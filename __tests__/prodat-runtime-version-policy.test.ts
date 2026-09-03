import { describe, expect, it } from 'vitest'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'

const rawZ01 = [
  'UNB+UNOC:3+21660:14+27700:14+260903:0956+Z01REF+++++23-DDQ-PRODAT',
  'UNH+1+PRODAT:D:97A:UN:E2SE6A',
  'BGM+Z01+AUTO-Z01-17C57E37+9+AB',
  'DTM+137:202609030956:203',
  'DTM+ZZZ:1:805',
  'NAD+FR+21660:160:SVK+++++++SE',
  'NAD+DO+27700:160:SVK+++++++SE',
  'LIN+1++735999147062804224:::9',
  'DTM+92:202609030000:203',
  'CCI++Z13',
  'CAV+Z22',
  'RFF+LI:AUTO-Z01-17C57E37',
  'RFF+Z05:MBY',
  'RFF+ANJ:AUTO-Z01-17C57E37',
  'NAD+UD+199905242328:SE2:260++Mariam Said El Hessi+Stjärngatan 14+Mjölby++59533+SE',
  'NAD+IT+735999147062804224::9+++Stjärngatan 14+Mjölby++59533+SE',
  'UNT+17+1',
  'UNZ+1+Z01REF',
].join("'") + "'"

describe('PRODAT runtime version versus UNH association semantics', () => {
  it('accepts catalog version 26A while resolving the guide association as E2SE6A', () => {
    const result = validateRulebookMessage({
      family: 'PRODAT',
      code: 'Z01',
      version: '26A',
      rawPayload: rawZ01,
      applicationReference: '23-DDQ-PRODAT',
      businessDate: '2026-09-03',
      direction: 'outbound',
      mode: 'send',
      environment: 'test',
    })

    const policyFailures = result.issues.filter((issue) => issue.code === 'CANONICAL_POLICY_VALIDATION_FAILED')
    expect(policyFailures.map((issue) => issue.description)).not.toContain('ediel_guide_resolution_missing:PRODAT:2026-09-03:26A')
    expect(policyFailures).toEqual([])
  })

  it('still fails closed for an unknown PRODAT runtime version', () => {
    const result = validateRulebookMessage({
      family: 'PRODAT',
      code: 'Z01',
      version: '99Z',
      rawPayload: rawZ01,
      applicationReference: '23-DDQ-PRODAT',
      businessDate: '2026-09-03',
      direction: 'outbound',
      mode: 'send',
      environment: 'test',
    })
    expect(result.issues.some((issue) =>
      issue.code === 'CANONICAL_POLICY_VALIDATION_FAILED' &&
      issue.description.includes('canonical_ediel_version_not_allowed:PRODAT:99Z')
    )).toBe(true)
  })
})
