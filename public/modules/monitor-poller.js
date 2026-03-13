window.AgentMonitor = window.AgentMonitor || {};

window.AgentMonitor.poller = {
  getLatestActivityTimestamp(activities) {
    if (!Array.isArray(activities) || activities.length === 0) return null;
    return activities.reduce((latest, activity) => {
      const ts = activity?.timestamp;
      if (!ts) return latest;
      if (!latest) return ts;
      return new Date(ts).getTime() > new Date(latest).getTime() ? ts : latest;
    }, null);
  },
  switchToFastMode() {
    const state = window.AgentMonitor.state;

    state.currentInterval = state.POLL_CONFIG.fastInterval;

    if (state.intervalId) clearInterval(state.intervalId);
    state.intervalId = setInterval(() => this.poll(), state.currentInterval);

    if (state.fastModeTimer) clearTimeout(state.fastModeTimer);
    state.fastModeTimer = setTimeout(() => {
      state.currentInterval = state.POLL_CONFIG.defaultInterval;
      if (state.intervalId) clearInterval(state.intervalId);
      state.intervalId = state.pollingEnabled ? setInterval(() => this.poll(), state.currentInterval) : null;
    }, state.POLL_CONFIG.fastDuration);
  },

  mergeIncomingActivities(incoming, refs) {
    const state = window.AgentMonitor.state;
    const render = window.AgentMonitor.render;
    const formatters = window.AgentMonitor.formatters;

    if (!Array.isArray(incoming) || incoming.length === 0) return;

    incoming.forEach((activity) => state.newFlashKeys.add(formatters.getActivityKey(activity)));
    const merged = [...incoming, ...state.latestActivities]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const dedup = [];
    const seen = new Set();
    for (const activity of merged) {
      const key = formatters.getActivityKey(activity);
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(activity);
      if (dedup.length >= 300) break;
    }

    render.updateList(dedup, refs);
  },

  async poll() {
    const state = window.AgentMonitor.state;
    const refs = window.AgentMonitor.dom.getRefs();
    const render = window.AgentMonitor.render;
    const systemPanel = window.AgentMonitor.systemPanel;

    try {
      state.pollCount += 1;

      const sinceQuery = state.lastServerTimestamp ? ('&since=' + encodeURIComponent(state.lastServerTimestamp)) : '';
      const res = await fetch('/api?t=' + Date.now() + sinceQuery, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });

      if (!res.ok) throw new Error('HTTP ' + res.status);

      const data = await res.json();
      const hadCursor = !!state.lastServerTimestamp;
      state.connectionMode = 'polling';

      render.updateAgents(data.agents || [], refs);
      state.sessionStatuses = data.sessionStatuses || [];
      render.updateAgentStatuses(data.agentStatuses || {}, refs);
      render.updateConnectionStatus(refs);

      const incoming = data.activities || [];
      const latestActivityTimestamp = this.getLatestActivityTimestamp(incoming);
      if (!hadCursor) {
        render.updateList(incoming, refs);
      } else if (incoming.length > 0) {
        this.mergeIncomingActivities(incoming, refs);
      }

      if (latestActivityTimestamp) {
        state.lastServerTimestamp = latestActivityTimestamp;
      } else if (!state.lastServerTimestamp && data.updatedAt) {
        state.lastServerTimestamp = data.updatedAt;
      }

      systemPanel.update(data.system);
    } catch (err) {
      console.error('[Agent-Monitor] 请求失败:', err.message);
    }
  },

  setPolling(enabled) {
    const state = window.AgentMonitor.state;
    state.pollingEnabled = enabled;

    if (!enabled) {
      if (state.intervalId) clearInterval(state.intervalId);
      state.intervalId = null;
      return;
    }

    if (!state.intervalId) {
      state.intervalId = setInterval(() => this.poll(), state.currentInterval);
    }
  },

  connectWebSocket() {
    const state = window.AgentMonitor.state;
    const refs = window.AgentMonitor.dom.getRefs();
    const render = window.AgentMonitor.render;
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      state.ws = ws;

      ws.addEventListener('open', () => {
        console.log('[Agent-Monitor] WebSocket connected');
        state.wsConnected = true;
        state.wsRetryCount = 0;
        state.connectionMode = 'ws-live';
        render.updateConnectionStatus(refs);
        this.setPolling(false);
      });

      ws.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message?.event === 'activities') {
            const activities = message.payload?.activities || [];
            const statuses = message.payload?.agentStatuses || {};
            state.sessionStatuses = message.payload?.sessionStatuses || [];
            this.mergeIncomingActivities(activities, refs);
            render.updateAgentStatuses(statuses, refs);
            state.connectionMode = 'ws-live';
            render.updateConnectionStatus(refs);
            const latestTimestamp = this.getLatestActivityTimestamp(activities);
            if (latestTimestamp) state.lastServerTimestamp = latestTimestamp;
            return;
          }

          if (message?.event === 'connected') {
            state.connectionMode = 'ws-live';
            render.updateAgents(state.latestAgents || [], refs);
            render.updateConnectionStatus(refs);
          }
        } catch (err) {
          console.warn('[Agent-Monitor] WS message parse failed:', err.message);
        }
      });

      ws.addEventListener('close', () => {
        console.warn('[Agent-Monitor] WebSocket closed, fallback to polling');
        state.wsConnected = false;
        state.connectionMode = 'polling';
        render.updateConnectionStatus(refs);
        this.setPolling(true);
        const retryDelay = Math.min(10000, 1000 * Math.max(1, state.wsRetryCount + 1));
        state.wsRetryCount += 1;
        setTimeout(() => this.connectWebSocket(), retryDelay);
      });

      ws.addEventListener('error', (err) => {
        console.warn('[Agent-Monitor] WebSocket error:', err.message || 'unknown');
      });
    } catch (err) {
      console.warn('[Agent-Monitor] WebSocket init failed:', err.message);
      state.connectionMode = 'polling';
      render.updateConnectionStatus(refs);
      this.setPolling(true);
    }
  },

  start() {
    this.poll().then(() => {
      this.setPolling(true);
      this.connectWebSocket();
    });
  }
};
