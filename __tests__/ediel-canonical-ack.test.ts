import { describe, expect, it } from 'vitest'
import { resolveCanonicalAckMatrixRule } from '@/lib/ediel/ack/canonicalAckEngine'

describe('canonical ACK matrix', () => {
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
})
