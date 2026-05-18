// lib/ediel/fileEngine.ts

import type {
  CreateEdielMessageInput,
  EdielAckStatus,
  EdielDirection,
  EdielMessageFamily,
  EdielMessageStandard,
  EdielMessageStatus,
} from '@/lib/ediel/types'
import {
  createCanonicalOutboundMessage,
  registerInboundCanonicalMessage,
  resolveInboundAcceptedVersions,
  resolveOutboundMessageVersion,
} from '@/lib/ediel/core/kernel'
import { createEdielMessageEvent } from '@/lib/ediel/db'

export const GRIDEX_TGT_EDIEL_ID = '92825'
// Backwards-compatible alias used by the TGT/file-engine views only.
// Actor/AGT identity must come from ediel_actor_settings and route profiles.
export const GRIDEX_EDIEL_ID = GRIDEX_TGT_EDIEL_ID
export const EDIEL_TGT_TESTSYSTEM_EDIEL_ID = '91100'
export const EDIEL_TGT_TESTSYSTEM_EMAIL = '91100@ediel.se'
export const EDIEL_TGT_PRODAT_SENDER_SUB_ADDRESS = 'PRODAT'
// In the PRODAT 26.A EDIFACT interchange, Edielportalens testsystem uses
// receiver subaddress PRODAT. This is separate from SMTP address 91100@ediel.se.
export const EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS = 'PRODAT'
export const EDIEL_TGT_PRODAT_APPLICATION_REFERENCE = '23-DDQ-PRODAT'
export const EDIEL_TGT_PRODAT_ESCO_APPLICATION_REFERENCE = '23-DGI-PRODAT'

export function resolveEdielTgtProdatApplicationReference(params?: { roleCode?: string | null; testCaseCode?: string | null; messageCode?: string | null }): string {
  const roleCode = params?.roleCode?.toLowerCase() ?? null
  const messageCode = params?.messageCode?.toUpperCase() ?? null
  const testCaseCode = params?.testCaseCode ?? ''

  if (roleCode === 'esco') return EDIEL_TGT_PRODAT_ESCO_APPLICATION_REFERENCE
  if (messageCode === 'Z13' || messageCode === 'Z14' || messageCode === 'Z15' || messageCode === 'Z18') {
    if (/^(8|9)\./.test(testCaseCode)) return EDIEL_TGT_PRODAT_ESCO_APPLICATION_REFERENCE
  }

  return EDIEL_TGT_PRODAT_APPLICATION_REFERENCE
}

export type EdielFileEngineMode = 'tgt' | 'agt' | 'internal_test' | 'production_dry_run'
export type EdielFileEngineRegisterResult = {
  id: string
  direction: EdielDirection
  status: EdielMessageStatus
  messageFamily: EdielMessageFamily
  messageCode: string
  messageVersion: string | null
  senderEdielId: string | null
  receiverEdielId: string | null
  interchangeReference: string | null
  transactionReference: string | null
  externalReference: string | null
  applicationReference: string | null
  warnings: string[]
  errors: string[]
  duplicateOrExisting: boolean
}

type EdifactSegment = {
  tag: string
  elements: string[]
  raw: string
}

type ParsedEdielFile = {
  messageStandard: EdielMessageStandard
  messageFamily: EdielMessageFamily
  messageCode: string
  messageVersion: string | null
  processType: string | null
  senderEdielId: string | null
  senderSubAddress: string | null
  receiverEdielId: string | null
  receiverSubAddress: string | null
  interchangeReference: string | null
  transactionReference: string | null
  externalReference: string | null
  correlationReference: string | null
  applicationReference: string | null
  originalMessageId: string | null
  originalTransactionId: string | null
  originalMessageCode: string | null
  ackOutcome: 'positive' | 'negative' | null
  syntaxCheckStatus: string | null
  functionalCheckStatus: string | null
  parsedPayload: Record<string, unknown>
  validationReport: Record<string, unknown>
}

