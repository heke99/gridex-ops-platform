// Physical source-only selection with a declared catalog control. Public SDK
// resolver and actual native capture are verified separately; no coverage tag.
import { beforeEach, expect, it, vi } from 'vitest'
import { resolveCancellationBirthProfile } from '@/lib/inbound-mail/cancellationBirthProfile'
import { raw, line, characteristic, type Parts } from './fixtures/prodat-register'

const catalog = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry', () => ({ resolveCanonicalRulePack: catalog }))
const receivedAt = '2026-10-07T22:30:00.000Z'
const checksum = 'a'.repeat(64)
const object = (sequence = '1', identity = '735999000000001', reason = 'Z24', register?: string): Parts[] => [
  line(sequence, identity, register, '9'), ...characteristic('Z13', reason), ['RFF', ['LI', 'OWN-' + sequence]],
]
const evidence = (code: string) => ({ rulePackId: 'declared-pack', messageProfileId: 'declared-profile',
  databaseProfileKey: `PRODAT:${code}:C:26.A:r3`, originalVersion: '26.A:r3', sourceHash: checksum,
  unhAssociationCode: 'E2SE6A', originalSnapshot: { rulePack: { id: 'declared-pack' },
    messageProfile: { id: 'declared-profile', code, reason: 'Z24' }, guideSources: [{ source_hash: checksum }] } })
const select = (payload: string, messageCode = 'Z04', clock = receivedAt) => resolveCancellationBirthProfile({ rawPayload: payload, messageCode, receivedAt: clock })
beforeEach(() => { catalog.mockReset(); catalog.mockImplementation(async ({ messageCode }: { messageCode: string }) => evidence(messageCode)) })

