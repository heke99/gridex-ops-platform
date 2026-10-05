// masterplan: SC-020
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyPermissionMarketSource, advancePermissionMarketDeadlines } from '@/lib/ediel/permissions/permissionMarketTransition'
import { applyZ14SnapshotToMeteringPermission } from '@/lib/onboarding/infoRequests'
import { handleZ15PermissionTermination } from '@/lib/ediel/permissions/z15HandleTermination'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { processInboundAckMessage } from '@/lib/ediel/flows/inboundAckProcessing'
import { classifyProductionInboundDecision } from '@/lib/ediel/inbound/productionInboundDecisionEngine'

const io = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), governance: vi.fn(), events: vi.fn(), link: vi.fn(),
  status: vi.fn(), outboundRead: vi.fn(), outboundUpdate: vi.fn(), gridUpdate: vi.fn(), switchUpdate: vi.fn(),
  switchEvent: vi.fn(), caseAck: vi.fn(), actorTesting: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: io }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: io.governance }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: io.events, linkEdielMessage: io.link, updateEdielMessageStatus: io.status }))
vi.mock('@/lib/cis/db', () => ({ getOutboundRequestById: io.outboundRead, updateOutboundRequestStatus: io.outboundUpdate,
  updateGridOwnerDataRequestStatus: io.gridUpdate }))
vi.mock('@/lib/operations/db', () => ({ updateSupplierSwitchRequestStatus: io.switchUpdate, createSupplierSwitchEvent: io.switchEvent }))
vi.mock('@/lib/customer-cases/db', () => ({ syncCustomerCaseCancellationAck: io.caseAck }))
vi.mock('@/lib/ediel/actorTestingEngine', () => ({ syncActorTestingForMessage: io.actorTesting }))
const source = (extra: Record<string, unknown> = {}) => ({ id: 'real-source', company_id: 'tenant-a', direction: 'inbound', message_family: 'PRODAT', message_code: 'Z14', ...extra }) as EdielMessageRow
beforeEach(() => { vi.clearAllMocks(); io.rpc.mockResolvedValue({ data: { applied: true, permissionId: 'permission', status: 'active', idempotent: true }, error: null }) })

