// masterplan: AT-Z09F-SUPPLIER, AT-Z09G-SUPPLIER
// Component acceptance only: later Z06/P-15 history, actual ACK processing,
// SQL source authority, TEN/ENV and native/integration proofs retain their owners.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MeteringMethodChangeBasis } from '@/lib/ediel/production/meteringMethodChangeSource'
import type { CreateEdielMessageInput } from '@/lib/ediel/types'
import type { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'

// Declared finite IO ports. Flow, gateway, renderer, source/BRP adapters, intent
// engine, canonical route assertion, policy and EDIFACT codec remain real.
// RPC results are synthetic fixtures, not an implementation of native authority.
// Route/version selection, draft persistence, CIS request and outbox enqueue are
// IO doubles; no SQL, SMTP, inbound consumer or received-ACK behavior is claimed.
const io = vi.hoisted(() => ({
  rpc: vi.fn(), serviceFrom: vi.fn(), tenantFrom: vi.fn(),
  route: vi.fn(), version: vi.fn(), finalize: vi.fn(),
  request: vi.fn(), queue: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { rpc: io.rpc, from: io.serviceFrom },
}))
vi.mock('@/lib/supabase/tenantDb', () => ({
  tenantDb: (companyId: string) => ({ from: (table: string) => io.tenantFrom(companyId, table) }),
}))
vi.mock('@/lib/cis/db', () => ({ createOutboundRequest: io.request }))
vi.mock('@/lib/ediel/core/kernel', () => ({
  resolveCanonicalOutboundContext: io.route, finalizeCanonicalOutboundDraft: io.finalize,
}))
vi.mock('@/lib/ediel/core/versionRegistry', () => ({ resolveCanonicalOutboundVersion: io.version }))
vi.mock('@/lib/ediel/flows/shared', () => ({ queuePreparedEdielMessage: io.queue }))

import { prepareAndQueueMeteringMethodChangeZ09 } from '@/lib/ediel/flows/prodatMeteringMethodChange'
import { renderAndQueueMeteringMethodChange } from '@/lib/ediel/intent/meteringMethodChangeGateway'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const own = {
  company: id(1), event: id(2), supply: id(3), sourceMessage: id(4), customer: id(5),
  point: id(6), legalActor: id(7), site: id(8), contract: id(9), intent: id(10),
  profile: id(11), route: id(12), actor: id(20), request: id(21), message: id(22),
}
const command = { companyId: own.company, eventId: own.event, actorUserId: own.actor }
const profiles = [
  { subtype: 'F' as const, reason: 'E64', method: 'Z04' },
  { subtype: 'G' as const, reason: 'E32', method: 'Z03' },
]
const minutes = [
  { label: 'winter non-midnight', at: '2027-01-18T14:37:00+01:00', physical: '202701181437' },
  // 14:37 civil summer UTC+2 is 13:37 in Ediel's fixed UTC+1.
  { label: 'summer non-midnight', at: '2027-07-18T14:37:00+02:00', physical: '202707181337' },
]
type Row = Record<string, unknown>
type Route = Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
type Effect = { port: string; input: Row }
type Fixture = {
  basis: MeteringMethodChangeBasis; route: Route;
  intents: Row[]; requests: Row[]; messages: Row[]; drafts: CreateEdielMessageInput[];
  effects: Effect[]; reads: string[]; unexpected: string[];
  heldAt: 'preparation' | 'reread' | 'reservation' | null;
  reservationError: { code: string; message: string } | null;
  scopeReads: number; reservationReads: number;
  unrelated: Row;
}
let f: Fixture

function fixture(): Fixture {
  const basis: MeteringMethodChangeBasis = {
    status: 'authorized', companyId: own.company, environment: 'production', eventId: own.event,
    supplyPeriodId: own.supply, supplyStateVersion: 4, supplySourceMessageId: own.sourceMessage,
    customerId: own.customer, siteId: own.site, meteringPointId: own.point,
    legalActorId: own.legalActor, legalSenderId: '12345', legalReceiverId: '54321',
    pointId: '735123456789012345', identityAgency: '9', gridArea: 'TES',
    effectiveAt: minutes[0].at, ...profiles[0], contractId: own.contract,
    contractRevision: 'SYNTHETIC-REVISION-4', sourceReference: 'SYNTHETIC-AGREEMENT',
    sourceVersion: 'synthetic-fixture', sourceDigest: 'b'.repeat(64), brpEdielId: '11111',
  }
  const route = {
    companyId: own.company, environment: 'production',
    actor: { tenantIdentity: { legalActorId: own.legalActor }, legalActorEdielId: '12345', marketRoles: ['electricity_supplier'] },
    // Deliberately distinct communication sender and source legal sender.
    senderEdielId: '99111', receiverEdielId: '54321', senderSubAddress: null,
    receiverSubAddress: null, receiverMessageSubAddress: null,
    applicationReference: '23-DDQ-PRODAT', route: { id: own.route },
    routeRuntime: { route_profile_id: own.profile }, mailbox: null,
    receiverEmail: 'synthetic-dso@example.invalid',
  } as Route
  return {
    basis, route, intents: [], requests: [], messages: [], drafts: [], effects: [],
    reads: [], unexpected: [], heldAt: null, reservationError: null, scopeReads: 0, reservationReads: 0,
    unrelated: {
      requestedCustomer: { id: own.customer, legalIdentity: 'SYNTHETIC-LEGAL-IDENTITY', siteId: own.site },
      supply: { id: own.supply, customerId: own.customer, startAt: '2026-01-01T00:00:00+01:00', endAt: null, stateVersion: 4 },
      confirmedStructure: [
        { version: 3, method: 'Z01', validAt: '2025-01-01T00:00:00+01:00', receivedAt: '2024-12-20T09:15:00Z' },
        { version: 4, method: 'Z02', validAt: '2026-01-01T00:00:00+01:00', receivedAt: '2025-12-20T11:23:00Z' },
      ],
      foreignSupply: { companyId: id(90), customerId: id(91), method: 'Z03', stateVersion: 8 },
    },
  }
}

function unexpected(port: string): never {
  f.unexpected.push(port)
  throw new Error(`undeclared_fixture_io:${port}`)
}

// Narrow table adapter: only actual intent-engine writes and the flow/gateway's
// request/message reads. Unknown table or mutation calls fail closed and record
// the attempted port. This is a finite call oracle, not SQL persistence proof.
type QueryResult = { data: Row | Row[] | null; error: null }
type FixtureQuery = {
  select: (columns: string) => FixtureQuery;
  eq: (key: string, value: unknown) => FixtureQuery;
  limit: (value: number) => FixtureQuery;
  returns: () => FixtureQuery;
  maybeSingle: () => Promise<QueryResult>;
  single: () => Promise<QueryResult>;
  upsert: (row: Row) => FixtureQuery;
  update: (row: Row) => FixtureQuery;
  insert: (row: Row) => never;
  delete: () => never;
  then: (resolve: (value: QueryResult) => unknown) => Promise<unknown>;
}
function tableQuery(table: string, tenant?: string): FixtureQuery {
  const rows = table === 'ediel_message_intents' ? f.intents
    : table === 'outbound_requests' ? f.requests : table === 'ediel_messages' ? f.messages
      : unexpected(`table:${table}`)
  if (tenant && tenant !== own.company) unexpected(`tenant:${tenant}`)
  const filters: Array<[string, unknown]> = []
  let operation = 'select'
  let mutation: Row | undefined
  let rowLimit = Infinity
  const result = (single: boolean): QueryResult => {
    const selected = rows.filter(row => filters.every(([key, value]) => row[key] === value)
      && (!tenant || row.company_id === tenant)).slice(0, rowLimit)
    if (operation === 'upsert') {
      if (table !== 'ediel_message_intents' || !mutation) unexpected(`upsert:${table}`)
      const row = { id: own.intent, ...structuredClone(mutation!) }
      rows.push(row)
      f.effects.push({ port: 'intent.upsert', input: structuredClone(row) })
      return { data: row, error: null }
    }
    if (operation === 'update') {
      if (table !== 'ediel_message_intents' || !mutation) unexpected(`update:${table}`)
      for (const row of selected) Object.assign(row, structuredClone(mutation!))
      f.effects.push({ port: 'intent.lifecycle', input: structuredClone(mutation!) })
      return { data: null, error: null }
    }
    f.reads.push(`table:${table}`)
    return { data: single ? selected[0] ?? null : selected, error: null }
  }
  const query: FixtureQuery = {
    select: () => query,
    eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
    limit: (value: number) => { rowLimit = value; return query },
    returns: () => query,
    maybeSingle: async () => result(true),
    single: async () => result(true),
    upsert: (row: Row) => { operation = 'upsert'; mutation = row; return query },
    update: (row: Row) => { operation = 'update'; mutation = row; return query },
    insert: () => unexpected(`insert:${table}`),
    delete: () => unexpected(`delete:${table}`),
    then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result(false)).then(resolve),
  }
  return query
}

