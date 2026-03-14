const fs = require('fs');
const path = require('path');
const os = require('os');
const { createToolCallState } = require('./parsers/tool-call-state');
const { createActivityParser } = require('./parsers/activity-parser');
const { parseCronLine } = require('./parsers/cron-parser');
const { createActivityStore } = require('./store/activity-store');
const { createSessionWatcher } = require('./watchers/session-watcher');

const STATUS_IDLE_AFTER_MS = 15 * 1000;
const AGENT_HIDE_AFTER_MS = 20 * 60 * 1000;
const WAITING_MODEL_AFTER_MS = 2500;
const TOOL_RUNNING_AFTER_MS = 1500;

function getSessionKey(activity) {
  return `${activity.agent}:${activity.sessionName || 'unknown'}`;
}

function safeTimestampMs(value) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function inferEventState(activity) {
  if (!activity) return null;

  if (activity.type === 'thinking') {
    return {
      code: 'thinking',
      label: 'Thinking',
      isTerminal: false,
      tool: null,
      error: null,
      model: activity.model || null,
      provider: activity.provider || null,
      updatedAt: activity.timestamp
    };
  }

  if (activity.type === 'tool') {
    if (activity.toolError || Number(activity.exitCode) > 0) {
      return {
        code: 'tool-failed',
        label: `Tool failed · ${activity.tool || 'unknown'}`,
        isTerminal: true,
        tool: activity.tool || null,
        error: activity.error || activity.description || null,
        model: activity.model || null,
        provider: activity.provider || null,
        updatedAt: activity.timestamp
      };
    }

    if (activity.exitCode !== undefined || activity.durationMs || activity.toolStatus) {
      return {
        code: 'tool-done',
        label: `Tool done · ${activity.tool || 'unknown'}`,
        isTerminal: true,
        tool: activity.tool || null,
        error: null,
        model: activity.model || null,
        provider: activity.provider || null,
        updatedAt: activity.timestamp
      };
    }

    return {
      code: 'tool-call-pending',
      label: `Tool pending · ${activity.tool || 'unknown'}`,
      isTerminal: false,
      tool: activity.tool || null,
      error: null,
      model: activity.model || null,
      provider: activity.provider || null,
      updatedAt: activity.timestamp
    };
  }

  if (activity.type === 'reply') {
    return {
      code: 'reply-done',
      label: 'Reply ready',
      isTerminal: true,
      tool: null,
      error: null,
      model: activity.model || null,
      provider: activity.provider || null,
      updatedAt: activity.timestamp
    };
  }

  if (activity.type === 'cron') {
    return {
      code: activity.status === 'error' ? 'cron-error' : 'cron',
      label: activity.status === 'error' ? 'Cron error' : 'Cron run',
      isTerminal: true,
      tool: null,
      error: activity.error || null,
      model: activity.model || null,
      provider: activity.provider || null,
      updatedAt: activity.timestamp
    };
  }

  return null;
}

function normalizeSessionStatus(status, now = Date.now()) {
  if (!status) return null;

  const updatedAtMs = safeTimestampMs(status.updatedAt);
  const stateStartedAtMs = safeTimestampMs(status.stateStartedAt || status.updatedAt);
  if (!updatedAtMs || !stateStartedAtMs) return null;

  let normalized = {
    ...status,
    durationMs: Math.max(0, now - stateStartedAtMs),
    updatedAgoMs: Math.max(0, now - updatedAtMs)
  };

  if (normalized.code === 'thinking' && normalized.updatedAgoMs >= WAITING_MODEL_AFTER_MS) {
    normalized = {
      ...normalized,
      code: 'waiting-model',
      label: 'Waiting for model'
    };
  } else if (normalized.code === 'tool-call-pending' && normalized.updatedAgoMs >= TOOL_RUNNING_AFTER_MS) {
    normalized = {
      ...normalized,
      code: 'tool-running',
      label: `Tool running · ${normalized.tool || 'unknown'}`
    };
  } else if (normalized.isTerminal && normalized.updatedAgoMs >= STATUS_IDLE_AFTER_MS) {
    normalized = {
      ...normalized,
      code: 'idle',
      label: 'Idle',
      tool: null,
      error: null,
      durationMs: Math.max(0, now - updatedAtMs)
    };
  }

  return normalized;
}

