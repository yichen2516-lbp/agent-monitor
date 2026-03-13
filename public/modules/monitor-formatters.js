window.AgentMonitor = window.AgentMonitor || {};

window.AgentMonitor.formatters = {
  formatTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  },

  formatDuration(ms) {
    if (!ms) return null;
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  },

  normalizeUsage(usage) {
    if (!usage || typeof usage !== 'object') return null;
    const input = Number(usage.input ?? usage.inputTokens ?? usage.input_tokens ?? 0) || 0;
    const output = Number(usage.output ?? usage.outputTokens ?? usage.output_tokens ?? 0) || 0;
    const total = Number(usage.totalTokens ?? usage.total_tokens ?? (input + output)) || 0;
    const cacheRead = Number(usage.cacheRead ?? usage.cache_read ?? 0) || 0;
    const cacheWrite = Number(usage.cacheWrite ?? usage.cache_write ?? 0) || 0;
    if (!input && !output && !total && !cacheRead && !cacheWrite) return null;
    return { input, output, total, cacheRead, cacheWrite };
  },

  formatTokens(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return numeric.toLocaleString();
  },

  getActivityKey(activity) {
    return [
      activity.timestamp,
      activity.agent,
      activity.sessionName,
      activity.type,
      activity.tool || '',
      activity.description || ''
    ].join('|');
  },

  randomCodeLine() {
    const parts = [
      'exec --json', 'poll interval=1000', 'session.main', 'agent.cool', 'tool.browser.snapshot',
      'error.aggregate=true', 'retry=1 backoff=250ms', 'openclaw status --deep', 'model=k2p5',
      'usage.total_tokens', 'exit_code=0', 'cron.tick', 'ws://localhost:3450'
    ];
    const n = 3 + Math.floor(Math.random() * 4);
    let out = [];
    for (let i = 0; i < n; i++) {
      out.push(parts[Math.floor(Math.random() * parts.length)]);
    }
    return out.join('  ·  ');
  }
};
