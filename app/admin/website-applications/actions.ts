'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdminAccess, requireCompanyScopedActionAccess, isPlatformAdminContext } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { assessWebsiteApplicationReadiness, cleanReviewText, customerIntakeStatusForReadiness } from '@/lib/website/applicationReview'
import { resolveEnergyContext } from '@/lib/energy/resolver'
import { ensureGridOwnerInformationRequest, markFacilityDataReceived } from '@/lib/energy/gridOwnerRequests'

const WRITE_PERMISSIONS = { anyOf: ['customers.write', 'switching.write', 'metering.write', 'poa.write'] }

type ApplicationRecord = {
  id: string
  company_id: string
  customer_id: string | null
  customer_site_id: string | null
  metering_point_id: string | null
  contract_id: string | null
  status: string
  payload: Record<string, unknown> | null
  raw_payload: Record<string, unknown> | null
  response_payload: Record<string, unknown> | null
  timeline: unknown[] | null
  audit_log: unknown[] | null
  resolution_id?: string | null
  grid_owner_information_request_id?: string | null
  grid_area_code?: string | null
  grid_owner_id?: string | null
  price_area_code?: string | null
  resolution_status?: string | null
  resolution_confidence?: number | null
  requested_start_mode?: string | null
  calculated_earliest_start_date?: string | null
  facility_data_verified_at?: string | null
}

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? '').trim()
  return value.length > 0 ? value : null
}

function checkbox(formData: FormData, key: string): boolean | null {
  if (!formData.has(key)) return null
  const value = String(formData.get(key) ?? '').trim().toLowerCase()
  return ['on', 'true', '1', 'yes', 'ja', 'accepted'].includes(value)
}

function asBooleanLike(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return ['true', 'yes', 'ja', '1', 'on', 'verified', 'received'].includes(value.trim().toLowerCase())
  if (typeof value === 'number') return value === 1
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isUuid(value: string | null): boolean {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
}

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

const WEBSITE_APPLICATION_CONTRACT_SOURCE_TYPE = 'website_application'
const LEGACY_WEBSITE_APPLICATION_REVIEW_SOURCE_TYPE = 'website_application_review'
const WEBSITE_APPLICATION_CONTRACT_CHANNEL = 'external_website'
const WEBSITE_APPLICATION_READY_CONTRACT_STATUS = 'pending_signature'
const WEBSITE_APPLICATION_DRAFT_CONTRACT_STATUS = 'draft'
const WEBSITE_CONTRACT_SOURCE_TYPES = [
  WEBSITE_APPLICATION_CONTRACT_SOURCE_TYPE,
  LEGACY_WEBSITE_APPLICATION_REVIEW_SOURCE_TYPE,
]

type WebsiteContractRow = {
  id: string
  contract_name: string | null
  starts_at: string | null
  status: string | null
  site_id?: string | null
  customer_site_id?: string | null
  metering_point_id?: string | null
  requested_start_date?: string | null
}

function matchesExpectedValue(actual: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected) return true
  return actual === expected
}

function matchesExpectedDate(actual: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected) return true
  return Boolean(actual && String(actual).slice(0, 10) === String(expected).slice(0, 10))
}

async function findExistingApplicationContract(input: {
  companyId: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  requestedStartDate?: string | null
  contractName?: string | null
}): Promise<WebsiteContractRow | null> {
  const { data, error } = await supabaseService
    .from('customer_contracts')
    .select('id,contract_name,starts_at,status,site_id,customer_site_id,metering_point_id,requested_start_date')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .in('source_type', WEBSITE_CONTRACT_SOURCE_TYPES)
    .order('created_at', { ascending: false })
    .limit(25)

  if (error) {
    if (missingSchema(error)) return null
    throw error
  }

  const rows = (data ?? []) as WebsiteContractRow[]
  return rows.find((row) => {
    const rowSiteId = row.customer_site_id ?? row.site_id ?? null
    const siteMatches = matchesExpectedValue(rowSiteId, input.siteId ?? null)
    const meterMatches = matchesExpectedValue(row.metering_point_id ?? null, input.meteringPointId ?? null)
    const dateMatches = matchesExpectedDate(row.requested_start_date ?? row.starts_at ?? null, input.requestedStartDate ?? null)
    const nameMatches = !input.contractName || !row.contract_name || row.contract_name === input.contractName
    return siteMatches && meterMatches && dateMatches && nameMatches
  }) ?? null
}

