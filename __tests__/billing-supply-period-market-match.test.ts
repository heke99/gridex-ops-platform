import { describe, expect, it, vi } from 'vitest'
import { updateMeterValueBillingReadiness } from '@/lib/billing/meterValueBillingMatcher'
import type { MeteringValueRow } from '@/lib/cis/types'

const fetchPort = vi.hoisted(() => vi.fn<typeof fetch>())
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabaseService: createClient('https://billing-test.invalid', 'synthetic-metering-test', {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: fetchPort },
    }),
  }
})

type Row = Record<string, unknown>
type Period = {
  id: string
  company_id: string
  customer_id: string
  metering_point_id: string
  contract_id: string
  start_date: string
  end_date: string | null
  market_start_at: string | null
  market_end_at: string | null
  status: string
}

const [company, customer, point, meter, normalized, source] = [
  'company', 'customer', 'point', 'meter', 'normalized', 'source',
]
const at = (time: string) => `2026-06-01T${time}Z`
const cutoff = at('12:00:00')
const period = (id: string, values: Partial<Period> = {}): Period => ({
  id, company_id: company, customer_id: customer, metering_point_id: point, contract_id: `contract-${id}`,
  start_date: '2026-05-01', end_date: '2026-06-01',
  market_start_at: '2026-04-30T22:00:00Z', market_end_at: cutoff, status: 'active',
  ...values,
})
const previous = period('earlier')
const next = period('later', {
  start_date: '2026-06-01', end_date: null, market_start_at: cutoff, market_end_at: null,
})

function fixture({ rows, start, end, readError = false }: {
  rows: Period[]; start: string; end: string; readError?: boolean
}) {
  const value = {
    id: meter, company_id: company, customer_id: customer, metering_point_id: point,
    period_start: start, period_end: end, source_ediel_message_id: source,
  } as MeteringValueRow
  const gates: Row[] = []
  const issues: Row[] = []
  const lookups: string[] = []
  const supplyQueries: URLSearchParams[] = []

  fetchPort.mockImplementation(async (input, init) => {
    const { pathname, searchParams } = new URL(String(input))
    const endpoint = pathname.split('/').at(-1)
    if (endpoint === 'gridex_read_billing_source_values_v1') {
      expect(JSON.parse(String(init?.body))).toEqual({ p_company_id: company, p_value_ids: [normalized] })
      return Response.json([{
        id: normalized, company_id: company, customer_id: customer, metering_point_id: point,
        period_start: start, period_end: end, source_metering_value_id: meter, source_message_id: source,
        quantity_kwh: '1.5', unit: 'kWh', revision_status: 'current', revision_number: 1,
        billing_source_message: { id: source, company_id: company, message_family: 'UTILTS', status: 'validated' },
        billing_source_basis: {
          version: 1, normalizedValueId: normalized, sourceMessageId: source, qualified: true,
          quantityType: '136', quantityKwh: '1.5', qualityEstablished: true, quality: null, productCode: null,
        },
      }])
    }
    if (endpoint === 'gridex_set_metering_billing_gate') {
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({ p_company_id: company, p_metering_value_id: meter, p_normalized_value_id: normalized })
      gates.push(body.p_gate)
      const matched = rows.find(row => row.id === body.p_gate.supply_period_id)
      if (body.p_gate.billing_status === 'billable' && !matched?.market_start_at) {
        return Response.json({ code: '23514', message: 'billing_gate_qualified_supply_source_required' }, { status: 400 })
      }
      return Response.json({ status: body.p_gate.billing_status })
    }
    if (endpoint === 'ediel_unresolved_items' && init?.method === 'POST') {
      const item = JSON.parse(String(init.body))
      expect(item.company_id).toBe(company)
      issues.push(item)
      return new Response(null, { status: 201 })
    }

    expect(searchParams.get('company_id')).toBe(`eq.${company}`)
    switch (endpoint) {
      case 'normalized_metering_values':
        expect(searchParams.get('source_metering_value_id')).toBe(`eq.${meter}`)
        expect(searchParams.get('revision_status')).toBe('eq.current')
        return Response.json([{ id: normalized, revision_status: 'current' }])
      case 'customer_supply_periods': {
        supplyQueries.push(searchParams)
        expect(searchParams.get('metering_point_id')).toBe(`eq.${point}`)
        expect(searchParams.get('status')).toBe('in.(active,confirmed_by_grid_owner,ended)')
        expect(searchParams.get('start_date')).toBe('lte.2026-06-01')
        expect(searchParams.get('limit')).toBe('3')
        expect(searchParams.getAll('or')[0]).toBe('(end_date.is.null,end_date.gte.2026-06-01)')
        if (readError) return Response.json({ code: '57014', message: 'query canceled' }, { status: 500 })
        const physical = searchParams.getAll('or')[1]
        if (physical) {
          expect(physical).toBe(`(market_start_at.is.null,and(market_start_at.lte.${start},or(market_end_at.is.null,market_end_at.gte.${end})))`)
          expect(searchParams.get('order')).toBe('market_start_at.asc.nullslast')
        }
        let matching = rows.filter(row => row.company_id === company && row.metering_point_id === point
          && ['active', 'confirmed_by_grid_owner', 'ended'].includes(row.status))
        if (physical) {
          matching = matching.filter(row => !row.market_start_at || (
            Date.parse(row.market_start_at) <= Date.parse(start)
            && (!row.market_end_at || Date.parse(end) <= Date.parse(row.market_end_at))
          )).sort((a, b) => Number(a.market_start_at === null) - Number(b.market_start_at === null))
        }
        return Response.json(matching.slice(0, 3))
      }
      case 'customer_contracts': {
        const id = searchParams.get('id')?.slice(3)
        if (!id) throw new Error('Expected an exact contract id')
        expect(searchParams.get('metering_point_id')).toBe(`eq.${point}`)
        expect(searchParams.get('customer_id')).toBe(`eq.${customer}`)
        lookups.push(id)
        return Response.json([{ id, company_id: company, customer_id: customer, metering_point_id: point,
          starts_at: '2026-05-01', status: 'active' }])
      }
      case 'ediel_unresolved_items':
        return Response.json([])
      default:
        throw new Error(`Unexpected synthetic endpoint ${endpoint}`)
    }
  })

  return { evaluate: () => updateMeterValueBillingReadiness({ meterValue: value }), gates, issues, lookups, supplyQueries }
}

