const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseCronLine } = require('../server/parsers/cron-parser');

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'cron-run.jsonl'), 'utf8').trim();

test('cron parser parses cron runs', () => {
  const items = parseCronLine(fixture);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'cron');
  assert.equal(items[0].agent, 'main');
  assert.equal(items[0].sessionName, 'abcd1234');
  assert.match(items[0].description, /Heartbeat completed/);
  assert.equal(items[0].durationMs, 4200);
});
