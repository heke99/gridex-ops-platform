// Component-only prospective Z02 catalog selection. The registry is a declared
// port; parsing, physical grouping, reason validation and receipt-date conversion
// are real. No received-source admission, authority or whole AT proof is claimed.
import { beforeEach, expect, it, vi } from 'vitest'
import { guideOrderedFixtureRaw } from './helpers/prodatGuideOrderedFixture'
import { alphabets, characteristic, line, raw, type Parts } from './fixtures/prodat-register'
import { head } from './fixtures/prodat-identity'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { resolveSupplierDataBirthProfile } from '@/lib/inbound-mail/supplierDataBirthProfile'
import type { CanonicalRulePackResolution } from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import { segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage'

const catalog = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry', () => ({ resolveCanonicalRulePack: catalog }))
const receipt = '2026-10-06T22:30:00Z'
const packId = '11111111-1111-4111-8111-111111111111'
const profileId = '22222222-2222-4222-8222-222222222222'
const profileKey = 'PRODAT:Z02:L:26.A:r3'
const points = ['735999000000000001', '735999000000000002']
const evidence: CanonicalRulePackResolution = {
  rulePackId: packId, messageProfileId: profileId, sourceHash: 'a'.repeat(64),
  originalVersion: '26.A:r3', databaseProfileKey: profileKey,
  originalSnapshot: {
    rulePack: { id: packId, guide_version: '26.A', guide_revision: '3', source_hash: 'a'.repeat(64) },
    messageProfile: { id: profileId, rule_pack_id: packId, profile_key: profileKey },
    guideSources: [{ rule_pack_id: packId, source_document: 'Declared original catalog source' }],
  },
  market: 'electricity', family: 'PRODAT', guideVersion: '26.A', guideRevision: '3',
  unhAssociationCode: 'E2SE6A', validFrom: '2025-11-05', validTo: null,
  sourceDocument: 'Declared original catalog source', fieldMatrixVersion: '26.A:r3',
  profileKey: 'semantic-alias-must-not-be-stored', businessProcess: 'grid_contract_information',
  phase: null, profile: {}, parserReady: true, builderReady: true,
  validatorReady: true, ackReady: true, stateMachineReady: true,
}
function object(reason: string, index = 0): Parts[] {
  return [line(String(index + 1), points[index], undefined, '9'),
    ...characteristic('Z13', reason), ['RFF', ['LI', `OWN-${index}`]]]
}
function wire(reasons: string[] = ['Z22']) {
  return guideOrderedFixtureRaw(reasons.flatMap((reason, index) => object(reason, index)), 'Z02')
}
function changedBusinessWire(change: (segments: string[]) => string[]) {
  const business = tokenizeEdifact(wire()).segments
    .filter(token => !['UNB', 'UNH', 'UNT', 'UNZ'].includes(token.tag)).map(token => token.raw)
  return EdifactEnvelopeCodec.encode({ sender: 'S', receiver: 'R', interchangeReference: 'I',
    applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: false, environment: 'test',
    createdAt: new Date('2026-10-06T12:00:00Z'),
    messages: [{ messageReference: 'M', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: change(business) }] })
}
function twoMessagesWire() {
  const businessSegments = tokenizeEdifact(guideOrderedFixtureRaw([...head(), ...object('Z22')], 'Z02')).segments
    .filter(token => !['UNB', 'UNH', 'UNT', 'UNZ'].includes(token.tag)).map(token => token.raw)
  return EdifactEnvelopeCodec.encode({ sender: 'S', receiver: 'R', interchangeReference: 'I',
    applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: false, environment: 'test',
    createdAt: new Date('2026-10-06T12:00:00Z'),
    messages: ['M', 'SECOND'].map(messageReference => ({ messageReference,
      messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments })) })
}
function selected(reason: 'Z22' | 'Z23') {
  const key = `PRODAT:Z02:${reason === 'Z22' ? 'L' : 'LK'}:26.A:r3`
  return { ...evidence, databaseProfileKey: key,
    originalSnapshot: { ...evidence.originalSnapshot,
      messageProfile: { ...evidence.originalSnapshot.messageProfile, profile_key: key } } }
}
beforeEach(() => { catalog.mockReset(); catalog.mockResolvedValue(evidence) })

it.each(['Z22', 'Z23'] as const)('binds the exact six-field original witness for homogeneous %s distinct objects', async reason => {
  const chosen = selected(reason)
  const originalSnapshot = structuredClone(chosen.originalSnapshot)
  catalog.mockResolvedValue(chosen)
  expect(await resolveSupplierDataBirthProfile({ rawPayload: wire([reason, reason]), receivedAt: receipt })).toEqual({
    canonical_rule_pack_id: packId, rule_profile_key: chosen.databaseProfileKey,
    rule_profile_version_id: profileId, rule_profile_version: '26.A:r3', rule_pack_checksum: 'a'.repeat(64),
    rule_pack_snapshot: { ...originalSnapshot, profileKey: chosen.databaseProfileKey,
      profileVersionId: profileId, version: '26.A:r3', checksum: 'a'.repeat(64) },
  })
  expect(chosen.originalSnapshot).toEqual(originalSnapshot)
  expect(catalog).toHaveBeenCalledExactlyOnceWith({ family: 'PRODAT', messageCode: 'Z02',
    transactionSubtype: reason, applicationReference: '23-DDQ-PRODAT', direction: 'inbound', businessDate: '2026-10-07' })
})

it.each([
  ['mixed L/LK', () => wire(['Z22', 'Z23'])],
  ['mixed LK/L', () => wire(['Z23', 'Z22'])],
  ['foreign H reason', () => wire(['Z25'])],
  ['foreign assigned-supply reason', () => wire(['Z26'])],
  ['foreign production reason', () => wire(['Z70'])],
  ['second object missing own reason', () => guideOrderedFixtureRaw([...object('Z22'),
    line('2', points[1], undefined, '9'), ['RFF', ['LI', 'OWN-1']]], 'Z02')],
  ['empty own reason', () => wire([''])],
  ['missing adjacent CAV', () => guideOrderedFixtureRaw([line('1', points[0], undefined, '9'),
    ['CCI', '', 'Z13'], ['RFF', ['LI', 'OWN']]], 'Z02')],
  ['nonadjacent CAV', () => raw([line('1', points[0], undefined, '9'), ['CCI', '', 'Z13'],
    ['RFF', ['LI', 'OWN']], ['CAV', ['Z22']]], 'Z02')],
  ['duplicate own reason', () => guideOrderedFixtureRaw([line('1', points[0], undefined, '9'),
    ...characteristic('Z13', 'Z22'), ...characteristic('Z13', 'Z22'), ['RFF', ['LI', 'OWN']]], 'Z02')],
  ['header reason without LIN', () => guideOrderedFixtureRaw([...characteristic('Z13', 'Z22'),
    ['RFF', ['LI', 'OWN']]], 'Z02')],
  ['extra header reason', () => guideOrderedFixtureRaw([...characteristic('Z13', 'Z22'), ...object('Z22')], 'Z02')],
  ['reason after parent reference', () => raw([line('1', points[0], undefined, '9'),
    ['RFF', ['LI', 'OWN']], ...characteristic('Z13', 'Z22')], 'Z02')],
  ['unsupported repeated registers', () => guideOrderedFixtureRaw([
    line('1', points[0], '1', '9'), ...characteristic('Z13', 'Z22'), ['RFF', ['LI', 'OWN-0']],
    line('2', points[0], '2', '9'), ...characteristic('Z13', 'Z22'), ['RFF', ['LI', 'OWN-1']]], 'Z02')],
  ['duplicate same-object LIN', () => guideOrderedFixtureRaw([...object('Z22'),
    line('2', points[0], undefined, '9'), ...characteristic('Z13', 'Z22'), ['RFF', ['LI', 'OWN-1']]], 'Z02')],
  ['single-register C829', () => guideOrderedFixtureRaw([line('1', points[0], '1', '9'),
    ...characteristic('Z13', 'Z22'), ['RFF', ['LI', 'OWN']]], 'Z02')],
  ['nonincrementing LIN sequence', () => guideOrderedFixtureRaw([...object('Z22'),
    line('3', points[1], undefined, '9'), ...characteristic('Z13', 'Z22'), ['RFF', ['LI', 'OWN-1']]], 'Z02')],
  ['empty object identity', () => guideOrderedFixtureRaw([line('1', '', undefined, '9'),
    ...characteristic('Z13', 'Z22'), ['RFF', ['LI', 'OWN']]], 'Z02')],
  ['unsupported object identity agency', () => guideOrderedFixtureRaw([line('1', points[0], undefined, '260'),
    ...characteristic('Z13', 'Z22'), ['RFF', ['LI', 'OWN']]], 'Z02')],
  ['foreign message code', () => guideOrderedFixtureRaw(object('Z22'), 'Z04')],
  ['foreign message family', () => wire().replace('PRODAT:D:97A', 'UTILTS:D:97A')],
  ['foreign type containing PRODAT', () => wire().replace('PRODAT:D:97A', 'XPRODAT:D:97A')],
  ['foreign application reference', () => wire().replace('23-DDQ-PRODAT', '23-DGI-PRODAT')],
  ['missing application reference', () => wire().replace('+23-DDQ-PRODAT', '')],
  ['duplicate physical UNH', () => guideOrderedFixtureRaw([
    ['UNH', 'SECOND', ['PRODAT', 'D', '97A', 'UN', 'E2SE6A']], ...object('Z22')], 'Z02')],
  ['two complete physical messages', twoMessagesWire],
  ['duplicate physical BGM', () => guideOrderedFixtureRaw([['BGM', 'Z02', 'SECOND', '9'], ...object('Z22')], 'Z02')],
  ['BGM after LIN', () => changedBusinessWire(segments => segments.flatMap(segment =>
    segment.startsWith('BGM+') ? [] : segment.startsWith('LIN+') ? [segment, 'BGM+Z02+D+9+AB'] : [segment]))],
  ['missing BGM', () => changedBusinessWire(segments => segments.filter(segment => !segment.startsWith('BGM+')))],
  ['missing UNH', () => wire().replace("UNH+M+PRODAT:D:97A:UN:E2SE6A'", '')],
  ['null payload', (): null => null],
  ['undefined payload', (): undefined => undefined],
] as const)('does not select a supplier-data profile for %s', async (_name, payload) => {
  expect(await resolveSupplierDataBirthProfile({ rawPayload: payload(), receivedAt: receipt })).toBeNull()
  expect(catalog).not.toHaveBeenCalled()
})

it.each([
  ['header empty', 'Z13', true, true], ['header missing', 'Z13', true, false],
  ['header lowercase', 'z13', true, true], ['later padded', ' Z13 ', false, false],
] as const)('rejects an out-of-scope physical reason qualifier: %s', async (_name, qualifier, header, withCav) => {
  const extra: Parts[] = withCav ? characteristic(qualifier, '') : [['CCI', '', qualifier]]
  const body = header ? [...extra, ...object('Z22')] : [...object('Z22'), line('2', points[1], undefined, '9'), ...extra]
  expect(await resolveSupplierDataBirthProfile({ rawPayload: guideOrderedFixtureRaw(body, 'Z02'), receivedAt: receipt })).toBeNull()
  expect(catalog).not.toHaveBeenCalled()
})

it.each(alphabets)('keeps released separators as data with alphabet %s/%s/%s/%s', async (component, element, release, segment) => {
  const body: Parts[] = [line('1', points[0], undefined, '9'), ...characteristic('Z13', 'Z22'),
    ['RFF', ['LI', `OWN${element}CCI${element}${element}Z13${segment}CAV${element}Z23${release}${component}`]]]
  expect(await resolveSupplierDataBirthProfile({ rawPayload: raw(body, 'Z02', [component, element, release, segment]), receivedAt: receipt }))
    .not.toBeNull()
  expect(catalog).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ transactionSubtype: 'Z22' }))
})

