// reality-defects: I-B13
// I-B13 (scenario I, step I8, facility S9 'S9-late-negative'): the grid owner sent CONTRL, then Z04 (13:25:35) and then
// a negative APERAK with a header error (ERC 40/102, 13:25:51). One poll stored them in that order. The mail intake of
// the APERAK marked the switch 'rejected' (ACK-01 alarm) before any business processing ran, and the run then processed
// the Ediel messages newest first and four at a time. The native owner held the Z04 ('normal_z04_locked_original_scope_
// required': a 'rejected' switch is not waiting for a Z04), and the canonical ACK owner failed the switch. P-11/GOR-02
// require the opposite: a Z04 sent before the negative APERAK confirms the switch, and the late APERAK only leaves a
// warning on it. A Z04 that does not confirm the switch for its own reasons still lets the APERAK fail it, once.
// Rules exercised (specification only, not coverage tags): P-11, GOR-02, GOR-04, ACK-01.
//
// The real intake ACK writer (applyCanonicalInboundAckStatusUpdate), the real business-processing lanes of the inbound
// engine (runInboundBusinessInArrivalLanes) and the real canonical ACK owner (processInboundAckMessage) run against an
// in-memory Supabase port. The SQL ACK receipt has the shape of gridex_apply_inbound_ack_source_v1 and, like the SQL
// owner, marks a wholly rejected Z03 'failed'. The native Z04 owner is reduced to its admission gate in
// gridex_received_sources.normal_switch_scope_effect_v1 (switch still waiting, Z03 still 'sent'/'acknowledged').
// Synthetic data only.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const port = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  committed: new Set<string>(),
  seq: 0,
}))

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
        const list = (Array.isArray(patch) ? patch : [patch]).map((value) => ({ id: `${table}-${++port.seq}`, created_at: new Date(Date.UTC(2026, 9, 27, 13, 27, 30) + port.seq).toISOString(), ...value }))
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
      neq: (column: string, value: unknown) => { filters.push((row) => row[column] !== value); return q },
      in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return q },
      is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return q },
      not: (column: string, operator: string, value: unknown) => {
        if (operator === 'is') filters.push((row) => (row[column] ?? null) !== value)
        else if (operator === 'in') { const list = String(value).replace(/[()"]/g, '').split(','); filters.push((row) => !list.includes(String(row[column]))) }
        else throw Error(`unexpected not ${operator}`)
        return q
      },
      lt: (column: string, value: string) => { filters.push((row) => row[column] != null && String(row[column]) < value); return q },
      order: () => q,
      limit: (value: number) => { maximum = value; return q },
      update: (value: Row) => { op = 'update'; patch = value; return q },
      insert: (value: Row | Row[]) => { op = 'insert'; patch = value; return q },
      maybeSingle: async () => ({ data: structuredClone(run()[0] ?? null), error: null }),
      single: async () => { const row = run()[0]; return row ? { data: structuredClone(row), error: null } : { data: null, error: { code: 'PGRST116', message: 'no row' } } },
      then: (ok: (value: unknown) => unknown, fail?: (error: unknown) => unknown) => {
        try { return Promise.resolve({ data: structuredClone(run()), error: null }).then(ok, fail) } catch (error) { return Promise.reject(error).then(ok, fail) }
      },
    })
    return q
  }
  const z03 = () => port.rows.ediel_messages.find((row) => row.direction === 'outbound' && row.message_code === 'Z03')!
  return { supabaseService: {
    from,
    rpc: async (name: string, args: Row) => {
      if (name === 'gridex_read_inbound_ack_source_v1') return { data: { version: 1, sourceMessage: structuredClone(z03()) }, error: null }
      if (name === 'gridex_apply_inbound_ack_source_v1') {
        // The SQL owner (gridex_ack_authority.apply_before_committed_replay_v1): a whole-source negative APERAK marks our Z03 failed.
        Object.assign(z03(), { status: 'failed', aperak_status: 'failed' })
        port.committed.add(String(args.p_ack_message_id))
        return { data: { version: 1, sourceMessage: structuredClone(z03()), outcome: 'negative', scope: 'message', scopeOutcomes: [], finalAckReached: false,
          wholeSourceRejected: true, sourceAccepted: false, failureReason: 'APERAK negative whole-source acknowledgement', idempotent: false }, error: null }
      }
      throw Error(`unexpected rpc ${name}`)
    },
  } }
})
vi.mock('@/lib/ediel/ack/committedInboundAck', () => ({
  // A committed receipt is replayed without a second business effect.
  readCommittedInboundAck: async ({ message }: { message: Row }) => port.committed.has(String(message.id))
    ? { kind: 'receipt', result: { sourceMessage: port.rows.ediel_messages.find((row) => row.message_code === 'Z03'), outcome: 'negative', finalAckReached: false, wholeSourceRejected: true, sourceAccepted: false } }
    : null,
}))
vi.mock('@/lib/ediel/ack/sourceCorrelation', () => ({
  readInboundAckSourceCorrelation: () => ({ classification: { outcome: 'negative' }, lookupReferences: [] }),
  qualifyInboundAckSourceCandidates: ({ candidates }: { candidates: unknown[] }) => ({ status: 'unique', sourceMessage: candidates[0] }),
}))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: async () => ({}), linkEdielMessage: async () => ({}), updateEdielMessageStatus: async () => ({}) }))
vi.mock('@/lib/ediel/flows/shared', () => ({ ensureActorUserId: (value: string) => value, getGridOwnerDataRequestById: async () => null }))
vi.mock('@/lib/operations/db', () => ({
  updateSupplierSwitchRequestStatus: async (_client: unknown, input: Row) => {
    const row = port.rows.supplier_switch_requests.find((item) => item.id === input.requestId)!
    Object.assign(row, { status: input.status, failure_reason: input.failureReason ?? null })
    return structuredClone(row)
  },
  createSupplierSwitchEvent: async (_client: unknown, input: Row) => { (port.rows.supplier_switch_events ??= []).push(input); return input },
}))
vi.mock('@/lib/customer-cases/db', () => ({ syncCustomerCaseCancellationAck: async () => null }))
vi.mock('@/lib/ediel/actorTestingEngine', () => ({ syncActorTestingForMessage: async () => null }))
vi.mock('@/lib/inbound-mail/inboundTaskFactory', () => ({ createInboundMailTask: async () => 'task' }))
vi.mock('@/lib/inbound-mail/edielInboundProcessor', () => ({ processInboundEmailMessage: async () => ({ status: 'processed' }) }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: async () => undefined }))

