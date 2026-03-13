const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createToolCallState } = require('../server/parsers/tool-call-state');
const { createActivityParser } = require('../server/parsers/activity-parser');

function readFixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8').trim().split('\n');
}

test('activity parser parses new message format with tool pairing', () => {
  const parser = createActivityParser({ toolCallState: createToolCallState() });
  const lines = readFixture('session-new-format.jsonl');

  const all = lines.flatMap(line => parser.parseLine(line, 'main', 'session1') || []);

  assert.equal(all.length, 4);
  assert.equal(all[0].type, 'thinking');
  assert.equal(all[1].type, 'reply');
  assert.equal(all[2].type, 'tool');
  assert.match(all[2].description, /🔧 exec/);
  assert.equal(all[3].type, 'tool');
  assert.match(all[3].description, /🔍 exec/);
  assert.equal(all[3].durationMs, 123);
  assert.equal(all[3].exitCode, 0);
  assert.equal(all[0].model, 'gpt-5.4');
});

test('activity parser parses legacy format', () => {
  const parser = createActivityParser({ toolCallState: createToolCallState() });
  const lines = readFixture('session-old-format.jsonl');

  const all = lines.flatMap(line => parser.parseLine(line, 'main', 'session2') || []);

  assert.equal(all.length, 3);
  assert.match(all[0].description, /🔧 read/);
  assert.match(all[1].description, /🔍 read/);
  assert.equal(all[1].exitCode, 0);
  assert.equal(all[2].type, 'reply');
  assert.equal(all[2].fullText, 'Done');
});
