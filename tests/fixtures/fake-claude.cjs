const readline = require('node:readline')
const crashAfter = Number(process.env.FAKE_CLAUDE_CRASH_AFTER || 0)
let turns = 0
const out = (value) => process.stdout.write(JSON.stringify(value) + '\n')
if (!process.env.FAKE_CLAUDE_NO_INIT) out({ type: 'system', subtype: 'init', session_id: 'fake-session' })
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  const text = typeof msg.message?.content === 'string' ? msg.message.content : ''
  const match = /^Targets: (.*)$/m.exec(text)
  const targets = match ? match[1].split(',').map((target) => target.trim()).filter(Boolean) : []
  const sent = targets.filter((target) => !target.startsWith('missing-'))
  const failed = targets.filter((target) => target.startsWith('missing-')).map((to) => ({ to, error: 'no such session' }))
  out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } })
  out({ type: 'result', subtype: 'success', is_error: false, num_turns: ++turns, result: JSON.stringify({ sent, failed }) })
  if (crashAfter && turns >= crashAfter) setTimeout(() => process.exit(3), 5)
})
rl.on('close', () => process.exit(0))
