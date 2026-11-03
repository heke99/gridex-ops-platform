import { beforeEach, describe, expect, it, vi } from 'vitest'
import { contractCommitment } from '@/lib/customer-contracts/commitment'
import { deriveContractEndsAt, getContractLifecycleSummary } from '@/lib/customer-contracts/lifecycle'
import { contractCalendarDate, resolveContractStartDate } from '@/lib/customer-contracts/operationalDates'
import { getLifecycleSummary } from '@/components/admin/customers/contracts/helpers'
import type { CustomerContractRow } from '@/lib/customer-contracts/types'
import { buildContractPayload } from '@/lib/cis/db-shared'
import { calculateCustomerReadinessScore } from '@/lib/customers/readinessScore'
import { calculatePricingPreviewForUnderlay } from '@/lib/pricing/engine'
import { addCustomerContractEvent } from '@/lib/customer-contracts/db'

const pricingFixture = vi.hoisted(() => ({
  underlay: {} as Record<string, unknown>, contract: {} as Record<string, unknown>,
  filters: [] as Array<{ table: string; key: string; value: unknown }>,
  noticeCommands: [] as Array<Record<string, unknown>>,
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    let columns = '*'
    const predicates: Array<[string, unknown]> = []
    const row = () => {
      const data = table === 'billing_underlays' ? pricingFixture.underlay : pricingFixture.contract
      if (predicates.some(([key, value]) => data[key] !== value)) return null
      return columns === '*' ? data : Object.fromEntries(columns.split(',').map(key => [key.trim(), data[key.trim()]]))
    }
    const query = {
      select: (value = '*') => { columns = value; return query },
      eq: (key: string, value: unknown) => { pricingFixture.filters.push({ table, key, value }); predicates.push([key, value]); return query },
      in: () => query,
      single: async () => ({ data: row(), error: null }),
      maybeSingle: async () => ({ data: row(), error: null }),
    }
    if (!['billing_underlays', 'customer_contracts'].includes(table)) throw new Error(`Unexpected unit read: ${table}`)
    return query
  },
  rpc: async (name: string, params: Record<string, unknown>) => {
    if (name !== 'gridex_record_customer_contract_event_v1') throw new Error('Unexpected unit command')
    pricingFixture.noticeCommands.push({ ...params })
    return { data: { event: { id: 'unit-event' } }, error: null }
  },
} }))
vi.mock('@/lib/pricing/priceSourceResolver', () => ({
  // Explicit resolved-configuration fixture; source admission, snapshot loading
  // and ledger qualification remain separate. Actual engine/component/VAT math runs.
  resolvePricingConfiguration: async () => ({
    baseComponents: [{ sourceType: 'fixed', weightPercent: 100, fixedPriceSekPerKwh: 1 }],
    priceComponents: [
      { componentType: 'start_fee', name: 'Fixture start', amount: 100, unit: 'sek_once', calculationType: 'fixed_once', lifecycle: 'once_per_contract' },
      { componentType: 'custom_addon', name: 'Fixture annual', amount: 25, unit: 'sek_year', calculationType: 'fixed_once', lifecycle: 'annual' },
    ],
    vatRate: 0.25, warnings: [],
  }),
  resolveBasePriceSourceValues: async () => ({ fixedSekPerKwh: 1 }),
}))