beforeEach(() => {
  vi.resetAllMocks()
  f = fixture()
  io.serviceFrom.mockImplementation((table: string) => {
    if (table !== 'ediel_message_intents') return unexpected(`service.table:${table}`)
    return tableQuery(table)
  })
  io.tenantFrom.mockImplementation((company: string, table: string) => {
    if (!['outbound_requests', 'ediel_messages'].includes(table)) return unexpected(`tenant.table:${table}`)
    return tableQuery(table, company)
  })
  io.rpc.mockImplementation(async (name: string, input: Row) => {
    f.reads.push(`rpc:${name}`)
    if (input.p_company_id !== own.company || input.p_actor_user_id !== own.actor) return unexpected(`rpc.scope:${name}`)
    if (name === 'ediel_metering_method_change_scope_v1') {
      f.scopeReads++
      if (input.p_event_id !== own.event) return unexpected('scope.event')
      if (f.heldAt === 'preparation' || (f.heldAt === 'reread' && f.scopeReads === 2)) {
        return { data: { status: 'held', missing: ['authentic_customer_agreed_method_event'] }, error: null }
      }
      return { data: structuredClone(f.basis), error: null }
    }
    if (name === 'ediel_brp_field_source_v1') {
      expect(input).toEqual({
        p_company_id: own.company, p_contract_id: own.contract, p_actor_user_id: own.actor,
        p_environment: 'production', p_customer_id: own.customer, p_site_id: own.site,
        p_point_id: own.point, p_at: f.basis.effectiveAt, p_period_id: own.supply,
      })
      return { data: {
        status: 'authorized', sourceKind: 'accepted_supply_brp', companyId: own.company,
        environment: 'production', customerId: own.customer, siteId: own.site,
        meteringPointId: own.point, at: f.basis.effectiveAt, supplyPeriodId: own.supply,
        brpEdielId: '11111', pointId: f.basis.pointId, identityAgency: '9',
        legalActorId: own.legalActor, legalSenderId: '12345', legalReceiverId: '54321',
        gridArea: 'TES', sourceMessageId: own.sourceMessage, sourcePayloadHash: 'a'.repeat(64),
      }, error: null }
    }
    if (name === 'ediel_metering_method_change_source_v1') {
      if (input.p_event_id !== own.event) return unexpected('source.event')
      return { data: structuredClone(f.basis), error: null }
    }
    if (name === 'ediel_reserve_metering_method_change_origin_v1') {
      f.reservationReads++
      if (input.p_event_id !== own.event || input.p_intent_id !== own.intent || input.p_outbound_request_id !== own.request) return unexpected('reservation.binding')
      if (f.reservationError) return { data: null, error: f.reservationError }
      if (f.heldAt === 'reservation') return { data: { status: 'held', missing: ['authentic_customer_agreed_method_event'] }, error: null }
      return { data: { status: 'reserved', outboundRequestId: own.request, messageId: f.messages[0]?.id ?? null }, error: null }
    }
    return unexpected(`rpc:${name}`)
  })
  io.route.mockImplementation(async () => f.route)
  io.version.mockResolvedValue('26.A')
  io.request.mockImplementation(async (input: Row) => {
    f.requests.push({ id: own.request, company_id: own.company, source_type: input.sourceType, source_id: input.sourceId, request_type: input.requestType })
    f.effects.push({ port: 'request.create', input: structuredClone(input) })
    return { id: own.request }
  })
  io.finalize.mockImplementation(async (input: { draft: CreateEdielMessageInput }) => {
    const draft = structuredClone(input.draft)
    f.drafts.push(draft)
    f.effects.push({ port: 'draft.finalize', input: structuredClone(input) })
    const message = {
      id: own.message, company_id: draft.companyId, environment: draft.environment,
      status: 'draft', direction: draft.direction, message_family: draft.messageFamily,
      message_code: draft.messageCode, intent_id: draft.intentId,
      outbound_request_id: draft.outboundRequestId, source_operation_id: draft.sourceOperationId,
      raw_payload: draft.rawPayload,
    }
    f.messages.push(message)
    return message
  })
  io.queue.mockImplementation(async (input: Row) => {
    f.effects.push({ port: 'outbox.queue', input: structuredClone(input) })
    f.messages[0].status = 'queued'
  })
})

