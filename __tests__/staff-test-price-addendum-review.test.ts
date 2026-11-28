import { createHash } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/internal/contracts/[contractId]/price-addenda/[documentId]/review/route'
import type { createClient } from '@supabase/supabase-js'

const uuid = (n: string) => `10000000-0000-4000-8000-0000000000${n}`
const companyId = uuid('aa')
const otherCompanyId = uuid('ab')
const actorId = uuid('ac')
const customerId = uuid('ad')
const contractId = uuid('ae')
const documentId = uuid('ba')
const pdf = Buffer.from('%PDF-1.7\nInert archival transport fixture\n%%EOF\n')
const documentBase64 = pdf.toString('base64')
const digest = createHash('sha256').update(pdf).digest('hex')
const source = { kind: 'review_source', documentId, documentSha256: digest, byteLength: pdf.length, bodyBase64: documentBase64 }
const verification = {
  kind: 'staff_manually_verified_signed_addendum_v1',
  signedOn: '2026-10-17',
  effectiveOn: '2026-10-25',
  supplierSignerEvidence: 'Synthetic supplier authority reference',
  customerSignerEvidence: 'Synthetic customer authority reference',
  priceOrePerKwh: '78.12500000',
}
const receipt = {
  kind: 'reviewed_unapplied', documentId, reviewSha256: 'a'.repeat(64), effectiveAt: '2026-10-24T22:00:00+00:00', existing: false,
}
const sourceRpc = 'gridex_read_test_contract_price_addendum_review_source_v1'
const reviewRpc = 'gridex_review_test_contract_price_addendum_v1'
const permissions = ['contracts.write', 'documents.write']
const io = vi.hoisted(() => ({
  token: true,
  selected: '',
  granted: [] as string[],
  writable: true,
  contract: null as unknown,
  sourceReply: { status: 200, body: null as unknown },
  reviewReply: { status: 200, body: null as unknown },
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
      if (profile === 'service' && url.pathname === '/rest/v1/rpc/' + sourceRpc) {
        return Response.json(io.sourceReply.body, { status: io.sourceReply.status })
      }
      if (profile === 'service' && url.pathname === '/rest/v1/rpc/' + reviewRpc) {
        return Response.json(io.reviewReply.body, { status: io.reviewReply.status })
      }
      throw Error('unexpected transport')
    } },
  })
}

const target = `http://127.0.0.1:1/api/internal/contracts/${contractId}/price-addenda/${documentId}/review`
const context = { params: Promise.resolve({contractId, documentId}) }

function post(body: unknown = { documentSha256: digest, verification }) {
  return POST(new Request(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), context)
}

function get() {
  return GET(new Request(target), context)
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
  io.sourceReply = { status: 200, body: source }
  io.reviewReply = { status: 200, body: receipt }
  io.requests.length = 0
})

it('downloads the exact private source with no mutation or inline preview', async () => {
  const response = await get()
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('content-disposition')).toContain('attachment;')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('x-gridex-document-sha256')).toBe(digest)
  expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf)
  const calls = byProfile('service')
  expect(calls).toHaveLength(1)
  expect(calls[0].url.pathname).toBe('/rest/v1/rpc/' + sourceRpc)
  expect(calls[0].body).toEqual({
    p_company_id: companyId, p_actor_user_id: actorId, p_customer_id: customerId, p_contract_id: contractId, p_document_id: documentId,
  })
})

it('reads matching bytes before the explicitly authorized manual review, with no source fields in the response', async () => {
  const response = await post()
  expect(response.status).toBe(201)
  expect(await response.json()).toEqual(receipt)
  const calls = byProfile('service')
  expect(calls.map(call => call.url.pathname)).toEqual(['/rest/v1/rpc/' + sourceRpc, '/rest/v1/rpc/' + reviewRpc])
  expect(calls[1].body).toEqual({
    p_company_id: companyId, p_actor_user_id: actorId, p_customer_id: customerId, p_contract_id: contractId, p_document_id: documentId,
    p_verified_sha256: digest, p_verification: verification,
  })
})

