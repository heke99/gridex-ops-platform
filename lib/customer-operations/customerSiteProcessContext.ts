import { supabaseService } from '@/lib/supabase/service'
import { requireUuid } from '@/lib/validation/uuid'

export type CustomerProcessType =
  | 'supplier_switch_existing_site'
  | 'move_in'
  | 'move_out'
  | 'takeover'
  | 'unknown'

export type RequiredAuthorizationOperation =
  | 'facility_information'
  | 'supplier_switch'
  | 'metering_data'
  | 'billing_underlay'

export type ProcessBlocker = {
  code: string
  message: string
  source: string
}

export type AuthorizationResolution = {
  allowed: boolean
  authorizationId: string | null
  powerOfAttorneyId: string | null
  scope: RequiredAuthorizationOperation
  validFrom: string | null
  validUntil: string | null
  evidence: Record<string, unknown>
  blockers: ProcessBlocker[]
}

export type ContractOperationalReadiness = {
  ready: boolean
  contractId: string | null
  status: string | null
  requestedStartDate: string | null
  blockers: ProcessBlocker[]
  evidence: Record<string, unknown>
}

export type ProdatCustomerProcessVariant = {
  processType: CustomerProcessType
  z01Variant: 'L' | 'LK' | null
  z01Reason: 'Z22' | 'Z23' | null
  expectedZ02Variant: 'L' | 'LK' | null
  z03Variant: 'L' | 'LK' | null
  supported: boolean
  blockerCode: string | null
}

export type CustomerSiteProcessContext = {
  companyId: string
  customerId: string
  siteId: string
  contractId: string | null
  meteringPointId: string | null
  processType: CustomerProcessType
  gridOwnerId: string | null
  gridAreaCode: string | null
  priceAreaCode: string | null
  facilityId: string | null
  meteringPointExternalId: string | null
  contractReady: boolean
  authorizationReady: boolean
  facilityReady: boolean
  gridOwnerReady: boolean
  routeReady: boolean
  currentSupplier: {
    id: string | null
    name: string | null
    orgNumber: string | null
    edielId: string | null
    explicitlyUnknown: boolean
  }
  requestedStartDate: string | null
  blockers: ProcessBlocker[]
  warnings: ProcessBlocker[]
  evidence: Record<string, unknown>
}

type JsonRecord = Record<string, unknown>

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function missingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function normalizeProcessType(value: unknown): CustomerProcessType | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (['supplier_switch_existing_site', 'supplier_switch', 'switch', 'existing_site'].includes(normalized)) return 'supplier_switch_existing_site'
  if (['move_in', 'move-in', 'inflytt'].includes(normalized)) return 'move_in'
  if (['move_out', 'move-out', 'utflytt'].includes(normalized)) return 'move_out'
  if (['takeover', 'overtagande', 'övertagande'].includes(normalized)) return 'takeover'
  if (normalized === 'unknown') return 'unknown'
  return null
}

function explicitProcessType(...sources: unknown[]): CustomerProcessType | null {
  for (const source of sources) {
    const value = record(source)
    const candidate = normalizeProcessType(
      value.process_type ?? value.processType ?? value.customer_process_type ?? value.customerProcessType,
    )
    if (candidate) return candidate
  }
  return null
}

function isFuture(value: string | null, now = new Date()): boolean {
  if (!value) return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() > now.getTime()
}

function isPast(value: string | null, now = new Date()): boolean {
  if (!value) return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() < now.getTime()
}

function poaAllowsOperation(row: JsonRecord, required: RequiredAuthorizationOperation): boolean {
  const values = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value === 'string') values.add(value.trim().toLowerCase())
    if (Array.isArray(value)) value.forEach(add)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.entries(value as JsonRecord).forEach(([key, nested]) => {
        if (nested === true) values.add(key.trim().toLowerCase())
        add(nested)
      })
    }
  }
  add(row.scope)
  add(row.scope_summary)
  add(row.signed_scope_snapshot)
  add(row.fullmakt_snapshot)

  if (required === 'supplier_switch') return values.has('supplier_switch')
  if (required === 'facility_information') {
    return values.has('facility_information_lookup') || values.has('grid_owner_data') || values.has('supplier_switch')
  }
  if (required === 'metering_data') return values.has('meter_data') || values.has('metering_data')
  return values.has('billing_handoff') || values.has('billing_underlay')
}

