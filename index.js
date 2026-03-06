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

    <div id="activity-list" class="activity-list">
      <div class="empty">加载中...</div>
    </div>
  </div>

  <script>
    const listEl = document.getElementById('activity-list');
    const agentsEl = document.getElementById('agents-list');

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

    function createActivityItem(activity) {
      const div = document.createElement('div');
      const agentClass = (activity.agent || 'unknown').toUpperCase();
      div.className = 'activity-item ' + agentClass;
      if (activity.type === 'thinking') div.classList.add('thinking');
      if (activity.type === 'reply') div.classList.add('reply');
      if (activity.type === 'cron') div.classList.add('cron');

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

      const desc = document.createElement('span');
      desc.className = 'description';
      desc.textContent = activity.description;

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
    }

    function updateList(activities) {
      // 直接重新渲染整个列表，确保实时更新
      listEl.innerHTML = '';

      console.log('[Agent-Monitor] 更新列表:', activities.length, 'activities');

      if (activities.length === 0) {
        listEl.innerHTML = '<div class="empty">暂无活动</div>';
        return;
      }

      activities.forEach(activity => {
        listEl.appendChild(createActivityItem(activity));
      });
    }

    async function poll() {
      try {
        pollCount++;
        console.log('[Agent-Monitor] 轮询 #' + pollCount);

        const res = await fetch('/api?t=' + Date.now(), {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        });

        if (!res.ok) throw new Error('HTTP ' + res.status);

        const data = await res.json();
        console.log('[Agent-Monitor] 收到数据:', data.activities.length, 'activities');

        updateAgents(data.agents || []);
        updateList(data.activities || []);
        updateSystemPanel(data.system);
      } catch (err) {
        console.error('[Agent-Monitor] 请求失败:', err.message);
      }
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

    // 立即执行第一次
    poll();

    // 每1秒轮询
    const intervalId = setInterval(poll, 1000);
    console.log('[Agent-Monitor] 轮询已启动, intervalId:', intervalId);
  </script>
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
