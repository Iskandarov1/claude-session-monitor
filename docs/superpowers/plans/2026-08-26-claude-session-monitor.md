# Claude Session Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a macOS/Windows Electron app that lists live Claude Code sessions, live-tails their transcripts, shows cross-session messages in one feed, relays prompts to sessions through a headless Claude "bridge", and searches all transcripts.

**Architecture:** Electron main process hosts four Electron-free backend classes (RegistryWatcher over `~/.claude/sessions`, TranscriptTailer over `~/.claude/projects/**/*.jsonl`, Bridge over a long-lived `claude -p --input-format stream-json` child, SearchIndex) combined by a SessionStore and exposed to the React renderer through a typed IPC surface. The renderer is a zustand store plus components that map one-to-one onto the Claude Design sheets (2a/2b/2c, 1c–1g).

**Tech Stack:** Electron, electron-vite, React 19, TypeScript, Tailwind v4, Radix primitives (shadcn/ui token set), zustand, react-virtuoso, chokidar, Vitest + @testing-library/react, electron-builder.

**Spec:** `docs/superpowers/specs/2026-08-26-claude-session-monitor-design.md` — read it first; §2 lists the verified file formats every parser in this plan targets, §5 the module contracts, §7 the UI table.

## Global Constraints

- Node ≥ 22 (machine has 26.7), npm ≥ 10. No pnpm/bun.
- Backend modules in `src/main/**` (except `index.ts`, `ipc.ts`, `window.ts`) MUST NOT import from `electron` — they are unit-tested under plain Node.
- The app NEVER reads `~/.claude/sessions/*.key` or opens `/tmp/cc-socks/*.sock`.
- Registry path: `<claudeHome>/sessions`; transcripts: `<claudeHome>/projects/<slug>/<sessionId>.jsonl`; `claudeHome` = `$CLAUDE_CONFIG_DIR` or `~/.claude`.
- Bridge command (spec §5.5): `claude -p --input-format stream-json --output-format stream-json --verbose --model haiku --allowedTools SendMessage,ListAgents --no-session-persistence -n csm-bridge --system-prompt <text>`; the child env MUST have `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID` removed.
- Session states are exactly `'working' | 'idle' | 'waiting' | 'ended'`; `waiting` threshold is 20 s (spec §5.4). The design sheets label two states differently: mockup **Blocked** is this plan's `waiting`, and mockup **Completed** is `ended`. Mockup **Failed** has no reliable signal and is not implemented (spec §5.4) — never add a `failed` state.
- Dark theme only. Tokens (spec §7 / design 2a): background `oklch(0.145 0 0)`, panel `oklch(0.205 0 0)`, raised `oklch(0.269 0 0)`, fg `oklch(0.985 0 0)`, fg-soft `oklch(0.87 0 0)`, muted `oklch(0.708 0 0)`, faint `oklch(0.556 0 0)`, border `rgba(255,255,255,.1)`, input-border `rgba(255,255,255,.15)`, primary `oklch(0.922 0 0)` on `oklch(0.205 0 0)`; accents: working `#34d399`, waiting `#fbbf24`, ended `#60a5fa`, error `#f87171`, cross-session `#a78bfa` (text `#c4b5fd`), claude `#d97757`.
- Fonts: Geist / Geist Mono from the `geist` npm package (bundled, never fetched at runtime), fallback `system-ui, sans-serif` / `ui-monospace, monospace`.
- Commit after every task with a conventional-commit message; never push.
- Every command in this plan runs from the repo root `~/maydon/claude-session-monitor`.

---

## File map

| Path | Responsibility |
|---|---|
| `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `electron-builder.yml` | tooling |
| `src/shared/types.ts` | all cross-process types + IPC channel names |
| `src/main/paths.ts` | claudeHome/sessions/projects paths, cwd → slug |
| `src/main/transcript/parser.ts` | pure: raw JSONL line → events/updates/meta |
| `src/main/transcript/locate.ts` | find a session's transcript file |
| `src/main/transcript/tailer.ts` | incremental file reader, emits reset/append |
| `src/main/registry.ts` | watch `sessions/*.json`, liveness |
| `src/main/state.ts` | pure: derive SessionState |
| `src/main/store.ts` | SessionStore: registry + tailers → Session model, transcripts, stats |
| `src/main/feed.ts` | FeedBuilder: merge sender/receiver evidence |
| `src/main/bridge.ts` | Bridge child process + relay protocol |
| `src/main/search.ts` | SearchIndex |
| `src/main/prefs.ts` | prefs.json persistence |
| `src/main/export.ts` | transcript → markdown |
| `src/main/ipc.ts` | IPC channel registration (only file besides index/window that touches electron) |
| `src/main/window.ts` | BrowserWindow creation, bounds persistence, platform chrome |
| `src/main/index.ts` | app lifecycle and wiring |
| `src/preload/index.ts` | `window.csm` typed API |
| `src/renderer/index.html`, `src/renderer/src/main.tsx`, `App.tsx` | renderer entry |
| `src/renderer/src/styles/globals.css` | tokens, fonts, base styles |
| `src/renderer/src/store.ts` | zustand store + IPC subscriptions |
| `src/renderer/src/lib/format.ts` | time/path formatting helpers |
| `src/renderer/src/components/*` | one file per UI region (see spec §7 table) |
| `tests/**` | Vitest tests + fixtures |
| `docs/testing.md` | manual integration checklist |

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/styles/globals.css`, `tests/smoke.test.ts`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `test`, `typecheck`; path aliases `@shared/*`, `@main/*`, `@renderer/*`.

- [ ] **Step 1: Create package.json and install dependencies**

```json
{
  "name": "claude-session-monitor",
  "version": "0.1.0",
  "private": true,
  "description": "Monitor and relay prompts to local Claude Code sessions",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "package:mac": "npm run build && electron-builder --mac",
    "package:win": "npm run build && electron-builder --win"
  }
}
```

Run:
```bash
npm install --save-dev electron electron-vite vite @vitejs/plugin-react typescript @types/node @types/react @types/react-dom vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event electron-builder tailwindcss @tailwindcss/vite
npm install react react-dom zustand react-virtuoso chokidar clsx tailwind-merge lucide-react geist @radix-ui/react-dropdown-menu @radix-ui/react-dialog @radix-ui/react-context-menu @radix-ui/react-tooltip @radix-ui/react-popover
```
Expected: `node_modules/` populated, no peer-dependency errors. (If `electron` postinstall fails behind a proxy, set `ELECTRON_MIRROR` and re-run.)

- [ ] **Step 2: Write tooling config**

`electron.vite.config.ts`:
```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@main': resolve(__dirname, 'src/main'),
  '@renderer': resolve(__dirname, 'src/renderer/src'),
}

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  renderer: {
    root: 'src/renderer',
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    resolve: { alias },
    plugins: [react(), tailwindcss()],
  },
})
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node", "vitest/globals", "@testing-library/jest-dom"],
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"],
      "@main/*": ["src/main/*"],
      "@renderer/*": ["src/renderer/src/*"]
    }
  },
  "include": ["src", "tests", "electron.vite.config.ts", "vitest.config.ts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
  },
})
```

`tests/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
```

`.gitignore`:
```
node_modules/
out/
dist/
release/
*.log
.DS_Store
```

- [ ] **Step 3: Write the minimal app**

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 760,
    minWidth: 1100,
    minHeight: 600,
    show: false,
    backgroundColor: '#252525',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false },
  })
  win.once('ready-to-show', () => win.show())
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

`src/preload/index.ts`:
```ts
import { contextBridge } from 'electron'
contextBridge.exposeInMainWorld('csm', { platform: process.platform })
```

`src/renderer/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:" />
    <title>Claude Session Monitor</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

`src/renderer/src/App.tsx`:
```tsx
export default function App() {
  return <div className="h-screen flex items-center justify-center text-fg">Claude Session Monitor</div>
}
```

`src/renderer/src/styles/globals.css`:
```css
@import "tailwindcss";

@theme {
  --color-bg: oklch(0.145 0 0);
  --color-panel: oklch(0.205 0 0);
  --color-raised: oklch(0.269 0 0);
  --color-fg: oklch(0.985 0 0);
  --color-fg-soft: oklch(0.87 0 0);
  --color-muted: oklch(0.708 0 0);
  --color-faint: oklch(0.556 0 0);
  --color-border: rgba(255,255,255,.1);
  --color-input: rgba(255,255,255,.15);
  --color-primary: oklch(0.922 0 0);
  --color-primary-fg: oklch(0.205 0 0);
  --color-working: #34d399;
  --color-waiting: #fbbf24;
  --color-ended: #60a5fa;
  --color-error: #f87171;
  --color-cross: #a78bfa;
  --color-cross-fg: #c4b5fd;
  --color-claude: #d97757;
  --font-sans: "Geist", system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, monospace;
}

html, body, #root { height: 100%; margin: 0; }
body { background: var(--color-bg); color: var(--color-fg); font-family: var(--font-sans); font-size: 12.5px; -webkit-font-smoothing: antialiased; }
```

- [ ] **Step 4: Write a smoke test**

`tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 5: Verify test, typecheck, and build**

Run: `npm test`
Expected: `1 passed`.

Run: `npm run typecheck`
Expected: no output (exit 0).

Run: `npm run build`
Expected: `out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html` exist.

Run: `npm run dev` for ~10 s, then Ctrl+C.
Expected: a dark window titled "Claude Session Monitor" opens showing the centered text.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold electron-vite + react + tailwind + vitest"
```

---

### Task 2: Shared types and path resolution

**Files:**
- Create: `src/shared/types.ts`, `src/main/paths.ts`
- Test: `tests/paths.test.ts`

**Interfaces:**
- Produces (used by every later task): all types below; `claudeHome(env?, home?)`, `sessionsDir(root?)`, `projectsDir(root?)`, `projectSlug(cwd)`, `transcriptPath(cwd, sessionId, root?)`.

- [ ] **Step 1: Write the failing test**

`tests/paths.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { claudeHome, sessionsDir, projectsDir, projectSlug, transcriptPath } from '@main/paths'

describe('paths', () => {
  it('defaults to ~/.claude', () => {
    expect(claudeHome({}, '/Users/me')).toBe('/Users/me/.claude')
  })
  it('honors CLAUDE_CONFIG_DIR', () => {
    expect(claudeHome({ CLAUDE_CONFIG_DIR: '/x/cfg' }, '/Users/me')).toBe('/x/cfg')
  })
  it('derives sessions and projects dirs', () => {
    expect(sessionsDir('/h/.claude')).toBe('/h/.claude/sessions')
    expect(projectsDir('/h/.claude')).toBe('/h/.claude/projects')
  })
  it('slugs a cwd like Claude Code does', () => {
    expect(projectSlug('/Users/iskandarov/maydon/secondrun/maydon-api')).toBe('-Users-iskandarov-maydon-secondrun-maydon-api')
    expect(projectSlug('C:\\dev\\acme-api')).toBe('C--dev-acme-api')
    expect(projectSlug('/tmp/my.app_v2')).toBe('-tmp-my-app-v2')
  })
  it('builds the transcript path', () => {
    expect(transcriptPath('/a/b', 'abc-123', '/h/.claude')).toBe('/h/.claude/projects/-a-b/abc-123.jsonl')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/paths.test.ts`
Expected: FAIL — `Cannot find module '@main/paths'`.

- [ ] **Step 3: Write the shared types**

`src/shared/types.ts`:
```ts
export type SessionState = 'working' | 'idle' | 'waiting' | 'ended'
export type Origin = 'local' | 'cloud' | 'remote'
export type RegistryStatus = 'busy' | 'idle'

export interface RegistryEntry {
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
  version: string
  kind: string
  entrypoint: string
  name: string
  nameSource?: string
  status: RegistryStatus
  updatedAt: number
  messagingSocketPath?: string
}

export interface Session {
  sessionId: string
  pid: number
  name: string
  nameSource?: string
  cwd: string
  gitBranch?: string
  startedAt: number
  version: string
  registryStatus: RegistryStatus
  state: SessionState
  origin: Origin
  alive: boolean
  lastActivityAt: number
  lastActivityPreview: string
  model?: string
  permissionMode?: string
  aiTitle?: string
  totalCostUSD?: number
  transcriptPath?: string
  pinned: boolean
  /** output tokens of the current (in-progress) turn, for the streaming indicator */
  turnOutputTokens: number
}

interface EventBase { id: string; ts: number }
export type TranscriptEvent =
  | (EventBase & { kind: 'user'; text: string })
  | (EventBase & { kind: 'claude'; text: string; model?: string; outputTokens?: number; messageId?: string })
  | (EventBase & { kind: 'tool'; name: string; input: unknown; resultText?: string; isError?: boolean })
  | (EventBase & { kind: 'cross'; fromName: string; fromMode?: string; text: string })
  | (EventBase & { kind: 'sent'; to: string[]; text: string })
  | (EventBase & { kind: 'system'; text: string; level?: string })
  | (EventBase & { kind: 'divider'; text: string })

export type EventKind = TranscriptEvent['kind']

export interface EventUpdate { id: string; patch: Partial<TranscriptEvent> & { appendText?: string } }

export interface TranscriptMeta {
  permissionMode?: string
  aiTitle?: string
  totalCostUSD?: number
  model?: string
  gitBranch?: string
}

export interface FeedItem {
  id: string
  ts: number
  from: string
  to: string[]
  text: string
  senderSessionId?: string
  receiverSessionIds: string[]
  viaBridge: boolean
}

export type BridgeState =
  | { status: 'connected'; latencyMs?: number; bridgeName: string }
  | { status: 'reconnecting'; attempt: number; max: number }
  | { status: 'unavailable'; reason: string }
  | { status: 'relaying'; targets: string[] }

export interface RelayResult { sent: string[]; failed: { to: string; error: string }[]; latencyMs: number }

export interface Bookmark { sessionId: string; eventId: string; ts: number; preview: string }

export interface Prefs {
  pinned: string[]
  bookmarks: Bookmark[]
  promptHistory: string[]
  window?: { x: number; y: number; width: number; height: number }
  selectedSessionId?: string
}

export interface SearchHit { sessionId: string; sessionName: string; eventId: string; ts: number; snippet: string }

export interface Stats { working: number; waiting: number; idle: number; ended: number; refreshedAt: number }

/** Renderer → main (invoke) */
export const IPC = {
  sessionsList: 'sessions:list',
  transcriptLoad: 'transcript:load',
  transcriptExport: 'transcript:export',
  relaySend: 'relay:send',
  bridgeRetry: 'bridge:retry',
  bridgeState: 'bridge:state',
  feedList: 'feed:list',
  searchQuery: 'search:query',
  prefsGet: 'prefs:get',
  prefsSet: 'prefs:set',
  appOpenLogs: 'app:openLogs',
  appReload: 'app:reload',
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',
} as const

/** Main → renderer (push) */
export const PUSH = {
  sessionUpsert: 'session:upsert',
  sessionRemove: 'session:remove',
  transcriptReset: 'transcript:reset',
  transcriptAppend: 'transcript:append',
  feedUpdate: 'feed:update',
  bridgeState: 'bridge:state',
  statsUpdate: 'stats:update',
} as const

export interface TranscriptResetPayload { sessionId: string; events: TranscriptEvent[]; meta: TranscriptMeta }
export interface TranscriptAppendPayload { sessionId: string; events: TranscriptEvent[]; updates: EventUpdate[]; meta: TranscriptMeta }

export interface CsmApi {
  platform: NodeJS.Platform
  listSessions(): Promise<Session[]>
  loadTranscript(sessionId: string): Promise<TranscriptResetPayload | null>
  exportTranscript(sessionId: string): Promise<{ saved: boolean; path?: string }>
  relay(targets: string[], text: string): Promise<RelayResult>
  bridgeRetry(): Promise<void>
  bridgeState(): Promise<BridgeState>
  listFeed(): Promise<FeedItem[]>
  search(q: string): Promise<SearchHit[]>
  getPrefs(): Promise<Prefs>
  setPrefs(patch: Partial<Prefs>): Promise<Prefs>
  openLogs(): Promise<void>
  reload(): Promise<void>
  windowControl(action: 'minimize' | 'maximize' | 'close'): void
  on<T>(channel: (typeof PUSH)[keyof typeof PUSH], cb: (payload: T) => void): () => void
}

declare global {
  interface Window { csm: CsmApi }
}
```

- [ ] **Step 4: Write paths.ts**

`src/main/paths.ts`:
```ts
import os from 'node:os'
import path from 'node:path'

export function claudeHome(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  return env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR.length > 0 ? env.CLAUDE_CONFIG_DIR : path.join(home, '.claude')
}

export function sessionsDir(root: string = claudeHome()): string {
  return path.join(root, 'sessions')
}

export function projectsDir(root: string = claudeHome()): string {
  return path.join(root, 'projects')
}

/** Claude Code names the per-project transcript folder by replacing every non-alphanumeric char of the cwd with '-'. */
export function projectSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

export function transcriptPath(cwd: string, sessionId: string, root: string = claudeHome()): string {
  return path.join(projectsDir(root), projectSlug(cwd), `${sessionId}.jsonl`)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/paths.test.ts`
Expected: 5 passed.

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/paths.ts tests/paths.test.ts
git commit -m "feat: shared types and claude path resolution"
```

---

### Task 3: Transcript line parser

**Files:**
- Create: `src/main/transcript/parser.ts`, `tests/fixtures/lines.ts`
- Test: `tests/parser.test.ts`

**Interfaces:**
- Consumes: `TranscriptEvent`, `EventUpdate`, `TranscriptMeta` from `@shared/types`.
- Produces: `createParseContext(): ParseContext`; `parseLine(raw: string, ctx: ParseContext): ParseOutput` where `ParseOutput = { events: TranscriptEvent[]; updates: EventUpdate[]; meta: Partial<TranscriptMeta> }`; `parseLines(lines: string[], ctx): ParseOutput` (concatenates); `GAP_MS = 30 * 60_000`.

- [ ] **Step 1: Write synthetic fixture lines (shapes copied from spec §2)**

`tests/fixtures/lines.ts`:
```ts
const S = 'db0dacce-7b5f-4f61-a04e-c8fc48f9aafd'
const CWD = '/Users/dev/acme-api'
const base = { isSidechain: false, userType: 'external', entrypoint: 'cli', cwd: CWD, sessionId: S, version: '2.1.246' }

export const L = {
  userText: JSON.stringify({ ...base, parentUuid: null, type: 'user', uuid: 'u1', timestamp: '2026-08-26T11:04:00.000Z', message: { role: 'user', content: 'Refactor the token store.' } }),
  userTextBlocks: JSON.stringify({ ...base, parentUuid: 'u1', type: 'user', uuid: 'u2', timestamp: '2026-08-26T11:04:05.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Also ' }, { type: 'text', text: 'keep the shim.' }] } }),
  userMeta: JSON.stringify({ ...base, parentUuid: 'u2', type: 'user', uuid: 'u3', isMeta: true, timestamp: '2026-08-26T11:04:06.000Z', message: { role: 'user', content: 'injected context' } }),
  userSystemTag: JSON.stringify({ ...base, parentUuid: 'u3', type: 'user', uuid: 'u4', timestamp: '2026-08-26T11:04:07.000Z', message: { role: 'user', content: '<command-name>/effort</command-name>' } }),
  assistantText: JSON.stringify({ ...base, parentUuid: 'u4', type: 'assistant', uuid: 'a1', timestamp: '2026-08-26T11:05:00.000Z', requestId: 'r1', message: { id: 'msg_1', model: 'claude-sonnet-4-6', role: 'assistant', type: 'message', content: [{ type: 'text', text: "I'll start with the adapter." }], stop_reason: null, usage: { input_tokens: 10, output_tokens: 120 } } }),
  assistantText2: JSON.stringify({ ...base, parentUuid: 'a1', type: 'assistant', uuid: 'a2', timestamp: '2026-08-26T11:05:01.000Z', requestId: 'r1', message: { id: 'msg_1', model: 'claude-sonnet-4-6', role: 'assistant', type: 'message', content: [{ type: 'text', text: ' Then the shim.' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 180 } } }),
  assistantThinking: JSON.stringify({ ...base, parentUuid: 'a2', type: 'assistant', uuid: 'a3', timestamp: '2026-08-26T11:05:02.000Z', message: { id: 'msg_2', model: 'claude-sonnet-4-6', role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }], usage: { output_tokens: 5 } } }),
  assistantTool: JSON.stringify({ ...base, parentUuid: 'a3', type: 'assistant', uuid: 'a4', timestamp: '2026-08-26T11:06:00.000Z', message: { id: 'msg_2', model: 'claude-sonnet-4-6', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } }], usage: { output_tokens: 40 } } }),
  toolResult: JSON.stringify({ ...base, parentUuid: 'a4', type: 'user', uuid: 'u5', timestamp: '2026-08-26T11:06:03.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '12 passed', is_error: false }] } }),
  assistantSend: JSON.stringify({ ...base, parentUuid: 'u5', type: 'assistant', uuid: 'a5', timestamp: '2026-08-26T11:09:00.000Z', message: { id: 'msg_3', model: 'claude-sonnet-4-6', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_2', name: 'SendMessage', input: { to: 'auth-refactor', summary: 'rename', message: 'Heads up — I renamed CacheKey to QueryKey.' } }], usage: { output_tokens: 30 } } }),
  cross: JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-08-26T11:09:30.000Z', sessionId: S, content: '<cross-session-message from="uds:/tmp/cc-socks/42650.sock" hop-chain="80e6" from-name="perf-query-cache" from-mode="bypass">\nHeads up — I renamed CacheKey to QueryKey.\n</cross-session-message>' }),
  dequeue: JSON.stringify({ type: 'queue-operation', operation: 'dequeue', timestamp: '2026-08-26T11:09:31.000Z', sessionId: S }),
  systemLocal: JSON.stringify({ ...base, parentUuid: 'a5', type: 'system', subtype: 'local_command', content: '<command-name>/rename</command-name>', level: 'info', timestamp: '2026-08-26T11:10:00.000Z', uuid: 's1', isMeta: false }),
  systemTurn: JSON.stringify({ ...base, parentUuid: 's1', type: 'system', subtype: 'turn_duration', content: '', timestamp: '2026-08-26T11:10:01.000Z', uuid: 's2' }),
  permissionMode: JSON.stringify({ type: 'permission-mode', permissionMode: 'bypassPermissions', sessionId: S }),
  aiTitle: JSON.stringify({ type: 'ai-title', aiTitle: 'Token store refactor', sessionId: S }),
  costState: JSON.stringify({ type: 'cost-state', sessionId: S, totalCostUSD: 1.25, totalDuration: 1000 }),
  attachment: JSON.stringify({ ...base, parentUuid: null, type: 'attachment', uuid: 'at1', timestamp: '2026-08-26T11:00:00.000Z', attachment: { type: 'hook_success', hookName: 'SessionStart' } }),
  userAfterGap: JSON.stringify({ ...base, parentUuid: 's2', type: 'user', uuid: 'u6', timestamp: '2026-08-26T12:00:00.000Z', message: { role: 'user', content: 'Back.' } }),
  garbage: '{not json',
}
```

- [ ] **Step 2: Write the failing tests (one per mapping row of spec §5.2)**

`tests/parser.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createParseContext, parseLine, parseLines } from '@main/transcript/parser'
import { L } from './fixtures/lines'

const run = (lines: string[]) => parseLines(lines, createParseContext())
const kinds = (lines: string[]) => run(lines).events.map((e) => e.kind)

describe('parseLine', () => {
  it('emits a divider then a user event for the first typed prompt', () => {
    const out = run([L.userText])
    expect(out.events.map((e) => e.kind)).toEqual(['divider', 'user'])
    expect(out.events[0]).toMatchObject({ kind: 'divider', text: 'session started 11:04' })
    expect(out.events[1]).toMatchObject({ kind: 'user', id: 'u1', text: 'Refactor the token store.', ts: Date.parse('2026-08-26T11:04:00.000Z') })
  })
  it('concatenates text blocks of an array-content user message', () => {
    const out = run([L.userText, L.userTextBlocks])
    expect(out.events[2]).toMatchObject({ kind: 'user', text: 'Also keep the shim.' })
  })
  it('drops meta user entries and system-tag prompts', () => {
    expect(kinds([L.userText, L.userMeta, L.userSystemTag])).toEqual(['divider', 'user'])
  })
  it('emits claude text and merges continuation blocks of the same message id as an update', () => {
    const out = run([L.userText, L.assistantText, L.assistantText2])
    const claude = out.events.filter((e) => e.kind === 'claude')
    expect(claude).toHaveLength(1)
    expect(claude[0]).toMatchObject({ id: 'a1', text: "I'll start with the adapter.", model: 'claude-sonnet-4-6', outputTokens: 120, messageId: 'msg_1' })
    expect(out.updates).toContainEqual({ id: 'a1', patch: { appendText: ' Then the shim.', outputTokens: 180 } })
    expect(out.meta.model).toBe('claude-sonnet-4-6')
  })
  it('drops thinking blocks', () => {
    expect(kinds([L.userText, L.assistantThinking])).toEqual(['divider', 'user'])
  })
  it('emits a tool event and attaches its result as an update', () => {
    const out = run([L.userText, L.assistantTool, L.toolResult])
    expect(out.events.at(-1)).toMatchObject({ kind: 'tool', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } })
    expect(out.updates).toContainEqual({ id: 'toolu_1', patch: { resultText: '12 passed', isError: false } })
  })
  it('maps SendMessage tool_use to a sent event', () => {
    const out = run([L.userText, L.assistantSend])
    expect(out.events.at(-1)).toMatchObject({ kind: 'sent', to: ['auth-refactor'], text: 'Heads up — I renamed CacheKey to QueryKey.' })
  })
  it('parses an enqueued cross-session message', () => {
    const out = run([L.cross])
    expect(out.events).toHaveLength(1)
    expect(out.events[0]).toMatchObject({ kind: 'cross', fromName: 'perf-query-cache', fromMode: 'bypass', text: 'Heads up — I renamed CacheKey to QueryKey.', ts: Date.parse('2026-08-26T11:09:30.000Z') })
  })
  it('ignores dequeue operations', () => {
    expect(run([L.dequeue]).events).toEqual([])
  })
  it('keeps local_command system rows and drops other system subtypes', () => {
    const out = run([L.userText, L.systemLocal, L.systemTurn])
    expect(out.events.at(-1)).toMatchObject({ kind: 'system', text: '<command-name>/rename</command-name>', level: 'info' })
    expect(out.events).toHaveLength(3)
  })
  it('extracts meta from permission-mode, ai-title, cost-state', () => {
    const out = run([L.permissionMode, L.aiTitle, L.costState])
    expect(out.events).toEqual([])
    expect(out.meta).toEqual({ permissionMode: 'bypassPermissions', aiTitle: 'Token store refactor', totalCostUSD: 1.25 })
  })
  it('ignores attachments and malformed lines', () => {
    expect(run([L.attachment, L.garbage, '']).events).toEqual([])
  })
  it('inserts a "resumed" divider after a gap over 30 minutes', () => {
    const out = run([L.userText, L.userAfterGap])
    expect(out.events.map((e) => e.kind)).toEqual(['divider', 'user', 'divider', 'user'])
    expect(out.events[2]).toMatchObject({ text: 'session resumed 12:00' })
  })
  it('parseLine on a single line returns the same shape', () => {
    const ctx = createParseContext()
    const out = parseLine(L.userText, ctx)
    expect(out.events).toHaveLength(2)
    expect(ctx.sawFirst).toBe(true)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/parser.test.ts`
Expected: FAIL — `Cannot find module '@main/transcript/parser'`.

- [ ] **Step 4: Write the parser**

`src/main/transcript/parser.ts`:
```ts
import type { EventUpdate, TranscriptEvent, TranscriptMeta } from '@shared/types'

export const GAP_MS = 30 * 60_000

export interface ParseContext {
  sawFirst: boolean
  lastTs?: number
  /** claude text event id for the assistant message id currently being streamed */
  claudeEventByMsg: Map<string, string>
}

export interface ParseOutput {
  events: TranscriptEvent[]
  updates: EventUpdate[]
  meta: Partial<TranscriptMeta>
}

export function createParseContext(): ParseContext {
  return { sawFirst: false, claudeEventByMsg: new Map() }
}

const CROSS_RE = /<cross-session-message\b([^>]*)>\n?([\s\S]*?)\n?<\/cross-session-message>/
const attr = (attrs: string, name: string): string | undefined => new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1]

function hhmm(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

function divider(ctx: ParseContext, ts: number, out: ParseOutput): void {
  if (!ctx.sawFirst) {
    out.events.push({ kind: 'divider', id: `div-${ts}`, ts, text: `session started ${hhmm(ts)}` })
    ctx.sawFirst = true
  } else if (ctx.lastTs !== undefined && ts - ctx.lastTs > GAP_MS) {
    out.events.push({ kind: 'divider', id: `div-${ts}`, ts, text: `session resumed ${hhmm(ts)}` })
  }
  ctx.lastTs = ts
}

function textOfBlocks(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('')
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((b) => (typeof b === 'string' ? b : b?.text ?? '')).join('\n')
  return ''
}

export function parseLine(raw: string, ctx: ParseContext): ParseOutput {
  const out: ParseOutput = { events: [], updates: [], meta: {} }
  if (!raw.trim()) return out
  let d: any
  try { d = JSON.parse(raw) } catch { return out }
  if (!d || typeof d !== 'object') return out

  switch (d.type) {
    case 'user': {
      const c = d.message?.content
      if (Array.isArray(c)) {
        for (const b of c) {
          if (b?.type === 'tool_result') {
            out.updates.push({ id: String(b.tool_use_id), patch: { resultText: resultText(b.content), isError: Boolean(b.is_error) } })
          }
        }
        if (c.some((b: any) => b?.type === 'tool_result')) return out
      }
      if (d.isMeta) return out
      const text = textOfBlocks(c).trim()
      if (!text || text.startsWith('<')) return out
      const ts = Date.parse(d.timestamp)
      divider(ctx, ts, out)
      out.events.push({ kind: 'user', id: String(d.uuid), ts, text })
      return out
    }
    case 'assistant': {
      const m = d.message ?? {}
      const ts = Date.parse(d.timestamp)
      const blocks: any[] = Array.isArray(m.content) ? m.content : []
      if (typeof m.model === 'string') out.meta.model = m.model
      const outputTokens: number | undefined = typeof m.usage?.output_tokens === 'number' ? m.usage.output_tokens : undefined
      for (const b of blocks) {
        if (b?.type === 'text') {
          const existing = m.id ? ctx.claudeEventByMsg.get(m.id) : undefined
          if (existing) {
            out.updates.push({ id: existing, patch: { appendText: b.text, outputTokens } })
          } else {
            divider(ctx, ts, out)
            const id = String(d.uuid)
            out.events.push({ kind: 'claude', id, ts, text: b.text, model: m.model, outputTokens, messageId: m.id })
            if (m.id) ctx.claudeEventByMsg.set(m.id, id)
          }
        } else if (b?.type === 'tool_use') {
          divider(ctx, ts, out)
          if (b.name === 'SendMessage') {
            const to = typeof b.input?.to === 'string' ? [b.input.to] : []
            out.events.push({ kind: 'sent', id: String(b.id), ts, to, text: String(b.input?.message ?? '') })
          } else {
            out.events.push({ kind: 'tool', id: String(b.id), ts, name: String(b.name), input: b.input })
          }
        }
        // thinking and anything else: dropped
      }
      return out
    }
    case 'queue-operation': {
      if (d.operation !== 'enqueue' || typeof d.content !== 'string') return out
      const m = CROSS_RE.exec(d.content)
      if (!m) return out
      const ts = Date.parse(d.timestamp)
      out.events.push({ kind: 'cross', id: `x-${ts}-${out.events.length}`, ts, fromName: attr(m[1]!, 'from-name') ?? 'unknown', fromMode: attr(m[1]!, 'from-mode'), text: m[2]!.trim() })
      return out
    }
    case 'system': {
      if (d.subtype !== 'local_command') return out
      const ts = Date.parse(d.timestamp)
      out.events.push({ kind: 'system', id: String(d.uuid ?? `sys-${ts}`), ts, text: String(d.content ?? ''), level: d.level })
      return out
    }
    case 'permission-mode':
      if (typeof d.permissionMode === 'string') out.meta.permissionMode = d.permissionMode
      return out
    case 'ai-title':
      if (typeof d.aiTitle === 'string') out.meta.aiTitle = d.aiTitle
      return out
    case 'cost-state':
      if (typeof d.totalCostUSD === 'number') out.meta.totalCostUSD = d.totalCostUSD
      return out
    default:
      return out
  }
}

export function parseLines(lines: string[], ctx: ParseContext): ParseOutput {
  const out: ParseOutput = { events: [], updates: [], meta: {} }
  for (const line of lines) {
    const r = parseLine(line, ctx)
    out.events.push(...r.events)
    out.updates.push(...r.updates)
    Object.assign(out.meta, r.meta)
  }
  return out
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/parser.test.ts`
Expected: 14 passed. If the "merges continuation blocks" test fails on `outputTokens`, check that the update patch includes `outputTokens` even when undefined is not serialized — `toContainEqual` compares `{ appendText, outputTokens: 180 }` exactly; the fixture's second block has `output_tokens: 180`.

- [ ] **Step 6: Commit**

```bash
git add src/main/transcript/parser.ts tests/parser.test.ts tests/fixtures/lines.ts
git commit -m "feat: transcript JSONL line parser"
```

---

### Task 4: Transcript locate + tailer

**Files:**
- Create: `src/main/transcript/locate.ts`, `src/main/transcript/tailer.ts`
- Test: `tests/tailer.test.ts`

**Interfaces:**
- Consumes: `parseLines`, `createParseContext` (Task 3); `transcriptPath`, `projectsDir` (Task 2).
- Produces: `findTranscript(sessionId, cwd, projectsRoot): Promise<string | null>`; `class TranscriptTailer extends EventEmitter` with `constructor(sessionId: string, filePath: string, opts?: { pollMs?: number })`, `start(): Promise<void>`, `stop(): void`, events `'reset'` `(payload: { events, meta })`, `'append'` `(payload: { events, updates, meta })`, `'error'` `(err)`.

- [ ] **Step 1: Write the failing tests**

`tests/tailer.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TranscriptTailer } from '@main/transcript/tailer'
import { findTranscript } from '@main/transcript/locate'
import { L } from './fixtures/lines'

const waitFor = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now()
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)) }
}

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'csm-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

describe('findTranscript', () => {
  it('finds the file at the slug path', async () => {
    const p = path.join(dir, '-a-b', 'sid.jsonl')
    await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, '')
    expect(await findTranscript('sid', '/a/b', dir)).toBe(p)
  })
  it('falls back to scanning all project folders', async () => {
    const p = path.join(dir, '-other', 'sid2.jsonl')
    await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, '')
    expect(await findTranscript('sid2', '/a/b', dir)).toBe(p)
  })
  it('returns null when absent', async () => {
    expect(await findTranscript('nope', '/a/b', dir)).toBeNull()
  })
})

describe('TranscriptTailer', () => {
  it('emits reset with the existing content, then append for new lines, buffering partial lines', async () => {
    const file = path.join(dir, 't.jsonl')
    await fs.writeFile(file, L.userText + '\n' + L.permissionMode + '\n')
    const tailer = new TranscriptTailer('sid', file, { pollMs: 30 })
    const resets: any[] = []; const appends: any[] = []
    tailer.on('reset', (p) => resets.push(p)); tailer.on('append', (p) => appends.push(p))
    await tailer.start()
    expect(resets).toHaveLength(1)
    expect(resets[0].events.map((e: any) => e.kind)).toEqual(['divider', 'user'])
    expect(resets[0].meta.permissionMode).toBe('bypassPermissions')

    const half = L.assistantText.slice(0, 40)
    await fs.appendFile(file, half)
    await new Promise((r) => setTimeout(r, 120))
    expect(appends).toHaveLength(0)
    await fs.appendFile(file, L.assistantText.slice(40) + '\n')
    await waitFor(() => appends.length === 1)
    expect(appends[0].events[0]).toMatchObject({ kind: 'claude', id: 'a1' })
    expect(appends[0].meta.model).toBe('claude-sonnet-4-6')

    await fs.appendFile(file, L.toolResult + '\n')
    await waitFor(() => appends.length === 2)
    expect(appends[1].updates[0]).toMatchObject({ id: 'toolu_1' })
    tailer.stop()
  })
  it('re-reads from scratch when the file is truncated', async () => {
    const file = path.join(dir, 't.jsonl')
    await fs.writeFile(file, L.userText + '\n')
    const tailer = new TranscriptTailer('sid', file, { pollMs: 30 })
    const resets: any[] = []
    tailer.on('reset', (p) => resets.push(p))
    await tailer.start()
    await fs.writeFile(file, L.cross + '\n')
    await waitFor(() => resets.length === 2)
    expect(resets[1].events[0].kind).toBe('cross')
    tailer.stop()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tailer.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write locate.ts**

`src/main/transcript/locate.ts`:
```ts
import fs from 'node:fs/promises'
import path from 'node:path'
import { projectSlug } from '@main/paths'

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}

