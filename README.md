# Agent Monitor

Agent Monitor is a realtime monitoring dashboard for **OpenClaw agents**.

It is built for a very specific job: not just to show logs, but to help you answer the questions that actually matter during daily use:

- **Which agent is active right now?**
- **What just happened?**
- **What is it doing now?**
- **If it is not replying, is it thinking, calling a tool, failing, or just idle?**

In short, Agent Monitor is meant to be a practical control surface for OpenClaw sessions, cron runs, and workspace inspection — not another page that only scrolls text.

---

## Why this project exists

OpenClaw already produces rich session data, but raw session logs alone are not enough for smooth day-to-day debugging.

Two gaps show up quickly in real usage:

1. **Events exist, but state is not obvious enough**  
   You can see tools, replies, thinking, and cron records — but it is still hard to answer "what is happening right now?"

2. **Logs exist, but the investigation path is still too long**  
   When something goes wrong, the real goal is not "does a log exist?" but:
   - which agent is affected,
   - which session is affected,
   - whether it is slow, broken, or stuck,
   - and which event you should inspect first.

Agent Monitor exists to shorten that path.

---

## Capability Overview

### Monitoring
- Realtime activity feed for `tool / thinking / reply / cron`
- Hybrid transport: `HTTP bootstrap + WebSocket incremental push + polling fallback`
- Multi-agent auto discovery
- Session-aware event parsing
- Cron visibility
- System metrics: CPU / GPU / Memory / Disk

### Investigation workflow
- Error-first filtering
- Slow call quick filtering
- Failed tools / tool errors / cron errors quick filters
- Error aggregation for repeated failures
- Structured detail drawer + raw event JSON
- Model / token / duration / exit code visibility

### Live status
- Agent live status (v1 heuristic)
- Transport indicator: `WS LIVE / POLLING / CONNECTING`
- Terminal states auto-expire into `idle`
- Stale agents auto-hide after long inactivity

### Workspace browser
- On-demand tree expansion
- Lightweight indexed search
- Markdown / image / binary-safe preview
- Compact preview for large text files
- Recent files / prev-next navigation / raw open
- Mobile file picker and drawer interaction

---

## Current Feature Set

### 1. Monitor dashboard
The main dashboard is optimized for **continuous observation and first-response debugging**.

It currently supports:
- Activity stream for:
  - `tool`
  - `thinking`
  - `reply`
  - `cron`
- Rich event metadata:
  - model
  - provider
  - usage
  - duration
  - exit code
  - tool status
  - stop reason
- Investigation helpers:
  - Agent / Type / Keyword filters
  - Errors only
  - Error aggregation
  - Failed Tools / Tool Errors / Cron Errors / Slow Calls quick filters
- Detail drawer:
  - summary fields
  - description
  - grouped events
  - copy JSON / source / session
  - raw payload

### 2. Realtime transport
The current transport design is **hybrid**, not push-only.

- Initial page load uses `GET /api`
- Incremental updates use `GET /ws`
- If WebSocket disconnects, the UI falls back to polling automatically
- The header explicitly shows the current transport mode

This is intentional. It keeps the UI realtime while preserving safe recovery after reconnects.

### 3. Agent live status (v1)
Agent Monitor now tracks a first-pass answer to: **what is the agent doing now?**

Current states include:
- `thinking`
- `tool-running`
- `tool-done`
- `tool-failed`
- `reply-done`
- `idle`
- `cron-error`

Each live status card shows:
- current session
- current status code
- human-readable status label
- last updated time

This already reduces a lot of the ambiguity behind "why is it not replying?"

### 4. Workspace browser
The workspace browser is no longer just a raw file viewer. It is designed for ongoing inspection and lightweight debugging.

Current behavior:
- auto-discovers `~/.openclaw/workspace*`
- lazy-loads deep folders to reduce initial DOM weight
- uses a lightweight search index instead of full DOM traversal
- remembers:
  - active agent
  - expanded directories
  - search term
  - recent files
- supports:
  - markdown rendering
  - image preview
  - binary-safe notice
  - compact preview for large text files
  - raw file open
  - prev / next navigation
  - mobile file picker drawer

---

## Architecture

### High-level data flow

```text
OpenClaw session jsonl / cron jsonl
            │
            ▼
         parsers
            │
            ▼
      monitor-store
            │
     ┌──────┴────────┐
     │               │
     ▼               ▼
   /api            /ws
     │               │
     └──────┬────────┘
            ▼
      frontend state
            ▼
 render / filter / drawer / live status UI
```

### Key design choices

#### Store-centered coordination
`monitor-store.js` acts as the coordinator for:
- loading session / cron sources
- watching incremental file changes
- maintaining recent activities
- deriving live statuses
- notifying realtime subscribers

This keeps parsing, storage, watching, and UI transport clearly separated.

#### Hybrid realtime over pure push
The project does **not** force everything through WebSocket.

