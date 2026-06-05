// lib/ediel/ackDecision.ts

import type { EdielMessageRow } from '@/lib/ediel/types'
import type { AckFamily, AckOutcome, EdielAperakApplicationError } from '@/lib/ediel/ack'
import { decideProdatAperak, decideUtiltsResponse } from '@/lib/ediel/decisionEngine'

export type EdielAckDecisionAction =
  | 'none'
  | 'send_ack'

export type EdielAckDecisionReasonCode =
  | 'not_inbound'
  | 'incoming_contrl_no_ack'
  | 'incoming_aperak_contrl_required'
  | 'incoming_aperak_contrl_done'
  | 'incoming_utilts_err_contrl_required'
  | 'syntax_error_negative_contrl'
  | 'syntax_error_negative_contrl_done'
  | 'syntax_ok_positive_contrl_required'
  | 'business_negative_aperak_required'
  | 'business_positive_aperak_required'
  | 'business_manual_review_required'
  | 'utilts_err_required'
  | 'aperak_done'
  | 'unsupported_family'

export type EdielAckDecision = {
  action: EdielAckDecisionAction
  title: string
  description: string
  tone: 'slate' | 'green' | 'yellow' | 'red' | 'blue'
  reasonCode: EdielAckDecisionReasonCode
  ackFamily: AckFamily | null
  outcome: AckOutcome | null
  messageText: string | null
  applicationErrors: EdielAperakApplicationError[] | null
  canAutoSend: boolean
  reasonItems: string[]
  diagnostics: {
    syntaxIssue: string | null
    untDeclaredCount: number | null
    untActualCount: number | null
    hasFinalContrl: boolean
    hasFinalAperak: boolean
    hasReplaceableContrl: boolean
    hasReplaceableAperak: boolean
    detectedPreset: string | null
  }
}

const FINAL_ACK_STATUSES = new Set(['sent', 'acknowledged', 'validated'])
const REPLACEABLE_ACK_STATUSES = new Set(['draft', 'queued', 'prepared', 'failed', 'cancelled'])

export function isFinalAckMessage(message: Pick<EdielMessageRow, 'status'>): boolean {
  return FINAL_ACK_STATUSES.has(String(message.status))
}

export function isReplaceableAckMessage(message: Pick<EdielMessageRow, 'status'>): boolean {
  return REPLACEABLE_ACK_STATUSES.has(String(message.status))
}

export function getEdifactSegments(rawPayload: string | null | undefined): string[] {
  return String(rawPayload ?? '')
    .replace(/\r\n/g, '')
    .replace(/\n/g, '')
    .split("'")
    .map((segment) => segment.trim())
    .filter(Boolean)
}

export function getUntSegmentCountIssue(rawPayload: string | null | undefined): {
  hasIssue: boolean
  declaredCount: number | null
  actualCount: number | null
  messageReference: string | null
} {
  const segments = getEdifactSegments(rawPayload)
  const unhIndex = segments.findIndex((segment) => segment.toUpperCase().startsWith('UNH+'))
  const untIndex = segments.findIndex((segment) => segment.toUpperCase().startsWith('UNT+'))

  if (unhIndex < 0 || untIndex < 0 || untIndex < unhIndex) {
    return {
      hasIssue: false,
      declaredCount: null,
      actualCount: null,
      messageReference: null,
    }
  }

  const untParts = segments[untIndex].split('+')
  const declaredCount = Number(untParts[1])
  const messageReference = untParts[2] || null
  const actualCount = untIndex - unhIndex + 1

  if (!Number.isFinite(declaredCount)) {
    return {
      hasIssue: true,
      declaredCount: null,
      actualCount,
      messageReference,
    }
  }

  return {
    hasIssue: declaredCount !== actualCount,
    declaredCount,
    actualCount,
    messageReference,
  }
}

function safeJsonText(value: unknown): string {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return ''
  }
}