/** `~/.claude/projects/<slug(cwd)>/<sessionId>.jsonl`, else scan every project folder for `<sessionId>.jsonl`. */
export async function findTranscript(sessionId: string, cwd: string, projectsRoot: string): Promise<string | null> {
  const direct = path.join(projectsRoot, projectSlug(cwd), `${sessionId}.jsonl`)
  if (await exists(direct)) return direct
  let dirs: string[] = []
  try { dirs = await fs.readdir(projectsRoot) } catch { return null }
  for (const d of dirs) {
    const candidate = path.join(projectsRoot, d, `${sessionId}.jsonl`)
    if (await exists(candidate)) return candidate
  }
  return null
}
```

- [ ] **Step 4: Write tailer.ts**

`src/main/transcript/tailer.ts`:
```ts
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { createParseContext, parseLines, type ParseContext, type ParseOutput } from './parser'
import type { TranscriptMeta } from '@shared/types'

export interface TailerOptions { pollMs?: number }

/**
 * Reads a JSONL transcript incrementally. Emits:
 *  - 'reset'  { events, meta }            after start() and whenever the file shrinks
 *  - 'append' { events, updates, meta }   for newly completed lines
 *  - 'error'  err
 */
export class TranscriptTailer extends EventEmitter {
  private offset = 0
  private partial = ''
  private ctx: ParseContext = createParseContext()
  private meta: TranscriptMeta = {}
  private timer?: NodeJS.Timeout
  private watcher?: fs.FSWatcher
  private reading = false
  private dirty = false
  private readonly pollMs: number

  constructor(readonly sessionId: string, readonly filePath: string, opts: TailerOptions = {}) {
    super()
    this.pollMs = opts.pollMs ?? 1000
  }

  get currentMeta(): TranscriptMeta { return { ...this.meta } }

  async start(): Promise<void> {
    await this.reset()
    try {
      this.watcher = fs.watch(this.filePath, () => void this.readNew())
      this.watcher.on('error', () => { /* fall back to polling */ })
    } catch { /* polling only */ }
    this.timer = setInterval(() => void this.readNew(), this.pollMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.watcher?.close()
    this.timer = undefined; this.watcher = undefined
  }

  private async reset(): Promise<void> {
    this.ctx = createParseContext(); this.meta = {}; this.partial = ''
    const content = await fsp.readFile(this.filePath, 'utf8')
    const { lines, rest } = splitLines(content)
    this.partial = rest
    this.offset = Buffer.byteLength(content, 'utf8')
    const out = parseLines(lines, this.ctx)
    Object.assign(this.meta, out.meta)
    this.emit('reset', { events: out.events, meta: { ...this.meta } })
  }

  private async readNew(): Promise<void> {
    if (this.reading) { this.dirty = true; return }
    this.reading = true
    try {
      let st: fs.Stats
      try { st = await fsp.stat(this.filePath) } catch { return }
      if (st.size < this.offset) { await this.reset(); return }
      if (st.size === this.offset) return
      const fh = await fsp.open(this.filePath, 'r')
      try {
        const len = st.size - this.offset
        const buf = Buffer.alloc(len)
        await fh.read(buf, 0, len, this.offset)
        this.offset = st.size
        const { lines, rest } = splitLines(this.partial + buf.toString('utf8'))
        this.partial = rest
        if (lines.length === 0) return
        const out: ParseOutput = parseLines(lines, this.ctx)
        Object.assign(this.meta, out.meta)
        if (out.events.length || out.updates.length || Object.keys(out.meta).length) {
          this.emit('append', { events: out.events, updates: out.updates, meta: { ...this.meta } })
        }
      } finally { await fh.close() }
    } catch (err) {
      this.emit('error', err)
    } finally {
      this.reading = false
      if (this.dirty) { this.dirty = false; void this.readNew() }
    }
  }
}

/** Splits on '\n'; the trailing fragment without a newline is returned as `rest`. */
export function splitLines(text: string): { lines: string[]; rest: string } {
  const parts = text.split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts.filter((l) => l.length > 0), rest }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/tailer.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add src/main/transcript/locate.ts src/main/transcript/tailer.ts tests/tailer.test.ts
git commit -m "feat: transcript locator and incremental tailer"
```

---

### Task 5: Registry watcher

**Files:**
- Create: `src/main/registry.ts`
- Test: `tests/registry.test.ts`, `tests/fixtures/sessions.ts`

**Interfaces:**
- Consumes: `RegistryEntry` (Task 2).
- Produces: `class RegistryWatcher extends EventEmitter` — `constructor(dir: string, opts?: { isAlive?: (pid: number) => boolean; tickMs?: number; usePolling?: boolean })`, `start(): Promise<void>`, `stop(): Promise<void>`, `list(): { entry: RegistryEntry; alive: boolean }[]`, events `'upsert'` `({ entry, alive })`, `'remove'` `(pid)`; `isPidAlive(pid): boolean`; `parseRegistryFile(json: string): RegistryEntry | null`.

- [ ] **Step 1: Write fixture + failing tests**

`tests/fixtures/sessions.ts`:
```ts
export const reg = (over: Partial<Record<string, unknown>> = {}) => JSON.stringify({
  pid: 73708, sessionId: 'db0dacce-7b5f-4f61-a04e-c8fc48f9aafd', cwd: '/Users/dev/acme-api', startedAt: 1787744330752,
  procStart: 'Wed Aug 26 11:38:49 2026', version: '2.1.246', peerProtocol: 1, peerFeatures: ['notify_idle'], kind: 'interactive',
  entrypoint: 'cli', pidDomain: 'darwin', messagingSocketPath: '/tmp/cc-socks/73708.sock', name: 'maydon-api-2b', nameSource: 'derived',
  nameSince: 1787744330752, status: 'busy', updatedAt: 1787749581039, statusUpdatedAt: 1787749581039, ...over,
})
```

`tests/registry.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { RegistryWatcher, parseRegistryFile } from '@main/registry'
import { reg } from './fixtures/sessions'

const waitFor = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now()
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 25)) }
}

let dir: string; let w: RegistryWatcher | undefined
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'csm-reg-')) })
afterEach(async () => { await w?.stop(); await fs.rm(dir, { recursive: true, force: true }) })

describe('parseRegistryFile', () => {
  it('extracts the fields the app needs', () => {
    expect(parseRegistryFile(reg())).toMatchObject({ pid: 73708, name: 'maydon-api-2b', status: 'busy', cwd: '/Users/dev/acme-api', kind: 'interactive' })
  })
  it('returns null for invalid json or missing pid', () => {
    expect(parseRegistryFile('{')).toBeNull()
    expect(parseRegistryFile('{"name":"x"}')).toBeNull()
  })
})

