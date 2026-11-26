import { beforeEach, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/internal/contracts/[contractId]/price-addenda/[documentId]/activate/route'
import type { createClient } from '@supabase/supabase-js'

const uuid = (n: string) => `10000000-0000-4000-8000-0000000000${n}`
const companyId = uuid('aa')
const otherCompanyId = uuid('ab')
const actorId = uuid('ac')
const customerId = uuid('ad')
const contractId = uuid('ae')
const documentId = uuid('ba')
const reviewSha256 = 'a'.repeat(64)
const receipt = {
  kind: 'applied', documentId, reviewSha256, priceSnapshotId: uuid('bb'),
  priceSnapshotSha256: 'b'.repeat(64), effectiveAt: '2026-10-24T22:00:00+00:00',
  activatedAt: '2026-11-25T21:30:00.000001+00:00', actorUserId: actorId, existing: false,
}
const activationRpc = 'gridex_activate_test_contract_price_addendum_v1'
const permissions = ['contracts.write', 'documents.write', 'pricing.write']
const io = vi.hoisted(() => ({
  token: true,
  selected: '',
  granted: [] as string[],
  writable: true,
  contract: null as unknown,
  activationReply: { status: 200, body: null as unknown },
  requests: [] as Array<{ profile: string; url: URL; body: unknown }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: io.selected }) }) }))
vi.mock('@/lib/supabase/server', async () => {
  const sdk = await import('@supabase/supabase-js')
  return { createSupabaseServerClient: async () => Object.assign(client('actor', sdk.createClient), {
    auth: { getUser: async () => ({ data: { user: io.token ? { id: actorId } : null }, error: null }) },
  }) }
})
vi.mock('@/lib/supabase/service', async () => {
  const sdk = await import('@supabase/supabase-js')
  return { supabaseService: client('service', sdk.createClient) }
})

function client(profile: 'actor' | 'service', factory: typeof createClient) {
  return factory('http://127.0.0.1:1', 'synthetic-unit-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(profile === 'actor' ? { accessToken: async () => 'synthetic-app-session' } : {}),
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.origin !== 'http://127.0.0.1:1') throw Error('unexpected transport origin')
      const body = init?.body ? JSON.parse(String(init.body)) : null
      io.requests.push({ profile, url, body })
      if (url.pathname === '/rest/v1/rpc/canonical_authenticated_tenant_context' && profile === 'actor') {
        return Response.json({
          authorized: true,
          user_id: actorId,
          selected_company_id: io.selected,
          is_platform_admin: false,
          permissions: io.granted,
          active_permission_keys: permissions,
          denied_permissions: [],
          roles: ['employee'],
        })
      }
      if (url.pathname === '/rest/v1/rpc/gridex_can_write_company' && profile === 'actor') {
        return Response.json(io.writable)
      }
      if (url.pathname === '/rest/v1/customer_contracts' && profile === 'actor') {
        return Response.json(io.contract)
      }
      if (profile === 'service' && url.pathname === '/rest/v1/rpc/' + activationRpc) {
        return Response.json(io.activationReply.body, { status: io.activationReply.status })
      }
      throw Error('unexpected transport')
    } },
  })
}

const target = `http://127.0.0.1:1/api/internal/contracts/${contractId}/price-addenda/${documentId}/activate`
const context = { params: Promise.resolve({ contractId, documentId }) }

