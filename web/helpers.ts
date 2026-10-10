import type {Actor,EventKind,Evidence,FMEvent} from '../src/types';

export type {Actor,EventKind,Evidence,FMEvent};

/* ------------------------------------------------------------------ labels */

export const KIND_LABEL:Record<EventKind,string>={
 'session.started':'会话开始','task.started':'任务开始','delegate.started':'派发代理','tool.started':'调用工具',
 'tool.completed':'工具结束','file.changed':'文件变化','agent.message':'代理声明','delegate.completed':'代理交稿',
 'delegate.failed':'代理失败','turn.completed':'回合完成','turn.interrupted':'回合已中断','recording.gap':'记录缺口'
};
export const EVIDENCE_LABEL:Record<Evidence,string>={observed:'观测到',declared:'代理声明',unknown:'归属未知'};
export const ACTOR_LABEL:Record<Actor,string>={codex:'Codex',deepseek:'DeepSeek',unknown:'未知来源',system:'系统'};
export type Character='codex'|'deepseek'|'none';
export function characterOf(actor:Actor):Character{return actor==='codex'||actor==='deepseek'?actor:'none';}

export type Pose='idle'|'accept'|'read'|'edit'|'run'|'handoff'|'celebrate'|'error';
export const POSES:Pose[]=['idle','accept','read','edit','run','handoff','celebrate','error'];
export const POSE_LABEL:Record<Pose,string>={idle:'待命',accept:'接单',read:'阅读',edit:'编辑',run:'执行',handoff:'交接',celebrate:'庆祝',error:'出错'};

export function text(value:unknown):string{return typeof value==='string'?value:value==null?'':String(value);}
export function baseName(path:string):string{return path.replace(/\\/g,'/').split('/').filter(Boolean).pop()||path;}

/* ------------------------------------------------------- tool + pose logic */

const READ_TOOLS=/(^|[^a-z])(read|cat|view|open|list|ls|glob|grep|search|fetch|web_search)([^a-z]|$)/;
const EDIT_TOOLS=/(^|[^a-z])(write|edit|apply_patch|patch|create|replace|multiedit|write_file|edit_file)([^a-z]|$)/;
const RUN_TOOLS=/(^|[^a-z])(bash|exec|shell|run|command|terminal|sh|pwsh|powershell|cmd)([^a-z]|$)/;

export function eventTool(event:FMEvent):string{
 const raw=text(event.data.tool)||text((event.data.input as Record<string,unknown>|undefined)?.tool);
 return raw;
}
export function isCommandTool(tool:string):boolean{return RUN_TOOLS.test(tool.toLowerCase());}

/** Tool name to pose. Only observed tool identity is used, never model guessing. */
export function poseForTool(tool:string):Pose{
 const name=tool.toLowerCase();
 if(!name)return 'run';
 if(EDIT_TOOLS.test(name))return 'edit';
 if(READ_TOOLS.test(name))return 'read';
 if(RUN_TOOLS.test(name))return 'run';
 return 'run';
}
export function poseForEvent(event:FMEvent):Pose{
 switch(event.kind){
  case 'session.started':case 'turn.completed':return 'idle';
  case 'task.started':return 'accept';
  case 'tool.started':return poseForTool(eventTool(event));
  case 'tool.completed':return event.data.status==='failed'||typeof event.data.exitCode==='number'&&event.data.exitCode!==0?'error':isCommandTool(eventTool(event))&&event.data.exitCode===0?'celebrate':poseForTool(eventTool(event));
  case 'file.changed':return 'edit';
  case 'agent.message':return 'idle';
  case 'delegate.started':return event.actor==='codex'?'handoff':'accept';
  case 'delegate.completed':return event.actor==='deepseek'?'handoff':'accept';
  case 'delegate.failed':return 'error';
  case 'turn.interrupted':return 'error';
  case 'recording.gap':return 'error';
  default:return 'idle';
 }
}

