// lib/ediel/references.ts

type BuildReferenceInput = {
  family: string
  code: string
  relatedMessageId?: string | null
  switchRequestId?: string | null
  gridOwnerDataRequestId?: string | null
  outboundRequestId?: string | null
  partnerExportId?: string | null
}

function trimOrNull(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function compactToken(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 12)
}

function randomToken(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''
  for (let i = 0; i < length; i += 1) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

function shortContextId(input: BuildReferenceInput): string | null {
  const candidates = [
    input.relatedMessageId,
    input.switchRequestId,
    input.gridOwnerDataRequestId,
    input.outboundRequestId,
    input.partnerExportId,
  ]

  for (const value of candidates) {
    const clean = trimOrNull(value)
    if (!clean) continue

    const normalized = clean.replace(/-/g, '').toUpperCase()
    const shortened = normalized.slice(0, 10)
    if (shortened) return shortened
  }

  return null
}

function utcTimestampToken(date = new Date()): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  const seconds = String(date.getUTCSeconds()).padStart(2, '0')
  return `${year}${month}${day}${hours}${minutes}${seconds}`
}

export function normalizeEdielReference(value?: string | null): string | null {
  return trimOrNull(value)
}

export function normalizeInterchangeReference(value?: string | null): string | null {
  const normalized = trimOrNull(value)
  return normalized ? normalized.slice(0, 35) : null
}

export function buildEdielExternalReference(input: BuildReferenceInput): string {
  const family = compactToken(input.family)
  const code = compactToken(input.code)
  const contextId = shortContextId(input)
  const timestamp = utcTimestampToken().slice(2)
  const suffix = randomToken(4)

  if (contextId) {
    return `${family}-${code}-${contextId}-${timestamp}-${suffix}`.slice(0, 70)
  }

  return `${family}-${code}-${timestamp}-${suffix}`.slice(0, 70)
}

export function buildEdielTransactionReference(input: BuildReferenceInput): string {
  const family = compactToken(input.family)
  const code = compactToken(input.code)
  const contextId = shortContextId(input)
  const timestamp = utcTimestampToken()
  const suffix = randomToken(6)

  if (contextId) {
    return `${family}${code}${contextId}${timestamp}${suffix}`.slice(0, 35)
  }

  return `${family}${code}${timestamp}${suffix}`.slice(0, 35)
}

export function buildEdielInterchangeReference(params?: {
  senderEdielId?: string | null
  receiverEdielId?: string | null
}) {
  const sender = compactToken(params?.senderEdielId ?? 'GRIDEX')
  const receiver = compactToken(params?.receiverEdielId ?? 'EDIEL')
  const timestamp = utcTimestampToken()
  const suffix = randomToken(5)
  return `${sender}${receiver}${timestamp}${suffix}`.slice(0, 35)
}

export function deriveEdielAckDefaults(params: {
  family: string
  code: string
}): {
  requiresContrl: boolean
  requiresAperak: boolean
  contrlStatus: 'pending' | 'not_required'
  aperakStatus: 'pending' | 'not_required'
  utiltsErrStatus: 'not_required'
} {
  const family = params.family.toUpperCase()
  const code = params.code.toUpperCase()

  if (family === 'AI_LIST') {
    return {
      requiresContrl: false,
      requiresAperak: false,
      contrlStatus: 'not_required',
      aperakStatus: 'not_required',
      utiltsErrStatus: 'not_required',
    }
  }

  if (family === 'CONTRL' || family === 'APERAK' || family === 'UTILTS_ERR') {
    return {
      requiresContrl: false,
      requiresAperak: false,
      contrlStatus: 'not_required',
      aperakStatus: 'not_required',
      utiltsErrStatus: 'not_required',
    }
  }

  if (family === 'UTILTS') {
    return {
      requiresContrl: true,
      requiresAperak:
        code === 'E66' ||
        code === 'E73' ||
        code === 'S01' ||
        code === 'S02' ||
        code === 'S03' ||
        code === 'S04',
      contrlStatus: 'pending',
      aperakStatus:
        code === 'E66' ||
        code === 'E73' ||
        code === 'S01' ||
        code === 'S02' ||
        code === 'S03' ||
        code === 'S04'
          ? 'pending'
          : 'not_required',
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

  return {
    requiresContrl: true,
    requiresAperak: false,
    contrlStatus: 'pending',
    aperakStatus: 'not_required',
    utiltsErrStatus: 'not_required',
  }
}
