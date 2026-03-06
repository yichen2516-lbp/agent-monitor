# Agent Monitor

实时监控 OpenClaw Agent 运行状态的可视化工具。

![Status](https://img.shields.io/badge/status-active-green)
![Version](https://img.shields.io/badge/version-1.5-blue)

## 功能特性

- 🔴 **实时监控** - 追踪所有 Agent 的会话活动
- 📝 **活动记录** - 显示工具调用、思考过程、回复内容
- 🎨 **多 Agent 支持** - 自动识别并区分不同 Agent
- ⏰ **Cron 监控** - 同时显示定时任务执行记录
- 📊 **系统监控** - CPU / GPU / 内存 / 磁盘实时状态
- 📱 **响应式设计** - 适配桌面和移动设备
- 🌙 **深色主题** - 护眼设计，适合长时间监控
- ⚡ **自动刷新** - 1 秒间隔实时更新
- 🔍 **详细元数据** - 模型信息、Token消耗、执行时间、退出码

## 界面展示

### 系统监控栏
顶部显示实时系统资源状态：
```
CPU: 15% GPU: 0% MEM: 97% DISK: 6%
```

### Agent 活动记录
```
[时间] [Agent名] [Session名] [Cron标签]
├─ 活动内容（工具调用/思考/回复）
└─ [模型] [Token消耗] [执行时间] [退出码]
```

- **Session 名**: 8位字符，标识当前会话
- **Cron 标签**: 紫色标识，仅定时任务显示
- **模型**: 蓝色标签，如 `k2p5`, `M2.5`
- **Token消耗**: 绿色标签，如 `⚡ 13,202 tokens`
- **执行时间**: 黄色标签，如 `⏱️ 17ms`
- **退出码**: 成功绿色/失败红色，如 `Exit: 0`

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
  "activities": [...],
  "system": {
    "cpu": { "used": 15, "user": 3.5, "sys": 11.5 },
    "gpu": { "used": 0, "name": "Apple Silicon" },
    "memory": { "used": 7.8, "total": 8, "percentage": 97 },
    "disk": { "used": 10, "total": 233, "percentage": 6 }
  },
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

### v1.5.0
- 新增系统资源监控栏：
  - CPU 使用率 (user/sys 细分)
  - GPU 使用率 (支持 Apple Silicon)
  - 内存使用率
  - 磁盘使用率
- 紧凑单行布局显示系统状态

### v1.4.0
- 新增元数据显示：
  - 模型信息（如 k2p5, M2.5）
  - Token 消耗统计
  - 工具执行时间
  - 工具退出码（成功/失败状态）
- 修复 thinking 内容显示
- 修复 NaN tokens 问题

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
