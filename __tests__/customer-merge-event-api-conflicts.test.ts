import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The real mounted event handlers and shared support/event/idempotency writes run; only
// database transport, verified identity, authentication and secondary telemetry are replaced.

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
let idCounter = 0
let injectedGuardHits: string[] = []
let injectedGuardTable = ''
let injectedGuardCode = '23514'
let injectedGuardMessage = 'customer_merged_write_conflict'
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
  let guardBlocked = false
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
      if (table === injectedGuardTable) { injectedGuardHits.push(table); guardBlocked = true; return api }
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
    single: async () => guardBlocked ? { data: null, error: { code: injectedGuardCode, message: injectedGuardMessage } } : ({ data: (api.rows as () => Row[])()[0] ?? null, error: null }),
    maybeSingle: async () => guardBlocked ? { data: null, error: { code: injectedGuardCode, message: injectedGuardMessage } } : ({ data: (api.rows as () => Row[])()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => {
      const rows = (api.rows as () => Row[])()
      return resolve({ data: head ? null : rows, count: rows.length, error: guardBlocked ? { code: injectedGuardCode, message: injectedGuardMessage } : null })
    },
  }
  return api
}

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => builder(table) } }))
vi.mock('@/lib/customer-portal/keysetPagination', () => ({
  portalPageLimit: (value?: number | null) => Math.min(Math.max(Math.trunc(value ?? 50), 1), 100),
  decodePortalCursor: () => null,
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
      return { ok: true, client: { id: 'client-a', company_id: TENANT_A, scopes: auth.scopes }, context: { companyId: TENANT_A }, rateLimit: null }
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

function request(method: string, path: string, body?: unknown, key?: string) {
  return new NextRequest(`https://app.gridex.se${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  injectedGuardHits = []
  injectedGuardTable = ''
  injectedGuardCode = '23514'
  injectedGuardMessage = 'customer_merged_write_conflict'
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

vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: async () => ({ id: '10000000-0000-4000-8000-000000000001' }), listDomainEventsForCompany: async () => [] }))
vi.mock('@/lib/audit/actionLogger', () => ({ logUsageEvent: async () => undefined }))

describe('mounted customer event merge conflicts', () => {
  it.each([
    ['/api/v1/events', 'customer_portal_write_idempotency'],
    ['/api/v1/events', 'customer_events'],
    ['/api/v1/events', 'customer_cases'],
    ['/api/v1/events', 'customer_case_events'],
    ['/api/v1/website/customer-events', 'customer_portal_write_idempotency'],
    ['/api/v1/website/customer-events', 'customer_events'],
    ['/api/v1/website/customer-events', 'customer_cases'],
    ['/api/v1/website/customer-events', 'customer_case_events'],
  ])('%s returns a controlled 409 for exact guard from %s', async (path, table) => {
    auth.scopes = ['website_events.write']
    injectedGuardTable = table
    const route = path === '/api/v1/events' ? await import('@/app/api/v1/events/route') : await import('@/app/api/v1/website/customer-events/route')
    const response = await route.POST(request('POST', path, {
      event_type: table.startsWith('customer_case') ? 'customer.support_requested' : 'customer.synthetic_review',
      event_reference: 'synthetic-review-event', occurred_at: '2026-10-02T12:00:00Z',
      customer: { external_customer_id: 'synthetic-review-customer' }, subject: { type: 'customer' }, data: { title: 'Synthetic review probe', message: 'Synthetic review probe' },
    }, 'auditguard-event-01-abcdefgh'))
    expect(response.status).toBe(409)
    expect(injectedGuardHits).toEqual([table])
    expect(db[table] ?? []).toEqual([])
    expect((await response.json()).error.code).toBe('portal_identity_customer_conflict')
  })
  it.each(['/api/v1/events', '/api/v1/website/customer-events'])('keeps normal non-support %s accepted', async (path) => {
    auth.scopes = ['website_events.write']
    const route = path === '/api/v1/events' ? await import('@/app/api/v1/events/route') : await import('@/app/api/v1/website/customer-events/route')
    const response = await route.POST(request('POST', path, {
      event_type: 'customer.synthetic_review', event_reference: 'synthetic-review-event', occurred_at: '2026-10-02T12:00:00Z',
      customer: { external_customer_id: 'synthetic-review-customer' }, subject: { type: 'customer' }, data: {},
    }, 'auditguard-event-02-abcdefgh'))
    expect(response.status).toBe(200)
    expect((await response.json()).data.status).toBe('accepted')
  })
})


describe('event routes preserve unrelated database errors', () => {
  it.each([
    ['/api/v1/events', '23514', 'some_other_constraint'],
    ['/api/v1/events', '42501', 'customer_merged_write_conflict'],
    ['/api/v1/website/customer-events', '23514', 'some_other_constraint'],
    ['/api/v1/website/customer-events', '42501', 'customer_merged_write_conflict'],
  ])('%s retains generic 500 for %s/%s', async (path, code, message) => {
    auth.scopes = ['website_events.write']
    injectedGuardTable = 'customer_events'
    injectedGuardCode = code
    injectedGuardMessage = message
    const route = path === '/api/v1/events' ? await import('@/app/api/v1/events/route') : await import('@/app/api/v1/website/customer-events/route')
    const response = await route.POST(request('POST', path, {
      event_type: 'customer.synthetic_review', event_reference: 'synthetic-review-event', occurred_at: '2026-10-02T12:00:00Z',
      customer: { external_customer_id: 'synthetic-review-customer' }, subject: { type: 'customer' }, data: {},
    }, 'auditguard-event-03-abcdefgh'))
    expect(response.status).toBe(500)
    expect((await response.json()).error.code).toBe('customer_event_failed')
  })
})

describe('website application guarded stage response', () => {
  it.each(['portal_identity_create', 'portal_user_link', 'idempotency'] as const)('maps exact merged-write conflict at %s to its existing 409 application response', async (stageName) => {
    const { stage, WebsiteApplicationError } = await import('@/lib/website/customerApplicationShared')
    const error = await stage(stageName, async () => { throw { code: '23514', message: 'customer_merged_write_conflict' } }).catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(WebsiteApplicationError)
    expect(error).toMatchObject({ status: 409, code: 'portal_identity_customer_conflict', stage: stageName })
  })

  it.each([
    { code: '23514', message: 'some_other_constraint' },
    { code: '42501', message: 'customer_merged_write_conflict' },
  ])('preserves unrelated stage error %o', async (error) => {
    const { stage } = await import('@/lib/website/customerApplicationShared')
    await expect(stage('portal_user_link', async () => { throw error })).rejects.toMatchObject({ status: 500, code: error.code, stage: 'portal_user_link' })
  })
})
