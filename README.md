# Agent Monitor

实时监控 OpenClaw Agent 运行状态的可视化工具。

![Status](https://img.shields.io/badge/status-active-green)
![Version](https://img.shields.io/badge/version-1.2-blue)

## 功能特性

- 🔴 **实时监控** - 追踪所有 Agent 的会话活动
- 📝 **活动记录** - 显示工具调用、思考过程、回复内容
- 🎨 **多 Agent 支持** - 自动识别并区分不同 Agent
- 📱 **响应式设计** - 适配桌面和移动设备
- 🌙 **深色主题** - 护眼设计，适合长时间监控
- ⚡ **自动刷新** - 1 秒间隔实时更新

## 截图

界面展示多个 Agent 的实时活动流，包括：
- 工具调用（read/edit/exec/web_search 等）
- 思考过程（thinking）
- 最终回复（reply）

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

npm start
```

### 配置文件

创建 `config.json`：

```json
{
  "agentsDir": "/home/user/.openclaw/agents",
  "maxActivities": 100,
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
      "tool": "read",
      "description": "📄 read    /path/to/file.js",
      "timestamp": "2026-03-05T15:30:00.000Z"
    }
  ],
  "updatedAt": "2026-03-05T15:30:00.000Z"
}
```

### 健康检查
```
GET /health
```

## 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 JavaScript (无框架依赖)
- **实时更新**: File System Watch API + 轮询

## 系统要求

- Node.js ≥ 18
- OpenClaw 安装（用于读取 agent 会话）

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

## License

MIT

---

Built with ⚡ for OpenClaw