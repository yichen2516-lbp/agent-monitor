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
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3450;

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
  refreshInterval: process.env.REFRESH_INTERVAL || fileConfig.refreshInterval || 1000
};

console.log('[Agent-Monitor] Agents 目录:', CONFIG.agentsDir);

// 状态
let recentActivities = [];
let cronActivities = [];
let activeSessions = new Map();
// 用于存储 toolCall 和 toolResult 的关联信息
let pendingToolCalls = new Map();

// 系统监控状态
let systemStats = {
  cpu: { used: 0, user: 0, sys: 0, idle: 100 },
  gpu: { used: 0, name: 'N/A' },
  memory: { used: 0, total: 0, percentage: 0 },
  disk: { used: 0, total: 0, percentage: 0 },
  updatedAt: null
};

// 检测操作系统平台
const PLATFORM = os.platform();
const IS_MACOS = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';

// 异步执行命令（不阻塞）
function execAsync(command, timeout = 5000) {
  return new Promise((resolve) => {
    try {
      const result = execSync(command, { encoding: 'utf8', timeout });
      resolve(result);
    } catch (e) {
      resolve(null);
    }
  });
}

// 获取 CPU 使用情况
async function getCPUStats() {
  try {
    let output;
    
    if (IS_MACOS) {
      // macOS: top -l 1 -n 0
      output = await execAsync('top -l 1 -n 0 | grep "CPU usage"', 3000);
      if (output) {
        const match = output.match(/(\d+\.?\d*)%\s*user.*?(\d+\.?\d*)%\s*sys.*?(\d+\.?\d*)%\s*idle/);
        if (match) {
          const user = parseFloat(match[1]) || 0;
          const sys = parseFloat(match[2]) || 0;
          const idle = parseFloat(match[3]) || 0;
          return { used: Math.round(user + sys), user, sys, idle };
        }
      }
    } else if (IS_LINUX) {
      // Linux: 读取 /proc/stat
      const statOutput = await execAsync('cat /proc/stat | grep "^cpu "', 2000);
      if (statOutput) {
        const parts = statOutput.split(/\s+/);
        if (parts.length >= 8) {
          const user = parseFloat(parts[1]) || 0;
          const nice = parseFloat(parts[2]) || 0;
          const system = parseFloat(parts[3]) || 0;
          const idle = parseFloat(parts[4]) || 0;
          const iowait = parseFloat(parts[5]) || 0;
          const total = user + nice + system + idle + iowait;
          const used = user + nice + system;
          const userPct = (user / total) * 100;
          const sysPct = (system / total) * 100;
          const usedPct = Math.round((used / total) * 100);
          return { used: usedPct, user: userPct, sys: sysPct, idle: (idle / total) * 100 };
        }
      }
      // 备用：使用 top -bn1
      output = await execAsync('top -bn1 | grep "Cpu(s)"', 3000);
      if (output) {
        const match = output.match(/(\d+\.?\d*)%?\s*us.*?(\d+\.?\d*)%?\s*sy/);
        if (match) {
          const user = parseFloat(match[1]) || 0;
          const sys = parseFloat(match[2]) || 0;
          return { used: Math.round(user + sys), user, sys, idle: 100 - user - sys };
        }
      }
    }
  } catch (e) {
    console.error('[Agent-Monitor] 获取 CPU 信息失败:', e.message);
  }
  return { used: 0, user: 0, sys: 0, idle: 100 };
}

// 获取 GPU 使用情况
async function getGPUStats() {
  try {
    let used = 0;
    let name = 'GPU';
    
    if (IS_MACOS) {
      // macOS: ioreg
      const output = await execAsync('ioreg -l | grep -E "(GPU|Metal|AGC)" | head -10', 3000);
      if (output) {
        const activityMatch = output.match(/"GPU Activity"[=:]\s*(\d+)/i) || 
                             output.match(/gpuActivePercentage\s*=\s*(\d+)/i);
        if (activityMatch) used = parseInt(activityMatch[1]) || 0;
        
        const nameMatch = output.match(/"model"[=:]\s*"([^"]+)"/i);
        if (nameMatch) name = nameMatch[1];
      }
    } else if (IS_LINUX) {
      // Linux: 尝试 nvidia-smi (NVIDIA)
      const nvidiaOutput = await execAsync('nvidia-smi --query-gpu=utilization.gpu,name --format=csv,noheader,nounits 2>/dev/null', 3000);
      if (nvidiaOutput) {
        const parts = nvidiaOutput.split(',');
        if (parts.length >= 2) {
          used = parseInt(parts[0].trim()) || 0;
          name = parts[1].trim();
        }
      } else {
        // 尝试 intel_gpu_top (Intel)
        const intelOutput = await execAsync('timeout 1 intel_gpu_top -l 1 2>/dev/null | grep -E "render|3D" | head -1', 3000);
        if (intelOutput) {
          const match = intelOutput.match(/(\d+\.?\d*)/);
          if (match) used = parseFloat(match[1]) || 0;
          name = 'Intel GPU';
        }
      }
    }
    
    return { used, name };
  } catch (e) {
    console.error('[Agent-Monitor] 获取 GPU 信息失败:', e.message);
  }
  return { used: 0, name: 'GPU' };
}

