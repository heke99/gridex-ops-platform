import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import type { LinkedPortalIdentity } from '@/lib/customer-portal/externalApi'
import { ApiInputError } from '@/lib/api/strictRequest'
import { parseTenantCustomerSyncPayload } from '@/lib/customer-portal/customerSyncContract'
import { syncTenantCustomerRecords } from '@/lib/customer-portal/tenantSync'

type Row = Record<string, unknown>
const database = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  customerUpdates: [] as Row[],
  customerError: null as { operation: 'read' | 'update'; error: Error } | null,
}))

// Only the persistence port is modeled. Both request parsing and synchronization
// run their public production exports; unrelated document/facility/event writes
// fail the test if a profile-only request unexpectedly reaches them.
function query(table: string) {
  if (!Object.hasOwn(database.tables, table)) throw new Error(`Unexpected table: ${table}`)
  const filters: Array<(row: Row) => boolean> = []
  let columns: string[] = []
  let maximum = Infinity
  let ordering: { field: string; ascending: boolean } | null = null
  let patch: Row | null = null
  const port = {
    select: (fields: string) => { columns = fields.split(','); return port },
    eq: (field: string, value: unknown) => { filters.push((row) => row[field] === value); return port },
    order: (field: string, options: { ascending: boolean }) => { ordering = { field, ...options }; return port },
    limit: (value: number) => { maximum = value; return port },
    update: (value: Row) => {
      patch = value
      if (table === 'customers') database.customerUpdates.push(structuredClone(value))
      return port
    },
    maybeSingle: async () => {
      const operation = patch ? 'update' : 'read'
      if (table === 'customers' && database.customerError?.operation === operation) {
        return { data: null, error: database.customerError.error }
      }
      let rows = database.tables[table].filter((row) => filters.every((filter) => filter(row)))
      if (ordering) {
        const { field, ascending } = ordering
        rows = rows.toSorted((a, b) => String(a[field]).localeCompare(String(b[field])) * (ascending ? 1 : -1))
      }
      rows = rows.slice(0, maximum)
      if (rows.length > 1) throw new Error(`Unexpected multiple rows from ${table}`)
      if (patch) for (const row of rows) Object.assign(row, patch)
      const row = rows[0]
      return {
        data: row ? Object.fromEntries(columns.map((field) => [field, structuredClone(row[field])])) : null,
        error: null,
      }
    },
  }
  return port
}

function unexpectedWrite() { throw new Error('Unexpected non-profile write') }
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: query } }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: unexpectedWrite }))
vi.mock('@/lib/customer-sites/addressIntake', () => ({ createOrUpdateCustomerSiteFromAddress: unexpectedWrite }))
vi.mock('@/lib/customer-operations/automation', () => ({ enqueueCustomerDataRequestAutomation: unexpectedWrite }))
vi.mock('@/lib/customer-portal/customerResolver', () => ({ isMissingPortalSchemaError: () => false }))
vi.mock('@/lib/legal/customerDocumentPackage', () => ({
  buildCustomerLegalDocuments: unexpectedWrite,
  customerLegalAcceptanceCategoryForModule: unexpectedWrite,
}))
vi.mock('@/lib/legal/authorizationChain', () => ({ ensureAuthorizationDocumentFromPowerOfAttorney: unexpectedWrite }))
vi.mock('@/lib/operations/powerOfAttorneyWorkflow', () => ({ powerOfAttorneyCoverageFromScopes: unexpectedWrite }))

const COMPANY = '00000000-0000-4000-8000-000000000001'
const FOREIGN_COMPANY = '00000000-0000-4000-8000-000000000002'
const CUSTOMER = '00000000-0000-4000-8000-000000000003'
const OTHER_CUSTOMER = '00000000-0000-4000-8000-000000000004'
const FOREIGN_CUSTOMER = '00000000-0000-4000-8000-000000000005'
const client: IntegrationApiClient = {
  id: '00000000-0000-4000-8000-000000000006',
  company_id: COMPANY,
  name: 'Synthetic tenant sync client',
  status: 'active',
  key_prefix: 'synthetic',
  secret_hash: 'synthetic-not-a-credential',
  scopes: ['customer_sync.write'],
  allowed_ips: [],
  rate_limit_per_minute: 30,
  expires_at: null,
}
const identity: LinkedPortalIdentity = {
  id: null,
  company_id: COMPANY,
  customer_id: CUSTOMER,
  external_customer_id: 'synthetic-external-customer',
  email: 'synthetic@example.test',
  customer_number: 'synthetic-number',
  auth_user_id: null,
  customer_portal_user_id: null,
  match_strength: 'exact',
  match_method: 'external_customer_id',
  provider: null,
  customer: { id: CUSTOMER, company_id: COMPANY, status: 'active' },
}
const originalCustomer = {
  id: CUSTOMER,
  company_id: COMPANY,
  first_name: 'Existing',
  last_name: 'Customer',
  full_name: 'Existing Customer',
  company_name: 'Existing Company',
  phone: '+46 70 111 22 33',
  invoice_email: 'Existing.Invoice@example.test',
  preferred_language: 'sv',
  metadata: { portal_timezone: 'UTC', unrelated: { preserved: true } },
  updated_at: '2026-01-01T00:00:00.000Z',
}