type RegisterFileParams = {
  actorUserId: string
  direction: EdielDirection
  rawPayload: string
  fileName?: string | null
  mode?: EdielFileEngineMode
  mailbox?: string | null
  mailboxMessageId?: string | null
  senderEmail?: string | null
  receiverEmail?: string | null
  subject?: string | null
  ownActorEdielId?: string | null
  ownActorName?: string | null
}

function trimOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeEdielId(value: string | null): string | null {
  if (!value) return null
  return value.split(':')[0]?.trim().toUpperCase() || null
}

function normalizeSubAddress(value: string | null): string | null {
  if (!value) return null
  const parts = value.split(':')
  return parts.length > 1 ? parts[1]?.trim().toUpperCase() || null : null
}

function normalizeRawPayload(rawPayload: string): string {
  return rawPayload
    .replace(/^\uFEFF/, '')
    // Some admins copy raw_payload from SQL/JSON views where line breaks are literal \n.
    // Convert those back before segment parsing, otherwise tags become "\nUNB"/"\nUNH".
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .trim()
}

function splitEdifactSegments(rawPayload: string): EdifactSegment[] {
  const normalized = normalizeRawPayload(rawPayload)
  const body = normalized.startsWith('UNA') ? normalized.slice(9) : normalized

  return body
    .split("'")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((raw) => {
      const parts = raw.split('+')
      return {
        tag: (parts[0] ?? '').toUpperCase(),
        elements: parts.slice(1),
        raw,
      }
    })
}

function firstSegment(segments: EdifactSegment[], tag: string): EdifactSegment | null {
  return segments.find((segment) => segment.tag === tag.toUpperCase()) ?? null
}

function allSegments(segments: EdifactSegment[], tag: string): EdifactSegment[] {
  return segments.filter((segment) => segment.tag === tag.toUpperCase())
}

function firstElementComponent(element: string | undefined, index = 0): string | null {
  if (!element) return null
  const value = element.split(':')[index]
  return trimOrNull(value)
}

function parseRffValue(segments: EdifactSegment[], qualifier: string): string | null {
  const normalizedQualifier = qualifier.toUpperCase()
  for (const segment of allSegments(segments, 'RFF')) {
    const [q, value] = (segment.elements[0] ?? '').split(':')
    if (q?.toUpperCase() === normalizedQualifier) return trimOrNull(value)
  }
  return null
}

function parseNadValue(segments: EdifactSegment[], qualifier: string): string | null {
  const normalizedQualifier = qualifier.toUpperCase()
  for (const segment of allSegments(segments, 'NAD')) {
    const q = segment.elements[0]?.toUpperCase()
    if (q === normalizedQualifier) {
      return trimOrNull(segment.elements[1]?.split(':')[0])
    }
  }
  return null
}

function detectAiList(rawPayload: string, fileName?: string | null): ParsedEdielFile | null {
  const file = fileName?.toLowerCase() ?? ''
  const firstLine = rawPayload.split(/\r?\n/).find((line) => line.trim().length > 0) ?? ''
  const upper = `${file} ${firstLine}`.toUpperCase()

  if (!file.endsWith('.csv') && !file.endsWith('.skv') && !firstLine.includes(';')) return null

  const listType = upper.includes('BI') ? 'BI' : 'AI'
  const lineCount = rawPayload.split(/\r?\n/).filter((line) => line.trim().length > 0).length

  return {
    messageStandard: 'ai_list',
    messageFamily: 'AI_LIST',
    messageCode: listType,
    messageVersion: 'Ver20140401',
    processType: null,
    senderEdielId: null,
    senderSubAddress: null,
    receiverEdielId: null,
    receiverSubAddress: null,
    interchangeReference: `AI-LIST-${listType}-${lineCount}-${rawPayload.length}`,
    transactionReference: null,
    externalReference: `AI-LIST-${listType}-${Date.now()}`,
    correlationReference: null,
    applicationReference: null,
    originalMessageId: null,
    originalTransactionId: null,
    originalMessageCode: null,
    ackOutcome: null,
    syntaxCheckStatus: 'not_checked',
    functionalCheckStatus: 'not_checked',
    parsedPayload: {
      parser: 'file_engine_v1',
      listType,
      lineCount,
      separator: ';',
      fileFormat: file.endsWith('.skv') ? 'legacy_skv' : 'csv',
      note: 'AI/BI-listan körs filbaserat och ska granskas innan eventuell masterdata-uppdatering.',
    },
    validationReport: {
      ok: true,
      warnings: [],
      errors: [],
      mode: 'file_engine',
    },
  }
}

