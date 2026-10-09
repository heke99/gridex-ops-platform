// ops-api-review: F7
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { postgrestOr, sortRows } from './helpers/postgrestOrFilter'

type Row = Record<string, unknown>
const m = vi.hoisted(() => ({
  invoices: [] as Record<string, unknown>[],
  contracts: [] as Record<string, unknown>[],
  limits: [] as number[],
  company: 'company_synthetic',
}))

vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: vi.fn(async () => ({ ok: true, client: { id: 'client_synthetic', company_id: m.company } })),
  logIntegrationApiRequest: vi.fn(async () => {}),
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = []
      const orders: Array<{ column: string; ascending: boolean; nullsFirst?: boolean }> = []
      let limit = Infinity
      const customer = { id: 'c0000000-0000-4000-8000-000000000001', company_id: 'company_synthetic', customer_reference: 'customer_public', customer_type: 'private' }
      const site = { id: 's0000000-0000-4000-8000-000000000001', company_id: 'company_synthetic', customer_id: customer.id, facility_reference: 'site_public', site_type: 'consumption' }
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (k: string, v: unknown) => { filters.push((row) => row[k] === v); return builder },
        gte: (k: string, v: string) => { filters.push((row) => row[k] !== null && String(row[k]) >= v); return builder },
        lte: (k: string, v: string) => { filters.push((row) => row[k] !== null && String(row[k]) <= v); return builder },
        or: (expression: string) => { filters.push(postgrestOr(expression)); return builder },
        order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => { orders.push({ column, ascending: options?.ascending ?? true, nullsFirst: options?.nullsFirst }); return builder },
        limit: (n: number) => { limit = n; if (table === 'customer_invoices') m.limits.push(n); return builder },
        async maybeSingle() {
          const row = table === 'customers' ? customer : site
          return { data: filters.every((f) => f(row)) ? row : null, error: null }
        },
        then(resolve: (v: unknown) => unknown) {
          const source = table === 'customer_contracts' ? m.contracts : m.invoices
          const rows = sortRows(source.filter((row) => filters.every((f) => f(row))), orders).slice(0, limit)
          return Promise.resolve({ data: rows, error: null }).then(resolve)
        },
      }
      return builder
    },
  },
}))

import { handleSimplePartnerApi } from '@/lib/partner-api/simple'

