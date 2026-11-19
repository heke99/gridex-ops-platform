import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { prepareAndQueueUtiltsE73 } from '@/lib/ediel/flows/utiltsSupplierRequest'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight'

const probe = vi.hoisted(() => {
  const state = { start: '' as string | null, end: '' as string | null, legalCompany: 'tenant-1' }
  const effects = {
    governance: vi.fn(async () => {}),
    request: vi.fn(async () => ({
      id: 'request-1', company_id: 'tenant-1', customer_id: 'customer', site_id: 'site',
      metering_point_id: 'meter', grid_owner_id: 'owner', request_scope: 'meter_values',
      requested_period_start: state.start, requested_period_end: state.end, request_payload: {},
    })),
    route: vi.fn(async () => ({
      route: { id: 'route-1' }, companyId: 'tenant-1', environment: 'test',
      actor: { legalActorEdielId: '33333', tenantIdentity: { companyId: state.legalCompany, environment: 'test', legalEdielId: '33333' } },
      senderEdielId: '11111', receiverEdielId: '22222', applicationReference: '23-DDQ-E66-T',
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
