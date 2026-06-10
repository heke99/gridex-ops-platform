export type WebsiteApplicationStatus =
  | 'application_received'
  | 'needs_information'
  | 'pending_validation'
  | 'ready_for_switch'
  | 'switch_requested'
  | 'switch_confirmed'
  | 'switch_rejected'
  | 'active'
  | 'manual_review'
  | 'pending_review'
  | 'failed'
  | 'cancelled'


export type CustomerIntakeStatus =
  | 'draft'
  | 'incomplete'
  | 'needs_completion'
  | 'pending_information'
  | 'pending_power_of_attorney'
  | 'pending_duplicate_review'
  | 'blocked'
  | 'ready_for_contract'
  | 'ready_for_operations'

export function customerIntakeStatusForReadiness(readiness: Pick<WebsiteApplicationReadiness, 'status' | 'missingFields' | 'blockingReasons' | 'canStartSwitch'>): CustomerIntakeStatus {
  if (readiness.status === 'failed') return 'blocked'
  if (readiness.status === 'cancelled') return 'blocked'
  if (readiness.status === 'ready_for_switch' || readiness.status === 'switch_requested' || readiness.status === 'switch_confirmed' || readiness.status === 'active') {
    return 'ready_for_operations'
  }
  if (readiness.status === 'pending_validation') return 'ready_for_contract'

  const missing = new Set(readiness.missingFields)
  const blockingFields = readiness.blockingReasons
    .filter((issue) => issue.severity === 'blocking')
    .map((issue) => issue.field)

  if (blockingFields.length === 0 && readiness.canStartSwitch) return 'ready_for_operations'
  if (blockingFields.length === 1 && missing.has('power_of_attorney')) return 'pending_power_of_attorney'
  if (missing.has('grid_owner') || missing.has('metering_point_id') || missing.has('site')) return 'pending_information'
  if (missing.size > 0 || blockingFields.length > 0) return 'needs_completion'
  return 'draft'
}

export type ReviewIssue = {
  field: string
  label: string
  severity: 'blocking' | 'warning'
  message: string
  action: string
}

export type WebsiteApplicationReadiness = {
  status: WebsiteApplicationStatus
  missingFields: string[]
  blockingReasons: ReviewIssue[]
  warnings: string[]
  nextStep: string
  qualityScore: number
  requestedStartDate: string | null
  confirmedStartDate: string | null
  actualStartDate: string | null
  canCreateSite: boolean
  canCreateMeteringPoint: boolean
  canCreateContract: boolean
  canStartSwitch: boolean
  canSendAgreementConfirmation: boolean
  canActivateCustomer: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function cleanReviewText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return ['true', 'yes', 'ja', '1', 'accepted', 'signed'].includes(value.trim().toLowerCase())
  if (typeof value === 'number') return value === 1
  return false
}

function readPath(input: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = input
  for (const part of parts) {
    if (!isRecord(current)) return undefined
    current = current[part]
  }
  return current
}

function firstText(input: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = cleanReviewText(readPath(input, path))
    if (value) return value
  }
  return null
}

function firstBoolean(input: unknown, paths: string[]): boolean {
  return paths.some((path) => asBoolean(readPath(input, path)))
}

function isUuid(value: string | null): boolean {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
}

function isEdielId(value: string | null): boolean {
  return Boolean(value && /^\d{5,18}$/.test(value))
}

function addIssue(issues: ReviewIssue[], input: Omit<ReviewIssue, 'severity'> & { severity?: ReviewIssue['severity'] }) {
  issues.push({ ...input, severity: input.severity ?? 'blocking' })
}

export function readRequestedStartDate(input: unknown): string | null {
  return firstText(input, [
    'requested_start_date',
    'requestedStartDate',
    'contract.requested_start_date',
    'contract.requestedStartDate',
    'contract.expected_start_at',
    'contract.expectedStartAt',
    'contract.starts_at',
    'contract.startsAt',
    'site.move_in_date',
    'site.moveInDate',
    'metering_point.start_date',
    'metering_point.startDate',
    'start_date',
    'startDate',
    'move_in_date',
    'moveInDate',
  ])
}

