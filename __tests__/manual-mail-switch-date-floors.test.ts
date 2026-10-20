import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculateEarliestSwitchStartDate } from '@/lib/operations/switchStartDate'

afterEach(() => vi.useRealTimers())

describe('supplier reply switch-date floors', () => {
  it.each([
    ['30 dagar', '2027-03-02'],
    ['30 days', '2027-03-02'],
    ['en dag', '2027-02-01'],
    ['två dagar', '2027-02-02'],
    ['tre dagar', '2027-02-03'],
    ['2 veckor', '2027-02-14'],
    ['en vecka', '2027-02-07'],
    ['två veckor', '2027-02-14'],
    ['1 månad', '2027-02-28'],
    ['en månad', '2027-02-28'],
    ['ett år', '2028-01-31'],
    ['två månader', '2027-03-31'],
    ['tre månader', '2027-04-30'],
  ])('respects an explicit simple notice period %s', (noticePeriod, expected) => {
    const result = calculateEarliestSwitchStartDate({ requestType: 'switch', today: '2027-01-31', marketLeadDays: 0, noticePeriod })
    expect(result.effectiveStartDate).toBe(expected)
    expect(result.floors).toContainEqual({ source: 'notice_period', date: expected })
  })

  it.each([
    ['2028-01-31', '1 månad', '2028-02-29'],
    ['2027-12-31', '2 månader', '2028-02-29'],
    ['2028-02-29', '1 år', '2029-02-28'],
    ['2027-03-31', '1 månad', '2027-04-30'],
  ])('clamps the last day of %s when adding %s', (today, noticePeriod, expected) => {
    expect(calculateEarliestSwitchStartDate({ requestType: 'switch', today, marketLeadDays: 0, noticePeriod }).effectiveStartDate).toBe(expected)
  })

  it.each([
    30, '30', '-30 dagar', '1.5 månader', '1,5 månader', '1 månad om kunden säger upp avtalet',
    'minst 3 månader', '3 månader eller 30 dagar', '1 månad och därefter 30 dagar',
    'cirka 3 månader', '999999999 år', '999999999 dagar', '3 arbetsdagar',
  ])('does not turn an ambiguous or invalid notice into an automatic date: %s', (noticePeriod) => {
    const result = calculateEarliestSwitchStartDate({ requestType: 'switch', today: '2027-01-31', marketLeadDays: 0, noticePeriod })
    expect(result.effectiveStartDate).toBe('2027-01-31')
    expect(result.floors.some((floor) => floor.source === 'notice_period')).toBe(false)
  })

  it('retains the market lead when notice is explicitly zero', () => {
    const result = calculateEarliestSwitchStartDate({ requestType: 'switch', today: '2027-01-31', noticePeriod: '0 dagar' })
    expect(result.effectiveStartDate).toBe('2027-02-14')
  })

  it('uses the supplier-confirmed earliest start as an independent floor', () => {
    const result = calculateEarliestSwitchStartDate({
      requestType: 'switch', today: '2026-10-18', requestedStartDate: '2027-03-31',
      contractEndDate: '2027-03-31', earliestSupplierStartDate: '2027-04-01',
    })
    expect(result.effectiveStartDate).toBe('2027-04-01')
    expect(result.requestedTooEarly).toBe(true)
    expect(result.floors).toContainEqual({ source: 'supplier_confirmed_start', date: '2027-04-01' })
    expect(result.floors).toContainEqual({ source: 'current_contract_end_date', date: '2027-03-31' })
  })

  it('preserves a later customer request while retaining supplier evidence', () => {
    const result = calculateEarliestSwitchStartDate({
      requestType: 'switch', today: '2026-10-18', requestedStartDate: '2027-05-01', earliestSupplierStartDate: '2027-04-01',
    })
    expect(result.earliestValidStartDate).toBe('2027-04-01')
    expect(result.effectiveStartDate).toBe('2027-05-01')
    expect(result.requestedHonored).toBe(true)
  })

  it('preserves the existing contract-end floor without adding a global day', () => {
    expect(calculateEarliestSwitchStartDate({ requestType: 'switch', today: '2026-10-18', contractEndDate: '2027-03-31' }).effectiveStartDate).toBe('2027-03-31')
  })

  it.each(['move_in', 'move_out_takeover'])('keeps %s anchored to move-in date despite old supplier terms', (requestType) => {
    const result = calculateEarliestSwitchStartDate({
      requestType, today: '2026-10-18', moveInDate: '2026-10-20',
      contractEndDate: '2027-03-31', noticePeriod: '3 månader', earliestSupplierStartDate: '2027-04-01',
    })
    expect(result.effectiveStartDate).toBe('2026-10-20')
    expect(result.floors).toEqual([{ source: 'today', date: '2026-10-18' }, { source: 'move_in_date', date: '2026-10-20' }])
  })

  it.each(['2027-02-29', '2027-04-31', '2027-13-01', '2027-3-01'])('rejects invalid calendar dates rather than rolling them forward: %s', (invalid) => {
    const result = calculateEarliestSwitchStartDate({
      requestType: 'switch', today: '2026-10-18', marketLeadDays: 0,
      contractEndDate: invalid, earliestSupplierStartDate: invalid, requestedStartDate: invalid,
    })
    expect(result.effectiveStartDate).toBe('2026-10-18')
    expect(result.requestedHonored).toBe(false)
    expect(result.floors).toEqual([{ source: 'market_lead_time', date: '2026-10-18' }])
  })

  it.each([new Date('2026-10-18T23:30:00.000Z'), '2026-10-18T23:30:00.000Z'])('uses the Stockholm calendar day when today is an instant', (today) => {
    expect(calculateEarliestSwitchStartDate({ requestType: 'switch', today }).effectiveStartDate).toBe('2026-11-02')
  })

  it('uses the Stockholm calendar day when today is omitted', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-18T23:30:00.000Z'))
    expect(calculateEarliestSwitchStartDate({ requestType: 'switch' }).effectiveStartDate).toBe('2026-11-02')
  })
})
