import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initProject,enqueue,collect} from '../src/store';
import {startWatch} from '../src/server';
import type {FMEvent} from '../src/types';

test('run list follows latest received activity, including an older run and a backwards producer clock',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fm-run-order-'));
 await initProject(root);
 const events:FMEvent[]=[
  {version:1,id:'order-a',runId:'a',sessionId:'a',actor:'codex',kind:'task.started',at:'2026-01-01T10:00:00Z',evidence:'observed',data:{prompt:'Active task'}},
  {version:1,id:'order-b',runId:'b',sessionId:'b',actor:'codex',kind:'task.started',at:'2026-01-01T11:00:00Z',evidence:'observed',data:{prompt:'Inactive task'}},
  {version:1,id:'order-a-again',runId:'a',sessionId:'a',actor:'deepseek',kind:'agent.message',at:'2026-01-01T09:00:00Z',evidence:'declared',data:{text:'Review ready'}}
 ];
 // Collect after every event to make reception order independent of inbox filename timestamps.
 for(const event of events){await enqueue(root,event);await collect(root);}
 const server=await startWatch(root,{port:0});
 try{
  const rows=await (await fetch(`http://127.0.0.1:${server.port}/api/runs`,{headers:{Authorization:`Bearer ${server.token}`}})).json();
  assert.deepEqual(rows.map((row:{id:string})=>row.id),['a','b']);
  assert.equal(rows[0].title,'Active task');
  assert.equal(rows[0].count,2);
 }finally{await server.close();}
});
