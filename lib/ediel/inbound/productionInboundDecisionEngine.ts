import { decideProdatAperak } from '@/lib/ediel/decisionEngine'
import { selectRuleProfile, summarizeRuleProfile } from '@/lib/ediel/rulebook/ruleProfileSelector'

export type EdielInboundMessageFamily = 'PRODAT' | 'UTILTS' | 'CONTRL' | 'APERAK' | 'UTILTS_ERR' | string

export type ProductionInboundScenario =
  | 'prodat_permission_approved'
  | 'prodat_permission_rejected'
  | 'prodat_permission_terminated'
  | 'prodat_permission_requested'
  | 'prodat_permission_termination_requested'
  | 'prodat_permission_manual_review'
  | 'prodat_other'
  | 'utilts_e66_quarter_values'
  | 'utilts_e66_hour_values'
  | 'utilts_e66_sch_values'
  | 'utilts_e31_values'
  | 'utilts_other'
  | 'ack_message'
  | 'unknown'

export type ProductionInboundBusinessEffect =
  | 'activate_permission'
  | 'reject_permission'
  | 'terminate_permission'
  | 'request_permission'
  | 'request_permission_termination'
  | 'import_meter_values'
  | 'register_ack'
  | 'none'

export type ProductionInboundDecision = {
  scenario: ProductionInboundScenario
  messageFamily: string
  messageCode: string | null
  direction: 'inbound'
  requiresPrivateDecryption: boolean
  expectedResponses: Array<'CONTRL' | 'APERAK' | 'UTILTS_ERR'>
  businessEffect: ProductionInboundBusinessEffect
  manualReviewRequired: boolean
  uiLabel: string
  notes: string[]
  ruleProfileId?: string
  classification?: Record<string, unknown>
}

export type ProductionInboundDecisionInput = {
  messageFamily?: EdielInboundMessageFamily | null
  messageCode?: string | null
  rawPayload?: string | null
  utiltsResolution?: 'quarter' | 'sch' | 'hour' | 'month' | string | null
  processType?: string | null
  actorRole?: string | null
}