function inferFamilyFromUnh(unh: EdifactSegment | null): EdielMessageFamily {
  const messageType = firstElementComponent(unh?.elements[1], 0)?.toUpperCase()
  if (messageType === 'PRODAT') return 'PRODAT'
  if (messageType === 'UTILTS') return 'UTILTS'
  if (messageType === 'APERAK') return 'APERAK'
  if (messageType === 'CONTRL') return 'CONTRL'
  return 'OTHER'
}

function inferMessageVersion(unh: EdifactSegment | null): string | null {
  const descriptor = unh?.elements[1]
  if (!descriptor) return null
  const parts = descriptor.split(':')
  return trimOrNull(parts[4]) ?? trimOrNull(parts[2])
}

function inferMessageCode(family: EdielMessageFamily, bgm: EdifactSegment | null): string {
  if (family === 'APERAK') return 'APERAK'
  if (family === 'CONTRL') return 'CONTRL'
  if (family === 'UTILTS_ERR') return 'UTILTS_ERR'

  const code = firstElementComponent(bgm?.elements[0], 0)
  return code?.toUpperCase() ?? String(family)
}

function inferAckOutcome(params: {
  family: EdielMessageFamily
  segments: EdifactSegment[]
}): 'positive' | 'negative' | null {
  const ercSegments = allSegments(params.segments, 'ERC')
  const ercCodes = ercSegments
    .map((segment) => firstElementComponent(segment.elements[0], 0))
    .filter(Boolean)
    .map((value) => value!.toUpperCase())

  if (params.family === 'APERAK') {
    if (ercCodes.includes('100')) return 'positive'
    if (ercCodes.length > 0) return 'negative'

    const ftx = allSegments(params.segments, 'FTX')
      .map((segment) => segment.raw.toUpperCase())
      .join(' ')
    if (ftx.includes('OK')) return 'positive'
  }

  if (params.family === 'CONTRL') {
    const uci = firstSegment(params.segments, 'UCI')
    const status = firstElementComponent(uci?.elements[2], 0)?.toUpperCase()
    if (status === '7' || status === '8') return 'positive'
    if (status) return 'negative'
  }

  return null
}

