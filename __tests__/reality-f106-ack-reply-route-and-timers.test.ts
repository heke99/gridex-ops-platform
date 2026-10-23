// reality-defects: F106 (scenario F run 26, tenant 7b53f121: the grid owner's 4 APERAK got no CONTRL
// ("ediel_technical_ack_route_unavailable"), the 3 Z04 got no APERAK ("Ingen aktiv communication_route
// hittades för ediel_ack"), and the SLA timers looked unresolved / regressing)
// Rules exercised (specification only, not coverage tags): ACK-01 (CONTRL on every received EDIFACT except
// CONTRL), ACK-02 (APERAK on PRODAT), ACK-05 (never APERAK on APERAK), TM-ACK (30-minute reply watch).
//
// Unit proofs with an in-memory Supabase port. The real inbound ACK intake writer, the real canonical route
// registry (with the real generic route lookup and ACK profile selection), the real timer planner and the
// real deadline sweep run; only the transport and the reception RPC answer are replaced. Synthetic data only.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const port = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  rpcs: [] as Array<{ name: string; args: Row }>,
  receptionError: null as Error | null,
  events: [] as Row[],
  seq: 0,
}))

vi.mock('@/lib/supabase/service', () => {
  type Filter = (row: Row) => boolean
  const literal = (value: string): unknown => value === 'true' ? true : value === 'false' ? false : value === 'null' ? null : value
  const from = (table: string) => {
    let op: 'select' | 'update' | 'insert' | 'upsert' = 'select'
    let patch: Row | Row[] = {}
    let maximum = Number.POSITIVE_INFINITY
    const filters: Filter[] = []
    const run = () => {
      const rows = (port.rows[table] ??= [])
      if (op === 'insert' || op === 'upsert') {
        const list = (Array.isArray(patch) ? patch : [patch]).map((value) => ({ id: `${table}-${++port.seq}`, ...structuredClone(value) }))
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
      is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return q },
      not: (column: string, operator: string, value: unknown) => {
        if (operator !== 'in') throw Error(`unexpected not ${operator}`)
        const list = String(value).replace(/[()"]/g, '').split(',')
        filters.push((row) => !list.includes(String(row[column])))
        return q
      },
      or: (expression: string) => {
        const alternatives = expression.split(',').map((part) => {
          const [column, operator, ...rest] = part.split('.')
          const value = literal(rest.join('.'))
          if (operator === 'is') return (row: Row) => (row[column] ?? null) === value
          if (operator === 'eq') return (row: Row) => row[column] === value
          throw Error(`unexpected or ${part}`)
        })
        filters.push((row) => alternatives.some((alternative) => alternative(row)))
        return q
      },
      order: () => q,
      limit: (value: number) => { maximum = value; return q },
      update: (value: Row) => { op = 'update'; patch = value; return q },
      insert: (value: Row | Row[]) => { op = 'insert'; patch = value; return q },
      upsert: (value: Row | Row[]) => { op = 'upsert'; patch = value; return q },
      maybeSingle: async () => {
        const rows = run()
        if (rows.length > 1 && op === 'select') return { data: null, error: { code: 'PGRST116', message: 'Multiple rows' } }
        return { data: structuredClone(rows[0] ?? null), error: null }
      },
      single: async () => { const row = run()[0]; return row ? { data: structuredClone(row), error: null } : { data: null, error: { code: 'PGRST116', message: 'no row' } } },
      then: (ok: (value: unknown) => unknown, fail?: (error: unknown) => unknown) => {
        try { return Promise.resolve({ data: structuredClone(run()), error: null }).then(ok, fail) } catch (error) { return Promise.reject(error).then(ok, fail) }
      },
    })
    return q
  }
  return { supabaseService: {
    from,
    rpc: async (name: string, args: Row) => {
      port.rpcs.push({ name, args })
      if (name !== 'ediel_record_inbound_reception_v1') throw Error(`unexpected rpc ${name}`)
      if (port.receptionError) return { data: null, error: port.receptionError }
      const hash = 'a'.repeat(64)
      return { data: { companyId: args.p_company_id, sourceMessageId: args.p_message_id, inboundEmailMessageId: args.p_inbound_email_message_id,
        parseResultId: args.p_parse_result_id, receptionId: 'reception-1', classification: 'first_reception', isReplay: false,
        receivedAt: '2026-10-23T10:03:16.000Z', canonicalPayloadHash: hash, receivedPayloadHash: hash, responseRequestId: null,
        status: 'observed', reason: null, businessEffectAuthorized: false }, error: null }
    },
  } }
})
vi.mock('@/lib/inbound-mail/inboundTaskFactory', () => ({ createInboundMailTask: async () => 'task' }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: async (event: Row) => { port.events.push(event); return {} } }))
vi.mock('@/lib/ediel/core/actorRegistry', () => ({ resolveCanonicalActorContext: async () => ({ senderEdielId: '70307', senderName: 'Synthetic Supplier',
  senderSubAddress: null, mailbox: 'gridex-ediel@example.invalid', defaultApplicationReference: null }) }))
