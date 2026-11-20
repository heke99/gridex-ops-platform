import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { prepareAndQueueUtiltsE73 } from '@/lib/ediel/flows/utiltsSupplierRequest'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { prodatMarketMinuteToUtc } from '@/lib/ediel/prodat/render/dates'
import { stockholmMonthBounds } from '@/lib/time/stockholm'

const probe = vi.hoisted(() => {
  const state = { start: '' as string | null, end: '' as string | null, legalCompany: 'tenant-1', storedRequest: null as Record<string, unknown> | null, applicationReference: '23-DDQ-E66-T' }
  const effects = {
    governance: vi.fn(async () => {}),
    request: vi.fn(async () => (state.storedRequest ?? {
      id: 'request-1', company_id: 'tenant-1', customer_id: 'customer', site_id: 'site',
      metering_point_id: 'meter', grid_owner_id: 'owner', request_scope: 'meter_values',
      requested_period_start: state.start, requested_period_end: state.end, request_payload: {},
    })),
    route: vi.fn(async () => ({
      route: { id: 'route-1' }, companyId: 'tenant-1', environment: 'test',
      actor: { legalActorEdielId: '33333', tenantIdentity: { companyId: state.legalCompany, environment: 'test', legalEdielId: '33333' } },
      senderEdielId: '11111', receiverEdielId: '22222', applicationReference: state.applicationReference,
    })),
    structure: vi.fn(async () => ({
      legalSupplier: '33333', legalNetwork: '44444', fields: { reportingFrequency: 'D', measurementMethod: 'quarter_hour' }, resolution: 'PT15M',
    })),
    makeOutbound: vi.fn(async () => ({ id: 'outbound-1' })),
    finalize: vi.fn(async ({ draft }: { draft: { rawPayload: string; externalReference: string } }) => ({
      id: 'message-1', external_reference: draft.externalReference,
    })),
    link: vi.fn(async () => {}),
    queue: vi.fn(async () => {}),
    status: vi.fn(async () => {}),
    event: vi.fn(async () => {}),
  }
  return { state, effects }
})
const {state, effects} = probe
vi.mock('@/lib/supabase/service', () => {
  const query = {
    select: () => query,
    eq: () => query,
    limit: async () => ({ data: [{ id: 'cap-e73' }], error: null }),
  }
  return { supabaseService: { from: () => query } }
})
vi.mock('@/lib/ediel/core/referenceRegistry', async importOriginal => {
  // Use a qualified fixture reference to keep the independent BGM length defect
  // from preempting the real builder and send preflight in these period cases.
  const originals = await importOriginal<typeof import('@/lib/ediel/core/referenceRegistry')>()
  return { ...originals, buildCanonicalOutboundReferences: (input: Parameters<typeof originals.buildCanonicalOutboundReferences>[0]) => ({
    ...originals.buildCanonicalOutboundReferences(input), externalReference: 'E73-SYNTHETIC-DOC',
  }) }
})
vi.mock('@/lib/ediel/core/versionRegistry', () => ({ resolveCanonicalOutboundVersion: async () => 'E5SE5A' }))
vi.mock('@/lib/masterdata/db', () => ({
  getCustomerSiteById: async () => ({ site_type:'consumption' }),
  getMeteringPointById: async () => ({ meter_point_id:'735999260731000007' }),
  getGridOwnerById: async () => ({ owner_code:'TES', ediel_id:'44444' }),
}))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: probe.effects.governance }))
vi.mock('@/lib/ediel/flows/shared', () => ({
  ensureActorUserId: (actor: string) => actor,
  makeServerClient: async () => ({}),
  getGridOwnerDataRequestById: probe.effects.request,
  resolveOutboundRuntimeEnvironment: async () => 'test',
  findOrCreateDataRequestOutbound: probe.effects.makeOutbound,
  finalizeOutboundDraft: probe.effects.finalize,
  queuePreparedEdielMessage: probe.effects.queue,
}))
vi.mock('@/lib/ediel/flows/routeDecisionContext', () => ({ resolveDecisionBackedOutboundContext: probe.effects.route }))
vi.mock('@/lib/ediel/sources/dataRequestStructure', () => ({ requireDataRequestStructure: probe.effects.structure }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: probe.effects.event, linkEdielMessage: probe.effects.link }))
vi.mock('@/lib/cis/db', () => ({ updateGridOwnerDataRequestStatus: probe.effects.status }))

