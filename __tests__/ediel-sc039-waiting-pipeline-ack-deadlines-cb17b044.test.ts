// Component evidence for the internal-wait deadline clause only; no whole-card tag.
// Constructed Z04C premise, real pipeline/matcher/timer/canonical requirements.
// Strict finite SDK storage and event ports below are models, not SQL/RLS,
// admission, physical ACK delivery, provider, concurrency or native evidence.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeEdielProcessingPipeline } from '@/lib/ediel/orchestrator/edielProcessingPipeline'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { guideOrderedFixtureRaw } from './helpers/prodatGuideOrderedFixture'
import { characteristic, line, qty, type Parts } from './fixtures/prodat-register'

type Row = Record<string, unknown>
type TimerRow = Row & {
  ediel_message_id: string
  timer_type: string
  status: string
}
const io = vi.hoisted(() => ({
  timers: new Map<string, TimerRow>(), runs: new Map<string, Row>(), traces: [] as Row[],
  reads: [] as { table: string; timers: TimerRow[] }[],
  order: [] as string[], events: [] as Row[],
  from: vi.fn(), event: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from } }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: io.event }))

const company = '00000000-0000-4000-8000-000000000002'
const actor = '00000000-0000-4000-8000-000000000003'
const received = '2026-10-01T12:00:00Z'
const created = '2026-10-01T12:02:00Z'
const key = (row: TimerRow) => `${row.ediel_message_id}:${row.timer_type}`
const storedTimers = () => structuredClone([...io.timers.values()])

function constructedMessage(extra: Partial<EdielMessageRow> = {}): EdielMessageRow {
  const point = '735123456789012344'
  const body: Parts[] = [
    ['NAD', 'FR', ['54321', '160', 'SVK']], ['NAD', 'DO', ['12345', '160', 'SVK']],
    line('1', point, undefined, '9'), ['DTM', ['92', '202610150000', '203']],
    ['DTM', ['354', '15', '806']], qty('1000'),
    ...characteristic('Z13', 'Z24'), ...characteristic('Z04', 'Z04'),
    ...characteristic('Z07', 'Z12'), ...characteristic('Z12', 'D', 3),
    ...characteristic('Z15', 'Z31'), ...characteristic('Z14', 'L639Q', 3),
    ...characteristic('Z02', '1', 3), ...characteristic('Z05', '6', 3),
    ...characteristic('Z16', '101', 3),
    ['RFF', ['MG', 'SYNTHETIC-METER']], ['RFF', ['Z05', 'TES']], ['RFF', ['LI', 'WAIT-CANCEL']],
    ['NAD', 'UD', ['199001011234', 'SE2', '260'], '', 'Synthetic Customer', 'Street', 'City', '', '12345', 'SE'],
    ['NAD', 'IT', [point, '', '9'], '', '', 'Street', 'City', '', '12345', 'SE'],
    ['NAD', 'Z02', ['99876', '160', 'SVK']],
  ]
  const raw = guideOrderedFixtureRaw(body, 'Z04').replace('+S+R+', '+54321:14+12345:14+')
  return {
    id: '00000000-0000-4000-8000-000000000001', company_id: company,
    direction: 'inbound', message_standard: 'edifact', message_family: 'PRODAT', message_code: 'Z04',
    message_version: 'E2SE6A', process_type: null, environment: 'test', test_flag: 1, status: 'validated',
    transport_type: 'manual_upload', mailbox: null, mailbox_message_id: null,
    sender_ediel_id: '54321', sender_name: null, sender_sub_address: null,
    receiver_ediel_id: '12345', receiver_name: null, receiver_sub_address: null,
    sender_email: null, receiver_email: null, subject: null, file_name: null, mime_type: null,
    interchange_reference: null, external_reference: null, correlation_reference: 'WAIT-CANCEL',
    transaction_reference: null, application_reference: '23-DDQ-PRODAT', original_message_id: null,
    original_transaction_id: null, original_message_code: null, related_message_id: null,
    communication_route_id: null, outbound_request_id: null, switch_request_id: null,
    grid_owner_data_request_id: null, partner_export_id: null, customer_id: null,
    site_id: null, metering_point_id: null, grid_owner_id: null,
    raw_payload: raw, parsed_payload: {}, validation_report: {},
    requires_contrl: true, requires_aperak: true, contrl_status: 'pending', aperak_status: 'pending',
    utilts_err_status: null, ack_outcome: null, syntax_check_status: 'valid', functional_check_status: 'valid',
    failure_reason: null, message_created_at: null, message_received_at: received, message_sent_at: null,
    parsed_at: null, validated_at: null, acknowledged_at: null, failed_at: null, ack_due_at: null,
    created_at: created, updated_at: created, created_by: actor, updated_by: actor, ...extra,
  }
}

