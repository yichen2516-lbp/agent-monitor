window.AgentMonitor = window.AgentMonitor || {};

window.AgentMonitor.dom = {
  getRefs() {
    return {
      listEl: document.getElementById('activity-list'),
      agentsEl: document.getElementById('agents-list'),
      bgCodeEl: document.getElementById('bg-code'),
      filterAgentEl: document.getElementById('filter-agent'),
      filterTypeEl: document.getElementById('filter-type'),
      filterKeywordEl: document.getElementById('filter-keyword'),
      filterErrorsOnlyEl: document.getElementById('filter-errors-only'),
      toggleErrorAggregateEl: document.getElementById('toggle-error-aggregate'),
      quickResetFiltersEl: document.getElementById('quick-reset-filters'),
      metricActiveSessionsEl: document.getElementById('metric-active-sessions'),
      metricErrors5mEl: document.getElementById('metric-errors-5m'),
      metricSlowCallsEl: document.getElementById('metric-slow-calls'),
      metricVisibleEl: document.getElementById('metric-visible'),
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
