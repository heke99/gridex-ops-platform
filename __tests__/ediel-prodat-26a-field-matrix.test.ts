import { describe, expect, it } from 'vitest'
import {
  PRODAT_26A_FIELD_MATRIX,
  PRODAT_26A_MESSAGE_CODES,
  assertCanonicalProdat26AMatrixComplete,
  canonicalProdat26AFieldRules,
} from '@/lib/ediel/prodat/prodat26AFieldMatrix'

describe('PRODAT 26.A immutable field matrix', () => {
  it('contains exactly 77 fields across all 13 message functions', () => {
    expect(() => assertCanonicalProdat26AMatrixComplete()).not.toThrow()
    expect(PRODAT_26A_FIELD_MATRIX).toHaveLength(77)
    expect(PRODAT_26A_MESSAGE_CODES).toEqual(['Z01','Z02','Z03','Z04','Z05','Z06','Z08','Z09','Z10','Z13','Z14','Z15','Z18'])
    for (const row of PRODAT_26A_FIELD_MATRIX) expect(row.requirements).toHaveLength(13)
  })

  it('projects one deterministic 77-rule view per message function', () => {
    for (const code of PRODAT_26A_MESSAGE_CODES) {
      const rules = canonicalProdat26AFieldRules(code)
      expect(rules).toHaveLength(77)
      expect(rules.every((rule) => rule.family === 'PRODAT' && rule.code === code && rule.source === 'static')).toBe(true)
    }
  })

  it('locks important guide requirements without DB fallback', () => {
    const z01 = canonicalProdat26AFieldRules('Z01')
    const z13 = canonicalProdat26AFieldRules('Z13')
    const z14 = canonicalProdat26AFieldRules('Z14')
    expect(z01.find((rule) => rule.fieldNumber === '311')?.requirement).toBe('required')
    expect(z01.find((rule) => rule.fieldNumber === '313')?.requirement).toBe('optional')
    expect(z13.find((rule) => rule.fieldNumber === '506')?.requirement).toBe('required')
    expect(z13.find((rule) => rule.fieldNumber === '261')?.requirement).toBe('required')
    expect(z14.find((rule) => rule.fieldNumber === '322')?.requirement).toBe('required')
  })
})