function request(body: unknown = { reviewSha256 }) {
  return new Request(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function post(body?: unknown) {
  return POST(request(body), context)
}

function byProfile(profile: string) {
  return io.requests.filter(item => item.profile === profile)
}

beforeEach(() => {
  io.token = true
  io.selected = companyId
  io.granted = [...permissions]
  io.writable = true
  io.contract = { id: contractId, company_id: companyId, customer_id: customerId }
  io.activationReply = { status: 200, body: receipt }
  io.requests.length = 0
})

it('applies only the exact scoped durable review receipt through the activation owner', async () => {
  const response = await post()
  expect(response.status).toBe(201)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(await response.json()).toEqual(receipt)
  const calls = byProfile('service')
  expect(calls).toHaveLength(1)
  expect(calls[0].url.pathname).toBe('/rest/v1/rpc/' + activationRpc)
  expect(calls[0].body).toEqual({
    p_company_id: companyId, p_actor_user_id: actorId, p_customer_id: customerId,
    p_contract_id: contractId, p_document_id: documentId, p_review_sha256: reviewSha256,
  })
})

it('returns the exact prior price snapshot and original activation actor on a valid replay', async () => {
  io.activationReply.body = { ...receipt, existing: true, actorUserId: uuid('bc') }
  const response = await post()
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(io.activationReply.body)
  expect(byProfile('service')).toHaveLength(1)
})

it.each([
  { mode: 'anonymous', configure: () => { io.token = false }, status: 401 },
  { mode: 'missing contracts.write', configure: () => { io.granted = ['documents.write', 'pricing.write'] }, status: 403 },
  { mode: 'missing documents.write', configure: () => { io.granted = ['contracts.write', 'pricing.write'] }, status: 403 },
  { mode: 'missing pricing.write', configure: () => { io.granted = ['contracts.write', 'documents.write'] }, status: 403 },
  { mode: 'paused', configure: () => { io.writable = false }, status: 403 },
  { mode: 'foreign contract', configure: () => { io.contract = {id: contractId, company_id: otherCompanyId, customer_id: customerId} }, status: 404 },
])('stops $mode before body consumption or invoking the native writer', async ({ configure, status }) => {
  configure()
  const input = request()
  const read = vi.spyOn(input.body!, 'getReader')
  expect((await POST(input, context)).status).toBe(status)
  expect(read).not.toHaveBeenCalled()
  expect(byProfile('service')).toEqual([])
})

it.each([
  {},
  { reviewSha256: 'invalid digest' },
  { reviewSha256, reviewed: true },
  { reviewSha256, contractId },
  { reviewSha256, actorUserId: actorId },
  { reviewSha256, priceOrePerKwh: '78' },
])('refuses invalid scope selectors or asserted review state before activation', async invalid => {
  const response = await post(invalid)
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error: 'price_addendum_review_digest_required' })
  expect(byProfile('service')).toEqual([])
})

it.each([
  { status: 403, code: '42501', message: 'price_addendum_pricing_scope_required', expected: 403 },
  { status: 400, code: '23514', message: 'price_addendum_test_scope_required', expected: 403 },
  { status: 400, code: '23514', message: 'price_addendum_review_evidence_changed', expected: 409 },
  { status: 400, code: '23514', message: 'price_addendum_initial_timeline_changed', expected: 409 },
  { status: 400, code: '23514', message: 'price_addendum_fixed_energy_only_required', expected: 409 },
  { status: 409, code: '23505', message: 'price_addendum_application_conflict', expected: 409 },
  { status: 500, code: '55P03', message: 'busy', expected: 503 },
  { status: 404, code: 'PGRST202', message: 'missing RPC', expected: 503 },
  { status: 400, code: '23514', message: 'price_addendum_activation_readback_invalid', expected: 500 },
])('does not report activation when the exact native owner declines $message', async ({ status, code, message, expected }) => {
  io.activationReply = { status, body: { code, message, details: 'private native details' } }
  const response = await post()
  expect(response.status).toBe(expected)
  const body = await response.text()
  expect(body).not.toContain('private native details')
  expect(body).not.toContain('"applied"')
  expect(byProfile('service')).toHaveLength(1)
})

it.each([
  { ...receipt, kind: 'reviewed_unapplied' },
  { ...receipt, documentId: uuid('bc') },
  { ...receipt, reviewSha256: '0'.repeat(64) },
  { ...receipt, priceSnapshotSha256: 'not a digest' },
  { ...receipt, actorUserId: uuid('bc') },
  { ...receipt, sourceBytes: 'private source' },
])('does not accept an incorrect, mis-scoped or unexpected activation receipt', async body => {
  io.activationReply.body = body
  const response = await post()
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error: 'price_addendum_activation_unconfirmed' })
  expect(byProfile('service')).toHaveLength(1)
})

it('rejects an oversize activation intent before calling the writer', async () => {
  const input = new Request(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: ' '.repeat(513),
  })
  const response = await POST(input, context)
  expect(response.status).toBe(413)
  expect(byProfile('service')).toEqual([])
})
