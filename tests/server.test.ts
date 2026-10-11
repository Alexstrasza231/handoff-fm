import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {initProject,enqueue,collect} from '../src/store';
import {startWatch} from '../src/server';
import {shareEvents} from '../src/export';
import {DEFAULT_SHARE,type FMEvent} from '../src/types';
const event:FMEvent={version:1,id:'event',runId:'private-run',sessionId:'private-session',actor:'codex',kind:'task.started',at:new Date().toISOString(),evidence:'observed',data:{prompt:'private task',path:'private/file.ts',output:'private output',diff:'private diff'}};
test('default share contains no source text, private identifiers, paths, or wall-clock time',()=>{
 const result=shareEvents([event],DEFAULT_SHARE);const text=JSON.stringify(result);
 assert.doesNotMatch(text,/private|2026/);assert.equal(result[0].at,'1970-01-01T00:00:00.000Z');
 assert.match(JSON.stringify(shareEvents([event],{...DEFAULT_SHARE,prompts:true})),/private task/);
});
test('loopback service requires token and trusted Host/Origin, and never exposes command execution',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fm-server-'));await initProject(root);await enqueue(root,event);await collect(root);
 const server=await startWatch(root,{port:0});const url=`http://127.0.0.1:${server.port}`;
 try{
  assert.equal((await fetch(url+'/api/runs')).status,401);
  const headers={Authorization:`Bearer ${server.token}`};
  assert.equal((await fetch(url+'/api/runs',{headers:{...headers,Origin:'https://evil.test'}})).status,403);
  const hostStatus=await new Promise<number>(done=>{request(url+'/api/runs',{headers:{...headers,Host:'evil.test'}},r=>{r.resume();done(r.statusCode!);}).end();});assert.equal(hostStatus,403);
  const rows=await (await fetch(url+'/api/events?run=private-run',{headers})).json();assert.equal(rows.length,1);
  assert.equal((await fetch(url+'/api/exec',{method:'POST',headers})).status,405);
  const abort=new AbortController();const stream=await fetch(url+'/api/stream?since=0',{headers,signal:abort.signal});
  const chunk=await stream.body!.getReader().read();assert.match(new TextDecoder().decode(chunk.value),/id: 1/);abort.abort();
 }finally{await server.close();}
});
test('usage survives collector restart and SSE resumes by sequence without duplicate accounting',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fm-usage-stream-'));await initProject(root);
 const sample={...event,id:'usage-1',kind:'usage.recorded' as const,taskId:'turn',data:{source:'codex-transcript',sampleKey:'turn',input:100,output:20,total:120,coverage:'complete'}};
 await enqueue(root,sample);await collect(root);let watcher=await startWatch(root,{port:0});await watcher.close();
 await enqueue(root,{...sample,id:'usage-2',data:{...sample.data,input:200,total:220}});await collect(root);
 watcher=await startWatch(root,{port:0});const abort=new AbortController();
 try{
  const res=await fetch(`http://127.0.0.1:${watcher.port}/api/stream?since=1`,{headers:{Authorization:`Bearer ${watcher.token}`},signal:abort.signal});
  const data=new TextDecoder().decode((await res.body!.getReader().read()).value);
  assert.match(data,/id: 2/);assert.doesNotMatch(data,/id: 1\n/);assert.match(data,/usage.recorded/);
  const rows=await (await fetch(`http://127.0.0.1:${watcher.port}/api/events`,{headers:{Authorization:`Bearer ${watcher.token}`}})).json();
  const {summarizeUsage}=await import('../src/usage');assert.equal(summarizeUsage(rows,{scope:'session'}).total,220);
 }finally{abort.abort();await watcher.close();}
});
