const fs = require('fs');
const path = require('path');
const os = require('os');

function createMonitorStore({ CONFIG, getSystemStats }) {
  let recentActivities = [];
  let cronActivities = [];
  let activeSessions = new Map();
  let pendingToolCalls = new Map();
  let sessionModelSnapshots = new Map();

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

  function parseActivityLine(line, agentName, sessionName) {
    try {
      const data = JSON.parse(line);
      const sessionKey = `${agentName}:${sessionName}`;

      // New format model snapshots are emitted as custom events
      if (data.type === 'custom' && data.customType === 'model-snapshot') {
        const snapshotModel = data.data?.modelId || data.data?.model || null;
        if (snapshotModel) {
          sessionModelSnapshots.set(sessionKey, snapshotModel);
        }
        return null;
      }
      
      // Handle new format: {type: "message", message: {content: [...]}}
      if (data.type === 'message' && data.message) {
        const msg = data.message;
        const timestamp = data.timestamp || new Date().toISOString();
        const model = data.model || data.request?.model || sessionModelSnapshots.get(sessionKey) || null;
        const provider = data.provider || null;
        const usage = data.usage || null;
        const stopReason = data.stopReason || null;
        
        const activities = [];
        
        // Tool result message (role: "tool")
        if (msg.role === 'tool' && msg.toolCallId) {
          const toolCallId = msg.toolCallId;
          const toolResult = {
            status: msg.status,
            durationMs: msg.durationMs,
            exitCode: msg.exitCode,
            isError: msg.isError
          };
          
          if (pendingToolCalls.has(toolCallId)) {
            const callInfo = pendingToolCalls.get(toolCallId);
            pendingToolCalls.delete(toolCallId);
            
            const outputText = msg.content?.[0]?.text || '';
            activities.push({
              type: 'tool',
              agent: agentName,
              sessionName,
              tool: callInfo.toolName,
              description: `🔍 ${callInfo.toolName} ${typeof callInfo.args === 'string' ? callInfo.args : JSON.stringify(callInfo.args)}`,
              timestamp,
              model: callInfo.model,
              provider: callInfo.provider,
              usage: callInfo.usage,
              stopReason: callInfo.stopReason,
              durationMs: toolResult?.durationMs,
              exitCode: toolResult?.exitCode,
              toolStatus: toolResult?.status,
              toolError: toolResult?.isError
            });
          }
          return activities.length > 0 ? activities : null;
        }
        
        // Assistant message with content array
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          for (const item of msg.content) {
            if (item.type === 'thinking' && item.thinking) {
              activities.push({
                type: 'thinking',
                agent: agentName,
                sessionName,
                description: `💭 ${item.thinking}`,
                timestamp,
                model,
                provider,
                usage,
                stopReason
              });
            }

            // Assistant plain text reply
            if (item.type === 'text' && item.text) {
              activities.push({
                type: 'reply',
                agent: agentName,
                sessionName,
                description: `💬 ${item.text}`,
                timestamp,
                fullText: item.text,
                model,
                provider,
                usage,
                stopReason
              });
            }
            
            if (item.type === 'toolCall') {
              const toolName = item.name || 'unknown';
              const args = item.arguments ? JSON.stringify(item.arguments) : '';
              const toolCallId = item.id || item.toolCallId;
              
              if (toolCallId) {
                pendingToolCalls.set(toolCallId, {
                  toolName,
                  args,
                  timestamp,
                  model,
                  provider,
                  usage,
                  stopReason
                });
              }
              
              activities.push({
                type: 'tool',
                agent: agentName,
                sessionName,
                tool: toolName,
                description: `🔧 ${toolName} ${args}`,
                timestamp,
                model,
                provider,
                usage,
                stopReason
              });
            }
          }
          return activities.length > 0 ? activities : null;
        }
        
        // User message (text reply)
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          const text = msg.content.map(c => c.text || '').join('');
          if (text) {
            return [{
              type: 'reply',
              agent: agentName,
              sessionName,
              description: `💬 ${text}`,
              timestamp,
              fullText: text,
              model,
              provider,
              usage,
              stopReason
            }];
          }
        }
      }
      
      // Fallback: handle old flat format for backward compatibility
      const item = data.item || data;
      
      const timestamp = data.timestamp || item.timestamp || new Date().toISOString();
      const itemTimestamp = new Date(timestamp);

      const model = data.model || item.model || data.request?.model || null;
      const provider = data.provider || item.provider || null;
      const usage = data.usage || item.usage || null;
      const stopReason = data.stopReason || item.stopReason || null;

      const activities = [];

      if (item.type === 'tool_call') {
        const toolName = item.toolName || item.tool_name || 'unknown';
        const args = item.arguments || item.args || '';
        const toolCallId = item.id || item.toolCallId || item.tool_call_id || null;

        if (toolCallId) {
          pendingToolCalls.set(toolCallId, {
            toolName,
            args,
            timestamp: itemTimestamp.toISOString(),
            model,
            provider,
            usage,
            stopReason
          });
        }

        activities.push({
          type: 'tool',
          agent: agentName,
          sessionName,
          tool: toolName,
          description: `🔧 ${toolName} ${typeof args === 'string' ? args : JSON.stringify(args)}`,
          timestamp: itemTimestamp.toISOString(),
          model,
          provider,
          usage,
          stopReason
        });
      }

      if (item.type === 'tool_result') {
        const toolCallId = item.toolCallId || item.tool_call_id || item.id || null;
        const toolResult = item;

        if (toolCallId && pendingToolCalls.has(toolCallId)) {
          const callInfo = pendingToolCalls.get(toolCallId);
          pendingToolCalls.delete(toolCallId);

          activities.push({
            type: 'tool',
            agent: agentName,
            sessionName,
            tool: callInfo.toolName,
            description: `🔍 ${callInfo.toolName} ${typeof callInfo.args === 'string' ? callInfo.args : JSON.stringify(callInfo.args)}`,
            timestamp: itemTimestamp.toISOString(),
            model: callInfo.model,
            provider: callInfo.provider,
            usage: callInfo.usage,
            stopReason: callInfo.stopReason,
            durationMs: toolResult?.durationMs,
            exitCode: toolResult?.exitCode,
            toolStatus: toolResult?.status,
            toolError: toolResult?.isError
          });
        }
      }

      if (item.type === 'thinking') {
        const thinkingText = item.thinking || '';
        activities.push({
          type: 'thinking',
          agent: agentName,
          sessionName,
          description: `💭 ${thinkingText}`,
          timestamp: itemTimestamp.toISOString(),
          model,
          provider,
          usage,
          stopReason
        });
      }

      if (item.type === 'text' && item.text) {
        activities.push({
          type: 'reply',
          agent: agentName,
          sessionName,
          description: `💬 ${item.text}`,
          timestamp: itemTimestamp.toISOString(),
          fullText: item.text,
          model,
          provider,
          usage,
          stopReason
        });
      }

      return activities.length > 0 ? activities : null;
    } catch (e) {
      return null;
    }
  }

  function parseCronLine(line) {
    try {
      const data = JSON.parse(line);
      if (!data.ts) return null;

      const timestamp = new Date(data.ts).toISOString();
      const status = data.status || 'unknown';
      const summary = data.summary || '';
      const error = data.error || '';
      const duration = data.durationMs ? `(${Math.round(data.durationMs / 1000)}s)` : '';
      const durationMs = data.durationMs;
      const usage = data.usage;

      let agentName = 'cron';
      let sessionName = '';
      if (data.sessionKey) {
        const match = data.sessionKey.match(/agent:([^:]+):/);
        if (match) agentName = match[1];
        const sessionMatch = data.sessionKey.match(/:run:([^:]+)/);
        if (sessionMatch) sessionName = sessionMatch[1].slice(0, 8);
      }

      const statusEmoji = status === 'ok' ? '✅' : status === 'error' ? '❌' : '⏳';
      const description = `${statusEmoji} ${duration} ${summary}`;

      return [{
        type: 'cron',
        agent: agentName,
        sessionName: sessionName || 'cron',
        tool: 'cron',
        description,
        timestamp,
        status,
        fullSummary: summary,
        error,
        durationMs,
        usage
      }];
    } catch (e) {
      return null;
    }
  }

  function loadSessionFile(sessionInfo) {
    const { agent, path: filePath, source, name } = sessionInfo;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());

      const sessionName = name ? name.replace('.jsonl', '').slice(0, 8) : '';

      for (const line of lines) {
        const activities = source === 'cron'
          ? parseCronLine(line)
          : parseActivityLine(line, agent, sessionName);

        if (activities) {
          if (source === 'cron') {
            cronActivities.push(...activities.map(a => ({ ...a, source: filePath })));
          } else {
            recentActivities.push(...activities.map(a => ({ ...a, source: filePath })));
          }
        }
      }

      if (recentActivities.length > CONFIG.maxActivities) {
        recentActivities = recentActivities.slice(-CONFIG.maxActivities);
      }
      if (cronActivities.length > 50) {
        cronActivities = cronActivities.slice(-50);
      }

      console.log(`[Agent-Monitor] Loaded ${source === 'cron' ? 'cron' : agent}: ${path.basename(filePath)} (${lines.length} lines)`);
      return fs.statSync(filePath).size;
    } catch (e) {
      console.error(`[Agent-Monitor] Load failed ${agent}:`, e.message);
      return 0;
    }
  }

  function watchSession(sessionInfo) {
    const { agent, path: filePath } = sessionInfo;

    if (activeSessions.has(agent)) {
      const old = activeSessions.get(agent);
      if (old.watcher) old.watcher.close();
    }

    const lastSize = loadSessionFile(sessionInfo);
    const sessionName = sessionInfo.name ? sessionInfo.name.replace('.jsonl', '').slice(0, 8) : '';

    const watcher = fs.watch(filePath, (eventType) => {
      if (eventType !== 'change') return;

      try {
        const stats = fs.statSync(filePath);
        const session = activeSessions.get(agent);
        if (!session || stats.size <= session.lastSize) return;

        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(stats.size - session.lastSize);
        fs.readSync(fd, buffer, 0, buffer.length, session.lastSize);
        fs.closeSync(fd);

        const newLines = buffer.toString('utf8').split('\n').filter(l => l.trim());

        for (const line of newLines) {
          const activities = parseActivityLine(line, agent, sessionName);
          if (activities) {
            for (const activity of activities) {
              recentActivities.push(activity);
              if (recentActivities.length > CONFIG.maxActivities) recentActivities.shift();
            }
          }
        }

        session.lastSize = stats.size;
      } catch (err) {
        console.error(`[Agent-Monitor] Watch error ${agent}:`, err.message);
      }
    });

    activeSessions.set(agent, { file: filePath, watcher, lastSize, sessionName });
  }

  function init() {
    const sessions = getAllSessions();
    const cronRuns = getCronRuns();

    for (const session of sessions) watchSession(session);
    for (const cronRun of cronRuns) loadSessionFile(cronRun);

    if (sessions.length === 0 && cronRuns.length === 0) {
      console.log('[Agent-Monitor] No session files found, waiting...');
    }

    setInterval(() => {
      const sessions = getAllSessions();

      for (const session of sessions) {
        const existing = activeSessions.get(session.agent);
        if (!existing) {
          console.log(`[Agent-Monitor] New agent found: ${session.agent}`);
          watchSession(session);
        } else if (existing.file !== session.path) {
          console.log(`[Agent-Monitor] ${session.agent} new session: ${session.name}`);
          watchSession(session);
        }
      }

      const newCronRuns = getCronRuns();
      for (const cronRun of newCronRuns) loadSessionFile(cronRun);
    }, CONFIG.pollInterval);
  }

  function getStatus(since = null) {
    const allActivities = [...recentActivities, ...cronActivities];
    const nowMs = Date.now();
    const maxAgeMs = Math.max(1, Number(CONFIG.activityMaxAgeHours || 24)) * 60 * 60 * 1000;

    let sorted = allActivities
      .filter(a => {
        const ts = new Date(a.timestamp).getTime();
        if (isNaN(ts)) return false;
        return (nowMs - ts) <= maxAgeMs;
      })
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (since) {
      const sinceMs = new Date(since).getTime();
      if (!isNaN(sinceMs)) sorted = sorted.filter(a => new Date(a.timestamp).getTime() > sinceMs);
    }

    sorted = sorted.slice(0, CONFIG.maxActivities);

    return {
      agents: Array.from(activeSessions.keys()),
      activities: sorted,
      system: getSystemStats(),
      updatedAt: new Date().toISOString()
    };
  }

  function getActiveSessionsCount() {
    return activeSessions.size;
  }

  return {
    init,
    getStatus,
    getActiveSessionsCount
  };
}

module.exports = { createMonitorStore };