function authorizationCoverageColumn(required: RequiredAuthorizationOperation):
  | 'covers_grid_owner_data'
  | 'covers_current_supplier_contract'
  | 'covers_metering_data'
  | null {
  if (required === 'facility_information') return 'covers_grid_owner_data'
  if (required === 'supplier_switch') return 'covers_current_supplier_contract'
  if (required === 'metering_data') return 'covers_metering_data'
  return null
}

export function resolveProdatCustomerProcessVariant(processType: CustomerProcessType): ProdatCustomerProcessVariant {
  if (processType === 'supplier_switch_existing_site') {
    return {
      processType,
      z01Variant: 'L',
      z01Reason: 'Z22',
      expectedZ02Variant: 'L',
      z03Variant: 'L',
      supported: true,
      blockerCode: null,
    }
  }
  if (processType === 'move_in') {
    return {
      processType,
      z01Variant: 'LK',
      z01Reason: 'Z23',
      expectedZ02Variant: 'LK',
      z03Variant: 'LK',
      supported: true,
      blockerCode: null,
    }
  }
  return {
    processType,
    z01Variant: null,
    z01Reason: null,
    expectedZ02Variant: null,
    z03Variant: null,
    supported: false,
    blockerCode: processType === 'unknown' ? 'process_type_unknown' : 'process_type_not_supported_for_z01_z03',
  }
}

export async function isContractOperationallyReadyForSite(input: {
  companyId: string
  customerId: string
  siteId: string
  contractId?: string | null
}): Promise<ContractOperationalReadiness> {
  const companyId = requireUuid(input.companyId, 'company_id')
  const customerId = requireUuid(input.customerId, 'customer_id')
  const siteId = requireUuid(input.siteId, 'customer_site_id')
  const blockers: ProcessBlocker[] = []

  let query = supabaseService
    .from('customer_contracts')
    .select('id,status,signed_at,requested_start_date,starts_at,customer_site_id,site_id,legal_readiness_status,metadata')
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .or(`customer_site_id.eq.${siteId},site_id.eq.${siteId}`)
    .in('status', ['signed', 'active'])
    .order('signed_at', { ascending: false, nullsFirst: false })
    .limit(1)
  if (input.contractId) query = query.eq('id', requireUuid(input.contractId, 'customer_contract_id'))
  const candidate = await query.maybeSingle()
  if (candidate.error) {
    if (missingSchema(candidate.error)) {
      return {
        ready: false,
        contractId: null,
        status: null,
        requestedStartDate: null,
        blockers: [{ code: 'contract_readiness_unavailable', message: 'Avtalsreadiness kunde inte verifieras.', source: 'contract' }],
        evidence: { schema_available: false },
      }
    }
    throw candidate.error
  }

  const contract = candidate.data as JsonRecord | null
  const contractId = clean(contract?.id)
  if (!contractId) {
    return {
      ready: false,
      contractId: null,
      status: null,
      requestedStartDate: null,
      blockers: [{ code: 'contract_missing', message: 'Inget signerat avtal är kopplat till exakt denna anläggning.', source: 'contract' }],
      evidence: { company_id: companyId, customer_id: customerId, site_id: siteId },
    }
  }

  if (!clean(contract?.signed_at)) {
    blockers.push({ code: 'contract_signature_missing', message: 'Avtalet saknar verifierad server-side signeringstid.', source: 'contract' })
  }

  const readiness = await supabaseService
    .from('customer_contract_lifecycle_readiness_v')
    .select('customer_contract_id,agreement_ready,agreement_signed,active,lifecycle_stage,blockers')
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .eq('customer_site_id', siteId)
    .eq('customer_contract_id', contractId)
    .maybeSingle()
  if (readiness.error) {
    if (missingSchema(readiness.error)) {
      blockers.push({ code: 'contract_readiness_unavailable', message: 'Canonical avtalsreadiness saknas.', source: 'contract' })
    } else {
      throw readiness.error
    }
  } else if (!readiness.data) {
    blockers.push({ code: 'contract_site_mismatch', message: 'Avtalsreadiness saknar exakt tenant/kund/site-koppling.', source: 'contract' })
  } else {
    const row = readiness.data as JsonRecord
    if (row.agreement_ready !== true || row.agreement_signed !== true) {
      blockers.push({ code: 'agreement_not_operationally_ready', message: 'Avtalet är inte juridiskt/signaturmässigt redo för anläggningen.', source: 'contract' })
    }
  }

  return {
    ready: blockers.length === 0,
    contractId,
    status: clean(contract?.status),
    requestedStartDate: clean(contract?.requested_start_date) ?? clean(contract?.starts_at)?.slice(0, 10) ?? null,
    blockers,
    evidence: {
      contract_id: contractId,
      contract_status: clean(contract?.status),
      site_id: siteId,
      agreement_ready: readiness.data ? (readiness.data as JsonRecord).agreement_ready === true : false,
      agreement_signed: readiness.data ? (readiness.data as JsonRecord).agreement_signed === true : false,
    },
  }
}

