// lib/ediel/classify.ts

import type {
  EdielMessageFamily,
  EdielKnownMessageCode,
} from '@/lib/ediel/types'

const PRODAT_CODES = new Set([
  'Z01',
  'Z02',
  'Z03',
  'Z04',
  'Z05',
  'Z06',
  'Z09',
  'Z10',
  'Z13',
  'Z14',
  'Z15',
  'Z18',
])

const UTILTS_CODES = new Set(['S01', 'S02', 'S03', 'S04', 'E31', 'E66'])

function normalize(value?: string | null): string {
  return (value ?? '').trim().toUpperCase()
}

export function inferEdielFamilyFromCode(
  code?: string | null
): EdielMessageFamily | null {
  const normalized = normalize(code)

  if (!normalized) return null
  if (normalized === 'APERAK') return 'APERAK'
  if (normalized === 'CONTRL') return 'CONTRL'
  if (normalized === 'UTILTS_ERR' || normalized === 'UTILTSERR') {
    return 'UTILTS_ERR'
  }
  if (PRODAT_CODES.has(normalized)) return 'PRODAT'
  if (UTILTS_CODES.has(normalized)) return 'UTILTS'

  return null
}

export function inferEdielFamilyAndCodeFromRawPayload(rawPayload?: string | null): {
  messageFamily: EdielMessageFamily | null
  messageCode: EdielKnownMessageCode | null
} {
  const raw = rawPayload ?? ''
  const upper = raw.toUpperCase()

  if (!upper.trim()) {
    return {
      messageFamily: null,
      messageCode: null,
    }
  }

  if (upper.includes('APERAK')) {
    return {
      messageFamily: 'APERAK',
      messageCode: 'APERAK',
    }
  }

  if (upper.includes('CONTRL')) {
    return {
      messageFamily: 'CONTRL',
      messageCode: 'CONTRL',
    }
  }

  if (upper.includes('UTILTS-ERR') || upper.includes('UTILTS_ERR')) {
    return {
      messageFamily: 'UTILTS_ERR',
      messageCode: 'UTILTS_ERR',
    }
  }

  const messageFunctionMatch = upper.match(/\b(Z0[1-9]|Z1[0-8]|S0[1-4]|E31|E66)\b/)
  const matchedCode = messageFunctionMatch?.[1] ?? null
  const family = inferEdielFamilyFromCode(matchedCode)

  return {
    messageFamily: family,
    messageCode: matchedCode,
  }
}

export function inferEdielFileName(input: {
  family?: string | null
  code?: string | null
  direction?: 'inbound' | 'outbound' | null
  extension?: string | null
}): string {
  const family = normalize(input.family ?? 'EDIEL')
  const code = normalize(input.code ?? 'MSG')
  const direction = normalize(input.direction ?? 'OUT')
  const extension = (input.extension ?? 'edi').replace(/^\./, '') || 'edi'

  return `${family}_${code}_${direction}_${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '')}.${extension}`
}