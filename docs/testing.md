# Manual verification

Automated tests cover parsers, watchers, bridge protocol, search, IPC, and renderer wiring. These steps cover behavior that requires real Claude Code sessions.

## macOS

1. Open two terminals and start `claude -n alpha` and `claude -n beta` in different repos.
2. Run `npm run dev`.
   - [ ] Both sessions appear in the sidebar within roughly two seconds.
   - [ ] Idle/busy state and cwd display correctly.
   - [ ] The bridge status turns connected within roughly ten seconds.
3. Ask one session to do something slow.
   - [ ] Its status dot pulses.
   - [ ] Transcript tailing follows appended messages.
   - [ ] The streaming indicator appears during the active turn.
4. Scroll up while new transcript rows arrive.
   - [ ] The new-message pill appears.
   - [ ] Clicking it returns to the tail.
5. Select `beta`, type `reply with the word pong`, and press Cmd+Enter.
   - [ ] Relay status changes while sending.
   - [ ] `beta` receives a message from `csm-bridge`.
   - [ ] The feed shows one `you → beta` item marked as relayed via bridge.
6. From `alpha`, ask Claude to send `hello` to `beta`.
   - [ ] Sender transcript shows a `→ beta` row.
   - [ ] Receiver transcript shows a `⇄ from alpha` row.
   - [ ] Feed tab contains one merged item, not duplicates.
7. Press Cmd+K and search for a word used in the session.
   - [ ] Results show session name, time, and snippet.
   - [ ] Selecting a result jumps to the transcript event.
8. Quit one Claude terminal.
   - [ ] Its row changes to `ended` within roughly five seconds and remains visible.
9. Kill the bridge with `pkill -f csm-bridge`.
   - [ ] Relay panel shows reconnecting.
   - [ ] It either recovers or shows a clear unavailable reason.
   - [ ] Monitoring and transcript tailing keep working.
10. Quit and reopen the app.
    - [ ] Window bounds restore.
    - [ ] Last selected session and pins restore.
    - [ ] `~/.claude/sessions` has no stale `csm-bridge` entry from this app.

## Windows first run

- [ ] `%USERPROFILE%\.claude\sessions\*.json` has the same usable fields.
- [ ] Sessions list correctly.
- [ ] Windows paths shorten correctly in the UI.
- [ ] Custom min/max/close controls work.
- [ ] Ctrl+K opens search.
- [ ] Ctrl+Enter sends through relay.
- [ ] Bridge starts via `claude.cmd`, or relay shows a clear PATH error while monitoring still works.
