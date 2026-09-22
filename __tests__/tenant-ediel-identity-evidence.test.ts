import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, calls: [] as string[], advanceClock: false }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  io.calls.push(table)
  if (io.advanceClock) vi.setSystemTime(new Date('2026-09-23T00:00:00Z'))
  const query = { select: () => query, eq: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve({data: io.rows[table] ?? [], error: null}).then(resolve) }
  return query
} } }))
import { resolveCanonicalTenantEdielIdentity, resolveCanonicalTenantEdielIdentityWithEvidence } from '@/lib/ediel/tenant/tenantEdielIdentity'
const input = { companyId: 'company-a', environment: 'production' as const, asOf: '2026-09-22T12:00:00.123456Z' }
const scope = { company_id: input.companyId, environment: input.environment, valid_from: '2026-09-22T12:00:00.123455Z', valid_to: null }
beforeEach(() => {
  io.calls = []
  io.advanceClock = false
  io.rows = {
    tenant_ediel_profiles: [{ ...scope, id: 'profile', market: 'electricity', is_enabled: true }],
    tenant_actor_identifiers: [{ ...scope, id: 'identifier', actor_id: 'actor', identifier_type: 'EdielId', identifier_value: '12345', qualifier: null, subaddress: null }],
    tenant_actor_roles: [{ ...scope, id: 'role', actor_id: 'actor', role_code: 'electricity_supplier' }],
    tenant_counterparty_relations: [], platform_actor_identifiers: [],
  }
})
afterEach(() => vi.useRealTimers())
describe('actual tenant identity temporal evidence', () => {
  it('returns exact scoped inputs and limits its authority', async () => {
    const result = await resolveCanonicalTenantEdielIdentityWithEvidence(input)
    expect(result.identity.legalEdielId).toBe('12345')
    expect(result.evidence.evaluatedAt).toBe(input.asOf)
    expect(result.evidence.historicalKnowledge).toBe('not_established')
    expect(result.evidence.sourceDisposition).toBe('not_established')
    expect(result.evidence.records.identifiers).toEqual(io.rows.tenant_actor_identifiers)
    io.rows.tenant_actor_identifiers[0].identifier_value = 'mutated'
    expect(result.evidence.records.identifiers[0].identifier_value).toBe('12345')
  })
  it.each(['2026-02-30T00:00:00Z', '2026-09-22', 'garbage', '2026-09-22T12:00:00.1234567Z'])('rejects invalid instant %s before reads', async asOf => {
    await expect(resolveCanonicalTenantEdielIdentityWithEvidence({...input, asOf})).rejects.toThrow('tenant_ediel_evaluation_instant_invalid')
    expect(io.calls).toEqual([])
  })
  it('honors inclusive start and exclusive end at microsecond precision', async () => {
    io.rows.tenant_ediel_profiles[0].valid_from = input.asOf
    expect((await resolveCanonicalTenantEdielIdentityWithEvidence(input)).identity.companyId).toBe(input.companyId)
    io.rows.tenant_ediel_profiles[0].valid_to = input.asOf
    await expect(resolveCanonicalTenantEdielIdentityWithEvidence(input)).rejects.toThrow('profile_not_enabled')
  })
  it('rejects future roles and ambiguous actor identities', async () => {
    io.rows.tenant_actor_roles[0].valid_from = '2026-09-22T12:00:00.123457Z'
    await expect(resolveCanonicalTenantEdielIdentityWithEvidence(input)).rejects.toThrow('roles_missing')
    io.rows.tenant_actor_roles[0].valid_from = scope.valid_from
    io.rows.tenant_actor_identifiers.push({...io.rows.tenant_actor_identifiers[0], id: 'second', actor_id: 'other'})
    await expect(resolveCanonicalTenantEdielIdentityWithEvidence(input)).rejects.toThrow('identity_not_unique')
  })
  it.each(['company_id', 'environment', 'actor_id'])('rejects hostile role response %s', async field => {
    io.rows.tenant_actor_roles[0][field] = 'wrong'
    await expect(resolveCanonicalTenantEdielIdentityWithEvidence(input)).rejects.toThrow('evidence_scope_invalid')
  })
  it('records explicit delegation and dated platform identity without asserting verification', async () => {
    io.rows.tenant_counterparty_relations = [{...scope,id:'relation',counterparty_actor_id:'agent',relation_type:'ediel_transport_agent',is_enabled:true}]
    io.rows.platform_actor_identifiers = [{id:'transport-id',actor_id:'agent',identifier_type:'EdielId',identifier_value:'99999',is_verified:false,valid_from:'2026-09-22',valid_to:'2026-09-23'}]
    const result = await resolveCanonicalTenantEdielIdentityWithEvidence(input)
    expect(result.identity.transportRelationId).toBe('relation')
    expect(result.evidence.records.transportIdentifiers[0].is_verified).toBe(false)
    io.rows.platform_actor_identifiers[0].valid_to = '2026-09-22'
    await expect(resolveCanonicalTenantEdielIdentityWithEvidence(input)).rejects.toThrow('identity_not_unique')
  })
  it('rejects ambiguous delegation while retaining legitimate multiple roles', async () => {
    io.rows.tenant_actor_roles.push({...scope,id:'esco-role',actor_id:'actor',role_code:'energy_service_company'})
    expect((await resolveCanonicalTenantEdielIdentityWithEvidence(input)).identity.roleCodes).toHaveLength(2)
    const relation = {...scope,id:'relation',counterparty_actor_id:'agent',relation_type:'ediel_transport_agent',is_enabled:true}
    io.rows.tenant_counterparty_relations = [relation,{...relation,id:'other'}]
    await expect(resolveCanonicalTenantEdielIdentityWithEvidence(input)).rejects.toThrow('transport_agent_ambiguous')
  })
  it('uses the same default instant across reads even if the clock advances', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-22T12:00:00.124Z'))
    io.advanceClock = true
    io.rows.tenant_actor_roles[0].valid_to = '2026-09-22T12:00:00.125Z'
    const result = await resolveCanonicalTenantEdielIdentityWithEvidence({companyId:input.companyId,environment:input.environment})
    expect(result.evidence.evaluatedAt).toBe('2026-09-22T12:00:00.124Z')
    expect(result.identity.roleCodes).toEqual(['electricity_supplier'])
  })
  it.each(['tenant_ediel_profiles','tenant_actor_identifiers','tenant_actor_roles'])('fails closed on malformed validity in %s', async table => {
    io.rows[table][0].valid_from = '2026-02-30T00:00:00Z'
    await expect(resolveCanonicalTenantEdielIdentityWithEvidence(input)).rejects.toThrow()
  })
  it('does not turn a malformed delegation interval into direct representation', async () => {
    io.rows.tenant_counterparty_relations = [{...scope,id:'relation',counterparty_actor_id:'agent',relation_type:'ediel_transport_agent',is_enabled:true,valid_from:'not-a-date'}]
    await expect(resolveCanonicalTenantEdielIdentityWithEvidence(input)).rejects.toThrow('evidence_validity_invalid')
  })
  it('rejects a platform identifier from another actor', async () => {
    io.rows.tenant_counterparty_relations = [{...scope,id:'relation',counterparty_actor_id:'agent',relation_type:'ediel_transport_agent',is_enabled:true}]
    io.rows.platform_actor_identifiers = [{id:'transport-id',actor_id:'foreign',identifier_type:'EdielId',identifier_value:'99999',valid_from:null,valid_to:null}]
    await expect(resolveCanonicalTenantEdielIdentityWithEvidence(input)).rejects.toThrow('evidence_scope_invalid')
  })
  it('supports explicit as-of without expanding the plain identity result', async () => {
    const result = await resolveCanonicalTenantEdielIdentity(input)
    expect(result.legalEdielId).toBe('12345')
    expect(result).not.toHaveProperty('evidence')
  })
  it('preserves plain return shape and legacy platform identifier behavior', async () => {
    for (const rows of Object.values(io.rows)) for (const row of rows) row.valid_from = '2020-01-01T00:00:00Z'
    io.rows.tenant_counterparty_relations = [{...scope, valid_from:'2020-01-01T00:00:00Z',id:'relation',counterparty_actor_id:'agent',relation_type:'ediel_transport_agent',is_enabled:true}]
    io.rows.platform_actor_identifiers = [{identifier_value:'99999',valid_to:'2020-01-01'}]
    const identity = await resolveCanonicalTenantEdielIdentity({companyId: input.companyId,environment:input.environment})
    expect(identity.transportEdielId).toBe('99999')
    expect(identity).not.toHaveProperty('evidence')
  })
})

it.each([false, true])('rejects every contradictory profile independent of row order (%s)', async reverse => {
  io.rows.tenant_ediel_profiles.push({...io.rows.tenant_ediel_profiles[0], id:'reversed', valid_from:'2026-09-23T00:00:00Z',valid_to:'2026-09-21T00:00:00Z'})
  if (reverse) io.rows.tenant_ediel_profiles.reverse()
  await expect(resolveCanonicalTenantEdielIdentityWithEvidence(input)).rejects.toThrow('tenant_ediel_evidence_validity_invalid')
  await expect(resolveCanonicalTenantEdielIdentity(input)).rejects.toThrow('tenant_ediel_evidence_validity_invalid')
})
