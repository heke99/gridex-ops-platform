import { NextRequest } from 'next/server'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { publicReference } from '@/lib/integrations/publicReferences'

type Row = Record<string, unknown>
const m = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, mutations: [] as string[], rpc: vi.fn() }))
const COMPANY = '00000000-0000-4000-8000-000000000001'
const CUSTOMER = '00000000-0000-4000-8000-000000000002'
const RESOURCE = '00000000-0000-4000-8000-000000000003'
const OTHER_COMPANY = '00000000-0000-4000-8000-000000000004'
const CREATED = '2026-10-12T12:00:00Z'
const ref = (kind: Parameters<typeof publicReference>[0]) => publicReference(kind, COMPANY, RESOURCE)
const identity = () => ({ id: 'synthetic-identity', company_id: COMPANY, customer_id: CUSTOMER, customer_number: 'synthetic-number', external_customer_id: 'tenant-customer-subject', email: 'synthetic@example.test', auth_user_id: RESOURCE, customer_portal_user_id: RESOURCE, provider: 'synthetic-provider', match_strength: 'strong', customer: m.tables.customers[0] })
function field(row: Row, key: string): unknown {
  const [column, child] = key.split('->>')
  return child ? String((row[column] as Row | undefined)?.[child]) : row[key]
}
function query(table: string) {
  let mode = 'select'
  let pending: Row[] = []
  let patch: Row = {}
  let limit = Infinity
  let first = 0
  let last = Infinity
  let error: unknown = null
  const predicates: Array<(row: Row) => boolean> = []
  const rows = () => {
    if (mode === 'insert') return pending
    const result = (m.tables[table] ?? []).filter((row) => predicates.every((p) => p(row))).slice(first, Math.min(last + 1, first + limit))
    if (mode === 'update') result.forEach((row) => Object.assign(row, patch))
    return result
  }
  const q = {
    select: () => q,
    eq: (key: string, value: unknown) => { predicates.push((row) => field(row, key) === value); return q },
    neq: (key: string, value: unknown) => { predicates.push((row) => field(row, key) !== value); return q },
    is: (key: string, value: unknown) => { predicates.push((row) => field(row, key) === value); return q },
    in: (key: string, value: unknown[]) => { predicates.push((row) => value.includes(field(row, key))); return q },
    or: (expression: string) => {
      const clauses = [...expression.matchAll(/(\w+)\.in\.\(([^)]+)\)/g)]
      if (clauses.length) predicates.push((row) => clauses.some(([, key, values]) => values.split(',').includes(String(row[key]))))
      return q
    },
    order: () => q,
    range: (start: number, end: number) => { first = start; last = end; return q },
    limit: (value: number) => { limit = value; return q },
    insert: (value: Row) => {
      mode = 'insert'; m.mutations.push(table)
      pending = [{ id: RESOURCE, completion_reference: 'completion_synthetic', created_at: CREATED, ...value }]
      if (table === 'customer_portal_write_idempotency' && (m.tables[table] ?? []).some((row) => row.idempotency_key === value.idempotency_key)) { error = { code: '23505' }; pending = [] }
      else m.tables[table] = [...(m.tables[table] ?? []), ...pending]
      return q
    },
    update: (value: Row) => { mode = 'update'; patch = value; m.mutations.push(table); return q },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error }),
    single: async () => ({ data: rows()[0] ?? null, error }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: rows(), error }),
  }
  return q
}
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: query, rpc: m.rpc } }))
vi.mock('@/lib/ediel/retention/customerRecordClasses', () => ({ requirePortalRetentionAccess: vi.fn() }))
vi.mock('@/lib/ediel/retention/invoiceFileRetention', () => ({ requireInvoiceFileCopyAvailable: vi.fn() }))
vi.mock('@/lib/integrations/apiAuth', async (original) => ({ ...await original<typeof import('@/lib/integrations/apiAuth')>(), logIntegrationApiRequest: vi.fn(), currentIntegrationApiResponseContext: () => null }))
vi.mock('@/lib/customer-portal/externalApi', async (original) => ({
  ...await original<typeof import('@/lib/customer-portal/externalApi')>(),
  requireCustomerPortalApiContext: async () => ({ ok: true, client: { id: 'synthetic-client', company_id: COMPANY }, identity: identity(), startedAt: Date.now() }),
  requireCustomerPortalApiContextForIdentifiers: async () => ({ ok: true, client: { id: 'synthetic-client', company_id: COMPANY }, identity: identity(), startedAt: Date.now() }),
  logCustomerPortalSuccess: vi.fn(),
}))
beforeEach(() => {
  m.mutations = []
  const base = { id: RESOURCE, company_id: COMPANY, customer_id: CUSTOMER, created_at: CREATED }
  m.tables = {
    customers: [{ id: CUSTOMER, company_id: COMPANY, customer_number: 'synthetic-number', customer_type: 'private', status: 'active', full_name: 'Synthetic customer' }],
    customer_contracts: [{ ...base, status: 'active', customer_contract_reference: ref('contract'), customer_site_id: RESOURCE, metering_point_id: RESOURCE, markup_ore_per_kwh: null, spot_markup_ore_per_kwh: 8.5, contract_name: 'Synthetic contract', price_plan_id: RESOURCE }],
    customer_sites: [{ ...base, status: 'active', facility_reference: ref('facility'), street: 'Synthetic 1', city: 'Synthetic', postal_code: '12345', facility_id: '735999000000001234' }],
    metering_points: [{ ...base, customer_site_id: RESOURCE, status: 'active', metering_point_id: '735999000000001234' }],
    customer_invoices: [{ ...base, invoice_reference: ref('invoice'), status: 'issued', amount_inc_vat: 125, currency: 'SEK', total_kwh: 100 }],
    customer_invoice_lines: [], customer_invoice_documents: [],
    normalized_metering_values: [{ ...base, quantity_kwh: 0.75, period_start: CREATED, period_end: '2026-10-12T12:15:00Z', resolution: 'PT15M' }],
    customer_documents: [{ ...base, document_type: 'customer_document', status: 'uploaded', title: 'Synthetic document', storage_path: 'internal-never-public' }],
    customer_authorization_documents: [],
    customer_legal_acceptances: [{ ...base, acceptance_type: 'terms', accepted_at: CREATED }],
    powers_of_attorney: [{ ...base, status: 'signed', scope: 'supplier_switch', signed_at: CREATED }],
    customer_notifications: [{ ...base, type: 'information', title: 'Synthetic notification', status: 'unread', message: 'Synthetic message' }],
    customer_events: [{ ...base, event_type: 'customer.synthetic', occurred_at: CREATED, source: 'synthetic' }],
    domain_events: [], website_customer_applications: [], customer_portal_write_idempotency: [],
  }
  for (const table of ['customer_contracts', 'customer_sites', 'customer_invoices', 'customer_notifications', 'normalized_metering_values']) m.tables[table].push({ ...m.tables[table][0], company_id: OTHER_COMPANY, customer_id: 'foreign', contract_name: 'FOREIGN-MUST-NOT-APPEAR', title: 'FOREIGN-MUST-NOT-APPEAR' })
  m.rpc.mockReset()
  m.rpc.mockImplementation(async (name: string, args: Row) => {
    expect(args.p_company_id ?? (args.p_command as Row)?.company_id).toBe(COMPANY)
    expect(args.p_customer_id ?? (args.p_command as Row)?.customer_id).toBe(CUSTOMER)
    if (name === 'portal_customer_documents_page_v1') return { data: m.tables.customer_documents, error: null }
    if (name === 'portal_customer_events_page_v1') return { data: m.tables.customer_events, error: null }
    if (name === 'gridex_submit_customer_move_out_v1') return { data: { completion_reference: 'completion_synthetic', customer_reference: 'tenant-customer-subject', facility_reference: ref('facility'), contract_reference: null, requested_move_out_date: '2026-10-13', status: 'submitted', submitted_at: CREATED, replayed: false }, error: null }
    throw new Error(`Unexpected RPC ${name}`)
  })
})
const { validateResponse } = createRequire(import.meta.url)('../scripts/lib/openapi-schema-validator.cjs')
const spec = () => JSON.parse(readFileSync('docs/openapi/customer-portal-v1.json', 'utf8'))
const readOperations = [
  ['contracts', () => import('@/app/api/v1/customer/contracts/route')],
  ['documents', () => import('@/app/api/v1/customer/documents/route')],
  ['events', () => import('@/app/api/v1/customer/events/route')],
  ['invoices', () => import('@/app/api/v1/customer/invoices/route')],
  ['legal-acceptances', () => import('@/app/api/v1/customer/legal-acceptances/route')],
  ['me', () => import('@/app/api/v1/customer/me/route')],
  ['metering-values', () => import('@/app/api/v1/customer/metering-values/route')],
  ['notifications', () => import('@/app/api/v1/customer/notifications/route')],
  ['powers-of-attorney', () => import('@/app/api/v1/customer/powers-of-attorney/route')],
  ['sites', () => import('@/app/api/v1/customer/sites/route')],
  ['portal-bundle', () => import('@/app/api/v1/customer/portal-bundle/route')],
] as const
describe('finite synthetic mounted customer operation contract probes', () => {
  it.each(readOperations)('GET /customer/%s returns its public fixture under current OpenAPI', async (name, load) => {
    const path = `/api/v1/customer/${name}`
    const response = await (await load()).GET(new NextRequest(`https://synthetic.example${path}`))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(validateResponse(spec(), path, body, 'get', '200')).toEqual([])
    expect(body.data).toBeDefined()
    expect(JSON.stringify(body.data)).not.toContain('FOREIGN-MUST-NOT-APPEAR')
    expect(JSON.stringify(body.data)).not.toContain('internal-never-public')
    expect(m.mutations.filter((table) => table !== 'customer_portal_api_access_logs')).toEqual([])
    if (name === 'contracts') expect(body.data).toHaveLength(1)
    if (name === 'contracts') expect(body.data[0].markup_ore_per_kwh).toBe(8.5)
    if (name === 'documents') expect(body.data[0].document_reference).toBe(ref('document'))
    if (name === 'events') expect(body.data[0].event_type).toBe('customer.synthetic')
    if (name === 'invoices') {
      expect(body.data).toHaveLength(1)
      expect(body.data[0]).toMatchObject({ amount_inc_vat: 125, currency: 'SEK' })
    }
    if (name === 'legal-acceptances') expect(body.data[0]).toMatchObject({ acceptance_type: 'terms', accepted_at: CREATED })
    if (name === 'me') expect(body.data).toMatchObject({ display_name: 'Synthetic customer', customer_number: 'synthetic-number' })
    if (name === 'metering-values') expect(body.data[0].quantity_kwh).toBe(0.75)
    if (name === 'notifications') expect(body.data[0].title).toBe('Synthetic notification')
    if (name === 'powers-of-attorney') expect(body.data[0]).toMatchObject({ scope: 'supplier_switch', status: 'signed' })
    if (name === 'sites') {
      expect(body.data.sites).toHaveLength(1)
      expect(body.data.sites[0].address.street).toBe('Synthetic 1')
      expect(body.page.sites).toMatchObject({ returned: 1, has_more: false })
    } else if (name !== 'me' && name !== 'portal-bundle') {
      expect(body.page).toMatchObject({ returned: 1, has_more: false })
    }
    if (name === 'portal-bundle') {
      expect(body.data.bundle_status.status).toBe('complete')
      expect(body.data.contracts).toHaveLength(1)
      expect(body.data.invoices[0].amount_inc_vat).toBe(125)
    }
  })
  it('GET invoice detail resolves the public invoice reference then projects detail fields', async () => {
    const { GET } = await import('@/app/api/v1/customer/invoices/[id]/route')
    const path = '/api/v1/customer/invoices/{id}'
    const response = await GET(new NextRequest(`https://synthetic.example/api/v1/customer/invoices/${ref('invoice')}`), { params: Promise.resolve({ id: ref('invoice')! }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.invoice.amount_inc_vat).toBe(125)
    expect(validateResponse(spec(), path, body, 'get', '200')).toEqual([])
  })
  it('POST portal bundle uses a JSON identifier and returns the public combined data', async () => {
    const { POST } = await import('@/app/api/v1/customer/portal-bundle/route')
    const path = '/api/v1/customer/portal-bundle'
    const response = await POST(new NextRequest(`https://synthetic.example${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ external_customer_id: 'tenant-customer-subject' }) }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.bundle_status.status).toBe('complete')
    expect(validateResponse(spec(), path, body, 'post', '200')).toEqual([])
  })
  it('POST sync of an already-linked subject returns a durable synced receipt', async () => {
    const { POST } = await import('@/app/api/v1/customer/sync/route')
    const path = '/api/v1/customer/sync'
    const response = await POST(new NextRequest(`https://synthetic.example${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'synthetic-sync-happy-001' }, body: JSON.stringify({ authenticated_user_reference: 'tenant-owned-account-subject-42' }) }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.status).toBe('synced')
    expect(validateResponse(spec(), path, body, 'post', '200')).toEqual([])
    expect(m.tables.customer_portal_write_idempotency[0].status).toBe('completed')
  }, 20_000)
  it('POST notification read resolves a public reference and updates only its owning customer row', async () => {
    const { POST } = await import('@/app/api/v1/customer/notifications/read/route')
    const path = '/api/v1/customer/notifications/read'
    const response = await POST(new NextRequest(`https://synthetic.example${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'synthetic-notification-happy-001' }, body: JSON.stringify({ notification_references: [ref('notification')] }) }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.updated_count).toBe(1)
    expect(m.tables.customer_notifications[0].status).toBe('read')
    expect(m.tables.customer_notifications[1].status).toBe('unread')
    expect(validateResponse(spec(), path, body, 'post', '200')).toEqual([])
  })
  it('POST move-out forwards the owning graph to the transaction and stores its201receipt', async () => {
    const { POST } = await import('@/app/api/v1/customer/move-out/route')
    const path = '/api/v1/customer/move-out'
    const response = await POST(new NextRequest(`https://synthetic.example${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'synthetic-move-out-happy-001' }, body: JSON.stringify({ facility_reference: ref('facility'), requested_move_out_date: '2026-10-13' }) }))
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.data.status).toBe('submitted')
    expect(validateResponse(spec(), path, body, 'post', '201')).toEqual([])
    expect(m.tables.customer_portal_write_idempotency[0].status).toBe('completed')
  })
})
