import type {FMEvent} from '../src/types';
import {eventTool,isCommandTool} from './helpers';

/** Summarize only the visible title; original evidence is never rewritten. */
export function cleanTaskTitle(prompt:string):string{
 let title=prompt;
 const reply=title.match(/<send_user_message_question_reply>([\s\S]*?)<\/send_user_message_question_reply>/);
 if(reply){try{const answers=JSON.parse(reply[1]) as {answer?:unknown}[];title=answers.map(item=>typeof item.answer==='string'?item.answer:'').filter(Boolean).join(' · ');}catch{title='任务补充回复';}}
 title=title.replace(/<in-app-browser-context\b[^>]*>[\s\S]*?<\/in-app-browser-context>/g,'');
 const request=title.match(/## My request:\s*([\s\S]*)/);
 if(request)title=request[1];
 title=title.replace(/^PLEASE IMPLEMENT THIS PLAN:\s*/i,'');
 const heading=title.match(/^#\s+([^\r\n]+)/);if(heading)title=heading[1];
 return title.replace(/\s+/g,' ').trim().slice(0,100);
}
export function taskTitle(events:FMEvent[],fallback='等待记录'):string{
 for(let index=events.length-1;index>=0;index--){
  const event=events[index];
  if(event.kind==='task.started'&&typeof event.data.prompt==='string'){
   const title=cleanTaskTitle(event.data.prompt);if(title)return title;
  }
 }
 return cleanTaskTitle(fallback)||'等待记录';
}

/** These are original event indexes, never an inferred contribution score. */
export function recentActivities(events:FMEvent[],limit=6):{event:FMEvent;index:number}[]{
 const rows:{event:FMEvent;index:number}[]=[];
 for(let index=events.length-1;index>=0;index--){
  const event=events[index];
  if(event.kind==='session.started'||event.kind==='turn.completed'||event.kind==='usage.recorded')continue;
  if(event.kind==='tool.completed'&&!isCommandTool(eventTool(event))&&event.data.status!=='failed')continue;
  rows.push({event,index});
 }
 // Keep both sides legible when one producer sends many consecutive read events.
 // The retained records keep their original timestamps, indexes and evidence labels.
 const picked=new Set<number>();
 const perSide=Math.min(2,Math.floor(limit/2));
 for(const actor of ['codex','deepseek'] as const){
  for(const row of rows.filter(row=>row.event.actor===actor).slice(0,perSide))picked.add(row.index);
 }
 for(const row of rows){if(picked.size>=limit)break;picked.add(row.index);}
 return rows.filter(row=>picked.has(row.index)).sort((left,right)=>left.index-right.index);
}
export function latestHandoffIndex(events:FMEvent[]):number{
 for(let index=events.length-1;index>=0;index--)if(events[index].kind==='delegate.started')return index;
 return -1;
}
