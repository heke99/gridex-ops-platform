import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

const { validateResponse } = createRequire(import.meta.url)('../scripts/lib/openapi-schema-validator.cjs') as {
  validateResponse: (document: unknown, path: string, value: unknown, method?: string, status?: string) => string[]
}

/**
 * Tenantservice P6: the mounted support routes end to end through the real route handlers,
 * customerPortalJson (public payload safety) and the support domain, with an in-memory database.
 * Authentication and portal identity resolution are stubbed at their module boundary.
 */

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
let idCounter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`

function readPath(row: Row, field: string): unknown {
  const json = /^(\w+)->>(\w+)$/.exec(field)
  if (json) {
    const value = (row[json[1]] as Row | null)?.[json[2]]
    return value === undefined || value === null ? null : String(value)
  }
  return row[field]
}

function builder(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let mode: 'select' | 'insert' | 'update' = 'select'
  let pending: Row[] = []
  let patch: Row = {}
  let limit: number | null = null
  let ascending = true
  let head = false
  const api: Record<string, unknown> = {
    select: (_columns?: string, options?: { head?: boolean }) => { head = Boolean(options?.head); return api },
    gte: (field: string, value: string) => { filters.push((row) => String(readPath(row, field)) >= value); return api },
    eq: (field: string, value: unknown) => { filters.push((row) => readPath(row, field) === value); return api },
    in: (field: string, values: unknown[]) => { filters.push((row) => values.includes(readPath(row, field))); return api },
    contains: (field: string, value: Row) => {
      filters.push((row) => Object.entries(value).every(([key, v]) => (row[field] as Row | null)?.[key] === v))
      return api
    },
    or: () => api,
    order: (_field: string, options?: { ascending?: boolean }) => { ascending = options?.ascending ?? true; return api },
    limit: (value: number) => { limit = value; return api },
    insert: (value: Row | Row[]) => {
      mode = 'insert'
      pending = (Array.isArray(value) ? value : [value]).map((row) => ({
        id: nextId(), ...(table === 'customer_cases' ? { status: 'open', resolved_at: null } : {}), created_at: new Date(Date.now() + idCounter).toISOString(), updated_at: new Date().toISOString(), metadata: {}, ...row,
      }))
      db[table] = [...(db[table] ?? []), ...pending]
      return api
    },
    update: (value: Row) => { mode = 'update'; patch = value; return api },
    rows(): Row[] {
      if (mode === 'insert') return pending
      const matched = (db[table] ?? []).filter((row) => filters.every((filter) => filter(row)))
      if (mode === 'update') { matched.forEach((row) => Object.assign(row, patch)); return matched }
      const sorted = [...matched].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) * (ascending ? 1 : -1))
      return limit === null ? sorted : sorted.slice(0, limit)
    },
    single: async () => ({ data: (api.rows as () => Row[])()[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: (api.rows as () => Row[])()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => {
      const rows = (api.rows as () => Row[])()
      return resolve({ data: head ? null : rows, count: rows.length, error: null })
    },
  }
  return api
}

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => builder(table) } }))
vi.mock('@/lib/customer-portal/keysetPagination', () => ({
  portalPageLimit: (value?: number | null) => Math.min(Math.max(Math.trunc(value ?? 50), 1), 100),
  decodePortalCursor: () => null,
  PortalCursorError: class PortalCursorError extends Error {},
  buildPortalDatabasePage: (rows: Row[], input: { limit: number }) => ({
    items: rows.slice(0, input.limit),
    page: { limit: input.limit, offset: 0, returned: Math.min(rows.length, input.limit), has_more: rows.length > input.limit, next_cursor: null },
  }),
}))


const auth = vi.hoisted(() => ({ scopes: ['customer_support.read', 'customer_support.write'] as string[], binding: 'portal_account' as 'portal_account' | 'identifier_match', customerId: '' }))

vi.mock('@/lib/integrations/apiAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/integrations/apiAuth')>()
  return {
    ...original,
    requireIntegrationApiAccess: async (_request: unknown, required: unknown) => {
      const missing = original.missingIntegrationApiScopes(auth.scopes, Array.isArray(required) ? required as string[] : [])
      if (missing.length) return { ok: false, status: 403, error: 'scope saknas', errorCode: 'api_scope_missing', client: null }
      return { ok: true, client: { id: 'client-a', company_id: TENANT_A, scopes: auth.scopes }, context: {}, rateLimit: null }
    },
    logIntegrationApiRequest: async () => undefined,
    currentIntegrationApiResponseContext: () => null,
  }
})

vi.mock('@/lib/customer-portal/customerResolver', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/customer-portal/customerResolver')>()
  return {
    ...original,
    resolvePortalCustomer: async () => ({
      ok: true,
      binding: auth.binding,
      customer: { id: 'ident-a1', company_id: TENANT_A, customer_id: auth.customerId, external_customer_id: null, customer_number: 'A-1', email: null, auth_user_id: null, customer_portal_user_id: null, match_strength: 'strong', match_method: 'test', provider: 'test' },
    }),
  }
})

const TENANT_A = '0000000a-0000-4000-8000-000000000000'
const CUSTOMER_A1 = '000000a1-0000-4000-8000-000000000000'
const CUSTOMER_A2 = '000000a2-0000-4000-8000-000000000000'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i

function request(method: string, path: string, body?: unknown, key?: string) {
  return new NextRequest(`https://app.gridex.se${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  for (const key of Object.keys(db)) delete db[key]
  db.customers = [{ id: CUSTOMER_A1, company_id: TENANT_A }, { id: CUSTOMER_A2, company_id: TENANT_A }]
  db.customer_cases = []
  db.customer_case_events = []
  db.customer_portal_write_idempotency = []
  db.audit_logs = []
  auth.scopes = ['customer_support.read', 'customer_support.write']
  auth.binding = 'portal_account'
  auth.customerId = CUSTOMER_A1
})

