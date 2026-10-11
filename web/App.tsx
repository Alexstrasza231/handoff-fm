import {useCallback,useEffect,useMemo,useRef,useState,type KeyboardEvent as ReactKeyboardEvent} from 'react';
import type {FMEvent,ShareOptions} from '../src/types';
import {DEFAULT_SHARE} from '../src/types';
import {DeskPanel,Timeline,isUsageEvent} from './components';
import {DetailsDrawer,UsageSummaryRow,type DetailsFilter} from './UsageDetails';
import {ApiError,appendEvent,captureToken,createLiveApi,EventStream,initialLiveRun,rememberLiveRun,offlinePayload,runsFrom,type Connection,type LiveApi,type Loaded,type RunRow,type Source} from './data';
import {demoEvents} from './demo';
import {ACTOR_LABEL,clockTime,deriveActors,eventSummary,KIND_LABEL} from './helpers';
import {cleanTaskTitle,latestHandoffIndex,recentActivities,taskTitle} from './presentation';
import {findJump,isFailure,isHandoff,type Mode,useReplay} from './replay';
import {ShareModal} from './ShareModal';
import {ArtCredits} from './ArtCredits';

const SAMPLE='试玩示例';
const EXAMPLE='看个例子';
const DEMO_RUN='demo-run';
/** Offline export sets this before the bundle runs; it wins over every live path. */
const OFFLINE=typeof window!=='undefined'?offlinePayload():null;

