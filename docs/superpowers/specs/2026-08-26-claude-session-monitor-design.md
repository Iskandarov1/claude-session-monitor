# Claude Session Monitor — design spec

**Date:** 2026-08-26 · **Status:** draft for review · **Source design:** Claude Design project `4272a5e3-e480-4fae-84a1-099f7044665f`, file `Claude Session Monitor.dc.html` (option **2a** canonical layout, **2b** Windows deltas, **2c** feed tab, sheets **1c–1g** for component states and interactions).

## 1. Purpose

A desktop app (macOS + Windows) for a developer running several Claude Code sessions at once. One window that:

1. lists every live session with its state,
2. shows any session's transcript, live,
3. shows messages flowing *between* sessions in one feed,
4. sends a prompt to one or several sessions,
5. searches across all transcripts.

Single user, single machine. No accounts, no server, no telemetry.

## 2. Verified platform facts (Claude Code 2.1.246, macOS)

These were checked on 2026-08-26 and are the contract the app is built against. Anything not listed here is an assumption (see §11).

| Fact | Detail |
|---|---|
| **Session registry** | `~/.claude/sessions/<pid>.json`, world-readable. Fields: `pid`, `sessionId`, `cwd`, `startedAt` (ms), `procStart`, `version`, `kind` (`interactive`), `entrypoint` (`cli`), `pidDomain` (`darwin`), `messagingSocketPath`, `name` (e.g. `maydon-api-2b`), `nameSource` (`derived` \| user-set \| absent), `status` (`busy` \| `idle`), `updatedAt`, `statusUpdatedAt`. Updated live on status change. A sibling `<pid>.<hash>.key` (0600) holds the socket auth token — not readable by design. |
| **Transcripts** | `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`, append-only, one JSON object per line. Slug = cwd with `/` → `-`. Entry `type`s that matter: `user`, `assistant`, `system`, `queue-operation`, `permission-mode`, `ai-title`, `cost-state`. Others (`attachment`, `file-history-*`, `mode`, `last-prompt`, `atis-latch`, `agent-name`, `bridge-session`) are ignored. |
| **`user` entry** | `message.content` is a string (typed prompt) or an array of blocks (`text`, `image`, `tool_result`). `isMeta: true` marks injected/system content. Has `uuid`, `parentUuid`, `timestamp`, `cwd`. |
| **`assistant` entry** | One content block per line: `text`, `thinking`, or `tool_use` (`name`, `input`). `message.model`, `message.usage` (`output_tokens` etc.), `timestamp`. A `tool_use` with `name: "SendMessage"` has `input.to`, `input.message`, `input.summary`. |
| **`system` entry** | `subtype` ∈ `local_command`, `turn_duration`, `stop_hook_summary`, `away_summary`, `bridge_status`; `content`, `level`. Only `local_command` is shown (as a system row). |
| **Cross-session message (receiver side)** | `{"type":"queue-operation","operation":"enqueue","timestamp","sessionId","content":"<cross-session-message from=\"uds:/tmp/cc-socks/<pid>.sock\" from-name=\"<name>\" from-mode=\"bypass\" hop-chain=\"…\">\n<text>\n</cross-session-message>"}`. `dequeue`/`remove` ops are ignored. |
| **Bridge** | A headless `claude -p --input-format stream-json --output-format stream-json --verbose` process accepts multiple `{"type":"user","message":{"role":"user","content":"…"}}` lines on stdin, emits `system/init`, `assistant`, `user`, `result` events per turn, stays alive between turns, gets its own messaging socket, and can call `ListAgents`/`SendMessage` against all peers. Measured: ~8 s first turn (cold start), ~4 s later turns, $0.005–0.015 per turn on `haiku`. |
| **Sockets** | `/tmp/cc-socks/<pid>.sock`, token-protected. The app never touches them. |
| **Session name** | From the registry `name`. Not present in transcripts. Transcript `ai-title` gives an auto-generated title used as a subtitle. |

## 3. Architecture

Electron (electron-vite) · React 19 · TypeScript · Tailwind v4 · shadcn/ui (dark tokens as in the design) · Vitest.

