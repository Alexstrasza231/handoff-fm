import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,appendFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initProject,allEvents,collect,dir} from '../src/store';
import {captureHook} from '../src/hooks';
import {snapshot} from '../src/snapshots';
import {excludedEvidence} from '../src/evidence';
import {readdir,rename} from 'node:fs/promises';
const started=(id:string)=>({type:'event_msg',payload:{type:'task_started',turn_id:id}});
const tokens=(input:number,output=20)=>({type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:input,cached_input_tokens:input/2,cache_write_input_tokens:0,output_tokens:output,reasoning_output_tokens:output/2,total_tokens:input+output}},rate_limits:{secret:'never-store'}}});
test('Codex numeric parser uses turn boundary delta, replaces duplicate samples and marks counter reset partial',async()=>{
 const api=await import('../src/codex-usage').catch(()=>null);assert.ok(api,'Bounded numeric reader must exist');
 const state=api.newNumericState(true);
 api.parseNumericLine(JSON.stringify(tokens(100,20)),state);
 api.parseNumericLine(JSON.stringify(started('turn')),state);
 const first=api.parseNumericLine(JSON.stringify(tokens(180,30)),state)!;
 assert.equal(first.taskId,'turn');assert.equal(first.usage.input,80);assert.equal(first.usage.output,10);assert.equal(first.usage.total,90);
 const dup=api.parseNumericLine(JSON.stringify(tokens(180,30)),state)!;assert.deepEqual(dup,first);
 api.parseNumericLine(JSON.stringify(tokens(10,2)),state);
 const reset=api.parseNumericLine(JSON.stringify(tokens(30,4)),state)!;assert.equal(reset.usage.total,112);assert.equal(reset.usage.coverage,'partial');
 assert.equal(JSON.stringify(state).includes('secret'),false);
});
test('malformed or absent Codex usage preserves prior recorded totals as partial',async()=>{
 const api=await import('../src/codex-usage');const s=api.newNumericState(true);
 api.parseNumericLine(JSON.stringify(started('turn')),s);api.parseNumericLine(JSON.stringify(tokens(100,20)),s);
 const broken=api.parseNumericLine(JSON.stringify({type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:-1,output_tokens:2}}}}),s)!;
 assert.equal(broken.usage.total,120);assert.equal(broken.usage.coverage,'partial');
});
test('large incomplete transcript lines are bounded, discarded text is never checkpointed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hfm-bounded-'));await initProject(root);const path=join(root,'source.jsonl');
 await writeFile(path,JSON.stringify(started('turn'))+'\n'+JSON.stringify(tokens(100))+'\n'+JSON.stringify({type:'response_item',payload:{text:'SECRET-RAW-'+('x'.repeat(700000))}})+'\n'+JSON.stringify(tokens(200,40))+'\n');
 await captureHook(root,{session_id:'session',turn_id:'turn',cwd:root,transcript_path:path,hook_event_name:'UserPromptSubmit'});
 const api=await import('../src/codex-usage');for(let i=0;i<5;i++)await api.pollCodexUsage(root);await collect(root);
 const rows=(await allEvents(root)).filter(e=>e.kind==='usage.recorded');assert.equal(rows.at(-1)?.data.total,240);assert.equal(rows.at(-1)?.data.coverage,'partial');
 for(const name of await readdir(join(dir(root),'usage-sources'))){const text=await readFile(join(dir(root),'usage-sources',name),'utf8');assert.equal(text.includes('SECRET-RAW'),false);assert.ok(text.length<10000);}
});
test('out-of-scope hooks cannot register another transcript',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hfm-scope-'));await initProject(root);
 await captureHook(root,{session_id:'session',turn_id:'turn',cwd:tmpdir(),transcript_path:join(tmpdir(),'other.jsonl'),hook_event_name:'UserPromptSubmit'});
 assert.equal((await readdir(dir(root))).includes('usage-sources'),false);
});
test('registered transcript is excluded from all generic snapshot and tool evidence paths',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hfm-private-'));await initProject(root);const path=join(root,'current.jsonl');
 await writeFile(path,JSON.stringify({type:'response_item',payload:{text:'RAW_REASONING_CANARY'}})+'\n');
 const common={session_id:'session',turn_id:'turn',cwd:root,transcript_path:path};
 await captureHook(root,{...common,hook_event_name:'UserPromptSubmit'});
 await captureHook(root,{...common,hook_event_name:'PreToolUse',tool_name:'read_file',tool_use_id:'read',tool_input:{file_path:path}});
 for(const name of await readdir(join(dir(root),'pending')))assert.equal((await readFile(join(dir(root),'pending',name),'utf8')).includes('RAW_REASONING_CANARY'),false);
 await captureHook(root,{...common,hook_event_name:'PostToolUse',tool_name:'read_file',tool_use_id:'read',tool_input:{file_path:path},tool_response:{text:'RAW_REASONING_CANARY'}});
 await collect(root);assert.equal((await readFile(join(dir(root),'events.jsonl'),'utf8')).includes('RAW_REASONING_CANARY'),false);
});
test('replacing the transcript with identical bytes never counts historical consumption again',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hfm-replace-'));await initProject(root);const path=join(root,'source.jsonl');
 const raw=[tokens(100),started('turn'),tokens(180,30)].map(x=>JSON.stringify(x)).join('\n')+'\n';await writeFile(path,raw);
 await captureHook(root,{session_id:'session',turn_id:'turn',cwd:root,transcript_path:path,hook_event_name:'UserPromptSubmit'});
 const api=await import('../src/codex-usage');await api.pollCodexUsage(root);await collect(root);
 await rename(path,path+'.old');await writeFile(path,raw);await api.pollCodexUsage(root);await collect(root);
 const usage=await import('../src/usage');assert.equal(usage.summarizeUsage(await allEvents(root),{scope:'session'}).total,90);
});
test('simultaneous turn registrations do not lose either permitted task',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hfm-parallel-'));await initProject(root);const path=join(root,'source.jsonl');
 await writeFile(path,[started('a'),tokens(100),started('b'),tokens(200,40)].map(x=>JSON.stringify(x)).join('\n')+'\n');
 const api=await import('../src/codex-usage');await Promise.all(['a','b'].map(turn_id=>api.registerTranscript(root,{session_id:'session',turn_id,transcript_path:path})));
 await api.pollCodexUsage(root);await collect(root);const rows=(await allEvents(root)).filter(e=>e.kind==='usage.recorded');
 assert.deepEqual(new Set(rows.map(e=>e.taskId)),new Set(['a','b']));
});
test('previous transcript paths stay excluded after a source change and metadata failure fails closed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hfm-private-history-'));await initProject(root);
 const api=await import('../src/codex-usage');for(const name of ['old.jsonl','new.jsonl']){
  const path=join(root,name);await writeFile(path,'RAW_REASONING_CANARY');await api.registerTranscript(root,{session_id:'session',turn_id:'turn',transcript_path:path});
 }assert.equal(JSON.stringify(await snapshot(root)).includes('RAW_REASONING_CANARY'),false);assert.equal(await excludedEvidence(root,{path:'old.jsonl'}),true);
 await rename(join(dir(root),'usage-sources'),join(dir(root),'sources-backup'));await writeFile(join(dir(root),'usage-sources'),'unavailable');
 assert.deepEqual(await snapshot(root),{});assert.equal(await excludedEvidence(root,{path:'new.jsonl'}),true);
});
test('replacement boundary switches to its actual new task instead of charging the previous task',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hfm-switch-log-'));await initProject(root);const path=join(root,'source.jsonl');const api=await import('../src/codex-usage');
 await writeFile(path,[tokens(100),started('a'),tokens(180,30)].map(x=>JSON.stringify(x)).join('\n')+'\n');
 await api.registerTranscript(root,{session_id:'session',turn_id:'a',transcript_path:path});await api.pollCodexUsage(root);await collect(root);
 await rename(path,path+'.old');await writeFile(path,[started('b'),tokens(180,30)].map(x=>JSON.stringify(x)).join('\n')+'\n');
 await api.registerTranscript(root,{session_id:'session',turn_id:'b',transcript_path:path});await api.pollCodexUsage(root);await collect(root);
 await appendFile(path,JSON.stringify(tokens(200,40))+'\n');await api.pollCodexUsage(root);await collect(root);
 const rows=(await allEvents(root)).filter(e=>e.kind==='usage.recorded');assert.equal(rows.filter(e=>e.taskId==='a').at(-1)?.data.total,90);assert.equal(rows.at(-1)?.taskId,'b');assert.equal(rows.at(-1)?.data.total,30);
});
test('Codex registration respects project scope, reads incrementally, survives restart/truncation without raw text',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hfm-usage-'));await initProject(root);
 const path=join(root,'transcript.jsonl');
 await writeFile(path,[tokens(100),started('turn'),{type:'response_item',payload:{text:'PRIVATE CHAT AND REASONING'}},tokens(180,30)].map(x=>JSON.stringify(x)).join('\n')+'\n');
 await captureHook(root,{session_id:'session',turn_id:'turn',cwd:root,transcript_path:path,hook_event_name:'UserPromptSubmit',prompt:'Task'});
 const api=await import('../src/codex-usage').catch(()=>null);assert.ok(api);
 await api.pollCodexUsage(root);await collect(root);let rows=(await allEvents(root)).filter(e=>e.kind==='usage.recorded');
 assert.equal(rows.at(-1)?.data.total,90);assert.equal(rows.at(-1)?.taskId,'turn');
 await api.pollCodexUsage(root);await collect(root);assert.equal((await allEvents(root)).filter(e=>e.kind==='usage.recorded').length,rows.length);
 // Simulate a collector process restart by another poll with no in-memory state.
 await appendFile(path,JSON.stringify(tokens(200,40))+'\n');await api.pollCodexUsage(root);await collect(root);
 rows=(await allEvents(root)).filter(e=>e.kind==='usage.recorded');assert.equal(rows.at(-1)?.data.total,120);
 assert.equal((await readFile(join(dir(root),'events.jsonl'),'utf8')).includes('PRIVATE CHAT'),false);
 assert.equal((await readFile(join(dir(root),'events.jsonl'),'utf8')).includes('transcript.jsonl'),false);
 await writeFile(path,[started('turn'),tokens(10,2)].map(x=>JSON.stringify(x)).join('\n')+'\n');
 await api.pollCodexUsage(root);await collect(root);assert.notEqual((await allEvents(root)).filter(e=>e.kind==='usage.recorded').at(-1)?.data.coverage,'complete');
});
test('replacement without a bounded task boundary withholds attribution until an explicit boundary',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hfm-missing-boundary-'));await initProject(root);const path=join(root,'source.jsonl');const api=await import('../src/codex-usage');
 await writeFile(path,[tokens(100),started('a'),tokens(180,30)].map(x=>JSON.stringify(x)).join('\n')+'\n');
 await api.registerTranscript(root,{session_id:'session',turn_id:'a',transcript_path:path});await api.pollCodexUsage(root);await collect(root);
 await rename(path,path+'.old');await writeFile(path,[started('b'),{type:'response_item',payload:{text:'x'.repeat(300*1024)}},tokens(300,40)].map(x=>JSON.stringify(x)).join('\n')+'\n');
 await api.registerTranscript(root,{session_id:'session',turn_id:'b',transcript_path:path});await api.pollCodexUsage(root);
 await appendFile(path,JSON.stringify(tokens(320,50))+'\n');await api.pollCodexUsage(root);await collect(root);
 let rows=(await allEvents(root)).filter(e=>e.kind==='usage.recorded');assert.equal(rows.filter(e=>e.taskId==='a').at(-1)?.data.total,90);assert.equal(rows.some(e=>e.taskId==='b'),false);
 await appendFile(path,[started('b'),tokens(340,60)].map(x=>JSON.stringify(x)).join('\n')+'\n');await api.pollCodexUsage(root);await collect(root);
 rows=(await allEvents(root)).filter(e=>e.kind==='usage.recorded');assert.equal(rows.at(-1)?.taskId,'b');assert.equal(rows.at(-1)?.data.total,30);assert.equal(rows.at(-1)?.data.coverage,'partial');
});
test('unavailable pre or post snapshot never produces additions or deletions from an empty placeholder',async()=>{
 for(const failureAt of ['pre','post']){
  const root=await mkdtemp(join(tmpdir(),'hfm-suppressed-pair-'));await initProject(root);const path=join(root,'source.jsonl'),code=join(root,'code.txt');await writeFile(path,'');await writeFile(code,'before\n');
  const common={session_id:'session',turn_id:'turn',cwd:root,transcript_path:path,tool_name:'apply_patch',tool_use_id:'edit',tool_input:{command:'*** Update File: code.txt'}};
  const folder=join(dir(root),'usage-paths');const {mkdir,rm}=await import('node:fs/promises');
  if(failureAt==='pre')await writeFile(folder,'unavailable');
  await captureHook(root,{...common,hook_event_name:'PreToolUse'});await writeFile(code,'after\n');
  if(failureAt==='pre'){await rm(folder);await mkdir(folder);}else{await rename(folder,folder+'-backup');await writeFile(folder,'unavailable');}
  await captureHook(root,{...common,hook_event_name:'PostToolUse',tool_response:{exit_code:0}});await collect(root);
  const events=await allEvents(root);assert.equal(events.some(e=>e.kind==='file.changed'),false);assert.ok(events.some(e=>e.kind==='recording.gap'));
 }
});
