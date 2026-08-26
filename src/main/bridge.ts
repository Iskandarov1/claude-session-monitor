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
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    opts.model,
    '--allowedTools',
    'SendMessage,ListAgents',
    '--no-session-persistence',
    '-n',
    opts.name,
    '--system-prompt',
    RELAY_SYSTEM_PROMPT,
  ]
}

export function buildRelayPrompt(targets: string[], text: string): string {
  return `Relay the message below to each target with SendMessage (one call per target, \`to\` exactly as written). Send it verbatim; add nothing. Then reply with only the JSON summary.\nTargets: ${targets.join(', ')}\n<<<MSG\n${text}\nMSG>>>`
}

export function parseRelayResult(resultText: string, targets: string[], isError: boolean): { sent: string[]; failed: { to: string; error: string }[] } {
  if (isError) return { sent: [], failed: targets.map((to) => ({ to, error: resultText || 'bridge error' })) }
  const match = /\{[\s\S]*\}/.exec(resultText)
  if (match) {
    try {
      const json = JSON.parse(match[0])
      if (Array.isArray(json.sent) || Array.isArray(json.failed)) {
        return {
          sent: (json.sent ?? []).map(String),
          failed: (json.failed ?? []).map((failure: any) => ({ to: String(failure.to), error: String(failure.error ?? 'failed') })),
        }
      }
    } catch {
      // Fall through to optimistic success when Claude reports the turn itself succeeded.
    }
  }
  return { sent: [...targets], failed: [] }
}

const STRIP = ['CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID']

export function stripSessionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (!STRIP.includes(key) && value !== undefined) out[key] = value
  }
  return out
}

interface Pending {
  targets: string[]
  text: string
  resolve: (result: RelayResult) => void
  reject: (err: Error) => void
  startedAt?: number
  timer?: NodeJS.Timeout
}

export class Bridge extends EventEmitter {
  state: BridgeState
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
    this.state = { status: 'reconnecting', attempt: 0, max: this.maxAttempts }
  }

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
    if (targets.length === 0) return Promise.reject(new Error('no relay targets'))
    return new Promise((resolve, reject) => {
      this.queue.push({ targets, text, resolve, reject })
      this.pump()
    })
  }

  private setState(state: BridgeState): void {
    this.state = state
    this.emit('state', state)
  }

  private spawnChild(): void {
    const args = [...(this.opts.prefixArgs ?? []), ...buildArgs({ model: this.model, name: this.name })]
    try {
      const child = spawn(this.opts.command ?? 'claude', args, {
        cwd: this.opts.cwd,
        env: stripSessionEnv(this.opts.env ?? process.env),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.child = child
      this.pid = child.pid
      this.setState({ status: 'reconnecting', attempt: this.attempt, max: this.maxAttempts })
      const rl = readline.createInterface({ input: child.stdout })
      rl.on('line', (line) => this.onLine(line))
      let stderr = ''
      child.stderr.on('data', (data) => {
        stderr = (stderr + data.toString()).slice(-2000)
      })
      child.on('error', (err: any) => this.onExit(err?.code === 'ENOENT' ? `'${this.opts.command ?? 'claude'}' not found on PATH` : String(err?.message ?? err)))
      child.on('exit', (code) => {
        if (this.child === child) this.onExit(`bridge exited with code ${code}${stderr ? `: ${stderr.trim().split('\n').pop()}` : ''}`)
      })
    } catch (err: any) {
      this.onExit(err?.message ?? String(err))
    }
  }

  private killChild(): void {
    const child = this.child
    this.child = undefined
    this.pid = undefined
    if (child && child.exitCode === null) {
      try {
        child.stdin.end()
      } catch {
        // Ignore shutdown errors.
      }
      child.kill()
    }
  }

  private onLine(line: string): void {
    let data: any
    try {
      data = JSON.parse(line)
    } catch {
      return
    }
    if (data.type === 'system' && data.subtype === 'init') {
      this.setState({ status: 'connected', bridgeName: this.name })
      this.pump()
      return
    }
    if (data.type === 'result' && this.inFlight) {
      const pending = this.inFlight
      this.inFlight = undefined
      if (pending.timer) clearTimeout(pending.timer)
      const latencyMs = Date.now() - (pending.startedAt ?? Date.now())
      const parsed = parseRelayResult(String(data.result ?? ''), pending.targets, Boolean(data.is_error))
      this.setState({ status: 'connected', bridgeName: this.name, latencyMs })
      pending.resolve({ ...parsed, latencyMs })
      this.pump()
    }
  }

  private pump(): void {
    if (this.inFlight || !this.child || this.state.status !== 'connected') return
    const pending = this.queue.shift()
    if (!pending) return
    this.inFlight = pending
    pending.startedAt = Date.now()
    pending.timer = setTimeout(() => {
      if (this.inFlight === pending) {
        this.inFlight = undefined
        pending.reject(new Error('relay timed out'))
        this.killChild()
        this.onExit('relay timed out')
      }
    }, this.turnTimeoutMs)
    this.setState({ status: 'relaying', targets: pending.targets })
    this.child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: buildRelayPrompt(pending.targets, pending.text) } }) + '\n')
  }

  private failAll(err: Error): void {
    if (this.inFlight) {
      if (this.inFlight.timer) clearTimeout(this.inFlight.timer)
      this.inFlight.reject(err)
      this.inFlight = undefined
    }
    for (const pending of this.queue.splice(0)) pending.reject(err)
  }

  private onExit(reason: string): void {
    this.child = undefined
    this.pid = undefined
    if (this.stopping) return
    this.failAll(new Error(reason))
    this.attempt += 1
    if (this.attempt >= this.maxAttempts) {
      this.setState({ status: 'unavailable', reason })
      return
    }
    this.setState({ status: 'reconnecting', attempt: this.attempt, max: this.maxAttempts })
    const delay = this.backoff[Math.min(this.attempt - 1, this.backoff.length - 1)] ?? 1000
    this.reconnectTimer = setTimeout(() => this.spawnChild(), delay)
  }
}
