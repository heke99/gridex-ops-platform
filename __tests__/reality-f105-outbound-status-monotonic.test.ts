// reality-defects: F105 (scenario F run 26: a Z04-confirmed Z03 outbound request regressed to 'acknowledged' by a
// later CONTRL/APERAK processed by the canonical runtime)
// Rules exercised (specification only, not coverage tags): P-11 ("Sena kvittenser får inte backa ett giltigt
// affärstillstånd"), ACK-06 (update only the acknowledged parts), OPS-02 (watches act on the process decision).
//
// Unit proofs with an in-memory Supabase port. The real outbound status writer (lib/cis/db-outbound.ts), the real
// inbound ACK owner (processInboundAckMessage), the real canonical intake ACK writer and the real overdue watch run;
// only the transport, the SQL ACK receipt (exact receipt shape of gridex_apply_inbound_ack_source_v1) and the
// switch/event writers outside the outbound request are replaced. Synthetic data only.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const port = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  receipt: null as Row | null,
  source: null as Row | null,
  outcome: 'positive' as 'positive' | 'negative',
  seq: 0,
}))

vi.mock('@/lib/supabase/service', () => {
  type Filter = (row: Row) => boolean
  const from = (table: string) => {
    let op: 'select' | 'update' | 'insert' = 'select'
    let patch: Row | Row[] = {}
    let countHead = false
    let maximum = Number.POSITIVE_INFINITY
    const filters: Filter[] = []
    const run = () => {
      const rows = (port.rows[table] ??= [])
      if (op === 'insert') {
        const list = (Array.isArray(patch) ? patch : [patch]).map((value) => ({ id: `${table}-${++port.seq}`, created_at: new Date(Date.now() + port.seq).toISOString(), ...value }))
        rows.push(...list)
        return list
      }
      const hit = rows.filter((row) => filters.every((filter) => filter(row))).slice(0, maximum)
      if (op === 'update') hit.forEach((row) => Object.assign(row, structuredClone(patch)))
      return hit
    }
    const q: Row = {}
    Object.assign(q, {
      select: (_columns?: string, options?: { head?: boolean }) => { countHead = options?.head === true; return q },
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
      contains: (column: string, value: Row) => { filters.push((row) => Object.entries(value).every(([key, item]) => (row[column] as Row | undefined)?.[key] === item)); return q },
      order: () => q,
      limit: (value: number) => { maximum = value; return q },
      update: (value: Row) => { op = 'update'; patch = value; return q },
      insert: (value: Row | Row[]) => { op = 'insert'; patch = value; return q },
      maybeSingle: async () => ({ data: structuredClone(run()[0] ?? null), error: null }),
      single: async () => { const row = run()[0]; return row ? { data: structuredClone(row), error: null } : { data: null, error: { code: 'PGRST116', message: 'no row' } } },
      then: (ok: (value: unknown) => unknown, fail?: (error: unknown) => unknown) => {
        try {
          const rows = run()
          return Promise.resolve(countHead ? { data: null, count: rows.length, error: null } : { data: structuredClone(rows), error: null }).then(ok, fail)
        } catch (error) { return Promise.reject(error).then(ok, fail) }
      },
    })
    return q
  }
  return { supabaseService: {
    from,
    rpc: async (name: string) => {
      if (name === 'gridex_read_inbound_ack_source_v1') return { data: { version: 1, sourceMessage: port.source }, error: null }
      if (name === 'gridex_apply_inbound_ack_source_v1') return { data: port.receipt, error: null }
      throw Error(`unexpected rpc ${name}`)
    },
  } }
})
vi.mock('@/lib/ediel/ack/committedInboundAck', () => ({ readCommittedInboundAck: async () => null }))
vi.mock('@/lib/ediel/ack/sourceCorrelation', () => ({
  readInboundAckSourceCorrelation: () => ({ classification: { outcome: port.outcome }, lookupReferences: [] }),
  qualifyInboundAckSourceCandidates: ({ candidates }: { candidates: unknown[] }) => ({ status: 'unique', sourceMessage: candidates[0] }),
}))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: async () => ({}), linkEdielMessage: async () => ({}), updateEdielMessageStatus: async () => ({}) }))
vi.mock('@/lib/ediel/flows/shared', () => ({ ensureActorUserId: (value: string) => value, getGridOwnerDataRequestById: async () => null }))
vi.mock('@/lib/operations/db', () => ({
  updateSupplierSwitchRequestStatus: async (_client: unknown, input: Row) => input,
  createSupplierSwitchEvent: async (_client: unknown, input: Row) => input,
}))
vi.mock('@/lib/customer-cases/db', () => ({ syncCustomerCaseCancellationAck: async () => null }))
vi.mock('@/lib/ediel/actorTestingEngine', () => ({ syncActorTestingForMessage: async () => null }))
vi.mock('@/lib/inbound-mail/inboundTaskFactory', () => ({ createInboundMailTask: async () => 'task' }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: async () => undefined }))

