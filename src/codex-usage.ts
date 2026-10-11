import {open,readFile,writeFile,rename,mkdir,readdir,stat} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {dir,enqueue,safeId} from './store';
import {acquireCollectorLock} from './collector-lock';
import {count,numericKeys,validNumbers} from './usage';
import type {UsageNumbers,UsageSample} from './types';
const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const CHUNK=256*1024,TAIL=2*1024*1024,LINE=64*1024;
async function replaceFile(from:string,to:string):Promise<void>{
 for(let attempt=0;;attempt++)try{await rename(from,to);return;}catch(error){
  if(attempt>=5||!['EPERM','EACCES','EBUSY'].includes(String((error as NodeJS.ErrnoException).code)))throw error;
  // Windows can briefly lock a destination while a concurrent hook opens it.
  await new Promise(resolve=>setTimeout(resolve,20*(attempt+1)));
 }
}
export interface NumericState {turn?:string;last?:UsageNumbers;sum:UsageNumbers;partial:boolean;fresh:boolean;boundaryMissing?:boolean;}
export function newNumericState(fresh=false):NumericState{return {sum:{},partial:!fresh,fresh};}
function counters(raw:any):UsageNumbers|null{
 if(!raw||typeof raw!=='object')return null;const n:UsageNumbers={};
 const fields={input_tokens:'input',output_tokens:'output',cached_input_tokens:'cacheRead',cache_write_input_tokens:'cacheWrite',reasoning_output_tokens:'reasoning',total_tokens:'total'} as const;
 for(const [key,to] of Object.entries(fields))if(raw[key]!==undefined){const value=count(raw[key]);if(value===undefined)return null;n[to as keyof UsageNumbers]=value;}
 if(n.input===undefined||n.output===undefined)return null;n.total??=n.input+n.output;
 return validNumbers(n);
}
/** Unstable transcript adapter. Only numeric usage and explicit turn identifiers survive this function. */
export function parseNumericLine(line:string,state:NumericState):{taskId:string;usage:UsageSample}|null{
 if(line.length>LINE){state.partial=true;return null;}
 let v:any;try{v=JSON.parse(line);}catch{state.partial=true;return null;}
 const p=v?.payload;
 if(v?.type==='event_msg'&&p?.type==='task_started'||v?.type==='turn_context'){
  const turn=typeof p?.turn_id==='string'&&safeId(p.turn_id)?p.turn_id:undefined;
  if(turn&&turn!==state.turn){state.turn=turn;state.sum={};state.partial=!!state.boundaryMissing||!state.last&&!state.fresh;state.boundaryMissing=false;}
  return null;
 }
 if(v?.type!=='event_msg'||p?.type!=='token_count')return null;
 const next=counters(p.info?.total_token_usage);
 if(!next){state.partial=true;return state.turn?{taskId:state.turn,usage:{...state.sum,sampleKey:state.turn,source:'codex-transcript',coverage:state.sum.total===undefined?'unavailable':'partial'}}:null;}
 const previous=state.last??(state.fresh?{input:0,output:0,cacheRead:0,cacheWrite:0,reasoning:0,total:0}:undefined);
 state.fresh=false;
 if(previous&&state.turn){
  const reset=next.input!<previous.input!||next.output!<previous.output!;
  if(reset)state.partial=true;
  else for(const key of numericKeys){
   if(next[key]===undefined||previous[key]===undefined){delete state.sum[key];continue;}
   const delta=next[key]!-previous[key]!;
   if(delta<0){state.partial=true;delete state.sum[key];continue;}
   state.sum[key]=(state.sum[key]??0)+delta;
  }
 }else if(state.turn)state.partial=true;
 state.last=next;
 if(!state.turn)return null;
 // A missing baseline is unknown, not a zero-token turn. Counter reset keeps only observed positive deltas.
 const sum=validNumbers(state.sum)??{input:state.sum.input,output:state.sum.output,total:state.sum.total};
 return {taskId:state.turn,usage:{...sum,sampleKey:state.turn,source:'codex-transcript',coverage:sum.total===undefined?'unavailable':state.partial?'partial':'complete'}};
}
interface Registration {sessionId:string;path:string;turns:string[];}
interface Checkpoint {pathHash:string;position:number;inode:string;anchor:string;discard:boolean;state:NumericState;epoch:number;}
/** Called only AFTER existing enabled-project scope validation; never from a browser request. */
export async function registerTranscript(root:string,input:any):Promise<void>{
 if(typeof input.transcript_path!=='string'||!isAbsolute(input.transcript_path)||!safeId(input.session_id)||!safeId(input.turn_id))return;
 const pathFolder=join(dir(root),'usage-paths');await mkdir(pathFolder,{recursive:true});
 let identity:string|undefined;try{const info=await stat(input.transcript_path);identity=`${info.dev}:${info.ino}`;}catch{}
 const pathMarker=join(pathFolder,hash(input.transcript_path+(identity??''))+'.json');
 try{await writeFile(pathMarker,JSON.stringify({path:input.transcript_path,identity}),{flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
 const folder=join(dir(root),'usage-sources');await mkdir(folder,{recursive:true});
 const turnFolder=join(dir(root),'usage-turns');await mkdir(turnFolder,{recursive:true});
 // Separate immutable turn markers avoid read/merge/write races between simultaneous hooks.
 const marker=join(turnFolder,`${hash(input.session_id)}-${hash(input.turn_id)}.json`);
 try{await writeFile(marker,JSON.stringify({sessionId:input.session_id,turnId:input.turn_id}),{flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
 const file=join(folder,hash(input.session_id)+'.json');let prior:Registration|undefined;
 try{prior=JSON.parse(await readFile(file,'utf8'));}catch{}
 const turns=[...new Set([...(prior&&prior.path===input.transcript_path?prior.turns:[]),input.turn_id])].slice(-128);
 const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify({sessionId:input.session_id,path:input.transcript_path,turns}));await replaceFile(temp,file);
}
const active=new Set<string>();
/** Bounded per tick; checkpoints contain offsets/IDs/numbers/hashes, never transcript text or reasoning. */
export async function pollCodexUsage(root:string):Promise<void>{
 if(active.has(root))return;active.add(root);let release:(()=>Promise<void>)|null=null;
 try{
  const folder=join(dir(root),'usage-sources');let names:string[];try{names=(await readdir(folder)).filter(n=>n.endsWith('.json')&&!n.endsWith('.cursor.json'));}catch{return;}
  if(!names.length)return;
  release=await acquireCollectorLock(join(dir(root),'usage.lock'));if(!release)return;
  // Rotate the bounded batch rather than starving registrations after the first four.
  const roundFile=join(folder,'round');let round=0;try{round=Number(await readFile(roundFile,'utf8'))||0;}catch{}
  const selected=Array.from({length:Math.min(4,names.length)},(_,i)=>names[(round+i)%names.length]);await writeFile(roundFile,String((round+selected.length)%names.length));
  for(const name of selected){
   let source:Registration;try{source=JSON.parse(await readFile(join(folder,name),'utf8'));}catch{continue;}
   if(!safeId(source.sessionId)||!Array.isArray(source.turns)||!isAbsolute(source.path))continue;
   try{const turnFolder=join(dir(root),'usage-turns');for(const name of (await readdir(turnFolder)).filter(n=>n.startsWith(hash(source.sessionId)+'-'))){
    const marker=JSON.parse(await readFile(join(turnFolder,name),'utf8'));if(marker.sessionId===source.sessionId&&safeId(marker.turnId)&&!source.turns.includes(marker.turnId))source.turns.push(marker.turnId);
   }}catch{}
   const cursorFile=join(folder,name.replace('.json','.cursor.json'));let cursor:Checkpoint|undefined;
   try{cursor=JSON.parse(await readFile(cursorFile,'utf8'));}catch{}
   let fd;try{fd=await open(source.path,'r');const info=await fd.stat();if(!info.isFile())continue;
    const inode=`${info.dev}:${info.ino}:${info.birthtimeMs}`,pathHash=hash(source.path);
    let restart=!!cursor&&(cursor.pathHash!==pathHash||cursor.inode!==inode||info.size<cursor.position);
    if(cursor&&!restart&&cursor.position){const anchor=Buffer.alloc(Math.min(256,cursor.position));await fd.read(anchor,0,anchor.length,cursor.position-anchor.length);restart=hash(anchor)!==cursor.anchor;}
    if(restart&&cursor){
     // Rewritten bytes are historical/ambiguous. Do not parse and sum them as fresh consumption.
     // Keep the existing sample and observed sum, skip to EOF, then establish a new numeric baseline.
     const probe=newNumericState(false),tail=Buffer.alloc(Math.min(CHUNK,info.size));await fd.read(tail,0,tail.length,info.size-tail.length);
     const lines=tail.toString('utf8').split('\n');if(info.size>tail.length)lines.shift();if(!tail.toString('utf8').endsWith('\n'))lines.pop();
     for(const line of lines)if(line)parseNumericLine(line,probe); // Counters establish a baseline only; probe sums are discarded.
     // A bounded probe may miss the boundary. Never retain the previous task in that case.
     if(probe.turn!==cursor.state.turn){cursor.state.turn=probe.turn;cursor.state.sum={};}
     cursor.state.boundaryMissing=!probe.turn;
     cursor.pathHash=pathHash;cursor.inode=inode;cursor.position=info.size;cursor.discard=false;cursor.state.last=probe.last;cursor.state.fresh=false;cursor.state.partial=true;
    }else if(!cursor){const position=Math.max(0,info.size-TAIL);cursor={pathHash,inode,position,anchor:'',discard:position>0,state:newNumericState(position===0),epoch:0};
    }
    const buffer=Buffer.alloc(Math.min(CHUNK,Math.max(0,info.size-cursor.position)));const {bytesRead}=await fd.read(buffer,0,buffer.length,cursor.position);
    const bytes=buffer.subarray(0,bytesRead);let begin=0;
    const emit=async(taskId:string,usage:UsageSample)=>{
     if(!source.turns.includes(taskId))return;const data={...usage,sampleKey:`${taskId}:epoch-${cursor!.epoch}`};
     if(restart||cursor!.epoch>0)data.coverage=data.total===undefined?'unavailable':'partial';
     await enqueue(root,{version:1,id:'usage-'+hash(source.sessionId+JSON.stringify(data)),runId:source.sessionId,sessionId:source.sessionId,actor:'codex',kind:'usage.recorded',at:new Date().toISOString(),taskId,turnId:taskId,evidence:'observed',data});
    };
    for(let i=0;i<bytes.length;i++)if(bytes[i]===10){
     if(!cursor.discard){const sample=parseNumericLine(bytes.subarray(begin,i).toString('utf8'),cursor.state);if(sample)await emit(sample.taskId,sample.usage);}
     else cursor.state.partial=true;
     cursor.discard=false;begin=i+1;
    }
    // Do not persist a partial raw line. Re-read its bytes next tick, or skip an oversized line with a boolean only.
    if(cursor.discard||bytes.length-begin>LINE){cursor.discard=true;cursor.state.partial=true;begin=bytes.length;}
    cursor.position+=begin;
    if(restart&&cursor.state.turn)await emit(cursor.state.turn,{...cursor.state.sum,sampleKey:cursor.state.turn,source:'codex-transcript',coverage:cursor.state.sum.total===undefined?'unavailable':'partial'});
    const anchor=Buffer.alloc(Math.min(256,cursor.position));await fd.read(anchor,0,anchor.length,cursor.position-anchor.length);cursor.anchor=hash(anchor);
    const temp=cursorFile+'.tmp';await writeFile(temp,JSON.stringify(cursor));await replaceFile(temp,cursorFile);
   }catch{
    // Source absent/changed/unsupported is unavailable; never capture the OS error (which may contain paths).
    for(const taskId of source.turns.slice(-1)){
     const sum=cursor?.state.turn===taskId?cursor.state.sum:{};
     const data={...sum,sampleKey:`${taskId}:epoch-${cursor?.epoch??0}`,source:'codex-transcript',coverage:sum.total===undefined?'unavailable':'partial'};
     await enqueue(root,{version:1,id:'usage-missing-'+hash(source.sessionId+taskId+JSON.stringify(data)),runId:source.sessionId,sessionId:source.sessionId,actor:'codex',kind:'usage.recorded',at:new Date().toISOString(),taskId,evidence:'observed',data}).catch(()=>{});
    }
   }finally{await fd?.close();}
  }
 }finally{if(release)await release().catch(()=>{});active.delete(root);}
}