function buildValidation(params: {
  direction: EdielDirection
  mode: EdielFileEngineMode
  parsed: Omit<ParsedEdielFile, 'validationReport'>
  rawPayload: string
  fileName?: string | null
}): { warnings: string[]; errors: string[]; report: Record<string, unknown> } {
  const warnings: string[] = []
  const errors: string[] = []

  if (!params.rawPayload.includes('UNB+') && params.parsed.messageStandard === 'edifact') {
    errors.push('UNB saknas. Filen ser inte ut som komplett EDIFACT-interchange.')
  }

  if (!params.rawPayload.includes('UNH+') && params.parsed.messageStandard === 'edifact') {
    errors.push('UNH saknas. Meddelandetyp kan inte verifieras säkert.')
  }

  if (params.parsed.messageFamily === 'OTHER') {
    warnings.push('Meddelandefamilj kunde inte identifieras som PRODAT/UTILTS/APERAK/CONTRL.')
  }

  if (params.parsed.messageFamily === 'PRODAT') {
    if (params.direction === 'outbound' && params.mode === 'tgt' && params.parsed.senderEdielId !== GRIDEX_EDIEL_ID) {
      warnings.push(`TGT outbound PRODAT bör ha Gridcore/TGT som avsändare (${GRIDEX_EDIEL_ID}).`)
    }
    if (params.direction === 'outbound' && params.mode === 'agt' && params.parsed.senderEdielId === GRIDEX_EDIEL_ID) {
      warnings.push(`AGT outbound PRODAT får inte ha Gridcore/TGT-id ${GRIDEX_EDIEL_ID} som avsändare. Avsändaren ska vara aktiv leverantör/tenant från aktörsprofilen.`)
    }
    if (params.direction === 'outbound' && params.parsed.receiverEdielId !== EDIEL_TGT_TESTSYSTEM_EDIEL_ID && (params.mode === 'tgt' || params.mode === 'agt')) {
      warnings.push(`${params.mode.toUpperCase()} outbound PRODAT bör ha Edielportalens mottagare ${EDIEL_TGT_TESTSYSTEM_EDIEL_ID}.`)
    }
    if ((params.mode === 'tgt' || params.mode === 'agt') && params.parsed.receiverSubAddress !== EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS && params.direction === 'outbound') {
      warnings.push(`${params.mode.toUpperCase()} PRODAT ska ha mottagarens subadress ${EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS}.`)
    }
    if (params.mode === 'tgt' && params.direction === 'outbound' && ![EDIEL_TGT_PRODAT_APPLICATION_REFERENCE, EDIEL_TGT_PRODAT_ESCO_APPLICATION_REFERENCE].includes(params.parsed.applicationReference ?? '')) {
      warnings.push(`TGT PRODAT för elmarknad ska normalt ha Application Reference ${EDIEL_TGT_PRODAT_APPLICATION_REFERENCE}; ESCO/tillståndstest använder ${EDIEL_TGT_PRODAT_ESCO_APPLICATION_REFERENCE}.`)
    }
  }

  if ((params.parsed.messageFamily === 'PRODAT' || params.parsed.messageFamily === 'UTILTS') && !params.parsed.messageVersion) {
    warnings.push('Version saknas i UNH. Runtime kan falla tillbaka på regelmotor men filen bör innehålla version.')
  }

  if (params.rawPayload.length > 10 * 1024 * 1024) {
    warnings.push('Filen är större än 10 MB. Ediel-anvisningen anger 10 MB som rekommenderad maxstorlek för meddelandefiler.')
  }

  return {
    warnings,
    errors,
    report: {
      ok: errors.length === 0,
      warnings,
      errors,
      mode: 'file_engine',
      fileEngineMode: params.mode,
      fileName: params.fileName ?? null,
      gridexEdielId: GRIDEX_EDIEL_ID,
      tgtReceiverEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
      tgtProdatReceiverSubAddress: EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS,
      tgtProdatApplicationReference: EDIEL_TGT_PRODAT_APPLICATION_REFERENCE,
      tgtProdatEscoApplicationReference: EDIEL_TGT_PRODAT_ESCO_APPLICATION_REFERENCE,
    },
  }
}