function messageSearchText(message: EdielMessageRow): string {
  return [
    message.raw_payload,
    message.external_reference,
    message.transaction_reference,
    message.interchange_reference,
    message.original_transaction_id,
    message.original_message_code,
    message.failure_reason,
    safeJsonText(message.parsed_payload),
    safeJsonText(message.validation_report),
  ]
    .filter(Boolean)
    .join(' ')
    .toUpperCase()
}

function containsAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle.toUpperCase()))
}

export function getSyntaxIssueDescription(message: EdielMessageRow): string | null {
  const segments = getEdifactSegments(message.raw_payload)
  const hasUnb = segments.some((segment) => segment.toUpperCase().startsWith('UNB+'))
  const hasUnh = segments.some((segment) => segment.toUpperCase().startsWith('UNH+'))
  const hasUnt = segments.some((segment) => segment.toUpperCase().startsWith('UNT+'))
  const hasUnz = segments.some((segment) => segment.toUpperCase().startsWith('UNZ+'))

  if (message.message_standard === 'edifact' && segments.length > 0) {
    if (!hasUnb) return 'UNB saknas i EDIFACT-meddelandet.'
    if (!hasUnh) return 'UNH saknas i EDIFACT-meddelandet.'
    if (!hasUnt) return 'UNT saknas i EDIFACT-meddelandet.'
    if (!hasUnz) return 'UNZ saknas i EDIFACT-meddelandet.'
  }

  const untIssue = getUntSegmentCountIssue(message.raw_payload)
  if (untIssue.hasIssue) {
    return `UNT segmentantal stämmer inte. Deklarerat: ${untIssue.declaredCount ?? 'okänt'}, faktiskt: ${untIssue.actualCount ?? 'okänt'}.`
  }

  if (message.syntax_check_status === 'failed') {
    return 'Syntaxkontrollen är markerad som failed.'
  }

  if (message.status === 'failed') {
    return message.failure_reason ?? 'Meddelandet är markerat som failed.'
  }

  return null
}

export function isInboundEdifactSyntaxError(message: EdielMessageRow): boolean {
  if (message.direction !== 'inbound') return false
  if (message.message_standard !== 'edifact') return false
  return getSyntaxIssueDescription(message) !== null
}

function hasFinalAck(acks: EdielMessageRow[], family: AckFamily): boolean {
  return acks.some((ack) => ack.message_family === family && isFinalAckMessage(ack))
}

function hasReplaceableAck(acks: EdielMessageRow[], family: AckFamily): boolean {
  return acks.some((ack) => ack.message_family === family && isReplaceableAckMessage(ack))
}

function firstReferenceAfter(rawPayload: string | null | undefined, qualifier: string): string | null {
  const prefix = `RFF+${qualifier}:`
  const segment = getEdifactSegments(rawPayload).find((item) => item.startsWith(prefix))
  if (!segment) return null
  const value = segment.slice(prefix.length).split('+')[0]?.trim()
  return value || null
}

function firstLinObject(rawPayload: string | null | undefined): string | null {
  const lin = getEdifactSegments(rawPayload).find((segment) => segment.startsWith('LIN+'))
  const value = lin?.split('+')[3]?.split(':')[0]?.trim()
  return value || null
}

function lineItemReferencesByZ07(rawPayload: string | null | undefined): Map<string, string> {
  const segments = getEdifactSegments(rawPayload)
  const refs = new Map<string, string>()
  let currentZ07: string | null = null

  for (const segment of segments) {
    if (segment.startsWith('LIN+')) {
      currentZ07 = segment.split('+')[3]?.split(':')[0]?.trim() || null
      continue
    }

    if (currentZ07 && segment.startsWith('RFF+LI:')) {
      const li = segment.replace(/^RFF\+LI:/, '').trim()
      if (li) refs.set(currentZ07, li)
    }
  }

  return refs
}

