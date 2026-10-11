import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDSH} from '../src/delegate';
import {shareEvents} from '../src/share';
import {DEFAULT_SHARE,type FMEvent} from '../src/types';
const ctx={runId:'run',sessionId:'ds',taskId:'job',parentTaskId:'turn'};
const step=(usage:unknown,step=1)=>normalizeDSH({type:'status',phase:'step_end',turn:1,step,usage},ctx);
const event=(kind:string,data={},extra={}):FMEvent=>({version:1,id:Math.random().toString(),runId:'run',sessionId:'cx',actor:'codex',kind:kind as FMEvent['kind'],at:'2026-10-11T00:00:00Z',evidence:'observed',taskId:'turn',data,...extra});
test('DS step usage includes cache once and reasoning remains an output subset',()=>{
 const rows=step({inputTokens:10,cacheReadTokens:80,cacheWriteTokens:10,outputTokens:20,reasoningTokens:5,totalTokens:120});
 assert.equal(rows.length,1);assert.equal(rows[0].kind,'usage.recorded');
 assert.equal(rows[0].data.input,100);assert.equal(rows[0].data.output,20);assert.equal(rows[0].data.total,120);
 assert.equal(rows[0].data.cacheRead,80);assert.equal(rows[0].data.reasoning,5);
 assert.equal(rows[0].parentTaskId,'turn');assert.deepEqual(step({inputTokens:-1,outputTokens:20})[0].data,step(undefined)[0].data);
});
test('incomplete DeepSeek cache data does not fabricate a total',()=>{
 const rows=step({inputTokens:10,outputTokens:20});assert.equal(rows.length,1);
 assert.equal(rows[0].data.total,undefined);assert.equal(rows[0].data.input,undefined);assert.equal(rows[0].data.coverage,'partial');
 assert.equal(step(undefined)[0].data.coverage,'unavailable');
 assert.equal(normalizeDSH({type:'status',phase:'turn_end',usage:{totalTokens:1000}},ctx).length,0);
});
test('default share removes usage events entirely, opt-in preserves only numeric metadata',()=>{
 const row=event('usage.recorded',{input:100,output:20,total:120,source:'codex-transcript',sampleKey:'secret-path:turn',coverage:'complete',transcriptPath:'secret',raw:'private'});
 assert.deepEqual(shareEvents([row],DEFAULT_SHARE),[]);
 const out=shareEvents([row],{...DEFAULT_SHARE,usage:true} as any);assert.equal(out.length,1);
 assert.equal(out[0].data.total,120);assert.equal(JSON.stringify(out).includes('secret'),false);assert.equal(JSON.stringify(out).includes('private'),false);
});
test('usage sharing preserves unique tool counts through opaque call aliases',async()=>{
 const {summarizeUsage}=await import('../src/usage');const rows=[event('task.started'),event('tool.started',{callId:'private-call'}),event('tool.completed',{callId:'private-call'}),event('tool.started',{callId:'private-call'},{actor:'deepseek',sessionId:'ds',taskId:'job',parentTaskId:'turn'})];
 const shared=shareEvents(rows,{...DEFAULT_SHARE,usage:true});assert.equal(summarizeUsage(shared,{scope:'task'}).tools,2);
 assert.equal(shared[1].data.callId,shared[2].data.callId);assert.notEqual(shared[1].data.callId,shared[3].data.callId);assert.equal(JSON.stringify(shared).includes('private-call'),false);
 assert.equal(shareEvents(rows,DEFAULT_SHARE)[1].data.callId,undefined);
});
test('latest sampling replaces cumulative values, distinct steps sum, current task excludes ambiguity',async()=>{
 const api=await import('../src/usage').catch(()=>null);assert.ok(api,'Usage statistics module must exist');
 const rows=[event('task.started',{}),event('tool.started',{callId:'a'}),event('tool.completed',{callId:'a'}),
 event('usage.recorded',{sampleKey:'cx-turn',source:'codex-transcript',input:100,output:20,total:120,coverage:'complete'}),
 event('usage.recorded',{sampleKey:'cx-turn',source:'codex-transcript',input:200,output:30,total:230,coverage:'complete'}),
 ...step({inputTokens:10,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:5}),
 ...step({inputTokens:20,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:10},2),
 event('usage.recorded',{sampleKey:'unlinked',source:'deepseek-step',input:900,output:10,total:910,coverage:'complete'},{actor:'deepseek',taskId:'other',parentTaskId:undefined})];
 const stats=api.summarizeUsage(rows,{scope:'task',now:Date.parse('2026-10-11T00:00:10Z')});
 assert.equal(stats.total,275);assert.equal(stats.tools,1);assert.equal(stats.actors.codex.input,200);
 assert.equal(stats.actors.deepseek.output,15);assert.equal(stats.unassociated,1);
 assert.equal(api.summarizeUsage(rows.slice(0,4),{scope:'task'}).total,120);
 assert.equal(api.summarizeUsage(rows,{scope:'session'}).total,1185);
});
test('task switch and same-session active task resolution are unambiguous only',async()=>{
 const api=await import('../src/usage').catch(()=>null);assert.ok(api);
 const rows=[event('task.started',{}),event('task.started',{}, {taskId:'parallel'})];
 assert.equal(api.resolveParentTask(rows,'cx'),undefined);
 assert.equal(api.resolveParentTask(rows,'different'),undefined);
 assert.equal(api.resolveParentTask([...rows,event('turn.completed',{}, {taskId:'parallel'})],'cx'),'turn');
 assert.equal(api.summarizeUsage(rows,{scope:'task'}).taskId,'parallel');
 assert.equal(api.summarizeUsage(rows,{scope:'task'}).total,undefined);
});
test('unassociated detail groups jobs and replaces repeated samples',async()=>{
 const api=await import('../src/usage');assert.equal(typeof api.unassociatedUsage,'function');
 const rows=[event('usage.recorded',{sampleKey:'s',source:'deepseek-step',input:20,output:10,total:30,coverage:'complete'},{actor:'deepseek',taskId:'job'}),
 event('usage.recorded',{sampleKey:'s',source:'deepseek-step',input:40,output:10,total:50,coverage:'complete'},{actor:'deepseek',taskId:'job'})];
 const detail=api.unassociatedUsage(rows);assert.equal(detail.length,1);assert.equal(detail[0].usage.total,50);
});
test('a measured delegate cannot make a sibling with no samples look complete',async()=>{
 const api=await import('../src/usage');const rows=[event('task.started'),
 event('usage.recorded',{sampleKey:'cx',source:'codex-transcript',input:10,output:10,total:20,coverage:'complete'}),
 event('delegate.started',{}, {taskId:'missing',parentTaskId:'turn'}),
 event('tool.started',{callId:'missing-read'},{actor:'deepseek',taskId:'missing',parentTaskId:'turn'}),
 ...step({inputTokens:10,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:5})];
 assert.equal(api.summarizeUsage(rows,{scope:'task'}).coverage,'partial');
 assert.equal(api.summarizeUsage(rows,{scope:'task'}).actors.deepseek.coverage,'partial');
});
test('illegal, fractional and contradictory provider numbers never become valid totals',()=>{
 for(const value of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'20',null])assert.equal(step({inputTokens:value,outputTokens:2,cacheReadTokens:0,cacheWriteTokens:0})[0].data.coverage,'unavailable');
 assert.equal(step({inputTokens:10,outputTokens:2,reasoningTokens:3,cacheReadTokens:0,cacheWriteTokens:0})[0].data.coverage,'unavailable');
 assert.equal(step({inputTokens:10,outputTokens:2,totalTokens:11,cacheReadTokens:0,cacheWriteTokens:0})[0].data.coverage,'unavailable');
});

