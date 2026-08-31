import type { EdielMessageFamily } from '@/lib/ediel/types'
import { processGroupForMessage } from '@/lib/ediel/rulebook/rulebook'

export type ParsedRulebookMessage = {
  family: EdielMessageFamily | 'BI_LIST' | 'UNKNOWN'
  code: string | null
  subtype: string | null
  sender: string | null
  receiver: string | null
  senderSubAddress: string | null
  receiverSubAddress: string | null
  applicationReference: string | null
  interchangeReference: string | null
  messageReference: string | null
  transactionReference: string | null
  relatedReference: string | null
  facilityId: string | null
  meteringPointId: string | null
  permissionId: string | null
  period: string | null
  outcome: 'positive' | 'negative' | null
  processGroup: string
  rawSegments: string[]
  facts: Record<string, unknown>
  errors: string[]
  warnings: string[]
}

function segments(raw: string): string[] {
  return raw.split("'").map((segment) => segment.trim()).filter(Boolean)
}

function part(segment: string | null | undefined, index: number): string | null {
  if (!segment) return null
  return segment.split('+')[index]?.trim() || null
}

function splitParty(value: string | null): { id: string | null; subAddress: string | null } {
  if (!value) return { id: null, subAddress: null }
  const parts = value.split(':')
  return { id: parts[0]?.trim() || null, subAddress: parts[2]?.trim() || null }
}

function first(segments: string[], prefix: string): string | null {
  return segments.find((segment) => segment.toUpperCase().startsWith(prefix.toUpperCase())) ?? null
}

function all(segments: string[], prefix: string): string[] {
  return segments.filter((segment) => segment.toUpperCase().startsWith(prefix.toUpperCase()))
}

function extractRff(rawSegments: string[], qualifier: string): string | null {
  const hit = rawSegments.find((segment) => segment.toUpperCase().startsWith(`RFF+${qualifier.toUpperCase()}:`))
  if (!hit) return null
  return hit.split(':').slice(1).join(':').trim() || null
}

function extractDtm(rawSegments: string[], qualifier: string): string | null {
  const hit = rawSegments.find((segment) => segment.toUpperCase().startsWith(`DTM+${qualifier.toUpperCase()}:`))
  return hit?.split(':')[1]?.trim() || null
}

function inferFamilyFromUnh(unh: string | null): EdielMessageFamily | 'UNKNOWN' {
  const token = (unh ?? '').toUpperCase()
  if (token.includes('PRODAT')) return 'PRODAT'
  if (token.includes('UTILTS')) return 'UTILTS'
  if (token.includes('APERAK')) return 'APERAK'
  if (token.includes('CONTRL')) return 'CONTRL'
  if (token.includes('UTILTS_ERR')) return 'UTILTS_ERR'
  return 'UNKNOWN'
}

function parseBgmCode(bgm: string | null): string | null {
  if (!bgm) return null
  const value = part(bgm, 1)
  if (!value) return null
  return value.split(':')[0]?.trim().toUpperCase() || null
}

function parseBgmReference(bgm: string | null): string | null {
  return part(bgm, 2)?.split(':')[0]?.trim() || null
}

function inferSubtype(rawSegments: string[]): string | null {
  const cci = rawSegments.find((segment) => segment.toUpperCase().startsWith('CCI++Z13'))
  if (!cci) return null
  const idx = rawSegments.indexOf(cci)
  const cav = rawSegments[idx + 1]
  if (!cav || !cav.toUpperCase().startsWith('CAV+')) return null
  const raw = cav.slice(4).split(':').filter(Boolean).pop()
  return raw?.trim().toUpperCase() || null
}

function parseContrlFacts(rawSegments: string[]): Record<string, unknown> {
  const uci = first(rawSegments, 'UCI+')
  const ucm = all(rawSegments, 'UCM+')
  const ucs = all(rawSegments, 'UCS+')
  const actionCode = part(uci, 4)?.split(':')[0]?.trim() || null
  const status = actionCode === '1'
    ? 'positive'
    : actionCode === '4'
      ? 'negative'
      : 'unknown'

  return {
    uci,
    ucm,
    ucs,
    acknowledgedInterchangeReference: part(uci, 1),
    actionCode,
    status,
  }
}

function parseAperakFacts(rawSegments: string[]): Record<string, unknown> {
  const erc = all(rawSegments, 'ERC+')
  const ftx = all(rawSegments, 'FTX+')
  const doc = all(rawSegments, 'DOC+')
  return {
    erc,
    ftx,
    doc,
    errors: erc.map((segment, index) => ({
      erc: segment.split('+')[1]?.split(':')[0] ?? null,
      ftx: ftx[index] ?? null,
    })),
  }
}

function parseUtiltsFacts(rawSegments: string[]): Record<string, unknown> {
  return {
    mks: all(rawSegments, 'MKS+'),
    ide: all(rawSegments, 'IDE+'),
    loc: all(rawSegments, 'LOC+'),
    qty: all(rawSegments, 'QTY+'),
    sts: all(rawSegments, 'STS+'),
    dtm137: extractDtm(rawSegments, '137'),
    dtm354: extractDtm(rawSegments, '354'),
    dtm597: extractDtm(rawSegments, '597'),
    dtm735: extractDtm(rawSegments, '735'),
  }
}