export default function App(){
 const [source,setSource]=useState<Source>(OFFLINE?'offline':'live');
 const [loaded,setLoaded]=useState<Loaded|null>(OFFLINE);
 const [liveEvents,setLiveEvents]=useState<FMEvent[]>([]);
 const [runs,setRuns]=useState<RunRow[]>(OFFLINE?.runs??[]);
 const [runId,setRunId]=useState<string>(OFFLINE?.runs[0]?.id??'');
 const [connection,setConnection]=useState<Connection>('initial');
 const [auth,setAuth]=useState<'ok'|'missing'|'invalid'>('ok');
 const [notice,setNotice]=useState<string|null>(null);
 const [streamNotice,setStreamNotice]=useState<string|null>(null);
 const [mode,setMode]=useState<Mode>('live');
 const [stageOn,setStageOn]=useState(true);
 const [calm,setCalm]=useState(()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches);
 /** 详情面板里选中的记录；null 表示跟随现场（实时最新 / 回放播放头），绝不引用前缀之外的记录。 */
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [shareOpen,setShareOpen]=useState(false);
 const [moreOpen,setMoreOpen]=useState(false);
 const [detailsOpen,setDetailsOpen]=useState(false);
 const [detailsFilter,setDetailsFilter]=useState<DetailsFilter>('all');
 const [replayUi,setReplayUi]=useState(false);
 const [evidenceOpen,setEvidenceOpen]=useState(false);
 const [shareOptions,setShareOptions]=useState<ShareOptions>({...DEFAULT_SHARE});
 const [exporting,setExporting]=useState(false);
 const [exportError,setExportError]=useState<string|null>(null);
 const [now,setNow]=useState(()=>Date.now());
 /** Run id the global stream currently feeds; kept in sync inside loadRun. */
 const [streamRun,setStreamRun]=useState('');

 const apiRef=useRef<LiveApi|null>(null);
 const streamRef=useRef<EventStream|null>(null);
 const tokenRef=useRef('');
 const listRef=useRef<HTMLUListElement|null>(null);
 const evidenceRef=useRef<HTMLElement|null>(null);
 const detailsOpenerRef=useRef<HTMLButtonElement|null>(null);
 /** Guards late async results: only the newest load may touch events or the stream. */
 const generation=useRef(0);
 const loadedRun=useRef<string|null>(null);
 /** Run the global stream is currently feeding; read inside stable callbacks. */
 const streamRunRef=useRef('');
 streamRunRef.current=streamRun;
 /** Last real run, so 返回实时 from the sample restores the previous selection. */
 const liveRunRef=useRef('');

 const offline=source==='offline';
 const demo=source==='demo';
 const localMode=offline||demo;
 const events=useMemo(()=>{
  const all=localMode?loaded?.events??[]:liveEvents;
  return runId?all.filter(event=>event.runId===runId):all;
 },[localMode,loaded,liveEvents,runId]);
 const replay=useReplay(mode,events);
 const visible=mode==='replay'?replay.visible:events;
 const actors=useMemo(()=>deriveActors(visible),[visible]);
 const {jump}=replay;

 /** 舞台字幕、卡片与交接包只看已渲染前缀，并且跳过用量采样。 */
 const stageEvents=useMemo(()=>visible.filter(event=>!isUsageEvent(event)),[visible]);
 const stageEvent=useMemo(()=>{
  for(let index=stageEvents.length-1;index>=0;index--){if(stageEvents[index].kind!=='session.started')return stageEvents[index];}
  return stageEvents.at(-1)??null;
 },[stageEvents]);
 const latestCodex=useMemo(()=>latestActorEvent(stageEvents,'codex'),[stageEvents]);
 const latestDeepseek=useMemo(()=>latestActorEvent(stageEvents,'deepseek'),[stageEvents]);
 const packet=useMemo(()=>[...stageEvents].reverse().find(event=>event.kind==='delegate.started'||event.kind==='delegate.completed')??null,[stageEvents]);

 const displayIndex=events.length-1;
 const displayEvent=displayIndex>=0?events[displayIndex]:null;
 /** 详情面板里选中的记录：回放时同步到播放头，绝不引用未来的记录。 */
 const detailEvent=selectedId?events.find(event=>event.id===selectedId)??null:displayEvent;

 /* ------------------------------------------------------------------ clock */
 useEffect(()=>{
  const timer=window.setInterval(()=>setNow(Date.now()),15000);
  return ()=>window.clearInterval(timer);
 },[]);

 /* ------------------------------------------------------------------ stream */
 const openStream=useCallback((api:LiveApi,seed:FMEvent[])=>{
  streamRef.current?.stop();
  const stream=new EventStream(api.streamUrl,{
   event:event=>setLiveEvents(previous=>appendEvent(previous,event,streamRunRef.current)),
   status:state=>{setConnection(state);if(state==='connected')setStreamNotice(null);},
   error:message=>setStreamNotice(message)
  });
  streamRef.current=stream;
  stream.start(seed.reduce((max,event)=>Math.max(max,event.seq??0),0),seed);
 },[]);

 const reportError=useCallback((error:unknown)=>{
  setConnection('disconnected');
  if(error instanceof ApiError&&error.status===401){setAuth('invalid');setNotice(error.message);return;}
  setNotice(error instanceof Error?error.message:'读取失败，请稍后重试。');
 },[]);

 /** Loading a run clears the previous stream first so only newer records can win. */
 const loadRun=useCallback(async(api:LiveApi,run:string)=>{
  const ticket=++generation.current;
  streamRef.current?.stop();
  setStreamRun(run);
  streamRunRef.current=run;
  try{
   const seed=run?await api.events(run):[];
   if(ticket!==generation.current)return;
   setLiveEvents(seed);
   setSelectedId(null);
   if(run&&run!==DEMO_RUN)liveRunRef.current=run;
   openStream(api,seed);
  }catch(error){
   if(ticket!==generation.current)return;
   setLiveEvents([]);
   reportError(error);
  }
 },[openStream,reportError]);

 useEffect(()=>{
  if(OFFLINE)return;
  const token=captureToken();
  tokenRef.current=token;
  if(!token){
   setAuth('missing');setConnection('disconnected');
   setNotice('缺少访问令牌：请使用启动命令输出的带 #token=... 的地址打开本页面。');
   return;
  }
  const api=createLiveApi(token);
  apiRef.current=api;
  let cancelled=false;
  (async()=>{
   try{
    const rows=await api.runs();
    if(cancelled)return;
    setRuns(rows);
    const target=initialLiveRun(rows);
    setRunId(target);
    loadedRun.current=target;
    setAuth('ok');
    await loadRun(api,target);
   }catch(error){if(!cancelled)reportError(error);}
  })();
  return ()=>{cancelled=true;generation.current++;streamRef.current?.stop();};
 },[loadRun,reportError]);

 /* Refresh once when the user picks another run; the stream itself stays global. */
 useEffect(()=>{
  if(OFFLINE||localMode)return;
  const api=apiRef.current;
  if(!api||!runId||loadedRun.current===runId)return;
  if(!runs.some(row=>row.id===runId))return;
  loadedRun.current=runId;
  void loadRun(api,runId);
 },[runId,localMode,runs,loadRun]);

 /* Run list grows from incoming events while the current selection is preserved. */
 useEffect(()=>{
  if(localMode||!liveEvents.length)return;
  const rows=runsFrom(liveEvents);
  setRuns(previous=>{
   const merged=new Map(previous.map(row=>[row.id,row]));
   let changed=false;
   for(const row of rows){
    const known=merged.get(row.id);
    if(known&&known.count===row.count&&known.title===row.title)continue;
    merged.set(row.id,row);changed=true;
   }
   return changed?[...merged.values()]:previous;
  });
 },[liveEvents,localMode]);

 /* --------------------------------------------------------------- selection */
 const replayIndex=replay.index;
 const replayEvent=replayIndex>=0?visible[replayIndex]??null:null;
 /**
  * 只有真实的已渲染记录才能成为选区：用户点过的记录优先，否则实时跟随最新记录、
  * 回放跟随播放头。回放刚开始、还没有记录时不会预选未来。
  */
 const pickedValid=selectedId!==null&&visible.some(event=>event.id===selectedId);
 const effectiveSelectedId=pickedValid?selectedId:mode==='replay'?replayEvent?.id??null:displayEvent?.id??null;
 const selectedIndex=effectiveSelectedId?events.findIndex(event=>event.id===effectiveSelectedId):-1;

 /**
  * 选中一条记录。回放时若点到播放头之后的记录，先把播放头推进到该记录：
  * 详情证据永远不会引用“未来”，选区也不会落在已渲染前缀之外。
  */
 const chooseEvent=useCallback((index:number)=>{
  const event=events[index];
  if(!event)return;
  setEvidenceOpen(true);
  setDetailsOpen(true);
  if(mode==='replay')jump(index);
  setSelectedId(event.id);
 },[events,jump,mode,replayIndex]);

 const moveSelection=useCallback((step:number)=>{
  if(!events.length)return;
  const base=selectedIndex>=0?selectedIndex:events.length-1;
  chooseEvent(Math.max(0,Math.min(events.length-1,base+step)));
 },[events.length,selectedIndex,chooseEvent]);

 const jumpTo=useCallback((predicate:(event:FMEvent)=>boolean)=>{
  const target=findJump(events,Math.max(0,selectedIndex),1,predicate);
  if(target==null)return;
  setMode('replay');setReplayUi(true);jump(target);
 },[events,selectedIndex,jump]);

 /** 详情抽屉：打开时按需带上角色筛选，关闭时焦点交还给“查看详情”。 */
 const openDetails=useCallback((filter:DetailsFilter='all')=>{
  setDetailsFilter(filter);
  setDetailsOpen(true);
 },[]);
 const closeDetails=useCallback(()=>{
  setDetailsOpen(false);
  detailsOpenerRef.current?.focus();
 },[]);
 const openPerson=(character:'codex'|'deepseek')=>{
  setDetailsFilter(character);
   const newest=[...stageEvents].reverse().find(event=>event.actor===character);
  if(newest)setSelectedId(newest.id);
  setDetailsOpen(true);
 };

 const enterDemo=()=>{
  if(runId&&runId!==DEMO_RUN)liveRunRef.current=runId;
  const demoData=demoEvents();
  setSource('demo');
  setLoaded({source:'demo',events:demoData,runs:runsFrom(demoData)});
  setRunId(DEMO_RUN);
  setMode('live');setReplayUi(false);setSelectedId(null);setConnection('initial');setNotice(null);
 };
 const backToLive=()=>{
  const api=apiRef.current;
  const target=api?(liveRunRef.current||runs.find(row=>row.id!==DEMO_RUN)?.id||''):'';
  setSource('live');setLoaded(null);setConnection('initial');setNotice(null);setStreamNotice(null);
  setMode('live');setReplayUi(false);setSelectedId(null);
  setRunId(target);
  loadedRun.current=null;
  if(api&&target)void loadRun(api,target);
 };

 const openReplayAll=()=>{
  setMode('replay');setReplayUi(true);
  replay.jump(0);replay.setPlaying(events.length>1);setMoreOpen(false);
 };
 const startReplay=()=>{
  setMode('replay');setReplayUi(true);
  replay.jump(Math.max(0,events.length-1));
 };

 /* ----------------------------------------------------------------- sharing */
 const exportDisabled=localMode;
 const exportDisabledReason=demo?'示例回放不能导出：示例数据只用于界面试玩。':offline?'离线回放不能导出：此页面没有可用的本地服务。':'';
 const download=async()=>{
  const api=apiRef.current;
  if(!api||!runId){setExportError('没有可导出的运行记录。');return;}
  setExporting(true);setExportError(null);
  try{
   const blob=await api.download(api.exportUrl(runId,{prompts:shareOptions.prompts,paths:shareOptions.paths,diffs:shareOptions.diffs,outputs:shareOptions.outputs,usage:!!shareOptions.usage}));
   const url=URL.createObjectURL(blob);
   const anchor=document.createElement('a');
   anchor.href=url;anchor.download='handoff-fm.html';anchor.rel='noopener';
   document.body.appendChild(anchor);anchor.click();anchor.remove();
   window.setTimeout(()=>URL.revokeObjectURL(url),4000);
   setShareOpen(false);
  }catch(error){
   setExportError(error instanceof Error?error.message:'导出失败。');
  }finally{setExporting(false);}
 };

 /* ---------------------------------------------------------------- keyboard */
 const onKeyDown=(event:ReactKeyboardEvent<HTMLDivElement>)=>{
  if(shareOpen)return;
  if(event.key==='Escape'){closeDetails();return;}
  const target=event.target as HTMLElement;
  if(target instanceof HTMLInputElement||target instanceof HTMLSelectElement||target instanceof HTMLTextAreaElement)return;
  if(target.closest('[role="tablist"]'))return;
  if(event.key==='ArrowDown'||event.key==='ArrowRight'){event.preventDefault();moveSelection(1);}
  else if(event.key==='ArrowUp'||event.key==='ArrowLeft'){event.preventDefault();moveSelection(-1);}
  else if(event.key===','){setMode('replay');setReplayUi(true);replay.step(-1);}
  else if(event.key==='.'){setMode('replay');setReplayUi(true);replay.step(1);}
 };

 /* -------------------------------------------------------------------- view */
 const statusText=offline?'离线回放':demo?'示例回放':connection==='connected'?'已连接':connection==='initial'?'正在连接':'连接已断开';
 const authBad=auth==='invalid'||auth==='missing';
 const showWaiting=!events.length&&!authBad;
 const controlsDisabled=!events.length;
 const taskLine=taskTitle(visible,mode==='replay'?'等待任务记录':runs.find(row=>row.id===runId)?.title);
 const recent=recentActivities(stageEvents);
 const shownRuns=localMode?loaded?.runs??[]:runs;
 const stageNow=mode==='replay'||localMode?Date.parse(visible.at(-1)?.at??new Date(now).toISOString()):now;
 const startMs=events.length?Date.parse(events[0].at):0;
 const finiteStart=Number.isFinite(startMs)?startMs:0;
 const endLabel=clockTime(new Date(finiteStart+replay.duration).toISOString(),finiteStart);
 const currentLabel=clockTime(mode==='replay'?replayEvent?.at??events[0]?.at??new Date(finiteStart).toISOString():displayEvent?.at??events[0]?.at??new Date(finiteStart).toISOString(),finiteStart);
 const handoffIndex=latestHandoffIndex(events);
 const barVisible=mode==='replay'&&replayUi;
 const usageScope:'task'|'session'='task';
 const usageNow=mode==='replay'||localMode?stageNow:now;

 return <div className={`app${calm?' calm':''}`} onKeyDown={onKeyDown}>
  <header className="topbar">
   <div className="brand">
    <span className="brand-mark" aria-hidden="true">FM</span>
    <div>
     <h1>HandoffFM</h1>
     <p className="brand-sub">白龙派活，蓝鲸交稿。</p>
    </div>
   </div>
   <div className="topbar-mid">
    <p className="conn-line">
     <span className={`dot conn-${offline?'offline':connection}`} aria-hidden="true"></span>
     <span className="status" role="status" aria-live="polite">{statusText}</span>
     {!localMode?<span className="muted">{mode==='live'?'实时记录':'过程回放'}</span>:null}
    </p>
   </div>
   <div className="topbar-actions">
    <button type="button" className="ghost" aria-expanded={moreOpen} aria-controls="more-panel" onClick={()=>setMoreOpen(value=>!value)}>更多</button>
   </div>
  </header>
  <p className="task-line" title={taskLine}><span className="tag">本集任务</span><span className="task-title">{taskLine}</span></p>

  <div id="more-panel" className="more-panel" hidden={!moreOpen}>
   {!localMode?<button type="button" className="ghost" onClick={enterDemo}>{SAMPLE}</button>:null}
   <label className="run-picker">
    <span>运行</span>
    <select value={runId} onChange={event=>{if(!localMode)rememberLiveRun(event.target.value);setMode('live');setReplayUi(false);setRunId(event.target.value);}} aria-label="选择运行记录">
     {shownRuns.length===0?<option value="">等待记录</option>:null}
     {shownRuns.map(row=><option key={row.id} value={row.id}>{cleanTaskTitle(row.title)||'记录中的协作'}（{row.count}）</option>)}
    </select>
   </label>
   <button type="button" className="ghost" onClick={()=>{setShareOpen(true);setMoreOpen(false);}}>分享预览</button>
   <button type="button" className="ghost" disabled={controlsDisabled} onClick={openReplayAll}>回放全部记录</button>
   <button type="button" className="ghost" disabled={controlsDisabled} onClick={()=>{setDetailsOpen(true);setDetailsFilter('all');setMoreOpen(false);}}>查看最近修改</button>
   {localMode&&tokenRef.current?<button type="button" onClick={backToLive}>返回实时</button>:null}
   <label className="check"><input type="checkbox" checked={stageOn} onChange={event=>setStageOn(event.target.checked)}/><span>舞台字幕</span></label>
   <label className="check"><input type="checkbox" checked={calm} onChange={event=>setCalm(event.target.checked)}/><span>减少动效</span></label>
   <p className="explainer">白龙 = Codex，蓝鲸 = DeepSeek。角色皮肤与舞台字幕是演出；实际操作以记录为准。</p>
  </div>
  {offline?<p className="banner warn-banner" role="note">离线回放：此页面不联网、不请求接口，内容为导出时的静态快照。分享导出前请人工检查敏感信息。</p>:null}
  {demo?<p className="banner" role="note">示例回放：静态示例数据，不会请求网络，也不会调用任何模型。点击“返回实时”可回到实时记录。</p>:null}
  {streamNotice&&!localMode?<p className="banner" role="alert">{streamNotice} <button type="button" className="ghost" onClick={()=>{const api=apiRef.current;if(api)void loadRun(api,runId);}}>手动重连</button></p>:null}
  {notice?<p className="banner error" role="alert">{notice}{authBad?<span className="muted">（界面不会显示或导出令牌。）</span>:null}</p>:null}

  <main className="layout">
   <section className="desk-wrap" aria-label="直播台">
    {showWaiting?<div className="empty">
     <h2>{authBad?'无法读取记录':connection==='disconnected'?'信号呢？':'等待记录'}</h2>
     <p>{authBad?'请从启动命令输出的地址重新打开界面，令牌只保存在本次会话中。':connection==='disconnected'?'这表示与本地服务的连接中断，并不代表代理失败；记录本身可能仍然完整。':'还没有任何实时记录。可以先看示例回放，界面完全离线，不会调用模型。'}</p>
     <button type="button" onClick={enterDemo}>{EXAMPLE}</button>
    </div>:null}
    <DeskPanel actors={actors} assets={loaded?.assets} stageOn={stageOn} stageEvent={stageEvent} packet={packet} onPacket={()=>{if(packet)chooseEvent(events.findIndex(event=>event.id===packet.id));}} onActor={openPerson} latestCodex={latestCodex} latestDeepseek={latestDeepseek}/>
   </section>

   <div className="home-usage">
    <UsageSummaryRow events={visible} scope={usageScope} now={usageNow}/>
   </div>

   <div className="home-actions">
    <button type="button" ref={detailsOpenerRef} onClick={()=>openDetails('all')}>查看详情</button>
    <button type="button" className="ghost" onClick={startReplay} disabled={controlsDisabled}>回放过程</button>
   </div>

   <div className="replay-bar" hidden={!barVisible}>
    {handoffIndex===events.length-1&&handoffIndex>=0?<p className="replay-note" role="status">这次派活后暂无后续记录，已定位到派活。</p>:null}
    <details className="replay-advanced"><summary>回放控制</summary><div className="advanced-body">
    <div className="mode-switch" role="group" aria-label="实时或回放">
     <button type="button" className={mode==='live'?'active':''} aria-pressed={mode==='live'} onClick={()=>{setMode('live');setReplayUi(false);}}>实时</button>
     <button type="button" className={mode==='replay'?'active':''} aria-pressed={mode==='replay'} onClick={()=>{setMode('replay');setReplayUi(true);}} disabled={controlsDisabled}>回放</button>
    </div>
    <button type="button" className="ghost" onClick={()=>{setMode('replay');setReplayUi(true);replay.step(-1);}} disabled={controlsDisabled}>上一条</button>
    <button type="button" className="ghost" onClick={()=>{setMode('replay');setReplayUi(true);replay.step(1);}} disabled={controlsDisabled}>下一条</button>
    <label className="speed">速度
     <select value={replay.speed} onChange={event=>replay.setSpeed(Number(event.target.value))} aria-label="回放速度">
      {[1,2,4].map(value=><option key={value} value={value}>{value}x</option>)}
     </select>
    </label>
    <button type="button" className="ghost" onClick={()=>jumpTo(isHandoff)} disabled={controlsDisabled}>下一处交接</button>
    <button type="button" className="ghost" onClick={()=>jumpTo(event=>isFailure(event)||isHandoff(event))} disabled={controlsDisabled}>下一处失败或交接</button>
    </div></details>
    <button type="button" onClick={()=>{setMode('replay');setReplayUi(true);if(replay.playing)replay.setPlaying(false);else replay.play();}} disabled={controlsDisabled}>
     {replay.playing?'暂停':'播放'}
    </button>
    <label className="scrub">
     <span className="muted">记录时间 {currentLabel} / {endLabel}</span>
     <input type="range" min={0} max={Math.max(1,replay.duration)} step={100}
      value={mode==='replay'?Math.round(replay.playhead):Math.round(replay.duration)}
      disabled={controlsDisabled} aria-label="回放时间位置"
      onChange={event=>{setMode('replay');setReplayUi(true);replay.scrub(Number(event.target.value));}}/>
    </label>
   </div>

  </main>

  <footer className="foot">
   <p>交稿不是验收。字幕是演出，记录是证据。</p>
   <ArtCredits/>
  </footer>

  <DetailsDrawer
   open={detailsOpen}
   events={visible}
   actors={actors}
   selectedId={effectiveSelectedId}
   filter={detailsFilter}
   onFilter={setDetailsFilter}
   onSelect={chooseEvent}
   onClose={closeDetails}
   startMs={finiteStart}
   now={usageNow}
   mode={mode}
   evidenceOpen={evidenceOpen}
   onEvidenceToggle={setEvidenceOpen}
   evidenceRef={evidenceRef}
   listRef={listRef}
  />

  {shareOpen?<ShareModal
   events={events}
   options={shareOptions}
   onToggle={key=>setShareOptions(previous=>({...previous,[key]:!previous[key]}))}
   onClose={()=>setShareOpen(false)}
   onConfirm={download}
   disabled={exportDisabled}
   disabledReason={exportDisabledReason}
   busy={exporting}
   error={exportError}
  />:null}
 </div>;
}

function latestActorEvent(events:FMEvent[],actor:'codex'|'deepseek'):FMEvent|null{
 for(let index=events.length-1;index>=0;index--)if(events[index].actor===actor)return events[index];
 return null;
}
