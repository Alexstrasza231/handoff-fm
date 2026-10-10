import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initProject,collect,readRun,dir} from '../src/store';
import {captureHook} from '../src/hooks';
test('excluded file content is absent from tool input and result records as well as diffs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fm-privacy-'));await initProject(root);
 const input={cwd:root,session_id:'run',tool_name:'apply_patch',tool_use_id:'call',tool_input:{command:'*** Begin Patch\n*** Add File: .env\n+CUSTOM_DATA=canary-private-value\n*** End Patch'}};
 await captureHook(root,{...input,hook_event_name:'PreToolUse'});await writeFile(join(root,'.env'),'CUSTOM_DATA=canary-private-value');
 await captureHook(root,{...input,hook_event_name:'PostToolUse',tool_response:{output:'canary-private-value'}});await collect(root);
 const rows=await readRun(root,'run');assert.equal(rows.length,2);assert.doesNotMatch(JSON.stringify(rows),/canary-private-value/);
 assert.equal(rows[0].data.excluded,true);
});
test('relative paths use tool cwd and binary files never enter tool evidence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fm-scope-'));await initProject(root);const sub=join(root,'sub');await mkdir(sub);
 await writeFile(join(sub,'oversized.txt'),'x'.repeat(1024*1024+1));await writeFile(join(sub,'opaque.dat'),Buffer.from('binary\0canary'));
 for(const [index,path] of ['oversized.txt','opaque.dat'].entries()){
  const input={cwd:sub,session_id:'run',tool_name:'read_file',tool_use_id:'c'+index,tool_input:{file_path:path}};
  await captureHook(root,{...input,hook_event_name:'PreToolUse'});
  await captureHook(root,{...input,hook_event_name:'PostToolUse',tool_response:{output:'excluded-output-canary'}});
 }await collect(root);const rows=await readRun(root,'run');assert.equal(rows.length,4);assert.ok(rows.every(e=>e.data.excluded));assert.doesNotMatch(JSON.stringify(rows),/excluded-output-canary/);
});
test('interrupt cleanup removes only this session operation and records the missing completion',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fm-interrupt-'));await initProject(root);
 await captureHook(root,{cwd:root,session_id:'s',tool_name:'apply_patch',tool_use_id:'i',tool_input:{command:'*** Add File: a.txt'},hook_event_name:'PreToolUse'});
 await captureHook(root,{cwd:root,session_id:'s',hook_event_name:'Interrupt'});
 assert.deepEqual(await readdir(join(dir(root),'pending')),[]);await collect(root);assert.ok((await readRun(root,'s')).some(e=>e.kind==='recording.gap'));
});
