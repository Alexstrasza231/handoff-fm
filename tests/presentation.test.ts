import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {FMEvent} from '../src/types';
import {eventSummary} from '../web/helpers';
import {timeWindow} from '../web/replay';

// A missing helper is reported as a feature assertion, rather than a module-load error.
async function helpers(){const loaded=await import('../web/presentation').catch(()=>null);assert.ok(loaded,'compact presentation helpers must exist');return loaded;}
const event=(kind:FMEvent['kind'],actor:FMEvent['actor']='codex',data:Record<string,unknown>={}):FMEvent=>({version:1,id:kind,runId:'run',sessionId:'session',kind,actor,data,evidence:'observed',at:'2026-10-10T12:00:00Z'});

test('task title extracts the user request and uses the most recent recorded task',async()=>{
 const {taskTitle}=await helpers();
 const wrapped='<in-app-browser-context>irrelevant metadata</in-app-browser-context>\n## My request:\n把卡片改成蓝色';
 assert.equal(taskTitle([event('task.started','codex',{prompt:'旧任务'}),event('task.started','codex',{prompt:wrapped})]),'把卡片改成蓝色');
 assert.equal(taskTitle([]),'等待记录');
 assert.equal(taskTitle([event('task.started','codex',{prompt:'PLEASE IMPLEMENT THIS PLAN:\n# HandoffFM v0.1.2：新手首页与任务用量\n\n## 首页更简单\n- 一句话'})]),'HandoffFM v0.1.2：新手首页与任务用量');
 assert.equal(taskTitle([event('task.started','codex',{prompt:'<send_user_message_question_reply>[{"answer":"开始修改"}]</send_user_message_question_reply>'})]),'开始修改');
});

test('recent activities retain original indexes, actors and unknown attribution',async()=>{
 const {recentActivities}=await helpers();
 const events=[event('session.started'),event('delegate.started'),event('tool.started','deepseek',{tool:'read',input:{path:'card.tsx'}}),{...event('file.changed','deepseek',{path:'card.tsx'}),evidence:'unknown' as const},event('tool.completed','deepseek',{tool:'read',status:'completed'}),event('tool.completed','codex',{tool:'bash',exitCode:1})];
 const rows=recentActivities(events,6);
 assert.deepEqual(rows.map(row=>row.index),[1,2,3,5]);
 assert.equal(rows[2].event.evidence,'unknown');
 assert.equal(rows[2].event.actor,'deepseek');
 assert.equal(recentActivities(events,2).length,2);
});

test('one-click replay locates the latest dispatch, not the start of a long session',async()=>{
 const {latestHandoffIndex}=await helpers();
 assert.equal(latestHandoffIndex([event('delegate.started'),event('delegate.completed'),event('task.started'),event('delegate.started'),event('file.changed')]),3);
 assert.equal(latestHandoffIndex([event('task.started'),event('file.changed')]),-1);
 assert.equal(latestHandoffIndex([]),-1);
});

test('out-of-order producer clocks cannot make later received events unreachable in replay',()=>{
 const rows=[{...event('session.started'),at:'2026-10-10T12:00:00Z'},{...event('tool.started'),at:'2026-10-10T12:00:05Z'},{...event('file.changed'),at:'2026-10-10T12:00:03Z'}];
 const window=timeWindow(rows);
 assert.equal(window.duration,5000);
 assert.deepEqual(window.offsets,[0,5000,5000]);
 assert.equal(rows[2].at,'2026-10-10T12:00:03Z','original timestamps stay untouched');
});

test('a busy helper does not hide the other participants most recent operations',async()=>{
 const {recentActivities}=await helpers();
 const events=[event('file.changed','codex',{path:'App.tsx'}),event('tool.started','codex',{tool:'apply_patch'}),...Array.from({length:8},()=>event('tool.started','deepseek',{tool:'read',input:{file_path:'styles.css'}}))];
 const rows=recentActivities(events);
 assert.ok(rows.some(row=>row.event.actor==='codex'),'show recorded work from both sides');
 assert.ok(rows.some(row=>row.event.actor==='deepseek'));
 assert.equal(rows.length,6);
 assert.deepEqual(rows.map(row=>row.index),[...rows.map(row=>row.index)].sort((a,b)=>a-b));
});

test('DSH read file_path is displayed as a concise actual target',()=>{
 assert.equal(eventSummary(event('tool.started','deepseek',{tool:'read',input:{file_path:'C:\\project\\web\\App.tsx'}})),'read → App.tsx');
});