export function parseEdielFile(rawPayload: string, fileName?: string | null): ParsedEdielFile {
  const normalized = normalizeRawPayload(rawPayload)
  const aiList = detectAiList(normalized, fileName)
  if (aiList) return aiList

  const segments = splitEdifactSegments(normalized)
  const unb = firstSegment(segments, 'UNB')
  const unh = firstSegment(segments, 'UNH')
  const bgm = firstSegment(segments, 'BGM')

  const family = inferFamilyFromUnh(unh)
  const messageCode = inferMessageCode(family, bgm)
  const messageVersion = inferMessageVersion(unh)
  const senderRaw = unb?.elements[1] ?? null
  const receiverRaw = unb?.elements[2] ?? null
  const interchangeReference = trimOrNull(unb?.elements[4]) ?? trimOrNull(unb?.elements[3])
  const transactionReference = parseRffValue(segments, 'TN') ?? parseRffValue(segments, 'ACW')
  const externalReference = firstElementComponent(bgm?.elements[1], 0) ?? interchangeReference
  const applicationReference = trimOrNull(unb?.elements[6]) ?? parseRffValue(segments, 'APP')
  const processType = firstElementComponent(bgm?.elements[2], 0)
  const ackOutcome = inferAckOutcome({ family, segments })
  const originalMessageId = parseRffValue(segments, 'ACE') ?? parseRffValue(segments, 'ACD')
  const originalTransactionId = parseRffValue(segments, 'AGO') ?? parseRffValue(segments, 'TN')
  const originalMessageCode = parseRffValue(segments, 'ACW')

  const parsedWithoutValidation = {
    messageStandard: 'edifact' as const,
    messageFamily: family,
    messageCode,
    messageVersion,
    processType,
    senderEdielId: normalizeEdielId(senderRaw),
    senderSubAddress: normalizeSubAddress(senderRaw),
    receiverEdielId: normalizeEdielId(receiverRaw),
    receiverSubAddress: normalizeSubAddress(receiverRaw),
    interchangeReference,
    transactionReference,
    externalReference,
    correlationReference: originalMessageId ?? transactionReference ?? externalReference,
    applicationReference,
    originalMessageId,
    originalTransactionId,
    originalMessageCode,
    ackOutcome,
    syntaxCheckStatus: family === 'CONTRL' ? (ackOutcome === 'negative' ? 'failed' : ackOutcome === 'positive' ? 'ok' : 'pending') : 'pending',
    functionalCheckStatus: family === 'APERAK' || family === 'UTILTS_ERR' ? (ackOutcome === 'negative' ? 'failed' : ackOutcome === 'positive' ? 'ok' : 'pending') : 'pending',
    parsedPayload: {
      parser: 'file_engine_v1',
      segmentCount: segments.length,
      segmentTags: segments.map((segment) => segment.tag),
      unh: unh?.raw ?? null,
      bgm: bgm?.raw ?? null,
      senderRaw,
      receiverRaw,
      nadMr: parseNadValue(segments, 'MR'),
      nadMs: parseNadValue(segments, 'MS'),
      ackOutcome,
      originalMessageId,
      originalTransactionId,
      originalMessageCode,
    },
  }

  const validation = buildValidation({
    direction: 'inbound',
    mode: 'tgt',
    parsed: parsedWithoutValidation,
    rawPayload: normalized,
    fileName,
  })

  return {
    ...parsedWithoutValidation,
    validationReport: validation.report,
  }
}

function ackStatusesFor(params: {
  direction: EdielDirection
  family: EdielMessageFamily
  messageCode: string
}): {
  requiresContrl: boolean
  requiresAperak: boolean
  contrlStatus: EdielAckStatus | null
  aperakStatus: EdielAckStatus | null
  utiltsErrStatus: EdielAckStatus | null
} {
  if (params.family === 'AI_LIST' || params.family === 'OTHER') {
    return {
      requiresContrl: false,
      requiresAperak: false,
      contrlStatus: 'not_required',
      aperakStatus: 'not_required',
      utiltsErrStatus: 'not_required',
    }
  }

  if (params.family === 'CONTRL') {
    return {
      requiresContrl: false,
      requiresAperak: false,
      contrlStatus: 'not_required',
      aperakStatus: 'not_required',
      utiltsErrStatus: 'not_required',
    }
  }

  if (params.family === 'APERAK') {
    return {
      requiresContrl: true,
      requiresAperak: false,
      contrlStatus: params.direction === 'outbound' ? 'pending' : 'pending',
      aperakStatus: 'not_required',
      utiltsErrStatus: 'not_required',
    }
  }

  if (params.family === 'UTILTS_ERR') {
    return {
      requiresContrl: false,
      requiresAperak: false,
      contrlStatus: 'not_required',
      aperakStatus: 'not_required',
      utiltsErrStatus: 'not_required',
    }
  }

  return {
    requiresContrl: true,
    requiresAperak: true,
    contrlStatus: params.direction === 'outbound' ? 'pending' : 'pending',
    aperakStatus: params.direction === 'outbound' ? 'pending' : 'pending',
    utiltsErrStatus: params.family === 'UTILTS' ? 'pending' : 'not_required',
  }
}

