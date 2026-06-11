export type WebsiteApplicationStatus =
  | 'application_received'
  | 'received'
  | 'needs_address_resolution'
  | 'address_resolved'
  | 'grid_area_resolved'
  | 'needs_facility_data'
  | 'information_request_ready'
  | 'information_request_sent'
  | 'waiting_grid_owner_response'
  | 'facility_data_received'
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
  if (['ready_for_switch', 'switch_requested', 'switch_confirmed', 'active'].includes(readiness.status)) return 'ready_for_operations'
  if (['pending_validation', 'facility_data_received'].includes(readiness.status)) return 'ready_for_contract'

  const missing = new Set(readiness.missingFields)
  const blockingFields = readiness.blockingReasons
    .filter((issue) => issue.severity === 'blocking')
    .map((issue) => issue.field)

  if (blockingFields.length === 0 && readiness.canStartSwitch) return 'ready_for_operations'
  if (blockingFields.length === 1 && missing.has('power_of_attorney')) return 'pending_power_of_attorney'
  if (missing.has('grid_area_code') || missing.has('price_area') || missing.has('grid_owner') || missing.has('metering_point_id') || missing.has('facility_verified') || missing.has('site')) return 'pending_information'
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
  requestedStartMode: 'earliest_possible' | 'specific_date'
  calculatedEarliestStartDate: string | null
  confirmedStartDate: string | null
  actualStartDate: string | null
  gridAreaCode: string | null
  priceArea: string | null
  resolutionStatus: string | null
  facilityVerified: boolean
  canCreateSite: boolean
  canCreateMeteringPoint: boolean
  canCreateContract: boolean
  canStartSwitch: boolean
  canRequestGridOwnerInformation: boolean
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
  if (typeof value === 'string') return ['true', 'yes', 'ja', '1', 'accepted', 'signed', 'verified', 'received'].includes(value.trim().toLowerCase())
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

function normalisePriceArea(value: string | null): string | null {
  const area = value?.toUpperCase() ?? null
  return area && ['SE1', 'SE2', 'SE3', 'SE4'].includes(area) ? area : null
}