it.each([
  ['2026-10-06T21:30:00Z', '2026-10-06'],
  ['2026-10-06T22:30:00Z', '2026-10-07'],
  ['2026-01-06T22:30:00Z', '2026-01-06'],
  ['2026-01-06T23:30:00Z', '2026-01-07'],
] as const)('uses the actual receipt %s for catalog date %s', async (receivedAt, businessDate) => {
  await resolveSupplierDataBirthProfile({ rawPayload: wire(), receivedAt })
  expect(catalog).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ businessDate }))
})

it('does not replace an invalid receipt clock with now', async () => {
  await expect(resolveSupplierDataBirthProfile({ rawPayload: wire(), receivedAt: 'invalid' }))
    .rejects.toThrow('supplier_data_birth_receipt_clock_invalid')
  expect(catalog).not.toHaveBeenCalled()
})
it('refuses the physical UNH association mismatch against the selected catalog', async () => {
  catalog.mockResolvedValue({ ...evidence, unhAssociationCode: 'E2SE5A' })
  await expect(resolveSupplierDataBirthProfile({ rawPayload: wire(), receivedAt: receipt }))
    .rejects.toThrow('supplier_data_birth_association_mismatch')
})
it('does not replace a missing database profile key with the semantic alias', async () => {
  catalog.mockResolvedValue({ ...evidence, databaseProfileKey: undefined })
  await expect(resolveSupplierDataBirthProfile({ rawPayload: wire(), receivedAt: receipt }))
    .rejects.toThrow('supplier_data_birth_database_profile_key_missing')
})
it.each([0, 2])('propagates actual catalog evidence count %s without inventing a witness', async count => {
  const failure = Error(`canonical_rule_pack_evidence_count:${count}:PRODAT:Z02:L`)
  catalog.mockRejectedValue(failure)
  await expect(resolveSupplierDataBirthProfile({ rawPayload: wire(), receivedAt: receipt })).rejects.toBe(failure)
})

