import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/supabase/database.types'

const { sdkFetch } = vi.hoisted(() => ({ sdkFetch: vi.fn<typeof fetch>() }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    // Keep the installed SDK's methods intact: a plain rpc mock hides lost receivers.
    supabaseService: createClient<Database>('https://staff-context.example.invalid', 'synthetic-service-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: sdkFetch },
    }),
  }
})
vi.mock('@/lib/integrations/apiAuth', () => ({ requireIntegrationApiAccess: vi.fn() }))

import { requireIntegrationApiAccess, type IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { requireStaffApiContext, type StaffMembership, type StaffPermissionOverride } from '@/lib/staff-api/context'
import type { CustomerIdentityProvider } from '@/lib/customer-portal/customerAssertion'
import { tenantContextForIntegration } from '@/lib/tenant/context'

const company = '11111111-1111-4111-8111-111111111111'
const actor = '22222222-2222-4222-8222-222222222222'
const client: IntegrationApiClient = {
  id: '33333333-3333-4333-8333-333333333333', company_id: company, name: 'Synthetic staff SDK test',
  status: 'active', key_prefix: 'synthetic', secret_hash: 'synthetic', scopes: ['staff_customers.read'],
  allowed_ips: [], rate_limit_per_minute: 60, expires_at: null,
}
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
const provider: CustomerIdentityProvider = {
  id: '44444444-4444-4444-8444-444444444444', company_id: company, kind: 'tenant_key', display_name: 'Staff SDK test',
  issuer: `gridex-tenant:${company}`, audience: `gridex-staff-api:${company}`, jwks_uri: null,
  public_jwk: rsa.publicKey.export({ format: 'jwk' }), subject_claim: 'sub', enforcement: 'enforce',
}
const membershipRpc = '/rest/v1/rpc/gridex_staff_active_membership_v1'
const overridesRpc = '/rest/v1/rpc/gridex_staff_permission_overrides_v1'
type RpcError = { code: string; message: string; details: string; hint: null }
type CapturedRequest = { url: URL; method: string; body: Record<string, unknown> | null }
let requests: CapturedRequest[]
let memberships: StaffMembership[]
let overrides: StaffPermissionOverride[]
let rpcErrors: Map<string, RpcError>
let consumedJtis: Set<string>

function assertion() {
  const issuedAt = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: provider.issuer, aud: provider.audience, sub: actor, iat: issuedAt, exp: issuedAt + 300, jti: randomUUID(),
  })).toString('base64url')
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), rsa.privateKey)
  return `${header}.${payload}.${signature.toString('base64url')}`
}

function resolve(proof = assertion()) {
  return requireStaffApiContext(new NextRequest('https://app.example.invalid/api/v1/staff/customers', {
    headers: { 'x-gridex-staff-assertion': proof },
  }), { scopes: ['staff_customers.read'], permission: 'customers.read' })
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

function rpcRequests() {
  return requests.filter(request => request.url.pathname.startsWith('/rest/v1/rpc/'))
}

beforeEach(() => {
  requests = []
  memberships = [{ user_id: actor, role_key: 'customer_service_agent', membership_role: 'support', status: 'active', is_active: true }]
  overrides = []
  rpcErrors = new Map()
  consumedJtis = new Set()
  vi.mocked(requireIntegrationApiAccess).mockReset()
  vi.mocked(requireIntegrationApiAccess).mockResolvedValue({
    ok: true, client,
    context: tenantContextForIntegration({ companyId: company, clientId: client.id, scopes: client.scopes }),
    rateLimit: { limit: 60, count: 1, remaining: 59, resetAt: null },
  })
  sdkFetch.mockReset()
  sdkFetch.mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const body = request.method === 'GET' ? null : await request.json() as Record<string, unknown>
    requests.push({ url, method: request.method, body })
    if (url.pathname === '/rest/v1/tenant_customer_identity_providers' && request.method === 'GET') {
      return json([provider])
    }
    if (url.pathname === '/rest/v1/tenant_staff_assertion_replays' && request.method === 'POST') {
      const jti = String(body?.jti)
      if (consumedJtis.has(jti)) return json({ code: '23505', message: 'Synthetic replay', details: null, hint: null }, 409)
      consumedJtis.add(jti)
      return new Response(null, { status: 201 })
    }
    // F1: durable external anchors/bindings are checked for unregistered clients.
    if ((url.pathname === '/rest/v1/tenant_staff_actor_anchors' || url.pathname === '/rest/v1/tenant_staff_identity_bindings') && request.method === 'GET') {
      return json([])
    }
    const error = rpcErrors.get(url.pathname)
    if (error) return json(error, 503)
    if (url.pathname === membershipRpc && request.method === 'POST') return json(memberships)
    if (url.pathname === overridesRpc && request.method === 'POST') return json(overrides)
    throw new Error(`Unexpected SDK request: ${request.method} ${url.pathname}`)
  })
})