describe('RegistryWatcher', () => {
  it('lists existing entries on start, ignores .key files, and reports liveness', async () => {
    await fs.writeFile(path.join(dir, '1.json'), reg({ pid: 1, name: 'one' }))
    await fs.writeFile(path.join(dir, '2.json'), reg({ pid: 2, name: 'two' }))
    await fs.writeFile(path.join(dir, '2.abc.key'), 'secret')
    w = new RegistryWatcher(dir, { isAlive: (pid) => pid === 1, tickMs: 50, usePolling: true })
    await w.start()
    const list = w.list().sort((a, b) => a.entry.pid - b.entry.pid)
    expect(list.map((x) => [x.entry.name, x.alive])).toEqual([['one', true], ['two', false]])
  })
  it('emits upsert on add/change and remove on unlink', async () => {
    w = new RegistryWatcher(dir, { isAlive: () => true, tickMs: 50, usePolling: true })
    const ups: any[] = []; const rms: number[] = []
    w.on('upsert', (p) => ups.push(p)); w.on('remove', (pid) => rms.push(pid))
    await w.start()
    await fs.writeFile(path.join(dir, '5.json'), reg({ pid: 5, name: 'five', status: 'idle' }))
    await waitFor(() => ups.some((u) => u.entry.pid === 5))
    await fs.writeFile(path.join(dir, '5.json'), reg({ pid: 5, name: 'five', status: 'busy' }))
    await waitFor(() => ups.some((u) => u.entry.pid === 5 && u.entry.status === 'busy'))
    await fs.unlink(path.join(dir, '5.json'))
    await waitFor(() => rms.includes(5))
    expect(w.list().find((x) => x.entry.pid === 5)).toBeUndefined()
  })
  it('flips alive to false on a tick when the pid dies', async () => {
    let alive = true
    await fs.writeFile(path.join(dir, '9.json'), reg({ pid: 9, name: 'nine' }))
    w = new RegistryWatcher(dir, { isAlive: () => alive, tickMs: 30, usePolling: true })
    const ups: any[] = []; w.on('upsert', (p) => ups.push(p))
    await w.start()
    alive = false
    await waitFor(() => ups.some((u) => u.entry.pid === 9 && u.alive === false))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write registry.ts**

`src/main/registry.ts`:
```ts
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { RegistryEntry } from '@shared/types'

export interface RegistryOptions {
  isAlive?: (pid: number) => boolean
  tickMs?: number
  usePolling?: boolean
}

export function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (e: any) { return e?.code === 'EPERM' }
}

export function parseRegistryFile(json: string): RegistryEntry | null {
  let d: any
  try { d = JSON.parse(json) } catch { return null }
  if (!d || typeof d.pid !== 'number' || typeof d.sessionId !== 'string') return null
  return {
    pid: d.pid,
    sessionId: d.sessionId,
    cwd: String(d.cwd ?? ''),
    startedAt: Number(d.startedAt ?? 0),
    version: String(d.version ?? ''),
    kind: String(d.kind ?? 'interactive'),
    entrypoint: String(d.entrypoint ?? 'cli'),
    name: String(d.name ?? `pid-${d.pid}`),
    nameSource: typeof d.nameSource === 'string' ? d.nameSource : undefined,
    status: d.status === 'busy' ? 'busy' : 'idle',
    updatedAt: Number(d.updatedAt ?? 0),
    messagingSocketPath: typeof d.messagingSocketPath === 'string' ? d.messagingSocketPath : undefined,
  }
}

export class RegistryWatcher extends EventEmitter {
  private entries = new Map<number, { entry: RegistryEntry; alive: boolean }>()
  private watcher?: FSWatcher
  private timer?: NodeJS.Timeout
  private readonly isAlive: (pid: number) => boolean
  private readonly tickMs: number
  private readonly usePolling: boolean

  constructor(readonly dir: string, opts: RegistryOptions = {}) {
    super()
    this.isAlive = opts.isAlive ?? isPidAlive
    this.tickMs = opts.tickMs ?? 5000
    this.usePolling = opts.usePolling ?? false
  }

  list(): { entry: RegistryEntry; alive: boolean }[] { return [...this.entries.values()] }

  async start(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    for (const f of await fs.readdir(this.dir)) if (f.endsWith('.json')) await this.load(path.join(this.dir, f))
    this.watcher = chokidar.watch(this.dir, {
      ignoreInitial: true, depth: 0, usePolling: this.usePolling, interval: 50,
      ignored: (p) => p !== this.dir && !p.endsWith('.json'),
    })
    this.watcher.on('add', (p) => void this.load(p)).on('change', (p) => void this.load(p)).on('unlink', (p) => this.remove(p))
    this.timer = setInterval(() => this.tick(), this.tickMs)
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    await this.watcher?.close()
    this.timer = undefined; this.watcher = undefined
  }

  private async load(file: string, attempt = 0): Promise<void> {
    let text: string
    try { text = await fs.readFile(file, 'utf8') } catch { return }
    const entry = parseRegistryFile(text)
    if (!entry) {
      if (attempt < 3) { await new Promise((r) => setTimeout(r, 100)); return this.load(file, attempt + 1) }
      return
    }
    const alive = this.isAlive(entry.pid)
    this.entries.set(entry.pid, { entry, alive })
    this.emit('upsert', { entry, alive })
  }

  private remove(file: string): void {
    const pid = Number(path.basename(file, '.json'))
    if (!Number.isFinite(pid)) return
    if (this.entries.delete(pid)) this.emit('remove', pid)
  }

  private tick(): void {
    for (const rec of this.entries.values()) {
      const alive = this.isAlive(rec.entry.pid)
      if (alive !== rec.alive) { rec.alive = alive; this.emit('upsert', { entry: rec.entry, alive }) }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/registry.test.ts`
Expected: 5 passed. (If the unlink test is flaky on macOS with `usePolling: true`, raise `waitFor` to 6000 ms — chokidar polling interval is 50 ms so it should settle well within that.)

- [ ] **Step 5: Commit**

```bash
git add src/main/registry.ts tests/registry.test.ts tests/fixtures/sessions.ts
git commit -m "feat: session registry watcher with pid liveness"
```

---

### Task 6: State derivation and SessionStore

**Files:**
- Create: `src/main/state.ts`, `src/main/store.ts`
- Test: `tests/state.test.ts`, `tests/store.test.ts`

**Interfaces:**
- Consumes: `RegistryWatcher` (Task 5), `TranscriptTailer`, `findTranscript` (Task 4), types (Task 2).
- Produces: `WAITING_MS = 20_000`; `deriveState({ alive, registryStatus, lastEvent, now }): SessionState`; `lastActivity(events): { ts, preview }`; `class SessionStore extends EventEmitter` — `constructor(opts: StoreOptions)`, `start(): Promise<void>`, `stop(): Promise<void>`, `sessions(): Session[]`, `session(id): Session | undefined`, `transcript(id): { events: TranscriptEvent[]; meta: TranscriptMeta } | undefined`, `setPinned(ids: string[])`, `recompute(): void`, `stats(): Stats`; events `'session'` `(Session)`, `'removed'` `(sessionId)`, `'transcript:reset'` `(TranscriptResetPayload)`, `'transcript:append'` `(TranscriptAppendPayload)`, `'stats'` `(Stats)`. `StoreOptions = { registry: RegistryWatcher; projectsRoot: string; excludeNames?: string[]; isExcludedPid?: (pid: number) => boolean; now?: () => number; tailerPollMs?: number; tickMs?: number }`.
- Also exports `applyUpdates(events: TranscriptEvent[], updates: EventUpdate[]): void` (mutates in place; shared with the renderer store logic in Task 11 via `@shared`? No — renderer re-implements the 6-line equivalent to keep main code Electron-free and renderer code Node-free).

- [ ] **Step 1: Write the failing state tests**

`tests/state.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { deriveState, lastActivity, WAITING_MS } from '@main/state'
import type { TranscriptEvent } from '@shared/types'

const t0 = 1_000_000
const tool = (ts: number, done = false): TranscriptEvent => ({ kind: 'tool', id: 't', ts, name: 'Bash', input: {}, ...(done ? { resultText: 'ok' } : {}) })

describe('deriveState', () => {
  it('ended when not alive regardless of status', () => {
    expect(deriveState({ alive: false, registryStatus: 'busy', now: t0 })).toBe('ended')
  })
  it('idle when registry says idle', () => {
    expect(deriveState({ alive: true, registryStatus: 'idle', now: t0 })).toBe('idle')
  })
  it('working when busy and no dangling tool', () => {
    expect(deriveState({ alive: true, registryStatus: 'busy', now: t0, lastEvent: { kind: 'claude', id: 'c', ts: t0, text: 'hi' } })).toBe('working')
    expect(deriveState({ alive: true, registryStatus: 'busy', now: t0, lastEvent: tool(t0 - WAITING_MS - 1, true) })).toBe('working')
  })
  it('waiting when busy and a tool has no result for over 20s', () => {
    expect(deriveState({ alive: true, registryStatus: 'busy', now: t0, lastEvent: tool(t0 - WAITING_MS - 1) })).toBe('waiting')
    expect(deriveState({ alive: true, registryStatus: 'busy', now: t0, lastEvent: tool(t0 - 1000) })).toBe('working')
  })
})

describe('lastActivity', () => {
  it('uses the last user/claude/tool event and truncates to 60 chars', () => {
    const long = 'x'.repeat(100)
    const r = lastActivity([
      { kind: 'divider', id: 'd', ts: 1, text: 'started' },
      { kind: 'claude', id: 'c', ts: 2, text: long },
      { kind: 'divider', id: 'd2', ts: 3, text: 'resumed' },
    ])
    expect(r.ts).toBe(2)
    expect(r.preview).toBe('x'.repeat(59) + '…')
  })
  it('summarizes tool events by name', () => {
    expect(lastActivity([{ kind: 'tool', id: 't', ts: 5, name: 'Bash', input: { command: 'npm test' } }]).preview).toBe('Bash: npm test')
  })
  it('returns zero when empty', () => {
    expect(lastActivity([])).toEqual({ ts: 0, preview: '' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write state.ts**

`src/main/state.ts`:
```ts
import type { RegistryStatus, SessionState, TranscriptEvent } from '@shared/types'

export const WAITING_MS = 20_000

export function deriveState(input: { alive: boolean; registryStatus: RegistryStatus; lastEvent?: TranscriptEvent; now: number }): SessionState {
  if (!input.alive) return 'ended'
  if (input.registryStatus === 'idle') return 'idle'
  const e = input.lastEvent
  if (e && e.kind === 'tool' && e.resultText === undefined && input.now - e.ts > WAITING_MS) return 'waiting'
  return 'working'
}

export function toolSummary(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  const arg = i.command ?? i.file_path ?? i.pattern ?? i.query ?? i.to ?? i.url ?? ''
  return arg ? `${name}: ${String(arg)}` : name
}

export function lastActivity(events: TranscriptEvent[]): { ts: number; preview: string } {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    let text: string | undefined
    if (e.kind === 'user' || e.kind === 'claude' || e.kind === 'cross') text = e.text
    else if (e.kind === 'tool') text = toolSummary(e.name, e.input)
    else if (e.kind === 'sent') text = `→ ${e.to.join(', ')}: ${e.text}`
    if (text !== undefined) {
      const one = text.replace(/\s+/g, ' ').trim()
      return { ts: e.ts, preview: one.length > 60 ? one.slice(0, 59) + '…' : one }
    }
  }
  return { ts: 0, preview: '' }
}
```

- [ ] **Step 4: Run state tests**

Run: `npx vitest run tests/state.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Write the failing store tests**

`tests/store.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionStore, applyUpdates } from '@main/store'
import type { RegistryEntry, TranscriptEvent } from '@shared/types'
import { L } from './fixtures/lines'

const waitFor = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now()
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)) }
}

class FakeRegistry extends EventEmitter {
  rows: { entry: RegistryEntry; alive: boolean }[] = []
  list() { return this.rows }
  async start() {}
  async stop() {}
  upsert(entry: RegistryEntry, alive = true) {
    this.rows = this.rows.filter((r) => r.entry.pid !== entry.pid).concat({ entry, alive })
    this.emit('upsert', { entry, alive })
  }
  remove(pid: number) { this.rows = this.rows.filter((r) => r.entry.pid !== pid); this.emit('remove', pid) }
}

const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  pid: 1, sessionId: 'db0dacce-7b5f-4f61-a04e-c8fc48f9aafd', cwd: '/Users/dev/acme-api', startedAt: 1, version: '2.1.246',
  kind: 'interactive', entrypoint: 'cli', name: 'auth-refactor', status: 'busy', updatedAt: 1, ...over,
})

let dir: string; let store: SessionStore; let registry: FakeRegistry
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'csm-store-'))
  await fs.mkdir(path.join(dir, '-Users-dev-acme-api'), { recursive: true })
  registry = new FakeRegistry()
})
afterEach(async () => { await store?.stop(); await fs.rm(dir, { recursive: true, force: true }) })

describe('applyUpdates', () => {
  it('appends text and patches fields by id', () => {
    const events: TranscriptEvent[] = [{ kind: 'claude', id: 'a', ts: 1, text: 'Hi' }, { kind: 'tool', id: 't', ts: 2, name: 'Bash', input: {} }]
    applyUpdates(events, [{ id: 'a', patch: { appendText: ' there', outputTokens: 9 } }, { id: 't', patch: { resultText: 'ok', isError: false } }])
    expect(events[0]).toMatchObject({ text: 'Hi there', outputTokens: 9 })
    expect(events[1]).toMatchObject({ resultText: 'ok', isError: false })
  })
})

describe('SessionStore', () => {
  it('builds a Session from a registry entry and its transcript, and updates on append', async () => {
    const file = path.join(dir, '-Users-dev-acme-api', 'db0dacce-7b5f-4f61-a04e-c8fc48f9aafd.jsonl')
    await fs.writeFile(file, [L.userText, L.permissionMode, L.aiTitle, L.assistantText].join('\n') + '\n')
    store = new SessionStore({ registry: registry as any, projectsRoot: dir, tailerPollMs: 30, tickMs: 30 })
    const resets: any[] = []; const appends: any[] = []
    store.on('transcript:reset', (p) => resets.push(p)); store.on('transcript:append', (p) => appends.push(p))
    await store.start()
    registry.upsert(entry())
    await waitFor(() => resets.length === 1)
    const s = store.session('db0dacce-7b5f-4f61-a04e-c8fc48f9aafd')!
    expect(s).toMatchObject({ name: 'auth-refactor', state: 'working', permissionMode: 'bypassPermissions', aiTitle: 'Token store refactor', model: 'claude-sonnet-4-6', transcriptPath: file, turnOutputTokens: 120 })
    expect(s.lastActivityPreview).toBe("I'll start with the adapter.")

    await fs.appendFile(file, L.assistantTool + '\n')
    await waitFor(() => appends.length === 1)
    expect(store.session(s.sessionId)!.lastActivityPreview).toBe('Bash: npm test')
    expect(store.transcript(s.sessionId)!.events.at(-1)).toMatchObject({ kind: 'tool', name: 'Bash' })
  })
  it('marks ended on registry remove and keeps the record; excludes bridge by name', async () => {
    store = new SessionStore({ registry: registry as any, projectsRoot: dir, excludeNames: ['csm-bridge'], tickMs: 30 })
    const seen: any[] = []; store.on('session', (s) => seen.push(s))
    await store.start()
    registry.upsert(entry({ pid: 2, sessionId: 'other', name: 'csm-bridge' }))
    registry.upsert(entry({ pid: 3, sessionId: 'x3', name: 'three', status: 'idle' }))
    await waitFor(() => seen.some((s) => s.sessionId === 'x3'))
    expect(store.sessions().map((s) => s.name)).toEqual(['three'])
    registry.remove(3)
    await waitFor(() => store.session('x3')?.state === 'ended')
    expect(store.stats()).toMatchObject({ working: 0, idle: 0, waiting: 0, ended: 1 })
  })
  it('derives waiting after a dangling tool call and applies pins', async () => {
    let now = 10_000_000
    const file = path.join(dir, '-Users-dev-acme-api', 'db0dacce-7b5f-4f61-a04e-c8fc48f9aafd.jsonl')
    const toolAt = (iso: string) => L.assistantTool.replace('2026-08-26T11:06:00.000Z', iso)
    await fs.writeFile(file, L.userText + '\n' + toolAt(new Date(now - 30_000).toISOString()) + '\n')
    store = new SessionStore({ registry: registry as any, projectsRoot: dir, now: () => now, tickMs: 20 })
    await store.start()
    registry.upsert(entry())
    await waitFor(() => store.session('db0dacce-7b5f-4f61-a04e-c8fc48f9aafd')?.state === 'waiting')
    store.setPinned(['db0dacce-7b5f-4f61-a04e-c8fc48f9aafd'])
    expect(store.session('db0dacce-7b5f-4f61-a04e-c8fc48f9aafd')!.pinned).toBe(true)
  })
})
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run tests/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Write store.ts**

`src/main/store.ts`:
```ts
import { EventEmitter } from 'node:events'
import type { EventUpdate, RegistryEntry, Session, Stats, TranscriptAppendPayload, TranscriptEvent, TranscriptMeta, TranscriptResetPayload } from '@shared/types'
import type { RegistryWatcher } from './registry'
import { TranscriptTailer } from './transcript/tailer'
import { findTranscript } from './transcript/locate'
import { deriveState, lastActivity } from './state'

export interface StoreOptions {
  registry: RegistryWatcher
  projectsRoot: string
  excludeNames?: string[]
  isExcludedPid?: (pid: number) => boolean
  now?: () => number
  tailerPollMs?: number
  tickMs?: number
}

export function applyUpdates(events: TranscriptEvent[], updates: EventUpdate[]): void {
  if (updates.length === 0) return
  const byId = new Map(events.map((e) => [e.id, e]))
  for (const u of updates) {
    const e = byId.get(u.id) as any
    if (!e) continue
    const { appendText, ...rest } = u.patch as any
    if (typeof appendText === 'string' && typeof e.text === 'string') e.text += appendText
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) e[k] = v
  }
}

interface Rec { session: Session; events: TranscriptEvent[]; meta: TranscriptMeta; tailer?: TranscriptTailer; alive: boolean }

export class SessionStore extends EventEmitter {
  private recs = new Map<string, Rec>()
  private pinned = new Set<string>()
  private timer?: NodeJS.Timeout
  private readonly now: () => number
  private readonly excludeNames: Set<string>

  constructor(private readonly opts: StoreOptions) {
    super()
    this.now = opts.now ?? Date.now
    this.excludeNames = new Set(opts.excludeNames ?? [])
  }

  sessions(): Session[] { return [...this.recs.values()].map((r) => r.session) }
  session(id: string): Session | undefined { return this.recs.get(id)?.session }
  transcript(id: string): { events: TranscriptEvent[]; meta: TranscriptMeta } | undefined {
    const r = this.recs.get(id); return r ? { events: r.events, meta: r.meta } : undefined
  }

  stats(): Stats {
    const s: Stats = { working: 0, waiting: 0, idle: 0, ended: 0, refreshedAt: this.now() }
    for (const r of this.recs.values()) s[r.session.state]++
    return s
  }

  setPinned(ids: string[]): void {
    this.pinned = new Set(ids)
    for (const r of this.recs.values()) {
      const p = this.pinned.has(r.session.sessionId)
      if (p !== r.session.pinned) { r.session.pinned = p; this.emit('session', r.session) }
    }
  }

  async start(): Promise<void> {
    this.opts.registry.on('upsert', (p: { entry: RegistryEntry; alive: boolean }) => void this.onUpsert(p.entry, p.alive))
    this.opts.registry.on('remove', (pid: number) => this.onRemove(pid))
    for (const { entry, alive } of this.opts.registry.list()) await this.onUpsert(entry, alive)
    this.timer = setInterval(() => this.recompute(), this.opts.tickMs ?? 5000)
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    for (const r of this.recs.values()) r.tailer?.stop()
  }

  private excluded(entry: RegistryEntry): boolean {
    return this.excludeNames.has(entry.name) || Boolean(this.opts.isExcludedPid?.(entry.pid))
  }

  private async onUpsert(entry: RegistryEntry, alive: boolean): Promise<void> {
    if (this.excluded(entry)) return
    let rec = this.recs.get(entry.sessionId)
    if (!rec) {
      rec = {
        alive,
        events: [], meta: {},
        session: {
          sessionId: entry.sessionId, pid: entry.pid, name: entry.name, nameSource: entry.nameSource, cwd: entry.cwd,
          startedAt: entry.startedAt, version: entry.version, registryStatus: entry.status, state: 'idle', origin: 'local',
          alive, lastActivityAt: entry.updatedAt, lastActivityPreview: '', pinned: this.pinned.has(entry.sessionId), turnOutputTokens: 0,
        },
      }
      this.recs.set(entry.sessionId, rec)
      this.refresh(rec)
      await this.attachTailer(rec)
    } else {
      Object.assign(rec.session, { pid: entry.pid, name: entry.name, nameSource: entry.nameSource, cwd: entry.cwd, registryStatus: entry.status, version: entry.version })
      rec.alive = alive
      this.refresh(rec)
    }
  }

  private onRemove(pid: number): void {
    for (const rec of this.recs.values()) {
      if (rec.session.pid === pid) { rec.alive = false; rec.tailer?.stop(); rec.tailer = undefined; this.refresh(rec) }
    }
  }

  private async attachTailer(rec: Rec): Promise<void> {
    const file = await findTranscript(rec.session.sessionId, rec.session.cwd, this.opts.projectsRoot)
    if (!file) return
    rec.session.transcriptPath = file
    const tailer = new TranscriptTailer(rec.session.sessionId, file, { pollMs: this.opts.tailerPollMs })
    rec.tailer = tailer
    tailer.on('reset', (p: { events: TranscriptEvent[]; meta: TranscriptMeta }) => {
      rec.events = p.events; rec.meta = p.meta
      this.refresh(rec)
      const payload: TranscriptResetPayload = { sessionId: rec.session.sessionId, events: rec.events, meta: rec.meta }
      this.emit('transcript:reset', payload)
    })
    tailer.on('append', (p: { events: TranscriptEvent[]; updates: EventUpdate[]; meta: TranscriptMeta }) => {
      rec.events.push(...p.events); applyUpdates(rec.events, p.updates); rec.meta = p.meta
      this.refresh(rec)
      const payload: TranscriptAppendPayload = { sessionId: rec.session.sessionId, events: p.events, updates: p.updates, meta: rec.meta }
      this.emit('transcript:append', payload)
    })
    tailer.on('error', () => { /* keep session; transcript just stops updating */ })
    try { await tailer.start() } catch { rec.tailer = undefined }
  }

  /** Recomputes derived fields for one record and emits 'session' + 'stats'. */
  private refresh(rec: Rec): void {
    const s = rec.session
    s.alive = rec.alive
    s.model = rec.meta.model ?? s.model
    s.permissionMode = rec.meta.permissionMode ?? s.permissionMode
    s.aiTitle = rec.meta.aiTitle ?? s.aiTitle
    s.totalCostUSD = rec.meta.totalCostUSD ?? s.totalCostUSD
    const act = lastActivity(rec.events)
    if (act.ts) { s.lastActivityAt = act.ts; s.lastActivityPreview = act.preview }
    s.turnOutputTokens = currentTurnTokens(rec.events)
    const lastEvent = [...rec.events].reverse().find((e) => e.kind !== 'divider')
    s.state = deriveState({ alive: rec.alive, registryStatus: s.registryStatus, lastEvent, now: this.now() })
    this.emit('session', s)
    this.emit('stats', this.stats())
  }

  recompute(): void {
    for (const rec of this.recs.values()) {
      const lastEvent = [...rec.events].reverse().find((e) => e.kind !== 'divider')
      const next = deriveState({ alive: rec.alive, registryStatus: rec.session.registryStatus, lastEvent, now: this.now() })
      if (next !== rec.session.state) this.refresh(rec)
    }
    this.emit('stats', this.stats())
  }
}

/** Output tokens reported by the latest claude event after the last user prompt. */
export function currentTurnTokens(events: TranscriptEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (e.kind === 'user') return 0
    if (e.kind === 'claude' && typeof e.outputTokens === 'number') return e.outputTokens
  }
  return 0
}
```

- [ ] **Step 8: Run store tests**

Run: `npx vitest run tests/store.test.ts tests/state.test.ts`
Expected: all pass (4 + 7).

- [ ] **Step 9: Commit**

```bash
git add src/main/state.ts src/main/store.ts tests/state.test.ts tests/store.test.ts
git commit -m "feat: session state derivation and session store"
```

---

### Task 7: FeedBuilder

**Files:**
- Create: `src/main/feed.ts`
- Test: `tests/feed.test.ts`

**Interfaces:**
- Consumes: `TranscriptEvent`, `FeedItem` (Task 2).
- Produces: `class FeedBuilder` — `constructor(opts: { bridgeName: string; windowMs?: number })`, `ingest(sessionId: string, sessionName: string, events: TranscriptEvent[]): boolean` (true if the feed changed), `rename(sessionId, name)`, `recordRelay(targets: string[], text: string, ts: number): FeedItem`, `items(): FeedItem[]` (newest first).

- [ ] **Step 1: Write the failing tests**

`tests/feed.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { FeedBuilder } from '@main/feed'
import type { TranscriptEvent } from '@shared/types'

const sent = (ts: number, to: string, text: string): TranscriptEvent => ({ kind: 'sent', id: `s${ts}`, ts, to: [to], text })
const cross = (ts: number, fromName: string, text: string): TranscriptEvent => ({ kind: 'cross', id: `x${ts}`, ts, fromName, text })

describe('FeedBuilder', () => {
  it('creates an item from the sender side', () => {
    const f = new FeedBuilder({ bridgeName: 'csm-bridge' })
    expect(f.ingest('A', 'perf-query-cache', [sent(1000, 'auth-refactor', 'hello')])).toBe(true)
    expect(f.items()).toEqual([{ id: expect.any(String), ts: 1000, from: 'perf-query-cache', to: ['auth-refactor'], text: 'hello', senderSessionId: 'A', receiverSessionIds: [], viaBridge: false }])
  })
  it('creates an item from the receiver side when the sender is unknown', () => {
    const f = new FeedBuilder({ bridgeName: 'csm-bridge' })
    f.ingest('B', 'auth-refactor', [cross(2000, 'cloud-worker', 'hi from cloud')])
    expect(f.items()[0]).toMatchObject({ from: 'cloud-worker', to: ['auth-refactor'], receiverSessionIds: ['B'], senderSessionId: undefined })
  })
  it('merges sender and receiver evidence for the same message within the window', () => {
    const f = new FeedBuilder({ bridgeName: 'csm-bridge' })
    f.ingest('A', 'perf-query-cache', [sent(1000, 'auth-refactor', 'Heads up — renamed')])
    f.ingest('B', 'auth-refactor', [cross(1004, 'perf-query-cache', 'Heads up — renamed')])
    expect(f.items()).toHaveLength(1)
    expect(f.items()[0]).toMatchObject({ senderSessionId: 'A', receiverSessionIds: ['B'], to: ['auth-refactor'] })
  })
  it('does not merge when the text differs or the gap exceeds the window', () => {
    const f = new FeedBuilder({ bridgeName: 'csm-bridge', windowMs: 10_000 })
    f.ingest('A', 'p', [sent(1000, 'q', 'one')])
    f.ingest('B', 'q', [cross(1500, 'p', 'two')])
    f.ingest('B', 'q', [cross(50_000, 'p', 'one')])
    expect(f.items()).toHaveLength(3)
  })
  it('relabels bridge-originated messages as you / viaBridge and merges with the recorded relay', () => {
    const f = new FeedBuilder({ bridgeName: 'csm-bridge' })
    f.recordRelay(['auth-refactor', 'feature-dev'], 'status?', 5000)
    f.ingest('B', 'auth-refactor', [cross(5300, 'csm-bridge', 'status?')])
    f.ingest('C', 'feature-dev', [cross(5400, 'csm-bridge', 'status?')])
    expect(f.items()).toHaveLength(1)
    expect(f.items()[0]).toMatchObject({ from: 'you', viaBridge: true, to: ['auth-refactor', 'feature-dev'], receiverSessionIds: ['B', 'C'] })
  })
  it('sorts newest first and ignores non-message events', () => {
    const f = new FeedBuilder({ bridgeName: 'csm-bridge' })
    expect(f.ingest('A', 'a', [{ kind: 'user', id: 'u', ts: 1, text: 'x' }])).toBe(false)
    f.ingest('A', 'a', [sent(10, 'b', 'first'), sent(20, 'b', 'second')])
    expect(f.items().map((i) => i.text)).toEqual(['second', 'first'])
  })
  it('renames the sender label when a session is renamed', () => {
    const f = new FeedBuilder({ bridgeName: 'csm-bridge' })
    f.ingest('A', 'old', [sent(10, 'b', 'msg')])
    f.rename('A', 'new')
    expect(f.items()[0]!.from).toBe('new')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/feed.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write feed.ts**

`src/main/feed.ts`:
```ts
import type { FeedItem, TranscriptEvent } from '@shared/types'

const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase()

export class FeedBuilder {
  private list: FeedItem[] = []
  private seq = 0
  private readonly windowMs: number
  private readonly bridgeName: string

  constructor(opts: { bridgeName: string; windowMs?: number }) {
    this.bridgeName = opts.bridgeName
    this.windowMs = opts.windowMs ?? 10_000
  }

  items(): FeedItem[] { return [...this.list].sort((a, b) => b.ts - a.ts) }

  rename(sessionId: string, name: string): void {
    for (const it of this.list) if (it.senderSessionId === sessionId) it.from = name
  }

  recordRelay(targets: string[], text: string, ts: number): FeedItem {
    const item: FeedItem = { id: `relay-${++this.seq}`, ts, from: 'you', to: [...targets], text, receiverSessionIds: [], viaBridge: true }
    this.list.push(item)
    return item
  }

  ingest(sessionId: string, sessionName: string, events: TranscriptEvent[]): boolean {
    let changed = false
    for (const e of events) {
      if (e.kind === 'sent') {
        const from = sessionName === this.bridgeName ? 'you' : sessionName
        const m = this.find(from, e.text, e.ts)
        if (m) {
          m.senderSessionId = m.senderSessionId ?? sessionId
          for (const t of e.to) if (!m.to.includes(t)) m.to.push(t)
          m.ts = Math.min(m.ts, e.ts)
        } else {
          this.list.push({ id: `feed-${++this.seq}`, ts: e.ts, from, to: [...e.to], text: e.text, senderSessionId: sessionId, receiverSessionIds: [], viaBridge: from === 'you' })
        }
        changed = true
      } else if (e.kind === 'cross') {
        const from = e.fromName === this.bridgeName ? 'you' : e.fromName
        const m = this.find(from, e.text, e.ts)
        if (m) {
          if (!m.receiverSessionIds.includes(sessionId)) m.receiverSessionIds.push(sessionId)
          if (!m.to.includes(sessionName)) m.to.push(sessionName)
        } else {
          this.list.push({ id: `feed-${++this.seq}`, ts: e.ts, from, to: [sessionName], text: e.text, receiverSessionIds: [sessionId], viaBridge: from === 'you' })
        }
        changed = true
      }
    }
    return changed
  }

  private find(from: string, text: string, ts: number): FeedItem | undefined {
    const n = norm(text)
    return this.list.find((it) => it.from === from && norm(it.text) === n && Math.abs(it.ts - ts) <= this.windowMs)
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/feed.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/feed.ts tests/feed.test.ts
git commit -m "feat: cross-session feed builder"
```

---

### Task 8: Bridge process manager

**Files:**
- Create: `src/main/bridge.ts`, `tests/fixtures/fake-claude.cjs`
- Test: `tests/bridge.test.ts`

**Interfaces:**
- Consumes: `BridgeState`, `RelayResult` (Task 2).
- Produces: `RELAY_SYSTEM_PROMPT: string`; `buildArgs(opts: { model: string; name: string }): string[]`; `buildRelayPrompt(targets: string[], text: string): string`; `parseRelayResult(resultText: string, targets: string[], isError: boolean): { sent: string[]; failed: { to: string; error: string }[] }`; `stripSessionEnv(env): NodeJS.ProcessEnv`; `class Bridge extends EventEmitter` — `constructor(opts: BridgeOptions)`, `state: BridgeState`, `pid: number | undefined`, `start(): void`, `stop(): Promise<void>`, `retry(): void`, `relay(targets, text): Promise<RelayResult>`, event `'state'` `(BridgeState)`. `BridgeOptions = { command?: string; prefixArgs?: string[]; cwd: string; env?: NodeJS.ProcessEnv; model?: string; name?: string; maxAttempts?: number; backoffMs?: number[]; turnTimeoutMs?: number }`.

- [ ] **Step 1: Write the fake claude**

`tests/fixtures/fake-claude.cjs`:
```js
// Minimal stand-in for `claude -p --input-format stream-json --output-format stream-json`.
// Env: FAKE_CLAUDE_CRASH_AFTER=<n> exits with code 3 after n completed turns; FAKE_CLAUDE_NO_INIT=1 never prints init.
const readline = require('node:readline')
const crashAfter = Number(process.env.FAKE_CLAUDE_CRASH_AFTER || 0)
let turns = 0
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
if (!process.env.FAKE_CLAUDE_NO_INIT) out({ type: 'system', subtype: 'init', session_id: 'fake-session' })
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  const text = typeof msg.message?.content === 'string' ? msg.message.content : ''
  const m = /^Targets: (.*)$/m.exec(text)
  const targets = m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : []
  const sent = targets.filter((t) => !t.startsWith('missing-'))
  const failed = targets.filter((t) => t.startsWith('missing-')).map((to) => ({ to, error: 'no such session' }))
  out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } })
  out({ type: 'result', subtype: 'success', is_error: false, num_turns: ++turns, result: JSON.stringify({ sent, failed }) })
  if (crashAfter && turns >= crashAfter) process.exit(3)
})
rl.on('close', () => process.exit(0))
```

- [ ] **Step 2: Write the failing tests**

`tests/bridge.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import path from 'node:path'
import { Bridge, buildArgs, buildRelayPrompt, parseRelayResult, stripSessionEnv } from '@main/bridge'

const FAKE = path.resolve(__dirname, 'fixtures/fake-claude.cjs')
const mk = (env: Record<string, string> = {}, over: Partial<ConstructorParameters<typeof Bridge>[0]> = {}) =>
  new Bridge({ command: process.execPath, prefixArgs: [FAKE], cwd: process.cwd(), env: { ...process.env, ...env }, backoffMs: [10, 10, 10], maxAttempts: 3, ...over })

const waitFor = async (cond: () => boolean, ms = 5000) => {
  const t0 = Date.now()
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)) }
}

let b: Bridge | undefined
afterEach(async () => { await b?.stop(); b = undefined })

describe('pure helpers', () => {
  it('buildArgs matches the spec command line', () => {
    expect(buildArgs({ model: 'haiku', name: 'csm-bridge' })).toEqual([
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', 'haiku',
      '--allowedTools', 'SendMessage,ListAgents', '--no-session-persistence', '-n', 'csm-bridge', '--system-prompt', expect.any(String),
    ])
  })
  it('buildRelayPrompt lists targets and wraps the text in markers', () => {
    const p = buildRelayPrompt(['a', 'b'], 'hello\nworld')
    expect(p).toContain('Targets: a, b')
    expect(p).toContain('<<<MSG\nhello\nworld\nMSG>>>')
  })
  it('parseRelayResult reads JSON, tolerates prose around it, and falls back', () => {
    expect(parseRelayResult('Done. {"sent":["a"],"failed":[{"to":"b","error":"x"}]}', ['a', 'b'], false)).toEqual({ sent: ['a'], failed: [{ to: 'b', error: 'x' }] })
    expect(parseRelayResult('no json here', ['a'], false)).toEqual({ sent: ['a'], failed: [] })
    expect(parseRelayResult('boom', ['a'], true)).toEqual({ sent: [], failed: [{ to: 'a', error: 'boom' }] })
  })
  it('stripSessionEnv removes the nested-session variables', () => {
    const e = stripSessionEnv({ PATH: '/x', CLAUDE_CODE_MESSAGING_SOCKET: 's', CLAUDE_CODE_MESSAGING_TOKEN: 't', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_SESSION_ID: 'id' })
    expect(e).toEqual({ PATH: '/x' })
  })
})

describe('Bridge', () => {
  it('connects, relays to several targets, reports latency, and stays alive across turns', async () => {
    b = mk()
    const states: string[] = []; b.on('state', (s) => states.push(s.status))
    b.start()
    await waitFor(() => b!.state.status === 'connected')
    const r1 = await b.relay(['auth-refactor', 'feature-dev'], 'status?')
    expect(r1.sent).toEqual(['auth-refactor', 'feature-dev']); expect(r1.failed).toEqual([]); expect(r1.latencyMs).toBeGreaterThanOrEqual(0)
    const r2 = await b.relay(['missing-one'], 'again')
    expect(r2.failed).toEqual([{ to: 'missing-one', error: 'no such session' }])
    expect(states).toContain('relaying')
    expect(b.state).toMatchObject({ status: 'connected', bridgeName: 'csm-bridge' })
  })
  it('queues concurrent relays and serves them in order', async () => {
    b = mk(); b.start()
    await waitFor(() => b!.state.status === 'connected')
    const [a, c] = await Promise.all([b.relay(['a'], '1'), b.relay(['c'], '2')])
    expect(a.sent).toEqual(['a']); expect(c.sent).toEqual(['c'])
  })
  it('reconnects with backoff after a crash and becomes unavailable after maxAttempts', async () => {
    b = mk({ FAKE_CLAUDE_CRASH_AFTER: '1' }, { maxAttempts: 2 })
    const states: any[] = []; b.on('state', (s) => states.push(s))
    b.start()
    await waitFor(() => b!.state.status === 'connected')
    await b.relay(['a'], 'x')                       // fake exits after this turn
    await waitFor(() => states.some((s) => s.status === 'reconnecting'))
    await waitFor(() => b!.state.status === 'connected')   // respawned (attempt 1)
    await b.relay(['a'], 'y')                       // crashes again
    await waitFor(() => b!.state.status === 'unavailable', 8000)
    expect(states.filter((s) => s.status === 'reconnecting').map((s) => s.attempt)).toEqual([1, 2])
  })
  it('is unavailable when the command does not exist, and retry() tries again', async () => {
    b = new Bridge({ command: 'definitely-not-a-real-binary-xyz', cwd: process.cwd(), backoffMs: [10], maxAttempts: 1 })
    b.start()
    await waitFor(() => b!.state.status === 'unavailable')
    expect((b.state as any).reason).toMatch(/not found|ENOENT/i)
    b.retry()
    await waitFor(() => b!.state.status === 'unavailable')
  })
  it('rejects a relay while unavailable', async () => {
    b = new Bridge({ command: 'definitely-not-a-real-binary-xyz', cwd: process.cwd(), backoffMs: [10], maxAttempts: 1 })
    b.start()
    await waitFor(() => b!.state.status === 'unavailable')
    await expect(b.relay(['a'], 'x')).rejects.toThrow(/unavailable/)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/bridge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write bridge.ts**

`src/main/bridge.ts`:
```ts
import { EventEmitter } from 'node:events'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'
import type { BridgeState, RelayResult } from '@shared/types'

export const RELAY_SYSTEM_PROMPT =
  'You are a relay. Each user message names target sessions and contains a message between <<<MSG and MSG>>> markers. ' +
  'For each target, call SendMessage with `to` set to the target name exactly and `message` set to the text between the markers, verbatim, with no additions. ' +
  'Never answer the message yourself. When done, reply with only JSON: {"sent":[names],"failed":[{"to":name,"error":text}]}.'

export interface BridgeOptions {
  command?: string
  prefixArgs?: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  model?: string
  name?: string
  maxAttempts?: number
  backoffMs?: number[]
  turnTimeoutMs?: number
}

export function buildArgs(opts: { model: string; name: string }): string[] {
  return ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', opts.model,
    '--allowedTools', 'SendMessage,ListAgents', '--no-session-persistence', '-n', opts.name, '--system-prompt', RELAY_SYSTEM_PROMPT]
}

export function buildRelayPrompt(targets: string[], text: string): string {
  return `Relay the message below to each target with SendMessage (one call per target, \`to\` exactly as written). Send it verbatim; add nothing. Then reply with only the JSON summary.\nTargets: ${targets.join(', ')}\n<<<MSG\n${text}\nMSG>>>`
}

export function parseRelayResult(resultText: string, targets: string[], isError: boolean): { sent: string[]; failed: { to: string; error: string }[] } {
  if (isError) return { sent: [], failed: targets.map((to) => ({ to, error: resultText || 'bridge error' })) }
  const m = /\{[\s\S]*\}/.exec(resultText)
  if (m) {
    try {
      const j = JSON.parse(m[0])
      if (Array.isArray(j.sent) || Array.isArray(j.failed)) {
        return { sent: (j.sent ?? []).map(String), failed: (j.failed ?? []).map((f: any) => ({ to: String(f.to), error: String(f.error ?? 'failed') })) }
      }
    } catch { /* fall through */ }
  }
  return { sent: [...targets], failed: [] }
}

const STRIP = ['CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID']
export function stripSessionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env)) if (!STRIP.includes(k) && v !== undefined) out[k] = v
  return out
}

interface Pending { targets: string[]; text: string; resolve: (r: RelayResult) => void; reject: (e: Error) => void; startedAt?: number; timer?: NodeJS.Timeout }

export class Bridge extends EventEmitter {
  state: BridgeState = { status: 'reconnecting', attempt: 0, max: 5 }
  pid: number | undefined
  private child?: ChildProcessWithoutNullStreams
  private queue: Pending[] = []
  private inFlight?: Pending
  private attempt = 0
  private stopping = false
  private reconnectTimer?: NodeJS.Timeout
  private readonly name: string
  private readonly model: string
  private readonly maxAttempts: number
  private readonly backoff: number[]
  private readonly turnTimeoutMs: number

  constructor(private readonly opts: BridgeOptions) {
    super()
    this.name = opts.name ?? 'csm-bridge'
    this.model = opts.model ?? 'haiku'
    this.maxAttempts = opts.maxAttempts ?? 5
    this.backoff = opts.backoffMs ?? [1000, 2000, 4000, 8000, 16000]
    this.turnTimeoutMs = opts.turnTimeoutMs ?? 120_000
  }

  private setState(s: BridgeState): void { this.state = s; this.emit('state', s) }

  start(): void {
    this.stopping = false
    this.spawnChild()
  }

  retry(): void {
    this.attempt = 0
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.killChild()
    this.start()
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.failAll(new Error('bridge stopped'))
    this.killChild()
  }

  relay(targets: string[], text: string): Promise<RelayResult> {
    if (this.state.status === 'unavailable') return Promise.reject(new Error(`bridge unavailable: ${this.state.reason}`))
    return new Promise<RelayResult>((resolve, reject) => {
      this.queue.push({ targets, text, resolve, reject })
      this.pump()
    })
  }

  private spawnChild(): void {
    const args = [...(this.opts.prefixArgs ?? []), ...buildArgs({ model: this.model, name: this.name })]
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(this.opts.command ?? 'claude', args, { cwd: this.opts.cwd, env: stripSessionEnv(this.opts.env ?? process.env), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    } catch (e: any) {
      this.onExit(e?.message ?? String(e)); return
    }
    this.child = child
    this.pid = child.pid
    this.setState({ status: 'reconnecting', attempt: this.attempt, max: this.maxAttempts })
    const rl = readline.createInterface({ input: child.stdout })
    rl.on('line', (line) => this.onLine(line))
    let stderr = ''
    child.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-2000) })
    child.on('error', (err: any) => this.onExit(err?.code === 'ENOENT' ? `'${this.opts.command ?? 'claude'}' not found on PATH` : String(err?.message ?? err)))
    child.on('exit', (code) => { if (this.child === child) this.onExit(`bridge exited with code ${code}${stderr ? `: ${stderr.trim().split('\n').pop()}` : ''}`) })
  }

  private killChild(): void {
    const c = this.child
    this.child = undefined; this.pid = undefined
    if (c && c.exitCode === null) { try { c.stdin.end() } catch { /* ignore */ } c.kill() }
  }

  private onLine(line: string): void {
    let d: any
    try { d = JSON.parse(line) } catch { return }
    if (d.type === 'system' && d.subtype === 'init') {
      if (this.state.status !== 'connected' && this.state.status !== 'relaying') {
        this.attempt = 0
        this.setState({ status: 'connected', bridgeName: this.name })
        this.pump()
      }
      return
    }
    if (d.type === 'result' && this.inFlight) {
      const p = this.inFlight; this.inFlight = undefined
      if (p.timer) clearTimeout(p.timer)
      const latencyMs = Date.now() - (p.startedAt ?? Date.now())
      const parsed = parseRelayResult(String(d.result ?? ''), p.targets, Boolean(d.is_error))
      this.setState({ status: 'connected', bridgeName: this.name, latencyMs })
      p.resolve({ ...parsed, latencyMs })
      this.pump()
    }
  }

  private pump(): void {
    if (this.inFlight || !this.child || this.state.status !== 'connected') return
    const next = this.queue.shift()
    if (!next) return
    this.inFlight = next
    next.startedAt = Date.now()
    next.timer = setTimeout(() => {
      if (this.inFlight === next) { this.inFlight = undefined; next.reject(new Error('relay timed out')); this.killChild(); this.onExit('relay timed out') }
    }, this.turnTimeoutMs)
    this.setState({ status: 'relaying', targets: next.targets })
    this.child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: buildRelayPrompt(next.targets, next.text) } }) + '\n')
  }

  private failAll(err: Error): void {
    if (this.inFlight) { if (this.inFlight.timer) clearTimeout(this.inFlight.timer); this.inFlight.reject(err); this.inFlight = undefined }
    for (const p of this.queue.splice(0)) p.reject(err)
  }

  private onExit(reason: string): void {
    this.child = undefined; this.pid = undefined
    if (this.stopping) return
    this.failAll(new Error(reason))
    this.attempt += 1
    if (this.attempt > this.maxAttempts) { this.setState({ status: 'unavailable', reason }); return }
    this.setState({ status: 'reconnecting', attempt: this.attempt, max: this.maxAttempts })
    const delay = this.backoff[Math.min(this.attempt - 1, this.backoff.length - 1)] ?? 1000
    this.reconnectTimer = setTimeout(() => this.spawnChild(), delay)
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/bridge.test.ts`
Expected: 9 passed. The reconnect test expects reconnecting attempts `[1, 2]` with `maxAttempts: 2`: crash 1 → attempt 1 (respawn), crash 2 → attempt 2 (respawn), crash 3 is not reached because the test only relays twice — if it reports `unavailable` too early, check that `attempt > maxAttempts` (not `>=`) guards the unavailable transition. If the test still ends with `connected` instead of `unavailable`, the fake's second instance survives (it only crashes after one turn per instance); adjust the test to relay a third time before waiting for `unavailable`.

- [ ] **Step 6: Commit**

```bash
git add src/main/bridge.ts tests/bridge.test.ts tests/fixtures/fake-claude.cjs
git commit -m "feat: headless claude bridge with relay protocol and reconnect"
```

---

### Task 9: SearchIndex, Prefs, and Markdown export

**Files:**
- Create: `src/main/search.ts`, `src/main/prefs.ts`, `src/main/export.ts`
- Test: `tests/search.test.ts`, `tests/prefs.test.ts`, `tests/export.test.ts`

**Interfaces:**
- Consumes: parser (Task 3), `splitLines` (Task 4), types (Task 2).
- Produces: `class SearchIndex` — `upsert(sessionId, sessionName, events)`, `applyUpdates(sessionId, updates)`, `remove(sessionId)`, `query(q, limit = 200): SearchHit[]`, `size: number`; `loadRecentTranscripts(projectsRoot, days, skip: Set<string>): Promise<{ sessionId: string; name: string; events: TranscriptEvent[] }[]>`; `class PrefsStore` — `constructor(filePath, opts?: { debounceMs?: number })`, `load(): Promise<Prefs>`, `get(): Prefs`, `set(patch: Partial<Prefs>): Prefs`, `flush(): Promise<void>`, `DEFAULT_PREFS`; `transcriptToMarkdown(session: { name: string; cwd: string; startedAt: number }, events: TranscriptEvent[]): string`.

- [ ] **Step 1: Write the failing tests**

`tests/search.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SearchIndex, loadRecentTranscripts } from '@main/search'
import { L } from './fixtures/lines'