function normalize(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

function prodatUiLabel(scenario: ProductionInboundScenario, code: string | null): string {
  switch (scenario) {
    case 'prodat_permission_requested':
      return 'PRODAT Z13 - begäran om tillgång/fullmakt'
    case 'prodat_permission_approved':
      return 'PRODAT Z14 - tillstånd/fullmakt godkänd'
    case 'prodat_permission_rejected':
      return 'PRODAT Z14 - tillstånd/fullmakt nekad'
    case 'prodat_permission_terminated':
      return 'PRODAT Z15 - tillstånd/fullmakt upphör'
    case 'prodat_permission_termination_requested':
      return 'PRODAT Z18 - begäran om avslut av tillstånd'
    case 'prodat_permission_manual_review':
      return `PRODAT ${code ?? ''} - tillståndsflöde kräver granskning`.trim()
    default:
      return `PRODAT ${code ?? ''} - mottaget meddelande`.trim()
  }
}

export function classifyProductionInboundDecision(input: ProductionInboundDecisionInput): ProductionInboundDecision {
  const classification = selectRuleProfile({
    family: input.messageFamily ?? null,
    messageCode: input.messageCode ?? null,
    rawPayload: input.rawPayload ?? null,
    processType: input.utiltsResolution ?? input.processType ?? null,
    actorRole: input.actorRole ?? null,
    testKind: 'production',
  })

  const family = normalize(classification.family) || 'UNKNOWN'
  const code = classification.messageCode
  const notes: string[] = [
    `Rule profile: ${classification.ruleProfileId}`,
    ...classification.matchedSignals,
  ]

  if (classification.manualReviewReason) notes.push(classification.manualReviewReason)

  if (family === 'PRODAT') {
    const prodatDecision = decideProdatAperak({
      rawPayload: input.rawPayload ?? null,
      family: family,
      messageCode: code,
      applicationReference: input.rawPayload?.includes('23-DGI-PRODAT') ? '23-DGI-PRODAT' : null,
      processType: classification.processType,
      actorRole: input.actorRole ?? null,
      testKind: 'production',
    })
    const manualReviewRequired =
      classification.applicationValidity !== 'valid' || classification.confidence === 'low' || prodatDecision.kind === 'manual_review'

    let scenario: ProductionInboundScenario = 'prodat_other'
    let businessEffect: ProductionInboundBusinessEffect = 'none'

    if (classification.businessResult === 'permission_requested') {
      scenario = 'prodat_permission_requested'
      businessEffect = 'request_permission'
    } else if (classification.businessResult === 'permission_approved') {
      scenario = 'prodat_permission_approved'
      businessEffect = 'activate_permission'
    } else if (classification.businessResult === 'permission_rejected') {
      scenario = 'prodat_permission_rejected'
      businessEffect = 'reject_permission'
      notes.push('Z14N är ett affärsbesked om nekad tillgång. Det är inte automatiskt negativ APERAK om payload/process är korrekt.')
    } else if (classification.businessResult === 'permission_terminated') {
      scenario = 'prodat_permission_terminated'
      businessEffect = 'terminate_permission'
    } else if (classification.businessResult === 'permission_termination_requested') {
      scenario = 'prodat_permission_termination_requested'
      businessEffect = 'request_permission_termination'
    } else if (classification.ruleProfileId.startsWith('prodat_permission')) {
      scenario = 'prodat_permission_manual_review'
    }

    return {
      scenario,
      messageFamily: family,
      messageCode: code,
      direction: 'inbound',
      requiresPrivateDecryption: true,
      expectedResponses: ['CONTRL', 'APERAK'],
      businessEffect,
      manualReviewRequired,
      uiLabel: prodatUiLabel(scenario, code),
      notes: [
        'Inbound PRODAT ska dekrypteras med mottagande aktörs privata PFX om mailet är S/MIME.',
        'Positiv CONTRL styrs av syntax. APERAK styrs av vald regelprofil och affärsvalidering.',
        prodatDecision.reason,
        ...notes,
      ],
      ruleProfileId: classification.ruleProfileId,
      classification: summarizeRuleProfile(classification),
    }
  }

  if (family === 'UTILTS') {
    let scenario: ProductionInboundScenario = 'utilts_other'
    if (code === 'E66' && classification.variant === 'quarter') scenario = 'utilts_e66_quarter_values'
    else if (code === 'E66' && classification.variant === 'hour') scenario = 'utilts_e66_hour_values'
    else if (code === 'E66' && (classification.variant === 'sch' || classification.variant === 'month')) scenario = 'utilts_e66_sch_values'
    else if (code === 'E31') scenario = 'utilts_e31_values'

    return {
      scenario,
      messageFamily: family,
      messageCode: code ?? (normalize(input.messageCode) || null),
      direction: 'inbound',
      requiresPrivateDecryption: false,
      expectedResponses: ['CONTRL', 'APERAK'],
      businessEffect: code === 'E66' || code === 'E31' ? 'import_meter_values' : 'none',
      manualReviewRequired: classification.applicationValidity === 'uncertain' && classification.variant === 'unknown',
      uiLabel:
        scenario === 'utilts_e66_quarter_values'
          ? 'UTILTS E66 - kvartsmätvärden'
          : scenario === 'utilts_e66_hour_values'
            ? 'UTILTS E66 - timvärden'
            : scenario === 'utilts_e66_sch_values'
              ? 'UTILTS E66 - SCH/månadsavlästa mätvärden'
              : scenario === 'utilts_e31_values'
                ? 'UTILTS E31 - andelstal/mätvärdesunderlag'
                : `UTILTS ${code ?? ''} - mottaget meddelande`.trim(),
      notes: [
        'UTILTS ska normalt inte kräva S/MIME i detta flöde.',
        'Syntaxfel går till CONTRL, anvisnings-/applikationsfel till negativ APERAK och funktions-/processfel till UTILTS_ERR.',
        ...notes,
      ],
      ruleProfileId: classification.ruleProfileId,
      classification: summarizeRuleProfile(classification),
    }
  }

  if (family === 'CONTRL' || family === 'APERAK' || family === 'UTILTS_ERR') {
    return {
      scenario: 'ack_message',
      messageFamily: family,
      messageCode: code,
      direction: 'inbound',
      requiresPrivateDecryption: false,
      expectedResponses: classification.expectedResponses,
      businessEffect: 'register_ack',
      manualReviewRequired: false,
      uiLabel: `${family} - inkommande kvittens`,
      notes: ['Kvittensmeddelanden ska registreras och korreleras, inte behandlas som ny affärsbegäran.', ...notes],
      ruleProfileId: classification.ruleProfileId,
      classification: summarizeRuleProfile(classification),
    }
  }

  return {
    scenario: 'unknown',
    messageFamily: family,
    messageCode: code,
    direction: 'inbound',
    requiresPrivateDecryption: family === 'PRODAT',
    expectedResponses: family ? ['CONTRL'] : [],
    businessEffect: 'none',
    manualReviewRequired: true,
    uiLabel: 'Okänt eller ofullständigt inbound Ediel-meddelande',
    notes: notes.length
      ? notes
      : ['Lägg i unresolved/dead-letter tills meddelandetyp, mottagare och affärsobjekt kan matchas säkert.'],
    ruleProfileId: classification.ruleProfileId,
    classification: summarizeRuleProfile(classification),
  }
}
