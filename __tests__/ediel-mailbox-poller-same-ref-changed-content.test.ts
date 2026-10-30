// Sim finding 20261029/claude-track3/016 step 2: same business reference
// (sender+interchange or sender+transaction+external) with CHANGED content was
// silently deduped in findExistingInboundEmail phase 2 and in the 23505 branch
// of storeInboundEmail. Only identical raw sha may dedupe on business refs.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({ rows: [] as Row[], seq: 0, forceConflict: false, facts: null as null | Record<string, string | null> }))

vi.mock('@/lib/ediel/aiBiPersonalDataStorage', () => ({ requireAiBiPersonalDataStorage: async () => null }))
vi.mock('@/lib/inbound-mail/edielInboundProcessor', () => ({ processInboundEmailMessage: vi.fn() }))
vi.mock('@/lib/inbound-mail/edielMailboxPoller.part-1', async (orig) => {
  const real = await orig<typeof import('@/lib/inbound-mail/edielMailboxPoller.part-1')>()
  return { ...real, parseInboundDedupeFacts: (p: string | null | undefined) => (db.facts ? { receiverEdielId: null, messageFamily: null, messageCode: null, ...db.facts } : real.parseInboundDedupeFacts(p)) }
})

// Minimal PostgREST-like fake: eq filters, `.or("col.eq.X,col.is.null" | "id.not.is.null")`.
function query(table: string) {
  const preds: Array<(r: Row) => boolean> = []
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return q },
    or: (expr: string) => {
      const alts = expr.split(',').map(part => {
        const [c, op, ...rest] = part.split('.')
        const v = rest.join('.')
        if (op === 'eq') return (r: Row) => r[c] === v
        if (op === 'is' && v === 'null') return (r: Row) => r[c] == null
        if (op === 'not' && v === 'is.null') return (r: Row) => r[c] != null
        throw new Error(`unsupported or: ${part}`)
      })
      preds.push(r => alts.some(f => f(r)))
      return q
    },
    limit: () => q,
    maybeSingle: async () => ({ data: (table === 'inbound_email_messages' ? db.rows : []).find(r => preds.every(p => p(r))) ?? null, error: null }),
    insert: (row: Row) => {
      if (table !== 'inbound_email_messages') return Promise.resolve({ error: null })
      const conflict = db.forceConflict || db.rows.some(r =>
        (row.internet_message_id && r.mailbox_id === row.mailbox_id && r.internet_message_id === row.internet_message_id) ||
        (row.raw_message_sha256 && r.mailbox_id === row.mailbox_id && r.raw_message_sha256 === row.raw_message_sha256) ||
        // sha-aware business index (migration 20261030131000)
        (row.company_id && r.company_id === row.company_id && r.environment === row.environment && r.sender_ediel_id === row.sender_ediel_id &&
          r.interchange_reference === row.interchange_reference && row.interchange_reference && r.raw_message_sha256 === row.raw_message_sha256))
      const res = conflict ? { data: null, error: { code: '23505', message: 'duplicate key' } } : (() => { const id = `m${++db.seq}`; db.rows.push({ ...row, id }); return { data: { id }, error: null } })()
      return { select: () => ({ single: async () => res }) }
    },
  }
  return q
}
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (t: string) => query(t) } }))

import { storeInboundEmail } from '@/lib/inbound-mail/edielMailboxPoller.part-2'

const REF = { senderEdielId: '7300009000001', interchangeReference: 'IC-1', transactionReference: null, externalReference: null }
const base = { mailboxId: 'mb-shared', companyId: 'co-A', environment: 'test' }

beforeEach(() => { db.rows = []; db.seq = 0; db.forceConflict = false; db.facts = { ...REF } })

describe('016 step 2: business-reference dedupe is content (sha) aware', () => {
  it('same ref + changed content creates a new row (not deduped)', async () => {
    const a = await storeInboundEmail({ ...base, internetMessageId: '<a@x>', rawEdifactPayload: 'PAYLOAD-V1' })
    const b = await storeInboundEmail({ ...base, internetMessageId: '<b@x>', rawEdifactPayload: 'PAYLOAD-V2' })
    expect(a.deduped).toBe(false)
    expect(b).toEqual({ id: expect.not.stringMatching(a.id), deduped: false })
    expect(db.rows).toHaveLength(2)
  })

  it('same transaction+external ref + changed content is not deduped', async () => {
    db.facts = { senderEdielId: 'S', interchangeReference: null, transactionReference: 'T1', externalReference: 'E1' }
    await storeInboundEmail({ ...base, internetMessageId: '<a@x>', rawEdifactPayload: 'V1' })
    const b = await storeInboundEmail({ ...base, internetMessageId: '<b@x>', rawEdifactPayload: 'V2' })
    expect(b.deduped).toBe(false)
    expect(db.rows).toHaveLength(2)
  })

  it('same ref + same content in another mailbox is deduped on the business ref', async () => {
    const a = await storeInboundEmail({ ...base, internetMessageId: '<a@x>', rawEdifactPayload: 'SAME' })
    const b = await storeInboundEmail({ ...base, mailboxId: 'mb-other', internetMessageId: '<b@x>', rawEdifactPayload: 'SAME' })
    expect(b).toEqual({ id: a.id, deduped: true })
    expect(db.rows).toHaveLength(1)
  })

  it('legacy stored row with NULL sha keeps previous reference-only dedupe', async () => {
    db.rows.push({ id: 'legacy', mailbox_id: 'mb-old', company_id: 'co-A', environment: 'test', sender_ediel_id: REF.senderEdielId, interchange_reference: 'IC-1', raw_message_sha256: null })
    const b = await storeInboundEmail({ ...base, internetMessageId: '<b@x>', rawEdifactPayload: 'ANY' })
    expect(b).toEqual({ id: 'legacy', deduped: true })
  })

  it('same Message-ID is deduped as before even with changed content', async () => {
    const a = await storeInboundEmail({ ...base, internetMessageId: '<same@x>', rawEdifactPayload: 'V1' })
    const b = await storeInboundEmail({ ...base, internetMessageId: '<same@x>', rawEdifactPayload: 'V2' })
    expect(b).toEqual({ id: a.id, deduped: true })
  })

  it('23505 race against a row with different sha is not silently deduped', async () => {
    db.rows.push({ id: 'racer', mailbox_id: 'mb-x', company_id: 'co-A', environment: 'test', sender_ediel_id: REF.senderEdielId, interchange_reference: 'IC-1', raw_message_sha256: 'f'.repeat(64) })
    db.forceConflict = true
    await expect(storeInboundEmail({ ...base, internetMessageId: '<n@x>', rawEdifactPayload: 'NEW' })).rejects.toMatchObject({ code: '23505' })
  })

  it('another tenant with the same ref is unaffected', async () => {
    const a = await storeInboundEmail({ ...base, internetMessageId: '<a@x>', rawEdifactPayload: 'SAME' })
    const b = await storeInboundEmail({ ...base, mailboxId: 'mb-other', companyId: 'co-B', internetMessageId: '<b@x>', rawEdifactPayload: 'SAME' })
    expect(b.deduped).toBe(false)
    expect(b.id).not.toBe(a.id)
    expect(db.rows.map(r => r.company_id)).toEqual(['co-A', 'co-B'])
  })
})
