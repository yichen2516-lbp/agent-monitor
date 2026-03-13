<div align="center">

# 🤖 Agent Monitor

**Real-time monitoring dashboard for OpenClaw Agent activities**

[![Status](https://img.shields.io/badge/status-active-success?style=flat-square)](https://github.com/yichen2516-lbp/agent-monitor)
[![Version](https://img.shields.io/badge/version-1.5.3-blue?style=flat-square)](https://github.com/yichen2516-lbp/agent-monitor/releases)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org/)

[Live Demo](https://github.com/yichen2516-lbp/agent-monitor#) · [Report Bug](https://github.com/yichen2516-lbp/agent-monitor/issues) · [Request Feature](https://github.com/yichen2516-lbp/agent-monitor/issues)

</div>

---

## 📋 Table of Contents

- [About](#about)
- [Features](#features)
- [Screenshots](#screenshots)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Architecture](#architecture)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgments](#acknowledgments)

---

## 🎯 About

Agent Monitor is a lightweight, real-time dashboard for tracking OpenClaw Agent activities. It provides instant visibility into agent sessions, cron jobs, and system resources—all in a clean, dark-themed interface optimized for monitoring workflows.

**Why Agent Monitor?**

- 🔍 **Instant Visibility** — See what your agents are doing in real-time
- 📊 **System Context** — Monitor CPU/GPU/Memory alongside agent activities
- 🚀 **Zero Configuration** — Works out of the box with OpenClaw defaults
- 📱 **Mobile Ready** — Check agent status from anywhere

---

## ✨ Features

### Core Capabilities

| Feature | Description |
|---------|-------------|
| 🔴 **Real-time Monitoring** | Track all agent session activities with adaptive 1s/5s polling |
| 📝 **Activity Logging** | View tool calls, thinking processes, and responses |
| 🎭 **Multi-Agent Support** | Automatically detect and distinguish between agents |
| ⏰ **Cron Monitoring** | Display scheduled task execution records |
| 📊 **System Metrics** | Real-time CPU / GPU / Memory / Disk monitoring |
| 🌙 **Dark Theme** | Eye-friendly design for extended monitoring sessions |
| 🔍 **Rich Metadata** | Model info, token usage, execution time, exit codes |
| 🧭 **Filter & Error-First Workflow** | Filter by agent/type/keyword, focus on errors, aggregate repeated failures |
| 📌 **Persistent UI State** | Preserve filters and error-view options across page refresh |
| 🗂️ **Detail Drawer** | Click any activity to inspect structured event details |

### Advanced Features

- **Smart Polling** — Adaptive refresh rate (1s active / 5s idle) to reduce resource usage
- **Session Isolation** — Separate storage for session and cron records
- **Cross-Platform** — Works on macOS, Linux, and Windows
- **Responsive Design** — Optimized for both desktop and mobile devices
- **Auto-Discovery** — Automatically detects agent workspaces without manual configuration

---

## 📸 Screenshots

<div align="center">

*Dashboard showing real-time agent activities with system metrics*

```
┌─────────────────────────────────────────────────────────────┐
│  CPU: 15%  GPU: 0%  MEM: 97%  DISK: 6%                     │
├─────────────────────────────────────────────────────────────┤
│  [01:33:06]  main  abc123def                                │
│  ├─ 🤔 Thinking: Planning response structure...            │
│  ├─ 🔧 Tool: web_search "Agent Monitor GitHub"             │
│  └─ [k2p5] [⚡ 13,202 tokens] [⏱️ 17ms] [Exit: 0]          │
├─────────────────────────────────────────────────────────────┤
│  [01:32:45]  cool  xyz789ghi                                │
│  ├─ 🔧 Tool: exec "curl -s localhost:3457"                 │
│  └─ [M2.5] [⚡ 2,341 tokens] [⏱️ 245ms] [Exit: 0]          │
└─────────────────────────────────────────────────────────────┘
```

</div>

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18.0.0
- [OpenClaw](https://github.com/openclaw/openclaw) installed and configured
- (Optional) Git for cloning

### Installation

#### Option 1: Clone via HTTPS

```bash
git clone https://github.com/yichen2516-lbp/agent-monitor.git
cd agent-monitor
npm install
```

#### Option 2: Clone via SSH

```bash
git clone git@github.com:yichen2516-lbp/agent-monitor.git
cd agent-monitor
npm install
```

#### Option 3: Download ZIP

```bash
curl -L https://github.com/yichen2516-lbp/agent-monitor/archive/refs/heads/main.zip -o agent-monitor.zip
unzip agent-monitor.zip
cd agent-monitor-main
npm install
```

### Quick Start

```bash
# Start with default configuration
npm start

# Or with custom settings
export AGENTS_DIR=/path/to/.openclaw/agents
export PORT=3450
npm start
```

The dashboard will be available at `http://localhost:3450`.

---

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTS_DIR` | `~/.openclaw/agents` | Path to OpenClaw agents directory |
| `PORT` | `3450` | Server port |
| `MAX_ACTIVITIES` | `300` | Maximum number of activities to retain |
| `POLL_INTERVAL` | `10000` | File polling interval (ms) |
| `REFRESH_INTERVAL` | `1000` | UI refresh interval (ms) |
| `LOG_RETENTION_DAYS` | `3` | Rolling log retention (days) for `./logs/agent-monitor-YYYY-MM-DD.log` |

### Configuration File

Create a `config.json` in the project root:

```json
{
  "agentsDir": "/home/user/.openclaw/agents",
  "maxActivities": 300,
  "pollInterval": 10000,
  "refreshInterval": 1000
}
```

### Platform-Specific Setup

<details>
<summary><b>macOS</b></summary>

```bash
export AGENTS_DIR=/Users/$(whoami)/.openclaw/agents
npm start
```
</details>

<details>
<summary><b>Linux</b></summary>

```bash
export AGENTS_DIR=/home/$(whoami)/.openclaw/agents
npm start
```
</details>

<details>
<summary><b>Windows (PowerShell)</b></summary>

```powershell
$env:AGENTS_DIR="$env:USERPROFILE\.openclaw\agents"
npm start
```
</details>

---

## 📖 Usage

### Dashboard Overview

The main dashboard displays:

1. **System Bar** — Real-time resource usage (CPU, GPU, Memory, Disk)
2. **Summary Cards** — Active sessions, 5-minute error count, slow calls, visible items
3. **Filter Bar** — Agent/type/keyword filters, error-only mode, error aggregation toggle
4. **Activity Feed** — Chronological list of agent activities
5. **Metadata Tags** — Model, tokens, execution time, exit code
6. **Detail Drawer** — Click an item to inspect structured event fields

### Activity Indicators

| Element | Meaning |
|---------|---------|
| `🤔 Thinking` | Agent is processing/thinking |
| `🔧 Tool` | Tool invocation (read, exec, web_search, etc.) |
| `💬 Reply` | Agent response |
| `⏰ [cron]` | Scheduled task execution |
| `[k2p5]` / `[M2.5]` | Model identifier |
| `⚡ N tokens` | Token consumption |
| `⏱️ Nms` | Execution duration |
| `Exit: 0` / `Exit: 1` | Success / Failure |

### Workspace Browser

Navigate to `http://localhost:3450/workspace` to browse agent workspace files:

- **Auto-discovery** — Automatically detects all `workspace*` directories in `~/.openclaw/`
- **Multi-agent support** — Dynamically adapts to any agent workspaces found (main, cool, tim, edge, etc.)
- **Markdown rendering** — Syntax highlighting and formatting for `.md` files
- **Mobile-optimized interface** — Responsive design for on-the-go monitoring

**Auto-recognition mapping:**
| Directory | Display Name | Emoji | Color |
|-----------|--------------|-------|-------|
| `workspace` | Main | ⚡ | Orange |
| `workspace-cool` | Cool | ❄️ | Blue |
| `workspace-tim` | Tim | ⏱️ | Green |
| `workspace-edge` | Edge | 🔥 | Pink |
| `workspace-*` | *Auto* | 🤖 | Gray |

---

## 🔌 API Reference

### Get Dashboard Data

```http
GET /api
```

**Query Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `since` | ISO datetime (optional) | Return activities newer than this timestamp (incremental polling support) |

**Response:**

```json
{
  "agents": ["main", "edge", "cool", "tim"],
  "activities": [
    {
      "agent": "main",
      "session": "abc123def",
      "type": "tool",
      "tool": "web_search",
      "model": "k2p5",
      "tokens": 13202,
      "duration": 17,
      "exitCode": 0,
      "timestamp": "2026-03-09T01:33:06.000Z"
    }
  ],
  "system": {
    "cpu": { "used": 15, "user": 3.5, "sys": 11.5 },
    "gpu": { "used": 0, "name": "Apple Silicon" },
    "memory": { "used": 7.8, "total": 8, "percentage": 97 },
    "disk": { "used": 10, "total": 233, "percentage": 6 }
  },
  "updatedAt": "2026-03-09T01:33:06.000Z"
}
```

### Health Check

```http
GET /health
```

**Response:**

```json
{
  "status": "ok",
  "agents": 3
}
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Agent Monitor                          │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Frontend   │  │    Backend   │  │   Monitors   │      │
│  │  (Vanilla JS)│  │   (Express)  │  │  (FS Watch)  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                 │                 │              │
│         └─────────────────┴─────────────────┘              │
│                           │                                │
│                    ┌──────┴──────┐                        │
│                    │  OpenClaw   │                        │
│                    │   Agents    │                        │
│                    └─────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

### Data Sources

| Source | Path | Content |
|--------|------|---------|
| Sessions | `~/.openclaw/agents/{agent}/sessions/*.jsonl` | Agent conversation history |
| Cron | `~/.openclaw/cron/runs/*.jsonl` | Scheduled task executions |
| System | OS APIs | CPU, GPU, Memory, Disk metrics |

### Current Code Structure

```text
index.js                        # app entry
server/config.js                # config loading
server/logger.js                # rolling logs
server/routes/api.js            # /api /health
server/routes/workspace.js      # workspace pages
server/monitor-store.js         # coordinator
server/parsers/                 # session / cron parsing
server/store/                   # in-memory activity store
server/watchers/                # file watchers
public/modules/                 # frontend state/render/polling modules
views/                          # monitor/workspace templates
test/                           # minimal regression tests + fixtures
```

### Run Regression Tests

```bash
npm test
```

当前最小回归覆盖：
- session activity parser（新格式 / 旧格式）
- cron parser
- activity store limit / since 过滤

---

## 🗺️ Roadmap

- [ ] WebSocket support for true real-time updates
- [ ] Historical data persistence and analytics
- [ ] Alert notifications (webhook/email)
- [ ] Multi-node monitoring support
- [ ] REST API authentication
- [ ] Plugin system for custom metrics

See [open issues](https://github.com/yichen2516-lbp/agent-monitor/issues) for proposed features and known issues.

---

## 🤝 Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

### Development Setup

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/agent-monitor.git
cd agent-monitor

# Install dependencies
npm install

# Run in development mode
npm run dev
```

### Pull Request Process

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Please ensure your PR:
- Follows the existing code style
- Includes appropriate test coverage
- Updates documentation if needed
- Passes core regression checks in [`REGRESSION_CHECKLIST.md`](./REGRESSION_CHECKLIST.md)

---

## 📄 License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.

---

## 🙏 Acknowledgments

- Built for [OpenClaw](https://github.com/openclaw/openclaw) — the extensible AI agent platform
- Inspired by the need for better visibility into multi-agent workflows
- Thanks to all contributors and users who provided feedback

---

<div align="center">

**[⬆ Back to Top](#agent-monitor)**

Built with 🤖⚡ by LBP · Human supervision & snack supply: Yichen

</div>
