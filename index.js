/**
 * Agent Monitor - OpenClaw Agent 实时状态监控
 * 
 * 独立运行版本，无需依赖 LBP-Tools
 * 
 * 使用方法:
 * 1. npm install
 * 2. npm start
 * 3. 访问 http://localhost:3450
 */

const fs = require('fs');
const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3450;

// 配置
const CONFIG = {
  agentsDir: '/Users/lbp/.openclaw/agents',
  maxActivities: 100,
  pollInterval: 10000, // 检查新会话间隔
  refreshInterval: 3000 // 前端刷新间隔
};

// 状态
let recentActivities = [];
let activeSessions = new Map();

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
            mtime: stats.mtime
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

// 解析单行活动
function parseActivityLine(line, agentName) {
  try {
    const data = JSON.parse(line);
    if (!data.timestamp) return null;
    
    const baseTimestamp = new Date(data.timestamp).getTime();
    const activities = [];
    
    if (data.type === 'message' && data.message?.role === 'assistant') {
      const content = data.message.content || [];
      
      content.forEach((item, index) => {
        const itemTimestamp = new Date(baseTimestamp + index * 10);
        
        if (item.type === 'toolCall') {
          const toolName = item.name || 'unknown';
          const args = item.arguments || {};
          
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
          
          activities.push({
            type: 'tool',
            agent: agentName,
            tool: toolName,
            description,
            timestamp: itemTimestamp.toISOString()
          });
        }
        
        if (item.type === 'thinking') {
          activities.push({
            type: 'thinking',
            agent: agentName,
            description: `💭 thinking: ${item.thinking || ''}`,
            timestamp: itemTimestamp.toISOString()
          });
        }
        
        if (item.type === 'text' && item.text) {
          activities.push({
            type: 'reply',
            agent: agentName,
            description: `💬 ${item.text}`,
            timestamp: itemTimestamp.toISOString(),
            fullText: item.text
          });
        }
      });
    }
    
    return activities;
  } catch (e) {
    return null;
  }
}

// 加载会话文件
function loadSessionFile(sessionInfo) {
  const { agent, path: filePath } = sessionInfo;
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    
    for (const line of lines) {
      const activities = parseActivityLine(line, agent);
      if (activities) {
        recentActivities.push(...activities.map(a => ({ ...a, source: filePath })));
      }
    }
    
    if (recentActivities.length > CONFIG.maxActivities) {
      recentActivities = recentActivities.slice(-CONFIG.maxActivities);
    }
    
    console.log(`[Agent-Monitor] 加载 ${agent}: ${path.basename(filePath)} (${lines.length} 行)`);
    
    return fs.statSync(filePath).size;
  } catch (e) {
    console.error(`[Agent-Monitor] 加载失败 ${agent}:`, e.message);
    return 0;
  }
}

// 监控会话文件
function watchSession(sessionInfo) {
  const { agent, path: filePath } = sessionInfo;
  
  // 关闭旧监控
  if (activeSessions.has(agent)) {
    const old = activeSessions.get(agent);
    if (old.watcher) old.watcher.close();
  }
  
  const lastSize = loadSessionFile(sessionInfo);
  
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
        const activities = parseActivityLine(line, agent);
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
  
  activeSessions.set(agent, { file: filePath, watcher, lastSize });
}

// 初始化所有 agent
function init() {
  const sessions = getAllSessions();
  
  for (const session of sessions) {
    watchSession(session);
  }
  
  if (sessions.length === 0) {
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
  }, CONFIG.pollInterval);
}

// 获取状态
function getStatus() {
  const sorted = recentActivities
    .slice()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, CONFIG.maxActivities);
  
  return {
    agents: Array.from(activeSessions.keys()),
    activities: sorted,
    updatedAt: new Date().toISOString()
  };
}

// 路由
app.get('/', (req, res) => {
  res.send(HTML_PAGE);
});

app.get('/api', (req, res) => {
  res.json(getStatus());
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', agents: activeSessions.size });
});

