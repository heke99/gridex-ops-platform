import { describe, expect, it } from 'vitest'
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
