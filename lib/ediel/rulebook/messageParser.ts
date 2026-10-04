import {parseAiBiTechnicalFile} from '@/lib/ediel/aiListFormat'
import type { EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import { prodatDocumentValue } from '@/lib/ediel/prodat/prodatDocumentFields'
import { prodatReferenceByQualifier } from '@/lib/ediel/prodat/prodatReferenceFields'
import { prodatCharacteristicValue } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import type { EdielMessageFamily } from '@/lib/ediel/types'
import { processGroupForMessage } from '@/lib/ediel/rulebook/rulebook'

export type ParsedRulebookMessage = {
  una?: EdifactServiceStringAdvice
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

function inferSubtype(raw: string): string | null {
  const tokenized = tokenizeEdifact(raw)
  return prodatCharacteristicValue('223', tokenized.segments, tokenized.una)?.toUpperCase() ?? null
}

function parseContrlFacts(source: ReturnType<typeof tokenizeEdifact>): Record<string, unknown> {
  const uci = source.segments.find(segment => segment.tag === 'UCI')
  const ucm = source.segments.filter(segment => segment.tag === 'UCM').map(segment => segment.raw)
  const ucs = source.segments.filter(segment => segment.tag === 'UCS').map(segment => segment.raw)
  const action = segmentComposite(uci, 4, source.una)
  const actionCode = action.length === 1 ? action[0] || null : null
  const status = actionCode === '1'
    ? 'positive'
    : actionCode === '4'
      ? 'negative'
      : 'unknown'

  return {
    uci: uci?.raw ?? null,
    ucm,
    ucs,
    acknowledgedInterchangeReference: segmentComposite(uci, 1, source.una)[0] || null,
    actionCode,
    status,
  }
}

function physicalRff(source: ReturnType<typeof tokenizeEdifact>, qualifier: string): string | null {
  const match = source.segments.find(segment => segment.tag === 'RFF' && segmentComposite(segment, 1, source.una)[0] === qualifier)
  return segmentComposite(match, 1, source.una)[1] || null
}
function physicalDtm(source: ReturnType<typeof tokenizeEdifact>, qualifier: string): string | null {
  const match = source.segments.find(segment => segment.tag === 'DTM' && segmentComposite(segment, 1, source.una)[0] === qualifier)
  return segmentComposite(match, 1, source.una)[1] || null
}
function parseAperakFacts(source: ReturnType<typeof tokenizeEdifact>): Record<string, unknown> {
  const erc = source.segments.filter(segment => segment.tag === 'ERC')
  const ftx = source.segments.filter(segment => segment.tag === 'FTX').map(segment => segment.raw)
  return { erc: erc.map(segment => segment.raw), ftx, doc: source.segments.filter(segment => segment.tag === 'DOC').map(segment => segment.raw),
    errors: erc.map((segment, index) => ({ erc: segmentComposite(segment, 1, source.una)[0] || null, ftx: ftx[index] ?? null })) }
}
function parseUtiltsFacts(source: ReturnType<typeof tokenizeEdifact>): Record<string, unknown> {
  const values = (tag: string) => source.segments.filter(segment => segment.tag === tag).map(segment => segment.raw)
  return { mks: values('MKS'), ide: values('IDE'), loc: values('LOC'), qty: values('QTY'), sts: values('STS'),
    dtm137: physicalDtm(source, '137'), dtm354: physicalDtm(source, '354'), dtm597: physicalDtm(source, '597'), dtm735: physicalDtm(source, '735') }
}

export function parseRulebookMessage(raw: string): ParsedRulebookMessage {
  const source = tokenizeEdifact(raw)
  const sourceFamily = segmentComposite(source.segments.find(segment => segment.tag === 'UNH'), 2, source.una)[0]?.trim().toUpperCase()
  const isProdat = sourceFamily === 'PRODAT'
  const isContrl = sourceFamily === 'CONTRL'
  const rawSegments = source.segments.map(segment => segment.raw)
  const sourceSegment = (tag: string) => source.segments.find(segment => segment.tag === tag)
  const sourcePart = (tag: string, index: number): string | null => {
    const parts = segmentComposite(sourceSegment(tag), index, source.una)
    return parts.length === 1 ? parts[0]?.trim() || null : null
  }
  const unb = sourceSegment('UNB')?.raw ?? null
  const unh = sourceSegment('UNH')?.raw ?? null
  const bgm = sourceSegment('BGM')?.raw ?? null
  const sourceSender = segmentComposite(sourceSegment('UNB'), 2, source.una)
  const sourceReceiver = segmentComposite(sourceSegment('UNB'), 3, source.una)
  const sender = { id: sourceSender[0]?.trim() || null, subAddress: sourceSender[2]?.trim() || null }
  const receiver = { id: sourceReceiver[0]?.trim() || null, subAddress: sourceReceiver[2]?.trim() || null }
  const bgmCode = isProdat ? prodatDocumentValue('202', source.segments, source.una)?.toUpperCase() ?? null : segmentComposite(sourceSegment('BGM'), 1, source.una)[0]?.trim().toUpperCase() || null
  const inferredFamily = (['PRODAT', 'UTILTS', 'APERAK', 'CONTRL', 'UTILTS_ERR'].includes(sourceFamily ?? '') ? sourceFamily : 'UNKNOWN') as EdielMessageFamily | 'UNKNOWN'
  const family = inferredFamily === 'UTILTS' && bgmCode === 'ERR' ? 'UTILTS_ERR' : inferredFamily
  const code = family === 'CONTRL' ? 'CONTRL' : family === 'APERAK' ? 'APERAK' : family === 'UTILTS_ERR' ? 'UTILTS_ERR' : bgmCode
  const applicationReference = sourcePart('UNB', 7)
  const interchangeReference = sourcePart('UNB', 5)
  const messageReference = isProdat ? prodatDocumentValue('203', source.segments, source.una) : isContrl ? sourcePart('UNH', 1) : segmentComposite(sourceSegment('BGM'), 2, source.una)[0] || sourcePart('UNH', 1)
  const tokenized = family === 'PRODAT' ? source : null
  const reference = (qualifier: string): string | null => tokenized
    ? prodatReferenceByQualifier(qualifier, tokenized.segments, tokenized.una) : physicalRff(source, qualifier)
  const transactionReference = reference('TN') ?? reference('LI') ?? reference('ACW')
  const relatedReference = reference('ACW') ?? reference('AGO') ?? reference('E31')
  const facilityId = reference('Z05') ?? null
  const meteringPointId = segmentComposite(sourceSegment('LIN'), 3, source.una)[0]?.trim() || null
  const permissionId = family === 'PRODAT' ? reference('Z09') : reference('Z07') ?? reference('AHL')
  const processGroup = processGroupForMessage(family, code)
  const facts: Record<string, unknown> = {
    bgm,
    unh,
    unb,
    nad: source.segments.filter(segment => segment.tag === 'NAD').map(segment => segment.raw),
    rff: source.segments.filter(segment => segment.tag === 'RFF').map(segment => segment.raw),
    dtm: source.segments.filter(segment => segment.tag === 'DTM').map(segment => segment.raw),
  }
  if (family === 'CONTRL') Object.assign(facts, parseContrlFacts(source))
  if (family === 'APERAK') Object.assign(facts, parseAperakFacts(source))
  if (family === 'UTILTS' || family === 'UTILTS_ERR') Object.assign(facts, parseUtiltsFacts(source))

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
    ? (source.segments.some(segment => segment.tag === 'ERC') ? 'negative' : 'positive')
    : family === 'CONTRL'
      ? (facts.status === 'positive' ? 'positive' : facts.status === 'negative' ? 'negative' : null)
      : null

  return {
    una: source.una,
    family,
    code,
    subtype: family === 'PRODAT' ? inferSubtype(raw) : null,
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
    period: physicalDtm(source, '163') ?? physicalDtm(source, '324') ?? null,
    outcome,
    processGroup,
    rawSegments,
    facts,
    errors,
    warnings,
  }
}

export function parseRulebookListPayload(raw: string): ParsedRulebookMessage {
  let parsed: ReturnType<typeof parseAiBiTechnicalFile> | null = null
  const errors: string[] = []
  try { parsed = parseAiBiTechnicalFile(raw) } catch (error) { errors.push(error instanceof Error ? error.message : 'ai_list_format_invalid') }
  const listType = parsed?.header.listType ?? null
  return {
    family: listType === 'BI' ? 'BI_LIST' : listType === 'AI' ? 'AI_LIST' : 'UNKNOWN',
    code: listType, subtype: null, sender: null, receiver: null,
    senderSubAddress: null, receiverSubAddress: null, applicationReference: null,
    interchangeReference: null, messageReference: null, transactionReference: null,
    relatedReference: null, facilityId: null, meteringPointId: null, permissionId: null,
    period: parsed?.header.fromDate && parsed.header.toDate ? `${parsed.header.fromDate}/${parsed.header.toDate}` : null,
    outcome: null, processGroup: 'ai_list', rawSegments: raw.split(/\r?\n/).filter(Boolean),
    facts: {delimiter:';',rowCount:parsed?.rows.length ?? 0,formatVersion:parsed?.header.version ?? null,
      header:parsed?.header ?? null, rows:parsed?.rows ?? []}, errors, warnings:[],
  }
}
