import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanText} from '../src/privacy';
import {safeId,validEvent} from '../src/store';
test('missing IDs cannot be coerced into valid identifiers',()=>{
 assert.equal(safeId(undefined as any),false);assert.equal(safeId(null as any),false);
 assert.equal(validEvent({version:1,actor:'codex',kind:'tool.started',sessionId:'s',evidence:'observed',at:new Date().toISOString(),data:{}} as any),false);
});
test('quoted JSON and common camelCase assignments are masked in snapshot text',()=>{
 assert.doesNotMatch(cleanText('{"api_key": "abc secret", "password":"do not share"}\nconst apiKey="abc-key"; ACCESS_TOKEN=private'),/abc secret|do not share|abc-key|private/);
});
