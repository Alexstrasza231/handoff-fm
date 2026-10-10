import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect, dir, initProject, readRun } from '../src/store';
import { delegate } from '../src/delegate';
import { captureHook } from '../src/hooks';

const tmp = (prefix = 'hfm-delegate-edge-') => mkdtemp(join(tmpdir(), prefix));
const marksDir = (root: string) => join(dir(root), 'dsh-marks');
const markPath = (root: string, name: string) => join(marksDir(root), name);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitForMark(root: string, name: string, timeoutMs = 45_000): Promise<void> {
  const path = markPath(root, name);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await readFile(path).then(() => true, () => false)) return;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for the fake DSH marker ${path}`);
    await sleep(10);
  }
}

async function mark(root: string, name: string): Promise<void> {
  await mkdir(marksDir(root), { recursive: true });
  await writeFile(markPath(root, name), '1');
}

/**
 * Fake `dsh` driver. It follows a JSON scene inside .handoff-fm/dsh-spec.json step by
 * step and publishes each step through marker files, so the test can release the child
 * deterministically instead of racing it. Every wait is bounded; a timeout leaves
 * dsh-error.txt behind and exits nonzero rather than hanging the suite.
 */
const FAKE_DSH = `const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const marks = path.join(root, '.handoff-fm', 'dsh-marks');
fs.mkdirSync(marks, { recursive: true });
const spec = JSON.parse(fs.readFileSync(path.join(root, '.handoff-fm', 'dsh-spec.json'), 'utf8'));
process.stdin.resume();
const sleep = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const limit = spec.stepTimeoutMs || 30000;
function fail(message) { fs.writeFileSync(path.join(marks, 'dsh-error.txt'), message); process.exit(2); }
for (const step of spec.steps) {
  const end = Date.now() + limit;
  if (step.type === 'wait') {
    while (!fs.existsSync(path.join(marks, step.name))) { if (Date.now() > end) fail('timed out waiting for marker ' + step.name); sleep(25); }
  } else if (step.type === 'waitDelegateWindow') {
    const pending = path.join(root, '.handoff-fm', 'pending');
    for (;;) {
      let found = false;
      try { found = fs.readdirSync(pending).some((name) => /^delegate-.*\\.json$/.test(name)); } catch (error) { found = false; }
      if (found) break;
      if (Date.now() > end) fail('the DeepSeek task window marker never appeared');
      sleep(25);
    }
  } else if (step.type === 'mark') {
    fs.writeFileSync(path.join(marks, step.name), '1');
  } else if (step.type === 'write') {
    fs.writeFileSync(path.join(root, step.file), step.content);
  } else if (step.type === 'emit') {
    process.stdout.write(JSON.stringify(step.value) + '\\n');
  } else if (step.type === 'raw') {
    process.stdout.write(step.line + '\\n');
  } else {
    fail('unknown step type ' + step.type);
  }
}
// Never call process.exit() here: it can truncate the piped stdout that the terminal
// events travel over. stdin has already been ended by the caller, so setting the code
// and falling off the end of the script lets stdout drain first.
process.exitCode = spec.exitCode || 0;
`;

type Step =
  | { type: 'wait'; name: string }
  | { type: 'waitDelegateWindow' }
  | { type: 'mark'; name: string }
  | { type: 'write'; file: string; content: string }
  | { type: 'emit'; value: unknown }
  | { type: 'raw'; line: string };

interface SceneSpec { steps: Step[]; exitCode?: number }

async function readSceneError(root: string): Promise<string | undefined> {
  return readFile(join(marksDir(root), 'dsh-error.txt'), 'utf8').catch(() => undefined);
}

/** Install the fake `dsh` wrapper exactly like the existing delegate test does. */
async function installFakeDsh(root: string): Promise<string> {
  const fake = join(dir(root), 'dsh-fake.cjs');
  await writeFile(fake, FAKE_DSH);
  const wrapper = join(dir(root), process.platform === 'win32' ? 'dsh.cmd' : 'dsh');
  await writeFile(
    wrapper,
    process.platform === 'win32'
      ? `@echo off\r\n"${process.execPath}" "${fake}"\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${fake}"\n`,
    { mode: 0o755 },
  );
  const configPath = join(dir(root), 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.dshCommand = wrapper;
  await writeFile(configPath, JSON.stringify(config));
  return wrapper;
}

async function setup(root: string, spec: SceneSpec): Promise<{ task: string }> {
  await initProject(root);
  await mkdir(marksDir(root), { recursive: true });
  await writeFile(join(dir(root), 'dsh-spec.json'), JSON.stringify(spec));
  await installFakeDsh(root);
  const task = join(root, 'task.txt');
  await writeFile(task, 'Apply the requested edit.');
  return { task };
}

