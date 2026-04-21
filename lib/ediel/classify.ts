// lib/ediel/classify.ts

import type { EdielDirection, EdielMessageFamily } from '@/lib/ediel/types'
import { isActiveEdielMessageFamily } from '@/lib/ediel/types'

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

function matchEdifactToken(rawPayloadUpper: string, token: string): boolean {
  return (
    rawPayloadUpper.includes(`+${token}+`) ||
    rawPayloadUpper.includes(`:${token}+`) ||
    rawPayloadUpper.includes(`'${token}+`) ||
    rawPayloadUpper.includes(`+${token}:'`) ||
    rawPayloadUpper.includes(`${token}:D:`)
  )
}

function inferEdifactFamilyAndCode(rawPayload: string): {
  family: EdielMessageFamily | 'UNKNOWN'
  code: string | null
} {
  const upper = upperPayload(rawPayload)

  if (matchEdifactToken(upper, 'APERAK')) {
    return { family: 'APERAK', code: 'APERAK' }
  }

  if (matchEdifactToken(upper, 'CONTRL')) {
    return { family: 'CONTRL', code: 'CONTRL' }
  }

  if (
    upper.includes('UTILTS_ERR') ||
    upper.includes('UTILTS-ERR') ||
    upper.includes('BGM+UTILTS_ERR') ||
    upper.includes('BGM+UTILTS-ERR')
  ) {
    return { family: 'UTILTS_ERR', code: 'UTILTS_ERR' }
  }

  if (matchEdifactToken(upper, 'UTILTS')) {
    const bgmMatch = upper.match(/BGM\+([A-Z0-9_:-]+)\+?/)
    const bgmToken = bgmMatch?.[1]?.split(':')[0] ?? null
    const utiltsCode =
      bgmToken &&
      ['S01', 'S02', 'S03', 'S04', 'E31', 'E66', 'E73'].includes(bgmToken)
        ? bgmToken
        : ['S01', 'S02', 'S03', 'S04', 'E31', 'E66', 'E73'].find((code) =>
              upper.includes(`BGM+${code}`)
            ) ?? null

    return { family: 'UTILTS', code: utiltsCode }
  }

  if (matchEdifactToken(upper, 'PRODAT')) {
    const bgmMatch = upper.match(/BGM\+([A-Z0-9_:-]+)\+?/)
    const bgmToken = bgmMatch?.[1]?.split(':')[0] ?? null
    const prodatCode =
      bgmToken &&
      ['Z03', 'Z04', 'Z05', 'Z06', 'Z09', 'Z10'].includes(bgmToken)
        ? bgmToken
        : ['Z03', 'Z04', 'Z05', 'Z06', 'Z09', 'Z10'].find((code) =>
              upper.includes(`BGM+${code}`)
            ) ?? null

    return { family: 'PRODAT', code: prodatCode }
  }

  return { family: 'UNKNOWN', code: null }
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