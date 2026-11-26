import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  calls: [] as { name: string; args: Record<string, unknown> }[],
}))

vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('http://127.0.0.1:1', 'fixture', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fixtureFetch },
    }),
  }
})

// The individual invoice branch must never be entered for a selected group.
vi.mock('@/lib/ediel/retention/financeCopyRetention', () => ({
  requireInvoiceSourceCopiesAvailable: () => { throw new Error('Unexpected individual invoice preparation') },
}))

import { prepareInvoiceDraftsForReview } from '@/lib/billing/invoiceReviewPrepare'
import { lockPricingPreview } from '@/lib/pricing/engine'
import { calculateUnderlayPricingWithCore, loadLockedUnderlayPricingWithCore } from '@/lib/pricing/underlayPricingAdapter'

type Row = Record<string, unknown>
const companyId = '00000000-0000-4000-8000-000000000001'
const customerId = '00000000-0000-4000-8000-000000000002'
const actorUserId = '00000000-0000-4000-8000-000000000003'
const referenceTime = '2026-10-31T12:00:00Z'
const billingMonth = '2026-11'
const frozenSource = (priceArea: string, price: number) => ({
  source_type: 'fixed', price_area: priceArea, fixed_price_sek_per_kwh: price,
  valid_from: '2026-10-01', valid_to: '2026-12-31',
})

function json(data: unknown, total?: number) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (total !== undefined) headers.set('content-range', total ? `0-${total - 1}/${total}` : '*/0')
  return new Response(JSON.stringify(data), { headers })
}

function fixtureFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { origin, pathname, searchParams } = new URL(input instanceof Request ? input.url : String(input))
  expect(origin).toBe('http://127.0.0.1:1')
  const target = pathname.replace(/^\/rest\/v1\//, '')
  if (init?.method === 'POST' && target.startsWith('rpc/')) {
    const name = target.slice(4)
    const args: Row = JSON.parse(String(init.body))
    fixture.calls.push({ name, args })
    expect(args.p_company_id).toBe(companyId)
    switch (name) {
      case 'gridex_read_billing_underlay_source_basis_v1':
        return Promise.resolve(json((args.p_underlay_ids as string[]).map(id => ({
          id, qualified: true, correctionRequired: false, sourceBasisHash: 'f'.repeat(64),
        }))))
      case 'gridex_persist_pricing_run': {
        const id = `run-${String(args.p_billing_underlay_id)}`
        const { lines, ...run } = args.p_result as Row
        fixture.tables.pricing_runs.push({
          ...run, id, billing_underlay_id: args.p_billing_underlay_id, company_id: companyId, status: 'calculated',
        })
        fixture.tables.pricing_preview_lines.push(...(lines as Row[]).map(line => ({
          ...line, pricing_run_id: id, company_id: companyId,
        })))
        return Promise.resolve(json(id))
      }
      case 'gridex_lock_pricing_run': {
        expect(args.p_actor_user_id).toBe(actorUserId)
        const run = fixture.tables.pricing_runs.find(row => row.id === args.p_pricing_run_id)
        if (!run || run.status !== 'calculated') throw new Error('Unexpected price lock')
        Object.assign(run, { status: 'locked', locked_at: referenceTime })
        return Promise.resolve(json(run.id))
      }
      case 'gridex_prepare_consolidated_invoice_v1': {
        const sources = args.p_sources as { underlayId: string }[]
        fixture.tables.invoice_export_items.push(...sources.map(({ underlayId }) => ({
          company_id: companyId, billing_underlay_id: underlayId, status: 'draft',
        })))
        return Promise.resolve(json({ invoice_id: 'fixture-invoice', existing: false }))
      }
      default:
        throw new Error(`Unexpected fixture RPC ${name}`)
    }
  }
  if (init?.method !== 'GET' || !Object.hasOwn(fixture.tables, target)) {
    throw new Error(`Unexpected fixture operation ${init?.method} ${target}`)
  }
  let rows = fixture.tables[target]
  for (const [column, filter] of searchParams) {
    if (['select', 'order', 'offset', 'limit'].includes(column)) continue
    if (filter.startsWith('eq.')) rows = rows.filter(row => String(row[column]) === filter.slice(3))
    else if (filter.startsWith('neq.')) rows = rows.filter(row => String(row[column]) !== filter.slice(4))
    else if (filter.startsWith('in.(')) rows = rows.filter(row => filter.slice(4, -1).split(',').includes(String(row[column])))
    else throw new Error(`Unexpected fixture filter ${column} ${filter}`)
  }
  const total = rows.length
  const offset = Number(searchParams.get('offset') ?? 0)
  rows = rows.slice(offset, offset + Number(searchParams.get('limit') ?? total))
  const headers = new Headers(init?.headers)
  if (headers.get('accept') === 'application/vnd.pgrst.object+json') {
    expect(rows).toHaveLength(1)
    return Promise.resolve(json(rows[0]))
  }
  return Promise.resolve(json(rows, headers.get('prefer')?.includes('count=exact') ? total : undefined))
}

