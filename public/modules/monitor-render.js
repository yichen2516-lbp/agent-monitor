window.AgentMonitor = window.AgentMonitor || {};

window.AgentMonitor.render = {
  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  formatValue(value) {
    if (value === undefined || value === null || value === '') return '—';
    if (typeof value === 'object') return this.escapeHtml(JSON.stringify(value, null, 2));
    return this.escapeHtml(String(value));
  },

  formatAbsoluteTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (isNaN(date.getTime())) return this.escapeHtml(String(value));
    return this.escapeHtml(date.toLocaleString('zh-CN', { hour12: false }));
  },

  formatStatusDuration(durationMs) {
    const ms = Number(durationMs || 0);
    if (!Number.isFinite(ms) || ms <= 0) return '0s';
    if (ms < 1000) return '<1s';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  },

  createSummaryRow(label, value, className = '') {
    return `<div class="detail-summary-row ${className}"><span class="detail-summary-label">${this.escapeHtml(label)}</span><span class="detail-summary-value">${this.formatValue(value)}</span></div>`;
  },

  getInvestigationVerdict(activity, recentSessionEvents = []) {
    const latestSessionEvent = recentSessionEvents[0] || activity;

    if (activity.type === 'reply' && (activity.status === 'error' || activity.stopReason === 'error' || activity.error)) {
      return {
        tone: 'error',
        title: 'Provider/API error surfaced before a normal reply',
        detail: activity.error || activity.fullText || activity.description || 'The provider returned an error before a usable assistant reply.'
      };
    }

    if (activity.type === 'tool' && (activity.toolError || Number(activity.exitCode) > 0)) {
      return {
        tone: 'error',
        title: 'Tool failed during session execution',
        detail: activity.error || activity.description || 'A tool call failed and likely interrupted normal reply flow.'
      };
    }

    if (activity.type === 'reply' && !activity.error && activity.stopReason !== 'error') {
      return {
        tone: 'success',
        title: 'Reply completed normally',
        detail: 'The session reached an assistant reply event without an explicit error on this step.'
      };
    }

    if (latestSessionEvent.type === 'thinking') {
      return {
        tone: 'pending',
        title: 'Session is still thinking or waiting on the model',
        detail: 'The latest visible event in this session is a thinking step; the run may still be in progress.'
      };
    }

    if (latestSessionEvent.type === 'tool' && latestSessionEvent.exitCode === undefined && !latestSessionEvent.toolError) {
      return {
        tone: 'pending',
        title: 'Session is in a tool execution phase',
        detail: latestSessionEvent.tool ? `Current tool context: ${latestSessionEvent.tool}` : 'A tool call has started and no terminal result is visible yet.'
      };
    }

    return {
      tone: 'neutral',
      title: 'No stronger verdict yet',
      detail: 'This event is visible and inspectable, but the monitor cannot safely infer a stronger conclusion from current session evidence.'
    };
  },

  getSessionRecentActivities(sessionKey, limit = 8) {
    const state = window.AgentMonitor.state;
    return (state.latestActivities || [])
      .filter(item => `${item.agent}:${item.sessionName || 'unknown'}` === sessionKey)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  },

  getDetailPayload(activity) {
    return {
      timestamp: activity.timestamp,
      agent: activity.agent,
      sessionName: activity.sessionName,
      type: activity.type,
      tool: activity.tool,
      description: activity.description,
      fullText: activity.fullText,
      model: activity.model,
      provider: activity.provider,
      usage: activity.usage,
      durationMs: activity.durationMs,
      exitCode: activity.exitCode,
      status: activity.status,
      toolStatus: activity.toolStatus,
      toolError: activity.toolError,
      stopReason: activity.stopReason,
      error: activity.error,
      source: activity.source,
      aggregateCount: activity.aggregateCount,
      aggregateLabel: activity.aggregateLabel,
      groupedItems: activity.groupedItems
    };
  },

  openDetail(activity) {
    const filters = window.AgentMonitor.filters;
    const formatters = window.AgentMonitor.formatters;
    const dom = window.AgentMonitor.dom;
    const detailBodyEl = dom.getDetailBodyEl();
    const detailDrawerEl = dom.getDetailDrawerEl();
    if (!detailBodyEl || !detailDrawerEl) return;

    const payload = this.getDetailPayload(activity);
    const sessionKey = `${activity.agent}:${activity.sessionName || 'unknown'}`;
    const recentSessionEvents = this.getSessionRecentActivities(sessionKey, 8);
    detailBodyEl.dataset.copyJson = JSON.stringify(payload, null, 2);
    detailBodyEl.dataset.copySource = activity.source || '';
    detailBodyEl.dataset.copySession = activity.sessionName || '';

    const normalizedUsage = formatters.normalizeUsage(activity.usage);
    const usageText = normalizedUsage?.total ? formatters.formatTokens(normalizedUsage.total) + ' tokens' : '—';
    const durationText = activity.durationMs ? formatters.formatDuration(activity.durationMs) : '—';
    const providerText = activity.provider || '—';
    const modelText = activity.model || '—';
    const stopReasonText = activity.stopReason || '—';
    const aggregateMeta = activity.aggregateCount > 1
      ? `Errors grouped: ${activity.aggregateCount}`
      : (filters.isErrorActivity(activity) ? 'Single error event' : '—');
    const errorKind = filters.isFailedToolActivity(activity)
      ? 'Failed Tool'
      : filters.isToolErrorActivity(activity)
        ? 'Tool Error'
        : filters.isCronErrorActivity(activity)
          ? 'Cron Error'
          : (filters.isErrorActivity(activity) ? 'Error' : '—');

    const groupedItemsHtml = Array.isArray(activity.groupedItems) && activity.groupedItems.length > 1
      ? `
        <section class="detail-section">
          <div class="detail-section-title">Grouped Events</div>
          <div class="grouped-events-list">${activity.groupedItems
            .slice()
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .map(item => `
              <div class="grouped-event-item">
                <div class="grouped-event-time">${this.formatAbsoluteTime(item.timestamp)}</div>
                <div class="grouped-event-text">${this.escapeHtml(item.description || item.error || '')}</div>
              </div>`)
            .join('')}</div>
        </section>`
      : '';

    const sameSessionHtml = recentSessionEvents.length > 0
      ? `
        <section class="detail-section">
          <div class="detail-section-title">Same Session Recent Timeline</div>
          <div class="same-session-timeline">${recentSessionEvents
            .map(item => {
              const itemKey = `${item.agent}:${item.sessionName || 'unknown'}`;
              const activeClass = item.timestamp === activity.timestamp && item.type === activity.type && item.description === activity.description
                ? ' is-current'
                : '';
              const eventKey = this.escapeHtml(`${item.timestamp}|${item.type}|${item.description || ''}`);
              return `
                <button class="same-session-item${activeClass}" type="button" data-session-focus="${this.escapeHtml(itemKey)}" data-open-activity="${eventKey}">
                  <div class="same-session-item-head">
                    <span class="same-session-time">${this.formatAbsoluteTime(item.timestamp)}</span>
                    <span class="same-session-type">${this.escapeHtml(item.type || 'event')}</span>
                  </div>
                  <div class="same-session-text">${this.escapeHtml(item.description || item.error || '')}</div>
                </button>`;
            })
            .join('')}</div>
        </section>`
      : '';

    const sessionEventCount = recentSessionEvents.length;
    const sourceFile = activity.source ? String(activity.source).split('/').pop() : '—';
    const verdict = this.getInvestigationVerdict(activity, recentSessionEvents);

    detailBodyEl.innerHTML = `
      <section class="detail-section">
        <div class="investigation-verdict investigation-verdict-${this.escapeHtml(verdict.tone)}">
          <div class="investigation-verdict-title">${this.escapeHtml(verdict.title)}</div>
          <div class="investigation-verdict-detail">${this.escapeHtml(verdict.detail)}</div>
        </div>
      </section>

      <section class="detail-section">
        <div class="detail-section-title">Overview</div>
        <div class="detail-summary-grid detail-summary-grid-3up">
          ${this.createSummaryRow('Time', this.formatAbsoluteTime(activity.timestamp))}
          ${this.createSummaryRow('Agent', activity.agent)}
          ${this.createSummaryRow('Session', activity.sessionName)}
          ${this.createSummaryRow('Type', activity.type)}
          ${this.createSummaryRow('Tool', activity.tool)}
          ${this.createSummaryRow('Recent Session Events', sessionEventCount)}
        </div>
      </section>

      <section class="detail-section">
        <div class="detail-section-title">Model & Usage</div>
        <div class="detail-summary-grid detail-summary-grid-3up">
          ${this.createSummaryRow('Provider', providerText)}
          ${this.createSummaryRow('Model', modelText)}
          ${this.createSummaryRow('Stop Reason', stopReasonText)}
          ${this.createSummaryRow('Usage Total', usageText)}
          ${this.createSummaryRow('Usage Input', normalizedUsage?.input ? formatters.formatTokens(normalizedUsage.input) : '—')}
          ${this.createSummaryRow('Usage Output', normalizedUsage?.output ? formatters.formatTokens(normalizedUsage.output) : '—')}
          ${this.createSummaryRow('Cache Read', normalizedUsage?.cacheRead ? formatters.formatTokens(normalizedUsage.cacheRead) : '—')}
          ${this.createSummaryRow('Cache Write', normalizedUsage?.cacheWrite ? formatters.formatTokens(normalizedUsage.cacheWrite) : '—')}
          ${this.createSummaryRow('Aggregate', aggregateMeta, activity.aggregateCount > 1 ? 'is-error' : '')}
        </div>
      </section>

      <section class="detail-section">
        <div class="detail-section-title">Execution & Source</div>
        <div class="detail-summary-grid detail-summary-grid-3up">
          ${this.createSummaryRow('Duration', durationText)}
          ${this.createSummaryRow('Exit Code', activity.exitCode ?? '—', activity.exitCode > 0 ? 'is-error' : '')}
          ${this.createSummaryRow('Tool Status', activity.toolStatus || activity.status)}
          ${this.createSummaryRow('Error Kind', errorKind, filters.isErrorActivity(activity) ? 'is-error' : '')}
          ${this.createSummaryRow('Source File', sourceFile)}
          ${this.createSummaryRow('Source Path', activity.source || '—')}
        </div>
      </section>

      <section class="detail-section">
        <div class="detail-section-title">Description</div>
        <pre>${this.escapeHtml(activity.fullText || activity.description || '')}</pre>
      </section>

      ${activity.error ? `
        <section class="detail-section">
          <div class="detail-section-title">Error</div>
          <pre class="detail-error-block">${this.escapeHtml(activity.error)}</pre>
        </section>` : ''}

      ${groupedItemsHtml}
      ${sameSessionHtml}

      <section class="detail-section">
        <div class="detail-section-title">Paths & Copy</div>
        <div class="detail-action-row">
          <button class="detail-copy-btn" data-copy-target="json">Copy Event JSON</button>
          <button class="detail-copy-btn" data-copy-target="source">Copy Source Path</button>
          <button class="detail-copy-btn" data-copy-target="session">Copy Session</button>
        </div>
        <div class="detail-source-path">${this.escapeHtml(activity.source || '—')}</div>
      </section>

      <section class="detail-section">
        <details class="detail-raw-details">
          <summary>Raw Event JSON</summary>
          <pre>${this.escapeHtml(JSON.stringify(payload, null, 2))}</pre>
        </details>
      </section>`;

    detailDrawerEl.classList.add('open');
    document.getElementById('drawer-overlay')?.classList.add('open');
  },

  updateSessionFocusBar(refs) {
    const state = window.AgentMonitor.state;
    if (!refs.sessionFocusBarEl || !refs.sessionFocusLabelEl) return;
    if (!state.selectedSessionKey) {
      refs.sessionFocusBarEl.classList.remove('open');
      refs.sessionFocusLabelEl.textContent = '';
      return;
    }

    const focused = (state.sessionStatuses || []).find(item => item.sessionKey === state.selectedSessionKey);
    const fallbackLabel = state.selectedSessionKey;
    const recentCount = this.getSessionRecentActivities(state.selectedSessionKey, 12).length;
    const label = focused
      ? `${focused.agent} / ${focused.sessionName} / ${focused.code}${recentCount ? ` / ${recentCount} recent` : ''}`
      : fallbackLabel;

    refs.sessionFocusBarEl.classList.add('open');
    refs.sessionFocusLabelEl.textContent = label;
  },

  createActivityItem(activity) {
    const state = window.AgentMonitor.state;
    const formatters = window.AgentMonitor.formatters;
    const filters = window.AgentMonitor.filters;

    const div = document.createElement('div');
    const agentClass = (activity.agent || 'unknown').toUpperCase();
    const activityKey = formatters.getActivityKey(activity);
    div.className = 'activity-item ' + agentClass;
    if (state.selectedSessionKey && `${activity.agent}:${activity.sessionName || 'unknown'}` === state.selectedSessionKey) {
      div.classList.add('session-focused-item');
    }

    if (state.newFlashKeys.has(activityKey)) {
      div.classList.add('feed-new');
      state.newFlashKeys.delete(activityKey);
    }
    if (activity.type === 'thinking') div.classList.add('thinking');
    if (activity.type === 'reply') div.classList.add('reply');
    if (activity.type === 'cron') div.classList.add('cron');
    if (filters.isErrorActivity(activity)) div.classList.add('error-item');
    if (filters.isSlowActivity(activity)) div.classList.add('slow-item');

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

    const usageBadgeText = formatters.formatUsageBadge(activity.usage);
    if (usageBadgeText) {
      const tokenTag = document.createElement('span');
      tokenTag.className = 'token-tag';
      tokenTag.textContent = '⚡ ' + usageBadgeText;
      detailsRow.appendChild(tokenTag);
    }

    if (activity.durationMs) {
      const durationTag = document.createElement('span');
      durationTag.className = 'duration-tag';
      durationTag.textContent = '⏱️ ' + formatters.formatDuration(activity.durationMs);
      detailsRow.appendChild(durationTag);
    }

    if (filters.isSlowActivity(activity)) {
      const slowTag = document.createElement('span');
      slowTag.className = 'duration-tag slow-tag';
      slowTag.textContent = 'SLOW';
      detailsRow.appendChild(slowTag);
    }

    if (activity.type === 'tool' && activity.exitCode !== undefined) {
      const exitCodeTag = document.createElement('span');
      exitCodeTag.className = 'exitcode-tag ' + (activity.exitCode === 0 ? 'success' : 'error');
      exitCodeTag.textContent = 'Exit: ' + activity.exitCode;
      detailsRow.appendChild(exitCodeTag);
    }

    if (activity.aggregateCount && activity.aggregateCount > 1) {
      const aggregateInfoTag = document.createElement('span');
      aggregateInfoTag.className = 'aggregate-info-tag';
      const groupedItems = Array.isArray(activity.groupedItems) ? activity.groupedItems : [];
      const firstSeen = groupedItems.length > 0 ? groupedItems.reduce((min, item) => Math.min(min, new Date(item.timestamp).getTime()), Infinity) : null;
      aggregateInfoTag.textContent = 'first ' + formatters.formatTime(isFinite(firstSeen) ? new Date(firstSeen).toISOString() : activity.timestamp);
      detailsRow.appendChild(aggregateInfoTag);
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

  updateConnectionStatus(refs) {
    const state = window.AgentMonitor.state;
    if (refs.connectionPillEl) {
      refs.connectionPillEl.textContent = state.connectionMode === 'ws-live' ? 'WS LIVE' : state.connectionMode === 'polling' ? 'POLLING' : 'CONNECTING';
      refs.connectionPillEl.className = 'connection-pill ' + state.connectionMode;
    }
    if (refs.connectionDotEl) {
      refs.connectionDotEl.className = 'status-dot ' + state.connectionMode;
    }
  },

  updateAgentStatuses(statuses, refs) {
    const state = window.AgentMonitor.state;
    state.agentStatuses = statuses || {};

    if (!refs.agentStatusListEl) return;
    const entries = Object.entries(state.agentStatuses);
    if (entries.length === 0) {
      refs.agentStatusListEl.innerHTML = '<div class="empty">Waiting for live status...</div>';
      return;
    }

    refs.agentStatusListEl.innerHTML = entries
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([agent, status]) => {
        const updatedAt = status?.updatedAt ? this.formatAbsoluteTime(status.updatedAt) : '—';
        const isIdle = (status?.code || 'idle') === 'idle';
        const duration = this.formatStatusDuration(status?.durationMs);
        const tool = status?.tool ? `<span>tool: ${this.escapeHtml(status.tool)}</span>` : '';
        const model = status?.model ? `<span>${this.escapeHtml(status.model)}</span>` : '';
        const sessionKey = `${agent}:${status?.sessionName || 'unknown'}`;
        const focusedClass = window.AgentMonitor.state.selectedSessionKey === sessionKey ? ' is-focused' : '';
        return `<button class="agent-status-card${focusedClass}" data-session-focus="${this.escapeHtml(sessionKey)}" type="button">
          <div class="agent-status-head">
            <span class="agent-tag">${this.escapeHtml(agent)}</span>
            <span class="agent-live-badge ${this.escapeHtml(status?.code || 'idle')}">${this.escapeHtml(status?.code || 'idle')}</span>
          </div>
          ${isIdle ? '' : `<div class="agent-status-label">${this.escapeHtml(status?.label || 'Idle')}</div>`}
          <div class="agent-status-meta">
            <span>${this.escapeHtml(status?.sessionName || '—')}</span>
            <span>${this.escapeHtml(updatedAt)}</span>
          </div>
          <div class="agent-status-submeta">
            <span>for ${this.escapeHtml(duration)}</span>
            ${tool}
            ${model}
          </div>
        </button>`;
      }).join('');
  },

  updateAgents(agents, refs) {
    const uiState = window.AgentMonitor.uiState;
    const state = window.AgentMonitor.state;

    state.latestAgents = agents || [];
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

    refs.metricCardErrors5mEl?.classList.toggle('is-active', !!refs.filterErrorsOnlyEl.checked);
    refs.metricCardSlowCallsEl?.classList.toggle('is-active', state.quickMode === 'slow');
    refs.quickFailedToolsEl?.classList.toggle('is-active', state.quickMode === 'failed-tools');
    refs.quickToolErrorsEl?.classList.toggle('is-active', state.quickMode === 'tool-errors');
    refs.quickCronErrorsEl?.classList.toggle('is-active', state.quickMode === 'cron-errors');
    this.updateSessionFocusBar(refs);

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
