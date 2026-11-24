import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ensureAndPrepareUtiltsFromDataRequest } from '@/lib/cis/edielAutomation'
import { runMeteringMarketDataAutopilot } from '@/lib/metering/monthlyAutopilot'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight'

const io = vi.hoisted(() => {
  const state = {
    start: '2026-03-01', end: '2026-04-01',
    monthlyEnvironment: false, bilateral: true, legalCompany: 'company',
    existing: null as { id: string; company_id: string; communication_route_id: string } | null,
  }
  const point = { id: 'meter', customer_id: 'customer', site_id: 'site', customer_site_id: 'site', grid_owner_id: 'owner', status: 'active' }
  const request = () => ({
    id: 'request', company_id: 'company', customer_id: 'customer', site_id: 'site', metering_point_id: 'meter',
    grid_owner_id: 'owner', request_scope: 'meter_values', requested_period_start: state.start, requested_period_end: state.end,
    requested_at: '2026-11-19T12:00:00.000Z', external_reference: null, request_payload: {}, response_payload: {},
  })
  return {
    state, request, point,
    task: vi.fn(async () => ({})),
    createRequest: vi.fn(async () => request()),
    createOutbound: vi.fn(async ({ communicationRouteId }: { communicationRouteId?: string | null }) => {
      const outbound = { id: 'own-outbound', company_id: 'company', communication_route_id: communicationRouteId ?? '' }
      state.existing = outbound
      return outbound
    }),
    findOutbound: vi.fn(async () => state.existing),
    legacyRoute: vi.fn(async () => ({ id: 'legacy-route' })),
    status: vi.fn(async () => ({})),
    governance: vi.fn(async () => undefined),
    route: vi.fn(async ({ preferredRouteId }: { preferredRouteId: string | null }) => ({
      route: { id: preferredRouteId ?? 'tgt-route' }, companyId: 'company', environment: 'test',
      routeRuntime: { route_profile_id: 'test-route-profile' },
      actor: { legalActorEdielId: '33333', tenantIdentity: { companyId: state.legalCompany, environment: 'test', legalEdielId: '33333' } },
      senderEdielId: '11111', receiverEdielId: '22222', applicationReference: '23-DDQ-E66-T',
    })),
    structure: vi.fn(async () => ({
      legalSupplier: '33333', legalNetwork: '44444', fields: { reportingFrequency: 'D', measurementMethod: 'Z04' }, resolution: 'PT15M',
    })),
    intent: vi.fn(async () => ({
      id: 'e73-intent', validationStatus: 'validated', interchangeReference: 'E7312345678901', messageReference: '1',
    })),
    finalize: vi.fn(async ({ draft }: { draft: {
      rawPayload: string; externalReference: string; outboundRequestId?: string; intentId?: string;
    } }) => ({
      id: 'e73-message', external_reference: draft.externalReference, outbound_request_id: draft.outboundRequestId,
    })),
    link: vi.fn(async () => ({})),
    queue: vi.fn(async (method: string, _args: Record<string, string>) => {
      if (method !== 'gridex_queue_prepared_supplier_e73_v1') throw new Error('Unexpected synthetic RPC ' + method)
      return { data: { message: { id: 'e73-message', outbound_request_id: state.existing?.id } }, error: null }
    }),
  }
})
const { state } = io

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    rpc: io.queue,
    from(table: string) {
      const query = {
        select: () => query, eq: () => query, in: () => query, order: () => query,
        range: async () => ({ data: [io.point], error: null }),
        limit: async () => ({ data: io.state.bilateral ? [{ id: 'bilateral-e73' }] : [], error: null }),
        maybeSingle: async () => ({
          data: table === 'grid_owner_data_requests' ? io.request() : { target_system: 'TGT' },
          error: null,
        }),
      }
      if (!['grid_owner_data_requests', 'metering_points', 'communication_routes', 'tenant_message_capabilities'].includes(table)) {
        throw new Error('Unexpected synthetic read of ' + table)
      }
      return query
    },
  },
}))
vi.mock('@/lib/cis/db', () => ({
  createGridOwnerDataRequest: io.createRequest, createOutboundRequest: io.createOutbound,
  findOpenOutboundBySource: io.findOutbound, updateGridOwnerDataRequestStatus: io.status,
}))
vi.mock('@/lib/cis/db-routes', () => ({ findBestCommunicationRoute: io.legacyRoute }))
vi.mock('@/lib/customers/dataTasks', () => ({ createCustomerDataTask: io.task }))
vi.mock('@/lib/masterdata/db', () => ({
  getCustomerSiteById: async () => ({ site_type: 'consumption' }),
  getMeteringPointById: async () => ({ meter_point_id: '735999260731000007' }),
  getGridOwnerById: async () => ({ owner_code: 'TES', ediel_id: '44444' }),
}))
vi.mock('@/lib/metering/validation', () => ({
  evaluateMeteringCompletenessForMonth: async () => ({ issues: [{ code: 'metering_values_missing' }] }),
}))
vi.mock('@/lib/metering/contractMeteringResolution', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/metering/contractMeteringResolution')>(),
  loadMeteringResolutionRequirements: async () => new Map(),
}))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: io.governance }))
vi.mock('@/lib/ediel/intent/intentEngine', () => ({ createEdielMessageIntent: io.intent }))
vi.mock('@/lib/ediel/flows/routeDecisionContext', () => ({ resolveDecisionBackedOutboundContext: io.route }))
vi.mock('@/lib/ediel/sources/dataRequestStructure', () => ({ requireDataRequestStructure: io.structure }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: vi.fn(), linkEdielMessage: io.link }))
vi.mock('@/lib/ediel/core/versionRegistry', () => ({ resolveCanonicalOutboundVersion: async () => 'E5SE5A' }))
vi.mock('@/lib/ediel/core/referenceRegistry', async importOriginal => {
  // The period/owner test uses a valid synthetic BGM. Automatic document
  // identity has separate evidence and remains outside the requested change.
  const actual = await importOriginal<typeof import('@/lib/ediel/core/referenceRegistry')>()
  return { ...actual, buildCanonicalOutboundReferences: (input: Parameters<typeof actual.buildCanonicalOutboundReferences>[0]) => ({
    ...actual.buildCanonicalOutboundReferences(input), externalReference: 'E73-SYNTHETIC-DOC',
  }) }
})
vi.mock('@/lib/ediel/orchestrator', async () => {
  const { prepareAndQueueUtiltsE73 } = await import('@/lib/ediel/flows/utiltsSupplierRequest')
  return { prepareAndQueueUtiltsE73 }
})
// Canonical finalization and transport are declared I/O ports. Keep the
// actual shared environment lookup and find-or-create behavior below.
vi.mock('@/lib/ediel/core/kernel', () => ({
  finalizeCanonicalOutboundDraft: vi.fn(), resolveCanonicalOutboundContext: vi.fn(),
}))
vi.mock('@/lib/ediel/flows/shared', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ediel/flows/shared')>()
  return {
    ...actual,
    makeServerClient: async () => ({}),
    resolveOutboundRuntimeEnvironment: async (input: Parameters<typeof actual.resolveOutboundRuntimeEnvironment>[0]) =>
      io.state.monthlyEnvironment && !input.preferredRouteId ? 'test' : actual.resolveOutboundRuntimeEnvironment(input),
    finalizeOutboundDraft: io.finalize,
  }
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T12:00:00Z'))
  vi.clearAllMocks()
  Object.assign(state, { start: '2026-03-01', end: '2026-04-01', monthlyEnvironment: false,
    bilateral: true, legalCompany: 'company', existing: null })
  vi.stubGlobal('fetch', async () => { throw new Error('Network access is outside this synthetic fixture') })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const monthly = () => runMeteringMarketDataAutopilot({ companyId: 'company', billingMonth: '2026-03', actorUserId: 'actor' })
const direct = (code: 'E66' | 'E73' = 'E73') => ensureAndPrepareUtiltsFromDataRequest({
  actorUserId: 'actor', dataRequestId: 'request', utiltsCode: code, communicationRouteId: 'tgt-route',
})

function expectNoOutbound() {
  expect(io.createOutbound).not.toHaveBeenCalled()
  expect(io.intent).not.toHaveBeenCalled()
  expect(io.finalize).not.toHaveBeenCalled()
  expect(io.link).not.toHaveBeenCalled()
  expect(io.queue).not.toHaveBeenCalled()
  expect(io.status).not.toHaveBeenCalled()
}

it('keeps the actual monthly job fail-closed without an environment and creates no outbound row', async () => {
  const result = await monthly()
  expect(result.decisions).toMatchObject([{ decision: 'REVIEW', error: expect.stringContaining('environment_not_resolved') }])
  expect(io.createRequest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    requestedPeriodStart: '2026-02-28T23:00:00.000Z',
    requestedPeriodEnd: '2026-03-31T22:00:00.000Z',
  }))
  expect(io.task).toHaveBeenCalledOnce()
  expect(io.route).not.toHaveBeenCalled()
  expectNoOutbound()
})

