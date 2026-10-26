// reality-defects: K-B4
// K-B4: the simulated grid owner timed its Z02 (answer to our Z01) with z04DelayMs. Scenario K holds switch requests
// unanswered (z04DelayMs = 24 h), so W1's Z01 got no Z02 either: W1 never got its grid area and no Z03 was sent
// (K4, K8). The Z02 has its own delay; holding Z04 back never holds back the Z02.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { businessAnswerDelayMs, DEFAULT_GRID_OWNER_PROFILE } from '@/scripts/reality/simulators/gridOwnerProfile'

describe('K-B4 the grid owner answers a Z01 on its own schedule, independent of Z04', () => {
  it('holding switch confirmations back does not hold back the Z02', () => {
    const k4 = { ...DEFAULT_GRID_OWNER_PROFILE, contrlDelayMs: 20_000, aperakDelayMs: 40_000, z02DelayMs: 90_000, z04DelayMs: 24 * 3_600_000 }
    expect(businessAnswerDelayMs(k4, 'Z01')).toBe(90_000)
    expect(businessAnswerDelayMs(k4, 'Z03')).toBe(24 * 3_600_000)
    expect(businessAnswerDelayMs(k4, 'Z05')).toBeNull()
  })

  it('the default answers a Z01 within minutes', () => {
    expect(businessAnswerDelayMs(DEFAULT_GRID_OWNER_PROFILE, 'Z01')).toBeLessThanOrEqual(120_000)
  })

  it('the simulator uses the Z01 delay for its Z02 and the Z03 delay for its Z04', () => {
    const source = readFileSync(path.resolve(__dirname, '../scripts/reality/simulators/gridOwner.ts'), 'utf8')
    const z01 = source.slice(source.indexOf("code === 'Z01'"), source.indexOf("code === 'Z03'"))
    expect(z01).toContain("businessAnswerDelayMs(profile, 'Z01')")
    expect(z01).not.toContain('z04DelayMs')
  })
})
