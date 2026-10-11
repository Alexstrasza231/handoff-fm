#!/usr/bin/env node
import {createRequire} from 'node:module';const require=createRequire(import.meta.url);

// src/cli.ts
import { writeFile as writeFile7 } from "fs/promises";
import { resolve as resolve7, join as join10 } from "path";
import { spawnSync as spawnSync3 } from "child_process";
import { pathToFileURL } from "url";

// src/store.ts
import { mkdir, readFile, writeFile, rename, readdir, unlink, open, realpath } from "fs/promises";
import { join as join2 } from "path";

// src/collector-lock.ts
import * as filesystem from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
var ownerName = /^owner-([1-9]\d*)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;
var code = (error) => error.code;
var contention = (error) => ["EEXIST", "ENOENT", "ENOTEMPTY", "EPERM", "EBUSY"].includes(code(error) || "");
function deadOwner(name) {
  const match = ownerName.exec(name);
  if (!match) return false;
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid > 2147483647) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return code(error) === "ESRCH";
  }
}
async function reclaim(path2, fs) {
  const directory = await fs.lstat(path2);
  if (!directory.isDirectory() || directory.isSymbolicLink()) return false;
  const observed = await fs.readdir(path2);
  if (!observed.length) {
    if (Date.now() - directory.mtimeMs < 1e4) return false;
  } else {
    for (const name of observed) {
      if (!deadOwner(name)) return false;
      const entry = await fs.lstat(join(path2, name));
      if (!entry.isFile() || entry.isSymbolicLink()) return false;
    }
    for (const name of observed) {
      try {
        await fs.unlink(join(path2, name));
      } catch (error) {
        if (code(error) !== "ENOENT") throw error;
      }
    }
  }
  await fs.rmdir(path2);
  return true;
}
function releaseOwner(path2, owner, fs) {
  let markerRemoved = false;
  return async () => {
    if (!markerRemoved) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await fs.unlink(join(path2, owner));
          markerRemoved = true;
          break;
        } catch (error) {
          if (code(error) === "ENOENT") {
            markerRemoved = true;
            break;
          }
          if (!["EPERM", "EBUSY"].includes(code(error) || "")) throw error;
          if (attempt < 2) await new Promise((done) => setTimeout(done, 25));
        }
      }
    }
    if (!markerRemoved) throw Object.assign(new Error("Owner cleanup is busy; retry release"), { code: "EBUSY" });
    try {
      await fs.rmdir(path2);
    } catch (error) {
      if (!contention(error)) throw error;
    }
  };
}
async function acquireCollectorLock(path2, options = {}) {
  const fs = options.fs || filesystem, owner = `owner-${process.pid}-${randomUUID()}.json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.mkdir(path2);
    } catch (error) {
      if (code(error) !== "EEXIST") {
        if (contention(error)) return null;
        throw error;
      }
      try {
        if (!await reclaim(path2, fs)) return null;
      } catch (recoveryError) {
        if (!contention(recoveryError)) throw recoveryError;
      }
      continue;
    }
    const release = releaseOwner(path2, owner, fs);
    let published = false;
    try {
      const handle = await fs.open(join(path2, owner), "wx");
      published = true;
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid }));
      } finally {
        await handle.close();
      }
      const names = await fs.readdir(path2);
      if (names.length === 1 && names[0] === owner) return release;
      await release();
      return null;
    } catch (error) {
      if (published) await release();
      if (!contention(error)) throw error;
    }
  }
  return null;
}

// src/store.ts
import { randomUUID as randomUUID2 } from "crypto";

// src/privacy.ts
import { relative, resolve, basename, isAbsolute, sep } from "path";

// src/privacy-text.ts
var secretKey = /^(authorization|proxy-authorization|password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|cookie|set-cookie)$/i;
function cleanText(s) {
  return s.replace(/\b(?:Bearer\s+)[\w.\-+/=]+/gi, "Bearer [redacted]").replace(/\bBasic\s+[A-Za-z0-9+/=]{8,}/gi, "Basic [redacted]").replace(/\b(?:sk-|gh[pousr]_|github_pat_)[A-Za-z0-9_\-]{8,}/g, "[redacted]").replace(/(["']?\b[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|PASSWORD|SECRET)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s;,}]+)/gi, '$1"[redacted]"').replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@");
}
function sanitize(v, depth = 0) {
  if (depth > 12) return "[depth limit]";
  if (typeof v === "string") return cleanText(v.length > 65536 ? v.slice(0, 65536) + "\n[truncated]" : v);
  if (Array.isArray(v)) return v.slice(0, 256).map((x) => sanitize(x, depth + 1));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).slice(0, 128).map(([k, x]) => [k.slice(0, 256), secretKey.test(k) ? "[redacted]" : sanitize(x, depth + 1)]));
  return v;
}

// src/privacy.ts
function safeRelative(root, path2) {
  const rel = relative(resolve(root), resolve(root, path2));
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) return null;
  const parts = rel.split(/[\\/]/);
  if (parts.some((x) => [".git", ".work", ".handoff-fm", "node_modules", "dist", "web-dist", "build", "coverage", "test-results", "playwright-report"].includes(x))) return null;
  if (/^(?:\.env(?:\..*)?|credentials(?:\..*)?|auth\.json|id_rsa|id_ed25519)$/i.test(basename(rel)) || /\.(?:pem|key|p12|pfx|kubeconfig)$/i.test(rel)) return null;
  return parts.join("/");
}

// src/store.ts
var dir = (root) => join2(root, ".handoff-fm");
var safeId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(id);
async function initProject(root) {
  root = await realpath(root);
  await mkdir(dir(root), { recursive: true });
  for (const d of ["inbox", "objects", "pending", "quarantine"]) await mkdir(join2(dir(root), d), { recursive: true });
  const config = { version: 1, root, boundSessions: [] };
  try {
    await writeFile(join2(dir(root), "config.json"), JSON.stringify(config, null, 2) + "\n", { flag: "wx" });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  try {
    await writeFile(join2(dir(root), "CONNECT.md"), "# HandoffFM local recording\n\nThis project is enabled. Only new events in this project are observed.\n\n1. Install the GitHub Codex plugin (see docs/usage.md). Review and trust its exact hooks through /hooks. Installing does not trust hooks.\n2. Run handoff-fm doctor. Codex Hooks remain not yet verified until real records arrive.\n3. Run handoff-fm watch and open its local token URL.\n4. Use delegate deepseek with a task file and actual parent-session ID.\n\nRecords are local and ignored by Git. Do not commit or share this directory. Export defaults exclude task text, paths, diffs and outputs; review any opt-in content.\n", { flag: "wx" });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  let ignored = "";
  try {
    ignored = await readFile(join2(root, ".gitignore"), "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (!ignored.split(/\r?\n/).some((x) => x.trim() === ".handoff-fm/")) await writeFile(join2(root, ".gitignore"), ignored + (ignored && !ignored.endsWith("\n") ? "\n" : "") + ".handoff-fm/\n");
  return loadConfig(root);
}
async function loadConfig(root) {
  const v = JSON.parse(await readFile(join2(dir(root), "config.json"), "utf8"));
  if (v.version !== 1 || !Array.isArray(v.boundSessions)) throw new Error("Unsupported project config");
  return v;
}
var kinds = /* @__PURE__ */ new Set(["session.started", "task.started", "delegate.started", "tool.started", "tool.completed", "file.changed", "agent.message", "delegate.completed", "delegate.failed", "turn.completed", "turn.interrupted", "recording.gap"]);
function validEvent(e) {
  return e?.version === 1 && safeId(e.id) && safeId(e.runId) && typeof e.sessionId === "string" && e.sessionId.length < 200 && ["codex", "deepseek", "unknown", "system"].includes(e.actor) && kinds.has(e.kind) && ["observed", "declared", "unknown"].includes(e.evidence) && Number.isFinite(Date.parse(e.at)) && !!e.data && typeof e.data === "object" && !Array.isArray(e.data);
}
async function enqueue(root, event) {
  if (!validEvent(event)) throw new Error("Invalid event");
  const e = { ...event, data: sanitize(event.data), model: event.model ? String(sanitize(event.model)) : void 0 };
  delete e.seq;
  const name = Date.now().toString().padStart(13, "0") + "-" + process.hrtime.bigint().toString().padStart(20, "0") + "-" + randomUUID2();
  const file = join2(dir(root), "inbox", name + ".json");
  await writeFile(file + ".tmp", JSON.stringify(e), { flag: "wx" });
  await rename(file + ".tmp", file);
}
async function allEvents(root) {
  let source = "";
  try {
    source = await readFile(join2(dir(root), "events.jsonl"), "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const lines = source.slice(0, source.lastIndexOf("\n") + 1).split("\n").filter(Boolean);
  return lines.map((x) => JSON.parse(x)).filter(validEvent);
}
var queues = /* @__PURE__ */ new Map();
var delayedReleases = /* @__PURE__ */ new Map();
async function collect(root) {
  root = await realpath(root);
  const prior = queues.get(root) || Promise.resolve();
  const p = prior.catch(() => {
  }).then(() => collectLocked(root));
  queues.set(root, p);
  try {
    return await p;
  } finally {
    if (queues.get(root) === p) queues.delete(root);
  }
}
async function collectLocked(root) {
  const delayed = delayedReleases.get(root);
  if (delayed) {
    try {
      await delayed();
      delayedReleases.delete(root);
    } catch {
      return [];
    }
  }
  const release = await acquireCollectorLock(join2(dir(root), "journal.lock"));
  if (!release) return [];
  try {
    const log = join2(dir(root), "events.jsonl");
    let raw = "";
    try {
      raw = await readFile(log, "utf8");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    let damaged = false;
    if (raw && !raw.endsWith("\n")) {
      raw = raw.slice(0, raw.lastIndexOf("\n") + 1);
      const repair = await open(log, "r+");
      try {
        await repair.truncate(Buffer.byteLength(raw));
        await repair.sync();
      } finally {
        await repair.close();
      }
      damaged = true;
    }
    const rows = await allEvents(root), seen = new Set(rows.map((x) => x.id));
    let seq = rows.at(-1)?.seq || 0;
    const out = [];
    const files = (await readdir(join2(dir(root), "inbox"))).filter((x) => x.endsWith(".json")).sort();
    const journal = await open(log, "a");
    try {
      for (const name of files) {
        const file = join2(dir(root), "inbox", name);
        let e;
        try {
          const value = await readFile(file, "utf8");
          if (value.length > 1024 * 1024) throw new Error("oversized");
          e = JSON.parse(value);
          if (!validEvent(e)) throw new Error("invalid");
        } catch {
          await rename(file, join2(dir(root), "quarantine", name));
          damaged = true;
          continue;
        }
        if (!seen.has(e.id)) {
          e = { ...e, data: sanitize(e.data), seq: ++seq };
          await journal.write(JSON.stringify(e) + "\n");
          await journal.sync();
          seen.add(e.id);
          out.push(e);
        }
        await unlink(file);
      }
      if (damaged) {
        const e = { version: 1, id: randomUUID2(), runId: rows.at(-1)?.runId || out.at(-1)?.runId || "system", sessionId: "collector", actor: "system", kind: "recording.gap", evidence: "unknown", at: (/* @__PURE__ */ new Date()).toISOString(), seq: ++seq, data: { message: "Incomplete or invalid records were excluded." } };
        await journal.write(JSON.stringify(e) + "\n");
        await journal.sync();
        out.push(e);
      }
    } finally {
      await journal.close();
    }
    return out;
  } finally {
    try {
      await release();
    } catch (e) {
      if (!["EPERM", "EBUSY", "ENOENT", "ERELEASED"].includes(e.code || "")) throw e;
      delayedReleases.set(root, release);
      process.stderr.write("HandoffFM: journal unlock delayed; committed records are safe.\n");
    }
  }
}
async function readRun(root, run2) {
  if (!safeId(run2)) throw new Error("Invalid run ID");
  return (await allEvents(root)).filter((x) => x.runId === run2);
}

// src/registry.ts
import { homedir } from "os";
import { resolve as resolve2, join as join3, dirname, relative as relative2, isAbsolute as isAbsolute2, sep as sep2 } from "path";
import { readFile as readFile2, writeFile as writeFile2, mkdir as mkdir2, rename as rename2, realpath as realpath2 } from "fs/promises";
import { randomUUID as randomUUID3 } from "crypto";
var within = (root, path2) => {
  const r = relative2(resolve2(root), resolve2(path2));
  return r === "" || !isAbsolute2(r) && r !== ".." && !r.startsWith(".." + sep2);
};
var registryPath = () => join3(process.env.HANDOFF_FM_HOME || join3(homedir(), ".handoff-fm"), "projects.json");
async function projects() {
  try {
    const v = JSON.parse(await readFile2(registryPath(), "utf8"));
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
async function register(root) {
  root = await realpath2(root);
  const roots = await projects();
  if (roots.includes(root)) return;
  roots.push(root);
  const file = registryPath();
  await mkdir2(dirname(file), { recursive: true });
  const temp = file + "." + randomUUID3();
  await writeFile2(temp, JSON.stringify(roots));
  await rename2(temp, file);
}
async function findProject(input) {
  for (const root of await projects()) {
    try {
      const cfg = await loadConfig(root);
      const cwd = typeof input.cwd === "string" ? input.cwd : "";
      const child = input.tool_input?.workdir || input.tool_input?.cwd;
      const scope = typeof child === "string" ? child : cwd;
      if (scope && within(root, scope)) return root;
      if (cfg.boundSessions.includes(input.session_id) && !input.tool_name) return root;
      if (cfg.boundSessions.includes(input.session_id) && input.tool_name === "apply_patch" && String(input.tool_input?.command).includes(root.replace(/\\/g, "/"))) return root;
    } catch {
    }
  }
  return null;
}

// src/hooks.ts
import { readFile as readFile6, writeFile as writeFile5, unlink as unlink4, readdir as readdir3 } from "fs/promises";
import { join as join6, resolve as resolve5 } from "path";
import { randomUUID as randomUUID5 } from "crypto";

// src/snapshots.ts
import { readdir as readdir2, lstat, readFile as readFile3, writeFile as writeFile3, realpath as realpath3 } from "fs/promises";
import { join as join4, resolve as resolve3 } from "path";
import { createHash } from "crypto";

// node_modules/diff/libesm/diff/base.js
var Diff = class {
  diff(oldStr, newStr, options = {}) {
    let callback;
    if (typeof options === "function") {
      callback = options;
      options = {};
    } else if ("callback" in options) {
      callback = options.callback;
    }
    const oldString = this.castInput(oldStr, options);
    const newString = this.castInput(newStr, options);
    const oldTokens = this.removeEmpty(this.tokenize(oldString, options));
    const newTokens = this.removeEmpty(this.tokenize(newString, options));
    return this.diffWithOptionsObj(oldTokens, newTokens, options, callback);
  }
  diffWithOptionsObj(oldTokens, newTokens, options, callback) {
    var _a;
    const done = (value) => {
      value = this.postProcess(value, options);
      if (callback) {
        setTimeout(function() {
          callback(value);
        }, 0);
        return void 0;
      } else {
        return value;
      }
    };
    const newLen = newTokens.length, oldLen = oldTokens.length;
    let editLength = 1;
    let maxEditLength = newLen + oldLen;
    if (options.maxEditLength != null) {
      maxEditLength = Math.min(maxEditLength, options.maxEditLength);
    }
    const maxExecutionTime = (_a = options.timeout) !== null && _a !== void 0 ? _a : Infinity;
    const abortAfterTimestamp = Date.now() + maxExecutionTime;
    const bestPath = [{ oldPos: -1, lastComponent: void 0 }];
    let newPos = this.extractCommon(bestPath[0], newTokens, oldTokens, 0, options);
    if (bestPath[0].oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
      return done(this.buildValues(bestPath[0].lastComponent, newTokens, oldTokens));
    }
    let minDiagonalToConsider = -Infinity, maxDiagonalToConsider = Infinity;
    const execEditLength = () => {
      for (let diagonalPath = Math.max(minDiagonalToConsider, -editLength); diagonalPath <= Math.min(maxDiagonalToConsider, editLength); diagonalPath += 2) {
        let basePath;
        const removePath = bestPath[diagonalPath - 1], addPath = bestPath[diagonalPath + 1];
        if (removePath) {
          bestPath[diagonalPath - 1] = void 0;
        }
        let canAdd = false;
        if (addPath) {
          const addPathNewPos = addPath.oldPos - diagonalPath;
          canAdd = addPath && 0 <= addPathNewPos && addPathNewPos < newLen;
        }
        const canRemove = removePath && removePath.oldPos + 1 < oldLen;
        if (!canAdd && !canRemove) {
          bestPath[diagonalPath] = void 0;
          continue;
        }
        if (!canRemove || canAdd && removePath.oldPos < addPath.oldPos) {
          basePath = this.addToPath(addPath, true, false, 0, options);
        } else {
          basePath = this.addToPath(removePath, false, true, 1, options);
        }
        newPos = this.extractCommon(basePath, newTokens, oldTokens, diagonalPath, options);
        if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
          return done(this.buildValues(basePath.lastComponent, newTokens, oldTokens)) || true;
        } else {
          bestPath[diagonalPath] = basePath;
          if (basePath.oldPos + 1 >= oldLen) {
            maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
          }
          if (newPos + 1 >= newLen) {
            minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
          }
        }
      }
      editLength++;
    };
    if (callback) {
      (function exec() {
        setTimeout(function() {
          if (editLength > maxEditLength || Date.now() > abortAfterTimestamp) {
            return callback(void 0);
          }
          if (!execEditLength()) {
            exec();
          }
        }, 0);
      })();
    } else {
      while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
        const ret = execEditLength();
        if (ret) {
          return ret;
        }
      }
    }
  }
  addToPath(path2, added, removed, oldPosInc, options) {
    const last = path2.lastComponent;
    if (last && !options.oneChangePerToken && last.added === added && last.removed === removed) {
      return {
        oldPos: path2.oldPos + oldPosInc,
        lastComponent: { count: last.count + 1, added, removed, previousComponent: last.previousComponent }
      };
    } else {
      return {
        oldPos: path2.oldPos + oldPosInc,
        lastComponent: { count: 1, added, removed, previousComponent: last }
      };
    }
  }
  extractCommon(basePath, newTokens, oldTokens, diagonalPath, options) {
    const newLen = newTokens.length, oldLen = oldTokens.length;
    let oldPos = basePath.oldPos, newPos = oldPos - diagonalPath, commonCount = 0;
    while (newPos + 1 < newLen && oldPos + 1 < oldLen && this.equals(oldTokens[oldPos + 1], newTokens[newPos + 1], options)) {
      newPos++;
      oldPos++;
      commonCount++;
      if (options.oneChangePerToken) {
        basePath.lastComponent = { count: 1, previousComponent: basePath.lastComponent, added: false, removed: false };
      }
    }
    if (commonCount && !options.oneChangePerToken) {
      basePath.lastComponent = { count: commonCount, previousComponent: basePath.lastComponent, added: false, removed: false };
    }
    basePath.oldPos = oldPos;
    return newPos;
  }
  equals(left, right, options) {
    if (options.comparator) {
      return options.comparator(left, right);
    } else {
      return left === right || !!options.ignoreCase && left.toLowerCase() === right.toLowerCase();
    }
  }
  removeEmpty(array) {
    const ret = [];
    for (let i = 0; i < array.length; i++) {
      if (array[i]) {
        ret.push(array[i]);
      }
    }
    return ret;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  castInput(value, options) {
    return value;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tokenize(value, options) {
    return Array.from(value);
  }
  join(chars) {
    return chars.join("");
  }
  postProcess(changeObjects, options) {
    return changeObjects;
  }
  get useLongestToken() {
    return false;
  }
  buildValues(lastComponent, newTokens, oldTokens) {
    const components = [];
    let nextComponent;
    while (lastComponent) {
      components.push(lastComponent);
      nextComponent = lastComponent.previousComponent;
      delete lastComponent.previousComponent;
      lastComponent = nextComponent;
    }
    components.reverse();
    const componentLen = components.length;
    let componentPos = 0, newPos = 0, oldPos = 0;
    for (; componentPos < componentLen; componentPos++) {
      const component = components[componentPos];
      if (!component.removed) {
        if (!component.added && this.useLongestToken) {
          let value = newTokens.slice(newPos, newPos + component.count);
          value = value.map(function(value2, i) {
            const oldValue = oldTokens[oldPos + i];
            return oldValue.length > value2.length ? oldValue : value2;
          });
          component.value = this.join(value);
        } else {
          component.value = this.join(newTokens.slice(newPos, newPos + component.count));
        }
        newPos += component.count;
        if (!component.added) {
          oldPos += component.count;
        }
      } else {
        component.value = this.join(oldTokens.slice(oldPos, oldPos + component.count));
        oldPos += component.count;
      }
    }
    return components;
  }
};

// node_modules/diff/libesm/diff/line.js
var LineDiff = class extends Diff {
  constructor() {
    super(...arguments);
    this.tokenize = tokenize;
  }
  equals(left, right, options) {
    if (options.ignoreWhitespace) {
      if (!options.newlineIsToken || !left.includes("\n")) {
        left = left.trim();
      }
      if (!options.newlineIsToken || !right.includes("\n")) {
        right = right.trim();
      }
    } else if (options.ignoreNewlineAtEof && !options.newlineIsToken) {
      if (left.endsWith("\n")) {
        left = left.slice(0, -1);
      }
      if (right.endsWith("\n")) {
        right = right.slice(0, -1);
      }
    }
    return super.equals(left, right, options);
  }
};
var lineDiff = new LineDiff();
function diffLines(oldStr, newStr, options) {
  return lineDiff.diff(oldStr, newStr, options);
}
function tokenize(value, options) {
  if (options.stripTrailingCr) {
    value = value.replace(/\r\n/g, "\n");
  }
  const retLines = [], linesAndNewlines = value.split(/(\n|\r\n)/);
  if (!linesAndNewlines[linesAndNewlines.length - 1]) {
    linesAndNewlines.pop();
  }
  for (let i = 0; i < linesAndNewlines.length; i++) {
    const line = linesAndNewlines[i];
    if (i % 2 && !options.newlineIsToken) {
      retLines[retLines.length - 1] += line;
    } else {
      retLines.push(line);
    }
  }
  return retLines;
}

// node_modules/diff/libesm/patch/create.js
var INCLUDE_HEADERS = {
  includeIndex: true,
  includeUnderline: true,
  includeFileHeaders: true
};
function structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options) {
  let optionsObj;
  if (!options) {
    optionsObj = {};
  } else if (typeof options === "function") {
    optionsObj = { callback: options };
  } else {
    optionsObj = options;
  }
  if (typeof optionsObj.context === "undefined") {
    optionsObj.context = 4;
  }
  const context = optionsObj.context;
  if (optionsObj.newlineIsToken) {
    throw new Error("newlineIsToken may not be used with patch-generation functions, only with diffing functions");
  }
  if (!optionsObj.callback) {
    return diffLinesResultToPatch(diffLines(oldStr, newStr, optionsObj));
  } else {
    const { callback } = optionsObj;
    diffLines(oldStr, newStr, Object.assign(Object.assign({}, optionsObj), { callback: (diff) => {
      const patch = diffLinesResultToPatch(diff);
      callback(patch);
    } }));
  }
  function diffLinesResultToPatch(diff) {
    if (!diff) {
      return;
    }
    diff.push({ value: "", lines: [] });
    function contextLines(lines) {
      return lines.map(function(entry) {
        return " " + entry;
      });
    }
    const hunks = [];
    let oldRangeStart = 0, newRangeStart = 0, curRange = [], oldLine = 1, newLine = 1;
    for (let i = 0; i < diff.length; i++) {
      const current = diff[i], lines = current.lines || splitLines(current.value);
      current.lines = lines;
      if (current.added || current.removed) {
        if (!oldRangeStart) {
          const prev = diff[i - 1];
          oldRangeStart = oldLine;
          newRangeStart = newLine;
          if (prev) {
            curRange = context > 0 ? contextLines(prev.lines.slice(-context)) : [];
            oldRangeStart -= curRange.length;
            newRangeStart -= curRange.length;
          }
        }
        for (const line of lines) {
          curRange.push((current.added ? "+" : "-") + line);
        }
        if (current.added) {
          newLine += lines.length;
        } else {
          oldLine += lines.length;
        }
      } else {
        if (oldRangeStart) {
          if (lines.length <= context * 2 && i < diff.length - 2) {
            for (const line of contextLines(lines)) {
              curRange.push(line);
            }
          } else {
            const contextSize = Math.min(lines.length, context);
            for (const line of contextLines(lines.slice(0, contextSize))) {
              curRange.push(line);
            }
            const hunk = {
              oldStart: oldRangeStart,
              oldLines: oldLine - oldRangeStart + contextSize,
              newStart: newRangeStart,
              newLines: newLine - newRangeStart + contextSize,
              lines: curRange
            };
            hunks.push(hunk);
            oldRangeStart = 0;
            newRangeStart = 0;
            curRange = [];
          }
        }
        oldLine += lines.length;
        newLine += lines.length;
      }
    }
    for (const hunk of hunks) {
      for (let i = 0; i < hunk.lines.length; i++) {
        if (hunk.lines[i].endsWith("\n")) {
          hunk.lines[i] = hunk.lines[i].slice(0, -1);
        } else {
          hunk.lines.splice(i + 1, 0, "\\ No newline at end of file");
          i++;
        }
      }
    }
    return {
      oldFileName,
      newFileName,
      oldHeader,
      newHeader,
      hunks
    };
  }
}
function formatPatch(patch, headerOptions) {
  if (!headerOptions) {
    headerOptions = INCLUDE_HEADERS;
  }
  if (Array.isArray(patch)) {
    if (patch.length > 1 && !headerOptions.includeFileHeaders) {
      throw new Error("Cannot omit file headers on a multi-file patch. (The result would be unparseable; how would a tool trying to apply the patch know which changes are to which file?)");
    }
    return patch.map((p) => formatPatch(p, headerOptions)).join("\n");
  }
  const ret = [];
  if (headerOptions.includeIndex && patch.oldFileName == patch.newFileName) {
    ret.push("Index: " + patch.oldFileName);
  }
  if (headerOptions.includeUnderline) {
    ret.push("===================================================================");
  }
  if (headerOptions.includeFileHeaders) {
    ret.push("--- " + patch.oldFileName + (typeof patch.oldHeader === "undefined" ? "" : "	" + patch.oldHeader));
    ret.push("+++ " + patch.newFileName + (typeof patch.newHeader === "undefined" ? "" : "	" + patch.newHeader));
  }
  for (let i = 0; i < patch.hunks.length; i++) {
    const hunk = patch.hunks[i];
    if (hunk.oldLines === 0) {
      hunk.oldStart -= 1;
    }
    if (hunk.newLines === 0) {
      hunk.newStart -= 1;
    }
    ret.push("@@ -" + hunk.oldStart + "," + hunk.oldLines + " +" + hunk.newStart + "," + hunk.newLines + " @@");
    for (const line of hunk.lines) {
      ret.push(line);
    }
  }
  return ret.join("\n") + "\n";
}
function createTwoFilesPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options) {
  if (typeof options === "function") {
    options = { callback: options };
  }
  if (!(options === null || options === void 0 ? void 0 : options.callback)) {
    const patchObj = structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options);
    if (!patchObj) {
      return;
    }
    return formatPatch(patchObj, options === null || options === void 0 ? void 0 : options.headerOptions);
  } else {
    const { callback } = options;
    structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, Object.assign(Object.assign({}, options), { callback: (patchObj) => {
      if (!patchObj) {
        callback(void 0);
      } else {
        callback(formatPatch(patchObj, options.headerOptions));
      }
    } }));
  }
}
function splitLines(text) {
  const hasTrailingNl = text.endsWith("\n");
  const result = text.split("\n").map((line) => line + "\n");
  if (hasTrailingNl) {
    result.pop();
  } else {
    result.push(result.pop().slice(0, -1));
  }
  return result;
}

// src/snapshots.ts
var hash = (s) => createHash("sha256").update(s).digest("hex");
async function snapshot(root) {
  root = await realpath3(root);
  const out = {};
  let visited = 0;
  async function scan(path2) {
    for (const name of await readdir2(path2)) {
      if (++visited > 5e3) return;
      const file = join4(path2, name), rel = safeRelative(root, file);
      if (!rel) continue;
      const stat = await lstat(file);
      if (stat.isSymbolicLink()) continue;
      const canonical = await realpath3(file);
      if (!safeRelative(root, canonical)) continue;
      if (stat.isDirectory()) {
        await scan(file);
        continue;
      }
      if (!stat.isFile() || stat.size > 1024 * 1024) continue;
      const bytes = await readFile3(file);
      if (bytes.includes(0)) continue;
      const text = bytes.toString("utf8");
      if (text.includes("\uFFFD")) continue;
      const content = cleanText(text);
      out[rel] = { hash: hash(content), text: content };
    }
  }
  await scan(root);
  return out;
}
async function blob(root, text) {
  const key = hash(text);
  try {
    await writeFile3(join4(dir(root), "objects", key + ".txt"), text, { flag: "wx" });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  return key;
}
function changes(before, after) {
  return [.../* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)])].filter((p) => before[p]?.hash !== after[p]?.hash).map((path2) => ({ path: path2, before: before[path2]?.text || "", after: after[path2]?.text || "", beforeHash: before[path2]?.hash, afterHash: after[path2]?.hash, diff: createTwoFilesPatch(path2, path2, before[path2]?.text || "", after[path2]?.text || "") }));
}

// src/evidence.ts
import { lstat as lstat2, realpath as realpath4, readFile as readFile4 } from "fs/promises";
import { resolve as resolve4 } from "path";
var excludedMention = /(?:^|[\s"'\\/=:])(?:\.env(?:[.\s"'\\/]|$)|auth\.json|credentials(?:\.|[\s"'\\/])|id_rsa\b|id_ed25519\b|node_modules[\\/]|\.git[\\/]|\.handoff-fm[\\/]|(?:dist|web-dist|build|coverage)[\\/])|\.(?:pem|key|p12|pfx|kubeconfig)\b/i;
async function excludedEvidence(root, input, cwd = root) {
  const tool = input && typeof input === "object" ? input : {};
  const base = resolve4(cwd, typeof tool.workdir === "string" ? tool.workdir : typeof tool.cwd === "string" ? tool.cwd : ".");
  const paths = [];
  let excluded = false;
  function visit(v, depth = 0) {
    if (depth > 8) return;
    if (typeof v === "string") {
      if (excludedMention.test(v) || v.includes("\0")) excluded = true;
      return;
    }
    if (v && typeof v === "object") for (const [key, val] of Object.entries(v)) {
      if (/^(file_path|path|filename|file)$/i.test(key) && typeof val === "string") paths.push(val);
      if (key === "command" && typeof val === "string") for (const m of val.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)) paths.push(m[1]);
      visit(val, depth + 1);
    }
  }
  visit(input);
  if (excluded) return true;
  for (const path2 of paths) {
    const target = resolve4(base, path2);
    if (!safeRelative(root, target) || /\.(png|jpe?g|gif|webp|pdf|zip|exe|dll|bin|mp[34]|webm)$/i.test(path2)) return true;
    try {
      const st = await lstat2(target);
      if (st.isSymbolicLink() || st.size > 1024 * 1024 || !safeRelative(await realpath4(root), await realpath4(target))) return true;
      if (st.isFile()) {
        const content = await readFile4(target);
        if (content.includes(0) || content.toString("utf8").includes("\uFFFD")) return true;
      }
    } catch {
    }
  }
  return false;
}

// src/attribution.ts
import { readFile as readFile5, writeFile as writeFile4, rename as rename3, unlink as unlink3 } from "fs/promises";
import { join as join5 } from "path";
import { randomUUID as randomUUID4 } from "crypto";
var path = (root) => join5(root, ".handoff-fm", "attribution-epoch");
async function attributionEpoch(root) {
  try {
    const value = await readFile5(path(root), "utf8");
    return /^[a-f0-9-]{36}$/.test(value) ? value : null;
  } catch (e) {
    return e.code === "ENOENT" ? "initial" : null;
  }
}
async function rotateAttributionEpoch(root) {
  const value = randomUUID4(), temporary = path(root) + "." + value + ".tmp";
  try {
    await writeFile4(temporary, value, { flag: "wx" });
    await rename3(temporary, path(root));
    return true;
  } catch {
    return false;
  } finally {
    await unlink3(temporary).catch(() => {
    });
  }
}

// src/hooks.ts
async function captureHook(root, input) {
  const cfg = await loadConfig(root);
  const bound = cfg.boundSessions.includes(input.session_id);
  const scope = input.tool_input?.workdir || input.tool_input?.cwd || input.cwd;
  const patch = String(input.tool_input?.command || "");
  const paths = input.tool_name === "apply_patch" ? [...patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map((x) => safeRelative(root, resolve5(input.cwd, x[1]))).filter(Boolean) : [];
  if (!within(root, String(scope || "")) && !(bound && (!input.tool_name || paths.length))) return;
  const session = String(input.session_id || "unknown"), run2 = safeId(session) ? session : hash(session).slice(0, 32);
  const tool = String(input.tool_name || ""), call = String(input.tool_use_id || randomUUID5()), file = join6(dir(root), "pending", hash(session + call) + ".json");
  const base = { version: 1, runId: run2, actor: "codex", sessionId: session, turnId: input.turn_id, taskId: input.turn_id, model: input.model, evidence: "observed" };
  const send = async (kind, data, evidence = "observed") => enqueue(root, { ...base, id: randomUUID5(), kind, at: (/* @__PURE__ */ new Date()).toISOString(), data, evidence });
  switch (input.hook_event_name) {
    case "SessionStart":
      await send("session.started", { source: input.source });
      break;
    case "UserPromptSubmit":
      await send("task.started", { prompt: input.prompt });
      break;
    case "PreToolUse": {
      const excluded = await excludedEvidence(root, input.tool_input, input.cwd || root);
      const epoch = await attributionEpoch(root);
      await writeFile5(file, JSON.stringify({ session, paths, tool, before: {}, overlap: true, excluded }));
      const others = (await readdir3(join6(dir(root), "pending"))).filter((n) => n.endsWith(".json") && n !== file.split(/[\\/]/).at(-1));
      for (const name of others) {
        await writeFile5(join6(dir(root), "pending", name) + ".overlap", "1");
        await writeFile5(file + ".overlap", "1");
      }
      const before = await snapshot(root);
      await writeFile5(file, JSON.stringify({ session, before, paths, tool, overlap: others.length > 0, excluded, epoch }));
      await send("tool.started", { tool, callId: call, input: excluded ? "[excluded file evidence]" : input.tool_input, excluded });
      break;
    }
    case "PostToolUse": {
      let pending;
      try {
        pending = JSON.parse(await readFile6(file, "utf8"));
      } catch {
      }
      const response = input.tool_response, exitCode = response?.exit_code ?? response?.exitCode;
      const excluded = pending?.excluded || await excludedEvidence(root, input.tool_input, input.cwd || root);
      await send("tool.completed", { tool, callId: call, output: excluded ? "[excluded file evidence]" : response, excluded, exitCode, status: typeof exitCode === "number" ? exitCode === 0 ? "completed" : "failed" : response?.isError ? "failed" : "unknown" });
      if (pending) {
        const after = await snapshot(root);
        const others = (await readdir3(join6(dir(root), "pending"))).filter((n) => n !== file.split(/[\\/]/).at(-1));
        for (const change of changes(pending.before, after)) {
          const flagged = await readFile6(file + ".overlap").then(() => true, () => false);
          const epoch = await attributionEpoch(root);
          const exact = tool === "apply_patch" && pending.paths.includes(change.path) && !pending.overlap && !flagged && others.length === 0 && epoch !== null && epoch === pending.epoch;
          const beforeBlob = await blob(root, change.before), afterBlob = await blob(root, change.after);
          await send("file.changed", { ...change, before: void 0, after: void 0, beforeBlob, afterBlob, callId: call, candidateActor: "codex", reason: exact ? "Explicit edit tool and isolated before/after evidence" : "Indirect write or overlapping operation; attribution is unknown" }, exact ? "observed" : "unknown");
        }
        await unlink4(file).catch(() => {
        });
        await unlink4(file + ".overlap").catch(() => {
        });
      }
      break;
    }
    case "Stop":
      if (input.last_assistant_message) await send("agent.message", { text: input.last_assistant_message }, "declared");
      await send("turn.completed", {});
      break;
    case "Interrupt": {
      await send("turn.interrupted", {});
      for (const name of await readdir3(join6(dir(root), "pending"))) if (name.endsWith(".json")) {
        const pendingFile = join6(dir(root), "pending", name);
        try {
          const pending = JSON.parse(await readFile6(pendingFile, "utf8"));
          if (pending.session === session) {
            await unlink4(pendingFile);
            await unlink4(pendingFile + ".overlap").catch(() => {
            });
            await send("recording.gap", { message: "Interrupted operation has no paired completion" }, "unknown");
          }
        } catch {
        }
      }
      break;
    }
    case "SubagentStart":
      await send("delegate.started", { agentId: input.agent_id, agentType: input.agent_type });
      break;
    case "SubagentStop":
      await send("delegate.completed", { agentId: input.agent_id, text: input.last_assistant_message }, "declared");
      break;
  }
}

// src/delegate.ts
import { spawn, spawnSync as spawnSync2 } from "child_process";
import { readFile as readFile7, writeFile as writeFile6, unlink as unlink5, readdir as readdir4 } from "fs/promises";
import { join as join7 } from "path";
import { randomUUID as randomUUID6 } from "crypto";

// src/process.ts
import { spawnSync } from "child_process";
function commandSpec(command, args2, platform = process.platform) {
  if (platform === "win32" && process.platform === "win32" && command === "dsh") {
    const found = spawnSync("where.exe", ["dsh"], { encoding: "utf8", windowsHide: true, timeout: 5e3 });
    const path2 = found.stdout?.trim().split(/\r?\n/)[0];
    if (found.status === 0 && path2) command = path2;
  }
  if (platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    if (/[\r\n"&|<>^%!]/.test(command) || args2.some((a) => !/^[-a-zA-Z0-9_]+$/.test(a))) throw new Error("Unsafe DSH path or argument");
    return { command: "cmd.exe", args: ["/d", "/s", "/c", `""${command}" ${args2.join(" ")}"`], options: { windowsHide: true, windowsVerbatimArguments: true } };
  }
  return { command, args: args2, options: { windowsHide: true } };
}

// src/delegate.ts
function completionReason(v) {
  return typeof v === "string" ? v : v && typeof v === "object" && "kind" in v ? String(v.kind) : "unknown";
}
function normalizeDSH(v, c) {
  if (!v || ["thinking", "text", "status"].includes(v.type)) return [];
  const truncated = !!v.truncated || JSON.stringify(v.input ?? v.result ?? "").length > 65536;
  const base = { version: 1, id: randomUUID6(), ...c, actor: "deepseek", at: (/* @__PURE__ */ new Date()).toISOString(), evidence: truncated ? "unknown" : "observed" };
  if (v.type === "session") return [{ ...base, sessionId: v.sessionId || c.sessionId, kind: "session.started", data: {} }];
  if (v.type === "tool_call") return [{ ...base, kind: "tool.started", data: { tool: v.tool, callId: v.callId, input: v.input, truncated } }];
  if (v.type === "tool_result") return [{ ...base, kind: "tool.completed", data: { callId: v.callId, status: v.status, output: v.result, truncated } }];
  if (v.type === "final") return [{ ...base, kind: "agent.message", evidence: "declared", data: { text: v.text } }];
  if (v.type === "error") return [{ ...base, kind: "delegate.failed", data: { message: v.message } }];
  return [];
}
async function delegate(root, options) {
  const cfg = await loadConfig(root), task = await readFile7(options.taskFile, "utf8");
  if (!task.trim() || task.length > 128 * 1024) throw new Error("Task must be non-empty and <=128 KiB");
  if (options.sessionId && !safeId(options.sessionId)) throw new Error("Invalid DeepSeek session ID");
  const runId = safeId(options.parentSession) ? options.parentSession : hash(options.parentSession).slice(0, 32), taskId = "task-" + randomUUID6();
  const c = { runId, sessionId: "pending-" + taskId, taskId, parentTaskId: options.parentTurn };
  let invalid = false;
  const send = async (e) => {
    try {
      await enqueue(root, e);
    } catch {
      invalid = true;
      process.stderr.write("HandoffFM: recording gap; the delegate continues.\n");
    }
  };
  const emit = async (kind, data, actor = "deepseek", evidence = "observed") => send({ version: 1, id: randomUUID6(), ...c, sessionId: actor === "codex" ? options.parentSession : c.sessionId, actor, kind, at: (/* @__PURE__ */ new Date()).toISOString(), evidence, data });
  const gap = async (message) => {
    invalid = true;
    await emit("recording.gap", { message }, "system", "unknown");
  };
  const takeSnapshot = async () => {
    try {
      return await snapshot(root);
    } catch {
      await gap("Snapshot unavailable; file changes could not be captured");
      return null;
    }
  };
  const args2 = ["headless", "--json", ...options.sessionId ? ["--session-id", options.sessionId] : [], "-"];
  const spec = commandSpec(cfg.dshCommand || "dsh", args2);
  if (!await rotateAttributionEpoch(root)) await gap("Attribution guard unavailable; delegate recording is incomplete");
  await emit("delegate.started", { title: options.title, prompt: task, parentSession: options.parentSession }, "codex");
  const windowMarker = join7(dir(root), "pending", `delegate-${taskId}.json`);
  const pendingMarkers = /* @__PURE__ */ new Set();
  try {
    try {
      await writeFile6(windowMarker, JSON.stringify({ actor: "deepseek", taskId }));
      for (const name of await readdir4(join7(dir(root), "pending"))) if (name.endsWith(".json") && join7(dir(root), "pending", name) !== windowMarker) await writeFile6(join7(dir(root), "pending", name) + ".overlap", "1");
    } catch {
      await gap("Task-window recording unavailable; the delegate continues");
    }
    const taskBefore = await takeSnapshot();
    const child = spawn(spec.command, spec.args, { ...spec.options, cwd: root, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    let interrupted = false;
    const cancel = () => {
      interrupted = true;
      if (!child.pid) return;
      if (process.platform === "win32") spawnSync2("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 5e3 });
      else try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    };
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    child.stdin.end(task);
    let queue = Promise.resolve(), answer = "", reason = "", hadFinal = false;
    let lastSnapshot = taskBefore;
    const reported = /* @__PURE__ */ new Set();
    const calls = /* @__PURE__ */ new Map();
    const onLine = (line) => {
      queue = queue.then(async () => {
        if (line.length > 1024 * 1024) {
          invalid = true;
          await emit("recording.gap", { message: "Oversized DeepSeek event excluded" }, "system", "unknown");
          return;
        }
        let v;
        try {
          v = JSON.parse(line);
        } catch {
          invalid = true;
          await emit("recording.gap", { message: "Invalid DeepSeek event excluded" }, "system", "unknown");
          return;
        }
        if (v.type === "session") c.sessionId = v.sessionId || c.sessionId;
        if (v.type === "status" && v.phase === "turn_end") reason = completionReason(v.reason);
        if (v.type === "final") {
          answer = String(v.text || "");
          hadFinal = true;
        }
        if (v.type === "tool_call" && (typeof v.callId !== "string" || !v.callId)) {
          invalid = true;
          await emit("recording.gap", { message: "Uncorrelated tool call excluded" }, "system", "unknown");
          return;
        }
        if (v.type === "tool_call" && v.callId) {
          const before = lastSnapshot;
          if (!before) {
            await gap("Tool snapshot unavailable; tool evidence excluded");
            return;
          }
          const pending = join7(dir(root), "pending", "ds-" + hash(taskId + v.callId) + ".json");
          const overlap = (await readdir4(join7(dir(root), "pending"))).length > 0;
          const excluded = await excludedEvidence(root, v.input);
          await writeFile6(pending, JSON.stringify({ actor: "deepseek", taskId }));
          pendingMarkers.add(pending);
          calls.set(v.callId, { before, input: v.input, tool: v.tool, truncated: !!v.truncated, pending, overlap, excluded });
        }
        for (const e of normalizeDSH(v, c)) {
          const excluded = calls.get(v.callId)?.excluded;
          if (v.type === "tool_call" && excluded) e.data.input = "[excluded file evidence]";
          if (v.type === "tool_result" && (excluded || !calls.has(v.callId))) e.data.output = "[excluded or unmatched file evidence]";
          if (excluded) e.data.excluded = true;
          await send(e);
        }
        if (v.type === "tool_result" && calls.has(v.callId)) {
          const call = calls.get(v.callId);
          const after = await snapshot(root);
          const others = (await readdir4(join7(dir(root), "pending"))).filter((n) => n !== call.pending.split(/[\\/]/).at(-1));
          for (const change of changes(call.before, after)) {
            await emit("file.changed", { ...change, before: void 0, after: void 0, beforeBlob: await blob(root, change.before), afterBlob: await blob(root, change.after), callId: v.callId, candidateActor: "deepseek", reason: "Observed during delegate tool; external event stream is not a pre-write barrier" }, "deepseek", "unknown");
            reported.add(change.path + "@" + change.afterHash);
          }
          lastSnapshot = after;
          await unlink5(call.pending).catch(() => {
          });
          calls.delete(v.callId);
        }
      }).catch(async () => {
        invalid = true;
        await emit("recording.gap", { message: "DeepSeek evidence could not be captured" }, "system", "unknown");
      });
    };
    let lineBuffer = "", discarding = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      const pieces = chunk.split("\n");
      for (let i = 0; i < pieces.length; i++) {
        if (!discarding) {
          if (lineBuffer.length + pieces[i].length > 1024 * 1024) {
            lineBuffer = "";
            discarding = true;
            onLine(" ".repeat(1024 * 1024 + 1));
          } else lineBuffer += pieces[i];
        }
        if (i < pieces.length - 1) {
          if (!discarding && lineBuffer.trim()) onLine(lineBuffer);
          lineBuffer = "";
          discarding = false;
        }
      }
    });
    child.stdout.on("end", () => {
      if (!discarding && lineBuffer.trim()) onLine(lineBuffer);
      lineBuffer = "";
    });
    child.stderr.on("data", () => {
    });
    let processError = "";
    child.on("error", (e) => {
      processError = e.message;
    });
    const exit = await new Promise((done) => child.on("close", (code2) => done(code2 ?? 1)));
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    await queue;
    for (const call of calls.values()) await unlink5(call.pending).catch(() => {
    });
    const taskAfter = await takeSnapshot();
    for (const change of taskBefore && taskAfter ? changes(taskBefore, taskAfter) : []) {
      if (reported.has(change.path + "@" + change.afterHash)) continue;
      try {
        await emit("file.changed", { ...change, before: void 0, after: void 0, beforeBlob: await blob(root, change.before), afterBlob: await blob(root, change.after), candidateActor: "deepseek", reason: "Task-window snapshot; exact writer is unknown" }, "deepseek", "unknown");
      } catch {
        await gap("File evidence storage unavailable; delegate result is preserved");
      }
    }
    await unlink5(windowMarker).catch(() => {
    });
    await unlink5(windowMarker + ".overlap").catch(() => {
    });
    if (interrupted) {
      reason = "interrupted";
      await emit("turn.interrupted", {}, "deepseek");
    }
    const success = !interrupted && exit === 0 && hadFinal && reason === "completed";
    if (exit === 0 && (!hadFinal || !reason)) {
      invalid = true;
      await emit("recording.gap", { message: "Delegate terminal event is missing; completion could not be verified" }, "system", "unknown");
    }
    await emit(success ? "delegate.completed" : "delegate.failed", { exitCode: exit, reason: reason || "unknown", message: processError || void 0, recordingIncomplete: invalid }, "deepseek");
    process.stdout.write(answer + (answer.endsWith("\n") ? "" : "\n"));
    process.stderr.write(`HandoffFM run: ${runId}; task: ${taskId}
`);
    return success ? 0 : 1;
  } catch (e) {
    await emit("delegate.failed", { message: e.message, reason: "recording-or-launch-error" }, "deepseek");
    throw e;
  } finally {
    for (const marker of pendingMarkers) {
      await unlink5(marker).catch(() => {
      });
      await unlink5(marker + ".overlap").catch(() => {
      });
    }
    await unlink5(windowMarker).catch(() => {
    });
    await unlink5(windowMarker + ".overlap").catch(() => {
    });
  }
}

// src/server.ts
import { createServer } from "http";
import { randomBytes, timingSafeEqual } from "crypto";
import { readFile as readFile9, realpath as realpath5 } from "fs/promises";
import { join as join9, resolve as resolve6, relative as relative4, isAbsolute as isAbsolute4, extname } from "path";
import { fileURLToPath } from "url";

// src/export.ts
import { readFile as readFile8, readdir as readdir5 } from "fs/promises";
import { join as join8 } from "path";

// src/share.ts
function shareEvents(events, options) {
  const start = Date.parse(events[0]?.at || "1970-01-01");
  const aliases = /* @__PURE__ */ new Map();
  const alias = (s, prefix) => {
    const key = prefix + s;
    if (!aliases.has(key)) aliases.set(key, `${prefix}-${aliases.size + 1}`);
    return aliases.get(key);
  };
  return events.map((e, i) => {
    const data = {};
    if (options.prompts) {
      for (const key of ["prompt", "title"]) if (key in e.data) data[key] = e.data[key];
    }
    if (options.paths && e.kind === "file.changed") data.path = e.data.path;
    if (options.diffs && e.kind === "file.changed") data.diff = e.data.diff;
    if (options.outputs) {
      for (const key of ["text", "output", "exitCode", "status", "message", "reason"]) if (key in e.data) data[key] = e.data[key];
    }
    return {
      version: 1,
      id: `event-${i + 1}`,
      runId: alias(e.runId, "run"),
      sessionId: alias(e.sessionId, "instance"),
      actor: e.actor,
      kind: e.kind,
      at: new Date(Math.max(0, Date.parse(e.at) - start)).toISOString(),
      seq: i + 1,
      evidence: e.evidence,
      taskId: e.taskId ? alias(e.taskId, "task") : void 0,
      parentTaskId: e.parentTaskId ? alias(e.parentTaskId, "task") : void 0,
      data: sanitize(data)
    };
  });
}

// src/export.ts
async function offlineHTML(webDir, events, options) {
  const html = await readFile8(join8(webDir, "index.html"), "utf8");
  const assets = {};
  const chars = join8(webDir, "characters");
  for (const file of await readdir5(chars)) if (/^[a-z-]+\.png$/.test(file)) assets[`/characters/${file}`] = "data:image/png;base64," + (await readFile8(join8(chars, file))).toString("base64");
  const json = JSON.stringify({ events: shareEvents(events, options), options, assets }).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  let result = html.replace(/<link rel="modulepreload"[^>]*>/g, "");
  const scripts = [...result.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)];
  for (const match of scripts) {
    const path2 = match[1].replace(/^\//, "");
    if (!/^assets\/[a-zA-Z0-9_.-]+\.js$/.test(path2)) throw new Error("Unexpected build script");
    const code2 = await readFile8(join8(webDir, path2), "utf8");
    result = result.replace(match[0], () => `<script type="module">${code2.replace(/<\/script/gi, "<\\/script")}</script>`);
  }
  for (const match of [...result.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)]) {
    const path2 = match[1].replace(/^\//, "");
    if (!/^assets\/[a-zA-Z0-9_.-]+\.css$/.test(path2)) throw new Error("Unexpected build CSS");
    const css = await readFile8(join8(webDir, path2), "utf8");
    result = result.replace(match[0], () => `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`);
  }
  result = result.replace(/<head>/, () => `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><script>window.__HANDOFF_FM_OFFLINE__=` + json + "</script>");
  return result;
}

// src/types.ts
var DEFAULT_SHARE = { prompts: false, paths: false, diffs: false, outputs: false };

// src/server.ts
var webDirectory = resolve6(fileURLToPath(new URL("../web-dist", import.meta.url)));
async function startWatch(root, options) {
  const token = randomBytes(32).toString("hex");
  const streams = /* @__PURE__ */ new Set();
  let ticking = false;
  const server = createServer(async (req, res) => {
    try {
      const port = server.address().port, expected = `127.0.0.1:${port}`;
      const fail = (code2, msg) => {
        res.writeHead(code2, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(msg);
      };
      if (req.headers.host !== expected) return fail(403, "Invalid Host");
      if (req.headers.origin && req.headers.origin !== `http://${expected}`) return fail(403, "Invalid Origin");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Cache-Control", "no-store");
      if (req.method !== "GET") return fail(405, "Read-only service");
      const url = new URL(req.url || "/", `http://${expected}`);
      if (url.pathname.startsWith("/api/")) {
        const offered = String(req.headers.authorization || "").replace(/^Bearer /, "") || url.searchParams.get("token") || "";
        const a = Buffer.from(offered), b = Buffer.from(token);
        if (a.length !== b.length || !timingSafeEqual(a, b)) return fail(401, "Access token required");
        const reply = (value) => {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(value));
        };
        if (url.pathname === "/api/runs") {
          const rows = await allEvents(root);
          const runs = /* @__PURE__ */ new Map();
          for (const e of rows) {
            const prior = runs.get(e.runId);
            runs.delete(e.runId);
            runs.set(e.runId, { id: e.runId, title: e.kind === "task.started" ? e.data.prompt || "Recorded task" : prior?.title || "Recorded collaboration", updated: e.at, count: (prior?.count || 0) + 1 });
          }
          return reply([...runs.values()].reverse());
        }
        if (url.pathname === "/api/events") {
          const run2 = url.searchParams.get("run");
          if (run2 && !safeId(run2)) return fail(400, "Invalid run");
          return reply(run2 ? await readRun(root, run2) : await allEvents(root));
        }
        if (url.pathname === "/api/export") {
          const run2 = url.searchParams.get("run");
          if (!run2 || !safeId(run2)) return fail(400, "Invalid run");
          const opts = { ...DEFAULT_SHARE };
          for (const k of Object.keys(opts)) opts[k] = url.searchParams.get(k) === "true";
          const body = await offlineHTML(options.webDir || webDirectory, await readRun(root, run2), opts);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": 'attachment; filename="handoff-fm.html"' });
          return res.end(body);
        }
        if (url.pathname === "/api/stream") {
          let since = Number(req.headers["last-event-id"] || url.searchParams.get("since") || 0);
          if (!Number.isSafeInteger(since) || since < 0) return fail(400, "Invalid sequence");
          res.writeHead(200, { "Content-Type": "text/event-stream", "Connection": "keep-alive" });
          for (const e of await allEvents(root)) if ((e.seq || 0) > since) {
            res.write(`id: ${e.seq}
data: ${JSON.stringify(e)}

`);
            since = e.seq;
          }
          res.write(": connected\n\n");
          res.lastSeq = since;
          streams.add(res);
          res.on("close", () => streams.delete(res));
          return;
        }
        return fail(404, "Unknown endpoint");
      }
      const web = await realpath5(options.webDir || webDirectory);
      const target = await realpath5(join9(web, decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname.slice(1))));
      const rel = relative4(web, target);
      if (rel.startsWith("..") || isAbsolute4(rel)) return fail(403, "Invalid path");
      const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".json": "application/json; charset=utf-8" };
      res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      res.writeHead(200, { "Content-Type": types[extname(target)] || "application/octet-stream" });
      res.end(await readFile9(target));
    } catch (e) {
      res.writeHead(e.code === "ENOENT" ? 404 : 500);
      res.end("Resource unavailable");
    }
  });
  await collect(root);
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      done();
    });
  }).catch((e) => {
    if (e.code === "EADDRINUSE") throw new Error(`Port ${options.port} is in use. Choose --port NUMBER.`);
    throw e;
  });
  const timer = setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      await collect(root);
      const events = streams.size ? await allEvents(root) : [];
      for (const res of streams) {
        for (const e of events) if ((e.seq || 0) > res.lastSeq) {
          if (res.writableLength > 1024 * 1024) {
            res.destroy();
            break;
          }
          res.write(`id: ${e.seq}
data: ${JSON.stringify(e)}

`);
          res.lastSeq = e.seq;
        }
        res.write(": heartbeat\n\n");
      }
    } catch {
      for (const res of streams) res.destroy();
      streams.clear();
    } finally {
      ticking = false;
    }
  }, 300);
  return { port: server.address().port, token, close: async () => {
    clearInterval(timer);
    for (const s of streams) s.end();
    server.closeAllConnections();
    await new Promise((done) => server.close(() => done()));
  } };
}