// Field 312 is the physical UNH/S009/0057 association code. Keep the real
// message, objects, receipt clock and parser; only the declared catalog is a port.
type PhysicalAlphabet = typeof alphabets[number]
type MissingAssociation = 'absent' | 'empty' | 'blank'
function physicalAssociationWire(reason: 'Z22' | 'Z23', alphabet: PhysicalAlphabet, association: string | null) {
  const complete = raw(object(reason), 'Z02', alphabet)
  const original = tokenizeEdifact(complete)
  const originalHeaders = original.segments.filter(token => token.tag === 'UNH')
  expect(originalHeaders).toHaveLength(1)
  const [component, element, release] = alphabet
  const separators: readonly string[] = alphabet
  const encode = (value: string) => [...value].map(char => separators.includes(char) ? release + char : char).join('')
  const associationComponent = association === null ? '' : component + encode(association)
  const replacement = `UNH${element}M${element}PRODAT${component}D${component}97A${component}UN${associationComponent}`
  const payload = complete.replace(originalHeaders[0].raw, replacement)
  expect(payload).toContain(replacement + alphabet[3])
  const physical = tokenizeEdifact(payload)
  expect(physical.una).toEqual(original.una)
  expect(physical.segments).toHaveLength(original.segments.length)
  expect(physical.segments.filter(token => token.tag !== 'UNH').map(token => token.raw))
    .toEqual(original.segments.filter(token => token.tag !== 'UNH').map(token => token.raw))
  const headers = physical.segments.filter(token => token.tag === 'UNH')
  expect(headers).toHaveLength(1)
  expect(segmentComposite(headers[0], 2, physical.una))
    .toEqual(association === null ? ['PRODAT', 'D', '97A', 'UN'] : ['PRODAT', 'D', '97A', 'UN', association.trim()])
  return payload
}
const missingAssociations: readonly [MissingAssociation, string | null][] = [
  ['absent', null], ['empty', ''], ['blank', '   '],
]
const missingAssociationCases = (['Z22', 'Z23'] as const).flatMap(reason =>
  alphabets.flatMap((alphabet, index) => missingAssociations.map(([missing, association]) =>
    ({ reason, alphabet, alphabetName: `UNA-${index + 1}`, missing, association }))))

