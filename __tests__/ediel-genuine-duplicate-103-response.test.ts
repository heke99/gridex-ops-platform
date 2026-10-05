// masterplan: ACK-09, AT-ACK-09
import { expectOwnReferencePair } from './helpers/p16bHold'
// Finite external native-owner responses model IO only. The actual opaque
// source-read capability, envelope, complete UNSM and national preflight run.
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { originalRuleWitnessFixture } from './helpers/originalRuleWitnessFixture'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import type { EdielMessageRow } from '@/lib/ediel/types'
const io = vi.hoisted(() => ({ rpc: vi.fn(), smtp: vi.fn(), commits: [] as Record<string, unknown>[] }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))
vi.mock('@/lib/ediel/mailReadiness', () => ({ assertEdielSmtpReadiness: io.smtp }))
import { prepareDuplicate103Response } from '@/lib/ediel/inbound/duplicateResponses'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const input = { companyId: id(1), sourceMessageId: id(3), actorUserId: id(2), inboundEmailMessageId: id(4) }
const digest = (s: string) => createHash('sha256').update(s).digest('hex')
const witness = originalRuleWitnessFixture({ profileKey: 'DECLARED:P26', messageProfileId: id(20), rulePackId: id(21), sourceHash: 'a'.repeat(64) })
const pack = { ...witness, snapshot: { ...witness.snapshot, rulePack: { ...witness.snapshot.rulePack, family: 'PRODAT' }, profileKey: witness.profileKey, profileVersionId: witness.messageProfileId, version: witness.version, checksum: witness.sourceHash } }
function raw(li = false) {
  return EdifactEnvelopeCodec.encode({ sender: '90001', senderQualifier: 'ZZ', senderSubAddress: 'S', receiver: '90002', receiverQualifier: 'ZZ', receiverSubAddress: 'R', applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: true, interchangeReference: 'ORIGINAL', environment: 'test', messages: [{ messageReference: 'M', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: ['BGM+Z03+DOC+9+AB', 'DTM+137:202610010900:203', 'DTM+ZZZ:1:805', 'NAD+FR+54321:160:SVK+++++++SE', 'NAD+DO+12345:160:SVK+++++++SE', 'LIN+1++735123456789012345:::9', 'CCI++Z13', 'CAV+Z22', ...(li ? ['RFF+LI:ORIGINAL-LI'] : [])] }] })
}
let original: EdielMessageRow
let qualified: Record<string, unknown>
const smtp = { from: 'local@example.invalid', host: 'smtp.example.invalid', port: 587 }
function install(li = false) {
  original = { id: input.sourceMessageId, company_id: input.companyId, direction: 'inbound', message_standard: 'edifact', message_family: 'PRODAT', message_code: 'Z03', environment: 'test', raw_payload: raw(li), message_received_at: '2026-10-01T08:00:00Z', parsed_payload: {} } as unknown as EdielMessageRow
  qualified = { status: 'qualified', sourceMessage: original, sourceHash: digest(original.raw_payload!), receptionId: id(5), responseRequestId: id(6), serverDate203: '202610010930', sourceReceivedDate203: '202610010915', businessEffectAuthorized: false, route: {
    companyId: input.companyId, environment: 'test', sourceMessageId: input.sourceMessageId, sourceHash: digest(original.raw_payload!), senderEdielId: '90002', senderQualifier: 'ZZ', senderSubAddress: 'R', receiverEdielId: '90001', receiverQualifier: 'ZZ', receiverSubAddress: 'S', applicationReference: '23-DDQ-PRODAT', senderEmail: smtp.from, receiverEmail: 'remote@example.invalid', mailbox: smtp.from, smtpHost: smtp.host, smtpPort: smtp.port, authorizesBusinessEffect: false,
    route: { id: id(7), company_id: input.companyId, is_active: true }, routeRuntime: { route_profile_id: id(8), company_id: input.companyId, communication_route_id: id(7), environment: 'test', is_enabled: true },
  } }
  io.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (args.p_company_id !== input.companyId || (args.p_source_message_id ?? args.p_message_id) !== input.sourceMessageId) throw Error('declared_exact_source_required')
    if (name === 'ediel_read_source_rule_pack_basis_v1') return { data: { version: 1, sourceMessage: original, sourceRulePackEvidence: pack }, error: null }
    if (args.p_actor_user_id !== input.actorUserId || args.p_inbound_email_message_id !== input.inboundEmailMessageId) throw Error('declared_exact_new_mail_actor_required')
    if (name === 'ediel_prepare_duplicate_103_response_v1') return { data: { ...qualified, route: args.p_smtp ? qualified.route : null }, error: null }
    if (name === 'ediel_commit_duplicate_103_response_v1') {
      io.commits.push(args)
      return { data: { status: 'protocol_response_prepared', ackMessage: { ...original, id: id(9), direction: 'outbound', message_family: 'APERAK', related_message_id: original.id, ack_outcome: 'negative', raw_payload: (args.p_draft as { rawPayload: string }).rawPayload }, outboxId: id(10), receptionId: id(5), responseRequestId: id(6), businessEffectAuthorized: false, replayed: false }, error: null }
    }
    throw Error('undeclared_native_port:' + name)
  })
}
beforeEach(() => { vi.resetAllMocks(); io.commits.length = 0; io.smtp.mockReturnValue(smtp); install() })
describe('a genuine new reception has a separate 103 protocol response', () => {
  it('runs the actual strict single-own-reference renderer, retains original parties/ACW and only native atomic commit', async () => {
    const r = await prepareDuplicate103Response(input)
    expect(r.status).toBe('protocol_response_prepared'); expect(io.commits).toHaveLength(1)
    // P26.A p99 DTM178/A901: actual NEW reception at08:15Z; canonical
    // original's first08:00Z timestamp remains unchanged on its stored row.
    expect(r.ackMessage.raw_payload).toContain('DTM+178:202610010915:203')
    expect(r.ackMessage.raw_payload).not.toContain('DTM+178:202610010900:203')
    expect(original.message_received_at).toBe('2026-10-01T08:00:00Z')
    const wire = tokenizeEdifact(r.ackMessage.raw_payload), tags = wire.segments.map(s => s.tag)
    expect(tags).toEqual(['UNB', 'UNH', 'BGM', 'DTM', 'DTM', 'RFF', 'NAD', 'NAD', 'ERC', 'FTX', 'RFF', 'UNT', 'UNZ'])
    expect(segmentComposite(wire.segments.find(s => s.tag === 'BGM'), 3, wire.una)).toEqual(['27'])
    expect(r.ackMessage.raw_payload).toContain('RFF+ACW:DOC')
    expect(r.ackMessage.raw_payload).toContain('NAD+FR+12345:160:SVK+++++++SE')
    expect(r.ackMessage.raw_payload).toContain('NAD+DO+54321:160:SVK+++++++SE')
    expect(r.ackMessage.raw_payload).toContain('ERC+40::260'); expect(r.ackMessage.raw_payload).toContain('FTX+AAO++103::260+Dubblett av meddelandet')
    expect(r.ackMessage.raw_payload).toContain('RFF+Z07:735123456789012345')
    expect(io.commits[0]).not.toHaveProperty('sourceAuthority')
  })
  it('reads committed response before broken SMTP, route, renderer or a new commit', async () => {
    const saved = { status: 'protocol_response_prepared', ackMessage: { ...original, id: id(9), direction: 'outbound', message_family: 'APERAK', related_message_id: original.id, ack_outcome: 'negative', raw_payload: 'immutable-own-response' }, outboxId: id(10), receptionId: id(5), responseRequestId: id(6), businessEffectAuthorized: false, replayed: true }
    io.rpc.mockResolvedValueOnce({ data: saved, error: null }); io.smtp.mockImplementation(() => { throw Error('smtp_revoked') })
    expect(await prepareDuplicate103Response(input)).toEqual(saved)
    expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_prepare_duplicate_103_response_v1', expect.objectContaining({ p_smtp: null }))
    expect(io.smtp).not.toHaveBeenCalled(); expect(io.commits).toHaveLength(0)
  })
  it('retains both known point and LI in one E2SE6A ERC and commits the 103 response (P16B resolved)', async () => {
    install(true)
    await prepareDuplicate103Response(input)
    expect(io.commits).toHaveLength(1)
    expectOwnReferencePair([JSON.stringify(io.commits[0]).match(/UNA[^"]*/)?.[0]?.replace(/\\'/g, "'") ?? ''])
  })
  it.each(['current_actor_denied', 'same_identity_different_original', 'captured_role_revoked', 'guide_cutoff_held'])('holds native %s without SMTP or effects', async error => {
    io.rpc.mockResolvedValueOnce({ data: null, error: Error(error) })
    await expect(prepareDuplicate103Response(input)).rejects.toThrow(error)
    expect(io.smtp).not.toHaveBeenCalled(); expect(io.commits).toHaveLength(0)
  })
  it('does not commit source bytes changed between native original ports', async () => {
    const fixture = io.rpc.getMockImplementation()!
    io.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === 'ediel_read_source_rule_pack_basis_v1' ? Promise.resolve({ data: { version: 1, sourceMessage: { ...original, raw_payload: original.raw_payload + ' ' }, sourceRulePackEvidence: pack }, error: null }) : fixture(name, args))
    await expect(prepareDuplicate103Response(input)).rejects.toThrow('original_changed'); expect(io.commits).toHaveLength(0)
  })
  it('holds current revocation at final native commit without fallback or original ACK mutation', async () => {
    const fixture = io.rpc.getMockImplementation()!
    io.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === 'ediel_commit_duplicate_103_response_v1' ? Promise.resolve({ data: null, error: Error('native_current_prepare_revoked') }) : fixture(name, args))
    await expect(prepareDuplicate103Response(input)).rejects.toThrow('native_current_prepare_revoked')
    expect(io.commits).toHaveLength(0)
    expect(io.rpc.mock.calls.filter(([name]) => String(name).includes('commit'))).toHaveLength(1)
  })
})
