import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const env = vi.hoisted(() => ({ url: 'https://piidsfebjqjmnepdpnas.supabase.co' }))
vi.mock('@/lib/supabase/service', () => ({ get SUPABASE_SERVICE_URL() { return env.url }, supabaseService: {} }))
vi.mock('@/lib/integrations/apiAuth', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), requireIntegrationApiAccess: vi.fn(), logIntegrationApiRequest: vi.fn() }))
import { createStaffIdentityResolutionHandler, type StaffIdentityResolutionPorts } from '@/lib/staff-api/identityResolution'

const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', local = '11111111-1111-4111-8111-111111111111', actor = '22222222-2222-4222-8222-222222222222'
const clientId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', providerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', bindingId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const origin = 'https://support123.gridex.se', authUrl = 'https://ayiuxjlfazkjmmtlvhsl.supabase.co', publicKey = 'sb_publishable_synthetic_public_key_1234567890'
const { privateKey, publicKey: assertionPublic } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...assertionPublic.export({ format: 'jwk' }), alg: 'RS256', kid: 'synthetic' }
const client = { id: clientId, company_id: company, name: 'Synthetic independent tenant', key_prefix: 'synthetic', secret_hash: '', rate_limit_per_minute: 60, allowed_ips: [], status: 'active', scopes: ['staff_users.read'], expires_at: null, allowed_origins: [origin], metadata: { staff_onboarding_origin: origin, staff_tenant_auth: { url: authUrl, public_key: publicKey } } }
function proof(claims: Record<string, unknown> = {}, key = privateKey) {
  const now = Math.floor(Date.now() / 1000)
  const parts = [Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'synthetic' })).toString('base64url'), Buffer.from(JSON.stringify({ iss: origin, aud: 'staff-audience', sub: local, company_id: company, token_use: 'staff_identity_resolution', iat: now, exp: now + 60, jti: randomUUID(), ...claims })).toString('base64url')]
  return [...parts, sign('RSA-SHA256', Buffer.from(parts.join('.')), key).toString('base64url')].join('.')
}
function boundary() {
  const consumed = new Set<string>()
  const ports = {
    apiAccess: vi.fn<StaffIdentityResolutionPorts['apiAccess']>(async () => ({ ok: true, client })),
    getAuthUser: vi.fn<StaffIdentityResolutionPorts['getAuthUser']>(async () => ({ id: local, email: 'synthetic@example.invalid', email_confirmed_at: '2026-10-01T00:00:00Z' })),
    loadProvider: vi.fn<StaffIdentityResolutionPorts['loadProvider']>(async () => ({ id: providerId, company_id: company, purpose: 'staff', is_active: true, kind: 'tenant_key', display_name: 'Independent staff', issuer: origin, audience: 'staff-audience', jwks_uri: null, public_jwk: jwk, subject_claim: 'sub', enforcement: 'enforce' })),
    consumeJti: vi.fn<StaffIdentityResolutionPorts['consumeJti']>(async (_company, jti) => { if (consumed.has(jti)) return false; consumed.add(jti); return true }),
    resolveIdentity: vi.fn<StaffIdentityResolutionPorts['resolveIdentity']>(async () => ({ actor_user_id: actor, binding_id: bindingId, binding_version: 1 })),
    logRequest: vi.fn<StaffIdentityResolutionPorts['logRequest']>(async () => undefined),
  }
  return { ports, handler: createStaffIdentityResolutionHandler(ports) }
}
function request(options: { body?: unknown; headers?: Record<string, string>; method?: string } = {}) {
  return new NextRequest('https://app.gridex.se/api/v1/staff-onboarding/identity/resolve', { method: options.method ?? 'POST', headers: { authorization: 'Bearer synthetic-api-credential', 'x-gridex-expected-project-ref': 'piidsfebjqjmnepdpnas', 'x-gridex-support-auth-token': 'synthetic-local-auth', 'x-gridex-staff-assertion': proof(), 'content-type': 'application/json', ...options.headers }, ...(options.method === 'GET' ? {} : { body: JSON.stringify(options.body ?? {}) }) })
}
beforeEach(() => { env.url = 'https://piidsfebjqjmnepdpnas.supabase.co' })