function gatewayInput() {
  return { ...command, intentId: own.intent, routeContext: f.route, outboundRequestId: own.request }
}
function effects(port: string) { return f.effects.filter(effect => effect.port === port) }
function expectNoFinalizedOrQueuedEffects() {
  expect(f.drafts).toEqual([])
  expect(f.messages).toEqual([])
  expect(effects('draft.finalize')).toEqual([])
  expect(effects('outbox.queue')).toEqual([])
  expect(effects('intent.lifecycle')).toEqual([])
  expect(f.unexpected).toEqual([])
}

describe.each(profiles)('supplier Z09$subtype coupled component acceptance', profile => {
  beforeEach(() => { Object.assign(f.basis, profile) })

  // Mutations caught: bypass gateway, switch F/G tuple, legal sender replaced by
  // communication sender, midnight truncation or civil summer offset, lost LI
  // or source/request/route binding, forbidden customer/supply projection.
  it.each(minutes)('prepares, reserves and queues the physical profile at $label without changing confirmed structure', async minute => {
    f.basis.effectiveAt = minute.at
    const before = structuredClone(f.unrelated)
    expect(await prepareAndQueueMeteringMethodChangeZ09(command)).toMatchObject({ status: 'queued', message: { id: own.message } })
    expect(f.drafts).toHaveLength(1)
    const draft = f.drafts[0]
    const intent = f.intents[0]
    const tokenized = tokenizeEdifact(draft.rawPayload!)
    const segments = tokenized.segments.map(segment => segment.raw)
    const unb = tokenized.segments.find(segment => segment.tag === 'UNB')!
    expect(unb.elements[7]).toBe('23-DDQ-PRODAT')
    expect(unb.elements[9]).toBe('1')
    expect(unb.elements[2]).toBe('99111:ZZ')
    expect(unb.elements[3]).toBe('54321:ZZ')
    expect(segments).toContain(`BGM+Z09+${intent.interchange_reference}+9+AB`)
    expect(segments).toContain('NAD+FR+12345:160:SVK+++++++SE')
    expect(segments).toContain('NAD+DO+54321:160:SVK+++++++SE')
    expect(segments).toContain('LIN+1++735123456789012345:::9')
    expect(segments).toContain(`DTM+157:${minute.physical}:203`)
    expect(segments.join("'")).toContain(`CCI++Z13'CAV+${profile.reason}`)
    expect(segments.join("'")).toContain(`CCI++Z04'CAV+${profile.method}`)
    expect(segments.filter(segment => segment.startsWith('RFF+LI:'))).toEqual([`RFF+LI:${intent.transaction_reference}`])
    expect(intent.transaction_reference).not.toBe(intent.interchange_reference)
    expect(intent.interchange_reference).toMatch(/^[A-F0-9]{14}$/)
    expect(segments.filter(segment => /^NAD\+(UD|IT)(?:\+|$)|^DTM\+(92|93):/.test(segment))).toEqual([])
    expect(draft).toMatchObject({
      companyId: own.company, direction: 'outbound', intentId: own.intent,
      sourceOperationId: own.event, outboundRequestId: own.request,
      communicationRouteId: own.route, routeProfileId: own.profile,
      customerId: own.customer, siteId: own.site, meteringPointId: own.point,
      applicationReference: '23-DDQ-PRODAT', requiresContrl: true, requiresAperak: true,
      contrlStatus: 'pending', aperakStatus: 'pending', utiltsErrStatus: 'not_required',
      transactionReference: intent.transaction_reference,
    })
    expect(intent).toMatchObject({
      company_id: own.company, direction: 'outbound', operation_id: own.event,
      customer_id: own.customer, customer_site_id: own.site,
      metering_point_id: '735123456789012345', communication_route_id: own.route,
      route_profile_id: own.profile, payload: { actorRole: 'supplier', meteringMethodChangeEventId: own.event },
      render_status: 'rendered', outbox_status: 'queued', ediel_message_id: own.message,
      outbound_request_id: own.request,
      supplier_switch_request_id: null, customer_info_request_id: null,
      requested_effective_date: null,
    })
    expect(effects('request.create')).toEqual([{ port: 'request.create', input: expect.objectContaining({
      actorUserId: own.actor, customerId: own.customer, environment: 'production', failOnMissingEnvironment: true,
      requestType: 'customer_masterdata', sourceType: 'manual', sourceId: own.intent, operationId: own.event,
      siteId: own.site, meteringPointId: own.point, communicationRouteId: own.route,
      payload: { meteringMethodChangeEventId: own.event, intentId: own.intent },
    }) }])
    expect(io.route).toHaveBeenCalledExactlyOnceWith({
      companyId: own.company, environment: 'production', requestType: 'customer_masterdata',
      receiverEdielId: '54321', preferredRouteId: undefined, applicationReference: '23-DDQ-PRODAT',
    })
    expect(effects('draft.finalize')[0].input).toMatchObject({
      actorUserId: own.actor, requestType: 'customer_masterdata', outboundRequestId: own.request,
      duplicateCheck: { sourceType: 'manual', sourceId: own.intent, messageFamily: 'PRODAT',
        messageCode: 'Z09', receiverEdielId: '54321' },
    })
    expect(effects('outbox.queue')).toEqual([{ port: 'outbox.queue', input: {
      actorUserId: own.actor, messageId: own.message, outboundRequestId: own.request,
      intentId: own.intent, payload: { meteringMethodChangeEventId: own.event,
        intentId: own.intent, operationId: own.event, messageFamily: 'PRODAT', messageCode: 'Z09', routeId: own.route },
    } }])
    expect(f.scopeReads).toBe(2)
    expect(f.reservationReads).toBe(2)
    expect(f.reads.filter(read => read === 'rpc:ediel_metering_method_change_source_v1')).toHaveLength(2)
    expect(f.effects.map(effect => effect.port)).toEqual([
      'intent.upsert', 'request.create', 'draft.finalize', 'intent.lifecycle', 'outbox.queue', 'intent.lifecycle',
    ])
    const policy = resolveCanonicalEdielPolicy({
      family: 'PRODAT', messageCode: 'Z09', subtypeOrReasonCode: profile.subtype,
      direction: 'outbound', referenceDate: '2026-09-30', applicationReference: '23-DDQ-PRODAT',
      prodatDependentFacts: { market: 'electricity' }, mode: 'parse',
    })
    expect(validateCanonicalPolicyFields({ policy, rawSegments: segments, una: tokenized.una })).toEqual([])
    expect(f.unrelated).toEqual(before)
    expect(f.unexpected).toEqual([])
  })

  // Mutations caught: preparation creates preliminary effects on absent source;
  // gateway ignores its reread or native reservation hold and continues.
  it.each(['preparation', 'reread', 'reservation'] as const)('holds source withdrawn at %s without finalization or queued lifecycle', async heldAt => {
    f.heldAt = heldAt
    const before = structuredClone(f.unrelated)
    expect(await prepareAndQueueMeteringMethodChangeZ09(command)).toEqual({ status: 'held', missing: ['authentic_customer_agreed_method_event'] })
    expect(f.intents).toHaveLength(heldAt === 'preparation' ? 0 : 1)
    expect(f.requests).toHaveLength(heldAt === 'preparation' ? 0 : 1)
    if (heldAt !== 'preparation') expect(f.intents[0]).toMatchObject({ render_status: 'not_rendered', outbox_status: 'not_queued' })
    expect(f.reservationReads).toBe(heldAt === 'reservation' ? 1 : 0)
    expectNoFinalizedOrQueuedEffects()
    expect(f.unrelated).toEqual(before)
  })

  // Mutation caught: reserved non-draft replay is finalized/enqueued twice.
  it('reuses the own reserved message through preparation without another finalization or queue', async () => {
    await prepareAndQueueMeteringMethodChangeZ09(command)
    const before = structuredClone({ effects: f.effects, unrelated: f.unrelated, messages: f.messages })
    expect(await prepareAndQueueMeteringMethodChangeZ09(command)).toMatchObject({
      status: 'existing', message: { id: own.message, intent_id: own.intent,
        outbound_request_id: own.request, source_operation_id: own.event },
    })
    expect(f.intents).toHaveLength(1)
    expect(f.requests).toHaveLength(1)
    expect(f.drafts).toHaveLength(1)
    expect(f.effects).toEqual(before.effects)
    expect(f.messages).toEqual(before.messages)
    expect(f.unrelated).toEqual(before.unrelated)
    expect(f.scopeReads).toBe(4)
    expect(f.reservationReads).toBe(3)
    expect(f.unexpected).toEqual([])
  })

  // Mutation caught: replay accepts someone else's intent/request/event binding.
  it.each(['intent_id', 'outbound_request_id', 'source_operation_id'])('rejects reserved replay with wrong %s without new effects', async field => {
    await prepareAndQueueMeteringMethodChangeZ09(command)
    f.messages[0][field] = id(99)
    const before = structuredClone(f.effects)
    await expect(renderAndQueueMeteringMethodChange(gatewayInput())).rejects.toThrow('metering_method_change_existing_message_conflict')
    expect(f.effects).toEqual(before)
    expect(f.drafts).toHaveLength(1)
    expect(f.unexpected).toEqual([])
  })
})

