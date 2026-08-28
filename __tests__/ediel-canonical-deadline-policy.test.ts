import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  assertCanonicalDeadlineCatalogConsistency,
  canonicalDeadlineRuleForMessage,
  canonicalSupplierSwitchSendPolicy,
  evaluateCanonicalEdielActionDeadline,
} from '@/lib/ediel/rulebook/deadlinePolicy'

describe('canonical Ediel deadline authority', () => {
  it('owns handbook timing exactly once with source provenance', () => {
    expect(() => assertCanonicalDeadlineCatalogConsistency()).not.toThrow()

    const z03l = canonicalDeadlineRuleForMessage({ family: 'PRODAT', code: 'Z03', subtype: 'L' })
    expect(z03l?.source).toMatchObject({
      document: 'Svensk Elmarknadshandbok',
      edition: '26A',
      effectiveFrom: '2026-04-01',
      section: '10.2.1',
    })
    expect(z03l?.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'not_before', anchor: 'delivery_start', offset: -14, unit: 'calendar_months' }),
      expect.objectContaining({ kind: 'not_after', anchor: 'delivery_start', offset: -14, unit: 'calendar_days' }),
    ]))

    const policy = canonicalSupplierSwitchSendPolicy({ subtype: 'L' })
    expect(policy.maxAdvanceMonths).toBe(14)
    expect(policy.minimumLeadCalendarDays).toBe(14)
    expect(policy.latestRelativeToStartDays).toBe(-14)
  })

  it('models Z03 variants instead of applying the L deadline to move-in/cancellation', () => {
    expect(canonicalSupplierSwitchSendPolicy({ subtype: 'LK' })).toMatchObject({
      subtype: 'LK',
      maxAdvanceMonths: 14,
      minimumLeadCalendarDays: 0,
      latestRelativeToStartDays: 0,
    })
    expect(canonicalSupplierSwitchSendPolicy({ subtype: 'C', cancellationOfSubtype: 'L' })).toMatchObject({
      subtype: 'C',
      minimumLeadCalendarDays: 4,
      latestRelativeToStartDays: -4,
    })
    expect(canonicalSupplierSwitchSendPolicy({ subtype: 'C', cancellationOfSubtype: 'LK' })).toMatchObject({
      subtype: 'C',
      minimumLeadCalendarDays: 0,
      latestRelativeToStartDays: 0,
    })
  })

  it('enforces the Z03L 14-day / 14-month delivery-start window deterministically', () => {
    const now = new Date('2026-08-28T10:00:00Z')
    expect(evaluateCanonicalEdielActionDeadline({ actionType: 'start_supplier_switch', requestedDate: '2026-09-10', now }).ok).toBe(false)
    expect(evaluateCanonicalEdielActionDeadline({ actionType: 'start_supplier_switch', requestedDate: '2026-09-11', now }).ok).toBe(true)
    expect(evaluateCanonicalEdielActionDeadline({ actionType: 'start_supplier_switch', requestedDate: '2027-10-28', now }).ok).toBe(true)
    expect(evaluateCanonicalEdielActionDeadline({ actionType: 'start_supplier_switch', requestedDate: '2027-10-29', now }).ok).toBe(false)
  })

  it('enforces Z13VH history against both three years and current grid-agreement evidence', () => {
    const now = new Date('2026-08-28T10:00:00Z')
    const valid = evaluateCanonicalEdielActionDeadline({
      actionType: 'request_historical_metering_access',
      historicalStartDate: '2023-08-28',
      historicalEndDate: '2026-08-27',
      now,
    })
    expect(valid.ok).toBe(true)
    expect(valid.earliestAllowedDate).toBe('2023-08-28')
    expect(valid.latestAllowedDate).toBe('2026-08-27')

    expect(evaluateCanonicalEdielActionDeadline({
      actionType: 'request_historical_metering_access',
      historicalStartDate: '2023-08-27',
      historicalEndDate: '2026-08-27',
      now,
    }).ok).toBe(false)

    const agreementBound = evaluateCanonicalEdielActionDeadline({
      actionType: 'request_historical_metering_access',
      historicalStartDate: '2025-02-28',
      historicalEndDate: '2026-08-27',
      networkContractStartDate: '2025-03-01',
      now,
    })
    expect(agreementBound.ok).toBe(false)
    expect(agreementBound.earliestAllowedDate).toBe('2025-03-01')

    expect(evaluateCanonicalEdielActionDeadline({
      actionType: 'request_historical_metering_access',
      historicalStartDate: '2025-03-01',
      historicalEndDate: '2026-08-28',
      networkContractStartDate: '2025-03-01',
      now,
    }).ok).toBe(false)
  })

  it('keeps normative deadline tables out of operational runtime', () => {
    const deadlineCalculator = fs.readFileSync(path.join(process.cwd(), 'lib/ediel/calendar/deadlineCalculator.ts'), 'utf8')
    const scheduler = fs.readFileSync(path.join(process.cwd(), 'lib/operations/supplierSwitchScheduler.ts'), 'utf8')
    const historicalAction = fs.readFileSync(path.join(process.cwd(), 'lib/operations/businessActions/requestHistoricalMeteringAccess.ts'), 'utf8')

    expect(deadlineCalculator).toContain('canonicalDeadlineForAction')
    expect(deadlineCalculator).not.toContain(".from('ediel_business_deadline_rules')")
    expect(scheduler).toContain('canonicalSupplierSwitchSendPolicyProjection')
    expect(scheduler).not.toContain(".from('market_process_policies')")
    expect(historicalAction).not.toContain('setUTCFullYear')
  })
})
