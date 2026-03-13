function parseCronLine(line) {
  try {
    const data = JSON.parse(line);
    if (!data.ts) return null;

    const timestamp = new Date(data.ts).toISOString();
    const status = data.status || 'unknown';
    const summary = data.summary || '';
    const error = data.error || '';
    const durationMs = data.durationMs;
    const duration = durationMs ? `(${Math.round(durationMs / 1000)}s)` : '';
    const usage = data.usage;

    let agentName = 'cron';
    let sessionName = '';
    if (data.sessionKey) {
      const match = data.sessionKey.match(/agent:([^:]+):/);
      if (match) agentName = match[1];
      const sessionMatch = data.sessionKey.match(/:run:([^:]+)/);
      if (sessionMatch) sessionName = sessionMatch[1].slice(0, 8);
    }

    const statusEmoji = status === 'ok' ? '✅' : status === 'error' ? '❌' : '⏳';
    return [{
      type: 'cron',
      agent: agentName,
      sessionName: sessionName || 'cron',
      tool: 'cron',
      description: `${statusEmoji} ${duration} ${summary}`,
      timestamp,
      status,
      fullSummary: summary,
      error,
      durationMs,
      usage
    }];
  } catch (_) {
    return null;
  }
}

module.exports = { parseCronLine };
