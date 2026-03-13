window.AgentMonitor = window.AgentMonitor || {};

window.AgentMonitor.render = {
  openDetail(activity) {
    const detail = {
      timestamp: activity.timestamp,
      agent: activity.agent,
      sessionName: activity.sessionName,
      type: activity.type,
      tool: activity.tool,
      description: activity.description,
      model: activity.model,
      usage: activity.usage,
      durationMs: activity.durationMs,
      exitCode: activity.exitCode,
      status: activity.status,
      source: activity.source
    };

    const dom = window.AgentMonitor.dom;
    const detailBodyEl = dom.getDetailBodyEl();
    const detailDrawerEl = dom.getDetailDrawerEl();
    if (!detailBodyEl || !detailDrawerEl) return;

    detailBodyEl.innerHTML = '<pre>' + JSON.stringify(detail, null, 2) + '</pre>';
    detailDrawerEl.classList.add('open');
    document.getElementById('drawer-overlay')?.classList.add('open');
  },

  createActivityItem(activity) {
    const state = window.AgentMonitor.state;
    const formatters = window.AgentMonitor.formatters;
    const filters = window.AgentMonitor.filters;

    const div = document.createElement('div');
    const agentClass = (activity.agent || 'unknown').toUpperCase();
    const activityKey = formatters.getActivityKey(activity);
    div.className = 'activity-item ' + agentClass;

    if (state.newFlashKeys.has(activityKey)) {
      div.classList.add('feed-new');
      state.newFlashKeys.delete(activityKey);
    }
    if (activity.type === 'thinking') div.classList.add('thinking');
    if (activity.type === 'reply') div.classList.add('reply');
    if (activity.type === 'cron') div.classList.add('cron');
    if (filters.isErrorActivity(activity)) div.classList.add('error-item');

    const meta = document.createElement('div');
    meta.className = 'meta';

    const time = document.createElement('span');
    time.className = 'timestamp';
    time.textContent = formatters.formatTime(activity.timestamp);

    const agent = document.createElement('span');
    agent.className = 'agent-name ' + agentClass;
    agent.textContent = activity.agent || '?';

    const session = document.createElement('span');
    session.className = 'session-name';
    session.textContent = activity.sessionName || '-';

    meta.appendChild(time);
    meta.appendChild(agent);
    meta.appendChild(session);

    if (activity.type === 'cron') {
      const cronTag = document.createElement('span');
      cronTag.className = 'cron-tag';
      cronTag.textContent = 'CRON';
      meta.appendChild(cronTag);
    }

    const desc = document.createElement('div');
    desc.className = 'description';
    desc.textContent = activity.description || '';

    div.appendChild(meta);
    div.appendChild(desc);

    const detailsRow = document.createElement('div');
    detailsRow.className = 'details-row';

    if (activity.model) {
      const modelTag = document.createElement('span');
      modelTag.className = 'model-tag';
      modelTag.textContent = activity.model;
      detailsRow.appendChild(modelTag);
    }

    if (activity.usage) {
      const tokenTag = document.createElement('span');
      tokenTag.className = 'token-tag';
      tokenTag.textContent = '⚡ ' + formatters.formatTokens(activity.usage) + ' tokens';
      detailsRow.appendChild(tokenTag);
    }

    if (activity.durationMs) {
      const durationTag = document.createElement('span');
      durationTag.className = 'duration-tag';
      durationTag.textContent = '⏱️ ' + formatters.formatDuration(activity.durationMs);
      detailsRow.appendChild(durationTag);
    }

    if (activity.type === 'tool' && activity.exitCode !== undefined) {
      const exitCodeTag = document.createElement('span');
      exitCodeTag.className = 'exitcode-tag ' + (activity.exitCode === 0 ? 'success' : 'error');
      exitCodeTag.textContent = 'Exit: ' + activity.exitCode;
      detailsRow.appendChild(exitCodeTag);
    }

    if (detailsRow.children.length > 0) {
      div.appendChild(detailsRow);
    }

    if (activity.aggregateCount && activity.aggregateCount > 1) {
      const badge = document.createElement('span');
      badge.className = 'aggregate-badge';
      badge.textContent = activity.aggregateCount + 'x';
      meta.appendChild(badge);
    }

    div.addEventListener('click', () => this.openDetail(activity));
    return div;
  },

  updateAgents(agents, refs) {
    const uiState = window.AgentMonitor.uiState;

    refs.agentsEl.innerHTML = '';
    agents.forEach(agent => {
      const tag = document.createElement('span');
      tag.className = 'agent-tag';
      tag.textContent = agent;
      refs.agentsEl.appendChild(tag);
    });

    const savedAgent = uiState.getSavedAgent();
    const current = refs.filterAgentEl.value || savedAgent || 'all';
    refs.filterAgentEl.innerHTML = '<option value="all">All Agents</option>';
    agents.forEach(agent => {
      const op = document.createElement('option');
      op.value = agent;
      op.textContent = agent;
      refs.filterAgentEl.appendChild(op);
    });
    refs.filterAgentEl.value = agents.includes(current) ? current : 'all';
  },

  renderFilteredList(refs) {
    const state = window.AgentMonitor.state;
    const filters = window.AgentMonitor.filters;

    const filtered = filters.applyFilters(state.latestActivities, refs);
    const visible = filters.aggregateErrorActivities(filtered);
    refs.listEl.innerHTML = '';

    console.log('[Agent-Monitor] 更新列表:', visible.length, '/', state.latestActivities.length, 'activities');

    if (visible.length === 0) {
      refs.listEl.innerHTML = '<div class="empty">No activities under current filters</div>';
    } else {
      visible.forEach(activity => refs.listEl.appendChild(this.createActivityItem(activity)));
    }

    filters.updateMetrics(state.latestActivities, visible, refs);
  },

  updateList(activities, refs) {
    const state = window.AgentMonitor.state;
    const formatters = window.AgentMonitor.formatters;
    const filters = window.AgentMonitor.filters;

    state.latestActivities = activities || [];
    const signature = state.latestActivities.slice(0, 120).map(formatters.getActivityKey).join('||');
    if (signature === state.lastRenderedSignature) {
      filters.updateMetrics(
        state.latestActivities,
        filters.aggregateErrorActivities(filters.applyFilters(state.latestActivities, refs)),
        refs
      );
      return;
    }

    state.lastRenderedSignature = signature;
    this.renderFilteredList(refs);
  },

  initCodeBackground(refs) {
    const formatters = window.AgentMonitor.formatters;
    if (!refs.bgCodeEl) return;

    const streamCount = window.innerWidth < 900 ? 12 : 20;
    const streams = [];

    for (let i = 0; i < streamCount; i++) {
      const s = document.createElement('div');
      s.className = 'code-stream';
      s.style.left = ((i + 0.5) * (100 / streamCount)) + '%';
      s.style.animationDuration = (18 + Math.random() * 16).toFixed(1) + 's';
      s.style.animationDelay = (-Math.random() * 20).toFixed(1) + 's';
      s.style.opacity = (0.22 + Math.random() * 0.45).toFixed(2);
      s.textContent = formatters.randomCodeLine() + '\n' + formatters.randomCodeLine() + '\n' + formatters.randomCodeLine();
      refs.bgCodeEl.appendChild(s);
      streams.push(s);
    }

    setInterval(() => {
      const idx = Math.floor(Math.random() * streams.length);
      const s = streams[idx];
      if (!s) return;
      s.textContent = formatters.randomCodeLine() + '\n' + formatters.randomCodeLine() + '\n' + formatters.randomCodeLine();
    }, 2200);
  }
};
