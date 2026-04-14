'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import {
  addCustomerContractEvent,
  createCustomerContract,
  getContractOfferById,
} from '@/lib/customer-contracts/db'
import type { ContractType, GreenFeeMode } from '@/lib/customer-contracts/types'
import {
  createSupplierSwitchRequest,
  findCustomerSiteById,
  listMeteringPointsForSite,
  listPowersOfAttorneyByCustomerId,
  syncCustomerOperationsForSite,
} from '@/lib/operations/db'
import type { SupplierSwitchRequestType } from '@/lib/operations/types'

function getString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function getNullableString(formData: FormData, key: string): string | null {
  const value = getString(formData, key)
  return value || null
}

function parseNumber(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function parseIntOrNull(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function parseContractType(value: string): ContractType {
  switch (value) {
    case 'fixed':
    case 'variable_monthly':
    case 'variable_hourly':
    case 'portfolio':
      return value
    default:
      return 'variable_hourly'
  }
}

function parseGreenFeeMode(value: string): GreenFeeMode {
  switch (value) {
    case 'sek_month':
    case 'ore_per_kwh':
      return value
    default:
      return 'none'
  }
}

function parseOptionalFeeLines(value: string): Array<Record<string, unknown>> {
  const trimmed = value.trim()
  if (!trimmed) return []

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, amountRaw, unitRaw] = line.split('|').map((part) => part.trim())
      const amount = amountRaw ? Number(amountRaw.replace(',', '.')) : null

      return {
        label: label || '',
        amount: Number.isFinite(amount ?? NaN) ? amount : null,
        unit: unitRaw || 'sek',
      }
    })
}

function parseBulkRows(raw: string): Array<Record<string, string>> {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) return []

  const delimiter = lines[0].includes('\t') ? '\t' : ';'
  const headers = lines[0].split(delimiter).map((part) => part.trim())

  return lines.slice(1).map((line) => {
    const cols = line.split(delimiter)
    const row: Record<string, string> = {}

    headers.forEach((header, index) => {
      row[header] = String(cols[index] ?? '').trim()
    })

    return row
  })
}

function normalizeCustomerType(
  value: string | null | undefined
): 'private' | 'business' | 'association' {
  if (value === 'business') return 'business'
  if (value === 'association') return 'association'
  return 'private'
}

function normalizeIntakeFlowType(
  value: string | null | undefined
): SupplierSwitchRequestType | null {
  if (value === 'move_in') return 'move_in'
  if (value === 'move_out_takeover') return 'move_out_takeover'
  if (value === 'switch') return 'switch'
  return null
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function requireValue(value: string | null | undefined, message: string) {
  if (!normalizeOptionalString(value)) {
    throw new Error(message)
  }
}

async function getActorUserId(): Promise<string> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Unauthorized')
  return user.id
}

async function insertAuditLog(params: {
  actorUserId: string
  entityType: string
  entityId: string
  action: string
  newValues?: Record<string, unknown>
  metadata?: Record<string, unknown>
}) {
  const { error } = await supabaseService.from('audit_logs').insert({
    actor_user_id: params.actorUserId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    new_values: params.newValues ?? null,
    metadata: params.metadata ?? null,
  })

  if (error) throw error
}

async function createPrimaryContact(params: {
  customerId: string
  customerType: 'private' | 'business' | 'association'
  firstName?: string | null
  lastName?: string | null
  companyName?: string | null
  email?: string | null
  phone?: string | null
  title?: string | null
}) {
  const personName = `${params.firstName ?? ''} ${params.lastName ?? ''}`.trim() || null

  const name =
    params.customerType === 'private'
      ? personName
      : personName || (params.companyName ?? '').trim() || null

  if (!name && !params.email && !params.phone) {
    return null
  }

  const { data, error } = await supabaseService
    .from('customer_contacts')
    .insert({
      customer_id: params.customerId,
      type: 'primary',
      name,
      email: params.email ?? null,
      phone: params.phone ?? null,
      title: params.title ?? null,
      is_primary: true,
    })
    .select('*')
    .single()

  if (error) throw error
  return data
}