beforeEach(() => {
  const sites = ['A', 'B'].map(site => ({
    company_id: companyId, customer_id: customerId, customer_site_id: `site-${site}`,
    metering_point_id: `meter-${site}`, contract_id: `contract-${site}`,
    contract_price_snapshot_id: `snapshot-${site}`,
  }))
  fixture.calls = []
  fixture.tables = {
    companies: [{ id: companyId, status: 'active' }],
    customers: [{ id: customerId, company_id: companyId, billing_profile_revision: 1, full_name: 'Fixture customer', invoice_email: 'invoice@example.invalid' }],
    customer_sites: sites.map(site => ({ ...site, id: site.customer_site_id, updated_at: referenceTime })),
    customer_contracts: sites.map(site => ({
      ...site, id: site.contract_id, status: 'active', consolidated_invoice: true,
      contract_type: 'fixed', updated_at: referenceTime, price_area_used: 'SE4',
    })),
    contract_price_snapshots: sites.map(site => ({
      id: site.contract_price_snapshot_id, company_id: companyId, contract_id: site.contract_id,
      invoice_delivery_method: 'email', pricing_model: 'fixed', snapshot_json: { vat_rate: 0.25 },
      base_price_components_snapshot: [frozenSource('SE4', site.customer_site_id === 'site-A' ? 0.80 : 0.95)],
      price_components_snapshot: [],
    })),
    billing_underlays: sites.map(site => ({
      ...site, id: `underlay-${site.customer_site_id.slice(-1)}`, price_area: 'SE4',
      underlay_year: 2026, underlay_month: 11, billing_period_start: '2026-11-01', billing_period_end: '2026-12-01',
      pricing_snapshot: { snapshot: site.contract_price_snapshot_id },
      status: 'validated', readiness_status: 'ready', total_kwh: 100,
      settlement_type: 'invoice', energy_direction: 'consumption', currency: 'SEK',
    })),
    billing_period_locks: [],
    price_period_locks: [],
    company_market_price_sources: [],
    invoice_export_items: [],
    pricing_runs: [],
    pricing_preview_lines: [],
    pricing_interval_evidence: [],
  }
})

const calculate = (billingUnderlayId: string) => calculateUnderlayPricingWithCore({ companyId, billingUnderlayId })
const locked = (billingUnderlayId: string) => loadLockedUnderlayPricingWithCore({ companyId, billingUnderlayId })
const prepare = () => prepareInvoiceDraftsForReview({
  companyId, billingMonth, actorUserId, customerId, environment: 'test', provider: 'file_export',
})

async function calculateAndLock(underlayId: string, amount: number, total: number) {
  const result = await calculate(underlayId)
  expect(result).toMatchObject({ status: 'success', subtotalSekExVat: amount, totalSekIncVat: total, locked: false, errors: [] })
  const pricingRunId = `run-${underlayId}`
  expect(result.pricingRunId).toBe(pricingRunId)
  expect(await locked(underlayId)).toBeNull()
  await lockPricingPreview({ companyId, pricingRunId, actorUserId })
  expect(await locked(underlayId)).toMatchObject({ pricingRunId: result.pricingRunId, locked: true, subtotalSekExVat: amount, totalSekIncVat: total })
}