export function parseRulebookMessage(raw: string): ParsedRulebookMessage {
  const rawSegments = segments(raw)
  const unb = first(rawSegments, 'UNB+')
  const unh = first(rawSegments, 'UNH+')
  const bgm = first(rawSegments, 'BGM+')
  const lin = first(rawSegments, 'LIN+')
  const sender = splitParty(part(unb, 2))
  const receiver = splitParty(part(unb, 3))
  const bgmCode = parseBgmCode(bgm)
  const inferredFamily = inferFamilyFromUnh(unh)
  const family = inferredFamily === 'UTILTS' && bgmCode === 'ERR' ? 'UTILTS_ERR' : inferredFamily
  const code = family === 'CONTRL' ? 'CONTRL' : family === 'APERAK' ? 'APERAK' : family === 'UTILTS_ERR' ? 'UTILTS_ERR' : bgmCode
  const applicationReference = part(unb, 7)
  const interchangeReference = part(unb, 5)
  const messageReference = parseBgmReference(bgm) ?? part(unh, 1)
  const transactionReference = extractRff(rawSegments, 'TN') ?? extractRff(rawSegments, 'LI') ?? extractRff(rawSegments, 'ACW')
  const relatedReference = extractRff(rawSegments, 'ACW') ?? extractRff(rawSegments, 'AGO') ?? extractRff(rawSegments, 'E31')
  const facilityId = extractRff(rawSegments, 'Z05') ?? null
  const meteringPointId = lin?.split('+')[3]?.split(':')[0]?.trim() || null
  const permissionId = extractRff(rawSegments, 'Z07') ?? extractRff(rawSegments, 'AHL') ?? null
  const processGroup = processGroupForMessage(family, code)
  const facts: Record<string, unknown> = {
    bgm,
    unh,
    unb,
    nad: all(rawSegments, 'NAD+'),
    rff: all(rawSegments, 'RFF+'),
    dtm: all(rawSegments, 'DTM+'),
  }
  if (family === 'CONTRL') Object.assign(facts, parseContrlFacts(rawSegments))
  if (family === 'APERAK') Object.assign(facts, parseAperakFacts(rawSegments))
  if (family === 'UTILTS' || family === 'UTILTS_ERR') Object.assign(facts, parseUtiltsFacts(rawSegments))

  const errors: string[] = []
  const warnings: string[] = []
  if (!unb && rawSegments.length > 0) warnings.push('UNB saknas eller kunde inte läsas.')
  if (!unh && !raw.includes(';')) warnings.push('UNH saknas eller kunde inte läsas.')
  if (family !== 'CONTRL' && family !== 'AI_LIST' && family !== 'UNKNOWN' && !bgm) warnings.push('BGM saknas eller kunde inte läsas.')
  if (family === 'CONTRL') {
    const actionCode = typeof facts.actionCode === 'string' ? facts.actionCode : null
    if (actionCode !== '1' && actionCode !== '4') {
      errors.push(`CONTRL UCI/0083 måste vara 1 eller 4 enligt Ediel; fick ${actionCode ?? 'saknas'}.`)
    }
  }

  const outcome = family === 'APERAK'
    ? (all(rawSegments, 'ERC+').length > 0 ? 'negative' : 'positive')
    : family === 'CONTRL'
      ? (facts.status === 'positive' ? 'positive' : facts.status === 'negative' ? 'negative' : null)
      : null

  return {
    family,
    code,
    subtype: inferSubtype(rawSegments),
    sender: sender.id,
    receiver: receiver.id,
    senderSubAddress: sender.subAddress,
    receiverSubAddress: receiver.subAddress,
    applicationReference,
    interchangeReference,
    messageReference,
    transactionReference,
    relatedReference,
    facilityId,
    meteringPointId,
    permissionId,
    period: extractDtm(rawSegments, '163') ?? extractDtm(rawSegments, '324') ?? null,
    outcome,
    processGroup,
    rawSegments,
    facts,
    errors,
    warnings,
  }
}

export function parseRulebookListPayload(raw: string): ParsedRulebookMessage {
  const firstLine = raw.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ''
  const delimiter = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ','
  const headers = firstLine.split(delimiter).map((value) => value.trim())
  const isBi = headers.some((header) => /nytt|new|changed|ändr/i.test(header))
  return {
    family: isBi ? ('BI_LIST' as never) : 'AI_LIST',
    code: isBi ? 'BI' : 'AI',
    subtype: null,
    sender: null,
    receiver: null,
    senderSubAddress: null,
    receiverSubAddress: null,
    applicationReference: null,
    interchangeReference: null,
    messageReference: null,
    transactionReference: null,
    relatedReference: null,
    facilityId: null,
    meteringPointId: null,
    permissionId: null,
    period: null,
    outcome: null,
    processGroup: 'ai_list',
    rawSegments: raw.split(/\r?\n/).filter(Boolean),
    facts: { headers, delimiter, rowCount: Math.max(raw.split(/\r?\n/).filter(Boolean).length - 1, 0), formatVersion: raw.includes('Ver20140401') ? 'Ver20140401' : null },
    errors: [],
    warnings: delimiter !== ';' ? ['AI/BI-lista ska normalt vara semikolonseparerad.'] : [],
  }
}
