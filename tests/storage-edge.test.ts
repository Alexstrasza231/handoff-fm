import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, symlink,utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject, enqueue, collect, allEvents, readRun, validEvent, dir } from '../src/store';
import { snapshot } from '../src/snapshots';
import { captureHook } from '../src/hooks';
import type { FMEvent } from '../src/types';

const tmp = (prefix = 'hfm-edge-') => mkdtemp(join(tmpdir(), prefix));
const readLog = (root: string) => readFile(join(dir(root), 'events.jsonl'), 'utf8').catch(() => '');
const logLines = (text: string) => text.split('\n').filter(Boolean);
const makeEvent = (over: Partial<FMEvent> & { id: string }): FMEvent => ({
  version: 1, runId: 'run', actor: 'codex', kind: 'tool.started', at: new Date().toISOString(),
  sessionId: 'session', evidence: 'observed', data: {}, ...over,
});
/** Drop a raw record straight into the inbox, bypassing the enqueue validator. */
const dropInbox = async (root: string, name: string, body: string) => {
  await writeFile(join(dir(root), 'inbox', name), body);
};

test('collector repairs an uncommitted trailing JSONL fragment and records a gap', async () => {
  const root = await tmp();
  await initProject(root);
  await enqueue(root, makeEvent({ id: 'committed-one' }));
  await collect(root);
  assert.equal((await readRun(root, 'run')).length, 1);

  // A crash between the append and the newline can leave a torn record with no
  // terminator. Readers must ignore it, and the collector must repair the log.
  const fragment = '{"version":1,"id":"torn-record","runId":"run","actor":"codex","kin';
  await writeFile(join(dir(root), 'events.jsonl'), fragment, { flag: 'a' });

  const visible = await allEvents(root);
  assert.deepEqual(visible.map(e => e.id), ['committed-one'], 'a torn tail is never parsed');

  await enqueue(root, makeEvent({ id: 'after-repair' }));
  const collected = await collect(root);
  assert.ok(collected.some(e => e.id === 'after-repair'), 'a good record after the torn tail is still collected');

  const raw = await readLog(root);
  assert.ok(raw.endsWith('\n'), 'the repaired log ends on a record boundary');
  assert.ok(!raw.includes('torn-record'), 'the uncommitted fragment is discarded, never committed as a partial line');
  for (const line of logLines(raw)) assert.doesNotThrow(() => JSON.parse(line), `every committed line is valid JSON: ${line}`);

  const rows = await allEvents(root);
  assert.equal(rows.filter(e => e.id === 'committed-one').length, 1);
  const gap = rows.find(e => e.kind === 'recording.gap');
  assert.ok(gap, 'discarding a torn record is recorded as a recording.gap');
  assert.equal(gap?.actor, 'system');
  assert.equal(gap?.evidence, 'unknown');
  assert.equal(rows.filter(e => e.kind === 'recording.gap').length, 1, 'the repair is recorded exactly once');
});

test('duplicate producer deliveries are committed once and are not a gap', async () => {
  const root = await tmp();
  await initProject(root);
  const original = makeEvent({ id: 'dup-event', data: { tool: 'Bash' } });

  // Re-delivery while the first copy is still queued in the inbox.
  await enqueue(root, original);
  await enqueue(root, original);
  const first = await collect(root);
  assert.deepEqual(first.map(e => e.id), ['dup-event'], 'the first copy wins and the duplicate is dropped');
  assert.equal(first[0]?.seq, 1);

  // Re-delivery after the record was committed (producer retry across a restart).
  await enqueue(root, original);
  const second = await collect(root);
  assert.deepEqual(second, [], 'an already-committed id is not re-committed');

  const rows = await readRun(root, 'run');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.data.tool, 'Bash');
  assert.equal(rows.some(e => e.kind === 'recording.gap'), false, 'deduplication is not data loss');
  assert.deepEqual((await readdir(join(dir(root), 'inbox'))).filter(n => n.endsWith('.json')), []);
});

