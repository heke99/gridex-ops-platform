import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const m = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, writes: [] as string[] }))
function query(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let maximum = Infinity
  const rows = () => (m.tables[table] ?? []).filter((row) => filters.every((filter) => filter(row))).slice(0, maximum)
  const q = {
    select: () => q,
    eq: (field: string, value: unknown) => { filters.push((row) => row[field] === value); return q },
    not: (field: string, _operator: string, value: unknown) => { filters.push((row) => row[field] !== value); return q },
    limit: (value: number) => { maximum = value; return q },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    insert: () => { m.writes.push(table); return q },
    update: () => { m.writes.push(table); return q },
    then: (resolve: (value: unknown) => unknown) => resolve({ data: rows(), error: null }),
  }
  return q
}
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: query, rpc: async () => ({ data: [], error: null }) } }))
const COMPANY_A = '00000000-0000-4000-8000-000000000001'
const COMPANY_B = '00000000-0000-4000-8000-000000000002'
const CUSTOMER = '00000000-0000-4000-8000-000000000003'
const SUBJECT = 'tenant-owned-account-subject-42'
const client = { id: 'synthetic-client', company_id: COMPANY_A, scopes: ['customer_sync.write'] } as never
beforeEach(() => {
  m.writes = []
  m.tables = {
    customers: [{ id: CUSTOMER, company_id: COMPANY_A, customer_number: 'synthetic-number', status: 'active' }],
    customer_portal_accounts: [{ id: 'synthetic-account', company_id: COMPANY_A, customer_id: CUSTOMER, external_account_id: SUBJECT, status: 'active', is_active: true }],
    customer_portal_identities: [], customer_profiles: [],
  }
})
async function resolve(payload: Record<string, unknown>) {
  const { parseTenantCustomerSyncPayload } = await import('@/lib/customer-portal/customerSyncContract')
  const { portalIdentifiersFromPayload } = await import('@/lib/customer-portal/externalApi')
  const { resolvePortalCustomer } = await import('@/lib/customer-portal/customerResolver')
  return resolvePortalCustomer({ client, identifiers: portalIdentifiersFromPayload(parseTenantCustomerSyncPayload(payload)), mode: 'link' })
}
describe('customer sync tenant authenticated account subject', () => {
  it('maps the sole canonical field and resolves an already active account in the credential company', async () => {
    const result = await resolve({ authenticated_user_reference: SUBJECT })
    expect(result).toMatchObject({ ok: true, binding: 'portal_account', customer: { company_id: COMPANY_A, customer_id: CUSTOMER } })
    expect(m.writes).toEqual([])
  })
  it.each(['missing', 'wrong company', 'disabled'])('never grants or links an account that is %s', async (kind) => {
    if (kind === 'missing') m.tables.customer_portal_accounts = []
    if (kind === 'wrong company') m.tables.customer_portal_accounts[0].company_id = COMPANY_B
    if (kind === 'disabled') m.tables.customer_portal_accounts[0].is_active = false
    const result = await resolve({ authenticated_user_reference: SUBJECT })
    expect(result).toMatchObject({ ok: false, status: 404, code: 'customer_not_found' })
    expect(m.writes).toEqual([])
  })
  it.each(['customer_portal_user_id', 'customerPortalUserId', 'portal_user_id', 'portalUserId'])('preserves legacy %s normalization', async (field) => {
    const { portalIdentifiersFromPayload } = await import('@/lib/customer-portal/externalApi')
    expect(portalIdentifiersFromPayload({ [field]: SUBJECT }).customerPortalUserId).toBe(SUBJECT)
  })
  it('does not treat the authenticated subject as an email/customer-number factor', async () => {
    const { portalIdentifiersFromPayload } = await import('@/lib/customer-portal/externalApi')
    expect(portalIdentifiersFromPayload({ authenticated_user_reference: SUBJECT })).toMatchObject({ customerPortalUserId: SUBJECT, email: null, customerNumber: null, externalCustomerId: null })
  })
})