export function assessWebsiteApplicationReadiness(input: unknown): WebsiteApplicationReadiness {
  const missingFields: string[] = []
  const blockingReasons: ReviewIssue[] = []
  const warnings: string[] = []

  const customerEmail = firstText(input, ['customer.email', 'email'])
  const customerName = firstText(input, [
    'customer.full_name',
    'customer.fullName',
    'customer.company_name',
    'customer.companyName',
    'customer.first_name',
    'customer.firstName',
    'name',
    'full_name',
    'company_name',
  ])
  const customerIdentity = firstText(input, [
    'customer.personal_number',
    'customer.personalNumber',
    'customer.org_number',
    'customer.orgNumber',
    'personal_number',
    'org_number',
  ])
  const facilityId = firstText(input, [
    'site.facility_id',
    'site.facilityId',
    'facility_id',
    'facilityId',
    'site_facility_id',
    'anlage_id',
    'anlaggningId',
  ])
  const siteAddress = firstText(input, [
    'site.street',
    'site.address',
    'street',
    'address',
    'address_line1',
    'billing_street',
    'customer.billing_street',
  ])
  const meteringPointId = firstText(input, [
    'metering_point.metering_point_id',
    'metering_point.meteringPointId',
    'metering_point.meter_point_id',
    'metering_point.meterPointId',
    'metering_point.ediel_metering_point_id',
    'metering_point.edielMeteringPointId',
    'metering_point.anlage_id',
    'metering_point.anlaggningId',
    'metering_point_id',
    'meteringPointId',
    'meter_point_id',
    'ediel_metering_point_id',
    'anlage_id',
  ])
  const gridOwnerId = firstText(input, [
    'grid_owner_id',
    'gridOwnerId',
    'network_owner_id',
    'networkOwnerId',
    'site.grid_owner_id',
    'site.gridOwnerId',
    'metadata.grid_owner_id',
    'metadata.network_owner_id',
  ])
  const gridOwnerEdielId = firstText(input, [
    'metadata.grid_owner_ediel_id',
    'grid_owner_ediel_id',
    'network_owner_ediel_id',
  ])
  const hasVerifiedGridOwner = isUuid(gridOwnerId) || isEdielId(gridOwnerEdielId)
  const pricePlanId = firstText(input, [
    'price_plan_id',
    'pricePlanId',
    'contract.price_plan_id',
    'contract.pricePlanId',
  ])
  const pricePlanDefinition = firstText(input, [
    'contract.contract_name',
    'contract.contractName',
    'contract.contract_type',
    'contract.contractType',
    'contract.campaign_code',
    'campaign_code',
  ])
  const hasValidPricePlan = Boolean(isUuid(pricePlanId) || pricePlanDefinition)
  const requestedStartDate = readRequestedStartDate(input)
  const confirmedStartDate = firstText(input, ['confirmed_start_date', 'confirmedStartDate', 'contract.confirmed_start_date', 'contract.confirmedStartDate'])
  const actualStartDate = firstText(input, ['actual_start_date', 'actualStartDate', 'contract.actual_start_date', 'contract.actualStartDate'])
  const powerOfAttorneyAccepted = firstBoolean(input, [
    'consents.power_of_attorney',
    'consents.powerOfAttorney',
    'consents.fullmakt',
    'consents.fullmakt_accepted',
    'consents.poa_accepted',
    'power_of_attorney_accepted',
    'fullmakt_accepted',
  ])
  const termsAccepted = firstBoolean(input, [
    'consents.terms',
    'consents.terms_accepted',
    'consents.customer_terms',
    'terms_accepted',
    'accepted_terms',
  ])

  if (!customerEmail) {
    missingFields.push('customer.email')
    addIssue(blockingReasons, {
      field: 'customer.email',
      label: 'E-post saknas',
      message: 'Kunden behöver en giltig e-postadress innan kundmail och portalflöde kan hanteras.',
      action: 'Komplettera kundens e-postadress.',
    })
  }

  if (!customerName) {
    missingFields.push('customer.name')
    addIssue(blockingReasons, {
      field: 'customer.name',
      label: 'Kundnamn saknas',
      message: 'Kundnamn eller företagsnamn saknas i ansökan.',
      action: 'Komplettera namn/företagsnamn.',
    })
  }

  if (!customerIdentity) {
    missingFields.push('customer.identity')
    addIssue(blockingReasons, {
      field: 'customer.identity',
      label: 'Person-/organisationsnummer saknas',
      message: 'Identitet saknas och bör kontrolleras innan switch eller aktiv kundstatus.',
      action: 'Komplettera personnummer eller organisationsnummer.',
      severity: 'warning',
    })
  }

  if (!facilityId && !siteAddress) {
    missingFields.push('site')
    addIssue(blockingReasons, {
      field: 'site',
      label: 'Anläggning saknas',
      message: 'Ansökan saknar både anläggnings-ID och anläggningsadress.',
      action: 'Komplettera anläggningsadress eller anläggnings-ID.',
    })
  }

  if (!meteringPointId) {
    missingFields.push('metering_point_id')
    addIssue(blockingReasons, {
      field: 'metering_point_id',
      label: 'Mätpunkt/anläggnings-ID saknas',
      message: 'Systemet kan inte starta leverantörsbyte eller aktivera kund utan mätpunkt/anläggnings-ID.',
      action: 'Komplettera mätpunkt/anläggnings-ID eller hämta uppgifter från nätägare.',
    })
  }

  if (!hasVerifiedGridOwner) {
    missingFields.push('grid_owner')
    addIssue(blockingReasons, {
      field: 'grid_owner',
      label: 'Nätägare saknas',
      message: 'Nätägare måste väljas från verifierat aktörsregister innan switch kan skickas.',
      action: 'Välj verifierad nätägare eller markera som okänd för fortsatt granskning.',
    })
  }

  if (!hasValidPricePlan) {
    missingFields.push('price_plan')
    addIssue(blockingReasons, {
      field: 'price_plan',
      label: 'Prisplan/avtal saknas',
      message: 'Prisplan eller avtalsform saknas och måste kompletteras före avtal/switch.',
      action: 'Välj prisplan eller avtalsform.',
    })
  }

  if (!powerOfAttorneyAccepted) {
    missingFields.push('power_of_attorney')
    addIssue(blockingReasons, {
      field: 'power_of_attorney',
      label: 'Fullmakt saknas',
      message: 'Switch får inte skickas utan giltig fullmakt/samtycke.',
      action: 'Komplettera eller verifiera fullmakt.',
    })
  }

  if (!termsAccepted) {
    missingFields.push('terms_accepted')
    addIssue(blockingReasons, {
      field: 'terms_accepted',
      label: 'Avtalsvillkor/samtycke saknas',
      message: 'Kunden måste ha accepterat villkor innan processen kan fortsätta.',
      action: 'Verifiera kundens samtycke till villkor.',
    })
  }

  if (!requestedStartDate) warnings.push('requested_start_date_missing')
  if (facilityId && !meteringPointId) warnings.push('facility_without_metering_point')
  if (siteAddress && !hasVerifiedGridOwner) warnings.push('address_without_grid_owner')
  if (gridOwnerId && !isUuid(gridOwnerId)) warnings.push('grid_owner_id_not_verified_uuid')
  if (pricePlanId && !isUuid(pricePlanId) && !pricePlanDefinition) warnings.push('price_plan_id_not_verified_uuid')

  const blocking = blockingReasons.filter((issue) => issue.severity === 'blocking')
  const canCreateSite = Boolean(facilityId || siteAddress)
  const canCreateMeteringPoint = Boolean(meteringPointId && canCreateSite)
  const canCreateContract = Boolean(hasValidPricePlan)
  const canStartSwitch = blocking.length === 0 && Boolean(meteringPointId && hasVerifiedGridOwner && powerOfAttorneyAccepted && hasValidPricePlan)
  const canSendAgreementConfirmation = Boolean(canStartSwitch && confirmedStartDate)
  const canActivateCustomer = Boolean(canStartSwitch && confirmedStartDate && actualStartDate)

  const status: WebsiteApplicationStatus = blocking.length > 0
    ? 'needs_information'
    : canStartSwitch
      ? 'ready_for_switch'
      : 'pending_validation'

  const nextStep = blocking[0]?.action ?? (canStartSwitch
    ? 'Kontrollera ansökan och starta leverantörsbyte.'
    : 'Kontrollera ansökan innan nästa statussteg.')

  const qualityScore = Math.max(0, Math.min(100, 100 - (blocking.length * 14) - ((blockingReasons.length - blocking.length) * 6) - (warnings.length * 3)))

  return {
    status,
    missingFields: Array.from(new Set(missingFields)),
    blockingReasons,
    warnings,
    nextStep,
    qualityScore,
    requestedStartDate,
    confirmedStartDate,
    actualStartDate,
    canCreateSite,
    canCreateMeteringPoint,
    canCreateContract,
    canStartSwitch,
    canSendAgreementConfirmation,
    canActivateCustomer,
  }
}