function computeAckDueAt(): string {
  return new Date(Date.now() + 30 * 60 * 1000).toISOString()
}

async function withVersionValidation(params: {
  parsed: ParsedEdielFile
  direction: EdielDirection
  mode: EdielFileEngineMode
  rawPayload: string
  fileName?: string | null
}) {
  const report = {
    ...(params.parsed.validationReport ?? {}),
  } as Record<string, unknown>

  const warnings = Array.isArray(report.warnings) ? [...report.warnings] : []
  const errors = Array.isArray(report.errors) ? [...report.errors] : []

  let resolvedVersion: string | null = params.parsed.messageVersion
  let acceptedVersions: string[] = []

  if (params.direction === 'outbound') {
    resolvedVersion = await resolveOutboundMessageVersion({
      family: params.parsed.messageFamily,
      code: params.parsed.messageCode,
      standard: params.parsed.messageStandard,
      fallback: params.parsed.messageVersion,
      environment: params.mode === 'production_dry_run' ? 'production' : 'test',
    })

    if (params.parsed.messageVersion && resolvedVersion && params.parsed.messageVersion !== resolvedVersion) {
      warnings.push(`Filens version ${params.parsed.messageVersion} skiljer sig från runtime-version ${resolvedVersion}.`)
    }
  } else {
    const acceptedVersionRows = await resolveInboundAcceptedVersions({
      family: params.parsed.messageFamily,
      code: params.parsed.messageCode,
      standard: params.parsed.messageStandard,
    })

    acceptedVersions = acceptedVersionRows
      .map((row) => row.version_code)
      .filter((versionCode): versionCode is string => typeof versionCode === 'string' && versionCode.length > 0)

    if (
      params.parsed.messageVersion &&
      acceptedVersions.length > 0 &&
      !acceptedVersions.includes(params.parsed.messageVersion)
    ) {
      errors.push(
        `Inbound version ${params.parsed.messageVersion} är inte accepterad. Accepterade versioner: ${acceptedVersions.join(', ')}.`
      )
    }
  }

  return {
    resolvedVersion,
    validationReport: {
      ...report,
      ok: errors.length === 0,
      warnings,
      errors,
      resolvedVersion,
      acceptedVersions,
    },
  }
}