describe('SearchIndex', () => {
  it('finds case-insensitive substrings with a snippet, newest first', () => {
    const ix = new SearchIndex()
    ix.upsert('A', 'auth', [
      { kind: 'user', id: 'u1', ts: 1, text: 'Refactor the Token store please' },
      { kind: 'claude', id: 'c1', ts: 2, text: 'x'.repeat(100) + 'token' + 'y'.repeat(100) },
      { kind: 'tool', id: 't1', ts: 3, name: 'Bash', input: { command: 'token' } },
      { kind: 'divider', id: 'd', ts: 4, text: 'token' },
    ])
    const hits = ix.query('TOKEN')
    expect(hits.map((h) => h.eventId)).toEqual(['c1', 'u1'])
    expect(hits[0]!.snippet.length).toBeLessThanOrEqual(90)
    expect(hits[0]!.snippet).toContain('token')
    expect(hits[1]).toMatchObject({ sessionId: 'A', sessionName: 'auth', ts: 1 })
  })
  it('applies updates, removes sessions, and respects limit', () => {
    const ix = new SearchIndex()
    ix.upsert('A', 'a', [{ kind: 'claude', id: 'c', ts: 1, text: 'hello' }])
    ix.applyUpdates('A', [{ id: 'c', patch: { appendText: ' needle' } }])
    expect(ix.query('needle')).toHaveLength(1)
    ix.upsert('B', 'b', [{ kind: 'user', id: 'u', ts: 2, text: 'needle' }, { kind: 'user', id: 'u2', ts: 3, text: 'needle' }])
    expect(ix.query('needle', 2)).toHaveLength(2)
    ix.remove('A')
    expect(ix.query('needle').every((h) => h.sessionId === 'B')).toBe(true)
    expect(ix.query('')).toEqual([])
  })
})

describe('loadRecentTranscripts', () => {
  let dir: string
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'csm-search-')) })
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })
  it('loads recent jsonl files not in the skip set and names them by ai-title or id', async () => {
    await fs.mkdir(path.join(dir, '-p1'), { recursive: true })
    await fs.writeFile(path.join(dir, '-p1', 'old.jsonl'), L.userText + '\n')
    await fs.utimes(path.join(dir, '-p1', 'old.jsonl'), new Date(Date.now() - 10 * 86400e3), new Date(Date.now() - 10 * 86400e3))
    await fs.writeFile(path.join(dir, '-p1', 'fresh.jsonl'), L.userText + '\n' + L.aiTitle + '\n')
    await fs.writeFile(path.join(dir, '-p1', 'live.jsonl'), L.userText + '\n')
    const r = await loadRecentTranscripts(dir, 7, new Set(['live']))
    expect(r.map((x) => [x.sessionId, x.name])).toEqual([['fresh', 'Token store refactor']])
    expect(r[0]!.events.some((e) => e.kind === 'user')).toBe(true)
  })
})
```

`tests/prefs.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PrefsStore, DEFAULT_PREFS } from '@main/prefs'

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'csm-prefs-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

describe('PrefsStore', () => {
  it('returns defaults when the file is missing or corrupt', async () => {
    const p = new PrefsStore(path.join(dir, 'prefs.json'))
    expect(await p.load()).toEqual(DEFAULT_PREFS)
    await fs.writeFile(path.join(dir, 'prefs.json'), '{oops')
    expect(await p.load()).toEqual(DEFAULT_PREFS)
  })
  it('merges patches, caps prompt history at 50, and persists after debounce', async () => {
    const file = path.join(dir, 'prefs.json')
    const p = new PrefsStore(file, { debounceMs: 10 })
    await p.load()
    p.set({ pinned: ['a'] })
    p.set({ promptHistory: Array.from({ length: 60 }, (_, i) => `p${i}`) })
    expect(p.get().pinned).toEqual(['a'])
    expect(p.get().promptHistory).toHaveLength(50)
    await p.flush()
    const again = new PrefsStore(file)
    expect((await again.load()).pinned).toEqual(['a'])
  })
})
```

`tests/export.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { transcriptToMarkdown } from '@main/export'

describe('transcriptToMarkdown', () => {
  it('renders a header and one section per event kind', () => {
    const md = transcriptToMarkdown({ name: 'auth-refactor', cwd: '/x', startedAt: Date.UTC(2026, 7, 26, 11, 2) }, [
      { kind: 'divider', id: 'd', ts: 1, text: 'session started 11:02' },
      { kind: 'user', id: 'u', ts: Date.UTC(2026, 7, 26, 11, 4), text: 'Do it' },
      { kind: 'claude', id: 'c', ts: Date.UTC(2026, 7, 26, 11, 5), text: 'Done.' },
      { kind: 'tool', id: 't', ts: 3, name: 'Bash', input: { command: 'npm test' }, resultText: 'ok' },
      { kind: 'cross', id: 'x', ts: 4, fromName: 'perf', text: 'heads up' },
      { kind: 'sent', id: 's', ts: 5, to: ['perf'], text: 'thanks' },
      { kind: 'system', id: 'sy', ts: 6, text: '/rename' },
    ])
    expect(md.startsWith('# auth-refactor\n')).toBe(true)
    expect(md).toContain('cwd: `/x`')
    expect(md).toContain('---\n\n_session started 11:02_')
    expect(md).toContain('**You** · 11:04\n\nDo it')
    expect(md).toContain('**Claude** · 11:05\n\nDone.')
    expect(md).toContain('> **Tool · Bash** `npm test`\n>\n> ```\n> ok\n> ```')
    expect(md).toContain('**⇄ from perf**\n\n> heads up')
    expect(md).toContain('**→ to perf**\n\n> thanks')
    expect(md).toContain('_system: /rename_')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/search.test.ts tests/prefs.test.ts tests/export.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write search.ts**

`src/main/search.ts`:
```ts
import fs from 'node:fs/promises'
import path from 'node:path'
import type { EventUpdate, SearchHit, TranscriptEvent } from '@shared/types'
import { createParseContext, parseLines } from './transcript/parser'
import { splitLines } from './transcript/tailer'
import { toolSummary } from './state'

interface Doc { sessionId: string; sessionName: string; eventId: string; ts: number; text: string }

function textOf(e: TranscriptEvent): string | undefined {
  switch (e.kind) {
    case 'user': case 'claude': case 'cross': case 'sent': return e.text
    case 'tool': return toolSummary(e.name, e.input)
    default: return undefined
  }
}

export class SearchIndex {
  private docs = new Map<string, Doc[]>()
  private names = new Map<string, string>()

  get size(): number { let n = 0; for (const d of this.docs.values()) n += d.length; return n }

  upsert(sessionId: string, sessionName: string, events: TranscriptEvent[]): void {
    this.names.set(sessionId, sessionName)
    const list = this.docs.get(sessionId) ?? []
    for (const e of events) {
      const text = textOf(e)
      if (text === undefined) continue
      const i = list.findIndex((d) => d.eventId === e.id)
      const doc: Doc = { sessionId, sessionName, eventId: e.id, ts: e.ts, text }
      if (i >= 0) list[i] = doc; else list.push(doc)
    }
    for (const d of list) d.sessionName = sessionName
    this.docs.set(sessionId, list)
  }

  applyUpdates(sessionId: string, updates: EventUpdate[]): void {
    const list = this.docs.get(sessionId); if (!list) return
    for (const u of updates) {
      const d = list.find((x) => x.eventId === u.id); if (!d) continue
      const p = u.patch as any
      if (typeof p.appendText === 'string') d.text += p.appendText
      if (typeof p.text === 'string') d.text = p.text
    }
  }

  remove(sessionId: string): void { this.docs.delete(sessionId); this.names.delete(sessionId) }

  query(q: string, limit = 200): SearchHit[] {
    const needle = q.trim().toLowerCase()
    if (!needle) return []
    const hits: SearchHit[] = []
    for (const list of this.docs.values()) {
      for (const d of list) {
        const at = d.text.toLowerCase().indexOf(needle)
        if (at < 0) continue
        hits.push({ sessionId: d.sessionId, sessionName: d.sessionName, eventId: d.eventId, ts: d.ts, snippet: snippet(d.text, at, needle.length) })
      }
    }
    return hits.sort((a, b) => b.ts - a.ts).slice(0, limit)
  }
}

export function snippet(text: string, at: number, len: number, radius = 40): string {
  const start = Math.max(0, at - radius)
  const end = Math.min(text.length, at + len + radius)
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : '')
}

/** Loads transcripts modified within `days`, excluding session ids in `skip` (the live ones already indexed). */
export async function loadRecentTranscripts(projectsRoot: string, days: number, skip: Set<string>): Promise<{ sessionId: string; name: string; events: TranscriptEvent[] }[]> {
  const cutoff = Date.now() - days * 86_400_000
  const out: { sessionId: string; name: string; events: TranscriptEvent[] }[] = []
  let dirs: string[] = []
  try { dirs = await fs.readdir(projectsRoot) } catch { return out }
  for (const d of dirs) {
    const dir = path.join(projectsRoot, d)
    let files: string[] = []
    try { files = (await fs.readdir(dir)).filter((f) => f.endsWith('.jsonl')) } catch { continue }
    for (const f of files) {
      const sessionId = f.slice(0, -'.jsonl'.length)
      if (skip.has(sessionId)) continue
      const full = path.join(dir, f)
      let st; try { st = await fs.stat(full) } catch { continue }
      if (st.mtimeMs < cutoff) continue
      const { lines } = splitLines(await fs.readFile(full, 'utf8'))
      const parsed = parseLines(lines, createParseContext())
      out.push({ sessionId, name: parsed.meta.aiTitle ?? sessionId.slice(0, 8), events: parsed.events })
    }
  }
  return out
}
```

- [ ] **Step 4: Write prefs.ts**

`src/main/prefs.ts`:
```ts
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Prefs } from '@shared/types'

export const DEFAULT_PREFS: Prefs = { pinned: [], bookmarks: [], promptHistory: [] }
const HISTORY_MAX = 50

export class PrefsStore {
  private prefs: Prefs = { ...DEFAULT_PREFS }
  private timer?: NodeJS.Timeout
  private writing: Promise<void> = Promise.resolve()
  private readonly debounceMs: number

  constructor(private readonly filePath: string, opts: { debounceMs?: number } = {}) {
    this.debounceMs = opts.debounceMs ?? 300
  }

  async load(): Promise<Prefs> {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8'))
      this.prefs = { ...DEFAULT_PREFS, ...(raw && typeof raw === 'object' ? raw : {}) }
    } catch { this.prefs = { ...DEFAULT_PREFS } }
    return this.get()
  }

  get(): Prefs { return { ...this.prefs, pinned: [...this.prefs.pinned], bookmarks: [...this.prefs.bookmarks], promptHistory: [...this.prefs.promptHistory] } }

  set(patch: Partial<Prefs>): Prefs {
    this.prefs = { ...this.prefs, ...patch }
    if (this.prefs.promptHistory.length > HISTORY_MAX) this.prefs.promptHistory = this.prefs.promptHistory.slice(0, HISTORY_MAX)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), this.debounceMs)
    return this.get()
  }

  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
    const data = JSON.stringify(this.prefs, null, 2)
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      await fs.writeFile(this.filePath + '.tmp', data, 'utf8')
      await fs.rename(this.filePath + '.tmp', this.filePath)
    })
    await this.writing
  }
}
```

- [ ] **Step 5: Write export.ts**

`src/main/export.ts`:
```ts
import type { TranscriptEvent } from '@shared/types'
import { toolSummary } from './state'

const hhmm = (ts: number) => { const d = new Date(ts); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` }
const quote = (t: string) => t.split('\n').map((l) => `> ${l}`).join('\n')

export function transcriptToMarkdown(session: { name: string; cwd: string; startedAt: number }, events: TranscriptEvent[]): string {
  const parts: string[] = [`# ${session.name}`, '', `cwd: \`${session.cwd}\` · started ${new Date(session.startedAt).toISOString()}`, '', '---', '']
  for (const e of events) {
    switch (e.kind) {
      case 'divider': parts.push(`_${e.text}_`); break
      case 'user': parts.push(`**You** · ${hhmm(e.ts)}`, '', e.text); break
      case 'claude': parts.push(`**Claude** · ${hhmm(e.ts)}`, '', e.text); break
      case 'tool': {
        const arg = toolSummary(e.name, e.input).slice(e.name.length + 2)
        parts.push(`> **Tool · ${e.name}**${arg ? ` \`${arg}\`` : ''}${e.resultText ? `\n>\n> \`\`\`\n${quote(e.resultText)}\n> \`\`\`` : ''}`)
        break
      }
      case 'cross': parts.push(`**⇄ from ${e.fromName}**`, '', quote(e.text)); break
      case 'sent': parts.push(`**→ to ${e.to.join(', ')}**`, '', quote(e.text)); break
      case 'system': parts.push(`_system: ${e.text}_`); break
    }
    parts.push('')
  }
  return parts.join('\n')
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/search.test.ts tests/prefs.test.ts tests/export.test.ts`
Expected: 6 passed.

- [ ] **Step 7: Commit**

```bash
git add src/main/search.ts src/main/prefs.ts src/main/export.ts tests/search.test.ts tests/prefs.test.ts tests/export.test.ts
git commit -m "feat: search index, prefs store, markdown export"
```

---

### Task 10: IPC, preload, window, and main wiring

**Files:**
- Create: `src/main/ipc.ts`, `src/main/window.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts`
- Test: `tests/ipc.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 5–9; `IPC`, `PUSH`, `CsmApi` (Task 2).
- Produces: `registerIpc(ipc: IpcLike, deps: IpcDeps): void` and `wirePush(deps: IpcDeps): () => void` where `IpcLike = { handle(channel: string, fn: (event: unknown, ...args: any[]) => unknown): void; on(channel: string, fn: (event: unknown, ...args: any[]) => void): void }` and `IpcDeps = { store: SessionStore; bridge: Bridge; feed: FeedBuilder; search: SearchIndex; prefs: PrefsStore; projectsRoot: string; send(channel: string, payload: unknown): void; saveMarkdown(defaultName: string, content: string): Promise<{ saved: boolean; path?: string }>; openPath(p: string): Promise<void>; reload(): void; windowControl(action: 'minimize' | 'maximize' | 'close'): void; now?: () => number }`. Renderer gets `window.csm: CsmApi`.

- [ ] **Step 1: Write the failing IPC test**

`tests/ipc.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { registerIpc, wirePush } from '@main/ipc'
import { FeedBuilder } from '@main/feed'
import { SearchIndex } from '@main/search'
import { PrefsStore } from '@main/prefs'
import { IPC, PUSH } from '@shared/types'
import os from 'node:os'
import path from 'node:path'

class FakeIpc { handlers = new Map<string, Function>(); listeners = new Map<string, Function>()
  handle(c: string, fn: Function) { this.handlers.set(c, fn) }
  on(c: string, fn: Function) { this.listeners.set(c, fn) }
  invoke(c: string, ...args: any[]) { return this.handlers.get(c)!({}, ...args) } }

function deps() {
  const store = Object.assign(new EventEmitter(), {
    sessions: () => [{ sessionId: 'A', name: 'a', cwd: '/x', startedAt: 0 }],
    session: (id: string) => (id === 'A' ? { sessionId: 'A', name: 'a', cwd: '/x', startedAt: 0 } : undefined),
    transcript: (id: string) => (id === 'A' ? { events: [{ kind: 'user', id: 'u', ts: 1, text: 'hi' }], meta: {} } : undefined),
    setPinned: vi.fn(), stats: () => ({ working: 0, waiting: 0, idle: 0, ended: 0, refreshedAt: 0 }),
  })
  const bridge = Object.assign(new EventEmitter(), { state: { status: 'connected', bridgeName: 'csm-bridge' }, relay: vi.fn(async (t: string[]) => ({ sent: t, failed: [], latencyMs: 5 })), retry: vi.fn() })
  const feed = new FeedBuilder({ bridgeName: 'csm-bridge' })
  const search = new SearchIndex()
  const prefs = new PrefsStore(path.join(os.tmpdir(), `csm-ipc-${Date.now()}.json`), { debounceMs: 10 })
  const send = vi.fn(); const saveMarkdown = vi.fn(async () => ({ saved: true, path: '/tmp/a.md' }))
  return { store: store as any, bridge: bridge as any, feed, search, prefs, projectsRoot: '/p', send, saveMarkdown, openPath: vi.fn(async () => {}), reload: vi.fn(), windowControl: vi.fn(), now: () => 1234 }
}

describe('registerIpc', () => {
  it('serves sessions, transcripts, prefs, search and export', async () => {
    const d = deps(); const ipc = new FakeIpc(); registerIpc(ipc, d)
    expect(await ipc.invoke(IPC.sessionsList)).toHaveLength(1)
    expect(await ipc.invoke(IPC.transcriptLoad, 'A')).toMatchObject({ sessionId: 'A', events: [{ id: 'u' }] })
    expect(await ipc.invoke(IPC.transcriptLoad, 'Z')).toBeNull()
    await ipc.invoke(IPC.prefsSet, { pinned: ['A'] })
    expect(d.store.setPinned).toHaveBeenCalledWith(['A'])
    expect((await ipc.invoke(IPC.prefsGet)).pinned).toEqual(['A'])
    d.search.upsert('A', 'a', [{ kind: 'user', id: 'u', ts: 1, text: 'find me' }])
    expect(await ipc.invoke(IPC.searchQuery, 'find')).toHaveLength(1)
    expect(await ipc.invoke(IPC.transcriptExport, 'A')).toEqual({ saved: true, path: '/tmp/a.md' })
    expect(d.saveMarkdown).toHaveBeenCalledWith('a.md', expect.stringContaining('# a'))
  })
  it('relays through the bridge, records history and feed, and pushes the feed', async () => {
    const d = deps(); const ipc = new FakeIpc(); registerIpc(ipc, d)
    const r = await ipc.invoke(IPC.relaySend, ['x', 'y'], 'status?')
    expect(r.sent).toEqual(['x', 'y'])
    expect(d.prefs.get().promptHistory).toEqual(['status?'])
    expect(d.feed.items()[0]).toMatchObject({ from: 'you', to: ['x', 'y'], viaBridge: true, ts: 1234 })
    expect(d.send).toHaveBeenCalledWith(PUSH.feedUpdate, expect.any(Array))
    await ipc.invoke(IPC.bridgeRetry); expect(d.bridge.retry).toHaveBeenCalled()
    expect(await ipc.invoke(IPC.bridgeState)).toMatchObject({ status: 'connected' })
  })
  it('forwards window controls, logs and reload', async () => {
    const d = deps(); const ipc = new FakeIpc(); registerIpc(ipc, d)
    ipc.listeners.get(IPC.windowMinimize)!({}); expect(d.windowControl).toHaveBeenCalledWith('minimize')
    await ipc.invoke(IPC.appOpenLogs); expect(d.openPath).toHaveBeenCalledWith('/p')
    await ipc.invoke(IPC.appReload); expect(d.reload).toHaveBeenCalled()
  })
})

describe('wirePush', () => {
  it('forwards store/bridge events to the renderer and feeds search + feed', () => {
    const d = deps(); wirePush(d)
    d.store.emit('session', { sessionId: 'A', name: 'a' })
    expect(d.send).toHaveBeenCalledWith(PUSH.sessionUpsert, { sessionId: 'A', name: 'a' })
    d.store.emit('transcript:append', { sessionId: 'A', events: [{ kind: 'sent', id: 's', ts: 1, to: ['b'], text: 'ping' }], updates: [], meta: {} })
    expect(d.send).toHaveBeenCalledWith(PUSH.transcriptAppend, expect.objectContaining({ sessionId: 'A' }))
    expect(d.feed.items()[0]).toMatchObject({ from: 'a', to: ['b'] })
    expect(d.search.query('ping')).toHaveLength(1)
    d.bridge.emit('state', { status: 'relaying', targets: ['b'] })
    expect(d.send).toHaveBeenCalledWith(PUSH.bridgeState, { status: 'relaying', targets: ['b'] })
    d.store.emit('stats', { working: 1 })
    expect(d.send).toHaveBeenCalledWith(PUSH.statsUpdate, { working: 1 })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ipc.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write ipc.ts**

`src/main/ipc.ts`:
```ts
import type { BridgeState, FeedItem, Prefs, RelayResult, Session, TranscriptAppendPayload, TranscriptResetPayload } from '@shared/types'
import { IPC, PUSH } from '@shared/types'
import type { SessionStore } from './store'
import type { Bridge } from './bridge'
import type { FeedBuilder } from './feed'
import type { SearchIndex } from './search'
import type { PrefsStore } from './prefs'
import { transcriptToMarkdown } from './export'

export interface IpcLike {
  handle(channel: string, fn: (event: unknown, ...args: any[]) => unknown): void
  on(channel: string, fn: (event: unknown, ...args: any[]) => void): void
}

export interface IpcDeps {
  store: SessionStore
  bridge: Bridge
  feed: FeedBuilder
  search: SearchIndex
  prefs: PrefsStore
  projectsRoot: string
  send(channel: string, payload: unknown): void
  saveMarkdown(defaultName: string, content: string): Promise<{ saved: boolean; path?: string }>
  openPath(p: string): Promise<void>
  reload(): void
  windowControl(action: 'minimize' | 'maximize' | 'close'): void
  now?: () => number
}

export function registerIpc(ipc: IpcLike, d: IpcDeps): void {
  const now = d.now ?? Date.now
  ipc.handle(IPC.sessionsList, (): Session[] => d.store.sessions())
  ipc.handle(IPC.transcriptLoad, (_e, sessionId: string): TranscriptResetPayload | null => {
    const t = d.store.transcript(sessionId)
    return t ? { sessionId, events: t.events, meta: t.meta } : null
  })
  ipc.handle(IPC.transcriptExport, async (_e, sessionId: string) => {
    const s = d.store.session(sessionId); const t = d.store.transcript(sessionId)
    if (!s || !t) return { saved: false }
    return d.saveMarkdown(`${s.name}.md`, transcriptToMarkdown(s, t.events))
  })
  ipc.handle(IPC.relaySend, async (_e, targets: string[], text: string): Promise<RelayResult> => {
    const history = [text, ...d.prefs.get().promptHistory.filter((h) => h !== text)]
    d.prefs.set({ promptHistory: history })
    d.feed.recordRelay(targets, text, now())
    d.send(PUSH.feedUpdate, d.feed.items())
    return d.bridge.relay(targets, text)
  })
  ipc.handle(IPC.bridgeRetry, () => { d.bridge.retry() })
  ipc.handle(IPC.bridgeState, (): BridgeState => d.bridge.state)
  ipc.handle(IPC.feedList, (): FeedItem[] => d.feed.items())
  ipc.handle(IPC.searchQuery, (_e, q: string) => d.search.query(q))
  ipc.handle(IPC.prefsGet, (): Prefs => d.prefs.get())
  ipc.handle(IPC.prefsSet, (_e, patch: Partial<Prefs>): Prefs => {
    const p = d.prefs.set(patch)
    if (patch.pinned) d.store.setPinned(p.pinned)
    return p
  })
  ipc.handle(IPC.appOpenLogs, () => d.openPath(d.projectsRoot))
  ipc.handle(IPC.appReload, () => { d.reload() })
  ipc.on(IPC.windowMinimize, () => d.windowControl('minimize'))
  ipc.on(IPC.windowMaximize, () => d.windowControl('maximize'))
  ipc.on(IPC.windowClose, () => d.windowControl('close'))
}

/** Subscribes main-process modules to each other and to the renderer push channel. Returns an unsubscribe function. */
export function wirePush(d: IpcDeps): () => void {
  const onSession = (s: Session) => { d.feed.rename(s.sessionId, s.name); d.send(PUSH.sessionUpsert, s) }
  const onRemoved = (id: string) => { d.search.remove(id); d.send(PUSH.sessionRemove, id) }
  const onReset = (p: TranscriptResetPayload) => {
    const name = d.store.session(p.sessionId)?.name ?? p.sessionId
    d.search.upsert(p.sessionId, name, p.events)
    if (d.feed.ingest(p.sessionId, name, p.events)) d.send(PUSH.feedUpdate, d.feed.items())
    d.send(PUSH.transcriptReset, p)
  }
  const onAppend = (p: TranscriptAppendPayload) => {
    const name = d.store.session(p.sessionId)?.name ?? p.sessionId
    d.search.upsert(p.sessionId, name, p.events); d.search.applyUpdates(p.sessionId, p.updates)
    if (d.feed.ingest(p.sessionId, name, p.events)) d.send(PUSH.feedUpdate, d.feed.items())
    d.send(PUSH.transcriptAppend, p)
  }
  const onStats = (s: unknown) => d.send(PUSH.statsUpdate, s)
  const onBridge = (s: BridgeState) => d.send(PUSH.bridgeState, s)
  d.store.on('session', onSession); d.store.on('removed', onRemoved); d.store.on('transcript:reset', onReset); d.store.on('transcript:append', onAppend); d.store.on('stats', onStats)
  d.bridge.on('state', onBridge)
  return () => {
    d.store.off('session', onSession); d.store.off('removed', onRemoved); d.store.off('transcript:reset', onReset); d.store.off('transcript:append', onAppend); d.store.off('stats', onStats)
    d.bridge.off('state', onBridge)
  }
}
```

- [ ] **Step 4: Run the IPC tests**

Run: `npx vitest run tests/ipc.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Write window.ts**

`src/main/window.ts`:
```ts
import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import type { PrefsStore } from './prefs'

export function createMainWindow(prefs: PrefsStore): BrowserWindow {
  const saved = prefs.get().window
  const bounds = saved && screen.getDisplayMatching(saved).bounds ? saved : { width: 1360, height: 760 }
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 1100,
    minHeight: 600,
    show: false,
    backgroundColor: '#252525',
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } } : { frame: false }),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false },
  })
  win.once('ready-to-show', () => win.show())
  let t: NodeJS.Timeout | undefined
  const persist = () => { if (t) clearTimeout(t); t = setTimeout(() => { if (!win.isDestroyed()) { const b = win.getBounds(); prefs.set({ window: { x: b.x, y: b.y, width: b.width, height: b.height } }) } }, 300) }
  win.on('resize', persist); win.on('move', persist)
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}
```

- [ ] **Step 6: Rewrite main/index.ts with the full wiring**

`src/main/index.ts`:
```ts
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { claudeHome, projectsDir, sessionsDir } from './paths'
import { RegistryWatcher } from './registry'
import { SessionStore } from './store'
import { FeedBuilder } from './feed'
import { Bridge } from './bridge'
import { SearchIndex, loadRecentTranscripts } from './search'
import { PrefsStore } from './prefs'
import { registerIpc, wirePush } from './ipc'
import { createMainWindow } from './window'

const BRIDGE_NAME = 'csm-bridge'

async function main(): Promise<void> {
  await app.whenReady()
  const home = claudeHome()
  const prefs = new PrefsStore(path.join(app.getPath('userData'), 'prefs.json'))
  await prefs.load()

  const bridge = new Bridge({ cwd: app.getPath('userData'), name: BRIDGE_NAME, command: process.platform === 'win32' ? 'claude.cmd' : 'claude' })
  const registry = new RegistryWatcher(sessionsDir(home))
  const store = new SessionStore({ registry, projectsRoot: projectsDir(home), excludeNames: [BRIDGE_NAME], isExcludedPid: (pid) => pid === bridge.pid })
  store.setPinned(prefs.get().pinned)
  const feed = new FeedBuilder({ bridgeName: BRIDGE_NAME })
  const search = new SearchIndex()

  let win = createMainWindow(prefs)
  const send = (channel: string, payload: unknown) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload) }

  registerIpc(ipcMain, {
    store, bridge, feed, search, prefs, projectsRoot: projectsDir(home), send,
    saveMarkdown: async (defaultName, content) => {
      const r = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: [{ name: 'Markdown', extensions: ['md'] }] })
      if (r.canceled || !r.filePath) return { saved: false }
      await fs.writeFile(r.filePath, content, 'utf8')
      return { saved: true, path: r.filePath }
    },
    openPath: async (p) => { await shell.openPath(p) },
    reload: () => { for (const w of BrowserWindow.getAllWindows()) w.webContents.reload() },
    windowControl: (action) => {
      const w = BrowserWindow.getFocusedWindow() ?? win
      if (action === 'minimize') w.minimize(); else if (action === 'close') w.close(); else w.isMaximized() ? w.unmaximize() : w.maximize()
    },
  })
  wirePush({ store, bridge, feed, search, prefs, projectsRoot: projectsDir(home), send, saveMarkdown: async () => ({ saved: false }), openPath: async () => {}, reload: () => {}, windowControl: () => {} })

  await registry.start()
  await store.start()
  bridge.start()

  // Index recent non-live transcripts in the background so search covers the last 7 days.
  void loadRecentTranscripts(projectsDir(home), 7, new Set(store.sessions().map((s) => s.sessionId)))
    .then((list) => { for (const t of list) search.upsert(t.sessionId, t.name, t.events) })

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) win = createMainWindow(prefs) })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('before-quit', () => { void bridge.stop(); void store.stop(); void registry.stop(); void prefs.flush() })
}

