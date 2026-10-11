import type {FMEvent} from '../src/types';
import {characterOf} from './helpers';

export type Source='live'|'demo'|'offline';
export type AuthState='ok'|'missing'|'invalid';
export type Connection='initial'|'connected'|'disconnected';

export interface RunRow{id:string;title:string;updated:string;count:number;}
export interface Loaded{
 source:Source;
 events:FMEvent[];
 runs:RunRow[];
 options?:Record<string,boolean>;
 assets?:Record<string,string>;
}

const TOKEN_KEY='handoff-fm-token';
const SELECTED_RUN_KEY='handoff-fm-selected-run';

/** Only explicit live choices survive a tab refresh. Removed runs fall back to the service order. */
export function initialLiveRun(runs:RunRow[]):string{
 let saved='';
 try{saved=sessionStorage.getItem(SELECTED_RUN_KEY)||'';}catch{/* Storage may be disabled. */}
 return runs.some(run=>run.id===saved)?saved:runs[0]?.id||'';
}

export function rememberLiveRun(run:string):void{
 try{sessionStorage.setItem(SELECTED_RUN_KEY,run);}catch{/* Selection still works without storage. */}
}

/** Read the token from the URL fragment, keep it for reloads, then erase it from the address bar. */
export function captureToken():string{
 let token='';
 try{
  const hash=location.hash.startsWith('#')?location.hash.slice(1):location.hash;
  const params=new URLSearchParams(hash);
  token=params.get('token')||'';
  if(token){
   sessionStorage.setItem(TOKEN_KEY,token);
   history.replaceState(null,'',location.pathname+location.search);
  }else{
   token=sessionStorage.getItem(TOKEN_KEY)||'';
  }
 }catch{token='';}
 return token;
}

export function offlinePayload():Loaded|null{
 const raw=typeof window!=='undefined'?window.__HANDOFF_FM_OFFLINE__:undefined;
 if(!raw)return null;
 const events=Array.isArray(raw.events)?raw.events:[];
 return {
  source:'offline',
  events:sortEvents(events),
  runs:runsFrom(events),
  options:raw.options?{...raw.options}:undefined,
  assets:raw.assets||{}
 };
}

export function demoLoaded(events:FMEvent[]):Loaded{
 return {source:'demo',events:sortEvents(events),runs:runsFrom(events)};
}

export function sortEvents(events:FMEvent[]):FMEvent[]{
 return [...events].sort((a,b)=>{
  const sa=a.seq??0,sb=b.seq??0;
  if(sa!==sb)return sa-sb;
  const ta=Date.parse(a.at),tb=Date.parse(b.at);
  return (Number.isFinite(ta)?ta:0)-(Number.isFinite(tb)?tb:0);
 });
}

const DEFAULT_TITLE='记录中的协作';
export function runsFrom(events:FMEvent[]):RunRow[]{
 const runs=new Map<string,RunRow>();
 for(const event of events){
  const prior=runs.get(event.runId);
  const title=event.kind==='task.started'?String(event.data.prompt||'').slice(0,120)||prior?.title||'记录的任务':prior?.title||DEFAULT_TITLE;
  runs.set(event.runId,{id:event.runId,title,updated:event.at,count:(prior?.count||0)+1});
 }
 return [...runs.values()].sort((a,b)=>(Date.parse(b.updated)||0)-(Date.parse(a.updated)||0));
}

/* --------------------------------------------------------------- live fetch */

export class ApiError extends Error{
 readonly status:number;
 constructor(message:string,status:number){super(message);this.name='ApiError';this.status=status;}
}