import { processInboundAckMessage } from '@/lib/ediel/flows/inboundAckProcessing'
import { applyCanonicalInboundAckStatusUpdate } from '@/lib/inbound-mail/canonicalInboundAckStatusUpdater'
import { planInboundBusinessLanes, runInboundBusinessInArrivalLanes } from '@/lib/inbound-mail/edielMailboxPoller.part-2'
import { parseEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'
import type { EdielMessageRow } from '@/lib/ediel/types'

const COMPANY = '2cd4040d-0000-4000-8000-000000000b13'
const OTHER_COMPANY = '9f1d2c3b-0000-4000-8000-000000000b13'
const ACTOR = 'aaaaaaaa-0000-4000-8000-000000000b13'
const OUTBOUND = 'd66ba494-0000-4000-8000-000000000b13'
const SWITCH = '2b477c44-0000-4000-8000-000000000b13'
const Z03 = '01eeffca-0000-4000-8000-000000000b13'
const Z04 = '8d8ab3b5-0000-4000-8000-000000000b13'
// The grid owner's APERAK in I8: whole message rejected (BGM 27), ERC 40/102.
const HEADER_REJECTION = "UNA:+.? 'UNB+UNOC:3+16700:14+70456:14+261027:1325+APK1++23-DDQ-PRODAT'UNH+1+APERAK:D:96A:UN:E2SE6A'BGM+++27'DTM+137:202610271325:203'"
  + "RFF+ACW:DOC1'NAD+FR+16700:160:SVK+++++++SE'NAD+DO+70456:160:SVK+++++++SE'ERC+40::260'FTX+AAO++102::260+Meddelandehuvudet kunde inte läsas'UNT+9+1'UNZ+1+APK1'"
const WAITING_FOR_Z04 = ['prepared', 'queued', 'submitted', 'sent', 'waiting', 'waiting_response', 'waiting_for_z04', 'awaiting_confirmation', 'cancelled_before_start']

const switchRow = () => port.rows.supplier_switch_requests.find((row) => row.id === SWITCH)!
const z03Row = () => port.rows.ediel_messages.find((row) => row.id === Z03)!
const switchEvents = () => (port.rows.supplier_switch_events ?? []) as Row[]

/** The Z04 row the mail intake stores (status 'received', bound to our Z03's outbound request by the intake matcher). */
function storeZ04(patch: Row = {}) {
  port.rows.ediel_messages.push({ id: Z04, company_id: COMPANY, environment: 'production', direction: 'inbound', message_family: 'PRODAT', message_code: 'Z04',
    status: 'received', outbound_request_id: OUTBOUND, inbound_email_message_id: 'mail-z04', message_received_at: '2026-10-27T13:25:35+00:00',
    created_at: '2026-10-27T13:27:23.996927+00:00', ...patch })
}
/** The real mail intake of the negative APERAK (ACK-01 alarm and ACK columns), matched to our Z03's outbound request. */
async function intakeNegativeAperak(): Promise<string> {
  const result = await applyCanonicalInboundAckStatusUpdate({ companyId: COMPANY, environment: 'production', parsed: parseEdifactPayload(HEADER_REJECTION),
    outboundMatch: { status: 'matched', entityType: 'outbound_request', entityId: OUTBOUND, candidates: [{ source_type: 'supplier_switch_request', source_id: SWITCH, outbound_request_id: OUTBOUND }] } as never,
    meteringPointMatch: { status: 'unmatched', candidates: [] } as never, inboundEmailMessageId: 'mail-aperak' })
  expect(result.inboundEdielMessageId).toBeTruthy()
  return result.inboundEdielMessageId as string
}

type Log = string[]
/** The native Z04 owner reduced to its admission gate (normal_switch_scope_effect_v1). It takes a while, like the world's. */
async function nativeZ04(log: Log, applicable: boolean) {
  log.push('z04:start')
  await new Promise((resolve) => setTimeout(resolve, 15))
  const sw = switchRow(), z03 = z03Row()
  const admitted = applicable && WAITING_FOR_Z04.includes(String(sw.status)) && ['sent', 'acknowledged'].includes(String(z03.status))
  if (admitted) Object.assign(sw, { status: 'accepted', inbound_z04_message_id: Z04 })
  Object.assign(port.rows.ediel_messages.find((row) => row.id === Z04)!, { status: 'validated' })
  log.push(admitted ? 'z04:applied' : 'z04:held')
}
async function ackOwner(log: Log, ackId: string) {
  log.push('ack:start')
  const message = port.rows.ediel_messages.find((row) => row.id === ackId)! as unknown as EdielMessageRow
  const result = await processInboundAckMessage({ actorUserId: ACTOR, message: structuredClone(message) })
  log.push(`ack:done:${result.businessRejection ? 'rejection' : 'no-rejection'}`)
  return result
}
/** One inbound-engine run: the Ediel ids in the order the run lists them (newest first, as in the world). */
async function businessRun(ids: string[], z04Applicable = true) {
  const log: Log = []
  const results = await runInboundBusinessInArrivalLanes(ids, 4, async (id) => id === Z04 ? nativeZ04(log, z04Applicable) : ackOwner(log, id))
  const rejections = results.filter((result) => Boolean(result && (result as { businessRejection?: boolean }).businessRejection)).length
  return { log, rejections }
}

beforeEach(() => {
  port.seq = 0
  port.committed = new Set()
  port.rows = {
    supplier_switch_requests: [{ id: SWITCH, company_id: COMPANY, status: 'submitted', inbound_z04_message_id: null, external_reference: null }],
    outbound_requests: [{ id: OUTBOUND, company_id: COMPANY, source_type: 'supplier_switch_request', source_id: SWITCH, request_type: 'supplier_switch',
      message_family: 'PRODAT', message_code: 'Z03', status: 'syntax_accepted', sent_at: '2026-10-27T13:25:02Z', response_payload: {} }],
    ediel_messages: [{ id: Z03, company_id: COMPANY, environment: 'production', direction: 'outbound', message_family: 'PRODAT', message_code: 'Z03', status: 'sent',
      switch_request_id: SWITCH, outbound_request_id: OUTBOUND, grid_owner_data_request_id: null, raw_payload: "UNA:+.? '", created_at: '2026-10-27T13:24:42.382549+00:00' }],
    supplier_switch_events: [],
    outbound_dispatch_events: [],
  }
})

describe('I-B13 a Z04 the grid owner sent before a negative APERAK confirms the switch (P-11, GOR-02)', () => {
  it('intake: the negative APERAK does not mark the switch rejected while its earlier Z04 awaits the native owner', async () => {
    storeZ04()
    await intakeNegativeAperak()
    expect(switchRow().status).toBe('submitted')
  })

  it('the run applies the earlier Z04 before the APERAK, and the APERAK only leaves a warning that names the Z04', async () => {
    storeZ04()
    const ack = await intakeNegativeAperak()
    const { log, rejections } = await businessRun([ack, Z04])
    expect(log).toEqual(['z04:start', 'z04:applied', 'ack:start', 'ack:done:no-rejection'])
    expect(switchRow()).toMatchObject({ status: 'accepted', inbound_z04_message_id: Z04 })
    expect(switchEvents()).toEqual([expect.objectContaining({ eventStatus: 'warning', message: expect.stringContaining('Z04'),
      payload: expect.objectContaining({ inboundZ04MessageId: Z04, manualReviewRequired: true }) })])
    // GOR-04: a late negative after the Z04 is no rejection (no operator rejection case, no customer notice).
    expect(rejections).toBe(0)
  })

  it('an earlier Z04 that ends unavailable for its own reasons leaves the switch failed by the APERAK, followed up exactly once', async () => {
    storeZ04()
    const ack = await intakeNegativeAperak()
    const first = await businessRun([ack, Z04], false)
    expect(first.log).toEqual(['z04:start', 'z04:held', 'ack:start', 'ack:done:rejection'])
    expect(switchRow().status).toBe('failed')
    expect(String(switchRow().failure_reason)).toContain('ERC 40/102')
    expect(switchEvents().filter((event) => event.eventStatus === 'failed')).toHaveLength(1)
    // A later run (resume or replay of the committed receipt) adds no second rejection.
    const replay = await businessRun([ack])
    expect(first.rejections + replay.rejections).toBe(1)
    expect(switchEvents().filter((event) => event.eventStatus === 'failed')).toHaveLength(1)
  })
})

describe('I-B13 unchanged where the Z04 does not come first', () => {
  it('a Z04 received after the negative APERAK: the APERAK fails the switch as before, and the Z04 is held', async () => {
    const ack = await intakeNegativeAperak()
    expect(switchRow().status).toBe('rejected')
    storeZ04({ created_at: '2026-10-27T13:27:40.000000+00:00' })
    const { log, rejections } = await businessRun([Z04, ack])
    expect(log).toEqual(['ack:start', 'ack:done:rejection', 'z04:start', 'z04:held'])
    expect(switchRow()).toMatchObject({ status: 'failed', inbound_z04_message_id: null })
    expect(rejections).toBe(1)
  })

  it('a Z04 we rejected ourselves does not hold back the ACK-01 alarm', async () => {
    storeZ04({ status: 'failed' })
    await intakeNegativeAperak()
    expect(switchRow().status).toBe('rejected')
  })

  it('no cross-tenant match: another tenant\'s Z04 on an outbound request with the same id does not hold back the alarm', async () => {
    storeZ04({ company_id: OTHER_COMPANY })
    await intakeNegativeAperak()
    expect(switchRow().status).toBe('rejected')
  })
})

describe('I-B13 business-processing lanes of the inbound engine', () => {
  it('messages of one tenant\'s outbound request form one lane in arrival order; other messages and tenants are separate lanes', () => {
    const rows = [
      { id: 'aperak', company_id: COMPANY, outbound_request_id: OUTBOUND, created_at: '2026-10-27T13:27:24.583132+00:00' },
      { id: 'z04', company_id: COMPANY, outbound_request_id: OUTBOUND, created_at: '2026-10-27T13:27:23.996927+00:00' },
      { id: 'contrl', company_id: COMPANY, outbound_request_id: OUTBOUND, created_at: '2026-10-27T13:27:20.749569+00:00' },
      { id: 'other-tenant', company_id: OTHER_COMPANY, outbound_request_id: OUTBOUND, created_at: '2026-10-27T13:27:22.000000+00:00' },
      { id: 'unbound', company_id: COMPANY, outbound_request_id: null, created_at: '2026-10-27T13:27:21.000000+00:00' },
    ]
    expect(planInboundBusinessLanes(['aperak', 'z04', 'other-tenant', 'unbound', 'contrl', 'missing'], rows))
      .toEqual([['contrl', 'z04', 'aperak'], ['unbound'], ['other-tenant'], ['missing']])
  })

  it('lanes still run concurrently with each other', async () => {
    port.rows.ediel_messages = [
      { id: 'a1', company_id: COMPANY, outbound_request_id: 'request-a', created_at: '2026-10-27T13:00:00Z' },
      { id: 'b1', company_id: COMPANY, outbound_request_id: 'request-b', created_at: '2026-10-27T13:00:01Z' },
    ]
    const active: string[] = []
    let overlap = false
    await runInboundBusinessInArrivalLanes(['a1', 'b1'], 4, async (id) => {
      active.push(id); if (active.length > 1) overlap = true
      await new Promise((resolve) => setTimeout(resolve, 5))
      active.splice(active.indexOf(id), 1)
    })
    expect(overlap).toBe(true)
  })
})
