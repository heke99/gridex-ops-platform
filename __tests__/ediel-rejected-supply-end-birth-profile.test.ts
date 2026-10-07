// Explicit rejection catalog/source-birth prerequisite only. SDK, actor, mail,
// INSERT and reception ports are synthetic: no native authorization, source
// approval, business capability, real negative ACK or whole H proof is granted.
import {beforeEach, expect, it, vi} from 'vitest'
import {resolveSupplyEndBirthProfile} from '@/lib/inbound-mail/supplyEndBirthProfile'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {parseInboundEmailContent} from '@/lib/inbound-mail/edielEmailParser'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {characteristic, line, type Parts} from './fixtures/prodat-register'
import {company, actor, mailId, parseId, newId, oldId, receivedAt, inboundReceptionBoundary} from './fixtures/inbound-reception-db'

const io = vi.hoisted(() => ({from: vi.fn(), rpc: vi.fn()}))
vi.mock('@/lib/supabase/service', () => ({supabaseService: {from: io.from, rpc: io.rpc}}))
const checksum = 'a'.repeat(64), profileKey = 'PRODAT:Z05:H:26.A:r3'
function catalogRow() {
  const profile = {family: 'PRODAT', source: 'canonical-db-rule-pack', messageCode: 'Z05', guideVersion: '26.A',
    guideRevision: '3', canonicalDirection: 'inbound', transactionSubtype: 'H', reasonForTransaction: 'Z25'}
  return {rule_pack_id: '11111111-1111-4111-8111-111111111111', message_profile_id: '22222222-2222-4222-8222-222222222222',
    market: 'electricity', family: 'PRODAT', guide_version: '26.A', guide_revision: '3', unh_association_code: 'E2SE6A',
    valid_from: '2026-04-01', valid_to: null, source_document: 'SYNTHETIC DECLARED SDK PORT', source_hash: checksum,
    field_matrix_version: '26A-r3', profile_key: profileKey, business_process: 'supply_end', phase: null, profile,
    parser_ready: true, builder_ready: true, validator_ready: true, ack_ready: true, state_machine_ready: true,
    original_version: '26.A:r3', original_snapshot: {
      rulePack: {id: '11111111-1111-4111-8111-111111111111', source_hash: checksum, guide_version: '26.A', guide_revision: '3'},
      messageProfile: {id: '22222222-2222-4222-8222-222222222222', rule_pack_id: '11111111-1111-4111-8111-111111111111', profile_key: profileKey, profile},
      guideSources: [],
    }}
}
function object(n = '1', identity = '', li = `OWN-${n}`, reason = 'Z25'): Parts[] {
  return [line(n, identity, undefined, '9'), ...characteristic('Z13', reason), ['RFF', ['LI', li]],
    ['NAD', 'UD', ['199001011234', 'SE2', '260']],
    // A different NAD IT cannot fill the absent own LIN identity.
    ['NAD', 'IT', ['735999000000000001', '', '9']]]
}
const wire = (body = object()) => guideOrderedFixtureRaw(body, 'Z05')
function parsed(raw: string) {
  const result = parseInboundEmailContent({attachmentText: raw})
  if (!result) throw Error('actual_parser_required')
  return result
}
let db: ReturnType<typeof inboundReceptionBoundary>, row: ReturnType<typeof catalogRow>
function setup(raw = wire()) {
  const original = parsed(raw)
  db = inboundReceptionBoundary(original); db.state.existing = false
  row = catalogRow()
  io.from.mockImplementation(db.from)
  io.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === 'resolve_canonical_ediel_rule_pack_with_witness_v1') return {data: [row], error: null}
    return db.rpc(name, args)
  })
  return {companyId: company, actorUserId: actor, environment: 'test', inboundEmailMessageId: mailId, parseResultId: parseId, parsed: original}
}
const catalogCalls = () => io.rpc.mock.calls.filter(([name]) => name === 'resolve_canonical_ediel_rule_pack_with_witness_v1')
const explicitInput = (rawPayload = wire(), receipt = receivedAt) => ({rawPayload, receivedAt: receipt, purpose: 'rejected_identity' as const})
const expectedProfile = () => ({canonical_rule_pack_id: row.rule_pack_id, rule_profile_key: row.profile_key,
  rule_profile_version_id: row.message_profile_id, rule_profile_version: row.original_version, rule_pack_checksum: checksum,
  rule_pack_snapshot: {...row.original_snapshot, profileKey, profileVersionId: row.message_profile_id, version: row.original_version, checksum}})
beforeEach(() => {vi.clearAllMocks(); setup()})

