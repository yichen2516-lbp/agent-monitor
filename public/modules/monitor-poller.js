window.AgentMonitor = window.AgentMonitor || {};

window.AgentMonitor.poller = {
  switchToFastMode() {
    const state = window.AgentMonitor.state;

    console.log('[Agent-Monitor] 切换到快速模式 (1秒)');
    state.currentInterval = state.POLL_CONFIG.fastInterval;

    if (state.intervalId) clearInterval(state.intervalId);
    state.intervalId = setInterval(() => this.poll(), state.currentInterval);

    if (state.fastModeTimer) clearTimeout(state.fastModeTimer);
    state.fastModeTimer = setTimeout(() => {
      console.log('[Agent-Monitor] 恢复默认模式 (5秒)');
      state.currentInterval = state.POLL_CONFIG.defaultInterval;
      clearInterval(state.intervalId);
      state.intervalId = setInterval(() => this.poll(), state.currentInterval);
    }, state.POLL_CONFIG.fastDuration);
  },

  async poll() {
    const state = window.AgentMonitor.state;
    const refs = window.AgentMonitor.dom.getRefs();
    const render = window.AgentMonitor.render;
    const systemPanel = window.AgentMonitor.systemPanel;
    const formatters = window.AgentMonitor.formatters;

    try {
      state.pollCount += 1;
      console.log('[Agent-Monitor] 轮询 #' + state.pollCount + ' (间隔: ' + state.currentInterval + 'ms)');

      const sinceQuery = state.lastServerTimestamp ? ('&since=' + encodeURIComponent(state.lastServerTimestamp)) : '';
      const res = await fetch('/api?t=' + Date.now() + sinceQuery, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });

      if (!res.ok) throw new Error('HTTP ' + res.status);

      const data = await res.json();
      const activityCount = data.activities ? data.activities.length : 0;
      console.log('[Agent-Monitor] 收到数据:', activityCount, 'activities');

      const hadCursor = !!state.lastServerTimestamp;
      if (data.updatedAt) state.lastServerTimestamp = data.updatedAt;

      const incoming = data.activities || [];
      if (incoming.length > 0 && state.currentInterval !== state.POLL_CONFIG.fastInterval) {
        this.switchToFastMode();
      }

      render.updateAgents(data.agents || [], refs);

      if (!hadCursor) {
        render.updateList(incoming, refs);
      } else if (incoming.length > 0) {
        incoming.forEach(a => state.newFlashKeys.add(formatters.getActivityKey(a)));
        const merged = [...incoming, ...state.latestActivities]
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const dedup = [];
        const seen = new Set();
        for (const a of merged) {
          const k = formatters.getActivityKey(a);
          if (seen.has(k)) continue;
          seen.add(k);
          dedup.push(a);
          if (dedup.length >= 300) break;
        }
        render.updateList(dedup, refs);
      }

      systemPanel.update(data.system);
    } catch (err) {
      console.error('[Agent-Monitor] 请求失败:', err.message);
    }
  },

  start() {
    const state = window.AgentMonitor.state;
    this.poll();
    state.intervalId = setInterval(() => this.poll(), state.currentInterval);
    console.log('[Agent-Monitor] 轮询已启动, 默认间隔: 5秒, intervalId:', state.intervalId);
  }
};