it('does not allocate an outbound for the monthly job’s invalid stored period with a qualified environment port', async () => {
  state.monthlyEnvironment = true
  state.end = state.start
  const result = await monthly()
  expect(result.decisions).toMatchObject([{ decision: 'REVIEW', error: 'utilts_e73_delivery_period_invalid' }])
  expect(io.route).toHaveBeenCalledOnce()
  expect(io.structure).not.toHaveBeenCalled()
  expectNoOutbound()
})

it('rejects an invalid manually selected period before any outbound begins', async () => {
  state.end = state.start
  await expect(direct()).rejects.toThrow('utilts_e73_delivery_period_invalid')
  expect(io.route).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ companyId: 'company', preferredRouteId: 'tgt-route', environment: 'test' }))
  expect(io.structure).not.toHaveBeenCalled()
  expectNoOutbound()
})

it('uses the same qualified route for the monthly candidate and its outbound row', async () => {
  state.monthlyEnvironment = true
  const result = await monthly()
  expect(result.decisions).toMatchObject([{ decision: 'RETRY', dataRequestId: 'request' }])
  expect(io.createOutbound).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    sourceId: 'request', communicationRouteId: 'tgt-route',
  }))
  expect(io.intent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    operationId: 'request', communicationRouteId: 'tgt-route', routeProfileId: 'test-route-profile',
  }))
  expect(io.finalize.mock.calls[0][0].draft).toMatchObject({ intentId: 'e73-intent', outboundRequestId: 'own-outbound' })
  expect(io.queue).toHaveBeenCalledExactlyOnceWith('gridex_queue_prepared_supplier_e73_v1', {
    p_company_id: 'company', p_actor_user_id: 'actor', p_request_id: 'request', p_environment: 'test', p_message_id: 'e73-message',
  })
})

