// Component-only public parser/creator with declared SDK ports. No whole C
// acceptance, source admission or business authority is supplied by this port.
import { beforeEach, expect, it, vi } from 'vitest'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { guideOrderedFixtureRaw } from './helpers/prodatGuideOrderedFixture'
import { characteristic, line } from './fixtures/prodat-register'
import { company, actor, mailId, parseId, newId, receivedAt, inboundReceptionBoundary } from './fixtures/inbound-reception-db'

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
