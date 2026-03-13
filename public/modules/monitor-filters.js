window.AgentMonitor = window.AgentMonitor || {};

window.AgentMonitor.filters = {
  SLOW_THRESHOLD_MS: 3000,

  isErrorActivity(activity) {
    if (!activity) return false;
    if (activity.type === 'tool' && (activity.toolError || activity.exitCode > 0)) return true;
    if (activity.type === 'cron' && activity.status === 'error') return true;
    return false;
  },

  isSlowActivity(activity) {
    return (activity?.durationMs || 0) > this.SLOW_THRESHOLD_MS;
  },

  isFailedToolActivity(activity) {
    return activity?.type === 'tool' && Number(activity.exitCode) > 0;
  },

  isToolErrorActivity(activity) {
    return activity?.type === 'tool' && !!activity.toolError;
  },

  isCronErrorActivity(activity) {
    return activity?.type === 'cron' && activity.status === 'error';
  },

  matchesQuickMode(activity, quickMode) {
    switch (quickMode) {
      case 'slow':
        return this.isSlowActivity(activity);
      case 'failed-tools':
        return this.isFailedToolActivity(activity);
      case 'tool-errors':
        return this.isToolErrorActivity(activity);
      case 'cron-errors':
        return this.isCronErrorActivity(activity);
      default:
        return true;
    }
  },

  getErrorSignature(activity) {
    if (!activity) return 'unknown';
    return [
      activity.tool || activity.type || 'unknown',
      activity.agent || 'unknown',
      activity.exitCode ?? 'na',
      activity.toolStatus || activity.status || 'unknown',
      (activity.error || activity.description || '').replace(/\s+/g, ' ').trim().slice(0, 140)
    ].join('|');
  },

  applyFilters(activities, refs) {
    const state = window.AgentMonitor.state;
    const agent = refs.filterAgentEl.value;
    const type = refs.filterTypeEl.value;
    const kw = (refs.filterKeywordEl.value || '').trim().toLowerCase();
    const onlyErrors = refs.filterErrorsOnlyEl.checked;

    return activities.filter(a => {
      if (agent !== 'all' && a.agent !== agent) return false;
      if (type !== 'all' && a.type !== type) return false;
      if (onlyErrors && !this.isErrorActivity(a)) return false;
      if (!this.matchesQuickMode(a, state.quickMode)) return false;

      if (kw) {
        const target = [a.description, a.tool, a.sessionName, a.agent, a.type, a.error]
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
      const key = this.getErrorSignature(a);
      const activityTs = new Date(a.timestamp).getTime();
      if (!groups.has(key)) {
        groups.set(key, {
          ...a,
          aggregateCount: 1,
          groupedItems: [a],
          latestTs: activityTs,
          firstSeenTs: activityTs,
          aggregateLabel: `${a.tool || a.type} · ${a.agent || 'unknown'}`
        });
      } else {
        const g = groups.get(key);
        g.aggregateCount += 1;
        g.groupedItems.push(a);
        g.firstSeenTs = Math.min(g.firstSeenTs, activityTs);
        if (activityTs > g.latestTs) {
          const count = g.aggregateCount;
          const groupedItems = g.groupedItems;
          const firstSeenTs = g.firstSeenTs;
          Object.assign(g, a, { aggregateCount: count, groupedItems, firstSeenTs, latestTs: activityTs, aggregateLabel: g.aggregateLabel });
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
    const slowCalls = (allActivities || []).filter(a => this.isSlowActivity(a)).length;

    refs.metricActiveSessionsEl.textContent = activeSessions.size;
    refs.metricErrors5mEl.textContent = errors5m;
    refs.metricSlowCallsEl.textContent = slowCalls;
    refs.metricVisibleEl.textContent = visibleActivities.length;
  }
};
