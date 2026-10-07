// Component-only prospective catalog binding. The catalog is a declared port;
// parsing, physical scopes, reason validation and receipt-date conversion are real.
// No original admission, business effect or whole native contract is claimed.
import { beforeEach, expect, it, vi } from 'vitest'
import { guideOrderedFixtureRaw } from './helpers/prodatGuideOrderedFixture'
import { characteristic, line, raw, type Parts } from './fixtures/prodat-register'
import { resolveNormalSwitchBirthProfile } from '@/lib/inbound-mail/normalSwitchBirthProfile'

const catalog = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry', () => ({ resolveCanonicalRulePack: catalog }))
const receipt = '2026-10-06T22:30:00Z'
const evidence = {
  rulePackId: 'normal-pack', messageProfileId: 'normal-profile', sourceHash: 'a'.repeat(64),
  originalVersion: '26.A:r3', databaseProfileKey: 'PRODAT:Z04:L:26.A:r3',
  profileKey: 'semantic-alias-must-not-be-stored', unhAssociationCode: 'E2SE6A',
  originalSnapshot: { rulePack: { id: 'normal-pack' }, messageProfile: { id: 'normal-profile' }, guideSources: [{ source: 'original' }] },
}
function object(reason: string, index = 0): Parts[] {
  return [line(String(index + 1), `73599900000000${index}`, undefined, '9'),
    ...characteristic('Z13', reason), ['RFF', ['LI', `OWN-${index}`]]]
}
function wire(reasons: string[] = ['Z22']) {
  return guideOrderedFixtureRaw(reasons.flatMap((reason, i) => object(reason, i)), 'Z04')
}
beforeEach(() => { catalog.mockReset(); catalog.mockResolvedValue(evidence) })

it.each([
  ['Z22', 'PRODAT:Z04:L:26.A:r3'], ['Z23', 'PRODAT:Z04:LK:26.A:r3'],
] as const)('binds only the original six-field catalog witness for homogeneous %s objects', async (reason, key) => {
  const selected = { ...evidence, databaseProfileKey: key }
  catalog.mockResolvedValue(selected)
  const result = await resolveNormalSwitchBirthProfile({ rawPayload: wire([reason, reason]), receivedAt: receipt })
  expect(result).toEqual({
    canonical_rule_pack_id: 'normal-pack', rule_profile_key: key,
    rule_profile_version_id: 'normal-profile', rule_profile_version: '26.A:r3',
    rule_pack_checksum: 'a'.repeat(64), rule_pack_snapshot: {
      rulePack: { id: 'normal-pack' }, messageProfile: { id: 'normal-profile' }, guideSources: [{ source: 'original' }],
      profileKey: key, profileVersionId: 'normal-profile', version: '26.A:r3', checksum: 'a'.repeat(64),
    },
  })
  expect(catalog).toHaveBeenCalledExactlyOnceWith({ family: 'PRODAT', messageCode: 'Z04', transactionSubtype: reason,
    applicationReference: '23-DDQ-PRODAT', direction: 'inbound', businessDate: '2026-10-07' })
})

it.each([
  ['mixed L/LK', (): string => wire(['Z22', 'Z23'])],
  ['mixed LK/L', () => wire(['Z23', 'Z22'])],
  ['assigned supply reason', () => wire(['Z26'])],
  ['production reason', () => wire(['Z70'])],
  ['mixed normal/assigned', () => wire(['Z22', 'Z26'])],
  ['missing own reason', () => guideOrderedFixtureRaw([line('1', '735999000000001', undefined, '9'), ['RFF', ['LI', 'OWN']]], 'Z04')],
  ['empty own reason', () => wire([''])],
  ['missing adjacent CAV', () => guideOrderedFixtureRaw([line('1', '735999000000001', undefined, '9'), ['CCI', '', 'Z13'], ['RFF', ['LI', 'OWN']]], 'Z04')],
  ['duplicate own reason', () => guideOrderedFixtureRaw([line('1', '735999000000001', undefined, '9'), ...characteristic('Z13', 'Z22'), ...characteristic('Z13', 'Z22'), ['RFF', ['LI', 'OWN']]], 'Z04')],
  ['header reason without own LIN', () => guideOrderedFixtureRaw([...characteristic('Z13', 'Z22'), ['RFF', ['LI', 'OWN']]], 'Z04')],
  ['foreign message code', () => guideOrderedFixtureRaw(object('Z22'), 'Z06')],
  ['foreign message family', () => wire().replace('PRODAT:D:97A', 'UTILTS:D:97A')],
  ['missing application reference', () => wire().replace('+23-DDQ-PRODAT', '')],
  ['null payload', (): null => null],
  ['undefined payload', (): undefined => undefined],
] as const)('does not supply a normal-switch pin for %s', async (_name, payload) => {
  expect(await resolveNormalSwitchBirthProfile({ rawPayload: payload(), receivedAt: receipt })).toBeNull()
  expect(catalog).not.toHaveBeenCalled()
})

