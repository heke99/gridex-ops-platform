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
  | 'facility_data_invalid'
  | 'customer_information_mismatch'
  | 'grid_owner_rejected_request'
  | 'negative_aperak_received'
  | 'z02_rejected'
  | 'needs_customer_correction'
  | 'needs_grid_owner_followup'
  | 'duplicate_facility_id'
  | 'cross_tenant_facility_conflict'
  | 'protected_identity'
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

export type ControlledFacilityStatus =
  | 'facility_data_invalid'
  | 'customer_information_mismatch'
  | 'grid_owner_rejected_request'
  | 'negative_aperak_received'
  | 'z02_rejected'
  | 'needs_customer_correction'
  | 'needs_grid_owner_followup'
  | 'duplicate_facility_id'
  | 'cross_tenant_facility_conflict'
  | 'protected_identity'

const CONTROLLED_FACILITY_STATUSES = new Set<string>([
  'facility_data_invalid',
  'customer_information_mismatch',
  'grid_owner_rejected_request',
  'negative_aperak_received',
  'z02_rejected',
  'needs_customer_correction',
  'needs_grid_owner_followup',
  'duplicate_facility_id',
  'cross_tenant_facility_conflict',
  'protected_identity',
])

const CUSTOMER_CORRECTION_STATUSES = new Set<string>([
  'facility_data_invalid',
  'customer_information_mismatch',
  'z02_rejected',
  'needs_customer_correction',
  'duplicate_facility_id',
])

const GRID_OWNER_FOLLOWUP_STATUSES = new Set<string>([
  'grid_owner_rejected_request',
  'negative_aperak_received',
  'needs_grid_owner_followup',
])

function isControlledFacilityStatus(value: string | null): value is ControlledFacilityStatus {
  return Boolean(value && CONTROLLED_FACILITY_STATUSES.has(value))
}

function humanFacilityIssue(status: ControlledFacilityStatus): ReviewIssue {
  if (status === 'cross_tenant_facility_conflict') {
    return {
      field: 'cross_tenant_facility_conflict',
      label: 'Anläggnings-ID finns i annan tenant',
      severity: 'blocking',
      message: 'Samma anläggnings-ID verkar redan finnas i ett annat bolag. Kunddata från annan tenant visas inte och automation stoppas.',
      action: 'Skapa säker manuell granskning. Bekräfta uppgifterna med kunden och nätägaren innan ny readiness-check.',
    }
  }
  if (status === 'duplicate_facility_id') {
    return {
      field: 'duplicate_facility_id',
      label: 'Anläggnings-ID finns redan',
      severity: 'blocking',
      message: 'Anläggnings-ID finns redan hos samma bolag. Systemet skapar inte en dubblett.',
      action: 'Granska befintlig kund/anläggning och länka eller rätta uppgiften innan ny readiness-check.',
    }
  }
  if (status === 'protected_identity') {
    return {
      field: 'protected_identity',
      label: 'Skyddad identitet kräver manuell hantering',
      severity: 'blocking',
      message: 'Automatiska utskick och känslig databehandling är spärrade.',
      action: 'Flytta ärendet till behörig handläggare och följ skyddad-identitet-processen.',
    }
  }
  if (GRID_OWNER_FOLLOWUP_STATUSES.has(status)) {
    return {
      field: status,
      label: 'Nätägaren har stoppat eller avvisat uppgifterna',
      severity: 'blocking',
      message: 'Nätägarens svar måste tolkas affärsmässigt. Leverantörsbyte får inte fortsätta automatiskt.',
      action: 'Kontrollera nätägarens svar, begär rätt uppgifter vid behov och kör ny readiness-check efter korrigering.',
    }
  }
  return {
    field: status,
    label: 'Anläggningsuppgifter behöver rättas',
    severity: 'blocking',
    message: 'Anläggnings-ID, mätpunkt, kundidentitet eller nätområde kunde inte verifieras säkert.',
    action: 'Kontrollera uppgifterna med kunden, begär rätt uppgifter från nätägare eller ladda upp elnätsfaktura. Kör ny readiness-check efter rättning.',
  }
}

