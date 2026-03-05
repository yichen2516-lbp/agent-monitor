# Agent Monitor

OpenClaw Agent 实时状态监控 - 独立版

从 LBP-Tools 中提取的 Agent 实时监控模块，作为独立项目运行。

## 功能

- 🔴 实时监控所有 OpenClaw Agent 会话
- 📊 显示 Agent 的工具调用、思考过程和回复
- 🎨 按 Agent 区分的颜色标识
- ⚡ 自动检测新 Agent 和新会话
- 📱 响应式 Web 界面

## 快速开始

```bash
# 1. 进入项目目录
cd ~/Developer/agent-monitor

# 2. 安装依赖
npm install

# 3. 启动服务
npm start

# 4. 访问 http://localhost:3450
```

## 配置

默认配置：
- 端口: `3450`
- Agent 目录: `/Users/lbp/.openclaw/agents`
- 刷新间隔: 3秒

可以通过环境变量修改端口：
```bash
PORT=8080 npm start
```

## API

### 获取实时状态
```
GET /api
```

响应：
```json
{
  "agents": ["LBP", "EDGE", "COOL", "TIM"],
  "activities": [
    {
      "type": "tool",
      "agent": "LBP",
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

## 与 LBP-Tools 的区别

| 特性 | LBP-Tools 版 | 独立版 |
|------|-------------|--------|
| 依赖 | 需要 LBP-Tools 完整环境 | 仅依赖 express |
| 启动 | 随 LBP-Tools 启动 | 独立启动 |
| 端口 | 3000 (共享) | 3450 (独立) |
| 功能 | 集成在 Tools 平台中 | 纯监控功能 |

## 技术栈

- Node.js
- Express
- File System Watch API
- 原生 JavaScript (前端)

## 许可证

MIT