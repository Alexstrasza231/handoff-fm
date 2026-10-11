import type {FMEvent,UsageNumbers,UsageSample,UsageCoverage} from './types';
export const numericKeys=['input','output','cacheRead','cacheWrite','reasoning','total'] as const;
export function count(value:unknown):number|undefined{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:undefined;}
/** Reject malformed samples instead of silently converting a missing number to zero. */
export function validNumbers(v:unknown):UsageNumbers|null{
 if(!v||typeof v!=='object')return null;const source=v as Record<string,unknown>,n:UsageNumbers={};
 for(const k of numericKeys)if(source[k]!==undefined){const value=count(source[k]);if(value===undefined)return null;n[k]=value;}
 if(n.reasoning!==undefined&&n.output!==undefined&&n.reasoning>n.output)return null;
 if(n.input!==undefined&&(n.cacheRead??0)+(n.cacheWrite??0)>n.input)return null;
 if(n.total!==undefined&&n.input!==undefined&&n.output!==undefined&&n.total!==n.input+n.output)return null;
 return n;
}
/** DSH inputTokens excludes cache, while Codex input_tokens includes it. */
export function deepseekUsage(raw:unknown,sampleKey:string):UsageSample{
 const missing:UsageSample={sampleKey,source:'deepseek-step',coverage:'unavailable'};
 if(!raw||typeof raw!=='object')return missing;const v=raw as Record<string,unknown>;
 const mapping={inputTokens:'input',outputTokens:'output',cacheReadTokens:'cacheRead',cacheWriteTokens:'cacheWrite',reasoningTokens:'reasoning',totalTokens:'total'} as const;
 const n:UsageNumbers={};for(const [from,to] of Object.entries(mapping))if(v[from]!==undefined){const value=count(v[from]);if(value===undefined)return missing;n[to as keyof UsageNumbers]=value;}
 if(n.input===undefined||n.output===undefined||n.reasoning!==undefined&&n.reasoning>n.output)return missing;
 const known=n.input+(n.cacheRead??0)+(n.cacheWrite??0),cachesKnown=n.cacheRead!==undefined&&n.cacheWrite!==undefined;
 const input=n.total!==undefined?n.total-n.output:cachesKnown?known:undefined;
 if(input!==undefined&&(input<known||cachesKnown&&input!==known||!Number.isSafeInteger(input)))return missing;
 return {sampleKey,source:'deepseek-step',coverage:input!==undefined&&cachesKnown?'complete':'partial',input,output:n.output,cacheRead:n.cacheRead,cacheWrite:n.cacheWrite,reasoning:n.reasoning,total:input===undefined?undefined:input+n.output};
}
export function resolveParentTask(events:FMEvent[],sessionId:string):string|undefined{
 const active=new Set<string>();for(const e of events){if(e.actor!=='codex'||e.sessionId!==sessionId||!e.taskId)continue;
  if(e.kind==='task.started')active.add(e.taskId);if(e.kind==='turn.completed'||e.kind==='turn.interrupted')active.delete(e.taskId);
 }return active.size===1?[...active][0]:undefined;
}
export interface ActorUsage extends UsageNumbers {coverage:UsageCoverage;sources:string[];updatedAt?:string;samples:number;tools:number;}
export interface UsageSummary extends UsageNumbers {coverage:UsageCoverage;taskId?:string;startedAt?:string;elapsedMs?:number;tools:number;unassociated:number;actors:Record<'codex'|'deepseek',ActorUsage>;}
export function unassociatedUsage(events:FMEvent[]):{taskId:string;sessionId:string;usage:ActorUsage}[]{
 const jobs=new Map<string,{taskId:string;sessionId:string}>();for(const e of events)if(e.kind==='usage.recorded'&&e.actor==='deepseek'&&!e.parentTaskId&&e.taskId)jobs.set(`${e.sessionId}:${e.taskId}`,{taskId:e.taskId,sessionId:e.sessionId});
 return [...jobs.values()].map(job=>({...job,usage:summarizeUsage(events.filter(e=>e.actor==='deepseek'&&e.taskId===job.taskId&&e.sessionId===job.sessionId),{scope:'session'}).actors.deepseek}));
}
/** Input is a rendered event prefix: replay cannot see future samples. Latest sample wins in journal order. */
export function summarizeUsage(events:FMEvent[],options:{scope:'task'|'session';now?:number}):UsageSummary{
 const task=[...events].reverse().find(e=>e.kind==='task.started'&&e.actor==='codex');
 const linked=new Set<string>();for(const e of events)if(e.parentTaskId===task?.taskId&&e.taskId&&task?.taskId)linked.add(e.taskId);
 const inTask=(e:FMEvent)=>!!task?.taskId&&(e.taskId===task.taskId||e.parentTaskId===task.taskId||!!e.taskId&&linked.has(e.taskId));
 const selected=options.scope==='session'?events:events.filter(inTask);
 const actors:UsageSummary['actors']={codex:{coverage:'unavailable',sources:[],samples:0,tools:0},deepseek:{coverage:'unavailable',sources:[],samples:0,tools:0}};
 const samples=new Map<string,FMEvent>();
 for(const e of selected)if(e.kind==='usage.recorded'&&(e.actor==='codex'||e.actor==='deepseek')&&typeof e.data.sampleKey==='string')samples.set(`${e.actor}:${e.sessionId}:${e.taskId}:${e.data.sampleKey}`,e);
 const calls=new Set<string>();for(const e of selected)if((e.kind==='tool.started'||e.kind==='tool.completed')&&typeof e.data.callId==='string'){
  const key=`${e.actor}:${e.sessionId}:${e.data.callId}`;if(!calls.has(key)){calls.add(key);if(e.actor==='codex'||e.actor==='deepseek')actors[e.actor].tools++;}
 }
 for(const actor of ['codex','deepseek'] as const){const rows=[...samples.values()].filter(e=>e.actor===actor),a=actors[actor];
  let complete=rows.length>0;
  const expectedTasks=new Set(selected.filter(e=>actor==='codex'?e.actor==='codex'&&e.kind==='task.started':e.actor==='deepseek'||e.kind==='delegate.started').map(e=>e.taskId).filter(Boolean));
  const sampledTasks=new Set(rows.map(e=>e.taskId));if([...expectedTasks].some(id=>!sampledTasks.has(id)))complete=false;
  for(const e of rows){const n=validNumbers(e.data);a.samples++;a.updatedAt=e.at;
   if(typeof e.data.source==='string'&&!a.sources.includes(e.data.source))a.sources.push(e.data.source);
   if(!n||e.data.coverage!=='complete'||n.total===undefined)complete=false;
   if(n)for(const key of numericKeys)if(n[key]!==undefined)a[key]=(a[key]??0)+n[key]!;
  }a.coverage=complete?'complete':a.total!==undefined||a.output!==undefined?'partial':'unavailable';
 }
 const expected=(['codex','deepseek'] as const).filter(a=>a==='codex'||selected.some(e=>e.actor===a||e.kind==='delegate.started'));
 const result:UsageSummary={actors,tools:calls.size,coverage:expected.every(a=>actors[a].coverage==='complete')?'complete':expected.some(a=>actors[a].total!==undefined||actors[a].output!==undefined)?'partial':'unavailable',taskId:task?.taskId,
  unassociated:events.filter(e=>e.kind==='usage.recorded'&&e.actor==='deepseek'&&!e.parentTaskId).length};
 for(const k of numericKeys)for(const a of expected)if(actors[a][k]!==undefined)result[k]=(result[k]??0)+actors[a][k]!;
 const start=options.scope==='task'?task:events.find(e=>e.kind==='task.started');
 if(start){result.startedAt=start.at;const end=options.scope==='task'?selected.filter(e=>e.actor==='codex'&&(e.kind==='turn.completed'||e.kind==='turn.interrupted')).at(-1):undefined;
  const last=events.at(-1);const endMs=end?Date.parse(end.at):options.now??Date.parse(last?.at||start.at);
  if(Number.isFinite(endMs)&&Number.isFinite(Date.parse(start.at)))result.elapsedMs=Math.max(0,endMs-Date.parse(start.at));
 }return result;
}