export async function registerEdielFile(params: RegisterFileParams): Promise<EdielFileEngineRegisterResult> {
  const mode = params.mode ?? 'tgt'
  const rawPayload = normalizeRawPayload(params.rawPayload)
  if (!rawPayload) throw new Error('Filen är tom.')

  const parsed = parseEdielFile(rawPayload, params.fileName)

  if (parsed.messageFamily === 'OTHER') {
    const preview = rawPayload.slice(0, 240).replace(/\s+/g, ' ')
    throw new Error(
      `Filen kunde inte identifieras som PRODAT, UTILTS, APERAK, CONTRL eller AI_LIST. Kontrollera att du klistrar in ren EDIFACT-fil från UNA/UNB/UNH utan JSON-citat eller escaped \\n. Förhandsvisning: ${preview}`
    )
  }

  const version = await withVersionValidation({
    parsed,
    direction: params.direction,
    mode,
    rawPayload,
    fileName: params.fileName,
  })

  const ack = ackStatusesFor({
    direction: params.direction,
    family: parsed.messageFamily,
    messageCode: parsed.messageCode,
  })

  const ownActorEdielId = mode === 'agt' ? trimOrNull(params.ownActorEdielId) : GRIDEX_EDIEL_ID
  const ownActorName = trimOrNull(params.ownActorName) ?? (mode === 'tgt' ? 'Gridex' : null)

  const senderEdielId =
    parsed.senderEdielId ??
    (params.direction === 'outbound' ? ownActorEdielId : EDIEL_TGT_TESTSYSTEM_EDIEL_ID)

  const receiverEdielId =
    parsed.receiverEdielId ??
    (params.direction === 'outbound' ? EDIEL_TGT_TESTSYSTEM_EDIEL_ID : ownActorEdielId)

  const input: CreateEdielMessageInput = {
    actorUserId: params.actorUserId,
    direction: params.direction,
    messageStandard: parsed.messageStandard,
    messageFamily: parsed.messageFamily,
    messageCode: parsed.messageCode,
    messageVersion: version.resolvedVersion ?? parsed.messageVersion,
    processType: parsed.processType,
    environment: mode === 'production_dry_run' ? 'production' : 'test',
    testFlag: mode === 'production_dry_run' ? 0 : 1,
    status: params.direction === 'outbound' ? 'prepared' : 'received',
    transportType: 'manual_upload',
    mailbox: params.mailbox ?? 'file-engine',
    mailboxMessageId:
      params.mailboxMessageId ??
      `${params.direction}-${parsed.interchangeReference ?? parsed.externalReference ?? Date.now()}`,
    senderEdielId,
    senderName: senderEdielId === GRIDEX_EDIEL_ID ? 'Gridex' : senderEdielId === ownActorEdielId ? ownActorName : null,
    senderSubAddress:
      parsed.senderSubAddress ??
      (params.direction === 'outbound' && parsed.messageFamily === 'PRODAT' ? EDIEL_TGT_PRODAT_SENDER_SUB_ADDRESS : null),
    receiverEdielId,
    receiverName: receiverEdielId === EDIEL_TGT_TESTSYSTEM_EDIEL_ID ? (mode === 'agt' ? 'Edielportalen AGT' : 'Edielportalen TGT') : null,
    receiverSubAddress:
      parsed.receiverSubAddress ??
      (params.direction === 'outbound' && parsed.messageFamily === 'PRODAT'
        ? EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS
        : null),
    senderEmail: params.senderEmail ?? null,
    receiverEmail:
      params.receiverEmail ??
      (params.direction === 'outbound' && (mode === 'tgt' || mode === 'agt') ? EDIEL_TGT_TESTSYSTEM_EMAIL : null),
    subject: params.subject ?? null,
    fileName: params.fileName ?? inferFileName(parsed),
    mimeType: parsed.messageStandard === 'ai_list' ? 'text/csv; charset=utf-8' : 'application/edifact',
    interchangeReference: parsed.interchangeReference,
    externalReference: parsed.externalReference,
    correlationReference: parsed.correlationReference,
    transactionReference: parsed.transactionReference,
    applicationReference:
      parsed.applicationReference ??
      (parsed.messageFamily === 'PRODAT' && (mode === 'tgt' || mode === 'agt')
        ? EDIEL_TGT_PRODAT_APPLICATION_REFERENCE
        : null),
    originalMessageId: parsed.originalMessageId,
    originalTransactionId: parsed.originalTransactionId,
    originalMessageCode: parsed.originalMessageCode,
    rawPayload,
    parsedPayload: {
      ...parsed.parsedPayload,
      fileEngine: {
        mode,
        direction: params.direction,
        gridexEdielId: GRIDEX_EDIEL_ID,
        activeActorEdielId: ownActorEdielId,
        testSystemEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
      },
    },
    validationReport: version.validationReport,
    requiresContrl: ack.requiresContrl,
    requiresAperak: ack.requiresAperak,
    contrlStatus: ack.contrlStatus,
    aperakStatus: ack.aperakStatus,
    utiltsErrStatus: ack.utiltsErrStatus,
    ackOutcome: parsed.ackOutcome,
    syntaxCheckStatus: parsed.syntaxCheckStatus,
    functionalCheckStatus: parsed.functionalCheckStatus,
    failureReason: (version.validationReport.errors as string[] | undefined)?.join(' | ') || null,
    messageReceivedAt: params.direction === 'inbound' ? new Date().toISOString() : null,
    messageSentAt: null,
    ackDueAt: ack.requiresContrl || ack.requiresAperak ? computeAckDueAt() : null,
  }

  const message =
    params.direction === 'inbound'
      ? await registerInboundCanonicalMessage({
          actorUserId: params.actorUserId,
          input,
        })
      : await createCanonicalOutboundMessage({
          actorUserId: params.actorUserId,
          requestType: parsed.messageFamily === 'UTILTS' ? 'meter_values' : 'supplier_switch',
          baseInput: input,
        })

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: message.id,
    eventType: params.direction === 'inbound' ? 'received' : 'prepared',
    eventStatus: ((version.validationReport.errors as string[] | undefined)?.length ?? 0) > 0 ? 'warning' : 'success',
    message:
      params.direction === 'inbound'
        ? 'Fil registrerad via filbaserad Ediel-motor.'
        : 'Outbound fil registrerad som prepared via filbaserad Ediel-motor.',
    payload: {
      fileEngine: true,
      mode,
      fileName: params.fileName ?? null,
      gridexEdielId: GRIDEX_EDIEL_ID,
      activeActorEdielId: ownActorEdielId,
      testSystemEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
      warnings: version.validationReport.warnings ?? [],
      errors: version.validationReport.errors ?? [],
    },
  })

  return {
    id: message.id,
    direction: message.direction,
    status: message.status,
    messageFamily: message.message_family,
    messageCode: String(message.message_code),
    messageVersion: message.message_version,
    senderEdielId: message.sender_ediel_id,
    receiverEdielId: message.receiver_ediel_id,
    interchangeReference: message.interchange_reference,
    transactionReference: message.transaction_reference,
    externalReference: message.external_reference,
    applicationReference: message.application_reference,
    warnings: (version.validationReport.warnings as string[] | undefined) ?? [],
    errors: (version.validationReport.errors as string[] | undefined) ?? [],
    duplicateOrExisting: message.created_at !== message.updated_at && params.direction === 'inbound',
  }
}

