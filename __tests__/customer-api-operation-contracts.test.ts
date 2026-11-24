import { NextRequest } from 'next/server'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { publicReference } from '@/lib/integrations/publicReferences'

type Row = Record<string, unknown>
const m = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, mutations: [] as string[], reads: [] as string[], rpc: vi.fn(), retiredInvoiceDocuments: new Set<string>(), missingContractColumns: null as Set<string> | null }))
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
  m.reads.push(table)
  let mode = 'select'
  let pending: Row[] = []
  let patch: Row = {}
  let limit = Infinity
  let first = 0
  let last = Infinity
  let error: unknown = null
  let columns: string[] | undefined
  const predicates: Array<(row: Row) => boolean> = []
  const rows = () => {
    if (mode === 'insert') return pending
    const result = (m.tables[table] ?? []).filter((row) => predicates.every((p) => p(row))).slice(first, Math.min(last + 1, first + limit))
    if (mode === 'update') result.forEach((row) => Object.assign(row, patch))
    return columns ? result.map(row => Object.fromEntries(columns!.map(key => [key, row[key]]))) : result
  }
  const q = {
    select: (value: string) => {
      if (table === 'powers_of_attorney') columns = value.split(',')
      if (table === 'customer_contracts' && m.missingContractColumns) {
        columns = value.split(',')
        if (columns.some(key => m.missingContractColumns?.has(key))) error = { code: '42703' }
      }
      return q
    },
    eq: (key: string, value: unknown) => { predicates.push((row) => field(row, key) === value); return q },
    not: (key: string, op: string, value: unknown) => {
      expect(op).toBe('is')
      predicates.push(row => field(row, key) !== value)
      return q
    },
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
  m.reads = []
  m.missingContractColumns = null
  const base = { id: RESOURCE, company_id: COMPANY, customer_id: CUSTOMER, created_at: CREATED }
  m.tables = {
    customers: [{ id: CUSTOMER, company_id: COMPANY, customer_number: 'synthetic-number', customer_type: 'private', status: 'active', full_name: 'Synthetic customer', preferred_language: 'en' }],
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
    customer_notifications: [{ ...base, type: 'information', title: 'Synthetic notification', status: 'unread', read_at: null, message: 'Synthetic message' }],
    customer_events: [{ ...base, event_type: 'customer.synthetic', occurred_at: CREATED, source: 'synthetic' }],
    domain_events: [], website_customer_applications: [], customer_portal_write_idempotency: [],
  }
  for (const table of ['customer_contracts', 'customer_sites', 'customer_invoices', 'customer_notifications', 'normalized_metering_values']) m.tables[table].push({ ...m.tables[table][0], company_id: OTHER_COMPANY, customer_id: 'foreign', contract_name: 'FOREIGN-MUST-NOT-APPEAR', title: 'FOREIGN-MUST-NOT-APPEAR' })
  m.rpc.mockReset()
  m.retiredInvoiceDocuments.clear()
  m.rpc.mockImplementation(async (name: string, args: Row) => {
    expect(args.p_company_id ?? (args.p_command as Row)?.company_id).toBe(COMPANY)
    if (name === 'gridex_portal_invoice_document_availability_v1') {
      return {
        data: m.tables.customer_invoice_documents
          .filter(row => row.company_id === args.p_company_id && row.invoice_id === args.p_invoice_id && (args.p_document_ids as string[]).includes(String(row.id)))
          .map(row => ({ document_id: row.id, retired: m.retiredInvoiceDocuments.has(String(row.id)) })),
        error: null,
      }
    }
    expect(args.p_customer_id ?? (args.p_command as Row)?.customer_id).toBe(CUSTOMER)
    if (name === 'gridex_resolve_customer_notification_references_v1') {
      const rows = m.tables.customer_notifications.filter(row => row.company_id === args.p_company_id && row.customer_id === args.p_customer_id)
      const data = rows.map(row => ({ id: row.id, notification_reference: publicReference('notification', COMPANY, row.id) }))
      return { data: data.filter(row => (args.p_references as string[]).includes(row.notification_reference!)), error: null }
    }
    if (name === 'portal_customer_documents_page_v2') {
      expect(args).toMatchObject({ p_cursor_created_at: null, p_cursor_source_rank: null, p_cursor_id: null })
      return { data: m.tables.customer_documents
        .filter(row => row.company_id === args.p_company_id && row.customer_id === args.p_customer_id)
        .map(row => ({ ...row, public_reference_source: row.id, cursor_created_at: row.created_at, cursor_source_rank: 2, cursor_id: row.id })),
        error: null,
      }
    }
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
    if (name === 'me') expect(body.data).toMatchObject({ display_name: 'Synthetic customer', customer_number: 'synthetic-number', language_code: 'en' })
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
  it.each(['contracts', 'portal-bundle'])('negotiates separate contract dates for %s', async name => {
    const dates = { requested_start_date: '2026-12-05', confirmed_start_date: '2026-12-14', actual_start_date: null }
    Object.assign(m.tables.customer_contracts[0], dates)
    const path = `/api/v1/customer/${name}`
    const load = readOperations.find(([resource]) => resource === name)![1]
    const { GET } = await load()
    const req = (headers?: HeadersInit) => new NextRequest(`https://synthetic.example${path}`, { headers })
    const legacy = await GET(req())
    expect(legacy.headers.get('Preference-Applied')).toBeNull()
    const legacyBody = await legacy.json()
    const legacyContract = name === 'contracts' ? legacyBody.data[0] : legacyBody.data.contracts[0]
    expect(legacyContract.start_date).toBe('2026-12-14')
    expect(legacyContract).not.toHaveProperty('confirmed_start_date')
    const modern = await GET(req({ Prefer: 'contract-start-dates' }))
    expect(modern.status).toBe(200)
    expect(modern.headers.get('Preference-Applied')).toBe('contract-start-dates')
    const body = await modern.json()
    expect(name === 'contracts' ? body.data[0] : body.data.contracts[0]).toMatchObject(dates)
  })
  it.each([
    ['contracts', 'production', true, false],
    ['contracts', 'consumption', false, false],
    ['portal-bundle', 'production', true, false],
    ['portal-bundle', 'consumption', false, false],
    ['contracts', 'production', true, true],
    ['portal-bundle', 'production', true, true],
    ['contracts', undefined, undefined, false],
    ['portal-bundle', undefined, undefined, false],
  ] as const)('projects stored contract terms through %s (%s, %s)', async (name, direction, renewal, legacy) => {
    const row = m.tables.customer_contracts[0]
    Object.assign(row, { energy_direction: direction, auto_renew_enabled: renewal })
    m.missingContractColumns = new Set(direction === undefined
      ? ['customer_contract_reference', 'energy_direction', 'auto_renew_enabled']
      : legacy ? ['customer_contract_reference'] : [])
    const path = `/api/v1/customer/${name}`
    const { GET } = await readOperations.find(([resource]) => resource === name)![1]()
    const response = await GET(new NextRequest(`https://synthetic.example${path}`))
    expect(response.status).toBe(200)
    const body = await response.json()
    const contract = name === 'contracts' ? body.data[0] : body.data.contracts[0]
    if (direction === undefined) {
      expect(contract).not.toHaveProperty('energy_direction')
      expect(contract).not.toHaveProperty('auto_renew_enabled')
    } else {
      expect(contract).toMatchObject({ energy_direction: direction, auto_renew_enabled: renewal })
    }
    expect(validateResponse(spec(), path, body, 'get', '200')).toEqual([])
  })
  it.each(['contracts', 'portal-bundle'])('negotiates separate contract prices for %s', async name => {
    const path = `/api/v1/customer/${name}`
    const { GET } = await readOperations.find(([resource]) => resource === name)![1]()
    const request = (headers?: HeadersInit) => new NextRequest(`https://synthetic.example${path}`, { headers })
    const contract = (body: { data: Row[] | { contracts: Row[] } }) => Array.isArray(body.data) ? body.data[0] : body.data.contracts[0]
    const row = m.tables.customer_contracts[0]
    m.missingContractColumns = new Set()
    Object.assign(row, { markup_ore_per_kwh: 3, variable_fee_ore_per_kwh: 7, confirmed_start_date: '2026-12-14' })
    const headers = { 'X-Gridex-Contract-Pricing': 'separate-variable-fee', Prefer: 'contract-start-dates' }
    const modern = await GET(request(headers))
    expect(modern.headers.get('X-Gridex-Contract-Pricing')).toBe('separate-variable-fee')
    expect(modern.headers.get('Preference-Applied')).toBe('contract-start-dates')
    expect(contract(await modern.json())).toMatchObject({
      markup_ore_per_kwh: 3, variable_fee_ore_per_kwh: 7, confirmed_start_date: '2026-12-14',
    })

    Object.assign(row, { markup_ore_per_kwh: null, spot_markup_ore_per_kwh: null })
    expect(contract(await (await GET(request(headers))).json())).toMatchObject({
      markup_ore_per_kwh: null, variable_fee_ore_per_kwh: 7,
    })
    const legacy = await GET(request())
    expect(legacy.headers.get('X-Gridex-Contract-Pricing')).toBeNull()
    const legacyBody = await legacy.json()
    expect(contract(legacyBody)).toMatchObject({ markup_ore_per_kwh: 7 })
    expect(contract(legacyBody)).not.toHaveProperty('variable_fee_ore_per_kwh')
    expect(validateResponse(spec(), path, legacyBody, 'get', '200')).toEqual([])
  })
  it.each(['powers-of-attorney', 'portal-bundle'])('publishes signed purposes through %s', async name => {
    const row = m.tables.powers_of_attorney[0]
    const scopes = ['supplier_switch', 'facility_information_lookup']
    Object.assign(row, {
      signed_scope_snapshot: [...scopes, 'supplier_switch', 'unrecognized'],
      scope_summary: { scopes: ['unverified_summary'] },
    })
    const path = `/api/v1/customer/${name}`
    const { GET } = await readOperations.find(([resource]) => resource === name)![1]()
    const request = () => new NextRequest(`https://synthetic.example${path}`)
    const getPoa = (body: { data: Row[] | { powers_of_attorney: Row[] } }) =>
      Array.isArray(body.data) ? body.data[0] : body.data.powers_of_attorney[0]
    const response = await GET(request())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(getPoa(body)).toMatchObject({ scope: 'supplier_switch', scopes })
    expect(getPoa(body)).not.toHaveProperty('signed_scope_snapshot')
    expect(getPoa(body)).not.toHaveProperty('scope_summary')
    expect(validateResponse(spec(), path, body, 'get', '200')).toEqual([])

    Object.assign(row, { status: 'draft', signed_at: null })
    expect(getPoa(await (await GET(request())).json())).not.toHaveProperty('scopes')
  })
  it('limits the contract bundle to eight events without querying optional heavy tables', async () => {
    const meter = m.tables.normalized_metering_values[0]
    m.tables.normalized_metering_values = Array.from({ length: 500 }, (_, index) => ({ ...meter, quantity_kwh: index }))
    const event = m.tables.customer_events[0]
    m.tables.customer_events = Array.from({ length: 15 }, (_, index) => ({ ...event, id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`, title: `Event ${index}` }))
    const { POST } = await import('@/app/api/v1/customer/portal-bundle/route')
    const path = 'https://synthetic.example/api/v1/customer/portal-bundle'
    const request = (url: string) => new NextRequest(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ external_customer_id: 'tenant-customer-subject' }),
    })
    const full = await POST(request(path))
    const fullBody = await full.text()
    expect(JSON.parse(fullBody).data.metering_values).toHaveLength(500)
    const fullReads = m.reads.length

    m.reads = []
    const projected = await POST(request(`${path}?include=events&events_limit=8`))
    expect(projected.status).toBe(200)
    const projectedBody = await projected.text()
    const { data } = JSON.parse(projectedBody)
    expect(data.contracts).toHaveLength(1)
    expect(data.events).toHaveLength(8)
    expect(data.metering_values).toEqual([])
    expect(m.reads).not.toContain('normalized_metering_values')
    expect(m.reads.length).toBeLessThan(fullReads)
    expect(Buffer.byteLength(projectedBody)).toBeLessThan(Buffer.byteLength(fullBody))
    process.stdout.write(`contract bundle measurement: ${Buffer.byteLength(fullBody)} to ${Buffer.byteLength(projectedBody)} bytes, ${fullReads} to ${m.reads.length} table calls\n`)
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
  it('opens one invoice attachment without reading lines and still checks file retention', async () => {
    const ownInvoice = m.tables.customer_invoices[0]
    const ownDocument = { id: RESOURCE, invoice_id: ownInvoice.id, company_id: COMPANY, public_url: 'https://files.example.test/own.pdf' }
    const secondDocument = { ...ownDocument, id: '00000000-0000-4000-8000-000000000005' }
    const unrelatedDocument = { ...ownDocument, id: OTHER_COMPANY, invoice_id: OTHER_COMPANY }
    m.tables.customer_invoice_documents = [ownDocument, secondDocument, unrelatedDocument]

    const { GET } = await import('@/app/api/v1/customer/invoices/[id]/route')
    const id = ref('invoice')!
    const open = (reference: string) => GET(
      new NextRequest(`https://synthetic.example/api/v1/customer/invoices/${id}?document_reference=${reference}`),
      { params: Promise.resolve({ id }) },
    )
    const reference = publicReference('document', COMPANY, ownDocument.id)!
    const response = await open(reference)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.lines).toEqual([])
    expect(body.data.documents).toHaveLength(1)
    expect(body.data.documents[0]).toMatchObject({ document_reference: reference, secure_url: ownDocument.public_url })
    expect(m.reads).not.toContain('customer_invoice_lines')
    expect(m.rpc).toHaveBeenCalledWith('gridex_portal_invoice_document_availability_v1', {
      p_company_id: COMPANY, p_invoice_id: ownInvoice.id, p_document_ids: [ownDocument.id],
    })
    expect(validateResponse(spec(), '/api/v1/customer/invoices/{id}', body, 'get', '200')).toEqual([])

    expect((await open(publicReference('document', COMPANY, unrelatedDocument.id)!)).status).toBe(404)
    expect(m.rpc.mock.calls.filter(([name]) => name === 'gridex_portal_invoice_document_availability_v1')).toHaveLength(1)
    m.retiredInvoiceDocuments.add(ownDocument.id)
    const retired = await open(reference)
    expect(retired.status).toBe(200)
    expect((await retired.json()).data.documents[0].secure_url).toBeNull()
  })
  it('looks up a document moved beyond the first owned page by public reference', async () => {
    const target = { ...m.tables.customer_documents[0], id: RESOURCE, public_url: 'https://files.example.test/document.pdf', source_rank: 2 }
    const newer = Array.from({ length: 100 }, (_, index) => ({
      ...target, id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
    }))
    m.tables.customer_documents = [...newer, target, { ...target, company_id: OTHER_COMPANY }]
    m.rpc.mockImplementation(async (name: string, args: Row) => {
      expect(name).toBe('portal_customer_document_reference_v2')
      expect(args).toEqual({
        p_company_id: COMPANY,
        p_customer_id: CUSTOMER,
        p_public_reference: expect.stringMatching(/^document_[A-Za-z0-9_-]{32}$/),
      })
      const document = m.tables.customer_documents.find(row =>
        row.company_id === args.p_company_id && row.customer_id === args.p_customer_id
        && publicReference('document', COMPANY, row.id) === args.p_public_reference,
      )
      return { data: document ? { kind: 'matched', document } : { kind: 'unmatched' }, error: null }
    })
    const { GET } = await import('@/app/api/v1/customer/documents/route')
    const request = (reference: string) => new NextRequest(`https://synthetic.example/api/v1/customer/documents?document_reference=${reference}`)
    const targetReference = publicReference('document', COMPANY, target.id)!
    const response = await GET(request(targetReference))
    expect(response.status).toBe(200)
    expect(m.rpc).toHaveBeenCalledTimes(1)
    const body = await response.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({ document_reference: targetReference, secure_url: target.public_url })
    expect(validateResponse(spec(), '/api/v1/customer/documents', body, 'get', '200')).toEqual([])
    expect((await GET(request(publicReference('document', OTHER_COMPANY, target.id)!))).status).toBe(404)
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
  it('links only the exact locked legal version accepted by the verified customer', async () => {
    const older = '00000000-0000-4000-8000-000000000021'
    const newer = '00000000-0000-4000-8000-000000000022'
    const foreign = '00000000-0000-4000-8000-000000000023'
    const oldHash = 'a'.repeat(64)
    const base = m.tables.customer_legal_acceptances[0]
    const acceptance = (id: string, hash: string) => ({
      ...base, legal_bundle_version_document_id: id, legal_module_key: 'general_consumer_terms',
      legal_document_sha256: hash, legal_document_version: 'v1',
    })
    m.tables.customer_legal_acceptances = [acceptance(older, oldHash), acceptance(newer, oldHash), acceptance(foreign, oldHash)]
    m.tables.companies = [{ id: COMPANY, slug: 'synthetic-company' }]
    m.tables.legal_bundle_versions = [
      { id: older, company_id: COMPANY, status: 'replaced', locked_at: CREATED },
      { id: newer, company_id: COMPANY, status: 'published', locked_at: CREATED },
      { id: foreign, company_id: OTHER_COMPANY, status: 'published', locked_at: CREATED },
    ]
    m.tables.legal_bundle_version_documents = [older, newer, foreign].map(id => ({
      id, legal_bundle_version_id: id, module_key: 'general_consumer_terms', template_version: id === newer ? 'v2' : 'v1',
      content_sha256: id === newer ? 'b'.repeat(64) : oldHash, rendered_body: 'Exact terms', unresolved_variables: [],
    }))
    m.tables.customer_legal_acceptances[1].id = newer
    m.tables.customer_legal_acceptances[2].id = foreign
    const { GET } = await import('@/app/api/v1/customer/legal-acceptances/route')
    const response = await GET(new NextRequest('https://synthetic.example/api/v1/customer/legal-acceptances'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.map((row: Row) => row.verified_document_path)).toEqual([
      `/legal/synthetic-company/general-consumer-terms/${older}`, undefined, undefined,
    ])
    expect(JSON.stringify(body)).not.toContain('Exact terms')
    expect(validateResponse(spec(), '/api/v1/customer/legal-acceptances', body, 'get', '200')).toEqual([])
  })

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