import { processInboundAckMessage } from '@/lib/ediel/flows/inboundAckProcessing'
import { updateOutboundRequestStatus } from '@/lib/cis/db'
import { createInboundOverdueTasks } from '@/lib/inbound-mail/inboundOverdueMonitor'
import { applyCanonicalInboundAckStatusUpdate } from '@/lib/inbound-mail/canonicalInboundAckStatusUpdater'
import { parseEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'
import { resolveAutomaticOutboundStatus } from '@/lib/cis/outboundStatusLattice'
import type { EdielMessageRow } from '@/lib/ediel/types'

const COMPANY = '7b53f121-0000-4000-8000-000000000105'
const ACTOR = 'aaaaaaaa-0000-4000-8000-000000000105'
const OUTBOUND = '13eeb887-0000-4000-8000-000000000105'
const SWITCH = '7b34e761-0000-4000-8000-000000000105'
const SOURCE = '22222222-0000-4000-8000-000000000105'
const ACK = '33333333-0000-4000-8000-000000000105'
const Z04 = '55555555-0000-4000-8000-000000000105'
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()
const Z04_PAYLOAD = { inboundFamily: 'PRODAT', inboundCode: 'Z04', productionInboundDecision: { scenario: 'prodat_switch_confirmed' } }

/** The Z03 outbound request exactly as the mail intake leaves it when the grid owner's Z04 is received (F105). */
function confirmedByZ04Intake(acknowledgedAt = hoursAgo(25)): Row {
  return { id: OUTBOUND, company_id: COMPANY, customer_id: 'customer-1', site_id: null, metering_point_id: null, grid_owner_id: null,
    request_type: 'supplier_switch', source_type: 'supplier_switch_request', source_id: SWITCH, message_family: 'PRODAT', message_code: 'Z03',
    channel_type: 'ediel_partner', status: 'confirmed', external_reference: 'Z03A551E263B3BC4586A5012835FD64A056', attempts_count: 1,
    sent_at: hoursAgo(26), acknowledged_at: acknowledgedAt, failed_at: null, failure_reason: null, response_payload: Z04_PAYLOAD, updated_at: acknowledgedAt }
}
function sourceZ03(): Row {
  return { id: SOURCE, company_id: COMPANY, environment: 'production', direction: 'outbound', message_family: 'PRODAT', message_code: 'Z03',
    status: 'sent', switch_request_id: SWITCH, outbound_request_id: OUTBOUND, grid_owner_data_request_id: null, raw_payload: 'UNA:+.? \'' }
}
function lateAck(family: 'CONTRL' | 'APERAK'): EdielMessageRow {
  return { id: ACK, company_id: COMPANY, environment: 'production', direction: 'inbound', message_family: family, message_code: family,
    external_reference: null, raw_payload: 'UNA:+.? \'', parsed_payload: {}, validation_report: {} } as unknown as EdielMessageRow
}
/** gridex_apply_inbound_ack_source_v1's receipt for the last of CONTRL+APERAK on our Z03: final and accepted. */
const finalPositiveReceipt = () => ({ version: 1, sourceMessage: port.source, outcome: 'positive', scope: 'message', scopeOutcomes: [],
  finalAckReached: true, wholeSourceRejected: false, sourceAccepted: true, failureReason: null, idempotent: false })
const outbound = () => port.rows.outbound_requests.find((row) => row.id === OUTBOUND)!
const tasks = () => (port.rows.customer_operation_tasks ?? []).map((row) => `${row.task_type}:${row.title}`)

beforeEach(() => {
  port.seq = 0
  port.outcome = 'positive'
  port.source = sourceZ03()
  port.receipt = finalPositiveReceipt()
  port.rows = {
    outbound_requests: [confirmedByZ04Intake()],
    supplier_switch_requests: [{ id: SWITCH, company_id: COMPANY, status: 'completed', inbound_z04_message_id: Z04, external_reference: null }],
    outbound_dispatch_events: [],
    customer_operation_tasks: [],
  }
})

describe('F105 a technical ACK processed after the Z04 never moves the Z03 outbound request back', () => {
  it.each(['CONTRL', 'APERAK'] as const)('a late final %s keeps the Z04-confirmed request and records the ACK facts', async (family) => {
    const before = structuredClone(outbound())
    await processInboundAckMessage({ actorUserId: ACTOR, message: lateAck(family) })
    const after = outbound()
    expect(after.status).toBe('confirmed')
    // The J1-01 clock (acknowledged_at of the Z04 intake) and the Z03 reference are unchanged.
    expect(after.acknowledged_at).toBe(before.acknowledged_at)
    expect(after.external_reference).toBe(before.external_reference)
    // The technical ACK is recorded: its message id on the request and a dispatch event that says the status was kept.
    expect(after.response_payload).toMatchObject({ ...Z04_PAYLOAD, inboundAckMessageId: ACK, inboundAckFamily: family, acknowledgedVia: 'inbound_ediel_ack' })
    expect(port.rows.outbound_dispatch_events).toEqual([expect.objectContaining({ outbound_request_id: OUTBOUND, event_type: 'acknowledged', event_status: 'confirmed' })])
  })

  it('the 24 h Z04 watch raises no "Z04-svar saknas" for the request a late CONTRL reached after the Z04', async () => {
    Object.assign(outbound(), { acknowledged_at: new Date().toISOString() })
    await processInboundAckMessage({ actorUserId: ACTOR, message: lateAck('CONTRL') })
    // The watch runs the next day, past its 24 h deadline counted from the stored acknowledged_at.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 25 * 3_600_000)
      const result = await createInboundOverdueTasks({ companyId: COMPANY })
      expect(tasks()).toEqual([])
      expect(result.z04Overdue).toBe(0)
    } finally { vi.useRealTimers() }
    expect(outbound().status).toBe('confirmed')
  })

  it('J1-01 still sees a Z04-confirmed request whose Z04 the native owner held, also after a late CONTRL', async () => {
    port.rows.supplier_switch_requests[0] = { id: SWITCH, company_id: COMPANY, status: 'submitted', inbound_z04_message_id: null }
    await processInboundAckMessage({ actorUserId: ACTOR, message: lateAck('CONTRL') })
    await createInboundOverdueTasks({ companyId: COMPANY })
    expect(tasks()).toEqual(['ediel_z04_unconfirmed:Z04 mottagen men inte verkställd'])
    expect(outbound()).toMatchObject({ status: 'waiting_attention', failure_reason: 'Z04 mottagen men inte verkställd' })
    // A further late ACK does not clear the operator flag, and the 24 h watch adds no second, false alarm.
    await processInboundAckMessage({ actorUserId: ACTOR, message: lateAck('APERAK') })
    await createInboundOverdueTasks({ companyId: COMPANY })
    expect(outbound().status).toBe('waiting_attention')
    expect(tasks()).toEqual(['ediel_z04_unconfirmed:Z04 mottagen men inte verkställd'])
  })

  it('before any business response the final ACK still acknowledges the request (forward path unchanged)', async () => {
    Object.assign(outbound(), { status: 'sent', acknowledged_at: null, response_payload: {} })
    await processInboundAckMessage({ actorUserId: ACTOR, message: lateAck('APERAK') })
    expect(outbound()).toMatchObject({ status: 'acknowledged', acknowledged_at: expect.any(String) })
    expect(port.rows.outbound_dispatch_events).toEqual([expect.objectContaining({ event_type: 'acknowledged', event_status: 'acknowledged' })])
  })

  it('a late negative ACK after the Z04 is unchanged by this rule (P-11 incident handling stays with the switch owner)', async () => {
    port.outcome = 'negative'
    port.receipt = { ...finalPositiveReceipt(), outcome: 'negative', finalAckReached: false, wholeSourceRejected: true, sourceAccepted: false, failureReason: 'APERAK negativ' }
    await processInboundAckMessage({ actorUserId: ACTOR, message: lateAck('APERAK') })
    expect(outbound().status).toBe('failed')
  })
})

