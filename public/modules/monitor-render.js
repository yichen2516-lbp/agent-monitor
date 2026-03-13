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

  createSummaryRow(label, value, className = '') {
    return `<div class="detail-summary-row ${className}"><span class="detail-summary-label">${this.escapeHtml(label)}</span><span class="detail-summary-value">${this.formatValue(value)}</span></div>`;
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
    detailBodyEl.dataset.copyJson = JSON.stringify(payload, null, 2);
    detailBodyEl.dataset.copySource = activity.source || '';
    detailBodyEl.dataset.copySession = activity.sessionName || '';

    const usageText = activity.usage ? formatters.formatTokens(activity.usage) + ' tokens' : '—';
    const durationText = activity.durationMs ? formatters.formatDuration(activity.durationMs) : '—';
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

    detailBodyEl.innerHTML = `
      <section class="detail-section">
        <div class="detail-section-title">Summary</div>
        <div class="detail-summary-grid">
          ${this.createSummaryRow('Time', this.formatAbsoluteTime(activity.timestamp))}
          ${this.createSummaryRow('Agent', activity.agent)}
          ${this.createSummaryRow('Session', activity.sessionName)}
          ${this.createSummaryRow('Type', activity.type)}
          ${this.createSummaryRow('Tool', activity.tool)}
          ${this.createSummaryRow('Model', activity.model)}
          ${this.createSummaryRow('Duration', durationText)}
          ${this.createSummaryRow('Usage', usageText)}
          ${this.createSummaryRow('Exit Code', activity.exitCode ?? '—', activity.exitCode > 0 ? 'is-error' : '')}
          ${this.createSummaryRow('Tool Status', activity.toolStatus || activity.status)}
          ${this.createSummaryRow('Stop Reason', activity.stopReason)}
          ${this.createSummaryRow('Error Kind', errorKind, filters.isErrorActivity(activity) ? 'is-error' : '')}
          ${this.createSummaryRow('Aggregate', aggregateMeta, activity.aggregateCount > 1 ? 'is-error' : '')}
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

    refs.metricCardErrors5mEl?.classList.toggle('is-active', !!refs.filterErrorsOnlyEl.checked);
    refs.metricCardSlowCallsEl?.classList.toggle('is-active', state.quickMode === 'slow');
    refs.quickFailedToolsEl?.classList.toggle('is-active', state.quickMode === 'failed-tools');
    refs.quickToolErrorsEl?.classList.toggle('is-active', state.quickMode === 'tool-errors');
    refs.quickCronErrorsEl?.classList.toggle('is-active', state.quickMode === 'cron-errors');

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
