import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { sdkFetch } = vi.hoisted(() => ({ sdkFetch: vi.fn<typeof fetch>() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('https://customer-detail.example.invalid', 'synthetic-service-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: sdkFetch },
  }) }
})
vi.mock('@/lib/staff-api/context', () => ({ requireStaffApiContext: vi.fn() }))
vi.mock('@/lib/integrations/apiAuth', () => ({ logIntegrationApiRequest: vi.fn(), currentIntegrationApiResponseContext: () => null }))

import { GET } from '@/app/api/v1/staff/customers/[ref]/route'
import { requireStaffApiContext } from '@/lib/staff-api/context'
import { publicReference } from '@/lib/integrations/publicReferences'
import { readCustomerRecordTombstones } from '@/lib/ediel/retention/customerRecordClasses'
import { STAFF_CUSTOMER_SELECT } from '@/lib/customers/getCustomerForCompany'

const company = '11111111-1111-4111-8111-111111111111'
const customer = '22222222-2222-4222-8222-222222222222'
const foreignCompany = '33333333-3333-4333-8333-333333333333'
const erasedAddress = '44444444-4444-4444-8444-444444444444'
const visibleAddress = '55555555-5555-4555-8555-555555555555'
const reference = publicReference('customer', company, customer)!
const rpcName = 'ediel_customer_record_tombstones_v1'
const source = readFileSync('supabase/schema.sql', 'utf8')
const start = source.indexOf(`CREATE FUNCTION public.${rpcName}(`)
const end = source.indexOf('END$$;', start)
if (start < 0 || end < 0) throw new Error('Captured tombstone RPC declaration missing')
const actualRpc = source.slice(start, end + 'END$$;'.length)
let db: PGlite
let missingRpc = false
let rpcError: Record<string, unknown> | null = null
let rpcArguments: Record<string, unknown>[]

// Finite supporting columns retain their captured declarations; the RPC body
// runs verbatim. This is embedded reproduction, not full native qualification.
function capturedTable(table: string, columns: string[]) {
  const first = source.indexOf(`CREATE TABLE ${table} (`)
  const last = source.indexOf('\n);', first)
  if (first < 0 || last < 0) throw new Error(`Missing captured table: ${table}`)
  const wanted = new Set(columns)
  const declarations = source.slice(first, last).split('\n').filter(line => wanted.has(/^\s+(\w+) /.exec(line)?.[1] ?? ''))
  if (declarations.length !== wanted.size) throw new Error(`Missing captured supporting column: ${table}`)
  return `CREATE TABLE ${table} (${declarations.map(line => line.trim().replace(/,$/, '')).join(',')});`
}

const tables: Record<string, string[]> = {
  customers: [...STAFF_CUSTOMER_SELECT.split(','), 'company_id'],
  customer_contacts: ['id', 'company_id', 'customer_id', 'type', 'name', 'email', 'phone', 'title', 'is_primary', 'created_at'],
  customer_addresses: ['id', 'company_id', 'customer_id', 'type', 'street_1', 'street_2', 'postal_code', 'city', 'country', 'is_active', 'created_at'],
  customer_sites: ['id', 'company_id', 'customer_id', 'site_name', 'facility_id', 'site_type', 'status', 'price_area_code', 'street', 'postal_code', 'city', 'created_at'],
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}
function call() {
  return GET(new NextRequest(`https://app.example.invalid/api/v1/staff/customers/${reference}`), { params: Promise.resolve({ ref: reference }) })
}