// Mutation caught: preparation stops calling the real canonical route assertion.
it.each([
  { label: 'non-supplier', change: (route: Route) => { route.actor.marketRoles = [] } },
  { label: 'wrong legal recipient', change: (route: Route) => { route.receiverEdielId = '98765' } },
  { label: 'foreign company', change: (route: Route) => { route.companyId = id(99) } },
  { label: 'foreign legal actor', change: (route: Route) => { route.actor.tenantIdentity!.legalActorId = id(99) } },
  { label: 'wrong legal sender', change: (route: Route) => { route.actor.legalActorEdielId = '98765' } },
  { label: 'wrong environment', change: (route: Route) => { route.environment = 'test' } },
  { label: 'wrong application reference', change: (route: Route) => { route.applicationReference = '23-UTILTS' } },
])('rejects $label route before any intent/request/draft/queue', async ({ change }) => {
  change(f.route)
  await expect(prepareAndQueueMeteringMethodChangeZ09(command)).rejects.toThrow('metering_method_change_canonical_legal_route_mismatch')
  expect(f.effects).toEqual([])
  expect(f.intents).toEqual([])
  expect(f.requests).toEqual([])
  expectNoFinalizedOrQueuedEffects()
})

// Mutation caught: source tuple checks are bypassed and current Z02 is used as
// desired method, or F and G reason/method assignments are swapped.
it.each([
  { subtype: 'F' as const, reason: 'E32', method: 'Z03' },
  { subtype: 'G' as const, reason: 'E64', method: 'Z04' },
  { subtype: 'F' as const, reason: 'E64', method: 'Z02' },
])('rejects a noncanonical $subtype/$reason/$method source before effects', async tuple => {
  Object.assign(f.basis, tuple)
  await expect(prepareAndQueueMeteringMethodChangeZ09(command)).rejects.toThrow('metering_method_change_canonical_tuple_mismatch')
  expect(f.effects).toEqual([])
  expectNoFinalizedOrQueuedEffects()
})

