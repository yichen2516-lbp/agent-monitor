# Agent Monitor Phase 5 Plan

## Positioning

Phase 5 is no longer about structural refactoring. It is the stage where Agent Monitor becomes a more complete product in terms of:

- usability
- observability
- realtime behavior
- debugging efficiency

Phase 1~4 already completed the structural cleanup:
- thinner entry and routing layer
- frontend monitor module split
- backend monitor-store split
- minimum regression tests and docs baseline

So Phase 5 is about this:

> **Make Agent Monitor easier to read, faster to debug with, more realtime, and more trustworthy as an always-on monitoring surface.**

---

## Current Progress (updated: 2026-03-13)

### Completed

#### P5-B: Error and anomaly investigation improvements (v1 completed)
Delivered:
- stronger error aggregation by more stable error signature
- aggregate count display
- grouped events in detail drawer
- slow calls quick filter
- failed tools / tool errors / cron errors quick filters
- richer drawer summary
- copy actions for JSON / source / session
- extra fields like:
  - error kind
  - tool status
  - stop reason

Representative commit:
- `19e9924` — `feat(monitor): improve error investigation workflows`

#### P5-C: Detail readability and interaction improvements (v2 completed)
Delivered:
- drawer upgraded from raw JSON view into:
  - summary
  - description
  - grouped events
  - raw JSON
- activity cards now expose clearer tags:
  - duration
  - slow
  - aggregate info
- copy interactions wired in
- drawer summary refined into investigation-oriented sections:
  - Overview
  - Model & Usage
  - Execution & Source
- normalized usage display:
  - total
  - input
  - output
  - cache read
  - cache write
- normalized provider / model / stopReason presentation
- stronger source / session context in drawer
- same-session recent timeline added inside drawer for faster continuous investigation

Current status:
- strong enough for real first-pass debugging
- next refinement should focus on verdict / interpretation, not raw field expansion

#### P5-D: Workspace Browser productization (second round completed)
Delivered in this phase:
- unified HUD / cyber dark visual shell with monitor page
- shared sidebar shell between workspace home and file view
- current file highlight
- remembered state:
  - expanded directories
  - search term
  - recent files
- missing file no longer returns a blank 404 page
- image preview support
- binary-safe rendering
- compact preview for large text files
- prev / next navigation
- raw open support
- recent files list
- lazy folder expansion for deep trees
- lightweight indexed search instead of full DOM traversal
- mobile file picker drawer and mobile interaction fixes

Representative commits:
- `cf2b2b4` — `feat(workspace): UX/UI overhaul with search, state persistence, unified HUD style`
- `ccc46df` — `fix(workspace): correct sidebar styling and search visibility`
- `6fa1adf` — `fix(workspace): render images and guard binary previews`
- `e915430` — `fix(workspace): avoid inline base64 image previews`
- `e6b8159` — `fix(workspace): show missing file errors inside viewer shell`
- `cc14d8c` — `feat(workspace): optimize browser UX and mobile picker`

#### P5-E: Realtime transport + live status (v2 completed)
Delivered:
- WebSocket hybrid pipeline
  - HTTP bootstrap
  - WS incremental push
  - polling fallback
- lightweight WS hub on backend
- transport mode indicator in UI:
  - `WS LIVE`
  - `POLLING`
  - `CONNECTING`
- agent live status panel
- session-first live status derivation in monitor-store
- refined state transitions:
  - `thinking`
  - `waiting-model`
  - `tool-call-pending`
  - `tool-running`
  - `tool-failed`
  - `reply-done`
  - `idle`
- terminal states auto-expire into `idle`
- stale agents auto-hide after long inactivity
- status cards now expose:
  - current session
  - current status duration
  - current tool
  - model
- fixed realtime feed cursor bug caused by using response `updatedAt` instead of latest activity timestamp
- provider-side assistant errors with `errorMessage` are now parsed and surfaced in feed as error events
- reply error events now participate in error-first filtering and investigation flow

Representative commits:
- `9e28df5` — `feat(monitor): add realtime websocket status pipeline`

#### Docs and maintenance
Delivered:
- `README.md` rewritten in English and aligned with current capabilities
- project positioning, architecture, API, limitations, and roadmap clarified

Representative commit:
- `62c731e` — `docs(readme): rewrite project documentation in english`

---

## What changed in priority

Earlier in the day, the biggest visible issue was workspace performance and usability. That work has now been pushed much further forward.

At this point, the product center of gravity has shifted.

The next most important work is no longer:
- more workspace styling
- or another round of local UI polish

The next most important work is:

1. **make live status more truthful**
2. **make transport and session visibility more production-like**
3. **make debugging a full session easier, not just a single event**

---

## Phase 5 Subtracks

## P5-A: Monitoring view enhancement

### Goal
Make the main monitor better for focused debugging, not just event scrolling.

### Current state
Substantially moved forward through:
- quick filters
- metrics
- live status panel
- connection mode indicator
- session focus mode from live status card into feed filtering
- same-session recent timeline inside drawer

### Remaining opportunities
- stronger session header / mini overview
- better “what matters now” prioritization
- dedicated verdict / interpretation layer above raw event details

---

## P5-B: Error and anomaly investigation enhancement

### Goal
Move from “see logs” to “recognize patterns faster”.

### Status
**v1 completed, refinement still possible.**

### Remaining opportunities
- richer error group metadata:
  - first seen
  - last seen
  - repeat count
- independent slow-calls view
- configurable duration threshold
- better group drill-down

---