describe('F105 watch effect on the state run 26 left behind', () => {
  it('a Z03 request already regressed to acknowledged raises no "Z04-svar saknas" once its switch has the Z04 (completed switch 7b34e761)', async () => {
    Object.assign(outbound(), { status: 'acknowledged' })
    await createInboundOverdueTasks({ companyId: COMPANY })
    expect(tasks()).toEqual([])
    expect(outbound().status).toBe('acknowledged')
  })

  it('an acknowledged Z03 whose switch is still waiting for the Z04 is still reported after 24 h', async () => {
    Object.assign(outbound(), { status: 'acknowledged' })
    port.rows.supplier_switch_requests[0] = { id: SWITCH, company_id: COMPANY, status: 'submitted', inbound_z04_message_id: null }
    await createInboundOverdueTasks({ companyId: COMPANY })
    expect(tasks()).toEqual(['ediel_z04_overdue:Z04-svar saknas'])
    expect(outbound().status).toBe('waiting_attention')
  })

  it('the overdue flag never overwrites a status that changed after the watch read it', async () => {
    Object.assign(outbound(), { status: 'sent', acknowledged_at: null })
    const realInsert = port.rows.customer_operation_tasks
    // The Z04 is received between the watch's read and its flag write.
    port.rows.customer_operation_tasks = new Proxy(realInsert, { get(target, key, receiver) {
      if (key === 'push') return (...items: Row[]) => { Object.assign(outbound(), { status: 'confirmed', acknowledged_at: new Date().toISOString() }); return target.push(...items) }
      return Reflect.get(target, key, receiver)
    } })
    await createInboundOverdueTasks({ companyId: COMPANY })
    expect(outbound().status).toBe('confirmed')
  })
})

