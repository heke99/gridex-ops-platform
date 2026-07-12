import type { AckFamily } from '@/lib/ediel/core/ackPolicy'

export type CanonicalAckMatrixRule = {
  family: string
  code: string | '*'
  technicalAck: 'CONTRL' | 'none'
  applicationAck: 'APERAK' | 'transactional' | 'none'
  businessResponses: readonly string[]
  negativeApplicationResponse: 'APERAK' | 'UTILTS_ERR' | 'APERAK_OR_UTILTS_ERR' | 'none'
  acknowledgeIncomingMessageWith: readonly AckFamily[]
}

const ACK_MATRIX: readonly CanonicalAckMatrixRule[] = [
  {
    family: 'CONTRL',
    code: '*',
    technicalAck: 'none',
    applicationAck: 'none',
    businessResponses: [],
    negativeApplicationResponse: 'none',
    acknowledgeIncomingMessageWith: [],
  },
  {
    family: 'APERAK',
    code: '*',
    technicalAck: 'CONTRL',
    applicationAck: 'none',
    businessResponses: [],
    negativeApplicationResponse: 'none',
    acknowledgeIncomingMessageWith: ['CONTRL'],
  },
  {
    family: 'UTILTS_ERR',
    code: '*',
    technicalAck: 'CONTRL',
    applicationAck: 'APERAK',
    businessResponses: [],
    negativeApplicationResponse: 'APERAK',
    acknowledgeIncomingMessageWith: ['CONTRL', 'APERAK'],
  },
  {
    family: 'PRODAT',
    code: 'Z01',
    technicalAck: 'CONTRL',
    applicationAck: 'none',
    businessResponses: ['Z02'],
    negativeApplicationResponse: 'APERAK',
    acknowledgeIncomingMessageWith: ['CONTRL'],
  },
  {
    family: 'PRODAT',
    code: '*',
    technicalAck: 'CONTRL',
    applicationAck: 'APERAK',
    businessResponses: [],
    negativeApplicationResponse: 'APERAK',
    acknowledgeIncomingMessageWith: ['CONTRL', 'APERAK'],
  },
  {
    family: 'UTILTS',
    code: '*',
    technicalAck: 'CONTRL',
    applicationAck: 'transactional',
    businessResponses: [],
    negativeApplicationResponse: 'APERAK_OR_UTILTS_ERR',
    acknowledgeIncomingMessageWith: ['CONTRL', 'APERAK', 'UTILTS_ERR'],
  },
] as const

function normalize(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace('-', '_')
}

export function resolveCanonicalAckMatrixRule(input: {
  family: string | null | undefined
  code?: string | null
}): CanonicalAckMatrixRule {
  const family = normalize(input.family)
  const code = normalize(input.code)
  return ACK_MATRIX.find((rule) => rule.family === family && rule.code === code)
    ?? ACK_MATRIX.find((rule) => rule.family === family && rule.code === '*')
    ?? {
      family,
      code: code || '*',
      technicalAck: 'CONTRL',
      applicationAck: 'none',
      businessResponses: [],
      negativeApplicationResponse: 'none',
      acknowledgeIncomingMessageWith: ['CONTRL'],
    }
}

export function canonicalAckRequirements(input: {
  family: string | null | undefined
  code?: string | null
}): {
  requiresContrl: boolean
  requiresAperak: boolean
  supportsNegativeAperak: boolean
  supportsUtiltsErr: boolean
  businessResponses: readonly string[]
} {
  const rule = resolveCanonicalAckMatrixRule(input)
  return {
    requiresContrl: rule.technicalAck === 'CONTRL',
    requiresAperak: rule.applicationAck === 'APERAK' || rule.applicationAck === 'transactional',
    supportsNegativeAperak: rule.negativeApplicationResponse === 'APERAK' || rule.negativeApplicationResponse === 'APERAK_OR_UTILTS_ERR',
    supportsUtiltsErr: rule.negativeApplicationResponse === 'UTILTS_ERR' || rule.negativeApplicationResponse === 'APERAK_OR_UTILTS_ERR',
    businessResponses: rule.businessResponses,
  }
}

export function listCanonicalAckMatrix(): readonly CanonicalAckMatrixRule[] {
  return ACK_MATRIX
}