export function createLiveApi(token:string){
 const auth=()=>({Authorization:`Bearer ${token}`});
 const json=async(path:string):Promise<unknown>=>{
  let response:Response;
  try{response=await fetch(path,{headers:auth(),cache:'no-store'});}catch{throw new ApiError('无法连接到本地服务，请确认 handoff-fm 仍在运行。',0);}
  if(!response.ok)throw new ApiError(response.status===401?'访问令牌无效或已过期，请重新从启动命令打开界面。':`服务返回错误（HTTP ${response.status}）。`,response.status);
  try{return await response.json();}catch{throw new ApiError('服务返回了无法解析的数据。',response.status);}
 };
 return {
  token,
  runs:async():Promise<RunRow[]>=>{
   const rows=await json('/api/runs');
   if(!Array.isArray(rows))throw new ApiError('运行列表格式异常。',200);
   return rows.filter((row):row is RunRow=>!!row&&typeof row==='object'&&typeof (row as RunRow).id==='string')
    .map(row=>({id:row.id,title:String(row.title||DEFAULT_TITLE),updated:String(row.updated||''),count:Number(row.count)||0}));
  },
  events:async(run:string):Promise<FMEvent[]>=>{
   const rows=await json(`/api/events?run=${encodeURIComponent(run)}`);
   return Array.isArray(rows)?sortEvents(rows as FMEvent[]):[];
  },
  streamUrl:(since:number)=>`/api/stream?since=${since}&token=${encodeURIComponent(token)}`,
  exportUrl:(run:string,options:Record<string,boolean>)=>{
   const params=new URLSearchParams({run});
   for(const key of ['prompts','paths','diffs','outputs','usage'])params.set(key,options[key]?'true':'false');
   return `/api/export?${params.toString()}`;
  },
  download:async(url:string):Promise<Blob>=>{
   const response=await fetch(url,{headers:auth(),cache:'no-store'});
   if(!response.ok)throw new ApiError(response.status===401?'导出需要有效令牌，请重新打开界面。':`导出失败（HTTP ${response.status}）。`,response.status);
   return response.blob();
  }
 };
}
export type LiveApi=ReturnType<typeof createLiveApi>;

/** SSE client: dedups by id and seq, reconnects with the last known sequence, honors Last-Event-ID. */
export class EventStream{
 private source:EventSource|null=null;
 private seenIds=new Set<string>();
 private lastSeq=0;
 private closed=false;
 private readonly url:(since:number)=>string;
 private readonly handlers:{
  event:(event:FMEvent)=>void;
  status:(connection:Connection)=>void;
  error:(message:string)=>void;
 };
 constructor(url:(since:number)=>string,handlers:{
  event:(event:FMEvent)=>void;
  status:(connection:Connection)=>void;
  error:(message:string)=>void;
 }){
  this.url=url;
  this.handlers=handlers;
  this.seenIds=new Set();
 }
 get sequence():number{return this.lastSeq;}
 start(since:number,seed:FMEvent[]=[]):void{
  this.stop();
  this.closed=false;
  this.seenIds.clear();
  this.lastSeq=Math.max(since,0,...seed.map(event=>event.seq??0));
  for(const event of seed)this.seenIds.add(event.id);
  this.open();
 }
 private open():void{
  if(this.closed)return;
  const source=new EventSource(this.url(this.lastSeq));
  this.source=source;
  source.onopen=()=>this.handlers.status('connected');
  source.onmessage=(message)=>{
   let event:FMEvent;
   try{event=JSON.parse(message.data) as FMEvent;}catch{return;}
   const seq=Number(message.lastEventId||event.seq||0);
   // Compare with the previous cursor before advancing it; otherwise every new
   // message looks like a duplicate of itself and is silently discarded.
   if(this.remember(event))this.handlers.event(event);
   if(Number.isFinite(seq)&&seq>0)this.lastSeq=Math.max(this.lastSeq,seq);
  };
  source.onerror=()=>{
   if(this.closed)return;
   this.handlers.status('disconnected');
   // EventSource retries on its own and sends Last-Event-ID; surface a plain hint for the user.
   this.handlers.error('实时连接中断，浏览器会带着最后序号重试；也可以手动重连。');
  };
 }
 /** Browsers expose Last-Event-ID themselves; this is only used on a manual reconnect. */
 reconnect():void{this.stop();this.closed=false;this.open();}
 private remember(event:FMEvent):boolean{
  if(this.seenIds.has(event.id))return false;
  if(event.seq!=null&&event.seq<=this.lastSeq)return false;
  this.seenIds.add(event.id);
  return true;
 }
 stop():void{
  this.closed=true;
  if(this.source){this.source.close();this.source=null;}
 }
}

/** Append a streamed event, deduplicating by both id and sequence number.
 *  Sequences are global on the wire, so the sequence guard only applies inside the active run. */
export function appendEvent(list:FMEvent[],incoming:FMEvent,activeRun:string):FMEvent[]{
 if(list.some(existing=>existing.id===incoming.id))return list;
 if(incoming.runId===activeRun&&incoming.seq!=null&&list.some(existing=>existing.seq===incoming.seq&&existing.runId===incoming.runId))return list;
 return sortEvents([...list,incoming]);
}

export function sideText(actor:string):string{
 const character=characterOf(actor as FMEvent['actor']);
 return character==='codex'?'白龙侧':character==='deepseek'?'蓝鲸侧':'未知侧';
}