void main()
```

Note: `wirePush` only uses `store`, `bridge`, `feed`, `search`, `send` from its deps — the stubs for the other fields exist only to satisfy the shared `IpcDeps` type. To avoid the stubs, split the type: change `wirePush`'s parameter to `Pick<IpcDeps, 'store' | 'bridge' | 'feed' | 'search' | 'send'>` in `ipc.ts` and pass `{ store, bridge, feed, search, send }` here. Do that.

- [ ] **Step 7: Write the preload**

`src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron'
import { IPC, PUSH, type CsmApi } from '@shared/types'

const api: CsmApi = {
  platform: process.platform,
  listSessions: () => ipcRenderer.invoke(IPC.sessionsList),
  loadTranscript: (sessionId) => ipcRenderer.invoke(IPC.transcriptLoad, sessionId),
  exportTranscript: (sessionId) => ipcRenderer.invoke(IPC.transcriptExport, sessionId),
  relay: (targets, text) => ipcRenderer.invoke(IPC.relaySend, targets, text),
  bridgeRetry: () => ipcRenderer.invoke(IPC.bridgeRetry),
  bridgeState: () => ipcRenderer.invoke(IPC.bridgeState),
  listFeed: () => ipcRenderer.invoke(IPC.feedList),
  search: (q) => ipcRenderer.invoke(IPC.searchQuery, q),
  getPrefs: () => ipcRenderer.invoke(IPC.prefsGet),
  setPrefs: (patch) => ipcRenderer.invoke(IPC.prefsSet, patch),
  openLogs: () => ipcRenderer.invoke(IPC.appOpenLogs),
  reload: () => ipcRenderer.invoke(IPC.appReload),
  windowControl: (action) => ipcRenderer.send(action === 'minimize' ? IPC.windowMinimize : action === 'maximize' ? IPC.windowMaximize : IPC.windowClose),
  on: (channel, cb) => {
    const allowed = new Set<string>(Object.values(PUSH))
    if (!allowed.has(channel)) throw new Error(`unknown push channel ${channel}`)
    const handler = (_e: unknown, payload: any) => cb(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.off(channel, handler)
  },
}

contextBridge.exposeInMainWorld('csm', api)
```

- [ ] **Step 8: Typecheck, run all tests, and smoke-run the app**

Run: `npm run typecheck && npm test`
Expected: exit 0; all suites pass.

Run: `npm run dev` for ~20 s with at least one Claude Code session open in another terminal. Open DevTools (View → Toggle Developer Tools) and in the console run `await window.csm.listSessions()`.
Expected: an array containing your live sessions with `name`, `state`, `cwd`. Then `await window.csm.bridgeState()` → `{ status: 'connected', bridgeName: 'csm-bridge' }` within ~10 s of launch. Also confirm `ls ~/.claude/sessions` shows a `csm-bridge` entry while the app runs and that it disappears after quitting.

- [ ] **Step 9: Commit**

```bash
git add src/main/ipc.ts src/main/window.ts src/main/index.ts src/preload/index.ts tests/ipc.test.ts
git commit -m "feat: ipc surface, preload api, window, and main wiring"
```

---

### Task 11: Renderer foundation — fonts, tokens, formatting helpers, zustand store, layout shell

**Files:**
- Create: `src/renderer/src/lib/format.ts`, `src/renderer/src/lib/events.ts`, `src/renderer/src/store.ts`, `src/renderer/src/assets/fonts/` (two woff2 files), `tests/renderer/mockCsm.ts`
- Modify: `src/renderer/src/styles/globals.css`, `src/renderer/src/App.tsx`
- Test: `tests/renderer/format.test.ts`, `tests/renderer/store.test.ts`

**Interfaces:**
- Consumes: `CsmApi`, `PUSH`, all shared types (Task 2).
- Produces: `cn(...)`, `hhmm(ts)`, `relTime(ts, now?)`, `cwdTail(cwd)`, `shortTokens(n)`, `stateLabel(session, now?)`, `STATE_COLOR: Record<SessionState, string>` (hex), `firstLine(text, max?)`; `applyUpdates(events, updates)` (renderer copy); `useStore` zustand hook with the `AppState` below; `installMockCsm()` for tests; CSS utility classes `.animate-pulse-dot`, `.animate-blink`, `.drag`, `.no-drag`.

- [ ] **Step 1: Bundle the fonts**

Run:
```bash
mkdir -p src/renderer/src/assets/fonts
SANS=$(find node_modules/geist -iname 'Geist*Variable*.woff2' -not -iname '*Mono*' | head -1)
MONO=$(find node_modules/geist -iname 'GeistMono*Variable*.woff2' | head -1)
echo "sans=$SANS mono=$MONO"
cp "$SANS" src/renderer/src/assets/fonts/Geist.woff2
cp "$MONO" src/renderer/src/assets/fonts/GeistMono.woff2
```
Expected: both paths print non-empty and the two files exist. If `find` prints nothing, download `Geist-Variable.woff2` / `GeistMono-Variable.woff2` from the `vercel/geist-font` GitHub release assets into the same folder with the same names; the fallback stacks keep the UI working meanwhile.

- [ ] **Step 2: Finish globals.css**

Replace `src/renderer/src/styles/globals.css` with:
```css
@import "tailwindcss";

@font-face { font-family: "Geist"; src: url("../assets/fonts/Geist.woff2") format("woff2"); font-weight: 100 900; font-display: swap; }
@font-face { font-family: "Geist Mono"; src: url("../assets/fonts/GeistMono.woff2") format("woff2"); font-weight: 100 900; font-display: swap; }

@theme {
  --color-bg: oklch(0.145 0 0);
  --color-panel: oklch(0.205 0 0);
  --color-raised: oklch(0.269 0 0);
  --color-fg: oklch(0.985 0 0);
  --color-fg-soft: oklch(0.87 0 0);
  --color-muted: oklch(0.708 0 0);
  --color-faint: oklch(0.556 0 0);
  --color-border: rgba(255,255,255,.1);
  --color-input: rgba(255,255,255,.15);
  --color-primary: oklch(0.922 0 0);
  --color-primary-fg: oklch(0.205 0 0);
  --color-working: #34d399;
  --color-waiting: #fbbf24;
  --color-ended: #60a5fa;
  --color-error: #f87171;
  --color-cross: #a78bfa;
  --color-cross-fg: #c4b5fd;
  --color-claude: #d97757;
  --font-sans: "Geist", system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}

@keyframes csm-pulse { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }
@keyframes csm-blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }

@layer utilities {
  .animate-pulse-dot { animation: csm-pulse 1.6s ease-in-out infinite; }
  .animate-blink { animation: csm-blink 1s step-end infinite; }
  .drag { -webkit-app-region: drag; }
  .no-drag { -webkit-app-region: no-drag; }
}

html, body, #root { height: 100%; margin: 0; }
body { background: var(--color-bg); color: var(--color-fg); font-family: var(--font-sans); font-size: 12.5px; -webkit-font-smoothing: antialiased; overflow: hidden; }
* { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.15) transparent; }
::selection { background: rgba(255,255,255,.2); }
```

- [ ] **Step 3: Write the failing format tests**

`tests/renderer/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { relTime, cwdTail, shortTokens, stateLabel, firstLine, STATE_COLOR } from '@renderer/lib/format'
import type { Session } from '@shared/types'

const s = (over: Partial<Session>): Session => ({ sessionId: 'a', pid: 1, name: 'a', cwd: '/x', startedAt: 0, version: '', registryStatus: 'idle', state: 'idle', origin: 'local', alive: true, lastActivityAt: 0, lastActivityPreview: 'doing things', pinned: false, turnOutputTokens: 0, ...over })

describe('format', () => {
  it('relTime', () => {
    const now = 10 * 60_000 * 100
    expect(relTime(now - 20_000, now)).toBe('now')
    expect(relTime(now - 24 * 60_000, now)).toBe('24 min')
    expect(relTime(now - 3 * 3_600_000, now)).toBe('3 h')
    expect(relTime(now - 2 * 86_400_000, now)).toBe('2 d')
  })
  it('cwdTail shortens the home dir on both platforms', () => {
    expect(cwdTail('/Users/dev/acme-api')).toBe('~/acme-api')
    expect(cwdTail('/Users/dev/maydon/secondrun/maydon-api')).toBe('~/maydon/secondrun/maydon-api')
    expect(cwdTail('C:\\Users\\dev\\acme-api')).toBe('~\\acme-api')
    expect(cwdTail('/srv/app')).toBe('/srv/app')
  })
  it('shortTokens', () => {
    expect(shortTokens(950)).toBe('950'); expect(shortTokens(2100)).toBe('2.1k'); expect(shortTokens(12_400)).toBe('12k')
  })
  it('stateLabel per state', () => {
    const now = 100 * 60_000
    expect(stateLabel(s({ state: 'working' }), now)).toBe('doing things')
    expect(stateLabel(s({ state: 'idle', lastActivityAt: now - 24 * 60_000 }), now)).toBe('Idle — 24 min')
    expect(stateLabel(s({ state: 'waiting' }), now)).toBe('Waiting — likely permission')
    expect(stateLabel(s({ state: 'ended', lastActivityAt: Date.UTC(2026, 0, 1, 12, 41) }), now)).toMatch(/^Ended — \d\d:\d\d$/)
  })
  it('firstLine truncates', () => {
    expect(firstLine('a\nb', 10)).toBe('a'); expect(firstLine('x'.repeat(20), 10)).toBe('xxxxxxxxx…')
  })
  it('has a color per state', () => {
    expect(Object.keys(STATE_COLOR).sort()).toEqual(['ended', 'idle', 'waiting', 'working'])
  })
})
```

- [ ] **Step 4: Write format.ts and events.ts**

`src/renderer/src/lib/format.ts`:
```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Session, SessionState } from '@shared/types'

export const cn = (...xs: ClassValue[]) => twMerge(clsx(xs))

export function hhmm(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function relTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, now - ts) / 1000
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)} min`
  if (s < 86_400) return `${Math.floor(s / 3600)} h`
  return `${Math.floor(s / 86_400)} d`
}

export function cwdTail(cwd: string): string {
  return cwd.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~')
}

export function shortTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n / 1000)}k`
}

export const STATE_COLOR: Record<SessionState, string> = { working: '#34d399', waiting: '#fbbf24', idle: '#8a8a8a', ended: '#60a5fa' }

export function stateLabel(s: Session, now = Date.now()): string {
  switch (s.state) {
    case 'working': return s.lastActivityPreview || 'Working…'
    case 'waiting': return 'Waiting — likely permission'
    case 'idle': return `Idle — ${relTime(s.lastActivityAt, now)}`
    case 'ended': return `Ended — ${hhmm(s.lastActivityAt)}`
  }
}

export function firstLine(text: string, max = 80): string {
  const line = text.split('\n')[0] ?? ''
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

export const isMac = () => window.csm?.platform === 'darwin'
export const modKey = () => (isMac() ? '⌘' : 'Ctrl')
```

`src/renderer/src/lib/events.ts`:
```ts
import type { EventUpdate, TranscriptEvent } from '@shared/types'

/** Renderer twin of main's applyUpdates: mutates events in place. */
export function applyUpdates(events: TranscriptEvent[], updates: EventUpdate[]): void {
  if (!updates.length) return
  const byId = new Map(events.map((e) => [e.id, e as any]))
  for (const u of updates) {
    const e = byId.get(u.id); if (!e) continue
    const { appendText, ...rest } = u.patch as any
    if (typeof appendText === 'string' && typeof e.text === 'string') e.text += appendText
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) e[k] = v
  }
}

/** Index of the event whose ts is closest to `ts` (for feed → transcript jumps). */
export function nearestIndex(events: TranscriptEvent[], ts: number): number {
  let best = -1, bestD = Infinity
  events.forEach((e, i) => { const d = Math.abs(e.ts - ts); if (d < bestD) { bestD = d; best = i } })
  return best
}
```

- [ ] **Step 5: Run the format tests**

Run: `npx vitest run tests/renderer/format.test.ts`
Expected: 6 passed. (`hhmm` uses local time on purpose — the UI shows the user's clock; the parser's UTC divider text is re-rendered by the Divider component in Task 13.)

- [ ] **Step 6: Write the mock csm and the failing store test**

`tests/renderer/mockCsm.ts`:
```ts
import { vi } from 'vitest'
import type { CsmApi } from '@shared/types'

export function installMockCsm(over: Partial<CsmApi> = {}) {
  const listeners = new Map<string, (p: any) => void>()
  const csm: CsmApi = {
    platform: 'darwin',
    listSessions: vi.fn(async () => []),
    loadTranscript: vi.fn(async () => null),
    exportTranscript: vi.fn(async () => ({ saved: false })),
    relay: vi.fn(async (t: string[]) => ({ sent: t, failed: [], latencyMs: 1 })),
    bridgeRetry: vi.fn(async () => {}),
    bridgeState: vi.fn(async () => ({ status: 'connected' as const, bridgeName: 'csm-bridge' })),
    listFeed: vi.fn(async () => []),
    search: vi.fn(async () => []),
    getPrefs: vi.fn(async () => ({ pinned: [], bookmarks: [], promptHistory: [] })),
    setPrefs: vi.fn(async (p) => ({ pinned: [], bookmarks: [], promptHistory: [], ...p })),
    openLogs: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    windowControl: vi.fn(),
    on: vi.fn((ch: string, cb: (p: any) => void) => { listeners.set(ch, cb); return () => listeners.delete(ch) }),
    ...over,
  }
  ;(globalThis as any).window.csm = csm
  return { csm, push: (ch: string, payload: unknown) => listeners.get(ch)?.(payload) }
}
```

`tests/renderer/store.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { installMockCsm } from './mockCsm'
import { useStore } from '@renderer/store'
import { PUSH } from '@shared/types'

const sess = (id: string, over = {}) => ({ sessionId: id, pid: 1, name: id, cwd: '/x', startedAt: 0, version: '', registryStatus: 'idle', state: 'idle', origin: 'local', alive: true, lastActivityAt: 0, lastActivityPreview: '', pinned: false, turnOutputTokens: 0, ...over })

describe('store', () => {
  beforeEach(() => useStore.getState().reset())

  it('init loads sessions/prefs/feed/bridge and selects the remembered or most recent session', async () => {
    const { csm } = installMockCsm({
      listSessions: async () => [sess('a', { lastActivityAt: 5 }), sess('b', { lastActivityAt: 9 })] as any,
      getPrefs: async () => ({ pinned: ['a'], bookmarks: [], promptHistory: ['p'] }),
      loadTranscript: async (id: string) => ({ sessionId: id, events: [{ kind: 'user', id: 'u', ts: 1, text: 'hi' }], meta: {} }) as any,
    })
    await useStore.getState().init()
    const st = useStore.getState()
    expect(Object.keys(st.sessions)).toEqual(['a', 'b'])
    expect(st.selectedId).toBe('b')
    expect(st.prefs.pinned).toEqual(['a'])
    expect(csm.loadTranscript).toHaveBeenCalledWith('b')
    expect(st.transcripts.b!.events).toHaveLength(1)
  })

  it('applies push updates: upsert, append with updates, feed, bridge, stats, remove', async () => {
    const { push } = installMockCsm()
    await useStore.getState().init()
    push(PUSH.sessionUpsert, sess('a'))
    expect(useStore.getState().sessions.a!.name).toBe('a')
    push(PUSH.transcriptReset, { sessionId: 'a', events: [{ kind: 'claude', id: 'c', ts: 1, text: 'Hi' }], meta: {} })
    push(PUSH.transcriptAppend, { sessionId: 'a', events: [{ kind: 'tool', id: 't', ts: 2, name: 'Bash', input: {} }], updates: [{ id: 'c', patch: { appendText: ' there' } }], meta: { model: 'm' } })
    const t = useStore.getState().transcripts.a!
    expect(t.events.map((e) => e.id)).toEqual(['c', 't'])
    expect((t.events[0] as any).text).toBe('Hi there')
    expect(t.meta.model).toBe('m')
    push(PUSH.feedUpdate, [{ id: 'f', ts: 1, from: 'x', to: ['y'], text: 'm', receiverSessionIds: [], viaBridge: false }])
    expect(useStore.getState().feed).toHaveLength(1)
    push(PUSH.bridgeState, { status: 'unavailable', reason: 'r' })
    expect(useStore.getState().bridge.status).toBe('unavailable')
    push(PUSH.statsUpdate, { working: 2, waiting: 0, idle: 0, ended: 0, refreshedAt: 1 })
    expect(useStore.getState().stats.working).toBe(2)
    push(PUSH.sessionRemove, 'a')
    expect(useStore.getState().sessions.a).toBeUndefined()
  })

  it('select loads the transcript once; additive select builds the multi list; togglePin persists', async () => {
    const { csm } = installMockCsm({ listSessions: async () => [sess('a'), sess('b')] as any, loadTranscript: async (id: string) => ({ sessionId: id, events: [], meta: {} }) as any })
    await useStore.getState().init()
    useStore.getState().select('a')
    useStore.getState().select('a')
    await new Promise((r) => setTimeout(r, 0))
    expect((csm.loadTranscript as any).mock.calls.filter((c: any[]) => c[0] === 'a')).toHaveLength(1)
    useStore.getState().select('b', true)
    expect(useStore.getState().multiIds).toEqual(['a', 'b'])
    useStore.getState().select('b', true)
    expect(useStore.getState().multiIds).toEqual(['a'])
    await useStore.getState().togglePin('a')
    expect(csm.setPrefs).toHaveBeenCalledWith({ pinned: ['a'] })
    expect(useStore.getState().sessions.a!.pinned).toBe(true)
  })

  it('jump sets the target and clears it after consumption', async () => {
    installMockCsm({ loadTranscript: async (id: string) => ({ sessionId: id, events: [], meta: {} }) as any })
    await useStore.getState().init()
    useStore.getState().jump({ sessionId: 'z', ts: 5 })
    expect(useStore.getState().selectedId).toBe('z')
    expect(useStore.getState().jumpTarget).toEqual({ sessionId: 'z', ts: 5 })
    useStore.getState().consumeJump()
    expect(useStore.getState().jumpTarget).toBeUndefined()
  })
})
```

- [ ] **Step 7: Write store.ts**

`src/renderer/src/store.ts`:
```ts
import { create } from 'zustand'
import { PUSH, type BridgeState, type Bookmark, type FeedItem, type Prefs, type Session, type Stats, type TranscriptAppendPayload, type TranscriptEvent, type TranscriptMeta, type TranscriptResetPayload } from '@shared/types'
import { applyUpdates } from './lib/events'

export type View = 'sessions' | 'feed' | 'history'
export interface JumpTarget { sessionId: string; eventId?: string; ts?: number }

export interface AppState {
  sessions: Record<string, Session>
  transcripts: Record<string, { events: TranscriptEvent[]; meta: TranscriptMeta }>
  feed: FeedItem[]
  bridge: BridgeState
  stats: Stats
  prefs: Prefs
  selectedId?: string
  multiIds: string[]
  view: View
  searchOpen: boolean
  draft: string
  jumpTarget?: JumpTarget
  ready: boolean

  init(): Promise<void>
  reset(): void
  select(id: string, additive?: boolean): void
  setView(v: View): void
  setSearchOpen(open: boolean): void
  setDraft(text: string): void
  jump(t: JumpTarget): void
  consumeJump(): void
  togglePin(id: string): Promise<void>
  addBookmark(b: Bookmark): Promise<void>
  setPrefs(patch: Partial<Prefs>): Promise<void>
}

const EMPTY_STATS: Stats = { working: 0, waiting: 0, idle: 0, ended: 0, refreshedAt: 0 }
const EMPTY_PREFS: Prefs = { pinned: [], bookmarks: [], promptHistory: [] }
let unsubscribe: (() => void)[] = []

export const useStore = create<AppState>((set, get) => ({
  sessions: {}, transcripts: {}, feed: [], bridge: { status: 'reconnecting', attempt: 0, max: 5 }, stats: EMPTY_STATS, prefs: EMPTY_PREFS,
  multiIds: [], view: 'sessions', searchOpen: false, draft: '', ready: false,

  reset() {
    for (const u of unsubscribe) u(); unsubscribe = []
    set({ sessions: {}, transcripts: {}, feed: [], bridge: { status: 'reconnecting', attempt: 0, max: 5 }, stats: EMPTY_STATS, prefs: EMPTY_PREFS, selectedId: undefined, multiIds: [], view: 'sessions', searchOpen: false, draft: '', jumpTarget: undefined, ready: false })
  },

  async init() {
    const csm = window.csm
    const [list, prefs, feed, bridge] = await Promise.all([csm.listSessions(), csm.getPrefs(), csm.listFeed(), csm.bridgeState()])
    const sessions: Record<string, Session> = {}
    for (const s of list) sessions[s.sessionId] = { ...s, pinned: prefs.pinned.includes(s.sessionId) }
    set({ sessions, prefs, feed, bridge, ready: true })
    unsubscribe.push(
      csm.on<Session>(PUSH.sessionUpsert, (s) => set((st) => ({ sessions: { ...st.sessions, [s.sessionId]: { ...s, pinned: st.prefs.pinned.includes(s.sessionId) } } }))),
      csm.on<string>(PUSH.sessionRemove, (id) => set((st) => { const { [id]: _, ...rest } = st.sessions; return { sessions: rest } })),
      csm.on<TranscriptResetPayload>(PUSH.transcriptReset, (p) => set((st) => ({ transcripts: { ...st.transcripts, [p.sessionId]: { events: [...p.events], meta: p.meta } } }))),
      csm.on<TranscriptAppendPayload>(PUSH.transcriptAppend, (p) => set((st) => {
        const cur = st.transcripts[p.sessionId]
        if (!cur) return {}
        const events = [...cur.events, ...p.events]
        applyUpdates(events, p.updates)
        return { transcripts: { ...st.transcripts, [p.sessionId]: { events, meta: { ...cur.meta, ...p.meta } } } }
      })),
      csm.on<FeedItem[]>(PUSH.feedUpdate, (feed) => set({ feed })),
      csm.on<BridgeState>(PUSH.bridgeState, (bridge) => set({ bridge })),
      csm.on<Stats>(PUSH.statsUpdate, (stats) => set({ stats })),
    )
    const remembered = prefs.selectedSessionId && sessions[prefs.selectedSessionId] ? prefs.selectedSessionId : undefined
    const mostRecent = list.slice().sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0]?.sessionId
    const first = remembered ?? mostRecent
    if (first) get().select(first)
  },

  select(id, additive = false) {
    const st = get()
    if (additive) {
      const base = st.multiIds.length ? st.multiIds : st.selectedId ? [st.selectedId] : []
      const multiIds = base.includes(id) ? base.filter((x) => x !== id) : [...base, id]
      set({ multiIds, selectedId: multiIds[multiIds.length - 1] ?? st.selectedId })
    } else {
      set({ selectedId: id, multiIds: [] })
      void window.csm.setPrefs({ selectedSessionId: id })
    }
    if (!st.transcripts[id]) {
      set((s) => ({ transcripts: { ...s.transcripts, [id]: { events: [], meta: {} } } }))
      void window.csm.loadTranscript(id).then((t) => { if (t) set((s) => ({ transcripts: { ...s.transcripts, [id]: { events: [...t.events], meta: t.meta } } })) })
    }
  },

  setView: (view) => set({ view }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setDraft: (draft) => set({ draft }),

  jump(t) { get().select(t.sessionId); set({ jumpTarget: t, view: 'sessions', searchOpen: false }) },
  consumeJump: () => set({ jumpTarget: undefined }),

  async togglePin(id) {
    const cur = get().prefs.pinned
    const pinned = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    await get().setPrefs({ pinned })
  },

  async addBookmark(b) {
    const bookmarks = [b, ...get().prefs.bookmarks.filter((x) => !(x.sessionId === b.sessionId && x.eventId === b.eventId))]
    await get().setPrefs({ bookmarks })
  },

  async setPrefs(patch) {
    const prefs = await window.csm.setPrefs(patch)
    set((st) => {
      const sessions = { ...st.sessions }
      for (const s of Object.values(sessions)) sessions[s.sessionId] = { ...s, pinned: prefs.pinned.includes(s.sessionId) }
      return { prefs, sessions }
    })
  },
}))

export const useSelected = () => useStore((s) => (s.selectedId ? s.sessions[s.selectedId] : undefined))
export const useTargets = () => useStore((s) => (s.multiIds.length ? s.multiIds : s.selectedId ? [s.selectedId] : []))
```

- [ ] **Step 8: Run the store tests**

Run: `npx vitest run tests/renderer/store.test.ts`
Expected: 4 passed.

- [ ] **Step 9: Write the layout shell**

`src/renderer/src/App.tsx`:
```tsx
import { useEffect } from 'react'
import { useStore } from './store'
import { cn, isMac } from './lib/format'

/** Regions are filled in by Tasks 12–16; until then they render labelled placeholders. */
export default function App() {
  const init = useStore((s) => s.init)
  const ready = useStore((s) => s.ready)
  useEffect(() => { void init() }, [init])
  if (!ready) return <div className="h-full flex items-center justify-center text-muted">Loading…</div>
  return (
    <div className="h-full flex flex-col bg-bg">
      <div id="titlebar" className="h-10 shrink-0 border-b border-border bg-panel" />
      <div className="flex-1 min-h-0 flex">
        <aside id="sidebar" className={cn('w-[236px] shrink-0 border-r border-border flex flex-col', isMac() ? 'bg-panel' : 'bg-bg')} />
        <main id="center" className="flex-1 min-w-0 flex flex-col bg-bg" />
        <aside id="relay" className="w-[292px] shrink-0 border-l border-border bg-panel flex flex-col" />
      </div>
      <div id="statusbar" className="h-7 shrink-0 border-t border-border bg-panel" />
    </div>
  )
}
```

- [ ] **Step 10: Typecheck, test, run**

Run: `npm run typecheck && npm test`
Expected: exit 0, all green.

Run: `npm run dev` for ~10 s.
Expected: window shows the four empty regions with the right widths and borders; fonts load (inspect a text node in DevTools → Computed → font-family resolves to Geist).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(renderer): fonts, tokens, formatting helpers, store, layout shell"
```

---

