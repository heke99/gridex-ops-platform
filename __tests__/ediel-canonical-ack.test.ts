import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { resolveCanonicalAckMatrixRule } from '@/lib/ediel/ack/canonicalAckEngine'
import { classifyCanonicalInboundAck } from '@/lib/ediel/ack/inboundAckOutcome'

function aperak(input: {
  release: '96A' | '04A'
  association: 'E2SE6A' | 'E5SE5A'
  applicationReference: string
  messageCode: string | null
  messageFunctionCode: string | null
  errorCodes: string[]
}) {
  return classifyCanonicalInboundAck({
    messageFamily: 'APERAK',
    messageCode: input.messageCode,
    messageFunctionCode: input.messageFunctionCode,
    applicationReference: input.applicationReference,
    messageTypeVersion: {
      syntaxIdentifier: 'APERAK',
      directoryVersion: 'D',
      release: input.release,
      controllingAgency: 'UN',
      associationAssignedCode: input.association,
    },
    errorCodes: input.errorCodes,
    references: {},
  })
}

describe('canonical ACK matrix', () => {
  it('keeps actual pending CONTRL defaults after an attempted published Z01 rule change', async () => {
    vi.resetModules()
    const { resolveCanonicalAckMatrixRule } = await import('@/lib/ediel/ack/canonicalAckEngine')
    const { deriveEdielAckDefaults } = await import('@/lib/ediel/core/ackPolicy')
    const input = { family: 'PRODAT', code: 'Z01' }
    const source = resolveCanonicalAckMatrixRule(input)
    const changed = Reflect.set(source, 'technicalAck', 'none')
    try {
      expect(deriveEdielAckDefaults(input)).toMatchObject({ requiresContrl: true, contrlStatus: 'pending' })
      expect(changed).toBe(false)
    } finally {
      if (changed) Reflect.set(source, 'technicalAck', 'CONTRL')
      vi.resetModules()
    }
  })

  it('retains the published Z02 business response in the actual canonical requirement projection', async () => {
    vi.resetModules()
    const { resolveCanonicalAckMatrixRule } = await import('@/lib/ediel/ack/canonicalAckEngine')
    const { canonicalAckRequirementsForFamilyCode } = await import('@/lib/ediel/rulebook/canonicalEdielFacade')
    const input = { family: 'PRODAT', code: 'Z01' }
    const source = resolveCanonicalAckMatrixRule(input).businessResponses
    const changed = Reflect.set(source, '0', 'Z99')
    try {
      expect(canonicalAckRequirementsForFamilyCode(input).businessResponses).toEqual(['Z02'])
      expect(changed).toBe(false)
    } finally {
      if (changed) Reflect.set(source, '0', 'Z02')
      vi.resetModules()
    }
  })

  it('retains the published acknowledgement chain after an attempted nested array change', async () => {
    vi.resetModules()
    const { resolveCanonicalAckMatrixRule } = await import('@/lib/ediel/ack/canonicalAckEngine')
    const { canonicalAckRuleForFamilyCode } = await import('@/lib/ediel/rulebook/canonicalEdielFacade')
    const input = { family: 'UTILTS_ERR', code: 'ERR' }
    const source = resolveCanonicalAckMatrixRule(input).acknowledgeIncomingMessageWith
    const changed = Reflect.set(source, '0', 'UTILTS_ERR')
    try {
      expect(canonicalAckRuleForFamilyCode(input).acknowledgeIncomingMessageWith).toEqual(['CONTRL', 'APERAK'])
      expect(changed).toBe(false)
    } finally {
      if (changed) Reflect.set(source, '0', 'CONTRL')
      vi.resetModules()
    }
  })

  it('holds an unsupported family after an attempted published matrix row replacement', async () => {
    vi.resetModules()
    const { listCanonicalAckMatrix } = await import('@/lib/ediel/ack/canonicalAckEngine')
    const { deriveEdielAckDefaults } = await import('@/lib/ediel/core/ackPolicy')
    const matrix = listCanonicalAckMatrix()
    const original = matrix[0]
    const changed = Reflect.set(matrix, '0', { ...original, family: 'UNQUALIFIED', technicalAck: 'CONTRL' })
    try {
      expect(() => deriveEdielAckDefaults({ family: 'UNQUALIFIED', code: original.code })).toThrow('ediel_ack_family_unsupported')
      expect(changed).toBe(false)
    } finally {
      if (changed) Reflect.set(matrix, '0', original)
      vi.resetModules()
    }
  })

  it.each([
    ['CONTRL', null, []],
    ['APERAK', null, ['CONTRL']],
    ['UTILTS_ERR', null, ['CONTRL', 'APERAK']],
    ['PRODAT', 'Z01', ['CONTRL']],
    ['PRODAT', 'Z04', ['CONTRL', 'APERAK']],
    ['UTILTS', 'E66', ['CONTRL', 'APERAK', 'UTILTS_ERR']],
  ])('%s/%s uses the required acknowledgement chain', (family, code, expected) => {
    expect(resolveCanonicalAckMatrixRule({ family, code }).acknowledgeIncomingMessageWith).toEqual(expected)
  })

  it('keeps Z02 as the Z01 business response and negative APERAK as failure response', () => {
    const rule = resolveCanonicalAckMatrixRule({ family: 'PRODAT', code: 'Z01' })
    expect(rule.businessResponses).toEqual(['Z02'])
    expect(rule.negativeApplicationResponse).toBe('APERAK')
  })

  it('classifies PRODAT 16.B APERAK from BGM function 34 and ERC, never UTILTS 312/313', () => {
    expect(aperak({
      release: '96A', association: 'E2SE6A', applicationReference: '23-DDQ-PRODAT',
      messageCode: null, messageFunctionCode: '34', errorCodes: ['100'],
    })).toMatchObject({ profile: 'PRODAT_16_B', outcome: 'positive', code: '100' })

    expect(aperak({
      release: '96A', association: 'E2SE6A', applicationReference: '23-DGI-PRODAT',
      messageCode: null, messageFunctionCode: '34', errorCodes: ['100', '41', '42'],
    })).toMatchObject({ profile: 'PRODAT_16_B', outcome: 'negative', code: '100,41,42' })

    expect(aperak({
      release: '96A', association: 'E2SE6A', applicationReference: '23-DDQ-PRODAT',
      messageCode: '312', messageFunctionCode: null, errorCodes: ['100'],
    })).toMatchObject({ profile: 'PRODAT_16_B', outcome: 'invalid', reason: 'prodat_aperak_bgm_function_invalid:missing' })
  })

  it('classifies a P-APERAK whole-message BGM27 as negative and holds contradictory ERC100', () => {
    const source = {
      release: '96A' as const, association: 'E2SE6A' as const,
      applicationReference: '23-DDQ-PRODAT', messageCode: null, messageFunctionCode: '27',
    }
    expect(aperak({ ...source, errorCodes: ['42'] }))
      .toMatchObject({ profile: 'PRODAT_16_B', outcome: 'negative', code: '42' })
    expect(aperak({ ...source, errorCodes: ['100'] }))
      .toMatchObject({ profile: 'PRODAT_16_B', outcome: 'invalid', reason: 'prodat_aperak_whole_message_result_conflict' })
  })

  it('keeps UTILTS APERAK 312/313 semantics isolated to D04A/E5SE5A', () => {
    expect(aperak({
      release: '04A', association: 'E5SE5A', applicationReference: '23-DDQ-E66-T',
      messageCode: '312', messageFunctionCode: '9', errorCodes: ['100'],
    })).toMatchObject({ profile: 'UTILTS_25_A', outcome: 'positive', code: '312' })

    expect(aperak({
      release: '04A', association: 'E5SE5A', applicationReference: '23-DDQ-E66-T',
      messageCode: '313', messageFunctionCode: '9', errorCodes: ['41'],
    })).toMatchObject({ profile: 'UTILTS_25_A', outcome: 'negative', code: '313' })
  })
})

