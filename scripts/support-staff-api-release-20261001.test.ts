import { beforeEach, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { isValidElement, type ReactNode } from 'react'
import { NextRequest } from 'next/server'
import portal from '@/docs/openapi/customer-portal-v1.json'
import { publicReference } from '@/lib/integrations/publicReferences'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'
const { validateResponse, validateSchema } = createRequire(import.meta.url)('../scripts/lib/openapi-schema-validator.cjs')

const io = vi.hoisted(() => ({ messages: [] as Array<Record<string, unknown>>, requests: [] as URL[] }))
const companyId = 'f0340000-0000-4000-8000-000000000001'
const customerId = 'f0340000-0000-4000-8000-000000000002'
const caseId = 'f0340000-0000-4000-8000-000000000003'
const readerId = 'f0340000-0000-4000-8000-000000000004'
const staffId = 'f0340000-0000-4000-8000-000000000005'
const secondStaffId = 'f0340000-0000-4000-8000-000000000006'
const at = '2026-10-01T00:00:00.000Z'
const reference = publicReference('case', companyId, caseId)!
const currentCase = { id: caseId, case_reference: reference, title: 'Synthetic saved support summary', status: 'open', revision: 4, created_at: at, updated_at: at }
const path = '/api/v1/customer/cases/{reference}/messages'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/env/supabaseServer', () => ({ getSupabaseServiceEnv: () => ({ serviceRoleKey: 'nonworking-functional-fixture-only' }) }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('http://staff-parity.invalid', 'nonworking-outer-db-placeholder', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
      const url = new URL(String(input)); io.requests.push(url)
      if (url.pathname.endsWith('/rpc/gridex_support_case_read_v1')) {
        const { p_query } = JSON.parse(String(init?.body))
        return Response.json(p_query.reference ? { caseId, case: currentCase, items: io.messages } : { items: [] })
      }
      if (url.pathname.endsWith('/rpc/gridex_support_attachment_read_v1')) return Response.json({ items: [] })
      if (url.pathname.endsWith('/customer_portal_accounts')) return Response.json({ role: 'reader' })
      if (url.pathname.endsWith('/customer_support_threads')) return Response.json([{ id: caseId, public_reference: reference }])
      if (url.pathname.endsWith('/customer_case_publications')) return Response.json([])
      throw new Error('unexpected_functional_projection_query')
    } },
  }) }
})
// Only functional outer identity/context is controlled. No Auth/credentials,
// permission/role/security exercise, database/network or provider call occurs.
vi.mock('@/lib/customer-portal/externalApi', async original => ({
  ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
  requireCustomerPortalApiContext: async () => ({ ok: true, client: { id: staffId, company_id: companyId },
    identity: { customer_id: customerId, customer_portal_user_id: readerId }, startedAt: 1 }),
  logCustomerPortalSuccess: async () => undefined,
}))
vi.mock('@/lib/customer-portal/db', async original => ({
  ...await original<typeof import('@/lib/customer-portal/db')>(),
  getCustomerPortalContext: async () => ({ companyId, customerIds: [customerId], customers: [{ id: customerId }] }),
}))
vi.mock('@/lib/customer-operations/supportSession', () => ({ currentSupportSession: async () => ({ kind: 'portal', userId: readerId, sessionId: secondStaffId }) }))
vi.mock('@/app/portal/arenden/actions', () => ({ createPortalSupportCaseAction: vi.fn(), createPortalSupportCaseFallbackAction: vi.fn(),
  replyPortalSupportCaseAction: vi.fn(), replyPortalSupportCaseFallbackAction: vi.fn(), uploadPortalSupportAttachmentAction: vi.fn(), uploadPortalSupportAttachmentFallbackAction: vi.fn() }))

function message(authorKind: 'staff' | 'customer', savedActor: string | null | undefined, n = 1) {
  return { id: `f0340000-0000-4000-8000-${String(100 + n).padStart(12, '0')}`, body: `Synthetic visible message ${n}`, author_kind: authorKind,
    ...(savedActor === undefined ? {} : { actor_user_id: savedActor }), channel: authorKind === 'staff' ? 'phone' : 'portal', revision: n, created_at: at }
}
function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join(' ')
  return isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : ''
}
beforeEach(() => { io.messages = []; io.requests = [] })

it.each([['staff', staffId], ['staff', null], ['staff', undefined], ['customer', readerId]] as const)(
  'actual GET/public DTO for %s saved actor %s agrees with the authoritative closed message schema', async (kind, savedActor) => {
    io.messages = [message(kind, savedActor)]
    const { GET } = await import('@/app/api/v1/customer/cases/[reference]/messages/route')
    const response = await GET(new NextRequest(`http://staff-parity.invalid/api/v1/customer/cases/${reference}/messages`), { params: Promise.resolve({ reference }) })
    expect(response.status).toBe(200)
    const envelope = await response.json()
    expect(envelope.data[0].author_reference).toBe(kind === 'staff' && savedActor ? publicReference('support_staff', companyId, savedActor) : null)
    expect(Object.keys(envelope.data[0]).sort()).toEqual(['message_reference', 'body', 'author_kind', 'author_reference', 'channel', 'revision', 'created_at'].sort())
    expect(JSON.stringify(envelope)).not.toContain(staffId)
    expect(response.headers.get('x-gridex-contract-version')).toBe(WEBSITE_INTEGRATION_CONTRACT_VERSION)
    expect(envelope.contract_schema_version).toBe(WEBSITE_INTEGRATION_CONTRACT_VERSION)
    expect(validateResponse(portal, path, envelope)).toEqual([])
  },
)