### Task 12: Sidebar and SessionRow

**Files:**
- Create: `src/renderer/src/components/SessionRow.tsx`, `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/components/StatusDot.tsx`, `src/renderer/src/components/NewSessionPopover.tsx`
- Modify: `src/renderer/src/App.tsx` (mount `<Sidebar />` in `#sidebar`)
- Test: `tests/renderer/sidebar.test.tsx`

**Interfaces:**
- Consumes: `useStore`, `stateLabel`, `STATE_COLOR`, `cwdTail`, `cn` (Task 11).
- Produces: `<StatusDot state size? />`, `<SessionRow session selected multi onSelect(e) onPin() />`, `<Sidebar />`, `<NewSessionPopover />`.

- [ ] **Step 1: Write the failing tests**

`tests/renderer/sidebar.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { installMockCsm } from './mockCsm'
import { useStore } from '@renderer/store'
import { Sidebar } from '@renderer/components/Sidebar'
import { SessionRow } from '@renderer/components/SessionRow'
import type { Session } from '@shared/types'

const s = (id: string, over: Partial<Session> = {}): Session => ({ sessionId: id, pid: 1, name: id, cwd: '/Users/dev/' + id, startedAt: 0, version: '', registryStatus: 'idle', state: 'idle', origin: 'local', alive: true, lastActivityAt: 0, lastActivityPreview: 'preview ' + id, pinned: false, turnOutputTokens: 0, ...over })

beforeEach(() => { useStore.getState().reset(); installMockCsm() })

describe('SessionRow', () => {
  it('renders name, state label, LOCAL badge, and a pulsing dot when working', () => {
    render(<SessionRow session={s('auth', { state: 'working' })} selected={false} multi={false} onSelect={() => {}} onPin={() => {}} />)
    expect(screen.getByText('auth')).toBeInTheDocument()
    expect(screen.getByText('preview auth')).toBeInTheDocument()
    expect(screen.getByText('LOCAL')).toBeInTheDocument()
    expect(screen.getByTestId('dot')).toHaveClass('animate-pulse-dot')
  })
  it('shows waiting/ended labels with their colors', () => {
    const { rerender } = render(<SessionRow session={s('x', { state: 'waiting' })} selected={false} multi={false} onSelect={() => {}} onPin={() => {}} />)
    expect(screen.getByText('Waiting — likely permission')).toBeInTheDocument()
    rerender(<SessionRow session={s('x', { state: 'ended', lastActivityAt: Date.now() })} selected={false} multi={false} onSelect={() => {}} onPin={() => {}} />)
    expect(screen.getByText(/^Ended — /)).toBeInTheDocument()
  })
  it('calls onSelect with the click event and onPin from the star', () => {
    let selected = 0; let pinned = 0
    render(<SessionRow session={s('x')} selected={false} multi={false} onSelect={() => selected++} onPin={() => pinned++} />)
    fireEvent.click(screen.getByRole('button', { name: /select x/i }))
    fireEvent.click(screen.getByRole('button', { name: /pin/i }))
    expect(selected).toBe(1); expect(pinned).toBe(1)
  })
  it('exposes the cwd for hover display', () => {
    render(<SessionRow session={s('x')} selected={false} multi={false} onSelect={() => {}} onPin={() => {}} />)
    expect(screen.getByText('~/x')).toBeInTheDocument()
  })
})

describe('Sidebar', () => {
  it('groups pinned first, sorts by last activity, filters by name, shows the count, and multi-selects with meta-click', async () => {
    useStore.setState({
      ready: true,
      sessions: { a: s('alpha', { sessionId: 'a', lastActivityAt: 1 }), b: s('beta', { sessionId: 'b', lastActivityAt: 9 }), c: s('gamma', { sessionId: 'c', lastActivityAt: 5, pinned: true }) },
      prefs: { pinned: ['c'], bookmarks: [], promptHistory: [] },
    })
    render(<Sidebar />)
    const pinned = screen.getByTestId('group-pinned'); const all = screen.getByTestId('group-all')
    expect(within(pinned).getByText('gamma')).toBeInTheDocument()
    expect(within(all).getAllByRole('button', { name: /select/i }).map((b) => b.getAttribute('aria-label'))).toEqual(['select beta', 'select alpha'])
    expect(screen.getByText('3 sessions')).toBeInTheDocument()
    fireEvent.click(within(all).getByRole('button', { name: 'select beta' }))
    expect(useStore.getState().selectedId).toBe('b')
    fireEvent.click(within(all).getByRole('button', { name: 'select alpha' }), { metaKey: true })
    expect(useStore.getState().multiIds).toEqual(['b', 'a'])
    fireEvent.change(screen.getByPlaceholderText('Filter sessions'), { target: { value: 'gam' } })
    expect(screen.queryByText('beta')).not.toBeInTheDocument()
    expect(screen.getByText('gamma')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/renderer/sidebar.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write StatusDot, SessionRow, NewSessionPopover, Sidebar**

`src/renderer/src/components/StatusDot.tsx`:
```tsx
import type { SessionState } from '@shared/types'
import { cn, STATE_COLOR } from '../lib/format'

export function StatusDot({ state, size = 7, className }: { state: SessionState; size?: number; className?: string }) {
  const color = STATE_COLOR[state]
  return (
    <span data-testid="dot" className={cn('inline-block rounded-full shrink-0', state === 'working' && 'animate-pulse-dot', className)}
      style={{ width: size, height: size, background: color, boxShadow: state === 'working' ? `0 0 6px ${color}99` : undefined }} />
  )
}
```

`src/renderer/src/components/SessionRow.tsx`:
```tsx
import type { MouseEvent } from 'react'
import type { Session } from '@shared/types'
import { cn, cwdTail, stateLabel } from '../lib/format'
import { StatusDot } from './StatusDot'

export function SessionRow({ session, selected, multi, onSelect, onPin }: { session: Session; selected: boolean; multi: boolean; onSelect: (e: MouseEvent) => void; onPin: () => void }) {
  const label = stateLabel(session)
  const labelColor = session.state === 'waiting' ? 'text-waiting' : session.state === 'ended' ? 'text-faint' : 'text-muted'
  return (
    <div className={cn('group relative flex items-center gap-2 px-2 py-[5px] rounded-md cursor-default', (selected || multi) && 'bg-raised', multi && 'ring-1 ring-cross/50')}>
      <button aria-label={`select ${session.name}`} onClick={onSelect} className="absolute inset-0 rounded-md" />
      <StatusDot state={session.state} />
      <div className="flex-1 min-w-0 pointer-events-none">
        <div className={cn('font-medium text-[12px] truncate', selected ? 'text-fg' : session.state === 'idle' || session.state === 'ended' ? 'text-muted' : 'text-fg-soft')}>{session.name}</div>
        <div className={cn('font-mono text-[10px] truncate group-hover:hidden', labelColor)}>{label}</div>
        <div className="font-mono text-[10px] truncate text-muted hidden group-hover:block">{cwdTail(session.cwd)}</div>
      </div>
      <span className="relative font-mono font-semibold text-[8.5px] text-muted border border-border rounded px-1 group-hover:hidden">{session.origin.toUpperCase()}</span>
      <button aria-label={session.pinned ? 'unpin' : 'pin'} onClick={(e) => { e.stopPropagation(); onPin() }}
        className={cn('relative hidden group-hover:block text-[11px] leading-none px-1', session.pinned ? 'text-fg' : 'text-muted hover:text-fg')}>★</button>
    </div>
  )
}
```

`src/renderer/src/components/NewSessionPopover.tsx`:
```tsx
import * as Popover from '@radix-ui/react-popover'
import { useState } from 'react'

/** v1 does not spawn terminals: it hands the user a ready-to-paste `claude -n <name>` command. */
export function NewSessionPopover() {
  const [name, setName] = useState('')
  const cmd = `claude -n ${name.trim() || '<name>'}`
  return (
    <Popover.Root>
      <Popover.Trigger className="text-[10.5px] text-muted hover:text-fg">+ New</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="end" className="w-64 rounded-lg border border-border bg-panel p-3 shadow-xl text-[11.5px] space-y-2">
          <div className="text-fg font-medium">Start a named session</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="session name" className="w-full h-7 rounded-md bg-bg border border-input px-2 text-fg outline-none" />
          <code className="block font-mono text-[10.5px] text-muted bg-bg rounded px-2 py-1 truncate">{cmd}</code>
          <button className="h-7 w-full rounded-md bg-primary text-primary-fg font-semibold text-[11px]" onClick={() => void navigator.clipboard.writeText(cmd)}>Copy command</button>
          <div className="text-faint text-[10px]">Run it in a terminal; the session appears here automatically.</div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
```

`src/renderer/src/components/Sidebar.tsx`:
```tsx
import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { SessionRow } from './SessionRow'
import { NewSessionPopover } from './NewSessionPopover'

export function Sidebar() {
  const sessions = useStore((s) => s.sessions)
  const selectedId = useStore((s) => s.selectedId)
  const multiIds = useStore((s) => s.multiIds)
  const select = useStore((s) => s.select)
  const togglePin = useStore((s) => s.togglePin)
  const [filter, setFilter] = useState('')

  const { pinned, all, total } = useMemo(() => {
    const list = Object.values(sessions).filter((s) => s.name.toLowerCase().includes(filter.trim().toLowerCase()))
    const sorted = list.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    return { pinned: sorted.filter((s) => s.pinned), all: sorted.filter((s) => !s.pinned), total: Object.keys(sessions).length }
  }, [sessions, filter])

  const row = (s: (typeof all)[number]) => (
    <SessionRow key={s.sessionId} session={s} selected={s.sessionId === selectedId && multiIds.length === 0} multi={multiIds.includes(s.sessionId)}
      onSelect={(e) => select(s.sessionId, e.metaKey || e.ctrlKey)} onPin={() => void togglePin(s.sessionId)} />
  )

  return (
    <>
      <div className="p-[10px] pb-[6px]">
        <div className="flex items-center gap-2 h-[26px] rounded-md bg-bg border border-input px-2">
          <span className="text-muted text-[11px]">⌕</span>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter sessions" className="flex-1 bg-transparent outline-none text-[11.5px] text-fg placeholder:text-muted" />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-[6px] flex flex-col gap-[1px]">
        {pinned.length > 0 && (
          <div data-testid="group-pinned">
            <div className="font-mono font-semibold text-[9.5px] tracking-[.1em] text-faint px-2 pt-[5px] pb-[3px]">PINNED</div>
            {pinned.map(row)}
          </div>
        )}
        <div data-testid="group-all">
          <div className="font-mono font-semibold text-[9.5px] tracking-[.1em] text-faint px-2 pt-2 pb-[3px]">ALL SESSIONS</div>
          {all.map(row)}
          {all.length === 0 && pinned.length === 0 && <div className="px-2 py-4 text-[11px] text-faint">No sessions{filter ? ' match' : ' yet — start one with claude'}</div>}
        </div>
      </div>
      <div className="mt-auto px-3 py-2 border-t border-border flex items-center text-[10.5px] text-muted">
        <span>{total} session{total === 1 ? '' : 's'}</span>
        <span className="ml-auto"><NewSessionPopover /></span>
      </div>
    </>
  )
}
```

- [ ] **Step 4: Mount it in App.tsx**

In `src/renderer/src/App.tsx`, import `{ Sidebar } from './components/Sidebar'` and replace the empty `<aside id="sidebar" …/>` with `<aside id="sidebar" className={…same classes…}><Sidebar /></aside>`.

- [ ] **Step 5: Run tests, typecheck, look at it**

Run: `npx vitest run tests/renderer/sidebar.test.tsx && npm run typecheck`
Expected: 5 passed; exit 0.

Run: `npm run dev` — with live sessions open, the sidebar lists them with pulsing dots for busy ones; hovering a row swaps the second line to the cwd and reveals ★; ⌘-click highlights several rows.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(renderer): sidebar with session rows, pinning, filter, multi-select"
```

---

### Task 13: Transcript view

**Files:**
- Create: `src/renderer/src/components/Transcript.tsx`, `src/renderer/src/components/messages/MessageUser.tsx`, `MessageClaude.tsx`, `MessageCross.tsx`, `MessageTool.tsx`, `MessageSent.tsx`, `SystemRow.tsx`, `Divider.tsx`, `CodeBlock.tsx`, `StreamingIndicator.tsx`, `src/renderer/src/components/SessionHeader.tsx`, `src/renderer/src/lib/rich.ts`
- Modify: `src/renderer/src/App.tsx` (mount `<SessionHeader />` + `<Transcript />` in `#center`)
- Test: `tests/renderer/transcript.test.tsx`, `tests/renderer/rich.test.ts`

**Interfaces:**
- Consumes: store, `hhmm`, `shortTokens`, `nearestIndex`, `applyUpdates` (Task 11), `StatusDot` (Task 12).
- Produces: `splitRich(text): Array<{ type: 'text'; text: string } | { type: 'code'; lang?: string; code: string }>`; `<Transcript />` (reads selected session from the store; honors `jumpTarget`; context menu Copy/Bookmark/Jump to sender); `<SessionHeader />`.

- [ ] **Step 1: Write the failing rich-text test**

`tests/renderer/rich.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { splitRich } from '@renderer/lib/rich'

describe('splitRich', () => {
  it('splits fenced code out of prose and keeps language', () => {
    expect(splitRich('Here:\n```ts\nconst a = 1\n```\nand after')).toEqual([
      { type: 'text', text: 'Here:' }, { type: 'code', lang: 'ts', code: 'const a = 1' }, { type: 'text', text: 'and after' },
    ])
  })
  it('handles unterminated fences and no fences', () => {
    expect(splitRich('plain')).toEqual([{ type: 'text', text: 'plain' }])
    expect(splitRich('x\n```\nopen')).toEqual([{ type: 'text', text: 'x' }, { type: 'code', lang: undefined, code: 'open' }])
  })
})
```

- [ ] **Step 2: Write rich.ts and run**

`src/renderer/src/lib/rich.ts`:
```ts
export type RichPart = { type: 'text'; text: string } | { type: 'code'; lang?: string; code: string }

export function splitRich(text: string): RichPart[] {
  const parts: RichPart[] = []
  const re = /```([^\n`]*)\n([\s\S]*?)(?:\n```|$)/g
  let last = 0; let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const before = text.slice(last, m.index).trim()
    if (before) parts.push({ type: 'text', text: before })
    parts.push({ type: 'code', lang: m[1]?.trim() || undefined, code: m[2] ?? '' })
    last = m.index + m[0].length
  }
  const rest = text.slice(last).trim()
  if (rest) parts.push({ type: 'text', text: rest })
  return parts.length ? parts : [{ type: 'text', text: '' }]
}
```

Run: `npx vitest run tests/renderer/rich.test.ts` → 2 passed.

- [ ] **Step 3: Write the failing transcript tests**

`tests/renderer/transcript.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { installMockCsm } from './mockCsm'
import { useStore } from '@renderer/store'
import { Transcript } from '@renderer/components/Transcript'
import { SessionHeader } from '@renderer/components/SessionHeader'
import type { Session, TranscriptEvent } from '@shared/types'

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent }: any) => <div data-testid="list">{data.map((d: any, i: number) => <div key={i}>{itemContent(i, d)}</div>)}</div>,
}))

const s = (over: Partial<Session> = {}): Session => ({ sessionId: 'a', pid: 1, name: 'auth-refactor', cwd: '/Users/dev/acme-api', startedAt: Date.now(), version: '', registryStatus: 'busy', state: 'working', origin: 'local', alive: true, lastActivityAt: 0, lastActivityPreview: '', pinned: false, turnOutputTokens: 2100, model: 'claude-sonnet-4-6', permissionMode: 'bypassPermissions', ...over })
const events: TranscriptEvent[] = [
  { kind: 'divider', id: 'd', ts: 0, text: 'session started 00:00' },
  { kind: 'user', id: 'u', ts: 1, text: 'Refactor it' },
  { kind: 'claude', id: 'c', ts: 2, text: 'Sure.\n```ts\nconst x = 1\n```' },
  { kind: 'cross', id: 'x', ts: 3, fromName: 'perf-query-cache', text: 'Heads up' },
  { kind: 'tool', id: 't', ts: 4, name: 'Bash', input: { command: 'npm test' }, resultText: '12 passed' },
  { kind: 'sent', id: 's', ts: 5, to: ['perf-query-cache'], text: 'thanks' },
  { kind: 'system', id: 'sy', ts: 6, text: '/rename' },
]

beforeEach(() => { useStore.getState().reset(); installMockCsm(); useStore.setState({ ready: true, sessions: { a: s() }, selectedId: 'a', transcripts: { a: { events, meta: {} } } }) })

describe('Transcript', () => {
  it('renders every event kind with its visual identity', () => {
    render(<Transcript />)
    expect(screen.getByText(/session started/)).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument(); expect(screen.getByText('Refactor it')).toBeInTheDocument()
    expect(screen.getByText('✳ Claude')).toBeInTheDocument(); expect(screen.getByText('const x = 1')).toBeInTheDocument()
    expect(screen.getByText('⇄ from perf-query-cache')).toBeInTheDocument()
    expect(screen.getByText('Bash: npm test')).toBeInTheDocument()
    expect(screen.getByText('→ perf-query-cache')).toBeInTheDocument()
    expect(screen.getByText('/rename')).toBeInTheDocument()
  })
  it('shows the streaming indicator with token count while working after a claude/tool event', () => {
    render(<Transcript />)
    expect(screen.getByText(/streaming · 2\.1k tokens/)).toBeInTheDocument()
  })
  it('hides the streaming indicator when idle', () => {
    useStore.setState({ sessions: { a: s({ state: 'idle' }) } })
    render(<Transcript />)
    expect(screen.queryByText(/streaming/)).not.toBeInTheDocument()
  })
  it('expands a tool row to reveal its result', () => {
    render(<Transcript />)
    fireEvent.click(screen.getByText('Bash: npm test'))
    expect(screen.getByText('12 passed')).toBeInTheDocument()
  })
  it('Reply on a cross message prefills the draft and targets the sender', () => {
    useStore.setState({ sessions: { a: s(), b: s({ sessionId: 'b', name: 'perf-query-cache' }) } })
    render(<Transcript />)
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    expect(useStore.getState().multiIds).toEqual(['b'])
    expect(useStore.getState().draft).toMatch(/^@perf-query-cache /)
  })
  it('shows an empty state when the session has no transcript file', () => {
    useStore.setState({ transcripts: { a: { events: [], meta: {} } } })
    render(<Transcript />)
    expect(screen.getByText(/Transcript not found/)).toBeInTheDocument()
  })
})

describe('SessionHeader', () => {
  it('shows name, state chip, meta line, and toggles pin / exports', async () => {
    const { csm } = installMockCsm()
    render(<SessionHeader />)
    expect(screen.getByText('auth-refactor')).toBeInTheDocument()
    expect(screen.getByText('WORKING')).toBeInTheDocument()
    expect(screen.getByText(/~\/acme-api · claude-sonnet-4-6 · started/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    expect(csm.exportTranscript).toHaveBeenCalledWith('a')
    fireEvent.click(screen.getByRole('button', { name: /pin/i }))
    expect(csm.setPrefs).toHaveBeenCalledWith({ pinned: ['a'] })
  })
})
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run tests/renderer/transcript.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 5: Write the message components**

`src/renderer/src/components/messages/CodeBlock.tsx`:
```tsx
import { useState } from 'react'

export function CodeBlock({ code, title }: { code: string; title?: string }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="mt-[7px] rounded-lg border border-border bg-[oklch(0.2_0_0)] overflow-hidden">
      <div className="flex items-center px-[11px] py-[5px] border-b border-border font-mono text-[10px] text-muted">
        <span className="truncate">{title ?? 'code'}</span>
        <span className="ml-auto text-faint flex gap-2">
          <button className="hover:text-fg" onClick={() => void navigator.clipboard.writeText(code)}>Copy</button>
          <button className="hover:text-fg" onClick={() => setOpen((o) => !o)}>{open ? 'Collapse' : 'Expand'}</button>
        </span>
      </div>
      {open && <pre className="m-0 px-[13px] py-[10px] font-mono text-[11.5px] leading-[1.55] text-fg-soft overflow-x-auto whitespace-pre">{code}</pre>}
    </div>
  )
}
```

`src/renderer/src/components/messages/MessageUser.tsx`:
```tsx
import { hhmm } from '../../lib/format'

export function MessageUser({ text, ts }: { text: string; ts: number }) {
  return (
    <div className="self-end max-w-[68%]">
      <div className="flex justify-end gap-2 font-mono text-[10px] text-faint mb-[3px]"><span>You</span><span>{hhmm(ts)}</span></div>
      <div className="bg-raised rounded-[10px_10px_3px_10px] px-3 py-2 text-[12.5px] leading-[1.5] text-fg whitespace-pre-wrap">{text}</div>
    </div>
  )
}
```

`src/renderer/src/components/messages/MessageClaude.tsx`:
```tsx
import { hhmm } from '../../lib/format'
import { splitRich } from '../../lib/rich'
import { CodeBlock } from './CodeBlock'

export function MessageClaude({ text, ts }: { text: string; ts: number }) {
  return (
    <div className="max-w-[82%]">
      <div className="flex gap-2 font-mono text-[10px] text-faint mb-[3px]"><span className="text-claude">✳ Claude</span><span>{hhmm(ts)}</span></div>
      {splitRich(text).map((p, i) => p.type === 'text'
        ? <div key={i} className="text-[12.5px] leading-[1.55] text-fg-soft whitespace-pre-wrap">{p.text}</div>
        : <CodeBlock key={i} code={p.code} title={p.lang} />)}
    </div>
  )
}
```

`src/renderer/src/components/messages/MessageCross.tsx`:
```tsx
import { hhmm } from '../../lib/format'

export function MessageCross({ fromName, text, ts, onReply, onJump }: { fromName: string; text: string; ts: number; onReply: () => void; onJump?: () => void }) {
  return (
    <div className="max-w-[82%]">
      <div className="flex items-center gap-2 font-mono text-[10px] mb-[3px]">
        <span className="inline-flex items-center gap-1 font-semibold text-cross bg-cross/10 border border-cross/30 rounded-full px-[7px] py-[1px]">⇄ from {fromName}</span>
        <span className="text-faint">{hhmm(ts)}</span>
      </div>
      <div className="border-l-[3px] border-cross bg-cross/[.06] rounded-r-lg px-3 py-2 text-[12.5px] leading-[1.5] text-cross-fg whitespace-pre-wrap">{text}</div>
      <div className="text-[10px] text-faint mt-[2px] flex gap-2">
        <button className="hover:text-fg" onClick={onReply}>Reply</button>
        {onJump && <button className="hover:text-fg" onClick={onJump}>Jump to sender ↗</button>}
      </div>
    </div>
  )
}
```

`src/renderer/src/components/messages/MessageTool.tsx`:
```tsx
import { useState } from 'react'
import { cn } from '../../lib/format'

function summary(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  const arg = i.command ?? i.file_path ?? i.pattern ?? i.query ?? i.to ?? i.url ?? ''
  return arg ? `${name}: ${String(arg)}` : name
}

export function MessageTool({ name, input, resultText, isError }: { name: string; input: unknown; resultText?: string; isError?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="max-w-[82%]">
      <button onClick={() => setOpen((o) => !o)} className={cn('flex items-center gap-2 font-mono text-[10.5px] text-faint hover:text-muted', isError && 'text-error')}>
        <span>{open ? '▾' : '▸'}</span>
        <span className="truncate">{summary(name, input)}</span>
        <span className="text-faint">{resultText === undefined ? '· running' : isError ? '· error' : '· done'}</span>
      </button>
      {open && (
        <div className="mt-1 rounded-lg border border-border bg-[oklch(0.2_0_0)] p-2 font-mono text-[10.5px] text-muted space-y-2">
          <pre className="m-0 whitespace-pre-wrap break-all">{JSON.stringify(input, null, 2)}</pre>
          {resultText !== undefined && <pre className="m-0 whitespace-pre-wrap break-all text-fg-soft border-t border-border pt-2">{resultText.length > 4000 ? resultText.slice(0, 4000) + '…' : resultText}</pre>}
        </div>
      )}
    </div>
  )
}
```

`src/renderer/src/components/messages/MessageSent.tsx`:
```tsx
import { hhmm } from '../../lib/format'

export function MessageSent({ to, text, ts }: { to: string[]; text: string; ts: number }) {
  return (
    <div className="self-end max-w-[68%]">
      <div className="flex justify-end gap-2 font-mono text-[10px] mb-[3px]"><span className="text-cross">→ {to.join(', ')}</span><span className="text-faint">{hhmm(ts)}</span></div>
      <div className="border-r-[3px] border-cross bg-cross/[.06] rounded-l-lg px-3 py-2 text-[12.5px] leading-[1.5] text-cross-fg whitespace-pre-wrap">{text}</div>
    </div>
  )
}
```

`src/renderer/src/components/messages/SystemRow.tsx`:
```tsx
export function SystemRow({ text }: { text: string }) {
  const clean = text.replace(/<[^>]+>/g, '').trim() || text
  return <div className="self-center font-mono text-[10.5px] text-faint bg-raised/40 border border-border rounded-md px-[11px] py-[3px]">{clean}</div>
}
```

`src/renderer/src/components/messages/Divider.tsx`:
```tsx
import { hhmm } from '../../lib/format'

export function Divider({ text, ts }: { text: string; ts: number }) {
  const label = text.replace(/\d\d:\d\d$/, hhmm(ts))
  return (
    <div className="self-center flex items-center gap-2 font-mono text-[10.5px] text-faint">
      <span className="w-[60px] h-px bg-border" />{label}<span className="w-[60px] h-px bg-border" />
    </div>
  )
}
```

`src/renderer/src/components/messages/StreamingIndicator.tsx`:
```tsx
import { shortTokens } from '../../lib/format'

export function StreamingIndicator({ tokens }: { tokens: number }) {
  return (
    <div className="max-w-[82%]">
      <div className="flex gap-2 font-mono text-[10px] text-faint mb-[3px]"><span className="text-claude">✳ Claude</span><span>now</span></div>
      <div className="text-[12.5px] text-fg-soft">Working<span className="inline-block w-[7px] h-[13px] bg-claude ml-[3px] align-[-2px] animate-blink" /></div>
      <div className="flex items-center gap-[7px] mt-[5px] font-mono text-[10px] text-faint"><span className="w-[5px] h-[5px] rounded-full bg-working animate-pulse-dot" />streaming · {shortTokens(tokens)} tokens</div>
    </div>
  )
}
```

- [ ] **Step 6: Write Transcript.tsx and SessionHeader.tsx**

`src/renderer/src/components/Transcript.tsx`:
```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import * as ContextMenu from '@radix-ui/react-context-menu'
import type { TranscriptEvent } from '@shared/types'
import { useStore, useSelected } from '../store'
import { nearestIndex } from '../lib/events'
import { firstLine } from '../lib/format'
import { MessageUser } from './messages/MessageUser'
import { MessageClaude } from './messages/MessageClaude'
import { MessageCross } from './messages/MessageCross'
import { MessageTool } from './messages/MessageTool'
import { MessageSent } from './messages/MessageSent'
import { SystemRow } from './messages/SystemRow'
import { Divider } from './messages/Divider'
import { StreamingIndicator } from './messages/StreamingIndicator'

const textOf = (e: TranscriptEvent) => ('text' in e ? e.text : e.kind === 'tool' ? `${e.name} ${JSON.stringify(e.input)}` : '')

