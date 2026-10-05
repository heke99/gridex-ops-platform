import { describe, expect, it, vi } from 'vitest'

import { fieldRulesForMessage, validateFieldMatrixPayload } from '@/lib/ediel/rulebook/fieldMatrix'
import { normalizeRegistryRequirement } from '@/lib/ediel/rulebook/fieldRuleRegistry'

const PLANNING_MATRIX = {
  S02: {
    '505': 'required', '209': 'required', '260a': 'required', '262': 'forbidden',
    '510': 'forbidden', '506': 'required', '511': 'forbidden', '245': 'required',
    '532': 'required', '508': 'required', '223': 'required', '264': 'required',
    '226': 'optional', '254': 'forbidden', '513': 'forbidden', '507a': 'forbidden',
    '514': 'required', '515': 'required', '520': 'dependent', '507b': 'forbidden',
  },
  S03: {
    '505': 'required', '209': 'forbidden', '260a': 'required', '262': 'dependent',
    '510': 'dependent', '506': 'required', '511': 'required', '245': 'required',
    '532': 'required', '508': 'required', '223': 'required', '264': 'required',
    '226': 'forbidden', '254': 'required', '513': 'required', '507a': 'dependent',
    '514': 'required', '515': 'required', '520': 'forbidden', '507b': 'dependent',
  },
  S04: {
    '505': 'required', '209': 'forbidden', '260a': 'required', '262': 'dependent',
    '510': 'forbidden', '506': 'required', '511': 'required', '245': 'required',
    '532': 'required', '508': 'required', '223': 'required', '264': 'required',
    '226': 'forbidden', '254': 'forbidden', '513': 'forbidden', '507a': 'forbidden',
    '514': 'required', '515': 'required', '520': 'forbidden', '507b': 'forbidden',
  },
} as const

const HEADER_FIELDS = ['311', '312', '202', '203', '204', '313', '205', '206', '501', '502', '207', '208', '509']

