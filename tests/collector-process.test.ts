import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allEvents, collect, dir, enqueue, initProject, readRun } from '../src/store';
import type { FMEvent } from '../src/types';

// These tests exercise the real collector in separate OS processes, not Promise.all()
// inside one process: a single process shares the in-memory per-root queue in store.ts,
// so only separate processes can show whether the on-disk lease really serializes them.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const storeUrl = pathToFileURL(join(repoRoot, 'src', 'store.ts')).href;
const RESULT = 'HFM_COLLECT_RESULT ';

const tmp = (prefix = 'hfm-proc-') => mkdtemp(join(tmpdir(), prefix));
const marksDir = (root: string) => join(dir(root), 'proc-marks');
const markPath = (root: string, name: string) => join(marksDir(root), name);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const readLog = (root: string) => readFile(join(dir(root), 'events.jsonl'), 'utf8').catch(() => '');
const queuedIds = (root: string) => readdir(join(dir(root), 'inbox')).then((names) => names.filter((n) => n.endsWith('.json')));
const queuedEvent = (id: string): FMEvent => ({
  version: 1, id, runId: 'run', actor: 'codex', kind: 'tool.started',
  at: new Date().toISOString(), sessionId: 'session', evidence: 'observed', data: { id },
});

interface ChildOutcome {
  code: number | null;
  pid: number;
  stdout: string;
  stderr: string;
  /** Records the child was handed, or undefined when it reported a collector error. */
  events?: Array<{ id: string; seq: number }>;
  /** A collector failure reported by the child instead of an uncaught crash. */
  error?: { code?: string; message: string };
}

/**
 * The child runs the real collector in its own process. It reports what it was handed
 * (or the collector error) instead of crashing, so a lease-release failure cannot be
 * mistaken for a hang or for "handed nothing". Children park on a file barrier so the
 * collectors genuinely contend instead of starting one after another.
 */
function collectorChildSource(root: string, label: string): string {
  return `import { collect } from ${JSON.stringify(storeUrl)};
import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const root = ${JSON.stringify(root)};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const marks = join(root, '.handoff-fm', 'proc-marks');
await writeFile(join(marks, 'ready-${label}'), String(process.pid));
for (let i = 0; i < 12000; i++) { try { await access(join(marks, 'start')); break; } catch { await sleep(5); } }
try {
  const events = await collect(root);
  console.log(${JSON.stringify(RESULT)} + JSON.stringify({ pid: process.pid, events: events.map((e) => ({ id: e.id, seq: e.seq })) }));
} catch (error) {
  console.log(${JSON.stringify(RESULT)} + JSON.stringify({ pid: process.pid, error: { code: error && error.code, message: String((error && error.message) || error) } }));
}`;
}

function spawnCollector(root: string, label: string) {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', collectorChildSource(root, label)],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
  const done = new Promise<ChildOutcome>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      const line = stdout.split('\n').filter((l) => l.startsWith(RESULT)).at(-1);
      let reported: { pid?: number; events?: ChildOutcome['events']; error?: ChildOutcome['error'] } | undefined;
      if (line) { try { reported = JSON.parse(line.slice(RESULT.length)); } catch { reported = undefined; } }
      resolve({ code, pid: child.pid ?? -1, stdout, stderr, events: reported?.events, error: reported?.error });
    });
  });
  return { child, done, label };
}

