import type {FMEvent,ShareOptions} from './types';
import {sanitize} from './privacy-text';
/** This projection is shared by the exact-content preview and the offline exporter. */
export function shareEvents(events:FMEvent[],options:ShareOptions):FMEvent[]{
 const start=Date.parse(events[0]?.at||'1970-01-01');const aliases=new Map<string,string>();
 const alias=(s:string,prefix:string)=>{const key=prefix+s;if(!aliases.has(key))aliases.set(key,`${prefix}-${aliases.size+1}`);return aliases.get(key)!;};
 return events.map((e,i)=>{
  const data:Record<string,unknown>={};
  if(options.prompts)for(const key of ['prompt','title'])if(key in e.data)data[key]=e.data[key];
  if(options.paths&&e.kind==='file.changed')data.path=e.data.path;
  if(options.diffs&&e.kind==='file.changed')data.diff=e.data.diff;
  if(options.outputs)for(const key of ['text','output','exitCode','status','message','reason'])if(key in e.data)data[key]=e.data[key];
  return {version:1,id:`event-${i+1}`,runId:alias(e.runId,'run'),sessionId:alias(e.sessionId,'instance'),actor:e.actor,kind:e.kind,
   at:new Date(Math.max(0,Date.parse(e.at)-start)).toISOString(),seq:i+1,evidence:e.evidence,
   taskId:e.taskId?alias(e.taskId,'task'):undefined,parentTaskId:e.parentTaskId?alias(e.parentTaskId,'task'):undefined,data:sanitize(data) as Record<string,unknown>};
 });
}
