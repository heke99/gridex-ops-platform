// reality-defects: J1-11
// J1-11 (scenario J1, step J1-7; native proof scripts/inbound-prodat-j1-native.test.ts): the grid owner's Z04 arrives
// before its CONTRL/APERAK on our Z03. Our own CONTRL/APERAK on the Z04 inherit the Z04's outbound_request_id (the
// Z03 request). When the grid owner's late ACK on the Z03 was then received, the intake's ACK writer updated every
// outbound ediel_message of that request: it rewrote our own replies' related_message_id from the Z04 to the
// received ACK and stamped them with the Z03's ACK columns. The Z04's APERAK watch reads our answers by
// related_message_id, so the Z04 looked unanswered. Our own CONTRL/APERAK/UTILTS_ERR are never the acknowledged
// original (the outbound matcher already excludes them, lib/inbound-mail/inboundMatcher.ts).
// Rules exercised (specification only, not coverage tags): P-11, ACK-02, ACK-06.
//
// Unit proof with an in-memory Supabase port; the real canonical intake ACK writer runs. Synthetic data only.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const port = vi.hoisted(() => ({ rows: {} as Record<string, Row[]>, seq: 0 }))

vi.mock('@/lib/supabase/service', () => {
  type Filter = (row: Row) => boolean
  const from = (table: string) => {
    let op: 'select' | 'update' | 'insert' = 'select'
    let patch: Row | Row[] = {}
    let maximum = Number.POSITIVE_INFINITY
    const filters: Filter[] = []
    const run = () => {
      const rows = (port.rows[table] ??= [])
      if (op === 'insert') {
        const list = (Array.isArray(patch) ? patch : [patch]).map((value) => ({ id: `${table}-${++port.seq}`, ...value }))
        rows.push(...list)
        return list
      }
      const hit = rows.filter((row) => filters.every((filter) => filter(row))).slice(0, maximum)
      if (op === 'update') hit.forEach((row) => Object.assign(row, structuredClone(patch)))
      return hit
    }
    const q: Row = {}
    Object.assign(q, {
      select: () => q,
      eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return q },
      in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return q },
      not: (column: string, operator: string, value: unknown) => {
        if (operator !== 'in') throw Error(`unexpected not ${operator}`)
        const list = String(value).replace(/[()"]/g, '').split(',')
        filters.push((row) => !list.includes(String(row[column])))
        return q
      },
      order: () => q,
      limit: (value: number) => { maximum = value; return q },
      update: (value: Row) => { op = 'update'; patch = value; return q },
      insert: (value: Row | Row[]) => { op = 'insert'; patch = value; return q },
      maybeSingle: async () => ({ data: structuredClone(run()[0] ?? null), error: null }),
      then: (ok: (value: unknown) => unknown, fail?: (error: unknown) => unknown) =>
        Promise.resolve({ data: structuredClone(run()), error: null }).then(ok, fail),
    })
    return q
  }
  return { supabaseService: { from, rpc: async (name: string) => { throw Error(`unexpected rpc ${name}`) } } }
})
vi.mock('@/lib/inbound-mail/inboundTaskFactory', () => ({ createInboundMailTask: async () => 'task' }))
vi.mock('@/lib/ediel/inbound/receptions', () => ({ recordInboundReception: async () => ({ classification: 'first_reception' }) }))

