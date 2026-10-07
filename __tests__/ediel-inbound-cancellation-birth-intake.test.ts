// Component-only public parser/creator with declared SDK ports. No whole C
// acceptance, source admission or business authority is supplied by this port.
import { beforeEach, expect, it, vi } from 'vitest'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { guideOrderedFixtureRaw } from './helpers/prodatGuideOrderedFixture'
import { characteristic, line } from './fixtures/prodat-register'
import { company, actor, mailId, parseId, oldId, newId, receivedAt, inboundReceptionBoundary } from './fixtures/inbound-reception-db'

const io = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
const checksum = 'a'.repeat(64)
function catalogRow(code: string) {
  const profile = { family: 'PRODAT', source: 'canonical-db-rule-pack', messageCode: code,
    guideVersion: '26.A', guideRevision: '3', canonicalDirection: 'inbound',
    transactionSubtype: 'C', reasonForTransaction: 'Z24' }
  return {
    rule_pack_id: '11111111-1111-4111-8111-111111111111',
    message_profile_id: '22222222-2222-4222-8222-222222222222',
    market: 'electricity', family: 'PRODAT', guide_version: '26.A', guide_revision: '3',
    unh_association_code: 'E2SE6A', valid_from: '2026-04-01', valid_to: null,
    source_document: 'SYNTHETIC DECLARED SDK PORT', source_hash: checksum,
    field_matrix_version: '26A-r3', profile_key: `PRODAT:${code}:C:26.A:r3`,
    business_process: code === 'Z04' ? 'supplier_switch' : 'supply_end', phase: null, profile,
    parser_ready: true, builder_ready: true, validator_ready: true, ack_ready: true, state_machine_ready: true,
    original_version: '26.A:r3', original_snapshot: {
      rulePack: { id: '11111111-1111-4111-8111-111111111111', source_hash: checksum, guide_version: '26.A', guide_revision: '3' },
      messageProfile: { id: '22222222-2222-4222-8222-222222222222', rule_pack_id: '11111111-1111-4111-8111-111111111111', profile_key: `PRODAT:${code}:C:26.A:r3`, profile },
      guideSources: [],
    },
  }
}
const wire = (code: string) => guideOrderedFixtureRaw([
  line('1', '735999000000001', undefined, '9'), ...characteristic('Z13', 'Z24'), ['RFF', ['LI', 'OWN-C']]], code)
function parsed(payload: string) {
  const result = parseInboundEmailContent({ attachmentText: payload })
  if (!result) throw Error('actual_parser_required')
  return result
}
let db: ReturnType<typeof inboundReceptionBoundary>
let row: ReturnType<typeof catalogRow>
function setup(code: string) {
  const payload = wire(code)
  db = inboundReceptionBoundary(parsed(payload)); db.state.existing = false
  row = catalogRow(code)
  io.from.mockImplementation(db.from)
  io.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === 'resolve_canonical_ediel_rule_pack_with_witness_v1') {
      expect(db.writes('ediel_messages')).toEqual([])
      return { data: [row], error: null }
    }
    return db.rpc(name, args)
  })
  return { companyId: company, actorUserId: actor, environment: 'test', inboundEmailMessageId: mailId,
    parseResultId: parseId, parsed: parsed(payload) }
}
beforeEach(() => vi.clearAllMocks())

it.each(['Z04', 'Z05'])('binds physical %s/Z24 through the actual catalog resolver before public INSERT', async code => {
  const request = setup(code), originalCatalog = structuredClone(row)
  expect(await createInboundEdielMessage(request)).toBe(newId)
  const writes = db.writes('ediel_messages')
  expect(writes).toHaveLength(1)
  expect(writes[0].payload).toMatchObject({ raw_payload: request.parsed.rawPayload, message_received_at: receivedAt,
    canonical_rule_pack_id: row.rule_pack_id, rule_profile_key: row.profile_key,
    rule_profile_version_id: row.message_profile_id, rule_profile_version: row.original_version,
    rule_pack_checksum: checksum, rule_pack_snapshot: { ...row.original_snapshot,
      profileKey: row.profile_key, profileVersionId: row.message_profile_id, version: row.original_version, checksum } })
  expect(io.rpc).toHaveBeenCalledWith('resolve_canonical_ediel_rule_pack_with_witness_v1', {
    p_market: 'electricity', p_family: 'PRODAT', p_message_code: code, p_transaction_subtype: 'C',
    p_direction: 'inbound', p_business_date: '2026-09-21' })
  expect(db.state.rpcCalls.map(call => call.name)).toEqual(['gridex_actor_has_company_permission', 'ediel_record_inbound_reception_v1'])
  for (const key of ['execution_context_snapshot', 'bilateral_capability_verified', 'business_effect_authorized']) expect(writes[0].payload).not.toHaveProperty(key)
  expect(db.writes('outbound_requests')).toEqual([])
  expect(row).toEqual(originalCatalog)
})