describe('independent tenant local-to-central staff identity resolution', () => {
  it('resolves deliberately distinct local/central UUIDs through existing native binding only', async () => {
    const { handler, ports } = boundary()
    const response = await handler(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { actor_user_id: actor, binding_id: bindingId, binding_version: 1 }, contract_schema_version: '2026-10-05.2' })
    expect(response.headers.get('x-gridex-project-ref')).toBe('piidsfebjqjmnepdpnas')
    expect(ports.apiAccess).toHaveBeenCalledWith(expect.anything(), ['staff_users.read'])
    expect(ports.getAuthUser).toHaveBeenCalledWith(expect.objectContaining({ url: authUrl, authIssuer: `${authUrl}/auth/v1`, publicKey }), 'synthetic-local-auth')
    expect(ports.resolveIdentity).toHaveBeenCalledWith({ company_id: company, api_client_id: clientId, provider_id: providerId, local_user_id: local, local_auth_issuer: `${authUrl}/auth/v1`, local_auth_url: authUrl,
      verified_client: { secret_hash: createHash('sha256').update('synthetic-api-credential').digest('hex'), scopes: ['staff_users.read'], allowed_origins: [origin], staff_onboarding_origin: origin, staff_tenant_auth: { url: authUrl, public_key: publicKey }, staff_tenant_delivery: null },
      verified_provider: { kind: 'tenant_key', issuer: origin, audience: 'staff-audience', jwks_uri: null, public_jwk: jwk, subject_claim: 'sub', enforcement: 'enforce' } })
    expect(ports.logRequest.mock.calls[0][0].metadata).not.toHaveProperty('local_user_id')
  })
  it('requires a central project attestation before all auth/rate/replay/audit work', async () => {
    const { handler, ports } = boundary()
    expect((await handler(request({ headers: { 'x-gridex-expected-project-ref': 'ayiuxjlfazkjmmtlvhsl' } }))).status).toBe(412)
    expect(ports.apiAccess).not.toHaveBeenCalled(); expect(ports.getAuthUser).not.toHaveBeenCalled(); expect(ports.consumeJti).not.toHaveBeenCalled(); expect(ports.logRequest).not.toHaveBeenCalled()
  })
  it('requires the caller central-project expectation even when the backend is a known project', async () => {
    const { handler, ports } = boundary(), input = request()
    input.headers.delete('x-gridex-expected-project-ref')
    expect((await handler(input)).status).toBe(412)
    expect(ports.apiAccess).not.toHaveBeenCalled(); expect(ports.logRequest).not.toHaveBeenCalled()
  })
  it('rejects GET and does not grant or create any identity', async () => {
    const { handler, ports } = boundary()
    expect((await handler(request({ method: 'GET' }))).status).toBe(405)
    expect(ports.apiAccess).not.toHaveBeenCalled(); expect(ports.resolveIdentity).not.toHaveBeenCalled()
  })
  it('does not process a browser authority field or log a null company before machine authentication', async () => {
    const { handler, ports } = boundary()
    ports.apiAccess.mockResolvedValue({ ok: false, error: 'Unauthorized', errorCode: 'api_unauthorized', status: 401 })
    expect((await handler(request({ body: { company_id: company } }))).status).toBe(401)
    expect(ports.logRequest).not.toHaveBeenCalled(); expect(ports.getAuthUser).not.toHaveBeenCalled()
  })
  it.each(['company_id', 'local_user_id', 'actor_user_id', 'role_key', 'auth_url', 'public_key'])('denies body-selected authority field %s before local verification', async name => {
    const { handler, ports } = boundary()
    expect((await handler(request({ body: { [name]: 'synthetic' } }))).status).toBe(422)
    expect(ports.getAuthUser).not.toHaveBeenCalled(); expect(ports.resolveIdentity).not.toHaveBeenCalled()
  })
  it.each([[['*']], [['staff_users.write']], [['customer_portal.read']]])('requires explicit staff_users.read, without wildcard inheritance: %j', async scopes => {
    const { handler, ports } = boundary()
    ports.apiAccess.mockResolvedValue({ ok: true, client: { ...client, scopes } })
    expect((await handler(request())).status).toBe(403)
    expect(ports.getAuthUser).not.toHaveBeenCalled(); expect(ports.resolveIdentity).not.toHaveBeenCalled()
  })
  it.each([{ email_confirmed_at: null }, { id: actor }, { id: 'not-a-uuid' }])('rejects unconfirmed or mismatched remote local Auth subject %j', async changes => {
    const { handler, ports } = boundary()
    ports.getAuthUser.mockResolvedValue({ id: local, email: 'synthetic@example.invalid', email_confirmed_at: '2026-10-01T00:00:00Z', ...changes })
    expect((await handler(request())).status).toBe(401)
    expect(ports.resolveIdentity).not.toHaveBeenCalled()
  })
  it.each(['x-gridex-support-auth-token', 'x-gridex-staff-assertion'])('requires %s without substituting a machine credential or local session hint', async name => {
    const { handler, ports } = boundary(), input = request()
    input.headers.delete(name)
    expect((await handler(input)).status).toBe(401)
    expect(ports.getAuthUser).not.toHaveBeenCalled(); expect(ports.resolveIdentity).not.toHaveBeenCalled()
  })
  it.each([{ purpose: 'customer' }, { is_active: false }, { company_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }, { subject_claim: 'customer_id' }, { enforcement: 'report' as const }])('refuses current provider configurations that do not authorize this staff company: %j', async changes => {
    const { handler, ports } = boundary()
    const configured = await ports.loadProvider(company)
    if (!configured) throw new Error('Missing synthetic provider')
    ports.loadProvider.mockResolvedValue({ ...configured, ...changes })
    expect((await handler(request())).status).toBe(403)
    expect(ports.consumeJti).not.toHaveBeenCalled(); expect(ports.resolveIdentity).not.toHaveBeenCalled()
  })
  it.each([{ token_use: undefined }, { token_use: 'staff_invitation_acceptance' }, { company_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }, { iss: 'foreign' }, { aud: 'wrong-audience' }, { exp: Math.floor(Date.now() / 1000) + 600 }])('refuses wrong purpose/company/issuer/audience/lifetime proof %j', async claims => {
    const { handler, ports } = boundary()
    expect((await handler(request({ headers: { 'x-gridex-staff-assertion': proof(claims) } }))).status).toBe(401)
    expect(ports.resolveIdentity).not.toHaveBeenCalled()
  })
  it('refuses forgery and JTI replay and never falls back to an equal UUID or email when binding is missing', async () => {
    const { handler, ports } = boundary()
    expect((await handler(request({ headers: { 'x-gridex-staff-assertion': proof({}, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey) } }))).status).toBe(401)
    expect(ports.resolveIdentity).not.toHaveBeenCalled()
    const signed = proof()
    expect((await handler(request({ headers: { 'x-gridex-staff-assertion': signed } }))).status).toBe(200)
    expect((await handler(request({ headers: { 'x-gridex-staff-assertion': signed } }))).status).toBe(401)
    ports.resolveIdentity.mockResolvedValue(null)
    expect((await handler(request())).status).toBe(403)
  })
  it('returns a closed safe error if current native authority rejects or leaks unexpected output', async () => {
    const { handler, ports } = boundary()
    ports.resolveIdentity.mockRejectedValue(new Error('private SQL details and credentials'))
    const response = await handler(request())
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('private SQL')
  })
  it('maps an authoritative native denial to safe forbidden without returning backend error details', async () => {
    const { handler, ports } = boundary()
    ports.resolveIdentity.mockRejectedValue({ code: '42501', message: 'private binding details' })
    const response = await handler(request())
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'staff_identity_binding_invalid' } })
  })
  it.each([{ actor_user_id: local, binding_id: bindingId, binding_version: 0 }, { actor_user_id: 'invalid', binding_id: bindingId, binding_version: 1 }, { actor_user_id: actor, binding_id: bindingId, binding_version: 1, secret_hash: 'private' }])('refuses malformed or excessive native output %j', async value => {
    const { handler, ports } = boundary()
    ports.resolveIdentity.mockResolvedValue(value)
    const response = await handler(request())
    expect(response.status).toBe(403)
    expect(JSON.stringify(await response.json())).not.toContain('private')
  })
})
