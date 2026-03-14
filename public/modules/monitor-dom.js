window.AgentMonitor = window.AgentMonitor || {};

window.AgentMonitor.dom = {
  getRefs() {
    return {
      listEl: document.getElementById('activity-list'),
      agentsEl: document.getElementById('agents-list'),
      agentStatusListEl: document.getElementById('agent-status-list'),
      connectionPillEl: document.getElementById('connection-pill'),
      connectionDotEl: document.getElementById('connection-dot'),
      bgCodeEl: document.getElementById('bg-code'),
      filterAgentEl: document.getElementById('filter-agent'),
      filterTypeEl: document.getElementById('filter-type'),
      filterKeywordEl: document.getElementById('filter-keyword'),
      filterErrorsOnlyEl: document.getElementById('filter-errors-only'),
      toggleErrorAggregateEl: document.getElementById('toggle-error-aggregate'),
      quickFailedToolsEl: document.getElementById('quick-failed-tools'),
      quickToolErrorsEl: document.getElementById('quick-tool-errors'),
      quickCronErrorsEl: document.getElementById('quick-cron-errors'),
      quickResetFiltersEl: document.getElementById('quick-reset-filters'),
      metricActiveSessionsEl: document.getElementById('metric-active-sessions'),
      metricErrors5mEl: document.getElementById('metric-errors-5m'),
      metricSlowCallsEl: document.getElementById('metric-slow-calls'),
      metricVisibleEl: document.getElementById('metric-visible'),
      metricCardErrors5mEl: document.getElementById('metric-card-errors-5m'),
      metricCardSlowCallsEl: document.getElementById('metric-card-slow-calls'),
      sessionFocusBarEl: document.getElementById('session-focus-bar'),
      sessionFocusLabelEl: document.getElementById('session-focus-label'),
      sessionFocusClearEl: document.getElementById('session-focus-clear'),
      feedLoadMoreEl: document.getElementById('feed-load-more'),
      drawerOverlayEl: document.getElementById('drawer-overlay')
    };
  },

  getDetailDrawerEl() {
    return document.getElementById('detail-drawer');
  },

  getDetailBodyEl() {
    return document.getElementById('detail-body');
  }
};