describe('canonical supply dates reach actual contract consumers', () => {
  it('ends takeover binding after the actual delivered month-end term', () => {
    const contract = { id: 'fixture', status: 'active', contract_type: 'variable',
      actual_start_date: '2027-01-31', actual_start_at: null, starts_at: null, binding_months: 1 }
    expect(contractCommitment(contract, '2027-03-01')).toMatchObject({ binding: false, requiresTakeover: false })
  })

  it('includes the actual start in the binding floor when notice arrives', () => {
    const input = { startsAt: null, actualStartDate: '2026-10-28', bindingMonths: 12,
      noticeMonths: 1, terminationNoticeDate: '2026-11-01' }
    expect(deriveContractEndsAt(input)).toBe('2027-10-28')
  })

  it('anchors lifecycle binding and renewal to the actual start', () => {
    const input = { startsAt: null, actualStartDate: '2027-01-31', bindingMonths: 1,
      autoRenewEnabled: true, status: 'active' as const }
    expect(getContractLifecycleSummary(input, '2027-02-01')).toMatchObject({
      startsAt: '2027-01-31', bindingActive: true, terminationAllowedNow: false,
      boundUntil: '2027-02-28', nextRenewalDate: '2027-02-28',
    })
  })

  it('keeps a signed positive commitment conservative while delivery is genuinely unknown', () => {
    expect(getContractLifecycleSummary({ startsAt: null, bindingMonths: 12, status: 'signed' }, '2027-02-01'))
      .toMatchObject({ startsAt: null, boundUntil: null, bindingActive: true, terminationAllowedNow: false })
  })

  it('holds a definite end if a positive binding term has no start', () => {
    const input = { startsAt: null, bindingMonths: 12, noticeMonths: 1,
      terminationNoticeDate: '2026-11-01', status: 'signed' as const }
    expect(deriveContractEndsAt(input)).toBeNull()
    expect(getContractLifecycleSummary(input, '2026-11-01')).toMatchObject({
      effectiveEndDate: null, noticeEffectiveEndDate: '2026-12-01', bindingActive: true,
    })
  })

  it('uses actual date precedence in the real admin projection without changing signed terms', () => {
    const contract = { status: 'active', actual_start_date: '2027-01-31', starts_at: '2027-01-01',
      binding_months: 12, ends_at: null, notice_months: 1, termination_notice_date: null,
      auto_renew_enabled: false } as CustomerContractRow
    const before = JSON.stringify(contract)
    expect(getLifecycleSummary(contract)).toMatchObject({ startsAt: '2027-01-31', boundUntil: '2028-01-31' })
    expect(JSON.stringify(contract)).toBe(before)
  })

  it('preserves an explicit signed end as the existing legal rule', () => {
    expect(deriveContractEndsAt({ actualStartDate: '2027-01-31', bindingMonths: 12,
      endsAt: '2027-12-31', noticeMonths: 1, terminationNoticeDate: '2028-02-01' })).toBe('2027-12-31')
  })

  it('projects the same actual date into CIS while retaining the original signed start', () => {
    const contract = { id: 'fixture', status: 'active', actual_start_date: '2027-01-31',
      confirmed_start_date: '2027-01-30', starts_at: '2027-01-01', binding_months: 12,
      ends_at: null, notice_months: 1, termination_notice_date: null, auto_renew_enabled: false } as CustomerContractRow
    const payload = buildContractPayload(contract).contract as Record<string, unknown>
    expect(payload).toMatchObject({ starts_at: '2027-01-01', actual_start_date: '2027-01-31',
      confirmed_start_date: '2027-01-30', lifecycle_summary: { startsAt: '2027-01-31', boundUntil: '2028-01-31' } })
  })

  it('recognizes canonical dates in the existing readiness score without weakening other blockers', () => {
    const result = calculateCustomerReadinessScore({ customer: {}, contracts: [{ status: 'active',
      contract_name: 'Fixture', terms_version: 'fixture-v1', actual_start_date: '2027-01-31' }] })
    expect(result.contractScore).toBe(100)
    expect(result.readyForSwitch).toBe(false)
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'missing_signed_poa', severity: 'blocked' }))
  })
})

describe('calendar dates and consumer-specific authority', () => {
  it.each([
    ['2028-02-29', '2028-02-29'], ['2027-02-29', null], ['2027-02-30', null],
    ['2027-13-01', null], ['0000-01-01', null], [' 2027-01-31 ', '2027-01-31'],
    ['2027-01-30T23:30:00Z', '2027-01-31'], ['2027-03-27T23:30:00Z', '2027-03-28'],
    ['2027-10-30T22:30:00Z', '2027-10-31'], ['2027-01-31T00:30:00+01:00', '2027-01-31'],
    ['2027-01-31T00:30:00', null], ['2027-02-30T12:00:00Z', null],
    ['', null], ['not a date', null], [null, null], [42, null],
  ])('reads %s as %s', (input, expected) => {
    expect(contractCalendarDate(input)).toBe(expected)
  })

  it('uses the canonical actual date ahead of conflicting aliases and planned terms', () => {
    const row = { actual_start_date: '2027-01-31', actual_start_at: '2027-01-29',
      confirmed_start_date: '2027-01-25', starts_at: '2027-01-01' }
    for (const mode of ['delivered', 'planning', 'pricing'] as const)
      expect(resolveContractStartDate(row, mode)).toBe('2027-01-31')
  })

  it('distinguishes future confirmation from actual delivery and pricing authority', () => {
    const row = { confirmed_start_date: '2027-01-31', expected_start_at: '2027-01-25' }
    expect(resolveContractStartDate(row, 'planning')).toBe('2027-01-31')
    expect(resolveContractStartDate(row, 'delivered')).toBeNull()
    expect(resolveContractStartDate(row, 'pricing')).toBeNull()
  })

  it('retains the legacy actual and signed-start pricing compatibility', () => {
    expect(resolveContractStartDate({ actual_start_at: '2027-01-31' }, 'delivered')).toBe('2027-01-31')
    expect(resolveContractStartDate({ starts_at: '2027-01-31' }, 'pricing')).toBe('2027-01-31')
    expect(resolveContractStartDate({ starts_at: '2027-01-31' }, 'delivered')).toBeNull()
  })

  it('does not silently downgrade invalid authoritative data', () => {
    expect(resolveContractStartDate({ actual_start_date: '2027-02-30', actual_start_at: '2027-01-31' })).toBeNull()
    expect(resolveContractStartDate({ actual_start_date: 42, starts_at: '2027-01-31' })).toBeNull()
  })

  it('holds a genuinely unknown start without inventing a calendar date', () => {
    expect(resolveContractStartDate(null)).toBeNull()
    expect(resolveContractStartDate({})).toBeNull()
  })
})

