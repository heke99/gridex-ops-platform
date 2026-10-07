// Component-only prospective catalog binding. The catalog is a declared port;
// parsing, physical scopes, reason validation and receipt-date conversion are real.
// No original admission, business effect or whole native contract is claimed.
import { beforeEach, expect, it, vi } from 'vitest'
import { guideOrderedFixtureRaw } from './helpers/prodatGuideOrderedFixture'
import { characteristic, line, raw, type Parts } from './fixtures/prodat-register'
import { resolveInformationReplyBirthProfile } from '@/lib/inbound-mail/informationReplyBirthProfile'

const catalog = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry', () => ({ resolveCanonicalRulePack: catalog }))
const receipt = '2026-10-06T22:30:00Z'
const evidence = {
  rulePackId: 'information-reply-pack', messageProfileId: 'information-reply-profile', sourceHash: 'a'.repeat(64),
  originalVersion: '26.A:r3', databaseProfileKey: 'PRODAT:Z02:L:26.A:r3',
  profileKey: 'semantic-alias-must-not-be-stored', unhAssociationCode: 'E2SE6A',
  originalSnapshot: { rulePack: { id: 'information-reply-pack' }, messageProfile: { id: 'information-reply-profile' }, guideSources: [{ source: 'original' }] },
}
function object(reason: string, index = 0): Parts[] {
  return [line(String(index + 1), ['735999000000000013', '735999000000000020'][index], undefined, '9'),
    ...characteristic('Z13', reason), ['RFF', ['LI', `OWN-${index}`]]]
}
function wire(reasons: string[] = ['Z22']): string {
  return guideOrderedFixtureRaw(reasons.flatMap((reason, i) => object(reason, i)), 'Z02')
}
beforeEach(() => { catalog.mockReset(); catalog.mockResolvedValue(evidence) })

it.each([
  ['Z22', 'PRODAT:Z02:L:26.A:r3'], ['Z23', 'PRODAT:Z02:LK:26.A:r3'],
] as const)('binds only the original six-field catalog witness for homogeneous %s objects', async (reason, key) => {
  const selected = { ...evidence, databaseProfileKey: key }
  catalog.mockResolvedValue(selected)
  const result = await resolveInformationReplyBirthProfile({ rawPayload: wire([reason, reason]), receivedAt: receipt })
  expect(result).toEqual({
    canonical_rule_pack_id: 'information-reply-pack', rule_profile_key: key,
    rule_profile_version_id: 'information-reply-profile', rule_profile_version: '26.A:r3',
    rule_pack_checksum: 'a'.repeat(64), rule_pack_snapshot: {
      rulePack: { id: 'information-reply-pack' }, messageProfile: { id: 'information-reply-profile' }, guideSources: [{ source: 'original' }],
      profileKey: key, profileVersionId: 'information-reply-profile', version: '26.A:r3', checksum: 'a'.repeat(64),
    },
  })
  expect(catalog).toHaveBeenCalledExactlyOnceWith({ family: 'PRODAT', messageCode: 'Z02', transactionSubtype: reason,
    applicationReference: '23-DDQ-PRODAT', direction: 'inbound', businessDate: '2026-10-07' })
})

const refusedPayloads: readonly (readonly [string, () => string | null | undefined])[] = [
  ['mixed L/LK', (): string => wire(['Z22', 'Z23'])],
  ['mixed LK/L', () => wire(['Z23', 'Z22'])],
  ['assigned supply reason', () => wire(['Z26'])],
  ['production reason', () => wire(['Z70'])],
  ['mixed normal/assigned', () => wire(['Z22', 'Z26'])],
  ['missing own reason', () => guideOrderedFixtureRaw([line('1', '735999000000001', undefined, '9'), ['RFF', ['LI', 'OWN']]], 'Z02')],
  ['empty own reason', () => wire([''])],
  ['missing adjacent CAV', () => guideOrderedFixtureRaw([line('1', '735999000000001', undefined, '9'), ['CCI', '', 'Z13'], ['RFF', ['LI', 'OWN']]], 'Z02')],
  ['duplicate own reason', () => guideOrderedFixtureRaw([line('1', '735999000000001', undefined, '9'), ...characteristic('Z13', 'Z22'), ...characteristic('Z13', 'Z22'), ['RFF', ['LI', 'OWN']]], 'Z02')],
  ['header reason without own LIN', () => guideOrderedFixtureRaw([...characteristic('Z13', 'Z22'), ['RFF', ['LI', 'OWN']]], 'Z02')],
  ['foreign message code Z01', () => guideOrderedFixtureRaw(object('Z22'), 'Z01')],
  ['foreign message code Z04', () => guideOrderedFixtureRaw(object('Z22'), 'Z04')],
  ['foreign message code Z06', () => guideOrderedFixtureRaw(object('Z22'), 'Z06')],
  ['foreign message family', () => wire().replace('PRODAT:D:97A', 'UTILTS:D:97A')],
  ['missing application reference', () => wire().replace('+23-DDQ-PRODAT', '')],
  ['null payload', (): null => null],
  ['undefined payload', (): undefined => undefined],
  ['empty payload', () => ''],
]
it.each(refusedPayloads)('does not supply an information-reply pin for %s', async (_name, payload) => {
  expect(await resolveInformationReplyBirthProfile({ rawPayload: payload(), receivedAt: receipt })).toBeNull()
  expect(catalog).not.toHaveBeenCalled()
})

