import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ command: null as unknown, client: null as unknown, invitation: null as unknown, invite: vi.fn(), rpc: vi.fn(), record: vi.fn(), accept: vi.fn(), auth: vi.fn(), delivery: vi.fn(), ready: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ SUPABASE_SERVICE_URL: 'https://piidsfebjqjmnepdpnas.supabase.co', supabaseService: {
  rpc: state.rpc,
  auth: { admin: { inviteUserByEmail: state.invite } },
  from: (table: string) => {
    const query = { select: () => query, eq: () => query, update: () => query, upsert: () => query,
      maybeSingle: async () => ({ data: table === 'canonical_command_results' ? state.command : table === 'company_invitations' ? state.invitation : state.client, error: null }),
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) }
    return query
  },
} }))
vi.mock('@/lib/auth/companyUserAccess', () => ({ acceptCompanyInvitationAccess: state.accept }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: state.auth } }) }))
vi.mock('@/lib/auth/authEmailFlow', () => ({ findAuthUserByEmail: vi.fn(async () => null), getBaseAppUrl: () => 'https://app.gridex.se', recordAuthEmailEvent: state.record, upsertAuthUserProfile: vi.fn() }))
vi.mock('@/lib/auth/tenantStaffDelivery', () => ({ deliverRegisteredStaffInvitation: state.delivery, requireStaffTenantOnboardingReady: state.ready,
 loadStaffOnboardingAuthority: vi.fn(async () => ({ client: state.client, tenantAuth: { origin: 'https://support123.gridex.se' } })),
 staffAuthorityCommand: () => ({ company_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', api_client_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) }))
import { acceptCompanyInvitationByToken, deliverCompanyInvitationIntent, provisionCompanyInvitation, provisionExternalStaffBootstrapInvitation } from '@/lib/auth/companyInvitationFlow'

const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const clientId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const invitationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const token = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const input = { companyId: company, invitationId, email: 'staff@example.invalid', fullName: 'Staff', token, actorUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', source: 'tenant_provisioning_worker', membershipRole: 'support', roleKey: 'customer_service_agent', provisioningJobId: '55555555-5555-4555-8555-555555555555', provisioningLeaseToken: '66666666-6666-4666-8666-666666666666' }
beforeEach(() => {
  vi.clearAllMocks()
  state.command = { request_payload: { channel: 'staff_api', api_client_id: clientId, company_id: company, staff_operation: 'invite' } }
  state.client = { id: clientId, company_id: company, status: 'active', scopes: ['staff_users.write'], expires_at: null, allowed_origins: ['https://support123.gridex.se'], metadata: { staff_onboarding_origin: 'https://support123.gridex.se' } }
  state.invite.mockResolvedValue({ data: { user: { id: '11111111-1111-4111-8111-111111111111', email: input.email } }, error: null })
  state.rpc.mockResolvedValue({ data: { invitation_id: invitationId, company_id: company, token }, error: null })
  state.invitation = { id: invitationId, company_id: company, email: input.email, invited_user_id: '11111111-1111-4111-8111-111111111111', status: 'pending', expires_at: '2030-01-01T00:00:00Z' }
  state.delivery.mockResolvedValue({ userId: '99999999-9999-4999-8999-999999999999', wasCreated: false, emailSent: true, acceptUrl: `https://support123.gridex.se/auth/invitation?token=${token}` })
  state.ready.mockResolvedValue(undefined)
  state.auth.mockResolvedValue({ data: { user: { id: '11111111-1111-4111-8111-111111111111', email: input.email } }, error: null })
})

describe('registered staff invitation routing', () => {
  it('fails before canonical intent when the native registered tenant bridge is not ready', async () => {
    state.ready.mockRejectedValue(new Error('native unavailable'))
    await expect(provisionCompanyInvitation({ ...input, channel: 'staff_api', apiClientId: clientId, staffOperation: 'invite', idempotencyKey: 'registered-invite' })).rejects.toThrow('native unavailable')
    expect(state.rpc).not.toHaveBeenCalled(); expect(state.invite).not.toHaveBeenCalled()
  })
  it('creates the initial admin only through the service-only native bootstrap wrapper', async () => {
    await provisionExternalStaffBootstrapInvitation({ companyId: company, apiClientId: clientId, actorUserId: input.actorUserId, email: input.email, roleKey: 'company_admin', idempotencyKey: 'bootstrap-stable' })
    expect(state.rpc).toHaveBeenCalledWith('gridex_create_external_staff_invitation_v1', { p_command: expect.objectContaining({ company_id: company, api_client_id: clientId, actor_user_id: input.actorUserId, role_key: 'company_admin' }) })
    expect(state.invite).not.toHaveBeenCalled()
  })
  it('routes the explicit native OPS bootstrap marker through the same independent delivery bridge', async () => {
    state.command = { request_payload: { company_id: company, channel: 'ops', staff_operation: 'invite', api_client_id: clientId, external_staff_identity: true } }
    await deliverCompanyInvitationIntent(input)
    expect(state.delivery).toHaveBeenCalledOnce(); expect(state.invite).not.toHaveBeenCalled()
    await expect(acceptCompanyInvitationByToken(token)).rejects.toMatchObject({ code: 'staff_invitation_requires_independent_portal' })
    expect(state.accept).not.toHaveBeenCalled()
  })

  it('delivers only to the registered independent portal callback from the durable client binding', async () => {
    const result = await deliverCompanyInvitationIntent(input)
    expect(state.delivery).toHaveBeenCalledWith({ companyId: company, clientId, invitationId, provisioningJobId: input.provisioningJobId, provisioningLeaseToken: input.provisioningLeaseToken })
    expect(state.invite).not.toHaveBeenCalled()
    expect(result.acceptUrl).toBe(`https://support123.gridex.se/auth/invitation?token=${token}`)
  })
  it.each([
    { metadata: {} }, { allowed_origins: [] }, { company_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }, { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
    { status: 'revoked' }, { revoked_at: '2026-10-01T00:00:00Z' }, { deleted_at: '2026-10-01T00:00:00Z' }, { scopes: ['*'] }, { expires_at: '2020-01-01T00:00:00Z' },
    ...['http://support123.gridex.se', 'https://support123.gridex.se/path', 'https://support123.gridex.se?next=bad', 'https://user:pass@support123.gridex.se', 'https://127.0.0.1', 'https://localhost', 'https://support123.gridex.se:9443', 'https://10.0.0.1'].map(origin => ({ metadata: { staff_onboarding_origin: origin }, allowed_origins: [origin] })),
  ])('refuses unregistered, foreign, inactive or unsafe registration before provider delivery: %j', async changes => {
    state.client = { ...(state.client as object), ...changes }
    await expect(deliverCompanyInvitationIntent(input)).rejects.toMatchObject({ code: 'staff_onboarding_registration_invalid' })
    expect(state.invite).not.toHaveBeenCalled()
  })
  it('preserves canonical OPS invitation callback behavior', async () => {
    state.command = { request_payload: { company_id: company, source: 'ops' } }
    const result = await deliverCompanyInvitationIntent(input)
    expect(result.acceptUrl).toBe(`https://app.gridex.se/auth/company-invite?token=${token}`)
    expect(state.invite.mock.calls[0][1].redirectTo).toContain('https://app.gridex.se/auth/callback?next=')
  })
  it('refuses a missing durable command instead of silently sending a staff invitation to OPS', async () => {
    state.command = null
    await expect(deliverCompanyInvitationIntent(input)).rejects.toMatchObject({ code: 'staff_invitation_binding_missing' })
    expect(state.invite).not.toHaveBeenCalled()
  })
  it('validates client registration before creating a staff invitation intent', async () => {
    state.client = null
    await expect(provisionCompanyInvitation({ ...input, channel: 'staff_api', apiClientId: clientId, staffOperation: 'invite', idempotencyKey: 'registered-invite' })).rejects.toMatchObject({ code: 'staff_onboarding_registration_invalid' })
    expect(state.rpc).not.toHaveBeenCalled()
  })
  it.each(['pending', 'accepted'])('prevents independent staff invitations from bypassing provider/client/password checks through the legacy OPS action (%s)', async status => {
    state.invitation = { ...(state.invitation as object), status }
    await expect(acceptCompanyInvitationByToken(token)).rejects.toMatchObject({ code: 'staff_invitation_requires_independent_portal' })
    expect(state.accept).not.toHaveBeenCalled()
  })
  it('preserves explicit OPS invitation acceptance through existing canonical authority', async () => {
    state.command = { request_payload: { company_id: company, channel: 'ops' } }
    await expect(acceptCompanyInvitationByToken(token)).resolves.toMatchObject({ companyId: company, email: input.email })
    expect(state.accept).toHaveBeenCalledOnce()
  })
})