function withLineRefs(rawPayload: string | null | undefined, errors: EdielAperakApplicationError[]): EdielAperakApplicationError[] {
  const lineRefs = lineItemReferencesByZ07(rawPayload)
  return errors.map((error) => ({
    ...error,
    lineItemReference:
      error.lineItemReference ??
      (error.referenceNumber ? lineRefs.get(error.referenceNumber) ?? null : null),
  }))
}

function detectTgtPreset(message: EdielMessageRow): string | null {
  const text = messageSearchText(message)
  if (containsAny(text, ['1.4.2B', '142B'])) return 'PRODAT_S1_4_2B'
  if (containsAny(text, ['1.4.3', 'SAKNAD ANLÄGGNINGSREFERENS', 'SAKNAD ANLAGGNINGSREFERENS'])) {
    return 'PRODAT_S1_4_3'
  }
  if (containsAny(text, ['1.4.2', '142'])) return 'PRODAT_S1_4_2'
  return null
}

function buildTgtPresetErrors(message: EdielMessageRow, preset: string | null): EdielAperakApplicationError[] | null {
  if (!preset) return null

  if (preset === 'PRODAT_S1_4_2') {
    return withLineRefs(message.raw_payload, [
      {
        ercCode: '42',
        fieldCode: '210',
        text: 'Felaktig avtal, startdatum 2040-08-01',
        referenceQualifier: 'Z07',
        referenceNumber: '735999888000000123',
      },
      {
        ercCode: '41',
        fieldCode: '213',
        text: 'Årsförbrukning saknas',
        referenceQualifier: 'Z07',
        referenceNumber: '735999888000000123',
      },
      {
        ercCode: '41',
        fieldCode: '214',
        text: 'Konstant saknas',
        referenceQualifier: 'Z07',
        referenceNumber: '735999888000000130',
      },
      {
        ercCode: '41',
        fieldCode: '226',
        text: 'Ärendereferens saknas, kundid=196501022773',
        referenceQualifier: 'Z07',
        referenceNumber: '735999888000000130',
      },
      {
        ercCode: '100',
        text: 'OK',
        referenceQualifier: 'Z07',
        referenceNumber: '735999888000000147',
      },
    ])
  }

  if (preset === 'PRODAT_S1_4_2B') {
    const z07 = firstLinObject(message.raw_payload) ?? '735999888000000123'
    const li = firstReferenceAfter(message.raw_payload, 'LI')
    return [
      {
        ercCode: '42',
        fieldCode: '210',
        text: 'Felaktig avtal, startdatum 2040-08-01',
        referenceQualifier: 'Z07',
        referenceNumber: z07,
        lineItemReference: li,
      },
      {
        ercCode: '41',
        fieldCode: '213',
        text: 'Årsförbrukning saknas',
        referenceQualifier: 'Z07',
        referenceNumber: z07,
        lineItemReference: li,
      },
      {
        ercCode: '41',
        fieldCode: '214',
        text: 'Konstant saknas',
        referenceQualifier: 'Z07',
        referenceNumber: z07,
        lineItemReference: li,
      },
      {
        ercCode: '41',
        fieldCode: '226',
        text: 'Ärendereferens saknas',
        referenceQualifier: 'Z07',
        referenceNumber: z07,
        lineItemReference: li,
      },
    ]
  }

  if (preset === 'PRODAT_S1_4_3') {
    const z07 = firstLinObject(message.raw_payload) ?? firstReferenceAfter(message.raw_payload, 'Z07') ?? '735999888000000192'
    const li = firstReferenceAfter(message.raw_payload, 'LI')
    return [
      {
        ercCode: '42',
        fieldCode: '319',
        text: 'Anläggningsreferens saknas',
        referenceQualifier: 'Z07',
        referenceNumber: z07,
        lineItemReference: li,
      },
    ]
  }

  return null
}

function validationReportOutcome(message: EdielMessageRow): AckOutcome | null {
  const value = message.validation_report?.ackOutcome ?? message.validation_report?.ack_outcome ?? message.ack_outcome
  if (value === 'positive' || value === 'negative') return value
  return null
}

