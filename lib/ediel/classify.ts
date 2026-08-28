// lib/ediel/classify.ts

import type { EdielDirection, EdielMessageFamily } from '@/lib/ediel/types'
import { isActiveEdielMessageFamily } from '@/lib/ediel/types'
import { getCanonicalProdatProfile } from '@/lib/ediel/rulebook/prodatRulebook'
import { getCanonicalUtiltsProfile } from '@/lib/ediel/rulebook/utiltsRulebook'
import {
  extractCanonicalEdifactPayload,
  parseCanonicalEdifactAst,
} from '@/lib/ediel/core/canonicalEdifactAst'

export type InferredEdielPayload = {
  messageFamily: EdielMessageFamily | 'UNKNOWN'
  messageCode: string | null
  messageStandard: 'edifact' | 'xml' | 'ai_list' | 'unknown'
}

function normalizePayload(rawPayload: string): string {
  return rawPayload.replace(/\r\n/g, '\n').trim()
}

function upperPayload(rawPayload: string): string {
  return normalizePayload(rawPayload).toUpperCase()
}

function looksLikeXml(rawPayload: string): boolean {
  const trimmed = normalizePayload(rawPayload)
  return trimmed.startsWith('<?xml') || trimmed.startsWith('<')
}

function looksLikeCsvAiList(rawPayload: string): boolean {
  const trimmed = normalizePayload(rawPayload)
  if (!trimmed) return false

  const firstLine = trimmed.split('\n')[0] ?? ''
  const upper = firstLine.toUpperCase()
  if (!firstLine.includes(';')) return false

  return (
    upper.includes('ANLÄGG') ||
    upper.includes('ANLAGG') ||
    upper.includes('MÄTPUNKT') ||
    upper.includes('MATPUNKT') ||
    upper.includes('EDIEL') ||
    upper.includes('BALANS') ||
    upper.includes('NÄTOMRÅDE') ||
    upper.includes('NATOMRADE') ||
    upper.includes('AI;') ||
    upper.includes('BI;')
  )
}

function inferEdifactFamilyAndCode(rawPayload: string): {
  family: EdielMessageFamily | 'UNKNOWN'
  code: string | null
} {
  const extracted = extractCanonicalEdifactPayload(rawPayload) ?? rawPayload

  try {
    const ast = parseCanonicalEdifactAst(extracted)
    const message = ast.messages[0] ?? null
    const family = String(message?.family ?? '').toUpperCase().replace('-', '_')
    const code = String(message?.messageCode ?? '').toUpperCase() || null

    if (family === 'CONTRL') return { family: 'CONTRL', code: 'CONTRL' }
    if (family === 'APERAK') return { family: 'APERAK', code: 'APERAK' }
    if (family === 'UTILTS_ERR' || (family === 'UTILTS' && code === 'ERR')) {
      return { family: 'UTILTS_ERR', code: 'UTILTS_ERR' }
    }
    if (family === 'UTILTS') {
      return { family: 'UTILTS', code: code && getCanonicalUtiltsProfile(code) ? code : null }
    }
    if (family === 'PRODAT') {
      return { family: 'PRODAT', code: code && getCanonicalProdatProfile(code) ? code : null }
    }
    return { family: 'UNKNOWN', code: null }
  } catch {
    return { family: 'UNKNOWN', code: null }
  }
}

function inferXmlFamilyAndCode(rawPayload: string): {
  family: EdielMessageFamily | 'UNKNOWN'
  code: string | null
} {
  const upper = upperPayload(rawPayload)

  if (
    upper.includes('<MESSAGETYPE>SI-LIST</MESSAGETYPE>') ||
    upper.includes('<MESSAGENAME>SI-LIST</MESSAGENAME>')
  ) {
    return { family: 'OTHER', code: 'SI_LIST' }
  }

  if (
    upper.includes('ESETT') ||
    upper.includes('NBS') ||
    upper.includes('SVK_XML') ||
    upper.includes('URN:SVK-SE')
  ) {
    return { family: 'NBS_XML', code: 'NBS_XML' }
  }

  return { family: 'UNKNOWN', code: null }
}

export function extractEdifactPayloadFromText(rawText: string, subject?: string | null): string {
  for (const candidate of [rawText, subject ?? '']) {
    const extracted = extractCanonicalEdifactPayload(candidate)
    if (extracted) return extracted
  }
  return rawText.trim()
}

export function inferEdielFamilyAndCodeFromRawPayload(
  rawPayload: string
): InferredEdielPayload {
  const normalized = normalizePayload(rawPayload)

  if (!normalized) {
    return {
      messageFamily: 'UNKNOWN',
      messageCode: null,
      messageStandard: 'unknown',
    }
  }

  if (looksLikeCsvAiList(normalized)) {
    const upper = upperPayload(normalized)
    const listType =
      upper.includes('BI;') || upper.includes(';BI;') || upper.includes('BALANS')
        ? 'BI'
        : 'AI'

    return {
      messageFamily: 'AI_LIST',
      messageCode: listType,
      messageStandard: 'ai_list',
    }
  }

  if (looksLikeXml(normalized)) {
    const xml = inferXmlFamilyAndCode(normalized)
    return {
      messageFamily: xml.family,
      messageCode: xml.code,
      messageStandard: 'xml',
    }
  }

  const edifact = inferEdifactFamilyAndCode(normalized)
  return {
    messageFamily: edifact.family,
    messageCode: edifact.code,
    messageStandard: edifact.family === 'UNKNOWN' ? 'unknown' : 'edifact',
  }
}

export function inferEdielFileName(params: {
  family: string
  code: string
  direction: EdielDirection
  extension: 'edi' | 'csv' | 'xml'
}): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')
  const safeFamily = params.family.replace(/[^A-Za-z0-9_]/g, '_')
  const safeCode = params.code.replace(/[^A-Za-z0-9_]/g, '_')
  return `${params.direction}_${safeFamily}_${safeCode}_${stamp}.${params.extension}`
}

export function isActivelySupportedPayload(rawPayload: string): boolean {
  const inferred = inferEdielFamilyAndCodeFromRawPayload(rawPayload)
  return isActiveEdielMessageFamily(inferred.messageFamily)
}
