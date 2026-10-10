import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {FMEvent} from '../src/types';

export type Mode='live'|'replay';

export interface ReplayState{
 mode:Mode;
 playing:boolean;
 speed:number;
 /** Playback time in ms relative to the first rendered event of the replay window. */
 playhead:number;
 duration:number;
 index:number;
 visible:FMEvent[];
 setMode:(mode:Mode)=>void;
 setPlaying:(playing:boolean)=>void;
 play:()=>void;
 setSpeed:(speed:number)=>void;
 scrub:(ms:number)=>void;
 step:(direction:1|-1)=>void;
 jump:(index:number)=>void;
}

export interface ReplayWindow{
 events:FMEvent[];
 duration:number;
 offsets:number[];
}

/** Playback follows reception order. Clamp producer clock regressions only in the
 * playhead offsets; original events/timestamps remain unchanged in the evidence. */
export function timeWindow(events:FMEvent[]):ReplayWindow{
 const start=Date.parse(events[0]?.at??'');
 const base=Number.isFinite(start)?start:0;
 let previous=0;
 const offsets=events.map(event=>{
  const at=Date.parse(event.at);
  previous=Math.max(previous,Number.isFinite(at)?Math.max(0,at-base):0);
  return previous;
 });
 return {events,duration:offsets.at(-1)??0,offsets};
}

function locate(offsets:number[],value:number):number{
 if(!offsets.length)return -1;
 if(!Number.isFinite(value))return -1;
 let index=0;
 while(index+1<offsets.length&&offsets[index+1]<=value)index++;
 return index;
}

/** Recorded-time replay: the playhead advances in real milliseconds scaled by the speed setting. */
export function useReplay(mode:Mode,events:FMEvent[]):ReplayState{
 const window=useMemo(()=>timeWindow(events),[events]);
 const [playing,setPlaying]=useState(false);
 const [playhead,setPlayhead]=useState(0);
 const [speed,setSpeed]=useState(1);
 const speedRef=useRef(speed);
 const frame=useRef(0);
 const lastTick=useRef(0);
 speedRef.current=speed;

 useEffect(()=>{
  if(mode==='live'){setPlaying(false);setPlayhead(window.duration);return;}
  setPlayhead(current=>Math.min(current,window.duration));
 },[mode,window.duration]);

 useEffect(()=>{
  if(mode!=='replay'||!playing)return;
  lastTick.current=performance.now();
  const tick=(now:number)=>{
   const delta=(now-lastTick.current)*speedRef.current;
   lastTick.current=now;
   setPlayhead(current=>{
    const next=current+delta;
    if(next>=window.duration){setPlaying(false);return window.duration;}
    return next;
   });
   frame.current=requestAnimationFrame(tick);
  };
  frame.current=requestAnimationFrame(tick);
  return ()=>cancelAnimationFrame(frame.current);
 },[mode,playing,window.duration]);

 const index=useMemo(()=>mode==='live'?window.events.length-1:locate(window.offsets,playhead),[mode,window.offsets,playhead,window.events.length]);

 const visible=useMemo(()=>{
  if(mode==='live')return window.events;
  return index<0?[]:window.events.slice(0,index+1);
 },[mode,window.events,index]);

 const jump=useCallback((target:number)=>{
  if(window.events.length===0)return;
  const next=Math.max(0,Math.min(window.events.length-1,target));
  setPlayhead(window.offsets[next]??0);
 },[window.events.length,window.offsets]);

 return {
  mode,playing,speed,playhead,duration:window.duration,index,visible,
  setMode:next=>{if(next==='live')setPlaying(false);},
  setPlaying,
  play:()=>{if(playhead>=window.duration)setPlayhead(0);setPlaying(true);},
  setSpeed,
  scrub:value=>setPlayhead(Math.max(0,Math.min(window.duration,value))),
  step:direction=>jump(index+direction),
  jump
 };
}

/** Next / previous 交接 or 失败 event, wrapping at the ends. */
export function findJump(events:FMEvent[],from:number,direction:1|-1,predicate:(event:FMEvent)=>boolean):number|null{
 if(!events.length)return null;
 const total=events.length;
 for(let offset=1;offset<=total;offset++){
  const index=((from+direction*offset)%total+total)%total;
  if(predicate(events[index]))return index;
 }
 return null;
}

export function isHandoff(event:FMEvent):boolean{
 return event.kind==='delegate.started'||event.kind==='delegate.completed';
}
export function isFailure(event:FMEvent):boolean{
 return event.kind==='delegate.failed'||event.kind==='turn.interrupted';
}