async function waitForMark(root: string, name: string, timeoutMs = 60_000): Promise<void> {
  const path = markPath(root, name);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await access(path).then(() => true, () => false)) return;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${path}`);
    await sleep(10);
  }
}

/** Open the barrier only once every child has reached it, so all collectors start together. */
async function openGate(root: string, kids: Array<ReturnType<typeof spawnCollector>>, labels: string[]): Promise<void> {
  await Promise.all(kids.map(async (kid, index) => {
    const label = labels[index];
    const exited = kid.done.then((outcome) => outcome, () => undefined);
    const outcome = await Promise.race([
      waitForMark(root, `ready-${label}`).then(() => undefined),
      exited,
    ]);
    if (outcome) {
      throw new Error(`collector child ${label} exited (${outcome.code}) before joining the barrier: ${outcome.stderr || outcome.stdout}`);
    }
  }));
  await writeFile(markPath(root, 'start'), 'go');
}

function assertChildReported(outcome: ChildOutcome): void {
  assert.equal(outcome.code, 0, `collector child exited ${outcome.code}: ${outcome.stderr}`);
  assert.ok(
    outcome.events !== undefined || outcome.error !== undefined,
    `collector child produced no result line at all: ${outcome.stderr || outcome.stdout}`,
  );
}

/**
 * store.ts holds a 10s directory lease. A collector that commits and then cannot delete
 * the directory (a transient EPERM/EBUSY on Windows while another process touches it)
 * leaves that lease behind, and the next collector must respect it until it expires.
 * Wait for the lease to be either gone or genuinely stale, so a following drain is
 * testing the collector rather than the recycling of a lease nobody removed.
 */
async function settleLease(root: string): Promise<void> {
  const lock = join(dir(root), 'journal.lock');
  const deadline = Date.now() + 25_000;
  for (;;) {
    const held = await stat(lock).catch(() => undefined);
    if (!held) return;
    if (Date.now() - held.mtimeMs > 10_500) return;
    if (Date.now() > deadline) throw new Error(`the collector lease ${lock} was neither released nor allowed to expire`);
    await sleep(100);
  }
}

/** Durable-log invariants: every id exactly once, dense unique seq, no gap, inbox drained. */
async function assertDurableExactlyOnce(root: string, ids: string[]): Promise<FMEvent[]> {
  const rows = await allEvents(root);
  assert.deepEqual(rows.map((e) => e.id).sort(), [...ids].sort(), 'the durable log holds every queued id exactly once');
  const seqs = rows.map((e) => e.seq).slice().sort((a, b) => (a ?? 0) - (b ?? 0));
  assert.deepEqual(seqs, ids.map((_, i) => i + 1), 'sequence numbers are unique and contiguous');
  assert.equal(rows.some((e) => e.kind === 'recording.gap'), false, 'lock contention is not a recording gap');
  for (const line of (await readLog(root)).split('\n').filter(Boolean)) {
    assert.doesNotThrow(() => JSON.parse(line), 'every committed line is complete JSON');
  }
  assert.deepEqual(await queuedIds(root), [], 'the inbox is fully drained');
  return rows;
}

test('competing child processes commit repeated producer IDs exactly once, and a restart drain recommits nothing', { timeout: 180_000 }, async () => {
  const root = await tmp();
  await initProject(root);
  const ids = ['proc-a', 'proc-b', 'proc-c', 'proc-d', 'proc-e', 'proc-f', 'proc-g', 'proc-h'];
  // Every id is delivered twice; both copies must collapse into one durable record.
  for (const id of ids) { await enqueue(root, queuedEvent(id)); await enqueue(root, queuedEvent(id)); }
  assert.equal((await queuedIds(root)).length, ids.length * 2, 'both copies are queued before the race');

  await mkdir(marksDir(root), { recursive: true });
  const labels = ['p0', 'p1', 'p2', 'p3'];
  const kids = labels.map((label) => spawnCollector(root, label));
  await openGate(root, kids, labels);
  const outcomes = await Promise.all(kids.map((k) => k.done));
  for (const outcome of outcomes) assertChildReported(outcome);
  assert.equal(new Set(outcomes.map((o) => o.pid)).size, labels.length, 'each collector ran in its own OS process');

  const handed = outcomes.flatMap((o) => o.events ?? []);
  assert.equal(new Set(handed.map((e) => e.id)).size, handed.length, 'no record is handed to two collectors');
  const rows = await assertDurableExactlyOnce(root, ids);
  const seqById = new Map(rows.map((e) => [e.id, e.seq]));
  for (const handedOut of handed) {
    assert.equal(seqById.get(handedOut.id), handedOut.seq, `record ${handedOut.id} reported by a child is the record in the durable log`);
  }
  if (handed.length !== ids.length) {
    // A collector that commits and then fails to remove its lease reports an error instead
    // of the records it wrote; the durable log above stays the authority for exactly-once.
    assert.ok(outcomes.some((o) => o.error), 'a short hand-off must be explained by a reported collector error');
  }

  // Restart: a brand-new process drains one re-delivered id and one genuinely new event.
  await settleLease(root);
  await enqueue(root, queuedEvent('proc-a'));
  await enqueue(root, queuedEvent('proc-restart'));
  const drain = spawnCollector(root, 'restart');
  const drained = await drain.done;
  assertChildReported(drained);
  if (drained.events) assert.deepEqual(drained.events.map((e) => e.id), ['proc-restart'], 'the repeated id is not handed out again');

  const after = await allEvents(root);
  assert.equal(after.length, ids.length + 1, 'restarting a collector neither loses nor duplicates records');
  assert.deepEqual(
    after.map((e) => e.seq).slice().sort((a, b) => (a ?? 0) - (b ?? 0)),
    Array.from({ length: ids.length + 1 }, (_, i) => i + 1),
    'the sequence continues densely across the restart',
  );
  assert.equal(after.filter((e) => e.id === 'proc-a').length, 1, 'the id that was re-delivered before the restart stays committed once');
  assert.equal(after.find((e) => e.id === 'proc-restart')?.seq, ids.length + 1, 'the new record takes the next sequence number');
  assert.deepEqual(await queuedIds(root), []);
});

test('competing child processes reclaim an expired directory lease without losing or duplicating a record', { timeout: 180_000 }, async (t) => {
  const root = await tmp();
  await initProject(root);
  const ids = ['lease-1', 'lease-2', 'lease-3', 'lease-4', 'lease-5'];
  for (const id of ids) await enqueue(root, queuedEvent(id));

  // A collector killed mid-run leaves exactly this behind: a lock directory whose mtime
  // stops being renewed. Every competing process now sees the same stale lease.
  const lock = join(dir(root), 'journal.lock');
  await mkdir(lock);
  const expired = new Date(Date.now() - 30_000);
  await utimes(lock, expired, expired);
  assert.ok(Date.now() - (await stat(lock)).mtimeMs > 10_000, 'the lease under test is genuinely past the 10s stale window');

  await mkdir(marksDir(root), { recursive: true });
  const labels = ['l0', 'l1', 'l2', 'l3'];
  const kids = labels.map((label) => spawnCollector(root, label));
  await openGate(root, kids, labels);
  const outcomes = await Promise.all(kids.map((k) => k.done));
  for (const outcome of outcomes) assertChildReported(outcome);
  assert.equal(new Set(outcomes.map((o) => o.pid)).size, labels.length, 'each reclaimer ran in its own OS process');

  const handed = outcomes.flatMap((o) => o.events ?? []);
  assert.equal(new Set(handed.map((e) => e.id)).size, handed.length, 'no record is handed to two reclaiming collectors');
  const rows = await assertDurableExactlyOnce(root, ids);
  for (const handedOut of handed) {
    assert.equal(rows.find((e) => e.id === handedOut.id)?.seq, handedOut.seq, `reclaimed record ${handedOut.id} matches the durable log`);
  }

  // Whatever the race left behind, an uncontended final drain must not add or move anything.
  await settleLease(root);
  const drain = spawnCollector(root, 'drain');
  const drained = await drain.done;
  assertChildReported(drained);
  if (drained.events) assert.deepEqual(drained.events, [], 'nothing is left to commit after the reclaim race');
  await assertDurableExactlyOnce(root, ids);

  // Every record is in the durable log and the inbox is empty, so the stale lease was
  // reclaimed rather than ignored. The diagnostic surfaces any transient lock failure
  // without weakening the durability assertions above.
  const transient = outcomes.filter((o) => o.error).map((o) => `${o.error?.code ?? 'error'}: ${o.error?.message}`);
  t.diagnostic(`transient collector failures during stale-lease reclaim: ${transient.length ? transient.join(' | ') : 'none'}`);
});

test('a fresh lease owned by another process makes competing child collectors commit nothing, and the records survive', { timeout: 180_000 }, async () => {
  const root = await tmp();
  await initProject(root);
  const ids = ['fresh-1', 'fresh-2'];
  for (const id of ids) await enqueue(root, queuedEvent(id));

  await mkdir(marksDir(root), { recursive: true });
  const labels = ['f0', 'f1', 'f2'];
  const kids = labels.map((label) => spawnCollector(root, label));
  await Promise.all(labels.map((label) => waitForMark(root, `ready-${label}`)));
  // Create the live lease only after every child is parked on the barrier, so the mtime
  // cannot age out of the 10s stale window while the children run.
  const lock = join(dir(root), 'journal.lock');
  await mkdir(lock);
  assert.ok(Date.now() - (await stat(lock)).mtimeMs < 5_000, 'the lease under test is fresh');
  await writeFile(markPath(root, 'start'), 'go');

  const outcomes = await Promise.all(kids.map((k) => k.done));
  for (const outcome of outcomes) {
    assertChildReported(outcome);
    assert.equal(outcome.error, undefined, `a live lease is an empty result, not a collector error: ${outcome.stderr}`);
    assert.deepEqual(outcome.events, [], 'a live lease prevents another process from collecting');
  }
  assert.equal(await readLog(root), '', 'nothing is committed while the lease is held elsewhere');
  assert.equal((await queuedIds(root)).length, ids.length, 'queued records stay in the inbox');
  await readdir(lock); // the lease is still there, untouched

  // Release the lease and drain from a brand-new process.
  await rm(lock, { recursive: true });
  const drain = spawnCollector(root, 'drain-fresh');
  const drained = await drain.done;
  assertChildReported(drained);
  if (drained.events) assert.deepEqual(drained.events.map((e) => e.id).sort(), [...ids].sort());
  await assertDurableExactlyOnce(root, ids);
});

test('the durable log masks TOKEN assignments, JSON tokens, HTTP Basic credentials and URL userinfo', async () => {
  const root = await tmp();
  await initProject(root);
  const canaries = [
    ['TOKEN assignment', 'canary-assignment-value'],
    ['JSON token value', 'canary-json-value'],
    ['HTTP Basic credential', 'Y2FuYXJ5OnNlY3JldA=='],
    ['URL userinfo user', 'canary-user'],
    ['URL userinfo password', 'canary-pass'],
    ['Bearer credential', 'canary-bearer-value'],
    ['credential-shaped field', 'canary-field-value'],
  ] as const;
  const event: FMEvent = {
    ...queuedEvent('redact-1'),
    data: {
      text: [
        'TOKEN=canary-assignment-value',
        '{"token":"canary-json-value"}',
        'Authorization: Basic Y2FuYXJ5OnNlY3JldA==',
        'https://canary-user:canary-pass@example.invalid/path',
      ].join('\n'),
      authorization: 'Bearer canary-bearer-value',
      token: 'canary-field-value',
    },
  };
  await enqueue(root, event);
  const collected = await collect(root);
  assert.deepEqual(collected.map((e) => e.id), ['redact-1'], 'redaction must never drop the record');

  const raw = await readLog(root);
  for (const [name, canary] of canaries) assert.ok(!raw.includes(canary), `the durable log leaked the ${name}`);
  assert.match(raw, /\[redacted\]/, 'the values are replaced, not silently dropped');
  const rows = await readRun(root, 'run');
  assert.equal(rows.length, 1);
  assert.match(String(rows[0]?.data.text), /\[redacted\]/, 'masked text is what actually gets stored');
  assert.equal(rows[0]?.data.authorization, '[redacted]', 'a credential-shaped key masks its value outright');
  assert.equal(rows[0]?.data.token, '[redacted]', 'a token key masks its value outright');
});
