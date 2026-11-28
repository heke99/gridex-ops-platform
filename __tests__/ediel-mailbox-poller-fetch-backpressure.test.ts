// Sim finding 20261029-3f1a8ab1/claude-track3/001: pollEdielMailbox ran
// messageFlagsAdd inside `for await (client.fetch(...))`. ImapFlow forbids IMAP
// commands while a FETCH iteration is open (client-side deadlock). This ImapFlow
// double rejects any command issued while a fetch is open and only yields the
// next message after the previous iteration finished.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMailboxRow } from '@/lib/inbound-mail/edielMailboxPoller.part-1'
import { IMAP_BUSINESS_RECEIPT_PENDING, nextEdielImapRetry } from '@/lib/inbound-mail/edielImapScan'

type Msg = { uid: number; seen: boolean; failStore?: boolean }
const io = vi.hoisted(() => ({
  messages: [] as Msg[],
  metadata: {} as Record<string, unknown>,
  heldTechnical: new Set<number>(),
  heldReads: [] as number[][],
  failHeldRead: false,
  fetchOpen: false,
  commandsDuringFetch: [] as string[],
  flagCalls: [] as number[],
  receipts: new Set<number>(),
  terminal: new Set<number>(),
  socketErrorOnFetch: false,
  finishPoll: vi.fn(async (_input: unknown) => true),
}))

