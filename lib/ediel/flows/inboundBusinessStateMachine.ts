import type { EdielMessageRow } from '@/lib/ediel/types'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { resolveUtiltsInboundBusinessOutcome } from '@/lib/ediel/utilts/inboundBusinessOutcome'
import {
  applyInboundBusinessStateMachine as applyLegacyInboundBusinessStateMachine,
  type InboundBusinessOutcome as LegacyInboundBusinessOutcome,
  type InboundBusinessStateResult as LegacyInboundBusinessStateResult,
} from './inboundBusinessStateMachineLegacy'

export type InboundBusinessOutcome =
  | Exclude<LegacyInboundBusinessOutcome, 'ignored'>
  | 'metering_forecast_received'
  | 'grid_area_values_received'
  | 'non_billing_object_series_received'
  | 'metering_values_request_received'

export type InboundBusinessStateResult = Omit<LegacyInboundBusinessStateResult, 'outcome'> & {
  outcome: InboundBusinessOutcome
}

export type InboundBusinessStateInput = {
  actorUserId: string
  message: EdielMessageRow
  matchedSwitchRequestId?: string | null
  customerInfoRequestId?: string | null
  source?: string
}

function referenceDate(message: EdielMessageRow): string {
  const date = String(message.message_received_at ?? message.created_at ?? '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`canonical_inbound_state_reference_date_missing:${message.id}`)
  }
  return date
}

function utiltsStateResult(message: EdielMessageRow): InboundBusinessStateResult {
  const policy = resolveCanonicalEdielPolicy({
    family: 'UTILTS',
    messageCode: String(message.message_code ?? ''),
    direction: 'inbound',
    referenceDate: referenceDate(message),
    associationAssignedCode: message.message_version,
    applicationReference: message.application_reference,
    mode: 'parse',
  })
  const business = resolveUtiltsInboundBusinessOutcome(policy)

  if (!business.allowIndividualCustomerLink && (message.customer_id || message.site_id || message.metering_point_id)) {
    return {
      outcome: 'manual_review_required',
      tenantMessage: `${policy.code} har canonical ${policy.semantics.dataScope}-scope och får inte appliceras på en individuell kund eller mätpunkt.`,
      reviewRequired: true,
      updated: [],
      metadata: {
        canonicalPolicy: policy.profileKey,
        utiltsBusinessOutcome: business.kind,
        dataScope: policy.semantics.dataScope,
        sideEffectsApplied: false,
        reason: 'individual_customer_link_forbidden',
      },
    }
  }

  if (business.kind === 'actual_metering_values') {
    return {
      outcome: 'metering_values_received',
      tenantMessage: 'Faktiska individuella mätvärden är mottagna och får gå vidare till den canonicala mätvärdes-/billing-gaten.',
      reviewRequired: false,
      updated: [],
      metadata: {
        canonicalPolicy: policy.profileKey,
        utiltsBusinessOutcome: business.kind,
        dataScope: policy.semantics.dataScope,
        billingConsumptionAllowed: business.allowBillingConsumption,
      },
    }
  }

  if (business.kind === 'forecast_only') {
    return {
      outcome: 'metering_forecast_received',
      tenantMessage: 'Förbrukningsprognos är mottagen. Den lagras som prognos och får inte behandlas som faktureringsförbrukning.',
      reviewRequired: false,
      updated: [],
      metadata: {
        canonicalPolicy: policy.profileKey,
        utiltsBusinessOutcome: business.kind,
        dataScope: policy.semantics.dataScope,
        billingConsumptionAllowed: false,
      },
    }
  }

  if (business.kind === 'grid_area_aggregate') {
    return {
      outcome: 'grid_area_values_received',
      tenantMessage: 'Aggregerade UTILTS-värden är mottagna på nätområdesnivå och får inte appliceras på en individuell kund.',
      reviewRequired: false,
      updated: [],
      metadata: {
        canonicalPolicy: policy.profileKey,
        utiltsBusinessOutcome: business.kind,
        dataScope: policy.semantics.dataScope,
        billingConsumptionAllowed: false,
      },
    }
  }

  if (business.kind === 'object_time_series_non_billing') {
    return {
      outcome: 'non_billing_object_series_received',
      tenantMessage: 'Objektets UTILTS-tidsserie är mottagen som non-billing data.',
      reviewRequired: false,
      updated: [],
      metadata: {
        canonicalPolicy: policy.profileKey,
        utiltsBusinessOutcome: business.kind,
        dataScope: policy.semantics.dataScope,
        billingConsumptionAllowed: false,
      },
    }
  }

  if (business.kind === 'missing_values_request') {
    return {
      outcome: 'metering_values_request_received',
      tenantMessage: 'Begäran om saknade UTILTS-värden är mottagen och klassificerad som request, inte som mätvärdesleverans.',
      reviewRequired: false,
      updated: [],
      metadata: {
        canonicalPolicy: policy.profileKey,
        utiltsBusinessOutcome: business.kind,
        dataScope: policy.semantics.dataScope,
        billingConsumptionAllowed: false,
      },
    }
  }

  if (business.kind === 'functional_rejection') {
    return {
      outcome: 'metering_values_error',
      tenantMessage: 'UTILTS funktionellt fel är mottaget och kräver fel-/ACK-hantering, inte mätvärdes- eller billing-side-effects.',
      reviewRequired: true,
      updated: [],
      metadata: {
        canonicalPolicy: policy.profileKey,
        utiltsBusinessOutcome: business.kind,
        dataScope: policy.semantics.dataScope,
        billingConsumptionAllowed: false,
      },
    }
  }

  const exhaustive: never = business.kind
  throw new Error(`canonical_utilts_business_outcome_unhandled:${String(exhaustive)}`)
}

/**
 * Active inbound state facade. UTILTS is classified exclusively from the
 * canonical policy/business-outcome engine and therefore has no `ignored`
 * fallback. PRODAT/ACK side effects remain in the characterized implementation;
 * its PRODAT lifecycle dependency is itself policy-driven.
 */
export async function applyInboundBusinessStateMachine(
  input: InboundBusinessStateInput,
): Promise<InboundBusinessStateResult> {
  if (String(input.message.message_family ?? '').toUpperCase() === 'UTILTS') {
    return utiltsStateResult(input.message)
  }
  const legacy = await applyLegacyInboundBusinessStateMachine(input)
  if (legacy.outcome === 'ignored') {
    return {
      ...legacy,
      outcome: 'manual_review_required',
      reviewRequired: true,
      tenantMessage: legacy.tenantMessage || 'Meddelandet saknar explicit canonical business outcome och kräver granskning.',
      metadata: {
        ...legacy.metadata,
        legacyIgnoredConvertedToFailClosedReview: true,
      },
    }
  }
  return legacy as InboundBusinessStateResult
}
