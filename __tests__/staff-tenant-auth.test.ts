import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase/service', () => ({ SUPABASE_SERVICE_URL: 'https://piidsfebjqjmnepdpnas.supabase.co', supabaseService: {} }))
import { getRegisteredStaffTenantAuthUser, registeredStaffTenantAuth } from '@/lib/staff-api/tenantAuth'

const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', clientId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const authUrl = 'https://ayiuxjlfazkjmmtlvhsl.supabase.co', origin = 'https://support123.gridex.se'
const publicKey = 'sb_publishable_synthetic_public_key_1234567890'
const client = { id: clientId, company_id: company, status: 'active', scopes: ['staff_users.read'], expires_at: null, allowed_origins: [origin], metadata: { staff_onboarding_origin: origin, staff_tenant_auth: { url: authUrl, public_key: publicKey } } }
const registration = () => registeredStaffTenantAuth(client, company, clientId, 'staff_users.read')

describe('registered tenant-owned staff Auth', () => {
  it('uses the explicitly registered independent Auth origin and public key without an OPS project pin', () => {
    expect(registration()).toEqual({ url: authUrl, publicKey, projectRef: 'ayiuxjlfazkjmmtlvhsl', authIssuer: `${authUrl}/auth/v1`, origin })
    expect(registeredStaffTenantAuth({ ...client, metadata: { ...client.metadata, staff_tenant_auth: { url: 'https://bbbbbbbbbbbbbbbbbbbb.supabase.co', public_key: publicKey } } }, company, clientId, 'staff_users.read').projectRef).toBe('bbbbbbbbbbbbbbbbbbbb')
  })
  it.each(['https://piidsfebjqjmnepdpnas.supabase.co', 'http://ayiuxjlfazkjmmtlvhsl.supabase.co', 'https://127.0.0.1', 'https://ayiuxjlfazkjmmtlvhsl.supabase.co/auth/v1', 'https://ayiuxjlfazkjmmtlvhsl.supabase.co?next=secret', 'https://evil.example', 'https://user:password@ayiuxjlfazkjmmtlvhsl.supabase.co'])('rejects central or noncanonical registered Auth URL %s before any remote request', url => {
    expect(() => registeredStaffTenantAuth({ ...client, metadata: { ...client.metadata, staff_tenant_auth: { url, public_key: publicKey } } }, company, clientId, 'staff_users.read')).toThrow()
  })
  it.each(['sb_secret_synthetic_key', 'service-role-key', 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.synthetic'])('refuses privileged or malformed keys %s', key => {
    expect(() => registeredStaffTenantAuth({ ...client, metadata: { ...client.metadata, staff_tenant_auth: { url: authUrl, public_key: key } } }, company, clientId, 'staff_users.read')).toThrow()
  })
  it('accepts only a registered anon legacy JWT and binds its project claim when present', () => {
    const key = (role: string, ref: string) => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ role, ref })).toString('base64url')}.synthetic`
    expect(registeredStaffTenantAuth({ ...client, metadata: { ...client.metadata, staff_tenant_auth: { url: authUrl, public_key: key('anon', 'ayiuxjlfazkjmmtlvhsl') } } }, company, clientId, 'staff_users.read').publicKey).toBe(key('anon', 'ayiuxjlfazkjmmtlvhsl'))
    expect(() => registeredStaffTenantAuth({ ...client, metadata: { ...client.metadata, staff_tenant_auth: { url: authUrl, public_key: key('anon', 'piidsfebjqjmnepdpnas') } } }, company, clientId, 'staff_users.read')).toThrow()
  })
  it.each([{ company_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }, { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }, { scopes: ['*'] }, { status: 'revoked' }, { expires_at: '2020-01-01T00:00:00Z' }, { allowed_origins: [] }])('rejects wrong company/client, inactive client or absent exact scope/origin: %j', changes => {
    expect(() => registeredStaffTenantAuth({ ...client, ...changes }, company, clientId, 'staff_users.read')).toThrow()
  })
  it('runs real tenant SDK getUser at the registered Auth URL with public apikey and user bearer only', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(`${authUrl}/auth/v1/user`)
      const headers = new Headers(init?.headers)
      expect(headers.get('apikey')).toBe(publicKey)
      expect(headers.get('authorization')).toBe('Bearer synthetic-local-user-token')
      expect(init?.redirect).toBe('error')
      return Response.json({ id: '11111111-1111-4111-8111-111111111111', email: 'staff@example.invalid', email_confirmed_at: '2026-10-01T00:00:00Z' })
    })
    const user = await getRegisteredStaffTenantAuthUser(registration(), 'synthetic-local-user-token', fetchImpl)
    expect(user).toMatchObject({ id: '11111111-1111-4111-8111-111111111111', email: 'staff@example.invalid' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
  it('does not trust a local parsed session or retry failed remote identity verification', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ message: 'Invalid token' }, { status: 401 }))
    expect(await getRegisteredStaffTenantAuthUser(registration(), 'synthetic-invalid-user-token', fetchImpl)).toBeNull()
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
  it.each([
    { deleted_at: '2026-10-01T00:00:00Z' }, { deleted_at: 'invalid timestamp' }, { deleted_at: '' },
    { banned_until: '2099-01-01T00:00:00Z' }, { banned_until: 'invalid timestamp' }, { banned_until: '' },
    { banned_until: '2020' }, { banned_until: '2026-02-31T00:00:00Z' }, { banned_until: 42 },
    { is_anonymous: true },
  ])('denies an already-issued token when the actual tenant getUser reports inactive or invalid lifecycle: %j', async lifecycle => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ id: '11111111-1111-4111-8111-111111111111', email: 'staff@example.invalid', email_confirmed_at: '2026-10-01T00:00:00Z', ...lifecycle }))
    expect(await getRegisteredStaffTenantAuthUser(registration(), 'synthetic-issued-before-suspension', fetchImpl)).toBeNull()
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
  it.each([
    {}, { deleted_at: null, banned_until: null, is_anonymous: false },
    { banned_until: '2020-01-01T00:00:00Z' }, { banned_until: '2020-01-01T00:00:00.123456+00:00' },
  ])('retains independent Auth compatibility for active users and valid expired bans: %j', async lifecycle => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ id: '11111111-1111-4111-8111-111111111111', email: 'staff@example.invalid', email_confirmed_at: '2026-10-01T00:00:00Z', ...lifecycle }))
    expect(await getRegisteredStaffTenantAuthUser(registration(), 'synthetic-active-issued-token', fetchImpl)).toMatchObject({ id: '11111111-1111-4111-8111-111111111111' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