beforeAll(async () => {
  db = new PGlite()
  for (const [table, columns] of Object.entries(tables)) await db.exec(capturedTable(`public.${table}`, columns))
  await db.exec(`CREATE SCHEMA gridex_ediel_retention;${capturedTable('gridex_ediel_retention.record_tombstones', ['retention_class', 'target_id', 'company_id', 'customer_id', 'source_hash', 'journal_retain_until'])}`)
  await db.query('INSERT INTO customers(id,company_id,full_name,personal_number) VALUES($1,$2,$3,$4)', [customer, company, 'Synthetic customer', '19121212-1212'])
  for (const id of [erasedAddress, visibleAddress]) await db.query('INSERT INTO customer_addresses(id,company_id,customer_id,street_1) VALUES($1,$2,$3,$4)', [id, company, customer, 'Synthetic address'])
  await db.query('INSERT INTO gridex_ediel_retention.record_tombstones VALUES($1,$2,$3,$4,$5,$6)', ['customer_address_history', erasedAddress, company, customer, 'a'.repeat(64), '2030-01-01T00:00:00Z'])
  await db.exec(actualRpc)
})
afterAll(async () => { await db.close() })
afterEach(() => { vi.restoreAllMocks() })
beforeEach(() => {
  missingRpc = process.env.GRIDEX_STAFF_CUSTOMER_RETENTION_SOURCE === 'absent'
  rpcError = null
  rpcArguments = []
  vi.mocked(requireStaffApiContext).mockResolvedValue({ companyId: company, actorUserId: foreignCompany, apiClientId: 'synthetic-client', permissions: ['customers.read'], startedAt: 0,
    client: { id: 'synthetic-client', company_id: company, name: 'Synthetic client', status: 'active', key_prefix: 'synthetic', secret_hash: 'synthetic', scopes: ['staff_customers.read'], allowed_ips: [], rate_limit_per_minute: 60, expires_at: null } })
  sdkFetch.mockReset()
  sdkFetch.mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const endpoint = url.pathname.split('/').at(-1)!
    if (url.pathname === '/rest/v1/rpc/gridex_staff_customer_id_for_reference_v1') {
      expect(await request.json()).toEqual({ p_company_id: company, p_reference: reference })
      return json(customer)
    }
    if (url.pathname === `/rest/v1/rpc/${rpcName}`) {
      const args = await request.json() as Record<string, unknown>
      rpcArguments.push(args)
      if (missingRpc) return json({ code: 'PGRST202', message: 'Could not find the function public.ediel_customer_record_tombstones_v1 in the schema cache', details: null, hint: null }, 404)
      if (rpcError) return json(rpcError, 503)
      const result = await db.query<{ result: unknown }>(`SELECT public.${rpcName}($1::uuid,$2::uuid) AS result`, [args.p_company_id, args.p_customer_id])
      return json(result.rows[0].result)
    }
    const columns = tables[endpoint]
    if (request.method !== 'GET' || !columns) throw new Error(`Unexpected SDK request: ${request.method} ${url.pathname}`)
    const projection = url.searchParams.get('select')!.split(',')
    if (projection.some(column => !columns.includes(column))) throw new Error('Unknown captured projection')
    const values: string[] = []
    const filters = [...url.searchParams.entries()].filter(([key]) => ['id', 'company_id', 'customer_id'].includes(key)).map(([key, value]) => {
      if (!value.startsWith('eq.')) throw new Error('Unexpected tenant predicate')
      values.push(value.slice(3))
      return `${key}=$${values.length}::uuid`
    })
    expect(url.searchParams.get('company_id')).toBe(`eq.${company}`)
    if (endpoint !== 'customers') {
      expect(url.searchParams.get('customer_id')).toBe(`eq.${customer}`)
      expect(url.searchParams.get('limit')).toBe('101')
    }
    return json((await db.query(`SELECT ${projection.join(',')} FROM public.${endpoint} WHERE ${filters.join(' AND ')}`, values)).rows)
  })
})

describe('staff customer detail retention prerequisite', () => {
  it('serves the real detail handler with the captured RPC and excludes tombstoned address history', async () => {
    const response = await call()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.customer.personal_number_masked).toBe('••••1212')
    expect(body.data.customer.addresses.map((row: { address_reference: string }) => row.address_reference)).toEqual([publicReference('address', company, visibleAddress)])
    expect(JSON.stringify(body)).not.toContain(erasedAddress)
    expect(JSON.stringify(body)).not.toContain('19121212-1212')
    expect(rpcArguments).toEqual([{ p_company_id: company, p_customer_id: customer }])
  })

  it('fails closed with a safe 500 when the retention RPC is absent', async () => {
    missingRpc = true
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await call()
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error.code).toBe('internal_error')
    expect(body.data).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('tombstones')
    expect(log).toHaveBeenCalledWith('[staff-api] request_failed', { code: 'PGRST202' })
  })

  it('propagates retention RPC failures instead of treating them as an empty journal', async () => {
    rpcError = { code: 'XX000', message: 'Synthetic retention failure', details: null, hint: null }
    await expect(readCustomerRecordTombstones({ companyId: company, customerId: customer })).rejects.toEqual(rpcError)
  })

  it('keeps the captured RPC customer/company scope check', async () => {
    await expect(db.query(`SELECT public.${rpcName}($1::uuid,$2::uuid)`, [foreignCompany, customer])).rejects.toThrow('customer_record_customer_scope_required')
  })
})
