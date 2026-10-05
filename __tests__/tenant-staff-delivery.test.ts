import { generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ client: null as unknown, provider: null as unknown, rpc: vi.fn(), opsAuth: vi.fn(), consumed: new Set<string>() }))
vi.mock('@/lib/supabase/service', () => ({ SUPABASE_SERVICE_URL: 'https://piidsfebjqjmnepdpnas.supabase.co', supabaseService: {
  rpc: state.rpc, auth: { admin: { inviteUserByEmail: state.opsAuth } },
  from: (table: string) => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: table === 'integration_api_clients' ? state.client : state.provider, error: null }),
      insert: async (value: { jti: string }) => { if (state.consumed.has(value.jti)) return { error: { code: '23505' } }; state.consumed.add(value.jti); return { error: null } } }
    return query
  },
} }))
import { deliverRegisteredStaffInvitation, loadStaffOnboardingAuthority, requireStaffTenantOnboardingReady } from '@/lib/auth/tenantStaffDelivery'
const ops = generateKeyPairSync('rsa', { modulusLength: 2048 }), tenant = generateKeyPairSync('rsa', { modulusLength: 2048 })
const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', client = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', provider = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const invitation = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', delivery = '55555555-5555-4555-8555-555555555555'
const actor = '99999999-9999-4999-8999-999999999999', local = '11111111-1111-4111-8111-111111111111'
const input = { companyId: company, clientId: client, invitationId: invitation, provisioningJobId: '66666666-6666-4666-8666-666666666666', provisioningLeaseToken: '77777777-7777-4777-8777-777777777777' }
const payload = { delivery_id: delivery, actor_user_id: actor, company_id: company, api_client_id: client, provider_id: provider, invitation_id: invitation,
  recipient_email: 'staff@example.invalid', full_name: 'Staff', auth_issuer: 'https://ayiuxjlfazkjmmtlvhsl.supabase.co/auth/v1', callback_url: 'https://support123.gridex.se/auth/invitation?token=eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', request_hash: 'a'.repeat(64) }
