import {useEffect,useRef,useState,type RefObject} from 'react';
import type {FMEvent} from '../src/types';
import {ACTOR_LABEL,baseName,clockTime,eventSummary,eventTool,poseForTool,KIND_LABEL,stageLine,toolCompletionLabel,toolExitText,type ActorState,type ActorView,type Character,type Pose,POSE_LABEL} from './helpers';
import type {Mode} from './replay';

/* ------------------------------------------------------------- character art */

const failed=new Set<string>();
function assetPath(character:Character,pose:Pose,assets?:Record<string,string>):string{
 const path=`/characters/${character}-${pose}.png`;
 return assets&&assets[path]?assets[path]:path;
}

/** Licensed community-design sprites. Missing assets have an accessible fallback. */
export function CharacterView({character,pose,name,assets,muted}:{
 character:Character;pose:Pose;name:string;assets?:Record<string,string>;muted:boolean;
}){
 const [loadedSrc,setLoadedSrc]=useState<string|null>(null);
 const [brokenSrc,setBrokenSrc]=useState<string|null>(null);
 const src=character==='none'?null:assetPath(character,pose,assets);
 const broken=src&&(brokenSrc===src||failed.has(src));
 if(!src||broken)return <div className="char char-empty" role="img" aria-label={`${name} 立绘暂不可用`}><span>立绘待补</span></div>;
 return <div className={`char char-${character}${muted?' is-muted':''}`}>
  <img
   key={src}
   src={src}
   alt={`${name} 的${POSE_LABEL[pose]}姿态立绘`}
   draggable={false}
   style={{display:loadedSrc===src?'block':'none'}}
   onLoad={()=>setLoadedSrc(src)}
   onError={()=>{failed.add(src);setBrokenSrc(src);}}
  />
  {loadedSrc!==src?<span className="char-loading" aria-hidden="true">…</span>:null}
 </div>;
}

/* ---------------------------------------------------------------- summaries */

export function isUsageEvent(event:FMEvent|null|undefined):boolean{
 return !!event&&event.kind==='usage.recorded';
}

/**
 * 首页卡片上的一句话。只描述已记录的观测事实；命令是否成功以退出码为准，
 * 交稿只说“已交稿，等待检查”，绝不写成验收通过。技术细节留给详情面板。
 */
export function latestActionText(event:FMEvent|null|undefined):string{
 if(!event)return '还没有记录到动作';
 if(event.kind==='usage.recorded')return '记录了用量采样';
 if(event.kind==='tool.completed'&&toolCompletionLabel(event)==='命令退出码 0')return '该命令通过';
 if(event.kind==='delegate.completed'&&event.actor==='deepseek')return '已交稿，等待检查';
 if(event.kind==='tool.started'){
  const pose=poseForTool(eventTool(event));const input=event.data.input as Record<string,unknown>|undefined;
  const target=typeof input?.path==='string'?input.path:typeof input?.file_path==='string'?input.file_path:undefined;
  return pose==='read'?`正在读取${target?` ${baseName(target)}`:'文件或资料'}`:pose==='edit'?'正在使用编辑工具':'正在运行工具';
 }
 if(event.kind==='tool.completed')return event.data.status==='failed'||typeof event.data.exitCode==='number'&&event.data.exitCode!==0?'工具报错，待检查':'工具已结束，结果待检查';
 if(event.kind==='file.changed')return event.evidence==='observed'?`刚修改了 ${baseName(String(event.data.path||'文件'))}`:'发现文件变化，具体作者未确定';
 const lines:Partial<Record<FMEvent['kind'],string>>={'task.started':'接到新任务','session.started':'记录连接已建立','delegate.started':'已派活，等待交稿','agent.message':'提交了说明，待核对','delegate.failed':'这次任务失败，待检查','turn.completed':'这一轮已结束','turn.interrupted':'这一轮被中断','recording.gap':'记录不完整'};
 return lines[event.kind]||'等待记录';
}

/* --------------------------------------------------------------------- desk */