Instead it uses:
- HTTP bootstrap for initial consistency
- WebSocket for incremental updates
- polling fallback for resilience

That makes the UI more robust during reconnects and local runtime instability.

#### Heuristic live status over fake precision
The current live status layer is intentionally honest.

It can infer many useful states from observable session events, but it does **not** pretend to have provider-internal certainty when no such lifecycle event exists.

---

## Repository Structure

```text
index.js                        # app entry + HTTP + WS upgrade
server/config.js                # config loading
server/logger.js                # rolling log handling
server/ws-hub.js                # lightweight websocket broadcaster
server/routes/api.js            # /api /health
server/routes/workspace.js      # workspace routes and file rendering
server/monitor-store.js         # coordinator + live status logic
server/parsers/                 # session / cron parsing
server/store/                   # in-memory activity store
server/watchers/                # fs watch wrappers
public/modules/monitor-state.js
public/modules/monitor-dom.js
public/modules/monitor-render.js
public/modules/monitor-poller.js
public/modules/monitor-filters.js
public/modules/monitor-system-panel.js
views/monitor.html
views/workspace.html
views/workspace-view.html
test/                           # parser/store regression tests
```

---

## Getting Started

### Requirements
- Node.js >= 18
- OpenClaw installed locally
- Access to:
  - `~/.openclaw/agents`
  - `~/.openclaw/cron/runs`

### Install

```bash
git clone git@github.com:yichen2516-lbp/agent-monitor.git
cd agent-monitor
npm install
```

### Run

```bash
npm start
```

Default endpoints:
- Monitor: <http://localhost:3450>
- Workspace: <http://localhost:3450/workspace>
- API: <http://localhost:3450/api>
- Health: <http://localhost:3450/health>
- WebSocket: `ws://localhost:3450/ws`

---

## Configuration

Configuration can be provided via environment variables or `config.json`.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3450` | Server port |
| `AGENTS_DIR` | `~/.openclaw/agents` | OpenClaw agents directory |
| `MAX_ACTIVITIES` | `300` | Max activities kept in memory |
| `POLL_INTERVAL` | `10000` | Backend polling interval for discovering new sessions / cron files |
| `LOG_RETENTION_DAYS` | `3` | Rolling log retention days |

### Example `config.json`

```json
{
  "agentsDir": "/Users/you/.openclaw/agents",
  "maxActivities": 300,
  "pollInterval": 10000,
  "activityMaxAgeHours": 24,
  "logRetentionDays": 3
}
```

---

## API

### `GET /api`
Returns the current monitor snapshot.

Example:

```json
{
  "agents": ["main", "cool"],
  "activities": [],
  "agentStatuses": {
    "main": {
      "agent": "main",
      "sessionName": "abcd1234",
      "code": "thinking",
      "label": "Thinking",
      "updatedAt": "2026-03-13T09:39:00.000Z"
    }
  },
  "system": {},
  "updatedAt": "2026-03-13T09:39:05.000Z"
}
```

Query parameters:
- `since=<ISO timestamp>` — incremental activity fetch

### `GET /health`

```json
{ "status": "ok", "agents": 2 }
```

### `GET /ws`
WebSocket endpoint for incremental event push.

Current event types:
- `connected`
- `activities`

`activities` payload:

```json
{
  "event": "activities",
  "payload": {
    "activities": [],
    "agentStatuses": {}
  }
}
```

### Workspace routes
- `GET /workspace`
- `GET /workspace/view/*`
- `GET /workspace/raw/*`
- `GET /workspace/tree/*`

---

## Quality and Regression

Run the current automated regression suite:

```bash
npm test
```

Current automated coverage:
- new / legacy activity parser
- tool call / tool result pairing
- cron parsing
- activity retention + `since` filtering

Manual regression reference:
- [`REGRESSION_CHECKLIST.md`](./REGRESSION_CHECKLIST.md)

---

## Current Limitations

### 1. Live status is useful, but not provider-internal truth
The current live status system is intentionally **heuristic**.

It can explain many observable states well, but it cannot yet guarantee provider-internal distinctions such as:
- truly waiting on a remote model response
- provider-side stall without explicit event emission
- network-layer failure before OpenClaw emits a clear error event

This is a visibility limitation, not just a UI limitation.

### 2. WebSocket is hybrid, not fully push-only
Current realtime behavior is:
- HTTP bootstrap
- WS incremental push
- polling fallback

This is by design. It trades conceptual purity for resilience and simpler recovery.

### 3. Agent live status is still v1
The current implementation already supports:
- auto-expiring terminal states into `idle`
- auto-hiding stale agents

But it still has room to improve in:
- provider-aware states
- richer per-session drill-down
- explicit "possibly waiting model/provider" heuristics

---

## Roadmap Direction

Current next-step themes:
1. provider-aware live status research
2. richer usage display (`input / output / total`)
3. session drill-down views
4. continued reduction of unnecessary polling paths
5. stronger explanation of "why no reply yet?"

---

## License

MIT