export function Transcript() {
  const session = useSelected()
  const transcript = useStore((s) => (s.selectedId ? s.transcripts[s.selectedId] : undefined))
  const sessions = useStore((s) => s.sessions)
  const jumpTarget = useStore((s) => s.jumpTarget)
  const consumeJump = useStore((s) => s.consumeJump)
  const select = useStore((s) => s.select)
  const setDraft = useStore((s) => s.setDraft)
  const addBookmark = useStore((s) => s.addBookmark)
  const jump = useStore((s) => s.jump)
  const ref = useRef<VirtuosoHandle>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [pending, setPending] = useState(0)

  const events = transcript?.events ?? []
  const last = events[events.length - 1]
  const streaming = session?.state === 'working' && last !== undefined && (last.kind === 'claude' || last.kind === 'tool' || last.kind === 'sent')
  const items = useMemo<(TranscriptEvent | { kind: 'streaming'; id: '__streaming'; ts: number })[]>(
    () => (streaming ? [...events, { kind: 'streaming', id: '__streaming', ts: Date.now() }] : events), [events, streaming])

  // Follow the tail unless the user scrolled up; count what arrived meanwhile.
  const prevLen = useRef(items.length)
  useEffect(() => {
    if (items.length > prevLen.current) {
      if (atBottom) ref.current?.scrollToIndex({ index: items.length - 1, align: 'end' })
      else setPending((p) => p + (items.length - prevLen.current))
    }
    prevLen.current = items.length
  }, [items.length, atBottom])
  useEffect(() => { if (atBottom) setPending(0) }, [atBottom])

  // Jump requests from the feed / search / history.
  useEffect(() => {
    if (!jumpTarget || jumpTarget.sessionId !== session?.sessionId || events.length === 0) return
    const idx = jumpTarget.eventId ? events.findIndex((e) => e.id === jumpTarget.eventId) : jumpTarget.ts !== undefined ? nearestIndex(events, jumpTarget.ts) : -1
    if (idx >= 0) ref.current?.scrollToIndex({ index: idx, align: 'center', behavior: 'smooth' })
    consumeJump()
  }, [jumpTarget, session?.sessionId, events, consumeJump])

  if (!session) return <div className="flex-1 flex items-center justify-center text-faint">Select a session</div>
  if (!session.transcriptPath && events.length === 0) return <div className="flex-1 flex items-center justify-center text-faint text-[12px]">Transcript not found for this session yet</div>

  const senderId = (name: string) => Object.values(sessions).find((s) => s.name === name)?.sessionId
  const reply = (fromName: string) => {
    const id = senderId(fromName)
    if (id) { select(id, true); useStore.setState({ multiIds: [id] }) }
    setDraft(`@${fromName} `)
  }

  const render = (e: (typeof items)[number]) => {
    switch (e.kind) {
      case 'streaming': return <StreamingIndicator tokens={session.turnOutputTokens} />
      case 'divider': return <Divider text={e.text} ts={e.ts} />
      case 'user': return <MessageUser text={e.text} ts={e.ts} />
      case 'claude': return <MessageClaude text={e.text} ts={e.ts} />
      case 'cross': { const sid = senderId(e.fromName); return <MessageCross fromName={e.fromName} text={e.text} ts={e.ts} onReply={() => reply(e.fromName)} onJump={sid ? () => jump({ sessionId: sid, ts: e.ts }) : undefined} /> }
      case 'tool': return <MessageTool name={e.name} input={e.input} resultText={e.resultText} isError={e.isError} />
      case 'sent': return <MessageSent to={e.to} text={e.text} ts={e.ts} />
      case 'system': return <SystemRow text={e.text} />
    }
  }

  return (
    <div className="flex-1 min-h-0 relative">
      <Virtuoso ref={ref} data={items} className="h-full" atBottomStateChange={setAtBottom} followOutput={atBottom ? 'smooth' : false} initialTopMostItemIndex={Math.max(0, items.length - 1)}
        computeItemKey={(_, e) => e.id}
        itemContent={(_, e) => (
          <ContextMenu.Root>
            <ContextMenu.Trigger asChild>
              <div className="px-5 py-[5px] flex flex-col">{render(e)}</div>
            </ContextMenu.Trigger>
            {e.kind !== 'streaming' && (
              <ContextMenu.Portal>
                <ContextMenu.Content className="min-w-40 rounded-md border border-border bg-panel p-1 text-[11.5px] shadow-xl">
                  <ContextMenu.Item className="px-2 py-1 rounded hover:bg-raised outline-none" onSelect={() => void navigator.clipboard.writeText(textOf(e))}>Copy</ContextMenu.Item>
                  <ContextMenu.Item className="px-2 py-1 rounded hover:bg-raised outline-none" onSelect={() => void addBookmark({ sessionId: session.sessionId, eventId: e.id, ts: e.ts, preview: firstLine(textOf(e), 80) })}>Bookmark</ContextMenu.Item>
                  {e.kind === 'cross' && senderId(e.fromName) && <ContextMenu.Item className="px-2 py-1 rounded hover:bg-raised outline-none" onSelect={() => jump({ sessionId: senderId(e.fromName)!, ts: e.ts })}>Jump to sender</ContextMenu.Item>}
                </ContextMenu.Content>
              </ContextMenu.Portal>
            )}
          </ContextMenu.Root>
        )} />
      {!atBottom && pending > 0 && (
        <button onClick={() => ref.current?.scrollToIndex({ index: items.length - 1, align: 'end', behavior: 'smooth' })}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-primary text-primary-fg text-[11px] font-semibold px-3 py-1 shadow">↓ {pending} new</button>
      )}
    </div>
  )
}
```

`src/renderer/src/components/SessionHeader.tsx`:
```tsx
import { useStore, useSelected } from '../store'
import { cwdTail, hhmm, cn, STATE_COLOR } from '../lib/format'
import { StatusDot } from './StatusDot'

export function SessionHeader() {
  const session = useSelected()
  const togglePin = useStore((s) => s.togglePin)
  if (!session) return <div className="h-[50px] border-b border-border" />
  const color = STATE_COLOR[session.state]
  return (
    <div className="h-[50px] shrink-0 border-b border-border flex items-center gap-3 px-[18px]">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[14px] text-fg">{session.name}</span>
          <span className="inline-flex items-center gap-[5px] font-mono font-medium text-[10px] rounded-full px-[7px] py-[1px] border" style={{ color, background: `${color}1a`, borderColor: `${color}40` }}>
            <StatusDot state={session.state} size={5} />{session.state.toUpperCase()}
          </span>
        </div>
        <div className="font-mono text-[10.5px] text-faint mt-[1px]">{cwdTail(session.cwd)} · {session.model ?? '—'} · started {hhmm(session.startedAt)}{session.aiTitle ? ` · ${session.aiTitle}` : ''}</div>
      </div>
      <div className="ml-auto flex gap-[6px]">
        <button aria-label="export markdown" onClick={() => void window.csm.exportTranscript(session.sessionId)} className="h-6 px-[9px] rounded-md border border-border text-[11px] font-medium text-muted hover:text-fg">Export .md</button>
        <button aria-label={session.pinned ? 'unpin session' : 'pin session'} onClick={() => void togglePin(session.sessionId)} className={cn('h-6 px-[9px] rounded-md border border-border text-[11px] font-medium', session.pinned ? 'text-fg bg-raised' : 'text-muted hover:text-fg')}>★ {session.pinned ? 'Pinned' : 'Pin'}</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Mount in App.tsx**

Replace the empty `<main id="center" …/>` with:
```tsx
<main id="center" className="flex-1 min-w-0 flex flex-col bg-bg">
  <SessionHeader />
  <Transcript />
</main>
```
and add the two imports.

- [ ] **Step 8: Run tests, typecheck, look**

Run: `npx vitest run tests/renderer/transcript.test.tsx tests/renderer/rich.test.ts && npm run typecheck`
Expected: 9 passed; exit 0. If the "Reply" test fails because `select(id, true)` toggles rather than sets, the explicit `useStore.setState({ multiIds: [id] })` after it is what the test asserts — keep both lines.

Run: `npm run dev` — select a busy session: the transcript fills, follows the tail, shows the blinking cursor + token count; scroll up while it works and the "↓ N new" pill appears; right-click a message for the context menu.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(renderer): transcript view with message kinds, streaming, jumps, context menu"
```

---

### Task 14: Relay panel and bridge status

**Files:**
- Create: `src/renderer/src/components/RelayPanel.tsx`, `src/renderer/src/components/BridgeStatusChip.tsx`, `src/renderer/src/components/TargetPicker.tsx`
- Modify: `src/renderer/src/App.tsx` (mount `<RelayPanel />` in `#relay`)
- Test: `tests/renderer/relay.test.tsx`

**Interfaces:**
- Consumes: store (`draft`, `bridge`, `useTargets`, `prefs.promptHistory`), `modKey` (Task 11).
- Produces: `<BridgeStatusChip state />`, `<TargetPicker />`, `<RelayPanel />`; `QUICK_PROMPTS: { label: string; text: string }[]`; `needsApproval(permissionMode?: string): boolean`.

- [ ] **Step 1: Write the failing tests**

`tests/renderer/relay.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { installMockCsm } from './mockCsm'
import { useStore } from '@renderer/store'
import { RelayPanel, needsApproval } from '@renderer/components/RelayPanel'
import { BridgeStatusChip } from '@renderer/components/BridgeStatusChip'
import type { Session } from '@shared/types'

const s = (id: string, over: Partial<Session> = {}): Session => ({ sessionId: id, pid: 1, name: id, cwd: '/x', startedAt: 0, version: '', registryStatus: 'idle', state: 'idle', origin: 'local', alive: true, lastActivityAt: 0, lastActivityPreview: '', pinned: false, turnOutputTokens: 0, permissionMode: 'bypassPermissions', ...over })

beforeEach(() => { useStore.getState().reset() })

describe('BridgeStatusChip', () => {
  it('renders the four states', () => {
    const { rerender } = render(<BridgeStatusChip state={{ status: 'connected', bridgeName: 'b', latencyMs: 84 }} />)
    expect(screen.getByText(/Bridge connected/)).toBeInTheDocument(); expect(screen.getByText(/84 ?ms/)).toBeInTheDocument()
    rerender(<BridgeStatusChip state={{ status: 'reconnecting', attempt: 2, max: 5 }} />)
    expect(screen.getByText(/Reconnecting… attempt 2\/5/)).toBeInTheDocument()
    rerender(<BridgeStatusChip state={{ status: 'unavailable', reason: 'x' }} />)
    expect(screen.getByText(/Bridge unavailable/)).toBeInTheDocument()
    rerender(<BridgeStatusChip state={{ status: 'relaying', targets: ['a', 'b'] }} />)
    expect(screen.getByText(/Relaying prompt… → 2 targets/)).toBeInTheDocument()
  })
})

describe('needsApproval', () => {
  it('is false for bypass/acceptEdits and true otherwise', () => {
    expect(needsApproval('bypassPermissions')).toBe(false); expect(needsApproval('acceptEdits')).toBe(false)
    expect(needsApproval('default')).toBe(true); expect(needsApproval(undefined)).toBe(true)
  })
})

describe('RelayPanel', () => {
  it('sends to the selected session on mod+Enter, shows the result, and clears the draft', async () => {
    const { csm } = installMockCsm()
    useStore.setState({ ready: true, sessions: { a: s('auth') }, selectedId: 'a', bridge: { status: 'connected', bridgeName: 'b' } })
    render(<RelayPanel />)
    expect(screen.getByText('auth')).toBeInTheDocument()
    const ta = screen.getByPlaceholderText(/Message auth/)
    fireEvent.change(ta, { target: { value: 'status?' } })
    fireEvent.keyDown(ta, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(csm.relay).toHaveBeenCalledWith(['auth'], 'status?'))
    await waitFor(() => expect(screen.getByText(/Sent to auth/)).toBeInTheDocument())
    expect((ta as HTMLTextAreaElement).value).toBe('')
  })
  it('broadcasts to the multi-selection with chips and a broadcast button label', async () => {
    const { csm } = installMockCsm()
    useStore.setState({ ready: true, sessions: { a: s('a'), b: s('b') }, selectedId: 'b', multiIds: ['a', 'b'], bridge: { status: 'connected', bridgeName: 'x' } })
    render(<RelayPanel />)
    expect(screen.getByText('Send to · multiple')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /remove a/i }))
    expect(useStore.getState().multiIds).toEqual(['b'])
    useStore.setState({ multiIds: ['a', 'b'] })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi' } })
    fireEvent.click(screen.getByRole('button', { name: /Broadcast to 2 sessions/ }))
    await waitFor(() => expect(csm.relay).toHaveBeenCalledWith(['a', 'b'], 'hi'))
  })
  it('warns when a target needs approval and quick chips prefill the draft', () => {
    installMockCsm()
    useStore.setState({ ready: true, sessions: { a: s('a', { permissionMode: 'default' }) }, selectedId: 'a', bridge: { status: 'connected', bridgeName: 'x' } })
    render(<RelayPanel />)
    expect(screen.getByText(/Needs approval in target session/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ask status' }))
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toMatch(/working on/)
  })
  it('disables input and shows retry when the bridge is unavailable', async () => {
    const { csm } = installMockCsm()
    useStore.setState({ ready: true, sessions: { a: s('a') }, selectedId: 'a', bridge: { status: 'unavailable', reason: 'claude not found' } })
    render(<RelayPanel />)
    expect(screen.getByText(/Relay offline/)).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Retry connection/ }))
    expect(csm.bridgeRetry).toHaveBeenCalled()
  })
  it('shows prompt history and reuses an entry', () => {
    installMockCsm()
    useStore.setState({ ready: true, sessions: { a: s('a') }, selectedId: 'a', bridge: { status: 'connected', bridgeName: 'x' }, prefs: { pinned: [], bookmarks: [], promptHistory: ['older prompt'] } })
    render(<RelayPanel />)
    fireEvent.click(screen.getByRole('button', { name: /history/i }))
    fireEvent.click(screen.getByText('older prompt'))
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('older prompt')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/renderer/relay.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the components**

`src/renderer/src/components/BridgeStatusChip.tsx`:
```tsx
import type { BridgeState } from '@shared/types'
import { cn } from '../lib/format'

export function BridgeStatusChip({ state }: { state: BridgeState }) {
  const map = {
    connected: { color: 'text-working', dot: 'bg-working', text: `Bridge connected${'latencyMs' in state && state.latencyMs !== undefined ? ` · ${state.latencyMs} ms` : ''}` },
    reconnecting: { color: 'text-waiting', dot: 'bg-waiting animate-pulse-dot', text: `Reconnecting… attempt ${'attempt' in state ? state.attempt : 0}/${'max' in state ? state.max : 5}` },
    unavailable: { color: 'text-error', dot: 'bg-error', text: 'Bridge unavailable' },
    relaying: { color: 'text-cross', dot: 'bg-cross animate-pulse-dot', text: `Relaying prompt… → ${'targets' in state ? state.targets.length : 0} target${'targets' in state && state.targets.length === 1 ? '' : 's'}` },
  }[state.status]
  return <span className={cn('inline-flex items-center gap-[5px] font-mono font-medium text-[9.5px]', map.color)}><span className={cn('w-[6px] h-[6px] rounded-full', map.dot)} />{map.text}</span>
}
```

`src/renderer/src/components/TargetPicker.tsx`:
```tsx
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useStore, useTargets } from '../store'

export function TargetPicker() {
  const sessions = useStore((s) => s.sessions)
  const multiIds = useStore((s) => s.multiIds)
  const targets = useTargets()
  const name = (id: string) => sessions[id]?.name ?? id
  const live = Object.values(sessions).filter((s) => s.state !== 'ended')
  const setMulti = (ids: string[]) => useStore.setState({ multiIds: ids, selectedId: ids[ids.length - 1] ?? useStore.getState().selectedId })

  if (multiIds.length > 1) {
    return (
      <div className="rounded-md bg-bg border border-input px-[9px] py-[6px]">
        <div className="text-[10.5px] text-muted mb-1">Send to · multiple</div>
        <div className="flex flex-wrap gap-1">
          {multiIds.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-raised text-[10.5px] text-fg px-2 py-[1px]">{name(id)}
              <button aria-label={`remove ${name(id)}`} className="text-muted hover:text-fg" onClick={() => setMulti(multiIds.filter((x) => x !== id))}>✕</button></span>
          ))}
          <AddMenu exclude={multiIds} onPick={(id) => setMulti([...multiIds, id])} options={live} />
        </div>
      </div>
    )
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex items-center gap-2 h-7 w-full rounded-md bg-bg border border-input px-[9px] text-left">
        <span className="text-[10.5px] text-muted">Send to</span>
        <span className="text-[11.5px] font-medium text-fg truncate">{targets[0] ? name(targets[0]) : '—'}</span>
        <span className="ml-auto text-muted text-[10px]">▾</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" className="min-w-[260px] rounded-md border border-border bg-panel p-1 text-[11.5px] shadow-xl">
          {live.map((s) => <DropdownMenu.Item key={s.sessionId} className="px-2 py-1 rounded hover:bg-raised outline-none" onSelect={() => useStore.getState().select(s.sessionId)}>{s.name}</DropdownMenu.Item>)}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item className="px-2 py-1 rounded hover:bg-raised outline-none text-muted" onSelect={() => setMulti(live.map((s) => s.sessionId))}>All sessions</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function AddMenu({ exclude, onPick, options }: { exclude: string[]; onPick: (id: string) => void; options: { sessionId: string; name: string }[] }) {
  const rest = options.filter((o) => !exclude.includes(o.sessionId))
  if (!rest.length) return null
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="rounded-full border border-border text-[10.5px] text-muted px-2 py-[1px] hover:text-fg">+ add</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="min-w-[200px] rounded-md border border-border bg-panel p-1 text-[11.5px] shadow-xl">
          {rest.map((o) => <DropdownMenu.Item key={o.sessionId} className="px-2 py-1 rounded hover:bg-raised outline-none" onSelect={() => onPick(o.sessionId)}>{o.name}</DropdownMenu.Item>)}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
```

`src/renderer/src/components/RelayPanel.tsx`:
```tsx
import { useState, type KeyboardEvent } from 'react'
import * as Popover from '@radix-ui/react-popover'
import type { RelayResult } from '@shared/types'
import { useStore, useTargets } from '../store'
import { cn, modKey } from '../lib/format'
import { BridgeStatusChip } from './BridgeStatusChip'
import { TargetPicker } from './TargetPicker'

export const QUICK_PROMPTS = [
  { label: 'Ask status', text: 'What are you working on right now, and what (if anything) is blocking you?' },
  { label: 'List sessions', text: 'Call ListAgents and tell me which other sessions you can see.' },
  { label: 'Pause work', text: 'Pause after the current step and wait for further instructions.' },
]

export const needsApproval = (mode?: string) => !(mode === 'bypassPermissions' || mode === 'acceptEdits')

export function RelayPanel() {
  const sessions = useStore((s) => s.sessions)
  const bridge = useStore((s) => s.bridge)
  const draft = useStore((s) => s.draft)
  const setDraft = useStore((s) => s.setDraft)
  const history = useStore((s) => s.prefs.promptHistory)
  const targets = useTargets()
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null)

  const names = targets.map((id) => sessions[id]?.name ?? id)
  const offline = bridge.status === 'unavailable'
  const canSend = !offline && !busy && draft.trim().length > 0 && targets.length > 0 && bridge.status !== 'reconnecting'
  const warn = targets.some((id) => needsApproval(sessions[id]?.permissionMode))

  const send = async () => {
    if (!canSend) return
    setBusy(true); setLast(null)
    try {
      const r: RelayResult = await window.csm.relay(names, draft.trim())
      const ok = r.failed.length === 0
      setLast({ ok, text: ok ? `Sent to ${r.sent.join(', ')} · ${r.latencyMs} ms` : `Failed: ${r.failed.map((f) => `${f.to} (${f.error})`).join('; ')}${r.sent.length ? ` · sent to ${r.sent.join(', ')}` : ''}` })
      if (ok) setDraft('')
    } catch (e: any) {
      setLast({ ok: false, text: String(e?.message ?? e) })
    } finally { setBusy(false) }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() } }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 flex flex-col gap-2">
        <div className="flex items-center gap-2"><span className="font-semibold text-[11.5px] text-fg">Prompt relay</span><span className="ml-auto"><BridgeStatusChip state={bridge} /></span></div>
        {offline && (
          <div className="rounded-lg border border-error/40 bg-error/10 p-[10px] text-[11px]">
            <div className="font-semibold text-error">Relay offline</div>
            <div className="text-muted mt-[2px]">The headless bridge session isn't reachable. Prompts are disabled until it reconnects.{'reason' in bridge && bridge.reason ? ` (${bridge.reason})` : ''}</div>
            <button className="mt-2 h-6 px-2 rounded-md border border-border text-fg" onClick={() => void window.csm.bridgeRetry()}>Retry connection</button>
          </div>
        )}
        <TargetPicker />
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} disabled={offline}
          placeholder={offline ? 'Prompt input disabled…' : names.length > 1 ? `Message ${names.length} sessions…` : `Message ${names[0] ?? '…'}…`}
          className="min-h-[64px] max-h-[220px] resize-y rounded-lg bg-bg border border-input px-[11px] py-[9px] text-[12px] leading-[1.5] text-fg placeholder:text-faint outline-none focus:border-input disabled:opacity-60" />
        <div className="flex flex-wrap gap-[5px]">
          {QUICK_PROMPTS.map((q) => <button key={q.label} disabled={offline} onClick={() => setDraft(q.text)} className="rounded-full border border-border px-[9px] py-[2px] text-[10.5px] font-medium text-muted hover:text-fg disabled:opacity-50">{q.label}</button>)}
        </div>
        {warn && !offline && <div className="text-[10px] text-waiting">⚠ Needs approval in target session</div>}
        <div className="flex items-center gap-[7px]">
          <button onClick={() => void send()} disabled={!canSend} className={cn('flex-1 h-[30px] rounded-[7px] bg-primary text-primary-fg font-semibold text-[11.5px] flex items-center justify-center gap-2 disabled:opacity-50')}>
            {names.length > 1 ? `Broadcast to ${names.length} sessions` : 'Send'}<span className="font-mono text-[9.5px] text-primary-fg/70 bg-black/10 rounded px-[5px]">{modKey()}⏎</span>
          </button>
          <Popover.Root>
            <Popover.Trigger aria-label="prompt history" className="h-[30px] w-[30px] rounded-[7px] border border-border text-muted hover:text-fg font-mono text-[11px]">⟲</Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="end" className="w-72 max-h-64 overflow-y-auto rounded-md border border-border bg-panel p-1 text-[11.5px] shadow-xl">
                {history.length === 0 && <div className="px-2 py-1 text-faint">No prompts sent yet</div>}
                {history.map((h, i) => <Popover.Close key={i} className="block w-full text-left px-2 py-1 rounded hover:bg-raised truncate" onClick={() => setDraft(h)}>{h}</Popover.Close>)}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
        {last && <div className={cn('text-[10.5px] font-mono', last.ok ? 'text-working' : 'text-error')}>{last.text}</div>}
      </div>
      <div id="feed-mini" className="mt-3 border-t border-border flex-1 min-h-0" />
    </div>
  )
}
```

- [ ] **Step 4: Mount and run**

In `App.tsx` replace the empty `<aside id="relay" …/>` body with `<RelayPanel />` (keep the aside's classes) and import it.

Run: `npx vitest run tests/renderer/relay.test.tsx && npm run typecheck`
Expected: 8 passed; exit 0.

Run: `npm run dev` with another Claude session open. Type "reply with the word pong" and press ⌘⏎. Expected: the chip shows *Relaying prompt… → 1 target*, then *Sent to <name> · N ms*; the other terminal shows the message arriving from `csm-bridge`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(renderer): relay panel with target picker, bridge status, quick prompts, history"
```

---

### Task 15: Feed (mini + tab), History tab

**Files:**
- Create: `src/renderer/src/components/FeedMini.tsx`, `src/renderer/src/components/FeedTab.tsx`, `src/renderer/src/components/FeedItemRow.tsx`, `src/renderer/src/components/HistoryTab.tsx`
- Modify: `src/renderer/src/components/RelayPanel.tsx` (mount `<FeedMini />` in `#feed-mini`), `src/renderer/src/App.tsx` (switch `#center` on `view`)
- Test: `tests/renderer/feed.test.tsx`

**Interfaces:**
- Consumes: store (`feed`, `sessions`, `view`, `jump`, `prefs.bookmarks`, `prefs.promptHistory`), `hhmm`, `firstLine` (Task 11).
- Produces: `<FeedMini />` (last 3 + "Open tab ↗"), `<FeedItemRow item filter onJumpSender onJumpReceiver onBookmark />`, `<FeedTab />` (filters `cross` / `all` / by session, grouped by day), `<HistoryTab />` (bookmarks + prompt history); `groupByDay(items): { day: string; items: FeedItem[] }[]`.

- [ ] **Step 1: Write the failing tests**

`tests/renderer/feed.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { installMockCsm } from './mockCsm'
import { useStore } from '@renderer/store'
import { FeedMini } from '@renderer/components/FeedMini'
import { FeedTab, groupByDay } from '@renderer/components/FeedTab'
import { HistoryTab } from '@renderer/components/HistoryTab'
import type { FeedItem, Session } from '@shared/types'

const day = (d: number, h = 12) => Date.UTC(2026, 7, d, h, 30)
const item = (over: Partial<FeedItem>): FeedItem => ({ id: 'f1', ts: day(26), from: 'perf', to: ['auth'], text: 'Heads up — renamed CacheKey', receiverSessionIds: ['B'], senderSessionId: 'A', viaBridge: false, ...over })
const s = (id: string, name: string): Session => ({ sessionId: id, pid: 1, name, cwd: '/x', startedAt: 0, version: '', registryStatus: 'idle', state: 'idle', origin: 'local', alive: true, lastActivityAt: 0, lastActivityPreview: '', pinned: false, turnOutputTokens: 0 })

beforeEach(() => { useStore.getState().reset(); installMockCsm(); useStore.setState({ ready: true, sessions: { A: s('A', 'perf'), B: s('B', 'auth') } }) })

describe('groupByDay', () => {
  it('groups newest day first and labels Today', () => {
    const now = day(26, 20)
    const g = groupByDay([item({ id: '1', ts: day(26) }), item({ id: '2', ts: day(25) }), item({ id: '3', ts: day(26, 9) })], now)
    expect(g.map((x) => x.day)[0]).toBe('TODAY')
    expect(g[0]!.items.map((i) => i.id)).toEqual(['1', '3'])
    expect(g).toHaveLength(2)
  })
})

describe('FeedMini', () => {
  it('shows the three newest items and opens the tab', () => {
    useStore.setState({ feed: [item({ id: '1', ts: 4 }), item({ id: '2', ts: 3 }), item({ id: '3', ts: 2 }), item({ id: '4', ts: 1 })] })
    render(<FeedMini />)
    expect(screen.getAllByText(/perf → auth/)).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: /Open tab/ }))
    expect(useStore.getState().view).toBe('feed')
  })
  it('renders an empty hint with no items', () => {
    render(<FeedMini />)
    expect(screen.getByText(/No cross-session messages yet/)).toBeInTheDocument()
  })
})

describe('FeedTab', () => {
  it('lists items with full text and jump actions, and jumps to the receiver', () => {
    useStore.setState({ feed: [item({})] })
    render(<FeedTab />)
    expect(screen.getByText('Heads up — renamed CacheKey')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Open in receiver/ }))
    expect(useStore.getState().selectedId).toBe('B')
    expect(useStore.getState().jumpTarget).toMatchObject({ sessionId: 'B' })
  })
  it('marks broadcasts and shows the bridge note', () => {
    useStore.setState({ feed: [item({ from: 'you', to: ['auth', 'perf'], viaBridge: true, senderSessionId: undefined })] })
    render(<FeedTab />)
    expect(screen.getByText(/broadcast · relayed via bridge/)).toBeInTheDocument()
  })
  it('filters to cross-session only vs all activity, and by session', () => {
    useStore.setState({ feed: [item({ id: 'x', from: 'perf' }), item({ id: 'y', from: 'you', viaBridge: true, to: ['auth'], senderSessionId: undefined, receiverSessionIds: [] })] })
    render(<FeedTab />)
    fireEvent.click(screen.getByRole('button', { name: 'Cross-session only' }))
    expect(screen.queryByText(/^you →/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All activity' }))
    expect(screen.getByText(/you → auth/)).toBeInTheDocument()
  })
})

describe('HistoryTab', () => {
  it('lists bookmarks and prompt history, and jumps to a bookmark', () => {
    useStore.setState({ prefs: { pinned: [], promptHistory: ['status?'], bookmarks: [{ sessionId: 'B', eventId: 'e1', ts: 5, preview: 'a bookmarked line' }] } })
    render(<HistoryTab />)
    expect(screen.getByText('a bookmarked line')).toBeInTheDocument()
    expect(screen.getByText('status?')).toBeInTheDocument()
    fireEvent.click(screen.getByText('a bookmarked line'))
    expect(useStore.getState().jumpTarget).toMatchObject({ sessionId: 'B', eventId: 'e1' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/renderer/feed.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the components**

`src/renderer/src/components/FeedItemRow.tsx`:
```tsx
import type { FeedItem } from '@shared/types'
import { hhmm } from '../lib/format'

export function FeedItemRow({ item, onJumpSender, onJumpReceiver, onBookmark }: { item: FeedItem; onJumpSender?: () => void; onJumpReceiver?: () => void; onBookmark: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-panel/60 p-3">
      <div className="flex items-baseline gap-2 font-mono text-[10px]">
        <span className="text-cross">{item.from} → {item.to.join(', ')}</span>
        <span className="ml-auto text-faint">{hhmm(item.ts)}</span>
      </div>
      <div className="text-[12px] leading-[1.5] text-fg-soft mt-1 whitespace-pre-wrap">{item.text}</div>
      <div className="flex gap-3 mt-[6px] text-[10px] text-faint">
        {onJumpSender && <button className="hover:text-fg" onClick={onJumpSender}>Open in sender ↗</button>}
        {onJumpReceiver && <button className="hover:text-fg" onClick={onJumpReceiver}>Open in receiver ↗</button>}
        <button className="hover:text-fg" onClick={onBookmark}>Bookmark</button>
        {item.viaBridge && <span className="ml-auto text-cross/70">broadcast · relayed via bridge</span>}
      </div>
    </div>
  )
}
```

`src/renderer/src/components/FeedMini.tsx`:
```tsx
import { useStore } from '../store'
import { firstLine, hhmm } from '../lib/format'