function inferFileName(parsed: ParsedEdielFile): string {
  const extension = parsed.messageStandard === 'ai_list' ? 'csv' : 'edi'
  return `${parsed.messageFamily}_${parsed.messageCode}_${parsed.externalReference ?? Date.now()}.${extension}`
}

export function getFileEngineTestcaseTemplates() {
  return [
    {
      suite: 'PRODAT',
      role: 'supplier',
      code: '1.2',
      title: 'Z03/Z04 leverantörsbyte med positiv APERAK',
      focus: 'Skapa Z03, ta emot CONTRL + APERAK + Z04, skicka CONTRL + APERAK.',
    },
    {
      suite: 'PRODAT',
      role: 'supplier',
      code: '1.3',
      title: 'Negativ APERAK efter Z03',
      focus: 'Verifierar att systemet hanterar negativ APERAK utan att skapa dubbel APERAK.',
    },
    {
      suite: 'PRODAT',
      role: 'supplier',
      code: '1.5',
      title: 'Syntaxfel och negativ CONTRL',
      focus: 'Verifierar syntaxfel, negativ CONTRL och larm i kontrolltornet.',
    },
    {
      suite: 'UTILTS',
      role: 'supplier',
      code: 'U2.1',
      title: 'Mottagning av korrekt UTILTS E66',
      focus: 'Läs in mätvärdesfil, skapa CONTRL och positiv APERAK.',
    },
    {
      suite: 'UTILTS',
      role: 'supplier',
      code: 'U2.2',
      title: 'Felaktig UTILTS E66',
      focus: 'Verifierar negativ APERAK eller UTILTS-ERR beroende på feltyp.',
    },
  ]
}