function timelineEvent(type: string, label: string, metadata: Record<string, unknown> = {}) {
  return {
    type,
    label,
    metadata,
    occurred_at: new Date().toISOString(),
  }
}

function auditEvent(action: string, actorUserId: string, oldValues: Record<string, unknown>, newValues: Record<string, unknown>) {
  return {
    action,
    actor_user_id: actorUserId,
    old_values: oldValues,
    new_values: newValues,
    created_at: new Date().toISOString(),
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

async function authorizeForCompany(companyId: string) {
  const admin = await requireAdminAccess()
  if (isPlatformAdminContext(admin)) return admin
  return requireCompanyScopedActionAccess(companyId, WRITE_PERMISSIONS)
}

async function loadApplication(applicationId: string): Promise<ApplicationRecord> {
  const { data, error } = await supabaseService
    .from('website_customer_applications')
    .select('id,company_id,customer_id,customer_site_id,metering_point_id,contract_id,status,payload,raw_payload,response_payload,timeline,audit_log,resolution_id,grid_owner_information_request_id,grid_area_code,grid_owner_id,price_area_code,resolution_status,resolution_confidence,requested_start_mode,calculated_earliest_start_date,facility_data_verified_at')
    .eq('id', applicationId)
    .single()

  if (error) throw error
  return data as ApplicationRecord
}

function mergePayload(current: Record<string, unknown> | null, formData: FormData) {
  const base: Record<string, unknown> = isRecord(current) ? { ...current } : {}
  const customer = isRecord(base.customer) ? { ...base.customer } : {}
  const site = isRecord(base.site) ? { ...base.site } : {}
  const meteringPoint = isRecord(base.metering_point) ? { ...base.metering_point } : {}
  const contract = isRecord(base.contract) ? { ...base.contract } : {}
  const consents = isRecord(base.consents) ? { ...base.consents } : {}

  const assignments: Array<[Record<string, unknown>, string, string | null]> = [
    [customer, 'full_name', text(formData, 'customer_full_name')],
    [customer, 'email', text(formData, 'customer_email')],
    [customer, 'phone', text(formData, 'customer_phone')],
    [site, 'facility_id', text(formData, 'facility_id')],
    [site, 'street', text(formData, 'site_street')],
    [site, 'postal_code', text(formData, 'site_postal_code')],
    [site, 'city', text(formData, 'site_city')],
    [site, 'grid_area_code', text(formData, 'grid_area_code')],
    [site, 'price_area_code', text(formData, 'price_area_code')],
    [site, 'move_in_date', text(formData, 'requested_start_date')],
    [meteringPoint, 'metering_point_id', text(formData, 'metering_point_id')],
    [meteringPoint, 'site_facility_id', text(formData, 'facility_id')],
    [meteringPoint, 'grid_area_code', text(formData, 'grid_area_code')],
    [meteringPoint, 'price_area_code', text(formData, 'price_area_code')],
    [contract, 'price_plan_id', text(formData, 'price_plan_id')],
    [contract, 'contract_name', text(formData, 'contract_name')],
    [contract, 'requested_start_date', text(formData, 'requested_start_date')],
    [contract, 'requested_start_mode', text(formData, 'requested_start_mode')],
    [contract, 'calculated_earliest_start_date', text(formData, 'calculated_earliest_start_date')],
    [contract, 'confirmed_start_date', text(formData, 'confirmed_start_date')],
    [contract, 'actual_start_date', text(formData, 'actual_start_date')],
  ]

  for (const [target, key, value] of assignments) {
    if (value !== null) target[key] = value
  }

  const gridOwnerId = text(formData, 'grid_owner_id')
  const networkOwnerId = text(formData, 'network_owner_id')
  const electricitySupplierId = text(formData, 'electricity_supplier_id')
  const pricePlanId = text(formData, 'price_plan_id')
  const requestedStartDate = text(formData, 'requested_start_date')
  const confirmedStartDate = text(formData, 'confirmed_start_date')
  const actualStartDate = text(formData, 'actual_start_date')
  const requestedStartMode = text(formData, 'requested_start_mode')
  const calculatedEarliestStartDate = text(formData, 'calculated_earliest_start_date')
  const gridAreaCode = text(formData, 'grid_area_code')
  const priceAreaCode = text(formData, 'price_area_code')
  const resolutionStatus = text(formData, 'resolution_status')
  const facilityDataVerified = checkbox(formData, 'facility_data_verified')
  const powerOfAttorney = checkbox(formData, 'power_of_attorney_accepted')
  const termsAccepted = checkbox(formData, 'terms_accepted')

  if (gridOwnerId) {
    base.grid_owner_id = gridOwnerId
    site.grid_owner_id = gridOwnerId
  }
  if (networkOwnerId) base.network_owner_id = networkOwnerId
  if (electricitySupplierId) base.electricity_supplier_id = electricitySupplierId
  if (pricePlanId) base.price_plan_id = pricePlanId
  if (requestedStartDate) base.requested_start_date = requestedStartDate
  if (confirmedStartDate) base.confirmed_start_date = confirmedStartDate
  if (actualStartDate) base.actual_start_date = actualStartDate
  if (requestedStartMode) base.requested_start_mode = requestedStartMode
  if (calculatedEarliestStartDate) base.calculated_earliest_start_date = calculatedEarliestStartDate
  if (gridAreaCode) base.grid_area_code = gridAreaCode
  if (priceAreaCode) base.price_area_code = priceAreaCode
  if (resolutionStatus) base.resolution_status = resolutionStatus
  if (facilityDataVerified !== null) base.facility_data_verified = facilityDataVerified
  if (powerOfAttorney !== null) {
    consents.power_of_attorney = powerOfAttorney
    consents.fullmakt_accepted = powerOfAttorney
  }
  if (termsAccepted !== null) {
    consents.terms_accepted = termsAccepted
    consents.terms = termsAccepted
  }

  base.customer = customer
  base.site = site
  base.metering_point = meteringPoint
  base.contract = contract
  base.consents = consents

  return base
}

async function updateCustomerReviewState(application: ApplicationRecord, readiness: ReturnType<typeof assessWebsiteApplicationReadiness>) {
  if (!application.customer_id) return

  const { error } = await supabaseService
    .from('customers')
    .update({
      intake_status: customerIntakeStatusForReadiness(readiness),
      intake_missing_fields: readiness.missingFields,
      intake_quality_score: readiness.qualityScore,
      intake_warnings: readiness.warnings,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', application.company_id)
    .eq('id', application.customer_id)

  if (error && !missingSchema(error)) throw error
}

async function upsertApplicationSite(application: ApplicationRecord, payload: Record<string, unknown>) {
  if (!application.customer_id) return application.customer_site_id
  const site = isRecord(payload.site) ? payload.site : {}
  const facilityId = cleanReviewText(site.facility_id)
  const street = cleanReviewText(site.street)
  const city = cleanReviewText(site.city)
  const postalCode = cleanReviewText(site.postal_code)
  const gridOwnerInput = cleanReviewText(site.grid_owner_id) ?? cleanReviewText(payload.grid_owner_id)
  const gridOwnerId = isUuid(gridOwnerInput) ? gridOwnerInput : null
  const moveInDate = cleanReviewText(site.move_in_date) ?? cleanReviewText(payload.requested_start_date)

  if (!facilityId && !street && !city) return application.customer_site_id

  if (application.customer_site_id) {
    const { error } = await supabaseService
      .from('customer_sites')
      .update({
        facility_id: facilityId,
        street,
        postal_code: postalCode,
        city,
        grid_owner_id: gridOwnerId,
        grid_area_code: cleanReviewText(site.grid_area_code) ?? cleanReviewText(payload.grid_area_code),
        price_area_code: cleanReviewText(site.price_area_code) ?? cleanReviewText(payload.price_area_code),
        resolution_status: cleanReviewText(payload.resolution_status),
        facility_data_verified_at: asBooleanLike(payload.facility_data_verified) ? new Date().toISOString() : undefined,
        move_in_date: moveInDate,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', application.company_id)
      .eq('id', application.customer_site_id)

    if (error && !missingSchema(error)) throw error
    return application.customer_site_id
  }

  const insertPayload = {
    company_id: application.company_id,
    customer_id: application.customer_id,
    site_name: facilityId ?? street ?? 'Anläggning',
    site_type: 'consumption',
    status: 'active',
    facility_id: facilityId,
    street,
    postal_code: postalCode,
    city,
    grid_owner_id: gridOwnerId,
    grid_area_code: cleanReviewText(site.grid_area_code) ?? cleanReviewText(payload.grid_area_code),
    price_area_code: cleanReviewText(site.price_area_code) ?? cleanReviewText(payload.price_area_code),
    resolution_status: cleanReviewText(payload.resolution_status),
    facility_data_verified_at: asBooleanLike(payload.facility_data_verified) ? new Date().toISOString() : null,
    move_in_date: moveInDate,
    country: 'SE',
    metadata: { source: 'website_application_review' },
  }

  const { data, error } = await supabaseService
    .from('customer_sites')
    .insert(insertPayload)
    .select('id')
    .single()

  if (error && !missingSchema(error)) throw error
  if (data?.id) return String(data.id)

  const fallback = await supabaseService
    .from('customer_sites')
    .insert({
      company_id: application.company_id,
      customer_id: application.customer_id,
      site_name: facilityId ?? street ?? 'Anläggning',
      status: 'active',
      facility_id: facilityId,
    })
    .select('id')
    .single()
  if (fallback.error) throw fallback.error
  return String(fallback.data.id)
}

async function upsertApplicationMeteringPoint(application: ApplicationRecord, siteId: string | null, payload: Record<string, unknown>) {
  if (!application.customer_id || !siteId) return application.metering_point_id
  const metering = isRecord(payload.metering_point) ? payload.metering_point : {}
  const site = isRecord(payload.site) ? payload.site : {}
  const meteringPointId = cleanReviewText(metering.metering_point_id)
    ?? cleanReviewText(metering.meter_point_id)
    ?? cleanReviewText(metering.ediel_metering_point_id)
    ?? cleanReviewText(metering.anlage_id)
    ?? null
  if (!meteringPointId) return application.metering_point_id

  if (application.metering_point_id) {
    const { error } = await supabaseService
      .from('metering_points')
      .update({
        metering_point_id: meteringPointId,
        meter_point_id: meteringPointId,
        ediel_metering_point_id: meteringPointId,
        anlage_id: cleanReviewText(metering.anlage_id) ?? cleanReviewText(site.facility_id) ?? meteringPointId,
        site_facility_id: cleanReviewText(site.facility_id) ?? meteringPointId,
        grid_area_code: cleanReviewText(metering.grid_area_code) ?? cleanReviewText(payload.grid_area_code),
        price_area_code: cleanReviewText(metering.price_area_code) ?? cleanReviewText(payload.price_area_code) ?? cleanReviewText(site.price_area_code),
        facility_data_verified_at: asBooleanLike(payload.facility_data_verified) ? new Date().toISOString() : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', application.company_id)
      .eq('id', application.metering_point_id)

    if (error && !missingSchema(error)) throw error
    return application.metering_point_id
  }

  const insertPayload = {
    company_id: application.company_id,
    customer_id: application.customer_id,
    site_id: siteId,
    customer_site_id: siteId,
    metering_point_id: meteringPointId,
    meter_point_id: meteringPointId,
    ediel_metering_point_id: meteringPointId,
    anlage_id: cleanReviewText(metering.anlage_id) ?? cleanReviewText(site.facility_id) ?? meteringPointId,
    site_facility_id: cleanReviewText(site.facility_id) ?? meteringPointId,
    measurement_type: cleanReviewText(metering.measurement_type) ?? 'consumption',
    reading_frequency: cleanReviewText(metering.reading_frequency) ?? 'monthly',
    price_area_code: cleanReviewText(metering.price_area_code) ?? cleanReviewText(payload.price_area_code) ?? cleanReviewText(site.price_area_code),
    grid_area_code: cleanReviewText(metering.grid_area_code) ?? cleanReviewText(payload.grid_area_code),
    facility_data_verified_at: asBooleanLike(payload.facility_data_verified) ? new Date().toISOString() : null,
    start_date: cleanReviewText(metering.start_date) ?? cleanReviewText(payload.requested_start_date),
    status: 'active',
    verification_status: 'pending',
    onboarding_status: 'application_received',
    data_quality_status: 'manual_review',
    is_settlement_relevant: true,
    metadata: { source: 'website_application_review' },
  }

  const { data, error } = await supabaseService
    .from('metering_points')
    .insert(insertPayload)
    .select('id')
    .single()

  if (error && !missingSchema(error)) throw error
  if (data?.id) return String(data.id)

  const fallback = await supabaseService
    .from('metering_points')
    .insert({
      company_id: application.company_id,
      customer_id: application.customer_id,
      site_id: siteId,
      customer_site_id: siteId,
      metering_point_id: meteringPointId,
      meter_point_id: meteringPointId,
      status: 'active',
    })
    .select('id')
    .single()
  if (fallback.error) throw fallback.error
  return String(fallback.data.id)
}

async function upsertApplicationContract(application: ApplicationRecord, siteId: string | null, meteringPointId: string | null, payload: Record<string, unknown>, readiness: ReturnType<typeof assessWebsiteApplicationReadiness>) {
  if (!application.customer_id || !readiness.canCreateContract) return application.contract_id
  if (application.contract_id) return application.contract_id

  const contract = isRecord(payload.contract) ? payload.contract : {}
  const contractName = cleanReviewText(contract.contract_name) ?? 'Elavtal'
  const requestedStartDate = readiness.requestedStartDate ?? cleanReviewText(payload.requested_start_date) ?? cleanReviewText(contract.requested_start_date)
  const existingContract = await findExistingApplicationContract({
    companyId: application.company_id,
    customerId: application.customer_id,
    siteId,
    meteringPointId,
    requestedStartDate,
    contractName,
  })
  if (existingContract?.id) return String(existingContract.id)

  const now = new Date().toISOString()
  const insertPayload = {
    company_id: application.company_id,
    customer_id: application.customer_id,
    site_id: siteId,
    customer_site_id: siteId,
    metering_point_id: meteringPointId,
    source_type: WEBSITE_APPLICATION_CONTRACT_SOURCE_TYPE,
    status: readiness.canStartSwitch ? WEBSITE_APPLICATION_READY_CONTRACT_STATUS : WEBSITE_APPLICATION_DRAFT_CONTRACT_STATUS,
    contract_name: contractName,
    contract_type: cleanReviewText(contract.contract_type) ?? 'variable_monthly',
    starts_at: requestedStartDate,
    expected_start_at: requestedStartDate,
    requested_start_date: requestedStartDate,
    requested_start_mode: readiness.requestedStartMode,
    calculated_earliest_start_date: readiness.calculatedEarliestStartDate,
    price_area_used: readiness.priceArea,
    grid_area_code_used: readiness.gridAreaCode,
    resolution_status: readiness.resolutionStatus,
    confirmed_start_date: readiness.confirmedStartDate,
    actual_start_date: readiness.actualStartDate,
    agreement_channel: WEBSITE_APPLICATION_CONTRACT_CHANNEL,
    metadata: {
      source: 'website_application_review',
      source_type: WEBSITE_APPLICATION_CONTRACT_SOURCE_TYPE,
      agreement_channel: WEBSITE_APPLICATION_CONTRACT_CHANNEL,
      application_id: application.id,
      missing_fields: readiness.missingFields,
      blocking_reasons: readiness.blockingReasons,
    },
    updated_at: now,
  }

  const { data, error } = await supabaseService
    .from('customer_contracts')
    .insert(insertPayload)
    .select('id')
    .single()

  if (error && !missingSchema(error)) throw error
  if (data?.id) return String(data.id)

  const fallback = await supabaseService
    .from('customer_contracts')
    .insert({
      company_id: application.company_id,
      customer_id: application.customer_id,
      site_id: siteId,
      customer_site_id: siteId,
      metering_point_id: meteringPointId,
      source_type: WEBSITE_APPLICATION_CONTRACT_SOURCE_TYPE,
      status: readiness.canStartSwitch ? WEBSITE_APPLICATION_READY_CONTRACT_STATUS : WEBSITE_APPLICATION_DRAFT_CONTRACT_STATUS,
      contract_name: contractName,
      contract_type: cleanReviewText(contract.contract_type) ?? 'variable_monthly',
      starts_at: requestedStartDate,
      updated_at: now,
    })
    .select('id')
    .single()
  if (fallback.error) throw fallback.error
  return String(fallback.data.id)
}

async function saveApplicationReview(input: { applicationId: string; formData: FormData; action: 'review.updated' | 'review.checked' }) {
  if (!input.applicationId) throw new Error('Kundansökan saknas.')
  const application = await loadApplication(input.applicationId)
  const admin = await authorizeForCompany(application.company_id)
  const payload = mergePayload(application.payload, input.formData)
  const readiness = assessWebsiteApplicationReadiness(payload)
  const siteId = await upsertApplicationSite(application, payload)
  const meteringPointId = await upsertApplicationMeteringPoint(application, siteId, payload)
  const contractId = await upsertApplicationContract(application, siteId, meteringPointId, payload, readiness)
  const note = text(input.formData, 'admin_note')
  const previousValues = {
    status: application.status,
    customer_site_id: application.customer_site_id,
    metering_point_id: application.metering_point_id,
    contract_id: application.contract_id,
  }
  const newValues = {
    status: readiness.status,
    missing_fields: readiness.missingFields,
    blocking_reasons: readiness.blockingReasons,
    next_step: readiness.nextStep,
    customer_site_id: siteId,
    metering_point_id: meteringPointId,
    contract_id: contractId,
    note,
  }
  const timeline = [
    ...asArray(application.timeline),
    timelineEvent(input.action, input.action === 'review.checked' ? 'Redo-kontroll kördes' : 'Ansökan kompletterades', {
      missing_fields: readiness.missingFields,
      next_step: readiness.nextStep,
      note,
    }),
  ]
  const auditLog = [
    ...asArray(application.audit_log),
    auditEvent(input.action, admin.userId, previousValues, newValues),
  ]

  const responsePayload = isRecord(application.response_payload) ? { ...application.response_payload } : {}
  responsePayload.status = readiness.status
  responsePayload.missing_fields = readiness.missingFields
  responsePayload.blocking_reasons = readiness.blockingReasons
  responsePayload.next_step = readiness.nextStep
  responsePayload.customer_site_id = siteId
  responsePayload.metering_point_id = meteringPointId
  responsePayload.contract_id = contractId
  responsePayload.requested_start_mode = readiness.requestedStartMode
  responsePayload.calculated_earliest_start_date = readiness.calculatedEarliestStartDate
  responsePayload.grid_area_code = readiness.gridAreaCode
  responsePayload.price_area_code = readiness.priceArea
  responsePayload.resolution_status = readiness.resolutionStatus
  responsePayload.facility_verified = readiness.facilityVerified
  responsePayload.can_request_grid_owner_information = readiness.canRequestGridOwnerInformation
  responsePayload.can_start_switch = readiness.canStartSwitch
  responsePayload.can_send_agreement_confirmation = readiness.canSendAgreementConfirmation
  responsePayload.can_activate_customer = readiness.canActivateCustomer

  const { error } = await supabaseService
    .from('website_customer_applications')
    .update({
      status: readiness.status,
      payload,
      response_payload: responsePayload,
      customer_site_id: siteId,
      metering_point_id: meteringPointId,
      contract_id: contractId,
      missing_fields: readiness.missingFields,
      blocking_reasons: readiness.blockingReasons,
      next_step: readiness.nextStep,
      requested_start_date: readiness.requestedStartDate,
      confirmed_start_date: readiness.confirmedStartDate,
      actual_start_date: readiness.actualStartDate,
      requested_start_mode: readiness.requestedStartMode,
      calculated_earliest_start_date: readiness.calculatedEarliestStartDate,
      grid_area_code: readiness.gridAreaCode,
      price_area_code: readiness.priceArea,
      resolution_status: readiness.resolutionStatus,
      facility_data_verified_at: readiness.facilityVerified ? (application.facility_data_verified_at ?? new Date().toISOString()) : null,
      warnings: readiness.warnings,
      timeline,
      audit_log: auditLog,
      assigned_to: admin.userId,
      admin_note: note,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', application.company_id)
    .eq('id', application.id)

  if (error && !missingSchema(error)) throw error

  if (error && missingSchema(error)) {
    const fallback = await supabaseService
      .from('website_customer_applications')
      .update({
        status: readiness.status,
        payload,
        response_payload: responsePayload,
        customer_site_id: siteId,
        metering_point_id: meteringPointId,
        contract_id: contractId,
        warnings: readiness.warnings,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', application.company_id)
      .eq('id', application.id)
    if (fallback.error) throw fallback.error
  }

  await updateCustomerReviewState(application, readiness)

  await supabaseService.from('audit_logs').insert({
    company_id: application.company_id,
    actor_user_id: admin.userId,
    action: input.action,
    entity_type: 'website_customer_application',
    entity_id: application.id,
    old_values: previousValues,
    new_values: newValues,
  }).then(() => null)

  revalidatePath('/admin/website-applications')
  revalidatePath('/admin/customer-applications')
  if (application.customer_id) revalidatePath(`/admin/customers/${application.customer_id}`)
}


export async function resolveWebsiteApplicationEnergyAction(formData: FormData) {
  const applicationId = text(formData, 'application_id') ?? ''
  if (!applicationId) throw new Error('Kundansökan saknas.')
  const application = await loadApplication(applicationId)
  const admin = await authorizeForCompany(application.company_id)
  const payload = mergePayload(application.payload, formData)
  const site = isRecord(payload.site) ? payload.site : {}
  const metering = isRecord(payload.metering_point) ? payload.metering_point : {}
  const resolution = await resolveEnergyContext({
    companyId: application.company_id,
    customerId: application.customer_id,
    customerSiteId: application.customer_site_id,
    customerApplicationId: application.id,
    street: cleanReviewText(site.street) ?? cleanReviewText(payload.street),
    postalCode: cleanReviewText(site.postal_code) ?? cleanReviewText(payload.postal_code),
    city: cleanReviewText(site.city) ?? cleanReviewText(payload.city),
    country: cleanReviewText(site.country) ?? 'SE',
    gridAreaCode: cleanReviewText(payload.grid_area_code) ?? cleanReviewText(site.grid_area_code),
    facilityId: cleanReviewText(site.facility_id),
    meteringPointId: cleanReviewText(metering.metering_point_id) ?? cleanReviewText(metering.meter_point_id) ?? cleanReviewText(metering.ediel_metering_point_id),
    requestedStartMode: cleanReviewText(payload.requested_start_mode),
    requestedStartDate: cleanReviewText(payload.requested_start_date),
  })

  payload.grid_area_code = resolution.gridAreaCode
  payload.price_area_code = resolution.priceArea
  payload.grid_owner_id = resolution.gridOwnerId
  payload.resolution_status = resolution.resolutionStatus
  payload.metadata = {
    ...(isRecord(payload.metadata) ? payload.metadata : {}),
    energy_resolution: resolution,
  }
  site.grid_area_code = resolution.gridAreaCode
  site.price_area_code = resolution.priceArea
  site.grid_owner_id = resolution.gridOwnerId
  payload.site = site

  const readiness = assessWebsiteApplicationReadiness(payload)
  const responsePayload = isRecord(application.response_payload) ? { ...application.response_payload } : {}
  responsePayload.energy_resolution = resolution
  responsePayload.grid_area_code = readiness.gridAreaCode
  responsePayload.price_area_code = readiness.priceArea
  responsePayload.resolution_status = readiness.resolutionStatus
  responsePayload.resolution_id = resolution.resolutionId ?? null
  responsePayload.next_step = readiness.nextStep

  const timeline = [
    ...asArray(application.timeline),
    timelineEvent('energy_resolution', 'Adress- och nätområdesmatchning kördes', {
      grid_area_code: resolution.gridAreaCode,
      price_area: resolution.priceArea,
      status: resolution.resolutionStatus,
      confidence: resolution.confidence,
    }),
  ]
  const auditLog = [
    ...asArray(application.audit_log),
    auditEvent('energy_resolution', admin.userId, { status: application.status }, { status: readiness.status, resolution }),
  ]

  const { error } = await supabaseService
    .from('website_customer_applications')
    .update({
      status: readiness.status,
      payload,
      response_payload: responsePayload,
      resolution_id: resolution.resolutionId ?? application.resolution_id ?? null,
      grid_area_code: readiness.gridAreaCode,
      grid_owner_id: resolution.gridOwnerId,
      price_area_code: readiness.priceArea,
      resolution_status: resolution.resolutionStatus,
      resolution_confidence: resolution.confidence,
      missing_fields: readiness.missingFields,
      blocking_reasons: readiness.blockingReasons,
      warnings: readiness.warnings,
      next_step: readiness.nextStep,
      timeline,
      audit_log: auditLog,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', application.company_id)
    .eq('id', application.id)
  if (error && !missingSchema(error)) throw error

  await updateCustomerReviewState(application, readiness)
  revalidatePath('/admin/website-applications')
  if (application.customer_id) revalidatePath(`/admin/customers/${application.customer_id}`)
  redirect('/admin/website-applications')
}

export async function requestWebsiteApplicationGridOwnerInfoAction(formData: FormData) {
  const applicationId = text(formData, 'application_id') ?? ''
  if (!applicationId) throw new Error('Kundansökan saknas.')
  const application = await loadApplication(applicationId)
  const admin = await authorizeForCompany(application.company_id)
  const payload = mergePayload(application.payload, formData)
  const readiness = assessWebsiteApplicationReadiness(payload)
  const request = await ensureGridOwnerInformationRequest({
    companyId: application.company_id,
    customerId: application.customer_id,
    customerSiteId: application.customer_site_id,
    customerApplicationId: application.id,
    resolutionId: application.resolution_id,
    gridOwnerId: cleanReviewText(payload.grid_owner_id) ?? application.grid_owner_id,
    gridAreaCode: readiness.gridAreaCode,
    priceArea: readiness.priceArea,
    createdBy: admin.userId,
  })
  const responsePayload = isRecord(application.response_payload) ? { ...application.response_payload } : {}
  responsePayload.grid_owner_information_request_id = request.requestId
  responsePayload.grid_owner_information_request_status = request.status
  responsePayload.grid_owner_information_request_channel = request.channel

  await supabaseService
    .from('website_customer_applications')
    .update({
      grid_owner_information_request_id: request.requestId,
      status: request.status === 'ready_to_send' ? 'information_request_ready' : 'needs_facility_data',
      response_payload: responsePayload,
      next_step: request.nextStep,
      warnings: [...readiness.warnings, ...request.warnings],
      timeline: [...asArray(application.timeline), timelineEvent('grid_owner_information_request_created', 'Begäran om anläggningsuppgifter skapades', { request_id: request.requestId, status: request.status })],
      audit_log: [...asArray(application.audit_log), auditEvent('grid_owner_information_request_created', admin.userId, {}, { request })],
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', application.company_id)
    .eq('id', application.id)
    .throwOnError()

  revalidatePath('/admin/website-applications')
  if (application.customer_id) revalidatePath(`/admin/customers/${application.customer_id}`)
  redirect('/admin/website-applications?status=needs_facility_data')
}

export async function markWebsiteApplicationFacilityDataReceivedAction(formData: FormData) {
  const applicationId = text(formData, 'application_id') ?? ''
  if (!applicationId) throw new Error('Kundansökan saknas.')
  const application = await loadApplication(applicationId)
  const admin = await authorizeForCompany(application.company_id)
  const payload = mergePayload(application.payload, formData)
  const site = isRecord(payload.site) ? payload.site : {}
  const metering = isRecord(payload.metering_point) ? payload.metering_point : {}
  const facilityId = cleanReviewText(site.facility_id)
  const meteringPointId = cleanReviewText(metering.metering_point_id) ?? cleanReviewText(metering.meter_point_id) ?? cleanReviewText(metering.ediel_metering_point_id)
  if (!facilityId && !meteringPointId) throw new Error('Ange anläggnings-ID eller mätpunkt innan uppgifterna markeras mottagna.')

  await markFacilityDataReceived({
    companyId: application.company_id,
    customerId: application.customer_id,
    customerSiteId: application.customer_site_id,
    customerApplicationId: application.id,
    requestId: application.grid_owner_information_request_id,
    facilityId,
    meteringPointId,
    receivedPayload: { source: 'admin_review', facilityId, meteringPointId },
    actorUserId: admin.userId,
  })

  payload.facility_data_verified = true
  payload.resolution_status = 'facility_verified'
  const readiness = assessWebsiteApplicationReadiness(payload)
  await supabaseService
    .from('website_customer_applications')
    .update({
      status: readiness.status,
      payload,
      facility_data_verified_at: new Date().toISOString(),
      resolution_status: 'facility_verified',
      missing_fields: readiness.missingFields,
      blocking_reasons: readiness.blockingReasons,
      warnings: readiness.warnings,
      next_step: readiness.nextStep,
      timeline: [...asArray(application.timeline), timelineEvent('facility_data_received', 'Anläggningsuppgifter mottagna och markerade', { facility_id: facilityId, metering_point_id: meteringPointId })],
      audit_log: [...asArray(application.audit_log), auditEvent('facility_data_received', admin.userId, {}, { facilityId, meteringPointId })],
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', application.company_id)
    .eq('id', application.id)
    .throwOnError()

  await updateCustomerReviewState(application, readiness)
  revalidatePath('/admin/website-applications')
  if (application.customer_id) revalidatePath(`/admin/customers/${application.customer_id}`)
  redirect('/admin/website-applications')
}

export async function updateWebsiteApplicationReviewAction(formData: FormData) {
  const applicationId = text(formData, 'application_id') ?? ''
  await saveApplicationReview({ applicationId, formData, action: 'review.updated' })
  redirect('/admin/website-applications?status=needs_information')
}

export async function checkWebsiteApplicationReadinessAction(formData: FormData) {
  const applicationId = text(formData, 'application_id') ?? ''
  await saveApplicationReview({ applicationId, formData, action: 'review.checked' })
  redirect('/admin/website-applications')
}
