window.AgentMonitor = window.AgentMonitor || {};

window.AgentMonitor.state = {
  latestActivities: [],
  errorAggregateMode: false,
  pollCount: 0,
  lastRenderedSignature: '',
  lastServerTimestamp: null,
  newFlashKeys: new Set(),
  currentInterval: 5000,
  fastModeTimer: null,
  intervalId: null,
  quickMode: 'all',
  STORAGE_KEY: 'agent-monitor.ui-state.v2',
  POLL_CONFIG: {
    defaultInterval: 5000,
    fastInterval: 1000,
    fastDuration: 10000
  }
};
