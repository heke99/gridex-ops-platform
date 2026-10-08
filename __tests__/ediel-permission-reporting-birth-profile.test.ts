import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { resolvePermissionReportingBirthProfile } from '@/lib/inbound-mail/permissionReportingBirthProfile'

// LOCAL_SYNTHETIC SDK catalog port. Real tokenizer, grouping and dated canonical
// resolver; no source birth, public intake, accepted assessment or native proof.
const port = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: port.rpc } }))
const receipt = '2026-10-07T22:30:00.000Z'
const checksum = 'a'.repeat(64)
function row(reason = 'S17', subtype = 'V') {
  const profile = { family: 'PRODAT', source: 'canonical-db-rule-pack', messageCode: 'Z14',
    guideVersion: '26.A', guideRevision: '3', canonicalDirection: 'inbound',
    transactionSubtype: subtype, reasonForTransaction: reason }
  const rulePackId = '11111111-1111-4111-8111-111111111111'
  const messageProfileId = '22222222-2222-4222-8222-222222222222'
  const profileKey = `PRODAT:Z14:${subtype}:26.A:r3`
  return {
    rule_pack_id: rulePackId, message_profile_id: messageProfileId, market: 'electricity', family: 'PRODAT',
    guide_version: '26.A', guide_revision: '3', unh_association_code: 'E2SE6A',
    valid_from: '2026-04-01', valid_to: null, source_document: 'SYNTHETIC SDK CATALOG PORT',
    source_hash: checksum, field_matrix_version: '26A-r3', profile_key: profileKey,
    business_process: 'permission_reporting', phase: null, profile,
    parser_ready: true, builder_ready: true, validator_ready: true, ack_ready: true, state_machine_ready: true,
    original_version: '26.A:r3', original_snapshot: {
      rulePack: { id: rulePackId, source_hash: checksum, guide_version: '26.A', guide_revision: '3' },
      messageProfile: { id: messageProfileId, rule_pack_id: rulePackId, profile_key: profileKey, profile },
      guideSources: [{ rule_pack_id: rulePackId, source_hash: checksum, source_document: 'SYNTHETIC GUIDE' }],
    },
  }
}
function object(reason = 'S17', sequence = '1', point?: string) {
  return [point ? `LIN+${sequence}++${point}:::9` : `LIN+${sequence}`, 'CCI++Z13', `CAV+${reason}`, `RFF+LI:OWN-${sequence}`]
}
function wire(body = object(), options: { code?: string; application?: string; association?: string;
  una?: Parameters<typeof EdifactEnvelopeCodec.encode>[0]['una'] } = {}) {
  return EdifactEnvelopeCodec.encode({
    sender: '54321', receiver: '12345', senderQualifier: 'ZZ', receiverQualifier: 'ZZ',
    interchangeReference: 'PERMTEST1', acknowledgementRequest: true, environment: 'test',
    applicationReference: options.application ?? '23-DGI-PRODAT', createdAt: new Date('2026-10-07T10:00:00Z'), una: options.una,
    messages: [{ messageReference: 'PERM1', messageTypeToken: `PRODAT:D:97A:UN:${options.association ?? 'E2SE6A'}`,
      businessSegments: [`BGM+${options.code ?? 'Z14'}+PERM-DOC+9+AB`, 'DTM+137:202610071200:203', 'DTM+ZZZ:1:805', ...body] }],
  })
}
const select = (rawPayload: string | null | undefined = wire(), receivedAt = receipt) =>
  resolvePermissionReportingBirthProfile({ rawPayload, receivedAt })