/** Command completion is only "completed" when the evidence says so. Never project acceptance. */
export function toolCompletionLabel(event:FMEvent):string{
 const tool=eventTool(event);
 const exitCode=event.data.exitCode;
 if(isCommandTool(tool))return exitCode===0?'命令退出码 0':'命令中止 / 退出码未知';
 if(text(event.data.status)==='completed')return '工具结束（已报告完成）';
 return '工具结束';
}
export function toolExitText(value:unknown):string|null{
 return typeof value==='number'&&Number.isFinite(value)?`exitCode ${value}`:null;
}

/* ------------------------------------------------------------ event summary */

export function eventSummary(event:FMEvent):string{
 const d=event.data;
 switch(event.kind){
  case 'task.started':return text(d.prompt)||'(无任务文本)';
  case 'session.started':return text(d.source)?`来源 ${text(d.source)}`:'会话开始';
  case 'delegate.started':return text(d.title)||'派出代理';
  case 'tool.started':{const tool=eventTool(event)||'未知工具';const input=d.input&&typeof d.input==='object'?d.input as Record<string,unknown>:{};const target=text(input.path||input.file||input.file_path||input.filePath);return target?`${tool} → ${baseName(target)}`:tool;}
  case 'tool.completed':{const exit=toolExitText(d.exitCode);return `${eventTool(event)||'工具'} · ${toolCompletionLabel(event)}${exit?` · ${exit}`:''}`;}
  case 'file.changed':return text(d.path)?baseName(text(d.path)):text(d.change)||'文件变化';
  case 'agent.message':return text(d.text)||'(空声明)';
  case 'delegate.completed':return `交稿待检查${text(d.reason)&&text(d.reason)!=='unknown'?` · ${text(d.reason)}`:''}`;
  case 'delegate.failed':return text(d.message)||`代理失败 · ${text(d.reason)||'原因未知'}`;
  case 'turn.completed':return '回合完成';
  case 'turn.interrupted':return '已中断';
  case 'recording.gap':return text(d.message)||'记录缺口';
  default:return '';
 }
}

/* ------------------------------------------------------------------ subtitle */

/** Fixed stage lines, clearly labelled 舞台字幕. Real quotes only live in the evidence panel. */
export function stageLine(event:FMEvent):string{
 switch(event.kind){
  case 'session.started':return '白龙：开工。蓝鲸：饭碗就位。';
  case 'task.started':return '白龙：新任务来了。蓝鲸：饭可以等，需求不能漏。';
  case 'delegate.started':return event.actor==='codex'?'白龙：这一棒交给你。蓝鲸：收到，饭先放一边。':'新任务递到了舞台中央，先记下这次交接。';
  case 'tool.started':{
   const tool=eventTool(event),pose=poseForTool(tool);
   if(pose==='read')return '白龙：先翻资料。蓝鲸：书到用时方恨多。';
   if(pose==='edit')return '白龙：这行再揉揉。蓝鲸：代码不熟，不能出锅。';
   return isCommandTool(tool)?'白龙：跑一遍。蓝鲸：希望绿灯比饭先到。':'蓝鲸：工具开工。白龙：结果我盯着。';
  }
  case 'tool.completed':{
   if(event.data.status==='failed'||typeof event.data.exitCode==='number'&&event.data.exitCode!==0)return '白龙：红了。蓝鲸：这锅先查日志。';
   return toolCompletionLabel(event)==='命令退出码 0'?'白龙：这条命令过了。蓝鲸：开香槟？白龙：先别。':'蓝鲸：工具收工。白龙：结果我看看。';
  }
  case 'file.changed':return event.evidence==='unknown'?'白龙：谁改的？蓝鲸：先挂问号，别急着认领。':event.evidence==='observed'?'蓝鲸：文件有新墨迹。白龙：差异拿来看看。':'白龙：收到修改声明。蓝鲸：以证据为准。';
  case 'agent.message':return '白龙：发言已收录。蓝鲸：证据比音量重要。';
  case 'delegate.completed':return '蓝鲸：交稿！白龙：红笔已经准备好了。';
  case 'delegate.failed':return '蓝鲸：这棒没接住。白龙：先看失败记录。';
  case 'turn.completed':return '白龙：这一轮收工。蓝鲸：回放见。';
  case 'turn.interrupted':return '白龙：暂停拍摄。蓝鲸：这段被打断了。';
  case 'recording.gap':return '白龙：这段没录全。蓝鲸：导演，少了一帧。';
  default:return '白龙：等新记录。蓝鲸：饭先保温。';
 }
}