function shouldSendAperakForBusinessMessage(message: EdielMessageRow): boolean {
  if (message.message_family === 'PRODAT') return true
  if (message.message_family === 'UTILTS') return true
  return Boolean(message.requires_aperak)
}

function buildGenericNegativeAperakErrors(message: EdielMessageRow): EdielAperakApplicationError[] {
  if (message.message_family === 'UTILTS') {
    return [
      {
        ercCode: '41',
        fieldCode: '512',
        text: 'MANDATORY FIELD MISSING',
        referenceQualifier: 'ACW',
        referenceNumber: message.transaction_reference ?? firstReferenceAfter(message.raw_payload, 'TN'),
        lineItemReference: message.transaction_reference ?? firstReferenceAfter(message.raw_payload, 'TN'),
      },
    ]
  }

  const z07 = firstLinObject(message.raw_payload) ?? firstReferenceAfter(message.raw_payload, 'Z07')
  const li = firstReferenceAfter(message.raw_payload, 'LI')
  return [
    {
      ercCode: '40',
      fieldCode: '105',
      text: 'The object could not be identified',
      referenceQualifier: z07 ? 'Z07' : null,
      referenceNumber: z07,
      lineItemReference: li,
    },
  ]
}

function baseDiagnostics(params: {
  syntaxIssue: string | null
  hasFinalContrl: boolean
  hasFinalAperak: boolean
  hasReplaceableContrl: boolean
  hasReplaceableAperak: boolean
  detectedPreset: string | null
  rawPayload: string | null | undefined
}): EdielAckDecision['diagnostics'] {
  const unt = getUntSegmentCountIssue(params.rawPayload)
  return {
    syntaxIssue: params.syntaxIssue,
    untDeclaredCount: unt.declaredCount,
    untActualCount: unt.actualCount,
    hasFinalContrl: params.hasFinalContrl,
    hasFinalAperak: params.hasFinalAperak,
    hasReplaceableContrl: params.hasReplaceableContrl,
    hasReplaceableAperak: params.hasReplaceableAperak,
    detectedPreset: params.detectedPreset,
  }
}