function expectWitness(result: Awaited<ReturnType<typeof select>>, evidence: ReturnType<typeof row>) {
  expect(result).toEqual({
    canonical_rule_pack_id: evidence.rule_pack_id, rule_profile_key: evidence.profile_key,
    rule_profile_version_id: evidence.message_profile_id, rule_profile_version: evidence.original_version,
    rule_pack_checksum: evidence.source_hash, rule_pack_snapshot: { ...evidence.original_snapshot,
      profileKey: evidence.profile_key, profileVersionId: evidence.message_profile_id,
      version: evidence.original_version, checksum: evidence.source_hash },
  })
}
beforeEach(() => { port.rpc.mockReset(); port.rpc.mockResolvedValue({ data: [row()], error: null }) })

describe('prospective physical Z14 catalog witness selection', () => {
  it.each([['S17', 'V'], ['S18', 'VH'], ['Z96', 'N']])('uses physical %s and the actual dated %s catalog witness only', async (reason, subtype) => {
    const evidence = row(reason, subtype), unchanged = structuredClone(evidence)
    port.rpc.mockResolvedValue({ data: [evidence], error: null })
    expectWitness(await select(wire(object(reason))), evidence)
    expect(port.rpc).toHaveBeenCalledExactlyOnceWith('resolve_canonical_ediel_rule_pack_with_witness_v1', {
      p_market: 'electricity', p_family: 'PRODAT', p_message_code: 'Z14', p_transaction_subtype: subtype,
      p_direction: 'inbound', p_business_date: '2026-10-08',
    })
    expect(evidence).toEqual(unchanged)
  })
  it('selects N without installation, customer, positive permission or reporting facts', async () => {
    const evidence = row('Z96', 'N'); port.rpc.mockResolvedValue({ data: [evidence], error: null })
    expectWitness(await select(wire(object('Z96'))), evidence)
  })
  it.each(['S17', 'S18'])('leaves missing unrelated R/D data in %s to the subsequent validator', async reason => {
    const evidence = row(reason, reason === 'S17' ? 'V' : 'VH')
    port.rpc.mockResolvedValue({ data: [evidence], error: null })
    expectWitness(await select(wire(object(reason))), evidence) // no 321,322,customer or approval facts
  })
  it('requires each distinct object to supply its own homogeneous selector', async () => {
    expectWitness(await select(wire([...object('S17', '1', '735999000000000001'),
      ...object('S17', '2', '735999000000000002')])), row())
  })
  it('keeps released fake selectors in their actual reference value', async () => {
    const body = object().map(s => s.startsWith('RFF') ? "RFF+LI:OWN?+CCI?+?+Z13?'CAV?+S18?:?!" : s)
    expectWitness(await select(wire(body)), row())
  })
  it('uses the actual UNA separator alphabet', async () => {
    const una = { componentDataElementSeparator: ':', dataElementSeparator: ';', decimalMark: '.',
      releaseCharacter: '!', repetitionSeparator: ' ', segmentTerminator: '~' }
    expectWitness(await select(wire(object(), { una })), row())
  })

  const refusals: [string, () => string | null | undefined][] = [
    ['no LIN', () => wire([])], ['null', () => null], ['undefined', () => undefined],
    ['missing reason', () => wire(['LIN+1', 'RFF+LI:OWN'])],
    ['empty reason', () => wire(object(''))], ['internal V alias', () => wire(object('V'))],
    ['internal VH alias', () => wire(object('VH'))], ['internal N alias', () => wire(object('N'))],
    ['foreign reason', () => wire(object('Z22'))],
    ['mixed reasons', () => wire([...object('S17', '1', '735999000000000001'), ...object('S18', '2', '735999000000000002')])],
    ['second missing own reason', () => wire([...object('S17', '1', '735999000000000001'), 'LIN+2++735999000000000002:::9', 'RFF+LI:SECOND'])],
    ['duplicate selector', () => wire(['LIN+1', 'CCI++Z13', 'CAV+S17', 'CCI++Z13', 'CAV+S17', 'RFF+LI:OWN'])],
    ['extra empty selector', () => wire(['LIN+1', 'CCI++Z13', 'CAV+S17', 'CCI++Z13', 'CAV+', 'RFF+LI:OWN'])],
    ['header selector', () => wire(['CCI++Z13', 'CAV+S17', 'LIN+1', 'RFF+LI:OWN'])],
    ['extra header selector', () => wire(['CCI++Z13', 'CAV+S17', ...object()])],
    ['late selector after LI', () => wire(['LIN+1', 'RFF+LI:OWN', 'CCI++Z13', 'CAV+S17'])],
    ['late selector after NAD', () => wire(['LIN+1', 'NAD+UD+TEST:::89', 'CCI++Z13', 'CAV+S17', 'RFF+LI:OWN'])],
    ['nonadjacent CAV', () => wire(['LIN+1', 'CCI++Z13', 'DTM+93:202610070000:203', 'CAV+S17', 'RFF+LI:OWN'])],
    ['padded qualifier', () => wire(object().map(s => s === 'CCI++Z13' ? 'CCI++ Z13' : s))],
    ['padded CCI token', () => wire().replace("'CCI++Z13'", "' CCI++Z13'")],
    ['padded reason', () => wire(object('S17 '))], ['lowercase reason', () => wire(object('s17'))],
    ['lowercase qualifier', () => wire(object().map(s => s === 'CCI++Z13' ? 'CCI++z13' : s))],
    ['CCI extra component', () => wire(object().map(s => s === 'CCI++Z13' ? 'CCI++Z13:EXTRA' : s))],
    ['CCI extra element', () => wire(object().map(s => s === 'CCI++Z13' ? 'CCI++Z13+EXTRA' : s))],
    ['CCI supplied first element', () => wire(object().map(s => s === 'CCI++Z13' ? 'CCI+EXTRA+Z13' : s))],
    ['CAV extra component', () => wire(object('S17:EXTRA'))],
    ['CAV wrong component', () => wire(object(':::S17'))],
    ['CAV extra element', () => wire(object('S17+EXTRA'))],
    ['extra padded selector', () => wire(['LIN+1', 'CCI++Z13', 'CAV+S17', 'CCI++ Z13 ', 'CAV+', 'RFF+LI:OWN'])],
    ['extra escaped selector', () => wire(['LIN+1', 'CCI++Z13', 'CAV+S17', 'CCI++Z?13', 'CAV+', 'RFF+LI:OWN'])],
    ['missing own LI', () => wire(object().filter(s => !s.startsWith('RFF')))],
    ['empty own LI', () => wire(object().map(s => s.startsWith('RFF') ? 'RFF+LI:' : s))],
    ['duplicate own LI', () => wire([...object(), 'RFF+LI:OTHER'])],
    ['header LI borrowing', () => wire(['RFF+LI:HEADER', ...object().filter(s => !s.startsWith('RFF'))])],
    ['repeated Z14 register', () => wire([...object('S17', '1', '735999000000000001'), ...object('S17', '2', '735999000000000001')])],
    ['unsupported C829', () => wire(['LIN+1++735999000000000001:::9+1:1', ...object().slice(1)])],
    ['bad LIN sequence', () => wire(object('S17', '2'))],
    ['wrong application', () => wire(object(), { application: '23-DDQ-PRODAT' })],
    ['padded application', () => wire().replace('23-DGI-PRODAT', ' 23-DGI-PRODAT')],
    ['application extra component', () => wire().replace('23-DGI-PRODAT', '23-DGI-PRODAT:EXTRA')],
    ['wrong code', () => wire(object(), { code: 'Z13' })],
    ['wrong family', () => wire().replace('PRODAT:D:97A', 'UTILTS:D:97A')],
    ['wrong message release', () => wire().replace('PRODAT:D:97A', 'PRODAT:D:96A')],
    ['duplicate BGM', () => wire(['BGM+Z14+OTHER+9+AB', ...object()])],
    ['late BGM', () => wire().replace("BGM+Z14+PERM-DOC+9+AB'", '').replace("UNZ+1+PERMTEST1'", "BGM+Z14+PERM-DOC+9+AB'UNZ+1+PERMTEST1'")],
    ['second UNH', () => {
      const original = wire(), second = original.slice(original.indexOf('UNH'), original.indexOf('UNZ')).replaceAll('PERM1', 'PERM2')
      return original.replace("UNZ+1+PERMTEST1'", second + "UNZ+2+PERMTEST1'")
    }],
    ['wrong UNT', () => wire().replace(/UNT\+\d+\+PERM1/, 'UNT+999+PERM1')],
    ['wrong UNZ', () => wire().replace('UNZ+1+PERMTEST1', 'UNZ+2+PERMTEST1')],
    ['dangling release', () => wire() + '?'],
  ]
  it.each(refusals)('declines %s without any database lookup', async (_name, payload) => {
    const rawPayload = payload()
    expect(await resolvePermissionReportingBirthProfile({ rawPayload, receivedAt: receipt })).toBeNull()
    expect(port.rpc).not.toHaveBeenCalled()
  })
  it.each([
    ['2026-10-07T22:30:00Z', '2026-10-08'], ['2026-10-07T21:30:00Z', '2026-10-07'],
    ['2026-10-08T00:30:00+02:00', '2026-10-08'], ['2026-12-07T23:30:00Z', '2026-12-08'],
    ['2026-10-07T23:59:59.999999+02:00', '2026-10-07'],
  ])('uses actual Stockholm receipt day for %s', async (clock, businessDate) => {
    await select(wire(), clock)
    expect(port.rpc).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ p_business_date: businessDate }))
  })
  it.each(['', 'invalid', '2026-10-07', '2026-10-07T22:30:00', '2026-02-30T12:00:00Z',
    '2026-10-07T24:00:00Z', '2026-10-07T22:60:00Z', '2026-10-07T22:30:60Z',
    '2026-10-07T22:30:00+24:00', '2026-10-07T22:30:00+02:60'])('rejects invalid receipt %s before lookup', async clock => {
    await expect(select(wire(), clock)).rejects.toThrow('permission_reporting_birth_receipt_clock_invalid')
    expect(port.rpc).not.toHaveBeenCalled()
  })
  it('rejects a wire association different from the actual selected witness', async () => {
    await expect(select(wire(object(), { association: 'E2SE5A' }))).rejects.toThrow(/association_mismatch/)
  })
  it.each(['empty', 'ambiguous', 'foreign-code', 'foreign-subtype', 'foreign-direction', 'foreign-reason',
    'missing-original', 'foreign-original', 'runtime-incomplete', 'expired', 'missing-db-key', 'sdk-error'])('propagates real catalog %s refusal', async change => {
    const evidence = row()
    if (change === 'foreign-code') evidence.profile.messageCode = 'Z13'
    if (change === 'foreign-subtype') evidence.profile.transactionSubtype = 'VH'
    if (change === 'foreign-direction') evidence.profile.canonicalDirection = 'outbound'
    if (change === 'foreign-reason') evidence.profile.reasonForTransaction = 'S18'
    if (change === 'foreign-original') evidence.original_snapshot.rulePack.id = 'foreign-original'
    if (change === 'runtime-incomplete') evidence.validator_ready = false
    if (change === 'missing-db-key') evidence.profile_key = ''
    const submitted = change === 'missing-original' ? { ...evidence, original_snapshot: null }
      : change === 'expired' ? { ...evidence, valid_to: '2026-10-07' } : evidence
    port.rpc.mockResolvedValue({ data: change === 'empty' ? [] : change === 'ambiguous' ? [submitted, submitted] : [submitted],
      error: change === 'sdk-error' ? { message: 'SYNTHETIC SDK FAILURE' } : null })
    await expect(select()).rejects.toThrow(/canonical_(rule_pack_evidence|original_rule_witness)/)
    expect(port.rpc).toHaveBeenCalledTimes(1)
  })
})