it.each(['Z04', 'Z05'])('selects the own %s/Z24 physical profile with complete original witness and retained Stockholm date', async code => {
  const original = evidence(code)
  expect(await select(raw(object(), code), code)).toEqual({ canonical_rule_pack_id: original.rulePackId,
    rule_profile_key: original.databaseProfileKey, rule_profile_version_id: original.messageProfileId,
    rule_profile_version: original.originalVersion, rule_pack_checksum: checksum,
    rule_pack_snapshot: { ...original.originalSnapshot, profileKey: original.databaseProfileKey,
      profileVersionId: original.messageProfileId, version: original.originalVersion, checksum } })
  expect(catalog).toHaveBeenCalledExactlyOnceWith({ family: 'PRODAT', messageCode: code, transactionSubtype: 'Z24',
    applicationReference: '23-DDQ-PRODAT', direction: 'inbound', businessDate: '2026-10-08' })
})
it.each(['Z04', 'Z05'])('qualifies each homogeneous %s object independently', async code => {
  expect(await select(raw([...object(), ...object('2', '735999000000002')], code), code)).not.toBeNull()
  expect(catalog).toHaveBeenCalledTimes(1)
})
it('preserves lawful Z04 first-register common reason inheritance', async () => {
  const payload = raw([...object('1', undefined, 'Z24', '1'), line('2', '735999000000001', '2', '9')])
  expect(await select(payload)).not.toBeNull()
  expect(catalog).toHaveBeenCalledTimes(1)
})
it.each([
  [':', '+', '?', "'"], ['*', ';', '!', '~'], ['^', '|', '!', '%'],
])('uses actual UNA %j and released own identity without resplitting', async (...alphabet) => {
  expect(await select(raw(object('1', 'OWN+ID:WITH?RELEASE'), 'Z04', alphabet))).not.toBeNull()
})
const refusals: [string, () => string][] = [
  ['no object', () => raw([])],
  ['missing own reason', () => raw([line('1', '735999000000001', undefined, '9')])],
  ['empty reason', () => raw(object('1', undefined, ''))],
  ['internal alias', () => raw(object('1', undefined, 'C'))],
  ['H reason', () => raw(object('1', undefined, 'Z25'))],
  ['L reason', () => raw(object('1', undefined, 'Z22'))],
  ['mixed siblings', () => raw([...object(), ...object('2', '735999000000002', 'Z25')])],
  ['sibling missing own reason', () => raw([...object(), line('2', '735999000000002', undefined, '9')])],
  ['duplicate own reason', () => raw([...object(), ...characteristic('Z13', 'Z24')])],
  ['header borrowing', () => raw([...characteristic('Z13', 'Z24'), line('1', '735999000000001', undefined, '9')])],
  ['extra header qualifier', () => raw([...characteristic('Z13', 'Z24'), ...object()])],
  ['nonadjacent CAV', () => raw([line('1', '735999000000001', undefined, '9'), ['CCI', '', 'Z13'], ['RFF', ['LI', 'OWN']], ['CAV', 'Z24']])],
  ['late reason', () => raw([line('1', '735999000000001', undefined, '9'), ['RFF', ['LI', 'OWN']], ...characteristic('Z13', 'Z24')])],
  ['later-register borrowing', () => raw([line('1', '735999000000001', '1', '9'), ...object('2', undefined, 'Z24', '2')])],
  ['extra later-register reason', () => raw([...object('1', undefined, 'Z24', '1'), ...object('2', undefined, 'Z24', '2')])],
  ['register chain skips index', () => raw([...object('1', undefined, 'Z24', '1'), line('2', '735999000000001', '3', '9')])],
  ['unqualified repeated object', () => raw([...object(), ...object('2')])],
  ['missing identity', () => raw(object('1', ''))],
  ['wrong agency', () => raw(object().map(part => part[0] === 'LIN' ? line('1', '735999000000001', undefined, 'ZZZ') : part))],
  ['identity in wrong component', () => raw(object()).replace('735999000000001:::9', '735999000000001:WRONG::9')],
  ['trailing identity component', () => raw(object()).replace('735999000000001:::9', '735999000000001:::9:EXTRA')],
  ['missing sequence', () => raw(object(''))],
  ['wrong global sequence', () => raw(object('2'))],
  ['duplicate BGM', () => raw([['BGM', 'Z04', 'OTHER', '9', 'AB'], ...object()])],
  ['BGM outside own message', () => raw(object()).replace("BGM+Z04+D+9+AB'", '').replace('UNZ+', "BGM+Z04+D+9+AB'UNZ+")],
  ['multiple messages', () => raw(object()).replace('UNZ+', "UNH+OTHER+PRODAT:D:97A:UN:E2SE6A'BGM+Z04+OTHER+9+AB'UNT+3+OTHER'UNZ+")],
  ['duplicate UNB', () => raw(object()).replace('UNH+', "UNB+UNOC:3+S+R+260917:1200+I++23-DDQ-PRODAT'UNH+")],
  ['missing UNT', () => raw(object()).replace(/UNT[^']*'/, '')],
  ['duplicate UNZ', () => raw(object()) + "UNZ+1+I'"],
  ['wrong family', () => raw(object()).replace('PRODAT:D', 'UTILTS:D')],
  ['wrong application', () => raw(object()).replace('23-DDQ-PRODAT', '23-DGI-PRODAT')],
  ['wrong association', () => raw(object()).replace('E2SE6A', 'E2SE5A')],
]
it.each(refusals)('refuses %s before catalog lookup', async (_name, make) => {
  expect(await select(make())).toBeNull(); expect(catalog).not.toHaveBeenCalled()
})
it.each(['PRODAT:X:97A:UN:E2SE6A', 'PRODAT:D:1:UN:E2SE6A', 'PRODAT:D:97A:ZZ:E2SE6A', 'PRODAT:D:97A:UN:E2SE6A:EXTRA'])('refuses the complete foreign physical UNH token %s before lookup', async token => {
  expect(await select(raw(object()).replace('PRODAT:D:97A:UN:E2SE6A', token))).toBeNull()
  expect(catalog).not.toHaveBeenCalled()
})
it.each([['Z04', 'Z05'], ['Z05', 'Z04'], ['Z04', 'Z01']])('rejects physical %s with caller %s', async (physical, caller) => {
  expect(await select(raw(object(), physical), caller)).toBeNull(); expect(catalog).not.toHaveBeenCalled()
})
it('rejects Z05 same-object register repetition even with indexed registers', async () => {
  expect(await select(raw([...object('1', undefined, 'Z24', '1'), line('2', '735999000000001', '2', '9')], 'Z05'), 'Z05')).toBeNull()
  expect(catalog).not.toHaveBeenCalled()
})
it('rejects invalid retained clock before catalog lookup', async () => {
  await expect(select(raw(object()), 'Z04', 'invalid')).rejects.toThrow('cancellation_birth_receipt_clock_invalid')
  expect(catalog).not.toHaveBeenCalled()
})
it('propagates catalog refusal without a fallback witness', async () => {
  catalog.mockRejectedValue(Error('canonical_rule_pack_evidence_count:0'))
  await expect(select(raw(object()))).rejects.toThrow('canonical_rule_pack_evidence_count:0')
})
it.each(['association', 'database-key'])('rejects inconsistent catalog %s without invented evidence', async change => {
  catalog.mockResolvedValue({ ...evidence('Z04'), ...(change === 'association' ? { unhAssociationCode: 'E2SE5A' } : { databaseProfileKey: undefined }) })
  await expect(select(raw(object()))).rejects.toThrow(change === 'association' ? 'cancellation_birth_association_mismatch' : 'cancellation_birth_database_profile_key_missing')
})
