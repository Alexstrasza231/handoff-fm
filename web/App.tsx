import {useCallback,useEffect,useMemo,useRef,useState,type KeyboardEvent as ReactKeyboardEvent} from 'react';
import type {FMEvent,ShareOptions} from '../src/types';
import {DEFAULT_SHARE} from '../src/types';
import {DeskPanel,EvidencePanel,Timeline} from './components';
import {ApiError,appendEvent,captureToken,createLiveApi,EventStream,initialLiveRun,rememberLiveRun,offlinePayload,runsFrom,sideText,type Connection,type LiveApi,type Loaded,type RunRow,type Source} from './data';
import {demoEvents} from './demo';
import {ACTOR_LABEL,clockTime,deriveActors,eventSummary,KIND_LABEL} from './helpers';
import {cleanTaskTitle,latestHandoffIndex,recentActivities,taskTitle} from './presentation';
import {findJump,isFailure,isHandoff,type Mode,useReplay} from './replay';
import {ShareModal} from './ShareModal';
import {ArtCredits} from './ArtCredits';

const SAMPLE='试玩示例';
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
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [replayPick,setReplayPick]=useState<string|null>(null);
 const [shareOpen,setShareOpen]=useState(false);
 const [moreOpen,setMoreOpen]=useState(false);
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
   setSelectedId(seed.at(-1)?.id??null);
   setReplayPick(null);
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
 const displayIndex=useMemo(()=>{
  if(!events.length)return -1;
  if(mode==='replay'){
   const pick=replayPick?events.findIndex(event=>event.id===replayPick):-1;
   return pick>=0?Math.min(pick,replay.index):replay.index;
  }
  const pick=selectedId?events.findIndex(event=>event.id===selectedId):-1;
  return pick>=0?pick:events.length-1;
 },[events,mode,replayPick,replay.index,selectedId]);
 const displayEvent=displayIndex>=0?events[displayIndex]:null;
 const stageEvent=useMemo(()=>{
  for(let index=visible.length-1;index>=0;index--){if(visible[index].kind!=='session.started')return visible[index];}
  return visible.at(-1)??null;
 },[visible]);
 const packet=useMemo(()=>[...visible].reverse().find(event=>event.kind==='delegate.started'||event.kind==='delegate.completed')??null,[visible]);
 const startMs=events.length?Date.parse(events[0].at):0;
 const finiteStart=Number.isFinite(startMs)?startMs:0;
 const endLabel=clockTime(new Date(finiteStart+replay.duration).toISOString(),finiteStart);
 const currentLabel=clockTime(displayEvent?.at??events[0]?.at??new Date(finiteStart).toISOString(),finiteStart);

 const chooseEvent=useCallback((index:number)=>{
  const event=events[index];
  if(!event)return;
  setSelectedId(event.id);
  setEvidenceOpen(true);
  if(mode==='replay'){setReplayPick(event.id);jump(index);}
 },[events,mode,jump]);
 const moveSelection=useCallback((step:number)=>{
  if(!events.length)return;
  chooseEvent(Math.max(0,Math.min(events.length-1,displayIndex+step)));
 },[events.length,displayIndex,chooseEvent]);
 const jumpTo=useCallback((predicate:(event:FMEvent)=>boolean)=>{
  const target=findJump(events,Math.max(0,displayIndex),1,predicate);
  if(target==null)return;
  setMode('replay');setReplayPick(events[target].id);jump(target);
 },[events,displayIndex,jump]);

 const enterDemo=()=>{
  if(runId&&runId!==DEMO_RUN)liveRunRef.current=runId;
  const demoData=demoEvents();
  setSource('demo');
  setLoaded({source:'demo',events:demoData,runs:runsFrom(demoData)});
  setRunId(DEMO_RUN);
  setMode('live');setSelectedId(null);setReplayPick(null);setConnection('initial');setNotice(null);
 };
 const backToLive=()=>{
  const api=apiRef.current;
  const target=api?(liveRunRef.current||runs.find(row=>row.id!==DEMO_RUN)?.id||''):'';
  setSource('live');setLoaded(null);setConnection('initial');setNotice(null);setStreamNotice(null);
  setMode('live');setSelectedId(null);setReplayPick(null);
  setRunId(target);
  loadedRun.current=null;
  if(api&&target)void loadRun(api,target);
 };

 /* ----------------------------------------------------------------- sharing */
 const exportDisabled=localMode;
 const exportDisabledReason=demo?'示例回放不能导出：示例数据只用于界面试玩。':offline?'离线回放不能导出：此页面没有可用的本地服务。':'';
 const download=async()=>{
  const api=apiRef.current;
  if(!api||!runId){setExportError('没有可导出的运行记录。');return;}
  setExporting(true);setExportError(null);
  try{
   const blob=await api.download(api.exportUrl(runId,{prompts:shareOptions.prompts,paths:shareOptions.paths,diffs:shareOptions.diffs,outputs:shareOptions.outputs}));
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
  const target=event.target as HTMLElement;
  if(target instanceof HTMLInputElement||target instanceof HTMLSelectElement||target instanceof HTMLTextAreaElement)return;
  if(event.key==='ArrowDown'||event.key==='ArrowRight'){event.preventDefault();moveSelection(1);}
  else if(event.key==='ArrowUp'||event.key==='ArrowLeft'){event.preventDefault();moveSelection(-1);}
  else if(event.key===','){setMode('replay');replay.step(-1);}
  else if(event.key==='.'){setMode('replay');replay.step(1);}
 };

 /* -------------------------------------------------------------------- view */
 const statusText=offline?'离线回放':demo?'示例回放':connection==='connected'?'已连接':connection==='initial'?'正在连接':'连接已断开';
 const authBad=auth==='invalid'||auth==='missing';
 const showWaiting=!events.length&&!authBad;
 const controlsDisabled=!events.length;
 const taskLine=taskTitle(visible,runs.find(row=>row.id===runId)?.title);
 const recent=recentActivities(visible);
 const latestChange=[...visible].reverse().find(event=>event.kind==='file.changed');
 const handoffIndex=latestHandoffIndex(events);
 const shownRuns=localMode?loaded?.runs??[]:runs;
 const stageNow=mode==='replay'||localMode?Date.parse(visible.at(-1)?.at??new Date(now).toISOString()):now;

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
     <span className="muted">{mode==='live'?'实时':'回放'}</span>
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
     <select value={runId} onChange={event=>{if(!localMode)rememberLiveRun(event.target.value);setMode('live');setReplayPick(null);setRunId(event.target.value);}} aria-label="选择运行记录">
      {shownRuns.length===0?<option value="">等待记录</option>:null}
      {shownRuns.map(row=><option key={row.id} value={row.id}>{cleanTaskTitle(row.title)||'记录中的协作'}（{row.count}）</option>)}
     </select>
    </label>
    <button type="button" className="ghost" onClick={()=>{setShareOpen(true);setMoreOpen(false);}}>分享预览</button>
    <button type="button" className="ghost" disabled={controlsDisabled} onClick={()=>{setMode('replay');setReplayPick(null);replay.jump(0);replay.setPlaying(events.length>1);setMoreOpen(false);}}>回放全部记录</button>
    {localMode&&tokenRef.current?<button type="button" onClick={backToLive}>返回实时</button>:null}
    <label className="check"><input type="checkbox" checked={stageOn} onChange={event=>setStageOn(event.target.checked)}/><span>舞台字幕</span></label>
    <label className="check"><input type="checkbox" checked={calm} onChange={event=>setCalm(event.target.checked)}/><span>减少动效</span></label>
    <p className="explainer">白龙 = Codex，蓝鲸 = DeepSeek。角色皮肤与舞台字幕是演出；实际操作以记录为准。</p>
  </div>
  {offline?<p className="banner warn-banner" role="note">离线回放：此页面不联网、不请求接口，内容为导出时的静态快照。分享导出前请人工检查敏感信息。</p>:null}
  {demo?<p className="banner" role="note">示例回放：静态示例数据，不会请求网络，也不会调用任何模型。点击“返回实时”可回到实时记录。</p>:null}
  {streamNotice&&!localMode?<p className="banner" role="alert">{streamNotice} <button type="button" className="ghost" onClick={()=>{const api=apiRef.current;if(api)void loadRun(api,runId);}}>手动重连</button></p>:null}
  {notice?<p className="banner error" role="alert">{notice}{authBad?<span className="muted">（界面不会显示或导出令牌。）</span>:null}</p>:null}

  <div className="primary-actions">
   <button type="button" onClick={()=>{if(latestChange)chooseEvent(events.findIndex(event=>event.id===latestChange.id));}} disabled={!latestChange}>查看最近修改</button>
   <button type="button" className="ghost" onClick={()=>{if(handoffIndex<0)return;setMode('replay');setReplayPick(null);replay.jump(handoffIndex);replay.setPlaying(handoffIndex<events.length-1);}} disabled={handoffIndex<0}>重播最近交接</button>
   {mode==='replay'?<button type="button" className="ghost" onClick={()=>{setMode('live');setReplayPick(null);}}>回到现场</button>:null}
  </div>

  <div className="replay-bar" hidden={mode!=='replay'}>
   {handoffIndex===events.length-1&&handoffIndex>=0?<p className="replay-note" role="status">这次派活后暂无后续记录，已定位到派活。</p>:null}
   <details className="replay-advanced"><summary>回放控制</summary><div className="advanced-body">
   <div className="mode-switch" role="group" aria-label="实时或回放">
    <button type="button" className={mode==='live'?'active':''} aria-pressed={mode==='live'} onClick={()=>setMode('live')}>实时</button>
    <button type="button" className={mode==='replay'?'active':''} aria-pressed={mode==='replay'} onClick={()=>setMode('replay')} disabled={controlsDisabled}>回放</button>
   </div>
   <button type="button" className="ghost" onClick={()=>{setMode('replay');replay.step(-1);}} disabled={controlsDisabled}>上一条</button>
   <button type="button" className="ghost" onClick={()=>{setMode('replay');replay.step(1);}} disabled={controlsDisabled}>下一条</button>
   <label className="speed">速度
    <select value={replay.speed} onChange={event=>replay.setSpeed(Number(event.target.value))} aria-label="回放速度">
     {[1,2,4].map(value=><option key={value} value={value}>{value}x</option>)}
    </select>
   </label>
   <button type="button" className="ghost" onClick={()=>jumpTo(isHandoff)} disabled={controlsDisabled}>下一处交接</button>
   <button type="button" className="ghost" onClick={()=>jumpTo(event=>isFailure(event)||isHandoff(event))} disabled={controlsDisabled}>下一处失败或交接</button>
   </div></details>
   <button type="button" onClick={()=>{setMode('replay');if(replay.playing)replay.setPlaying(false);else replay.play();}} disabled={controlsDisabled}>
    {replay.playing?'暂停':'播放'}
   </button>
   <label className="scrub">
    <span className="muted">记录时间 {currentLabel} / {endLabel}</span>
    <input type="range" min={0} max={Math.max(1,replay.duration)} step={100}
     value={mode==='replay'?Math.round(replay.playhead):Math.round(replay.duration)}
     disabled={controlsDisabled} aria-label="回放时间位置"
     onChange={event=>{setMode('replay');setReplayPick(null);replay.scrub(Number(event.target.value));}}/>
   </label>
  </div>

  <main className="layout">
   <section className="desk-wrap" aria-label="直播台">
    {showWaiting?<div className="empty">
     <h2>{authBad?'无法读取记录':connection==='disconnected'?'信号呢？':'等待记录'}</h2>
     <p>{authBad?'请从启动命令输出的地址重新打开界面，令牌只保存在本次会话中。':connection==='disconnected'?'这表示与本地服务的连接中断，并不代表代理失败；记录本身可能仍然完整。':'还没有任何实时记录。可以先看示例回放，界面完全离线，不会调用模型。'}</p>
    </div>:null}
    <DeskPanel actors={actors} assets={loaded?.assets} mode={mode} now={stageNow} stageOn={stageOn} stageEvent={stageEvent} packet={packet} onPacket={()=>{if(packet)chooseEvent(events.findIndex(event=>event.id===packet.id));evidenceRef.current?.focus();}}/>
    <details className="desk-extra"><summary>记录与身份说明</summary>
     <span>白龙侧实例：{actors.codex.sessionLabel}</span>
     <span>蓝鲸侧实例：{actors.deepseek.sessionLabel}</span>
     <span>{sideText('system')}事件不参与姿态变化</span>
    </details>
   </section>

   <section className="recent-activity" aria-label="最近活动">
    <div className="pane-head"><h2>双方最近做了什么</h2><span className="muted">真实操作 · 点击看详情</span></div>
    {!recent.length?<p className="muted">等待记录，演员还没收到剧本。</p>:null}
    {recent.map(({event,index})=><button type="button" key={event.id} data-actor={event.actor} className={`activity-button activity-${event.actor}`} onClick={()=>chooseEvent(index)}>
     <span className="recent-actor">{ACTOR_LABEL[event.actor]}</span>
     <span className="recent-kind">{KIND_LABEL[event.kind]}</span>
     <span className="recent-summary">{eventSummary(event)}</span>
     {event.evidence==='unknown'?<span className="t-flag">归属未知</span>:null}
     <span className="t-time">{clockTime(event.at,finiteStart)}</span>
    </button>)}
   </section>

   <details className="history-details"><summary>全部记录 · {events.length} 条</summary>
   <section className="timeline-wrap" aria-label="活动时间线区域">
    <div className="pane-head">
     <h2>活动时间线</h2>
     <p className="muted">点击任意记录即可定位；回放时从该点继续。</p>
    </div>
    <div className="timeline-scroll"><Timeline events={events} index={displayIndex} mode={mode} onSelect={chooseEvent} listRef={listRef}/></div>
   </section>
   </details>

   <details className="evidence-details" open={evidenceOpen} onToggle={event=>setEvidenceOpen(event.currentTarget.open)}><summary>操作详情{displayEvent?` · ${ACTOR_LABEL[displayEvent.actor]} · ${KIND_LABEL[displayEvent.kind]}`:''}</summary>
   <EvidencePanel event={displayEvent} startMs={finiteStart} panelRef={evidenceRef}/>
   </details>
  </main>

  <footer className="foot">
   <p>交稿不是验收。字幕是演出，记录是证据。</p>
   <ArtCredits/>
  </footer>

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