it.each(['Z22', 'Z23'])('refuses physical %s in a later register instead of borrowing the first register', async reason => {
  const payload = guideOrderedFixtureRaw([line('1', '735999000000001', '1', '9'), ...characteristic('Z13', 'Z22'),
    ['RFF', ['LI', 'OWN']], line('2', '735999000000001', '2', '9'), ...characteristic('Z13', reason)], 'Z02')
  expect(await resolveInformationReplyBirthProfile({ rawPayload: payload, receivedAt: receipt })).toBeNull()
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
  const payload = guideOrderedFixtureRaw(body, 'Z02')
  expect(await resolveInformationReplyBirthProfile({ rawPayload: payload, receivedAt: receipt })).toBeNull()
  expect(catalog).not.toHaveBeenCalled()
})

it('refuses a reason after the own parent reference', async () => {
  const payload = raw([line('1', '735999000000001', undefined, '9'), ['RFF', ['LI', 'OWN']], ...characteristic('Z13', 'Z22')], 'Z02')
  expect(await resolveInformationReplyBirthProfile({ rawPayload: payload, receivedAt: receipt })).toBeNull()
  expect(catalog).not.toHaveBeenCalled()
})

it('refuses two physical UNH messages instead of pinning the first', async () => {
  const payload = guideOrderedFixtureRaw([['UNH', 'SECOND', ['PRODAT', 'D', '97A', 'UN', 'E2SE6A']], ...object('Z22')], 'Z02')
  expect(await resolveInformationReplyBirthProfile({ rawPayload: payload, receivedAt: receipt })).toBeNull()
  expect(catalog).not.toHaveBeenCalled()
})

it('keeps released separators in the own reference from becoming another reason', async () => {
  const payload = guideOrderedFixtureRaw([line('1', '735999000000001', undefined, '9'), ...characteristic('Z13', 'Z22'),
    ['RFF', ['LI', "OWN+CCI++Z13'CAV+Z23"]]], 'Z02')
  expect(await resolveInformationReplyBirthProfile({ rawPayload: payload, receivedAt: receipt })).not.toBeNull()
  expect(catalog).toHaveBeenCalledTimes(1)
})

it('does not replace an invalid actual receipt clock with now', async () => {
  await expect(resolveInformationReplyBirthProfile({ rawPayload: wire(), receivedAt: 'invalid' }))
    .rejects.toThrow('information_reply_birth_receipt_clock_invalid')
  expect(catalog).not.toHaveBeenCalled()
})
it('refuses an association mismatch', async () => {
  catalog.mockResolvedValue({ ...evidence, unhAssociationCode: 'E2SE5A' })
  await expect(resolveInformationReplyBirthProfile({ rawPayload: wire(), receivedAt: receipt }))
    .rejects.toThrow('information_reply_birth_association_mismatch')
})
it('refuses a physical UNH association from another guide', async () => {
  const rawPayload = wire().replace('PRODAT:D:97A:UN:E2SE6A', 'PRODAT:D:97A:UN:E2SE5A')
  await expect(resolveInformationReplyBirthProfile({ rawPayload, receivedAt: receipt }))
    .rejects.toThrow('information_reply_birth_association_mismatch')
})
it('does not replace a missing database profile key with the semantic alias', async () => {
  catalog.mockResolvedValue({ ...evidence, databaseProfileKey: undefined })
  await expect(resolveInformationReplyBirthProfile({ rawPayload: wire(), receivedAt: receipt }))
    .rejects.toThrow('information_reply_birth_database_profile_key_missing')
})
it.each([0, 2])('propagates catalog evidence count %s without inventing a witness', async count => {
  catalog.mockRejectedValue(Error(`canonical_rule_pack_evidence_count:${count}`))
  await expect(resolveInformationReplyBirthProfile({ rawPayload: wire(), receivedAt: receipt }))
    .rejects.toThrow(`canonical_rule_pack_evidence_count:${count}`)
})

