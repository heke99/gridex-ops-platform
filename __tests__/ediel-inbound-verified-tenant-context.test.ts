import { beforeEach, expect, it, vi } from 'vitest'
import { extractMarketActorEdielIdFromRawPayload, resolveInboundTenantFromIdentifiers } from '@/lib/ediel/tenant/resolveInboundTenant'

const io = vi.hoisted(() => ({ rows: {} as Record<string, Array<Record<string, unknown>>>, identity: vi.fn(), countUnavailable: false }))
vi.mock('@/lib/ediel/tenant/tenantEdielIdentity', () => ({ resolveCanonicalTenantEdielIdentityWithEvidence: io.identity }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from(table: string) {
  const filters: Array<[string, unknown]> = []
  const rows = () => (io.rows[table] ?? []).filter(row => filters.every(([key, value]) => row[key] === value))
  const result = () => ({ data: rows(), error: null, count: io.countUnavailable ? null : rows().length })
  const chain = { select: () => chain, eq: (key: string, value: unknown) => { filters.push([key, value]); return chain }, limit: () => chain,
    abortSignal: () => chain, maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve) }
  return chain
} } }))
const input = { environment: 'production', receiverEdielId: '54321', marketActorEdielId: '54321', messageFamily: 'PRODAT', messageCode: 'Z04' }
const identity = (companyId: string) => ({ companyId, environment: 'production', legalActorId: `${companyId}-legal`, legalEdielId: '54321', transportActorId: `${companyId}-legal`, transportEdielId: '54321', roleCodes: ['electricity_supplier'], representedByTransportAgent: false, transportRelationId: null })
beforeEach(() => {
  io.rows = { tenant_actor_identifiers: [{ company_id: 'tenant-b', environment: 'production', identifier_type: 'EdielId', identifier_value: '54321', valid_from: '2000-01-01', valid_to: null }] }
  io.countUnavailable = false
  io.identity.mockReset(); io.identity.mockImplementation(async ({ companyId }) => ({ identity: identity(companyId), evidence: { completeness: 'exact_count' } }))
})
it('derives the tenant from current legal identity and actual transport, not company metadata', async () => {
  const result = await resolveInboundTenantFromIdentifiers(input)
  expect(result).toMatchObject({ status: 'resolved', companyId: 'tenant-b', source: 'verified_legal_identity' })
  expect(io.identity).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'tenant-b', requireExactCounts: true }))
})
it('holds an incorrectly persisted company instead of applying business validation in that tenant', async () => {
  expect(await resolveInboundTenantFromIdentifiers({ ...input, existingCompanyId: 'tenant-a' })).toMatchObject({ status: 'ambiguous', companyId: null })
})
it('a stronger transport-route hint cannot replace a different verified legal actor', async () => {
  io.rows.communication_routes = [{ id: 'route', company_id: 'tenant-a' }]
  expect(await resolveInboundTenantFromIdentifiers({ ...input, communicationRouteId: 'route' })).toMatchObject({ status: 'resolved', companyId: 'tenant-b' })
})
it('holds multiple tenants sharing one legal actor without a uniquely qualified original', async () => {
  io.rows.tenant_actor_identifiers.push({ ...io.rows.tenant_actor_identifiers[0], company_id: 'tenant-a' })
  expect(await resolveInboundTenantFromIdentifiers(input)).toMatchObject({ status: 'ambiguous', companyId: null })
})
it('holds stale local identity and unsupported local roles without fabricating sender object errors', async () => {
  io.identity.mockRejectedValue(new Error('local_profile_missing'))
  expect(await resolveInboundTenantFromIdentifiers(input)).toMatchObject({ status: 'unresolved', companyId: null })
  io.identity.mockResolvedValue({ identity: { ...identity('tenant-b'), roleCodes: ['energy_service_company'] }, evidence: {} })
  expect(await resolveInboundTenantFromIdentifiers(input)).toMatchObject({ status: 'unresolved', companyId: null })
})
it('requires explicit transport representation while preserving the separate legal recipient', async () => {
  expect(await resolveInboundTenantFromIdentifiers({ ...input, receiverEdielId: '99999' })).toMatchObject({ status: 'unresolved' })
  io.identity.mockResolvedValue({ identity: { ...identity('tenant-b'), transportEdielId: '99999', transportActorId: 'agent', representedByTransportAgent: true, transportRelationId: 'mandate' }, evidence: {} })
  expect(await resolveInboundTenantFromIdentifiers({ ...input, receiverEdielId: '99999' })).toMatchObject({ status: 'resolved', companyId: 'tenant-b' })
})
it('missing or truncated candidate evidence cannot create a default tenant', async () => {
  io.countUnavailable = true
  expect(await resolveInboundTenantFromIdentifiers({ ...input, existingCompanyId: 'tenant-a' })).toMatchObject({ status: 'unresolved', companyId: null })
  expect(io.identity).not.toHaveBeenCalled()
})
it('reads source recipient roles using actual UNA and never falls back to sender MS or customer UD', () => {
  expect(extractMarketActorEdielIdFromRawPayload("UNH+1+UTILTS:D:04A:UN:E5SE5A'NAD+MS+11111::9'NAD+UD+22222::9'" )).toBeNull()
  expect(extractMarketActorEdielIdFromRawPayload("UNA;*.! ~UNH*1*PRODAT;D;97A;UN;E2SE6A~NAD*DO*54321;;9~")).toBe('54321')
  expect(extractMarketActorEdielIdFromRawPayload("UNH+1+UTILTS:D:04A:UN:E5SE5A'NAD+MR+54321::9'NAD+MR+22222::9'" )).toBeNull()
})