const run = (start: string | null, end: string | null) => {
  state.start = start
  state.end = end
  return prepareAndQueueUtiltsE73({ actorUserId: 'actor-auth', gridOwnerDataRequestId: 'request-1', environment: 'test' })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T12:00:00Z'))
  vi.clearAllMocks()
  state.legalCompany = 'tenant-1'
  state.storedRequest = null
  state.applicationReference = '23-DDQ-E66-T'
  vi.stubGlobal('fetch', async () => { throw new Error('Network access is outside this synthetic E73 fixture') })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function expectNoRequestEffects() {
  for (const effect of [effects.makeOutbound, effects.finalize, effects.link, effects.queue, effects.status, effects.event]) {
    expect(effect).not.toHaveBeenCalled()
  }
}

it.each([
  ['equal stored dates', '2026-07-01', '2026-07-01'],
  ['reversed stored dates', '2026-07-02', '2026-07-01'],
  ['distinct instants in the same wire minute', '2026-07-01T00:00:01+01:00', '2026-07-01T00:00:59+01:00'],
  ['equivalent instants with different offsets', '2026-07-01T00:00:00+02:00', '2026-06-30T23:00:00+01:00'],
  ['a missing end date', '2026-07-01', null],
  ['an impossible calendar day', '2026-02-30', '2026-03-02'],
])('rejects %s before structure selection and outbound effects', async (_name, start, end) => {
  await expect(run(start, end)).rejects.toThrow('utilts_e73_delivery_period_invalid')
  expect(effects.route).toHaveBeenCalledTimes(1)
  expect(effects.structure).not.toHaveBeenCalled()
  expectNoRequestEffects()
})

it.each([
  ['one market calendar day', '2026-07-01', '2026-07-02', '202607010000202607020000'],
  ['one Swedish spring-transition day', '2026-03-29T00:00:00+01:00', '2026-03-30T00:00:00+02:00', '202603290000202603292300'],
  ['one Swedish autumn-transition day', '2026-10-25T00:00:00+02:00', '2026-10-26T00:00:00+01:00', '202610242300202610260000'],
])('preserves %s in the real wire and existing queue workflow', async (_name, start, end, period719) => {
  await expect(run(start, end)).resolves.toHaveProperty('id', 'message-1')
  const payload = effects.finalize.mock.calls[0][0].draft.rawPayload
  expect(payload).toContain('DTM+324:' + period719 + ':719')
  expect(payload).toContain('DTM+735:?+0100:406')
  expect(preflightEdielPayload({ rawPayload: payload, messageStandard: 'edifact', mode: 'send' }).issues).toEqual([])
  expect(effects.structure).toHaveBeenCalledWith(expect.objectContaining({ periodStart: start, periodEnd: end }))
  expect(effects.makeOutbound).toHaveBeenCalledTimes(1)
  expect(effects.queue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ externalReference: 'E73-SYNTHETIC-DOC' }))
  expect(effects.status).toHaveBeenCalledTimes(1)
})

it('preserves the legal-source denial ahead of a malformed period', async () => {
  state.legalCompany = 'other-company'
  await expect(run('2026-07-01', '2026-07-01')).rejects.toThrow('utilts_data_request_legal_source_scope_required')
  expect(effects.structure).not.toHaveBeenCalled()
  expectNoRequestEffects()
})

function storedMonthlyRequest(month: string) {
  const {start, end, timeZone} = stockholmMonthBounds(month)
  return {
    id: 'request-1', company_id: 'tenant-1', customer_id: 'customer', site_id: 'site',
    metering_point_id: 'meter', grid_owner_id: 'owner', request_scope: 'meter_values',
    automation_origin: 'metering_market_data_autopilot_v1',
    automation_key: 'meter-values:tenant-1:meter:' + month,
    // The RPC casts the top-level fields to DATE and retains the two original
    // UTC instants in the request's JSON object.
    requested_period_start: start.slice(0, 10),
    requested_period_end: end.slice(0, 10),
    request_payload: {
      billing_month: month,
      time_zone: timeZone,
      requested_period_start: start,
      requested_period_end: end,
    },
  }
}

