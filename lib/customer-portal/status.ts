export type PortalStatusIssue =
  | 'contract_is_draft'
  | 'missing_contract'
  | 'missing_metering_point'
  | 'missing_facility_id'
  | 'missing_grid_owner'
  | 'facility_not_verified'
  | 'missing_power_of_attorney'
  | 'missing_legal_acceptance'
  | 'missing_price_plan'

export type PortalCustomerStatus = {
  code:
    | 'application_received'
    | 'needs_facility_data'
    | 'needs_grid_owner_review'
    | 'pending_supplier_switch'
    | 'active'
    | 'needs_review'
  label: string
  message: string
  supplier_switch: {
    can_create_request: boolean
    can_dispatch: boolean
    blockers: PortalStatusIssue[]
    next_action: 'complete_application' | 'create_request' | 'dispatch_request' | 'await_response' | null
  }
  /** @deprecated Use supplier_switch.can_dispatch. */
  can_start_switch: boolean
  severity: 'info' | 'warning' | 'blocking' | 'success'
  issues: PortalStatusIssue[]
}

type Row = Record<string, unknown>

type StatusInput = {
  customer?: Row | null
  contracts?: Row[] | null
  sites?: Row[] | null
  meteringPoints?: Row[] | null
  powersOfAttorney?: Row[] | null
  legalAcceptances?: Row[] | null
  applications?: Row[] | null
}

const PRICE_BLOCKER_FIELD = 'price_plan'
const ACTIVE_CONTRACT_STATUSES = new Set(['active'])
const READY_CONTRACT_STATUSES = new Set(['signed', 'pending_supplier_switch', 'pending_switch', 'pending_start'])