it.each(missingAssociationCases)('returns no witness and does not query the catalog for physical missing312 $reason/$missing/$alphabetName', async ({ reason, alphabet, association }) => {
  const payload = physicalAssociationWire(reason, alphabet, association)
  const canonical = parseCanonicalEdielPayload({ rawPayload: payload, direction: 'inbound', standardHint: 'edifact' })
  expect(canonical.family).toBe('PRODAT')
  expect(canonical.messageCode).toBe('Z02')
  expect(canonical.applicationReference).toBe('23-DDQ-PRODAT')
  expect(canonical.version).toBeNull()
  const chosen = selected(reason)
  const originalSnapshot = structuredClone(chosen.originalSnapshot)
  catalog.mockResolvedValue(chosen)
  const outcome = await Promise.allSettled([resolveSupplierDataBirthProfile({ rawPayload: payload, receivedAt: receipt })])
  expect.soft(catalog).not.toHaveBeenCalled()
  expect.soft(outcome).toEqual([{ status: 'fulfilled', value: null }])
  expect(chosen.originalSnapshot).toEqual(originalSnapshot)
})

const associationCounterCases = (['Z22', 'Z23'] as const).flatMap(reason =>
  alphabets.map((alphabet, index) => ({ reason, alphabet, alphabetName: `UNA-${index + 1}` })))
