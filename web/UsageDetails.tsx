import {useEffect,useRef,useState,type KeyboardEvent as ReactKeyboardEvent,type MouseEvent as ReactMouseEvent,type RefObject} from 'react';
import type {FMEvent} from '../src/types';
import {summarizeUsage,unassociatedUsage,type UsageSummary} from '../src/usage';
import {ACTOR_LABEL,clockTime,eventSummary,type ActorState} from './helpers';
import {sideText} from './data';
import {EvidencePanel,Timeline} from './components';

/**
 * 用量与详情面板。
 *
 * 这里只做展示：所有数字都来自 `src/usage.ts` 的 `summarizeUsage`，输入是“已经渲染出来的
 * 记录前缀”，因此回放到某一刻时绝不会出现未来的采样。缺失的数字一律写“尚未采集 / 未提供”，
 * 绝不用 0 冒充。
 */

export type UsageScope='task'|'session';
export type DetailsFilter='all'|'codex'|'deepseek';

const NOT_COLLECTED='尚未采集';
const NOT_PROVIDED='未提供';

const SOURCE_LABEL:Record<string,string>={codex:'Codex 会话用量',deepseek:'DeepSeek 步骤用量','codex-transcript':'Codex 会话用量','deepseek-step':'DeepSeek 步骤用量'};

/** 覆盖度只说人话，不暗示已经验收。 */
export function usageCoverageLabel(coverage:UsageSummary['coverage']):string{
 return coverage==='complete'?'数据完整':coverage==='partial'?'部分数据':'尚未采集';
}
export function numberText(value:number|undefined):string{
 return typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('zh-CN'):NOT_COLLECTED;
}
export function optionalText(value:number|undefined):string{
 return typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('zh-CN'):NOT_PROVIDED;
}
export function durationText(ms:number|undefined):string{
 if(typeof ms!=='number'||!Number.isFinite(ms)||ms<0)return NOT_COLLECTED;
 const seconds=Math.floor(ms/1000);
 if(seconds<60)return `${seconds} 秒`;
 const minutes=Math.floor(seconds/60),rest=seconds%60;
 if(minutes<60)return rest?`${minutes} 分 ${rest} 秒`:`${minutes} 分`;
 const hours=Math.floor(minutes/60),mins=minutes%60;
 return mins?`${hours} 小时 ${mins} 分`:`${hours} 小时`;
}
function parseMs(at:string|undefined):number{
 if(!at)return NaN;
 const ms=Date.parse(at);
 return Number.isFinite(ms)?ms:NaN;
}
export function describeUpdate(at:string|undefined,now:number):string{
 const ms=parseMs(at);
 if(!Number.isFinite(ms))return '尚未记录更新时间';
 const delta=Math.max(0,now-ms);
 if(delta<60000)return '刚刚更新';
 const minutes=Math.floor(delta/60000);
 if(minutes<60)return `${minutes} 分钟前更新`;
 const hours=Math.floor(minutes/60);
 if(hours<24)return `${hours} 小时前更新`;
 return `${Math.floor(hours/24)} 天前更新`;
}
export function sourceText(source:string):string{
 return SOURCE_LABEL[source]||source;
}

/** 首页可见的用量摘要行；类名 `.usage-summary` 供外层样式与测试定位。 */
export function UsageSummaryRow({events,scope,now}:{events:FMEvent[];scope:UsageScope;now:number}){
 const summary=summarizeUsage(events,{scope,now});
 const updated=summary.actors.deepseek.updatedAt??summary.actors.codex.updatedAt;
 const sources:string[]=[];
 for(const actor of ['codex','deepseek'] as const)for(const source of summary.actors[actor].sources)if(!sources.includes(source))sources.push(source);
 return <div className={`usage-summary${summary.coverage==='partial'?' is-partial':''}`} role="group" aria-label="用量摘要">
  <span className="u-label">已记录 Tokens</span>
  <b className="u-total">{numberText(summary.total)}</b>
  <span className={`u-coverage ${summary.coverage}`}>{usageCoverageLabel(summary.coverage)}</span>
  <span className="u-muted">工具调用 {summary.taskId?`${summary.tools} 次`:'尚未采集'}</span>
  <span className="u-muted">经过 {durationText(summary.elapsedMs)}</span>
 </div>;
}

function UsagePair({label,value,hint}:{label:string;value:number|undefined;hint?:string}){
 return <div className="usage-pair"><dt>{label}</dt><dd><b>{optionalText(value)}</b>{hint?<small>{hint}</small>:null}</dd></div>;
}