it.each(['invalid', 'absent'])('selects only the real dated H catalog for explicitly rejected %s identity', async kind => {
  const body = object(); if (kind === 'absent') body[0] = ['LIN', '1']
  const raw = wire(body), originalCatalog = structuredClone(row)
  expect(await resolveSupplyEndBirthProfile(explicitInput(raw, '2026-10-07T22:30:00Z'))).toEqual(expectedProfile())
  expect(catalogCalls()).toEqual([['resolve_canonical_ediel_rule_pack_with_witness_v1', {
    p_market: 'electricity', p_family: 'PRODAT', p_message_code: 'Z05', p_transaction_subtype: 'H',
    p_direction: 'inbound', p_business_date: '2026-10-08',
  }]])
  expect(row).toEqual(originalCatalog)
  expect(db.writes('ediel_messages')).toEqual([])
})
it('preserves default missing-identity refusal and ordinary healthy catalog selection', async () => {
  expect(await resolveSupplyEndBirthProfile({rawPayload: wire(), receivedAt})).toBeNull()
  expect(catalogCalls()).toEqual([])
  expect(await resolveSupplyEndBirthProfile({rawPayload: wire(object('1', '735999000000000001')), receivedAt})).toEqual(expectedProfile())
  expect(catalogCalls()).toHaveLength(1)
})
it('requires an actually rejected identity and preserves a healthy sibling as catalog evidence only', async () => {
  expect(await resolveSupplyEndBirthProfile(explicitInput(wire(object('1', '735999000000000001'))))).toBeNull()
  expect(catalogCalls()).toEqual([])
  expect(await resolveSupplyEndBirthProfile(explicitInput(wire([...object('1', '735999000000000001'), ...object('2')])))).toEqual(expectedProfile())
  expect(catalogCalls()).toHaveLength(1)
})
it.each([
  ['duplicate LI', () => wire([...object(), ...object('2', '', 'OWN-1')])],
  ['sequence', () => wire(object('2'))],
  ['register', () => wire(object().map(p => p[0] === 'LIN' ? ['LIN', '1', '', ['', '', '', '9'], ['1', '1']] as Parts : p))],
  ['missing LI', () => wire(object().filter(p => p[0] !== 'RFF'))],
  ['mixed reason', () => wire([...object(), ...object('2', '', 'OWN-2', 'Z22')])],
  ['L reason', () => wire(object('1', '', 'OWN-1', 'Z22'))],
  ['missing reason', () => wire(object().filter(p => !['CCI', 'CAV'].includes(p[0] as string)))],
  ['non-null malformed identity', () => wire(object().map(p => p[0] === 'LIN' ? ['LIN', '1', '', ['735999000000000001', 'WRONG', '', '9']] as Parts : p))],
] as const)('refuses explicit rejection catalog for %s without source or registry effects', async (_name, raw) => {
  expect(await resolveSupplyEndBirthProfile(explicitInput(raw()))).toBeNull()
  expect(catalogCalls()).toEqual([]); expect(db.writes('ediel_messages')).toEqual([])
})
it('refuses an invalid receipt clock before catalog access', async () => {
  await expect(resolveSupplyEndBirthProfile(explicitInput(wire(), 'invalid'))).rejects.toThrow('supply_end_birth_receipt_clock_invalid')
  expect(catalogCalls()).toEqual([])
})
it.each(['empty', 'ambiguous', 'foreign-profile', 'foreign-original', 'runtime-incomplete'])('preserves actual catalog %s failure without profile guessing', async change => {
  if (change === 'foreign-profile') row.profile.messageCode = 'Z04'
  if (change === 'foreign-original') row.original_snapshot.rulePack.id = 'FOREIGN'
  if (change === 'runtime-incomplete') row.validator_ready = false
  if (change === 'empty' || change === 'ambiguous') io.rpc.mockResolvedValue({data: change === 'empty' ? [] : [row, row], error: null})
  await expect(resolveSupplyEndBirthProfile(explicitInput())).rejects.toThrow(/canonical_(rule_pack_evidence|original_rule_witness)/)
  expect(catalogCalls()).toHaveLength(1); expect(db.writes('ediel_messages')).toEqual([])
})
it('binds actual public INSERT to the retained raw/mail clock and complete rejection catalog witness', async () => {
  const request = setup(), before = structuredClone(row)
  expect(await createInboundEdielMessage(request)).toBe(newId)
  const writes = db.writes('ediel_messages'); expect(writes).toHaveLength(1)
  expect(writes[0].payload).toMatchObject({...expectedProfile(), raw_payload: request.parsed.rawPayload, message_received_at: receivedAt,
    company_id: company, environment: 'test', metering_point_id: null, inbound_email_message_id: mailId, mailbox_message_id: mailId})
  for (const key of ['execution_context_snapshot', 'bilateral_capability_verified', 'business_effect_authorized']) expect(writes[0].payload).not.toHaveProperty(key)
  expect(catalogCalls()).toHaveLength(1)
  expect(db.state.rpcCalls.map(c => c.name)).toEqual(['gridex_actor_has_company_permission', 'ediel_record_inbound_reception_v1'])
  expect(db.writes('outbound_requests')).toEqual([]); expect(row).toEqual(before)
})
it('preserves healthy public selection and existing replay without extra catalog reads', async () => {
  const request = setup(wire(object('1', '735999000000000001')))
  expect(await createInboundEdielMessage(request)).toBe(newId); expect(catalogCalls()).toHaveLength(1)
  vi.clearAllMocks(); const replay = setup(wire(object('1', '735999000000000001'))); db.state.existing = true
  expect(await createInboundEdielMessage(replay)).toBe(oldId); expect(catalogCalls()).toEqual([])
})
it('does not turn an ordinary catalog error into a rejection fallback', async () => {
  const request = setup(wire(object('1', '735999000000000001')))
  io.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => name === 'resolve_canonical_ediel_rule_pack_with_witness_v1'
    ? {data: [], error: null} : db.rpc(name, args))
  await expect(createInboundEdielMessage(request)).rejects.toThrow(/canonical_rule_pack_evidence/)
  expect(catalogCalls()).toHaveLength(1); expect(db.writes('ediel_messages')).toEqual([])
})
