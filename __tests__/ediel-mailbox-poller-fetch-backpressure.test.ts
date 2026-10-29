// Sim finding 20261029-3f1a8ab1/claude-track3/001: pollEdielMailbox ran
// messageFlagsAdd inside `for await (client.fetch(...))`. ImapFlow forbids IMAP
// commands while a FETCH iteration is open (client-side deadlock). This ImapFlow
// double rejects any command issued while a fetch is open and only yields the
// next message after the previous iteration finished.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMailboxRow } from '@/lib/inbound-mail/edielMailboxPoller.part-1'

type Msg = { uid: number; seen: boolean; failStore?: boolean }
const io = vi.hoisted(() => ({
  messages: [] as Msg[],
  fetchOpen: false,
  commandsDuringFetch: [] as string[],
  flagCalls: [] as number[],
  insertSeq: 0,
}))

vi.mock('imapflow', () => ({ ImapFlow: class {
  async connect() { return undefined }
  async getMailboxLock() { return { release: () => undefined } }
  guard(name: string) {
    if (io.fetchOpen) { io.commandsDuringFetch.push(name); throw new Error(`deadlock: ${name} during FETCH`) }
  }
  async *fetch(query: { seen?: boolean }) {
    this.guard('fetch')
    io.fetchOpen = true
    try {
      for (const m of io.messages.filter(x => query.seen === false ? !x.seen : true)) {
        yield { uid: m.uid, envelope: { messageId: `<m${m.uid}@t>`, subject: m.failStore ? 'FAIL' : `s${m.uid}` }, source: Buffer.from(`Subject: s${m.uid}\r\n\r\nbody`), internalDate: new Date('2026-10-29T00:00:00Z') }
      }
    } finally { io.fetchOpen = false }
  }
  async fetchAll(query: { seen?: boolean }, opts: unknown) {
    const out: unknown[] = []
    for await (const m of this.fetch(query)) out.push(m)
    void opts
    return out
  }
  async fetchOne(uid: string, opts: unknown, o: { uid?: boolean }) {
    this.guard('fetchOne')
    if (!o?.uid) throw new Error('fetchOne must use UID')
    void opts
    for await (const m of this.fetch({})) if ((m as { uid: number }).uid === Number(uid)) return m
    return false
  }
  async search(query: { seen?: boolean }) {
    this.guard('search')
    return io.messages.filter(x => query.seen === false ? !x.seen : true).map(m => m.uid)
  }
  async messageFlagsAdd(uid: number) {
    this.guard('messageFlagsAdd')
    io.flagCalls.push(uid)
    const m = io.messages.find(x => x.uid === uid); if (m) m.seen = true
    return true
  }
  async logout() { return undefined }
} }))

vi.mock('@/lib/ediel/aiBiPersonalDataStorage', () => ({ requireAiBiPersonalDataStorage: async () => null }))
vi.mock('@/lib/ediel/transport/smime', () => ({ unpackInboundSmimeIfNeeded: async () => ({ detected: false, decryptedText: null }) }))
vi.mock('@/lib/inbound-mail/edielInboundProcessor', () => ({ processInboundEmailMessage: vi.fn() }))
vi.mock('@/lib/inbound-mail/edielMailboxPoller.part-1', async (orig) => ({
  ...(await orig<typeof import('@/lib/inbound-mail/edielMailboxPoller.part-1')>()),
  markMailboxPollStarted: async (id: string) => ({ id, locked_by: 'w:1', locked_at: '2026-10-29T00:00:00Z' }),
  markMailboxPollFinished: async () => true,
  findExistingInboundEmail: async () => null,
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => ({
    insert: (row: Record<string, unknown>) => {
      const res = table === 'inbound_email_messages' && row.subject === 'FAIL'
        ? { data: null, error: { code: 'XX000', message: 'synthetic store failure' } }
        : { data: { id: `iem-${++io.insertSeq}` }, error: null }
      const chain = { select: () => chain, single: async () => res, then: (r: (v: unknown) => unknown) => Promise.resolve(res).then(r) }
      return chain
    },
  }),
} }))

import { pollEdielMailbox } from '@/lib/inbound-mail/edielMailboxPoller.part-2'

const mailbox = { id: 'mb-1', company_id: 'co-1', environment: 'test', mailbox_name: 'unit', email_address: 'u@example.test',
  imap_host: 'imap.example.test', imap_port: 993, username: 'u', secret_reference: 'env:UNIT_IMAP_PASS', metadata: {} } as unknown as EdielMailboxRow

beforeEach(() => {
  vi.stubEnv('UNIT_IMAP_PASS', 'synthetic')
  io.messages = [1, 2, 3].map(uid => ({ uid, seen: false }))
  io.fetchOpen = false; io.commandsDuringFetch = []; io.flagCalls = []; io.insertSeq = 0
})

describe('pollEdielMailbox IMAP fetch backpressure', () => {
  it('processes all unseen messages and marks each Seen without commands inside FETCH', async () => {
    const r = await pollEdielMailbox({ mailbox })
    expect(io.commandsDuringFetch).toEqual([])
    expect(r.errors).toEqual([])
    expect(r).toMatchObject({ fetched: 3, unseenFetched: 3, stored: 3 })
    expect(io.flagCalls).toEqual([1, 2, 3])
    expect(io.messages.every(m => m.seen)).toBe(true)
  })

  it('sets no flags when markSeen is false', async () => {
    const r = await pollEdielMailbox({ mailbox, markSeen: false })
    expect(r).toMatchObject({ fetched: 3, stored: 3, errors: [] })
    expect(io.flagCalls).toEqual([])
  })

  it('does not mark a message Seen when storing it failed', async () => {
    io.messages[1].failStore = true
    const r = await pollEdielMailbox({ mailbox })
    expect(io.commandsDuringFetch).toEqual([])
    expect(r).toMatchObject({ fetched: 3, stored: 2 })
    expect(r.errors).toHaveLength(1)
    expect(io.flagCalls).toEqual([1, 3])
  })

  it('honours maxMessages and the seen-recent pass without commands inside FETCH', async () => {
    io.messages.push({ uid: 4, seen: true })
    const r = await pollEdielMailbox({ mailbox, maxMessages: 10, includeSeenRecent: true })
    expect(io.commandsDuringFetch).toEqual([])
    expect(r).toMatchObject({ fetched: 4, unseenFetched: 3, seenRecentFetched: 1, stored: 4 })
    const capped = await pollEdielMailbox({ mailbox, maxMessages: 1 })
    expect(capped.fetched).toBeLessThanOrEqual(1)
  })
})
