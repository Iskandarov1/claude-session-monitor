# Claude Session Monitor

A desktop app for macOS and Windows that watches local Claude Code sessions, shows what each one is doing, surfaces messages they send each other, and relays prompts to any of them.

## How it works

- Sessions come from `~/.claude/sessions/<pid>.json`, which Claude Code writes and updates live.
- Transcripts are tailed from `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`.
- Cross-session messages are detected from receiver-side `queue-operation` rows and sender-side `SendMessage` tool calls, then merged into one feed.
- Sending uses one headless Claude bridge session named `csm-bridge`; the app never reads `.key` files or opens Claude messaging sockets directly.

The app only reads local Claude files and talks to its own child process. There is no server and no telemetry.

## Requirements

- Node 22 or newer
- npm 10 or newer
- `claude` on `PATH` for prompt relay. Monitoring still works if the bridge cannot start.

## Develop

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

## Package

```bash
npm run package:mac
npm run package:win
```

macOS packaging writes `release/*.dmg`; Windows packaging writes `release/*.exe` when run on Windows.

The app icon in `build/icon.png` is a placeholder. Replace it before distributing.

## Not in v1

Light mode, cloud/Remote Control sessions, spawning interactive terminals, transcript editing, and notifications.

See [the design spec](docs/superpowers/specs/2026-08-26-claude-session-monitor-design.md) for the full product contract.
