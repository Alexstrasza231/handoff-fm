import { spawn,spawnSync } from 'node:child_process';
import { readFile,writeFile,unlink,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FMEvent } from './types';
import { enqueue,loadConfig,dir,safeId } from './store';
import { snapshot,changes,blob,hash } from './snapshots';
import {commandSpec} from './process';
import {excludedEvidence} from './evidence';
import {rotateAttributionEpoch} from './attribution';
export interface DSContext {runId:string;sessionId:string;taskId:string;parentTaskId?:string;}
export function completionReason(v:unknown):string{
 return typeof v==='string'?v:v&&typeof v==='object'&&'kind' in v?String(v.kind):'unknown';
}
export function normalizeDSH(v:any,c:DSContext):FMEvent[]{
 if(!v||['thinking','text','status'].includes(v.type))return [];
 const truncated=!!v.truncated||JSON.stringify(v.input??v.result??'').length>65536;
 const base={version:1 as const,id:randomUUID(),...c,actor:'deepseek' as const,at:new Date().toISOString(),evidence:truncated?'unknown' as const:'observed' as const};
 if(v.type==='session')return [{...base,sessionId:v.sessionId||c.sessionId,kind:'session.started',data:{}}];
 if(v.type==='tool_call')return [{...base,kind:'tool.started',data:{tool:v.tool,callId:v.callId,input:v.input,truncated}}];
 if(v.type==='tool_result')return [{...base,kind:'tool.completed',data:{callId:v.callId,status:v.status,output:v.result,truncated}}];
 if(v.type==='final')return [{...base,kind:'agent.message',evidence:'declared',data:{text:v.text}}];
 if(v.type==='error')return [{...base,kind:'delegate.failed',data:{message:v.message}}];
 return [];
}
export async function delegate(root:string,options:{taskFile:string;title:string;parentSession:string;parentTurn?:string;sessionId?:string}):Promise<number>{
 const cfg=await loadConfig(root),task=await readFile(options.taskFile,'utf8');if(!task.trim()||task.length>128*1024)throw new Error('Task must be non-empty and <=128 KiB');
 if(options.sessionId&&!safeId(options.sessionId))throw new Error('Invalid DeepSeek session ID');
 const runId=safeId(options.parentSession)?options.parentSession:hash(options.parentSession).slice(0,32),taskId='task-'+randomUUID();
 const c:DSContext={runId,sessionId:'pending-'+taskId,taskId,parentTaskId:options.parentTurn};
 let invalid=false;
 const send=async(e:FMEvent)=>{try{await enqueue(root,e);}catch{invalid=true;process.stderr.write('HandoffFM: recording gap; the delegate continues.\n');}};
 const emit=async(kind:FMEvent['kind'],data:Record<string,unknown>,actor:FMEvent['actor']='deepseek',evidence:FMEvent['evidence']='observed')=>send({version:1,id:randomUUID(),...c,sessionId:actor==='codex'?options.parentSession:c.sessionId,actor,kind,at:new Date().toISOString(),evidence,data});
 const gap=async(message:string)=>{invalid=true;await emit('recording.gap',{message},'system','unknown');};
 const takeSnapshot=async()=>{try{return await snapshot(root);}catch{await gap('Snapshot unavailable; file changes could not be captured');return null;}};
 const args=['headless','--json',...(options.sessionId?['--session-id',options.sessionId]:[]),'-'];
 const spec=commandSpec(cfg.dshCommand||'dsh',args);
 if(!await rotateAttributionEpoch(root))await gap('Attribution guard unavailable; delegate recording is incomplete');
 await emit('delegate.started',{title:options.title,prompt:task,parentSession:options.parentSession},'codex');
 const windowMarker=join(dir(root),'pending',`delegate-${taskId}.json`);
 const pendingMarkers=new Set<string>();
 try{
 try{
 await writeFile(windowMarker,JSON.stringify({actor:'deepseek',taskId}));
 for(const name of await readdir(join(dir(root),'pending')))if(name.endsWith('.json')&&join(dir(root),'pending',name)!==windowMarker)await writeFile(join(dir(root),'pending',name)+'.overlap','1');
 }catch{await gap('Task-window recording unavailable; the delegate continues');}
 const taskBefore=await takeSnapshot();
 const child=spawn(spec.command,spec.args,{...spec.options,cwd:root,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
 let interrupted=false;
 const cancel=()=>{interrupted=true;if(!child.pid)return;
  if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:5000});
  else try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}
 };
 process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
 child.stdin.end(task);
 let queue=Promise.resolve(),answer='',reason='',hadFinal=false;
 let lastSnapshot=taskBefore;const reported=new Set<string>();
 const calls=new Map<string,{before:Awaited<ReturnType<typeof snapshot>>;input:any;tool:string;truncated:boolean;pending:string;overlap:boolean;excluded:boolean}>();
 const onLine=(line:string)=>{queue=queue.then(async()=>{
  if(line.length>1024*1024){invalid=true;await emit('recording.gap',{message:'Oversized DeepSeek event excluded'},'system','unknown');return;}
  let v:any;try{v=JSON.parse(line);}catch{invalid=true;await emit('recording.gap',{message:'Invalid DeepSeek event excluded'},'system','unknown');return;}
  if(v.type==='session')c.sessionId=v.sessionId||c.sessionId;
  if(v.type==='status'&&v.phase==='turn_end')reason=completionReason(v.reason);
  if(v.type==='final'){answer=String(v.text||'');hadFinal=true;}
  if(v.type==='tool_call'&&(typeof v.callId!=='string'||!v.callId)){invalid=true;await emit('recording.gap',{message:'Uncorrelated tool call excluded'},'system','unknown');return;}
  if(v.type==='tool_call'&&v.callId){const before=lastSnapshot;if(!before){await gap('Tool snapshot unavailable; tool evidence excluded');return;}const pending=join(dir(root),'pending','ds-'+hash(taskId+v.callId)+'.json');const overlap=(await readdir(join(dir(root),'pending'))).length>0;
   const excluded=await excludedEvidence(root,v.input);
   await writeFile(pending,JSON.stringify({actor:'deepseek',taskId}));pendingMarkers.add(pending);calls.set(v.callId,{before,input:v.input,tool:v.tool,truncated:!!v.truncated,pending,overlap,excluded});}
  for(const e of normalizeDSH(v,c)){
   const excluded=calls.get(v.callId)?.excluded;
   if(v.type==='tool_call'&&excluded)e.data.input='[excluded file evidence]';
   if(v.type==='tool_result'&&(excluded||!calls.has(v.callId)))e.data.output='[excluded or unmatched file evidence]';
   if(excluded)e.data.excluded=true;
   await send(e);
  }
  if(v.type==='tool_result'&&calls.has(v.callId)){
   const call=calls.get(v.callId)!;const after=await snapshot(root);const others=(await readdir(join(dir(root),'pending'))).filter(n=>n!==call.pending.split(/[\\/]/).at(-1));
   for(const change of changes(call.before,after)){
    // DSH is an asynchronous external process: its stdout notification is not a pre-write barrier.
    // Even direct-looking tools cannot prove isolation, so retain the candidate without false certainty.
    await emit('file.changed',{...change,before:undefined,after:undefined,beforeBlob:await blob(root,change.before),afterBlob:await blob(root,change.after),callId:v.callId,candidateActor:'deepseek',reason:'Observed during delegate tool; external event stream is not a pre-write barrier'},'deepseek','unknown');
    reported.add(change.path+'@'+change.afterHash);
   }lastSnapshot=after;await unlink(call.pending).catch(()=>{});calls.delete(v.callId);
  }
 }).catch(async()=>{invalid=true;await emit('recording.gap',{message:'DeepSeek evidence could not be captured'},'system','unknown');});};
 // Bound the line buffer before parsing: readline would retain an arbitrarily
 // long line in memory. Discard an oversized line until its next delimiter.
 let lineBuffer='',discarding=false;child.stdout.setEncoding('utf8');
 child.stdout.on('data',(chunk:string)=>{
  const pieces=chunk.split('\n');for(let i=0;i<pieces.length;i++){
   if(!discarding){if(lineBuffer.length+pieces[i].length>1024*1024){lineBuffer='';discarding=true;onLine(' '.repeat(1024*1024+1));}else lineBuffer+=pieces[i];}
   if(i<pieces.length-1){if(!discarding&&lineBuffer.trim())onLine(lineBuffer);lineBuffer='';discarding=false;}
  }
 });
 child.stdout.on('end',()=>{if(!discarding&&lineBuffer.trim())onLine(lineBuffer);lineBuffer='';});
 child.stderr.on('data',()=>{/* DSH diagnostics can contain reasoning. Deliberately do not persist or relay them. */});
 let processError='';child.on('error',e=>{processError=e.message;});
 const exit=await new Promise<number>(done=>child.on('close',code=>done(code??1)));process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);await queue;
 for(const call of calls.values())await unlink(call.pending).catch(()=>{});
 const taskAfter=await takeSnapshot();
 for(const change of taskBefore&&taskAfter?changes(taskBefore,taskAfter):[]){if(reported.has(change.path+'@'+change.afterHash))continue;
  try{
  await emit('file.changed',{...change,before:undefined,after:undefined,beforeBlob:await blob(root,change.before),afterBlob:await blob(root,change.after),candidateActor:'deepseek',reason:'Task-window snapshot; exact writer is unknown'},'deepseek','unknown');
  }catch{await gap('File evidence storage unavailable; delegate result is preserved');}
 }
 await unlink(windowMarker).catch(()=>{});await unlink(windowMarker+'.overlap').catch(()=>{});
 if(interrupted){reason='interrupted';await emit('turn.interrupted',{},'deepseek');}
 const success=!interrupted&&exit===0&&hadFinal&&reason==='completed';
 if(exit===0&&(!hadFinal||!reason)){invalid=true;await emit('recording.gap',{message:'Delegate terminal event is missing; completion could not be verified'},'system','unknown');}
 await emit(success?'delegate.completed':'delegate.failed',{exitCode:exit,reason:reason||'unknown',message:processError||undefined,recordingIncomplete:invalid},'deepseek');
 process.stdout.write(answer+(answer.endsWith('\n')?'':'\n'));process.stderr.write(`HandoffFM run: ${runId}; task: ${taskId}\n`);return success?0:1;
 }catch(e){await emit('delegate.failed',{message:(e as Error).message,reason:'recording-or-launch-error'},'deepseek');throw e;}
 finally{
  for(const marker of pendingMarkers){await unlink(marker).catch(()=>{});await unlink(marker+'.overlap').catch(()=>{});}
  await unlink(windowMarker).catch(()=>{});await unlink(windowMarker+'.overlap').catch(()=>{});
 }
}
