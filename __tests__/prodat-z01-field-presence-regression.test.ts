import { describe, expect, it } from 'vitest'
import { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { fieldRulePresent, validateFieldMatrixPayload } from '@/lib/ediel/rulebook/fieldMatrix'

const segments = [
  'UNB+UNOC:3+21660:14+27700:14+260903:0940+Z01REF+++++23-DDQ-PRODAT',
  'UNH+1+PRODAT:D:97A:UN:E2SE6A',
  'BGM+Z01+AUTO-Z01-17C57E37+9+AB',
  'DTM+137:202609030940:203',
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
]

const rules = canonicalProdat26AFieldRules('Z01')
const rule = (fieldNumber: string) => {
  const found = rules.find((item) => item.fieldNumber === fieldNumber)
  if (!found) throw new Error(`Missing canonical Z01 rule ${fieldNumber}`)
  return found
}

describe('PRODAT Z01 field-level matrix presence', () => {
  it('does not confuse normal party/LIN segments with forbidden sibling fields', () => {
    expect(fieldRulePresent(rule('315'), { family: 'PRODAT', code: 'Z01', rawSegments: segments })).toBe(false)
    expect(fieldRulePresent(rule('258'), { family: 'PRODAT', code: 'Z01', rawSegments: segments })).toBe(false)
  })

  it('detects the Z01 grid area using RFF+Z05 rather than the UTILTS LOC+239 alias', () => {
    expect(fieldRulePresent(rule('260'), { family: 'PRODAT', code: 'Z01', rawSegments: segments })).toBe(true)
  })

  it('accepts a complete canonical Z01 payload without the three production false positives', () => {
    const issues = validateFieldMatrixPayload({
      family: 'PRODAT',
      code: 'Z01',
      rawSegments: segments,
      applicationReference: '23-DDQ-PRODAT',
      mode: 'send',
    }, rules)

    const blockerDescriptions = issues
      .filter((issue) => issue.blocking)
      .map((issue) => `${issue.code}:${issue.description}`)

    expect(blockerDescriptions.some((value) => value.includes('NAD+FR är markerat som -'))).toBe(false)
    expect(blockerDescriptions.some((value) => value.includes('LIN är markerat som -'))).toBe(false)
    expect(blockerDescriptions.some((value) => value.includes('RFF+Z05 krävs'))).toBe(false)
  })
})