// src/cli.ts
function args(v) {
  const options = {};
  const positional = [];
  for (let i = 0; i < v.length; i++) {
    if (v[i].startsWith("--")) options[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith("--") ? v[++i] : "true";
    else positional.push(v[i]);
  }
  return { options, positional };
}
async function stdin() {
  let s = "";
  for await (const chunk of process.stdin) {
    s += chunk;
    if (s.length > 1024 * 1024) throw new Error("Input too large");
  }
  return s;
}
async function run(argv = process.argv.slice(2)) {
  const { options: o, positional: p } = args(argv), command = p[0] || "help", root = resolve7(o.project || process.cwd());
  if (command === "hook") {
    try {
      const input = JSON.parse(await stdin());
      const project = await findProject(input);
      if (project) await captureHook(project, input);
    } catch {
      process.stderr.write("HandoffFM: recording gap; tool execution is unaffected.\n");
    }
    return 0;
  }
  if (command === "init") {
    const cfg = await initProject(root);
    if (o["dsh-command"]) cfg.dshCommand = o["dsh-command"];
    const bound = o["bind-session"];
    if (bound && !cfg.boundSessions.includes(bound)) cfg.boundSessions.push(bound);
    await writeFile7(join10(dir(root), "config.json"), JSON.stringify(cfg, null, 2) + "\n");
    await register(root);
    console.log(`Enabled ${root}
Next: install the Codex plugin, review/trust its hooks, then run handoff-fm watch.
Only new recorded activity can be replayed.`);
    return 0;
  }
  if (command === "doctor") {
    const cfg = await loadConfig(root);
    const rows = await allEvents(root);
    const node = process.versions.node.split(".").map(Number);
    const nodeOK = node[0] > 22 || node[0] === 22 && node[1] >= 12;
    const s = commandSpec(cfg.dshCommand || "dsh", ["headless", "--help"]);
    const help = spawnSync3(s.command, s.args, { ...s.options, encoding: "utf8", timeout: 1e4 });
    const jsonOK = help.status === 0 && help.stdout.includes("--json");
    const received = rows.some((x) => x.actor === "codex" && x.kind === "tool.started");
    console.log(JSON.stringify({ node: nodeOK ? "ok" : "Node 22.12+ required", deepseekJSON: jsonOK ? "ok" : "not available", codexHooks: received ? "observed" : "not yet verified", project: root }, null, 2));
    return nodeOK && jsonOK ? 0 : 1;
  }
  if (command === "collect") {
    await collect(root);
    console.log(JSON.stringify(await allEvents(root), null, 2));
    return 0;
  }
  if (command === "watch") {
    await loadConfig(root);
    const port = Number(o.port || 4417);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");
    const server = await startWatch(root, { port });
    console.log(`HandoffFM watching enabled project
http://127.0.0.1:${server.port}/#token=${server.token}
Keep this process running. The URL grants access to local records; do not share it.`);
    const stop = () => server.close().then(() => process.exit(0));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    return 0;
  }
  if (command === "export") {
    if (!p[1] || !o.output) throw new Error("Use export RUN --output PATH [--prompts --paths --diffs --outputs] [--confirm]");
    await collect(root);
    const selection = { ...DEFAULT_SHARE };
    for (const key of Object.keys(selection)) selection[key] = o[key] === "true";
    const events = await readRun(root, p[1]);
    if (!events.length) throw new Error("Run has no recorded events");
    const output = resolve7(o.output), preview = o.confirm === "true" ? output : output + ".preview.html";
    await writeFile7(preview, await offlineHTML(webDirectory, events, selection), { flag: "wx" });
    console.log(`Offline ${o.confirm === "true" ? "export" : "preview"}: ${preview}
Included: ${Object.entries(selection).filter(([, v]) => v).map(([k]) => k).join(", ") || "roles, generic event types and relative timing only"}.
Review selected content for secrets. Automatic masking cannot find everything.${o.confirm === "true" ? "" : "\nAfter reviewing, repeat the same command with --confirm to export."}`);
    return 0;
  }
  if (command === "delegate") {
    if (p[1] !== "deepseek" || !o["task-file"] || !o["parent-session"]) throw new Error("Use delegate deepseek --task-file PATH --title TITLE --parent-session ID [--parent-turn ID]");
    return delegate(root, { taskFile: resolve7(root, o["task-file"]), title: o.title || "Delegated task", parentSession: o["parent-session"], parentTurn: o["parent-turn"], sessionId: o["session-id"] });
  }
  console.log("HandoffFM 0.1.0\ninit | doctor | watch | delegate deepseek | export\nUse --project PATH to select an enabled project.");
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve7(process.argv[1])).href) run().then((code2) => {
  process.exitCode = code2;
}).catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
export {
  run
};
