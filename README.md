# Agent Monitor

实时监控 OpenClaw Agent 运行状态的可视化工具。

![Status](https://img.shields.io/badge/status-active-green)
![Version](https://img.shields.io/badge/version-1.3-blue)

## 功能特性

- 🔴 **实时监控** - 追踪所有 Agent 的会话活动
- 📝 **活动记录** - 显示工具调用、思考过程、回复内容
- 🎨 **多 Agent 支持** - 自动识别并区分不同 Agent
- ⏰ **Cron 监控** - 同时显示定时任务执行记录
- 📱 **响应式设计** - 适配桌面和移动设备
- 🌙 **深色主题** - 护眼设计，适合长时间监控
- ⚡ **自动刷新** - 1 秒间隔实时更新

## 界面展示

每条记录显示格式：
```
[时间] [Agent名] [Session名] [Cron标签]
└─ 活动内容（工具调用/思考/回复）
```

- **Session 名**: 8位字符，标识当前会话
- **Cron 标签**: 紫色标识，仅定时任务显示

## 快速开始

### 安装

```bash
# 克隆项目
git clone https://github.com/yichen2516-lbp/agent-monitor.git
cd agent-monitor

# 安装依赖
npm install
```

### 启动

```bash
npm start
```

服务将在 http://localhost:3450 启动。

## 配置

### 环境变量

```bash
# 设置 OpenClaw agents 目录
export AGENTS_DIR=/path/to/.openclaw/agents

# 设置端口
export PORT=3450

# 设置最大活动记录数（默认 300）
export MAX_ACTIVITIES=300

npm start
```

### 配置文件

创建 `config.json`：

```json
{
  "agentsDir": "/home/user/.openclaw/agents",
  "maxActivities": 300,
  "pollInterval": 10000,
  "refreshInterval": 1000
}
```

## API

### 获取状态
```
GET /api
```

响应示例：
```json
{
  "agents": ["main", "edge", "cool", "tim"],
  "activities": [
    {
      "type": "tool",
      "agent": "main",
      "sessionName": "a3cab77d",
      "tool": "read",
      "description": "📄 read    /path/to/file.js",
      "timestamp": "2026-03-05T15:30:00.000Z"
    },
    {
      "type": "cron",
      "agent": "main",
      "sessionName": "04e01164",
      "description": "✅ (45s) ETF数据同步完成",
      "timestamp": "2026-03-05T15:25:00.000Z"
    }
  ],
  "updatedAt": "2026-03-05T15:30:00.000Z"
}
```

### 健康检查
```
GET /health
```

## 监控范围

### Session 记录
监控路径：`~/.openclaw/agents/{agent}/sessions/*.jsonl`

包括：
- 工具调用（read/exec/edit/write/web_search等）
- 思考过程（thinking）
- 回复内容（reply）

### Cron 记录
监控路径：`~/.openclaw/cron/runs/*.jsonl`

包括：
- 定时任务执行结果
- 执行时长
- 成功/失败状态
- 完整输出内容

## 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 JavaScript (无框架依赖)
- **实时更新**: File System Watch API + 轮询

## 系统要求

- Node.js ≥ 18
- OpenClaw 安装（用于读取 agent 会话和 cron 记录）

## 跨平台

### macOS
```bash
export AGENTS_DIR=/Users/username/.openclaw/agents
npm start
```

### Linux
```bash
export AGENTS_DIR=/home/username/.openclaw/agents
npm start
```

### Windows (PowerShell)
```powershell
$env:AGENTS_DIR="C:\Users\username\.openclaw\agents"
npm start
```

## Changelog

### v1.3.3
- Cron 内容不再截断，显示完整输出

### v1.3.2
- 添加 Session 名称显示
- 添加 Cron 标签标识

### v1.3.0
- 添加 Cron 运行记录监控
- Session 和 Cron 记录分离存储

### v1.2.0
- 跨平台默认路径支持
- 配置系统（环境变量 + 配置文件）
- 缓存控制修复
- 局域网访问支持（0.0.0.0）

## License

MIT

---

Built with ⚡ for OpenClaw