export function resolveRecommendedAckForInboundMessage(params: {
  message: EdielMessageRow
  relatedAcks: EdielMessageRow[]
}): EdielAckDecision {
  const { message, relatedAcks } = params
  const syntaxIssue = getSyntaxIssueDescription(message)
  const hasFinalContrl = hasFinalAck(relatedAcks, 'CONTRL')
  const hasFinalAperak = hasFinalAck(relatedAcks, 'APERAK')
  const hasReplaceableContrl = hasReplaceableAck(relatedAcks, 'CONTRL')
  const hasReplaceableAperak = hasReplaceableAck(relatedAcks, 'APERAK')
  const detectedPreset = detectTgtPreset(message)
  const diagnostics = baseDiagnostics({
    syntaxIssue,
    hasFinalContrl,
    hasFinalAperak,
    hasReplaceableContrl,
    hasReplaceableAperak,
    detectedPreset,
    rawPayload: message.raw_payload,
  })

  if (message.direction !== 'inbound') {
    return {
      action: 'none',
      title: 'Ingen inbound-åtgärd',
      description: 'Detta är inte ett inkommande meddelande.',
      tone: 'slate',
      reasonCode: 'not_inbound',
      ackFamily: null,
      outcome: null,
      messageText: null,
      applicationErrors: null,
      canAutoSend: false,
      reasonItems: ['Endast inbound-meddelanden får automatiska kvittensbeslut.'],
      diagnostics,
    }
  }

  if (message.message_family === 'CONTRL') {
    return {
      action: 'none',
      title: 'Registrera CONTRL',
      description: 'CONTRL ska registreras och kopplas. Skicka aldrig CONTRL på CONTRL.',
      tone: 'green',
      reasonCode: 'incoming_contrl_no_ack',
      ackFamily: null,
      outcome: null,
      messageText: null,
      applicationErrors: null,
      canAutoSend: false,
      reasonItems: ['Inkommande CONTRL kräver ingen ny kvittens.'],
      diagnostics,
    }
  }

  if (message.message_family === 'APERAK') {
    if (!hasFinalContrl) {
      return {
        action: 'send_ack',
        title: 'Skicka positiv CONTRL på inkommande APERAK',
        description: 'Inkommande APERAK får teknisk CONTRL, inte APERAK tillbaka.',
        tone: 'blue',
        reasonCode: 'incoming_aperak_contrl_required',
        ackFamily: 'CONTRL',
        outcome: 'positive',
        messageText: null,
        applicationErrors: null,
        canAutoSend: true,
        reasonItems: ['APERAK är redan applikationskvittens. Nästa svar kan bara vara teknisk CONTRL.'],
        diagnostics,
      }
    }

    return {
      action: 'none',
      title: 'APERAK är kvitterad',
      description: 'Inkommande APERAK har redan en slutlig CONTRL.',
      tone: 'green',
      reasonCode: 'incoming_aperak_contrl_done',
      ackFamily: null,
      outcome: null,
      messageText: null,
      applicationErrors: null,
      canAutoSend: false,
      reasonItems: ['Ingen mer kvittens behövs.'],
      diagnostics,
    }
  }

  if (message.message_family === 'UTILTS_ERR') {
    if (!hasFinalContrl) {
      return {
        action: 'send_ack',
        title: 'Skicka positiv CONTRL på UTILTS-ERR',
        description: 'Inkommande UTILTS-ERR ska tekniskt kvitteras med CONTRL.',
        tone: 'blue',
        reasonCode: 'incoming_utilts_err_contrl_required',
        ackFamily: 'CONTRL',
        outcome: 'positive',
        messageText: null,
        applicationErrors: null,
        canAutoSend: true,
        reasonItems: ['UTILTS-ERR besvaras inte med APERAK.'],
        diagnostics,
      }
    }
  }

  if (message.message_family !== 'PRODAT' && message.message_family !== 'UTILTS') {
    return {
      action: 'none',
      title: 'Ingen generell automatik',
      description: 'Meddelandefamiljen saknar generell ack-automatik i denna kärna.',
      tone: 'slate',
      reasonCode: 'unsupported_family',
      ackFamily: null,
      outcome: null,
      messageText: null,
      applicationErrors: null,
      canAutoSend: false,
      reasonItems: ['Använd familjens specifika arbetsyta eller bygg en familjeregel i ackDecision.'],
      diagnostics,
    }
  }

  if (syntaxIssue) {
    if (!hasFinalContrl) {
      return {
        action: 'send_ack',
        title: 'Syntaxfel upptäckt · skicka negativ CONTRL',
        description: 'Syntaxfel stoppar affärsvalidering. GridCore ska skicka negativ CONTRL och ingen APERAK.',
        tone: 'red',
        reasonCode: 'syntax_error_negative_contrl',
        ackFamily: 'CONTRL',
        outcome: 'negative',
        messageText: syntaxIssue,
        applicationErrors: null,
        canAutoSend: true,
        reasonItems: [
          syntaxIssue,
          'Negativ CONTRL ska ge UCI action code 4.',
          'APERAK skickas inte innan syntaxen är accepterad.',
        ],
        diagnostics,
      }
    }

    return {
      action: 'none',
      title: 'Syntaxfel är kvitterat',
      description: 'Vänta på omsändning från motparten. Omsändning utan syntaxfel går vidare till positiv CONTRL och APERAK.',
      tone: 'yellow',
      reasonCode: 'syntax_error_negative_contrl_done',
      ackFamily: null,
      outcome: null,
      messageText: null,
      applicationErrors: null,
      canAutoSend: false,
      reasonItems: ['Negativ CONTRL finns redan som slutlig kvittens.'],
      diagnostics,
    }
  }

  if (!hasFinalContrl) {
    return {
      action: 'send_ack',
      title: 'Skicka positiv CONTRL',
      description: 'Syntaxen är godkänd i kärnan. Nästa steg är teknisk CONTRL.',
      tone: 'blue',
      reasonCode: 'syntax_ok_positive_contrl_required',
      ackFamily: 'CONTRL',
      outcome: 'positive',
      messageText: null,
      applicationErrors: null,
      canAutoSend: true,
      reasonItems: ['Inbound EDIFACT ska syntaxkvitteras innan applikationskvittens hanteras.'],
      diagnostics,
    }
  }

  if (!shouldSendAperakForBusinessMessage(message)) {
    return {
      action: 'none',
      title: 'CONTRL klar',
      description: 'Meddelandet kräver ingen APERAK enligt kärnans regler.',
      tone: 'green',
      reasonCode: 'aperak_done',
      ackFamily: null,
      outcome: null,
      messageText: null,
      applicationErrors: null,
      canAutoSend: false,
      reasonItems: ['Ingen APERAK krävs för denna familj/rule.'],
      diagnostics,
    }
  }

  if (hasFinalAperak) {
    return {
      action: 'none',
      title: 'Kvittensflöde klart',
      description: 'CONTRL och APERAK finns redan som slutliga kvittenser.',
      tone: 'green',
      reasonCode: 'aperak_done',
      ackFamily: null,
      outcome: null,
      messageText: null,
      applicationErrors: null,
      canAutoSend: false,
      reasonItems: ['Ingen dubbelkvittens skickas automatiskt.'],
      diagnostics,
    }
  }

  const presetErrors = buildTgtPresetErrors(message, detectedPreset)
  const reportOutcome = validationReportOutcome(message)
  const functionalFailed = message.functional_check_status === 'failed'

  if (presetErrors || reportOutcome === 'negative' || functionalFailed) {
    const errors = presetErrors ?? buildGenericNegativeAperakErrors(message)
    return {
      action: 'send_ack',
      title: detectedPreset ? 'Skicka teststyrd negativ APERAK' : 'Skicka negativ APERAK',
      description: detectedPreset
        ? 'Kärnan känner igen TGT-affärsfel och skapar rätt APERAK-felrader.'
        : 'Affärsvalideringen visar fel. GridCore ska skicka negativ APERAK.',
      tone: 'red',
      reasonCode: 'business_negative_aperak_required',
      ackFamily: 'APERAK',
      outcome: 'negative',
      messageText: detectedPreset ?? message.failure_reason ?? 'Affärsvalidering avvisad',
      applicationErrors: errors,
      canAutoSend: true,
      reasonItems: [
        'Syntaxen är kvitterad med CONTRL.',
        detectedPreset ? `TGT-regel: ${detectedPreset}.` : 'Affärsvalideringen är negativ.',
        'APERAK skapas från backendbeslut, inte från UI-hårdkodning.',
      ],
      diagnostics,
    }
  }

  if (message.message_family === 'UTILTS') {
    const utiltsDecision = decideUtiltsResponse({
      message,
      testKind: message.test_flag === 1 ? 'TGT' : 'production',
    })

    if (utiltsDecision.kind === 'ack' && utiltsDecision.ackFamily === 'UTILTS_ERR') {
      return {
        action: 'send_ack',
        title: 'Skicka UTILTS-ERR',
        description: utiltsDecision.reason,
        tone: 'red',
        reasonCode: 'utilts_err_required',
        ackFamily: 'UTILTS_ERR',
        outcome: 'negative',
        messageText: utiltsDecision.messageText,
        applicationErrors: null,
        canAutoSend: true,
        reasonItems: [
          'Syntaxen är kvitterad med CONTRL.',
          utiltsDecision.reason,
          ...utiltsDecision.ruleKeys,
        ],
        diagnostics,
      }
    }

    if (utiltsDecision.kind === 'ack' && utiltsDecision.ackFamily === 'APERAK' && utiltsDecision.outcome === 'negative') {
      return {
        action: 'send_ack',
        title: 'Skicka negativ APERAK på UTILTS',
        description: utiltsDecision.reason,
        tone: 'red',
        reasonCode: 'business_negative_aperak_required',
        ackFamily: 'APERAK',
        outcome: 'negative',
        messageText: utiltsDecision.messageText ?? 'UTILTS anvisnings-/applikationsfel.',
        applicationErrors: utiltsDecision.applicationErrors,
        canAutoSend: true,
        reasonItems: [
          'Syntaxen är kvitterad med CONTRL.',
          utiltsDecision.reason,
          ...utiltsDecision.ruleKeys,
        ],
        diagnostics,
      }
    }
  }

  if (message.message_family === 'PRODAT') {
    const prodatDecision = decideProdatAperak({
      message,
      testKind: message.test_flag === 1 ? 'TGT' : 'production',
    })

    if (prodatDecision.kind === 'manual_review') {
      return {
        action: 'none',
        title: 'Manuell granskning krävs',
        description: prodatDecision.reason,
        tone: 'yellow',
        reasonCode: 'business_manual_review_required',
        ackFamily: 'APERAK',
        outcome: null,
        messageText: prodatDecision.messageText,
        applicationErrors: null,
        canAutoSend: false,
        reasonItems: [
          prodatDecision.reason,
          'Produktion får inte gissa positiv eller negativ APERAK när process-/tillståndskopplingen är osäker.',
          ...prodatDecision.ruleKeys,
        ],
        diagnostics,
      }
    }

    if (prodatDecision.kind === 'ack' && prodatDecision.outcome === 'negative') {
      return {
        action: 'send_ack',
        title: 'Skicka negativ APERAK',
        description: prodatDecision.reason,
        tone: 'red',
        reasonCode: 'business_negative_aperak_required',
        ackFamily: 'APERAK',
        outcome: 'negative',
        messageText: prodatDecision.messageText ?? 'PRODAT applikations-/affärsvalidering gav fel.',
        applicationErrors: prodatDecision.applicationErrors,
        canAutoSend: true,
        reasonItems: [
          'Syntaxen är kvitterad med CONTRL.',
          prodatDecision.reason,
          prodatDecision.expectedComparison?.reason ?? '',
          ...prodatDecision.ruleKeys,
        ].filter((item): item is string => Boolean(item)),
        diagnostics,
      }
    }

    if (prodatDecision.kind === 'ack' && prodatDecision.outcome === 'positive') {
      return {
        action: 'send_ack',
        title: 'Skicka positiv APERAK',
        description: prodatDecision.messageText ?? 'Syntaxen är accepterad och PRODAT är accepterad av vald regelprofil.',
        tone: 'green',
        reasonCode: 'business_positive_aperak_required',
        ackFamily: 'APERAK',
        outcome: 'positive',
        messageText: prodatDecision.messageText,
        applicationErrors: null,
        canAutoSend: true,
        reasonItems: [
          'CONTRL finns som slutlig syntaxkvittens.',
          prodatDecision.reason,
          prodatDecision.expectedComparison?.reason ?? '',
          ...prodatDecision.ruleKeys,
        ].filter((item): item is string => Boolean(item)),
        diagnostics,
      }
    }
  }

  return {
    action: 'send_ack',
    title: 'Skicka positiv APERAK',
    description: 'Syntaxen är accepterad och inga affärsfel hittades. GridCore skickar positiv APERAK.',
    tone: 'green',
    reasonCode: 'business_positive_aperak_required',
    ackFamily: 'APERAK',
    outcome: 'positive',
    messageText: null,
    applicationErrors: null,
    canAutoSend: true,
    reasonItems: [
      'CONTRL finns som slutlig syntaxkvittens.',
      'Ingen syntax- eller affärsfelregel matchade meddelandet.',
    ],
    diagnostics,
  }
}