// HTML 页面
const HTML_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Cache-Control" content="no-store">
  <title>Agent Monitor - OpenClaw 实时状态</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      background: #0d1117;
      color: #c9d1d9;
      padding: 20px;
      line-height: 1.6;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    
    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid #30363d;
      flex-wrap: wrap;
    }
    
    .status-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #238636;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    
    .header h1 { font-size: 20px; font-weight: 600; }
    .header .online { color: #7ee787; font-size: 14px; }
    .agents-list {
      margin-left: auto;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .agent-tag {
      padding: 4px 10px;
      background: #23863633;
      border: 1px solid #238636;
      border-radius: 12px;
      font-size: 12px;
      color: #7ee787;
    }
    
    .stats {
      display: flex;
      gap: 20px;
      margin-bottom: 20px;
      font-size: 13px;
      color: #8b949e;
    }
    
    .activity-list { display: flex; flex-direction: column; gap: 6px; }
    
    .activity-item {
      display: block;
      padding: 12px 14px;
      background: #161b22;
      border-radius: 6px;
      border: 1px solid #30363d;
      font-size: 12px;
      margin-bottom: 6px;
    }
    
    .activity-item:hover { background: #1c2128; border-color: #58a6ff; }
    
    /* Agent 颜色 */
    .activity-item.LBP { border-left: 3px solid #238636; }
    .activity-item.DEEP { border-left: 3px solid #58a6ff; }
    .activity-item.GEEK { border-left: 3px solid #a371f7; }
    .activity-item.EDGE { border-left: 3px solid #f778ba; }
    .activity-item.COOL { border-left: 3px solid #f7931a; }
    .activity-item.TIM { border-left: 3px solid #8b949e; }
    
    .meta {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 6px;
    }
    
    .timestamp { color: #8b949e; font-size: 11px; }
    
    .agent-name {
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .agent-name.LBP { background: #23863633; color: #7ee787; }
    .agent-name.DEEP { background: #58a6ff33; color: #58a6ff; }
    .agent-name.GEEK { background: #a371f733; color: #a371f7; }
    .agent-name.EDGE { background: #f778ba33; color: #f778ba; }
    .agent-name.COOL { background: #f7931a33; color: #f7931a; }
    .agent-name.TIM { background: #8b949e33; color: #8b949e; }
    
    .description {
      color: #c9d1d9;
      white-space: pre-wrap;
      word-wrap: break-word;
      margin-top: 4px;
    }
    
    .thinking .description { color: #8b949e; font-style: italic; }
    .reply .description { color: #c9d1d9; }
    
    .empty { text-align: center; padding: 40px; color: #8b949e; }
    
    .connection-status {
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 8px 16px;
      background: #238636;
      color: white;
      border-radius: 20px;
      font-size: 12px;
      transition: all 0.3s;
    }
    .connection-status.disconnected { background: #da3633; }
    
    .controls {
      margin-bottom: 16px;
      display: flex;
      gap: 10px;
    }
    .btn {
      padding: 6px 12px;
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
    }
    .btn:hover { background: #30363d; }
    .btn.active { background: #238636; border-color: #238636; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="status-dot"></div>
      <h1>⚡ Agent Monitor</h1>
      <span class="online">OpenClaw 实时状态</span>
      <div class="agents-list" id="agents-list"></div>
    </div>
    
    <div class="stats" id="stats">
      <span>Agents: <strong id="agent-count">0</strong></span>
      <span>Activities: <strong id="activity-count">0</strong></span>
    </div>
    
    <div id="activity-list" class="activity-list">
      <div class="empty">加载中...</div>
    </div>
    
    <div id="connection-status" class="connection-status">连接中...</div>
  </div>

  <script>
    const listEl = document.getElementById('activity-list');
    const statusEl = document.getElementById('connection-status');
    const agentsEl = document.getElementById('agents-list');
    const agentCountEl = document.getElementById('agent-count');
    const activityCountEl = document.getElementById('activity-count');
    
    let lastActivities = [];
    
    function formatTime(isoString) {
      const date = new Date(isoString);
      return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    
    function createActivityItem(activity) {
      const div = document.createElement('div');
      div.className = 'activity-item ' + (activity.agent || 'unknown');
      if (activity.type === 'thinking') div.classList.add('thinking');
      if (activity.type === 'reply') div.classList.add('reply');
      
      const meta = document.createElement('div');
      meta.className = 'meta';
      
      const time = document.createElement('span');
      time.className = 'timestamp';
      time.textContent = formatTime(activity.timestamp);
      
      const agent = document.createElement('span');
      agent.className = 'agent-name ' + (activity.agent || 'unknown');
      agent.textContent = activity.agent || '?';
      
      meta.appendChild(time);
      meta.appendChild(agent);
      
      const desc = document.createElement('span');
      desc.className = 'description';
      desc.textContent = activity.description;
      
      div.appendChild(meta);
      div.appendChild(desc);
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
      agentCountEl.textContent = agents.length;
    }
    
    function updateList(activities) {
      if (activities.length === 0) {
        listEl.innerHTML = '<div class="empty">暂无活动</div>';
        activityCountEl.textContent = 0;
        return;
      }
      
      // 只更新有变化的部分
      const currentCount = listEl.children.length;
      const newCount = activities.length;
      
      if (currentCount === 0 || newCount > currentCount) {
        listEl.innerHTML = '';
        activities.forEach(activity => {
          listEl.appendChild(createActivityItem(activity));
        });
      }
      
      activityCountEl.textContent = activities.length;
      lastActivities = activities;
    }
    
    async function poll() {
      try {
        const res = await fetch('/api?t=' + Date.now());
        const data = await res.json();
        
        updateAgents(data.agents || []);
        updateList(data.activities || []);
        
        statusEl.textContent = '实时连接 (' + (data.agents || []).length + ' agents)';
        statusEl.classList.remove('disconnected');
      } catch (err) {
        statusEl.textContent = '连接失败 - 重试中...';
        statusEl.classList.add('disconnected');
      }
    }
    
    poll();
    setInterval(poll, 3000);
  </script>
</body>
</html>`;

// 启动
init();

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║              Agent Monitor 已启动                      ║
╠════════════════════════════════════════════════════════╣
║  访问地址: http://localhost:${PORT}                    ║
║  API: http://localhost:${PORT}/api                     ║
╚════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;