describe('all permission consumers dispatch the actual source, never caller snapshots', () => {
  it('passes exact tenant, source, execution actor and expected owner only', async () => {
    const result = await applyPermissionMarketSource({ actorUserId: 'actor', message: source({ parsed_payload: { status: 'active', approvedStartDate: '1999-01-01' }, validation_report: { canonicalAccepted: true } }), expectedPermissionId: 'permission' })
    expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_apply_permission_source_v1', { p_company_id: 'tenant-a', p_source_message_id: 'real-source', p_actor_user_id: 'actor', p_expected_permission_id: 'permission' })
    expect(result).toMatchObject({ applied: true, idempotent: true, permissionId: 'permission' })
  })
  it.each([{ company_id: null }, { direction: 'outbound' }, { message_family: 'UTILTS' }, { message_code: 'Z04' }])('does not submit unrelated or unassigned sources %s', async extra => {
    expect((await applyPermissionMarketSource({ actorUserId: 'actor', message: source(extra) })).applied).toBe(false)
    expect(io.rpc).not.toHaveBeenCalled()
  })
  it('preserves a durable held outcome rather than supplying a local fallback', async () => {
    io.rpc.mockResolvedValue({ data: { applied: false, reason: 'permission_original_mode_unavailable' }, error: null })
    expect(await applyPermissionMarketSource({ actorUserId: 'actor', message: source() })).toMatchObject({ applied: false, permissionId: null, reason: 'permission_original_mode_unavailable' })
  })
  it('rejects the former freehand manual activation before any DB mutation', async () => {
    await expect(applyZ14SnapshotToMeteringPermission({ companyId: 'tenant-a', actorUserId: 'actor', permissionId: 'permission', approvedStartDate: '2026-09-01', approvedSites: [{ facilityId: 'point', status: 'approved' }] })).rejects.toThrow('z14_received_source_required')
    expect(io.from).not.toHaveBeenCalled(); expect(io.rpc).not.toHaveBeenCalled()
  })
  it('bounds time projections and does not originate a market command', async () => {
    io.rpc.mockResolvedValue({ data: { updated: 2 }, error: null })
    expect(await advancePermissionMarketDeadlines({ actorUserId: 'actor', companyId: 'tenant-a', limit: 10000 })).toEqual({ updated: 2 })
    expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_advance_permission_deadlines_v1', { p_actor_user_id: 'actor', p_company_id: 'tenant-a', p_limit: 200 })
  })
  it.each(['UNKNOWN', '', 'A74'])('does not invent B80 for unknown end reason %s', reasonCode => {
    expect(() => handleZ15PermissionTermination({ currentState: 'active_after_z14v_or_z14vh', reasonCode })).toThrow('z15_termination_reason_unqualified')
  })
  it.each(['B77', 'B78'])('keeps actual legitimate end reason %s generic rather than relabeling B80', reasonCode => {
    expect(handleZ15PermissionTermination({ currentState: 'active_after_z14v_or_z14vh', reasonCode })).toBe('terminated_after_z15')
  })

  it('SC020 actual positive Z13 APERAK records receipt only and cannot enter permission activation', async () => {
    const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
    const company = uid(1), originalId = uid(2), ackId = uid(3), actor = uid(50), requestId = uid(4)
    const envelope = (acknowledgement: boolean) => EdifactEnvelopeCodec.encode({
      sender: acknowledgement ? '54321' : '21660', receiver: acknowledgement ? '21660' : '54321', environment: 'test',
      applicationReference: '23-DGI-PRODAT', interchangeReference: acknowledgement ? 'ACK-I' : 'Z13-I', acknowledgementRequest: false,
      messages: [{ messageReference: '1', messageTypeToken: acknowledgement ? 'APERAK:D:96A:UN:E2SE6A' : 'PRODAT:D:97A:UN:E2SE6A',
        businessSegments: acknowledgement
          ? ['BGM+++34', 'RFF+ACW:Z13-D', 'NAD+FR+54321:160:SVK', 'NAD+DO+21660:160:SVK', 'ERC+100', 'RFF+LI:Z13-LI']
          : ['BGM+Z13+Z13-D+9+AB', 'NAD+FR+21660:160:SVK', 'NAD+DO+54321:160:SVK', 'LIN+1', 'RFF+LI:Z13-LI'] }] })
    const original = { id: originalId, company_id: company, environment: 'test', direction: 'outbound', message_family: 'PRODAT',
      message_code: 'Z13', raw_payload: envelope(false), message_sent_at: '2026-09-30T12:00:00Z', outbound_request_id: requestId,
      switch_request_id: null, grid_owner_data_request_id: null } as EdielMessageRow
    const positiveAck = { id: ackId, company_id: company, environment: 'test', direction: 'inbound', message_family: 'APERAK',
      message_code: '34', raw_payload: envelope(true) } as EdielMessageRow
    // Declared ACK-storage and business writer ports; the actual physical
    // qualification, ACK consumer, classification and activation guard run.
    const permission = { id: uid(5), company_id: company, status: 'z13_sent', source_z14_message_id: null }
    const effects = { permission, sites: [] as unknown[], supplies: [] as unknown[], grants: [] as unknown[] }
    const before = structuredClone(effects)
    io.from.mockImplementation((table: string) => { throw Error(`Unexpected domain/access table: ${table}`) })
    const outbound = { id: requestId, company_id: company, source_type: 'metering_permission', source_id: permission.id,
      status: 'sent', sent_at: original.message_sent_at, response_payload: {} }
    io.outboundRead.mockResolvedValue(outbound)
    io.outboundUpdate.mockImplementation(async (input: { status: string }) => ({ ...outbound, status: input.status }))
    io.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'gridex_read_committed_inbound_ack_v2') return { data: null, error: null }
      if (name === 'gridex_read_inbound_ack_source_v1') return { data: { version: 1, sourceMessage: original }, error: null }
      if (name === 'gridex_apply_inbound_ack_source_v1') {
        expect(args).toEqual({ p_company_id: company, p_environment: 'test', p_ack_message_id: ackId,
          p_source_message_id: originalId, p_actor_user_id: actor })
        return { data: { version: 1, sourceMessage: { ...original, aperak_status: 'received', status: 'acknowledged' },
          outcome: 'positive', finalAckReached: true, wholeSourceRejected: false, sourceAccepted: true, failureReason: null }, error: null }
      }
      throw Error(`Unexpected activation/access RPC: ${name}`)
    })
    const result = await processInboundAckMessage({ actorUserId: actor, message: positiveAck })
    expect(result).toMatchObject({ outcome: 'positive', sourceAccepted: true, sourceMessage: { id: originalId, message_code: 'Z13' },
      outboundRequestId: requestId, switchRequestId: null, gridOwnerDataRequestId: null })
    expect(io.rpc.mock.calls.map(([name]) => name)).toEqual(['gridex_read_committed_inbound_ack_v2',
      'gridex_read_inbound_ack_source_v1', 'gridex_apply_inbound_ack_source_v1'])
    expect(io.link).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ edielMessageId: ackId, relatedMessageId: originalId, outboundRequestId: requestId }))
    expect(io.outboundUpdate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outboundRequestId: requestId, status: 'acknowledged' }))
    expect(classifyProductionInboundDecision({ messageFamily: 'APERAK', rawPayload: positiveAck.raw_payload }))
      .toMatchObject({ scenario: 'ack_message', businessEffect: 'register_ack' })
    expect(await applyPermissionMarketSource({ actorUserId: actor, message: positiveAck, expectedPermissionId: permission.id }))
      .toMatchObject({ applied: false, reason: 'not_inbound_permission_source' })
    expect(io.rpc).toHaveBeenCalledTimes(3)
    expect(io.from).not.toHaveBeenCalled(); expect(io.switchUpdate).not.toHaveBeenCalled(); expect(io.gridUpdate).not.toHaveBeenCalled()
    expect(effects).toEqual(before)
    expect(effects.permission).toMatchObject({ status: 'z13_sent', source_z14_message_id: null })
  })
})