// masterplan: GOV-01, AT-GOV-01
describe('published canonical error mappings', () => {
  it('retains the published object ERC in the first actual reason resolution after a row mutation attempt', async () => {
    vi.resetModules()
    const { CANONICAL_EDIEL_ERRORS, getCanonicalEdielError } = await import('@/lib/ediel/rulebook/mapEdielError')
    const { resolveUtiltsError } = await import('@/lib/ediel/utilts/utiltsErrorReason')
    const source = CANONICAL_EDIEL_ERRORS.find((row) => row.key === 'INCORRECT_METERING_POINT_ID')!
    expect(CANONICAL_EDIEL_ERRORS).toHaveLength(9)
    expect(getCanonicalEdielError('INCORRECT_METERING_POINT_ID')).toBe(source)
    const changed = Reflect.set(source, 'ercCode', '99')
    try {
      expect(resolveUtiltsError(['wrong_period', 'unknown_facility_or_metering_point'])).toMatchObject({
        reason: 'unknown_facility_or_metering_point',
        errorKey: 'INCORRECT_METERING_POINT_ID',
        error: { ercCode: '42', fieldCode: '209', family: 'APERAK', source: 'PRODAT object validation' },
      })
      expect(changed).toBe(false)
    } finally {
      if (changed) Reflect.set(source, 'ercCode', '42')
      vi.resetModules()
    }
  })

  it('retains the published grid mapping in the first actual reason mapping after a backing-array replacement attempt', async () => {
    vi.resetModules()
    const { CANONICAL_EDIEL_ERRORS } = await import('@/lib/ediel/rulebook/mapEdielError')
    const { mapUtiltsErrorReason } = await import('@/lib/ediel/utilts/utiltsErrorReason')
    const index = CANONICAL_EDIEL_ERRORS.findIndex((row) => row.key === 'INCORRECT_GRID_AREA_ID')
    const source = CANONICAL_EDIEL_ERRORS[index]
    const changed = Reflect.set(CANONICAL_EDIEL_ERRORS, String(index), { ...source, ercCode: '99' })
    try {
      expect(mapUtiltsErrorReason('wrong_grid_area')).toMatchObject({
        reason: 'wrong_grid_area',
        errorKey: 'INCORRECT_GRID_AREA_ID',
        error: { ercCode: '42', fieldCode: '260', family: 'APERAK', source: 'PRODAT object validation' },
      })
      expect(changed).toBe(false)
    } finally {
      if (changed) Reflect.set(CANONICAL_EDIEL_ERRORS, String(index), source)
      vi.resetModules()
    }
  })

  it('retains the published field, family and source through a getter alias before the first actual period mapping', async () => {
    vi.resetModules()
    const { getCanonicalEdielError } = await import('@/lib/ediel/rulebook/mapEdielError')
    const { mapUtiltsErrorReason } = await import('@/lib/ediel/utilts/utiltsErrorReason')
    const source = getCanonicalEdielError('UTILTS_E31_INCORRECT_DATA')
    const changedField = Reflect.set(source, 'fieldCode', '999')
    const changedFamily = Reflect.set(source, 'family', 'UTILTS_ERR')
    const changedSource = Reflect.set(source, 'source', 'Unqualified replacement')
    try {
      expect(mapUtiltsErrorReason('wrong_period')).toMatchObject({
        reason: 'wrong_period',
        errorKey: 'UTILTS_E31_INCORRECT_DATA',
        error: { ercCode: '41', fieldCode: '511a', family: 'APERAK', source: 'UTILTS E31 application validation' },
      })
      expect([changedField, changedFamily, changedSource]).toEqual([false, false, false])
    } finally {
      if (changedField) Reflect.set(source, 'fieldCode', '511a')
      if (changedFamily) Reflect.set(source, 'family', 'APERAK')
      if (changedSource) Reflect.set(source, 'source', 'UTILTS E31 application validation')
      vi.resetModules()
    }
  })
})