async function createFacilityAddress(params: {
  customerId: string
  street?: string | null
  postalCode?: string | null
  city?: string | null
  careOf?: string | null
  moveInDate?: string | null
}) {
  if (!params.street && !params.postalCode && !params.city) {
    return null
  }

  const { data, error } = await supabaseService
    .from('customer_addresses')
    .insert({
      customer_id: params.customerId,
      type: 'facility',
      street_1: params.street ?? '',
      street_2: params.careOf ?? null,
      postal_code: params.postalCode ?? null,
      city: params.city ?? null,
      country: 'SE',
      municipality: null,
      moved_in_at: params.moveInDate ?? null,
      moved_out_at: null,
      is_active: true,
    })
    .select('*')
    .single()

  if (error) throw error
  return data
}

async function syncContractLifecycleEvents(params: {
  customerId: string
  contractId: string
  contractStatus: string | null | undefined
  contractStartDate?: string | null
  actorUserId: string
}) {
  const happenedAt = params.contractStartDate ?? null

  if (params.contractStatus === 'pending_signature') {
    await addCustomerContractEvent({
      customerContractId: params.contractId,
      customerId: params.customerId,
      eventType: 'signature_requested',
      happenedAt,
      note: 'Avtal satt till väntar signering i intake-flödet',
      actorUserId: params.actorUserId,
    })
    return
  }

  if (params.contractStatus === 'signed') {
    await addCustomerContractEvent({
      customerContractId: params.contractId,
      customerId: params.customerId,
      eventType: 'signed',
      happenedAt,
      note: 'Avtal markerat som signerat i intake-flödet',
      actorUserId: params.actorUserId,
    })
    return
  }

  if (params.contractStatus === 'active') {
    await addCustomerContractEvent({
      customerContractId: params.contractId,
      customerId: params.customerId,
      eventType: 'signed',
      happenedAt,
      note: 'Avtal markerat som signerat i intake-flödet',
      actorUserId: params.actorUserId,
    })

    await addCustomerContractEvent({
      customerContractId: params.contractId,
      customerId: params.customerId,
      eventType: 'activated',
      happenedAt,
      note: 'Avtal markerat som aktivt i intake-flödet',
      actorUserId: params.actorUserId,
    })
    return
  }

  if (params.contractStatus === 'terminated') {
    await addCustomerContractEvent({
      customerContractId: params.contractId,
      customerId: params.customerId,
      eventType: 'terminated',
      happenedAt,
      note: 'Avtal markerat som avslutat i intake-flödet',
      actorUserId: params.actorUserId,
    })
    return
  }

  if (params.contractStatus === 'cancelled') {
    await addCustomerContractEvent({
      customerContractId: params.contractId,
      customerId: params.customerId,
      eventType: 'cancelled',
      happenedAt,
      note: 'Avtal markerat som avbrutet i intake-flödet',
      actorUserId: params.actorUserId,
    })
  }
}

async function maybeCreateSwitchRequestFromIntake(params: {
  customerId: string
  siteId: string | null
  intakeFlowType: SupplierSwitchRequestType | null
}) {
  if (!params.customerId || !params.siteId || !params.intakeFlowType) {
    return null
  }

  const supabase = await createSupabaseServerClient()

  const readiness = await syncCustomerOperationsForSite(supabase, {
    customerId: params.customerId,
    siteId: params.siteId,
  })

  const site = await findCustomerSiteById(supabase, params.siteId)
  if (!site) {
    return null
  }

  const [meteringPoints, powersOfAttorney] = await Promise.all([
    listMeteringPointsForSite(supabase, params.siteId),
    listPowersOfAttorneyByCustomerId(supabase, params.customerId),
  ])

  const candidateMeteringPoint =
    meteringPoints.find((point) => point.id === readiness.candidateMeteringPointId) ??
    meteringPoints[0] ??
    null

  const hasRelevantPoa = powersOfAttorney.some(
    (poa) =>
      poa.scope === 'supplier_switch' &&
      (poa.site_id === params.siteId || poa.site_id === null)
  )

  if (!candidateMeteringPoint) {
    return {
      created: false,
      reason: 'Mätpunkt saknas',
      readiness,
    }
  }

  if (!hasRelevantPoa) {
    return {
      created: false,
      reason: 'Fullmakt saknas',
      readiness,
    }
  }

  const request = await createSupplierSwitchRequest(supabase, {
    readiness,
    site,
    meteringPoint: candidateMeteringPoint,
    requestType: params.intakeFlowType,
    requestedStartDate: site.move_in_date ?? null,
  })

  return {
    created: true,
    requestId: request.id,
    requestType: request.request_type,
    readiness,
  }
}

