// lib/ediel/references.ts

import type {
  EdielMessageFamily,
  EdielKnownMessageCode,
} from '@/lib/ediel/types'

function compact(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

function timestampPart(date: Date = new Date()): string {
  return date
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14)
}

function randomPart(length = 6): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''

  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }

  return out
}

export function buildEdielCorrelationReference(input?: {
  prefix?: string | null
  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
}): string {
  const base = compact(input?.prefix ?? 'GRIDEX')
  const subject =
    compact(input?.meteringPointId ?? '') ||
    compact(input?.siteId ?? '') ||
    compact(input?.customerId ?? '') ||
    'GEN'

  return `${base}-${subject.slice(0, 12)}-${timestampPart()}-${randomPart(4)}`
}

export function buildEdielTransactionReference(input: {
  family: EdielMessageFamily | string
  code: EdielKnownMessageCode
  prefix?: string | null
}): string {
  const prefix = compact(input.prefix ?? 'GRX')
  const family = compact(String(input.family)).slice(0, 10)
  const code = compact(String(input.code)).slice(0, 12)

  return `${prefix}-${family}-${code}-${timestampPart()}-${randomPart(5)}`
}

export function buildEdielExternalReference(input: {
  family: EdielMessageFamily | string
  code: EdielKnownMessageCode
  switchRequestId?: string | null
  gridOwnerDataRequestId?: string | null
  outboundRequestId?: string | null
}): string {
  const family = compact(String(input.family)).slice(0, 10)
  const code = compact(String(input.code)).slice(0, 10)
  const subject =
    compact(input.switchRequestId ?? '') ||
    compact(input.gridOwnerDataRequestId ?? '') ||
    compact(input.outboundRequestId ?? '') ||
    'GEN'

  return `${family}-${code}-${subject.slice(0, 10)}-${randomPart(6)}`
}

export function buildEdielInterchangeReference(input?: {
  senderEdielId?: string | null
  receiverEdielId?: string | null
}): string {
  const sender = compact(input?.senderEdielId ?? '00000').slice(0, 5) || '00000'
  const receiver =
    compact(input?.receiverEdielId ?? '00000').slice(0, 5) || '00000'

  return `${sender}${receiver}${timestampPart().slice(2, 12)}${randomPart(4)}`
}

export function buildAperakTransactionReference(): string {
  return `APE${timestampPart().slice(2)}${randomPart(4)}`
}

export function buildSupplierApplicationReference(): string {
  return '23-DDQ-PRODAT'
}

export function shouldRequireAperak(
  family: EdielMessageFamily | string,
  code: EdielKnownMessageCode
): boolean {
  const resolvedFamily = String(family).toUpperCase()
  const resolvedCode = String(code).toUpperCase()

  if (resolvedFamily === 'PRODAT') return true
  if (resolvedFamily === 'UTILTS') return true
  if (resolvedFamily === 'AI_LIST') return false
  if (resolvedFamily === 'NBS_XML') return false
  if (resolvedFamily === 'APERAK') return false
  if (resolvedFamily === 'CONTRL') return false
  if (resolvedFamily === 'UTILTS_ERR') return false

  return resolvedCode !== 'CONTRL'
}

export function shouldRequireContrl(
  family: EdielMessageFamily | string,
  code: EdielKnownMessageCode
): boolean {
  const resolvedFamily = String(family).toUpperCase()
  const resolvedCode = String(code).toUpperCase()

  if (resolvedFamily === 'CONTRL') return false
  if (resolvedFamily === 'AI_LIST') return false
  if (resolvedFamily === 'NBS_XML') return false
  if (resolvedFamily === 'UTILTS_ERR') return true
  if (resolvedFamily === 'APERAK') return true

  return resolvedCode !== 'CONTRL'
}

export function deriveEdielAckDefaults(input: {
  family: EdielMessageFamily | string
  code: EdielKnownMessageCode
}) {
  const requiresContrl = shouldRequireContrl(input.family, input.code)
  const requiresAperak = shouldRequireAperak(input.family, input.code)

  return {
    requiresContrl,
    requiresAperak,
    contrlStatus: requiresContrl ? ('pending' as const) : ('not_required' as const),
    aperakStatus: requiresAperak ? ('pending' as const) : ('not_required' as const),
    utiltsErrStatus:
      String(input.family).toUpperCase() === 'UTILTS'
        ? ('pending' as const)
        : ('not_required' as const),
  }
}