/** 实例 ID 很长：完整 ID 只在详情面板里出现。 */
function shortSession(id:string):string{
 const value=id.trim();
 if(value.length<=14)return value;
 return `${value.slice(0,7)}…${value.slice(-4)}`;
}

export function ActorCard({view,character,label,latest,assets,onOpen}:{
 view:ActorView;character:'codex'|'deepseek';label:string;latest:FMEvent|null;assets?:Record<string,string>;onOpen:()=>void;
}){
 const latestId=view.sessions.length?view.sessions[view.sessions.length-1]:null;
 const sentence=latestActionText(latest);
 return <section className={`actor-card actor-${character}${view.lastActionPose?' has-action':''}`} aria-label={`${label} 状态卡`}>
  <button type="button" className="actor-open" onClick={onOpen}>
   <span className="actor-head"><h3>{label}</h3><span className="actor-cue" aria-hidden="true">查看详情</span></span>
   <CharacterView character={character} pose={view.pose} name={label} assets={assets} muted={!view.lastActionPose}/>
   <span className="actor-latest">{sentence}</span>
  </button>
 </section>;
}

export function DeskPanel({actors,assets,stageOn,stageEvent,packet,onPacket,onActor,latestCodex,latestDeepseek}:{
 actors:ActorState;assets?:Record<string,string>;stageOn:boolean;stageEvent:FMEvent|null;packet:FMEvent|null;onPacket:()=>void;onActor:(character:'codex'|'deepseek')=>void;
 latestCodex:FMEvent|null;latestDeepseek:FMEvent|null;
}){
 return <div className="desk">
  <ActorCard view={actors.codex} character="codex" label="Codex（白龙侧）" latest={latestCodex} assets={assets} onOpen={()=>onActor('codex')}/>
  <div className="desk-center">
   {packet?<button key={packet.id} type="button" className={`handoff-packet ${packet.kind==='delegate.started'?'packet-right':'packet-left'}`} onClick={onPacket} aria-label="查看交接证据">
    <span aria-hidden="true">📁</span><strong>{packet.kind==='delegate.started'?'任务已递出':'交稿待检查'}</strong><small>点击查看真实交接记录</small>
   </button>:null}
   <div className="stage-line" aria-live="polite" aria-label="舞台字幕">
    <span className="stage-tag">舞台字幕</span>
    <p>{stageOn?(stageEvent?stageLine(stageEvent):'等待第一段记录，字幕还在后台候场。'):'舞台字幕已关闭（证据面板仍然保留全部记录）。'}</p>
    <span className="stage-note">趣味台词 · 实际操作见下方记录</span>
   </div>
   <div className="stage-hint" aria-hidden="true">HandoffFM · 交接台</div>
  </div>
  <ActorCard view={actors.deepseek} character="deepseek" label="DeepSeek（蓝鲸侧）" latest={latestDeepseek} assets={assets} onOpen={()=>onActor('deepseek')}/>
 </div>;
}

/* ----------------------------------------------------------------- timeline */