async function createCustomerGraph(params: {
  actorUserId: string
  customerType: 'private' | 'business' | 'association'
  intakeFlowType?: SupplierSwitchRequestType | null
  firstName?: string | null
  lastName?: string | null
  companyName?: string | null
  contactTitle?: string | null
  email?: string | null
  phone?: string | null
  personalNumber?: string | null
  orgNumber?: string | null
  apartmentNumber?: string | null
  siteName?: string | null
  facilityId?: string | null
  meterPointId?: string | null
  siteType?: 'consumption' | 'production' | 'mixed'
  gridOwnerId?: string | null
  priceAreaCode?: 'SE1' | 'SE2' | 'SE3' | 'SE4' | null
  moveInDate?: string | null
  annualConsumptionKwh?: number | null
  currentSupplierName?: string | null
  currentSupplierOrgNumber?: string | null
  street?: string | null
  postalCode?: string | null
  city?: string | null
  careOf?: string | null
  movedFromStreet?: string | null
  movedFromPostalCode?: string | null
  movedFromCity?: string | null
  movedFromSupplierName?: string | null
  contractOfferId?: string | null
  contractStartDate?: string | null
  contractStatus?: string | null
  overrideReason?: string | null
  contractTypeOverride?: ContractType | null
  fixedPriceOrePerKwh?: number | null
  spotMarkupOrePerKwh?: number | null
  variableFeeOrePerKwh?: number | null
  monthlyFeeSek?: number | null
  greenFeeMode?: GreenFeeMode | null
  greenFeeValue?: number | null
  bindingMonths?: number | null
  noticeMonths?: number | null
  optionalFeeLines?: Array<Record<string, unknown>>
}) {
  const normalizedFirstName = normalizeOptionalString(params.firstName)
  const normalizedLastName = normalizeOptionalString(params.lastName)
  const normalizedCompanyName = normalizeOptionalString(params.companyName)
  const normalizedContactTitle = normalizeOptionalString(params.contactTitle)
  const normalizedEmail = normalizeOptionalString(params.email)
  const normalizedPhone = normalizeOptionalString(params.phone)
  const normalizedApartmentNumber = normalizeOptionalString(params.apartmentNumber)
  const normalizedSiteName = normalizeOptionalString(params.siteName)
  const normalizedFacilityId = normalizeOptionalString(params.facilityId)
  const normalizedMeterPointId = normalizeOptionalString(params.meterPointId)
  const normalizedGridOwnerId = normalizeOptionalString(params.gridOwnerId)
  const normalizedMoveInDate = normalizeOptionalString(params.moveInDate)
  const normalizedCurrentSupplierName = normalizeOptionalString(params.currentSupplierName)
  const normalizedCurrentSupplierOrgNumber = normalizeOptionalString(
    params.currentSupplierOrgNumber
  )
  const normalizedStreet = normalizeOptionalString(params.street)
  const normalizedPostalCode = normalizeOptionalString(params.postalCode)
  const normalizedCity = normalizeOptionalString(params.city)
  const normalizedCareOf = normalizeOptionalString(params.careOf)

  let normalizedPersonalNumber = normalizeOptionalString(params.personalNumber)
  let normalizedOrgNumber = normalizeOptionalString(params.orgNumber)
  let normalizedMovedFromStreet = normalizeOptionalString(params.movedFromStreet)
  let normalizedMovedFromPostalCode = normalizeOptionalString(params.movedFromPostalCode)
  let normalizedMovedFromCity = normalizeOptionalString(params.movedFromCity)
  let normalizedMovedFromSupplierName = normalizeOptionalString(params.movedFromSupplierName)

  if (params.customerType === 'private') {
    requireValue(normalizedFirstName, 'Privatkund kräver förnamn')
    requireValue(normalizedLastName, 'Privatkund kräver efternamn')
    normalizedOrgNumber = null
  } else {
    requireValue(normalizedCompanyName, 'Företag eller förening kräver namn')
    requireValue(normalizedOrgNumber, 'Företag eller förening kräver organisationsnummer')
    requireValue(normalizedFirstName, 'Företag eller förening kräver kontaktperson förnamn')
    requireValue(normalizedLastName, 'Företag eller förening kräver kontaktperson efternamn')
    normalizedPersonalNumber = null
  }

  if (
    params.intakeFlowType === 'move_in' ||
    params.intakeFlowType === 'move_out_takeover'
  ) {
    requireValue(normalizedMoveInDate, 'Inflytt eller övertag kräver datum')
    requireValue(normalizedStreet, 'Inflytt eller övertag kräver gatuadress')
    requireValue(normalizedPostalCode, 'Inflytt eller övertag kräver postnummer')
    requireValue(normalizedCity, 'Inflytt eller övertag kräver stad')
  } else {
    normalizedMovedFromStreet = null
    normalizedMovedFromPostalCode = null
    normalizedMovedFromCity = null
    normalizedMovedFromSupplierName = null
  }

  const displayName =
    params.customerType === 'business' || params.customerType === 'association'
      ? normalizedCompanyName ?? ''
      : `${normalizedFirstName ?? ''} ${normalizedLastName ?? ''}`.trim()

  const { data: customer, error: customerError } = await supabaseService
    .from('customers')
    .insert({
      customer_type: params.customerType || 'private',
      status: 'draft',
      first_name: normalizedFirstName,
      last_name: normalizedLastName,
      full_name: displayName || null,
      company_name: normalizedCompanyName,
      email: params.email ?? null,
      phone: params.phone ?? null,
      personal_number: normalizedPersonalNumber,
      org_number: normalizedOrgNumber,
      apartment_number: normalizedApartmentNumber,
    })
    .select('*')
    .single()

  if (customerError) throw customerError

  await createPrimaryContact({
    customerId: customer.id,
    customerType: params.customerType,
    firstName: normalizedFirstName,
    lastName: normalizedLastName,
    companyName: normalizedCompanyName,
    title: normalizedContactTitle,
    email: normalizedEmail,
    phone: normalizedPhone,
  })

  await createFacilityAddress({
    customerId: customer.id,
    street: normalizedStreet,
    postalCode: normalizedPostalCode,
    city: normalizedCity,
    careOf: normalizedCareOf,
    moveInDate: normalizedMoveInDate,
  })

  let siteId: string | null = null

  const shouldCreateSite = Boolean(
    normalizedSiteName ||
      normalizedFacilityId ||
      normalizedStreet ||
      normalizedGridOwnerId ||
      params.priceAreaCode ||
      normalizedMoveInDate
  )

  if (shouldCreateSite) {
    const { data: site, error: siteError } = await supabaseService
      .from('customer_sites')
      .insert({
        customer_id: customer.id,
        site_name: normalizedSiteName || displayName || 'Ny anläggning',
        facility_id: normalizedFacilityId,
        site_type: params.siteType ?? 'consumption',
        status: 'draft',
        grid_owner_id: normalizedGridOwnerId,
        price_area_code: params.priceAreaCode ?? null,
        move_in_date: normalizedMoveInDate ?? null,
        annual_consumption_kwh: params.annualConsumptionKwh ?? null,
        current_supplier_name: normalizedCurrentSupplierName,
        current_supplier_org_number: normalizedCurrentSupplierOrgNumber,
        street: normalizedStreet,
        postal_code: normalizedPostalCode,
        city: normalizedCity,
        care_of: normalizedCareOf,
        moved_from_street: normalizedMovedFromStreet,
        moved_from_postal_code: normalizedMovedFromPostalCode,
        moved_from_city: normalizedMovedFromCity,
        moved_from_supplier_name: normalizedMovedFromSupplierName,
        created_by: params.actorUserId,
        updated_by: params.actorUserId,
      })
      .select('*')
      .single()

    if (siteError) throw siteError
    siteId = site.id
  }

  if (siteId && normalizedMeterPointId) {
    const { error: meteringPointError } = await supabaseService
      .from('metering_points')
      .insert({
        site_id: siteId,
        meter_point_id: normalizedMeterPointId,
        site_facility_id: normalizedFacilityId,
        status: 'draft',
        measurement_type: 'consumption',
        reading_frequency: 'hourly',
        grid_owner_id: normalizedGridOwnerId,
        price_area_code: params.priceAreaCode ?? null,
        is_settlement_relevant: true,
        created_by: params.actorUserId,
        updated_by: params.actorUserId,
      })

    if (meteringPointError) throw meteringPointError
  }

  if (params.contractOfferId || params.contractTypeOverride) {
    const offer = params.contractOfferId
      ? await getContractOfferById(params.contractOfferId)
      : null

    const contract = await createCustomerContract({
      customerId: customer.id,
      siteId,
      contractOfferId: offer?.id ?? null,
      sourceType:
        params.contractOfferId && !params.overrideReason ? 'catalog' : 'manual_override',
      status:
        (params.contractStatus as
          | 'draft'
          | 'pending_signature'
          | 'signed'
          | 'active'
          | 'terminated'
          | 'cancelled'
          | 'expired') || 'pending_signature',
      contractName: offer?.name ?? 'Kundspecifikt avtal',
      contractType: params.contractTypeOverride ?? offer?.contract_type ?? 'variable_hourly',
      campaignName: offer?.campaign_name ?? null,
      fixedPriceOrePerKwh:
        params.fixedPriceOrePerKwh ?? offer?.fixed_price_ore_per_kwh ?? null,
      spotMarkupOrePerKwh:
        params.spotMarkupOrePerKwh ?? offer?.spot_markup_ore_per_kwh ?? null,
      variableFeeOrePerKwh:
        params.variableFeeOrePerKwh ?? offer?.variable_fee_ore_per_kwh ?? null,
      monthlyFeeSek: params.monthlyFeeSek ?? offer?.monthly_fee_sek ?? null,
      greenFeeMode: params.greenFeeMode ?? offer?.green_fee_mode ?? 'none',
      greenFeeValue: params.greenFeeValue ?? offer?.green_fee_value ?? null,
      bindingMonths: params.bindingMonths ?? offer?.default_binding_months ?? null,
      noticeMonths: params.noticeMonths ?? offer?.default_notice_months ?? null,
      optionalFeeLines:
        params.optionalFeeLines && params.optionalFeeLines.length > 0
          ? params.optionalFeeLines
          : ((offer?.optional_fee_lines as Array<Record<string, unknown>> | null) ?? []),
      startsAt: params.contractStartDate ?? null,
      signedAt:
        params.contractStatus === 'signed' || params.contractStatus === 'active'
          ? params.contractStartDate || new Date().toISOString()
          : null,
      overrideReason: params.overrideReason ?? null,
      actorUserId: params.actorUserId,
    })

    await addCustomerContractEvent({
      customerContractId: contract.id,
      customerId: customer.id,
      eventType: 'created',
      note: params.contractOfferId
        ? `Skapad från avtalskatalog${params.overrideReason ? ` med override: ${params.overrideReason}` : ''}`
        : 'Skapad som manuellt kundspecifikt avtal',
      metadata: {
        contractOfferId: params.contractOfferId ?? null,
        customerNumber: customer.customer_number ?? null,
      },
      actorUserId: params.actorUserId,
    })

    await syncContractLifecycleEvents({
      customerId: customer.id,
      contractId: contract.id,
      contractStatus: params.contractStatus,
      contractStartDate: params.contractStartDate,
      actorUserId: params.actorUserId,
    })
  }

  const switchRequestResult = await maybeCreateSwitchRequestFromIntake({
    customerId: customer.id,
    siteId,
    intakeFlowType: params.intakeFlowType ?? null,
  })

  await insertAuditLog({
    actorUserId: params.actorUserId,
    entityType: 'customer',
    entityId: customer.id,
    action: 'customer_created',
    newValues: {
      customer_type: customer.customer_type,
      full_name: customer.full_name,
      company_name: customer.company_name,
      email: customer.email,
      phone: customer.phone,
      customer_number: customer.customer_number,
    },
    metadata: {
      intakeFlowType: params.intakeFlowType ?? null,
      siteId,
      switchRequest: switchRequestResult ?? null,
    },
  })

  return customer
}