test('malicious and invalid inbox records are quarantined with one recorded gap', async () => {
  const root = await tmp();
  await initProject(root);
  await enqueue(root, makeEvent({ id: 'good-event' }));

  const base = makeEvent({ id: 'placeholder' });
  const invalid: Array<{ name: string; body: string; why: string }> = [
    { name: '0000000000001-garbage.json', body: 'not json at all {{{', why: 'unparseable' },
    { name: '0000000000002-version.json', body: JSON.stringify({ ...base, version: 2 }), why: 'unsupported version' },
    { name: '0000000000003-kind.json', body: JSON.stringify({ ...base, kind: 'shell.exec' }), why: 'unknown kind' },
    { name: '0000000000004-traversal.json', body: JSON.stringify({ ...base, id: '../../escape' }), why: 'unsafe id' },
    { name: '0000000000005-array.json', body: JSON.stringify({ ...base, data: ['x'] }), why: 'non-object data' },
    { name: '0000000000006-date.json', body: JSON.stringify({ ...base, at: 'definitely-not-a-date' }), why: 'unparseable timestamp' },
    { name: '0000000000007-actor.json', body: JSON.stringify({ ...base, actor: 'root' }), why: 'unknown actor' },
    { name: '0000000000008-longid.json', body: JSON.stringify({ ...base, id: 'a'.repeat(200) }), why: 'oversized id' },
  ];
  for (const record of invalid) {
    // The validator must reject these before they ever reach the collector.
    let parsed: unknown;
    try { parsed = JSON.parse(record.body); } catch { parsed = undefined; }
    if (parsed !== undefined) assert.equal(validEvent(parsed as FMEvent), false, `rejected: ${record.why}`);
    await dropInbox(root, record.name, record.body);
  }
  // Structurally valid but over the collector's 1 MiB ceiling.
  const oversized = JSON.stringify({ ...base, id: 'oversized', data: { blob: 'x'.repeat(1024 * 1024 + 16) } });
  await dropInbox(root, '0000000000009-oversized.json', oversized);

  const out = await collect(root);
  assert.ok(out.some(e => e.id === 'good-event'), 'a valid record in the same batch is still collected');
  assert.equal(out.filter(e => e.kind === 'recording.gap').length, 1, 'a batch of bad records yields exactly one gap');
  assert.equal(out.find(e => e.kind === 'recording.gap')?.runId, 'run', 'the gap is attributed to the run being recorded');

  const raw = await readLog(root);
  for (const line of logLines(raw)) assert.doesNotThrow(() => JSON.parse(line));
  assert.ok(!raw.includes('not json at all'), 'garbage never reaches the durable log');
  assert.ok(!raw.includes('shell.exec'), 'an unknown kind never reaches the durable log');
  assert.ok(!raw.includes('../../escape'), 'a traversal-shaped id never reaches the durable log');
  assert.equal((await allEvents(root)).some(e => e.id === 'oversized'), false);

  const quarantined = (await readdir(join(dir(root), 'quarantine'))).filter(n => n.endsWith('.json')).sort();
  assert.deepEqual(quarantined, [...invalid.map(r => r.name), '0000000000009-oversized.json'].sort(), 'every bad record is preserved for review');
  assert.equal(await readFile(join(dir(root), 'quarantine', '0000000000001-garbage.json'), 'utf8'), 'not json at all {{{');
  assert.deepEqual((await readdir(join(dir(root), 'inbox'))).filter(n => n.endsWith('.json')), []);
});

test('concurrent collectors commit every event exactly once with contiguous sequence numbers', async () => {
  const root = await tmp();
  await initProject(root);
  const ids = Array.from({ length: 25 }, (_, i) => `concurrent-${String(i).padStart(2, '0')}`);
  for (const id of ids) await enqueue(root, makeEvent({ id, data: { id } }));

  const results = await Promise.all([collect(root), collect(root), collect(root), collect(root)]);
  const handedOut = results.flat().map(e => e.id);
  assert.equal(new Set(handedOut).size, handedOut.length, 'no event is handed to two collectors');

  const rows = await allEvents(root);
  assert.deepEqual(rows.map(e => e.id).sort(), [...ids].sort());
  assert.deepEqual(rows.map(e => e.seq), ids.map((_, i) => i + 1), 'sequence numbers are dense and unique');
  assert.equal(rows.some(e => e.kind === 'recording.gap'), false);
  assert.deepEqual((await readdir(join(dir(root), 'inbox'))).filter(n => n.endsWith('.json')), []);
  assert.equal(logLines(await readLog(root)).length, ids.length);
});