/** 详细的用量面板：切换当前任务 / 会话累计，并解释每个口径。 */
export function UsagePanel({events,now}:{events:FMEvent[];now:number}){
 const [scope,setScope]=useState<UsageScope>('task');
 const summary=summarizeUsage(events,{scope,now});
 const unassociated=unassociatedUsage(events);
 return <div className="usage-panel">
  <div className="usage-switch" role="group" aria-label="统计范围">
   <button type="button" className={scope==='task'?'active':''} aria-pressed={scope==='task'} onClick={()=>setScope('task')}>当前任务</button>
   <button type="button" className={scope==='session'?'active':''} aria-pressed={scope==='session'} onClick={()=>setScope('session')}>会话累计</button>
  </div>
  <p className="usage-line"><span>已记录 Tokens</span><b>{numberText(summary.total)}</b><span className={`u-coverage ${summary.coverage}`}>{usageCoverageLabel(summary.coverage)}</span></p>
  <p className="muted">输入 {numberText(summary.input)} · 输出 {numberText(summary.output)} · 工具调用 {summary.tools} 次 · 用时 {durationText(summary.elapsedMs)}</p>
  <div className="usage-actors">
   {(['codex','deepseek'] as const).map(actor=>{
    const view=summary.actors[actor];
    return <section key={actor} className={`usage-actor actor-${actor}`} aria-label={`${ACTOR_LABEL[actor]} 用量`}>
     <h4>{ACTOR_LABEL[actor]}</h4>
     <dl className="usage-mini">
      <UsagePair label="总量" value={view.total}/>
      <UsagePair label="输入" value={view.input}/>
      <UsagePair label="输出" value={view.output}/>
      <UsagePair label="缓存读取" value={view.cacheRead}/>
      <UsagePair label="缓存写入" value={view.cacheWrite}/>
      <UsagePair label="推理输出" value={view.reasoning}/>
     </dl>
     <p className="muted">
      {view.sources.length?view.sources.map(sourceText).join('、'):'暂无来源'} · {view.samples} 次采样 · 工具 {view.tools} 次 · {describeUpdate(view.updatedAt,now)} · {usageCoverageLabel(view.coverage)}
     </p>
    </section>;
   })}
  </div>
  <div className="usage-sub">
   <h4>细项（均为子集，不重复计入总量）</h4>
   <dl className="usage-pairs">
    <UsagePair label="输入总量" value={summary.input} hint="含缓存读取与缓存写入"/>
    <UsagePair label="输出总量" value={summary.output} hint="含推理输出"/>
    <UsagePair label="缓存读取" value={summary.cacheRead} hint="输入的子集"/>
    <UsagePair label="缓存写入" value={summary.cacheWrite} hint="输入的子集"/>
    <UsagePair label="推理输出" value={summary.reasoning} hint="输出的子集"/>
    <UsagePair label="工具调用" value={summary.tools} hint="按 callId 去重"/>
   </dl>
  </div>
  <p className="usage-note">缓存是输入的子集，推理输出是输出的子集，均不额外加入总量。经过时间包含等待与工具执行，不能解释为模型思考时间；Tokens 不是费用或账户余额。</p>
  {unassociated.length?<section aria-label="未关联用量"><h4>未关联 · {unassociated.length} 个任务</h4><p className="usage-note">没有明确父任务的调用仅计入会话累计，不计入当前任务。</p>
   <ul>{unassociated.map(job=><li key={`${job.sessionId}:${job.taskId}`}><code>{job.taskId}</code> · 输入 {optionalText(job.usage.input)} · 输出 {optionalText(job.usage.output)} · 已记录 Tokens {numberText(job.usage.total)} · {usageCoverageLabel(job.usage.coverage)}</li>)}</ul>
  </section>:null}
 </div>;
}

/* ------------------------------------------------------------------ details */

export interface DetailsDrawerProps{
 open:boolean;
 events:FMEvent[];
 actors:ActorState;
 selectedId:string|null;
 filter:DetailsFilter;
 onFilter:(filter:DetailsFilter)=>void;
 onSelect:(index:number)=>void;
 onClose:()=>void;
 startMs:number;
 now:number;
 mode:'live'|'replay';
 evidenceOpen:boolean;
 onEvidenceToggle:(open:boolean)=>void;
 evidenceRef:RefObject<HTMLElement|null>;
 listRef:RefObject<HTMLUListElement|null>;
}

type TabKey='process'|'usage';
const TABS:{key:TabKey;label:string}[]=[
 {key:'process',label:'过程记录'},
 {key:'usage',label:'用量明细'}
];
const FILTERS:{key:DetailsFilter;label:string}[]=[
 {key:'all',label:'全部'},
 {key:'codex',label:'Codex'},
 {key:'deepseek',label:'DeepSeek'}
];