describe('F105 variants of the same regression', () => {
  it('a late ACK on a cancelled attempt (replaced switch attempt) keeps it cancelled', async () => {
    Object.assign(outbound(), { status: 'cancelled', acknowledged_at: null, response_payload: {} })
    await processInboundAckMessage({ actorUserId: ACTOR, message: lateAck('CONTRL') })
    expect(outbound()).toMatchObject({ status: 'cancelled', acknowledged_at: expect.any(String) })
  })

  it('a native business-response writer (UTILTS/Z02 sync) never turns business_response_received back into acknowledged', async () => {
    Object.assign(outbound(), { request_type: 'meter_values', message_family: 'UTILTS', message_code: 'E66', status: 'business_response_received' })
    const row = await updateOutboundRequestStatus({ actorUserId: ACTOR, outboundRequestId: OUTBOUND, status: 'acknowledged', responsePayload: { edielMessageId: 'e66' } })
    expect(row.status).toBe('business_response_received')
    expect(outbound()).toMatchObject({ status: 'business_response_received', response_payload: { edielMessageId: 'e66' } })
  })

  it('an explicit operator transition may still set any status', async () => {
    const row = await updateOutboundRequestStatus({ actorUserId: ACTOR, outboundRequestId: OUTBOUND, status: 'acknowledged', allowStatusRegression: true })
    expect(row.status).toBe('acknowledged')
  })

  it('a request failed by a negative ACK is not revived by a positive ACK processed later; a transport failure is', async () => {
    Object.assign(outbound(), { status: 'failed', response_payload: { inboundAckOutcome: 'negative' } })
    expect((await updateOutboundRequestStatus({ actorUserId: ACTOR, outboundRequestId: OUTBOUND, status: 'acknowledged' })).status).toBe('failed')
    Object.assign(outbound(), { status: 'failed', response_payload: { transport: 'smtp_timeout' } })
    expect((await updateOutboundRequestStatus({ actorUserId: ACTOR, outboundRequestId: OUTBOUND, status: 'acknowledged' })).status).toBe('acknowledged')
  })

  const unb = "UNA:+.? 'UNB+UNOC:3+7300000000002:14+7300000000001:14+261004:1200+A-1++23-DDQ-PRODAT'"
  const positiveContrl = () => parseEdifactPayload(unb + "UNH+1+CONTRL:2:2:UN:EDIEL2'UCI+ORIG-I+7300000000001:14+7300000000002:14+1'UNT+3+1'UNZ+1+A-1'")
  const intake = () => applyCanonicalInboundAckStatusUpdate({ companyId: COMPANY, environment: 'production', parsed: positiveContrl(),
    outboundMatch: { status: 'matched', entityType: 'outbound_request', entityId: OUTBOUND, candidates: [{ source_type: 'supplier_switch_request', source_id: SWITCH }] } as never,
    meteringPointMatch: { status: 'unmatched', candidates: [] } as never, inboundEmailMessageId: 'mail-1' })

  it.each(['application_rejected', 'syntax_rejected', 'completed', 'cancelled'])('intake: a positive CONTRL never replaces %s', async (status) => {
    Object.assign(outbound(), { status, failure_reason: status.endsWith('rejected') ? 'APERAK avvisade' : null })
    await intake()
    expect(outbound()).toMatchObject({ status, failure_reason: status.endsWith('rejected') ? 'APERAK avvisade' : null })
  })

  it.each(['application_accepted', 'acknowledged'])('intake: a positive CONTRL processed after the APERAK keeps %s', async (status) => {
    Object.assign(outbound(), { status })
    await intake()
    expect(outbound().status).toBe(status)
  })

  it('intake: a positive CONTRL on a sent request still records syntax acceptance', async () => {
    Object.assign(outbound(), { status: 'sent', acknowledged_at: null })
    await intake()
    expect(outbound()).toMatchObject({ status: 'syntax_accepted', acknowledged_at: expect.any(String) })
  })
})