it.each(associationCounterCases)('retains receipt-clock failure before missing312 fallback for $reason/$alphabetName', async ({ reason, alphabet }) => {
  const payload = physicalAssociationWire(reason, alphabet, null)
  expect(parseCanonicalEdielPayload({ rawPayload: payload, direction: 'inbound', standardHint: 'edifact' }).version).toBeNull()
  await expect(resolveSupplierDataBirthProfile({ rawPayload: payload, receivedAt: 'invalid' }))
    .rejects.toThrow('supplier_data_birth_receipt_clock_invalid')
  expect(catalog).not.toHaveBeenCalled()
})

const nonemptyAssociationCases = associationCounterCases.flatMap(testCase =>
  ['E2SE5A', 'E2SE6B', 'UNKNOWN'].map(association => ({ ...testCase, association })))
it.each(nonemptyAssociationCases)('does not treat nonempty wrong physical312 as missing: $reason/$association/$alphabetName', async ({ reason, alphabet, association }) => {
  const payload = physicalAssociationWire(reason, alphabet, association)
  expect(parseCanonicalEdielPayload({ rawPayload: payload, direction: 'inbound', standardHint: 'edifact' }).version).toBe(association)
  catalog.mockResolvedValue(selected(reason))
  await expect(resolveSupplierDataBirthProfile({ rawPayload: payload, receivedAt: receipt }))
    .rejects.toThrow('supplier_data_birth_association_mismatch')
  expect(catalog).toHaveBeenCalledExactlyOnceWith({ family: 'PRODAT', messageCode: 'Z02',
    transactionSubtype: reason, applicationReference: '23-DDQ-PRODAT', direction: 'inbound', businessDate: '2026-10-07' })
})
