import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadLockedUnderlayPricingWithCore } from '@/lib/pricing/underlayPricingAdapter'

const transport = vi.hoisted(() => vi.fn<typeof fetch>())
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://billing.test', 'synthetic-service-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: transport },
    }),
  }
})
vi.mock('@/lib/pricing/engine', () => ({
  calculatePricingPreviewForUnderlay: () => { throw new Error('Unexpected repricing') },
}))

const companyId = '10000000-0000-4000-8000-000000000001'
const billingUnderlayId = '20000000-0000-4000-8000-000000000001'
const pricingRunId = '30000000-0000-4000-8000-000000000001'
const input = { companyId, billingUnderlayId }
const incomplete = 'Faktureringsuppgifterna kunde inte läsas fullständigt.'

function evidenceId(index: number) {
  return `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
}

function evidenceRows(count: number) {
  const periodStart = Date.parse('2026-01-31T23:00:00.000Z')
  return Array.from({ length: count }, (_, index) => ({
    id: evidenceId(index),
    company_id: companyId,
    pricing_run_id: pricingRunId,
    metering_interval_start: new Date(periodStart + index * 900_000).toISOString(),
    metering_interval_end: new Date(periodStart + (index + 1) * 900_000).toISOString(),
    resolution: 'quarter',
    consumption_kwh: 1,
    price_sek_per_kwh: 0.67,
    amount_ex_vat: 0.67,
    price_source_id: '50000000-0000-4000-8000-000000000001',
    price_area: 'SE3',
    evidence_sha256: 'a'.repeat(64),
  }))
}

function database(options: {
  count: number
  serverCap?: number
  missingTotalAt?: number
  differentTotalAt?: number
  duplicateAt?: number
  errorAt?: number
}) {
  const rows = evidenceRows(options.count)
  const evidenceRequests: Array<{ offset: number; limit: number; prefer: string | null; order: string | null }> = []
  transport.mockImplementation(async (request, init) => {
    const url = new URL(String(request))
    const query = url.searchParams
    expect(init?.method).toBe('GET')
    expect(query.get('company_id')).toBe(`eq.${companyId}`)
    switch (url.pathname) {
      case '/rest/v1/pricing_runs':
        expect(query.get('billing_underlay_id')).toBe(`eq.${billingUnderlayId}`)
        expect(query.get('status')).toBe('eq.locked')
        return Response.json([{ id: pricingRunId, total_ex_vat: 1809.51, vat_amount: 452.38, total_inc_vat: 2261.89 }])
      case '/rest/v1/pricing_preview_lines':
        expect(query.get('pricing_run_id')).toBe(`eq.${pricingRunId}`)
        return Response.json([])
      case '/rest/v1/billing_underlays':
        expect(query.get('id')).toBe(`eq.${billingUnderlayId}`)
        return Response.json({ energy_direction: 'consumption', settlement_type: 'invoice' })
      case '/rest/v1/pricing_interval_evidence': {
        expect(query.get('pricing_run_id')).toBe(`eq.${pricingRunId}`)
        const offset = Number(query.get('offset') ?? 0)
        const limit = Number(query.get('limit') ?? options.serverCap ?? 1000)
        const prefer = new Headers(init?.headers).get('prefer')
        evidenceRequests.push({ offset, limit, prefer, order: query.get('order') })
        if (offset === options.errorAt) {
          return Response.json({ code: '57014', message: 'query canceled' }, { status: 500 })
        }
        const page = rows.slice(offset, offset + Math.min(limit, options.serverCap ?? 1000))
        if (offset === options.duplicateAt) page[0] = rows[offset - 1]
        const exact = prefer?.includes('count=exact') && offset !== options.missingTotalAt
        const total = exact ? rows.length + (offset === options.differentTotalAt ? 1 : 0) : '*'
        const range = page.length > 0 ? `${offset}-${offset + page.length - 1}` : '*'
        return Response.json(page, {
          status: exact && page.length < Number(total) ? 206 : 200,
          headers: { 'Content-Range': `${range}/${total}` },
        })
      }
      default:
        throw new Error(`Unexpected synthetic billing request ${url.pathname}`)
    }
  })
  return evidenceRequests
}

beforeEach(() => {
  transport.mockReset()
})

function readError(): Promise<unknown> {
  return loadLockedUnderlayPricingWithCore(input).then(() => undefined, (error: unknown) => error)
}

describe('locked pricing interval evidence', () => {
  it('loads a complete 2,688-row quarter-hour month in stable order without changing totals', async () => {
    const requests = database({ count: 2688 })

    const result = await loadLockedUnderlayPricingWithCore(input)

    expect(result).toMatchObject({ status: 'success', locked: true, pricingRunId, subtotalSekExVat: 1809.51 })
    expect(result?.intervalEvidence).toHaveLength(2688)
    expect(result?.intervalEvidence.every((row, index) => row.id === evidenceId(index))).toBe(true)
    expect(result?.intervalEvidence[2687]).toMatchObject({ evidenceSha256: 'a'.repeat(64), priceArea: 'SE3' })
    expect(requests.map((request) => request.offset)).toEqual([0, 1000, 2000])
    expect(requests.every(({ limit, prefer, order }) => (
      limit === 1000 && prefer === 'count=exact' && order === 'metering_interval_start.asc,metering_interval_end.asc,price_area.asc'
    ))).toBe(true)
  })

  it('keeps the legacy empty evidence result and needs no subsequent page', async () => {
    const requests = database({ count: 0 })

    await expect(loadLockedUnderlayPricingWithCore(input)).resolves.toMatchObject({ locked: true, intervalEvidence: [] })
    expect(requests.map((request) => request.offset)).toEqual([0])
  })

  it('continues with the actual offset when the server applies a lower row cap', async () => {
    const requests = database({ count: 1500, serverCap: 400 })

    const result = await loadLockedUnderlayPricingWithCore(input)

    expect(result?.intervalEvidence).toHaveLength(1500)
    expect(requests.map((request) => request.offset)).toEqual([0, 400, 800, 1000, 1400])
  })

  it.each([0, 1000])('rejects a missing exact total at offset %i', async (missingTotalAt) => {
    database({ count: 1100, missingTotalAt })

    expect(await readError()).toMatchObject({ message: incomplete })
  })

  it('rejects a changing total before accepting all pages', async () => {
    database({ count: 1100, differentTotalAt: 1000 })

    expect(await readError()).toMatchObject({ message: 'Faktureringsuppgifterna ändrades under läsningen. Försök igen.' })
  })

  it('rejects a repeated evidence row across pages with the same total', async () => {
    database({ count: 1100, duplicateAt: 1000 })

    expect(await readError()).toMatchObject({ message: incomplete })
  })

  it('propagates a later read error without returning the earlier partial rows', async () => {
    const requests = database({ count: 1100, errorAt: 1000 })

    expect(await readError()).toMatchObject({ code: '57014' })
    expect(requests.map((request) => request.offset)).toEqual([0, 1000])
  })
})