export async function resolveAuthorizationForOperation(input: {
  companyId: string
  customerId: string
  siteId: string
  contractId?: string | null
  requiredScope: RequiredAuthorizationOperation
}): Promise<AuthorizationResolution> {
  const companyId = requireUuid(input.companyId, 'company_id')
  const customerId = requireUuid(input.customerId, 'customer_id')
  const siteId = requireUuid(input.siteId, 'customer_site_id')
  const blockers: ProcessBlocker[] = []
  const now = new Date()

  const poaQuery = await supabaseService
    .from('powers_of_attorney')
    .select('id,site_id,customer_site_id,contract_id,customer_contract_id,scope,status,signed_at,valid_from,valid_to,valid_until,revoked_at,document_id,scope_summary,signed_scope_snapshot,fullmakt_snapshot,created_at')
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .eq('status', 'signed')
    .is('revoked_at', null)
    .or(`site_id.eq.${siteId},customer_site_id.eq.${siteId}`)
    .order('created_at', { ascending: false })
    .limit(20)
  if (poaQuery.error) {
    if (missingSchema(poaQuery.error)) {
      return {
        allowed: false,
        authorizationId: null,
        powerOfAttorneyId: null,
        scope: input.requiredScope,
        validFrom: null,
        validUntil: null,
        evidence: { schema_available: false },
        blockers: [{ code: 'authorization_schema_unavailable', message: 'Fullmaktskedjan kan inte verifieras.', source: 'authorization' }],
      }
    }
    throw poaQuery.error
  }

  const contractId = clean(input.contractId)
  const candidates = ((poaQuery.data ?? []) as JsonRecord[]).filter((row) => {
    const rowSite = clean(row.customer_site_id) ?? clean(row.site_id)
    if (rowSite !== siteId) return false
    const rowContract = clean(row.customer_contract_id) ?? clean(row.contract_id)
    if (contractId && rowContract && rowContract !== contractId) return false
    if (isFuture(clean(row.valid_from), now)) return false
    if (isPast(clean(row.valid_until) ?? clean(row.valid_to), now)) return false
    return poaAllowsOperation(row, input.requiredScope)
  })
  const poa = candidates[0] ?? null
  const poaId = clean(poa?.id)
  if (!poaId) {
    return {
      allowed: false,
      authorizationId: null,
      powerOfAttorneyId: null,
      scope: input.requiredScope,
      validFrom: null,
      validUntil: null,
      evidence: { site_id: siteId, exact_site_only: true },
      blockers: [{ code: 'valid_site_authorization_missing', message: 'Giltig site-specifik fullmakt med rätt scope saknas.', source: 'authorization' }],
    }
  }

  const docs = await supabaseService
    .from('customer_authorization_documents')
    .select('id,site_id,power_of_attorney_id,customer_contract_id,status')
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .eq('site_id', siteId)
    .eq('power_of_attorney_id', poaId)
    .in('status', ['active', 'signed'])
  if (docs.error) {
    if (missingSchema(docs.error)) {
      blockers.push({ code: 'authorization_document_schema_unavailable', message: 'Authorization document kan inte verifieras.', source: 'authorization' })
    } else {
      throw docs.error
    }
  }
  const documentRows = (docs.data ?? []) as JsonRecord[]
  const document = documentRows.find((row) => {
    const rowContract = clean(row.customer_contract_id)
    return !contractId || !rowContract || rowContract === contractId
  }) ?? null
  const authorizationId = clean(document?.id)
  if (!authorizationId) {
    blockers.push({ code: 'authorization_document_missing_for_site', message: 'Fullmakten saknar canonical authorization-document för exakt denna site.', source: 'authorization' })
  }

  const coverageColumn = authorizationCoverageColumn(input.requiredScope)
  if (coverageColumn && authorizationId) {
    const scopes = await supabaseService
      .from('authorization_scopes')
      .select('id,status,revoked_at,valid_from,valid_to,covers_grid_owner_data,covers_current_supplier_contract,covers_metering_data')
      .eq('company_id', companyId)
      .eq('customer_id', customerId)
      .eq('authorization_document_id', authorizationId)
      .eq('status', 'active')
      .is('revoked_at', null)
    if (scopes.error) {
      if (missingSchema(scopes.error)) {
        blockers.push({ code: 'authorization_scope_schema_unavailable', message: 'Authorization scope kan inte verifieras.', source: 'authorization' })
      } else {
        throw scopes.error
      }
    } else {
      const covered = ((scopes.data ?? []) as JsonRecord[]).some((row) => {
        if (isFuture(clean(row.valid_from), now) || isPast(clean(row.valid_to), now)) return false
        return row[coverageColumn] === true
      })
      if (!covered) {
        blockers.push({ code: 'authorization_scope_missing', message: `Fullmaktens canonical scope täcker inte ${input.requiredScope} för denna site.`, source: 'authorization' })
      }
    }
  }

  return {
    allowed: blockers.length === 0,
    authorizationId,
    powerOfAttorneyId: poaId,
    scope: input.requiredScope,
    validFrom: clean(poa?.valid_from),
    validUntil: clean(poa?.valid_until) ?? clean(poa?.valid_to),
    evidence: {
      exact_site_only: true,
      site_id: siteId,
      power_of_attorney_id: poaId,
      authorization_document_id: authorizationId,
      contract_id: contractId,
      required_scope: input.requiredScope,
    },
    blockers,
  }
}