function createSessionStatusTracker() {
  const sessionStatuses = new Map();

  function applyActivity(activity) {
    const next = inferEventState(activity);
    if (!next) return;

    const sessionKey = getSessionKey(activity);
    const prev = sessionStatuses.get(sessionKey);
    const sameState = prev && prev.code === next.code && prev.tool === next.tool;
    const stateStartedAt = sameState ? (prev.stateStartedAt || prev.updatedAt) : next.updatedAt;

    sessionStatuses.set(sessionKey, {
      agent: activity.agent,
      sessionName: activity.sessionName || 'unknown',
      sessionKey,
      code: next.code,
      label: next.label,
      tool: next.tool,
      error: next.error,
      model: next.model,
      provider: next.provider,
      source: activity.source || prev?.source || null,
      lastType: activity.type,
      lastDescription: activity.description || prev?.lastDescription || '',
      isTerminal: next.isTerminal,
      updatedAt: next.updatedAt,
      stateStartedAt
    });
  }

  function applyActivities(activities) {
    if (!Array.isArray(activities)) return;
    activities.forEach(applyActivity);
  }

  function getSessionStatuses(now = Date.now()) {
    const visible = [];
    for (const status of sessionStatuses.values()) {
      const normalized = normalizeSessionStatus(status, now);
      if (!normalized) continue;
      if (normalized.updatedAgoMs > AGENT_HIDE_AFTER_MS) continue;
      visible.push(normalized);
    }

    visible.sort((a, b) => {
      const diff = (safeTimestampMs(b.updatedAt) || 0) - (safeTimestampMs(a.updatedAt) || 0);
      if (diff !== 0) return diff;
      return String(a.sessionKey).localeCompare(String(b.sessionKey));
    });

    return visible;
  }

  function getAgentStatuses(now = Date.now()) {
    const byAgent = new Map();

    for (const status of getSessionStatuses(now)) {
      const existing = byAgent.get(status.agent);
      const existingUpdatedAt = existing ? (safeTimestampMs(existing.updatedAt) || 0) : 0;
      const nextUpdatedAt = safeTimestampMs(status.updatedAt) || 0;
      const nextPriority = status.code === 'idle' ? 0 : 1;
      const existingPriority = existing ? (existing.code === 'idle' ? 0 : 1) : -1;

      if (!existing || nextPriority > existingPriority || nextUpdatedAt >= existingUpdatedAt) {
        byAgent.set(status.agent, status);
      }
    }

    return Object.fromEntries(byAgent.entries());
  }

  return {
    applyActivity,
    applyActivities,
    getSessionStatuses,
    getAgentStatuses
  };
}

