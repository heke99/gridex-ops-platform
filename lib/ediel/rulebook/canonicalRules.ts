import type { AckFamily, AckOutcome } from '@/lib/ediel/ack'
import { CANONICAL_EDIEL_ERRORS } from '@/lib/ediel/rulebook/mapEdielError'
import {
  isUtiltsApplicationReferenceMessageCode,
  isUtiltsRequestMessageCode,
  resolveVerifiedUtiltsApplicationReference,
} from '@/lib/ediel/rulebook/utiltsApplicationReference'

export type CanonicalRuleSeverity = 'blocking' | 'manual_review' | 'warning'
export type CanonicalRuleScope = 'common' | 'routing' | 'security' | 'ack_lifecycle' | 'unsupported' | 'application_reference'

export type CanonicalEdielRule = {
  key: string
  scope: CanonicalRuleScope
  severity: CanonicalRuleSeverity
  title: string
  description: string
  source: string
  adminOverridable: false
}

export const CANONICAL_EDIEL_RULES: CanonicalEdielRule[] = [
  {
    key: 'ACK_NO_APERAK_ON_APERAK',
    scope: 'ack_lifecycle',
    severity: 'blocking',
    title: 'APERAK får inte skickas på APERAK',
    description: 'Kvittens på kvittens ska blockeras. APERAK får inte besvaras med APERAK.',
    source: 'Generella tekniska regler 24.A / TGT PRODAT-UTILTS 6.0.5',
    adminOverridable: false,
  },
  {
    key: 'ACK_NO_APERAK_ON_CONTRL',
    scope: 'ack_lifecycle',
    severity: 'blocking',
    title: 'APERAK får inte skickas på CONTRL',
    description: 'CONTRL är teknisk kvittens och ska inte få APERAK som svar.',
    source: 'Generella tekniska regler 24.A',
    adminOverridable: false,
  },
  {
    key: 'ACK_NO_CONTRL_ON_CONTRL',
    scope: 'ack_lifecycle',
    severity: 'blocking',
    title: 'CONTRL får inte skickas på CONTRL',
    description: 'Teknisk kvittens på teknisk kvittens ska blockeras.',
    source: 'Generella tekniska regler 24.A',
    adminOverridable: false,
  },
  {
    key: 'ACK_CONTRL_ON_APERAK_ONLY',
    scope: 'ack_lifecycle',
    severity: 'blocking',
    title: 'APERAK ska bara få CONTRL som teknisk kvittens',
    description: 'Inkommande APERAK ska länkas till originalflödet och få CONTRL, inte ny APERAK.',
    source: 'Generella tekniska regler 24.A',
    adminOverridable: false,
  },
  {
    key: 'ACK_FIRST_FINAL_WINS',
    scope: 'ack_lifecycle',
    severity: 'blocking',
    title: 'Första finala APERAK gäller',
    description: 'Om positiv eller negativ final APERAK redan skickats får motsatt final ACK inte skickas senare.',
    source: 'PRODAT/APERAK 16.B',
    adminOverridable: false,
  },
  {
    key: 'PRODAT_ONE_APERAK_PER_SOURCE',
    scope: 'ack_lifecycle',
    severity: 'blocking',
    title: 'En APERAK per käll-PRODAT',
    description: 'En APERAK får inte agera svar på flera separata PRODAT-meddelanden.',
    source: 'PRODAT/APERAK 16.B',
    adminOverridable: false,
  },
  {
    key: 'PRODAT_MULTI_FACILITY_PARTIAL_ACK',
    scope: 'ack_lifecycle',
    severity: 'blocking',
    title: 'Multi-facility APERAK ska stödja delgodkännande',
    description: 'Om ett PRODAT innehåller flera anläggningar ska korrekt anläggning kunna godkännas medan felaktig anläggning avvisas.',
    source: 'PRODAT/APERAK 16.B',
    adminOverridable: false,
  },
  {
    key: 'PRODAT_Z01_APERAK_EXCEPTION',
    scope: 'ack_lifecycle',
    severity: 'warning',
    title: 'PRODAT Z01 har APERAK-undantag',
    description: 'Z01 ska inte behandlas med samma obligatoriska APERAK-policy som övriga PRODAT-meddelanden.',
    source: 'PRODAT/APERAK 16.B',
    adminOverridable: false,
  },
  {
    key: 'APPREF_DGI_FOR_PERMISSION',
    scope: 'application_reference',
    severity: 'blocking',
    title: 'Z13/Z14/Z15/Z18 kräver 23-DGI-PRODAT',
    description: 'Tillståndsflöden för energitjänsteföretag ska inte skickas som 23-DDQ-PRODAT.',
    source: 'PRODAT 26.A',
    adminOverridable: false,
  },
  {
    key: 'APPREF_DDQ_FOR_SUPPLIER',
    scope: 'application_reference',
    severity: 'blocking',
    title: 'Leverantörs-PRODAT kräver 23-DDQ-PRODAT',
    description: 'Svenska leverantörsflöden Z01/Z02/Z03/Z04/Z05/Z06/Z08/Z09/Z10 använder 23-DDQ-PRODAT.',
    source: 'PRODAT 26.A',
    adminOverridable: false,
  },
  {
    key: 'APPREF_UTILTS_EXACT_MATRIX',
    scope: 'application_reference',
    severity: 'blocking',
    title: 'UTILTS Application Reference måste följa fält 311 exakt',
    description: 'Application Reference valideras mot den exakta svenska matrisen. Begäran använder Application Reference för den meddelandetyp som begärs.',
    source: 'UTILTS & APERAK 25.A.3, fält 311',
    adminOverridable: false,
  },
  {
    key: 'ROUTE_PRODAT_PORTAL_RECEIVER_SUBADDRESS',
    scope: 'routing',
    severity: 'blocking',
    title: 'Edielportalen PRODAT kräver subadress PRODAT',
    description: 'Portalens PRODAT-mottagare ska adresseras som 91100:ZZ:PRODAT och 91100@ediel.se.',
    source: 'AGT PRODAT 5.0.2',
    adminOverridable: false,
  },
  {
    key: 'SECURITY_PRODAT_RECEIVER_CERTIFICATE',
    scope: 'security',
    severity: 'blocking',
    title: 'PRODAT krypteras till mottagaren',
    description: 'S/MIME/CMS ska krypteras till mottagarens publika certifikat och recipientInfo ska matcha mottagaren.',
    source: 'Generella tekniska regler 24.A',
    adminOverridable: false,
  },
  {
    key: 'UNSUPPORTED_NBS_XML',
    scope: 'unsupported',
    severity: 'manual_review',
    title: 'NBS/XML/eSett ingår inte i Batch 4',
    description: 'NBS/XML ska blockeras eller skickas till manual review tills separat batch byggs.',
    source: 'Batch 4 scope',
    adminOverridable: false,
  },
  {
    key: 'UNSUPPORTED_GAS',
    scope: 'unsupported',
    severity: 'manual_review',
    title: 'Gas/naturgas ingår inte i Batch 4',
    description: 'Application Reference 27-DDQ-PRODAT och gasmarknad ska blockeras eller hanteras manuellt.',
    source: 'Batch 4 scope',
    adminOverridable: false,
  },
  {
    key: 'UNSUPPORTED_ECP_EDX',
    scope: 'unsupported',
    severity: 'manual_review',
    title: 'ECP/EDX ingår inte i Batch 4',
    description: 'SMTP/IMAP används nu. ECP/EDX ska inte aktiveras i denna batch.',
    source: 'Batch 4 scope',
    adminOverridable: false,
  },
]