it('rejects foreign source company returned by the real source adapter before intent creation', async () => {
  f.basis.companyId = id(99)
  await expect(prepareAndQueueMeteringMethodChangeZ09(command)).rejects.toThrow('metering_method_change_source_scope_invalid')
  expect(f.effects).toEqual([])
  expectNoFinalizedOrQueuedEffects()
})

it('rejects foreign saved intent at the real gateway without additional effects', async () => {
  await prepareAndQueueMeteringMethodChangeZ09(command)
  f.intents[0].company_id = id(99)
  const before = structuredClone(f.effects)
  await expect(renderAndQueueMeteringMethodChange(gatewayInput())).rejects.toThrow('metering_method_change_intent_scope_mismatch')
  expect(f.effects).toEqual(before)
  expect(f.unexpected).toEqual([])
})

// Mutation caught: the renderer drops its own canonical route check after the
// preparation route was accepted. Native authority remains a separate proof.
it.each(['role', 'recipient', 'company'] as const)('rejects changed %s at the real gateway/renderer boundary', async field => {
  f.heldAt = 'reread'
  await prepareAndQueueMeteringMethodChangeZ09(command)
  f.heldAt = null
  if (field === 'role') f.route.actor.marketRoles = []
  if (field === 'recipient') f.route.receiverEdielId = '98765'
  if (field === 'company') f.route.companyId = id(99)
  const before = structuredClone(f.unrelated)
  await expect(renderAndQueueMeteringMethodChange(gatewayInput())).rejects.toThrow('metering_method_change_canonical_legal_route_mismatch')
  expect(f.reservationReads).toBe(1)
  expectNoFinalizedOrQueuedEffects()
  expect(f.unrelated).toEqual(before)
})

