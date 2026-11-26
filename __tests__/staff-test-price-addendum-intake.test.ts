import { createHash } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/internal/contracts/[contractId]/price-addenda/route'
import type { createClient } from '@supabase/supabase-js'

const uuid = (n: string) => `10000000-0000-4000-8000-0000000000${n}`
const companyId = uuid('aa')
const otherCompanyId = uuid('ab')
const actorId = uuid('ac')
const customerId = uuid('ad')
const contractId = uuid('ae')
const submissionKey = uuid('af')
const documentId = uuid('ba')
const pdf = Buffer.from('%PDF-1.7\nInert archival transport fixture\n%%EOF\n')
const documentBase64 = pdf.toString('base64')
const digest = createHash('sha256').update(pdf).digest('hex')
const correctlyPending = { kind: 'pending', documentId, documentSha256: digest, byteLength: pdf.length, existing: false }
const archiveRpc = 'gridex_archive_test_contract_price_addendum_v1'
const permissions = ['contracts.write', 'documents.write']
const io = vi.hoisted(() => ({
  token: true,
  selected: '',
  granted: [] as string[],
  writable: true,
  contract: null as unknown,
  reply: { status: 200, body: null as unknown },
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
      if (url.pathname === '/rest/v1/rpc/' + archiveRpc && profile === 'service') {
        return Response.json(io.reply.body, { status: io.reply.status })
      }
      throw Error('unexpected transport')
    } },
  })
}

function prepare(body = JSON.stringify({ submissionKey, documentBase64 }), options: { mediaType?: string; declaredLength?: number } = {}) {
  const headers = new Headers({ 'content-type': options.mediaType ?? 'application/json' })
  if (options.declaredLength !== undefined) headers.set('content-length', String(options.declaredLength))
  return new Request(`http://127.0.0.1:1/api/internal/contracts/${contractId}/price-addenda`, {
    method: 'POST',
    headers,
    body,
  })
}

function post(request = prepare(), contract = contractId) {
  return POST(request, { params: Promise.resolve({ contractId: contract }) })
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
  io.reply = { status: 200, body: correctlyPending }
  io.requests.length = 0
})

it('stages exact custody with canonical selected company and never claims sign-off', async () => {
  const req = prepare(JSON.stringify({ submissionKey: submissionKey.toUpperCase(), documentBase64 }))
  const response = await post(req, contractId.toUpperCase())
  expect(response.status).toBe(201)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(await response.json()).toEqual(correctlyPending)
  expect(byProfile('service')).toHaveLength(1)
  expect(byProfile('service')[0].body).toEqual({
    p_company_id: companyId,
    p_actor_user_id: actorId,
    p_customer_id: customerId,
    p_contract_id: contractId,
    p_submission_key: submissionKey,
    p_document_base64: documentBase64,
  })
  const lookups = byProfile('actor')
  expect(lookups[1].body).toEqual({ p_company_id: companyId })
  expect(lookups[2].url.searchParams.get('company_id')).toBe(`eq.${companyId}`)
  expect(lookups[2].url.searchParams.get('id')).toBe(`eq.${contractId}`)
})

it('uses the pending replay receipt without taking new archive actions', async () => {
  io.reply.body = { ...correctlyPending, existing: true }
  const response = await post()
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(io.reply.body)
  expect(byProfile('service')).toHaveLength(1)
})

it.each([
  { label: 'anonymous', configure: () => { io.token = false }, status: 401 },
  { label: 'documents.write only', configure: () => { io.granted = ['documents.write'] }, status: 403 },
  { label: 'contracts.write only', configure: () => { io.granted = ['contracts.write'] }, status: 403 },
  { label: 'non-writable company', configure: () => { io.writable = false }, status: 403 },
  { label: 'other company row', configure: () => { io.contract = {id: contractId, company_id: otherCompanyId, customer_id: customerId} }, status: 404 },
  { label: 'missing company selection', configure: () => { io.selected = '' }, status: 403 },
  { label: 'hidden contract', configure: () => { io.contract = null }, status: 404 },
])('stops $label before consuming evidence or invoking service custody', async ({ configure, status }) => {
  configure()
  const req = prepare()
  const read = vi.spyOn(req.body!, 'getReader')
  const response = await post(req)
  expect(response.status).toBe(status)
  expect(byProfile('service')).toEqual([])
  expect(read).not.toHaveBeenCalled()
})

it.each([
  ['caller authorization', JSON.stringify({ submissionKey, documentBase64, actorId })],
  ['caller review', JSON.stringify({ submissionKey, documentBase64, kind: 'reviewed' })],
  ['non-canonical Base64', JSON.stringify({ submissionKey, documentBase64: documentBase64 + '\n' })],
  ['non-PDF bytes', JSON.stringify({ submissionKey, documentBase64: Buffer.from('Plain text artifact').toString('base64') })],
  ['invalid JSON', '{invalid'],
])('rejects %s without RPC', async (_label, body) => {
  expect((await post(prepare(body))).status).toBe(400)
  expect(byProfile('service')).toEqual([])
})

it('refuses a mismatched content type and an oversize body at ingress', async () => {
  expect((await post(prepare('{}', { mediaType: 'text/plain' }))).status).toBe(415)
  expect((await post(prepare('{}', { declaredLength: 4000000 }))).status).toBe(413)
  expect((await post(prepare(' '.repeat(2_800_000)))).status).toBe(413)
  const oversize = JSON.stringify({ submissionKey, documentBase64: 'A'.repeat(2_796_208) })
  expect((await post(prepare(oversize))).status).toBe(413)
  expect(byProfile('service')).toEqual([])
})

it.each([
  { status: 403, code: '42501', message: 'price_addendum_staff_scope_required', expected: 403 },
  { status: 400, code: '23514', message: 'price_addendum_test_scope_required', expected: 403 },
  { status: 400, code: '23514', message: 'price_addendum_original_signature_required', expected: 409 },
  { status: 400, code: '22023', message: 'price_addendum_document_invalid', expected: 400 },
  { status: 409, code: '23505', message: 'price_addendum_submission_conflict', expected: 409 },
  { status: 404, code: 'PGRST202', message: 'synthetic schema message', expected: 503 },
  { status: 500, code: '55P03', message: 'synthetic busy detail', expected: 503 },
])('keeps a bounded status $expected when native declines $code', async ({ status, code, message, expected }) => {
  io.reply = { status, body: { code, message, details: 'private detail' } }
  const response = await post()
  expect(response.status).toBe(expected)
  expect(await response.text()).not.toContain('private detail')
  expect(byProfile('service')).toHaveLength(1)
})

it.each([
  { ...correctlyPending, documentSha256: '0'.repeat(64) },
  { ...correctlyPending, byteLength: correctlyPending.byteLength + 1 },
  { ...correctlyPending, kind: 'reviewed_unapplied' },
  { ...correctlyPending, bodyBase64: 'unexpected content' },
])('fails unconfirmed if native response is not the exact pending receipt', async body => {
  io.reply.body = body
  const response = await post()
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error: 'price_addendum_archive_unconfirmed' })
  expect(byProfile('service')).toHaveLength(1)
})