// 获取内存使用情况
function getMemoryStats() {
  try {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
      used: Math.round(used / 1024 / 1024 / 1024 * 100) / 100,
      total: Math.round(total / 1024 / 1024 / 1024 * 100) / 100,
      percentage: Math.round((used / total) * 100)
    };
  } catch (e) {
    console.error('[Agent-Monitor] 获取内存信息失败:', e.message);
    return { used: 0, total: 0, percentage: 0 };
  }
}

// 获取磁盘使用情况
async function getDiskStats() {
  try {
    const output = await execAsync('df -h /', 3000);
    if (output) {
      const lines = output.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        if (parts.length >= 5) {
          const total = parts[1];
          const used = parts[2];
          const percentage = parseInt(parts[4].replace('%', '')) || 0;
          const totalGB = parseFloat(total.replace(/[GT]/, '')) * (total.includes('T') ? 1024 : 1);
          const usedGB = parseFloat(used.replace(/[GT]/, '')) * (used.includes('T') ? 1024 : 1);
          return { used: Math.round(usedGB * 100) / 100, total: Math.round(totalGB * 100) / 100, percentage };
        }
      }
    }
  } catch (e) {
    console.error('[Agent-Monitor] 获取磁盘信息失败:', e.message);
  }
  return { used: 0, total: 0, percentage: 0 };
}

// 更新系统监控数据
async function updateSystemStats() {
  try {
    const [cpu, gpu, disk] = await Promise.all([
      getCPUStats(),
      getGPUStats(),
      getDiskStats()
    ]);
    const memory = getMemoryStats();

    systemStats = {
      cpu,
      gpu,
      memory,
      disk,
      updatedAt: new Date().toISOString()
    };
  } catch (e) {
    console.error('[Agent-Monitor] 更新系统监控失败:', e.message);
  }
}

// 启动系统监控 (每2秒更新一次)
setInterval(updateSystemStats, 2000);
updateSystemStats(); // 立即执行一次

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

  // 关闭旧监控
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
function getStatus() {
  // 合并 session 和 cron 记录
  const allActivities = [...recentActivities, ...cronActivities];
  const sorted = allActivities
    .slice()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, CONFIG.maxActivities);

  return {
    agents: Array.from(activeSessions.keys()),
    activities: sorted,
    system: systemStats,
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
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Content-Type', 'application/json');
  res.json(getStatus());
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', agents: activeSessions.size });
});

// ═════════════════════════════════════════════════════════════════════════════
// Workspace Browser - 多 Agent 文件浏览器
// ═════════════════════════════════════════════════════════════════════════════

// 动态扫描 ~/.openclaw/ 目录下的 workspace 文件夹
function scanWorkspaces() {
  const openclawDir = path.join(os.homedir(), '.openclaw');
  const workspaces = {};

  const agentColors = {
    main: '#f7931a',
    cool: '#58a6ff',
    tim: '#3fb950',
    edge: '#f778ba',
    deep: '#58a6ff',
    geek: '#a371f7'
  };

  const agentEmojis = {
    main: '⚡',
    cool: '❄️',
    tim: '⏱️',
    edge: '🔥',
    deep: '🔧',
    geek: '🤓'
  };

  try {
    if (!fs.existsSync(openclawDir)) {
      return workspaces;
    }

    const entries = fs.readdirSync(openclawDir);

    for (const entry of entries) {
      // 匹配 workspace 或 workspace-<name> 格式
      if (!entry.startsWith('workspace')) continue;

      const fullPath = path.join(openclawDir, entry);
      const stat = fs.statSync(fullPath);
      if (!stat.isDirectory()) continue;

      // 提取 agent 名称
      let agentKey = 'main';
      let displayName = 'Main';

      if (entry.includes('-')) {
        agentKey = entry.replace('workspace-', '').toLowerCase();
        displayName = agentKey.charAt(0).toUpperCase() + agentKey.slice(1);
      }

      workspaces[agentKey] = {
        name: displayName,
        emoji: agentEmojis[agentKey] || '🤖',
        workspace: fullPath,
        color: agentColors[agentKey] || '#8b949e'
      };
    }
  } catch (e) {
    console.error('[Workspace] 扫描工作区失败:', e.message);
  }

  return workspaces;
}