it.each(['Z22', 'Z23'])('refuses an unsupported Z02 repeated-register chain with own homogeneous %s reasons', async reason => {
  const payload = guideOrderedFixtureRaw([line('1', '735999000000001', '1', '9'), ...characteristic('Z13', reason),
    ['RFF', ['LI', 'OWN']], line('2', '735999000000001', '2', '9'), ...characteristic('Z13', reason), ['RFF', ['LI', 'OWN']]], 'Z02')
  expect(await resolveInformationReplyBirthProfile({ rawPayload: payload, receivedAt: receipt })).toBeNull()
  expect(catalog).not.toHaveBeenCalled()
})

it('refuses repeated own Z02 identity without C829 instead of treating it as distinct objects', async () => {
  const payload = guideOrderedFixtureRaw([line('1', '735999000000000013', undefined, '9'), ...characteristic('Z13', 'Z22'),
    ['RFF', ['LI', 'OWN']], line('2', '735999000000000013', undefined, '9'), ...characteristic('Z13', 'Z22'), ['RFF', ['LI', 'OWN']]], 'Z02')
  expect(await resolveInformationReplyBirthProfile({ rawPayload: payload, receivedAt: receipt })).toBeNull()
  expect(catalog).not.toHaveBeenCalled()
})

it('does not borrow the first object reason for another distinct object', async () => {
  const payload = guideOrderedFixtureRaw([...object('Z22'), line('2', '735999000000000020', undefined, '9'), ['RFF', ['LI', 'OTHER']]], 'Z02')
  expect(await resolveInformationReplyBirthProfile({ rawPayload: payload, receivedAt: receipt })).toBeNull()
  expect(catalog).not.toHaveBeenCalled()
})

it('refuses duplicate reasons on one object even when another has none', async () => {
  const payload = guideOrderedFixtureRaw([...object('Z22'), ...characteristic('Z13', 'Z22'),
    line('2', '735999000000000020', undefined, '9'), ['RFF', ['LI', 'OTHER']]], 'Z02')
  expect(await resolveInformationReplyBirthProfile({ rawPayload: payload, receivedAt: receipt })).toBeNull()
  expect(catalog).not.toHaveBeenCalled()
})

it('refuses a Z02 register indicator on a single object', async () => {
  const payload = guideOrderedFixtureRaw([line('1', '735999000000001', '1', '9'), ...characteristic('Z13', 'Z22'), ['RFF', ['LI', 'OWN']]], 'Z02')
  expect(await resolveInformationReplyBirthProfile({ rawPayload: payload, receivedAt: receipt })).toBeNull()
  expect(catalog).not.toHaveBeenCalled()
})

it.each([
  ['winter before Swedish midnight', '2026-12-06T22:59:59Z', '2026-12-06'],
  ['winter at Swedish midnight', '2026-12-06T23:00:00Z', '2026-12-07'],
  ['summer before Swedish midnight', '2026-06-06T21:59:59Z', '2026-06-06'],
  ['summer at Swedish midnight', '2026-06-06T22:00:00Z', '2026-06-07'],
] as const)('selects the catalog using the actual receipt date: %s', async (_name, receivedAt, businessDate) => {
  expect(await resolveInformationReplyBirthProfile({ rawPayload: wire(), receivedAt })).not.toBeNull()
  expect(catalog).toHaveBeenCalledExactlyOnceWith({ family: 'PRODAT', messageCode: 'Z02', transactionSubtype: 'Z22',
    applicationReference: '23-DDQ-PRODAT', direction: 'inbound', businessDate })
})

it('propagates an unavailable catalog instead of converting failure into a fabricated pin', async () => {
  const unavailable = Error('catalog_unavailable')
  catalog.mockRejectedValue(unavailable)
  await expect(resolveInformationReplyBirthProfile({ rawPayload: wire(), receivedAt: receipt })).rejects.toBe(unavailable)
})