function normaliseGridAreaCode(value: string | null): string | null {
  return value?.replace(/\s+/g, '').toUpperCase() ?? null
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

export function readRequestedStartMode(input: unknown): 'earliest_possible' | 'specific_date' {
  const mode = firstText(input, ['requested_start_mode', 'requestedStartMode', 'contract.requested_start_mode', 'contract.requestedStartMode'])?.toLowerCase()
  if (mode === 'specific_date' || mode === 'specific') return 'specific_date'
  return 'earliest_possible'
}

function readCalculatedEarliestStartDate(input: unknown): string | null {
  return firstText(input, ['calculated_earliest_start_date', 'calculatedEarliestStartDate', 'contract.calculated_earliest_start_date', 'contract.calculatedEarliestStartDate'])
}

export function assessWebsiteApplicationReadiness(input: unknown): WebsiteApplicationReadiness {
  const missingFields: string[] = []
  const blockingReasons: ReviewIssue[] = []
  const warnings: string[] = []

  const customerEmail = firstText(input, ['customer.email', 'email'])
  const customerName = firstText(input, [
    'customer.full_name', 'customer.fullName', 'customer.company_name', 'customer.companyName',
    'customer.first_name', 'customer.firstName', 'name', 'full_name', 'company_name',
  ])
  const customerIdentity = firstText(input, [
    'customer.personal_number', 'customer.personalNumber', 'customer.org_number', 'customer.orgNumber',
    'personal_number', 'org_number',
  ])
  const facilityId = firstText(input, ['site.facility_id', 'site.facilityId', 'facility_id', 'facilityId', 'site_facility_id', 'anlage_id', 'anlaggningId'])
  const siteAddress = firstText(input, ['site.street', 'site.address', 'street', 'address', 'address_line1', 'billing_street', 'customer.billing_street'])
  const postalCode = firstText(input, ['site.postal_code', 'site.postalCode', 'postal_code', 'postalCode', 'zip', 'customer.billing_postal_code'])
  const city = firstText(input, ['site.city', 'city', 'customer.billing_city'])
  const meteringPointId = firstText(input, [
    'metering_point.metering_point_id', 'metering_point.meteringPointId', 'metering_point.meter_point_id',
    'metering_point.meterPointId', 'metering_point.ediel_metering_point_id', 'metering_point.edielMeteringPointId',
    'metering_point.anlage_id', 'metering_point.anlaggningId', 'metering_point_id', 'meteringPointId',
    'meter_point_id', 'ediel_metering_point_id', 'anlage_id',
  ])
  const gridOwnerId = firstText(input, ['grid_owner_id', 'gridOwnerId', 'network_owner_id', 'networkOwnerId', 'site.grid_owner_id', 'site.gridOwnerId', 'metadata.grid_owner_id', 'metadata.network_owner_id', 'energy_resolution.gridOwnerId'])
  const gridOwnerEdielId = firstText(input, ['metadata.grid_owner_ediel_id', 'grid_owner_ediel_id', 'network_owner_ediel_id'])
  const gridAreaCode = normaliseGridAreaCode(firstText(input, ['grid_area_code', 'gridAreaCode', 'site.grid_area_code', 'site.gridAreaCode', 'metadata.grid_area_code', 'energy_resolution.gridAreaCode']))
  const priceArea = normalisePriceArea(firstText(input, ['price_area_code', 'priceAreaCode', 'price_area', 'priceArea', 'site.price_area_code', 'site.priceAreaCode', 'metering_point.price_area_code', 'energy_resolution.priceArea']))
  const resolutionStatus = firstText(input, ['resolution_status', 'resolutionStatus', 'site.resolution_status', 'energy_resolution.resolutionStatus'])
  const informationRequestId = firstText(input, ['grid_owner_information_request_id', 'gridOwnerInformationRequestId', 'metadata.grid_owner_information_request_id'])
  const informationRequestStatus = firstText(input, ['grid_owner_information_request_status', 'gridOwnerInformationRequestStatus', 'metadata.grid_owner_information_request_status'])
  const hasVerifiedGridOwner = isUuid(gridOwnerId) || isEdielId(gridOwnerEdielId) || Boolean(gridAreaCode && priceArea && ['grid_area_master_validated', 'facility_data_requested', 'facility_data_received', 'facility_verified'].includes(resolutionStatus ?? ''))
  const facilityVerified = firstBoolean(input, [
    'facility_data_verified',
    'facilityDataVerified',
    'facility_data_verified_at',
    'site.facility_data_verified_at',
    'metering_point.facility_data_verified_at',
  ]) || resolutionStatus === 'facility_verified' || Boolean(facilityId && meteringPointId && gridAreaCode && priceArea)

  const pricePlanId = firstText(input, ['price_plan_id', 'pricePlanId', 'contract.price_plan_id', 'contract.pricePlanId'])
  const pricePlanDefinition = firstText(input, ['contract.contract_name', 'contract.contractName', 'contract.contract_type', 'contract.contractType', 'contract.campaign_code', 'campaign_code'])
  const hasValidPricePlan = Boolean(isUuid(pricePlanId) || pricePlanDefinition)
  const requestedStartMode = readRequestedStartMode(input)
  const requestedStartDate = readRequestedStartDate(input)
  const calculatedEarliestStartDate = readCalculatedEarliestStartDate(input)
  const confirmedStartDate = firstText(input, ['confirmed_start_date', 'confirmedStartDate', 'contract.confirmed_start_date', 'contract.confirmedStartDate'])
  const actualStartDate = firstText(input, ['actual_start_date', 'actualStartDate', 'contract.actual_start_date', 'contract.actualStartDate'])
  const powerOfAttorneyAccepted = firstBoolean(input, ['consents.power_of_attorney', 'consents.powerOfAttorney', 'consents.fullmakt', 'consents.fullmakt_accepted', 'consents.poa_accepted', 'power_of_attorney_accepted', 'fullmakt_accepted'])
  const termsAccepted = firstBoolean(input, ['consents.terms', 'consents.terms_accepted', 'consents.customer_terms', 'terms_accepted', 'accepted_terms'])

  if (!customerEmail) {
    missingFields.push('customer.email')
    addIssue(blockingReasons, { field: 'customer.email', label: 'E-post saknas', message: 'Kunden behöver en giltig e-postadress innan kundmail och portalflöde kan hanteras.', action: 'Komplettera kundens e-postadress.' })
  }
  if (!customerName) {
    missingFields.push('customer.name')
    addIssue(blockingReasons, { field: 'customer.name', label: 'Kundnamn saknas', message: 'Kundnamn eller företagsnamn saknas i ansökan.', action: 'Komplettera namn/företagsnamn.' })
  }
  if (!customerIdentity) {
    missingFields.push('customer.identity')
    addIssue(blockingReasons, { field: 'customer.identity', label: 'Person-/organisationsnummer saknas', message: 'Identitet saknas och bör kontrolleras innan switch eller aktiv kundstatus.', action: 'Komplettera personnummer eller organisationsnummer.', severity: 'warning' })
  }
  if (!facilityId && !siteAddress) {
    missingFields.push('site')
    addIssue(blockingReasons, { field: 'site', label: 'Anläggning saknas', message: 'Ansökan saknar både anläggnings-ID och anläggningsadress.', action: 'Komplettera anläggningsadress eller anläggnings-ID.' })
  }
  if (siteAddress && (!postalCode || !city)) {
    missingFields.push('site.address')
    addIssue(blockingReasons, { field: 'site.address', label: 'Adress ej komplett', message: 'Full adress krävs för säker nätområdesmatchning.', action: 'Komplettera gata, postnummer och ort.' })
  }
  if (!gridAreaCode) {
    missingFields.push('grid_area_code')
    addIssue(blockingReasons, { field: 'grid_area_code', label: 'Nätområdeskod saknas', message: 'Systemet måste hitta nätområdeskod via adress/polygon eller få den bekräftad manuellt.', action: 'Kör adressmatchning eller välj nätområde manuellt.' })
  }
  if (!priceArea) {
    missingFields.push('price_area')
    addIssue(blockingReasons, { field: 'price_area', label: 'Elområde saknas', message: 'Prissättning och fakturering behöver verifierat SE-område.', action: 'Kör Energy Resolver eller komplettera nätområdesmaster.' })
  }
  if (!meteringPointId) {
    missingFields.push('metering_point_id')
    addIssue(blockingReasons, { field: 'metering_point_id', label: 'Mätpunkt/anläggnings-ID saknas', message: 'Leverantörsbyte får inte startas utan mätpunkt/anläggnings-ID.', action: 'Begär anläggningsuppgifter från nätägare.' })
  }
  if (!hasVerifiedGridOwner) {
    missingFields.push('grid_owner')
    addIssue(blockingReasons, { field: 'grid_owner', label: 'Nätägare saknas', message: 'Nätägare måste komma från verifierad nätområdes-/aktörsdata innan switch kan skickas.', action: 'Kör adressmatchning eller välj verifierad nätägare.' })
  }
  if (!facilityVerified) {
    missingFields.push('facility_verified')
    addIssue(blockingReasons, { field: 'facility_verified', label: 'Anläggningsuppgifter ej verifierade', message: 'Geodata räcker för att begära uppgifter, men switch kräver verifierad anläggning/mätpunkt.', action: 'Begär uppgifter från nätägare eller markera mottagna uppgifter efter kontroll.' })
  }
  if (!hasValidPricePlan) {
    missingFields.push('price_plan')
    addIssue(blockingReasons, { field: 'price_plan', label: 'Prisplan/avtal saknas', message: 'Prisplan eller avtalsform saknas och måste kompletteras före avtal/switch.', action: 'Välj prisplan eller avtalsform.' })
  }
  if (!powerOfAttorneyAccepted) {
    missingFields.push('power_of_attorney')
    addIssue(blockingReasons, { field: 'power_of_attorney', label: 'Fullmakt saknas', message: 'Switch får inte skickas utan giltig fullmakt/samtycke.', action: 'Komplettera eller verifiera fullmakt.' })
  }
  if (!termsAccepted) {
    missingFields.push('terms_accepted')
    addIssue(blockingReasons, { field: 'terms_accepted', label: 'Avtalsvillkor/samtycke saknas', message: 'Kunden måste ha accepterat villkor innan processen kan fortsätta.', action: 'Verifiera kundens samtycke till villkor.' })
  }
  if (requestedStartMode === 'specific_date' && !requestedStartDate) {
    missingFields.push('requested_start_date')
    addIssue(blockingReasons, { field: 'requested_start_date', label: 'Startdatum saknas', message: 'Kunden har valt specifikt startdatum men datum saknas.', action: 'Ange önskat startdatum eller ändra till snarast möjligt.' })
  }
  if (requestedStartMode === 'earliest_possible' && !calculatedEarliestStartDate) warnings.push('calculated_earliest_start_date_pending')
  if (siteAddress && !gridAreaCode) warnings.push('address_without_grid_area')
  if (gridAreaCode && !priceArea) warnings.push('grid_area_without_price_area')
  if (resolutionStatus === 'needs_review') warnings.push('energy_resolution_needs_review')
  if (informationRequestId || informationRequestStatus) warnings.push('grid_owner_information_request_open')
  if (gridOwnerId && !isUuid(gridOwnerId)) warnings.push('grid_owner_id_not_verified_uuid')
  if (pricePlanId && !isUuid(pricePlanId) && !pricePlanDefinition) warnings.push('price_plan_id_not_verified_uuid')

  const blocking = blockingReasons.filter((issue) => issue.severity === 'blocking')
  const canCreateSite = Boolean(facilityId || siteAddress)
  const canCreateMeteringPoint = Boolean(meteringPointId && canCreateSite)
  const canCreateContract = Boolean(hasValidPricePlan)
  const canRequestGridOwnerInformation = Boolean(gridAreaCode && priceArea && hasVerifiedGridOwner && !facilityVerified)
  const hasValidStartMode = requestedStartMode === 'earliest_possible' || Boolean(requestedStartDate)
  const canStartSwitch = blocking.length === 0 && Boolean(
    meteringPointId && facilityId && gridAreaCode && priceArea && hasVerifiedGridOwner && facilityVerified && powerOfAttorneyAccepted && termsAccepted && hasValidPricePlan && hasValidStartMode
  )
  const canSendAgreementConfirmation = Boolean(canStartSwitch && confirmedStartDate)
  const canActivateCustomer = Boolean(canStartSwitch && confirmedStartDate && actualStartDate)

  let status: WebsiteApplicationStatus
  if (canStartSwitch) status = 'ready_for_switch'
  else if (resolutionStatus === 'needs_review') status = 'manual_review'
  else if (!siteAddress && !facilityId) status = 'needs_address_resolution'
  else if (!gridAreaCode || !priceArea) status = 'needs_address_resolution'
  else if (canRequestGridOwnerInformation && informationRequestId) status = 'waiting_grid_owner_response'
  else if (canRequestGridOwnerInformation) status = 'needs_facility_data'
  else if (facilityVerified) status = 'facility_data_received'
  else status = blocking.length > 0 ? 'needs_information' : 'pending_validation'

  const nextStep = canStartSwitch
    ? 'Starta leverantörsbyte.'
    : canRequestGridOwnerInformation
      ? 'Begär anläggningsuppgifter från nätägare innan switch kan startas.'
      : blocking[0]?.action ?? 'Kontrollera ansökan innan nästa statussteg.'

  const qualityScore = Math.max(0, Math.min(100, 100 - (blocking.length * 12) - ((blockingReasons.length - blocking.length) * 5) - (warnings.length * 3)))

  return {
    status,
    missingFields: Array.from(new Set(missingFields)),
    blockingReasons,
    warnings,
    nextStep,
    qualityScore,
    requestedStartDate,
    requestedStartMode,
    calculatedEarliestStartDate,
    confirmedStartDate,
    actualStartDate,
    gridAreaCode,
    priceArea,
    resolutionStatus,
    facilityVerified,
    canCreateSite,
    canCreateMeteringPoint,
    canCreateContract,
    canStartSwitch,
    canRequestGridOwnerInformation,
    canSendAgreementConfirmation,
    canActivateCustomer,
  }
}
