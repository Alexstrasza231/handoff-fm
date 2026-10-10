import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireCollectorLock } from '../src/collector-lock';

const fixture = async () => join(await fs.mkdtemp(join(tmpdir(), 'hfm-owner-lock-')), 'journal.lock');
const marker = (pid: number) => `owner-${pid}-${randomUUID()}.json`;
async function deadPid() {
 const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
 await new Promise<void>((done, reject) => { child.once('error', reject); child.once('close', () => done()); });
 return child.pid!;
}
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

test('live owner is exclusive even when directory mtime is old; release is idempotent', async () => {
 const lock = await fixture(); const release = await acquireCollectorLock(lock);
 assert.equal(typeof release, 'function');
 const names = await fs.readdir(lock); assert.equal(names.length, 1);
 await fs.utimes(lock, new Date(0), new Date(0));
 assert.equal(await acquireCollectorLock(lock), null, 'mtime never permits stealing a live owner');
 assert.deepEqual(await fs.readdir(lock), names);
 await release!(); await release!();
 await assert.rejects(fs.stat(lock), { code: 'ENOENT' });
});

test('a dead owner is reclaimed without waiting for its directory to age', async () => {
 const lock = await fixture(); await fs.mkdir(lock);
 await fs.writeFile(join(lock, marker(await deadPid())), '{}');
 const release = await acquireCollectorLock(lock); assert.equal(typeof release, 'function');
 assert.equal((await fs.readdir(lock)).length, 1);
 await release!();
});

test('stale empty directory recovers while a fresh incomplete directory stays busy', async () => {
 const lock = await fixture(); await fs.mkdir(lock);
 assert.equal(await acquireCollectorLock(lock), null);
 await fs.utimes(lock, new Date(0), new Date(0));
 const release = await acquireCollectorLock(lock); assert.equal(typeof release, 'function'); await release!();
});

test('unknown directory entries are preserved and never reclaimed', async () => {
 const lock = await fixture(); await fs.mkdir(lock); await fs.writeFile(join(lock, 'unknown.txt'), 'preserve');
 await fs.utimes(lock, new Date(0), new Date(0));
 assert.equal(await acquireCollectorLock(lock), null);
 assert.equal(await fs.readFile(join(lock, 'unknown.txt'), 'utf8'), 'preserve');
});

test('claimant aborts if another live owner appears before its marker is published', async () => {
 const lock = await fixture(); const other = marker(process.pid); let injected = false;
 const release = await acquireCollectorLock(lock, { fs: { ...fs, open: async (path: string, flags: string) => {
  if (!injected) { injected = true; await fs.writeFile(join(lock, other), '{}'); }
  return fs.open(path, flags);
 } } });
 assert.equal(release, null, 'two owners must never admit this claimant');
 assert.deepEqual(await fs.readdir(lock), [other], 'abort removes only its own marker');
});

test('delayed stale reclaimer cannot delete a newly acquired live owner', async () => {
 const lock = await fixture(); await fs.mkdir(lock); await fs.writeFile(join(lock, marker(await deadPid())), '{}');
 const observed = deferred(), resume = deferred(); let paused = false;
 const delayed = acquireCollectorLock(lock, { fs: { ...fs, readdir: async (path: string) => {
  const names = await fs.readdir(path);
  if (!paused) { paused = true; observed.resolve(); await resume.promise; }
  return names;
 } } });
 await observed.promise;
 const fresh = await acquireCollectorLock(lock); assert.equal(typeof fresh, 'function');
 const freshOwner = await fs.readdir(lock); resume.resolve();
 assert.equal(await delayed, null, 'the stale observer may remove only its old exact nonce');
 assert.deepEqual(await fs.readdir(lock), freshOwner);
 assert.equal(await acquireCollectorLock(lock), null, 'fresh owner retains exclusive access');
 await fresh!();
});

test('killing a real lock holder permits recovery without mtime-based theft', { timeout: 15000 }, async () => {
 const lock = await fixture();
 const source = `import {acquireCollectorLock} from ${JSON.stringify(new URL('../src/collector-lock.ts', import.meta.url).href)};
 const release=await acquireCollectorLock(${JSON.stringify(lock)});
 if(!release)throw Error('could not claim');
 process.stdout.write('owned\\n');setInterval(()=>{},1000);`;
 const child = spawn(process.execPath, ['--import','tsx','--input-type=module','-e',source], {stdio:['ignore','pipe','pipe']});
 const exited = new Promise<void>((done,reject)=>{child.once('close',()=>done());child.once('error',reject);});
 try {
  await new Promise<void>((done,reject)=>{
   let output='';child.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('owned\n'))done();});
   child.once('error',reject);child.once('close',()=>reject(Error('holder exited before claiming')));
  });
  await fs.utimes(lock,new Date(0),new Date(0));
  assert.equal(await acquireCollectorLock(lock),null,'a live process is never stolen by age');
  child.kill();await exited;
  const release=await acquireCollectorLock(lock);assert.equal(typeof release,'function');await release!();
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill();await exited;}}
});

test('release preserves unrelated entries and can be retried after Windows sharing failures', async () => {
 const lock=await fixture();let denied=3;
 const release=await acquireCollectorLock(lock,{fs:{...fs,unlink:async(path:string)=>{
  if(denied-->0)throw Object.assign(Error('temporarily busy'),{code:'EPERM'});
  return fs.unlink(path);
 }}});
 assert.equal(typeof release,'function');const owner=await fs.readdir(lock);
 await assert.rejects(release!(),{code:'EBUSY'});assert.deepEqual(await fs.readdir(lock),owner,'failed unlink never discards ownership');
 await fs.writeFile(join(lock,'preserve.txt'),'keep');
 await release!();assert.deepEqual(await fs.readdir(lock),['preserve.txt'],'release never recursively deletes another entry');
});