// 动态获取工作区配置
function getWorkspaceAgents() {
  return scanWorkspaces();
}

const WORKSPACE_AGENTS = getWorkspaceAgents();

function getValidWorkspaceAgent(agent) {
  const agents = getWorkspaceAgents();
  return agents[agent] ? agent : 'main';
}

// 安全的文件路径检查
function isPathSafe(filePath, basePath) {
  const resolved = path.resolve(filePath);
  const baseResolved = path.resolve(basePath);
  return resolved.startsWith(baseResolved);
}

// 获取文件列表
function getFileList(dir, basePath = '') {
  const items = [];
  if (!fs.existsSync(dir)) return items;

  const EXCLUDE_DIRS = ['node_modules', '.git', '.venv', '__pycache__', '.pytest_cache', '.next', 'dist', 'build', 'coverage'];
  const EXCLUDE_FILES = ['.DS_Store', 'Thumbs.db'];

  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file.startsWith('.') && !file.startsWith('.openclaw')) continue;
      if (EXCLUDE_FILES.includes(file)) continue;

      const fullPath = path.join(dir, file);
      const relativePath = path.join(basePath, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        if (EXCLUDE_DIRS.includes(file)) continue;
        const children = getFileList(fullPath, relativePath);
        items.push({ name: file, path: relativePath, type: 'directory', children });
      } else {
        items.push({ name: file, path: relativePath, type: 'file', size: stat.size });
      }
    }
  } catch (e) {
    console.error('[Workspace] 读取目录失败:', dir, e.message);
  }

  return items.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });
}

// 格式化文件大小
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// 获取文件图标
function getFileIcon(filename) {
  const icons = {
    '.md': '📝', '.json': '📋', '.js': '💻', '.ts': '💻', '.py': '🐍',
    '.sh': '🔧', '.yml': '⚙️', '.yaml': '⚙️', '.txt': '📄', '.log': '📜',
    '.png': '🖼️', '.jpg': '🖼️', '.jpeg': '🖼️', '.gif': '🖼️', '.svg': '🎨',
    '.html': '🌐', '.css': '🎨', '.sql': '🗄️', '.csv': '📊'
  };
  const ext = path.extname(filename).toLowerCase();
  return icons[ext] || '📄';
}

