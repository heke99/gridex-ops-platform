import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type StoredRow = Record<string, unknown>
type SnapshotRow = StoredRow & { site_count: number; metering_point_count: number; contract_count: number;
  has_missing_grid_owner: boolean; has_signed_power_of_attorney: boolean }
const io = vi.hoisted(() => ({
  tables: {} as Record<string, StoredRow[]>,
  requests: [] as URL[],
  returned: [] as Array<{ table: string; rows: number }>,
  columnErrors: [] as Array<{ table: string; column: string }>,
  failure: null as { table: string; code: string; message?: string } | null,
  rpcOverride: undefined as unknown,
  handle: null as ((url: URL, init?: RequestInit) => Response) | null,
}))

// The installed client constructs real PostgREST requests. Only its external
// database transport is controlled; no reader, matcher, normalization or scope
// helper is replaced. These are synthetic business reads, not Auth/RLS proof.
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('http://127.0.0.1:54321', 'synthetic-unit-client', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)); io.requests.push(url)
      if (!io.handle) throw new Error('Controlled database transport is not initialized')
      try { return io.handle(url, init) }
      catch (error) {
        // A harness grammar/DDL error is a nonretrying setup failure. It must
        // never masquerade as the intended missing-corpus regression.
        return new Response(JSON.stringify({ code: 'HARNESS_SETUP', message: error instanceof Error ? error.message : 'Unknown controlled adapter error' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
    } },
  }) }
})
// Page proofs replace only its outer guard/current-scope observations. They do
// not execute Auth or establish these observations as authority receipts.
vi.mock('@/lib/admin/guards', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/admin/guards')>(),
  requireAdminPageKeyAccess: async () => ({ userId: '30000000-0000-4000-8000-000000000001', email: 'synthetic-staff@example.invalid',
    companyId: '10000000-0000-4000-8000-000000000001', roles: [], permissions: [], isPlatformAdmin: false }) }))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminTenantReadScope: async () => ({ isPlatformAdmin: false,
  companyId: '10000000-0000-4000-8000-000000000001', companyName: 'Synthetic current company' }) }))
vi.mock('@/lib/tenant/scope', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/tenant/scope')>(),
  getOperationalCompanyScope: async () => ({ companyId: '10000000-0000-4000-8000-000000000001', companyName: 'Synthetic current company' }) }))

import { listCustomersPage } from '@/lib/customers/getCustomers'
import { AdminCustomersPage } from '@/app/admin/customers/page.part-2'

const companyA = '10000000-0000-4000-8000-000000000001'
const companyB = '10000000-0000-4000-8000-000000000002'
const statuses = ['draft', 'pending_verification', 'active', 'inactive', 'moved', 'terminated', 'blocked', 'archived'] as const
const hiddenStatuses = ['archived', 'deleted', 'deleted_test_only', 'pending_deletion']
const schema = fs.readFileSync(path.join(process.cwd(), 'supabase/schema.sql'), 'utf8')
const configuredMaxRows = Number(fs.readFileSync(path.join(process.cwd(), 'supabase/config.toml'), 'utf8').match(/^max_rows\s*=\s*(\d+)$/m)?.[1])
if (!Number.isSafeInteger(configuredMaxRows) || configuredMaxRows < 1) throw new Error('Actual configured database row cap is missing')
const canonicalColumns = new Map(['customers', 'customer_sites', 'metering_points', 'customer_contracts', 'powers_of_attorney'].map(table => {
  const body = schema.match(new RegExp(`CREATE TABLE public\\.${table} \\(([\\s\\S]*?)\\n\\);`))?.[1]
  if (!body) throw new Error(`Canonical table not found: ${table}`)
  return [table, new Set([...body.matchAll(/^    ([a-z_]+) (?:[a-z])/gm)].map(match => match[1]))]
}))

function uuid(index: number): string { return `20000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}` }
function customer(index: number, overrides: StoredRow = {}): StoredRow {
  return {
    id: uuid(index), company_id: companyA, customer_type: 'private', status: 'active',
    billing_profile_revision: 3, intake_status: null, intake_missing_fields: [],
    first_name: 'Other', last_name: String(index), full_name: `Other ${index}`, company_name: null,
    email: `synthetic-${index}@example.invalid`, phone: null, personal_number: null, org_number: null,
    customer_number: `C-${index}`, apartment_number: null, source: null, is_test_data: false,
    created_at: new Date(Date.UTC(2026, 8, 1, 0, 0, index)).toISOString(), ...overrides,
  }
}
function seedCorpus(size = 1001): StoredRow[] {
  const rows = Array.from({ length: size }, (_, index) => customer(index + 1))
  io.tables.customers = rows
  return rows
}