describe('the shared monotonic rule', () => {
  it.each([
    ['confirmed', 'acknowledged', 'confirmed'], ['confirmed', 'sent', 'confirmed'], ['business_response_received', 'syntax_accepted', 'business_response_received'],
    ['completed', 'application_accepted', 'completed'], ['cancelled', 'acknowledged', 'cancelled'], ['application_rejected', 'syntax_accepted', 'application_rejected'],
    ['acknowledged', 'syntax_accepted', 'acknowledged'], ['application_accepted', 'syntax_accepted', 'application_accepted'],
    ['sent', 'acknowledged', 'acknowledged'], ['syntax_accepted', 'application_accepted', 'application_accepted'], ['prepared', 'sent', 'sent'],
    ['failed', 'queued', 'queued'], ['acknowledged', 'prepared', 'prepared'], ['confirmed', 'failed', 'failed'], ['acknowledged', 'confirmed', 'confirmed'],
    ['waiting_attention', 'acknowledged', 'acknowledged'],
  ])('%s + proposed %s → %s', (current, proposed, expected) => {
    expect(resolveAutomaticOutboundStatus({ status: current }, proposed).status).toBe(expected)
  })
  it('an attention flag raised after the acknowledgement is not cleared by a technical ACK', () => {
    expect(resolveAutomaticOutboundStatus({ status: 'waiting_attention', acknowledged_at: hoursAgo(1) }, 'acknowledged')).toEqual({ held: true, status: 'waiting_attention', reason: 'attention_after_acknowledgement' })
  })
})

// reality-defects: I-B9 (scenario I, batch 5d: the mail intake marked every negative ACK's switch 'rejected' before the
// canonical ACK owner ran, also a switch the Z04 had already confirmed (P-11), and the owner then skipped the GOR-04
// follow-up because the switch no longer looked like it was waiting).
describe('I-B9 a negative ACK never takes back a confirmed switch and is followed up once', () => {
  const unb9 = "UNA:+.? 'UNB+UNOC:3+7300000000002:14+7300000000001:14+261004:1200+A-1++23-DDQ-PRODAT'"
  const negativeContrl = () => parseEdifactPayload(unb9 + "UNH+1+CONTRL:2:2:UN:EDIEL2'UCI+ORIG-I+7300000000001:14+7300000000002:14+4'UNT+3+1'UNZ+1+A-1'")
  const negativeIntake = () => applyCanonicalInboundAckStatusUpdate({ companyId: COMPANY, environment: 'production', parsed: negativeContrl(),
    outboundMatch: { status: 'matched', entityType: 'outbound_request', entityId: OUTBOUND, candidates: [{ source_type: 'supplier_switch_request', source_id: SWITCH }] } as never,
    meteringPointMatch: { status: 'unmatched', candidates: [] } as never, inboundEmailMessageId: 'mail-1' })
  const switchRow = () => port.rows.supplier_switch_requests[0]
  const negativeReceipt = () => ({ ...finalPositiveReceipt(), outcome: 'negative', finalAckReached: false, wholeSourceRejected: true, sourceAccepted: false, failureReason: 'APERAK negativ' })

  it.each(['accepted', 'confirmed', 'active', 'completed'])('intake: a late negative ACK leaves a %s switch as it is (P-11)', async (status) => {
    Object.assign(switchRow(), { status })
    await negativeIntake()
    expect(switchRow().status).toBe(status)
  })

  it('intake: a negative ACK still marks a waiting switch rejected (ACK-01 alarm, unchanged)', async () => {
    Object.assign(switchRow(), { status: 'submitted', inbound_z04_message_id: null })
    await negativeIntake()
    expect(switchRow().status).toBe('rejected')
  })

  it('the canonical owner follows up a switch the intake marked rejected (GOR-04), exactly once', async () => {
    Object.assign(switchRow(), { status: 'rejected', inbound_z04_message_id: null })
    Object.assign(outbound(), { status: 'sent', acknowledged_at: null, response_payload: {} })
    port.outcome = 'negative'; port.receipt = negativeReceipt()
    expect(await processInboundAckMessage({ actorUserId: ACTOR, message: lateAck('APERAK') })).toMatchObject({ businessRejection: true })
    Object.assign(switchRow(), { status: 'failed' })
    expect(await processInboundAckMessage({ actorUserId: ACTOR, message: lateAck('APERAK') })).toMatchObject({ businessRejection: false })
  })
})