function isRecord(value: unknown): value is Row {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function valueAt(row: Row | null | undefined, path: string): unknown {
  if (!row) return null
  let current: unknown = row
  for (const key of path.split('.')) {
    if (!isRecord(current)) return null
    current = current[key]
  }
  return current
}

function textAt(row: Row | null | undefined, paths: string[]): string | null {
  for (const path of paths) {
    const value = str(valueAt(row, path))
    if (value) return value
  }
  return null
}

function hasText(row: Row | null | undefined, paths: string[]): boolean {
  return Boolean(textAt(row, paths))
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function uniqueIssues(issues: Array<PortalStatusIssue | null | false | undefined>): PortalStatusIssue[] {
  return Array.from(new Set(issues.filter(Boolean) as PortalStatusIssue[]))
}

function fieldName(issue: unknown): string | null {
  if (typeof issue === 'string') return issue
  if (isRecord(issue)) return str(issue.field) ?? str(issue.code) ?? str(issue.key)
  return null
}

function hasSignedPowerOfAttorney(rows: Row[]): boolean {
  return rows.some((row) => {
    const status = textAt(row, ['status'])?.toLowerCase()
    const scope = textAt(row, ['scope'])?.toLowerCase()
    return status === 'signed' && (!scope || ['supplier_switch', 'meter_data', 'billing_handoff'].includes(scope))
  })
}

function hasLegalAcceptance(rows: Row[]): boolean {
  if (rows.length === 0) return false
  const accepted = new Set(rows.map((row) => textAt(row, ['acceptance_type', 'type'])?.toLowerCase()).filter(Boolean))
  return accepted.has('terms') && accepted.has('privacy_policy') && (accepted.has('withdrawal_info') || accepted.has('withdrawal'))
}

export function displayNameFromCustomer(customer: Row | null | undefined, fallbackEmail?: string | null): string | null {
  const fullName = textAt(customer, ['full_name', 'name', 'company_name'])
  if (fullName) return fullName
  const combined = [textAt(customer, ['first_name']), textAt(customer, ['last_name'])].filter(Boolean).join(' ').trim()
  if (combined) return combined
  return fallbackEmail?.trim() || textAt(customer, ['email'])
}

export function hasContractPricePlan(contract: Row | null | undefined): boolean {
  if (!contract) return false
  return hasText(contract, [
    'price_plan_id',
    'price_plan_version_id',
    'contract_price_snapshot_id',
    'contract_offer_id',
    'metadata.price_plan_id',
    'metadata.price_plan_version_id',
    'metadata.contract_offer_id',
    'metadata.contract_number',
    'metadata.public_offer.price_plan_id',
    'metadata.public_offer.price_plan_version_id',
    'metadata.public_offer.offer_code',
    'metadata.source_metadata.price_plan_id',
    'metadata.source_metadata.price_plan_version_id',
    'metadata.source_metadata.contract_display_snapshot.price_plan_id',
    'metadata.source_metadata.contract_display_snapshot.price_plan_version_id',
    'metadata.source_metadata.contract_display_snapshot.offer_reference',
    'metadata.source_metadata.pricing_preview_snapshot.contract.price_plan_id',
    'metadata.source_metadata.pricing_preview_snapshot.contract.price_plan_version_id',
    'metadata.source_metadata.pricing_preview_snapshot.contract.offer_reference',
  ]) || hasText(contract, ['contract_name', 'contract_type'])
}

function hasApplicationPricePlan(application: Row | null | undefined): boolean {
  if (!application) return false
  return hasText(application, [
    'price_plan_id',
    'price_plan_version_id',
    'contract_id',
    'payload.contract.offer_reference',
    'payload.metadata.price_plan_id',
    'payload.metadata.price_plan_version_id',
    'payload.metadata.contract_display_snapshot.price_plan_id',
    'payload.metadata.contract_display_snapshot.price_plan_version_id',
    'payload.metadata.contract_display_snapshot.offer_reference',
    'payload.metadata.pricing_preview_snapshot.contract.price_plan_id',
    'payload.metadata.pricing_preview_snapshot.contract.price_plan_version_id',
    'payload.metadata.pricing_preview_snapshot.contract.offer_reference',
    'response_payload.price_plan_id',
    'response_payload.price_plan_version_id',
    'response_payload.offer_reference',
  ])
}

export function removeFalsePricePlanBlockers<T extends Row>(row: T, hasPricePlan: boolean): T {
  if (!hasPricePlan) return row
  const clone: Row = { ...row }
  for (const key of ['missing_fields', 'blocking_reasons']) {
    const values = asArray(clone[key]).filter((item) => fieldName(item) !== PRICE_BLOCKER_FIELD)
    if (Array.isArray(clone[key])) clone[key] = values
  }

  const metadata = isRecord(clone.metadata) ? { ...clone.metadata } : null
  if (metadata) {
    for (const key of ['missing_fields', 'blocking_reasons']) {
      const values = asArray(metadata[key]).filter((item) => fieldName(item) !== PRICE_BLOCKER_FIELD)
      if (Array.isArray(metadata[key])) metadata[key] = values
    }
    clone.metadata = metadata
  }

  const responsePayload = isRecord(clone.response_payload) ? { ...clone.response_payload } : null
  if (responsePayload) {
    for (const key of ['missing_fields', 'blocking_reasons']) {
      const values = asArray(responsePayload[key]).filter((item) => fieldName(item) !== PRICE_BLOCKER_FIELD)
      if (Array.isArray(responsePayload[key])) responsePayload[key] = values
    }
    clone.response_payload = responsePayload
  }
  return clone as T
}

export function buildPortalCustomerStatus(input: StatusInput): PortalCustomerStatus {
  const contracts = input.contracts ?? []
  const sites = input.sites ?? []
  const meteringPoints = input.meteringPoints ?? []
  const powersOfAttorney = input.powersOfAttorney ?? []
  const legalAcceptances = input.legalAcceptances ?? []
  const applications = input.applications ?? []

  const hasContract = contracts.length > 0
  const primaryContract = contracts[0] ?? null
  const contractStatus = textAt(primaryContract, ['status'])?.toLowerCase() ?? null
  const hasPricePlan = contracts.some(hasContractPricePlan) || applications.some(hasApplicationPricePlan)
  const hasFacilityId = sites.some((site) => hasText(site, ['facility_id', 'normalized_facility_id', 'site_facility_id']))
  const hasMeteringPoint = meteringPoints.some((point) => hasText(point, ['meter_point_id', 'metering_point_id', 'ediel_reference', 'site_facility_id', 'facility_id']))
    || contracts.some((contract) => hasText(contract, ['metering_point_id']))
  const hasGridOwner = sites.some((site) => hasText(site, ['grid_owner_id', 'grid_owner_ediel_id']))
    || meteringPoints.some((point) => hasText(point, ['grid_owner_id', 'grid_owner_ediel_id']))
  const facilityVerified = applications.some((application) => hasText(application, ['facility_data_verified_at']))
    || sites.some((site) => textAt(site, ['resolution_status']) === 'facility_verified')
    || (hasMeteringPoint && hasGridOwner)
  const hasPower = hasSignedPowerOfAttorney(powersOfAttorney)
  const hasLegal = hasLegalAcceptance(legalAcceptances)
  const isActive = contracts.some((contract) => ACTIVE_CONTRACT_STATUSES.has(textAt(contract, ['status'])?.toLowerCase() ?? ''))
  const isReady = contracts.some((contract) => READY_CONTRACT_STATUSES.has(textAt(contract, ['status'])?.toLowerCase() ?? ''))

  const issues = uniqueIssues([
    hasContract ? null : 'missing_contract',
    contractStatus === 'draft' ? 'contract_is_draft' : null,
    hasMeteringPoint ? null : 'missing_metering_point',
    hasFacilityId ? null : 'missing_facility_id',
    hasGridOwner ? null : 'missing_grid_owner',
    facilityVerified ? null : 'facility_not_verified',
    hasPower ? null : 'missing_power_of_attorney',
    hasLegal ? null : 'missing_legal_acceptance',
    hasPricePlan ? null : 'missing_price_plan',
  ])

  const canCreateSwitchRequest = !isActive
    && hasContract
    && contractStatus !== 'draft'
    && hasMeteringPoint
    && hasGridOwner
    && facilityVerified
    && hasPricePlan
  const canDispatchSwitchRequest = canCreateSwitchRequest && hasPower && hasLegal && isReady

  function status(
    value: Omit<PortalCustomerStatus, 'supplier_switch' | 'can_start_switch'>,
  ): PortalCustomerStatus {
    const awaitingResponse = value.code === 'pending_supplier_switch' && !canDispatchSwitchRequest
    return {
      ...value,
      supplier_switch: {
        can_create_request: canCreateSwitchRequest,
        can_dispatch: canDispatchSwitchRequest,
        blockers: issues,
        next_action: isActive
          ? null
          : canDispatchSwitchRequest
            ? 'dispatch_request'
            : canCreateSwitchRequest
              ? 'create_request'
              : awaitingResponse
                ? 'await_response'
                : 'complete_application',
      },
      can_start_switch: canDispatchSwitchRequest,
    }
  }

  if (isActive) {
    return status({
      code: 'active',
      label: 'Aktivt avtal',
      message: 'Avtalet är aktivt och kundens grunduppgifter är verifierade.',
      severity: 'success',
      issues,
    })
  }

  if (canCreateSwitchRequest || isReady) {
    return status({
      code: 'pending_supplier_switch',
      label: 'Leverantörsbyte förbereds',
      message: 'Kundens uppgifter är tillräckliga för nästa operativa steg.',
      severity: 'info',
      issues,
    })
  }

  if (!hasMeteringPoint || !hasFacilityId || !facilityVerified) {
    return status({
      code: 'needs_facility_data',
      label: 'Ansökan behandlas',
      message: hasPower
        ? 'Vi har registrerat ansökan och fullmakten. Anläggningsuppgifter behöver kompletteras innan leverantörsbytet kan starta.'
        : 'Ansökan är mottagen. Fullmakt och anläggningsuppgifter behöver kompletteras innan leverantörsbytet kan starta.',
      severity: 'blocking',
      issues,
    })
  }

  if (!hasGridOwner) {
    return status({
      code: 'needs_grid_owner_review',
      label: 'Nätägare behöver verifieras',
      message: 'Nätägare och nätområdesdata behöver verifieras innan leverantörsbyte kan starta.',
      severity: 'blocking',
      issues,
    })
  }

  if (!hasPower || !hasLegal || !hasPricePlan || !hasContract) {
    return status({
      code: 'needs_review',
      label: 'Behöver granskas',
      message: 'Kundkedjan är skapad men några uppgifter behöver kontrolleras innan nästa steg.',
      severity: 'warning',
      issues,
    })
  }

  return status({
    code: 'application_received',
    label: 'Ansökan mottagen',
    message: 'Ansökan är mottagen och behandlas.',
    severity: 'info',
    issues,
  })
}

export function buildAdminDataChain(input: StatusInput) {
  const status = buildPortalCustomerStatus(input)
  const contracts = input.contracts ?? []
  const sites = input.sites ?? []
  const meteringPoints = input.meteringPoints ?? []
  const powersOfAttorney = input.powersOfAttorney ?? []
  const legalAcceptances = input.legalAcceptances ?? []
  const applications = input.applications ?? []
  const hasPricePlan = contracts.some(hasContractPricePlan) || applications.some(hasApplicationPricePlan)

  return {
    status,
    rows: [
      { label: 'Kund', ok: Boolean(input.customer), detail: input.customer ? 'Kundprofil finns' : 'Kund saknas' },
      { label: 'Portal', ok: Boolean(input.customer), detail: input.customer ? 'Kund kan kopplas mot portal via kund-ID' : 'Saknar portalunderlag' },
      { label: 'Ansökan', ok: applications.length > 0, detail: applications.length > 0 ? `${applications.length} ansökan/ansökningar` : 'Ingen webbansökan kopplad' },
      { label: 'Avtal', ok: contracts.length > 0, detail: contracts.length > 0 ? `${contracts.length} kundavtal` : 'Saknas' },
      { label: 'Prisplan', ok: hasPricePlan, detail: hasPricePlan ? 'Prisplan/snapshot finns' : 'Saknas eller behöver granskas' },
      { label: 'Fullmakt', ok: hasSignedPowerOfAttorney(powersOfAttorney), detail: hasSignedPowerOfAttorney(powersOfAttorney) ? 'Signerad' : 'Saknas' },
      { label: 'Juridik', ok: hasLegalAcceptance(legalAcceptances), detail: hasLegalAcceptance(legalAcceptances) ? 'Villkor sparade' : 'Godkännanden saknas' },
      { label: 'Adress', ok: sites.length > 0, detail: sites.length > 0 ? `${sites.length} anläggningsplats` : 'Saknas' },
      { label: 'Mätpunkt', ok: meteringPoints.length > 0, detail: meteringPoints.length > 0 ? `${meteringPoints.length} mätpunkt(er)` : 'Saknas' },
    ],
  }
}