test('a stale lease left by a killed process is reclaimed', async () => {
  const root = await tmp();
  await initProject(root);
  const lock = join(dir(root), 'journal.lock');
  await mkdir(lock);const old=new Date(Date.now()-20000);await utimes(lock,old,old);
  await enqueue(root, makeEvent({ id: 'after-stale-lock' }));

  const out = await collect(root);
  assert.ok(out.some(e => e.id === 'after-stale-lock'), 'a dead holder does not block collection forever');
  await assert.rejects(readdir(lock), { code: 'ENOENT' }, 'the reclaimed lock is released');
});

test('an incomplete empty lock directory recovers after its lease', async () => {
  const root = await tmp();
  await initProject(root);
  const lock = join(dir(root), 'journal.lock');
  // A crash between `open(..., 'wx')` and the pid write leaves exactly this.
  await mkdir(lock);const old=new Date(Date.now()-20000);await utimes(lock,old,old);
  await enqueue(root, makeEvent({ id: 'after-empty-lock' }));

  const out = await collect(root);
  assert.ok(out.some(e => e.id === 'after-empty-lock'), 'an empty lock is stale, not an active collector');
  await assert.rejects(readdir(lock), { code: 'ENOENT' }, 'the stale lock is released');
});

test('a fresh active lock lease is never stolen', async () => {
  const root = await tmp();
  await initProject(root);
  await mkdir(join(dir(root), 'journal.lock'));
  await enqueue(root, makeEvent({ id: 'after-corrupt-lock' }));

  const out = await collect(root);
  assert.deepEqual(out,[], 'a live lease prevents another collector from writing');
});