describe('default staff context with the installed Supabase SDK', () => {
  it('calls both RPCs with their client receiver and the authenticated company and signed actor', async () => {
    const context = await resolve()
    expect(context).toMatchObject({ companyId: company, actorUserId: actor, apiClientId: client.id })
    expect(context.permissions).toContain('customers.read')
    expect(rpcRequests().map(request => ({ path: request.url.pathname, method: request.method, body: request.body }))).toEqual([
      { path: membershipRpc, method: 'POST', body: { p_company_id: company, p_user_id: actor } },
      { path: overridesRpc, method: 'POST', body: { p_company_id: company, p_user_id: actor } },
    ])
    expect(requests.map(request => request.url.pathname)).toEqual([
      '/rest/v1/tenant_customer_identity_providers', '/rest/v1/tenant_staff_assertion_replays',
      '/rest/v1/tenant_staff_actor_anchors', '/rest/v1/tenant_staff_identity_bindings', membershipRpc, overridesRpc,
    ])
    expect(requests[0].url.searchParams.get('company_id')).toBe(`eq.${company}`)
    expect(requests[0].url.searchParams.get('purpose')).toBe('eq.staff')
    expect(requests[0].url.searchParams.get('is_active')).toBe('eq.true')
    expect(requests[1].body).toMatchObject({ company_id: company, jti: expect.any(String), expires_at: expect.any(String) })
    expect(consumedJtis.size).toBe(1)
  })

  it.each([
    [membershipRpc, [membershipRpc]],
    [overridesRpc, [membershipRpc, overridesRpc]],
  ])('propagates the SDK error from %s without issuing later lookups', async (path, expectedPaths) => {
    const error: RpcError = { code: 'XX000', message: `Synthetic failure: ${path}`, details: 'Controlled SDK response', hint: null }
    rpcErrors.set(path, error)
    await expect(resolve()).rejects.toEqual(error)
    expect(rpcRequests().map(request => request.url.pathname)).toEqual(expectedPaths)
    for (const request of rpcRequests()) expect(request.body).toEqual({ p_company_id: company, p_user_id: actor })
  })

  it('recomputes permission overrides through the SDK and denies an otherwise allowed request', async () => {
    await expect(resolve()).resolves.toMatchObject({ companyId: company, actorUserId: actor })
    overrides = [{ permission_key: 'customers.read', effect: 'deny', status: 'active', is_active: true }]
    await expect(resolve()).rejects.toMatchObject({ status: 403, code: 'staff_permission_denied' })
    expect(rpcRequests().map(request => request.url.pathname)).toEqual([membershipRpc, overridesRpc, membershipRpc, overridesRpc])
  })

  it('rejects an absent active membership before fetching permission overrides', async () => {
    memberships = []
    await expect(resolve()).rejects.toMatchObject({ status: 403, code: 'staff_membership_inactive' })
    expect(rpcRequests().map(request => request.url.pathname)).toEqual([membershipRpc])
  })

  it('consumes the proof before both RPCs and blocks a replay before any further RPC', async () => {
    const proof = assertion()
    await resolve(proof)
    await expect(resolve(proof)).rejects.toMatchObject({ status: 401, code: 'staff_assertion_replayed' })
    expect(rpcRequests().map(request => request.url.pathname)).toEqual([membershipRpc, overridesRpc])
    expect(requests.filter(request => request.url.pathname === '/rest/v1/tenant_staff_assertion_replays')).toHaveLength(2)
    expect(consumedJtis.size).toBe(1)
  })
})
