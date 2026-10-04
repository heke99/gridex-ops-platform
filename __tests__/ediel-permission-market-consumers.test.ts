import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyPermissionMarketSource, advancePermissionMarketDeadlines } from '@/lib/ediel/permissions/permissionMarketTransition'
import { applyZ14SnapshotToMeteringPermission } from '@/lib/onboarding/infoRequests'
import { handleZ15PermissionTermination } from '@/lib/ediel/permissions/z15HandleTermination'
import type { EdielMessageRow } from '@/lib/ediel/types'

const io = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), governance: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: io }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: io.governance }))
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
})
