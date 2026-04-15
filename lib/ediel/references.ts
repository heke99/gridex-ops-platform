// lib/ediel/references.ts

import type { EdielMessageFamily, EdielKnownMessageCode } from '@/lib/ediel/types'

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
  family: EdielMessageFamily
  code: EdielKnownMessageCode
  prefix?: string | null
}): string {
  const prefix = compact(input.prefix ?? 'GRX')
  const family = compact(input.family).slice(0, 8)
  const code = compact(input.code).slice(0, 12)

  return `${prefix}-${family}-${code}-${timestampPart()}-${randomPart(5)}`
}

export function buildEdielExternalReference(input: {
  family: EdielMessageFamily
  code: EdielKnownMessageCode
  switchRequestId?: string | null
  gridOwnerDataRequestId?: string | null
  outboundRequestId?: string | null
}): string {
  const family = compact(input.family).slice(0, 8)
  const code = compact(input.code).slice(0, 8)
  const subject =
    compact(input.switchRequestId ?? '') ||
    compact(input.gridOwnerDataRequestId ?? '') ||
    compact(input.outboundRequestId ?? '') ||
    'GEN'

  return `${family}-${code}-${subject.slice(0, 10)}-${randomPart(6)}`
}

export function buildSupplierApplicationReference(): string {
  return '23-DDQ-PRODAT'
}

export function shouldRequireAperak(
  family: EdielMessageFamily,
  code: EdielKnownMessageCode
): boolean {
  if (family === 'PRODAT') return true
  if (family === 'UTILTS') return true
  if (family === 'APERAK') return false
  if (family === 'CONTRL') return false
  if (family === 'UTILTS_ERR') return false

  return code !== 'CONTRL'
}

export function shouldRequireContrl(
  family: EdielMessageFamily,
  code: EdielKnownMessageCode
): boolean {
  if (family === 'CONTRL') return false
  if (family === 'UTILTS_ERR') return true
  if (family === 'APERAK') return true

  return code !== 'CONTRL'
}

export function deriveEdielAckDefaults(input: {
  family: EdielMessageFamily
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
      input.family === 'UTILTS' ? ('pending' as const) : ('not_required' as const),
  }
}