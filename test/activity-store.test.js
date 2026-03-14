const test = require('node:test');
const assert = require('node:assert/strict');
const { createActivityStore } = require('../server/store/activity-store');

test('activity store enforces limits and supports since filtering', () => {
  const store = createActivityStore({ maxActivities: 3, maxCronActivities: 2, activityMaxAgeHours: 24 });
  const baseMs = Date.now() - (5 * 60 * 1000);
  const ts = (offsetMinutes) => new Date(baseMs + offsetMinutes * 60 * 1000).toISOString();

  store.append([
    { timestamp: ts(0), type: 'reply', sessionName: 'a' },
    { timestamp: ts(1), type: 'reply', sessionName: 'b' },
    { timestamp: ts(2), type: 'reply', sessionName: 'c' },
    { timestamp: ts(3), type: 'reply', sessionName: 'd' }
  ], 'session', '/tmp/session.jsonl');

  const all = store.getStatus();
  assert.equal(all.length, 3);
  assert.equal(all[0].sessionName, 'd');
  assert.equal(all[2].sessionName, 'b');

  const since = store.getStatus(ts(1.5));
  assert.equal(since.length, 2);
  assert.equal(since[0].sessionName, 'd');
  assert.equal(since[1].sessionName, 'c');
});
