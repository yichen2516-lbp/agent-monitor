const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('../public/modules/monitor-formatters.js');

const formatters = window.AgentMonitor.formatters;

test('formatUsageBadge prefers input/output over total-only display', () => {
  assert.equal(formatters.formatUsageBadge({ input: 1200, output: 34, totalTokens: 1234 }), 'IN 1,200 · OUT 34');
  assert.equal(formatters.formatUsageBadge({ totalTokens: 88 }), 'TOTAL 88');
  assert.equal(formatters.formatUsageBadge(null), null);
});