## P5-C: Detail readability and investigation drawer enhancement

### Goal
Make a single event easier to inspect without opening raw files or session logs.

### Status
**v1 completed, second round still needed.**

### Remaining priorities
- split usage into:
  - input
  - output
  - total
- normalize provider / model / stopReason presentation
- make source / tool / session summary stronger
- improve long-text readability for thinking / reply content

---

## P5-D: Workspace Browser

### Goal
Keep workspace genuinely usable as a long-running side surface.

### Status
**second round completed for this phase.**

### Notes
Workspace is no longer the immediate bottleneck.
It is in a much better place now and can move down the priority list unless new concrete pain shows up.

---

## P5-E: Realtime transport and live status

### Goal
Make the dashboard more realtime and more explanatory.

### Status
**v2 completed.**

### Delivered in v2
- WS hybrid transport
- fallback polling
- transport status in UI
- session-first agent live status
- terminal state expiry
- stale agent hiding
- session focus flow from live status into feed
- polling cursor fix for missed realtime activity updates
- provider error event surfacing for assistant-side API failures

### Remaining gap
This is still not enough for the hardest question:

> “If the agent is not replying, is it waiting on the model, silently stuck, calling a tool, or failing before response?”

That is the next major frontier.

---

## Observability Boundary (important)

The current live status system is intentionally heuristic.

What it can infer reasonably well from session events:
- thinking
- tool-running
- tool-done
- tool-failed
- reply-done
- idle
- cron-error

What it cannot yet guarantee with provider-level precision:
- exact model request lifecycle
- exact remote provider wait state
- provider-side stall before explicit error emission
- network-layer waiting vs local thinking when no explicit lifecycle event exists

This means:
- **a useful and honest live status is already possible**
- **a fully precise provider-aware status requires more OpenClaw event visibility**

---

## Next Step Plan (explicit)

This section replaces the earlier broad backlog with a more concrete next-step sequence.

### Next Step 1 — P5-E.2: Session-first live status refinement

**Goal:** make live status more truthful and less shallow.

#### Scope
- move from “agent-level last event” toward “session-first status, then agent summary”
- distinguish better between:
  - thinking
  - waiting-model
  - tool-call-pending
  - tool-running
  - tool-failed
  - reply-streaming
  - reply-done
  - idle
- track status duration more explicitly
- attach current tool name and current session context more reliably

#### Why this comes first
Because the current v1 already helps, but it still leaves the most important unanswered question partially open:

> what exactly is the agent doing *right now*?

This is the single most valuable improvement left in the monitor.

#### Expected deliverables
- per-session live status state machine in backend
- better agent summary derived from most active session
- status duration in UI
- clearer waiting / running / idle transitions

---

### Next Step 2 — P5-A.2: Session drill-down view

**Goal:** make it easier to debug one session as a continuous thread instead of isolated cards.

#### Scope
- session filter or session quick-focus entry
- session drill-down panel or focused list mode
- show latest N events for a selected session
- make live status and activity stream work together

#### Why this comes second
Live status tells you **what is happening now**.
Session drill-down tells you **how you got here**.
These two features should land together conceptually, but live status refinement is the stronger prerequisite.

#### Expected deliverables
- session focus UI
- session timeline view or filtered mode
- easier handoff from status card to event-level investigation

---

### Next Step 3 — P5-C.2: Usage and provider detail refinement

**Goal:** make the drawer more useful for real debugging and performance reading.

#### Scope
- split token usage into:
  - input
  - output
  - total
- normalize provider / model / stopReason fields
- improve summary rows for:
  - tool
  - source
  - session
  - provider context

#### Why this is third
It is important, but it is less transformative than live status refinement and session drill-down.
It improves the investigation experience after the bigger realtime/status model is stronger.

---

### Next Step 4 — P5-E.3: Provider-aware status research

**Goal:** find out how far Agent Monitor can go beyond heuristic states.

#### Research question
Can OpenClaw expose lifecycle signals that allow the monitor to distinguish:
- local thinking
- outbound model request started
- model response streaming
- provider/network timeout
- provider error before assistant reply

#### Expected outcome
One of two outcomes is acceptable:
1. **Hookable provider lifecycle exists** → integrate it
2. **No such lifecycle exists yet** → document hard limits and improve heuristics instead

This work is partially product, partially platform research.

---

## Recommended Priority Order

### Updated priority
1. **P5-A / P5-C follow-up — verdict layer + session mini header**
2. **P5-E.3 — Provider-aware status research**
3. **P5-D follow-up — Workspace only if new concrete pain appears**

### Why this order
- workspace is no longer the primary pain point
- realtime transport is now good enough to support deeper status work
- the biggest remaining product gap is still “what is the agent doing now, exactly?”
- after that, the next missing piece is session-level debugging continuity

---

## Acceptance Criteria

Phase 5 should not be judged by how many files changed.
It should be judged by whether it improves real debugging speed and trust.

### Good acceptance criteria
- can I tell what the agent is doing now more reliably?
- can I distinguish idle vs done vs stuck more quickly?
- can I move from agent status to session context with less friction?
- can I debug a failed or slow run faster than before?
- can I keep the monitor open for long periods without confusion or obvious instability?

### Bad acceptance criteria
- the UI got busier
- more badges were added
- more code was written without reducing ambiguity

---

## One-line conclusion

**Phase 5 has already completed the first strong round of error investigation improvements, workspace productization, hybrid realtime transport, and v1 live status.**

**The next phase should focus on making live status more truthful and making session-level debugging first-class.**