export function customerIntakeStatusForReadiness(readiness: Pick<WebsiteApplicationReadiness, 'status' | 'missingFields' | 'blockingReasons' | 'canStartSwitch'>): CustomerIntakeStatus {
  if (readiness.status === 'failed') return 'blocked'
  if (readiness.status === 'cancelled') return 'blocked'
  if (['protected_identity', 'cross_tenant_facility_conflict', 'negative_aperak_received', 'z02_rejected', 'grid_owner_rejected_request'].includes(readiness.status)) return 'blocked'
  if (readiness.status === 'duplicate_facility_id') return 'pending_duplicate_review'
  if (['facility_data_invalid', 'customer_information_mismatch', 'needs_customer_correction', 'needs_grid_owner_followup'].includes(readiness.status)) return 'pending_information'
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
  const gridOwnerVerificationStatus = firstText(input, ['grid_owner_verification_status', 'gridOwnerVerificationStatus', 'site.grid_owner_verification_status', 'energy_resolution.gridOwnerVerificationStatus'])
  const facilityDataStatus = firstText(input, [
    'facility_data_status',
    'facilityDataStatus',
    'site.facility_data_status',
    'site.facilityDataStatus',
    'metering_point.facility_data_status',
    'metadata.facility_data_status',
    'response_payload.status',
    'response_payload.facility_data_status',
    'status',
  ])
  const informationRequestId = firstText(input, ['grid_owner_information_request_id', 'gridOwnerInformationRequestId', 'metadata.grid_owner_information_request_id'])
  const informationRequestStatus = firstText(input, ['grid_owner_information_request_status', 'gridOwnerInformationRequestStatus', 'metadata.grid_owner_information_request_status'])
  const hasVerifiedGridOwner = gridOwnerVerificationStatus === 'verified' && (isUuid(gridOwnerId) || isEdielId(gridOwnerEdielId) || Boolean(gridAreaCode && priceArea && ['grid_area_master_validated', 'facility_data_requested', 'facility_data_received', 'facility_verified'].includes(resolutionStatus ?? '')))
  const facilityHasControlledError = isControlledFacilityStatus(facilityDataStatus)
  const facilityVerified = !facilityHasControlledError && (firstBoolean(input, [
    'facility_data_verified',
    'facilityDataVerified',
    'facility_data_verified_at',
    'site.facility_data_verified_at',
    'metering_point.facility_data_verified_at',
  ]) || resolutionStatus === 'facility_verified' || Boolean(facilityId && meteringPointId && gridAreaCode && priceArea))

  const pricePlanId = firstText(input, [
    'price_plan_id',
    'pricePlanId',
    'price_plan_version_id',
    'pricePlanVersionId',
    'offer_reference',
    'contract.offer_reference',
    'contract.price_plan_id',
    'contract.pricePlanId',
    'contract.price_plan_version_id',
    'contract.pricePlanVersionId',
    'metadata.price_plan_id',
    'metadata.price_plan_version_id',
    'metadata.contract_display_snapshot.price_plan_id',
    'metadata.contract_display_snapshot.price_plan_version_id',
    'metadata.contract_display_snapshot.offer_reference',
    'metadata.pricing_preview_snapshot.contract.price_plan_id',
    'metadata.pricing_preview_snapshot.contract.price_plan_version_id',
    'metadata.pricing_preview_snapshot.contract.offer_reference',
  ])
  const pricePlanDefinition = firstText(input, [
    'contract.contract_name',
    'contract.contractName',
    'contract.contract_type',
    'contract.contractType',
    'contract.campaign_code',
    'campaign_code',
    'metadata.contract_display_snapshot.name',
    'metadata.contract_display_snapshot.type',
    'metadata.pricing_preview_snapshot.contract.name',
    'metadata.pricing_preview_snapshot.contract.contractType',
  ])
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
    const verificationDetail = gridOwnerVerificationStatus && gridOwnerVerificationStatus !== 'verified' ? ` Status: ${gridOwnerVerificationStatus}.` : ''
    addIssue(blockingReasons, { field: 'grid_owner', label: 'Nätägare ej verifierad', message: `Nätägare måste komma från verifierad nätområdes-/aktörsdata innan switch kan skickas.${verificationDetail}`, action: 'Kör adressmatchning eller låt superadmin verifiera nätägare, Ediel-ID, route, subadress, kontaktväg och certifikat.' })
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
  if (facilityHasControlledError && facilityDataStatus) {
    missingFields.push(facilityDataStatus)
    addIssue(blockingReasons, humanFacilityIssue(facilityDataStatus))
    warnings.push('requires_new_readiness_check')
    if (CUSTOMER_CORRECTION_STATUSES.has(facilityDataStatus)) warnings.push('customer_correction_required')
    if (GRID_OWNER_FOLLOWUP_STATUSES.has(facilityDataStatus)) warnings.push('grid_owner_followup_required')
  }
  if (requestedStartMode === 'earliest_possible' && !calculatedEarliestStartDate) warnings.push('calculated_earliest_start_date_pending')
  if (siteAddress && !gridAreaCode) warnings.push('address_without_grid_area')
  if (gridAreaCode && !priceArea) warnings.push('grid_area_without_price_area')
  if (resolutionStatus === 'needs_review') warnings.push('energy_resolution_needs_review')
  if (gridOwnerVerificationStatus && gridOwnerVerificationStatus !== 'verified') warnings.push(`grid_owner_${gridOwnerVerificationStatus}`)
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
  if (facilityHasControlledError && facilityDataStatus) status = facilityDataStatus
  else if (canStartSwitch) status = 'ready_for_switch'
  else if (resolutionStatus === 'needs_review') status = 'manual_review'
  else if (!siteAddress && !facilityId) status = 'needs_address_resolution'
  else if (!gridAreaCode || !priceArea) status = 'needs_address_resolution'
  else if (canRequestGridOwnerInformation && informationRequestId) status = 'waiting_grid_owner_response'
  else if (canRequestGridOwnerInformation) status = 'needs_facility_data'
  else if (facilityVerified) status = 'facility_data_received'
  else status = blocking.length > 0 ? 'needs_information' : 'pending_validation'

  const nextStep = facilityHasControlledError && facilityDataStatus
    ? humanFacilityIssue(facilityDataStatus).action
    : canStartSwitch
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