export async function createCustomerAction(formData: FormData) {
  await requireAdminActionAccess(['masterdata.write'])
  const actorUserId = await getActorUserId()

  await createCustomerGraph({
    actorUserId,
    customerType: normalizeCustomerType(getString(formData, 'customerType') || 'private'),
    intakeFlowType: normalizeIntakeFlowType(
      getNullableString(formData, 'intakeFlowType')
    ),
    firstName: getNullableString(formData, 'firstName'),
    lastName: getNullableString(formData, 'lastName'),
    companyName: getNullableString(formData, 'companyName'),
    contactTitle: getNullableString(formData, 'contactTitle'),
    email: getNullableString(formData, 'email'),
    phone: getNullableString(formData, 'phone'),
    personalNumber: getNullableString(formData, 'personalNumber'),
    orgNumber: getNullableString(formData, 'orgNumber'),
    apartmentNumber: getNullableString(formData, 'apartmentNumber'),
    siteName: getNullableString(formData, 'siteName'),
    facilityId: getNullableString(formData, 'facilityId'),
    meterPointId: getNullableString(formData, 'meterPointId'),
    siteType: (getString(formData, 'siteType') || 'consumption') as
      | 'consumption'
      | 'production'
      | 'mixed',
    gridOwnerId: getNullableString(formData, 'gridOwnerId'),
    priceAreaCode: getNullableString(formData, 'priceAreaCode') as
      | 'SE1'
      | 'SE2'
      | 'SE3'
      | 'SE4'
      | null,
    moveInDate: getNullableString(formData, 'moveInDate'),
    annualConsumptionKwh: parseNumber(getString(formData, 'annualConsumptionKwh')),
    currentSupplierName: getNullableString(formData, 'currentSupplierName'),
    currentSupplierOrgNumber: getNullableString(formData, 'currentSupplierOrgNumber'),
    street: getNullableString(formData, 'street'),
    postalCode: getNullableString(formData, 'postalCode'),
    city: getNullableString(formData, 'city'),
    careOf: getNullableString(formData, 'careOf'),
    movedFromStreet: getNullableString(formData, 'movedFromStreet'),
    movedFromPostalCode: getNullableString(formData, 'movedFromPostalCode'),
    movedFromCity: getNullableString(formData, 'movedFromCity'),
    movedFromSupplierName: getNullableString(formData, 'movedFromSupplierName'),
    contractOfferId: getNullableString(formData, 'contractOfferId'),
    contractStartDate: getNullableString(formData, 'contractStartDate'),
    contractStatus: getNullableString(formData, 'contractStatus'),
    overrideReason: getNullableString(formData, 'overrideReason'),
    contractTypeOverride: getString(formData, 'contractTypeOverride')
      ? parseContractType(getString(formData, 'contractTypeOverride'))
      : null,
    fixedPriceOrePerKwh: parseNumber(getString(formData, 'fixedPriceOrePerKwh')),
    spotMarkupOrePerKwh: parseNumber(getString(formData, 'spotMarkupOrePerKwh')),
    variableFeeOrePerKwh: parseNumber(getString(formData, 'variableFeeOrePerKwh')),
    monthlyFeeSek: parseNumber(getString(formData, 'monthlyFeeSek')),
    greenFeeMode: getString(formData, 'greenFeeMode')
      ? parseGreenFeeMode(getString(formData, 'greenFeeMode'))
      : null,
    greenFeeValue: parseNumber(getString(formData, 'greenFeeValue')),
    bindingMonths: parseIntOrNull(getString(formData, 'bindingMonths')),
    noticeMonths: parseIntOrNull(getString(formData, 'noticeMonths')),
    optionalFeeLines: parseOptionalFeeLines(getString(formData, 'optionalFeeLines')),
  })

  revalidatePath('/admin/customers')
  revalidatePath('/admin/customers/intake')
}

