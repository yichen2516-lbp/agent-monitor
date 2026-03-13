const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSessionStatusTracker,
  normalizeSessionStatus
} = require('../server/monitor-store');

test('session status tracker derives session-first statuses and agent summary', () => {
  const tracker = createSessionStatusTracker();

  tracker.applyActivities([
    {
      type: 'thinking',
      agent: 'main',
      sessionName: 'sess-a',
      timestamp: '2026-03-13T10:00:00.000Z',
      model: 'gpt-5.4'
    },
    {
      type: 'tool',
      agent: 'main',
      sessionName: 'sess-b',
      timestamp: '2026-03-13T10:00:01.000Z',
      tool: 'exec',
      description: '🔧 exec {"command":"echo hi"}'
    }
  ]);

  const sessionStatuses = tracker.getSessionStatuses(new Date('2026-03-13T10:00:04.500Z').getTime());
  assert.equal(sessionStatuses.length, 2);
  assert.equal(sessionStatuses[0].sessionName, 'sess-b');
  assert.equal(sessionStatuses[0].code, 'tool-running');
  assert.equal(sessionStatuses[0].tool, 'exec');
  assert.equal(sessionStatuses[1].code, 'waiting-model');

  const agentStatuses = tracker.getAgentStatuses(new Date('2026-03-13T10:00:04.500Z').getTime());
  assert.equal(agentStatuses.main.sessionName, 'sess-b');
  assert.equal(agentStatuses.main.code, 'tool-running');
});

test('normalizeSessionStatus turns terminal states into idle after timeout', () => {
  const normalized = normalizeSessionStatus({
    agent: 'main',
    sessionName: 'sess-a',
    code: 'reply-done',
    label: 'Reply ready',
    isTerminal: true,
    updatedAt: '2026-03-13T10:00:00.000Z',
    stateStartedAt: '2026-03-13T10:00:00.000Z'
  }, new Date('2026-03-13T10:00:20.000Z').getTime());

  assert.equal(normalized.code, 'idle');
  assert.equal(normalized.label, 'Idle');
  assert.ok(normalized.durationMs >= 19000);
});