// Mutation caught: required object identity is allowed through the real intent
// validation gate, or validity-start is manufactured without a source instant.
it('holds missing required object identity before finalization or queue', async () => {
  f.basis.pointId = ''
  expect(await prepareAndQueueMeteringMethodChangeZ09(command)).toMatchObject({
    status: 'held', missing: ['facility_or_metering_point_missing'],
  })
  expect(f.intents[0]).toMatchObject({ validation_status: 'blocked', render_status: 'not_rendered', outbox_status: 'not_queued' })
  expect(f.reservationReads).toBe(0)
  expectNoFinalizedOrQueuedEffects()
})

it('rejects missing validity-start source instant rather than manufacturing DTM157', async () => {
  f.basis.effectiveAt = ''
  await expect(prepareAndQueueMeteringMethodChangeZ09(command)).rejects.toThrow('brp_field_source_scope_invalid')
  expect(f.effects).toEqual([])
  expectNoFinalizedOrQueuedEffects()
})

it('holds a non-supplier outbound saved intent at real pre-render validation', async () => {
  f.heldAt = 'reread'
  await prepareAndQueueMeteringMethodChangeZ09(command)
  f.heldAt = null
  f.intents[0].payload = { actorRole: 'esco', meteringMethodChangeEventId: own.event }
  expect(await renderAndQueueMeteringMethodChange(gatewayInput())).toMatchObject({ status: 'held', missing: ['prodat_actor_role_not_allowed'] })
  expect(f.scopeReads).toBe(2)
  expect(f.reservationReads).toBe(0)
  expectNoFinalizedOrQueuedEffects()
})

// Existing native owner requires outbound at reservation and seals original
// direction. This checks real gateway propagation of that port's rejection;
// it does not execute or simulate the SQL guard itself.
it('propagates native reservation rejection of a foreign-direction intent before draft or queue', async () => {
  f.heldAt = 'reread'
  await prepareAndQueueMeteringMethodChangeZ09(command)
  f.heldAt = null
  f.intents[0].direction = 'inbound_response'
  f.reservationError = { code: 'P0001', message: 'metering_method_change_owned_intent_request_required' }
  const before = structuredClone(f.unrelated)
  await expect(renderAndQueueMeteringMethodChange(gatewayInput())).rejects.toMatchObject({
    code: 'P0001', message: 'metering_method_change_owned_intent_request_required',
  })
  expect(f.reservationReads).toBe(1)
  expectNoFinalizedOrQueuedEffects()
  expect(f.unrelated).toEqual(before)
})