// This adapter evaluates the emitted database predicates before ORDER/LIMIT,
// independently of the actual reader's later JavaScript business filtering.
// A query that requests newest1000 cannot receive the1001st row from this seam.
function topLevelParts(value: string): string[] {
  let depth = 0; let start = 0; const parts: string[] = []
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1
    if (value[index] === ')') depth -= 1
    if (value[index] === ',' && depth === 0) { parts.push(value.slice(start, index)); start = index + 1 }
  }
  return [...parts, value.slice(start)]
}
function valueMatches(saved: unknown, expression: string): boolean {
  if (expression.startsWith('not.')) {
    if (saved === null || saved === undefined) return false
    return !valueMatches(saved, expression.slice(4))
  }
  const dot = expression.indexOf('.'); const operator = expression.slice(0, dot); const value = expression.slice(dot + 1)
  if (operator === 'is') return value === 'null' ? saved === null || saved === undefined : saved === (value === 'true')
  if (saved === null || saved === undefined) return false
  if (operator === 'eq') return String(saved) === value
  if (operator === 'neq') return String(saved) !== value
  if (operator === 'in') return topLevelParts(value.slice(1, -1)).map(item => item.replace(/^"|"$/g, '')).includes(String(saved))
  if (operator === 'ilike') {
    const literal = value.replace(/^[*%]|[*%]$/g, '').toLowerCase()
    return String(saved).toLowerCase().includes(literal)
  }
  throw new Error(`Unsupported controlled database operator: ${operator}`)
}
function matchesDatabasePredicates(row: StoredRow, params: URLSearchParams): boolean {
  for (const [field, expression] of params) {
    if (['select', 'order', 'limit', 'offset'].includes(field)) continue
    if (field === 'or') {
      if (!topLevelParts(expression.slice(1, -1)).some(part => {
        const dot = part.indexOf('.'); return valueMatches(row[part.slice(0, dot)], part.slice(dot + 1))
      })) return false
    } else if (!valueMatches(row[field], expression)) return false
  }
  return true
}
function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