// 生成文件树 HTML
function generateWorkspaceTree(items, agent, level = 0) {
  if (items.length === 0) return '<p style="color:#666;padding:10px;">暂无文件</p>';

  let html = level === 0 ? '<ul class="file-tree">' : '<ul>';

  for (const item of items) {
    if (item.type === 'directory') {
      const hasChildren = item.children && item.children.length > 0;
      html += `
        <li class="directory">
          <div class="dir-header" onclick="toggleDir(this)">
            <span class="dir-arrow">▶</span>
            <span class="dir-icon">📁</span>
            <span class="dir-name">${item.name}</span>
            <span class="dir-count">${item.children ? item.children.length : 0}</span>
          </div>
          ${hasChildren ? `<div class="dir-content collapsed">${generateWorkspaceTree(item.children, agent, level + 1)}</div>` : ''}
        </li>`;
    } else {
      const icon = getFileIcon(item.name);
      html += `
        <li class="file">
          <a href="/workspace/view/${encodeURIComponent(item.path)}?agent=${agent}" class="file-link">
            <span class="file-icon">${icon}</span>
            <span class="file-name">${item.name}</span>
            <span class="file-size">${formatFileSize(item.size)}</span>
          </a>
        </li>`;
    }
  }

  html += '</ul>';
  return html;
}

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
const HTML_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <meta http-equiv="Cache-Control" content="no-store">
  <title>Agent Monitor v1.4 - OpenClaw 实时状态</title>
  <!-- v1.4: added model, token usage, duration, exit code -->
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
    .nav-links {
      display: flex;
      gap: 16px;
      margin-left: auto;
    }
    .nav-links a {
      color: #8b949e;
      text-decoration: none;
      font-size: 13px;
      padding: 4px 10px;
      border-radius: 4px;
      transition: all 0.2s;
    }
    .nav-links a:hover {
      color: #58a6ff;
      background: #21262d;
    }
    .agent-tag {
      padding: 4px 10px;
      background: #23863633;
      border: 1px solid #238636;
      border-radius: 12px;
      font-size: 12px;
      color: #7ee787;
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
    .activity-item.error-item {
      border-left: 3px solid #f85149 !important;
      background: #2a1416;
      border-color: #5a2a2d;
    }
    .activity-item.error-item:hover {
      background: #34191c;
      border-color: #f85149;
    }

    /* Agent 颜色 */
    .activity-item.LBP { border-left: 3px solid #238636; }
    .activity-item.DEEP { border-left: 3px solid #58a6ff; }
    .activity-item.GEEK { border-left: 3px solid #a371f7; }
    .activity-item.EDGE { border-left: 3px solid #f778ba; }
    .activity-item.COOL { border-left: 3px solid #f7931a; }
    .activity-item.TIM { border-left: 3px solid #8b949e; }
    .activity-item.cron { border-left: 3px solid #8957e5; }

    .meta {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 6px;
      flex-wrap: wrap;
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
    .agent-name.cron { background: #8957e533; color: #8957e5; }

    .session-name {
      color: #58a6ff;
      font-size: 10px;
      font-family: monospace;
      background: #161b22;
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid #30363d;
    }

    .cron-tag {
      padding: 2px 6px;
      background: #8957e533;
      border: 1px solid #8957e5;
      border-radius: 4px;
      font-size: 10px;
      color: #8957e5;
      font-weight: 600;
    }

    /* 新增：模型信息标签 */
    .model-tag {
      padding: 2px 6px;
      background: #1f6feb33;
      border: 1px solid #1f6feb;
      border-radius: 4px;
      font-size: 10px;
      color: #58a6ff;
      font-family: monospace;
    }

    /* 新增：Token 信息标签 */
    .token-tag {
      padding: 2px 6px;
      background: #3fb95033;
      border: 1px solid #3fb950;
      border-radius: 4px;
      font-size: 10px;
      color: #7ee787;
      font-family: monospace;
    }

    /* 新增：执行时间标签 */
    .duration-tag {
      padding: 2px 6px;
      background: #d2992233;
      border: 1px solid #d29922;
      border-radius: 4px;
      font-size: 10px;
      color: #e3b341;
      font-family: monospace;
    }

    /* 新增：退出码标签 */
    .exitcode-tag {
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-family: monospace;
      font-weight: 600;
    }
    .exitcode-tag.success {
      background: #23863633;
      border: 1px solid #238636;
      color: #7ee787;
    }
    .exitcode-tag.error {
      background: #da363333;
      border: 1px solid #da3633;
      color: #f85149;
    }

    /* 系统监控面板样式 - 紧凑单行 */
    .system-panel {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
      padding: 10px 14px;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      font-size: 13px;
      flex-wrap: wrap;
    }

    .system-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .system-label {
      color: #8b949e;
      font-weight: 500;
    }

    .system-value-inline {
      color: #c9d1d9;
      font-weight: 600;
    }

    .description {
      color: #c9d1d9;
      white-space: pre-wrap;
      word-wrap: break-word;
      margin-top: 4px;
    }

    .thinking .description { color: #8b949e; font-style: italic; }
    .reply .description { color: #c9d1d9; }

    .description.collapsed {
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
      text-overflow: ellipsis;
      max-height: 4.5em;
    }
    .desc-toggle {
      margin-top: 6px;
      font-size: 11px;
      color: #58a6ff;
      cursor: pointer;
      user-select: none;
      display: inline-block;
    }
    .desc-toggle:hover { text-decoration: underline; }
    .aggregate-badge {
      margin-left: 8px;
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 10px;
      background: #da363333;
      border: 1px solid #da3633;
      color: #f85149;
      font-weight: 700;
    }

    .detail-drawer {
      position: fixed;
      top: 0;
      right: -520px;
      width: 520px;
      height: 100vh;
      background: #0d1117;
      border-left: 1px solid #30363d;
      box-shadow: -8px 0 20px rgba(0,0,0,0.35);
      transition: right 0.2s ease;
      z-index: 1000;
      display: flex;
      flex-direction: column;
    }
    .detail-drawer.open { right: 0; }
    .detail-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      border-bottom: 1px solid #30363d;
      background: #161b22;
      font-size: 13px;
      font-weight: 600;
    }
    .detail-close {
      cursor: pointer;
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 12px;
    }
    .detail-body {
      padding: 12px;
      overflow: auto;
      font-size: 12px;
      line-height: 1.5;
    }
    .detail-body pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-all;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 10px;
      font-family: 'SF Mono', monospace;
    }

    /* 新增：详细信息行 */
    .details-row {
      display: flex;
      gap: 6px;
      align-items: center;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #21262d;
      flex-wrap: wrap;
    }

    .empty { text-align: center; padding: 40px; color: #8b949e; }

    .summary-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }
    .summary-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 10px 12px;
    }
    .summary-card .label {
      color: #8b949e;
      font-size: 11px;
    }
    .summary-card .value {
      margin-top: 4px;
      color: #f0f6fc;
      font-size: 20px;
      font-weight: 700;
      line-height: 1.1;
    }

    .filters {
      margin-bottom: 16px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .filter-select,
    .filter-input {
      background: #161b22;
      border: 1px solid #30363d;
      color: #c9d1d9;
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      min-height: 32px;
    }
    .filter-input { min-width: 240px; }
    .filter-check {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #8b949e;
      padding: 6px 8px;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
    }
    .quick-btn {
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      cursor: pointer;
    }
    .quick-btn:hover { background: #30363d; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="status-dot"></div>
      <h1>⚡ Agent Monitor</h1>
      <span class="online">OpenClaw 实时状态</span>
      <div class="nav-links">
        <a href="/workspace">📂 Workspace</a>
      </div>
      <div class="agents-list" id="agents-list"></div>
    </div>

    <!-- 系统监控面板 -->
    <div class="system-panel" id="system-panel">
      <div class="system-item">
        <span class="system-label">CPU:</span>
        <span class="system-value-inline" id="cpu-value">--</span>
      </div>
      <div class="system-item">
        <span class="system-label">GPU:</span>
        <span class="system-value-inline" id="gpu-value">--</span>
      </div>
      <div class="system-item">
        <span class="system-label">MEM:</span>
        <span class="system-value-inline" id="mem-value">--</span>
      </div>
      <div class="system-item">
        <span class="system-label">DISK:</span>
        <span class="system-value-inline" id="disk-value">--</span>
      </div>
    </div>

    <div class="summary-cards">
      <div class="summary-card">
        <div class="label">活跃会话</div>
        <div class="value" id="metric-active-sessions">--</div>
      </div>
      <div class="summary-card">
        <div class="label">5分钟错误数</div>
        <div class="value" id="metric-errors-5m">--</div>
      </div>
      <div class="summary-card">
        <div class="label">慢调用（>3s）</div>
        <div class="value" id="metric-slow-calls">--</div>
      </div>
      <div class="summary-card">
        <div class="label">当前列表</div>
        <div class="value" id="metric-visible">--</div>
      </div>
    </div>

    <div class="filters">
      <select id="filter-agent" class="filter-select">
        <option value="all">全部 Agent</option>
      </select>
      <select id="filter-type" class="filter-select">
        <option value="all">全部类型</option>
        <option value="tool">tool</option>
        <option value="reply">reply</option>
        <option value="thinking">thinking</option>
        <option value="cron">cron</option>
      </select>
      <input id="filter-keyword" class="filter-input" placeholder="搜索关键词（description / tool / session）" />
      <label class="filter-check">
        <input type="checkbox" id="filter-errors-only" />
        仅看异常
      </label>
      <button id="quick-error-mode" class="quick-btn">异常模式</button>
      <button id="toggle-error-aggregate" class="quick-btn">错误聚合: 关</button>
      <button id="quick-reset-filters" class="quick-btn">重置筛选</button>
    </div>

    <div id="activity-list" class="activity-list">
      <div class="empty">加载中...</div>
    </div>
  </div>

  <script>
    const listEl = document.getElementById('activity-list');
    const agentsEl = document.getElementById('agents-list');

    const filterAgentEl = document.getElementById('filter-agent');
    const filterTypeEl = document.getElementById('filter-type');
    const filterKeywordEl = document.getElementById('filter-keyword');
    const filterErrorsOnlyEl = document.getElementById('filter-errors-only');
    const quickErrorModeEl = document.getElementById('quick-error-mode');
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
    const expandedItems = new Set();
    let errorAggregateMode = false;
    let pollCount = 0;

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
    }

    function createActivityItem(activity) {
      const div = document.createElement('div');
      const agentClass = (activity.agent || 'unknown').toUpperCase();
      div.className = 'activity-item ' + agentClass;
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

      if (fullDesc.length > 180 || fullDesc.split('\\n').length > 3) {
        const activityKey = getActivityKey(activity);
        const isExpanded = expandedItems.has(activityKey);

        if (!isExpanded) {
          desc.classList.add('collapsed');
        }

        const toggle = document.createElement('span');
        toggle.className = 'desc-toggle';
        toggle.textContent = isExpanded ? '收起' : '展开';
        toggle.addEventListener('click', () => {
          const collapsed = desc.classList.toggle('collapsed');
          const expanded = !collapsed;
          if (expanded) {
            expandedItems.add(activityKey);
          } else {
            expandedItems.delete(activityKey);
          }
          toggle.textContent = collapsed ? '展开' : '收起';
        });
        div.appendChild(toggle);
      }

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
        badge.textContent = activity.aggregateCount + ' 次';
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

      const current = filterAgentEl.value || 'all';
      filterAgentEl.innerHTML = '<option value="all">全部 Agent</option>';
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
        listEl.innerHTML = '<div class="empty">当前筛选条件下暂无活动</div>';
      } else {
        visible.forEach(activity => {
          listEl.appendChild(createActivityItem(activity));
        });
      }

      updateMetrics(latestActivities, visible);
    }

    function updateList(activities) {
      latestActivities = activities || [];
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

        const res = await fetch('/api?t=' + Date.now(), {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        });

        if (!res.ok) throw new Error('HTTP ' + res.status);

        const data = await res.json();
        const activityCount = data.activities ? data.activities.length : 0;
        console.log('[Agent-Monitor] 收到数据:', activityCount, 'activities');

        // 检测活动数量变化
        if (activityCount !== lastActivityCount) {
          console.log('[Agent-Monitor] 检测到数据变化:', lastActivityCount, '->', activityCount);
          lastActivityCount = activityCount;
          
          // 切换到快速模式
          if (currentInterval !== POLL_CONFIG.fastInterval) {
            switchToFastMode();
          }
        }

        updateAgents(data.agents || []);
        updateList(data.activities || []);
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
      el.addEventListener('input', renderFilteredList);
      el.addEventListener('change', renderFilteredList);
    });

    quickErrorModeEl.addEventListener('click', () => {
      filterErrorsOnlyEl.checked = true;
      filterTypeEl.value = 'all';
      renderFilteredList();
    });

    toggleErrorAggregateEl.addEventListener('click', () => {
      errorAggregateMode = !errorAggregateMode;
      toggleErrorAggregateEl.textContent = '错误聚合: ' + (errorAggregateMode ? '开' : '关');
      renderFilteredList();
    });

    quickResetFiltersEl.addEventListener('click', () => {
      filterAgentEl.value = 'all';
      filterTypeEl.value = 'all';
      filterKeywordEl.value = '';
      filterErrorsOnlyEl.checked = false;
      errorAggregateMode = false;
      toggleErrorAggregateEl.textContent = '错误聚合: 关';
      renderFilteredList();
    });

    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'detail-close') {
        const detailDrawerEl = getDetailDrawerEl();
        detailDrawerEl?.classList.remove('open');
      }
    });

    // 立即执行第一次
    poll();

    // 默认5秒轮询
    intervalId = setInterval(poll, currentInterval);
    console.log('[Agent-Monitor] 轮询已启动, 默认间隔: 5秒, intervalId:', intervalId);
  </script>

  <aside id="detail-drawer" class="detail-drawer">
    <div class="detail-header">
      <span>事件详情</span>
      <button id="detail-close" class="detail-close">关闭</button>
    </div>
    <div id="detail-body" class="detail-body">点击任意事件查看详情</div>
  </aside>
</body>
</html>`;

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
