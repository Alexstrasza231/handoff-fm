import { readFile,writeFile,unlink,readdir } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { enqueue,loadConfig,dir,safeId } from './store';
import { within } from './registry';
import { snapshot,changes,hash,blob } from './snapshots';
import { safeRelative,redact } from './privacy';
import type { FMEvent } from './types';
import {excludedEvidence} from './evidence';
import {attributionEpoch} from './attribution';
export async function captureHook(root:string,input:any):Promise<void>{
 const cfg=await loadConfig(root);const bound=cfg.boundSessions.includes(input.session_id);
 const scope=input.tool_input?.workdir||input.tool_input?.cwd||input.cwd;
 const patch=String(input.tool_input?.command||'');
 const paths=input.tool_name==='apply_patch'?[...patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map(x=>safeRelative(root,resolve(input.cwd,x[1]))).filter(Boolean):[];
 if(!within(root,String(scope||''))&&!(bound&&(!input.tool_name||paths.length)))return;
 const session=String(input.session_id||'unknown'),run=safeId(session)?session:hash(session).slice(0,32);
 const tool=String(input.tool_name||''),call=String(input.tool_use_id||randomUUID()),file=join(dir(root),'pending',hash(session+call)+'.json');
 const base={version:1 as const,runId:run,actor:'codex' as const,sessionId:session,turnId:input.turn_id,taskId:input.turn_id,model:input.model,evidence:'observed' as const};
 const send=async(kind:FMEvent['kind'],data:Record<string,unknown>,evidence:FMEvent['evidence']='observed')=>enqueue(root,{...base,id:randomUUID(),kind,at:new Date().toISOString(),data,evidence});
 switch(input.hook_event_name){
  case 'SessionStart':await send('session.started',{source:input.source});break;
  case 'UserPromptSubmit':await send('task.started',{prompt:input.prompt});break;
  case 'PreToolUse':{
   // Pre/post snapshots prove content changes; generic shell activity never proves authorship.
   // Publish the operation marker before reading source; later siblings cannot
   // disappear from our snapshot window. Separate flags survive sibling completion.
   const excluded=await excludedEvidence(root,input.tool_input,input.cwd||root);
   const epoch=await attributionEpoch(root);
   await writeFile(file,JSON.stringify({session,paths,tool,before:{},overlap:true,excluded}));
   const others=(await readdir(join(dir(root),'pending'))).filter(n=>n.endsWith('.json')&&n!==file.split(/[\\/]/).at(-1));
   for(const name of others){await writeFile(join(dir(root),'pending',name)+'.overlap','1');await writeFile(file+'.overlap','1');}
   const before=await snapshot(root);
   await writeFile(file,JSON.stringify({session,before,paths,tool,overlap:others.length>0,excluded,epoch}));
   await send('tool.started',{tool,callId:call,input:excluded?'[excluded file evidence]':input.tool_input,excluded});break;
  }
  case 'PostToolUse':{
   let pending:any;try{pending=JSON.parse(await readFile(file,'utf8'));}catch{}
   const response=input.tool_response,exitCode=response?.exit_code??response?.exitCode;
   const excluded=pending?.excluded||await excludedEvidence(root,input.tool_input,input.cwd||root);
   await send('tool.completed',{tool,callId:call,output:excluded?'[excluded file evidence]':response,excluded,exitCode,status:typeof exitCode==='number'?(exitCode===0?'completed':'failed'):(response?.isError?'failed':'unknown')});
   if(pending){const after=await snapshot(root);const others=(await readdir(join(dir(root),'pending'))).filter(n=>n!==file.split(/[\\/]/).at(-1));
    for(const change of changes(pending.before,after)){
     const flagged=await readFile(file+'.overlap').then(()=>true,()=>false);
     const epoch=await attributionEpoch(root);
     const exact=tool==='apply_patch'&&pending.paths.includes(change.path)&&!pending.overlap&&!flagged&&others.length===0&&epoch!==null&&epoch===pending.epoch;
     const beforeBlob=await blob(root,change.before),afterBlob=await blob(root,change.after);
     await send('file.changed',{...change,before:undefined,after:undefined,beforeBlob,afterBlob,callId:call,candidateActor:'codex',reason:exact?'Explicit edit tool and isolated before/after evidence':'Indirect write or overlapping operation; attribution is unknown'},exact?'observed':'unknown');
    }await unlink(file).catch(()=>{});await unlink(file+'.overlap').catch(()=>{});
   }break;
  }
  case 'Stop':if(input.last_assistant_message)await send('agent.message',{text:input.last_assistant_message},'declared');await send('turn.completed',{});break;
  case 'Interrupt':{
   await send('turn.interrupted',{});
   for(const name of await readdir(join(dir(root),'pending')))if(name.endsWith('.json')){
    const pendingFile=join(dir(root),'pending',name);
    try{const pending=JSON.parse(await readFile(pendingFile,'utf8'));if(pending.session===session){await unlink(pendingFile);await unlink(pendingFile+'.overlap').catch(()=>{});await send('recording.gap',{message:'Interrupted operation has no paired completion'},'unknown');}}catch{}
   }break;
  }
  case 'SubagentStart':await send('delegate.started',{agentId:input.agent_id,agentType:input.agent_type});break;
  case 'SubagentStop':await send('delegate.completed',{agentId:input.agent_id,text:input.last_assistant_message},'declared');break;
 }
}
