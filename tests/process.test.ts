import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {commandSpec} from '../src/process';
test('Windows batch paths with spaces are launched without extra argv escaping', {skip:process.platform!=='win32'},async()=>{
 const folder=await mkdtemp(join(tmpdir(),'fm batch '));const path=join(folder,'fake dsh.cmd');
 await writeFile(path,'@echo off\r\necho %1 %2\r\n');
 const s=commandSpec(path,['headless','--help']);const r=spawnSync(s.command,s.args,{...s.options,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/headless --help/);
});
test('Windows wrapper rejects shell metacharacters and unsafe session arguments',()=>{
 assert.throws(()=>commandSpec('dsh.cmd',['--session-id','abc&echo dangerous'],'win32'));
 assert.throws(()=>commandSpec('bad%PATH%.cmd',['--help'],'win32'));
});