// Only these lookup surfaces exist for the constructed unresolved correlation.
// Every table is explicitly empty. Unexpected tables/methods/filters fail closed.
const lookupTables = new Set(['metering_points', 'supplier_switch_requests',
  'grid_owner_information_requests', 'customer_info_requests'])
function installPorts() {
  io.from.mockImplementation((table: string) => {
    if (table === 'ediel_sla_timers') return {
      upsert: async (rows: TimerRow[], options: { onConflict: string; ignoreDuplicates?: boolean }) => {
        if (options.onConflict !== 'ediel_message_id,timer_type') throw Error('unexpected conflict key')
        for (const row of rows) {
          const existing = io.timers.get(key(row))
          if (!existing || !options.ignoreDuplicates) io.timers.set(key(row), structuredClone(row))
        }
        io.order.push('timers_persisted')
        return { error: null }
      },
    }
    if (table === 'ediel_processing_runs') return {
      insert: (row: Row) => ({ select: (columns: string) => {
        if (columns !== 'id') throw Error('unexpected run projection')
        return { single: async () => {
          const id = `run-${io.runs.size + 1}`
          io.runs.set(id, structuredClone(row)); io.order.push('run_started')
          return { data: { id }, error: null }
        } }
      } }),
      update: (patch: Row) => ({ eq: async (column: string, id: string) => {
        const row = io.runs.get(id)
        if (column !== 'id' || !row) throw Error('unexpected run update')
        io.runs.set(id, { ...row, ...structuredClone(patch) })
        io.order.push(`run_${String(patch.status)}`)
        return { error: null }
      } }),
    }
    if (table === 'ediel_decision_traces') return { insert: async (row: Row) => {
      io.traces.push(structuredClone(row)); io.order.push('trace_persisted')
      return { error: null }
    } }
    if (!lookupTables.has(table)) throw Error(`unexpected SDK table: ${table}`)
    const filters = new Map<string, unknown>()
    let projection: string | null = null
    let limit: number | null = null
    let disjunction: string | null = null
    const query = {
      select: (columns: string) => { projection = columns; return query },
      eq: (column: string, value: unknown) => {
        if (column !== 'company_id' && !(table === 'grid_owner_information_requests' && column === 'request_type')) {
          throw Error(`unexpected lookup filter: ${table}.${column}`)
        }
        filters.set(column, value); return query
      },
      limit: (value: number) => { limit = value; return query },
      or: (value: string) => { disjunction = value; return query },
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => {
        if (!projection || filters.get('company_id') !== company || limit !== (table === 'metering_points' || table === 'supplier_switch_requests' ? 20 : 50)
          || (table === 'grid_owner_information_requests' ? filters.get('request_type') !== 'facility_lookup' : !disjunction)) {
          throw Error(`unexpected lookup shape: ${table}`)
        }
        io.reads.push({ table, timers: storedTimers() }); io.order.push(`lookup:${table}`)
        return resolve({ data: [], error: null })
      },
    }
    return query
  })
  io.event.mockImplementation(async (event: Row) => {
    if (!['manual_note', 'validated'].includes(String(event.eventType))
      || !['info', 'warning'].includes(String(event.eventStatus))
      || ![actor, 'replay-actor'].includes(String(event.actorUserId))
      || typeof event.edielMessageId !== 'string') throw Error('unexpected event port operation')
    io.events.push(structuredClone(event)); io.order.push(`event:${String(event.eventType)}`)
  })
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:03:00Z'))
  vi.clearAllMocks(); io.timers.clear(); io.runs.clear(); io.traces = []
  io.reads = []; io.order = []; io.events = []; installPorts()
})
afterEach(() => { vi.useRealTimers() })

const analyze = (message: EdielMessageRow) => analyzeEdielProcessingPipeline({ actorUserId: actor, message })
function assertWaiting(result: Awaited<ReturnType<typeof analyze>>) {
  expect(result.businessMatch).toMatchObject({ confidence: 'low', candidates: [], processId: null })
  expect(result.manualReviewReason).toBe('business_match_low_confidence')
  expect(result.canAutoSendBusinessAck).toBe(false)
  expect([...io.runs.values()].at(-1)).toMatchObject({ status: 'manual_review' })
}
function assertDeadlineRows(rows: TimerRow[], message: EdielMessageRow, anchor: string, certainty: 'observed' | 'uncertain') {
  expect(rows.map(row => row.timer_type)).toEqual(['contrl_due', 'aperak_due'])
  for (const row of rows) expect(row).toMatchObject({
    company_id: company, ediel_message_id: message.id, status: 'open',
    due_at: certainty === 'observed' ? '2026-10-01T12:30:00.000Z' : '2026-10-01T12:32:00.000Z',
    warning_at: certainty === 'observed' ? '2026-10-01T12:20:00.000Z' : '2026-10-01T12:22:00.000Z',
    critical_at: certainty === 'observed' ? '2026-10-01T12:25:00.000Z' : '2026-10-01T12:27:00.000Z',
    payload: { receivedAt: anchor, anchorKind: certainty === 'observed' ? 'local_ingress_at' : 'local_record_created_at', anchorCertainty: certainty },
  })
}

