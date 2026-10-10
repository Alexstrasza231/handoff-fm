import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject,enqueue,collect,readRun } from '../src/store';
import { redact,safeRelative } from '../src/privacy';
import type { FMEvent } from '../src/types';
test('init preserves configuration and ignores private records',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hfm-')); await initProject(root);
 const cfg=await readFile(join(root,'.handoff-fm/config.json'),'utf8');
 await initProject(root); assert.equal(await readFile(join(root,'.handoff-fm/config.json'),'utf8'),cfg);
 assert.match(await readFile(join(root,'.gitignore'),'utf8'),/\.handoff-fm\//);
});
test('redaction excludes nested credential values and escaping paths',()=>{
 const v=redact({authorization:'Bearer very-secret-value',token:'secret',text:'OPENAI_API_KEY=sk-123456789012345678901234; normal'});
 assert.ok(!v.includes('very-secret-value')); assert.ok(!v.includes('sk-123456789')); assert.match(v,/normal/);
 assert.equal(safeRelative('/project','/project/.env'),null); assert.equal(safeRelative('/project','/outside/file.ts'),null);
 assert.equal(safeRelative('/project','/project/src/a.ts'),'src/a.ts');
});
test('collector deduplicates producer IDs durably across restarts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hfm-'));await initProject(root);
 const event:FMEvent={version:1,id:'event-one',runId:'run-one',actor:'codex',kind:'tool.started',at:new Date().toISOString(),sessionId:'session-one',evidence:'observed',data:{tool:'Bash'}};
 await enqueue(root,event);await collect(root);await enqueue(root,event);await collect(root);
 const rows=await readRun(root,'run-one');assert.equal(rows.length,1);assert.equal(rows[0].seq,1);
 await enqueue(root,{...event,id:'event-two',kind:'tool.completed'});await collect(root);
 assert.deepEqual((await readRun(root,'run-one')).map(x=>x.seq),[1,2]);
});
