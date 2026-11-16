import type { CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { UTILTS_CANONICAL_PROFILES } from '@/lib/ediel/rulebook/utiltsRulebook'

export type UtiltsInboundBusinessOutcomeKind =
  | 'actual_metering_values'
  | 'forecast_only'
  | 'grid_area_aggregate'
  | 'object_time_series_non_billing'
  | 'missing_values_request'
  | 'functional_rejection'

export type UtiltsInboundBusinessOutcome = {
  code: string
  kind: UtiltsInboundBusinessOutcomeKind
  allowIndividualCustomerLink: boolean
  allowMeteringValueIngest: boolean
  allowBillingConsumption: boolean
  requireGridAreaScope: boolean
  carriesQuantities: boolean
  reason: string
}

function dataOutcome(policy: CanonicalEdielPolicy): UtiltsInboundBusinessOutcome {
  const semantics = policy.semantics

  if (semantics.domainObject === 'validated_metering_values' || semantics.domainObject === 'collected_metering_values') {
    return {
      code: policy.code,
      kind: 'actual_metering_values',
      allowIndividualCustomerLink: true,
      allowMeteringValueIngest: true,
      allowBillingConsumption: true,
      requireGridAreaScope: false,
      carriesQuantities: semantics.carriesQuantities,
      reason: `${semantics.domainObject} is canonical actual metering data.`,
    }
  }

  if (semantics.domainObject === 'object_consumption_forecast') {
    return {
      code: policy.code,
      kind: 'forecast_only',
      allowIndividualCustomerLink: true,
      allowMeteringValueIngest: false,
      allowBillingConsumption: false,
      requireGridAreaScope: false,
      carriesQuantities: semantics.carriesQuantities,
      reason: 'Consumption prognosis is planning data and may never be treated as actual billing consumption.',
    }
  }

  if (semantics.dataScope === 'grid_area' || semantics.dataScope === 'grid_area_or_regulating_object') {
    return {
      code: policy.code,
      kind: 'grid_area_aggregate',
      allowIndividualCustomerLink: false,
      allowMeteringValueIngest: false,
      allowBillingConsumption: false,
      requireGridAreaScope: true,
      carriesQuantities: semantics.carriesQuantities,
      reason: 'Aggregate UTILTS data belongs to grid-area/regulating-object scope and may not mutate an individual customer.',
    }
  }

  if (semantics.domainObject === 'object_time_series') {
    return {
      code: policy.code,
      kind: 'object_time_series_non_billing',
      allowIndividualCustomerLink: true,
      allowMeteringValueIngest: false,
      allowBillingConsumption: false,
      requireGridAreaScope: false,
      carriesQuantities: semantics.carriesQuantities,
      reason: 'Object time series is an explicit non-billing outcome until a separately certified billing mapping exists.',
    }
  }

  throw new Error(`utilts_inbound_business_outcome_unmapped:${policy.code}:${semantics.domainObject}:${semantics.dataScope}`)
}

/**
 * Convert the already-resolved canonical policy into one exhaustive supplier-side
 * inbound business effect. This module intentionally contains no message-code
 * switch; code meaning remains owned by canonical business semantics/profile data.
 */
export function resolveUtiltsInboundBusinessOutcome(policy: CanonicalEdielPolicy): UtiltsInboundBusinessOutcome {
  if (policy.family !== 'UTILTS' && policy.family !== 'UTILTS_ERR') {
    throw new Error(`utilts_inbound_business_outcome_family_invalid:${policy.family}`)
  }
  if (policy.direction !== 'inbound') {
    throw new Error(`utilts_inbound_business_outcome_direction_invalid:${policy.direction}`)
  }

  const semantics = policy.semantics
  if (semantics.businessEffect === 'request_missing_values') {
    return {
      code: policy.code,
      kind: 'missing_values_request',
      allowIndividualCustomerLink: semantics.dataScope === 'metering_point' || semantics.dataScope === 'metering_point_or_regulating_object',
      allowMeteringValueIngest: false,
      allowBillingConsumption: false,
      requireGridAreaScope: semantics.dataScope === 'grid_area' || semantics.dataScope === 'grid_area_or_regulating_object',
      carriesQuantities: false,
      reason: 'Request message is an explicit request outcome and never an inbound value-ingestion outcome.',
    }
  }

  if (semantics.businessEffect === 'functional_rejection') {
    return {
      code: policy.code,
      kind: 'functional_rejection',
      allowIndividualCustomerLink: false,
      allowMeteringValueIngest: false,
      allowBillingConsumption: false,
      requireGridAreaScope: false,
      carriesQuantities: false,
      reason: 'UTILTS_ERR is a functional rejection outcome and never business data.',
    }
  }

  if (semantics.businessEffect === 'deliver_values') return dataOutcome(policy)

  throw new Error(`utilts_inbound_business_effect_unmapped:${policy.code}:${semantics.businessEffect}`)
}

/** Coverage assertion: every canonical UTILTS/UTILTS_ERR profile must be capable
 * of producing a non-ignored business outcome from its canonical semantics. */
export function assertUtiltsInboundBusinessOutcomeCoverage(resolvePolicy: (code: string, family: 'UTILTS' | 'UTILTS_ERR') => CanonicalEdielPolicy): void {
  for (const profile of UTILTS_CANONICAL_PROFILES) {
    const family = profile.messageCode === 'ERR' ? 'UTILTS_ERR' : 'UTILTS'
    const policy = resolvePolicy(profile.messageCode, family)
    const outcome = resolveUtiltsInboundBusinessOutcome(policy)
    if (!outcome.kind) throw new Error(`utilts_inbound_business_outcome_missing:${profile.messageCode}`)
  }
}