beforeEach(() => {
  database.customerUpdates = []
  database.customerError = null
  database.tables = {
    customers: [
      structuredClone(originalCustomer),
      { ...structuredClone(originalCustomer), id: OTHER_CUSTOMER },
      { ...structuredClone(originalCustomer), id: FOREIGN_CUSTOMER, company_id: FOREIGN_COMPANY },
    ],
    customer_contracts: [{
      id: 'synthetic-contract', company_id: COMPANY, customer_id: CUSTOMER,
      customer_site_id: 'synthetic-site', site_id: null,
      metering_point_id: 'synthetic-existing-point', website_application_id: null,
      legal_bundle_version_id: null, created_at: '2026-01-01T00:00:00.000Z',
    }],
    website_customer_applications: [],
  }
})

function currentCustomer() { return database.tables.customers[0] }
async function sync(profile?: Record<string, unknown>) {
  const payload = parseTenantCustomerSyncPayload({
    external_customer_id: identity.external_customer_id,
    ...(profile === undefined ? {} : { profile }),
  })
  return syncTenantCustomerRecords({ client, identity, payload })
}
function expectCustomerWith(changes: Row) {
  expect(currentCustomer()).toEqual({
    ...originalCustomer,
    ...changes,
    updated_at: expect.any(String),
  })
  expect(Date.parse(String(currentCustomer().updated_at))).not.toBeNaN()
}

describe('tenant customer sync profile patches through the public parser and service', () => {
  it('changes only the supplied phone and preserves names, billing email, language and metadata', async () => {
    const result = await sync({ phone: '  +46 (0)70 123 45 67  ' })
    expectCustomerWith({ phone: '+46 (0)70 123 45 67' })
    expect(result.summary.profile).toEqual({ updated: true, skipped: false })
    expect(result.customer_id).toBe(CUSTOMER)
    expect(database.customerUpdates).toHaveLength(1)
  })

  it('changes only timezone metadata and preserves the complete scalar profile and unrelated metadata', async () => {
    await sync({ timezone: '  Europe/Stockholm  ' })
    expectCustomerWith({
      metadata: { portal_timezone: 'Europe/Stockholm', unrelated: { preserved: true } },
    })
  })

  it.each([
    ['first_name', 'New first', 'first_name'],
    ['last_name', 'New last', 'last_name'],
    ['full_name', 'New full name', 'full_name'],
    ['company_name', 'New company', 'company_name'],
    ['invoice_email', 'Mixed.Case@example.test', 'invoice_email'],
    ['language_code', 'en', 'preferred_language'],
  ])('patches %s without clearing any omitted profile column', async (field, value, column) => {
    await sync({ [field]: `  ${value}  ` })
    expectCustomerWith({ [column]: value })
  })

  it('treats an explicitly undefined optional field as omitted while changing timezone', async () => {
    await sync({ phone: undefined, timezone: 'Europe/Stockholm' })
    expectCustomerWith({
      metadata: { portal_timezone: 'Europe/Stockholm', unrelated: { preserved: true } },
    })
  })

  it.each([undefined, {}])('keeps an omitted or empty profile as a no-op (%j)', async (profile) => {
    const result = await sync(profile)
    expect(currentCustomer()).toEqual(originalCustomer)
    expect(database.customerUpdates).toEqual([])
    expect(result.summary.profile).toEqual({ updated: false, skipped: true })
  })

  it('keeps the existing full-profile trim policy and language mapping without lowercasing billing email', async () => {
    await sync({
      first_name: ' New ', last_name: ' Person ', full_name: ' New Person ',
      company_name: ' New Company ', phone: ' +46 70 123 45 67 ',
      invoice_email: ' New.Invoice@example.test ', language_code: ' en ',
      timezone: ' Europe/Stockholm ',
    })
    expectCustomerWith({
      first_name: 'New', last_name: 'Person', full_name: 'New Person',
      company_name: 'New Company', phone: '+46 70 123 45 67',
      invoice_email: 'New.Invoice@example.test', preferred_language: 'en',
      metadata: { portal_timezone: 'Europe/Stockholm', unrelated: { preserved: true } },
    })
  })

  it('retains the published 50-character phone contract', async () => {
    await sync({ phone: '1'.repeat(50) })
    expectCustomerWith({ phone: '1'.repeat(50) })
  })

  it.each([
    { phone: null }, { phone: '   ' }, { phone: '1'.repeat(51) },
    { invoice_email: 'not-an-email' }, { timezone: '' }, { unknown_field: 'value' },
  ])('rejects invalid profile input before any customer update (%j)', async (profile) => {
    await expect(sync(profile)).rejects.toBeInstanceOf(ApiInputError)
    expect(database.tables.customers[0]).toEqual(originalCustomer)
    expect(database.customerUpdates).toEqual([])
  })

  it('keeps other customers in the same and another company untouched', async () => {
    const unrelatedCustomers = structuredClone(database.tables.customers.slice(1))
    await sync({ phone: '+46 70 999 88 77' })
    expectCustomerWith({ phone: '+46 70 999 88 77' })
    expect(database.tables.customers.slice(1)).toEqual(unrelatedCustomers)
  })

  it.each(['read', 'update'] as const)('propagates a customer %s failure without claiming synchronization', async (operation) => {
    const error = new Error(`Synthetic customer ${operation} failure`)
    database.customerError = { operation, error }
    await expect(sync({ phone: '+46 70 999 88 77' })).rejects.toBe(error)
    expect(currentCustomer()).toEqual(originalCustomer)
    if (operation === 'read') expect(database.customerUpdates).toEqual([])
  })
})