export type AckLifecycleGuardInput = {
  sourceFamily: AckFamily | string | null | undefined
  desiredFamily: AckFamily | string | null | undefined
  desiredOutcome?: AckOutcome | null
  finalAckAlreadySent?: { family: string; outcome: AckOutcome | null } | null
}

export type AckLifecycleGuardResult = {
  ok: boolean
  ruleKeys: string[]
  reason: string | null
}

export function evaluateCanonicalAckLifecycle(input: AckLifecycleGuardInput): AckLifecycleGuardResult {
  const source = String(input.sourceFamily ?? '').toUpperCase()
  const desired = String(input.desiredFamily ?? '').toUpperCase()
  const ruleKeys: string[] = []

  if (source === 'APERAK' && desired === 'APERAK') ruleKeys.push('ACK_NO_APERAK_ON_APERAK')
  if (source === 'CONTRL' && desired === 'APERAK') ruleKeys.push('ACK_NO_APERAK_ON_CONTRL')
  if (source === 'CONTRL' && desired === 'CONTRL') ruleKeys.push('ACK_NO_CONTRL_ON_CONTRL')
  if (source === 'APERAK' && desired !== 'CONTRL') ruleKeys.push('ACK_CONTRL_ON_APERAK_ONLY')

  const finalAck = input.finalAckAlreadySent
  if (finalAck && desired === 'APERAK' && finalAck.family === 'APERAK' && finalAck.outcome && input.desiredOutcome && finalAck.outcome !== input.desiredOutcome) {
    ruleKeys.push('ACK_FIRST_FINAL_WINS')
  }

  return {
    ok: ruleKeys.length === 0,
    ruleKeys,
    reason: ruleKeys.length > 0 ? `Canonical ACK guard blocked: ${ruleKeys.join(', ')}` : null,
  }
}

