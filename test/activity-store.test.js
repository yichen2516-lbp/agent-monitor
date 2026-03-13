const test = require('node:test');
const assert = require('node:assert/strict');
const { createActivityStore } = require('../server/store/activity-store');

test('activity store enforces limits and supports since filtering', () => {
  const store = createActivityStore({ maxActivities: 3, maxCronActivities: 2, activityMaxAgeHours: 24 });

  store.append([
    { timestamp: '2026-03-13T05:00:00.000Z', type: 'reply', sessionName: 'a' },
    { timestamp: '2026-03-13T05:01:00.000Z', type: 'reply', sessionName: 'b' },
    { timestamp: '2026-03-13T05:02:00.000Z', type: 'reply', sessionName: 'c' },
    { timestamp: '2026-03-13T05:03:00.000Z', type: 'reply', sessionName: 'd' }
  ], 'session', '/tmp/session.jsonl');

  const all = store.getStatus();
  assert.equal(all.length, 3);
  assert.equal(all[0].sessionName, 'd');
  assert.equal(all[2].sessionName, 'b');

  const since = store.getStatus('2026-03-13T05:01:30.000Z');
  assert.equal(since.length, 2);
  assert.equal(since[0].sessionName, 'd');
  assert.equal(since[1].sessionName, 'c');
});