// This is the controlled database/RPC business boundary, not the production
// parser or SQL function. The companion core suite executes that actual SQL.
function advancedSnapshot(input: Record<string, unknown>): StoredRow {
  const query = String(input.p_query ?? '').trim().toLowerCase()
  const flag = String(input.p_flag)
  const status = String(input.p_status)
  const contract = String(input.p_contract_filter)
  const page = Number(input.p_page)
  const pageSize = Number(input.p_page_size)
  const base = io.tables.customers.filter(row => row.company_id !== null &&
    (!input.p_company_id || row.company_id === input.p_company_id) && row.source !== 'ediel_portal_test' &&
    (status === 'archived' || !hiddenStatuses.includes(String(row.status))) &&
    (!input.p_exclude_test_data || flag === 'test_customers' || (!row.is_test_data && !String(row.source ?? '').toLowerCase().includes('test'))) &&
    (input.p_customer_type === 'all' || row.customer_type === input.p_customer_type ||
      (input.p_customer_type === 'private' && row.customer_type === null)))
  const derived = base.map((saved): SnapshotRow => {
    const fullName = saved.full_name || [saved.first_name, saved.last_name].filter(Boolean).join(' ').trim() || null
    const own = (row: StoredRow) => row.company_id === saved.company_id && row.customer_id === saved.id
    const sites = io.tables.customer_sites.filter(own)
    const points = io.tables.metering_points.filter(row => row.company_id === saved.company_id &&
      (row.customer_id == null || row.customer_id === saved.id) && sites.some(site => site.id === (row.site_id ?? row.customer_site_id)))
    const contracts = io.tables.customer_contracts.filter(own)
    const latest = [...contracts].sort((a,b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) || String(b.id).localeCompare(String(a.id)))[0]
    return { ...saved, full_name: fullName, customer_type: saved.customer_type ?? 'private', status: saved.status ?? 'draft',
      possible_duplicate: null, duplicate_review_status: null, consolidated_invoice: null, billing_level: null,
      site_count: sites.length, active_site_count: sites.filter(row => row.status === 'active').length,
      metering_point_count: points.length, active_metering_point_count: points.filter(row => row.status === 'active').length,
      contract_count: contracts.length, has_missing_grid_owner: sites.some(row => !row.grid_owner_id),
      has_signed_power_of_attorney: io.tables.powers_of_attorney.some(row => own(row) && row.status === 'signed'),
      latest_contract_status: latest?.status ?? null }
  }).filter(row => !query || [row.full_name,row.company_name,row.email,row.phone,row.personal_number,row.org_number,
    row.customer_number,row.first_name,row.last_name].some(value => value != null && String(value).toLowerCase().includes(query)))
  const countSet = derived.filter(row => {
    switch (flag) {
      case 'all': return true
      case 'multi_site': return row.site_count > 1
      case 'multi_contract': return row.contract_count > 1
      case 'missing_grid_owner': return row.has_missing_grid_owner
      case 'missing_authorization': return !row.has_signed_power_of_attorney
      case 'ready_for_switch': return row.site_count > 0 && row.metering_point_count > 0 && row.has_signed_power_of_attorney && !row.has_missing_grid_owner
      case 'billing_ready': return row.site_count > 0 && row.metering_point_count > 0 && row.contract_count > 0 && !row.has_missing_grid_owner
      case 'test_customers': return row.is_test_data === true || String(row.source ?? '').toLowerCase().includes('test')
      default: throw new Error('Unsupported fixture flag')
    }
  })
  const filtered = countSet.filter(row => (status === 'all' || row.status === status) &&
    (contract === 'all' || (contract === 'none' ? row.contract_count === 0 : contract === 'closed'
      ? ['terminated','cancelled','expired'].includes(String(row.latest_contract_status)) : row.latest_contract_status === contract)))
    .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)))
  return { rows: filtered.slice((page-1)*pageSize,page*pageSize),total: filtered.length,page,pageSize,
    totalPages: Math.max(1,Math.ceil(filtered.length/pageSize)),
    counts: { all: countSet.length,...Object.fromEntries(statuses.map(value => [value,countSet.filter(row => row.status === value).length])) } }
}

function handleDatabase(url: URL, init?: RequestInit): Response {
  if (url.origin !== 'http://127.0.0.1:54321') throw new Error('Unexpected transport destination')
  const table = url.pathname.slice('/rest/v1/'.length)
  if (table === 'rpc/gridex_customer_registry_page_v1') {
    if (io.failure) return json({ code: io.failure.code, message: io.failure.message ?? 'Controlled business database unavailable' }, 400)
    return json(io.rpcOverride === undefined ? advancedSnapshot(JSON.parse(String(init?.body ?? '{}'))) : io.rpcOverride)
  }
  if (table === 'rpc/gridex_customer_status_counts_v1') {
    const input = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    const rows = io.tables.customers.filter(row => row.company_id !== null &&
      (!input.p_company_id || row.company_id === input.p_company_id) && row.source !== 'ediel_portal_test' &&
      (!input.p_customer_type || input.p_customer_type === 'all' || row.customer_type === input.p_customer_type ||
        (input.p_customer_type === 'private' && row.customer_type === null)) &&
      (!input.p_exclude_test_data || (!row.is_test_data && !String(row.source ?? '').toLowerCase().includes('test'))))
    return json({ all_count: rows.filter(row => row.status === null || !hiddenStatuses.includes(String(row.status))).length,
      ...Object.fromEntries(statuses.map(status => [status, rows.filter(row => row.status === status).length])) })
  }
  if (!canonicalColumns.has(table)) throw new Error(`Unexpected business table: ${table}`)
  if (io.failure?.table === table) return json({ code: io.failure.code, message: io.failure.message ?? 'Controlled business database unavailable' }, 400)
  const selected = url.searchParams.get('select')?.split(',') ?? []
  for (const column of selected) if (!canonicalColumns.get(table)?.has(column)) {
    io.columnErrors.push({ table, column })
    return json({ code: '42703', message: `column ${table}.${column} does not exist` }, 400)
  }
  let rows = (io.tables[table] ?? []).filter(row => matchesDatabasePredicates(row, url.searchParams))
  const total = rows.length
  const orders = (url.searchParams.get('order') ?? '').split(',').filter(Boolean)
  rows = [...rows].sort((left, right) => {
    for (const order of orders) {
      const [field, direction] = order.split('.'); const compared = String(left[field] ?? '').localeCompare(String(right[field] ?? ''))
      if (compared) return direction === 'desc' ? -compared : compared
    }
    return 0
  })
  const offset = Number(url.searchParams.get('offset') ?? 0)
  const limit = Math.min(Number(url.searchParams.get('limit') ?? rows.length), configuredMaxRows)
  const result = rows.slice(offset, offset + limit).map(row => Object.fromEntries(selected.map(column => [column, row[column]])))
  io.returned.push({ table, rows: result.length })
  return json(result, 200, { 'Content-Range': `${offset}-${offset + result.length - 1}/${total}` })
}