describe('consolidated invoice pricing area', () => {
  it('prepares one draft with both exact locked prices when both selected sites have applicable SE4', async () => {
    await calculateAndLock('underlay-A', 80, 100)
    await calculateAndLock('underlay-B', 95, 118.75)
    expect(await prepare()).toMatchObject({ underlays: 2, candidates: 2, created: 1, failed: 0, errors: [] })
    const writes = fixture.calls.filter(call => call.name.includes('invoice'))
    expect(writes).toEqual([{
      name: 'gridex_prepare_consolidated_invoice_v1',
      args: expect.objectContaining({
        p_company_id: companyId, p_customer_id: customerId, p_billing_month: billingMonth,
        p_provider: 'file_export', p_environment: 'test',
        p_sources: [
          expect.objectContaining({
            underlayId: 'underlay-A', pricingRunId: 'run-underlay-A',
            calculation: expect.objectContaining({
              price_area: 'SE4', contract_price_snapshot_id: 'snapshot-A',
              total_kwh: 100, subtotal_sek_ex_vat: 80, vat_sek: 20, total_sek_inc_vat: 100,
              period_start: '2026-11-01', period_end: '2026-12-01',
            }),
          }),
          expect.objectContaining({
            underlayId: 'underlay-B', pricingRunId: 'run-underlay-B',
            calculation: expect.objectContaining({
              price_area: 'SE4', contract_price_snapshot_id: 'snapshot-B',
              total_kwh: 100, subtotal_sek_ex_vat: 95, vat_sek: 23.75, total_sek_inc_vat: 118.75,
              period_start: '2026-11-01', period_end: '2026-12-01',
            }),
          }),
        ],
      }),
    }])
    expect(fixture.tables.invoice_export_items.map(row => row.billing_underlay_id)).toEqual([
      'underlay-A', 'underlay-B',
    ])
  })

  it('refuses the whole group and makes no invoice mutation when one frozen price has an applicable invalid area', async () => {
    fixture.tables.contract_price_snapshots[1].base_price_components_snapshot = [frozenSource('SE5', 0.95)]
    await calculateAndLock('underlay-A', 80, 100)
    const invalid = await calculate('underlay-B')
    if (invalid.status === 'success' && invalid.pricingRunId) {
      await lockPricingPreview({ companyId, pricingRunId: invalid.pricingRunId, actorUserId })
    }
    const invalidLock = await locked('underlay-B')
    const prepared = await prepare()
    expect({
      pricing: {
        status: invalid.status, pricingRunId: invalid.pricingRunId,
        locked: invalid.locked, totalSekIncVat: invalid.totalSekIncVat, errors: invalid.errors,
      },
      invalidLockId: invalidLock?.pricingRunId ?? null,
      prepared,
      invoiceCalls: fixture.calls.filter(call => call.name.includes('invoice')).map(call => call.name),
    }).toMatchObject({
      pricing: {
        status: 'failed', pricingRunId: null, locked: false, totalSekIncVat: 0,
        errors: ['Prissnapshotets baskomponent har ett ogiltigt elområde.'],
      },
      invalidLockId: null,
      prepared: {
        underlays: 2, candidates: 2, alreadyPrepared: 0, created: 0, failed: 1,
        groupErrorCodes: ['invoice_group_price_not_locked'],
      },
      invoiceCalls: [],
    })
    expect(fixture.calls.map(call => call.name)).toEqual([
      'gridex_read_billing_underlay_source_basis_v1',
      'gridex_persist_pricing_run',
      'gridex_lock_pricing_run',
    ])
    expect(fixture.tables.invoice_export_items).toEqual([])
    expect(fixture.tables.pricing_runs).toMatchObject([{ id: 'run-underlay-A', status: 'locked' }])
  })
})