export function FeedMini() {
  const feed = useStore((s) => s.feed)
  const setView = useStore((s) => s.setView)
  const jump = useStore((s) => s.jump)
  const top = [...feed].sort((a, b) => b.ts - a.ts).slice(0, 3)
  return (
    <div className="px-3 py-[10px] flex flex-col gap-[7px] h-full min-h-0">
      <div className="flex items-baseline gap-2">
        <span className="font-semibold text-[11.5px] text-fg">Cross-session feed</span>
        <button className="ml-auto text-[10px] text-muted hover:text-fg" onClick={() => setView('feed')}>Open tab ↗</button>
      </div>
      <div className="flex flex-col gap-[5px] overflow-y-auto">
        {top.length === 0 && <div className="text-[10.5px] text-faint">No cross-session messages yet</div>}
        {top.map((i) => (
          <button key={i.id} onClick={() => { const target = i.receiverSessionIds[0] ?? i.senderSessionId; if (target) jump({ sessionId: target, ts: i.ts }) }}
            className="text-left rounded-[7px] bg-bg border border-border/80 px-[9px] py-[7px] hover:border-input">
            <div className="flex gap-[6px] font-mono text-[9.5px] text-cross"><span className="truncate">{i.from} → {i.to.join(', ')}</span><span className="ml-auto text-faint">{hhmm(i.ts)}</span></div>
            <div className="text-[11px] text-muted mt-[2px] truncate">{firstLine(i.text, 60)}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
```

`src/renderer/src/components/FeedTab.tsx`:
```tsx
import { useMemo, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { FeedItem } from '@shared/types'
import { useStore } from '../store'
import { cn, firstLine } from '../lib/format'
import { FeedItemRow } from './FeedItemRow'

export function groupByDay(items: FeedItem[], now = Date.now()): { day: string; items: FeedItem[] }[] {
  const key = (ts: number) => new Date(ts).toDateString()
  const today = key(now)
  const yesterday = key(now - 86_400_000)
  const map = new Map<string, FeedItem[]>()
  for (const i of [...items].sort((a, b) => b.ts - a.ts)) {
    const k = key(i.ts)
    map.set(k, [...(map.get(k) ?? []), i])
  }
  return [...map.entries()].map(([k, list]) => ({ day: k === today ? 'TODAY' : k === yesterday ? 'YESTERDAY' : k.toUpperCase(), items: list }))
}

export function FeedTab() {
  const feed = useStore((s) => s.feed)
  const sessions = useStore((s) => s.sessions)
  const jump = useStore((s) => s.jump)
  const addBookmark = useStore((s) => s.addBookmark)
  const [mode, setMode] = useState<'cross' | 'all'>('all')
  const [session, setSession] = useState<string | undefined>()

  const filtered = useMemo(() => feed.filter((i) => {
    if (mode === 'cross' && i.viaBridge) return false
    if (!session) return true
    const name = sessions[session]?.name
    return i.senderSessionId === session || i.receiverSessionIds.includes(session) || (name !== undefined && (i.from === name || i.to.includes(name)))
  }), [feed, mode, session, sessions])

  const groups = groupByDay(filtered)
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="h-[50px] shrink-0 border-b border-border flex items-center gap-3 px-[18px]">
        <span className="font-semibold text-[14px] text-fg">Inter-session feed</span>
        <div className="ml-auto flex gap-[6px] text-[11px]">
          <button onClick={() => setMode('cross')} className={cn('h-6 px-[9px] rounded-md border', mode === 'cross' ? 'bg-raised border-transparent text-fg' : 'border-border text-muted hover:text-fg')}>Cross-session only</button>
          <button onClick={() => setMode('all')} className={cn('h-6 px-[9px] rounded-md border', mode === 'all' ? 'bg-raised border-transparent text-fg' : 'border-border text-muted hover:text-fg')}>All activity</button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger className="h-6 px-[9px] rounded-md border border-border text-muted hover:text-fg">{session ? sessions[session]?.name : 'Session'} ▾</DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" className="min-w-[200px] rounded-md border border-border bg-panel p-1 text-[11.5px] shadow-xl">
                <DropdownMenu.Item className="px-2 py-1 rounded hover:bg-raised outline-none" onSelect={() => setSession(undefined)}>All sessions</DropdownMenu.Item>
                {Object.values(sessions).map((s) => <DropdownMenu.Item key={s.sessionId} className="px-2 py-1 rounded hover:bg-raised outline-none" onSelect={() => setSession(s.sessionId)}>{s.name}</DropdownMenu.Item>)}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-[18px] py-3 flex flex-col gap-3">
        {groups.length === 0 && <div className="text-faint text-[12px] mt-8 self-center">No messages between sessions yet</div>}
        {groups.map((g) => (
          <div key={g.day} className="flex flex-col gap-2">
            <div className="font-mono font-semibold text-[9.5px] tracking-[.1em] text-faint">{g.day}</div>
            {g.items.map((i) => (
              <FeedItemRow key={i.id} item={i}
                onJumpSender={i.senderSessionId ? () => jump({ sessionId: i.senderSessionId!, ts: i.ts }) : undefined}
                onJumpReceiver={i.receiverSessionIds[0] ? () => jump({ sessionId: i.receiverSessionIds[0]!, ts: i.ts }) : undefined}
                onBookmark={() => void addBookmark({ sessionId: i.receiverSessionIds[0] ?? i.senderSessionId ?? '', eventId: i.id, ts: i.ts, preview: firstLine(i.text, 80) })} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
```

`src/renderer/src/components/HistoryTab.tsx`:
```tsx
import { useStore } from '../store'
import { hhmm } from '../lib/format'

export function HistoryTab() {
  const bookmarks = useStore((s) => s.prefs.bookmarks)
  const history = useStore((s) => s.prefs.promptHistory)
  const sessions = useStore((s) => s.sessions)
  const jump = useStore((s) => s.jump)
  const setDraft = useStore((s) => s.setDraft)
  const setView = useStore((s) => s.setView)
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="h-[50px] shrink-0 border-b border-border flex items-center px-[18px]"><span className="font-semibold text-[14px] text-fg">History</span></div>
      <div className="flex-1 min-h-0 overflow-y-auto px-[18px] py-3 grid grid-cols-2 gap-6">
        <div className="flex flex-col gap-2">
          <div className="font-mono font-semibold text-[9.5px] tracking-[.1em] text-faint">BOOKMARKS</div>
          {bookmarks.length === 0 && <div className="text-[11px] text-faint">Right-click any message → Bookmark</div>}
          {bookmarks.map((b) => (
            <button key={`${b.sessionId}-${b.eventId}`} onClick={() => jump({ sessionId: b.sessionId, eventId: b.eventId, ts: b.ts })}
              className="text-left rounded-lg border border-border bg-panel/60 p-2 hover:border-input">
              <div className="font-mono text-[9.5px] text-faint">{sessions[b.sessionId]?.name ?? b.sessionId.slice(0, 8)} · {hhmm(b.ts)}</div>
              <div className="text-[11.5px] text-fg-soft mt-[2px] truncate">{b.preview}</div>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <div className="font-mono font-semibold text-[9.5px] tracking-[.1em] text-faint">PROMPTS SENT</div>
          {history.length === 0 && <div className="text-[11px] text-faint">Prompts you relay appear here</div>}
          {history.map((h, i) => (
            <button key={i} onClick={() => { setDraft(h); setView('sessions') }} className="text-left rounded-lg border border-border bg-panel/60 p-2 hover:border-input text-[11.5px] text-fg-soft truncate">{h}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Mount FeedMini and the view switch**

In `RelayPanel.tsx` replace `<div id="feed-mini" className="mt-3 border-t border-border flex-1 min-h-0" />` with `<div id="feed-mini" className="mt-3 border-t border-border flex-1 min-h-0"><FeedMini /></div>` and import it.

In `App.tsx` make `#center` switch on the view:
```tsx
const view = useStore((s) => s.view)
…
<main id="center" className="flex-1 min-w-0 flex flex-col bg-bg">
  {view === 'sessions' && <><SessionHeader /><Transcript /></>}
  {view === 'feed' && <FeedTab />}
  {view === 'history' && <HistoryTab />}
</main>
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run tests/renderer/feed.test.tsx && npm run typecheck`
Expected: 7 passed; exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(renderer): cross-session feed mini panel, feed tab, history tab"
```

---

### Task 16: Title bar, search overlay, status bar, keyboard shortcuts

**Files:**
- Create: `src/renderer/src/components/TitleBar.tsx`, `src/renderer/src/components/SearchOverlay.tsx`, `src/renderer/src/components/StatusBar.tsx`, `src/renderer/src/lib/useHotkeys.ts`
- Modify: `src/renderer/src/App.tsx`
- Test: `tests/renderer/chrome.test.tsx`

**Interfaces:**
- Consumes: store, `modKey`, `isMac`, `relTime` (Task 11).
- Produces: `<TitleBar />` (platform chrome + view tabs + search trigger), `<SearchOverlay />` (⌘K, debounced query, jump on select), `<StatusBar />` (counts, refreshed, bridge dot, logs, reload), `useHotkeys()`.

- [ ] **Step 1: Write the failing tests**

`tests/renderer/chrome.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { installMockCsm } from './mockCsm'
import { useStore } from '@renderer/store'
import { TitleBar } from '@renderer/components/TitleBar'
import { SearchOverlay } from '@renderer/components/SearchOverlay'
import { StatusBar } from '@renderer/components/StatusBar'

beforeEach(() => { useStore.getState().reset() })

describe('TitleBar', () => {
  it('shows mac traffic-light spacing and no window buttons on darwin', () => {
    installMockCsm({ platform: 'darwin' })
    render(<TitleBar />)
    expect(screen.queryByRole('button', { name: /minimize/i })).not.toBeInTheDocument()
    expect(screen.getByText('Claude Session Monitor')).toBeInTheDocument()
    expect(screen.getByText('⌘K')).toBeInTheDocument()
  })
  it('shows window controls and Ctrl+K on win32, wired to the api', () => {
    const { csm } = installMockCsm({ platform: 'win32' })
    render(<TitleBar />)
    expect(screen.getByText('Ctrl+K')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /minimize/i })); expect(csm.windowControl).toHaveBeenCalledWith('minimize')
    fireEvent.click(screen.getByRole('button', { name: /close/i })); expect(csm.windowControl).toHaveBeenCalledWith('close')
  })
  it('switches views', () => {
    installMockCsm()
    render(<TitleBar />)
    fireEvent.click(screen.getByRole('button', { name: 'Feed' }))
    expect(useStore.getState().view).toBe('feed')
  })
})

describe('SearchOverlay', () => {
  it('queries after typing and jumps to the chosen hit', async () => {
    const { csm } = installMockCsm({ search: vi.fn(async () => [{ sessionId: 'B', sessionName: 'auth', eventId: 'e1', ts: 5, snippet: '…needle…' }]) as any })
    useStore.setState({ searchOpen: true })
    render(<SearchOverlay />)
    fireEvent.change(screen.getByPlaceholderText(/Search all sessions/), { target: { value: 'needle' } })
    await waitFor(() => expect(csm.search).toHaveBeenCalledWith('needle'))
    await waitFor(() => expect(screen.getByText('…needle…')).toBeInTheDocument())
    fireEvent.click(screen.getByText('…needle…'))
    expect(useStore.getState().jumpTarget).toMatchObject({ sessionId: 'B', eventId: 'e1' })
    expect(useStore.getState().searchOpen).toBe(false)
  })
  it('renders nothing when closed', () => {
    installMockCsm()
    const { container } = render(<SearchOverlay />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('StatusBar', () => {
  it('shows counts, bridge dot, and wires logs and reload', () => {
    const { csm } = installMockCsm()
    useStore.setState({ stats: { working: 3, waiting: 1, idle: 1, ended: 1, refreshedAt: Date.now() }, bridge: { status: 'connected', bridgeName: 'b' } })
    render(<StatusBar />)
    expect(screen.getByText('3 working')).toBeInTheDocument()
    expect(screen.getByText('1 waiting')).toBeInTheDocument()
    expect(screen.getByText(/refreshed/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'logs' })); expect(csm.openLogs).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'reload' })); expect(csm.reload).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/renderer/chrome.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the components**

`src/renderer/src/components/TitleBar.tsx`:
```tsx
import { useStore, type View } from '../store'
import { cn, isMac, modKey } from '../lib/format'

const VIEWS: { id: View; label: string }[] = [{ id: 'sessions', label: 'Sessions' }, { id: 'feed', label: 'Feed' }, { id: 'history', label: 'History' }]

export function TitleBar() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const setSearchOpen = useStore((s) => s.setSearchOpen)
  const mac = isMac()
  return (
    <div className={cn('h-10 shrink-0 flex items-center gap-3 px-[14px] border-b border-border bg-panel drag', mac && 'pl-[86px]')}>
      {!mac && <span className="text-claude text-[13px] no-drag">✳</span>}
      <div className="font-semibold text-[12.5px] text-fg">Claude Session Monitor</div>
      <div className="flex-1 flex justify-center no-drag">
        <button onClick={() => setSearchOpen(true)} className="flex items-center gap-2 w-[340px] h-[26px] rounded-md bg-bg border border-input px-[10px] text-left">
          <span className="text-muted text-[11px]">⌕</span>
          <span className="text-[12px] text-muted">Search all sessions…</span>
          <span className="ml-auto font-mono text-[10px] text-faint border border-border rounded px-1">{mac ? '⌘K' : 'Ctrl+K'}</span>
        </button>
      </div>
      <div className="flex gap-[6px] no-drag">
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={cn('h-[26px] px-[10px] rounded-md font-medium text-[11.5px]', view === v.id ? 'bg-raised text-fg' : 'border border-border text-muted hover:text-fg')}>{v.label}</button>
        ))}
      </div>
      {!mac && (
        <div className="flex ml-2 no-drag">
          <button aria-label="minimize" onClick={() => window.csm.windowControl('minimize')} className="w-11 h-10 -my-[1px] text-muted hover:bg-white/10">─</button>
          <button aria-label="maximize" onClick={() => window.csm.windowControl('maximize')} className="w-11 h-10 -my-[1px] text-muted hover:bg-white/10">▢</button>
          <button aria-label="close" onClick={() => window.csm.windowControl('close')} className="w-11 h-10 -my-[1px] text-muted hover:bg-[#e81123] hover:text-white">✕</button>
        </div>
      )}
    </div>
  )
}
```

`src/renderer/src/components/SearchOverlay.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react'
import type { SearchHit } from '@shared/types'
import { useStore } from '../store'
import { hhmm } from '../lib/format'

export function SearchOverlay() {
  const open = useStore((s) => s.searchOpen)
  const setOpen = useStore((s) => s.setSearchOpen)
  const jump = useStore((s) => s.jump)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { if (open) { setQ(''); setHits([]); setTimeout(() => input.current?.focus(), 0) } }, [open])
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => { if (q.trim()) void window.csm.search(q.trim()).then(setHits); else setHits([]) }, 120)
    return () => clearTimeout(t)
  }, [q, open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-24" onClick={() => setOpen(false)}>
      <div className="w-[640px] max-h-[60vh] flex flex-col rounded-xl border border-border bg-panel shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
          placeholder="Search all sessions…" className="h-12 px-4 bg-transparent outline-none text-[13px] text-fg placeholder:text-muted border-b border-border" />
        <div className="flex-1 overflow-y-auto p-1">
          {q.trim() && hits.length === 0 && <div className="px-3 py-4 text-[11.5px] text-faint">No matches</div>}
          {hits.map((h) => (
            <button key={`${h.sessionId}-${h.eventId}`} onClick={() => jump({ sessionId: h.sessionId, eventId: h.eventId, ts: h.ts })}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-raised">
              <div className="font-mono text-[9.5px] text-faint">{h.sessionName} · {hhmm(h.ts)}</div>
              <div className="text-[12px] text-fg-soft truncate">{h.snippet}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
```

`src/renderer/src/components/StatusBar.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { cn, isMac, relTime, STATE_COLOR } from '../lib/format'

const BRIDGE_COLOR = { connected: 'text-working', reconnecting: 'text-waiting', unavailable: 'text-error', relaying: 'text-cross' } as const

export function StatusBar() {
  const stats = useStore((s) => s.stats)
  const bridge = useStore((s) => s.bridge)
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(t) }, [])
  const item = (n: number, label: string, color: string) => (
    <span className="inline-flex items-center gap-[5px]"><span className="w-[6px] h-[6px] rounded-full" style={{ background: color }} />{n} {label}</span>
  )
  return (
    <div className="h-7 shrink-0 border-t border-border bg-panel flex items-center gap-[14px] px-[14px] font-mono text-[10.5px] text-muted">
      {item(stats.working, 'working', STATE_COLOR.working)}
      {item(stats.waiting, 'waiting', STATE_COLOR.waiting)}
      {item(stats.idle, 'idle', STATE_COLOR.idle)}
      {item(stats.ended, 'ended', STATE_COLOR.ended)}
      <span className="ml-auto">refreshed {relTime(stats.refreshedAt)}</span>
      <span className={cn(BRIDGE_COLOR[bridge.status])}>bridge ●</span>
      {!isMac() && <span className="text-faint">Ctrl+⏎ to send</span>}
      <button className="hover:text-fg" onClick={() => void window.csm.openLogs()}>logs</button>
      <button className="hover:text-fg" onClick={() => void window.csm.reload()}>reload</button>
    </div>
  )
}
```

`src/renderer/src/lib/useHotkeys.ts`:
```ts
import { useEffect } from 'react'
import { useStore } from '../store'

/** ⌘K/Ctrl+K search, Esc closes it. ⌘⏎ send is handled inside the relay textarea. */
export function useHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); useStore.getState().setSearchOpen(true) }
      else if (e.key === 'Escape') useStore.getState().setSearchOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
```

- [ ] **Step 4: Final App.tsx**

`src/renderer/src/App.tsx`:
```tsx
import { useEffect } from 'react'
import { useStore } from './store'
import { cn, isMac } from './lib/format'
import { useHotkeys } from './lib/useHotkeys'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { SessionHeader } from './components/SessionHeader'
import { Transcript } from './components/Transcript'
import { RelayPanel } from './components/RelayPanel'
import { FeedTab } from './components/FeedTab'
import { HistoryTab } from './components/HistoryTab'
import { SearchOverlay } from './components/SearchOverlay'
import { StatusBar } from './components/StatusBar'

export default function App() {
  const init = useStore((s) => s.init)
  const ready = useStore((s) => s.ready)
  const view = useStore((s) => s.view)
  useHotkeys()
  useEffect(() => { void init() }, [init])
  if (!ready) return <div className="h-full flex items-center justify-center text-muted">Loading sessions…</div>
  return (
    <div className="h-full flex flex-col bg-bg">
      <TitleBar />
      <div className="flex-1 min-h-0 flex">
        <aside className={cn('w-[236px] shrink-0 border-r border-border flex flex-col', isMac() ? 'bg-panel' : 'bg-bg')}><Sidebar /></aside>
        <main className="flex-1 min-w-0 flex flex-col bg-bg">
          {view === 'sessions' && <><SessionHeader /><Transcript /></>}
          {view === 'feed' && <FeedTab />}
          {view === 'history' && <HistoryTab />}
        </main>
        <aside className="w-[292px] shrink-0 border-l border-border bg-panel flex flex-col"><RelayPanel /></aside>
      </div>
      <StatusBar />
      <SearchOverlay />
    </div>
  )
}
```

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck`
Expected: every suite green; exit 0.

Run: `npm run dev`. Compare side by side with design 2a: title bar with centered search and three tabs, 236 px sidebar, transcript, 292 px relay panel with the mini feed under it, 28 px status bar. Press ⌘K → overlay opens and searches. Click **Feed** → the full feed tab (design 2c).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(renderer): title bar, search overlay, status bar, hotkeys"
```

---

### Task 17: Packaging, docs, and end-to-end verification

**Files:**
- Create: `electron-builder.yml`, `build/icon.png` (1024×1024), `README.md`, `docs/testing.md`
- Modify: `package.json` (build metadata), `src/main/index.ts` (single-instance lock)
- Test: `tests/renderer/app.test.tsx`

**Interfaces:**
- Consumes: everything.
- Produces: `npm run package:mac` → `release/*.dmg`; `npm run package:win` → `release/*.exe`.

- [ ] **Step 1: Write the end-to-end render test**

`tests/renderer/app.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { installMockCsm } from './mockCsm'
import { useStore } from '@renderer/store'
import App from '@renderer/App'
import { PUSH, type Session } from '@shared/types'

vi.mock('react-virtuoso', () => ({ Virtuoso: ({ data, itemContent }: any) => <div>{data.map((d: any, i: number) => <div key={i}>{itemContent(i, d)}</div>)}</div> }))

const s = (id: string, name: string, over: Partial<Session> = {}): Session => ({ sessionId: id, pid: 1, name, cwd: '/Users/dev/acme-api', startedAt: Date.now(), version: '', registryStatus: 'busy', state: 'working', origin: 'local', alive: true, lastActivityAt: Date.now(), lastActivityPreview: 'working…', pinned: false, turnOutputTokens: 100, permissionMode: 'bypassPermissions', ...over })

beforeEach(() => useStore.getState().reset())

describe('App', () => {
  it('boots, lists sessions, shows the transcript, and relays a prompt end to end', async () => {
    const { csm, push } = installMockCsm({
      listSessions: async () => [s('a', 'auth-refactor'), s('b', 'perf-query-cache', { state: 'idle', registryStatus: 'idle' })],
      loadTranscript: async (id: string) => ({ sessionId: id, events: [{ kind: 'user', id: 'u', ts: Date.now(), text: 'Refactor it' }], meta: {} }) as any,
    })
    render(<App />)
    await waitFor(() => expect(screen.getByText('auth-refactor')).toBeInTheDocument())
    expect(screen.getByText('perf-query-cache')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Refactor it')).toBeInTheDocument())

    push(PUSH.transcriptAppend, { sessionId: useStore.getState().selectedId, events: [{ kind: 'cross', id: 'x', ts: Date.now(), fromName: 'perf-query-cache', text: 'Heads up' }], updates: [], meta: {} })
    await waitFor(() => expect(screen.getByText('⇄ from perf-query-cache')).toBeInTheDocument())

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'status?' } })
    fireEvent.click(screen.getByRole('button', { name: /^Send/ }))
    await waitFor(() => expect(csm.relay).toHaveBeenCalled())

    push(PUSH.bridgeState, { status: 'unavailable', reason: 'claude not found' })
    await waitFor(() => expect(screen.getByText(/Relay offline/)).toBeInTheDocument())
    expect(screen.getByRole('textbox')).toBeDisabled()
  })
})
```

Run: `npx vitest run tests/renderer/app.test.tsx`
Expected: 1 passed. (This exercises the full renderer wiring; if the Send button name is ambiguous with "Broadcast", the `/^Send/` regex disambiguates.)

- [ ] **Step 2: Add packaging config**

Add to `package.json`: `"build": { "appId": "com.maydon.claude-session-monitor", "productName": "Claude Session Monitor" }` is *not* used — electron-builder reads `electron-builder.yml`:

`electron-builder.yml`:
```yaml
appId: com.maydon.claude-session-monitor
productName: Claude Session Monitor
directories:
  output: release
  buildResources: build
files:
  - out/**
  - package.json
mac:
  target: [dmg]
  category: public.app-category.developer-tools
  icon: build/icon.png
win:
  target: [nsis]
  icon: build/icon.png
nsis:
  oneClick: false
  perMachine: false
```

Create `build/icon.png` — a 1024×1024 PNG. Generate a placeholder now:
```bash
mkdir -p build && node -e "
const {createCanvas}=(()=>{try{return require('canvas')}catch{return {}}})();
if(!createCanvas){require('node:fs').writeFileSync('build/icon.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=','base64')); console.log('placeholder 1x1 written — replace before shipping'); process.exit(0)}
const c=createCanvas(1024,1024),x=c.getContext('2d');x.fillStyle='#252525';x.fillRect(0,0,1024,1024);x.fillStyle='#d97757';x.font='bold 620px sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText('✳',512,540);require('node:fs').writeFileSync('build/icon.png',c.toBuffer());console.log('icon written')"
```
Expected: prints one of the two messages. A 1×1 placeholder builds fine; note in the README that the icon is a placeholder.

- [ ] **Step 3: Add the single-instance lock**

In `src/main/index.ts`, immediately inside `main()` before `app.whenReady()`:
```ts
if (!app.requestSingleInstanceLock()) { app.quit(); return }
app.on('second-instance', () => { const [w] = BrowserWindow.getAllWindows(); if (w) { if (w.isMinimized()) w.restore(); w.focus() } })
```

- [ ] **Step 4: Write the docs**

`README.md`:
```markdown
# Claude Session Monitor

A desktop app (macOS · Windows) that watches every Claude Code session on this machine, shows what each one is doing, surfaces the messages they send each other, and relays prompts to any of them.

## How it works

- **Sessions** come from `~/.claude/sessions/<pid>.json`, which Claude Code writes and updates live (name, cwd, busy/idle). Liveness is a `kill(pid, 0)` check.
- **Transcripts** are tailed from `~/.claude/projects/<slug>/<sessionId>.jsonl` — the same files Claude Code appends to.
- **Cross-session messages** appear in those transcripts as `queue-operation` entries (receiver side) and `SendMessage` tool calls (sender side); the feed merges both.
- **Sending** is not something an outside process can do — the per-session sockets are token-protected. The app therefore runs one headless Claude session (`csm-bridge`) and relays prompts through its `SendMessage` tool. Each send is one Haiku turn (a fraction of a cent).

Nothing is uploaded anywhere; the app only reads local files and talks to its own child process.

## Requirements

Node ≥ 22, and the `claude` CLI on your PATH (for the relay bridge; monitoring works without it).

## Develop

    npm install
    npm run dev        # electron-vite dev server
    npm test           # vitest
    npm run typecheck

## Package

    npm run package:mac   # release/*.dmg
    npm run package:win   # release/*.exe   (run on Windows)

The app icon in `build/icon.png` is a placeholder — replace it before distributing.

## Not in v1

Light mode · cloud / Remote Control sessions · spawning terminals · editing transcripts.
See `docs/superpowers/specs/2026-08-26-claude-session-monitor-design.md`.
```

`docs/testing.md`:
```markdown
# Manual verification

Automated tests cover the parsers, watchers, bridge protocol, and every renderer component. These steps cover what only a real machine can.

## macOS (primary)

1. Open two terminals: `claude -n alpha` in one repo, `claude -n beta` in another. Leave both idle.
2. `npm run dev`.
   - [ ] Both sessions appear in the sidebar within ~2 s, with cwd, and `idle`.
   - [ ] The status bar shows `2 idle` and `bridge ●` turns green within ~10 s.
3. In `alpha`, ask Claude to do something slow (e.g. "list every file in this repo one by one").
   - [ ] Its dot turns green and pulses; the sidebar preview updates; the transcript follows the tail.
   - [ ] The streaming indicator shows a token count while the turn runs.
4. Scroll the transcript up while it works.
   - [ ] A "↓ N new" pill appears; clicking it returns to the tail.
5. In the app, select `beta`, type "reply with the word pong", press ⌘⏎.
   - [ ] Chip shows *Relaying prompt…* then *Sent to beta*.
   - [ ] The `beta` terminal shows a message from `csm-bridge`; its reply appears in `beta`'s transcript in the app.
   - [ ] The message appears in the Feed tab as `you → beta`, marked *relayed via bridge*.
6. From `alpha`'s terminal, tell Claude: "send a message to beta saying hello".
   - [ ] It shows in `alpha` as a `→ beta` row, in `beta` as a `⇄ from alpha` row, and once in the Feed tab.
   - [ ] *Open in sender* and *Open in receiver* jump to the right transcripts.
7. ⌘K, search a word you used.
   - [ ] Hits list with session and time; clicking one jumps to that message.
8. Quit `alpha`'s terminal (Ctrl+D).
   - [ ] Its row flips to `ended` within ~5 s and stays in the list.
9. Kill the bridge: `pkill -f csm-bridge`.
   - [ ] The relay panel shows *Reconnecting…* then recovers to *Bridge connected*; transcripts keep updating throughout.
10. Quit the app.
    - [ ] `ls ~/.claude/sessions` no longer lists a `csm-bridge` entry.
    - [ ] Reopening restores window size/position, the selected session, and pins.

## Windows (first run on a Windows machine)

- [ ] `%USERPROFILE%\.claude\sessions\*.json` exists with the same fields; sessions list correctly.
- [ ] Paths render as `C:\…`; `cwdTail` shortens `C:\Users\<you>` to `~`.
- [ ] Title bar shows min/max/close on the right; close hovers red; the bar drags the window.
- [ ] Ctrl+K opens search; Ctrl+⏎ sends; the status bar shows the Ctrl+⏎ hint.
- [ ] The bridge spawns via `claude.cmd`; if it is not on PATH the panel says so and monitoring still works.
```

- [ ] **Step 5: Full verification**

Run: `npm test && npm run typecheck && npm run build`
Expected: all suites pass; exit 0; `out/` rebuilt.

Run: `npm run package:mac`
Expected: `release/Claude Session Monitor-0.1.0-arm64.dmg` (or x64) exists. Open the .dmg, drag the app to /Applications, launch it once: sessions list and the bridge connects. (First launch may need right-click → Open because the build is unsigned.)

Then work through `docs/testing.md` § macOS and check every box. Record any failure as a follow-up issue rather than patching blindly — each box maps to a module with its own tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: packaging config, icon, readme, manual test checklist"
```

---

## Post-plan notes

**Known gaps carried from the spec (§11), to verify or revisit after v1 runs:**

1. Windows registry path/format and `claude.cmd` invocation — unverified from macOS; `docs/testing.md` has the checklist.
2. `-n csm-bridge` may not be honored in `-p` mode. If `~/.claude/sessions` shows the bridge under a derived name instead, the `excludeNames` filter misses it — the `isExcludedPid` fallback in `SessionStore` covers it, and Task 10 wires `bridge.pid` for exactly that reason. Confirm during Task 10 Step 8.
3. `waiting` is a heuristic (busy + tool without result > 20 s). Long-running builds will show it. The label says "likely permission" for that reason.
4. Cloud/Remote sessions are not in the local registry, so `origin` is always `local` in v1; the badge and the `Origin` type are already in place for when they are.
5. Bridge cost: one Haiku turn per relay. If that proves noticeable, the next step is batching multiple targets into one turn (already the case — one turn handles all targets of a single send).