describe('UTILTS 25-A-3 canonical field registry', () => {
  it('keeps the published base requirement in the first current-guide policy after an attempted change', async () => {
    vi.resetModules()
    const { UTILTS_25_A_3_FIELD_RULES } = await import('@/lib/ediel/rulebook/utiltsFieldMatrix')
    const { resolveCanonicalEdielPolicy } = await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
    const row = UTILTS_25_A_3_FIELD_RULES.find((candidate) => candidate.ruleKey === '311_application_reference')!
    const changed = Reflect.set(row.requirements, 'E73', 'X')
    try {
      const policy = resolveCanonicalEdielPolicy({
        family: 'UTILTS', messageCode: 'E73', direction: 'outbound', referenceDate: '2026-10-15',
        applicationReference: '23-DDQ-E66-S', mode: 'catalog_evidence',
      })
      expect(policy.guide.guideRevision).toBe('25-A-4')
      const selected = policy.fieldRules.find((rule) => 'ruleKey' in rule && rule.ruleKey === '311_application_reference')
      expect(selected && 'requirements' in selected ? selected.requirements.E73 : null).toBe('R')
      expect(changed).toBe(false)
    } finally {
      // A broken source can be frozen by the first policy; discard that isolated graph.
      vi.resetModules()
    }
  })

  it('keeps the source field selected after an attempted published row replacement', async () => {
    vi.resetModules()
    const { UTILTS_25_A_3_FIELD_RULES, getUtiltsFieldRequirement } = await import('@/lib/ediel/rulebook/utiltsFieldMatrix')
    const original = UTILTS_25_A_3_FIELD_RULES[0]
    const changed = Reflect.set(UTILTS_25_A_3_FIELD_RULES, '0', { ...original, fieldNo: '999' })
    try {
      expect(getUtiltsFieldRequirement('E73', '311')).toBe('R')
      expect(changed).toBe(false)
    } finally {
      if (changed) Reflect.set(UTILTS_25_A_3_FIELD_RULES, '0', original)
      vi.resetModules()
    }
  })

  it('keeps the published source locator after an attempted row-metadata change', async () => {
    vi.resetModules()
    const { UTILTS_25_A_3_FIELD_RULES, getUtiltsFieldRules } = await import('@/lib/ediel/rulebook/utiltsFieldMatrix')
    const row = UTILTS_25_A_3_FIELD_RULES.find((candidate) => candidate.ruleKey === '311_application_reference')!
    const original = row.segmentPath
    const changed = Reflect.set(row, 'segmentPath', 'NAD+UD')
    try {
      expect(getUtiltsFieldRules('E73').find((rule) => rule.ruleKey === '311_application_reference')?.segmentPath).toBe('UNB/0026')
      expect(changed).toBe(false)
    } finally {
      if (changed) Reflect.set(row, 'segmentPath', original)
      vi.resetModules()
    }
  })

  it('maps the exact R/D/O/X classifications from the database registry', () => {
    expect(['R', 'D', 'O', 'X'].map(normalizeRegistryRequirement)).toEqual([
      'required', 'dependent', 'optional', 'forbidden',
    ])
  })

  it.each(Object.entries(PLANNING_MATRIX))('implements the exact %s planning matrix', (code, expected) => {
    const planningRules = fieldRulesForMessage('UTILTS', code)
      .filter((rule) => rule.scope === 'transaction')
    const actual = Object.fromEntries(planningRules.map((rule) => [rule.fieldNumber, rule.requirement]))

    expect(actual).toEqual(expected)
    expect(planningRules).toHaveLength(20)
  })

  it.each(['S02', 'S03', 'S04'])('uses the exact common header for %s', (code) => {
    const headerRules = fieldRulesForMessage('UTILTS', code)
      .filter((rule) => rule.scope === 'header')

    expect(headerRules.map((rule) => rule.fieldNumber)).toEqual(HEADER_FIELDS)
    expect(headerRules.every((rule) => rule.requirement === 'required')).toBe(true)
    expect(headerRules.find((rule) => rule.fieldNumber === '312')?.allowedValues).toEqual(['E5SE5A'])
    expect(headerRules.find((rule) => rule.fieldNumber === '204')?.allowedValues).toEqual(['5', '9'])
    expect(headerRules.find((rule) => rule.fieldNumber === '313')?.allowedValues).toEqual(['AB', 'NA'])
    expect(headerRules.find((rule) => rule.fieldNumber === '501')?.allowedValues).toEqual(['23', '27'])
    expect(headerRules.find((rule) => rule.fieldNumber === '502')?.allowedValues).toEqual(['E02', 'E03', 'E04'])
  })

  it('validates header values at their exact EDIFACT element paths', () => {
    const headerRules = fieldRulesForMessage('UTILTS', 'S02').filter((rule) => rule.scope === 'header')
    const validSegments = [
      'UNB+UNOC:3+SENDER+RECEIVER+260813:1200+INTREF++23-DDQ-S02-S',
      'UNH+MSG1+UTILTS:D:02B:UN:E5SE5A',
      'BGM+S02+DOC1+9+AB',
      'DTM+137:202608131200:203', 'DTM+735:+0100:406', 'MKS+23+E02::260',
      'NAD+MS+SENDER:SVK:260', 'NAD+MR+RECEIVER:SVK:260', 'NAD+DDQ+SUPPLIER:SVK:260',
    ]

    expect(validateFieldMatrixPayload({
      family: 'UTILTS', code: 'S02', rawSegments: validSegments,
      applicationReference: '23-DDQ-S02-S', mode: 'parse',
    }, headerRules)).toEqual([])

    const invalidAssociation = validSegments.map((segment) =>
      segment.startsWith('UNH+') ? 'UNH+MSG1+UTILTS:D:02B:UN:WRONG' : segment
    )
    expect(validateFieldMatrixPayload({
      family: 'UTILTS', code: 'S02', rawSegments: invalidAssociation,
      applicationReference: '23-DDQ-S02-S', mode: 'parse',
    }, headerRules).map((issue) => issue.code)).toContain('UTILTS_ASSOCIATION_INVALID')
  })
})
