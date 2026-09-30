import { beforeEach, expect, it, vi } from 'vitest'
import { assertScopedEdielProductionCapability, getScopedEdielProductionReadiness, recordScopedEdielProductionEvidence } from '@/lib/ediel/scopedCapabilityReadiness'
import { assertCompanyCanSendProductionEdiel, runProductionDryRun } from '@/lib/ediel/productionReadiness.part-3'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { AI_LIST_SOURCE_PROFILE } from '@/lib/ediel/aiListFormat'

const io = vi.hoisted(() => ({ rpc: vi.fn(), identity: vi.fn(), tenant: vi.fn(), readiness: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc, from: io.from } }))
vi.mock('@/lib/ediel/tenant/tenantEdielIdentity', () => ({ resolveCanonicalTenantEdielIdentity: io.identity }))
vi.mock('@/lib/tenant/operationPolicy', () => ({ requireTenantOperationAllowed: io.tenant }))
vi.mock('@/lib/ediel/productionReadiness.part-2', () => ({ getCompanyProductionReadiness: io.readiness }))

const company = 'c1c11111-1111-1111-1111-111111111111'
const actor = 'a1a11111-1111-1111-1111-111111111111'
const hash = 'a'.repeat(64)
function message(): EdielMessageRow {
  return { id: 'm', company_id: company, environment: 'production', direction: 'outbound', message_family: 'PRODAT', message_code: 'Z01',
    rule_pack_checksum: hash, parsed_payload: {}, raw_payload: "UNB+UNOC:3+54321:14+91101:14+260930:1200+I++23-DDQ-PRODAT'UNH+1+PRODAT:D:97A:UN:E2SE6A'BGM+Z01+OWN+9'CCI++Z13'CAV+Z22'UNT+5+1'UNZ+1+I'" } as EdielMessageRow
}
function result() {
  return { authorityVersion: 1, scope: { companyId: company, actorId: actor, actorRole: 'electricity_supplier', market: 'electricity', environment: 'production', family: 'PRODAT', code: 'Z01', subtype: 'L', assignmentId: null },
    dependencyHash: hash, dependencies: { releaseSha: 'f'.repeat(40) }, ready: true, evidenceId: 'proof', expiresAt: '2099-01-01T00:00:00Z' }
}
beforeEach(() => {
  io.rpc.mockReset(); io.identity.mockReset(); io.tenant.mockReset()
  io.identity.mockResolvedValue({ companyId: company, legalActorId: actor, legalEdielId: '54321', transportEdielId: '54321', roleCodes: ['electricity_supplier'] })
  io.rpc.mockResolvedValue({ data: result(), error: null }); io.tenant.mockResolvedValue({ allowed: true })
  io.readiness.mockResolvedValue({ blockingIssues: [], warnings: [], summary: { productionStatus: 'live', edielId: null }, latestCheck: { id: 'aggregate' } })
  const chain = { select: () => chain, eq: () => chain, single: async () => ({ data: { configuration_snapshot_id: 'snapshot', configuration_hash: hash }, error: null }), insert: async () => ({ error: null }) }
  io.from.mockReturnValue(chain)
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'f'.repeat(40))
})

it('uses actual saved message, legal identity, canonical capability and deployed release for scoped authority', async () => {
  await expect(assertScopedEdielProductionCapability(message())).resolves.toBeUndefined()
  expect(io.rpc).toHaveBeenCalledWith('ediel_scoped_capability_readiness_v1', expect.objectContaining({ p_company_id: company, p_legal_actor_id: actor, p_actor_role: 'electricity_supplier', p_family: 'PRODAT', p_code: 'Z01', p_subtype: 'L', p_release_sha: 'f'.repeat(40), p_rulepack_hash: hash }))
})
it('an old aggregate/global ready flag never authorizes missing scoped evidence', async () => {
  io.rpc.mockResolvedValue({ data: { ...result(), ready: false, evidenceId: null }, error: null })
  await expect(assertCompanyCanSendProductionEdiel({ companyId: company, message: message() })).rejects.toThrow('ediel_scoped_capability_evidence_required')
})
it.each(['CONTRL', 'APERAK', 'UTILTS_ERR'])('preserves incoming prescribed %s responses when business evidence is stale', async family => {
  const ack = { ...message(), message_family: family, related_message_id: 'source' } as EdielMessageRow
  await expect(assertCompanyCanSendProductionEdiel({ companyId: company, message: ack })).resolves.toBeUndefined()
  expect(io.rpc).not.toHaveBeenCalled(); expect(io.identity).not.toHaveBeenCalled(); expect(io.tenant).not.toHaveBeenCalled()
})
it('retains explicit tenant lifecycle policy for production business traffic', async () => {
  io.tenant.mockRejectedValue(new Error('tenant_operation_blocked'))
  await expect(assertCompanyCanSendProductionEdiel({ companyId: company, message: message() })).rejects.toThrow('tenant_operation_blocked')
  expect(io.rpc).not.toHaveBeenCalled()
})