vi.mock('imapflow', async () => { const { EventEmitter } = await import('node:events'); return { ImapFlow: class extends EventEmitter {
  async connect() { return undefined }
  get mailbox() { return { uidValidity: BigInt(1), path: "INBOX", uidNext: Math.max(...io.messages.map(m=>m.uid),0)+1 } }
  async getMailboxLock() { return { release: () => undefined } }
  guard(name: string) {
    if (io.fetchOpen) { io.commandsDuringFetch.push(name); throw new Error(`deadlock: ${name} during FETCH`) }
  }
  async *fetch(query: { seen?: boolean }) {
    this.guard('fetch')
    io.fetchOpen = true
    try {
      if (io.socketErrorOnFetch) {
        // imapflow emits 'error' on socket failure and rejects the in-flight
        // command. EventEmitter throws synchronously when nobody listens.
        const err = new Error('Socket timeout')
        this.emit('error', err)
        throw err
      }
      for (const m of io.messages.filter(x => query.seen === false ? !x.seen : true)) {
        yield { uid: m.uid, flags: new Set(m.seen ? ['\\Seen'] : []), envelope: { messageId: `<m${m.uid}@t>`, subject: m.failStore ? 'FAIL' : `s${m.uid}` }, source: Buffer.from(`Subject: s${m.uid}\r\n\r\nbody`), internalDate: new Date('2026-10-29T00:00:00Z') }
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
  async search(query: { seen?: boolean; uid?: string }) {
    this.guard('search')
    const [start,end] = (query.uid ?? '0:4294967295').split(':').map(Number)
    return io.messages.filter(x=>x.uid>=start && x.uid<=end && (query.seen!==false || !x.seen)).map(m=>m.uid)
  }
  async messageFlagsAdd(uid: number) {
    this.guard('messageFlagsAdd')
    io.flagCalls.push(uid)
    const m = io.messages.find(x => x.uid === uid); if (m) m.seen = true
    return true
  }
  async logout() { return undefined }
} } })

vi.mock('@/lib/ediel/aiBiPersonalDataStorage', () => ({ requireAiBiPersonalDataStorage: async () => null }))
vi.mock('@/lib/ediel/transport/smime', () => ({ unpackInboundSmimeIfNeeded: async () => ({ detected: false, decryptedText: null }) }))
vi.mock('@/lib/inbound-mail/edielInboundProcessor', () => ({ processInboundEmailMessage: vi.fn() }))
vi.mock('@/lib/inbound-mail/edielMailboxPoller.part-1', async (orig) => ({
  ...(await orig<typeof import('@/lib/inbound-mail/edielMailboxPoller.part-1')>()),
  markMailboxPollStarted: async (id: string) => ({ id, locked_by: 'w:1', locked_at: '2026-10-29T00:00:00Z' }),
  markMailboxPollFinished: io.finishPoll,
  findExistingInboundEmail: async () => null,
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    if (table !== 'ediel_mailboxes') throw new Error('unexpected table: '+table)
    const query = { select:()=>query, eq:()=>query,
      maybeSingle:async()=>({data:{metadata:structuredClone(io.metadata)},error:null}) }
    return query
  },
  rpc: async (name: string, args: Record<string,unknown>) => {
    if (name==="gridex_list_held_e66_technical_imap_uids_v1") {
      const uids=args.p_uids as number[]
      expect(args).toMatchObject({p_mailbox:'mb-1',p_worker:'w:1',p_claimed_at:'2026-10-29T00:00:00Z',
        p_validity:1,p_folder:'INBOX',p_scope:expect.stringMatching(/^[a-f0-9]{64}$/)})
      io.heldReads.push(uids)
      return io.failHeldRead ? {data:null,error:{message:'fixture held lookup unavailable'}} :
        {data:uids.filter(uid=>io.heldTechnical.has(uid)),error:null}
    }
    if (name==="gridex_checkpoint_ediel_imap_scan_v1") {
      expect(args.p_expected_metadata).toEqual(io.metadata)
      io.metadata={...io.metadata,ediel_imap_scan_v1:args.p_scan}
      return {data:true,error:null}
    }
    if (name==="gridex_can_acknowledge_verified_imap_source_v1") {
      const uid=Number(args.p_uid)
      expect(args).toMatchObject({p_mailbox:'mb-1',p_worker:'w:1',p_claimed_at:'2026-10-29T00:00:00Z',
        p_mail:`iem-${uid}`,p_folder:'INBOX',p_validity:1,
        p_scope:expect.stringMatching(/^[a-f0-9]{64}$/),p_sha256:expect.stringMatching(/^[a-f0-9]{64}$/)})
      return {data:io.terminal.has(uid),error:null}
    }
    if (name!=="gridex_store_verified_imap_intake_v1") throw new Error("unexpected rpc: "+name)
    const message=args.p_message as Record<string,unknown>
    if (message.subject==="FAIL") return {data:null,error:{code:"XX000",message:"synthetic store failure"}}
    const uid=Number(message.imap_uid)
    const deduped=io.receipts.has(uid)
    io.receipts.add(uid)
    return {data:{id:`iem-${uid}`,deduped},error:null}
  },
} }))

import { pollEdielMailbox } from '@/lib/inbound-mail/edielMailboxPoller.part-2'

const mailbox = { id: 'mb-1', company_id: 'co-1', environment: 'test', mailbox_name: 'unit', email_address: 'u@example.test',
  imap_host: 'imap.example.test', imap_port: 993, username: 'u', secret_reference: 'env:UNIT_IMAP_PASS', metadata: {} } as unknown as EdielMailboxRow

beforeEach(() => {
  vi.stubEnv('UNIT_IMAP_PASS', 'synthetic')
  io.finishPoll.mockClear()
  io.messages = [1, 2, 3].map(uid => ({ uid, seen: false }))
  io.metadata={};io.heldReads=[];io.heldTechnical.clear();io.failHeldRead=false
  io.fetchOpen = false; io.commandsDuringFetch = []; io.flagCalls = []; io.receipts.clear(); io.terminal.clear(); io.socketErrorOnFetch = false
})

describe('pollEdielMailbox IMAP fetch backpressure', () => {
  it('retains each message, then marks it Seen only with a terminal receipt and outside FETCH', async () => {
    const r = await pollEdielMailbox({ mailbox })
    expect(io.commandsDuringFetch).toEqual([])
    expect(r.errors).toEqual([])
    expect(r).toMatchObject({ fetched: 3, unseenFetched: 3, stored: 3 })
    expect(io.flagCalls).toEqual([])
    io.terminal=new Set([1,2,3])
    const replay=await pollEdielMailbox({ mailbox })
    expect(replay).toMatchObject({ fetched:3,stored:0,deduped:3,errors:[] })
    expect(io.commandsDuringFetch).toEqual([])
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
    io.receipts=new Set([1,3])
    io.terminal=new Set([1,2,3])
    const r = await pollEdielMailbox({ mailbox })
    expect(io.commandsDuringFetch).toEqual([])
    expect(r).toMatchObject({ fetched: 3, stored: 0, deduped: 2 })
    expect(r.errors).toEqual(['imap_storage_sqlstate_XX000'])
    expect(io.finishPoll).toHaveBeenCalledExactlyOnceWith({
      claim: { id: mailbox.id, locked_by: 'w:1', locked_at: '2026-10-29T00:00:00Z' },
      ok: false,
      errorMessage: 'imap_storage_sqlstate_XX000',
    })
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

  // Adopted from 7b0ccaad: a client 'error' event must not crash the process.
  it('handles an IMAP client error event as a recorded mailbox failure', async () => {
    io.socketErrorOnFetch = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const r = await pollEdielMailbox({ mailbox })
    expect(r.errors).toEqual(['Socket timeout'])
    expect(r).toMatchObject({ fetched: 0, stored: 0 })
    expect(io.flagCalls).toEqual([])
    expect(warn).toHaveBeenCalledWith('[inbound-mail] IMAP connection error', { mailboxId: 'mb-1', error: 'Socket timeout' })
    warn.mockRestore()
  })
})

it('skips an immutable held UID while it remains unread and still processes live and pending neighbours', async () => {
  const options={mailbox,trackUids:true,maxMessages:3}
  const first=await pollEdielMailbox(options)
  expect(first).toMatchObject({stored:3,errors:[]})
  io.heldTechnical.add(1)
  io.messages.push({uid:4,seen:false})
  const next=await pollEdielMailbox(options)
  expect(next).toMatchObject({fetched:1,stored:1,errors:[]})
  expect(io.heldReads.at(-1)).toEqual([1,2,3])
  expect(io.flagCalls).toEqual([])
  expect(io.messages[0].seen).toBe(false)
  const metadata=JSON.stringify(io.metadata)
  expect(metadata).not.toContain('"1":{"attempts"')
  expect(metadata).toContain('"2":{"attempts"')
  expect(metadata).toContain('"4":{"attempts"')
  expect((await pollEdielMailbox(options)).fetched).toBe(0)
  expect(io.flagCalls).toEqual([])
})

it('still stores a live UID without touching old retries if the hold read is unavailable', async () => {
  const options={mailbox,trackUids:true,maxMessages:3}
  await pollEdielMailbox(options)
  io.failHeldRead=true
  io.messages.push({uid:4,seen:false})
  const next=await pollEdielMailbox(options)
  expect(next).toMatchObject({fetched:1,stored:1,errors:['imap_technical_hold_read_unavailable']})
  expect(io.flagCalls).toEqual([])
  expect(JSON.stringify(io.metadata)).toContain('"1":{"attempts":1')
})

it('keeps business receipt and physical transport retry limits independent', () => {
  const business = {
    attempts: 8, reviewRequired: false, reason: IMAP_BUSINESS_RECEIPT_PENDING, nextAttemptAt: null,
  }
  const transport = nextEdielImapRetry(business, 'imap_scan_source_storage_pending')
  expect(transport).toMatchObject({ attempts: 1, reviewRequired: false })
  const resumedBusiness = nextEdielImapRetry({ ...transport, attempts: 4 }, IMAP_BUSINESS_RECEIPT_PENDING)
  expect(resumedBusiness).toMatchObject({ attempts: 1, reviewRequired: false })
  expect(nextEdielImapRetry({ ...transport, attempts: 4 }, 'imap_scan_source_fetch_failed')).toMatchObject({
    attempts: 5, reviewRequired: true,
  })
})