it.each([
  ['2028-02', '202802010000202803010000'],
  ['2028-03', '202803010000202803312300'],
  ['2028-04', '202803312300202804302300'],
  ['2028-07', '202806302300202807312300'],
])('renders the exact stored Swedish month %s in the qualified E73', async (month, expected719) => {
  const request = storedMonthlyRequest(month)
  state.storedRequest = request
  await expect(run(null, null)).resolves.toHaveProperty('id', 'message-1')
  const input = effects.finalize.mock.calls[0][0]
  const raw = input.draft.rawPayload
  expect(raw).toContain('DTM+735:?+0100:406')
  const match = raw.match(/DTM\+324:(\d{12})(\d{12}):719/)
  expect(match?.[0]).toBe('DTM+324:' + expected719 + ':719')
  const periodStart = request.request_payload.requested_period_start
  const periodEnd = request.request_payload.requested_period_end
  expect(prodatMarketMinuteToUtc(match?.[1])).toBe(periodStart)
  expect(prodatMarketMinuteToUtc(match?.[2])).toBe(periodEnd)
  expect(effects.structure).toHaveBeenCalledWith(expect.objectContaining({
    periodStart, periodEnd,
  }))
  expect(input).toMatchObject({ duplicateCheck: {
    sourceId: request.id, periodStart: request.requested_period_start, periodEnd: request.requested_period_end,
  } })
  expect(preflightEdielPayload({ rawPayload: raw, messageStandard: 'edifact', mode: 'send' }).issues).toEqual([])
  expect(effects.makeOutbound).toHaveBeenCalledTimes(1)
  expect(effects.queue).toHaveBeenCalledTimes(1)
})

it.each([
  ['another scope key', { automation_key: 'meter-values:other:meter:2028-07' }, {}],
  ['a non-metering request scope', { request_scope: 'billing_underlay' }, { requestedMessageCode: 'E66' }],
  ['a different stored day', { requested_period_start: '2028-07-01' }, {}],
  ['an incomplete period', {}, { requested_period_end: null }],
  ['a mismatched billing month', {}, { billing_month: '2028-06' }],
  ['an invalid billing month', {}, { billing_month: '2028-13' }],
  ['a different calendar zone', {}, { time_zone: 'UTC' }],
  ['an adjusted instant', {}, { requested_period_start: '2028-06-30T23:00:00.000Z' }],
] as const)('holds the monthly request before side effects if it has %s', async (_label, columns, payload) => {
  const row = storedMonthlyRequest('2028-07')
  state.storedRequest = { ...row, ...columns, request_payload: { ...row.request_payload, ...payload } }
  await expect(run(null, null)).rejects.toThrow('utilts_e73_monthly_period_source_mismatch')
  expect(effects.structure).not.toHaveBeenCalled()
  expectNoRequestEffects()
})

it.each([
  ['E66', '23-DDQ-E66-T'],
  ['S02', '23-DDQ-S02-S'],
])('retains explicit manual E73 dates for %s with an unrelated billing month', async (requestedMessageCode, applicationReference) => {
  const row = storedMonthlyRequest('2028-07')
  state.applicationReference = applicationReference
  state.storedRequest = { ...row, automation_origin: null, automation_key: null,
    request_payload: { ...row.request_payload, requestedMessageCode },
    requested_period_start: '2028-07-01', requested_period_end: '2028-07-02' }
  await expect(run(null, null)).resolves.toHaveProperty('id', 'message-1')
  const raw = effects.finalize.mock.calls[0][0].draft.rawPayload
  expect(raw).toContain('DTM+324:202807010000202807020000:719')
  expect(raw).toContain('RFF+' + requestedMessageCode + "'")
})


it('leaves a conflicting earlier original and request status with the canonical owner', async () => {
  state.storedRequest = storedMonthlyRequest('2028-03')
  effects.finalize.mockRejectedValueOnce(new Error('canonical_outbound_existing_operation_wire_conflict'))
  await expect(run(null, null)).rejects.toThrow('canonical_outbound_existing_operation_wire_conflict')
  expect(effects.finalize).toHaveBeenCalledTimes(1)
  for (const effect of [effects.link, effects.queue, effects.status, effects.event]) {
    expect(effect).not.toHaveBeenCalled()
  }
})
