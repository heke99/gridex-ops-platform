import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const env = vi.hoisted(() => ({ url: 'https://ayiuxjlfazkjmmtlvhsl.supabase.co' }))
vi.mock('@/lib/supabase/service', () => ({ get SUPABASE_SERVICE_URL() { return env.url }, supabaseService: {} }))
vi.mock('@/lib/integrations/apiAuth', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), requireIntegrationApiAccess: vi.fn(), logIntegrationApiRequest: vi.fn() }))
import { createStaffInvitationAcceptanceHandler, type StaffInvitationAcceptancePorts } from '@/lib/staff-api/onboarding'

const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', userId = '11111111-1111-4111-8111-111111111111'
const clientId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', inviteId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', token = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'staff-key', alg: 'RS256' }
function proof(overrides: Record<string, unknown> = {}, signer = privateKey) {
  const now = Math.floor(Date.now() / 1000)
  const parts = [Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'staff-key' })).toString('base64url'), Buffer.from(JSON.stringify({ iss: 'https://support123.gridex.se', aud: 'staff-audience', sub: userId, company_id: company, iat: now, exp: now + 60, jti: randomUUID(), ...overrides })).toString('base64url')]
  return [...parts, sign('RSA-SHA256', Buffer.from(parts.join('.')), signer).toString('base64url')].join('.')
}
const client = { id: clientId, company_id: company, name: 'Synthetic', key_prefix: 'synthetic', secret_hash: 'synthetic-secret-hash', rate_limit_per_minute: 60, allowed_ips: [], status: 'active', scopes: ['staff_users.write'], expires_at: null, allowed_origins: ['https://support123.gridex.se'], metadata: { staff_onboarding_origin: 'https://support123.gridex.se' } }
function boundary() {
  const consumed = new Set<string>(), calls: string[] = []
  const ports = {
    apiAccess: vi.fn<StaffInvitationAcceptancePorts['apiAccess']>(async () => { calls.push('api_access'); return { ok: true, client } }),
    getAuthUser: vi.fn<StaffInvitationAcceptancePorts['getAuthUser']>(async () => { calls.push('verified_prod_auth'); return { id: userId, email: 'staff@example.invalid', email_confirmed_at: '2026-10-01T00:00:00Z' } }),
    loadProvider: vi.fn<StaffInvitationAcceptancePorts['loadProvider']>(async () => ({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', company_id: company, purpose: 'staff', is_active: true, kind: 'tenant_key', display_name: 'Support', issuer: 'https://support123.gridex.se', audience: 'staff-audience', jwks_uri: null, public_jwk: jwk, subject_claim: 'sub', enforcement: 'enforce' })),
    consumeJti: vi.fn<StaffInvitationAcceptancePorts['consumeJti']>(async (_company, jti) => { if (consumed.has(jti)) return false; consumed.add(jti); calls.push('consume_signed_jti'); return true }),
    findInvitation: vi.fn<StaffInvitationAcceptancePorts['findInvitation']>(async () => ({ id: inviteId, company_id: company, email: 'staff@example.invalid', invited_user_id: userId, status: 'pending', expires_at: '2030-01-01T00:00:00Z' })),
    loadBinding: vi.fn<StaffInvitationAcceptancePorts['loadBinding']>(async () => ({ company_id: company, channel: 'staff_api', api_client_id: clientId, staff_operation: 'invite' })),
    canonicalAccept: vi.fn<StaffInvitationAcceptancePorts['canonicalAccept']>(async () => { calls.push('canonical_accept'); return { changed: true } }),
    logRequest: vi.fn<StaffInvitationAcceptancePorts['logRequest']>(async () => undefined),
  }
  return { ports, calls, handler: createStaffInvitationAcceptanceHandler(ports) }
}
function request(options: { headers?: Record<string, string>; body?: unknown; method?: string } = {}) {
  return new NextRequest('https://app.gridex.se/api/v1/staff-onboarding/invitations/accept', { method: options.method ?? 'POST', headers: { authorization: 'Bearer synthetic-api-key', 'x-gridex-expected-project-ref': 'ayiuxjlfazkjmmtlvhsl', 'x-gridex-support-auth-token': 'synthetic-auth-token', 'x-gridex-staff-assertion': proof(), 'idempotency-key': 'accept-stable-1', 'content-type': 'application/json', ...options.headers }, ...(options.method === 'GET' ? {} : { body: JSON.stringify(options.body ?? { invitation_token: token }) }) })
}
beforeEach(() => { env.url = 'https://ayiuxjlfazkjmmtlvhsl.supabase.co' })

describe('explicit independent staff invitation acceptance', () => {
  it('accepts a verified pre-membership Auth subject only through canonical authority with stable idempotency', async () => {
    const { handler, ports, calls } = boundary()
    const response = await handler(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { status: 'accepted' }, contract_schema_version: '2026-10-05.1' })
    expect(response.headers.get('x-gridex-project-ref')).toBe('ayiuxjlfazkjmmtlvhsl')
    expect(calls).toEqual(['api_access', 'verified_prod_auth', 'consume_signed_jti', 'canonical_accept'])
    expect(ports.canonicalAccept).toHaveBeenCalledWith(expect.objectContaining({ company_id: company, invitation_id: inviteId, user_id: userId, actor_user_id: userId, idempotency_key: `${clientId}:staff-invitation-accept:accept-stable-1`, channel: 'staff_onboarding', api_client_id: clientId, provider_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      verified_client: { secret_hash: createHash('sha256').update('synthetic-api-key').digest('hex'), scopes: ['staff_users.write'], allowed_origins: ['https://support123.gridex.se'], staff_onboarding_origin: 'https://support123.gridex.se' },
      verified_provider: expect.objectContaining({ public_jwk: jwk, issuer: 'https://support123.gridex.se', audience: 'staff-audience' }) }))
    expect(ports.getAuthUser).toHaveBeenCalledWith('synthetic-auth-token')
  })
  it('derives the native credential snapshot from the exact authenticated token when the real auth RPC omits secret_hash', async () => {
    const { handler, ports } = boundary()
    ports.apiAccess.mockResolvedValue({ ok: true, client: { ...client, secret_hash: '' } })
    expect((await handler(request())).status).toBe(200)
    expect(ports.canonicalAccept.mock.calls[0][0].verified_client.secret_hash).toBe(createHash('sha256').update('synthetic-api-key').digest('hex'))
  })
  it('stops wrong deployment/project before authentication rate/audit writes', async () => {
    env.url = 'https://piidsfebjqjmnepdpnas.supabase.co'
    const { handler, ports } = boundary()
    const response = await handler(request())
    expect(response.status).toBe(412)
    expect(ports.apiAccess).not.toHaveBeenCalled(); expect(ports.logRequest).not.toHaveBeenCalled(); expect(ports.canonicalAccept).not.toHaveBeenCalled()
  })
  it('rejects GET without authentication or acceptance', async () => {
    const { handler, ports } = boundary()
    expect((await handler(request({ method: 'GET' }))).status).toBe(405)
    expect(ports.apiAccess).not.toHaveBeenCalled(); expect(ports.canonicalAccept).not.toHaveBeenCalled()
  })
  it('authenticates before invalid body processing and never audits an unauthenticated null-company request', async () => {
    const { handler, ports } = boundary()
    ports.apiAccess.mockResolvedValue({ ok: false, status: 401, error: 'Authentication required.', errorCode: 'api_unauthorized' })
    expect((await handler(request({ body: { user_id: 'untrusted' } }))).status).toBe(401)
    expect(ports.apiAccess).toHaveBeenCalledOnce()
    expect(ports.logRequest).not.toHaveBeenCalled(); expect(ports.canonicalAccept).not.toHaveBeenCalled()
  })
  it.each([
    { email_confirmed_at: null }, { email: 'other@example.invalid' }, { id: '22222222-2222-4222-8222-222222222222' },
  ])('rejects unconfirmed or mismatched verified Auth identity before canonical write: %j', async changes => {
    const { handler, ports } = boundary()
    ports.getAuthUser.mockResolvedValue({ id: userId, email: 'staff@example.invalid', email_confirmed_at: '2026-10-01T00:00:00Z', ...changes })
    expect((await handler(request())).status).toBeGreaterThanOrEqual(400)
    expect(ports.canonicalAccept).not.toHaveBeenCalled()
  })
  it.each([
    { company_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }, { invited_user_id: null }, { invited_user_id: '22222222-2222-4222-8222-222222222222' }, { status: 'revoked' }, { expires_at: '2020-01-01T00:00:00Z' },
  ])('rejects a foreign, undelivered, revoked or expired invitation: %j', async changes => {
    const { handler, ports } = boundary()
    ports.findInvitation.mockResolvedValue({ id: inviteId, company_id: company, email: 'staff@example.invalid', invited_user_id: userId, status: 'pending', expires_at: '2030-01-01T00:00:00Z', ...changes })
    expect((await handler(request())).status).toBeGreaterThanOrEqual(400)
    expect(ports.canonicalAccept).not.toHaveBeenCalled()
  })
  it.each([{ channel: 'ops' }, { api_client_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }, { company_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }])('rejects a different durable invitation client/company/channel: %j', async changes => {
    const { handler, ports } = boundary()
    ports.loadBinding.mockResolvedValue({ company_id: company, channel: 'staff_api', api_client_id: clientId, staff_operation: 'invite', ...changes })
    expect((await handler(request())).status).toBe(403)
    expect(ports.canonicalAccept).not.toHaveBeenCalled()
  })
  it.each([{ purpose: 'customer' }, { is_active: false }, { company_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }])('rejects wrong staff provider binding: %j', async changes => {
    const { handler, ports } = boundary()
    const provider = await ports.loadProvider(company)
    if (!provider) throw new Error('The synthetic provider fixture is missing.')
    ports.loadProvider.mockResolvedValue({ ...provider, ...changes })
    expect((await handler(request())).status).toBe(403)
    expect(ports.canonicalAccept).not.toHaveBeenCalled()
  })
  it('rejects a forged signature and consumed JTI while permitting a fresh proof for the same idempotent command', async () => {
    const { handler, ports } = boundary()
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    expect((await handler(request({ headers: { 'x-gridex-staff-assertion': proof({}, other) } }))).status).toBe(401)
    expect(ports.canonicalAccept).not.toHaveBeenCalled()
    const signed = proof()
    expect((await handler(request({ headers: { 'x-gridex-staff-assertion': signed } }))).status).toBe(200)
    expect((await handler(request({ headers: { 'x-gridex-staff-assertion': signed } }))).status).toBe(401)
    expect((await handler(request())).status).toBe(200)
    expect(ports.canonicalAccept.mock.calls[0]).toEqual(ports.canonicalAccept.mock.calls[1])
  })
  it.each([{ company_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }, { exp: Math.floor(Date.now() / 1000) + 600 }, { iss: 'https://foreign.example' }, { aud: 'wrong-audience' }])('rejects signed foreign-company, extended-lifetime, issuer or audience proof: %j', async claims => {
    const { handler, ports } = boundary()
    expect((await handler(request({ headers: { 'x-gridex-staff-assertion': proof(claims) } }))).status).toBe(401)
    expect(ports.canonicalAccept).not.toHaveBeenCalled()
  })
  it.each(['company_id', 'user_id', 'role_key', 'callback_url'])('rejects browser authority field %s', async field => {
    const { handler, ports } = boundary()
    expect((await handler(request({ body: { invitation_token: token, [field]: 'untrusted' } }))).status).toBe(422)
    expect(ports.canonicalAccept).not.toHaveBeenCalled()
  })
})