beforeEach(() => {
  io.tables = { customers: [], customer_sites: [], metering_points: [], customer_contracts: [], powers_of_attorney: [] }
  io.requests = []; io.returned = []; io.columnErrors = []; io.failure = null; io.rpcOverride = undefined; io.handle = handleDatabase
})
afterEach(() => {
  // A false empty caused by the reader's optional-schema fallback cannot earn
  // a passing no-match or literal negative control.
  expect(io.columnErrors).toEqual([])
})

describe('actual customer registry full-corpus U07', () => {
  it('finds the oldest exact saved number outside the newest1000 and reports its actual count', async () => {
    seedCorpus()[0].customer_number = 'OLD-EXACT-1001'
    const result = await listCustomersPage({ companyId: companyA, query: 'OLD-EXACT-1001', excludeTestData: true })
    expect(result.rows.map(row => row.id)).toEqual([uuid(1)])
    expect(result).toMatchObject({ total: 1, totalPages: 1, counts: { all: 1, active: 1 } })
  })

  it('applies customer type plus an actual stored multi-site graph across the complete corpus before page/count', async () => {
    seedCorpus()[0].customer_type = 'business'
    io.tables.customer_sites = [1, 2].map(index => ({ id: uuid(7000 + index), company_id: companyA,
      customer_id: uuid(1), status: 'active', grid_owner_id: uuid(4000) }))
    const result = await listCustomersPage({ companyId: companyA, customerType: 'business', flag: 'multi_site' })
    expect(result.rows.map(row => row.id)).toEqual([uuid(1)])
    expect(result).toMatchObject({ total: 1, counts: { all: 1, active: 1 } })
  })

  it('derives the oldest multi-site flag from its stored sites before restricting the output page', async () => {
    seedCorpus()
    io.tables.customer_sites = [1, 2].map(index => ({ id: uuid(3000 + index), company_id: companyA,
      customer_id: uuid(1), status: 'active', grid_owner_id: uuid(4000) }))
    const result = await listCustomersPage({ companyId: companyA, flag: 'multi_site' })
    expect(result.rows.map(row => row.id)).toEqual([uuid(1)])
    expect(result.rows[0]).toMatchObject({ site_count: 2, active_site_count: 2 })
    expect(result).toMatchObject({ total: 1, counts: { all: 1 } })
  })

  it('finds the only no-contract customer outside1000 while preserving pre-contract status-chip counts', async () => {
    seedCorpus()
    io.tables.customer_contracts = io.tables.customers.slice(1).map((row, index) => ({ id: uuid(5000 + index),
      company_id: companyA, customer_id: row.id, status: 'signed' }))
    const result = await listCustomersPage({ companyId: companyA, contractFilter: 'none' })
    expect(result.rows.map(row => row.id)).toEqual([uuid(1)])
    expect(result).toMatchObject({ total: 1, counts: { all: 1001, active: 1001 } })
  })

  it('filters by the actual newest contract state before page and total rather than any contract presence', async () => {
    seedCorpus(3)
    io.tables.customer_contracts = [
      { id: uuid(9101), company_id: companyA, customer_id: uuid(1), status: 'signed', created_at: '2026-09-20T00:00:00Z' },
      { id: uuid(9102), company_id: companyA, customer_id: uuid(2), status: 'active', created_at: '2026-09-20T00:00:00Z' },
      { id: uuid(9103), company_id: companyA, customer_id: uuid(3), status: 'signed', created_at: '2026-09-19T00:00:00Z' },
      { id: uuid(9104), company_id: companyA, customer_id: uuid(3), status: 'terminated', created_at: '2026-09-20T00:00:00Z' },
    ]
    const result = await listCustomersPage({ companyId: companyA, contractFilter: 'signed', pageSize: 1 })
    expect(result.rows.map(row => row.id)).toEqual([uuid(1)])
    expect(result).toMatchObject({ total: 1, totalPages: 1, counts: { all: 3, active: 3 } })
  })

  it('does not count another company contract as a saved contract for the current customer tuple', async () => {
    seedCorpus(1)
    io.tables.customers.push(customer(2, { company_id: companyB }))
    io.tables.customer_contracts = [{ id: uuid(9201), company_id: companyB, customer_id: uuid(2), status: 'signed' }]
    const result = await listCustomersPage({ companyId: companyA, contractFilter: 'none' })
    expect(result.rows.map(row => row.id)).toEqual([uuid(1)])
    expect(result.rows[0].contract_count).toBe(0)
  })

  it('does not infer switch readiness from a legitimate foreign customer/site/point and signed authorization graph', async () => {
    seedCorpus(1)
    io.tables.customers.push(customer(2, { company_id: companyB }))
    io.tables.customer_sites = [
      { id: uuid(9301), company_id: companyA, customer_id: uuid(1), status: 'active', grid_owner_id: uuid(4000) },
      { id: uuid(9304), company_id: companyB, customer_id: uuid(2), status: 'active', grid_owner_id: uuid(4000) },
    ]
    io.tables.metering_points = [{ id: uuid(9302), company_id: companyB, customer_id: uuid(2), site_id: uuid(9304), status: 'active' }]
    io.tables.powers_of_attorney = [{ id: uuid(9303), company_id: companyB, customer_id: uuid(2), status: 'signed' }]
    const result = await listCustomersPage({ companyId: companyA, flag: 'ready_for_switch' })
    expect(result).toMatchObject({ rows: [], total: 0, counts: { all: 0 } })
  })

  it('derives both multi-site customers when actual relation facts exceed the installed database row cap', async () => {
    seedCorpus(2)
    io.tables.customer_sites = [
      ...Array.from({ length: configuredMaxRows }, (_, index) => ({ id: uuid(12000 + index), company_id: companyA,
        customer_id: uuid(2), status: 'active', grid_owner_id: uuid(4000) })),
      ...[1, 2].map(index => ({ id: uuid(15000 + index), company_id: companyA,
        customer_id: uuid(1), status: 'active', grid_owner_id: uuid(4000) })),
    ]
    const result = await listCustomersPage({ companyId: companyA, flag: 'multi_site' })
    expect(result.rows.map(row => row.id)).toEqual([uuid(2), uuid(1)])
    expect(result.rows.map(row => row.site_count)).toEqual([configuredMaxRows, 2])
    expect(result).toMatchObject({ total: 2, counts: { all: 2 } })
  })

  it('does not invent a no-contract customer after the installed cap truncates its real contract relations', async () => {
    seedCorpus(2)
    io.tables.customer_contracts = [
      ...Array.from({ length: configuredMaxRows + 1 }, (_, index) => ({ id: uuid(18000 + index), company_id: companyA,
        customer_id: uuid(2), status: 'draft' })),
      { id: uuid(21001), company_id: companyA, customer_id: uuid(1), status: 'draft' },
    ]
    const result = await listCustomersPage({ companyId: companyA, contractFilter: 'none' })
    expect(result).toMatchObject({ rows: [], total: 0, counts: { all: 2 } })
  })

  it('continues a1001-match literal search to its eleventh page with full total and chip count', async () => {
    seedCorpus().forEach(row => { row.full_name = 'Shared corpus' })
    const result = await listCustomersPage({ companyId: companyA, query: 'Shared corpus', page: 11, pageSize: 100 })
    expect(result.rows.map(row => row.id)).toEqual([uuid(1)])
    expect(result).toMatchObject({ total: 1001, totalPages: 11, counts: { all: 1001, active: 1001 } })
  })

  it('keeps a real inside-cap exact match and its saved billing revision', async () => {
    seedCorpus()[1000].customer_number = 'NEWEST-EXACT'
    const result = await listCustomersPage({ companyId: companyA, query: 'newest-exact' })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ id: uuid(1001), billing_profile_revision: 3 })
    expect(result.total).toBe(1)
  })

  it('projects the four unstored register facts as unknown rather than invented false or historical data', async () => {
    seedCorpus(1)
    const result = await listCustomersPage({ companyId: companyA, query: 'Other' })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ possible_duplicate: null, duplicate_review_status: null,
      consolidated_invoice: null, billing_level: null })
  })

  it.each(['possible_duplicate', 'consolidated_invoice'] as const)(
    'reports the unsupported %s filter as unavailable before claiming an empty register', async flag => {
      seedCorpus(1)
      await expect(listCustomersPage({ companyId: companyA, flag })).rejects.toMatchObject({
        code: 'CUSTOMER_REGISTRY_FILTER_UNAVAILABLE', filter: flag,
      })
      expect(io.requests).toEqual([])
    })

  it('filters other-company rows before the database cap rather than allowing them to consume the selected page', async () => {
    seedCorpus(3)[2].customer_number = 'OWN-EXACT'
    io.tables.customers.push(...Array.from({ length: 1200 }, (_, index) => customer(index + 10000,
      { company_id: companyB, customer_number: 'OWN-EXACT' })))
    const result = await listCustomersPage({ companyId: companyA, query: 'OWN-EXACT' })
    expect(result.rows.map(row => row.id)).toEqual([uuid(3)])
    expect(result).toMatchObject({ total: 1, counts: { all: 1 } })
    expect(io.requests.map(url => url.pathname)).toEqual(['/rest/v1/rpc/gridex_customer_registry_page_v1'])
  })

  it('preserves the existing explicit null-company global read behavior without treating it as an authority receipt', async () => {
    io.tables.customers = [customer(1, { customer_number: 'GLOBAL-EXACT' }),
      customer(2, { company_id: companyB, customer_number: 'GLOBAL-EXACT' }), customer(3, { company_id: null, customer_number: 'GLOBAL-EXACT' })]
    const result = await listCustomersPage({ companyId: null, query: 'GLOBAL-EXACT' })
    expect(result.rows.map(row => row.id)).toEqual([uuid(2), uuid(1)])
    expect(result.total).toBe(2)
    expect(io.requests.map(url => url.pathname)).toEqual(['/rest/v1/rpc/gridex_customer_registry_page_v1'])
  })

  it('retains literal punctuation search instead of converting saved text into wildcard/filter syntax', async () => {
    io.tables.customers = [customer(1, { full_name: "literal_%(,).'value" }), customer(2, { full_name: 'literalX-any-value' })]
    const result = await listCustomersPage({ companyId: companyA, query: "_%(,).'" })
    expect(result.rows.map(row => row.id)).toEqual([uuid(1)])
  })

  it('does not combine separate saved fields into a nonexistent textual match', async () => {
    io.tables.customers = [customer(1, { full_name: 'Alpha', company_name: 'Beta' })]
    expect((await listCustomersPage({ companyId: companyA, query: 'Alpha Beta' })).rows).toEqual([])
  })

  it('counts the query/type/derived-flag universe before selected status using only actual saved site relations', async () => {
    io.tables.customers = [customer(1, { full_name: 'Count scope', status: 'active' }),
      customer(2, { full_name: 'Count scope', status: 'blocked' }), customer(3, { full_name: 'Count scope', status: 'inactive' })]
    io.tables.customer_sites = [1, 2].flatMap(customerIndex => [1, 2].map(siteIndex => ({ id: uuid(8000 + customerIndex * 10 + siteIndex),
      company_id: companyA, customer_id: uuid(customerIndex), status: 'active', grid_owner_id: uuid(4000) })))
    const result = await listCustomersPage({ companyId: companyA, query: 'Count scope', status: 'active', flag: 'multi_site' })
    expect(result.rows.map(row => row.id)).toEqual([uuid(1)])
    expect(result).toMatchObject({ total: 1, counts: { all: 2, active: 1, blocked: 1, inactive: 0 } })
  })

  it('keeps the basic empty-query database pagination and full existing aggregate independent of advanced search', async () => {
    seedCorpus(2005)
    const result = await listCustomersPage({ companyId: companyA, page: 21, pageSize: 100, excludeTestData: true })
    expect(result.rows.map(row => row.id)).toEqual([5, 4, 3, 2, 1].map(uuid))
    expect(result).toMatchObject({ total: 2005, totalPages: 21, counts: { all: 2005, active: 2005 } })
    expect(io.returned.find(row => row.table === 'customers')?.rows).toBe(5)
  })

  it('preserves test/hidden/source rules and permits only the existing explicit archive selection', async () => {
    io.tables.customers = [customer(1, { full_name: 'Visible' }), customer(2, { full_name: 'Visible', is_test_data: true }),
      customer(3, { full_name: 'Visible', source: 'ediel_portal_test' }), customer(4, { full_name: 'Visible', source: 'other_test' }),
      customer(5, { full_name: 'Visible', status: 'archived' })]
    expect((await listCustomersPage({ companyId: companyA, query: 'Visible', excludeTestData: true })).rows.map(row => row.id)).toEqual([uuid(1)])
    expect((await listCustomersPage({ companyId: companyA, query: 'Visible', status: 'archived', excludeTestData: true })).rows.map(row => row.id)).toEqual([uuid(5)])
  })

  it('returns an actual no-match result without inventing a hit or positive count', async () => {
    seedCorpus()
    const result = await listCustomersPage({ companyId: companyA, query: 'No saved customer has this value' })
    expect(result).toMatchObject({ rows: [], total: 0, totalPages: 1, counts: { all: 0 } })
  })

  it('propagates non-schema database errors rather than displaying a successful empty search', async () => {
    seedCorpus(1); io.failure = { table: 'customers', code: 'P0001' }
    await expect(listCustomersPage({ companyId: companyA, query: 'Other' })).rejects.toMatchObject({ code: 'P0001' })
  })

  it('propagates a database missing-column error instead of reporting a successful empty register', async () => {
    seedCorpus(1)
    io.failure = { table: 'customers', code: '42703', message: 'column customers.billing_profile_revision does not exist' }
    await expect(listCustomersPage({ companyId: companyA, query: 'Other' })).rejects.toMatchObject({ code: '42703' })
  })

  it('propagates a missing new RPC instead of falling back to a capped or empty legacy search',async()=>{
    seedCorpus(1001)
    io.failure={table:'customers',code:'PGRST202',message:'Could not find the function public.gridex_customer_registry_page_v1 in the schema cache'}
    await expect(listCustomersPage({companyId:companyA,query:'Other'})).rejects.toMatchObject({code:'PGRST202'})
    expect(io.requests.map(url=>url.pathname)).toEqual(['/rest/v1/rpc/gridex_customer_registry_page_v1'])
  })

  it.each(['possible_duplicate','consolidated_invoice'] as const)('renders actual page unavailable for %s without fake totals and preserves reset filters',async flag=>{
    const element=await AdminCustomersPage({ searchParams: Promise.resolve({ q: "literal_%(,).'", status: 'blocked',
      contract: 'closed', customerType: 'business', ops: 'failed', flag, page: '3' }) })
    const html=renderToStaticMarkup(element)
    expect(html).toContain('role="alert"')
    expect(html).toContain('Det valda kundfiltret är inte tillgängligt')
    expect(html).not.toContain('Matchande kunder')
    const href=html.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;','&')
    const params=new URL(href ?? '', 'http://local.invalid').searchParams
    expect(params.get('q')).toBe("literal_%(,).'")
    expect(params.get('status')).toBe('blocked');expect(params.get('contract')).toBe('closed')
    expect(params.get('customerType')).toBe('business');expect(params.get('ops')).toBe('failed')
    expect(params.has('flag')).toBe(false)
    expect(io.requests).toEqual([])
  })

  it('lets the actual page propagate an unexpected database error instead of treating it as an unavailable filter',async()=>{
    seedCorpus(1);io.failure={table:'customers',code:'P0001'}
    await expect(AdminCustomersPage({searchParams:Promise.resolve({q:'Other'})})).rejects.toMatchObject({code:'P0001'})
  })

  it.each(['overflow','foreign','false_fact','incomplete'] as const)('rejects a malformed %s RPC snapshot instead of a false page',async kind=>{
    seedCorpus(1)
    const snapshot=advancedSnapshot({p_company_id:companyA,p_query:'Other',p_status:'all',p_contract_filter:'all',
      p_customer_type:'all',p_flag:'all',p_exclude_test_data:false,p_page:1,p_page_size:100})
    const row=(snapshot.rows as StoredRow[])[0]
    if(kind==='overflow') row.billing_profile_revision=Number.MAX_SAFE_INTEGER+1
    if(kind==='foreign') row.company_id=companyB
    if(kind==='false_fact') row.possible_duplicate=false
    if(kind==='incomplete') snapshot.rows=[]
    io.rpcOverride=snapshot
    await expect(listCustomersPage({companyId:companyA,query:'Other'})).rejects.toThrow('invalid snapshot')
  })
})
