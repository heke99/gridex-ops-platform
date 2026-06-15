export type IntakeReadinessStatus = 'ready' | 'blocked' | 'needs_review'

export type IntakeReadinessInput = {
  companyId: string
  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  contractId?: string | null
  hasLegalAcceptances?: boolean | null
  hasPowerOfAttorney?: boolean | null
  facilityId?: string | null
  meteringPointExternalId?: string | null
}

export type IntakeReadinessResult = {
  status: IntakeReadinessStatus
  blockers: string[]
  warnings: string[]
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export function calculateIntakeReadiness(input: IntakeReadinessInput): IntakeReadinessResult {
  const blockers: string[] = []
  const warnings: string[] = []

  if (!hasText(input.companyId)) blockers.push('missing_company_scope')
  if (!hasText(input.customerId)) blockers.push('missing_customer')
  if (!hasText(input.siteId)) blockers.push('missing_customer_site')
  if (!hasText(input.contractId)) blockers.push('missing_contract')
  if (!hasText(input.meteringPointId) && !hasText(input.meteringPointExternalId)) blockers.push('missing_metering_point')
  if (!hasText(input.facilityId)) warnings.push('missing_facility_id')
  if (input.hasLegalAcceptances === false) blockers.push('missing_legal_acceptances')
  if (input.hasPowerOfAttorney === false) blockers.push('missing_power_of_attorney')

  return {
    status: blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'needs_review' : 'ready',
    blockers,
    warnings,
  }
}

export function blockSupplierSwitchIfMissingRequiredData(input: IntakeReadinessInput): IntakeReadinessResult {
  return calculateIntakeReadiness(input)
}
