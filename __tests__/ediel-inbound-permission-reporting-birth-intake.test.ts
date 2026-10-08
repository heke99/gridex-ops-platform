// Component-only LOCAL_SYNTHETIC SDK ports. Real public creator, parser and
// catalog resolver; no PostgreSQL admission, permission/grant or native proof.
import { beforeEach, expect, it, vi } from 'vitest'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { company, actor, mailId, parseId, oldId, newId, receivedAt, inboundReceptionBoundary } from './fixtures/inbound-reception-db'

const io = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
const checksum = 'a'.repeat(64)
const cases = [['S17', 'V'], ['S18', 'VH'], ['Z96', 'N']] as const
type Reason = typeof cases[number][0]
type Subtype = typeof cases[number][1]

// Declared catalog shape follows the resolver's source component #696; these
// rows explicitly provide synthetic SDK evidence, never an accepted DB seed.
function catalogRow(reason: Reason, subtype: Subtype) {
  const profile = { family: 'PRODAT', source: 'canonical-db-rule-pack', messageCode: 'Z14',
    guideVersion: '26.A', guideRevision: '3', canonicalDirection: 'inbound',
    transactionSubtype: subtype as string, reasonForTransaction: reason as string }
  const rulePackId = '11111111-1111-4111-8111-111111111111'
  const profileId = '22222222-2222-4222-8222-222222222222'
  const profileKey = `PRODAT:Z14:${subtype}:26.A:r3`
  return { rule_pack_id: rulePackId, message_profile_id: profileId, market: 'electricity', family: 'PRODAT',
    guide_version: '26.A', guide_revision: '3', unh_association_code: 'E2SE6A',
    valid_from: '2026-04-01', valid_to: null, source_document: 'LOCAL_SYNTHETIC SDK CATALOG PORT',
    source_hash: checksum, field_matrix_version: '26A-r3', profile_key: profileKey,
    business_process: 'permission_reporting', phase: null, profile,
    parser_ready: true, builder_ready: true, validator_ready: true, ack_ready: true, state_machine_ready: true,
    original_version: '26.A:r3', original_snapshot: {
      rulePack: { id: rulePackId, source_hash: checksum, guide_version: '26.A', guide_revision: '3' },
      messageProfile: { id: profileId, rule_pack_id: rulePackId, profile_key: profileKey, profile }, guideSources: [],
    } }
}
function object(reason: string) {
  return ['LIN+1', 'CCI++Z13', `CAV+${reason}`, 'RFF+LI:OWN-REPORT']
}
function wire(reason: Reason, body = object(reason)) {
  return EdifactEnvelopeCodec.encode({ sender: '54321', receiver: '12345', senderQualifier: 'ZZ', receiverQualifier: 'ZZ',
    interchangeReference: 'INTAKE1', acknowledgementRequest: true, environment: 'test',
    applicationReference: '23-DGI-PRODAT', createdAt: new Date('2026-09-21T10:00:00Z'),
    messages: [{ messageReference: 'REPORT1', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A',
      businessSegments: ['BGM+Z14+REPORT-DOC+9+AB', 'DTM+137:202609211000:203', 'DTM+ZZZ:1:805', ...body] }],
  })
}
let db: ReturnType<typeof inboundReceptionBoundary>
let row: ReturnType<typeof catalogRow>
function setup(reason: Reason = 'S17', subtype: Subtype = 'V', body?: string[]) {
  const parsed = parseInboundEmailContent({ attachmentText: wire(reason, body) })
  if (!parsed) throw Error('actual_parser_required')
  db = inboundReceptionBoundary(parsed); db.state.existing = false
  row = catalogRow(reason, subtype)
  io.from.mockImplementation(db.from)
  io.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === 'resolve_canonical_ediel_rule_pack_with_witness_v1') {
      expect(db.writes('ediel_messages')).toEqual([])
      expect(db.state.calls.some(call => call.table === 'inbound_email_messages')).toBe(true)
      return { data: [row], error: null }
    }
    return db.rpc(name, args)
  })
  return { companyId: company, actorUserId: actor, environment: 'test', inboundEmailMessageId: mailId,
    parseResultId: parseId, parsed }
}
const catalogCalls = () => io.rpc.mock.calls.filter(([name]) => name === 'resolve_canonical_ediel_rule_pack_with_witness_v1')
const witnessKeys = ['canonical_rule_pack_id', 'rule_profile_key', 'rule_profile_version_id', 'rule_profile_version', 'rule_pack_checksum', 'rule_pack_snapshot']
beforeEach(() => vi.clearAllMocks())