it('keeps a generic company dry-run explicitly blocked without actual message-scope evidence', async () => {
  const dryRun = await runProductionDryRun(company, 'operator')
  expect(dryRun.success).toBe(false); expect(dryRun.status).toBe('blocked')
  expect(dryRun.previewMetadata).toMatchObject({ capabilityScopeReady: false, capabilityEvidenceId: null, wouldBeBlocked: true, wouldSend: false })
  expect(dryRun.blockingIssues.map(issue => issue.code)).toContain('capability_scope_evidence_required')
  expect(io.rpc).not.toHaveBeenCalled()
})

it('projects a dry-run against the actual scoped immutable capability evidence', async () => {
  const dryRun = await runProductionDryRun(company, 'operator', message())
  expect(dryRun.success).toBe(true)
  expect(dryRun.previewMetadata).toMatchObject({ capabilityScopeReady: true, capabilityEvidenceId: 'proof', capabilityDependencyHash: hash, messageId: 'm', wouldSend: false })
})
it('rejects cross-tenant scoped projections even if ready is true', async () => {
  io.rpc.mockResolvedValue({ data: { ...result(), scope: { ...result().scope, companyId: 'foreign' } }, error: null })
  await expect(assertScopedEdielProductionCapability(message())).rejects.toThrow('ediel_scoped_capability_evidence_required')
})
it('rejects mismatched physical wire rather than choosing another local rule scope', async () => {
  const altered = { ...message(), raw_payload: message().raw_payload!.replace('BGM+Z01+', 'BGM+Z03+') }
  await expect(assertScopedEdielProductionCapability(altered)).rejects.toThrow('ediel_scoped_capability_evidence_required')
  expect(io.rpc).not.toHaveBeenCalled(); expect(io.identity).not.toHaveBeenCalled()
})
it('requires genuine deployed release provenance without a synthetic fallback', async () => {
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', ''); vi.stubEnv('GIT_COMMIT_SHA', '')
  await expect(assertScopedEdielProductionCapability(message())).rejects.toThrow('ediel_release_sha_unavailable')
  expect(io.rpc).not.toHaveBeenCalled()
})
it.each(['invalid', '2000-01-01T00:00:00Z'])('holds malformed or expired scoped evidence %s', async expiry => {
  io.rpc.mockResolvedValue({ data: { ...result(), expiresAt: expiry }, error: null })
  await expect(assertScopedEdielProductionCapability(message())).rejects.toThrow('ediel_scoped_capability_evidence_required')
})
it('fails closed on RPC failure without exposing raw tenant/source data', async () => {
  io.rpc.mockResolvedValue({ data: null, error: { message: 'private failure data' } })
  await expect(getScopedEdielProductionReadiness(message())).rejects.toThrow(/^ediel_scoped_capability_evidence_required$/)
})
it('explicit evidence publication supplies references/hash/expiry, never an approved client flag', async () => {
  io.rpc.mockResolvedValue({ data: 'new-proof', error: null })
  expect(await recordScopedEdielProductionEvidence({ message: message(), expectedDependencyHash: hash, certificationEvidenceIds: ['approved-source'], expiresAt: '2099-01-01T00:00:00Z' })).toBe('new-proof')
  expect(io.rpc).toHaveBeenCalledWith('ediel_record_scoped_capability_evidence_v1', expect.objectContaining({ p_expected_dependency_hash: hash, p_certification_evidence_ids: ['approved-source'] }))
  expect(io.rpc.mock.calls[0][1]).not.toHaveProperty('approved')
})

it('uses the shared actual AI CSV source profile and legal supplier scope without an EDIFACT envelope', async () => {
  const columns = ['AAA', '735999260731000007', '9', '', '', '', '', 'Adress', '12345', 'Ort', '33333', '', '', '', '', '', '', '199901010001', 'Kundnamn', '20260901', '20261001', '']
  const ai = { ...message(), message_family: 'AI_LIST', message_code: 'AI', message_standard: 'ai_list', sender_ediel_id: '54321', receiver_ediel_id: '91101', file_name: 'ai.csv', mime_type: 'text/csv', rule_pack_checksum: null,
    raw_payload: `AI;91101;Nätägare;54321;Leverantör;202609301200;;20260901;20261002;Ver20140401\n${columns.join(';')}\n` } as EdielMessageRow
  io.rpc.mockResolvedValue({ data: { ...result(), scope: { ...result().scope, family: 'AI_LIST', code: 'AI', subtype: null } }, error: null })
  await expect(assertScopedEdielProductionCapability(ai)).resolves.toBeUndefined()
  expect(io.rpc).toHaveBeenCalledWith('ediel_scoped_capability_readiness_v1', expect.objectContaining({ p_family: 'AI_LIST', p_code: 'AI', p_rulepack_hash: AI_LIST_SOURCE_PROFILE.sourceSha256 }))
  io.rpc.mockClear()
  await expect(assertScopedEdielProductionCapability({ ...ai, raw_payload: ai.raw_payload!.replace('AI;', 'BI;') })).rejects.toThrow()
  expect(io.rpc).not.toHaveBeenCalled()
})
