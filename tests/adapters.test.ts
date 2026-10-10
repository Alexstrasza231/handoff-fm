import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject,collect,readRun } from '../src/store';
import { captureHook } from '../src/hooks';
import { normalizeDSH,completionReason } from '../src/delegate';
test('installed DSH object completion reason and older string form normalize identically',()=>{
 assert.equal(completionReason({kind:'completed'}),'completed');assert.equal(completionReason('completed'),'completed');
 assert.equal(completionReason({kind:'interrupted'}),'interrupted');assert.equal(completionReason(null),'unknown');
});
test('hooks scope to enabled project and preserve real tool identity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hfm-'));await initProject(root);
 const common={session_id:'session',turn_id:'turn',cwd:root,model:'provided-model',tool_name:'Bash',tool_use_id:'call',tool_input:{command:'npm test'}};
 await captureHook(root,{...common,cwd:tmpdir(),hook_event_name:'PreToolUse'});
 await captureHook(root,{...common,hook_event_name:'PreToolUse'});
 await captureHook(root,{...common,hook_event_name:'PostToolUse',tool_response:{exit_code:1,output:'failed'}});
 await collect(root);const rows=await readRun(root,'session');assert.equal(rows.length,2);assert.equal(rows[0].model,'provided-model');assert.equal(rows[1].data.exitCode,1);
});
test('actual apply_patch changes have evidence; shell changes remain unknown',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hfm-'));await initProject(root);await writeFile(join(root,'card.ts'),'export const label="before";\n');
 const common={session_id:'session',turn_id:'turn',cwd:root,tool_name:'apply_patch',tool_use_id:'edit',tool_input:{command:'*** Begin Patch\n*** Update File: card.ts\n@@\n-export const label="before";\n+export const label="after";\n*** End Patch'}};
 await captureHook(root,{...common,hook_event_name:'PreToolUse'});await writeFile(join(root,'card.ts'),'export const label="after";\n');
 await captureHook(root,{...common,hook_event_name:'PostToolUse',tool_response:{output:'Success'}});await collect(root);
 const change=(await readRun(root,'session')).find(x=>x.kind==='file.changed');assert.ok(change);assert.equal(change.evidence,'observed');assert.match(String(change.data.diff),/before/);
 const shell={...common,tool_name:'Bash',tool_use_id:'shell',tool_input:{command:'node update.js'}};
 await captureHook(root,{...shell,hook_event_name:'PreToolUse'});await writeFile(join(root,'card.ts'),'export const label="shell";\n');await captureHook(root,{...shell,hook_event_name:'PostToolUse',tool_response:{exit_code:0}});await collect(root);
 assert.equal((await readRun(root,'session')).filter(x=>x.kind==='file.changed').at(-1)?.evidence,'unknown');
});
test('DSH thinking is discarded, truncated edits never claim attribution',()=>{
 const ctx={runId:'run',sessionId:'ds',taskId:'task',parentTaskId:'parent'};
 assert.deepEqual(normalizeDSH({type:'thinking',text:'private reasoning'},ctx),[]);
 const rows=normalizeDSH({type:'tool_call',tool:'write_file',input:{path:'card.ts',content:'hello'},truncated:true},ctx);
 assert.equal(rows[0].kind,'tool.started');assert.equal(rows[0].evidence,'unknown');
 const msg=normalizeDSH({type:'final',text:'done'},ctx)[0];assert.equal(msg.evidence,'declared');assert.equal(msg.kind,'agent.message');
});