it.each(['Z22', 'Z23'])('refuses physical %s in a later register instead of borrowing the first register', async reason => {
  const payload = guideOrderedFixtureRaw([line('1', '735999000000001', '1', '9'), ...characteristic('Z13', 'Z22'),
    ['RFF', ['LI', 'OWN']], line('2', '735999000000001', '2', '9'), ...characteristic('Z13', reason)], 'Z04')
  expect(await resolveNormalSwitchBirthProfile({ rawPayload: payload, receivedAt: receipt })).toBeNull()
  expect(catalog).not.toHaveBeenCalled()
})

it.each([
  ['header empty', 'Z13', true, true], ['header missing', 'Z13', true, false],
  ['header lowercase', 'z13', true, true], ['header padded', ' Z13 ', true, false],
  ['later empty', 'Z13', false, true], ['later missing', 'Z13', false, false],
  ['later lowercase', 'z13', false, true], ['later padded', ' Z13 ', false, false],
] as const)('refuses an extra physical qualifier with %s value', async (_name, qualifier, header, withCav) => {
  const extra: Parts[] = withCav ? characteristic(qualifier, '') : [['CCI', '', qualifier]]
  const body = header ? [...extra, ...object('Z22')]
    : [line('1', '735999000000001', '1', '9'), ...characteristic('Z13', 'Z22'), ['RFF', ['LI', 'OWN']] as Parts,
      line('2', '735999000000001', '2', '9'), ...extra]
  const payload = guideOrderedFixtureRaw(body, 'Z04')
  expect(await resolveNormalSwitchBirthProfile({ rawPayload: payload, receivedAt: receipt })).toBeNull()
  expect(catalog).not.toHaveBeenCalled()
})

it('refuses a reason after the own parent reference', async () => {
  const payload = raw([line('1', '735999000000001', undefined, '9'), ['RFF', ['LI', 'OWN']], ...characteristic('Z13', 'Z22')], 'Z04')
  expect(await resolveNormalSwitchBirthProfile({ rawPayload: payload, receivedAt: receipt })).toBeNull()
  expect(catalog).not.toHaveBeenCalled()
})

it('refuses two physical UNH messages instead of pinning the first', async () => {
  const payload = guideOrderedFixtureRaw([['UNH', 'SECOND', ['PRODAT', 'D', '97A', 'UN', 'E2SE6A']], ...object('Z22')], 'Z04')
  expect(await resolveNormalSwitchBirthProfile({ rawPayload: payload, receivedAt: receipt })).toBeNull()
  expect(catalog).not.toHaveBeenCalled()
})

it('keeps released separators in the own reference from becoming another reason', async () => {
  const payload = guideOrderedFixtureRaw([line('1', '735999000000001', undefined, '9'), ...characteristic('Z13', 'Z22'),
    ['RFF', ['LI', "OWN+CCI++Z13'CAV+Z23"]]], 'Z04')
  expect(await resolveNormalSwitchBirthProfile({ rawPayload: payload, receivedAt: receipt })).not.toBeNull()
  expect(catalog).toHaveBeenCalledTimes(1)
})

it('does not replace an invalid actual receipt clock with now', async () => {
  await expect(resolveNormalSwitchBirthProfile({ rawPayload: wire(), receivedAt: 'invalid' }))
    .rejects.toThrow('normal_switch_birth_receipt_clock_invalid')
  expect(catalog).not.toHaveBeenCalled()
})
it('refuses an association mismatch', async () => {
  catalog.mockResolvedValue({ ...evidence, unhAssociationCode: 'E2SE5A' })
  await expect(resolveNormalSwitchBirthProfile({ rawPayload: wire(), receivedAt: receipt }))
    .rejects.toThrow('normal_switch_birth_association_mismatch')
})
it('does not replace a missing database profile key with the semantic alias', async () => {
  catalog.mockResolvedValue({ ...evidence, databaseProfileKey: undefined })
  await expect(resolveNormalSwitchBirthProfile({ rawPayload: wire(), receivedAt: receipt }))
    .rejects.toThrow('normal_switch_birth_database_profile_key_missing')
})
it.each([0, 2])('propagates catalog evidence count %s without inventing a witness', async count => {
  catalog.mockRejectedValue(Error(`canonical_rule_pack_evidence_count:${count}`))
  await expect(resolveNormalSwitchBirthProfile({ rawPayload: wire(), receivedAt: receipt }))
    .rejects.toThrow(`canonical_rule_pack_evidence_count:${count}`)
})
