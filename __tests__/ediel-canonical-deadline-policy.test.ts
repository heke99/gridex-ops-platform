import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'

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

// masterplan: GOV-01, AT-GOV-01
describe('published deadline source integrity before first canonical selection', () => {
  it('retains the first actual Z01 response deadline after nested Z02 constraint mutation attempts', async () => {
    vi.resetModules()
    const source = await import('@/lib/ediel/rulebook/deadlinePolicy')
    const rows = source.CANONICAL_EDIEL_DEADLINE_RULES.filter(row => row.code === 'Z02')
    const original = rows.map(row => row.constraints[0].offset)
    const writes = rows.map(row => Reflect.set(row.constraints[0], 'offset', 1))
    try {
      expect(source.canonicalZ01BusinessResponseDeadlineMinutes()).toBe(30)
      expect(writes).toEqual([false, false])
      expect(rows.map(row => row.constraints[0].offset)).toEqual([30, 30])
    } finally {
      rows.forEach((row, index) => Reflect.set(row.constraints[0], 'offset', original[index]))
    }
  })

  it('retains the first actual supplier-switch policy after published Z03 constraint mutation attempts', async () => {
    vi.resetModules()
    const source = await import('@/lib/ediel/rulebook/deadlinePolicy')
    const row = source.CANONICAL_EDIEL_DEADLINE_RULES.find(entry => entry.code === 'Z03' && entry.subtype === 'L')!
    const constraint = row.constraints.find(entry => entry.kind === 'not_after')!
    const original = constraint.offset
    const wrote = Reflect.set(constraint, 'offset', -1)
    try {
      expect(source.canonicalSupplierSwitchSendPolicy({ subtype: 'L' })).toMatchObject({
        maxAdvanceMonths: 14,
        minimumLeadCalendarDays: 14,
        latestRelativeToStartDays: -14,
      })
      expect(wrote).toBe(false)
      expect(source.canonicalDeadlineCatalog()).toBe(source.CANONICAL_EDIEL_DEADLINE_RULES)
    } finally {
      Reflect.set(constraint, 'offset', original)
    }
  })

  it('retains the first actual source locator and protects every published row and nested record', async () => {
    vi.resetModules()
    const source = await import('@/lib/ediel/rulebook/deadlinePolicy')
    const row = source.CANONICAL_EDIEL_DEADLINE_RULES.find(entry => entry.code === 'Z03' && entry.subtype === 'L')!
    const original = { ...row.source }
    const wrote = Reflect.set(row.source, 'section', 'in-process-altered-locator')
    try {
      expect(source.canonicalSupplierSwitchSendPolicy({ subtype: 'L' }).source.section).toBe(original.section)
      expect(source.canonicalSupplierSwitchSendPolicy({ subtype: 'L' }).source).toEqual(original)
      expect(wrote).toBe(false)
      expect(Object.isFrozen(source.CANONICAL_EDIEL_DEADLINE_RULES)).toBe(true)
      for (const published of source.canonicalDeadlineCatalog()) {
        expect(Object.isFrozen(published)).toBe(true)
        expect(Object.isFrozen(published.source)).toBe(true)
        expect(Object.isFrozen(published.constraints)).toBe(true)
        expect(published.constraints.every(Object.isFrozen)).toBe(true)
      }
    } finally {
      Reflect.set(row.source, 'section', original.section)
    }
  })
})