export async function bulkCreateCustomersAction(formData: FormData) {
  await requireAdminActionAccess(['masterdata.write'])
  const actorUserId = await getActorUserId()

  const raw = getString(formData, 'bulkPayload')
  if (!raw) {
    throw new Error('Ingen bulkdata skickades in')
  }

  const rows = parseBulkRows(raw)
  if (rows.length === 0) {
    throw new Error('Bulkformatet måste ha en header-rad och minst en datarad')
  }

  let created = 0
  const errors: string[] = []

  for (const [index, row] of rows.entries()) {
    try {
      await createCustomerGraph({
        actorUserId,
        customerType: normalizeCustomerType(row.customer_type || 'private'),
        intakeFlowType: normalizeIntakeFlowType(row.intake_flow_type || null),
        firstName: row.first_name || null,
        lastName: row.last_name || null,
        companyName: row.company_name || null,
        contactTitle: row.contact_title || null,
        email: row.email || null,
        phone: row.phone || null,
        personalNumber: row.personal_number || null,
        orgNumber: row.org_number || null,
        apartmentNumber: row.apartment_number || null,
        siteName: row.site_name || null,
        facilityId: row.facility_id || null,
        meterPointId: row.meter_point_id || null,
        siteType: (row.site_type as 'consumption' | 'production' | 'mixed') || 'consumption',
        gridOwnerId: row.grid_owner_id || null,
        priceAreaCode:
          (row.price_area_code as 'SE1' | 'SE2' | 'SE3' | 'SE4' | undefined) ?? null,
        moveInDate: row.move_in_date || null,
        annualConsumptionKwh: parseNumber(row.annual_consumption_kwh || ''),
        currentSupplierName: row.current_supplier_name || null,
        currentSupplierOrgNumber: row.current_supplier_org_number || null,
        street: row.street || null,
        postalCode: row.postal_code || null,
        city: row.city || null,
        careOf: row.care_of || null,
        movedFromStreet: row.moved_from_street || null,
        movedFromPostalCode: row.moved_from_postal_code || null,
        movedFromCity: row.moved_from_city || null,
        movedFromSupplierName: row.moved_from_supplier_name || null,
        contractOfferId: row.contract_offer_id || null,
        contractStartDate: row.contract_start_date || null,
        contractStatus: row.contract_status || 'pending_signature',
        overrideReason: row.override_reason || null,
        contractTypeOverride: row.contract_type_override
          ? parseContractType(row.contract_type_override)
          : null,
        fixedPriceOrePerKwh: parseNumber(row.fixed_price_ore_per_kwh || ''),
        spotMarkupOrePerKwh: parseNumber(row.spot_markup_ore_per_kwh || ''),
        variableFeeOrePerKwh: parseNumber(row.variable_fee_ore_per_kwh || ''),
        monthlyFeeSek: parseNumber(row.monthly_fee_sek || ''),
        greenFeeMode: row.green_fee_mode ? parseGreenFeeMode(row.green_fee_mode) : null,
        greenFeeValue: parseNumber(row.green_fee_value || ''),
        bindingMonths: parseIntOrNull(row.binding_months || ''),
        noticeMonths: parseIntOrNull(row.notice_months || ''),
        optionalFeeLines: parseOptionalFeeLines(row.optional_fee_lines || ''),
      })

      created += 1
    } catch (error) {
      errors.push(
        `Rad ${index + 2}: ${error instanceof Error ? error.message : 'Okänt fel'}`
      )
    }
  }

  await insertAuditLog({
    actorUserId,
    entityType: 'customer_bulk_import',
    entityId: actorUserId,
    action: 'customer_bulk_import_completed',
    newValues: {
      created,
      failed: errors.length,
    },
    metadata: {
      totalRows: rows.length,
      firstError: errors[0] ?? null,
    },
  })

  revalidatePath('/admin/customers')
  revalidatePath('/admin/customers/intake')

  if (errors.length > 0) {
    throw new Error(
      `Bulkimport klar med ${created} skapade och ${errors.length} fel. ${errors[0]}`
    )
  }
}