function receipt(changes: Record<string, unknown> = {}, privateKey = tenant.privateKey): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'tenant-key' })).toString('base64url')
  const claims = Buffer.from(JSON.stringify({ request_hash: payload.request_hash, company_id: company, api_client_id: client, provider_id: provider,
    invitation_id: invitation, delivery_id: delivery, local_auth_subject: local, auth_issuer: payload.auth_issuer, email: payload.recipient_email, status: 'sent',
    iss: 'https://support123.gridex.se', aud: 'tenant-staff', sub: local, token_use: 'staff_invitation_delivery_receipt', iat: now, exp: now + 60, jti: randomUUID(), ...changes })).toString('base64url')
  const input = `${header}.${claims}`
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`
}
beforeEach(() => {
  vi.clearAllMocks(); state.consumed.clear()
  vi.stubEnv('GRIDEX_STAFF_DELIVERY_PRIVATE_KEY', ops.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())
  state.client = { id: client, company_id: company, status: 'active', scopes: ['staff_users.write'], expires_at: null, allowed_origins: ['https://support123.gridex.se'], secret_hash: 'stored-hash',
    metadata: { staff_onboarding_origin: 'https://support123.gridex.se', staff_tenant_auth: { url: 'https://ayiuxjlfazkjmmtlvhsl.supabase.co', public_key: 'sb_publishable_synthetic_public_key_12345' },
      staff_tenant_delivery: { url: 'https://support123.gridex.se/api/internal/staff/invitations/deliver', issuer: 'https://app.gridex.se', audience: 'https://support123.gridex.se/api/internal/staff/invitations/deliver', key_id: 'ops-key', request_public_jwk: { ...ops.publicKey.export({ format: 'jwk' }), kid: 'ops-key' } } } }
  state.provider = { id: provider, company_id: company, purpose: 'staff', is_active: true, kind: 'tenant_key', display_name: 'Support', issuer: 'https://support123.gridex.se', audience: 'tenant-staff', jwks_uri: null, public_jwk: { ...tenant.publicKey.export({ format: 'jwk' }), kid: 'tenant-key', alg: 'RS256' }, subject_claim: 'sub', enforcement: 'enforce' }
  state.rpc.mockImplementation(async (name: string) => ({ data: name === 'gridex_staff_tenant_onboarding_ready_v1' ? true : name === 'gridex_prepare_staff_identity_delivery_v1' ? payload : { actor_user_id: actor, binding_id: '88888888-8888-4888-8888-888888888888', binding_version: 1 }, error: null }))
})
afterEach(() => vi.unstubAllEnvs())
describe('leased registered tenant delivery authority', () => {
  it('signs the exact prepared OPS request, verifies tenant receipt, and records only the bound local identity under the same lease', async () => {
    const network = vi.fn<typeof fetch>(async (_url, init) => {
      const token = JSON.parse(String(init?.body)).assertion.split('.')
      expect(verify('RSA-SHA256', Buffer.from(token.slice(0, 2).join('.')), ops.publicKey, Buffer.from(token[2], 'base64url'))).toBe(true)
      expect(JSON.parse(Buffer.from(token[1], 'base64url').toString('utf8'))).toMatchObject({ ...payload, token_use: 'staff_invitation_delivery' })
      return Response.json({ receipt: receipt() })
    })
    await expect(deliverRegisteredStaffInvitation(input, network)).resolves.toMatchObject({ userId: actor, emailSent: true, acceptUrl: payload.callback_url })
    expect(network).toHaveBeenCalledWith('https://support123.gridex.se/api/internal/staff/invitations/deliver', expect.objectContaining({ method: 'POST', redirect: 'error', cache: 'no-store' }))
    expect(state.rpc).toHaveBeenLastCalledWith('gridex_record_staff_identity_delivery_v1', { p_command: expect.objectContaining({ provisioning_job_id: input.provisioningJobId,
      provisioning_lease_token: input.provisioningLeaseToken, delivery_id: delivery, verified_receipt: expect.objectContaining({ local_auth_subject: local, company_id: company, status: 'sent' }) }) })
    expect(state.opsAuth).not.toHaveBeenCalled()
  })
  it('fails pre-intent readiness for missing native capability or signing registration without OPS Auth fallback', async () => {
    const authority = await loadStaffOnboardingAuthority(company, client)
    state.rpc.mockResolvedValue({ data: null, error: { code: '42883' } })
    await expect(requireStaffTenantOnboardingReady(authority)).rejects.toMatchObject({ code: 'staff_tenant_delivery_not_ready' })
    vi.stubEnv('GRIDEX_STAFF_DELIVERY_PRIVATE_KEY', '')
    await expect(loadStaffOnboardingAuthority(company, client)).rejects.toMatchObject({ code: 'staff_tenant_delivery_not_ready' })
    expect(state.opsAuth).not.toHaveBeenCalled()
  })
  it.each([{ status: 'revoked' }, { metadata: {} }, { scopes: ['*'] }, { allowed_origins: [] }])('rejects unregistered/inactive delivery client before native preparation: %j', async changes => {
    state.client = { ...(state.client as object), ...changes }
    const network = vi.fn<typeof fetch>()
    await expect(deliverRegisteredStaffInvitation(input, network)).rejects.toBeInstanceOf(Error)
    expect(network).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled(); expect(state.opsAuth).not.toHaveBeenCalled()
  })
  it.each([undefined, 'foreign-key'])('rejects a missing/mismatched registered OPS JWK kid before native preparation: %s', async kid => {
    const original = state.client as { metadata: { staff_tenant_delivery: object } }
    state.client = { ...original, metadata: { ...original.metadata, staff_tenant_delivery: { ...original.metadata.staff_tenant_delivery, request_public_jwk: { ...ops.publicKey.export({ format: 'jwk' }), kid } } } }
    const network = vi.fn<typeof fetch>()
    await expect(deliverRegisteredStaffInvitation(input, network)).rejects.toMatchObject({ code: 'staff_tenant_delivery_not_ready' })
    expect(network).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled(); expect(state.opsAuth).not.toHaveBeenCalled()
  })
  it.each([{ company_id: randomUUID() }, { api_client_id: randomUUID() }, { auth_issuer: 'https://foreign.supabase.co/auth/v1' }, { callback_url: 'https://app.gridex.se/auth/invitation?token=' + invitation }])('rejects mismatched native prepare data before tenant network: %j', async changes => {
    state.rpc.mockResolvedValue({ data: { ...payload, ...changes }, error: null })
    const network = vi.fn<typeof fetch>()
    await expect(deliverRegisteredStaffInvitation(input, network)).rejects.toMatchObject({ code: 'staff_tenant_delivery_not_ready' })
    expect(network).not.toHaveBeenCalled(); expect(state.opsAuth).not.toHaveBeenCalled()
  })
  it.each([{ company_id: randomUUID() }, { local_auth_subject: actor, sub: actor }, { request_hash: 'b'.repeat(64) }, { token_use: 'staff_invitation_acceptance' }, { role_key: 'company_admin' }])('rejects a signed mismatched receipt without finalizing the central binding: %j', async changes => {
    await expect(deliverRegisteredStaffInvitation(input, async () => Response.json({ receipt: receipt(changes) }))).rejects.toMatchObject({ code: 'staff_tenant_delivery_not_ready' })
    expect(state.rpc.mock.calls.map(call => call[0])).toEqual(['gridex_prepare_staff_identity_delivery_v1'])
  })
  it('rejects a forged receipt and redacts bridge errors without a network write retry', async () => {
    const network = vi.fn<typeof fetch>(async () => Response.json({ receipt: receipt({}, ops.privateKey) }))
    await expect(deliverRegisteredStaffInvitation(input, network)).rejects.toMatchObject({ code: 'staff_tenant_delivery_not_ready' })
    expect(network).toHaveBeenCalledOnce()
    expect(state.rpc.mock.calls.map(call => call[0])).toEqual(['gridex_prepare_staff_identity_delivery_v1'])
  })
  it.each(['transport', 'malformed JSON'])('redacts %s bridge failures before worker diagnostics and never retries or records', async failure => {
    const network = vi.fn<typeof fetch>(async () => {
      if (failure === 'transport') throw new Error('synthetic-sensitive-transport-details')
      return new Response('{"receipt":"synthetic-sensitive-incomplete-json', { headers: { 'Content-Type': 'application/json' } })
    })
    await expect(deliverRegisteredStaffInvitation(input, network)).rejects.toMatchObject({
      code: 'staff_tenant_delivery_not_ready', status: 503, message: 'Independent tenant invitation delivery is unavailable.',
    })
    expect(network).toHaveBeenCalledOnce()
    expect(state.rpc.mock.calls.map(call => call[0])).toEqual(['gridex_prepare_staff_identity_delivery_v1'])
  })
})
