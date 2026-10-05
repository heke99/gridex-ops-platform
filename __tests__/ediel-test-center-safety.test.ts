import { describe, expect, it } from 'vitest'
import {
  EDIEL_TEST_CENTER_ALLOWED_ENVIRONMENT_TYPES,
  resolveEdielTestCenterIsolation,
} from '@/lib/ediel/testing/testCenterSafety'

describe('Ediel Test Center production isolation', () => {
  it.each(EDIEL_TEST_CENTER_ALLOWED_ENVIRONMENT_TYPES)(
    'keeps %s in the test environment',
    (environmentType) => {
      const resolved = resolveEdielTestCenterIsolation({
        environmentType,
        productionLike: true,
      })

      expect(resolved).toEqual({
        environment: 'test',
        environmentType,
        productionLike: true,
        externalSideEffectsAllowed: false,
      })
    },
  )

  it('fails closed when production is requested', () => {
    expect(() =>
      resolveEdielTestCenterIsolation({ environmentType: 'production' }),
    ).toThrow(/aldrig köras mot produktionsmiljö/i)
  })

  it('fails closed for unknown environment types', () => {
    expect(() =>
      resolveEdielTestCenterIsolation({ environmentType: 'sandbox-ish' }),
    ).toThrow(/ogiltig test center-miljö/i)
  })

  it('defaults to AGT test without enabling production-like mode', () => {
    expect(resolveEdielTestCenterIsolation({})).toEqual({
      environment: 'test',
      environmentType: 'agt_test',
      productionLike: false,
      externalSideEffectsAllowed: false,
    })
  })
})
