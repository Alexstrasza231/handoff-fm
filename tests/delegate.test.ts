import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initProject,collect,readRun,dir} from '../src/store';
import {delegate} from '../src/delegate';
test('real wrapper returns final answer, captures modified files, and ignores thinking events',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fm-delegate '));await initProject(root);
 const fake=join(root,'fake.cjs');await writeFile(fake,`const fs=require('node:fs');process.stdin.resume();process.stdin.on('end',()=>{fs.writeFileSync('card.txt','changed\\n');for(const e of [{type:'session',sessionId:'session-real'},{type:'thinking',text:'hidden-private-reasoning'},{type:'tool_call',callId:'edit',tool:'write',input:{path:'card.txt'}},{type:'tool_result',callId:'edit',status:'completed',result:'done'},{type:'status',phase:'turn_end',reason:{kind:'completed'}},{type:'final',text:'real final answer'}])console.log(JSON.stringify(e));});`);
 const cfg=JSON.parse(await readFile(join(dir(root),'config.json'),'utf8'));
 const command=join(root,process.platform==='win32'?'dsh.cmd':'dsh');
 await writeFile(command,process.platform==='win32'?`@echo off\r\n"${process.execPath}" "${fake}"\r\n`:`#!/bin/sh\nexec "${process.execPath}" "${fake}"\n`,{mode:0o755});
 cfg.dshCommand=command;await writeFile(join(dir(root),'config.json'),JSON.stringify(cfg));const task=join(root,'task.txt');await writeFile(task,'Edit card.');
 assert.equal(await delegate(root,{taskFile:task,title:'controlled wrapper test',parentSession:'run-test'}),0);await collect(root);
 const rows=await readRun(root,'run-test');assert.ok(rows.some(e=>e.kind==='delegate.completed'));assert.ok(rows.some(e=>e.kind==='file.changed'&&e.evidence==='unknown'));
 assert.doesNotMatch(JSON.stringify(rows),/hidden-private-reasoning/);
 assert.equal(rows.find(e=>e.kind==='agent.message')?.data.text,'real final answer');
});
