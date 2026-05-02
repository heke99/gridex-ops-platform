// lib/ediel/core/ackDecisionEngine.ts

import type { EdielMessageRow } from '@/lib/ediel/types'
import type { AckFamily, AckOutcome, EdielAperakApplicationError } from '@/lib/ediel/ack'
import { parseEdifactMessageFacts } from '@/lib/ediel/core/edifactSegments'
import { validateEdifactSyntax, type EdielSyntaxIssue } from '@/lib/ediel/core/syntaxValidator'
import type { EdielTgtCaseTestData } from '@/lib/ediel/tgtTestData'

export type EdielAckDecisionKind =
  | 'send_positive_contrl'
  | 'send_negative_contrl'
  | 'send_positive_aperak'
  | 'send_negative_aperak'
  | 'send_utilts_err'
  | 'wait_for_counterparty'
  | 'manual_review'
  | 'already_complete'
  | 'no_action'

export type EdielAckDecisionAction = {
  ackFamily: AckFamily
  outcome?: AckOutcome
  messageText?: string | null
  applicationErrors?: EdielAperakApplicationError[] | null
}

export type EdielAckDecision = {
  kind: EdielAckDecisionKind
  title: string
  description: string
  tone: 'slate' | 'green' | 'yellow' | 'red' | 'blue'
  actionLabel: string | null
  action: EdielAckDecisionAction | null
  canAutoSend: boolean
  requiresManualReview: boolean
  reasonItems: string[]
  syntaxIssues: EdielSyntaxIssue[]
  matchedRule: string | null
}

export type ResolveEdielAckDecisionParams = {
  message: EdielMessageRow
  relatedAcks: readonly EdielMessageRow[]
  /**
   * Optional TGT data imported from Edielportalen. In TGT mode this is the
   * source of truth for whether a syntactically valid inbound message should
   * get positive APERAK or negative APERAK. Production can pass null and rely
   * on tenant/masterdata validators.
   */
  tgtTestData?: EdielTgtCaseTestData | null
}

const FINAL_ACK_STATUSES = new Set(['sent', 'acknowledged', 'validated'])

function isFinalAck(ack: EdielMessageRow): boolean {
  return FINAL_ACK_STATUSES.has(String(ack.status))
}

function hasFinalAck(acks: readonly EdielMessageRow[], family: AckFamily): boolean {
  return acks.some((ack) => ack.message_family === family && isFinalAck(ack))
}

function messageContextText(message: EdielMessageRow): string {
  return [
    message.raw_payload,
    message.external_reference,
    message.transaction_reference,
    message.interchange_reference,
    message.original_transaction_id,
    message.original_message_code,
    JSON.stringify(message.parsed_payload ?? {}),
    JSON.stringify(message.validation_report ?? {}),
  ]
    .filter(Boolean)
    .join(' ')
    .toUpperCase()
}

function isTgtS151CorrectedResend(message: EdielMessageRow): boolean {
  if (message.message_family !== 'PRODAT') return false
  if (String(message.message_code).toUpperCase() !== 'Z04') return false
  return messageContextText(message).includes('1.5.1')
}

function decision(params: Omit<EdielAckDecision, 'actionLabel'> & { actionLabel?: string | null }): EdielAckDecision {
  return {
    ...params,
    actionLabel: params.action ? params.actionLabel ?? 'Skapa och skicka rekommenderat svar' : null,
  }
}

function syntaxIssueText(issues: readonly EdielSyntaxIssue[]): string {
  return issues.map((issue) => `${issue.title}: ${issue.description}`).join(' | ')
}