describe('actual pricing engine and component calculator with resolved unit configuration', () => {
  beforeEach(() => {
    pricingFixture.underlay = { id: 'unit-underlay', company_id: 'unit-company', customer_id: 'unit-customer',
      metering_point_id: 'unit-point', contract_id: 'unit-contract', underlay_year: 2027, underlay_month: 1,
      total_kwh: 100, price_area: 'SE4', pricing_snapshot: { contract_type: 'fixed', vat_rate: 0.25 } }
    pricingFixture.contract = { id: 'unit-contract', company_id: 'unit-company', status: 'active',
      starts_at: null, actual_start_date: '2027-01-31', fixed_price_ore_per_kwh: 100 }
    pricingFixture.filters = []
    pricingFixture.noticeCommands = []
  })

  async function preview() {
    const result = await calculatePricingPreviewForUnderlay({ companyId: 'unit-company', billingUnderlayId: 'unit-underlay', persist: false })
    for (const table of ['billing_underlays', 'customer_contracts'])
      expect(pricingFixture.filters).toContainEqual({ table, key: 'company_id', value: 'unit-company' })
    expect(result.status).toBe('success')
    expect(pricingFixture.noticeCommands).toEqual([])
    return result
  }

  it('calculates first-period and annual fees from the actual canonical start', async () => {
    const result = await preview()
    expect(result.lines.filter(line => line.lineType !== 'base_price').map(line => line.amountExVat)).toEqual([100, 25])
    expect(result.totalExVat).toBe(225)
    expect(result.totalIncVat).toBe(281.25)
  })

  it('prefers delivered dates over a conflicting frozen planned start', async () => {
    pricingFixture.contract.starts_at = '2026-12-31'
    expect((await preview()).lines.filter(line => line.lineType !== 'base_price').map(line => line.amountExVat)).toEqual([100, 25])
    expect(pricingFixture.contract.starts_at).toBe('2026-12-31')
  })

  it('does not repeat first-period or annual fees in the following month', async () => {
    pricingFixture.underlay.underlay_month = 2
    expect((await preview()).lines.filter(line => line.lineType !== 'base_price')).toEqual([])
  })

  it('calculates only the annual component on a later anniversary', async () => {
    pricingFixture.underlay.underlay_year = 2028
    expect((await preview()).lines.filter(line => line.lineType !== 'base_price').map(line => line.amountExVat)).toEqual([25])
  })
})

describe('actual notice application port with a scoped query and mocked RPC boundary', () => {
  beforeEach(() => {
    pricingFixture.contract = { id: 'unit-contract', company_id: 'unit-company', customer_id: 'unit-customer',
      starts_at: null, ends_at: null, actual_start_date: '2026-10-28', binding_months: 12,
      notice_months: 1, status: 'active', auto_renew_enabled: false }
    pricingFixture.filters = []; pricingFixture.noticeCommands = []
  })

  const notice = (companyId = 'unit-company') => addCustomerContractEvent({ companyId,
    customerContractId: 'unit-contract', customerId: 'unit-customer', eventType: 'termination_notice_received',
    happenedAt: '2026-11-01T00:00:00Z', actorUserId: 'unit-actor' })

  it('passes the binding floor from the selected canonical actual date to the command', async () => {
    await notice()
    expect(pricingFixture.noticeCommands).toEqual([expect.objectContaining({
      p_company_id: 'unit-company', p_customer_id: 'unit-customer', p_customer_contract_id: 'unit-contract',
      p_derived_ends_at: '2027-10-28',
    })])
  })

  it('retains a known legacy actual start for notice derivation', async () => {
    pricingFixture.contract.actual_start_date = null
    pricingFixture.contract.actual_start_at = '2026-10-28'
    await notice()
    expect(pricingFixture.noticeCommands[0].p_derived_ends_at).toBe('2027-10-28')
  })

  it('does not derive a definite binding end from a future confirmation alone', async () => {
    pricingFixture.contract.actual_start_date = null
    pricingFixture.contract.confirmed_start_date = '2027-01-31'
    await notice()
    // NULL means no application-derived end, not an authoritative RPC HOLD.
    expect(pricingFixture.noticeCommands[0].p_derived_ends_at).toBeNull()
  })

  it('does not invoke the command for a different company', async () => {
    await expect(notice('other-company')).rejects.toThrow(/Kundavtalet hittades inte/)
    expect(pricingFixture.noticeCommands).toEqual([])
  })

  it('does not invoke the command for a different customer in the same company', async () => {
    await expect(addCustomerContractEvent({ companyId: 'unit-company', customerContractId: 'unit-contract',
      customerId: 'other-customer', eventType: 'termination_notice_received', happenedAt: '2026-11-01T00:00:00Z' }))
      .rejects.toThrow(/Kundavtalet hittades inte/)
    expect(pricingFixture.noticeCommands).toEqual([])
  })
})