const catalogCalls = () => io.rpc.mock.calls.filter(([name]) => name === 'resolve_canonical_ediel_rule_pack_with_witness_v1')
it.each(['Z04', 'Z05'])('preserves existing %s C original on replay without catalog reselection', async code => {
  const request = setup(code); db.state.existing = true
  const original = structuredClone(db.state.original)
  expect(await createInboundEdielMessage(request)).toBe(oldId)
  expect(catalogCalls()).toEqual([]); expect(db.writes('ediel_messages')).toEqual([])
  expect(db.state.original).toEqual(original)
})
it.each(['Z04', 'Z05'].flatMap(code => ['actor', 'permission', 'environment', 'parse'].map(guard => ({ code, guard }))))('refuses $code C $guard before catalog or source effects', async ({ code, guard }) => {
  const request = setup(code)
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
it.each(['Z04', 'Z05'])('uses original zoned %s C receipt across Stockholm midnight instead of wire date', async code => {
  const request = setup(code); patchMail({ received_at: '2026-09-21T22:30:00Z' })
  expect(await createInboundEdielMessage(request)).toBe(newId)
  expect(catalogCalls()).toEqual([['resolve_canonical_ediel_rule_pack_with_witness_v1', {
    p_market: 'electricity', p_family: 'PRODAT', p_message_code: code, p_transaction_subtype: 'C',
    p_direction: 'inbound', p_business_date: '2026-09-22' }]])
  expect(db.writes('ediel_messages')[0].payload).toHaveProperty('message_received_at', '2026-09-21T22:30:00.000Z')
})
it.each(['Z04', 'Z05'].flatMap(code => [{ company_id: 'foreign' }, { environment: 'production' }, { received_at: null }, { received_at: 'invalid' }].map(patch => ({ code, patch }))))('refuses $code C invalid retained mail $patch before catalog or INSERT', async ({ code, patch }) => {
  const request = setup(code); patchMail(patch)
  await expect(createInboundEdielMessage(request)).rejects.toThrow('ediel_actual_inbound_receipt_clock_required')
  expect(catalogCalls()).toEqual([]); expect(db.writes('ediel_messages')).toEqual([])
  expect(db.state.rpcCalls.map(call => call.name)).toEqual(['gridex_actor_has_company_permission'])
})
it.each(['Z04', 'Z05'].flatMap(code => ['empty', 'ambiguous', 'foreign-code', 'foreign-subtype', 'foreign-direction', 'foreign-original', 'missing-original', 'runtime-incomplete', 'sdk-error'].map(change => ({ code, change }))))('propagates real $code C catalog $change before INSERT/reception', async ({ code, change }) => {
  const request = setup(code)
  if (change === 'foreign-code') row.profile.messageCode = code === 'Z04' ? 'Z05' : 'Z04'
  if (change === 'foreign-subtype') row.profile.transactionSubtype = 'H'
  if (change === 'foreign-direction') row.profile.canonicalDirection = 'outbound'
  if (change === 'foreign-original') row.original_snapshot.rulePack.id = 'foreign-original'
  if (change === 'runtime-incomplete') row.validator_ready = false
  const submitted = change === 'missing-original' ? { ...row, original_snapshot: null } : row
  io.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === 'resolve_canonical_ediel_rule_pack_with_witness_v1') return {
      data: change === 'empty' ? [] : change === 'ambiguous' ? [submitted, submitted] : [submitted],
      error: change === 'sdk-error' ? { message: 'declared SDK failure' } : null }
    return db.rpc(name, args)
  })
  await expect(createInboundEdielMessage(request)).rejects.toThrow(/canonical_(rule_pack_evidence|original_rule_witness)/)
  expect(catalogCalls()).toHaveLength(1); expect(db.writes('ediel_messages')).toEqual([])
  expect(db.writes('ediel_message_events')).toEqual([])
  expect(db.state.rpcCalls.map(call => call.name)).toEqual(['gridex_actor_has_company_permission'])
})
it.each(['Z04', 'Z05'])('keeps race winner %s C original immutable after public unique conflict', async code => {
  const request = setup(code), winner = inboundReceptionBoundary(request.parsed)
  const original = structuredClone(winner.state.original)
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
  expect(winner.state.rpcCalls.map(call => call.name)).toEqual(['ediel_record_inbound_reception_v1'])
  expect(db.writes('outbound_requests')).toEqual([])
})