/** Run one delegate scene to completion and collect what it recorded. */
async function runScene(spec: SceneSpec) {
  const root = await tmp();
  const { task } = await setup(root, spec);
  const code = await delegate(root, { taskFile: task, title: 'controlled edge scene', parentSession: 'run-edge' });
  assert.equal(await readSceneError(root), undefined, 'the fake DSH finished every scripted step');
  await collect(root);
  return { root, code, rows: await readRun(root, 'run-edge') };
}

/** The terminal sequence a well-behaved run produces, including the answer text. */
const verifiedTerminal = (reason: unknown = { kind: 'completed' }): Step[] => [
  { type: 'emit', value: { type: 'session', sessionId: 'session-ds' } },
  { type: 'emit', value: { type: 'status', phase: 'turn_end', reason } },
  { type: 'emit', value: { type: 'final', text: 'verified answer' } },
];

const patchCommand = (to: string) =>
  `*** Begin Patch\n*** Update File: card.txt\n@@\n-export const label="before";\n+export const label="${to}";\n*** End Patch`;

for(const unavailable of ['pending','objects'])test(`unavailable ${unavailable} storage never blocks a successful delegate`, async()=>{
 const root=await tmp();
 const {task}=await setup(root,{steps:[{type:'write',file:'card.txt',content:'edited'},...verifiedTerminal()]});
 // Replace only this fixture's metadata directory with a regular file.
 await rename(join(dir(root),unavailable),join(dir(root),unavailable+'-backup'));
 await writeFile(join(dir(root),unavailable),'unavailable');
 assert.equal(await delegate(root,{taskFile:task,title:'storage failure',parentSession:'run-storage'}),0);
 assert.equal(await readFile(join(root,'card.txt'),'utf8'),'edited');
 await collect(root);const rows=await readRun(root,'run-storage');
 assert.ok(rows.some(e=>e.kind==='recording.gap'));
 assert.equal(rows.find(e=>e.kind==='delegate.completed')?.data.recordingIncomplete,true);
});

test('metadata recovery cannot attribute a delegate edit to an older Codex window', async()=>{
 const root=await tmp();const {task}=await setup(root,{steps:[{type:'write',file:'card.txt',content:'delegate edit'},...verifiedTerminal()]});
 await writeFile(join(root,'card.txt'),'before');
 const hook={session_id:'run-outage',turn_id:'turn',cwd:root,tool_name:'apply_patch',tool_use_id:'older',tool_input:{command:patchCommand('delegate edit')}};
 await captureHook(root,{...hook,hook_event_name:'PreToolUse'});
 await rename(join(dir(root),'pending'),join(dir(root),'pending-backup'));
 await writeFile(join(dir(root),'pending'),'unavailable');
 assert.equal(await delegate(root,{taskFile:task,title:'outage',parentSession:'run-outage'}),0);
 await rename(join(dir(root),'pending'),join(dir(root),'pending-blocker'));
 await rename(join(dir(root),'pending-backup'),join(dir(root),'pending'));
 await captureHook(root,{...hook,hook_event_name:'PostToolUse',tool_response:{exit_code:0}});
 await collect(root);const rows=await readRun(root,'run-outage');
 const edits=rows.filter(e=>e.kind==='file.changed'&&e.actor==='codex'&&e.data.path==='card.txt');
 assert.ok(edits.length);assert.ok(edits.every(e=>e.evidence==='unknown'));
});

test('a terminal status carrying {kind:"completed"} is the verified success path', { timeout: 120_000 }, async () => {
  const { code, rows } = await runScene({ steps: verifiedTerminal(), exitCode: 0 });
  assert.equal(code, 0);
  const done = rows.find((e) => e.kind === 'delegate.completed');
  assert.ok(done, 'a verified completion is recorded');
  assert.equal(rows.some((e) => e.kind === 'delegate.failed'), false);
  assert.equal(rows.some((e) => e.kind === 'recording.gap'), false, 'a clean stream records no gap');
  assert.equal(done?.data.exitCode, 0);
  assert.equal(done?.data.reason, 'completed');
  assert.equal(done?.data.recordingIncomplete, false);
  assert.equal(rows.find((e) => e.kind === 'agent.message')?.data.text, 'verified answer');
});

test('a nonzero exit is a failure even when the terminal stream is complete', { timeout: 120_000 }, async () => {
  const { code, rows } = await runScene({ steps: verifiedTerminal(), exitCode: 3 });
  assert.equal(code, 1);
  assert.equal(rows.some((e) => e.kind === 'delegate.completed'), false, 'a nonzero exit is never a verified success');
  const failed = rows.find((e) => e.kind === 'delegate.failed');
  assert.ok(failed);
  assert.equal(failed?.data.exitCode, 3);
  assert.equal(failed?.data.reason, 'completed', 'the terminal reason alone cannot override the exit code');
  assert.equal(rows.some((e) => e.kind === 'recording.gap'), false, 'a nonzero exit is reported as a failure, not as a gap');
});

