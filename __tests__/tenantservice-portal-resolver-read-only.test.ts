import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tenantservice P1a: the portal customer resolver is read-only by default, a presented but
 * unlinked/blocked portal user never falls back to identifier matching, and end-customer
 * mutations require an actively linked portal account.
 *
 * The fake below is an in-memory PostgREST stand-in: it applies eq/not filters and records
 * every write so the tests can assert that reads perform no writes.
 */

type Row = Record<string, unknown>
type Write = { table: string; op: 'insert' | 'update' | 'upsert' | 'delete'; payload: unknown }

const state: { tables: Record<string, Row[]>; writes: Write[]; rpcRows: Row[] } = {
  tables: {},
  writes: [],
  rpcRows: [],
}

function builder(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let op: Write['op'] | null = null
  let limit: number | null = null
  const api = {
    select: () => api,
    eq: (field: string, value: unknown) => {
      filters.push((row) => row[field] === value)
      return api
    },
    not: (field: string) => {
      filters.push((row) => row[field] !== null && row[field] !== undefined)
      return api
    },
    limit: (value: number) => {
      limit = value
      return api
    },
    order: () => api,
    insert: (payload: unknown) => {
      op = 'insert'
      state.writes.push({ table, op, payload })
      return api
    },
    update: (payload: unknown) => {
      op = 'update'
      state.writes.push({ table, op, payload })
      return api
    },
    upsert: (payload: unknown) => {
      op = 'upsert'
      state.writes.push({ table, op, payload })
      return api
    },
    delete: () => {
      op = 'delete'
      state.writes.push({ table, op, payload: null })
      return api
    },
    rows() {
      const rows = (state.tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)))
      return limit === null ? rows : rows.slice(0, limit)
    },
    maybeSingle: async () => ({ data: op ? { id: 'written' } : api.rows()[0] ?? null, error: null }),
    single: async () => ({ data: op ? { id: 'written' } : api.rows()[0] ?? null, error: null }),
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) => resolve({ data: op ? [] : api.rows(), error: null }),
  }
  return api
}

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => builder(table),
    rpc: async () => ({ data: state.rpcRows, error: null }),
  },
}))

const COMPANY_A = '00000000-0000-4000-8000-00000000000a'
const COMPANY_B = '00000000-0000-4000-8000-00000000000b'
const CUSTOMER_A1 = '10000000-0000-4000-8000-0000000000a1'
const CUSTOMER_B1 = '10000000-0000-4000-8000-0000000000b1'
const USER_LINKED = '20000000-0000-4000-8000-000000000001'
const USER_UNLINKED = '20000000-0000-4000-8000-000000000002'
const USER_BLOCKED = '20000000-0000-4000-8000-000000000003'

const clientA = { id: 'client-a', company_id: COMPANY_A } as never
const clientB = { id: 'client-b', company_id: COMPANY_B } as never

function seed() {
  state.writes = []
  state.rpcRows = []
  state.tables = {
    customers: [
      { id: CUSTOMER_A1, company_id: COMPANY_A, customer_number: 'A-1001', email: 'kund@example.test', status: 'active' },
      { id: CUSTOMER_B1, company_id: COMPANY_B, customer_number: 'B-1001', email: 'kund@example.test', status: 'active' },
    ],
    customer_profiles: [],
    tenant_portal_customer_links: [],
    customer_portal_identities: [],
    customer_portal_accounts: [
      { id: 'acct-linked', company_id: COMPANY_A, customer_id: CUSTOMER_A1, portal_user_id: USER_LINKED, user_id: USER_LINKED, status: 'active', is_active: true },
      { id: 'acct-blocked', company_id: COMPANY_A, customer_id: CUSTOMER_A1, portal_user_id: USER_BLOCKED, user_id: USER_BLOCKED, status: 'disabled', is_active: false },
    ],
  }
}

const identifiers = (overrides: Record<string, string | null>) => ({
  externalCustomerId: null,
  customerNumber: null,
  email: null,
  authUserId: null,
  customerPortalUserId: null,
  ...overrides,
})