import { applyCanonicalInboundAckStatusUpdate } from '@/lib/inbound-mail/canonicalInboundAckStatusUpdater'
import { parseEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'

const COMPANY = '7b53f121-0000-4000-8000-000000000111'
const OUTBOUND = '13eeb887-0000-4000-8000-000000000111'
const SWITCH = '7b34e761-0000-4000-8000-000000000111'
const Z03 = '22222222-0000-4000-8000-000000000111'
const Z04 = '55555555-0000-4000-8000-000000000111'
const OUR_CONTRL = '66666666-0000-4000-8000-000000000111'
const OUR_APERAK = '77777777-0000-4000-8000-000000000111'

const unb = "UNA:+.? 'UNB+UNOC:3+7300000000002:14+7300000000001:14+261004:1200+A-1++23-DDQ-PRODAT'"
const positiveContrl = () => parseEdifactPayload(unb + "UNH+1+CONTRL:2:2:UN:EDIEL2'UCI+ORIG-I+7300000000001:14+7300000000002:14+1'UNT+3+1'UNZ+1+A-1'")
const negativeContrl = () => parseEdifactPayload(unb + "UNH+1+CONTRL:2:2:UN:EDIEL2'UCI+ORIG-I+7300000000001:14+7300000000002:14+4'UNT+3+1'UNZ+1+A-1'")
const ackOnZ03 = (parsed: ReturnType<typeof parseEdifactPayload>) => applyCanonicalInboundAckStatusUpdate({ companyId: COMPANY, environment: 'production', parsed,
  outboundMatch: { status: 'matched', entityType: 'outbound_request', entityId: OUTBOUND, candidates: [{ source_type: 'supplier_switch_request', source_id: SWITCH }] } as never,
  meteringPointMatch: { status: 'unmatched', candidates: [] } as never, inboundEmailMessageId: 'mail-1' })

const message = (id: string) => port.rows.ediel_messages.find((row) => row.id === id)!
/** Our own reply as createCanonicalAckMessage stores it: related to the Z04 it answers, the Z04's outbound request. */
const ownReply = (id: string, family: 'CONTRL' | 'APERAK'): Row => ({ id, company_id: COMPANY, direction: 'outbound', message_family: family,
  message_code: family, related_message_id: Z04, outbound_request_id: OUTBOUND, ack_outcome: 'positive', contrl_status: 'pending', aperak_status: 'not_required',
  failure_reason: null })

beforeEach(() => {
  port.seq = 0
  port.rows = {
    outbound_requests: [{ id: OUTBOUND, company_id: COMPANY, source_type: 'supplier_switch_request', source_id: SWITCH, status: 'confirmed', response_payload: {} }],
    supplier_switch_requests: [{ id: SWITCH, company_id: COMPANY, status: 'accepted', inbound_z04_message_id: Z04 }],
    ediel_messages: [
      { id: Z03, company_id: COMPANY, direction: 'outbound', message_family: 'PRODAT', message_code: 'Z03', related_message_id: null, outbound_request_id: OUTBOUND, contrl_status: 'pending', aperak_status: 'pending' },
      { id: Z04, company_id: COMPANY, direction: 'inbound', message_family: 'PRODAT', message_code: 'Z04', related_message_id: Z03, outbound_request_id: OUTBOUND },
      ownReply(OUR_CONTRL, 'CONTRL'),
      ownReply(OUR_APERAK, 'APERAK'),
    ],
    ediel_message_events: [],
  }
})

describe('J1-11 the grid owner\'s late ACK on our Z03 leaves our replies to the Z04 alone', () => {
  it('a late positive CONTRL on the Z03 keeps our APERAK and CONTRL related to the Z04 they answer', async () => {
    const before = [structuredClone(message(OUR_CONTRL)), structuredClone(message(OUR_APERAK))]
    const result = await ackOnZ03(positiveContrl())
    expect(result.inboundEdielMessageId).toBeTruthy()
    expect(message(OUR_APERAK)).toEqual(before[1])
    expect(message(OUR_CONTRL)).toEqual(before[0])
    // The Z04's APERAK watch reads our answers by related_message_id.
    const answers = port.rows.ediel_messages.filter((row) => row.direction === 'outbound' && row.related_message_id === Z04).map((row) => row.message_family)
    expect(answers.sort()).toEqual(['APERAK', 'CONTRL'])
  })

  it('a late negative CONTRL on the Z03 does not mark our replies to the Z04 as rejected', async () => {
    await ackOnZ03(negativeContrl())
    expect(message(OUR_APERAK)).toMatchObject({ related_message_id: Z04, ack_outcome: 'positive', failure_reason: null })
    expect(message(OUR_CONTRL)).toMatchObject({ related_message_id: Z04, ack_outcome: 'positive', failure_reason: null })
  })

  it('the Z03 itself still records the received ACK (unchanged forward path)', async () => {
    const result = await ackOnZ03(positiveContrl())
    expect(message(Z03)).toMatchObject({ related_message_id: result.inboundEdielMessageId, contrl_status: 'accepted', ack_outcome: 'positive' })
    // The inbound Z04 is not an outbound message and is never touched.
    expect(message(Z04)).toMatchObject({ related_message_id: Z03 })
  })
})