/** 过程记录 / 用量明细。标签用标准 tablist 模式：方向键切换并聚焦，Escape 由 App 关闭面板。 */
export function DetailsDrawer({
 open,events,actors,selectedId,filter,onFilter,onSelect,onClose,startMs,now,mode,evidenceOpen,onEvidenceToggle,evidenceRef,listRef
}:DetailsDrawerProps){
 const [tab,setTab]=useState<TabKey>('process');
 const panel=useRef<HTMLDivElement|null>(null);
 const tabRefs=useRef<Record<TabKey,HTMLButtonElement|null>>({process:null,usage:null});
 const wasOpen=useRef(false);

 useEffect(()=>{
  if(open&&!wasOpen.current){setTab('process');}
  wasOpen.current=open;
 },[open]);

 /* 打开后把焦点收进面板，关闭后交还调用者（App 负责回到“查看详情”按钮）。 */
 useEffect(()=>{
  if(!open)return;
  const first=tabRefs.current.process;
  (first??panel.current)?.focus();
 },[open]);

 if(!open)return null;

 const shown=filter==='all'?events:events.filter(event=>event.actor===filter);
 const selectedIndex=selectedId?shown.findIndex(event=>event.id===selectedId):-1;
 const selectedEvent=selectedId?events.find(event=>event.id===selectedId)??null:null;
 const latest=shown.at(-1)??null;

 const onTabKey=(event:ReactKeyboardEvent<HTMLDivElement>)=>{
  if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
  event.preventDefault();
  const index=TABS.findIndex(item=>item.key===tab);
  const next=TABS[(index+(event.key==='ArrowRight'?1:-1)+TABS.length)%TABS.length];
  setTab(next.key);
  tabRefs.current[next.key]?.focus();
 };
 const activate=(key:TabKey)=>{
  setTab(key);
  tabRefs.current[key]?.focus();
 };
 const close=(event:ReactMouseEvent<HTMLDivElement>)=>{if(event.target===event.currentTarget)onClose();};

 return <div className="details-backdrop">
  <div className="details-panel" role="region" aria-label="详情面板" ref={panel} tabIndex={-1}>
   <header className="details-head">
    <div>
     <h2>详情</h2>
     <p className="muted">真实记录与用量口径都在这里；首页只保留一句话。</p>
    </div>
    <button type="button" className="ghost" onClick={onClose}>关闭</button>
   </header>
   <div className="details-tabs" role="tablist" aria-label="详情分类" onKeyDown={onTabKey}>
    {TABS.map(item=><button key={item.key} type="button" role="tab" id={`details-tab-${item.key}`}
     ref={node=>{tabRefs.current[item.key]=node;}}
     aria-selected={tab===item.key} aria-controls={`details-panel-${item.key}`}
     tabIndex={tab===item.key?0:-1}
     onClick={()=>activate(item.key)}>{item.label}</button>)}
   </div>

   <section className="details-body" role="tabpanel" id="details-panel-process" aria-labelledby="details-tab-process" hidden={tab!=='process'} tabIndex={-1}>
    {tab==='process'?<>
     <div className="detail-filters" role="group" aria-label="按角色筛选">
      <span className="muted">筛选</span>
      {FILTERS.map(item=><button key={item.key} type="button" className={filter===item.key?'active':''} aria-pressed={filter===item.key} onClick={()=>onFilter(item.key)}>{item.label}</button>)}
      <span className="muted">共 {shown.length} 条记录</span>
     </div>
     <div className="timeline-wrap" aria-label="活动时间线区域">
      <div className="pane-head">
       <h2>过程记录</h2>
       <p className="muted">点击任意记录查看证据；回放时只呈现到当前时间点为止的记录。</p>
      </div>
      <div className="timeline-scroll"><Timeline events={shown} index={selectedIndex} mode={mode} onSelect={index=>{const event=shown[index];if(event)onSelect(events.findIndex(item=>item.id===event.id));}} listRef={listRef}/></div>
     </div>
     <div className="evidence-details">
      <EvidencePanel event={selectedEvent} startMs={startMs} panelRef={evidenceRef}/>
     </div>
     <details className="desk-extra"><summary>记录与身份说明</summary>
      <span>白龙侧实例：{actors.codex.sessionLabel}</span>
      <span>蓝鲸侧实例：{actors.deepseek.sessionLabel}</span>
      <span>最新实例：{actors.codex.sessions.at(-1)??'尚未记录到实例'} / {actors.deepseek.sessions.at(-1)??'尚未记录到实例'}</span>
      <span>模型：{actors.codex.model} / {actors.deepseek.model}</span>
      <span>当前姿态：{actors.codex.status} / {actors.deepseek.status}</span>
      <span>{sideText('system')}事件不参与姿态变化</span>
      <span>角色皮肤只代表交接的两侧，不代表真实模型或真实作者。</span>
     </details>
    </>:null}
   </section>

   <section className="details-body" role="tabpanel" id="details-panel-usage" aria-labelledby="details-tab-usage" hidden={tab!=='usage'} tabIndex={-1}>
    {tab==='usage'?<UsagePanel events={events} now={now}/>:null}
   </section>
   {latest&&mode==='live'?<p className="muted detail-foot">最新一条记录 {clockTime(latest.at,startMs)} · {eventSummary(latest)}</p>:null}
   {mode==='replay'?<p className="muted detail-foot">回放视图：只呈现到当前时间点为止的记录，后续记录不会提前出现。</p>:null}
  </div>
 </div>;
}