```
┌──────────────── main process (Node) ────────────────┐
│ RegistryWatcher  TranscriptTailer  Bridge  SearchIndex│
│        └──────── SessionStore (in-memory model) ──────┘│
│                     Prefs (JSON in userData)           │
└───────────────┬────────── IPC (typed) ─────────────────┘
                │ contextBridge (preload)
┌───────────────▼──────────── renderer (React) ──────────┐
│ TitleBar · Sidebar · Transcript · RelayPanel · FeedTab  │
│ SearchOverlay · StatusBar        (zustand store)        │
└─────────────────────────────────────────────────────────┘
```

Every backend module is a plain class with an `EventEmitter`-style `on(event)` API and no Electron imports, so it is unit-testable with fixture files. `ipc.ts` is the only file that knows about Electron IPC.

### 3.1 Repository layout

```
claude-session-monitor/
  package.json  electron.vite.config.ts  tsconfig*.json  tailwind.config.ts
  src/shared/types.ts          # Session, TranscriptEvent, FeedItem, BridgeState, Prefs, IPC channel types
  src/main/index.ts            # app lifecycle, window, wiring
  src/main/paths.ts            # ~/.claude resolution per platform
  src/main/registry.ts         # RegistryWatcher
  src/main/transcript/parser.ts# line → TranscriptEvent (pure)
  src/main/transcript/tailer.ts# incremental file reader per session
  src/main/transcript/locate.ts# sessionId+cwd → jsonl path
  src/main/feed.ts             # FeedBuilder (merges sender/receiver evidence)
  src/main/bridge.ts           # Bridge process manager + relay protocol
  src/main/search.ts           # SearchIndex
  src/main/state.ts            # derived session state (working/idle/waiting/ended)
  src/main/prefs.ts            # pins, bookmarks, prompt history, window bounds
  src/main/ipc.ts              # channel registration
  src/preload/index.ts
  src/renderer/…               # App, components/, store/, lib/
  tests/fixtures/*.jsonl, tests/fixtures/sessions/*.json
  tests/*.test.ts
  docs/superpowers/specs/, docs/superpowers/plans/
```

## 4. Data model (`src/shared/types.ts`)

```ts
type SessionState = 'working' | 'idle' | 'waiting' | 'ended';
type Origin = 'local' | 'cloud' | 'remote';           // v1 always 'local'

interface Session {
  sessionId: string; pid: number; name: string; nameSource?: string;
  cwd: string; gitBranch?: string; startedAt: number; version: string;
  registryStatus: 'busy' | 'idle'; state: SessionState; origin: Origin;
  lastActivityAt: number; lastActivityPreview: string;   // sidebar second line
  model?: string; permissionMode?: string; aiTitle?: string;
  transcriptPath?: string; alive: boolean; pinned: boolean;
}

type TranscriptEvent =
  | { kind: 'user';    id; ts; text: string }
  | { kind: 'claude';  id; ts; text: string; model?: string; outputTokens?: number }
  | { kind: 'tool';    id; ts; name: string; input: unknown; resultText?: string; isError?: boolean }
  | { kind: 'cross';   id; ts; fromName: string; fromMode?: string; text: string }
  | { kind: 'sent';    id; ts; to: string[]; text: string }     // SendMessage tool_use in this session
  | { kind: 'system';  id; ts; text: string; level?: string }
  | { kind: 'divider'; id; ts; text: string };                  // e.g. "session resumed 11:02"

interface FeedItem { id; ts; from: string; to: string[]; text: string; senderSessionId?: string; receiverSessionIds: string[]; viaBridge: boolean }

type BridgeState =
  | { status: 'connected'; latencyMs?: number; bridgeName: string }
  | { status: 'reconnecting'; attempt: number; max: number }
  | { status: 'unavailable'; reason: string }
  | { status: 'relaying'; targets: string[] };

interface Prefs { pinned: string[]; bookmarks: {sessionId; eventId}[]; promptHistory: string[]; window?: {x;y;w;h}; selectedSessionId?: string }
```

## 5. Backends

