export type Actor = 'codex' | 'deepseek' | 'unknown' | 'system';
export type Evidence = 'observed' | 'declared' | 'unknown';
export type EventKind = 'session.started'|'task.started'|'delegate.started'|'tool.started'|'tool.completed'|'file.changed'|'agent.message'|'delegate.completed'|'delegate.failed'|'turn.completed'|'turn.interrupted'|'recording.gap'|'usage.recorded';
export interface FMEvent {
 version:1; id:string; runId:string; actor:Actor; kind:EventKind; at:string;
 sessionId:string; turnId?:string; taskId?:string; parentTaskId?:string; model?:string;
 evidence:Evidence; data:Record<string,unknown>; seq?:number;
}
export interface ProjectConfig {version:1; root:string; dshCommand?:string; boundSessions:string[];}
export type ShareOptions = {prompts:boolean;paths:boolean;diffs:boolean;outputs:boolean;usage?:boolean};
export const DEFAULT_SHARE:ShareOptions={prompts:false,paths:false,diffs:false,outputs:false,usage:false};
/** Input already contains caches; output already contains reasoning. Subsets are never added twice. */
export interface UsageNumbers {input?:number;output?:number;cacheRead?:number;cacheWrite?:number;reasoning?:number;total?:number;}
export type UsageCoverage='complete'|'partial'|'unavailable';
export interface UsageSample extends UsageNumbers {sampleKey:string;source:'codex-transcript'|'deepseek-step';coverage:UsageCoverage;}
