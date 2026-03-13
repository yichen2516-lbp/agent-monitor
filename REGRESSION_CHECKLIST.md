# Agent Monitor Regression Test Plan

> **Purpose**: Define a stable, repeatable regression process for Agent Monitor after UX/UI and polling-layer changes.
>
> **Audience**: Maintainers, contributors, and release reviewers.
>
> **Status**: Active

---

## 1. Scope

This checklist validates the following areas:

- Dashboard rendering and data loading
- Filtering and error-focused workflows
- Activity list interactions (expand/collapse, aggregation, detail drawer)
- Drawer close behaviors (button/overlay/ESC)
- UI state persistence (`localStorage`)
- Incremental polling behavior (`since` query)
- Basic performance stability (no unnecessary full redraw feel)

Out of scope:

- Authentication/authorization
- Browser compatibility matrix beyond current supported targets
- Backend storage migration

---

## 2. Test Environment

### 2.1 Required

- Running service (`node index.js` or process manager)
- URL: `http://localhost:3450`
- Browser DevTools Console enabled

### 2.2 Recommended

- One active session producing events (tool/reply/thinking/cron)
- At least one known error event for error-path validation

---

## 3. Entry/Exit Criteria

### 3.1 Entry Criteria

- Build/runtime starts successfully
- `/health` returns status OK
- `/api` returns valid JSON payload

### 3.2 Exit Criteria (Release Gate)

- All **P0/P1 critical cases** pass
- No blocking JS runtime error in Console
- No regression in incremental polling behavior (no flash-then-empty)

---

## 4. Test Cases

> Legend: **Priority** = P0 (blocker), P1 (important), P2 (nice-to-have)

| ID | Priority | Area | Test Case | Expected Result |
|---|---|---|---|---|
| AM-001 | P0 | Load | Open dashboard page | Page renders; not stuck at “加载中...” |
| AM-002 | P0 | API | Call `/health` and `/api` | `/health` is OK; `/api` contains `agents`, `activities`, `updatedAt` |
| AM-003 | P0 | Polling | Refresh page and observe 10s | No “shows data then empty” behavior |
| AM-004 | P0 | Filter | Apply Agent + Type + Keyword + Errors-only combinations | Result set matches filter criteria |
| AM-005 | P1 | Quick actions | Click “异常模式” and “重置筛选” | Switches to error-only view; reset restores defaults |
| AM-006 | P1 | Metrics | Observe summary cards after filter and incoming events | Metrics update logically; visible count equals rendered list size |
| AM-007 | P0 | Text toggle | Expand/collapse long description | Toggle works; label switches correctly |
| AM-008 | P0 | Toggle isolation | Click “展开/收起” on list item | Does **not** open detail drawer |
| AM-009 | P1 | Error highlight | Trigger/observe error activity | Error item uses error semantic highlight |
| AM-010 | P1 | Aggregation | Enable error aggregation | Similar errors grouped with count badge (`N 次`) |
| AM-011 | P0 | Drawer open/close button | Open detail; click close button | Drawer closes reliably |
| AM-012 | P0 | Drawer close overlay | Open detail; click overlay | Drawer closes |
| AM-013 | P0 | Drawer close ESC | Open detail; press ESC | Drawer closes |
| AM-014 | P1 | Persistence | Set filters + aggregation; refresh page | UI state restored from localStorage |
| AM-015 | P0 | Incremental polling | Verify requests include `since` after first load | Incremental fetch active; no state loss on empty delta |
| AM-016 | P2 | UX smoothness | Observe page during frequent updates | No obvious jitter/full redraw feel when no meaningful change |

---

## 5. Smoke Run (5-minute quick check)

For rapid pre-merge validation, run at least:

- AM-001, AM-003, AM-007, AM-008, AM-011, AM-015

If any fails, block release and fix before merge.

---

## 6. Defect Reporting Template

```text
[Defect] <Short title>
Severity: blocker / major / minor
Environment: <OS / Browser / build>
Related Case: <e.g., AM-008>

Steps to Reproduce:
1) ...
2) ...
3) ...

Expected:
...

Actual:
...

Evidence:
- Console log:
- Screenshot/video:
- Relevant request/response:
```

---

## 7. Automated Regression Coverage

Current lightweight automated checks (`npm test`):

- `test/activity-parser.test.js`
  - new session message format
  - legacy flat format
  - tool call / tool result pairing
- `test/cron-parser.test.js`
  - cron line parsing
- `test/activity-store.test.js`
  - max activity retention
  - `since` filtering behavior

Still manual for now:
- browser rendering correctness
- detail drawer interactions
- localStorage persistence
- polling UX smoothness
- workspace browser interaction flows

---

## 8. Change Log (Document)

- 2026-03-13: Added minimal automated regression suite (`npm test`) with fixtures for parser/store coverage.
- 2026-03-12: Initial professional regression plan drafted for open-source workflow.