function deriveProcessType(input: {
  site: JsonRecord
  contract: JsonRecord | null
  switchRequest: JsonRecord | null
}): CustomerProcessType {
  const explicit = explicitProcessType(input.switchRequest?.metadata, input.contract?.metadata, input.site.metadata)
  if (explicit) return explicit

  const requestType = clean(input.switchRequest?.request_type)
  if (requestType === 'switch') return 'supplier_switch_existing_site'
  if (requestType === 'move_in') return 'move_in'
  if (requestType === 'move_out_takeover') return clean(input.site.move_out_date) ? 'move_out' : 'takeover'

  const hasCurrentSupplierEvidence = Boolean(
    clean(input.site.current_supplier_id) ||
    clean(input.site.current_supplier_name) ||
    clean(input.site.current_supplier_org_number) ||
    clean(input.site.current_supplier_ediel_id) ||
    input.site.current_supplier_unknown === true,
  )
  if (clean(input.site.move_out_date)) return 'move_out'
  if (hasCurrentSupplierEvidence) return 'supplier_switch_existing_site'
  if (clean(input.site.move_in_date)) return 'move_in'
  return 'unknown'
}

export async function resolveCustomerSiteProcessContext(input: {
  companyId: string
  customerId: string
  siteId: string
  contractId?: string | null
  operationId?: string | null
}): Promise<CustomerSiteProcessContext> {
  const companyId = requireUuid(input.companyId, 'company_id')
  const customerId = requireUuid(input.customerId, 'customer_id')
  const siteId = requireUuid(input.siteId, 'customer_site_id')
  const blockers: ProcessBlocker[] = []
  const warnings: ProcessBlocker[] = []

  const siteResult = await supabaseService
    .from('customer_sites')
    .select('*')
    .eq('id', siteId)
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .maybeSingle()
  if (siteResult.error) throw siteResult.error
  const site = siteResult.data as JsonRecord | null
  if (!site) {
    throw new Error('customer_site_not_found_or_wrong_scope')
  }

  const meterResult = await supabaseService
    .from('metering_points')
    .select('*')
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .or(`site_id.eq.${siteId},customer_site_id.eq.${siteId}`)
    .order('created_at', { ascending: false })
    .limit(20)
  if (meterResult.error && !missingSchema(meterResult.error)) throw meterResult.error
  const meters = ((meterResult.data ?? []) as JsonRecord[])
  const meteringPoint = meters.find((row) => row.status === 'active') ?? meters[0] ?? null

  const contractReady = await isContractOperationallyReadyForSite({
    companyId,
    customerId,
    siteId,
    contractId: input.contractId ?? null,
  })
  blockers.push(...contractReady.blockers)

  const contractResult = contractReady.contractId
    ? await supabaseService
        .from('customer_contracts')
        .select('id,metadata,requested_start_date,starts_at')
        .eq('company_id', companyId)
        .eq('customer_id', customerId)
        .eq('id', contractReady.contractId)
        .maybeSingle()
    : { data: null, error: null }
  if (contractResult.error && !missingSchema(contractResult.error)) throw contractResult.error
  const contract = contractResult.data as JsonRecord | null

  const switchResult = await supabaseService
    .from('supplier_switch_requests')
    .select('id,request_type,status,requested_start_date,metadata')
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .or(`site_id.eq.${siteId},customer_site_id.eq.${siteId}`)
    .in('status', ['draft', 'queued', 'validated', 'ready_to_send', 'submitted', 'waiting_response', 'manual_followup_required'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (switchResult.error && !missingSchema(switchResult.error)) throw switchResult.error
  const switchRequest = switchResult.data as JsonRecord | null

  const processType = deriveProcessType({ site, contract, switchRequest })
  const variant = resolveProdatCustomerProcessVariant(processType)
  if (!variant.supported) {
    blockers.push({
      code: variant.blockerCode ?? 'process_type_unknown',
      message: 'Process-typen kan inte automatiskt mappas till en säker Z01/Z02/Z03-variant.',
      source: 'process_type',
    })
  }

  const facilityId = clean(site.normalized_facility_id) ?? clean(site.facility_id)
  const meteringPointExternalId =
    clean(meteringPoint?.ediel_reference) ??
    clean(meteringPoint?.ediel_metering_point_id) ??
    clean(meteringPoint?.metering_point_id) ??
    clean(meteringPoint?.meter_point_id)
  const facilityReady = Boolean(facilityId || meteringPointExternalId)

  const requiredAuthorizationScope: RequiredAuthorizationOperation = facilityReady ? 'supplier_switch' : 'facility_information'
  const authorization = await resolveAuthorizationForOperation({
    companyId,
    customerId,
    siteId,
    contractId: contractReady.contractId,
    requiredScope: requiredAuthorizationScope,
  })
  blockers.push(...authorization.blockers)

  const gridOwnerId = clean(meteringPoint?.grid_owner_id) ?? clean(site.grid_owner_id) ?? clean(site.selected_grid_owner_id)
  let gridOwnerReady = false
  let routeReady = false
  let gridOwnerEvidence: JsonRecord = {}
  if (!gridOwnerId) {
    blockers.push({ code: 'grid_owner_missing', message: 'Verifierad nätägare saknas för anläggningen.', source: 'grid_owner' })
  } else {
    const owner = await supabaseService
      .from('grid_owners')
      .select('id,verified_for_customer_flow,technical_owner_only,verification_status,prodat_ready_for_customer_flow,supplier_switch_ready,route_status')
      .eq('id', gridOwnerId)
      .maybeSingle()
    if (owner.error && !missingSchema(owner.error)) throw owner.error
    const row = owner.data as JsonRecord | null
    gridOwnerReady = Boolean(row && row.verified_for_customer_flow === true && row.technical_owner_only !== true && clean(row.verification_status) === 'verified')
    if (!gridOwnerReady) {
      blockers.push({ code: 'grid_owner_not_verified', message: 'Nätägaren är mappad men inte verifierad för kundflöde.', source: 'grid_owner' })
    }

    const manual = await supabaseService
      .from('grid_owner_contact_channels')
      .select('id')
      .eq('grid_owner_id', gridOwnerId)
      .eq('channel_type', 'facility_information_request')
      .eq('is_enabled', true)
      .eq('is_verified', true)
      .limit(1)
    if (manual.error && !missingSchema(manual.error)) throw manual.error
    const manualReady = Boolean((manual.data ?? []).length)
    const prodatReady = Boolean(row?.prodat_ready_for_customer_flow === true && row?.supplier_switch_ready === true)
    routeReady = facilityReady ? prodatReady : manualReady || prodatReady
    if (!routeReady) {
      blockers.push({ code: 'route_not_ready', message: 'Nätägaren saknar verifierad route för nästa site-operation.', source: 'route' })
    }
    gridOwnerEvidence = {
      grid_owner_id: gridOwnerId,
      verified_for_customer_flow: row?.verified_for_customer_flow === true,
      technical_owner_only: row?.technical_owner_only === true,
      prodat_ready_for_customer_flow: row?.prodat_ready_for_customer_flow === true,
      supplier_switch_ready: row?.supplier_switch_ready === true,
      manual_facility_route_ready: manualReady,
      route_status: clean(row?.route_status),
    }
  }

  if (!facilityReady) {
    warnings.push({ code: 'facility_information_required', message: 'Anläggnings-/mätpunktsidentitet saknas och måste hämtas för exakt site.', source: 'facility' })
  }

  return {
    companyId,
    customerId,
    siteId,
    contractId: contractReady.contractId,
    meteringPointId: clean(meteringPoint?.id),
    processType,
    gridOwnerId,
    gridAreaCode: clean(meteringPoint?.grid_area_code) ?? clean(site.grid_area_code),
    priceAreaCode: clean(meteringPoint?.price_area_code) ?? clean(site.price_area_code) ?? clean(site.bidding_zone_code),
    facilityId,
    meteringPointExternalId,
    contractReady: contractReady.ready,
    authorizationReady: authorization.allowed,
    facilityReady,
    gridOwnerReady,
    routeReady,
    currentSupplier: {
      id: clean(site.current_supplier_id),
      name: clean(site.current_supplier_name),
      orgNumber: clean(site.current_supplier_org_number),
      edielId: clean(site.current_supplier_ediel_id),
      explicitlyUnknown: site.current_supplier_unknown === true,
    },
    requestedStartDate:
      clean(switchRequest?.requested_start_date) ??
      contractReady.requestedStartDate ??
      clean(site.move_in_date) ??
      null,
    blockers,
    warnings,
    evidence: {
      operation_id: clean(input.operationId),
      site_id: siteId,
      contract: contractReady.evidence,
      authorization: authorization.evidence,
      process_variant: variant,
      grid_owner: gridOwnerEvidence,
      facility: {
        facility_id: facilityId,
        metering_point_record_id: clean(meteringPoint?.id),
        metering_point_external_id: meteringPointExternalId,
      },
    },
  }
}