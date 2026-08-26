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
  assistantSend: JSON.stringify({ ...base, parentUuid: 'u5', type: 'assistant', uuid: 'a5', timestamp: '2026-08-26T11:09:00.000Z', message: { id: 'msg_3', model: 'claude-sonnet-4-6', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_2', name: 'SendMessage', input: { to: 'auth-refactor', summary: 'rename', message: 'Heads up - I renamed CacheKey to QueryKey.' } }], usage: { output_tokens: 30 } } }),
  cross: JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-08-26T11:09:30.000Z', sessionId: S, content: '<cross-session-message from="uds:/tmp/cc-socks/42650.sock" hop-chain="80e6" from-name="perf-query-cache" from-mode="bypass">\nHeads up - I renamed CacheKey to QueryKey.\n</cross-session-message>' }),
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
