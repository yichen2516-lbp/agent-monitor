window.AgentMonitor = window.AgentMonitor || {};

window.AgentMonitor.state = {
  MAX_CLIENT_ACTIVITIES: 120,
  FEED_PAGE_SIZE: 50,
  feedVisibleCount: 50,
  latestActivities: [],
  errorAggregateMode: false,
  pollCount: 0,
  lastRenderedSignature: '',
  lastServerTimestamp: null,
  newFlashKeys: new Set(),
  currentInterval: 5000,
  fastModeTimer: null,
  intervalId: null,
  pollingEnabled: true,
  ws: null,
  wsConnected: false,
  wsRetryCount: 0,
  latestAgents: [],
  agentStatuses: {},
  sessionStatuses: [],
  selectedSessionKey: null,
  connectionMode: 'connecting',
  quickMode: 'all',
  STORAGE_KEY: 'agent-monitor.ui-state.v2',
  POLL_CONFIG: {
    defaultInterval: 5000,
    fastInterval: 1000,
    fastDuration: 10000
  }
};