test('exit 0 without a verified terminal records a gap and fails, never an unverified success', { timeout: 180_000 }, async () => {
  // A final answer with no turn_end at all.
  const noTerminal = await runScene({
    steps: [
      { type: 'emit', value: { type: 'session', sessionId: 'session-ds' } },
      { type: 'emit', value: { type: 'final', text: 'unverified answer' } },
    ],
    exitCode: 0,
  });
  assert.equal(noTerminal.code, 1);
  assert.equal(noTerminal.rows.some((e) => e.kind === 'delegate.completed'), false, 'an answer alone is not a verified completion');
  const gap = noTerminal.rows.find((e) => e.kind === 'recording.gap');
  assert.ok(gap, 'the missing terminal is recorded as a gap');
  assert.match(String(gap?.data.message), /terminal event is missing/i);
  assert.equal(noTerminal.rows.find((e) => e.kind === 'delegate.failed')?.data.recordingIncomplete, true);

  // A turn_end with no final answer.
  const noAnswer = await runScene({
    steps: [
      { type: 'emit', value: { type: 'session', sessionId: 'session-ds' } },
      { type: 'emit', value: { type: 'status', phase: 'turn_end', reason: { kind: 'completed' } } },
    ],
    exitCode: 0,
  });
  assert.equal(noAnswer.code, 1);
  assert.equal(noAnswer.rows.some((e) => e.kind === 'delegate.completed'), false, 'a turn_end alone is not a verified completion');
  assert.ok(noAnswer.rows.find((e) => e.kind === 'recording.gap'));
  assert.equal(noAnswer.rows.find((e) => e.kind === 'delegate.failed')?.data.recordingIncomplete, true);
});

test('a terminal turn_end whose reason is not completed is a failure', { timeout: 120_000 }, async () => {
  const { code, rows } = await runScene({ steps: verifiedTerminal({ kind: 'interrupted' }), exitCode: 0 });
  assert.equal(code, 1);
  assert.equal(rows.some((e) => e.kind === 'delegate.completed'), false);
  assert.equal(rows.find((e) => e.kind === 'delegate.failed')?.data.reason, 'interrupted');
  assert.equal(rows.some((e) => e.kind === 'recording.gap'), false, 'a present but non-completed terminal is not a missing terminal');
});

test('a malformed stdout line is recorded as a gap, and success still requires a verified terminal', { timeout: 180_000 }, async () => {
  const malformed = '{"type":"tool_call","callId":';
  // The malformed record is dropped, but the verified terminal still completes the run.
  const tolerated = await runScene({
    steps: [
      { type: 'emit', value: { type: 'session', sessionId: 'session-ds' } },
      { type: 'raw', line: malformed },
      ...verifiedTerminal(),
    ],
    exitCode: 0,
  });
  assert.equal(tolerated.code, 0, 'a verified terminal still succeeds');
  const done = tolerated.rows.find((e) => e.kind === 'delegate.completed');
  assert.ok(done, 'the verified terminal is recorded');
  assert.equal(done?.data.recordingIncomplete, true, 'the dropped line is flagged on the terminal record');
  assert.match(String(tolerated.rows.find((e) => e.kind === 'recording.gap')?.data.message), /Invalid DeepSeek event/i);
  assert.ok(!(await readFile(join(dir(tolerated.root), 'events.jsonl'), 'utf8')).includes(malformed), 'the malformed payload is never persisted');

  // The same malformed line without a verified terminal must not become a success.
  const unverified = await runScene({
    steps: [
      { type: 'emit', value: { type: 'session', sessionId: 'session-ds' } },
      { type: 'raw', line: 'not json at all' },
      { type: 'emit', value: { type: 'final', text: 'unverified answer' } },
    ],
    exitCode: 0,
  });
  assert.equal(unverified.code, 1);
  assert.equal(unverified.rows.some((e) => e.kind === 'delegate.completed'), false, 'a gap plus an answer is still not a verified success');
  assert.ok(unverified.rows.find((e) => e.kind === 'recording.gap'));
  assert.equal(unverified.rows.find((e) => e.kind === 'delegate.failed')?.data.recordingIncomplete, true);
});

