import { describe, expect, it } from 'vitest'
import { contractCommitment } from '@/lib/customer-contracts/commitment'
import { deriveContractEndsAt, getContractLifecycleSummary } from '@/lib/customer-contracts/lifecycle'
import { contractCalendarDate, resolveContractStartDate } from '@/lib/customer-contracts/operationalDates'
import { getLifecycleSummary } from '@/components/admin/customers/contracts/helpers'
import type { CustomerContractRow } from '@/lib/customer-contracts/types'
import { buildContractPayload } from '@/lib/cis/db-shared'
import { calculateCustomerReadinessScore } from '@/lib/customers/readinessScore'

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
