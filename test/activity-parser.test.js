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

test('activity parser assigns usage to the reply cell instead of duplicating it across split assistant items', () => {
  const parser = createActivityParser({ toolCallState: createToolCallState() });
  const line = JSON.stringify({
    type: 'message',
    timestamp: '2026-03-13T05:00:00.000Z',
    message: {
      role: 'assistant',
      model: 'gpt-5.4',
      usage: { input: 10, output: 20, totalTokens: 30 },
      content: [
        { type: 'thinking', thinking: 'Planning' },
        { type: 'text', text: 'Hello' },
        { type: 'toolCall', id: 'tool-1', name: 'exec', arguments: { command: 'echo hi' } }
      ]
    }
  });

  const all = parser.parseLine(line, 'main', 'session-usage') || [];
  assert.equal(all.length, 3);
  assert.equal(all[0].usage, null);
  assert.deepEqual(all[1].usage, { input: 10, output: 20, totalTokens: 30 });
  assert.equal(all[2].usage, null);
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

test('activity parser surfaces assistant provider errors as reply error events', () => {
  const parser = createActivityParser({ toolCallState: createToolCallState() });
  const line = JSON.stringify({
    type: 'message',
    timestamp: '2026-03-13T11:50:01.360Z',
    message: {
      role: 'assistant',
      content: [],
      provider: 'opencode',
      model: 'gpt-5.4',
      stopReason: 'error',
      errorMessage: 'An error occurred while processing your request. Please include request ID abc.'
    }
  });

  const all = parser.parseLine(line, 'main', 'session3') || [];

  assert.equal(all.length, 1);
  assert.equal(all[0].type, 'reply');
  assert.equal(all[0].status, 'error');
  assert.equal(all[0].stopReason, 'error');
  assert.match(all[0].description, /An error occurred while processing your request/);
  assert.match(all[0].error, /request ID abc/);
});