vi.mock('@/lib/grid-owners/platformGridOwnerResolver', () => ({
  selectTenantUsableGridOwners: async ({ match }: { match: Row }) => match.ediel_id === '16700' ? [{ id: GRID_OWNER }] : [],
}))

import { applyCanonicalInboundAckStatusUpdate } from '@/lib/inbound-mail/canonicalInboundAckStatusUpdater'
import { parseEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'
import { resolveCanonicalRouteContext } from '@/lib/ediel/core/routeRegistry'
import { checkAckDeadlines } from '@/lib/ediel/sla/checkAckDeadlines'
import { createAckTimersForMessage } from '@/lib/ediel/sla/createAckTimers'
import type { EdielMessageRow } from '@/lib/ediel/types'

const COMPANY = '7b53f121-0000-4000-8000-000000000106'
const ACTOR = 'f5d5f656-0000-4000-8000-000000000106'
const MAIL = 'f1569fdf-0000-4000-8000-000000000106'
const PARSE = '2e40f7a4-0000-4000-8000-000000000106'
const OUTBOUND = '26307228-0000-4000-8000-000000000106'
const GRID_OWNER = 'd0015158-0000-4000-8000-000000000106'

// The physical APERAK of run 26 (UNB 0031 = 1: acknowledgement requested) and a grid-owner CONTRL (no 0031).
const APERAK = "UNA:+.? 'UNB+UNOC:3+16700:ZZ+70307:ZZ+261023:1203+CD8794F4D37E40++23-DDQ-PRODAT++1'UNH+1+APERAK:D:96A:UN:E2SE6A'BGM+++34'DTM+137:202610231203:203'RFF+ACW:Z03A1AC925D4EBD414FA79CA78714DCA1F3'NAD+FR+16700:160:SVK+++++++SE'NAD+DO+70307:160:SVK+++++++SE'ERC+100::260'FTX+AAO++100::260+OK'UNT+9+1'UNZ+1+CD8794F4D37E40'"
const CONTRL = "UNA:+.? 'UNB+UNOC:3+16700:ZZ+70307:ZZ+261023:1154+49D9B08D8B4433++23-DDQ-PRODAT'UNH+1+CONTRL:2:2:UN:EDIEL2'UCI+465F842F46204E+70307:ZZ+16700:ZZ+1'UNT+3+1'UNZ+1+49D9B08D8B4433'"

const matched = { status: 'matched', entityType: 'outbound_request', entityId: OUTBOUND, candidates: [{ outbound_request_id: OUTBOUND }], reasons: [] } as never
const unmatchedPoint = { status: 'unmatched', candidates: [], reasons: [] } as never
const intake = (raw: string, extra: Row = {}) => applyCanonicalInboundAckStatusUpdate({ companyId: COMPANY, environment: 'production',
  parsed: parseEdifactPayload(raw), outboundMatch: matched, meteringPointMatch: unmatchedPoint, inboundEmailMessageId: MAIL, ...extra })
const inboundRows = () => (port.rows.ediel_messages ?? []).filter((row) => row.direction === 'inbound')

beforeEach(() => {
  port.seq = 0
  port.rpcs = []
  port.events = []
  port.receptionError = null
  port.rows = { outbound_requests: [{ id: OUTBOUND, company_id: COMPANY, status: 'sent' }] }
})

describe('F106 cause 1: a received APERAK is born with the mailbox reception the CONTRL route selector requires', () => {
  it('binds the APERAK to its own retained mail (mailbox_message_id) and records its first reception', async () => {
    const result = await intake(APERAK, { actorUserId: ACTOR, parseResultId: PARSE })
    expect(result).toMatchObject({ status: 'processed', matchStatus: 'matched' })
    const [aperak] = inboundRows()
    // select_configured_reply_route_v2 refuses an original without these (ediel_original_mailbox_source_required).
    expect(aperak).toMatchObject({ message_family: 'APERAK', inbound_email_message_id: MAIL, mailbox_message_id: MAIL,
      requires_contrl: true, requires_aperak: false })
    expect(port.rpcs).toEqual([{ name: 'ediel_record_inbound_reception_v1', args: { p_company_id: COMPANY, p_message_id: aperak.id,
      p_actor_user_id: ACTOR, p_inbound_email_message_id: MAIL, p_parse_result_id: PARSE } }])
  })

  it('a received CONTRL is never marked as requiring a CONTRL or an APERAK (ACK-01, ACK-05)', async () => {
    await intake(CONTRL, { actorUserId: ACTOR, parseResultId: PARSE })
    expect(inboundRows()[0]).toMatchObject({ message_family: 'CONTRL', requires_contrl: false, requires_aperak: false, mailbox_message_id: MAIL })
  })

  it('an unrecorded reception is visible and leaves the ACK business effect in place', async () => {
    port.receptionError = Object.assign(new Error('ediel_real_reception_source_scope_required'), { code: 'P0001' })
    await expect(intake(APERAK, { actorUserId: ACTOR, parseResultId: PARSE })).resolves.toMatchObject({ status: 'processed' })
    const warning = (port.rows.ediel_message_events ?? []).find((row) => row.event_status === 'warning')
    expect(warning).toMatchObject({ company_id: COMPANY, ediel_message_id: inboundRows()[0].id,
      payload: { receptionCustody: 'unrecorded', reason: 'ediel_real_reception_source_scope_required' } })
    expect(port.rows.outbound_requests[0].status).toBe('application_accepted')
  })

  it('never moves an existing original to another mail copy of the same interchange', async () => {
    port.rows.ediel_messages = [{ id: 'original', company_id: COMPANY, direction: 'inbound', sender_ediel_id: '16700', receiver_ediel_id: '70307',
      interchange_reference: 'CD8794F4D37E40', inbound_email_message_id: 'first-mail', mailbox_message_id: 'first-mail' }]
    await intake(APERAK, { actorUserId: ACTOR, parseResultId: PARSE })
    expect(port.rows.ediel_messages.find((row) => row.id === 'original')).toMatchObject({ mailbox_message_id: 'first-mail' })
    expect(port.rpcs).toEqual([])
  })

  it('without an execution actor or parse the source stays fail-closed (no reception is invented)', async () => {
    await intake(APERAK)
    expect(port.rpcs).toEqual([])
  })
})

// The grid owner's reply routes as F92/F98 materialize them: one ediel_ack pair per application reference.
const REFERENCES = ['23-DDQ-PRODAT', '23-DDQ-E31-S', '23-DDQ-E31-T', '23-DDQ-E66-S', '23-DDQ-E66-T', '23-DDQ-S02-S', '23-DDQ-S03-S']
const routeId = (reference: string, n = 0) => `route-${reference}-${n}`
function ackPair(reference: string, n = 0): { route: Row; profile: Row; view: Row } {
  const route = { id: routeId(reference, n), company_id: COMPANY, route_scope: 'ediel_ack', is_active: true, environment_type: 'production',
    grid_owner_id: GRID_OWNER, route_name: `Synthetic grid owner teknisk kvittens ${reference}`, target_system: 'counterparty',
    target_email: 'ediel-16700@example.invalid', updated_at: '2026-10-23T09:50:00Z' }
  const profile = { id: `profile-${reference}-${n}`, company_id: COMPANY, communication_route_id: route.id, environment: 'production',
    application_reference: reference, message_family: null, business_code: null, receiver_ediel_id: '16700', sender_ediel_id: '70307',
    is_enabled: true, is_active: true }
  const view = { ...profile, route_profile_id: profile.id, communication_route_active: true, route_name: route.route_name, route_scope: 'ediel_ack',
    target_email: route.target_email, mailbox: 'gridex-ediel@example.invalid', message_standard: 'edifact', payload_format: 'edifact',
    receiver_subaddress: null, sender_subaddress: null, ack_mode: 'default', default_message_version: null }
  return { route, profile, view }
}
function configureAckRoutes(pairs: Array<{ route: Row; profile: Row; view: Row }>) {
  port.rows.communication_routes = pairs.map((pair) => pair.route)
  port.rows.ediel_route_profiles = pairs.map((pair) => pair.profile)
  port.rows.ediel_route_runtime_v = pairs.map((pair) => pair.view)
}
const aperakForZ04 = (applicationReference = '23-DDQ-PRODAT') => resolveCanonicalRouteContext({ requestType: 'ediel_ack', companyId: COMPANY,
  environment: 'production', receiverEdielId: '16700', applicationReference, ackProfile: { family: 'APERAK', code: 'APERAK' } })

describe('F106 cause 2: the APERAK to the grid owner\'s Z04 is routed by its application reference', () => {
  it('selects the one pair carrying the Z04\'s application reference among the grid owner\'s seven reply routes', async () => {
    configureAckRoutes(REFERENCES.map((reference) => ackPair(reference)))
    const context = await aperakForZ04()
    expect(context.route.id).toBe(routeId('23-DDQ-PRODAT'))
    expect(context.routeRuntime).toMatchObject({ route_profile_id: 'profile-23-DDQ-PRODAT-0', application_reference: '23-DDQ-PRODAT' })
    expect(context).toMatchObject({ receiverEdielId: '16700', applicationReference: '23-DDQ-PRODAT', receiverEmail: 'ediel-16700@example.invalid' })
  })

  it('still refuses (never guesses) when two routes answer the same reference', async () => {
    configureAckRoutes([...REFERENCES.map((reference) => ackPair(reference)), ackPair('23-DDQ-PRODAT', 1)])
    await expect(aperakForZ04()).rejects.toThrow(/^communication_route_ambiguous:production:grid_owner:/)
  })

  it('still refuses a reference no reply route carries', async () => {
    configureAckRoutes(REFERENCES.filter((reference) => reference !== '23-DDQ-PRODAT').map((reference) => ackPair(reference)))
    await expect(aperakForZ04()).rejects.toThrow(/^communication_route_ambiguous:/)
  })

  it('a reply profile for another counterparty or a business-only family does not answer', async () => {
    const foreign = ackPair('23-DDQ-PRODAT'); foreign.profile.receiver_ediel_id = '99999'
    const contrlOnly = ackPair('23-DDQ-PRODAT', 1); contrlOnly.profile.message_family = 'CONTRL'
    configureAckRoutes([foreign, contrlOnly, ackPair('23-DDQ-E66-T')])
    await expect(aperakForZ04()).rejects.toThrow(/^communication_route_ambiguous:/)
  })
})

describe('F106 timers: what is due, and a resolved timer never regresses', () => {
  const inbound = (family: string, code: string): EdielMessageRow => ({ id: `source-${family}`, company_id: COMPANY, environment: 'production',
    direction: 'inbound', message_standard: 'edifact', message_family: family, message_code: code, requires_aperak: false,
    message_received_at: '2026-10-23T10:04:06.000Z', created_at: '2026-10-23T10:05:00.000Z' } as unknown as EdielMessageRow)
  const timerTypes = () => (port.rows.ediel_sla_timers ?? []).map((row) => `${row.ediel_message_id}:${row.timer_type}`).sort()

  it('plans our CONTRL for an APERAK, CONTRL+APERAK for a Z04 and nothing for a received CONTRL', async () => {
    for (const [family, code] of [['APERAK', 'APERAK'], ['PRODAT', 'Z04'], ['CONTRL', 'CONTRL']]) {
      await createAckTimersForMessage({ actorUserId: ACTOR, message: inbound(family, code) })
    }
    expect(timerTypes()).toEqual(['source-APERAK:contrl_due', 'source-PRODAT:aperak_due', 'source-PRODAT:contrl_due'])
  })

  it('resolves contrl_due by the sent CONTRL while the separate aperak_due timer escalates (run 26, Z04 0d5fbeb5)', async () => {
    const z04 = { id: 'z04', company_id: COMPANY, environment: 'production', direction: 'inbound', message_family: 'PRODAT', message_code: 'Z04', raw_payload: "UNA:+.? '" }
    const timer = (id: string, type: string) => ({ id, company_id: COMPANY, ediel_message_id: 'z04', timer_type: type, status: 'open',
      due_at: '2026-10-23T10:34:06Z', warning_at: '2026-10-23T10:24:06Z', critical_at: '2026-10-23T10:29:06Z' })
    port.rows = {
      ediel_messages: [z04, { id: 'contrl', company_id: COMPANY, environment: 'production', related_message_id: 'z04', direction: 'outbound',
        message_family: 'CONTRL', status: 'sent', message_sent_at: '2026-10-23T10:06:08Z', ack_outcome: 'positive' }],
      ediel_sla_timers: [timer('contrl-timer', 'contrl_due'), timer('aperak-timer', 'aperak_due')],
    }
    await checkAckDeadlines({ actorUserId: ACTOR, now: '2026-10-23T10:28:49Z' })
    await checkAckDeadlines({ actorUserId: ACTOR, now: '2026-10-23T10:29:53Z' })
    await checkAckDeadlines({ actorUserId: ACTOR, now: '2026-10-23T10:35:00Z' })
    const status = (id: string) => port.rows.ediel_sla_timers.find((row) => row.id === id)?.status
    expect([status('contrl-timer'), status('aperak-timer')]).toEqual(['resolved', 'expired'])
    // resolved → warning → critical were two different timers, not one timer regressing.
    expect(port.events.map((event) => `${(event.payload as Row).timerId}:${(event.payload as Row).status}`))
      .toEqual(['contrl-timer:resolved', 'aperak-timer:warning', 'aperak-timer:critical', 'aperak-timer:expired'])
  })
})