it.each(cases)('binds own physical %s to the dated %s witness before public INSERT', async (reason, subtype) => {
  const request = setup(reason, subtype), original = structuredClone(row)
  expect(await createInboundEdielMessage(request)).toBe(newId)
  const writes = db.writes('ediel_messages')
  expect(writes).toHaveLength(1)
  expect(writes[0].operation).toBe('insert')
  expect(writes[0].payload).toMatchObject({ company_id: company, environment: 'test', raw_payload: request.parsed.rawPayload,
    inbound_email_message_id: mailId, mailbox_message_id: mailId, message_received_at: receivedAt,
    canonical_rule_pack_id: row.rule_pack_id, rule_profile_key: row.profile_key,
    rule_profile_version_id: row.message_profile_id, rule_profile_version: row.original_version,
    rule_pack_checksum: checksum, rule_pack_snapshot: { ...row.original_snapshot,
      profileKey: row.profile_key, profileVersionId: row.message_profile_id, version: row.original_version, checksum } })
  expect(catalogCalls()).toEqual([['resolve_canonical_ediel_rule_pack_with_witness_v1', {
    p_market: 'electricity', p_family: 'PRODAT', p_message_code: 'Z14', p_transaction_subtype: subtype,
    p_direction: 'inbound', p_business_date: '2026-09-21' }]])
  expect(db.state.rpcCalls.map(call => call.name)).toEqual(['gridex_actor_has_company_permission', 'ediel_record_inbound_reception_v1'])
  for (const key of ['execution_context_snapshot', 'accepted', 'business_effect_authorized', 'permission_verified', 'reporting_knowledge']) expect(writes[0].payload).not.toHaveProperty(key)
  expect(db.writes('outbound_requests')).toEqual([])
  expect(row).toEqual(original)
})