function createMonitorStore({ CONFIG, getSystemStats }) {
  const activeSessions = new Map();
  const subscribers = new Set();
  const toolCallState = createToolCallState();
  const activityParser = createActivityParser({ toolCallState });
  const activityStore = createActivityStore({
    maxActivities: CONFIG.maxActivities,
    maxCronActivities: CONFIG.maxCronActivities,
    activityMaxAgeHours: CONFIG.activityMaxAgeHours
  });
  const sessionStatusTracker = createSessionStatusTracker();
  const loadedCronRuns = new Map();

  function getAllSessions() {
    const sessions = [];

    try {
      if (!fs.existsSync(CONFIG.agentsDir)) {
        console.error('[Agent-Monitor] Agents dir not found:', CONFIG.agentsDir);
        return sessions;
      }

      const agents = fs.readdirSync(CONFIG.agentsDir).filter(name => !name.startsWith('.'));
      for (const agent of agents) {
        const sessionsDir = path.join(CONFIG.agentsDir, agent, 'sessions');
        if (!fs.existsSync(sessionsDir)) continue;

        const files = fs.readdirSync(sessionsDir)
          .filter(f => f.endsWith('.jsonl') && !f.includes('.deleted'))
          .map(f => {
            const fullPath = path.join(sessionsDir, f);
            const stats = fs.statSync(fullPath);
            return { agent, name: f, path: fullPath, size: stats.size, mtime: stats.mtime, source: 'session' };
          })
          .sort((a, b) => b.mtime - a.mtime);

        if (files.length > 0) sessions.push(files[0]);
      }
    } catch (e) {
      console.error('[Agent-Monitor] Failed to read sessions:', e.message);
    }

    return sessions;
  }

  function getCronRuns() {
    const cronRuns = [];
    const cronDir = path.join(os.homedir(), '.openclaw', 'cron', 'runs');

    try {
      if (!fs.existsSync(cronDir)) return cronRuns;

      const files = fs.readdirSync(cronDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => {
          const fullPath = path.join(cronDir, f);
          const stats = fs.statSync(fullPath);
          return { agent: 'cron', name: f, path: fullPath, size: stats.size, mtime: stats.mtime, source: 'cron' };
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 10);

      cronRuns.push(...files);
    } catch (e) {
      console.error('[Agent-Monitor] Failed to read cron runs:', e.message);
    }

    return cronRuns;
  }

  function loadFile(sessionInfo, options = {}) {
    const { agent, path: filePath, source, name, size, mtime } = sessionInfo;
    const { emit = true } = options;

    try {
      if (source === 'cron') {
        const previous = loadedCronRuns.get(filePath);
        const currentSize = Number(size || 0);
        const currentMtime = mtime ? new Date(mtime).getTime() : 0;
        if (previous && previous.size === currentSize && previous.mtimeMs === currentMtime) {
          return { size: currentSize, sessionName: '' };
        }
        loadedCronRuns.set(filePath, { size: currentSize, mtimeMs: currentMtime });
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      const sessionName = name ? name.replace('.jsonl', '').slice(0, 8) : '';
      const parseLine = source === 'cron' ? parseCronLine : activityParser.parseLine;
      const collectedActivities = [];

      for (const line of lines) {
        const activities = parseLine(line, agent, sessionName);
        if (activities?.length) {
          collectedActivities.push(...activities);
        }
      }

      if (collectedActivities.length > 0) {
        const enrichedActivities = collectedActivities.map(activity => ({ ...activity, source: filePath }));
        activityStore.append(collectedActivities, source, filePath);
        if (emit) emitActivities(enrichedActivities);
      }

      console.log(`[Agent-Monitor] Loaded ${source === 'cron' ? 'cron' : agent}: ${path.basename(filePath)} (${lines.length} lines, ${collectedActivities.length} activities)`);
      return { size: fs.statSync(filePath).size, sessionName };
    } catch (e) {
      console.error(`[Agent-Monitor] Load failed ${agent}:`, e.message);
      return { size: 0, sessionName: '' };
    }
  }

  function watchSession(sessionInfo, options = {}) {
    const { agent } = sessionInfo;
    const existing = activeSessions.get(agent);
    if (existing?.watcher) existing.watcher.close();

    const loaded = loadFile(sessionInfo, options);
    const sessionWatcher = createSessionWatcher({
      sessionInfo: { ...sessionInfo, sessionName: loaded.sessionName, initialSize: loaded.size },
      parseLine: activityParser.parseLine,
      onActivities: (activity) => {
        const enriched = { ...activity, source: sessionInfo.path };
        activityStore.appendIncremental(enriched);
        emitActivities([enriched]);
      },
      onError: (err, agentName) => console.error(`[Agent-Monitor] Watch error ${agentName}:`, err.message)
    });

    activeSessions.set(agent, {
      file: sessionInfo.path,
      watcher: sessionWatcher.watcher,
      lastSize: loaded.size,
      sessionName: loaded.sessionName
    });
  }

  function emitActivities(activities) {
    if (!activities || activities.length === 0) return;
    sessionStatusTracker.applyActivities(activities);
    const payload = {
      activities,
      agentStatuses: sessionStatusTracker.getAgentStatuses(),
      sessionStatuses: sessionStatusTracker.getSessionStatuses()
    };
    for (const listener of subscribers) {
      try {
        listener(payload);
      } catch (err) {
        console.error('[Agent-Monitor] subscriber emit failed:', err.message);
      }
    }
  }

  function init() {
    const sessions = getAllSessions();
    const cronRuns = getCronRuns();

    sessions.forEach(session => watchSession(session, { emit: false }));
    cronRuns.forEach(cronRun => loadFile(cronRun, { emit: false }));

    if (sessions.length === 0 && cronRuns.length === 0) {
      console.log('[Agent-Monitor] No session files found, waiting...');
    }

    setInterval(() => {
      getAllSessions().forEach(session => {
        const existing = activeSessions.get(session.agent);
        if (!existing) {
          console.log(`[Agent-Monitor] New agent found: ${session.agent}`);
          watchSession(session);
        } else if (existing.file !== session.path) {
          console.log(`[Agent-Monitor] ${session.agent} new session: ${session.name}`);
          watchSession(session);
        }
      });

      getCronRuns().forEach(loadFile);
    }, CONFIG.pollInterval);
  }

  return {
    init,
    getStatus(since = null) {
      const agentStatuses = sessionStatusTracker.getAgentStatuses();
      const sessionStatuses = sessionStatusTracker.getSessionStatuses();
      return {
        agents: Object.keys(agentStatuses),
        activities: activityStore.getStatus(since),
        agentStatuses,
        sessionStatuses,
        system: getSystemStats(),
        updatedAt: new Date().toISOString()
      };
    },
    getActiveSessionsCount() {
      return activeSessions.size;
    },
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    }
  };
}

module.exports = {
  createMonitorStore,
  createSessionStatusTracker,
  inferEventState,
  normalizeSessionStatus
};
