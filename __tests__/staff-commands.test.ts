import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), invitation: vi.fn(), roleGuard: vi.fn(), audit: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: mocks.rpc, from: mocks.from } }))
vi.mock('@/lib/auth/companyInvitationFlow', () => ({ provisionCompanyInvitation: mocks.invitation }))
vi.mock('@/lib/tenant/roleChangeGuard', () => ({ assertCompanyRoleChangeAllowed: mocks.roleGuard }))
vi.mock('@/lib/tenant/governance', () => ({ logTenantGovernanceEvent: mocks.audit, requireCompanyOperationalForWrites: vi.fn().mockResolvedValue({ name: 'Synthetic' }) }))

import { changeStaffRole, disableStaff, inviteStaff, listStaff, listStaffRoles, reactivateStaff, validateStaffRoleAssignment } from '@/lib/tenant/staffCommands'
import { getRoleProfilePermissions } from '@/lib/admin/accessModel'

const context = { companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actorUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', apiClientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', channel: 'staff_api' as const, permissions: getRoleProfilePermissions('company_admin') }
const target = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.roleGuard.mockResolvedValue(undefined)
  mocks.rpc.mockResolvedValue({ data: { user_id: target, role_key: 'customer_service_agent', membership_role: 'support', status: 'active' }, error: null })
  mocks.invitation.mockResolvedValue({ userId: null, email: 'staff@example.invalid', invitationToken: 'secret', acceptUrl: 'secret-link', emailSent: false })
})

describe('staff commands', () => {
  it('blocks users.write absence even when caller supplies a platform flag in staff API', async () => {
    await expect(disableStaff({ ...context, permissions: [], actorIsPlatformAdmin: true }, { userId: target })).rejects.toMatchObject({ code: 'staff_permission_denied', status: 403 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('requires the requested role permission set to fit inside the actor ceiling', async () => {
    await expect(inviteStaff({ ...context, permissions: ['users.write'] }, { email: 'staff@example.invalid', roleKey: 'company_admin' })).rejects.toMatchObject({ code: 'staff_role_ceiling_exceeded' })
    expect(mocks.invitation).not.toHaveBeenCalled()
  })
  it('provides the same ceiling check to OPS settings before profile side effects', () => {
    expect(() => validateStaffRoleAssignment({ ...context, permissions: ['users.write'] }, 'company_admin')).toThrowError(expect.objectContaining({ code: 'staff_role_ceiling_exceeded' }))
    expect(validateStaffRoleAssignment(context, 'customer_service_agent')).toEqual({ roleKey: 'customer_service_agent', membershipRole: 'support' })
  })
  it('rejects a platform role as a company role', async () => {
    await expect(inviteStaff(context, { email: 'staff@example.invalid', roleKey: 'super_admin' })).rejects.toMatchObject({ code: 'staff_role_not_assignable', status: 422 })
  })
  it('queues normalized invitation and keeps secrets outside the command result', async () => {
    const result = await inviteStaff(context, { email: ' STAFF@EXAMPLE.INVALID ', fullName: ' Staff ', roleKey: 'customer_service_agent', idempotencyKey: 'request-1' })
    expect(result).toEqual({ email: 'staff@example.invalid', role_key: 'customer_service_agent', membership_role: 'support', status: 'pending' })
    expect(mocks.invitation).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: context.actorUserId, apiClientId: context.apiClientId, channel: 'staff_api', staffOperation: 'invite', idempotencyKey: 'request-1', membershipRole: 'support' }))
  })
  it('blocks self disable for every actor including platform OPS', async () => {
    await expect(disableStaff(context, { userId: context.actorUserId })).rejects.toMatchObject({ code: 'staff_self_disable_forbidden', status: 409 })
    await expect(disableStaff({ ...context, channel: 'ops', actorIsPlatformAdmin: true }, { userId: context.actorUserId })).rejects.toMatchObject({ code: 'staff_self_disable_forbidden' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('returns typed conflicts for shared OPS preflight guards before the native write', async () => {
    await expect(changeStaffRole(context, { userId: context.actorUserId, roleKey: 'customer_service_agent' })).rejects.toMatchObject({ code: 'staff_self_role_change_forbidden', status: 409 })
    mocks.roleGuard.mockRejectedValue(new Error('Bolaget måste ha minst en aktiv administratör. Utse en ny administratör först.'))
    await expect(changeStaffRole(context, { userId: target, roleKey: 'customer_service_agent' })).rejects.toMatchObject({ code: 'staff_last_admin_required', status: 409 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('maps the atomic last administrator refusal to a conflict', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'staff_last_admin_required' } })
    await expect(disableStaff(context, { userId: target })).rejects.toMatchObject({ code: 'staff_last_admin_required', status: 409 })
  })
  it('carries actor and API provenance into the canonical command', async () => {
    const result = await changeStaffRole(context, { userId: target, roleKey: 'customer_service_agent', idempotencyKey: 'request-2' })
    expect(result).toEqual({ user_id: target, role_key: 'customer_service_agent', membership_role: 'support', status: 'active' })
    expect(mocks.rpc).toHaveBeenCalledWith('canonical_change_tenant_user_access', { p_command: expect.objectContaining({ company_id: context.companyId, actor_user_id: context.actorUserId, user_id: target, action: 'upsert', staff_operation: 'change_role', api_client_id: context.apiClientId, channel: 'staff_api', idempotency_key: 'request-2' }) })
  })
  it('reactivation delegates a native restore operation without caller-selected role', async () => {
    const result = await reactivateStaff(context, { userId: target, idempotencyKey: 'request-3' })
    expect(result.status).toBe('active')
    expect(mocks.rpc).toHaveBeenCalledWith('canonical_change_tenant_user_access', { p_command: expect.objectContaining({ staff_operation: 'enable', user_id: target, channel: 'staff_api' }) })
    expect(mocks.rpc.mock.calls[0][1].p_command).not.toHaveProperty('role_key')
  })
  it('role catalog never marks a role above the actor ceiling as assignable', () => {
    const catalog = listStaffRoles({ ...context, permissions: ['users.read', 'users.write', 'customers.read'] })
    expect(catalog.data.find(row => row.key === 'company_admin')?.assignable).toBe(false)
    expect(catalog.data.some(row => row.key === 'super_admin')).toBe(false)
  })
  it('user listing refuses absent read permission before reading any profile', async () => {
    await expect(listStaff({ ...context, permissions: [] })).rejects.toMatchObject({ code: 'staff_permission_denied' })
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
