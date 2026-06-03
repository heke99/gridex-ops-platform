export type EdielInboundMessageFamily = 'PRODAT' | 'UTILTS' | 'CONTRL' | 'APERAK' | 'UTILTS_ERR' | string

export type ProductionInboundScenario =
  | 'prodat_permission_approved'
  | 'prodat_permission_rejected'
  | 'prodat_permission_terminated'
  | 'utilts_e66_quarter_values'
  | 'utilts_e66_sch_values'
  | 'unknown'

export type ProductionInboundBusinessEffect =
  | 'activate_permission'
  | 'reject_permission'
  | 'terminate_permission'
  | 'import_meter_values'
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
}

export type ProductionInboundDecisionInput = {
  messageFamily?: EdielInboundMessageFamily | null
  messageCode?: string | null
  rawPayload?: string | null
  utiltsResolution?: 'quarter' | 'sch' | 'hour' | 'month' | string | null
}

function normalize(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

function rawContainsAny(rawPayload: string | null | undefined, needles: readonly string[]): boolean {
  const raw = normalize(rawPayload)
  return needles.some((needle) => raw.includes(needle.toUpperCase()))
}

function inferUtiltsResolution(input: ProductionInboundDecisionInput): 'quarter' | 'sch' | 'unknown' {
  const explicit = normalize(input.utiltsResolution)
  if (['QUARTER', 'KVART', '15', 'PT15M'].includes(explicit)) return 'quarter'
  if (explicit === 'SCH') return 'sch'

  const raw = normalize(input.rawPayload)
  if (!raw) return 'unknown'
  if (raw.includes('DTM+354:15:804') || raw.includes('PT15M') || raw.includes('KVART')) return 'quarter'
  if (raw.includes('SCH')) return 'sch'
  return 'unknown'
}

export function classifyProductionInboundDecision(input: ProductionInboundDecisionInput): ProductionInboundDecision {
  const family = normalize(input.messageFamily)
  const raw = normalize(input.rawPayload)
  let code = normalize(input.messageCode) || null
  const notes: string[] = []

  if (family === 'PRODAT' && code === 'Z14') {
    if (raw.includes('Z14V')) code = 'Z14V'
    else if (raw.includes('Z14N')) code = 'Z14N'
  }
  if (family === 'PRODAT' && code === 'Z15') {
    if (raw.includes('Z15V')) code = 'Z15V'
  }

  if (family === 'PRODAT' && code === 'Z14V') {
    return {
      scenario: 'prodat_permission_approved',
      messageFamily: family,
      messageCode: code,
      direction: 'inbound',
      requiresPrivateDecryption: true,
      expectedResponses: ['CONTRL', 'APERAK'],
      businessEffect: 'activate_permission',
      manualReviewRequired: false,
      uiLabel: 'PRODAT Z14V - tillstånd/fullmakt godkänd',
      notes: [
        'Inbound PRODAT ska dekrypteras med mottagande aktörs privata PFX om mailet är S/MIME.',
        'Positiv CONTRL kan skickas när syntaxen är korrekt; APERAK-beslut styrs av affärsvalideringen.',
      ],
    }
  }

  if (family === 'PRODAT' && code === 'Z14N') {
    return {
      scenario: 'prodat_permission_rejected',
      messageFamily: family,
      messageCode: code,
      direction: 'inbound',
      requiresPrivateDecryption: true,
      expectedResponses: ['CONTRL', 'APERAK'],
      businessEffect: 'reject_permission',
      manualReviewRequired: false,
      uiLabel: 'PRODAT Z14N - tillstånd/fullmakt nekad',
      notes: [
        'Z14N kan vara affärsmässigt negativt men tekniskt korrekt.',
        'Spara orsak/status på kund, anläggning och tillståndsflöde.',
      ],
    }
  }

  if (family === 'PRODAT' && code === 'Z15V') {
    return {
      scenario: 'prodat_permission_terminated',
      messageFamily: family,
      messageCode: code,
      direction: 'inbound',
      requiresPrivateDecryption: true,
      expectedResponses: ['CONTRL', 'APERAK'],
      businessEffect: 'terminate_permission',
      manualReviewRequired: false,
      uiLabel: 'PRODAT Z15V - tillstånd/fullmakt upphör',
      notes: [
        'Matcha mot befintligt tillstånd innan affärsuppdatering.',
        'Om tillståndet inte kan identifieras ska positiv CONTRL och negativ APERAK användas där regeln kräver det.',
      ],
    }
  }

  if (family === 'UTILTS' && (code === 'E66' || rawContainsAny(input.rawPayload, ['BGM+E66']))) {
    const resolution = inferUtiltsResolution(input)
    if (resolution === 'quarter') {
      return {
        scenario: 'utilts_e66_quarter_values',
        messageFamily: family,
        messageCode: code ?? 'E66',
        direction: 'inbound',
        requiresPrivateDecryption: false,
        expectedResponses: ['CONTRL', 'APERAK'],
        businessEffect: 'import_meter_values',
        manualReviewRequired: false,
        uiLabel: 'UTILTS E66 - kvartsmätvärden',
        notes: [
          'UTILTS ska normalt inte kräva S/MIME i detta flöde.',
          'Importera mätvärden först efter att mätpunkt och period matchats säkert.',
        ],
      }
    }
    if (resolution === 'sch') {
      return {
        scenario: 'utilts_e66_sch_values',
        messageFamily: family,
        messageCode: code ?? 'E66',
        direction: 'inbound',
        requiresPrivateDecryption: false,
        expectedResponses: ['CONTRL', 'APERAK'],
        businessEffect: 'import_meter_values',
        manualReviewRequired: false,
        uiLabel: 'UTILTS E66 - SCH/månadsavlästa mätvärden',
        notes: [
          'UTILTS E66 SCH ska hanteras av samma produktionsmotor som UE2-testet.',
          'Funktionsfel enligt UTILTS-regler kan kräva UTILTS_ERR i stället för APERAK.',
        ],
      }
    }
    notes.push('UTILTS E66 hittades men upplösningen kunde inte klassificeras säkert.')
  }

  return {
    scenario: 'unknown',
    messageFamily: family || 'UNKNOWN',
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
  }
}