const SITE = 's0000000-0000-4000-8000-000000000001'
const CUSTOMER = 'c0000000-0000-4000-8000-000000000001'
const TARGET_CONTRACT = 'a0000000-0000-4000-8000-000000000001'
const LEGACY_CONTRACT = 'a0000000-0000-4000-8000-000000000002'
const OTHER_CONTRACT = 'b0000000-0000-4000-8000-000000000001'
let seq = 0
function invoice(ref: string, issuedAt: string | null, contract: { customer?: string | null; legacy?: string | null }, extra: Row = {}): Row {
  seq += 1
  return {
    id: `e0000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    company_id: 'company_synthetic', customer_id: CUSTOMER,
    invoice_reference: ref, invoice_number: ref, amount_inc_vat: 100, currency: 'SEK', due_date: '2026-10-30',
    issued_at: issuedAt, status: 'issued', customer_contract_id: contract.customer ?? null, contract_id: contract.legacy ?? null,
    ...extra,
  }
}
const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString()

async function list(query = '') {
  const path = ['customer', 'customer_public', 'site', 'site_public', 'invoice']
  return handleSimplePartnerApi(new NextRequest(`https://example.invalid/api/partner/v1/${path.join('/')}${query}`), 'GET', path)
}

beforeEach(() => {
  seq = 0
  m.limits = []
  m.company = 'company_synthetic'
  m.contracts = [
    { id: TARGET_CONTRACT, company_id: 'company_synthetic', customer_id: CUSTOMER, customer_site_id: SITE },
    { id: LEGACY_CONTRACT, company_id: 'company_synthetic', customer_id: CUSTOMER, customer_site_id: SITE },
    { id: OTHER_CONTRACT, company_id: 'company_synthetic', customer_id: CUSTOMER, customer_site_id: 'other-site' },
  ]
  m.invoices = []
})

describe('F7 Partner site invoices: site filter before the limit and keyset continuation', () => {
  it('200 newer invoices of another site no longer hide the requested site invoice', async () => {
    m.invoices = [
      ...Array.from({ length: 200 }, (_, i) => invoice(`other_${i}`, day(1000 + i), { customer: OTHER_CONTRACT })),
      invoice('target_invoice', day(1), { customer: TARGET_CONTRACT }),
    ]
    const response = await list()
    expect(response!.status).toBe(200)
    expect((await response!.json()).invoices.map((row: Row) => row.entity_id)).toEqual(['target_invoice'])
    expect(response!.headers.get('x-gridex-next-cursor')).toBeNull()
  })

  it('honours both contract columns: customer_contract_id wins, contract_id is the legacy fallback', async () => {
    m.invoices = [
      invoice('legacy_only', day(3), { legacy: LEGACY_CONTRACT }),
      invoice('modern', day(2), { customer: TARGET_CONTRACT, legacy: OTHER_CONTRACT }),
      invoice('modern_other_site', day(4), { customer: OTHER_CONTRACT, legacy: TARGET_CONTRACT }),
      invoice('no_contract', day(5), {}),
    ]
    const body = await (await list())!.json()
    expect(body.invoices.map((row: Row) => row.entity_id)).toEqual(['legacy_only', 'modern'])
  })

  it('keeps the V1 first page (newest 100, body shape unchanged) and continues with a cursor without gaps or duplicates', async () => {
    m.invoices = [
      ...Array.from({ length: 230 }, (_, i) => invoice(`site_${i}`, day(i % 50 === 0 ? 7 : i), { customer: TARGET_CONTRACT })),
      invoice('site_null_a', null, { customer: TARGET_CONTRACT }),
      invoice('site_null_b', null, { legacy: LEGACY_CONTRACT }),
      ...Array.from({ length: 50 }, (_, i) => invoice(`other_${i}`, day(5000 + i), { customer: OTHER_CONTRACT })),
    ]
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const response = await list(cursor ? `?cursor=${encodeURIComponent(cursor)}` : '')
      expect(response!.status).toBe(200)
      const body = await response!.json()
      expect(Object.keys(body)).toEqual(['invoices'])
      if (pages === 0) {
        expect(body.invoices).toHaveLength(100)
        expect(body.invoices[0].entity_id).toBe('site_229')
      }
      seen.push(...body.invoices.map((row: Row) => String(row.entity_id)))
      cursor = response!.headers.get('x-gridex-next-cursor')
      pages += 1
    } while (cursor && pages < 10)
    expect(pages).toBe(3)
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen).toHaveLength(232)
    expect(seen.slice(-2).sort()).toEqual(['site_null_a', 'site_null_b'])
    expect(seen.some((ref) => ref.startsWith('other_'))).toBe(false)
    expect(m.limits.every((n) => n === 101)).toBe(true)
  })

  it('rejects tampered cursors and cursors from another site filter, customer or tenant', async () => {
    m.invoices = Array.from({ length: 150 }, (_, i) => invoice(`site_${i}`, day(i), { customer: TARGET_CONTRACT }))
    const first = await list()
    const cursor = first!.headers.get('x-gridex-next-cursor')!
    expect(cursor).toBeTruthy()
    const tampered = cursor.slice(0, -2) + (cursor.endsWith('AA') ? 'BB' : 'AA')
    for (const bad of [tampered, 'anything', Buffer.from('{"orderValue":"x","id":"y"}').toString('base64url')]) {
      const response = await list(`?cursor=${encodeURIComponent(bad)}`)
      expect(response!.status).toBe(400)
      expect((await response!.json()).error.code).toBe('invalid_cursor')
    }
    // Same tenant, other date filter: the cursor is bound to the original filter.
    const otherFilter = await list(`?from_date=2026-01-01&cursor=${encodeURIComponent(cursor)}`)
    expect(otherFilter!.status).toBe(400)
    // Another tenant cannot reuse the cursor (and never sees the customer).
    m.company = 'company_other'
    const otherTenant = await list(`?cursor=${encodeURIComponent(cursor)}`)
    expect([400, 404]).toContain(otherTenant!.status)
    const valid = await (async () => { m.company = 'company_synthetic'; return list(`?cursor=${encodeURIComponent(cursor)}`) })()
    expect(valid!.status).toBe(200)
    expect((await valid!.json()).invoices).toHaveLength(50)
  })
})
