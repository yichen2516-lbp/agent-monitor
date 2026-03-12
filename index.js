/**
 * Agent Monitor - OpenClaw Agent 实时状态监控
 *
 * 独立运行版本，无需依赖 LBP-Tools
 *
 * 使用方法:
 * 1. npm install
 * 2. npm start
 * 3. 访问 http://localhost:3450
 *
 * 配置方法 (按优先级):
 * 1. 环境变量: AGENTS_DIR=/path/to/agents npm start
 * 2. 配置文件: 创建 config.json 文件
 * 3. 默认路径: ~/.openclaw/agents
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const os = require('os');
const { getSystemStats, startSystemStatsPolling } = require('./server/system-stats');
const {
  getWorkspaceAgents,
  getValidWorkspaceAgent,
  isPathSafe,
  getFileList,
  generateWorkspaceTree
} = require('./server/workspace');

const app = express();
const PORT = process.env.PORT || 3450;

app.use('/public', express.static(path.join(__dirname, 'public')));

// 读取配置文件
function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      console.error('[Agent-Monitor] 配置文件解析失败:', e.message);
    }
  }
  return {};
}

const fileConfig = loadConfig();

// 获取默认 agents 目录
function getDefaultAgentsDir() {
  // 根据操作系统返回默认路径
  const homeDir = os.homedir();
  return path.join(homeDir, '.openclaw', 'agents');
}

// 配置 (优先级: 环境变量 > 配置文件 > 默认)
const CONFIG = {
  agentsDir: process.env.AGENTS_DIR || fileConfig.agentsDir || getDefaultAgentsDir(),
  maxActivities: process.env.MAX_ACTIVITIES || fileConfig.maxActivities || 300,
  pollInterval: process.env.POLL_INTERVAL || fileConfig.pollInterval || 10000,
  refreshInterval: process.env.REFRESH_INTERVAL || fileConfig.refreshInterval || 1000,
  logRetentionDays: Number(process.env.LOG_RETENTION_DAYS || fileConfig.logRetentionDays || 3)
};

console.log('[Agent-Monitor] Agents 目录:', CONFIG.agentsDir);

// 日志（按天滚动 + 自动清理）
const LOG_DIR = path.join(__dirname, 'logs');

function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (e) {
    console.error('[Agent-Monitor] 创建日志目录失败:', e.message);
  }
}

function getDailyLogFileName(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `agent-monitor-${y}-${m}-${d}.log`;
}

function writeRollingLog(level, message) {
  try {
    ensureLogDir();
    const line = `[${new Date().toISOString()}] [${level}] ${message}
`;
    const filePath = path.join(LOG_DIR, getDailyLogFileName());
    fs.appendFileSync(filePath, line, 'utf8');
  } catch (e) {
    console.error('[Agent-Monitor] 写日志失败:', e.message);
  }
}

function cleanupOldLogs() {
  try {
    ensureLogDir();
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => /^agent-monitor-\d{4}-\d{2}-\d{2}\.log$/.test(f));

    const now = Date.now();
    const keepMs = Math.max(1, CONFIG.logRetentionDays) * 24 * 60 * 60 * 1000;

    for (const file of files) {
      const match = file.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (!match) continue;
      const ts = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`).getTime();
      if (isNaN(ts)) continue;
      if (now - ts > keepMs) {
        fs.unlinkSync(path.join(LOG_DIR, file));
      }
    }
  } catch (e) {
    console.error('[Agent-Monitor] 清理旧日志失败:', e.message);
  }
}

// 启动时清理一次，运行中每 6 小时清理一次
cleanupOldLogs();
setInterval(cleanupOldLogs, 6 * 60 * 60 * 1000);

// 状态
let recentActivities = [];
let cronActivities = [];
let activeSessions = new Map();
// 用于存储 toolCall 和 toolResult 的关联信息
let pendingToolCalls = new Map();

// API 观测指标
const apiMetrics = {
  total: 0,
  sinceRequests: 0,
  totalLatencyMs: 0
};

// 启动系统监控 (每2秒更新一次)
startSystemStatsPolling(2000);

// 获取所有 agent 的最新会话文件
function getAllSessions() {
  const sessions = [];

  try {
    if (!fs.existsSync(CONFIG.agentsDir)) {
      console.error('[Agent-Monitor] Agents 目录不存在:', CONFIG.agentsDir);
      return sessions;
    }

    const agents = fs.readdirSync(CONFIG.agentsDir)
      .filter(name => !name.startsWith('.'));

    for (const agent of agents) {
      const sessionsDir = path.join(CONFIG.agentsDir, agent, 'sessions');
      if (!fs.existsSync(sessionsDir)) continue;

      const files = fs.readdirSync(sessionsDir)
        .filter(f => f.endsWith('.jsonl') && !f.includes('.deleted'))
        .map(f => {
          const fullPath = path.join(sessionsDir, f);
          const stats = fs.statSync(fullPath);
          return {
            agent,
            name: f,
            path: fullPath,
            size: stats.size,
            mtime: stats.mtime,
            source: 'session'
          };
        })
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > 0) {
        sessions.push(files[0]);
      }
    }
  } catch (e) {
    console.error('[Agent-Monitor] 读取失败:', e.message);
  }

  return sessions;
}

// 获取所有 cron 运行记录文件
function getCronRuns() {
  const cronRuns = [];
  const cronDir = path.join(os.homedir(), '.openclaw', 'cron', 'runs');

  try {
    if (!fs.existsSync(cronDir)) {
      return cronRuns;
    }

    const files = fs.readdirSync(cronDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const fullPath = path.join(cronDir, f);
        const stats = fs.statSync(fullPath);
        return {
          agent: 'cron',
          name: f,
          path: fullPath,
          size: stats.size,
          mtime: stats.mtime,
          source: 'cron'
        };
      })
      .sort((a, b) => b.mtime - a.mtime);

    // 只取最新的5个cron文件（避免太多历史数据）
    return files.slice(0, 5);
  } catch (e) {
    console.error('[Agent-Monitor] 读取 cron 目录失败:', e.message);
  }

  return cronRuns;
}

// 解析单行活动
function parseActivityLine(line, agentName, sessionName) {
  try {
    const data = JSON.parse(line);
    if (!data.timestamp) return null;

    const baseTimestamp = new Date(data.timestamp).getTime();
    const activities = [];

    // 处理 toolResult - 存储以便后续 toolCall 关联
    if (data.type === 'message' && data.message?.role === 'toolResult') {
      const toolCallId = data.message.toolCallId;
      const details = data.message.details || {};
      if (toolCallId) {
        pendingToolCalls.set(toolCallId, {
          durationMs: details.durationMs,
          exitCode: details.exitCode,
          status: details.status,
          isError: data.message.isError
        });
        // 清理旧的 pendingToolCalls（保留最近100个）
        if (pendingToolCalls.size > 100) {
          const firstKey = pendingToolCalls.keys().next().value;
          pendingToolCalls.delete(firstKey);
        }
      }
      return null; // toolResult 不直接显示
    }

    if (data.type === 'message' && data.message?.role === 'assistant') {
      const content = data.message.content || [];
      
      // 提取模型和 usage 信息
      const model = data.model || data.message.model;
      const provider = data.provider || data.message.provider;
      const usage = data.usage;
      const stopReason = data.stopReason;

      content.forEach((item, index) => {
        const itemTimestamp = new Date(baseTimestamp + index * 10);

        if (item.type === 'toolCall') {
          const toolName = item.name || 'unknown';
          const args = item.arguments || {};
          const toolCallId = item.id;

          let description = '';
          const toolMap = {
            'read': () => `📄 read    ${args.file_path || args.path || 'unknown'}`,
            'exec': () => `🔍 exec    ${args.command || ''}`,
            'edit': () => `✏️  edit    ${args.file_path || args.path || 'unknown'}`,
            'write': () => `📝 write   ${args.file_path || args.path || 'unknown'}`,
            'web_search': () => `🌐 search  ${args.query || ''}`,
            'web_fetch': () => `🌐 fetch   ${args.url || ''}`,
            'message': () => `💬 message ${args.action || ''}`,
            'sessions_send': () => `📨 send    ${args.sessionKey || ''}`,
            'sessions_spawn': () => `🚀 spawn   ${args.agentId || ''}`,
            'subagents': () => `👥 subagents ${args.action || ''}`,
            'image': () => `🖼️  image   ${args.prompt || ''}`,
            'pdf': () => `📄 pdf     ${args.prompt || ''}`,
            'process': () => `⚙️  process ${args.action || ''}`,
            'browser': () => `🌐 browser ${args.action || ''}`
          };

          description = toolMap[toolName] ? toolMap[toolName]() : `⚙️  ${toolName}`;

          // 尝试获取关联的 toolResult 信息
          const toolResult = toolCallId ? pendingToolCalls.get(toolCallId) : null;

          activities.push({
            type: 'tool',
            agent: agentName,
            sessionName: sessionName,
            tool: toolName,
            description,
            timestamp: itemTimestamp.toISOString(),
            // 新增元数据
            model: model,
            provider: provider,
            usage: usage,
            stopReason: stopReason,
            durationMs: toolResult?.durationMs,
            exitCode: toolResult?.exitCode,
            toolStatus: toolResult?.status,
            toolError: toolResult?.isError
          });
        }

        if (item.type === 'thinking') {
          const thinkingText = item.thinking || '';
          activities.push({
            type: 'thinking',
            agent: agentName,
            sessionName: sessionName,
            description: `💭 ${thinkingText}`,
            timestamp: itemTimestamp.toISOString(),
            // 新增元数据
            model: model,
            provider: provider,
            usage: usage,
            stopReason: stopReason
          });
        }

        if (item.type === 'text' && item.text) {
          activities.push({
            type: 'reply',
            agent: agentName,
            sessionName: sessionName,
            description: `💬 ${item.text}`,
            timestamp: itemTimestamp.toISOString(),
            fullText: item.text,
            // 新增元数据
            model: model,
            provider: provider,
            usage: usage,
            stopReason: stopReason
          });
        }
      });
    }

    return activities;
  } catch (e) {
    return null;
  }
}

// 解析 cron 运行记录行
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

    // 从 sessionKey 中提取 agent 名称和 session ID
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
      error: error,
      durationMs: durationMs,
      usage: usage
    }];
  } catch (e) {
    return null;
  }
}

// 加载会话文件
function loadSessionFile(sessionInfo) {
  const { agent, path: filePath, source, name } = sessionInfo;

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());

    // 提取 session 名称（从文件名）
    const sessionName = name ? name.replace('.jsonl', '').slice(0, 8) : '';

    for (const line of lines) {
      let activities;
      if (source === 'cron') {
        activities = parseCronLine(line);
      } else {
        activities = parseActivityLine(line, agent, sessionName);
      }
      if (activities) {
        if (source === 'cron') {
          cronActivities.push(...activities.map(a => ({ ...a, source: filePath })));
        } else {
          recentActivities.push(...activities.map(a => ({ ...a, source: filePath })));
        }
      }
    }

    // 分别限制数量
    if (recentActivities.length > CONFIG.maxActivities) {
      recentActivities = recentActivities.slice(-CONFIG.maxActivities);
    }
    if (cronActivities.length > 50) {  // cron 只保留最近 50 条
      cronActivities = cronActivities.slice(-50);
    }

    console.log(`[Agent-Monitor] 加载 ${source === 'cron' ? 'cron' : agent}: ${path.basename(filePath)} (${lines.length} 行)`);

    return fs.statSync(filePath).size;
  } catch (e) {
    console.error(`[Agent-Monitor] 加载失败 ${agent}:`, e.message);
    return 0;
  }
}

// 监控会话文件
function watchSession(sessionInfo) {
  const { agent, path: filePath } = sessionInfo;

  // Close旧监控
  if (activeSessions.has(agent)) {
    const old = activeSessions.get(agent);
    if (old.watcher) old.watcher.close();
  }

  const lastSize = loadSessionFile(sessionInfo);

  // 提取 session 名称
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
            if (recentActivities.length > CONFIG.maxActivities) {
              recentActivities.shift();
            }
          }
        }
      }

      session.lastSize = stats.size;
    } catch (err) {
      console.error(`[Agent-Monitor] 监控错误 ${agent}:`, err.message);
    }
  });

  activeSessions.set(agent, { file: filePath, watcher, lastSize, sessionName });
}

// 初始化所有 agent
function init() {
  const sessions = getAllSessions();
  const cronRuns = getCronRuns();

  for (const session of sessions) {
    watchSession(session);
  }

  // 加载 cron 数据（只加载，不监控文件变化）
  for (const cronRun of cronRuns) {
    loadSessionFile(cronRun);
  }

  if (sessions.length === 0 && cronRuns.length === 0) {
    console.log('[Agent-Monitor] 未找到任何会话文件，等待中...');
  }

  // 每10秒检查新会话
  setInterval(() => {
    const sessions = getAllSessions();

    for (const session of sessions) {
      const existing = activeSessions.get(session.agent);

      if (!existing) {
        console.log(`[Agent-Monitor] 发现新 agent: ${session.agent}`);
        watchSession(session);
      } else if (existing.file !== session.path) {
        console.log(`[Agent-Monitor] ${session.agent} 新会话: ${session.name}`);
        watchSession(session);
      }
    }

    // 定期刷新 cron 数据（每10秒检查一次）
    const newCronRuns = getCronRuns();
    for (const cronRun of newCronRuns) {
      loadSessionFile(cronRun);
    }
  }, CONFIG.pollInterval);
}

// 获取状态
function getStatus(since = null) {
  // 合并 session 和 cron 记录
  const allActivities = [...recentActivities, ...cronActivities];
  let sorted = allActivities
    .slice()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (since) {
    const sinceMs = new Date(since).getTime();
    if (!isNaN(sinceMs)) {
      sorted = sorted.filter(a => new Date(a.timestamp).getTime() > sinceMs);
    }
  }

  sorted = sorted.slice(0, CONFIG.maxActivities);

  return {
    agents: Array.from(activeSessions.keys()),
    activities: sorted,
    system: getSystemStats(),
    updatedAt: new Date().toISOString()
  };
}

// 路由
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(HTML_PAGE);
});

app.get('/api', (req, res) => {
  const start = Date.now();
  const since = req.query.since || null;

  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Content-Type', 'application/json');

  const payload = getStatus(since);
  res.json(payload);

  const latency = Date.now() - start;
  apiMetrics.total += 1;
  if (since) apiMetrics.sinceRequests += 1;
  apiMetrics.totalLatencyMs += latency;

  const avgLatency = (apiMetrics.totalLatencyMs / apiMetrics.total).toFixed(1);
  const sinceHitRate = ((apiMetrics.sinceRequests / apiMetrics.total) * 100).toFixed(1);

  const apiLog = `[Agent-Monitor][API] /api latency=${latency}ms avg=${avgLatency}ms count=${payload.activities.length} since=${since ? 'yes' : 'no'} sinceHitRate=${sinceHitRate}% total=${apiMetrics.total}`;
  console.log(apiLog);
  writeRollingLog('INFO', apiLog);
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', agents: activeSessions.size });
});

// ═════════════════════════════════════════════════════════════════════════════
// Workspace Browser - 多 Agent 文件浏览器
// ═════════════════════════════════════════════════════════════════════════════

// Workspace helpers moved to ./server/workspace

// Workspace 主页面
app.get('/workspace', (req, res) => {
  const agents = getWorkspaceAgents();
  const agent = getValidWorkspaceAgent(req.query.agent || 'main');
  const config = agents[agent];
  const files = getFileList(config.workspace);
  const fileTree = generateWorkspaceTree(files, agent);

  let fileCount = 0, dirCount = 0;
  function count(items) {
    for (const item of items) {
      if (item.type === 'file') fileCount++;
      else if (item.type === 'directory') { dirCount++; if (item.children) count(item.children); }
    }
  }
  count(files);

  const agentTabs = Object.entries(agents).map(([key, cfg]) => `
    <a href="?agent=${key}" class="agent-tab ${key === agent ? 'active' : ''}" style="${key === agent ? `--color: ${cfg.color}` : ''}">
      <span>${cfg.emoji}</span>
      <span>${cfg.name}</span>
    </a>
  `).join('');

  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workspace Browser - ${config.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      background: #0d1117;
      color: #c9d1d9;
      line-height: 1.6;
    }
    .container { display: flex; height: 100vh; }
    .sidebar {
      width: 320px;
      background: #161b22;
      border-right: 1px solid #30363d;
      display: flex;
      flex-direction: column;
    }
    .sidebar-header {
      padding: 16px;
      border-bottom: 1px solid #30363d;
    }
    .sidebar-title {
      font-size: 14px;
      font-weight: 600;
      color: #f0f6fc;
      margin-bottom: 12px;
    }
    .agent-tabs {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .agent-tab {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: #21262d;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #8b949e;
      text-decoration: none;
      font-size: 13px;
      transition: all 0.2s;
    }
    .agent-tab:hover {
      background: #30363d;
      color: #c9d1d9;
    }
    .agent-tab.active {
      background: #21262d;
      border-color: var(--color, #58a6ff);
      color: #f0f6fc;
      box-shadow: 0 0 0 1px var(--color, #58a6ff);
    }
    .file-tree-container {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }
    .file-tree { list-style: none; }
    .file-tree li { margin: 2px 0; }
    .dir-header, .file-link {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    }
    .dir-header:hover, .file-link:hover {
      background: #21262d;
    }
    .dir-arrow {
      font-size: 10px;
      width: 12px;
      transition: transform 0.2s;
    }
    .dir-header.expanded .dir-arrow { transform: rotate(90deg); }
    .dir-icon { font-size: 14px; }
    .dir-name { flex: 1; }
    .dir-count {
      font-size: 10px;
      color: #8b949e;
      background: #21262d;
      padding: 1px 6px;
      border-radius: 10px;
    }
    .dir-content { overflow: hidden; }
    .dir-content.collapsed { display: none; }
    .dir-content ul { padding-left: 16px; border-left: 1px solid #30363d; margin-left: 8px; }
    .file-link {
      color: #c9d1d9;
      text-decoration: none;
    }
    .file-icon { font-size: 14px; }
    .file-name { flex: 1; }
    .file-size {
      font-size: 11px;
      color: #8b949e;
    }
    .main {
      flex: 1;
      padding: 24px;
      overflow-y: auto;
    }
    .header-nav {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #30363d;
    }
    .header-nav a {
      color: #8b949e;
      text-decoration: none;
      font-size: 14px;
    }
    .header-nav a:hover { color: #58a6ff; }
    .welcome {
      text-align: center;
      padding: 60px 20px;
    }
    .welcome-emoji { font-size: 64px; margin-bottom: 16px; }
    .welcome h2 { font-size: 24px; margin-bottom: 8px; }
    .welcome p { color: #8b949e; margin-bottom: 16px; }
    .welcome .path {
      font-family: monospace;
      font-size: 12px;
      color: #6e7681;
      background: #161b22;
      padding: 8px 16px;
      border-radius: 6px;
      display: inline-block;
    }
    .stats {
      display: flex;
      gap: 16px;
      justify-content: center;
      margin-top: 24px;
    }
    .stat-box {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 20px 30px;
      text-align: center;
    }
    .stat-value { font-size: 28px; font-weight: 700; color: var(--color, #58a6ff); }
    .stat-label { font-size: 12px; color: #8b949e; margin-top: 4px; }
    .file-view {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      overflow: hidden;
    }
    .file-view-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      background: #21262d;
      border-bottom: 1px solid #30363d;
    }
    .file-view-content {
      padding: 20px;
      overflow-x: auto;
    }
    .file-view-content pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-all;
      font-family: 'SF Mono', monospace;
      font-size: 13px;
      line-height: 1.6;
    }
    .file-view-content.markdown {
      line-height: 1.7;
    }
    .file-view-content.markdown h1, .file-view-content.markdown h2, .file-view-content.markdown h3 {
      margin: 16px 0 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid #30363d;
    }
    .file-view-content.markdown code {
      background: #21262d;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 0.9em;
    }
    .file-view-content.markdown pre {
      background: #0d1117;
      padding: 16px;
      border-radius: 6px;
      border: 1px solid #30363d;
      overflow-x: auto;
    }
    .breadcrumb {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      font-size: 14px;
    }
    .breadcrumb a { color: #58a6ff; text-decoration: none; }
    .breadcrumb a:hover { text-decoration: underline; }
    .breadcrumb-sep { color: #6e7681; }

    /* 移动端适配 */
    .mobile-toggle {
      display: none;
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 50px;
      height: 50px;
      background: #238636;
      border: none;
      border-radius: 50%;
      color: #fff;
      font-size: 20px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }

    @media (max-width: 768px) {
      .container { flex-direction: column; }
      .sidebar {
        width: 100%;
        height: auto;
        max-height: 60vh;
        border-right: none;
        border-bottom: 1px solid #30363d;
      }
      .sidebar.mobile-collapsed {
        display: none;
      }
      .main {
        padding: 16px;
      }
      .main.mobile-hidden {
        display: none;
      }
      .sidebar-header {
        padding: 12px;
      }
      .agent-tabs {
        flex-direction: row;
        flex-wrap: wrap;
        gap: 8px;
      }
      .agent-tab {
        flex: 1;
        min-width: 80px;
        justify-content: center;
        padding: 10px;
      }
      .file-tree-container {
        max-height: 40vh;
        padding: 8px;
      }
      .welcome {
        padding: 30px 16px;
      }
      .welcome-emoji { font-size: 48px; }
      .welcome h2 { font-size: 20px; }
      .stats {
        flex-direction: column;
        gap: 12px;
      }
      .stat-box {
        padding: 16px;
      }
      .header-nav {
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 16px;
        padding-bottom: 12px;
      }
      .file-view-content {
        padding: 12px;
      }
      .breadcrumb {
        flex-wrap: wrap;
        font-size: 13px;
      }
      .mobile-toggle { display: flex; }
    }

    @media (max-width: 480px) {
      .agent-tab {
        font-size: 12px;
        padding: 8px;
      }
      .agent-tab span:first-child {
        font-size: 16px;
      }
      .welcome-emoji { font-size: 40px; }
      .welcome h2 { font-size: 18px; }
      .stat-value { font-size: 24px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-title">📁 文件列表</div>
        <div class="agent-tabs">${agentTabs}</div>
      </div>
      <div class="file-tree-container">${fileTree}</div>
    </aside>
    <main class="main">
      <div class="header-nav">
        <a href="/">← 返回 Monitor</a>
        <span style="color:#30363d">|</span>
        <span style="color:#8b949e;font-size:14px">${config.name}'s Workspace</span>
      </div>
      <div class="welcome">
        <div class="welcome-emoji">${config.emoji}</div>
        <h2>${config.name}'s Workspace</h2>
        <p>从左侧选择文件开始浏览</p>
        <div class="path">${config.workspace}</div>
        <div class="stats">
          <div class="stat-box" style="--color:${config.color}">
            <div class="stat-value">${fileCount}</div>
            <div class="stat-label">文件</div>
          </div>
          <div class="stat-box" style="--color:#58a6ff">
            <div class="stat-value">${dirCount}</div>
            <div class="stat-label">文件夹</div>
          </div>
        </div>
      </div>
    </main>
  </div>
  <button class="mobile-toggle" onclick="toggleSidebar()" title="切换侧边栏">📂</button>
  <script>
    function toggleDir(header) {
      header.classList.toggle('expanded');
      const content = header.nextElementSibling;
      if (content) content.classList.toggle('collapsed');
    }

    // 移动端侧边栏切换
    function toggleSidebar() {
      const sidebar = document.querySelector('.sidebar');
      const main = document.querySelector('.main');
      sidebar.classList.toggle('mobile-collapsed');
      if (sidebar.classList.contains('mobile-collapsed')) {
        sidebar.style.display = 'none';
        main.style.display = 'block';
      } else {
        sidebar.style.display = 'block';
        main.style.display = 'none';
      }
    }

    // 检测是否为移动端
    function isMobile() {
      return window.innerWidth <= 768;
    }

    // 文件链接点击处理（移动端）
    document.querySelectorAll('.file-link').forEach(link => {
      link.addEventListener('click', function() {
        if (isMobile()) {
          // 移动端点击文件后自动隐藏侧边栏
          const sidebar = document.querySelector('.sidebar');
          const main = document.querySelector('.main');
          sidebar.classList.add('mobile-collapsed');
          sidebar.style.display = 'none';
          main.style.display = 'block';
        }
      });
    });
  </script>
</body>
</html>`);
});

// Workspace 文件查看
app.get('/workspace/view/*', (req, res) => {
  const agents = getWorkspaceAgents();
  const agent = getValidWorkspaceAgent(req.query.agent || 'main');
  const config = agents[agent];
  const filePath = decodeURIComponent(req.params[0]);
  const fullPath = path.join(config.workspace, filePath);

  if (!isPathSafe(fullPath, config.workspace) || !fs.existsSync(fullPath)) {
    return res.status(404).send('文件不存在');
  }

  const stat = fs.statSync(fullPath);
  const fileName = path.basename(filePath);
  const ext = path.extname(fileName).toLowerCase();

  // 读取文件内容
  let contentHtml;
  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    if (ext === '.md') {
      // 简单的 markdown 渲染
      let html = content
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/```[\s\S]*?```/g, '<pre><code>$&</code></pre>')
        .replace(/\n/g, '<br>');
      contentHtml = `<div class="file-view-content markdown">${html}</div>`;
    } else {
      contentHtml = `<div class="file-view-content"><pre>${content}</pre></div>`;
    }
  } catch (e) {
    contentHtml = `<div class="file-view-content"><p style="color:#f85149">无法读取文件: ${e.message}</p></div>`;
  }

  // 面包屑
  const parts = filePath.split('/').filter(p => p);
  let breadcrumbPath = '';
  const breadcrumbs = parts.map((part, i) => {
    breadcrumbPath += '/' + part;
    const isLast = i === parts.length - 1;
    if (isLast) return `<span style="color:#f0f6fc">${part}</span>`;
    return `<a href="/workspace/view/${encodeURIComponent(breadcrumbPath)}?agent=${agent}">${part}</a>`;
  }).join('<span class="breadcrumb-sep">/</span>');

  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${fileName} - Workspace</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      background: #0d1117;
      color: #c9d1d9;
      line-height: 1.6;
    }
    .container { display: flex; height: 100vh; }
    .sidebar {
      width: 320px;
      background: #161b22;
      border-right: 1px solid #30363d;
    }
    .sidebar-header {
      padding: 16px;
      border-bottom: 1px solid #30363d;
    }
    .sidebar-title { font-size: 14px; font-weight: 600; color: #f0f6fc; }
    .main {
      flex: 1;
      padding: 24px;
      overflow-y: auto;
    }
    .header-nav {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid #30363d;
    }
    .header-nav a {
      color: #8b949e;
      text-decoration: none;
      font-size: 14px;
    }
    .header-nav a:hover { color: #58a6ff; }
    .breadcrumb {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      font-size: 14px;
    }
    .breadcrumb a { color: #58a6ff; text-decoration: none; }
    .breadcrumb a:hover { text-decoration: underline; }
    .breadcrumb-sep { color: #6e7681; }
    .file-view {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      overflow: hidden;
    }
    .file-view-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      background: #21262d;
      border-bottom: 1px solid #30363d;
    }
    .file-view-content {
      padding: 20px;
      overflow-x: auto;
      max-height: calc(100vh - 200px);
      overflow-y: auto;
    }
    .file-view-content pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-all;
      font-family: 'SF Mono', monospace;
      font-size: 13px;
      line-height: 1.6;
    }
    .file-view-content.markdown {
      line-height: 1.7;
    }
    .file-view-content.markdown h1, .file-view-content.markdown h2, .file-view-content.markdown h3 {
      margin: 16px 0 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid #30363d;
    }
    .file-view-content.markdown code {
      background: #21262d;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 0.9em;
    }
    .file-view-content.markdown pre {
      background: #0d1117;
      padding: 16px;
      border-radius: 6px;
      border: 1px solid #30363d;
      overflow-x: auto;
    }
    .file-view-content.markdown pre code {
      background: none;
      padding: 0;
    }

    /* 文件查看页面移动端适配 */
    @media (max-width: 768px) {
      .file-view-page .container { flex-direction: column; }
      .file-view-page .sidebar {
        width: 100%;
        height: auto;
        border-right: none;
        border-bottom: 1px solid #30363d;
      }
      .file-view-page .sidebar-header {
        padding: 12px;
      }
      .file-view-page .main {
        padding: 12px;
      }
      .file-view-page .header-nav {
        flex-wrap: wrap;
        gap: 8px;
      }
      .file-view-page .file-view-header {
        padding: 12px;
        font-size: 13px;
      }
      .file-view-page .file-view-content {
        padding: 12px;
        max-height: calc(100vh - 180px);
      }
      .file-view-page .breadcrumb {
        flex-wrap: wrap;
        font-size: 12px;
      }
    }
  </style>
</head>
<body class="file-view-page">
  <div class="container">
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-title">📂 ${fileName}</div>
      </div>
    </aside>
    <main class="main">
      <div class="header-nav">
        <a href="/">← 返回 Monitor</a>
        <a href="/workspace?agent=${agent}">← 返回 Workspace</a>
      </div>
      <div class="breadcrumb">
        <a href="/workspace?agent=${agent}">📂 Home</a>
        <span class="breadcrumb-sep">/</span>
        ${breadcrumbs}
      </div>
      <div class="file-view">
        <div class="file-view-header">
          <span>${getFileIcon(fileName)}</span>
          <span style="font-weight:600">${fileName}</span>
          <span style="color:#8b949e;margin-left:auto">${formatFileSize(stat.size)}</span>
        </div>
        ${contentHtml}
      </div>
    </main>
  </div>
</body>
</html>`);
});

// HTML 页面
const HTML_PAGE = fs.readFileSync(path.join(__dirname, 'views/monitor.html'), 'utf8');

// 启动
init();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║              Agent Monitor 已启动                      ║
╠════════════════════════════════════════════════════════╣
║  本地访问: http://localhost:${PORT}                    ║
║  局域网访问: http://0.0.0.0:${PORT}                    ║
║  API: http://localhost:${PORT}/api                     ║
╚════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
