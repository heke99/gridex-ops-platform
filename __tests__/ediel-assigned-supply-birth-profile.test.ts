// Catalog port is declared; physical EDIFACT scope and receipt clock are real.
// Durable admission/effects are qualified separately by the native suite.
import { beforeEach, expect, it, vi } from 'vitest'
import { guideOrderedFixtureRaw } from './helpers/prodatGuideOrderedFixture'
import { characteristic, line, type Parts } from './fixtures/prodat-register'
import { resolveAssignedSupplyBirthProfile } from '@/lib/inbound-mail/assignedSupplyBirthProfile'

const catalog = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry', () => ({ resolveCanonicalRulePack: catalog }))
const evidence = {
  rulePackId: 'actual-pack', messageProfileId: 'actual-profile', sourceHash: 'a'.repeat(64),
  originalVersion: '26.A:r3', databaseProfileKey: 'PRODAT:Z04:A:26.A:r3',
  profileKey: 'semantic-alias-must-not-be-stored', unhAssociationCode: 'E2SE6A',
  originalSnapshot: { rulePack: { id: 'actual-pack' }, messageProfile: { id: 'actual-profile' }, guideSources: [{ source: 'original' }] },
}
const receipt = '2026-10-06T22:30:00Z'
function wire(reasons: string[] = ['Z26']) {
  const body: Parts[] = reasons.flatMap((reason, i) => [line(String(i + 1), `73599900000000${i}`, undefined, '9'),
    ...characteristic('Z13', reason), ['RFF', ['LI', `OWN-${i}`]] as Parts])
  return guideOrderedFixtureRaw(body, 'Z04')
}
beforeEach(() => { catalog.mockReset(); catalog.mockResolvedValue(evidence) })

it('binds the original catalog witness for every own assigned object at the actual Swedish receipt date', async () => {
  const result = await resolveAssignedSupplyBirthProfile({ rawPayload: wire(['Z26', 'Z26']), receivedAt: receipt })
  expect(catalog).toHaveBeenCalledExactlyOnceWith({ family: 'PRODAT', messageCode: 'Z04', transactionSubtype: 'Z26',
    applicationReference: '23-DDQ-PRODAT', direction: 'inbound', businessDate: '2026-10-07' })
  expect(result).toEqual({ canonical_rule_pack_id: evidence.rulePackId, rule_profile_key: evidence.databaseProfileKey,
    rule_profile_version_id: evidence.messageProfileId, rule_profile_version: evidence.originalVersion,
    rule_pack_checksum: evidence.sourceHash, rule_pack_snapshot: { ...evidence.originalSnapshot,
      profileKey: evidence.databaseProfileKey, profileVersionId: evidence.messageProfileId,
      version: evidence.originalVersion, checksum: evidence.sourceHash } })
})

it('binds the distinct production catalog witness for every homogeneous Z70 object', async () => {
  const production = { ...evidence, rulePackId: 'production-pack', messageProfileId: 'production-profile',
    databaseProfileKey: 'PRODAT:Z04:D:26.A:r3', originalSnapshot: { messageProfile: { id: 'production-profile' } } }
  catalog.mockResolvedValue(production)
  const result = await resolveAssignedSupplyBirthProfile({ rawPayload: wire(['Z70', 'Z70']), receivedAt: receipt })
  expect(catalog).toHaveBeenCalledExactlyOnceWith({ family: 'PRODAT', messageCode: 'Z04', transactionSubtype: 'Z70',
    applicationReference: '23-DDQ-PRODAT', direction: 'inbound', businessDate: '2026-10-07' })
  expect(result).toEqual({ canonical_rule_pack_id: production.rulePackId, rule_profile_key: production.databaseProfileKey,
    rule_profile_version_id: production.messageProfileId, rule_profile_version: production.originalVersion,
    rule_pack_checksum: production.sourceHash, rule_pack_snapshot: { ...production.originalSnapshot,
      profileKey: production.databaseProfileKey, profileVersionId: production.messageProfileId,
      version: production.originalVersion, checksum: production.sourceHash } })
})