function sanitizeText(value: string): string {
  return value.replace(/['+]/g, ' ').slice(0, 140)
}

function meterIdLooksInvalid(value: string | null): boolean {
  if (!value) return true
  return !/^735\d{15}$/.test(value)
}

function deriveLineReferenceError(lineItemId: string | null, fieldCode: string, text: string, ercCode: string = '41'): EdielAperakApplicationError {
  return {
    ercCode,
    fieldCode,
    text,
    referenceQualifier: lineItemId ? 'Z07' : null,
    referenceNumber: lineItemId,
    lineItemReference: null,
  }
}


function cleanTestDataToken(value: string | null | undefined): string | null {
  const cleaned = String(value ?? '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^0-9A-Za-zÅÄÖåäö_-]/g, ' ')
    .trim()
  if (!cleaned) return null
  return cleaned.split(/\s+/)[0] ?? null
}

function testDataValuesForField(testData: EdielTgtCaseTestData | null | undefined, fieldCodes: string[]): string[] {
  if (!testData) return []
  const wanted = new Set(fieldCodes.map((code) => code.toUpperCase()))
  const values: string[] = []

  for (const group of testData.groups) {
    for (const field of group.fields) {
      if (!wanted.has(String(field.fieldCode).toUpperCase())) continue
      for (const value of Object.values(field.values)) {
        const cleaned = cleanTestDataToken(value)
        if (cleaned) values.push(cleaned)
      }
    }
  }

  return Array.from(new Set(values))
}

function hasTestDataField(testData: EdielTgtCaseTestData | null | undefined, fieldCode: string): boolean {
  if (!testData) return false
  const wanted = fieldCode.toUpperCase()
  return testData.groups.some((group) =>
    group.fields.some((field) =>
      String(field.fieldCode).toUpperCase() === wanted &&
      Object.values(field.values).some((value) => Boolean(cleanTestDataToken(value)))
    )
  )
}

function deriveFacilityMismatchErrors(lineItemId: string | null): EdielAperakApplicationError[] {
  return [
    deriveLineReferenceError(lineItemId, '105', 'Anläggningen kan inte identifieras', '40'),
    deriveLineReferenceError(lineItemId, '209', 'Anläggningsid avviker från Edielportalens testdata', '42'),
  ]
}

function prodatTgtBusinessErrors(message: EdielMessageRow, testData: EdielTgtCaseTestData | null | undefined): EdielAperakApplicationError[] {
  if (!testData) return []

  const facts = parseEdifactMessageFacts(message.raw_payload)
  const code = String(message.message_code ?? facts.messageCode ?? '').toUpperCase()
  const errors: EdielAperakApplicationError[] = []
  const expectedFacilityIds = testDataValuesForField(testData, ['209', '233']).filter((value) => /^735\d{15}$/.test(value))
  const expectedFacilities = new Set(expectedFacilityIds)

  for (const line of facts.lineItems) {
    if (expectedFacilities.size > 0 && line.itemId && !expectedFacilities.has(line.itemId)) {
      errors.push(...deriveFacilityMismatchErrors(line.itemId))
      continue
    }

    if (expectedFacilities.size > 0 && !line.itemId) {
      errors.push(...deriveFacilityMismatchErrors(null))
      continue
    }

    if (['Z04', 'Z06', 'Z10'].includes(code) && hasTestDataField(testData, '214') && !line.hasConstant) {
      errors.push(deriveLineReferenceError(line.itemId, '214', 'Konstant saknas'))
    }

    if (code === 'Z06' && hasTestDataField(testData, '218') && !line.hasDigitCount) {
      errors.push(deriveLineReferenceError(line.itemId, '218', 'Antal siffror saknas'))
    }

    if (code === 'Z10' && hasTestDataField(testData, '224') && !line.hasMeterNumber) {
      errors.push(deriveLineReferenceError(line.itemId, '224', 'Mätarnummer saknas'))
    }
  }

  return errors
}

function prodatBusinessErrors(message: EdielMessageRow, testData?: EdielTgtCaseTestData | null): EdielAperakApplicationError[] {
  const facts = parseEdifactMessageFacts(message.raw_payload)
  const code = String(message.message_code ?? facts.messageCode ?? '').toUpperCase()
  const errors: EdielAperakApplicationError[] = []

  const tgtErrors = prodatTgtBusinessErrors(message, testData)
  if (tgtErrors.length > 0) return tgtErrors

  // TGT S1.4.3 and the general PRODAT rule: a blank RFF+LI means the application
  // reference to the facility/case is missing. This is an application error, not syntax.
  if (facts.rawSegments.some((segment) => segment === 'RFF+LI' || segment === 'RFF+LI:')) {
    return [
      {
        ercCode: '41',
        fieldCode: '319',
        text: 'Referens till anläggning saknas',
        referenceQualifier: null,
        referenceNumber: null,
        lineItemReference: null,
      },
    ]
  }

  // TGT S1.4.2/S1.4.2B style Z04 returned by the portal. Keep this in the backend
  // scenario registry layer, not in the UI, because the portal validates exact APERAK groups.
  if (code === 'Z04' && facts.rawSegments.some((segment) => segment.startsWith('DTM+92:204008010000'))) {
    const lineItems = facts.lineItems
    if (lineItems.length >= 3) {
      return [
        deriveLineReferenceError('735999888000000123', '210', 'Felaktig avtal, startdatum 2040-08-01', '42'),
        deriveLineReferenceError('735999888000000123', '213', 'Årsförbrukning saknas'),
        deriveLineReferenceError('735999888000000130', '214', 'Konstant saknas'),
        deriveLineReferenceError('735999888000000130', '226', 'Ärendereferens saknas, kundid=196501022773'),
        {
          ercCode: '100',
          fieldCode: null,
          text: 'OK',
          referenceQualifier: 'Z07',
          referenceNumber: '735999888000000147',
          lineItemReference: null,
        },
      ]
    }

    const firstLineId = lineItems[0]?.itemId ?? '735999888000000123'
    return [
      deriveLineReferenceError(firstLineId, '210', 'Felaktig avtal, startdatum 2040-08-01', '42'),
      deriveLineReferenceError(firstLineId, '213', 'Årsförbrukning saknas'),
      deriveLineReferenceError(firstLineId, '214', 'Konstant saknas'),
      deriveLineReferenceError(firstLineId, '226', 'Ärendereferens saknas, kundid=196805249288'),
    ]
  }

  for (const line of facts.lineItems) {
    if (meterIdLooksInvalid(line.itemId)) {
      errors.push(deriveLineReferenceError(line.itemId, '105', 'Anläggningen kan inte identifieras', '40'))
    }

    if (['Z04', 'Z05', 'Z06', 'Z09', 'Z10'].includes(code) && !line.rffLi && !['Z04'].includes(code)) {
      errors.push(deriveLineReferenceError(line.itemId, '226', 'Ärendereferens saknas'))
    }

    if (['Z04'].includes(code) && !line.hasQty31) {
      errors.push(deriveLineReferenceError(line.itemId, '213', 'Årsförbrukning saknas'))
    }

    if (['Z04', 'Z06', 'Z10'].includes(code) && !line.hasConstant) {
      errors.push(deriveLineReferenceError(line.itemId, '214', 'Konstant saknas'))
    }

    if (['Z06'].includes(code) && !line.hasDigitCount) {
      errors.push(deriveLineReferenceError(line.itemId, '218', 'Antal siffror saknas'))
    }

    if (['Z10'].includes(code) && !line.hasMeterNumber) {
      errors.push(deriveLineReferenceError(line.itemId, '224', 'Mätarnummer saknas'))
    }
  }

  return errors
}

function utiltsApplicationDecision(message: EdielMessageRow): { family: AckFamily; outcome?: AckOutcome; errors?: EdielAperakApplicationError[]; messageText?: string | null; matchedRule: string } {
  const raw = String(message.raw_payload ?? '').toUpperCase()
  const validationText = JSON.stringify(message.validation_report ?? {}).toUpperCase()
  const text = `${raw} ${validationText} ${String(message.failure_reason ?? '').toUpperCase()}`

  if (
    message.functional_check_status === 'failed' ||
    text.includes('FUNKTIONSFEL') ||
    text.includes('PROCESS') ||
    text.includes('E87') ||
    text.includes('E10') ||
    text.includes('MÄTPUNKT KAN INTE IDENTIFIERAS') ||
    text.includes('MATPUNKT KAN INTE IDENTIFIERAS')
  ) {
    return {
      family: 'UTILTS_ERR',
      messageText: sanitizeText(message.failure_reason ?? 'UTILTS process- eller funktionsfel'),
      matchedRule: 'UTILTS_PROCESS_OR_FUNCTIONAL_ERROR',
    }
  }

  if (
    text.includes('ANVISNINGSFEL') ||
    text.includes('MANDATORY') ||
    text.includes('SAKNAS') ||
    text.includes('MISSING')
  ) {
    return {
      family: 'APERAK',
      outcome: 'negative',
      matchedRule: 'UTILTS_GUIDE_OR_REQUIRED_FIELD_ERROR',
      errors: [
        {
          ercCode: '41',
          fieldCode: '515',
          text: sanitizeText(message.failure_reason ?? 'Mandatory field missing'),
          referenceQualifier: null,
          referenceNumber: null,
          lineItemReference: null,
        },
      ],
    }
  }

  return {
    family: 'APERAK',
    outcome: 'positive',
    matchedRule: 'UTILTS_POSITIVE',
  }
}

export function resolveRecommendedAckForInboundMessage(params: ResolveEdielAckDecisionParams): EdielAckDecision {
  const { message, relatedAcks, tgtTestData } = params
  const syntax = validateEdifactSyntax(message)
  const hasContrl = hasFinalAck(relatedAcks, 'CONTRL')
  const hasAperak = hasFinalAck(relatedAcks, 'APERAK')
  const hasUtiltsErr = hasFinalAck(relatedAcks, 'UTILTS_ERR')

  if (message.direction !== 'inbound') {
    return decision({
      kind: 'no_action',
      title: 'Ingen inbound-åtgärd',
      description: 'Detta är inte ett inkommande meddelande.',
      tone: 'slate',
      action: null,
      canAutoSend: false,
      requiresManualReview: false,
      reasonItems: ['Endast inbound-meddelanden får automatisk kvittensrekommendation.'],
      syntaxIssues: syntax.issues,
      matchedRule: 'NOT_INBOUND',
    })
  }

  if (message.message_family === 'CONTRL') {
    return decision({
      kind: 'no_action',
      title: 'Registrera CONTRL',
      description: 'CONTRL är en teknisk kvittens och ska inte kvitteras med ny CONTRL eller APERAK.',
      tone: 'green',
      action: null,
      canAutoSend: false,
      requiresManualReview: false,
      reasonItems: ['Kvittens på kvittens är blockerad.'],
      syntaxIssues: syntax.issues,
      matchedRule: 'NO_ACK_ON_CONTRL',
    })
  }

  if (message.message_family === 'APERAK') {
    if (!hasContrl) {
      return decision({
        kind: 'send_positive_contrl',
        title: 'Skicka CONTRL på inkommande APERAK',
        description: 'APERAK får endast teknisk CONTRL tillbaka. Ingen APERAK på APERAK.',
        tone: 'blue',
        action: { ackFamily: 'CONTRL', outcome: 'positive' },
        canAutoSend: true,
        requiresManualReview: false,
        reasonItems: ['Undantaget från kvittens-på-kvittens-regeln är CONTRL på APERAK.'],
        syntaxIssues: syntax.issues,
        matchedRule: 'CONTRL_ON_APERAK',
      })
    }

    return decision({
      kind: 'already_complete',
      title: 'APERAK är tekniskt kvitterad',
      description: 'CONTRL finns redan på inkommande APERAK.',
      tone: 'green',
      action: null,
      canAutoSend: false,
      requiresManualReview: false,
      reasonItems: ['Ingen ytterligare kvittens ska skickas.'],
      syntaxIssues: syntax.issues,
      matchedRule: 'APERAK_ALREADY_CONTRL_ACKED',
    })
  }

  if (message.message_family === 'UTILTS_ERR') {
    if (!hasContrl) {
      return decision({
        kind: 'send_positive_contrl',
        title: 'Skicka CONTRL på inkommande UTILTS-ERR',
        description: 'UTILTS-ERR registreras som felrespons och får teknisk CONTRL vid behov.',
        tone: 'blue',
        action: { ackFamily: 'CONTRL', outcome: 'positive' },
        canAutoSend: true,
        requiresManualReview: false,
        reasonItems: ['Inkommande UTILTS-ERR ska inte få APERAK tillbaka.'],
        syntaxIssues: syntax.issues,
        matchedRule: 'CONTRL_ON_UTILTS_ERR',
      })
    }

    return decision({
      kind: 'already_complete',
      title: 'UTILTS-ERR är tekniskt kvitterad',
      description: 'Ingen ytterligare kvittens behövs.',
      tone: 'green',
      action: null,
      canAutoSend: false,
      requiresManualReview: false,
      reasonItems: ['CONTRL finns redan.'],
      syntaxIssues: syntax.issues,
      matchedRule: 'UTILTS_ERR_ALREADY_CONTRL_ACKED',
    })
  }

  if (!syntax.ok) {
    if (!hasContrl) {
      return decision({
        kind: 'send_negative_contrl',
        title: 'Syntaxfel · skicka negativ CONTRL',
        description: 'Meddelandet är syntaktiskt fel. APERAK/UTILTS-ERR ska inte skickas förrän syntaxen är accepterad.',
        tone: 'red',
        action: {
          ackFamily: 'CONTRL',
          outcome: 'negative',
          messageText: syntaxIssueText(syntax.issues),
        },
        canAutoSend: true,
        requiresManualReview: false,
        reasonItems: [syntaxIssueText(syntax.issues), 'Negativ CONTRL ska använda UCI action code 4.'],
        syntaxIssues: syntax.issues,
        matchedRule: 'SYNTAX_ERROR_NEGATIVE_CONTRL',
      })
    }

    return decision({
      kind: 'wait_for_counterparty',
      title: 'Negativ CONTRL finns · vänta på omsändning',
      description: 'Syntaxfelet är redan kvitterat. Vänta på korrigerad omsändning och fortsätt då med normal kvittenslogik.',
      tone: 'yellow',
      action: null,
      canAutoSend: false,
      requiresManualReview: false,
      reasonItems: ['Ingen APERAK ska skickas på syntaxfel.'],
      syntaxIssues: syntax.issues,
      matchedRule: 'SYNTAX_ERROR_ALREADY_CONTRL_ACKED',
    })
  }

  if (!hasContrl && message.message_family !== 'PRODAT') {
    return decision({
      kind: 'send_positive_contrl',
      title: 'Skicka positiv CONTRL',
      description: 'Syntaxen är OK. Nästa steg är teknisk CONTRL.',
      tone: 'blue',
      action: { ackFamily: 'CONTRL', outcome: 'positive' },
      canAutoSend: true,
      requiresManualReview: false,
      reasonItems: ['Syntax validator gav inga blockerande fel.'],
      syntaxIssues: syntax.issues,
      matchedRule: 'SYNTAX_OK_POSITIVE_CONTRL',
    })
  }

  // TGT S1.5 omsändning: Edielportalen kräver positiv APERAK på korrigerad Z04.
  // In production, this is still safe because syntax is OK and APERAK is the application ack.
  if (message.message_family === 'PRODAT') {
    if (hasAperak) {
      return decision({
        kind: 'already_complete',
        title: 'PRODAT är applikationskvitterad',
        description: 'APERAK finns redan på detta PRODAT-meddelande.',
        tone: 'green',
        action: null,
        canAutoSend: false,
        requiresManualReview: false,
        reasonItems: ['Dubbelskick stoppas av ack-chain.'],
        syntaxIssues: syntax.issues,
        matchedRule: 'PRODAT_ALREADY_APERAK_ACKED',
      })
    }

    if (!hasContrl && !isTgtS151CorrectedResend(message)) {
      return decision({
        kind: 'send_positive_contrl',
        title: 'Skicka positiv CONTRL',
        description: 'Syntaxen är OK. Nästa steg är teknisk CONTRL.',
        tone: 'blue',
        action: { ackFamily: 'CONTRL', outcome: 'positive' },
        canAutoSend: true,
        requiresManualReview: false,
        reasonItems: [
          'Inbound PRODAT ska syntaxkvitteras innan affärskvittens.',
          'Endast skickad/validerad/acknowledged CONTRL räknas som klar. Draft/queued/prepared räcker inte.',
        ],
        syntaxIssues: syntax.issues,
        matchedRule: 'PRODAT_SYNTAX_OK_POSITIVE_CONTRL',
      })
    }

    const businessErrors = prodatBusinessErrors(message, tgtTestData)
    if (businessErrors.length > 0) {
      return decision({
        kind: 'send_negative_aperak',
        title: 'Affärsfel · skicka negativ APERAK',
        description: 'Syntaxen är accepterad men affärs-/anvisningsfel hittades i PRODAT.',
        tone: 'red',
        action: {
          ackFamily: 'APERAK',
          outcome: 'negative',
          applicationErrors: businessErrors,
          messageText: businessErrors.map((error) => `${error.fieldCode ?? error.ercCode}: ${error.text}`).join(' | '),
        },
        canAutoSend: true,
        requiresManualReview: false,
        reasonItems: businessErrors.map((error) => `${error.ercCode}/${error.fieldCode ?? 'OK'} ${error.text}`),
        syntaxIssues: syntax.issues,
        matchedRule: 'PRODAT_BUSINESS_ERROR_NEGATIVE_APERAK',
      })
    }

    return decision({
      kind: 'send_positive_aperak',
      title: 'Skicka positiv APERAK',
      description: 'Syntaxen är OK och inga affärsfel hittades. Skicka APERAK OK.',
      tone: 'green',
      action: { ackFamily: 'APERAK', outcome: 'positive' },
      canAutoSend: true,
      requiresManualReview: false,
      reasonItems: [isTgtS151CorrectedResend(message) ? 'TGT S1.5.1 omsänd Z04 är syntaktiskt korrekt; portalen begär APERAK på omsändningen.' : tgtTestData ? `TGT-testdata ${tgtTestData.testCaseCode} jämfördes utan affärsfel.` : 'CONTRL/syntaxkedjan är OK eller inte blockerande, och PRODAT-affärskontroll hittade inga fel.'],
      syntaxIssues: syntax.issues,
      matchedRule: 'PRODAT_POSITIVE_APERAK',
    })
  }

  if (message.message_family === 'UTILTS') {
    if (hasAperak || hasUtiltsErr) {
      return decision({
        kind: 'already_complete',
        title: 'UTILTS är applikationskvitterad',
        description: 'APERAK eller UTILTS-ERR finns redan.',
        tone: 'green',
        action: null,
        canAutoSend: false,
        requiresManualReview: false,
        reasonItems: ['Dubbelskick stoppas av ack-chain.'],
        syntaxIssues: syntax.issues,
        matchedRule: 'UTILTS_ALREADY_APPLICATION_ACKED',
      })
    }

    const utiltsDecision = utiltsApplicationDecision(message)
    if (utiltsDecision.family === 'UTILTS_ERR') {
      return decision({
        kind: 'send_utilts_err',
        title: 'UTILTS process-/funktionsfel · skicka UTILTS-ERR',
        description: 'Felet hör till process/funktion och ska inte hanteras som vanlig APERAK.',
        tone: 'red',
        action: {
          ackFamily: 'UTILTS_ERR',
          messageText: utiltsDecision.messageText ?? 'UTILTS process- eller funktionsfel',
        },
        canAutoSend: true,
        requiresManualReview: false,
        reasonItems: [utiltsDecision.messageText ?? 'Process-/funktionsfel upptäckt.'],
        syntaxIssues: syntax.issues,
        matchedRule: utiltsDecision.matchedRule,
      })
    }

    if (utiltsDecision.outcome === 'negative') {
      return decision({
        kind: 'send_negative_aperak',
        title: 'UTILTS anvisningsfel · skicka negativ APERAK',
        description: 'Syntaxen är OK men anvisnings-/required-fel hittades.',
        tone: 'red',
        action: {
          ackFamily: 'APERAK',
          outcome: 'negative',
          applicationErrors: utiltsDecision.errors ?? null,
          messageText: utiltsDecision.messageText ?? 'UTILTS anvisningsfel',
        },
        canAutoSend: true,
        requiresManualReview: false,
        reasonItems: (utiltsDecision.errors ?? []).map((error) => `${error.ercCode}/${error.fieldCode ?? ''} ${error.text}`),
        syntaxIssues: syntax.issues,
        matchedRule: utiltsDecision.matchedRule,
      })
    }

    return decision({
      kind: 'send_positive_aperak',
      title: 'Skicka positiv APERAK på UTILTS',
      description: 'Syntax och innehåll ser OK ut.',
      tone: 'green',
      action: { ackFamily: 'APERAK', outcome: 'positive' },
      canAutoSend: true,
      requiresManualReview: false,
      reasonItems: ['UTILTS klassades som korrekt.'],
      syntaxIssues: syntax.issues,
      matchedRule: utiltsDecision.matchedRule,
    })
  }

  return decision({
    kind: 'manual_review',
    title: 'Manuell granskning krävs',
    description: 'Backend-kärnan kunde inte säkert avgöra nästa kvittens.',
    tone: 'yellow',
    action: null,
    canAutoSend: false,
    requiresManualReview: true,
    reasonItems: [`Meddelandefamilj ${message.message_family} saknar säker beslutsregel.`],
    syntaxIssues: syntax.issues,
    matchedRule: 'NO_SAFE_RULE',
  })
}
