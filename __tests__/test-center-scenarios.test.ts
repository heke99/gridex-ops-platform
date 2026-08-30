import { describe, expect, it } from 'vitest'
import { materializeTestCenterScenario } from '@/lib/ediel/testing/testCenterScenarios'

const SAMPLE = "UNB+UNOC:3+SENDER+RECEIVER+260830:1200+1'UNH+1+UTILTS:D:02B:UN:S02'BGM+Z04+1+9'LOC+172+735999000000000001'QTY+136:12.5:KWH'DTM+163:202608010000:203'UNT+6+1'UNZ+1+1'"

describe('Test Center deterministic scenarios', () => {
  it('replays duplicates byte-for-byte', () => {
    const plan = materializeTestCenterScenario(SAMPLE, 'duplicate')
    expect(plan.runs).toHaveLength(2)
    expect(plan.runs[0].rawEdifact).toBe(plan.runs[1].rawEdifact)
  })

  it('removes exactly the first QTY for missing-values fixture', () => {
    const plan = materializeTestCenterScenario(SAMPLE, 'missing_values')
    expect(plan.runs).toHaveLength(1)
    expect(plan.runs[0].rawEdifact).not.toContain('QTY+136:12.5:KWH')
    expect(plan.runs[0].expectation).toBe('blocked_missing_values')
  })

  it('creates a deterministic correction while preserving baseline', () => {
    const plan = materializeTestCenterScenario(SAMPLE, 'correction')
    expect(plan.runs).toHaveLength(2)
    expect(plan.runs[0].rawEdifact).toBe(SAMPLE)
    expect(plan.runs[1].rawEdifact).toContain('QTY+136:13.500:KWH')
    expect(plan.runs[1].rawEdifact).toContain('UNH+1C+UTILTS')
  })

  it('materializes rebilling as baseline, correction, then correction replay', () => {
    const plan = materializeTestCenterScenario(SAMPLE, 'rebilling')
    expect(plan.runs).toHaveLength(3)
    expect(plan.runs[1].rawEdifact).toBe(plan.runs[2].rawEdifact)
    expect(plan.runs[2].expectation).toBe('rebilled')
  })
})