### 5.1 RegistryWatcher (`registry.ts`)

- Watches `~/.claude/sessions/` (chokidar). On add/change: parse `<pid>.json`; on unlink: mark ended. Ignores `*.key`.
- Liveness: `process.kill(pid, 0)` on every change and every 5 s tick; a dead pid whose file still exists ⇒ `ended`.
- Emits `session:upsert` / `session:remove`. Filters out the app's own bridge session (matched by the pid we spawned).

### 5.2 Transcript parser (`transcript/parser.ts`) — pure function `parseLine(raw): TranscriptEvent[] | Meta`

Mapping rules (each raw entry → 0..1 events, plus metadata side-effects):

| Raw | Result |
|---|---|
| `user`, content string, `isMeta` falsy | `user` |
| `user`, content array with `text` blocks, not meta | `user` (concatenated text) |
| `user`, content array with `tool_result` | attaches `resultText`/`isError` to the pending `tool` event with matching `tool_use_id` |
| `user`, `isMeta: true` or text starting with `<` system tag | dropped |
| `assistant` block `text` | `claude` (consecutive text blocks in one message id are merged) |
| `assistant` block `tool_use` name `SendMessage` | `sent` (to = `[input.to]`) |
| `assistant` block `tool_use` other | `tool` (collapsed row) |
| `assistant` block `thinking` | dropped |
| `queue-operation` enqueue with `<cross-session-message …>` | `cross` (parse `from-name`, `from-mode`, inner text) |
| `queue-operation` other | dropped |
| `system` subtype `local_command` | `system` |
| `system` other subtypes | dropped |
| `permission-mode` | meta: `permissionMode` |
| `ai-title` | meta: `aiTitle` |
| `cost-state` | meta: `totalCostUSD` |
| first entry after a gap > 30 min, or first entry of file | `divider` "session started/resumed HH:MM" |

### 5.3 TranscriptTailer (`transcript/tailer.ts`)

- One tailer per tracked session. Locates the file via `locate.ts` (`~/.claude/projects/<slug(cwd)>/<sessionId>.jsonl`; falls back to scanning project dirs for the sessionId).
- Initial load: reads whole file, parses, emits `transcript:reset(sessionId, events, meta)`.
- Then `fs.watch` + size check; reads only appended bytes; handles a partial trailing line by buffering. Emits `transcript:append(sessionId, events, meta)`.
- Keeps `lastActivityAt` and a one-line `lastActivityPreview` (last `user`/`claude`/`tool` text, ≤ 60 chars).

### 5.4 State derivation (`state.ts`)

| Condition | State |
|---|---|
| pid dead or registry file gone | `ended` |
| registry `idle` | `idle` |
| registry `busy`, and the last event is a `tool` without result for > 20 s | `waiting` (label "Waiting — likely permission prompt") |
| registry `busy` otherwise | `working` |

The design's `Completed`/`Failed` map to `ended`; `Blocked` maps to `waiting`. No `Failed` detection in v1 (no reliable signal).

### 5.5 Bridge (`bridge.ts`)

Spawns one long-lived child on app start:

```
claude -p --input-format stream-json --output-format stream-json --verbose
       --model haiku --allowedTools SendMessage,ListAgents
       --no-session-persistence -n csm-bridge
       --system-prompt <relay-system-prompt>
```
cwd = app userData dir; env with `CLAUDE_CODE_MESSAGING_*`/`CLAUDE_CODE_SESSION_ID` removed so it is a top-level session.

**Relay protocol.** `relay(targets: string[], text: string): Promise<RelayResult>` writes one user line:

> Relay the message between the markers to each of these sessions with SendMessage, one call per session, `to` exactly as given: `<names>`. Send the text verbatim; add nothing. Then reply with only JSON `{"sent":[…],"failed":[{"to":…,"error":…}]}`.
> `<<<MSG` … `MSG>>>`

and resolves on the next `result` event, parsing the JSON (tolerant: falls back to `sent: targets` when `is_error` is false and JSON is missing). One relay at a time; others queue. State `relaying` while a relay is in flight.