it('keeps a missing capability and a cross-company legal route ahead of an invalid period', async () => {
  state.end = state.start
  state.bilateral = false
  await expect(direct()).rejects.toThrow('utilts_e73_bilateral_capability_missing:test')
  expect(io.route).not.toHaveBeenCalled()
  expectNoOutbound()
  state.bilateral = true
  state.legalCompany = 'other-company'
  await expect(direct()).rejects.toThrow('utilts_data_request_legal_source_scope_required')
  expect(io.structure).not.toHaveBeenCalled()
  expectNoOutbound()
})

it.each(['new', 'reuse', 'foreign'] as const)('preserves an explicitly routed valid E73 with a %s outbound candidate', async kind => {
  if (kind !== 'new') state.existing = {
    id: kind === 'foreign' ? 'foreign-outbound' : 'existing-outbound',
    company_id: kind === 'foreign' ? 'other-company' : 'company', communication_route_id: 'tgt-route',
  }
  const expectedOutboundId = kind === 'reuse' ? 'existing-outbound' : 'own-outbound'
  await expect(direct()).resolves.toMatchObject({ id: 'e73-message', outbound_request_id: expectedOutboundId })
  const raw = io.finalize.mock.calls[0][0].draft.rawPayload
  expect(raw).toContain('DTM+324:202603010000202604010000:719')
  expect(preflightEdielPayload({ rawPayload: raw, messageStandard: 'edifact', mode: 'send' }).issues).toEqual([])
  expect(io.finalize.mock.calls[0][0].draft).toMatchObject({ intentId: 'e73-intent', outboundRequestId: expectedOutboundId })
  expect(io.queue).toHaveBeenCalledExactlyOnceWith('gridex_queue_prepared_supplier_e73_v1', {
    p_company_id: 'company', p_actor_user_id: 'actor', p_request_id: 'request', p_environment: 'test', p_message_id: 'e73-message',
  })
  if (kind === 'reuse') expect(io.createOutbound).not.toHaveBeenCalled()
  else expect(io.createOutbound).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    sourceId: 'request', communicationRouteId: 'tgt-route', actorUserId: 'actor',
  }))
})

it('keeps the supplier E66 refusal and neither prepares nor allocates an outbound', async () => {
  await expect(direct('E66')).rejects.toThrow('E66 är en mätvärdesleverans')
  expect(io.governance).not.toHaveBeenCalled()
  expectNoOutbound()
})