test('an open DeepSeek task window keeps a simultaneously captured Codex apply_patch unknown, even before DeepSeek emits any tool_call', { timeout: 120_000 }, async () => {
  const root = await tmp();
  const { task } = await setup(root, {
    steps: [
      { type: 'waitDelegateWindow' },
      { type: 'mark', name: 'window-seen' },
      { type: 'wait', name: 'hook-pre' },
      // The external DSH process changes the file without announcing it on stdout yet.
      { type: 'write', file: 'card.txt', content: 'export const label="deepseek";\n' },
      { type: 'mark', name: 'ds-wrote' },
      { type: 'wait', name: 'hook-post' },
      { type: 'emit', value: { type: 'session', sessionId: 'session-ds' } },
      { type: 'emit', value: { type: 'tool_call', callId: 'ds-edit', tool: 'write', input: { path: 'card.txt' } } },
      { type: 'emit', value: { type: 'tool_result', callId: 'ds-edit', status: 'completed', result: 'done' } },
      { type: 'emit', value: { type: 'status', phase: 'turn_end', reason: { kind: 'completed' } } },
      { type: 'emit', value: { type: 'final', text: 'deepseek final answer' } },
    ],
    exitCode: 0,
  });
  await writeFile(join(root, 'card.txt'), 'export const label="before";\n');

  const running = delegate(root, { taskFile: task, title: 'overlapping task window', parentSession: 'run-edge' });
  await waitForMark(root, 'window-seen');
  assert.ok(
    (await readdir(join(dir(root), 'pending'))).some((name) => /^delegate-.*\.json$/.test(name)),
    'the DeepSeek task window marker is open before the Codex hook runs',
  );

  const base = { session_id: 'session-codex', turn_id: 'turn-1', cwd: root, tool_name: 'apply_patch', model: 'model-x', tool_use_id: 'edit-1' };
  const toolInput = { command: patchCommand('deepseek') };
  await captureHook(root, { ...base, tool_input: toolInput, hook_event_name: 'PreToolUse' });
  await mark(root, 'hook-pre');
  await waitForMark(root, 'ds-wrote');

  // The change is already on disk; the DeepSeek stream has still emitted nothing.
  const pending = await readdir(join(dir(root), 'pending'));
  assert.ok(pending.some((name) => /^delegate-.*\.json$/.test(name)), 'the DeepSeek window marker is still open at attribution time');
  await captureHook(root, { ...base, tool_input: toolInput, tool_response: { output: 'Success' }, hook_event_name: 'PostToolUse' });
  await mark(root, 'hook-post');

  const exited = await running;
  const sceneError = await readSceneError(root);
  assert.equal(sceneError, undefined, `the fake DSH failed to finish its scene (delegate exited ${exited}): ${sceneError}`);
  assert.equal(exited, 0, 'the DeepSeek side completes normally');
  await collect(root);

  const codex = await readRun(root, 'session-codex');
  const change = codex.find((e) => e.kind === 'file.changed' && e.data.callId === 'edit-1');
  assert.ok(change, 'the Codex hook still reports the change it observed');
  assert.equal(change?.evidence, 'unknown', 'a change captured while a DeepSeek task window is open must not be attributed as observed');
  assert.match(String(change?.data.reason), /unknown/i);
  assert.equal(codex.some((e) => e.kind === 'file.changed' && e.evidence === 'observed'), false, 'no Codex record claims observed attribution during the overlap');

  // The DeepSeek side keeps its own candidate, also without claiming certainty.
  const deepseek = await readRun(root, 'run-edge');
  assert.ok(deepseek.some((e) => e.kind === 'delegate.completed'), 'the DeepSeek run still completes');
  const dsChange = deepseek.find((e) => e.kind === 'file.changed' && e.data.path === 'card.txt');
  assert.ok(dsChange, 'the DeepSeek side retains the overlapping change as a candidate');
  assert.equal(dsChange?.evidence, 'unknown');
});

test('control: an isolated apply_patch with no task window is still attributed as observed', { timeout: 120_000 }, async () => {
  const root = await tmp();
  await initProject(root);
  await writeFile(join(root, 'card.txt'), 'export const label="before";\n');
  const base = { session_id: 'session-codex', turn_id: 'turn-1', cwd: root, tool_name: 'apply_patch', model: 'model-x', tool_use_id: 'edit-control' };
  const toolInput = { command: patchCommand('codex') };

  await captureHook(root, { ...base, tool_input: toolInput, hook_event_name: 'PreToolUse' });
  await writeFile(join(root, 'card.txt'), 'export const label="codex";\n');
  await captureHook(root, { ...base, tool_input: toolInput, tool_response: { output: 'Success' }, hook_event_name: 'PostToolUse' });
  await collect(root);

  const rows = await readRun(root, 'session-codex');
  const change = rows.find((e) => e.kind === 'file.changed');
  assert.ok(change, 'the isolated edit reports its change');
  assert.equal(change?.evidence, 'observed', 'an explicit isolated edit keeps observed attribution, so the overlap test is not vacuous');
  assert.equal(rows.some((e) => e.kind === 'recording.gap'), false);
});