describe('mounted customer support routes', () => {
  it('creates, lists and reads a case without leaking internal identifiers', async () => {
    const cases = await import('@/app/api/v1/customer/support/cases/route')
    const detail = await import('@/app/api/v1/customer/support/cases/[reference]/route')
    const created = await cases.POST(request('POST', '/api/v1/customer/support/cases', { title: 'Fel faktura', message: 'Beloppet stämmer inte.' }, 'key-0001-abcdefgh'))
    expect(created.status).toBe(201)
    const createdBody = await created.json()
    expect(createdBody.data.case_reference).toMatch(/^support_case_/)
    expect(createdBody.contract_schema_version).toBe(WEBSITE_INTEGRATION_CONTRACT_VERSION)
    expect(createdBody.data.status).toBe('received')
    expect(JSON.stringify(createdBody.data)).not.toMatch(UUID)

    const list = await cases.GET(request('GET', '/api/v1/customer/support/cases'))
    const listBody = await list.json()
    expect(list.status).toBe(200)
    expect(listBody.data).toHaveLength(1)
    expect(listBody.page).toMatchObject({ returned: 1, has_more: false })

    const read = await detail.GET(request('GET', `/api/v1/customer/support/cases/${createdBody.data.case_reference}`), { params: Promise.resolve({ reference: createdBody.data.case_reference }) })
    const readBody = await read.json()
    expect(read.status).toBe(200)
    expect(readBody.data.messages.map((message: { body: string }) => message.body)).toEqual(['Beloppet stämmer inte.'])
    expect(JSON.stringify(readBody.data)).not.toMatch(UUID)

    // Response shape matches the published closed schema fields.
    const spec = JSON.parse(readFileSync('docs/openapi/customer-portal-v1.json', 'utf8'))
    expect(validateResponse(spec, '/api/v1/customer/support/cases/{reference}', readBody)).toEqual([])
    const caseFields = Object.keys(spec.components.schemas.CustomerSupportCase.properties).sort()
    expect(Object.keys(createdBody.data).sort()).toEqual(caseFields)
    const messageFields = Object.keys(spec.components.schemas.CustomerSupportMessage.properties).sort()
    expect(Object.keys(readBody.data.messages[0]).sort()).toEqual(messageFields)
  })

  it('rejects writes bound only by customer identifiers', async () => {
    auth.binding = 'identifier_match'
    const cases = await import('@/app/api/v1/customer/support/cases/route')
    const response = await cases.POST(request('POST', '/api/v1/customer/support/cases', { title: 'x', message: 'y' }, 'key-0002-abcdefgh'))
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('customer_identity_binding_required')
    expect(db.customer_cases).toHaveLength(0)
  })

  it('requires the explicit support scopes; customer_portal.* alone is not enough', async () => {
    auth.scopes = ['customer_portal.read', 'customer_portal.write']
    const cases = await import('@/app/api/v1/customer/support/cases/route')
    expect((await cases.GET(request('GET', '/api/v1/customer/support/cases'))).status).toBe(403)
  })

  it('requires an Idempotency-Key for writes', async () => {
    const cases = await import('@/app/api/v1/customer/support/cases/route')
    const response = await cases.POST(request('POST', '/api/v1/customer/support/cases', { title: 'x', message: 'y' }))
    expect(response.status).toBe(400)
    expect(db.customer_cases).toHaveLength(0)
  })

  it('another customer of the same tenant gets 404 for a known reference', async () => {
    const cases = await import('@/app/api/v1/customer/support/cases/route')
    const messages = await import('@/app/api/v1/customer/support/cases/[reference]/messages/route')
    const created = await (await cases.POST(request('POST', '/api/v1/customer/support/cases', { title: 'A', message: 'B' }, 'key-0003-abcdefgh'))).json()
    auth.customerId = CUSTOMER_A2
    const reference = created.data.case_reference
    const read = await messages.GET(request('GET', `/api/v1/customer/support/cases/${reference}/messages`), { params: Promise.resolve({ reference }) })
    expect(read.status).toBe(404)
    const write = await messages.POST(request('POST', `/api/v1/customer/support/cases/${reference}/messages`, { message: 'hej' }, 'key-0004-abcdefgh'), { params: Promise.resolve({ reference }) })
    expect(write.status).toBe(404)
    expect(db.customer_case_events.filter((row) => row.customer_id === CUSTOMER_A2)).toHaveLength(0)
  })
})

