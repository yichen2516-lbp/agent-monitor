const fs = require('fs');
const path = require('path');
const os = require('os');
const { createToolCallState } = require('./parsers/tool-call-state');
const { createActivityParser } = require('./parsers/activity-parser');
const { parseCronLine } = require('./parsers/cron-parser');
const { createActivityStore } = require('./store/activity-store');
const { createSessionWatcher } = require('./watchers/session-watcher');

function createMonitorStore({ CONFIG, getSystemStats }) {
  const activeSessions = new Map();
  const subscribers = new Set();
  const sessionLiveStatuses = new Map();
  const STATUS_IDLE_AFTER_MS = 15 * 1000;
  const AGENT_HIDE_AFTER_MS = 20 * 60 * 1000;
  const toolCallState = createToolCallState();
  const activityParser = createActivityParser({ toolCallState });
  const activityStore = createActivityStore({
    maxActivities: CONFIG.maxActivities,
    activityMaxAgeHours: CONFIG.activityMaxAgeHours
  });

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

  function loadFile(sessionInfo) {
    const { agent, path: filePath, source, name } = sessionInfo;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      const sessionName = name ? name.replace('.jsonl', '').slice(0, 8) : '';
      const parseLine = source === 'cron' ? parseCronLine : activityParser.parseLine;

      for (const line of lines) {
        const activities = parseLine(line, agent, sessionName);
        if (activities) {
          const enrichedActivities = activities.map(activity => ({ ...activity, source: filePath }));
          activityStore.append(activities, source, filePath);
          emitActivities(enrichedActivities);
        }
      }

      console.log(`[Agent-Monitor] Loaded ${source === 'cron' ? 'cron' : agent}: ${path.basename(filePath)} (${lines.length} lines)`);
      return { size: fs.statSync(filePath).size, sessionName };
    } catch (e) {
      console.error(`[Agent-Monitor] Load failed ${agent}:`, e.message);
      return { size: 0, sessionName: '' };
    }
  }

  function watchSession(sessionInfo) {
    const { agent } = sessionInfo;
    const existing = activeSessions.get(agent);
    if (existing?.watcher) existing.watcher.close();

    const loaded = loadFile(sessionInfo);
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

  function deriveSessionStatus(activity) {
    if (!activity) return null;

    if (activity.type === 'thinking') {
      return { code: 'thinking', label: 'Thinking', tool: null, error: null, updatedAt: activity.timestamp };
    }

    if (activity.type === 'tool') {
      if (activity.toolError || Number(activity.exitCode) > 0) {
        return { code: 'tool-failed', label: `Tool failed · ${activity.tool || 'unknown'}`, tool: activity.tool || null, error: activity.error || activity.description || null, updatedAt: activity.timestamp };
      }
      if (activity.exitCode !== undefined || activity.durationMs || activity.toolStatus) {
        return { code: 'tool-done', label: `Tool done · ${activity.tool || 'unknown'}`, tool: activity.tool || null, error: null, updatedAt: activity.timestamp };
      }
      return { code: 'tool-running', label: `Tool running · ${activity.tool || 'unknown'}`, tool: activity.tool || null, error: null, updatedAt: activity.timestamp };
    }

    if (activity.type === 'reply') {
      return { code: 'reply-done', label: 'Reply ready', tool: null, error: null, updatedAt: activity.timestamp };
    }

    if (activity.type === 'cron') {
      return { code: activity.status === 'error' ? 'cron-error' : 'cron', label: activity.status === 'error' ? 'Cron error' : 'Cron run', tool: null, error: activity.error || null, updatedAt: activity.timestamp };
    }

    return null;
  }

  function updateLiveStatuses(activities) {
    if (!activities || activities.length === 0) return;
    for (const activity of activities) {
      const sessionKey = `${activity.agent}:${activity.sessionName || 'unknown'}`;
      const next = deriveSessionStatus(activity);
      if (!next) continue;
      sessionLiveStatuses.set(sessionKey, {
        agent: activity.agent,
        sessionName: activity.sessionName || 'unknown',
        ...next
      });
    }
  }

  function getAgentStatuses() {
    const byAgent = new Map();
    const now = Date.now();

    for (const status of sessionLiveStatuses.values()) {
      const ts = new Date(status.updatedAt).getTime();
      if (isNaN(ts)) continue;
      if ((now - ts) > AGENT_HIDE_AFTER_MS) continue;

      const existing = byAgent.get(status.agent);
      const existingTs = existing ? new Date(existing.updatedAt).getTime() : 0;
      if (!existing || ts >= existingTs) {
        let normalized = { ...status };
        const isTerminal = ['reply-done', 'tool-done', 'cron', 'cron-error'].includes(normalized.code);
        if (isTerminal && (now - ts) > STATUS_IDLE_AFTER_MS) {
          normalized = {
            ...normalized,
            code: 'idle',
            label: 'Idle',
            tool: null,
            error: null
          };
        }
        byAgent.set(status.agent, normalized);
      }
    }

    return Object.fromEntries(byAgent.entries());
  }

  function emitActivities(activities) {
    if (!activities || activities.length === 0) return;
    updateLiveStatuses(activities);
    const payload = { activities, agentStatuses: getAgentStatuses() };
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

    sessions.forEach(watchSession);
    cronRuns.forEach(loadFile);

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
      const agentStatuses = getAgentStatuses();
      return {
        agents: Object.keys(agentStatuses),
        activities: activityStore.getStatus(since),
        agentStatuses,
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

module.exports = { createMonitorStore };