function patchMail(patch: Record<string, unknown>) {
  io.from.mockImplementation((table: string) => {
    const query = db.from(table)
    if (table === 'inbound_email_messages') {
      const original = query.maybeSingle
      query.maybeSingle = async () => { const result = await original(); return { ...result, data: result.data ? { ...result.data, ...patch } : result.data } }
    }
    return query
  })
}
it('selects the retained zoned receipt day across Stockholm midnight, independent of wire date', async () => {
  const request = setup(); patchMail({ received_at: '2026-09-21T22:30:00Z' })
  expect(await createInboundEdielMessage(request)).toBe(newId)
  expect(catalogCalls()).toEqual([['resolve_canonical_ediel_rule_pack_with_witness_v1', {
    p_market: 'electricity', p_family: 'PRODAT', p_message_code: 'Z14', p_transaction_subtype: 'V',
    p_direction: 'inbound', p_business_date: '2026-09-22' }]])
  expect(db.writes('ediel_messages')[0].payload).toHaveProperty('message_received_at', '2026-09-21T22:30:00.000Z')
})
it.each(['first_reception', 'protocol_duplicate', 'identity_conflict'] as const)('keeps existing source unchanged for %s without catalog reselection', async classification => {
  const request = setup(); db.state.existing = true; db.state.classification = classification
  const original = structuredClone(db.state.original)
  if (classification === 'first_reception') expect(await createInboundEdielMessage(request)).toBe(oldId)
  else await expect(createInboundEdielMessage(request)).rejects.toThrow()
  expect(catalogCalls()).toEqual([]); expect(db.writes('ediel_messages')).toEqual([])
  expect(db.state.original).toEqual(original)
  expect(db.state.rpcCalls.map(call => call.name)).toEqual(['gridex_actor_has_company_permission', 'ediel_record_inbound_reception_v1'])
})
it.each(['actor', 'permission', 'environment', 'parse'])('refuses %s before catalog/source effects', async guard => {
  const request = setup()
  if (guard === 'actor') db.state.actorActive = false
  if (guard === 'permission') db.state.permission = false
  if (guard === 'environment') request.environment = 'foreign'
  if (guard === 'parse') request.parseResultId = ''
  const errors: Record<string, string> = { actor: 'ediel_tenant_actor_forbidden', permission: 'ediel_tenant_permission_forbidden',
    environment: 'ediel_inbound_duplicate_scope_required', parse: 'ediel_real_reception_actor_and_parse_required' }
  await expect(createInboundEdielMessage(request)).rejects.toThrow(errors[guard])
  expect(catalogCalls()).toEqual([]); expect(db.writes('ediel_messages')).toEqual([])
  expect(db.state.rpcCalls.filter(call => call.name === 'ediel_record_inbound_reception_v1')).toEqual([])
})
it.each([{ id: 'foreign' }, { company_id: 'foreign' }, { environment: 'production' }, { received_at: null }, { received_at: 'invalid' }])('refuses invalid retained mail %j before catalog/INSERT', async patch => {
  const request = setup(); patchMail(patch)
  await expect(createInboundEdielMessage(request)).rejects.toThrow('ediel_actual_inbound_receipt_clock_required')
  expect(catalogCalls()).toEqual([]); expect(db.writes('ediel_messages')).toEqual([])
  expect(db.state.rpcCalls.map(call => call.name)).toEqual(['gridex_actor_has_company_permission'])
})
it.each(['empty', 'ambiguous', 'foreign-subtype', 'foreign-direction', 'foreign-original', 'missing-original', 'runtime-incomplete', 'sdk-error'])('propagates actual catalog %s refusal before INSERT/reception', async change => {
  const request = setup()
  if (change === 'foreign-subtype') row.profile.transactionSubtype = 'VH'
  if (change === 'foreign-direction') row.profile.canonicalDirection = 'outbound'
  if (change === 'foreign-original') row.original_snapshot.rulePack.id = 'foreign-original'
  if (change === 'runtime-incomplete') row.validator_ready = false
  const submitted = change === 'missing-original' ? { ...row, original_snapshot: null } : row
  io.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === 'resolve_canonical_ediel_rule_pack_with_witness_v1') return {
      data: change === 'empty' ? [] : change === 'ambiguous' ? [submitted, submitted] : [submitted],
      error: change === 'sdk-error' ? { message: 'LOCAL_SYNTHETIC SDK failure' } : null }
    return db.rpc(name, args)
  })
  await expect(createInboundEdielMessage(request)).rejects.toThrow(/canonical_(rule_pack_evidence|original_rule_witness)/)
  expect(catalogCalls()).toHaveLength(1); expect(db.writes('ediel_messages')).toEqual([])
  expect(db.writes('ediel_message_events')).toEqual([])
  expect(db.state.rpcCalls.map(call => call.name)).toEqual(['gridex_actor_has_company_permission'])
})
it.each([
  ['LIN+1', 'RFF+LI:MISSING'],
  ['LIN+1', 'CCI++Z13', 'CAV+S17', 'CAV+S18', 'RFF+LI:DUPLICATE'],
  ['CCI++Z13', 'CAV+S17', 'LIN+1', 'RFF+LI:HEADER'],
  [...object('S17'), 'LIN+2', 'CCI++Z13', 'CAV+S18', 'RFF+LI:MIXED'],
])('leaves ambiguous physical selector %j to unchanged later birth validation without injecting a witness', async (...body) => {
  const request = setup('S17', 'V', body)
  expect(await createInboundEdielMessage(request)).toBe(newId) // finite INSERT port, not actual PG acceptance
  expect(catalogCalls()).toEqual([])
  for (const key of witnessKeys) expect(db.writes('ediel_messages')[0].payload).not.toHaveProperty(key)
  expect(db.writes('outbound_requests')).toEqual([])
})
it('preserves the race-winner original unchanged after a public unique conflict', async () => {
  const request = setup(), winner = inboundReceptionBoundary(request.parsed), original = structuredClone(winner.state.original)
  db.state.error = { code: '23505', message: 'canonical duplicate' }
  io.from.mockImplementation((table: string) => {
    const query = db.from(table)
    if (table === 'ediel_messages') {
      const insert = query.insert
      query.insert = payload => { db.state.existing = true; return insert(payload) }
    }
    return query
  })
  const rpc = io.rpc.getMockImplementation()!
  io.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === 'ediel_record_inbound_reception_v1' ? winner.rpc(name, args) : rpc(name, args))
  expect(await createInboundEdielMessage(request)).toBe(oldId)
  expect(catalogCalls()).toHaveLength(1)
  expect(db.writes('ediel_messages').map(call => call.operation)).toEqual(['insert'])
  expect(winner.state.original).toEqual(original); expect(db.state.original).toEqual(original)
  expect(db.writes('outbound_requests')).toEqual([])
})