test('snapshots exclude private, dependency, binary, oversized and linked files', async (t) => {
  const root = await tmp();
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
  await mkdir(join(root, 'dist'), { recursive: true });
  await mkdir(join(root, '.git'), { recursive: true });
  await mkdir(join(root, '.work'), { recursive: true });
  await mkdir(join(root, '.handoff-fm', 'objects'), { recursive: true });
  await mkdir(join(root, 'coverage'), { recursive: true });

  await writeFile(join(root, 'src', 'app.ts'), 'export const app = 1;\n');
  await writeFile(join(root, 'notes.md'), 'hello\n');
  await writeFile(join(root, '.env'), 'API_KEY=sk-abcdefghijklmnopqrstuvwxyz\n');
  await writeFile(join(root, 'credentials.json'), '{"token":"credential-secret"}\n');
  await writeFile(join(root, 'id_rsa'), 'PRIVATE-KEY-MATERIAL\n');
  await writeFile(join(root, 'server.pem'), 'PRIVATE-KEY-MATERIAL\n');
  await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;\n');
  await writeFile(join(root, 'dist', 'bundle.js'), 'bundled;\n');
  await writeFile(join(root, 'coverage', 'lcov.info'), 'coverage;\n');
  await writeFile(join(root, '.git', 'config'), '[core]\n');
  await writeFile(join(root, '.work', 'notes.md'), 'internal;\n');
  await writeFile(join(root, '.handoff-fm', 'objects', 'blob.txt'), 'internal;\n');
  await writeFile(join(root, 'image.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));
  await writeFile(join(root, 'latin.ts'), Buffer.from([0xff, 0xfe, 0x61, 0x62, 0x63])); // invalid UTF-8, no NUL
  await writeFile(join(root, 'big.txt'), 'x'.repeat(1024 * 1024 + 1));

  // A link must never be followed; this account may not be allowed to create one.
  const outside = await tmp('hfm-outside-');
  await writeFile(join(outside, 'secret.txt'), 'OUTSIDE-SECRET\n');
  let linked = false;
  try {
    await symlink(join(outside, 'secret.txt'), join(root, 'linked.ts'), 'file');
    linked = true;
  } catch {
    t.diagnostic('file symlink creation unavailable (EPERM); link exclusion covered by the directory-link test');
  }

  const snap = await snapshot(root);
  assert.deepEqual(Object.keys(snap).sort(), ['notes.md', 'src/app.ts'], `unexpected snapshot entries: ${Object.keys(snap).sort().join(', ')}`);
  if (linked) assert.ok(!('linked.ts' in snap), 'a symlink is not read');

  const dump = JSON.stringify(snap);
  for (const secret of ['sk-abcdefghijklmnopqrstuvwxyz', 'credential-secret', 'PRIVATE-KEY-MATERIAL', 'OUTSIDE-SECRET', 'module.exports', 'bundled;', 'coverage;', '[core]', 'internal;']) {
    assert.ok(!dump.includes(secret), `snapshot leaked excluded content: ${secret}`);
  }
});

test('a directory link pointing outside the project is not followed into the snapshot', async (t) => {
  const root = await tmp();
  const outside = await tmp('hfm-outside-');
  await writeFile(join(outside, 'secret.txt'), 'OUTSIDE-DIR-SECRET\n');
  await writeFile(join(root, 'inside.txt'), 'inside\n');
  try {
    // A Windows junction needs no elevation; a POSIX dir symlink is created directly.
    await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    t.skip('directory links are unavailable in this environment');
    return;
  }

  const snap = await snapshot(root);
  assert.deepEqual(Object.keys(snap).sort(), ['inside.txt'], 'content reachable only through a directory link is not snapshotted');
  assert.ok(!JSON.stringify(snap).includes('OUTSIDE-DIR-SECRET'));
});

test('simultaneous hook edits stay unknown', async () => {
  const root = await tmp();
  await initProject(root);
  const target = join(root, 'card.ts');
  await writeFile(target, 'export const label="before";\n');
  const base = { session_id: 'session', turn_id: 'turn', cwd: root, tool_name: 'apply_patch', model: 'm' };
  const patch = (label: string) => ({
    command: `*** Begin Patch\n*** Update File: card.ts\n@@\n-export const label="before";\n+export const label="${label}";\n*** End Patch`,
  });

  // Both PreToolUse hook events fire before either PostToolUse.
  await captureHook(root, { ...base, tool_use_id: 'edit-a', tool_input: patch('a'), hook_event_name: 'PreToolUse' });
  await captureHook(root, { ...base, tool_use_id: 'edit-b', tool_input: patch('b'), hook_event_name: 'PreToolUse' });
  await writeFile(target, 'export const label="a";\n');
  await captureHook(root, { ...base, tool_use_id: 'edit-a', tool_input: patch('a'), hook_event_name: 'PostToolUse', tool_response: { output: 'Success' } });
  await captureHook(root, { ...base, tool_use_id: 'edit-b', tool_input: patch('b'), hook_event_name: 'PostToolUse', tool_response: { output: 'Success' } });
  await collect(root);

  const changes = (await readRun(root, 'session')).filter(e => e.kind === 'file.changed');
  assert.ok(changes.length >= 2, `both overlapping calls should report their change, saw ${changes.length}`);
  for (const change of changes) {
    assert.equal(change.evidence, 'unknown', `overlapping edit ${String(change.data.callId)} must not claim authorship`);
    assert.match(String(change.data.reason), /unknown/i);
  }
  assert.equal(changes.some(e => e.evidence === 'observed'), false);
});

test('an edit that finishes after an overlapping sibling stays unknown', async () => {
  const root = await tmp();
  await initProject(root);
  const target = join(root, 'card.ts');
  await writeFile(target, 'export const label="before";\n');
  const base = { session_id: 'session', turn_id: 'turn', cwd: root, tool_name: 'apply_patch', model: 'm' };
  const patch = (from: string, to: string) => ({
    command: `*** Begin Patch\n*** Update File: card.ts\n@@\n-export const label="${from}";\n+export const label="${to}";\n*** End Patch`,
  });

  // edit-c starts first, edit-d starts second; edit-d finishes first.
  await captureHook(root, { ...base, tool_use_id: 'edit-c', tool_input: patch('before', 'c'), hook_event_name: 'PreToolUse' });
  await captureHook(root, { ...base, tool_use_id: 'edit-d', tool_input: patch('before', 'd'), hook_event_name: 'PreToolUse' });
  await writeFile(target, 'export const label="d";\n');
  await captureHook(root, { ...base, tool_use_id: 'edit-d', tool_input: patch('before', 'd'), hook_event_name: 'PostToolUse', tool_response: { output: 'Success' } });
  await captureHook(root, { ...base, tool_use_id: 'edit-c', tool_input: patch('before', 'c'), hook_event_name: 'PostToolUse', tool_response: { output: 'Success' } });
  await collect(root);

  const changes = (await readRun(root, 'session')).filter(e => e.kind === 'file.changed');
  const late = changes.find(e => e.data.callId === 'edit-c');
  assert.ok(late, 'the late-finishing edit reports its change');
  assert.equal(late?.evidence, 'unknown', 'an edit overlapping a sibling must stay unknown even when the sibling finished first');
});
