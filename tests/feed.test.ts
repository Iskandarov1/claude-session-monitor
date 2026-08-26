import { describe, expect, it } from 'vitest'
import { FeedBuilder } from '@main/feed'
import type { TranscriptEvent } from '@shared/types'

const sent = (ts: number, to: string, text: string): TranscriptEvent => ({ kind: 'sent', id: `s${ts}`, ts, to: [to], text })
const cross = (ts: number, fromName: string, text: string): TranscriptEvent => ({ kind: 'cross', id: `x${ts}`, ts, fromName, text })

describe('FeedBuilder', () => {
  it('creates, merges, sorts, relabels, and renames feed items', () => {
    const feed = new FeedBuilder({ bridgeName: 'csm-bridge' })
    expect(feed.ingest('A', 'perf', [sent(1000, 'auth', 'hello')])).toBe(true)
    feed.ingest('B', 'auth', [cross(1100, 'perf', 'hello')])
    expect(feed.items()).toHaveLength(1)
    expect(feed.items()[0]).toMatchObject({ from: 'perf', to: ['auth'], senderSessionId: 'A', receiverSessionIds: ['B'] })

    feed.recordRelay(['auth'], 'status?', 2000)
    feed.ingest('B', 'auth', [cross(2100, 'csm-bridge', 'status?')])
    expect(feed.items()[0]).toMatchObject({ from: 'you', viaBridge: true, receiverSessionIds: ['B'] })

    feed.rename('A', 'perf-new')
    expect(feed.items().find((item) => item.senderSessionId === 'A')?.from).toBe('perf-new')
  })
})