it.each([
  ['mixed own reasons', () => wire(['Z26', 'Z03'])],
  ['mixed assigned and production reasons', () => wire(['Z26', 'Z70'])],
  ['mixed production and assigned reasons', () => wire(['Z70', 'Z26'])],
  ['other Z04 subtype', () => wire(['Z03'])],
  ['duplicate production reason', () => wire(['Z70']).replace("CAV+Z70'", "CAV+Z70'CCI++Z13'CAV+Z70'")],
  ['missing own reason', () => wire().replace("CCI++Z13'CAV+Z26'", '')],
  ['duplicate own reason', () => wire().replace("CAV+Z26'", "CAV+Z26'CCI++Z13'CAV+Z26'")],
  ['header reason without an own LIN', () => wire().replace(/LIN[^']*'/, '')],
  ['two messages', () => wire().replace(/UNZ[^']*'/, wire().slice(wire().indexOf('UNH')))],
  ['another message code', () => wire().replace('BGM+Z04', 'BGM+Z06')],
  ['missing actual application reference', () => wire().replace('+23-DDQ-PRODAT', '')],
] as const)('does not supply an assigned or production pin for %s', async (_name, original) => {
  expect(await resolveAssignedSupplyBirthProfile({ rawPayload: original(), receivedAt: receipt })).toBeNull()
  expect(catalog).not.toHaveBeenCalled()
})

it.each(['Z70', 'Z26'])('refuses a later-register physical reason %s instead of borrowing the first register', async reason => {
  const original = guideOrderedFixtureRaw([line('1', '735999000000001', '1', '9'), ...characteristic('Z13', 'Z26'),
    ['RFF', ['LI', 'OWN']], line('2', '735999000000001', '2', '9'), ...characteristic('Z13', reason)], 'Z04')
  expect(await resolveAssignedSupplyBirthProfile({ rawPayload: original, receivedAt: receipt })).toBeNull()
  expect(catalog).not.toHaveBeenCalled()
})

it('keeps released separator data from becoming an extra physical reason', async () => {
  const original = wire().replace('OWN-0', 'OWN?+CCI?+?+Z13?\'CAV?+Z70')
  expect(await resolveAssignedSupplyBirthProfile({ rawPayload: original, receivedAt: receipt })).not.toBeNull()
  expect(catalog).toHaveBeenCalledTimes(1)
})

it('refuses an association mismatch rather than binding a different guide', async () => {
  catalog.mockResolvedValue({ ...evidence, unhAssociationCode: 'E2SE5A' })
  await expect(resolveAssignedSupplyBirthProfile({ rawPayload: wire(), receivedAt: receipt }))
    .rejects.toThrow('assigned_supply_birth_association_mismatch')
})

it('propagates absent or ambiguous catalog evidence without inventing a pin', async () => {
  catalog.mockRejectedValue(Error('canonical_rule_pack_evidence_count:0'))
  await expect(resolveAssignedSupplyBirthProfile({ rawPayload: wire(), receivedAt: receipt })).rejects.toThrow('evidence_count:0')
})

it('does not substitute now for an invalid actual receipt clock', async () => {
  await expect(resolveAssignedSupplyBirthProfile({ rawPayload: wire(), receivedAt: 'invalid' })).rejects.toThrow('receipt_clock')
  expect(catalog).not.toHaveBeenCalled()
})

it.each([['header empty',"CCI++Z13'CAV+'",true],['header missing',"CCI++Z13'",true],['later empty',"CCI++Z13'CAV+'",false],['later missing',"CCI++Z13'",false],["header lowercase empty","CCI++z13'CAV+'",true],["header lowercase missing","CCI++z13'",true],["header padded empty","CCI++ Z13 'CAV+'",true],["header padded missing","CCI++ Z13 '",true],["later lowercase empty","CCI++z13'CAV+'",false],["later lowercase missing","CCI++z13'",false],["later padded empty","CCI++ Z13 'CAV+'",false],["later padded missing","CCI++ Z13 '",false]] as const)('refuses extra physical reason qualifier with %s CAV',async(_name,extra,header)=>{
 const base=header?wire():guideOrderedFixtureRaw([line('1','735999000000001','1','9'),...characteristic('Z13','Z26'),['RFF',['LI','OWN']],line('2','735999000000001','2','9')],'Z04'),raw=header?base.replace('LIN+1',extra+'LIN+1'):base.replace(/UNT[^']*'/,extra+base.match(/UNT[^']*'/)![0])
 expect(await resolveAssignedSupplyBirthProfile({rawPayload:raw,receivedAt:receipt})).toBeNull();expect(catalog).not.toHaveBeenCalled()
})