/* -------------------------------------------------------------------- actor */

export interface ActorView{
 actor:'codex'|'deepseek';
 pose:Pose;
 /** Pose observed in the latest event prefix; null when only idle/session chatter exists. */
 lastActionPose:Pose|null;
 status:string;
 evidence:Evidence|null;
 sessions:string[];
 sessionLabel:string;
 model:string;
 at:string|null;
 active:boolean;
}
export interface ActorState{codex:ActorView;deepseek:ActorView;nextCharacter:Character|null;}

const IDLE_LINE='还没有记录到动作';

/** Everything here is computed from the rendered event prefix only: scrubbing backwards regresses the desk. */
export function deriveActors(events:FMEvent[]):ActorState{
 const views={codex:emptyView('codex'),deepseek:emptyView('deepseek')};
 for(const event of events){
  const character=characterOf(event.actor);
  if(character==='none')continue;
  const view=views[character];
  const pose=poseForEvent(event);
  view.pose=pose;
  view.status=KIND_LABEL[event.kind];
  view.evidence=event.evidence;
  view.at=event.at;
  if(event.sessionId&&!view.sessions.includes(event.sessionId))view.sessions.push(event.sessionId);
  if(event.model)view.model=event.model;
  if(pose!=='idle')view.lastActionPose=pose;
  if(event.kind==='delegate.started'&&event.actor==='codex'){
   // The sender holds the packet until the receiver's delegate.completed event is recorded.
   views.codex.pose='handoff';views.codex.status='等待接手';
   views.deepseek.pose='accept';views.deepseek.status='准备接手';
  }
  if(event.kind==='delegate.completed'&&event.actor==='deepseek'){
   views.codex.pose='accept';views.codex.status='接收交稿';
  }
  if(event.kind==='delegate.failed'&&event.actor==='deepseek'){
   views.codex.pose='accept';views.codex.status='接手失败记录';
  }
 }
 const last=events.at(-1);
 return {codex:finalize(views.codex),deepseek:finalize(views.deepseek),nextCharacter:last&&characterOf(last.actor)!=='none'?characterOf(last.actor) as Character:null};
}

function emptyView(actor:'codex'|'deepseek'):ActorView{
 return {actor,pose:'idle',lastActionPose:null,status:'等待记录',evidence:null,sessions:[],sessionLabel:'尚未记录到实例',model:'未知',at:null,active:false};
}
function finalize(view:ActorView):ActorView{
 if(!view.at&&!view.sessions.length)return {...view,status:'等待记录',active:false,lastActionPose:null};
 return {...view,sessionLabel:view.sessions.length?view.sessions.join('、'):'尚未记录到实例',model:view.model||'未知'};
}
export const IDLE_STATUS=IDLE_LINE;

/* ------------------------------------------------------------------- extras */

export function gitSafeJson(value:unknown):string{
 try{return JSON.stringify(value,null,1)??'';}catch{return String(value);}
}
export function relativeTime(at:string|null,nowMs:number):string{
 if(!at)return '无记录';
 const ms=nowMs-Date.parse(at);
 if(!Number.isFinite(ms))return '时间未知';
 if(ms<1000)return '刚刚';
 const seconds=Math.floor(ms/1000);
 if(seconds<60)return `${seconds} 秒前`;
 const minutes=Math.floor(seconds/60);
 if(minutes<60)return `${minutes} 分钟前`;
 const hours=Math.floor(minutes/60);
 if(hours<24)return `${hours} 小时前`;
 return `${Math.floor(hours/24)} 天前`;
}
export function clockTime(at:string,startMs:number):string{
 const ms=Date.parse(at);
 if(!Number.isFinite(ms))return '--:--';
 const total=Math.max(0,ms-startMs);
 const minutes=Math.floor(total/60000),seconds=Math.floor(total%60000/1000),tenths=Math.floor(total%1000/100);
 return `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}.${tenths}`;
}
