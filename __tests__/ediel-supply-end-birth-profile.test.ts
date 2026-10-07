import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import type { CanonicalRulePackResolution } from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import { resolveSupplyEndBirthProfile } from '@/lib/inbound-mail/supplyEndBirthProfile'

// Prospective physical catalog selection only. Whole H05/H08 require real
// public reception, legal admission, committed consumers, ACKs and replay.
const catalog = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry', () => ({ resolveCanonicalRulePack: catalog }))

const receivedAt = '2026-10-07T22:30:00.000Z'
const checksum = 'a'.repeat(64)
function witness(subtype = 'H'): CanonicalRulePackResolution {
  return {
    rulePackId: '11111111-1111-4111-8111-111111111111',
    messageProfileId: '22222222-2222-4222-8222-222222222222',
    originalVersion: '26.A:r3',
    originalSnapshot: { rulePack: { source_hash: checksum }, messageProfile: { transaction_subtype: subtype }, guideSources: [{ source_hash: checksum }] },
    market: 'electricity', family: 'PRODAT', guideVersion: '26.A', guideRevision: '3',
    unhAssociationCode: 'E2SE6A', validFrom: '2026-04-01', validTo: null,
    sourceDocument: 'SYNTHETIC CATALOG PORT', sourceHash: checksum,
    fieldMatrixVersion: '26.A:r3', profileKey: `PRODAT:Z05:${subtype}:26.A:r3`,
    databaseProfileKey: `PRODAT:Z05:${subtype}:26.A:r3`, businessProcess: 'supply_end',
    phase: null, profile: {}, parserReady: true, builderReady: true,
    validatorReady: true, ackReady: true, stateMachineReady: true,
  }
}
function object(sequence = '1', identity = '735999000000000001', reason = 'Z25') {
  return [`LIN+${sequence}++${identity}:::9`, 'DTM+93:202610161330:203',
    'CCI++Z13', `CAV+${reason}`, `RFF+LI:LI-${sequence}`, 'RFF+Z05:TESTNET',
    'NAD+UD+SYNTHETIC:::89', `NAD+IT+${identity}:::9`]
}
function wire(body = object(), options: { code?: string; application?: string; association?: string; una?: Parameters<typeof EdifactEnvelopeCodec.encode>[0]['una'] } = {}) {
  return EdifactEnvelopeCodec.encode({
    sender: '54321', receiver: '12345', senderQualifier: 'ZZ', receiverQualifier: 'ZZ',
    interchangeReference: 'ENDTEST1', acknowledgementRequest: true, environment: 'test',
    applicationReference: options.application ?? '23-DDQ-PRODAT', createdAt: new Date('2026-10-07T10:00:00Z'), una: options.una,
    messages: [{ messageReference: 'END1', messageTypeToken: `PRODAT:D:97A:UN:${options.association ?? 'E2SE6A'}`,
      businessSegments: [`BGM+${options.code ?? 'Z05'}+END-DOC+9+AB`, 'DTM+137:202610071200:203', 'DTM+ZZZ:1:805', ...body] }],
  })
}
beforeEach(() => { catalog.mockReset(); catalog.mockResolvedValue(witness()) })

