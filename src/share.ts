import type {FMEvent,ShareOptions} from './types';
import {sanitize} from './privacy-text';
import {numericKeys,validNumbers} from './usage';
/** This projection is shared by the exact-content preview and the offline exporter. */
export function shareEvents(events:FMEvent[],options:ShareOptions):FMEvent[]{
 const start=Date.parse(events[0]?.at||'1970-01-01');const aliases=new Map<string,string>();
 const alias=(s:string,prefix:string)=>{const key=prefix+s;if(!aliases.has(key))aliases.set(key,`${prefix}-${aliases.size+1}`);return aliases.get(key)!;};
 return events.filter(e=>e.kind!=='usage.recorded'||options.usage).map((e,i)=>{
  const data:Record<string,unknown>={};
  if(options.prompts)for(const key of ['prompt','title'])if(key in e.data)data[key]=e.data[key];
  if(options.paths&&e.kind==='file.changed')data.path=e.data.path;
  if(options.diffs&&e.kind==='file.changed')data.diff=e.data.diff;
  if(options.outputs)for(const key of ['text','output','exitCode','status','message','reason'])if(key in e.data)data[key]=e.data[key];
  if(options.usage&&(e.kind==='tool.started'||e.kind==='tool.completed')&&typeof e.data.callId==='string')data.callId=alias(`${e.actor}:${e.sessionId}:${e.data.callId}`,'call');
  if(options.usage&&e.kind==='usage.recorded'){
   const numbers=validNumbers(e.data);if(numbers)for(const k of numericKeys)if(numbers[k]!==undefined)data[k]=numbers[k];
   data.sampleKey=alias(String(e.data.sampleKey||e.id),'sample');
   data.source=['codex-transcript','deepseek-step'].includes(String(e.data.source))?e.data.source:'unknown';
   data.coverage=['complete','partial','unavailable'].includes(String(e.data.coverage))?e.data.coverage:'unavailable';
  }
  return {version:1,id:`event-${i+1}`,runId:alias(e.runId,'run'),sessionId:alias(e.sessionId,'instance'),actor:e.actor,kind:e.kind,
   at:new Date(Math.max(0,Date.parse(e.at)-start)).toISOString(),seq:i+1,evidence:e.evidence,
   taskId:e.taskId?alias(e.taskId,'task'):undefined,parentTaskId:e.parentTaskId?alias(e.parentTaskId,'task'):undefined,data:sanitize(data) as Record<string,unknown>};
 });
}