it('author_reference is required, nullable, and restricted to the exact existing opaque staff-reference shape', () => {
  const schema = portal.components.schemas.CustomerSupportMessage
  const valid = { message_reference: publicReference('case_message', companyId, caseId), body: 'Synthetic', author_kind: 'staff', author_reference: publicReference('support_staff', companyId, staffId), channel: 'phone', revision: 1, created_at: at }
  expect(validateSchema(portal, valid, schema)).toEqual([])
  expect(validateSchema(portal, { ...valid, author_reference: null }, schema)).toEqual([])
  for (const author_reference of [staffId, 'support_staff_short', 'support_staff_' + 'a'.repeat(33), 'person_' + 'a'.repeat(32)]) {
    expect(validateSchema(portal, { ...valid, author_reference }, schema).length).toBeGreaterThan(0)
  }
  const missing: Partial<typeof valid> = { ...valid }
  delete missing.author_reference
  expect(validateSchema(portal, missing, schema).length).toBeGreaterThan(0)
  expect(validateSchema(portal, { ...valid, actor_user_id: staffId }, schema).length).toBeGreaterThan(0)
})

it('actual portal Page shows two saved opaque staff authors separately and retains the generic unknown-author label', async () => {
  io.messages = [message('staff', staffId, 4), message('staff', secondStaffId, 3), message('staff', null, 2), message('customer', readerId, 1)]
  const { default: Page } = await import('@/app/portal/arenden/page')
  const content = text(await Page({ searchParams: Promise.resolve({ case_reference: reference }) }))
  expect(content).toContain(publicReference('support_staff', companyId, staffId))
  expect(content).toContain(publicReference('support_staff', companyId, secondStaffId))
  expect(content).toContain('Kundservice')
  expect(content).not.toContain(readerId); expect(content).not.toContain(staffId)
})

it('actual exported reference flow refuses a message author outside the authoritative nullable staff shape', async () => {
  const { runCustomerSupportReference } = await import('./tenantservice/customer-api-reference.mjs')
  const messageReference = publicReference('case_message', companyId, caseId)!
  const readMessages = [
    { message_reference: messageReference, body: 'Initial', author_kind: 'customer', author_reference: null },
    { message_reference: messageReference, body: 'Continuation', author_kind: 'staff', author_reference: staffId },
  ]
  let creates = 0, replies = 0
  vi.stubGlobal('fetch', async (_input: unknown, init?: RequestInit) => {
    const method = init?.method ?? 'GET', url = new URL(String(_input))
    const data = url.pathname.endsWith('/messages')
      ? method === 'GET' ? readMessages : { message_reference: messageReference, revision: 2, replayed: ++replies > 1 }
      : method === 'GET' ? [{ case_reference: reference }] : { case_reference: reference, revision: 1, replayed: ++creates > 1 }
    return Response.json({ data }, { status: method === 'GET' ? 200 : 201 })
  })
  try {
    await expect(runCustomerSupportReference({ baseUrl: 'https://staff-reference.invalid', apiKey: 'nonworking-functional-placeholder',
      customerNumber: 'SYNTHETIC', signAssertion: async () => 'nonworking-controlled-outer-assertion', title: 'Synthetic',
      body: 'Initial', continuation: 'Continuation', createKey: 'synthetic-create', replyKey: 'synthetic-reply' }))
      .rejects.toThrow('support_reference_author_invalid')
  } finally { vi.unstubAllGlobals() }
})

it('reference helper preserves valid staff attribution and explicit unknown/customer null without deriving a person', async () => {
  const { readSupportMessageAuthorReference } = await import('./tenantservice/customer-api-reference.mjs')
  const saved = publicReference('support_staff', companyId, staffId)
  expect(readSupportMessageAuthorReference({ author_kind: 'staff', author_reference: saved })).toBe(saved)
  expect(readSupportMessageAuthorReference({ author_kind: 'staff', author_reference: null })).toBeNull()
  expect(readSupportMessageAuthorReference({ author_kind: 'customer', author_reference: null })).toBeNull()
  for (const item of [{ author_kind: 'staff' }, { author_kind: 'staff', author_reference: staffId },
    { author_kind: 'customer', author_reference: saved }]) {
    expect(() => readSupportMessageAuthorReference(item)).toThrow('support_reference_author_invalid')
  }
})