**States.** `connected` after `system/init`; `reconnecting {attempt, max: 5}` with backoff 1/2/4/8/16 s when the process exits unexpectedly; `unavailable` after 5 failures or when `claude` is not on PATH (message says which); manual **Retry** resets the counter. `latencyMs` = last relay round-trip.

**Recording.** Every relay is recorded as a `FeedItem` with `viaBridge: true`, `from: "you"` — the receiver's transcript will show it as from `csm-bridge`, and FeedBuilder folds those two into one item.

### 5.6 FeedBuilder (`feed.ts`)

Feed items come from two sources and are merged:

1. `sent` events in any tracked transcript (sender side: from = that session, to = `input.to`).
2. `cross` events in any tracked transcript (receiver side: from = `from-name`).

Dedup key: `(from, normalized text, ts within ±10 s)`; a match adds the receiver's sessionId to `receiverSessionIds`. Items sent by `csm-bridge` are relabeled `from: "you"`. Sorted by ts desc, grouped by day for the tab view.

### 5.7 SearchIndex (`search.ts`)

- Indexes `user`/`claude`/`cross`/`sent` event text for: all live sessions + transcripts modified in the last 7 days across all `~/.claude/projects/*`. Built lazily on first search, updated from tailer appends.
- Query: case-insensitive substring; returns `{sessionId, sessionName, eventId, ts, snippet}` ranked by recency, max 200.

### 5.8 Prefs (`prefs.ts`)

JSON file in `app.getPath('userData')/prefs.json`, written debounced. Holds pins, bookmarks, prompt history (last 50), window bounds, last selected session.

## 6. IPC contract (`src/shared/types.ts` → `ipc.ts` / preload)

Renderer → main (invoke): `sessions:list`, `transcript:load(sessionId)`, `relay:send(targets, text)`, `bridge:retry`, `search:query(q)`, `prefs:get`, `prefs:set(partial)`, `transcript:export(sessionId)` → markdown string + save dialog, `app:openLogs`, `app:reload`.

Main → renderer (push): `session:upsert`, `session:remove`, `transcript:reset`, `transcript:append`, `feed:update(items)`, `bridge:state`, `stats:update({working, waiting, idle, ended, refreshedAt})`.

All payloads are the shared types; preload exposes a typed `window.csm` object only.

## 7. UI (renderer)

Layout and tokens follow design **2a** exactly (1360×~700 reference; fully responsive down to 1100 px — sidebar 236 px, relay panel 292 px, center flexes). Dark only in v1. Fonts: Geist / Geist Mono (bundled locally, not fetched).

