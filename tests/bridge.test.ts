import { afterEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import { Bridge, buildArgs, buildRelayPrompt, parseRelayResult, stripSessionEnv } from '@main/bridge'

const FAKE = path.resolve(__dirname, 'fixtures/fake-claude.cjs')
const mk = (env: Record<string, string> = {}, over: Partial<ConstructorParameters<typeof Bridge>[0]> = {}) =>
  new Bridge({ command: process.execPath, prefixArgs: [FAKE], cwd: process.cwd(), env: { ...process.env, ...env }, backoffMs: [10, 10, 10], maxAttempts: 2, ...over })

const waitFor = async (cond: () => boolean, ms = 5000) => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

let bridge: Bridge | undefined
afterEach(async () => {
  await bridge?.stop()
  bridge = undefined
})

describe('Bridge', () => {
  it('builds command helpers and parses relay results', () => {
    expect(buildArgs({ model: 'haiku', name: 'csm-bridge' })).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      'haiku',
      '--allowedTools',
      'SendMessage,ListAgents',
      '--no-session-persistence',
      '-n',
      'csm-bridge',
      '--system-prompt',
      expect.any(String),
    ])
    expect(buildRelayPrompt(['a'], 'hello')).toContain('Targets: a')
    expect(parseRelayResult('Done {"sent":["a"],"failed":[]}', ['a'], false)).toEqual({ sent: ['a'], failed: [] })
    expect(parseRelayResult('boom', ['a'], true)).toEqual({ sent: [], failed: [{ to: 'a', error: 'boom' }] })
    expect(stripSessionEnv({ PATH: '/x', CLAUDE_CODE_MESSAGING_SOCKET: 's', CLAUDE_CODE_SESSION_ID: 'id' })).toEqual({ PATH: '/x' })
  })

  it('connects, relays, queues, and becomes unavailable after repeated crashes', async () => {
    bridge = mk()
    bridge.start()
    await waitFor(() => bridge!.state.status === 'connected')
    const [a, b] = await Promise.all([bridge.relay(['auth'], 'status?'), bridge.relay(['missing-one'], 'again')])
    expect(a.sent).toEqual(['auth'])
    expect(b.failed).toEqual([{ to: 'missing-one', error: 'no such session' }])
    await bridge.stop()

    bridge = mk({ FAKE_CLAUDE_CRASH_AFTER: '1' })
    bridge.start()
    await waitFor(() => bridge!.state.status === 'connected')
    await bridge.relay(['a'], 'x')
    await waitFor(() => bridge!.state.status === 'reconnecting')
    await waitFor(() => bridge!.state.status === 'connected')
    await bridge.relay(['a'], 'y')
    await waitFor(() => bridge!.state.status === 'unavailable')
  }, 10_000)
})
