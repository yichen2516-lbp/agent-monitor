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

  formatTokens(usage) {
    if (!usage || typeof usage !== 'object') return null;
    let total = usage.totalTokens || usage.total_tokens;
    if (!total && (typeof usage.input === 'number' || typeof usage.output === 'number')) {
      total = (usage.input || 0) + (usage.output || 0);
    }
    if (!total || isNaN(total)) return null;
    return Number(total).toLocaleString();
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