describe('meter billing at an intraday supply handover', () => {
  it.each([
    [at('08:00:00'), at('08:15:00'), previous],
    [at('11:45:00'), cutoff, previous],
    ['2026-06-01T14:00:00+02:00', '2026-06-01T14:15:00+02:00', next],
    [at('15:00:00'), at('15:15:00'), next],
  ] as const)('matches the entire interval %s–%s to one contract', async (start, end, expected) => {
    const result = fixture({ rows: [previous, next], start, end })
    await expect(result.evaluate()).resolves.toBe('billable')
    expect(result.supplyQueries).toHaveLength(1)
    expect(result.lookups).toEqual([expected.contract_id])
    expect(result.gates).toEqual([expect.objectContaining({
      supply_period_id: expected.id,
      billing_gate_snapshot: expect.objectContaining({
        contract_id: expected.contract_id, source_basis: expect.objectContaining({ quantityKwh: '1.5' }),
      }),
    })])
    expect(result.issues).toEqual([])
  })

  it('keeps true overlap in conflict and does not charge a crossing interval', async () => {
    const overlap = fixture({
      rows: [{ ...previous, market_end_at: at('14:00:00') }, next], start: cutoff, end: at('12:15:00'),
    })
    await expect(overlap.evaluate()).resolves.toBe('conflict')
    expect(overlap.gates[0]).toMatchObject({ supply_period_id: null, billing_status: 'conflict' })
    expect(overlap.issues[0]).toMatchObject({ issue_type: 'billing_period_conflict' })
    expect(overlap.lookups).toEqual([])

    const crossing = fixture({ rows: [previous, next], start: at('11:50:00'), end: at('12:05:00') })
    await expect(crossing.evaluate()).resolves.toBe('pending_match')
    expect(crossing.gates[0]).toMatchObject({ supply_period_id: null, billing_status: 'pending_match' })
    expect(crossing.lookups).toEqual([])
  })

  it('prioritizes covered source periods before the cap and ignores unrelated rows', async () => {
    const invalidRows = [
      period('early'),
      period('legacy-first', { market_start_at: null }),
      period('legacy-second', { market_start_at: null }),
      period('legacy-third', { market_start_at: null }),
      { ...next, id: 'other-company', company_id: 'other' },
      { ...next, id: 'other-meter', metering_point_id: 'other' },
    ]
    const result = fixture({ rows: [...invalidRows, next], start: cutoff, end: at('12:15:00') })
    await expect(result.evaluate()).resolves.toBe('billable')
    expect(result.supplyQueries).toHaveLength(1)
    expect(result.gates[0]).toMatchObject({ supply_period_id: next.id })
  })

  it('retains the existing visible qualification failure for a civil-only row', async () => {
    const legacy = fixture({
      rows: [period('legacy', { market_start_at: null })], start: cutoff, end: at('12:15:00'),
    })
    await expect(legacy.evaluate()).resolves.toBe('blocked')
    expect(legacy.gates.at(-1)).toMatchObject({
      billing_status: 'blocked', billing_gate_reasons: [expect.objectContaining({ code: 'supply_source_unqualified' })],
    })
    expect(legacy.issues[0]).toMatchObject({ issue_type: 'billing_gate_blocked' })
  })

  it('does not admit pending ends or disguise a failed candidate read', async () => {
    const ending = fixture({ rows: [{ ...previous, status: 'ending' }], start: at('08:00:00'), end: at('08:15:00') })
    await expect(ending.evaluate()).resolves.toBe('pending_match')
    expect(ending.gates[0]).toMatchObject({ supply_period_id: null })

    const failed = fixture({ rows: [next], start: cutoff, end: at('12:15:00'), readError: true })
    await expect(failed.evaluate()).rejects.toMatchObject({ code: '57014' })
    expect(failed.gates).toEqual([])
    expect(failed.issues).toEqual([])
  })
})
