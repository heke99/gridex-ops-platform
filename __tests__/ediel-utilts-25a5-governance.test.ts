import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))
import { resolveAuthoritativeEdielGuide, resolveEdielGuideAcceptance } from '@/lib/ediel/rulebook/guideRegistry'
import { resolveCanonicalEdielPolicy, resolveCanonicalInheritedAckPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { resolveCanonicalRulePack } from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import { CANONICAL_UTILTS_ERR_REASON_GUIDE_SCOPES, canonicalUtiltsErrReasonsForPolicy } from '@/lib/ediel/rulebook/ackGuidePolicy'
import { UTILTS_25_A_3_POLICY, UTILTS_25_A_4_POLICY } from '@/lib/ediel/rulebook/utilts25A4'

// Independent oracle: Swedish original, Document/3364, cover p1 and history p6.
const primaryHash = 'b76a61b9aa6f136771e5db4948296d1b632b8d775314eb6c93783595ae419db2'
const priorHash = '0524c18f38864ebe081dec9d3d53f1797b224ef0af7b01986627e895f47d99be'
const policy = (family = 'UTILTS', date = '2026-10-20') => resolveCanonicalEdielPolicy({
  family, messageCode: family === 'UTILTS' ? 'E66' : family === 'UTILTS_ERR' ? 'ERR' : 'APERAK',
  direction: 'inbound', referenceDate: date, associationAssignedCode: 'E5SE5A', applicationReference: '23-DDQ-E66-T',
})

function row(sources: Record<string, unknown>[]) {
  const id = '11111111-1111-4111-8111-111111111111', profileId = '22222222-2222-4222-8222-222222222222'
  const profile = { family: 'UTILTS', messageCode: 'E66', guideVersion: '25-A-5', guideRevision: '5' }
  return { rule_pack_id: id, message_profile_id: profileId, market: 'electricity', family: 'UTILTS',
    guide_version: '25-A-5', guide_revision: '5', unh_association_code: 'E5SE5A', valid_from: '2026-10-01', valid_to: null,
    source_document: 'synthetic reviewed U5 activation', source_hash: 'a'.repeat(64), field_matrix_version: '25-A-5',
    profile_key: 'synthetic:E66:U5', business_process: 'metering_values', phase: null, profile,
    parser_ready: true, builder_ready: true, validator_ready: true, ack_ready: true, state_machine_ready: true,
    original_version: '25-A-5:r5', original_snapshot: {
      rulePack: { id, source_hash: 'a'.repeat(64), guide_version: '25-A-5', guide_revision: '5' },
      messageProfile: { id: profileId, rule_pack_id: id, profile_key: 'synthetic:E66:U5', profile },
      guideSources: sources.map(source => ({ rule_pack_id: id, ...source })),
    } }
}
const source = () => ({ source_type: 'technical_guide', revision: '25-A-5', source_hash: primaryHash,
  source_locator: 'https://www.ediel.se/Portal/Document/3364', valid_from: '2026-10-01', valid_to: null })
const lookup = () => resolveCanonicalRulePack({ family: 'UTILTS', messageCode: 'E66', direction: 'inbound',
  businessDate: '2026-10-20', applicationReference: '23-DDQ-E66-T', requireBuilder: false })

beforeEach(() => io.rpc.mockReset())
describe('current Swedish UTILTS revision5 source governance, synthetic registry boundary', () => {
  it.each(['UTILTS', 'APERAK'] as const)('selects Swedish U5 for %s from its actual cover date', family => {
    expect(resolveAuthoritativeEdielGuide({ family, referenceDate: '2026-09-30', associationAssignedCode: 'E5SE5A' }).guideRevision).toBe('25-A-3')
    const guide = resolveAuthoritativeEdielGuide({ family, referenceDate: '2026-10-01', associationAssignedCode: 'E5SE5A' })
    expect(guide).toMatchObject({ guideRevision: '25-A-5', effectiveFrom: '2026-10-01',
      primarySource: { language: 'sv', sha256: primaryHash, pages: 135 } })
  })
  it('uses one U5 edition for the profile, processability and national ERR reasons', () => {
    const current = policy()
    expect(current).toMatchObject({ guide: { guideRevision: '25-A-5' }, utiltsProfile: { guideVersion: '25-A-5', guideRevision: '5' },
      utiltsProcessability: { guideRevision: '25-A-5', compareMeterReadingsToEnergyVolumes: false,
        structuralComparisonSource: { sha256: primaryHash } } })
    const reasons = CANONICAL_UTILTS_ERR_REASON_GUIDE_SCOPES.find(scope => scope.guideVersion === '25-A-5')
    expect(reasons?.source.sha256).toBe(primaryHash)
    expect(canonicalUtiltsErrReasonsForPolicy(policy('UTILTS_ERR'))).not.toContain('E19')
  })
  it('retains the actual preceding U3 grace without admitting superseded U4 as a new send', () => {
    expect(resolveEdielGuideAcceptance({ family: 'UTILTS', referenceDate: '2026-10-14', associationAssignedCode: 'E5SE5A' })
      .acceptedInbound.map(guide => guide.guideRevision)).toEqual(['25-A-5', '25-A-3'])
    expect(resolveEdielGuideAcceptance({ family: 'UTILTS', referenceDate: '2026-10-15', associationAssignedCode: 'E5SE5A' })
      .acceptedInbound.map(guide => guide.guideRevision)).toEqual(['25-A-5'])
    expect(() => resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E73', direction: 'outbound',
      referenceDate: '2026-10-20', selectedGuideRevision: '25-A-4', applicationReference: '23-DDQ-E66-T' }))
      .toThrow('canonical_ediel_guide_candidate_not_accepted')
  })
  it.each(['APERAK', 'UTILTS_ERR'])('preserves a protected U4 original in a later %s without relabeling', family => {
    const inherited = resolveCanonicalInheritedAckPolicy({ policy: policy(family), originalFamily: 'UTILTS',
      originalCode: 'E66', guideVersion: '25-A-4', guideRevision: '4', originalVersion: 'protected-original-U4' })
    expect(inherited.guide.guideRevision).toBe('25-A-4')
    expect(inherited.referenceDate).toBe('2026-10-20')
    if (family === 'UTILTS_ERR') expect(inherited).toMatchObject({ utiltsProfile: { guideVersion: '25-A-4' },
      utiltsProcessability: { guideRevision: '25-A-4', structuralComparisonSource: { sha256: priorHash } } })
    expect(UTILTS_25_A_4_POLICY.structuralComparisonSource.sha256).toBe(priorHash)
    expect(UTILTS_25_A_3_POLICY.removedRejectionReasonCodes).toEqual([])
  })
  it('keeps named activation identity distinct from the primary original hash', async () => {
    io.rpc.mockResolvedValue({ data: [row([source()])], error: null })
    const result = await lookup()
    expect(result.guideVersion).toBe('25-A-5')
    expect(result.sourceHash).toBe('a'.repeat(64))
    expect(result.originalSnapshot.guideSources[0].source_hash).toBe(primaryHash)
  })
  it('does not admit a named U4 activation as U5 despite the shared E5SE5A', async () => {
    const legacy = row([source()])
    legacy.guide_version = legacy.original_snapshot.rulePack.guide_version = legacy.profile.guideVersion = '25-A-4'
    legacy.guide_revision = legacy.original_snapshot.rulePack.guide_revision = legacy.profile.guideRevision = '4'
    legacy.original_version = '25-A-4:r4'
    io.rpc.mockResolvedValue({ data: [legacy], error: null })
    await expect(lookup()).rejects.toThrow('canonical_rule_pack_evidence_guide_mismatch')
  })
  it.each(['missing', 'old hash', 'example only'])('holds U5 with %s primary-source witness', async defect => {
    const sources = defect === 'missing' ? [] : [{ ...source(), ...(defect === 'old hash'
      ? { source_hash: priorHash } : { source_type: 'example' }) }]
    io.rpc.mockResolvedValue({ data: [row(sources)], error: null })
    await expect(lookup()).rejects.toThrow('canonical_rule_pack_evidence_primary_source_mismatch')
  })
})
