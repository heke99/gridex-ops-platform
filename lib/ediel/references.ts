// lib/ediel/references.ts

import type { EdielAckStatus } from '@/lib/ediel/types'

type ReferenceFamily =
  | 'PRODAT'
  | 'UTILTS'
  | 'APERAK'
  | 'CONTRL'
  | 'UTILTS_ERR'
  | 'AI_LIST'

function compactNow(): string {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(2, 14)
}

function shortId(value?: string | null): string {
  if (!value) return 'NONE'
  return value.replace(/-/g, '').slice(0, 12).toUpperCase()
}

export function buildEdielExternalReference(params: {
  family: ReferenceFamily
  code: string
  switchRequestId?: string | null
  gridOwnerDataRequestId?: string | null
  outboundRequestId?: string | null
  relatedMessageId?: string | null
}): string {
  const family = params.family
  const code = params.code.replace(/[^A-Za-z0-9_]/g, '').toUpperCase()
  const refSource =
    params.switchRequestId ??
    params.gridOwnerDataRequestId ??
    params.outboundRequestId ??
    params.relatedMessageId ??
    'GEN'

  return `${family}-${code}-${shortId(refSource)}-${compactNow()}`
}

export function buildEdielTransactionReference(params: {
  family: ReferenceFamily
  code: string
}): string {
  const family = params.family.replace(/[^A-Za-z0-9_]/g, '').toUpperCase()
  const code = params.code.replace(/[^A-Za-z0-9_]/g, '').toUpperCase()
  return `TX-${family}-${code}-${compactNow()}`
}

export function deriveEdielAckDefaults(params: {
  family: ReferenceFamily
  code: string
}): {
  requiresContrl: boolean
  requiresAperak: boolean
  contrlStatus: EdielAckStatus
  aperakStatus: EdielAckStatus
  utiltsErrStatus: EdielAckStatus
} {
  const family = params.family
  const code = params.code.toUpperCase()

  if (family === 'CONTRL' || family === 'APERAK' || family === 'UTILTS_ERR') {
    return {
      requiresContrl: false,
      requiresAperak: false,
      contrlStatus: 'not_required',
      aperakStatus: 'not_required',
      utiltsErrStatus: 'not_required',
    }
  }

  if (family === 'AI_LIST') {
    return {
      requiresContrl: false,
      requiresAperak: false,
      contrlStatus: 'not_required',
      aperakStatus: 'not_required',
      utiltsErrStatus: 'not_required',
    }
  }

  if (family === 'PRODAT') {
    return {
      requiresContrl: true,
      requiresAperak: true,
      contrlStatus: 'pending',
      aperakStatus: 'pending',
      utiltsErrStatus: 'not_required',
    }
  }

  if (family === 'UTILTS') {
    if (code === 'E66' || code === 'E73' || code === 'E31' || code === 'S02' || code === 'S03') {
      return {
        requiresContrl: true,
        requiresAperak: true,
        contrlStatus: 'pending',
        aperakStatus: 'pending',
        utiltsErrStatus: 'not_required',
      }
    }

    return {
      requiresContrl: true,
      requiresAperak: false,
      contrlStatus: 'pending',
      aperakStatus: 'not_required',
      utiltsErrStatus: 'not_required',
    }
  }

  return {
    requiresContrl: true,
    requiresAperak: false,
    contrlStatus: 'pending',
    aperakStatus: 'not_required',
    utiltsErrStatus: 'not_required',
  }
}