describe('tenantservice portal resolver (read-only by default)', () => {
  beforeEach(seed)

  it('resolves an actively linked portal account as portal_account binding without writing', async () => {
    const { resolvePortalCustomer } = await import('@/lib/customer-portal/customerResolver')
    const result = await resolvePortalCustomer({ client: clientA, identifiers: identifiers({ customerPortalUserId: USER_LINKED }) })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.binding).toBe('portal_account')
    expect(result.customer.customer_id).toBe(CUSTOMER_A1)
    expect(state.writes).toEqual([])
  })

  it('does not auto-link an unlinked user on read, even with customer number and email', async () => {
    const { resolvePortalCustomer } = await import('@/lib/customer-portal/customerResolver')
    const result = await resolvePortalCustomer({
      client: clientA,
      identifiers: identifiers({ customerPortalUserId: USER_UNLINKED, customerNumber: 'A-1001', email: 'kund@example.test' }),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(403)
    expect(result.code).toBe('customer_portal_link_required')
    expect(state.writes).toEqual([])
  })

  it('never reactivates a blocked account or falls back to identifiers on read', async () => {
    const { resolvePortalCustomer } = await import('@/lib/customer-portal/customerResolver')
    const result = await resolvePortalCustomer({
      client: clientA,
      identifiers: identifiers({ customerPortalUserId: USER_BLOCKED, customerNumber: 'A-1001', email: 'kund@example.test' }),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('customer_portal_link_required')
    expect(state.writes).toEqual([])
    expect(state.tables.customer_portal_accounts.find((row) => row.id === 'acct-blocked')?.is_active).toBe(false)
  })

  it('marks identifier-only matches as identifier_match binding', async () => {
    const { resolvePortalCustomer } = await import('@/lib/customer-portal/customerResolver')
    const result = await resolvePortalCustomer({ client: clientA, identifiers: identifiers({ customerNumber: 'A-1001' }) })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.binding).toBe('identifier_match')
    expect(state.writes).toEqual([])
  })

  it('a linked user of tenant A is not resolved through tenant B client', async () => {
    const { resolvePortalCustomer } = await import('@/lib/customer-portal/customerResolver')
    const result = await resolvePortalCustomer({ client: clientB, identifiers: identifiers({ customerPortalUserId: USER_LINKED }) })
    expect(result.ok).toBe(false)
    expect(state.writes).toEqual([])
  })

  it('explicit link mode still performs the controlled link operation', async () => {
    const { resolvePortalCustomer } = await import('@/lib/customer-portal/customerResolver')
    await resolvePortalCustomer({
      client: clientA,
      mode: 'link',
      identifiers: identifiers({ customerPortalUserId: USER_UNLINKED, customerNumber: 'A-1001', email: 'kund@example.test' }),
    }).catch(() => null)
    expect(state.writes.some((write) => write.table === 'customer_portal_accounts' || write.table === 'customer_portal_identities')).toBe(true)
  })

  it('link mode refuses to reactivate a blocked account and writes nothing', async () => {
    const { resolvePortalCustomer } = await import('@/lib/customer-portal/customerResolver')
    const result = await resolvePortalCustomer({
      client: clientA,
      mode: 'link',
      identifiers: identifiers({ customerPortalUserId: USER_BLOCKED, customerNumber: 'A-1001', email: 'kund@example.test' }),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('customer_portal_link_blocked')
    expect(state.writes).toEqual([])
  })

  it('link mode refuses to take over a revoked identity of the customer', async () => {
    state.tables.customer_portal_identities.push({
      id: 'ident-revoked', company_id: COMPANY_A, customer_id: CUSTOMER_A1, provider: 'gridex_website', status: 'revoked',
    })
    const { resolvePortalCustomer } = await import('@/lib/customer-portal/customerResolver')
    const result = await resolvePortalCustomer({
      client: clientA,
      mode: 'link',
      identifiers: identifiers({ customerPortalUserId: USER_UNLINKED, customerNumber: 'A-1001', email: 'kund@example.test' }),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('customer_portal_link_blocked')
    expect(state.writes).toEqual([])
  })

  it('link mode refuses to rebind an identity owned by another portal user', async () => {
    state.tables.customer_portal_identities.push({
      id: 'ident-other', company_id: COMPANY_A, customer_id: CUSTOMER_A1, provider: 'gridex_website', status: 'active',
      customer_portal_user_id: USER_LINKED, auth_user_id: USER_LINKED,
    })
    const { resolvePortalCustomer } = await import('@/lib/customer-portal/customerResolver')
    const result = await resolvePortalCustomer({
      client: clientA,
      mode: 'link',
      identifiers: identifiers({ customerPortalUserId: USER_UNLINKED, customerNumber: 'A-1001', email: 'kund@example.test' }),
    })
    expect(result.ok).toBe(false)
    expect(state.writes).toEqual([])
  })
})

describe('tenantservice end-customer mutation binding gate', () => {
  it('allows reads on any binding and mutations only on portal_account unless machine flow', async () => {
    const { customerPortalBindingAllowsRequest } = await import('@/lib/customer-portal/externalApi')
    expect(customerPortalBindingAllowsRequest('GET', 'identifier_match')).toBe(true)
    expect(customerPortalBindingAllowsRequest('POST', 'portal_account')).toBe(true)
    expect(customerPortalBindingAllowsRequest('POST', 'identifier_match')).toBe(false)
    expect(customerPortalBindingAllowsRequest('PATCH', 'identifier_match')).toBe(false)
    expect(customerPortalBindingAllowsRequest('DELETE', 'identifier_match')).toBe(false)
    expect(customerPortalBindingAllowsRequest('POST', 'identifier_match', { allowIdentifierBoundWrite: true })).toBe(true)
  })

  it('only the tenant sync route opts into identifier-bound machine writes', async () => {
    const { readFileSync } = await import('node:fs')
    const { execSync } = await import('node:child_process')
    const files = execSync("grep -rl 'allowIdentifierBoundWrite: true' app lib || true", { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
    expect(files).toEqual(['app/api/v1/customer/sync/route.ts'])
    expect(readFileSync('app/api/v1/customer/sync/route.ts', 'utf8')).toContain("mode: 'link'")
  })
})
