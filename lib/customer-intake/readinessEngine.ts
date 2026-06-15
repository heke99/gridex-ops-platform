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
  gridOwnerId?: string | null
  gridOwnerVerificationStatus?: string | null
  gridOwnerRouteStatus?: string | null
  tenantEdielStatus?: string | null
  tenantLegalStatus?: string | null
  gridAreaCode?: string | null
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
  if (!hasText(input.gridOwnerId)) blockers.push('missing_grid_owner')
  if (input.gridOwnerVerificationStatus && input.gridOwnerVerificationStatus !== 'verified') blockers.push(`grid_owner_${input.gridOwnerVerificationStatus}`)
  if (input.gridOwnerRouteStatus && !['ready', 'verified', 'auto_send_ready'].includes(input.gridOwnerRouteStatus)) blockers.push(`grid_owner_route_${input.gridOwnerRouteStatus}`)
  if (input.tenantEdielStatus && !['ready', 'live', 'manual_review_required'].includes(input.tenantEdielStatus)) blockers.push(`tenant_ediel_${input.tenantEdielStatus}`)
  if (input.tenantLegalStatus && input.tenantLegalStatus !== 'ready') blockers.push(`tenant_legal_${input.tenantLegalStatus}`)
  if (!hasText(input.gridAreaCode)) blockers.push('missing_grid_area_code')
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


export function intakeBlockerLabel(code: string): string {
  const labels: Record<string, string> = {
    missing_company_scope: 'Bolagskoppling saknas.',
    missing_customer: 'Kund saknas.',
    missing_customer_site: 'Anläggning saknas.',
    missing_contract: 'Avtal saknas.',
    missing_grid_owner: 'Verifierad nätägare saknas.',
    missing_grid_area_code: 'Nätområdeskod saknas.',
    missing_metering_point: 'Mätpunkts-id saknas.',
    missing_legal_acceptances: 'Juridiska godkännanden saknas.',
    missing_power_of_attorney: 'Fullmakt saknas.',
  }
  if (labels[code]) return labels[code]
  if (code.startsWith('grid_owner_route_')) return 'Nätägarens Ediel-route är inte redo.'
  if (code.startsWith('tenant_ediel_')) return 'Tenantens Ediel-konfiguration är inte redo.'
  if (code.startsWith('tenant_legal_')) return 'Tenantens juridiska avtalstexter är inte redo.'
  if (code.startsWith('grid_owner_')) return 'Nätägaren är inte verifierad för kundflödet.'
  return code
}

export function shouldCreateFacilityDataRequest(result: IntakeReadinessResult): boolean {
  return result.blockers.includes('missing_metering_point') || result.blockers.includes('missing_grid_area_code') || result.warnings.includes('missing_facility_id')
}
