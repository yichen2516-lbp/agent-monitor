window.AgentMonitor = window.AgentMonitor || {};

window.AgentMonitor.filters = {
  isErrorActivity(activity) {
    if (!activity) return false;
    if (activity.type === 'tool' && (activity.toolError || activity.exitCode > 0)) return true;
    if (activity.type === 'cron' && activity.status === 'error') return true;
    return false;
  },

  applyFilters(activities, refs) {
    const agent = refs.filterAgentEl.value;
    const type = refs.filterTypeEl.value;
    const kw = (refs.filterKeywordEl.value || '').trim().toLowerCase();
    const onlyErrors = refs.filterErrorsOnlyEl.checked;

    return activities.filter(a => {
      if (agent !== 'all' && a.agent !== agent) return false;
      if (type !== 'all' && a.type !== type) return false;
      if (onlyErrors && !this.isErrorActivity(a)) return false;

      if (kw) {
        const target = [a.description, a.tool, a.sessionName, a.agent, a.type]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!target.includes(kw)) return false;
      }
      return true;
    });
  },

  aggregateErrorActivities(activities) {
    const state = window.AgentMonitor.state;
    if (!state.errorAggregateMode) return activities;

    const groups = new Map();
    const passthrough = [];

    for (const a of activities) {
      if (!this.isErrorActivity(a)) {
        passthrough.push(a);
        continue;
      }
      const key = [a.agent, a.type, a.tool || '', (a.description || '').slice(0, 120)].join('|');
      if (!groups.has(key)) {
        groups.set(key, { ...a, aggregateCount: 1, latestTs: new Date(a.timestamp).getTime() });
      } else {
        const g = groups.get(key);
        g.aggregateCount += 1;
        const t = new Date(a.timestamp).getTime();
        if (t > g.latestTs) {
          Object.assign(g, a, { aggregateCount: g.aggregateCount, latestTs: t });
        }
      }
    }

    return [...passthrough, ...Array.from(groups.values())]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  updateMetrics(allActivities, visibleActivities, refs) {
    const now = Date.now();
    const fiveMinAgo = now - 5 * 60 * 1000;

    const activeSessions = new Set((allActivities || []).map(a => a.sessionName).filter(Boolean));
    const errors5m = (allActivities || []).filter(a => {
      const t = new Date(a.timestamp).getTime();
      return t >= fiveMinAgo && this.isErrorActivity(a);
    }).length;
    const slowCalls = (allActivities || []).filter(a => (a.durationMs || 0) > 3000).length;

    refs.metricActiveSessionsEl.textContent = activeSessions.size;
    refs.metricErrors5mEl.textContent = errors5m;
    refs.metricSlowCallsEl.textContent = slowCalls;
    refs.metricVisibleEl.textContent = visibleActivities.length;
  }
};