describe('physical Z05 supply-end catalog selection', () => {
  it.each([['Z25', 'H'], ['Z22', 'L']])('selects %s from the own physical object and preserves the complete %s catalog witness', async (reason, subtype) => {
    const evidence = witness(subtype); catalog.mockResolvedValue(evidence)
    const before = structuredClone(evidence)
    expect(await resolveSupplyEndBirthProfile({ rawPayload: wire(object('1', undefined, reason)), receivedAt })).toEqual({
      canonical_rule_pack_id: evidence.rulePackId, rule_profile_key: evidence.databaseProfileKey,
      rule_profile_version_id: evidence.messageProfileId, rule_profile_version: '26.A:r3', rule_pack_checksum: checksum,
      rule_pack_snapshot: { ...evidence.originalSnapshot, profileKey: evidence.databaseProfileKey,
        profileVersionId: evidence.messageProfileId, version: '26.A:r3', checksum },
    })
    expect(catalog).toHaveBeenCalledExactlyOnceWith({ family: 'PRODAT', messageCode: 'Z05', transactionSubtype: reason,
      applicationReference: '23-DDQ-PRODAT', direction: 'inbound', businessDate: '2026-10-08' })
    expect(evidence).toEqual(before)
  })
  it('selects homogeneous objects independently rather than borrowing the first object', async () => {
    const rawPayload = wire([...object(), ...object('2', '735999000000000002')])
    expect(await resolveSupplyEndBirthProfile({ rawPayload, receivedAt })).not.toBeNull()
    expect(catalog).toHaveBeenCalledTimes(1)
  })
  it.each([
    ['custom', { componentDataElementSeparator: '*', dataElementSeparator: ';', releaseCharacter: '!', segmentTerminator: '~' }],
    ['escaped identity', undefined],
  ] as const)('reads %s separators and released identity values through the existing tokenizer', async (name, una) => {
    const rawPayload = wire(object('1', name === 'escaped identity' ? '73599?+000' : undefined), { una })
    expect(await resolveSupplyEndBirthProfile({ rawPayload, receivedAt })).not.toBeNull()
  })
  const refusals: [string, () => string][] = [
    ['no object', () => wire([])],
    ['missing own reason', () => wire(object().filter(s => s !== 'CCI++Z13' && s !== 'CAV+Z25'))],
    ['empty reason', () => wire(object('1', undefined, ''))],
    ['internal subtype alias', () => wire(object('1', undefined, 'H'))],
    ['unhandled C reason', () => wire(object('1', undefined, 'Z24'))],
    ['unhandled LK reason', () => wire(object('1', undefined, 'Z23'))],
    ['unknown reason', () => wire(object('1', undefined, 'OTHER'))],
    ['mixed H/L objects', () => wire([...object(), ...object('2', '735999000000000002', 'Z22')])],
    ['second object missing own reason', () => wire([...object(), ...object('2', '735999000000000002').filter(s => s !== 'CCI++Z13' && s !== 'CAV+Z25')])],
    ['duplicate own reason', () => wire([...object().slice(0, 4), 'CCI++Z13', 'CAV+Z25', ...object().slice(4)])],
    ['header reason borrowing', () => wire(['CCI++Z13', 'CAV+Z25', ...object().filter(s => s !== 'CCI++Z13' && s !== 'CAV+Z25')])],
    ['extra header reason', () => wire(['CCI++Z13', 'CAV+Z25', ...object()])],
    ['nonadjacent CAV', () => wire(object().flatMap(s => s === 'CCI++Z13' ? [s, 'RFF+LI:OTHER'] : [s]))],
    ['late characteristic after reference', () => wire([...object().filter(s => s !== 'CCI++Z13' && s !== 'CAV+Z25'), 'CCI++Z13', 'CAV+Z25'])],
    ['same-object unsupported repeated register', () => wire([...object(), ...object('2')])],
    ['missing own identity', () => wire(object().map(s => s.startsWith('LIN') ? 'LIN+1++:::9' : s))],
    ['wrong agency', () => wire(object().map(s => s.startsWith('LIN') ? 'LIN+1++735999000000000001:::ZZZ' : s))],
    ['identity in wrong component', () => wire(object().map(s => s.startsWith('LIN') ? 'LIN+1++735999000000000001:WRONG::9' : s))],
    ['trailing identity component', () => wire(object().map(s => s.startsWith('LIN') ? 'LIN+1++735999000000000001:::9:EXTRA' : s))],
    ['missing own sequence', () => wire(object().map(s => s.startsWith('LIN') ? 'LIN+++735999000000000001:::9' : s))],
    ['wrong global sequence', () => wire(object('2'))],
    ['unsupported Z05 register index', () => wire(object().map(s => s.startsWith('LIN') ? s + '+1:1' : s))],
    ['wrong message code', () => wire(object(), { code: 'Z04' })],
    ['wrong application', () => wire(object(), { application: '23-DGI-PRODAT' })],
  ]
  it.each(refusals)('refuses %s before the catalog port', async (_name, makeRaw) => {
    expect(await resolveSupplyEndBirthProfile({ rawPayload: makeRaw(), receivedAt })).toBeNull()
    expect(catalog).not.toHaveBeenCalled()
  })
  it('uses the retained reception day instead of the wire date or current clock', async () => {
    await resolveSupplyEndBirthProfile({ rawPayload: wire(), receivedAt: '2026-10-07T00:30:00.000Z' })
    expect(catalog).toHaveBeenCalledWith(expect.objectContaining({ businessDate: '2026-10-07' }))
  })
  it('rejects an invalid retained clock without a catalog lookup', async () => {
    await expect(resolveSupplyEndBirthProfile({ rawPayload: wire(), receivedAt: 'not-a-clock' })).rejects.toThrow('supply_end_birth_receipt_clock_invalid')
    expect(catalog).not.toHaveBeenCalled()
  })
  it('propagates catalog refusal without a fallback witness', async () => {
    catalog.mockRejectedValue(new Error('canonical_rule_pack_evidence_count:0:PRODAT:Z05:H'))
    await expect(resolveSupplyEndBirthProfile({ rawPayload: wire(), receivedAt })).rejects.toThrow('canonical_rule_pack_evidence_count:0')
  })
  it('rejects a physical association that differs from the selected catalog witness', async () => {
    await expect(resolveSupplyEndBirthProfile({ rawPayload: wire(object(), { association: 'E2SE5A' }), receivedAt })).rejects.toThrow('supply_end_birth_association_mismatch')
  })
  it('rejects missing database profile identity instead of inventing a profile key', async () => {
    catalog.mockResolvedValue({ ...witness(), databaseProfileKey: undefined })
    await expect(resolveSupplyEndBirthProfile({ rawPayload: wire(), receivedAt })).rejects.toThrow('supply_end_birth_database_profile_key_missing')
  })
})
