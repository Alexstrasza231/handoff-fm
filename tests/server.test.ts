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
