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
        if (activities) activityStore.append(activities, source, filePath);
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
      onActivities: (activity) => activityStore.appendIncremental(activity),
      onError: (err, agentName) => console.error(`[Agent-Monitor] Watch error ${agentName}:`, err.message)
    });

    activeSessions.set(agent, {
      file: sessionInfo.path,
      watcher: sessionWatcher.watcher,
      lastSize: loaded.size,
      sessionName: loaded.sessionName
    });
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
      return {
        agents: Array.from(activeSessions.keys()),
        activities: activityStore.getStatus(since),
        system: getSystemStats(),
        updatedAt: new Date().toISOString()
      };
    },
    getActiveSessionsCount() {
      return activeSessions.size;
    }
  };
}

module.exports = { createMonitorStore };