describe('synthetic reference client (docs/examples) against the mounted routes', () => {
  it('opens, reads and replies through the published contract; another customer is denied', async () => {
    const cases = await import('@/app/api/v1/customer/support/cases/route')
    const detail = await import('@/app/api/v1/customer/support/cases/[reference]/route')
    const messages = await import('@/app/api/v1/customer/support/cases/[reference]/messages/route')
    const routeFetch = async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname
      const request = new NextRequest(url, init as never)
      const match = /^\/api\/v1\/customer\/support\/cases(?:\/([^/]+)(\/messages)?)?$/.exec(path)!
      const reference = match[1] ? decodeURIComponent(match[1]) : null
      const params = { params: Promise.resolve({ reference: reference ?? '' }) }
      if (!reference) return init.method === 'POST' ? cases.POST(request) : cases.GET(request)
      if (match[2]) return init.method === 'POST' ? messages.POST(request, params) : messages.GET(request, params)
      return detail.GET(request, params)
    }
    const { createSupportClient } = await import('../docs/examples/tenant-support-reference-client.mjs')
    const client = createSupportClient({ apiKey: 'synthetic-key', portalUserId: 'synthetic-portal-user', fetchImpl: routeFetch as unknown as typeof fetch })
    const opened = await client.openCase({ title: 'Fråga om faktura', message: 'Syntetiskt testärende.' })
    expect(opened.data.status).toBe('received')
    await client.reply(opened.data.case_reference, 'Tillägg från kunden.')
    const read = await client.getCase(opened.data.case_reference)
    expect(read.data.messages.map((message: { author_type: string }) => message.author_type)).toEqual(['customer', 'customer'])
    expect((await client.listCases()).data).toHaveLength(1)
    auth.customerId = CUSTOMER_A2
    await expect(client.getCase(opened.data.case_reference)).rejects.toMatchObject({ status: 404, code: 'support_case_not_found' })
  })
})
