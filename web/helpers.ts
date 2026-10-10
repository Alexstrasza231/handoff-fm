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
  case 'tool.started':{const tool=eventTool(event)||'未知工具';const target=text(d.input&&typeof d.input==='object'?(d.input as Record<string,unknown>).path||(d.input as Record<string,unknown>).file:'');return target?`${tool} → ${baseName(target)}`:tool;}
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
  case 'session.started':return '灯光师就位，话筒试音——HandoffFM 开播！';
  case 'task.started':return '今天的题面：交给两位同学接力。';
  case 'delegate.started':return event.actor==='codex'?'白龙把卷轴递了过去：这里交给你啦。':'蓝鲸接住了卷轴：收到，我来。';
  case 'tool.started':{const pose=poseForTool(eventTool(event));return pose==='read'?'翻资料中，哗啦哗啦。':pose==='edit'?'动笔了，落笔要稳。':'跑起来了，别眨眼。';}
  case 'tool.completed':return toolCompletionLabel(event)==='命令退出码 0'?'叮——命令安全落地。':'先把结果记在案上。';
  case 'file.changed':return event.evidence==='observed'?'文件页翻过一页，墨迹未干。':event.evidence==='unknown'?'这页是谁改的？先记个问号。':'文件有新动静。';
  case 'agent.message':return '两位同学先后发言，记录在案。';
  case 'delegate.completed':return '交稿！请检查，掌声先欠着。';
  case 'delegate.failed':return '这次没接稳，先如实记录。';
  case 'turn.completed':return '这一幕杀青，回放随时可以看。';
  case 'turn.interrupted':return '话说到一半被打断了。';
  case 'recording.gap':return '嗡——这一段录音有缺口。';
  default:return '继续记录中。';
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
