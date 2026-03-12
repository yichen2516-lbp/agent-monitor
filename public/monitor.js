    const listEl = document.getElementById('activity-list');
    const agentsEl = document.getElementById('agents-list');
    const bgCodeEl = document.getElementById('bg-code');

    const filterAgentEl = document.getElementById('filter-agent');
    const filterTypeEl = document.getElementById('filter-type');
    const filterKeywordEl = document.getElementById('filter-keyword');
    const filterErrorsOnlyEl = document.getElementById('filter-errors-only');
    const toggleErrorAggregateEl = document.getElementById('toggle-error-aggregate');
    const quickResetFiltersEl = document.getElementById('quick-reset-filters');

    function getDetailDrawerEl() { return document.getElementById('detail-drawer'); }
    function getDetailBodyEl() { return document.getElementById('detail-body'); }
    function getDetailCloseEl() { return document.getElementById('detail-close'); }

    const metricActiveSessionsEl = document.getElementById('metric-active-sessions');
    const metricErrors5mEl = document.getElementById('metric-errors-5m');
    const metricSlowCallsEl = document.getElementById('metric-slow-calls');
    const metricVisibleEl = document.getElementById('metric-visible');

    let latestActivities = [];
    let errorAggregateMode = false;
    let pollCount = 0;
    let lastRenderedSignature = '';
    let lastServerTimestamp = null;
    const newFlashKeys = new Set();

    const STORAGE_KEY = 'agent-monitor.ui-state.v1';

    function formatTime(isoString) {
      const date = new Date(isoString);
      return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function formatDuration(ms) {
      if (!ms) return null;
      if (ms < 1000) return ms + 'ms';
      return (ms / 1000).toFixed(1) + 's';
    }

    function formatTokens(usage) {
      if (!usage || typeof usage !== 'object') return null;
      let total = usage.totalTokens || usage.total_tokens;
      if (!total && (typeof usage.input === 'number' || typeof usage.output === 'number')) {
        total = (usage.input || 0) + (usage.output || 0);
      }
      if (!total || isNaN(total)) return null;
      return Number(total).toLocaleString();
    }

    function getActivityKey(activity) {
      return [activity.timestamp, activity.agent, activity.sessionName, activity.type, activity.tool || '', activity.description || ''].join('|');
    }

    function randomCodeLine() {
      const parts = [
        'exec --json', 'poll interval=1000', 'session.main', 'agent.cool', 'tool.browser.snapshot',
        'error.aggregate=true', 'retry=1 backoff=250ms', 'openclaw status --deep', 'model=k2p5',
        'usage.total_tokens', 'exit_code=0', 'cron.tick', 'ws://localhost:3450'
      ];
      const n = 3 + Math.floor(Math.random() * 4);
      let out = [];
      for (let i = 0; i < n; i++) {
        out.push(parts[Math.floor(Math.random() * parts.length)]);
      }
      return out.join('  ·  ');
    }

    function initCodeBackground() {
      if (!bgCodeEl) return;
      const streamCount = window.innerWidth < 900 ? 12 : 20;
      const streams = [];

      for (let i = 0; i < streamCount; i++) {
        const s = document.createElement('div');
        s.className = 'code-stream';
        s.style.left = ((i + 0.5) * (100 / streamCount)) + '%';
        s.style.animationDuration = (18 + Math.random() * 16).toFixed(1) + 's';
        s.style.animationDelay = (-Math.random() * 20).toFixed(1) + 's';
        s.style.opacity = (0.22 + Math.random() * 0.45).toFixed(2);
        s.textContent = randomCodeLine() + '\\n' + randomCodeLine() + '\\n' + randomCodeLine();
        bgCodeEl.appendChild(s);
        streams.push(s);
      }

      setInterval(() => {
        const idx = Math.floor(Math.random() * streams.length);
        const s = streams[idx];
        if (!s) return;
        s.textContent = randomCodeLine() + '\\n' + randomCodeLine() + '\\n' + randomCodeLine();
      }, 2200);
    }

    function saveUIState() {
      const state = {
        filterAgent: filterAgentEl.value,
        filterType: filterTypeEl.value,
        filterKeyword: filterKeywordEl.value,
        filterErrorsOnly: filterErrorsOnlyEl.checked,
        errorAggregateMode
      };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
    }

    function loadUIState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const state = JSON.parse(raw);
        if (state.filterType) filterTypeEl.value = state.filterType;
        if (typeof state.filterKeyword === 'string') filterKeywordEl.value = state.filterKeyword;
        if (typeof state.filterErrorsOnly === 'boolean') filterErrorsOnlyEl.checked = state.filterErrorsOnly;
        if (typeof state.errorAggregateMode === 'boolean') {
          errorAggregateMode = state.errorAggregateMode;
          toggleErrorAggregateEl.textContent = 'Error Aggregate: ' + (errorAggregateMode ? 'On' : 'Off');
        }
      } catch (_) {}
    }

    function openDetail(activity) {
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
      const detailBodyEl = getDetailBodyEl();
      const detailDrawerEl = getDetailDrawerEl();
      if (!detailBodyEl || !detailDrawerEl) return;
      detailBodyEl.innerHTML = '<pre>' + JSON.stringify(detail, null, 2) + '</pre>';
      detailDrawerEl.classList.add('open');
      document.getElementById('drawer-overlay')?.classList.add('open');
    }

    function createActivityItem(activity) {
      const div = document.createElement('div');
      const agentClass = (activity.agent || 'unknown').toUpperCase();
      const activityKey = getActivityKey(activity);
      div.className = 'activity-item ' + agentClass;
      if (newFlashKeys.has(activityKey)) {
        div.classList.add('feed-new');
        newFlashKeys.delete(activityKey);
      }
      if (activity.type === 'thinking') div.classList.add('thinking');
      if (activity.type === 'reply') div.classList.add('reply');
      if (activity.type === 'cron') div.classList.add('cron');
      if (isErrorActivity(activity)) div.classList.add('error-item');

      const meta = document.createElement('div');
      meta.className = 'meta';

      const time = document.createElement('span');
      time.className = 'timestamp';
      time.textContent = formatTime(activity.timestamp);

      const agent = document.createElement('span');
      agent.className = 'agent-name ' + agentClass;
      agent.textContent = activity.agent || '?';

      const session = document.createElement('span');
      session.className = 'session-name';
      session.textContent = activity.sessionName || '-';

      meta.appendChild(time);
      meta.appendChild(agent);
      meta.appendChild(session);

      // 如果是 cron 类型，添加 cron tag
      if (activity.type === 'cron') {
        const cronTag = document.createElement('span');
        cronTag.className = 'cron-tag';
        cronTag.textContent = 'CRON';
        meta.appendChild(cronTag);
      }

      const desc = document.createElement('div');
      desc.className = 'description';
      const fullDesc = activity.description || '';
      desc.textContent = fullDesc;

      div.appendChild(meta);
      div.appendChild(desc);


      // 新增：详细信息行（模型、token、执行时间、退出码）
      const detailsRow = document.createElement('div');
      detailsRow.className = 'details-row';

      // 模型信息
      if (activity.model) {
        const modelTag = document.createElement('span');
        modelTag.className = 'model-tag';
        modelTag.textContent = activity.model;
        detailsRow.appendChild(modelTag);
      }

      // Token 消耗
      if (activity.usage) {
        const tokenTag = document.createElement('span');
        tokenTag.className = 'token-tag';
        tokenTag.textContent = '⚡ ' + formatTokens(activity.usage) + ' tokens';
        detailsRow.appendChild(tokenTag);
      }

      // 执行时间
      if (activity.durationMs) {
        const durationTag = document.createElement('span');
        durationTag.className = 'duration-tag';
        durationTag.textContent = '⏱️ ' + formatDuration(activity.durationMs);
        detailsRow.appendChild(durationTag);
      }

      // 工具退出码（仅对 tool 类型）
      if (activity.type === 'tool' && activity.exitCode !== undefined) {
        const exitCodeTag = document.createElement('span');
        exitCodeTag.className = 'exitcode-tag ' + (activity.exitCode === 0 ? 'success' : 'error');
        exitCodeTag.textContent = 'Exit: ' + activity.exitCode;
        detailsRow.appendChild(exitCodeTag);
      }

      // 如果有详细信息，添加到卡片
      if (detailsRow.children.length > 0) {
        div.appendChild(detailsRow);
      }

      if (activity.aggregateCount && activity.aggregateCount > 1) {
        const badge = document.createElement('span');
        badge.className = 'aggregate-badge';
        badge.textContent = activity.aggregateCount + 'x';
        meta.appendChild(badge);
      }

      div.addEventListener('click', () => openDetail(activity));
      return div;
    }

    function updateAgents(agents) {
      agentsEl.innerHTML = '';
      agents.forEach(agent => {
        const tag = document.createElement('span');
        tag.className = 'agent-tag';
        tag.textContent = agent;
        agentsEl.appendChild(tag);
      });

      const savedAgent = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').filterAgent; } catch (_) { return null; } })();
      const current = filterAgentEl.value || savedAgent || 'all';
      filterAgentEl.innerHTML = '<option value="all">All Agents</option>';
      agents.forEach(agent => {
        const op = document.createElement('option');
        op.value = agent;
        op.textContent = agent;
        filterAgentEl.appendChild(op);
      });
      filterAgentEl.value = agents.includes(current) ? current : 'all';
    }

    function isErrorActivity(activity) {
      if (!activity) return false;
      if (activity.type === 'tool' && (activity.toolError || activity.exitCode > 0)) return true;
      if (activity.type === 'cron' && activity.status === 'error') return true;
      return false;
    }

    function applyFilters(activities) {
      const agent = filterAgentEl.value;
      const type = filterTypeEl.value;
      const kw = (filterKeywordEl.value || '').trim().toLowerCase();
      const onlyErrors = filterErrorsOnlyEl.checked;

      return activities.filter(a => {
        if (agent !== 'all' && a.agent !== agent) return false;
        if (type !== 'all' && a.type !== type) return false;
        if (onlyErrors && !isErrorActivity(a)) return false;

        if (kw) {
          const target = [a.description, a.tool, a.sessionName, a.agent, a.type].filter(Boolean).join(' ').toLowerCase();
          if (!target.includes(kw)) return false;
        }
        return true;
      });
    }

    function aggregateErrorActivities(activities) {
      if (!errorAggregateMode) return activities;
      const groups = new Map();
      const passthrough = [];

      for (const a of activities) {
        if (!isErrorActivity(a)) {
          passthrough.push(a);
          continue;
        }
        const key = [a.agent, a.type, a.tool || '', (a.description || '').slice(0, 120)].join('|');
        if (!groups.has(key)) {
          groups.set(key, { ...a, aggregateCount: 1, latestTs: new Date(a.timestamp).getTime() });
        } else {
          const g = groups.get(key);
          g.aggregateCount += 1;
          const t = new Date(a.timestamp).getTime();
          if (t > g.latestTs) {
            Object.assign(g, a, { aggregateCount: g.aggregateCount, latestTs: t });
          }
        }
      }

      const aggregatedErrors = Array.from(groups.values());
      return [...passthrough, ...aggregatedErrors].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    function updateMetrics(allActivities, visibleActivities) {
      const now = Date.now();
      const fiveMinAgo = now - 5 * 60 * 1000;

      const activeSessions = new Set((allActivities || []).map(a => a.sessionName).filter(Boolean));
      const errors5m = (allActivities || []).filter(a => {
        const t = new Date(a.timestamp).getTime();
        return t >= fiveMinAgo && isErrorActivity(a);
      }).length;
      const slowCalls = (allActivities || []).filter(a => (a.durationMs || 0) > 3000).length;

      metricActiveSessionsEl.textContent = activeSessions.size;
      metricErrors5mEl.textContent = errors5m;
      metricSlowCallsEl.textContent = slowCalls;
      metricVisibleEl.textContent = visibleActivities.length;
    }

    function renderFilteredList() {
      const filtered = applyFilters(latestActivities);
      const visible = aggregateErrorActivities(filtered);
      listEl.innerHTML = '';

      console.log('[Agent-Monitor] 更新列表:', visible.length, '/', latestActivities.length, 'activities');

      if (visible.length === 0) {
        listEl.innerHTML = '<div class="empty">No activities under current filters</div>';
      } else {
        visible.forEach(activity => {
          listEl.appendChild(createActivityItem(activity));
        });
      }

      updateMetrics(latestActivities, visible);
    }

    function updateList(activities) {
      latestActivities = activities || [];
      const signature = latestActivities.slice(0, 120).map(getActivityKey).join('||');
      if (signature === lastRenderedSignature) {
        updateMetrics(latestActivities, aggregateErrorActivities(applyFilters(latestActivities)));
        return;
      }
      lastRenderedSignature = signature;
      renderFilteredList();
    }

    // 轮询配置
    const POLL_CONFIG = {
      defaultInterval: 5000,  // 默认5秒
      fastInterval: 1000,     // 快速1秒
      fastDuration: 10000     // 快速模式持续10秒
    };

    let currentInterval = POLL_CONFIG.defaultInterval;
    let lastActivityCount = 0;
    let fastModeTimer = null;
    let intervalId = null;

    async function poll() {
      try {
        pollCount++;
        console.log('[Agent-Monitor] 轮询 #' + pollCount + ' (间隔: ' + currentInterval + 'ms)');

        const sinceQuery = lastServerTimestamp ? ('&since=' + encodeURIComponent(lastServerTimestamp)) : '';
        const res = await fetch('/api?t=' + Date.now() + sinceQuery, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        });

        if (!res.ok) throw new Error('HTTP ' + res.status);

        const data = await res.json();
        const activityCount = data.activities ? data.activities.length : 0;
        console.log('[Agent-Monitor] 收到数据:', activityCount, 'activities');

        const hadCursor = !!lastServerTimestamp;
        if (data.updatedAt) lastServerTimestamp = data.updatedAt;

        const incoming = data.activities || [];

        // 仅在有新数据时进入快速模式
        if (incoming.length > 0 && currentInterval !== POLL_CONFIG.fastInterval) {
          switchToFastMode();
        }

        updateAgents(data.agents || []);

        if (!hadCursor) {
          // 首次全量加载
          updateList(incoming);
        } else if (incoming.length > 0) {
          // 增量合并；无增量时保持Visible Items不动
          incoming.forEach(a => newFlashKeys.add(getActivityKey(a)));
          const merged = [...incoming, ...latestActivities]
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          const dedup = [];
          const seen = new Set();
          for (const a of merged) {
            const k = getActivityKey(a);
            if (seen.has(k)) continue;
            seen.add(k);
            dedup.push(a);
            if (dedup.length >= 300) break;
          }
          updateList(dedup);
        }

        lastActivityCount = latestActivities.length;
        updateSystemPanel(data.system);
      } catch (err) {
        console.error('[Agent-Monitor] 请求失败:', err.message);
      }
    }

    // 切换到快速轮询模式
    function switchToFastMode() {
      console.log('[Agent-Monitor] 切换到快速模式 (1秒)');
      currentInterval = POLL_CONFIG.fastInterval;
      
      // 清除现有定时器
      if (intervalId) {
        clearInterval(intervalId);
      }
      
      // 设置新的快速轮询
      intervalId = setInterval(poll, currentInterval);
      
      // 清除之前的恢复定时器
      if (fastModeTimer) {
        clearTimeout(fastModeTimer);
      }
      
      // 10秒后恢复默认轮询
      fastModeTimer = setTimeout(() => {
        console.log('[Agent-Monitor] 恢复默认模式 (5秒)');
        currentInterval = POLL_CONFIG.defaultInterval;
        clearInterval(intervalId);
        intervalId = setInterval(poll, currentInterval);
      }, POLL_CONFIG.fastDuration);
    }

    // 更新系统监控面板
    function updateSystemPanel(system) {
      if (!system) return;

      // CPU
      if (system.cpu) {
        document.getElementById('cpu-value').textContent = system.cpu.used + '%';
      }

      // GPU
      if (system.gpu) {
        document.getElementById('gpu-value').textContent = system.gpu.used + '%';
      }

      // 内存
      if (system.memory) {
        document.getElementById('mem-value').textContent = system.memory.percentage + '%';
      }

      // 磁盘
      if (system.disk) {
        document.getElementById('disk-value').textContent = system.disk.percentage + '%';
      }
    }


    // 过滤器事件
    [filterAgentEl, filterTypeEl, filterKeywordEl, filterErrorsOnlyEl].forEach(el => {
      el.addEventListener('input', () => { renderFilteredList(); saveUIState(); });
      el.addEventListener('change', () => { renderFilteredList(); saveUIState(); });
    });

    toggleErrorAggregateEl.addEventListener('click', () => {
      errorAggregateMode = !errorAggregateMode;
      toggleErrorAggregateEl.textContent = 'Error Aggregate: ' + (errorAggregateMode ? 'On' : 'Off');
      renderFilteredList();
      saveUIState();
    });

    quickResetFiltersEl.addEventListener('click', () => {
      filterAgentEl.value = 'all';
      filterTypeEl.value = 'all';
      filterKeywordEl.value = '';
      filterErrorsOnlyEl.checked = false;
      errorAggregateMode = false;
      toggleErrorAggregateEl.textContent = 'Error Aggregate: Off';
      renderFilteredList();
      saveUIState();
    });

    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'detail-close') {
        const detailDrawerEl = getDetailDrawerEl();
        detailDrawerEl?.classList.remove('open');
        document.getElementById('drawer-overlay')?.classList.remove('open');
      }
    });


    document.getElementById('drawer-overlay')?.addEventListener('click', () => {
      const detailDrawerEl = getDetailDrawerEl();
      detailDrawerEl?.classList.remove('open');
      document.getElementById('drawer-overlay')?.classList.remove('open');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const detailDrawerEl = getDetailDrawerEl();
        if (detailDrawerEl?.classList.contains('open')) {
          detailDrawerEl.classList.remove('open');
          document.getElementById('drawer-overlay')?.classList.remove('open');
        }
      }
    });

    loadUIState();
    initCodeBackground();

    // 立即执行第一次
    poll();

    // 默认5秒轮询
    intervalId = setInterval(poll, currentInterval);
    console.log('[Agent-Monitor] 轮询已启动, 默认间隔: 5秒, intervalId:', intervalId);
