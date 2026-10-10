import {useEffect,useRef,useState,type RefObject} from 'react';
import type {FMEvent} from '../src/types';
import {ACTOR_LABEL,baseName,clockTime,eventSummary,KIND_LABEL,stageLine,type ActorState,type ActorView,type Character,type Pose,POSE_LABEL,toolExitText} from './helpers';
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

/* --------------------------------------------------------------------- desk */

function humanTime(at:string|null):string{
 if(!at)return '无记录';
 const ms=Date.parse(at);
 if(!Number.isFinite(ms))return '时间未知';
 const date=new Date(ms);
 return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}:${String(date.getSeconds()).padStart(2,'0')}`;
}
function ago(ms:number):string|null{
 if(!Number.isFinite(ms)||ms<1000)return null;
 const seconds=Math.floor(ms/1000);
 if(seconds<60)return `${seconds} 秒前`;
 const minutes=Math.floor(seconds/60);
 if(minutes<60)return `${minutes} 分钟前`;
 return `${Math.floor(minutes/60)} 小时前`;
}

/** 实例 ID 很长：卡片上只显示缩短形式，完整 ID 始终保留在 title 里。 */
function shortSession(id:string):string{
 const value=id.trim();
 if(value.length<=14)return value;
 return `${value.slice(0,7)}…${value.slice(-4)}`;
}

function ActorCard({view,character,label,assets,mode,now}:{
 view:ActorView;character:Character;label:string;assets?:Record<string,string>;mode:Mode;now:number;
}){
 const stale=view.at?ago(now-Date.parse(view.at)):null;
 const latest=view.sessions.length?view.sessions[view.sessions.length-1]:null;
 const latestLabel=latest?shortSession(latest):'尚未记录到实例';
 const earlier=view.sessions.slice(0,-1);
 return <section className={`actor-card actor-${character}${view.lastActionPose?' has-action':''}`} aria-label={`${label} 状态卡`}>
  <header className="actor-head">
   <div className="actor-id">
    <h3>{label}</h3>
    <p className="actor-session" title={latest??view.sessionLabel}>实例 <span className="actor-session-id">{latestLabel}</span></p>
   </div>
   <span className="pose-chip">当前姿态：{POSE_LABEL[view.pose]}</span>
  </header>
  <CharacterView character={character} pose={view.pose} name={label} assets={assets} muted={!view.lastActionPose}/>
  <p className="actor-facts">
   <span className="fact"><b>状态</b>{view.status}</span>
   <span className="fact"><b>模型</b>{view.model}</span>
  </p>
  <details className="actor-more">
   <summary>实例信息</summary>
   <dl className="actor-meta">
    <div><dt>当前状态</dt><dd>{view.status}</dd></div>
    <div><dt>模型</dt><dd>{view.model}</dd></div>
    <div><dt>最新实例</dt><dd>{latest??'尚未记录到实例'}</dd></div>
    {earlier.length?<div><dt>更早实例</dt><dd>{earlier.join('、')}</dd></div>:null}
    <div><dt>最近记录</dt><dd>{humanTime(view.at)}{stale?`（${stale}）`:''}</dd></div>
    <div><dt>姿态依据</dt><dd>{view.lastActionPose?'最近一次观测到的动作':'尚未观测到工具动作'}</dd></div>
   </dl>
   <p className="actor-note">
    角色皮肤代表“{ACTOR_LABEL[view.actor]}”这一侧，不代表真实模型或真实作者；名字与模型都来自记录本身，缺失时写“未知”。
    {view.lastActionPose?'姿态取自最近一次观测到的动作；没有新记录时只标注“最近记录”，不代表仍在持续工作。':'还没有观测到工具动作，姿态保持待命。'}
   </p>
  </details>
  {mode==='replay'?<p className="actor-replay">回放视图：只呈现到当前时间点为止的记录。</p>:null}
 </section>;
}

export function DeskPanel({actors,assets,mode,now,stageOn,stageEvent,packet,onPacket}:{
 actors:ActorState;assets?:Record<string,string>;mode:Mode;now:number;stageOn:boolean;stageEvent:FMEvent|null;packet:FMEvent|null;onPacket:()=>void;
}){
 return <div className="desk">
  <ActorCard view={actors.codex} character="codex" label="Codex（白龙侧）" assets={assets} mode={mode} now={now}/>
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
  <ActorCard view={actors.deepseek} character="deepseek" label="DeepSeek（蓝鲸侧）" assets={assets} mode={mode} now={now}/>
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
