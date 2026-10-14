import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const port = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  company: '11111111-1111-4111-8111-111111111111' as string | null,
  platform: false,
  failures: {} as Record<string, { code: string; message: string }>,
  queries: [] as Array<{ table: string; params: Array<[string, string]> }>,
  cap: Infinity,
  serverClients: 0,
}))

function splitFilters(value: string): string[] {
  let depth = 0
  let start = 0
  const parts: string[] = []
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '(') depth++
    if (value[index] === ')') depth--
    if (value[index] === ',' && depth === 0) { parts.push(value.slice(start, index)); start = index + 1 }
  }
  return [...parts, value.slice(start)]
}

// PostgreSQL timestamptz compares instants and retains six fractional digits;
// the external database port must not compare formatting or truncate to JS ms.
function timestamp(value: unknown): string {
  const text = String(value)
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(text)?.[1] ?? ''
  return `${new Date(text).toISOString().slice(0, 19)}.${fraction.padEnd(6, '0')}Z`
}

function matches(row: Row, filter: string): boolean {
  if (filter.startsWith('and(')) return splitFilters(filter.slice(4, -1)).every(value => matches(row, value))
  if (filter.startsWith('or(')) return splitFilters(filter.slice(3, -1)).some(value => matches(row, value))
  const [field, op, ...rest] = filter.split('.')
  const value = rest.join('.')
  const actual = row[field]
  if (op === 'is') return value === 'null' && (actual === null || actual === undefined)
  if (actual === null || actual === undefined) return false
  if (op === 'eq') return field === 'created_at' ? timestamp(actual) === timestamp(value) : String(actual) === value
  if (op === 'in') return value.slice(1, -1).split(',').includes(String(actual))
  const left = field === 'created_at' ? timestamp(actual) : String(actual)
  const right = field === 'created_at' ? timestamp(value) : value
  if (op === 'lt') return left < right
  if (op === 'gt') return left > right
  if (op === 'gte') return left >= right
  if (op === 'lte') return left <= right
  throw new Error(`Unsupported read-port operator ${op}`)
}

function sdk() {
  return createClient('http://127.0.0.1:54321', 'synthetic-unit-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const table = url.pathname.split('/').at(-1)!
      port.queries.push({ table, params: [...url.searchParams] })
      if (port.failures[table]) return new Response(JSON.stringify(port.failures[table]), { status: 500 })
      let rows = [...(port.tables[table] ?? [])]
      for (const [field, value] of url.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(field)) continue
        rows = rows.filter(row => field === 'or'
          ? splitFilters(value.slice(1, -1)).some(filter => matches(row, filter))
          : matches(row, `${field}.${value}`))
      }
      const order = url.searchParams.get('order')
      if (order) rows.sort((a, b) => {
        for (const entry of order.split(',')) {
          const [field, direction, nullOrder] = entry.split('.')
          const av = a[field]; const bv = b[field]
          if (av == null || bv == null) {
            if (av == null && bv == null) continue
            return (av == null ? 1 : -1) * (nullOrder === 'nullsfirst' ? -1 : 1)
          }
          const diff = field === 'created_at'
            ? timestamp(av).localeCompare(timestamp(bv)) : String(av).localeCompare(String(bv))
          if (diff) return diff * (direction === 'desc' ? -1 : 1)
        }
        return 0
      })
      const count = rows.length
      const limit = Number(url.searchParams.get('limit') ?? Infinity)
      rows = rows.slice(0, Math.min(limit, port.cap))
      return new Response(JSON.stringify(rows), {
        headers: { 'content-type': 'application/json', 'content-range': rows.length ? `0-${rows.length - 1}/${count}` : `*/${count}` },
      })
    } },
  })
}

vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageKeyAccess: async () => ({ userId: 'operator', email: 'operator@example.test', roles: [], permissions: [], companyId: port.company, isPlatformAdmin: port.platform }),
  isPlatformAdminContext: () => port.platform,
}))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: async () => { throw new Error('canonical scope must not fall back') } }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => { port.serverClients++; return sdk() } }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: sdk() }))
vi.mock('@/app/admin/operations/actions', () => ({ bulkFinalizeReadySupplierSwitchesAction: async () => {}, finalizeSupplierSwitchExecutionAction: async () => {} }))
vi.mock('@/components/admin/CustomerName', () => ({ default: ({ id }: { id: string }) => React.createElement('span', null, id) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))

import ReadyPage from '@/app/admin/operations/ready-to-execute/page'
import { listAllSupplierSwitchRequests } from '@/lib/operations/db'

const COMPANY = '11111111-1111-4111-8111-111111111111'
const FOREIGN = '22222222-2222-4222-8222-222222222222'
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const customerId = id(10001)
const siteId = id(10002)
function request(n: number, overrides: Row = {}): Row {
  return {
    id: id(n), company_id: COMPANY, customer_id: customerId, site_id: siteId, metering_point_id: id(10003),
    status: 'accepted', request_type: 'switch_in', inbound_z04_message_id: id(10004),
    requested_start_date: '2026-10-01', confirmed_start_date: '2026-10-01',
    created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString(), submitted_at: null,
    failure_reason: null, ...overrides,
  }
}
async function html(cursor?: string): Promise<string> {
  const page = ReadyPage as (props?: { searchParams?: Promise<Record<string, string>> }) => Promise<React.ReactElement>
  const params: Record<string, string> = cursor ? { cursor } : {}
  return renderToStaticMarkup(await page({ searchParams: Promise.resolve(params) }))
}
function nextCursor(markup: string): string {
  const link = markup.match(/href="([^"]*\?cursor=[^"]+)"[^>]*>\s*Nästa sida\s*</)
  expect(link, 'qualified next page link').not.toBeNull()
  return new URL(link![1].replaceAll('&amp;', '&'), 'http://synthetic.local').searchParams.get('cursor')!
}
function visibleRequestIds(markup: string): string[] {
  return [...markup.matchAll(/name="request_id" value="([^"]+)"/g)].map(match => match[1])
}

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-pagination-server-key')
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T10:00:00Z'))
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  port.company = COMPANY; port.platform = false; port.failures = {}; port.queries = []; port.cap = Infinity; port.serverClients = 0
  port.tables = { supplier_switch_requests: [], outbound_requests: [], customer_sites: [{ id: siteId, company_id: COMPANY, site_name: 'Anläggning A' }] }
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('actual ready page and SDK candidate transport', () => {
  it('finds the older ready request behind200 newer completed rows', async () => {
    port.tables.supplier_switch_requests = [request(1), ...Array.from({ length: 200 }, (_, n) => request(n + 2, { status: 'completed' }))]
    expect(visibleRequestIds(await html())).toEqual([id(1)])
  })
  it('finds older actual ready work behind200 accepted rows whose start date has not arrived', async () => {
    port.tables.supplier_switch_requests = [request(1), ...Array.from({ length: 200 }, (_, n) => request(n + 2, { confirmed_start_date: '2099-01-01' }))]
    expect(visibleRequestIds(await html())).toEqual([id(1)])
  })
  it('retains the actual Z04, accepted status and reached-date activation requirements', async () => {
    port.tables.supplier_switch_requests = [request(1), request(2, { inbound_z04_message_id: null }), request(3, { confirmed_start_date: '2099-01-01' }), request(4, { status: 'submitted' })]
    expect(visibleRequestIds(await html())).toEqual([id(1)])
  })
  it('reaches more than200 ready rows without duplicate or skipped equal-date IDs', async () => {
    port.tables.supplier_switch_requests = Array.from({ length: 205 }, (_, n) => request(n + 1, { created_at: '2026-10-01T00:00:00Z' }))
    const all: string[] = []
    let cursor: string | undefined
    for (let page = 0; page < 8; page++) {
      const markup = await html(cursor)
      all.push(...visibleRequestIds(markup))
      if (!markup.includes('Nästa sida')) break
      cursor = nextCursor(markup)
    }
    expect(all).toEqual(Array.from({ length: 205 }, (_, n) => id(205 - n)))
    expect(new Set(all).size).toBe(205)
  })
  it('shows partial continuation when the accepted scan budget ends before older ready work', async () => {
    port.tables.supplier_switch_requests = [request(1), ...Array.from({ length: 1200 }, (_, n) => request(n + 2, { confirmed_start_date: '2099-01-01' }))]
    let markup = await html()
    expect(markup).toContain('Fler bekräftade byten återstår att kontrollera')
    expect(markup).not.toContain('Inga byten är redo för leveransstart')
    expect(visibleRequestIds(markup)).toEqual([])
    for (let page = 0; page < 4 && visibleRequestIds(markup).length === 0; page++) markup = await html(nextCursor(markup))
    expect(visibleRequestIds(markup)).toEqual([id(1)])
  })
  it('keeps nullable-created-at rows reachable after the nonnull ordered segment', async () => {
    port.tables.supplier_switch_requests = [...Array.from({ length: 52 }, (_, n) => request(n + 1)), request(53, { created_at: null })]
    const first = await html()
    const second = await html(nextCursor(first))
    expect([...visibleRequestIds(first), ...visibleRequestIds(second)]).toEqual([...Array.from({ length: 52 }, (_, n) => id(52 - n)), id(53)])
  })
  it('retains PostgreSQL microsecond precision across page boundaries', async () => {
    port.tables.supplier_switch_requests = Array.from({ length: 60 }, (_, n) => request(n + 1, {
      created_at: `2026-10-01T00:00:00.${String(n + 1).padStart(6, '0')}+00:00`,
    }))
    const first = await html()
    const second = await html(nextCursor(first))
    expect([...visibleRequestIds(first), ...visibleRequestIds(second)]).toEqual(Array.from({ length: 60 }, (_, n) => id(60 - n)))
  })
  it('does not infer exhaustion from a transport cap below requested batch size', async () => {
    port.cap = 30
    port.tables.supplier_switch_requests = [request(1), ...Array.from({ length: 200 }, (_, n) => request(n + 2, { confirmed_start_date: '2099-01-01' }))]
    expect(visibleRequestIds(await html())).toEqual([id(1)])
  })
  it('preserves genuine empty and page-local counters without a claimed global accepted total', async () => {
    const markup = await html()
    expect(markup).toContain('Inga byten är redo för leveransstart')
    expect(markup).not.toContain('Accepted totalt')
  })
  it('holds a source error with a safe unavailable view instead of claiming no ready work', async () => {
    port.failures.supplier_switch_requests = { code: '08006', message: 'private transport detail' }
    const markup = await html()
    expect(markup).toContain('Kön kunde inte läsas')
    expect(markup).not.toContain('private transport detail')
    expect(markup).not.toContain('Inga byten är redo för leveransstart')
  })
  it('does not query after a malformed or tampered cursor', async () => {
    const markup = await html('not-a-valid-cursor')
    expect(markup).toContain('Kön kunde inte läsas')
    expect(port.queries).toEqual([])
  })
  it('does not reuse a tenant cursor in another tenant or platform-global scope', async () => {
    port.tables.supplier_switch_requests = Array.from({ length: 60 }, (_, n) => request(n + 1))
    const cursor = nextCursor(await html())
    for (const scope of [{ company: FOREIGN, platform: false }, { company: COMPANY, platform: true }]) {
      port.company = scope.company; port.platform = scope.platform; port.queries = []
      expect(await html(cursor)).toContain('Kön kunde inte läsas')
      expect(port.queries).toEqual([])
    }
  })
  it('invalidates the previous market-day selection before querying rows', async () => {
    port.tables.supplier_switch_requests = Array.from({ length: 60 }, (_, n) => request(n + 1))
    const cursor = nextCursor(await html())
    vi.setSystemTime(new Date('2026-10-15T10:00:00Z')); port.queries = []
    expect(await html(cursor)).toContain('Kön kunde inte läsas')
    expect(port.queries).toEqual([])
  })
  it.each(['customer_id', 'site_id', 'metering_point_id'])('refuses a malformed candidate missing %s rather than rendering an invalid action target', async field => {
    port.tables.supplier_switch_requests = [request(1, { [field]: undefined })]
    expect(await html()).toContain('Kön kunde inte läsas')
    expect(port.queries.every(query => query.table === 'supplier_switch_requests')).toBe(true)
  })
  it.each(['customer_sites', 'outbound_requests'])('retains ready actions but explicitly marks unreadable auxiliary %s', async table => {
    port.tables.supplier_switch_requests = [request(1)]
    port.failures[table] = { code: '08006', message: 'private auxiliary detail' }
    const markup = await html()
    expect(visibleRequestIds(markup)).toEqual([id(1)])
    expect(markup).toContain('Vissa uppgifter kunde inte läsas')
    expect(markup).not.toContain('private auxiliary detail')
    expect(markup).not.toContain('Inga byten är redo för leveransstart')
  })
  it('marks incomplete outbound details instead of claiming a complete zero count', async () => {
    port.tables.supplier_switch_requests = [request(1)]
    port.tables.outbound_requests = Array.from({ length: 31 }, (_, n) => ({ id: id(n + 100), company_id: COMPANY, request_type: 'supplier_switch', source_type: 'supplier_switch_request', source_id: id(1), status: 'sent', created_at: '2026-10-01T00:00:00Z' }))
    port.cap = 30
    const markup = await html()
    expect(visibleRequestIds(markup)).toEqual([id(1)])
    expect(markup).toContain('Vissa uppgifter kunde inte läsas')
    expect(markup).toContain('Uppgift saknas')
  })
  it('keeps an unknown outbound state visible with a Swedish human-review label', async () => {
    port.tables.supplier_switch_requests = [request(1)]
    port.tables.outbound_requests = [{ id: id(100), company_id: COMPANY, request_type: 'supplier_switch', source_type: 'supplier_switch_request', source_id: id(1), status: 'future_delivery_state', created_at: '2026-10-01T00:00:00Z' }]
    const markup = await html()
    expect(visibleRequestIds(markup)).toEqual([id(1)])
    expect(markup).toContain('Kontroll krävs')
    expect(markup).not.toContain('Future delivery state')
  })
  it('contains a malformed auxiliary status instead of crashing the ready page', async () => {
    port.tables.supplier_switch_requests = [request(1)]
    port.tables.outbound_requests = [{ id: id(100), company_id: COMPANY, request_type: 'supplier_switch', source_type: 'supplier_switch_request', source_id: id(1), status: 17, created_at: '2026-10-01T00:00:00Z' }]
    const markup = await html()
    expect(visibleRequestIds(markup)).toEqual([id(1)])
    expect(markup).toContain('Vissa uppgifter kunde inte läsas')
  })
  it('holds cursor-key absence before reading rows instead of manufacturing an empty page', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    expect(await html()).toContain('Kön kunde inte läsas')
    expect(port.queries).toEqual([])
  })
  it('keeps canonical tenant scope and permits authorized global platform candidates', async () => {
    port.tables.supplier_switch_requests = [request(1), request(2, { company_id: FOREIGN })]
    expect(visibleRequestIds(await html())).toEqual([id(1)])
    port.platform = true; port.queries = []
    expect(visibleRequestIds(await html())).toEqual([id(2), id(1)])
  })
  it('retains old array caller semantics, including unrelated statuses', async () => {
    port.tables.supplier_switch_requests = [request(1, { status: 'future_review_state' }), request(2, { status: 'completed' })]
    const rows = await listAllSupplierSwitchRequests(sdk(), { companyId: COMPANY })
    expect(rows.map(row => row.id)).toEqual([id(2), id(1)])
  })
})