export type ApplicationReferenceGuardResult = {
  ok: boolean
  expectedApplicationReference: string | null
  ruleKeys: string[]
  reason: string | null
}

export function evaluateApplicationReferenceGuard(input: {
  family: string | null | undefined
  messageCode: string | null | undefined
  applicationReference: string | null | undefined
  requestedMessageCode?: string | null | undefined
}): ApplicationReferenceGuardResult {
  const family = String(input.family ?? '').toUpperCase()
  const code = String(input.messageCode ?? '').toUpperCase()
  const appRef = String(input.applicationReference ?? '').trim().toUpperCase()
  const permissionCodes = new Set(['Z13', 'Z14', 'Z15', 'Z18'])
  const supplierCodes = new Set(['Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09', 'Z10'])

  if (appRef === '27-DDQ-PRODAT') {
    return { ok: false, expectedApplicationReference: null, ruleKeys: ['UNSUPPORTED_GAS'], reason: 'Gas/naturgas ingår inte i Batch 4.' }
  }

  if (family === 'UTILTS') {
    if (!isUtiltsApplicationReferenceMessageCode(code) && !isUtiltsRequestMessageCode(code)) {
      return {
        ok: false,
        expectedApplicationReference: null,
        ruleKeys: ['APPREF_UTILTS_EXACT_MATRIX'],
        reason: `UTILTS ${code || 'utan meddelandekod'} saknar verifierad Application Reference-regel.`,
      }
    }

    try {
      const resolved = resolveVerifiedUtiltsApplicationReference({
        messageCode: code,
        requestedMessageCode: input.requestedMessageCode,
        applicationReference: appRef || null,
      })
      return {
        ok: true,
        expectedApplicationReference: resolved,
        ruleKeys: [],
        reason: null,
      }
    } catch (error) {
      return {
        ok: false,
        expectedApplicationReference: null,
        ruleKeys: ['APPREF_UTILTS_EXACT_MATRIX'],
        reason: error instanceof Error ? error.message : 'UTILTS Application Reference kunde inte verifieras.',
      }
    }
  }

  if (family !== 'PRODAT') {
    return { ok: true, expectedApplicationReference: null, ruleKeys: [], reason: null }
  }

  if (permissionCodes.has(code)) {
    const ok = !appRef || appRef === '23-DGI-PRODAT'
    return {
      ok,
      expectedApplicationReference: '23-DGI-PRODAT',
      ruleKeys: ok ? [] : ['APPREF_DGI_FOR_PERMISSION'],
      reason: ok ? null : `${code} ska använda 23-DGI-PRODAT, inte ${input.applicationReference}.`,
    }
  }

  if (supplierCodes.has(code)) {
    const ok = !appRef || appRef === '23-DDQ-PRODAT'
    return {
      ok,
      expectedApplicationReference: '23-DDQ-PRODAT',
      ruleKeys: ok ? [] : ['APPREF_DDQ_FOR_SUPPLIER'],
      reason: ok ? null : `${code} ska använda 23-DDQ-PRODAT, inte ${input.applicationReference}.`,
    }
  }

  return {
    ok: false,
    expectedApplicationReference: null,
    ruleKeys: ['APPREF_DDQ_FOR_SUPPLIER'],
    reason: `PRODAT ${code || 'utan meddelandekod'} ingår inte i den verifierade svenska 26.A-funktionslistan.`,
  }
}

export function canonicalRulebookSummary() {
  return {
    rules: CANONICAL_EDIEL_RULES,
    errorMappings: CANONICAL_EDIEL_ERRORS,
    scope: 'EDIFACT only: PRODAT, UTILTS, APERAK, CONTRL, UTILTS_ERR',
    excluded: ['NBS/XML/eSett', 'BRP/trader XML', 'gas/naturgas', 'ECP/EDX', 'full bilateral test manager'],
  }
}