describe('unresolved Z04C pipeline preserves modeled ACK deadlines during internal waiting', () => {
  it('persists receipt-anchored ACK rows before real unresolved business lookup and manual review', async () => {
    const message = constructedMessage(), original = structuredClone(message)
    expect(validateEdifactSyntax(message)).toMatchObject({ ok: true, grammarQualification: 'qualified' })
    const result = await analyze(message)
    expect(result.canonical).toMatchObject({ family: 'PRODAT', messageCode: 'Z04', subtype: 'Z24' })
    expect(result.decision?.applicationErrors).toEqual([])
    assertWaiting(result)
    assertDeadlineRows(storedTimers(), message, received, 'observed')
    expect(new Set(io.reads.map(read => read.table))).toEqual(lookupTables)
    for (const read of io.reads) assertDeadlineRows(read.timers, message, received, 'observed')
    expect(io.order.indexOf('timers_persisted')).toBeLessThan(io.order.findIndex(item => item.startsWith('lookup:')))
    expect(io.order.indexOf('timers_persisted')).toBeLessThan(io.order.indexOf('run_manual_review'))
    expect(io.traces).toHaveLength(1)
    expect(io.traces[0]).toMatchObject({ source_message_id: message.id, can_auto_send: false })
    expect(io.events.at(-1)).toMatchObject({ eventType: 'validated', eventStatus: 'warning' })
    expect(message).toEqual(original)
  })

  it('retains original stored deadlines when the same waiting message replays at a later clock', async () => {
    const message = constructedMessage()
    assertWaiting(await analyze(message))
    const first = storedTimers()
    assertDeadlineRows(first, message, received, 'observed')
    vi.setSystemTime(new Date('2026-10-02T18:00:00Z'))
    assertWaiting(await analyzeEdielProcessingPipeline({ actorUserId: 'replay-actor', message }))
    expect(storedTimers()).toEqual(first)
    expect(io.runs.size).toBe(2)
  })

  it('does not reopen or overwrite completed and expired stored rows on replay', async () => {
    const message = constructedMessage()
    await analyze(message)
    for (const row of io.timers.values()) {
      row.status = row.timer_type === 'contrl_due' ? 'completed' : 'expired'
      row.completed_at = row.status === 'completed' ? '2026-10-01T12:10:00Z' : null
      row.payload = { retained: 'preexisting modeled terminal evidence' }
    }
    const terminal = storedTimers()
    vi.setSystemTime(new Date('2026-10-03T18:00:00Z'))
    assertWaiting(await analyze(message))
    expect(storedTimers()).toEqual(terminal)
  })

  it('labels created-at fallback uncertain while retaining waiting deadlines across replay', async () => {
    const message = constructedMessage({ message_received_at: null })
    assertWaiting(await analyze(message))
    assertDeadlineRows(storedTimers(), message, created, 'uncertain')
    const first = storedTimers()
    vi.setSystemTime(new Date('2026-10-04T18:00:00Z'))
    assertWaiting(await analyze(message))
    expect(storedTimers()).toEqual(first)
  })

  it('creates no ACK-of-CONTRL rows despite stale requirement flags', async () => {
    const result = await analyze(constructedMessage({ message_family: 'CONTRL', message_code: 'CONTRL', raw_payload: null }))
    expect(result.sla).not.toBeNull()
    expect(storedTimers()).toEqual([])
    expect(io.order).not.toContain('timers_persisted')
  })

  it('keeps required technical CONTRL for APERAK but creates no application ACK timer', async () => {
    await analyze(constructedMessage({ message_family: 'APERAK', message_code: 'APERAK', raw_payload: null }))
    expect(storedTimers().map(row => row.timer_type)).toEqual(['contrl_due'])
  })

  it('creates no timers for an outbound message even with no usable receipt anchor', async () => {
    const result = await analyze(constructedMessage({ direction: 'outbound', message_received_at: null, created_at: '' }))
    expect(result.sla).toBeNull()
    expect(storedTimers()).toEqual([])
    expect(io.order).not.toContain('timers_persisted')
  })
})