| Region | Component | Design ref | Notes |
|---|---|---|---|
| Title bar | `TitleBar` | 2a / 2b | macOS: hidden-inset traffic lights, drag region; Windows: custom frame with min/max/close right-aligned, close hover `#E81123`, app icon + title left. Center: search field (`⌘K`/`Ctrl+K`). Right: `Sessions` · `Feed` · `History` segmented tabs. |
| Sidebar | `Sidebar`, `SessionRow` | 2a, 1c | Filter input; `PINNED` and `ALL SESSIONS` groups; row = status dot (pulsing when working) · name · one-line activity/state · origin badge; hover shows cwd in subtitle and a ★ pin toggle; ⌘/Ctrl-click multi-selects. Footer "N sessions". "+ New" opens a small dialog that copies a `claude -n <name>` command (v1 does not spawn interactive terminals). |
| Header | `SessionHeader` | 2a | name, state chip, `cwd · model · started HH:MM`, buttons `Export .md`, `★ Pinned`. |
| Transcript | `Transcript`, `MessageUser`, `MessageClaude`, `MessageCross`, `MessageTool`, `SystemRow`, `Divider`, `StreamingIndicator` | 2a, 1d | Virtualized list (react-virtuoso). Auto-follows tail unless the user scrolled up (then a "↓ new" pill). Code blocks with file-name header + copy/collapse. Cross-session rows: violet rail + `⇄ from <name>` chip, actions `Reply` (prefills relay to that sender) and `Jump to sender ↗`. Streaming state (session `working` and last event is `claude`/`tool`): blinking block cursor + "streaming · N tokens" from the current turn's `output_tokens`. Right-click: Copy · Bookmark · Jump to sender. |
| Relay panel | `RelayPanel`, `TargetPicker`, `BridgeStatusChip` | 2a, 1e, 1f | "Send to" follows selection; multi-select shows chips + "Broadcast to N sessions". Quick chips prefill text: *Ask status* ("What are you working on and what's blocking?"), *List sessions*, *Pause work* ("Pause after the current step and wait for further instructions."). Warning line "⚠ Needs approval in target session" when the target's `permissionMode` is not `bypassPermissions`/`acceptEdits`. Send = ⌘⏎/Ctrl⏎; ⟲ opens prompt history. Disconnected: red banner "Relay offline — The headless bridge session isn't reachable…", input disabled, **Retry connection**. |
| Mini feed | `FeedMini` | 2a | Last 3 items; "Open tab ↗". |
| Feed tab | `FeedTab` | 2c | Filters `Cross-session only` / `All activity` (adds `sent` broadcasts) / `Session ▾`; grouped by day; item = `from → to` · time · full text · `Open in sender ↗` · `Open in receiver ↗` · `Bookmark`; broadcast items show "broadcast · relayed via bridge". |
| History tab | `HistoryTab` | (not in design) | Bookmarks list + prompt history; minimal, uses the feed item style. |
| Search | `SearchOverlay` | 2a title bar | ⌘K modal; results `session · time · snippet`; Enter jumps to the event. |
| Status bar | `StatusBar` | 2a / 2b | counts by state with dots, `refreshed Ns ago`, `bridge ●` colored by state, `logs` (opens `~/.claude/projects`), `reload`. Windows adds "Ctrl+⏎ to send". |

State: a zustand store fed by the push channels; selection/multi-select is renderer-only.

## 8. Error handling

- Registry file half-written (JSON parse error) → retry after 100 ms, then ignore that change.
- Transcript missing for a registry session → row still shows (state from registry), transcript panel says "Transcript not found for this session yet".
- Bridge spawn fails (`claude` not on PATH) → `unavailable` with the reason; everything else keeps working.
- Relay result JSON missing/invalid → treat as sent if `is_error` false, else show the `result` text in the relay panel.
- Renderer never blocks on IPC; all pushes are idempotent (keyed by sessionId/eventId).

## 9. Testing

- **Unit (Vitest, main process):** `parser.test.ts` (one test per row of the §5.2 table, using real anonymized lines captured from this machine as fixtures); `tailer.test.ts` (append, partial-line buffering, reset); `registry.test.ts` (add/change/unlink, dead pid); `state.test.ts`; `feed.test.ts` (sender/receiver dedup, bridge relabel); `bridge.test.ts` (protocol against a fake `claude` script that echoes stream-json: multi-turn, crash → reconnecting → unavailable, relay JSON parsing); `search.test.ts`.
- **Integration (manual, scripted in `docs/testing.md`):** run the app against the real `~/.claude` with 2+ live sessions; send a relay; verify it lands in the target terminal and the feed.
- **Windows:** the code paths are written and unit-tested (path resolution, frame, shortcuts) but cannot be run from this Mac — first Windows run is a documented manual check.

## 10. Out of scope (v1)

Light mode · cloud / Remote Control sessions · spawning interactive sessions · transcript editing · notifications/toasts · reading `.key` tokens or sockets directly · multi-machine.

## 11. Assumptions and risks

1. Windows stores the registry at `%USERPROFILE%\.claude\sessions\` with the same JSON shape (`pidDomain` differs) and `claude` is invokable as `claude.cmd` — **verify on first Windows run**.
2. `-n csm-bridge` is honored in `-p` mode (else the bridge is filtered by pid only).
3. Transcript format is unversioned; each entry carries `version`, and the parser logs-and-skips unknown shapes rather than failing.
4. Bridge cost: each relay is one Haiku turn (~$0.01). No background polling through Claude — the registry provides state for free.
5. The `waiting` heuristic (§5.4) can misfire on long-running tools; it is labeled "likely", never asserted.