it.each(['actor', 'catalog'].flatMap(stage => ['companyId', 'inboundEmailMessageId'].map(field => ({ stage, field }))))(
  'keeps actual SDK principal A after caller $field changes at $stage await', async ({ stage, field }) => {
    const request = setup(), originalCatalog = structuredClone(row), originalSource = structuredClone(db.state.original)
    const foreign = '00000000-0000-4000-8000-000000000099'
    const originalRpc = io.rpc.getMockImplementation()!
    io.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      const result = await originalRpc(name, args) // real A permission result or declared stored A catalog row
      if (name === (stage === 'actor' ? 'gridex_actor_has_company_permission' : 'resolve_canonical_ediel_rule_pack_with_witness_v1')) {
        if (field === 'companyId') request.companyId = foreign
        else request.inboundEmailMessageId = foreign
      }
      return result
    })
    let returned: string | null | undefined, failure: unknown
    try { returned = await createInboundEdielMessage(request) } catch (error) { failure = error }
    // Assert attempted privileged IO outside the caught downstream refusal.
    // No return of foreign data or completed foreign durable effect is claimed.
    expect(request[field as 'companyId' | 'inboundEmailMessageId']).toBe(foreign)
    const selects = db.state.calls.filter(call => call.table === 'ediel_messages' && call.operation === 'select')
    expect(selects.length).toBeGreaterThan(0)
    for (const call of selects) expect(call.filters).toContainEqual(['company_id', company])
    const mailReads = db.state.calls.filter(call => call.table === 'inbound_email_messages')
    expect(mailReads.length).toBeGreaterThan(0)
    for (const call of mailReads) expect(call.filters).toContainEqual(['id', mailId])
    expect(db.state.rpcCalls.find(call => call.name === 'ediel_record_inbound_reception_v1')?.args).toMatchObject({
      p_company_id: company, p_message_id: newId, p_actor_user_id: actor,
      p_inbound_email_message_id: mailId, p_parse_result_id: parseId,
    })
    expect(db.writes('ediel_messages')).toHaveLength(1)
    expect(db.writes('ediel_messages')[0].payload).toMatchObject({ company_id: company, raw_payload: request.parsed.rawPayload,
      inbound_email_message_id: mailId, mailbox_message_id: mailId, message_received_at: receivedAt })
    expect(db.state.rpcCalls.find(call => call.name === 'gridex_actor_has_company_permission')?.args)
      .toMatchObject({ p_company_id: company, p_actor_user_id: actor, p_permission: 'communication.write' })
    expect(row).toEqual(originalCatalog); expect(db.state.original).toEqual(originalSource)
    expect(db.writes('outbound_requests')).toEqual([])
    expect(failure).toBeUndefined(); expect(returned).toBe(newId)
  },
)

it.each(['optional-match', 'mail-principal'])('preserves denied actor classification before %s getter error', async boundary => {
  const request = setup(); db.state.permission = false
  let reads = 0
  Object.defineProperty(request, boundary === 'optional-match' ? 'outboundMatch' : 'inboundEmailMessageId', {
    enumerable: true, get: () => { reads++; throw new Error('caller_getter_must_not_outrank_actor_denial') },
  })
  await expect(createInboundEdielMessage(request)).rejects.toThrow('ediel_tenant_permission_forbidden')
  if (boundary === 'optional-match') expect(reads).toBe(0)
  expect(catalogCalls()).toEqual([]); expect(db.writes('ediel_messages')).toEqual([])
  expect(db.state.calls.filter(call => call.table === 'inbound_email_messages')).toEqual([])
  expect(db.state.rpcCalls.map(call => call.name)).toEqual(['gridex_actor_has_company_permission'])
})