it('returns exactly the previous reviewed-unapplied receipt on an exact replay', async () => {
  io.reviewReply.body = { ...receipt, existing: true }
  const response = await post()
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(io.reviewReply.body)
  expect(byProfile('service')).toHaveLength(2)
})

it.each([
  { mode: 'anonymous', configure: () => { io.token = false }, status: 401 },
  { mode: 'one grant', configure: () => { io.granted = ['contracts.write'] }, status: 403 },
  { mode: 'paused', configure: () => { io.writable = false }, status: 403 },
  { mode: 'foreign source', configure: () => { io.contract = {id: contractId, company_id: otherCompanyId, customer_id: customerId} }, status: 404 },
])('stops $mode read and review before any native document requests', async ({ configure, status }) => {
  configure()
  expect((await get()).status).toBe(status)
  expect((await post()).status).toBe(status)
  expect(byProfile('service')).toEqual([])
})

it.each([
  { body: null, expected: 404 },
  { body: { ...source, documentId: uuid('bb') }, expected: 500 },
  { body: { ...source, documentSha256: '0'.repeat(64) }, expected: 500 },
  { body: { ...source, byteLength: source.byteLength + 1 }, expected: 500 },
  { body: { ...source, bodyBase64: documentBase64 + '\n' }, expected: 500 },
])('holds an unavailable or incoherent source before any manual write', async ({ body, expected }) => {
  io.sourceReply.body = body
  const response = await get()
  expect(response.status).toBe(expected)
  expect(response.headers.get('content-type')).toContain('application/json')
  expect(await response.text()).not.toContain(documentBase64)
  expect((await post()).status).toBe(expected)
  expect(byProfile('service').map(call => call.url.pathname)).toEqual(['/rest/v1/rpc/' + sourceRpc, '/rest/v1/rpc/' + sourceRpc])
})

it('holds a stale reviewer hash before invoking the native review writer', async () => {
  const response = await post({ documentSha256: '0'.repeat(64), verification })
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({ error: 'price_addendum_document_evidence_changed' })
  expect(byProfile('service').map(call => call.url.pathname)).toEqual(['/rest/v1/rpc/' + sourceRpc])
})

it.each([
  { ...verification, kind: 'auto_verified' },
  { ...verification, supplierSignerEvidence: ' ' },
  { ...verification, customerSignerEvidence: '' },
  { ...verification, priceOrePerKwh: '78,125' },
  { ...verification, effectiveOn: '2026-02-30' },
  { ...verification, signedOn: undefined },
  { ...verification, actorUserId: actorId },
])('refuses invalid manual evidence before reading any document', async invalid => {
  expect((await post({ documentSha256: digest, verification: invalid })).status).toBe(400)
  expect(byProfile('service')).toEqual([])
})

it.each([
  { status: 403, code: '42501', message: 'price_addendum_staff_scope_required', expected: 403 },
  { status: 400, code: '23514', message: 'price_addendum_test_scope_required', expected: 403 },
  { status: 400, code: '23514', message: 'price_addendum_original_signature_or_effective_scope_changed', expected: 409 },
  { status: 409, code: '23505', message: 'price_addendum_review_conflict', expected: 409 },
  { status: 500, code: '55P03', message: 'busy', expected: 503 },
])('preserves native review authorities and conflict outcomes for $code', async ({ status, code, message, expected }) => {
  io.reviewReply = { status, body: { code, message, details: 'private-detail' } }
  const response = await post()
  expect(response.status).toBe(expected)
  expect(await response.text()).not.toContain('private-detail')
  expect(byProfile('service')).toHaveLength(2)
})

it.each([
  { ...receipt, kind: 'applied' },
  { ...receipt, documentId: uuid('bb') },
  { ...receipt, effectiveAt: '2026-10-24T23:00:00+00:00' },
  { ...receipt, effectiveAt: '2026-10-24T22:00:00.000001+00:00' },
  { ...receipt, verification },
])('requires exact scoped, unapplied status and the Stockholm transition', async body => {
  io.reviewReply.body = body
  const response = await post()
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error: 'price_addendum_review_unconfirmed' })
  expect(byProfile('service')).toHaveLength(2)
})