export function Timeline({events,index,mode,onSelect,listRef}:{
 events:FMEvent[];index:number;mode:Mode;onSelect:(index:number)=>void;listRef:RefObject<HTMLUListElement|null>;
}){
 const active=useRef<HTMLLIElement|null>(null);
 useEffect(()=>{if(mode==='replay'&&active.current)active.current.scrollIntoView({block:'nearest'});},[index,mode]);
 const start=events.length?Date.parse(events[0].at):0;
 return <ul className="timeline" ref={listRef} aria-label="活动时间线">
  {events.length===0?<li className="timeline-empty">等待记录</li>:null}
  {events.map((event,position)=>{
   const selected=position===index;
   const actorClass=event.actor==='codex'?'t-codex':event.actor==='deepseek'?'t-deepseek':event.actor==='system'?'t-system':'t-unknown';
   const unknown=event.evidence==='unknown';
   return <li key={event.id} ref={selected?active:undefined} className={`timeline-row ${actorClass}${selected?' is-selected':''}`}>
    <button type="button" className="timeline-button" aria-current={selected?'step':undefined}
     aria-label={`${KIND_LABEL[event.kind]}，${ACTOR_LABEL[event.actor]}，${eventSummary(event)}，${unknown?'归属未知':'证据已记录'}`}
     onClick={()=>onSelect(position)}>
     <span className="t-time">{clockTime(event.at,Number.isFinite(start)?start:0)}</span>
     <span className="t-kind">{KIND_LABEL[event.kind]}</span>
     <span className="t-actor">{ACTOR_LABEL[event.actor]}</span>
     <span className="t-summary">{eventSummary(event)}</span>
     {unknown?<span className="t-flag">归属未知</span>:null}
     {event.seq!=null?<span className="t-seq">#{event.seq}</span>:null}
    </button>
   </li>;
  })}
 </ul>;
}

/* ----------------------------------------------------------------- evidence */

export function EvidencePanel({event,startMs,panelRef}:{event:FMEvent|null;startMs:number;panelRef:RefObject<HTMLElement|null>}){
 const data=event?event.data:{};
 const usage=event?.kind==='usage.recorded';
 return <section className="evidence" ref={panelRef} tabIndex={-1} aria-label="证据面板">
  <h3>证据面板</h3>
  {!event?<p className="muted">选择时间线上的一条记录，这里显示原始字段。</p>:<>
   <dl className="evidence-meta">
    <div><dt>事件类型</dt><dd>{KIND_LABEL[event.kind]}</dd></div>
    <div><dt>角色 / 侧</dt><dd>{ACTOR_LABEL[event.actor]}</dd></div>
    <div><dt>证据等级</dt><dd className={event.evidence==='unknown'?'warn':''}>{event.evidence}</dd></div>
    <div><dt>实例</dt><dd>{event.sessionId}</dd></div>
    <div><dt>模型</dt><dd>{event.model||'未知'}</dd></div>
    <div><dt>记录时间</dt><dd>{clockTime(event.at,Number.isFinite(startMs)?startMs:0)} · {event.at}</dd></div>
    <div><dt>序号</dt><dd>{event.seq??'无'}</dd></div>
    <div><dt>任务</dt><dd>{event.taskId||'未记录'}{event.parentTaskId?` ← ${event.parentTaskId}`:''}</dd></div>
   </dl>
   {usage?<div className="evidence-block">
    <h4>用量采样</h4>
    <p>数字口径与来源说明集中在“用量明细”页签；这里只呈现原始记录，缺失字段不估算。</p>
    <p className="muted">来源：{typeof data.source==='string'?data.source:'未记录'} · 覆盖度：{typeof data.coverage==='string'?data.coverage:'未记录'}</p>
   </div>:null}
   {event.kind==='file.changed'?<div className="evidence-block">
    <h4>文件变化{event.evidence==='unknown'?' · 归属未知':''}</h4>
    <p>路径：{data.path?baseName(String(data.path)):'未记录'}</p>
    {event.evidence==='unknown'
     ?<p className="warn">候选归属：{String(data.candidateActor||'未知')} · 原因：{String(data.reason||'记录不足')}</p>
     :<p>归属依据：{String(data.reason||'明确的前后快照')}</p>}
    {typeof data.diff==='string'&&data.diff?<pre className="diff">{data.diff}</pre>:<p className="muted">没有可展示的文本差异。</p>}
   </div>:null}
   {event.kind==='tool.started'||event.kind==='tool.completed'?<div className="evidence-block">
    <h4>工具记录</h4>
    <p>工具名：{String(data.tool||(data.input as Record<string,unknown>|undefined)?.tool||'未记录')}</p>
    {toolExitText(data.exitCode)?<p>退出状态：{toolExitText(data.exitCode)}（只按已记录状态呈现，不推断验收结果）</p>:<p className="muted">没有退出码；不推断命令结果。</p>}
    {typeof data.status==='string'?<p>上报状态：{data.status}</p>:null}
    {data.truncated?<p className="warn">该记录被截断，内容与归属都不完整。</p>:null}
   </div>:null}
   <details className="evidence-block">
    <summary>原始数据（纯文本）</summary>
    <pre className="raw">{JSON.stringify(data,null,1)??''}</pre>
   </details>
  </>}
 </section>;
}
