'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import type {
  CustomerImportCommitActionState,
  CustomerImportPreviewActionState,
  IntakeActionState,
  IntakeFieldErrors,
} from './actionState'
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
import { resolveTenantScope } from '@/lib/tenant/scope'
import {
  buildCustomerImportPreview,
  parseCustomerImportSource,
  rowsToNormalizedCsv,
  type CustomerImportIssue,
  type CustomerImportPreview,
  type CustomerImportRow,
} from '@/lib/customers/importParser'

type CustomerType = 'private' | 'business' | 'association'
type SiteType = 'consumption' | 'production' | 'mixed'
type PriceAreaCode = 'SE1' | 'SE2' | 'SE3' | 'SE4'
type ContractStatus =
  | 'draft'
  | 'pending_signature'
  | 'signed'
  | 'active'
  | 'terminated'
  | 'cancelled'
  | 'expired'

type CreateCustomerGraphParams = {
  actorUserId: string
  companyId: string
  customerType: CustomerType
  intakeFlowType: SupplierSwitchRequestType | null
  firstName: string | null
  lastName: string | null
  companyName: string | null
  contactTitle: string | null
  email: string | null
  phone: string | null
  personalNumber: string | null
  orgNumber: string | null
  apartmentNumber: string | null
  siteName: string | null
  facilityId: string | null
  meterPointId: string | null
  siteType: SiteType
  gridOwnerId: string | null
  priceAreaCode: PriceAreaCode | null
  moveInDate: string | null
  annualConsumptionKwh: number | null
  currentSupplierName: string | null
  currentSupplierOrgNumber: string | null
  street: string | null
  postalCode: string | null
  city: string | null
  careOf: string | null
  country: string | null
  movedFromStreet: string | null
  movedFromPostalCode: string | null
  movedFromCity: string | null
  movedFromSupplierName: string | null
  contractOfferId: string | null
  contractStartDate: string | null
  contractStatus: ContractStatus | null
  overrideReason: string | null
  contractTypeOverride: ContractType | null
  fixedPriceOrePerKwh: number | null
  spotMarkupOrePerKwh: number | null
  variableFeeOrePerKwh: number | null
  monthlyFeeSek: number | null
  greenFeeMode: GreenFeeMode | null
  greenFeeValue: number | null
  bindingMonths: number | null
  noticeMonths: number | null
  optionalFeeLines: Array<Record<string, unknown>>
}

type CreationContext = {
  customerId: string | null
  contactId: string | null
  addressId: string | null
  siteId: string | null
  meteringPointId: string | null
  contractId: string | null
  switchRequestId: string | null
}

class IntakeValidationError extends Error {
  fieldErrors: IntakeFieldErrors

  constructor(message: string, fieldErrors: IntakeFieldErrors) {
    super(message)
    this.name = 'IntakeValidationError'
    this.fieldErrors = fieldErrors
  }
}

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

function normalizeCustomerType(value: string | null | undefined): CustomerType {
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

function normalizeCountryCode(value: string | null | undefined): string {
  const normalized = value?.trim().toUpperCase()
  return normalized || 'SE'
}

function isIsoDate(value: string | null | undefined): boolean {
  if (!value) return false
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isEmail(value: string | null | undefined): boolean {
  if (!value) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function validateCreateCustomerParams(
  params: CreateCustomerGraphParams
): IntakeFieldErrors {
  const errors: IntakeFieldErrors = {}

  const normalizedCountry = normalizeCountryCode(params.country)
  const annualConsumptionKwh = params.annualConsumptionKwh ?? null
  const bindingMonths = params.bindingMonths ?? null
  const noticeMonths = params.noticeMonths ?? null
  const fixedPriceOrePerKwh = params.fixedPriceOrePerKwh ?? null
  const greenFeeValue = params.greenFeeValue ?? null

  const hasContractInput = Boolean(
    params.contractOfferId ||
      params.contractTypeOverride ||
      params.overrideReason ||
      params.contractStartDate ||
      fixedPriceOrePerKwh !== null ||
      (params.spotMarkupOrePerKwh ?? null) !== null ||
      (params.variableFeeOrePerKwh ?? null) !== null ||
      (params.monthlyFeeSek ?? null) !== null ||
      greenFeeValue !== null ||
      bindingMonths !== null ||
      noticeMonths !== null ||
      (params.optionalFeeLines?.length ?? 0) > 0
  )

  if (params.customerType === 'private') {
    if (!normalizeOptionalString(params.firstName)) {
      errors.firstName = 'Privatkund kräver förnamn.'
    }
    if (!normalizeOptionalString(params.lastName)) {
      errors.lastName = 'Privatkund kräver efternamn.'
    }
  } else {
    if (!normalizeOptionalString(params.companyName)) {
      errors.companyName = 'Företag eller förening kräver namn.'
    }
    if (!normalizeOptionalString(params.orgNumber)) {
      errors.orgNumber = 'Företag eller förening kräver organisationsnummer.'
    }
    if (!normalizeOptionalString(params.firstName)) {
      errors.firstName = 'Kontaktpersonens förnamn krävs.'
    }
    if (!normalizeOptionalString(params.lastName)) {
      errors.lastName = 'Kontaktpersonens efternamn krävs.'
    }
  }

  if (!isEmail(params.email)) {
    errors.email = 'E-postadressen har ogiltigt format.'
  }

  if (
    params.intakeFlowType === 'move_in' ||
    params.intakeFlowType === 'move_out_takeover'
  ) {
    if (!normalizeOptionalString(params.moveInDate)) {
      errors.moveInDate = 'Inflytt eller övertag kräver datum.'
    }
    if (!normalizeOptionalString(params.street)) {
      errors.street = 'Adress krävs för inflytt eller övertag.'
    }
    if (!normalizeOptionalString(params.postalCode)) {
      errors.postalCode = 'Postnummer krävs för inflytt eller övertag.'
    }
    if (!normalizeOptionalString(params.city)) {
      errors.city = 'Stad krävs för inflytt eller övertag.'
    }
  }

  if (normalizeOptionalString(params.moveInDate) && !isIsoDate(params.moveInDate ?? null)) {
    errors.moveInDate = 'Datum måste anges som YYYY-MM-DD.'
  }

  if (normalizedCountry.length !== 2) {
    errors.country = 'Land ska anges som två tecken, till exempel SE.'
  }

  if (annualConsumptionKwh !== null && annualConsumptionKwh < 0) {
    errors.annualConsumptionKwh = 'Årsförbrukning kan inte vara negativ.'
  }

  if (bindingMonths !== null && bindingMonths < 0) {
    errors.bindingMonths = 'Bindningstid kan inte vara negativ.'
  }

  if (noticeMonths !== null && noticeMonths < 0) {
    errors.noticeMonths = 'Uppsägningstid kan inte vara negativ.'
  }

  if (params.contractStatus === 'active' || params.contractStatus === 'signed') {
    if ((params.contractOfferId || params.contractTypeOverride || hasContractInput) && !params.contractStartDate) {
      errors.contractStartDate = 'Avtalsstart krävs när avtalet sätts som signerat eller aktivt.'
    }
  }

  if (params.contractStartDate && !isIsoDate(params.contractStartDate ?? null)) {
    errors.contractStartDate = 'Avtalsstart måste anges som YYYY-MM-DD.'
  }

  if ((params.contractOfferId || params.contractTypeOverride || hasContractInput) && !params.contractStatus) {
    errors.contractStatus = 'Avtalsstatus måste anges när avtal skapas.'
  }

  if (
    params.contractTypeOverride === 'fixed' &&
    fixedPriceOrePerKwh === null &&
    !params.contractOfferId
  ) {
    errors.fixedPriceOrePerKwh = 'Fast pris kräver prisnivå när ingen avtalsmall valts.'
  }

  if (
    params.greenFeeMode === 'sek_month' ||
    params.greenFeeMode === 'ore_per_kwh'
  ) {
    if (greenFeeValue === null) {
      errors.greenFeeValue = 'Ange värde för vald grön el-avgift.'
    }
  }

  return errors
}

function createValidationErrorFromFieldErrors(
  fieldErrors: IntakeFieldErrors
): IntakeValidationError {
  const message =
    Object.values(fieldErrors).find((value): value is string => Boolean(value)) ??
    'Valideringen misslyckades.'

  return new IntakeValidationError(message, fieldErrors)
}

function duplicateValidationError(message: string, field: keyof IntakeFieldErrors): IntakeValidationError {
  return new IntakeValidationError(message, { [field]: message })
}

async function existsInTable(params: {
  table: string
  companyId: string
  column: string
  value: string | null
}): Promise<boolean> {
  if (!params.value) return false

  const { data, error } = await supabaseService
    .from(params.table)
    .select('id')
    .eq('company_id', params.companyId)
    .eq(params.column, params.value)
    .limit(1)

  if (error) throw error
  return (data ?? []).length > 0
}

async function assertNoDuplicateCustomerGraph(params: CreateCustomerGraphParams) {
  const normalizedOrgNumber = normalizeOptionalString(params.orgNumber)
  const normalizedPersonalNumber = normalizeOptionalString(params.personalNumber)
  const normalizedEmail = normalizeOptionalString(params.email)
  const normalizedFacilityId = normalizeOptionalString(params.facilityId)
  const normalizedMeterPointId = normalizeOptionalString(params.meterPointId)

  if (
    normalizedOrgNumber &&
    (await existsInTable({
      table: 'customers',
      companyId: params.companyId,
      column: 'org_number',
      value: normalizedOrgNumber,
    }))
  ) {
    throw duplicateValidationError('En kund med samma organisationsnummer finns redan i valt företag.', 'orgNumber')
  }

  if (
    normalizedPersonalNumber &&
    (await existsInTable({
      table: 'customers',
      companyId: params.companyId,
      column: 'personal_number',
      value: normalizedPersonalNumber,
    }))
  ) {
    throw duplicateValidationError('En kund med samma personnummer finns redan i valt företag.', 'personalNumber')
  }

  if (
    normalizedEmail &&
    (await existsInTable({
      table: 'customers',
      companyId: params.companyId,
      column: 'email',
      value: normalizedEmail,
    }))
  ) {
    throw duplicateValidationError('En kund med samma e-postadress finns redan i valt företag.', 'email')
  }

  if (
    normalizedFacilityId &&
    (await existsInTable({
      table: 'customer_sites',
      companyId: params.companyId,
      column: 'facility_id',
      value: normalizedFacilityId,
    }))
  ) {
    throw duplicateValidationError('Anläggnings-id finns redan i valt företag.', 'facilityId')
  }

  if (
    normalizedMeterPointId &&
    (await existsInTable({
      table: 'metering_points',
      companyId: params.companyId,
      column: 'meter_point_id',
      value: normalizedMeterPointId,
    }))
  ) {
    throw duplicateValidationError('Mätpunkts-id finns redan i valt företag.', 'meterPointId')
  }
}

function buildCreateCustomerParams(
  formData: FormData,
  actorUserId: string,
  companyId: string
): CreateCustomerGraphParams {
  return {
    actorUserId,
    companyId,
    customerType: normalizeCustomerType(getString(formData, 'customerType') || 'private'),
    intakeFlowType: normalizeIntakeFlowType(getNullableString(formData, 'intakeFlowType')),
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
    siteType: (getString(formData, 'siteType') || 'consumption') as SiteType,
    gridOwnerId: getNullableString(formData, 'gridOwnerId'),
    priceAreaCode: getNullableString(formData, 'priceAreaCode') as PriceAreaCode | null,
    moveInDate: getNullableString(formData, 'moveInDate'),
    annualConsumptionKwh: parseNumber(getString(formData, 'annualConsumptionKwh')),
    currentSupplierName: getNullableString(formData, 'currentSupplierName'),
    currentSupplierOrgNumber: getNullableString(formData, 'currentSupplierOrgNumber'),
    street: getNullableString(formData, 'street'),
    postalCode: getNullableString(formData, 'postalCode'),
    city: getNullableString(formData, 'city'),
    careOf: getNullableString(formData, 'careOf'),
    country: getNullableString(formData, 'country'),
    movedFromStreet: getNullableString(formData, 'movedFromStreet'),
    movedFromPostalCode: getNullableString(formData, 'movedFromPostalCode'),
    movedFromCity: getNullableString(formData, 'movedFromCity'),
    movedFromSupplierName: getNullableString(formData, 'movedFromSupplierName'),
    contractOfferId: getNullableString(formData, 'contractOfferId'),
    contractStartDate: getNullableString(formData, 'contractStartDate'),
    contractStatus: getNullableString(formData, 'contractStatus') as ContractStatus | null,
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
  }
}

async function getActionTenantContext(formData?: FormData): Promise<{
  actorUserId: string
  companyId: string
}> {
  const admin = await requireAdminActionAccess({ anyOf: ['customers.write', 'masterdata.write'] })
  const scope = await resolveTenantScope({
    userId: admin.userId,
    roles: admin.roles,
    permissions: admin.permissions,
    requestedCompanyId: formData ? getNullableString(formData, 'companyId') : null,
    requireCompany: true,
  })

  if (!scope.companyId) {
    throw new Error('Välj företag innan du sparar kunddata.')
  }

  return { actorUserId: admin.userId, companyId: scope.companyId }
}

async function insertAuditLog(params: {
  actorUserId: string
  entityType: string
  entityId: string
  action: string
  newValues?: Record<string, unknown>
  metadata?: Record<string, unknown>
  companyId?: string | null
}) {
  const { data, error } = await supabaseService
    .from('audit_logs')
    .insert({
      actor_user_id: params.actorUserId,
      entity_type: params.entityType,
      entity_id: params.entityId,
      action: params.action,
      new_values: params.newValues ?? null,
      metadata: params.metadata ?? null,
      company_id: params.companyId ?? null,
    })
    .select('id')
    .single()

  if (error) throw error
  return data
}

async function createPrimaryContact(params: {
  customerId: string
  companyId: string
  customerType: CustomerType
  firstName: string | null
  lastName: string | null
  companyName: string | null
  email: string | null
  phone: string | null
  title: string | null
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
      company_id: params.companyId,
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
  companyId: string
  street: string | null
  postalCode: string | null
  city: string | null
  careOf: string | null
  moveInDate: string | null
  country: string | null
}) {
  if (!params.street && !params.postalCode && !params.city) {
    return null
  }

  const { data, error } = await supabaseService
    .from('customer_addresses')
    .insert({
      customer_id: params.customerId,
      company_id: params.companyId,
      type: 'facility',
      street_1: params.street ?? '',
      street_2: params.careOf ?? null,
      postal_code: params.postalCode ?? null,
      city: params.city ?? null,
      country: normalizeCountryCode(params.country),
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
  companyId: string
  contractId: string
  contractStatus: ContractStatus | null
  contractStartDate: string | null
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
      companyId: params.companyId,
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
      companyId: params.companyId,
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
      companyId: params.companyId,
    })

    await addCustomerContractEvent({
      customerContractId: params.contractId,
      customerId: params.customerId,
      eventType: 'activated',
      happenedAt,
      note: 'Avtal markerat som aktivt i intake-flödet',
      actorUserId: params.actorUserId,
      companyId: params.companyId,
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
      companyId: params.companyId,
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
      companyId: params.companyId,
    })
  }
}

async function maybeCreateSwitchRequestFromIntake(params: {
  customerId: string
  companyId: string
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
    companyId: params.companyId,
  })

  return {
    created: true,
    requestId: request.id,
    requestType: request.request_type,
    readiness,
  }
}

async function cleanupCreatedGraph(context: CreationContext) {
  try {
    if (context.switchRequestId) {
      await supabaseService
        .from('supplier_switch_events')
        .delete()
        .eq('supplier_switch_request_id', context.switchRequestId)

      await supabaseService
        .from('supplier_switch_requests')
        .delete()
        .eq('id', context.switchRequestId)
    }

    if (context.contractId) {
      await supabaseService
        .from('customer_contract_events')
        .delete()
        .eq('customer_contract_id', context.contractId)

      await supabaseService.from('customer_contracts').delete().eq('id', context.contractId)
    }

    if (context.meteringPointId) {
      await supabaseService.from('metering_points').delete().eq('id', context.meteringPointId)
    }

    if (context.siteId) {
      await supabaseService
        .from('customer_operation_tasks')
        .delete()
        .eq('site_id', context.siteId)

      await supabaseService.from('customer_sites').delete().eq('id', context.siteId)
    }

    if (context.addressId) {
      await supabaseService.from('customer_addresses').delete().eq('id', context.addressId)
    }

    if (context.contactId) {
      await supabaseService.from('customer_contacts').delete().eq('id', context.contactId)
    }

    if (context.customerId) {
      await supabaseService
        .from('audit_logs')
        .delete()
        .eq('entity_type', 'customer')
        .eq('entity_id', context.customerId)

      await supabaseService.from('customers').delete().eq('id', context.customerId)
    }
  } catch (cleanupError) {
    console.error('Customer intake cleanup failed', cleanupError)
  }
}

function mapUnknownErrorToIntakeState(error: unknown): IntakeActionState {
  if (error instanceof IntakeValidationError) {
    return {
      status: 'error',
      message: error.message,
      fieldErrors: error.fieldErrors,
      createdCustomerId: null,
    }
  }

  const maybeDatabaseError = error as {
    code?: string
    message?: string
    details?: string
  }

  if (maybeDatabaseError?.code === '23502') {
    if (
      maybeDatabaseError.details?.includes('customer_sites') &&
      maybeDatabaseError.message?.includes('country')
    ) {
      return {
        status: 'error',
        message: 'Land saknas för anläggningen.',
        fieldErrors: {
          country: 'Land saknas för anläggningen.',
        },
        createdCustomerId: null,
      }
    }
  }

  return {
    status: 'error',
    message:
      maybeDatabaseError?.message ||
      'Kunden kunde inte skapas. Kontrollera fälten och försök igen.',
    fieldErrors: {},
    createdCustomerId: null,
  }
}

async function createCustomerGraph(params: CreateCustomerGraphParams) {
  const fieldErrors = validateCreateCustomerParams(params)
  if (Object.keys(fieldErrors).length > 0) {
    throw createValidationErrorFromFieldErrors(fieldErrors)
  }

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
  const normalizedCountry = normalizeCountryCode(params.country)
  const normalizedContractStartDate = normalizeOptionalString(params.contractStartDate)
  const normalizedContractStatus = params.contractStatus ?? null
  const normalizedOverrideReason = normalizeOptionalString(params.overrideReason)
  const normalizedAnnualConsumptionKwh = params.annualConsumptionKwh ?? null
  const normalizedBindingMonths = params.bindingMonths ?? null
  const normalizedNoticeMonths = params.noticeMonths ?? null
  const normalizedFixedPriceOrePerKwh = params.fixedPriceOrePerKwh ?? null
  const normalizedSpotMarkupOrePerKwh = params.spotMarkupOrePerKwh ?? null
  const normalizedVariableFeeOrePerKwh = params.variableFeeOrePerKwh ?? null
  const normalizedMonthlyFeeSek = params.monthlyFeeSek ?? null
  const normalizedGreenFeeMode = params.greenFeeMode ?? null
  const normalizedGreenFeeValue = params.greenFeeValue ?? null
  const normalizedOptionalFeeLines = params.optionalFeeLines ?? []

  let normalizedPersonalNumber = normalizeOptionalString(params.personalNumber)
  let normalizedOrgNumber = normalizeOptionalString(params.orgNumber)
  let normalizedMovedFromStreet = normalizeOptionalString(params.movedFromStreet)
  let normalizedMovedFromPostalCode = normalizeOptionalString(params.movedFromPostalCode)
  let normalizedMovedFromCity = normalizeOptionalString(params.movedFromCity)
  let normalizedMovedFromSupplierName = normalizeOptionalString(params.movedFromSupplierName)

  if (params.customerType === 'private') {
    normalizedOrgNumber = null
  } else {
    normalizedPersonalNumber = null
  }

  if (
    params.intakeFlowType !== 'move_in' &&
    params.intakeFlowType !== 'move_out_takeover'
  ) {
    normalizedMovedFromStreet = null
    normalizedMovedFromPostalCode = null
    normalizedMovedFromCity = null
    normalizedMovedFromSupplierName = null
  }

  const displayName =
    params.customerType === 'business' || params.customerType === 'association'
      ? normalizedCompanyName ?? ''
      : `${normalizedFirstName ?? ''} ${normalizedLastName ?? ''}`.trim()

  const creationContext: CreationContext = {
    customerId: null,
    contactId: null,
    addressId: null,
    siteId: null,
    meteringPointId: null,
    contractId: null,
    switchRequestId: null,
  }

  try {
    const { data: customer, error: customerError } = await supabaseService
      .from('customers')
      .insert({
        company_id: params.companyId,
        customer_type: params.customerType,
        status: 'draft',
        first_name: normalizedFirstName,
        last_name: normalizedLastName,
        full_name: displayName || null,
        company_name: normalizedCompanyName,
        email: normalizedEmail,
        phone: normalizedPhone,
        personal_number: normalizedPersonalNumber,
        org_number: normalizedOrgNumber,
        apartment_number: normalizedApartmentNumber,
      })
      .select('*')
      .single()

    if (customerError) throw customerError
    creationContext.customerId = customer.id

    const contact = await createPrimaryContact({
      customerId: customer.id,
      companyId: params.companyId,
      customerType: params.customerType,
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      companyName: normalizedCompanyName,
      title: normalizedContactTitle,
      email: normalizedEmail,
      phone: normalizedPhone,
    })
    creationContext.contactId = contact?.id ?? null

    const address = await createFacilityAddress({
      customerId: customer.id,
      companyId: params.companyId,
      street: normalizedStreet,
      postalCode: normalizedPostalCode,
      city: normalizedCity,
      careOf: normalizedCareOf,
      moveInDate: normalizedMoveInDate,
      country: normalizedCountry,
    })
    creationContext.addressId = address?.id ?? null

    const shouldCreateSite = Boolean(
      normalizedSiteName ||
        normalizedFacilityId ||
        normalizedStreet ||
        normalizedGridOwnerId ||
        params.priceAreaCode ||
        normalizedMoveInDate
    )

    let siteId: string | null = null

    if (shouldCreateSite) {
      const { data: site, error: siteError } = await supabaseService
        .from('customer_sites')
        .insert({
          customer_id: customer.id,
          company_id: params.companyId,
          site_name: normalizedSiteName || displayName || 'Ny anläggning',
          facility_id: normalizedFacilityId,
          site_type: params.siteType ?? 'consumption',
          status: 'draft',
          grid_owner_id: normalizedGridOwnerId,
          price_area_code: params.priceAreaCode ?? null,
          move_in_date: normalizedMoveInDate,
          annual_consumption_kwh: normalizedAnnualConsumptionKwh,
          current_supplier_name: normalizedCurrentSupplierName,
          current_supplier_org_number: normalizedCurrentSupplierOrgNumber,
          street: normalizedStreet,
          postal_code: normalizedPostalCode,
          city: normalizedCity,
          country: normalizedCountry,
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
      creationContext.siteId = site.id
    }

    if (siteId && normalizedMeterPointId) {
      const { data: meteringPoint, error: meteringPointError } = await supabaseService
        .from('metering_points')
        .insert({
          site_id: siteId,
          company_id: params.companyId,
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
        .select('id')
        .single()

      if (meteringPointError) throw meteringPointError
      creationContext.meteringPointId = meteringPoint.id
    }

    if (params.contractOfferId || params.contractTypeOverride) {
      const offer = params.contractOfferId
        ? await getContractOfferById(params.contractOfferId, { companyId: params.companyId })
        : null

      const contract = await createCustomerContract({
        customerId: customer.id,
        siteId,
        contractOfferId: offer?.id ?? null,
        sourceType:
          params.contractOfferId && !normalizedOverrideReason ? 'catalog' : 'manual_override',
        status: normalizedContractStatus ?? 'pending_signature',
        contractName: offer?.name ?? 'Kundspecifikt avtal',
        contractType: params.contractTypeOverride ?? offer?.contract_type ?? 'variable_hourly',
        campaignName: offer?.campaign_name ?? null,
        fixedPriceOrePerKwh:
          normalizedFixedPriceOrePerKwh ?? offer?.fixed_price_ore_per_kwh ?? null,
        spotMarkupOrePerKwh:
          normalizedSpotMarkupOrePerKwh ?? offer?.spot_markup_ore_per_kwh ?? null,
        variableFeeOrePerKwh:
          normalizedVariableFeeOrePerKwh ?? offer?.variable_fee_ore_per_kwh ?? null,
        monthlyFeeSek: normalizedMonthlyFeeSek ?? offer?.monthly_fee_sek ?? null,
        greenFeeMode: normalizedGreenFeeMode ?? offer?.green_fee_mode ?? 'none',
        greenFeeValue: normalizedGreenFeeValue ?? offer?.green_fee_value ?? null,
        bindingMonths: normalizedBindingMonths ?? offer?.default_binding_months ?? null,
        noticeMonths: normalizedNoticeMonths ?? offer?.default_notice_months ?? null,
        optionalFeeLines:
          normalizedOptionalFeeLines.length > 0
            ? normalizedOptionalFeeLines
            : ((offer?.optional_fee_lines as Array<Record<string, unknown>> | null) ?? []),
        startsAt: normalizedContractStartDate,
        signedAt:
          normalizedContractStatus === 'signed' || normalizedContractStatus === 'active'
            ? normalizedContractStartDate || new Date().toISOString()
            : null,
        overrideReason: normalizedOverrideReason,
        actorUserId: params.actorUserId,
        companyId: params.companyId,
      })

      creationContext.contractId = contract.id

      await addCustomerContractEvent({
        customerContractId: contract.id,
        customerId: customer.id,
        eventType: 'created',
        note: params.contractOfferId
          ? `Skapad från avtalskatalog${normalizedOverrideReason ? ` med override: ${normalizedOverrideReason}` : ''}`
          : 'Skapad som manuellt kundspecifikt avtal',
        metadata: {
          contractOfferId: params.contractOfferId ?? null,
          customerNumber: customer.customer_number ?? null,
        },
        actorUserId: params.actorUserId,
        companyId: params.companyId,
      })

      await syncContractLifecycleEvents({
        customerId: customer.id,
        contractId: contract.id,
        contractStatus: normalizedContractStatus,
        contractStartDate: normalizedContractStartDate,
        actorUserId: params.actorUserId,
        companyId: params.companyId,
      })
    }

    const switchRequestResult = await maybeCreateSwitchRequestFromIntake({
      customerId: customer.id,
      companyId: params.companyId,
      siteId,
      intakeFlowType: params.intakeFlowType,
    })

    creationContext.switchRequestId =
      switchRequestResult && switchRequestResult.created
        ? (switchRequestResult.requestId ?? null)
        : null

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
        intakeFlowType: params.intakeFlowType,
        siteId,
        switchRequest: switchRequestResult ?? null,
        transactionReadyMode: 'manual_rollback',
      },
      companyId: params.companyId,
    })

    return customer
  } catch (error) {
    await cleanupCreatedGraph(creationContext)
    throw error
  }
}


async function buildDatabaseDuplicateIssues(rows: CustomerImportRow[], companyId: string) {
  const issues: CustomerImportIssue[] = []

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2
    const checks: Array<{ table: string; column: string; value: string; label: string }> = []

    if (row.org_number) checks.push({ table: 'customers', column: 'org_number', value: row.org_number, label: 'organisationsnummer' })
    if (row.personal_number) checks.push({ table: 'customers', column: 'personal_number', value: row.personal_number, label: 'personnummer' })
    if (row.email) checks.push({ table: 'customers', column: 'email', value: row.email, label: 'e-postadress' })
    if (row.facility_id) checks.push({ table: 'customer_sites', column: 'facility_id', value: row.facility_id, label: 'anläggnings-id' })
    if (row.meter_point_id) checks.push({ table: 'metering_points', column: 'meter_point_id', value: row.meter_point_id, label: 'mätpunkts-id' })

    for (const check of checks) {
      if (await existsInTable({ table: check.table, companyId, column: check.column, value: check.value })) {
        issues.push({
          rowNumber,
          field: check.column,
          severity: 'warning',
          message: `Möjlig dubblett: ${check.label} finns redan i valt företag.`,
        })
      }
    }
  }

  return issues
}

export async function previewCustomerImportAction(
  _prevState: CustomerImportPreviewActionState,
  formData: FormData
): Promise<CustomerImportPreviewActionState> {
  try {
    const { companyId } = await getActionTenantContext(formData)
    const fileEntry = formData.get('importFile')
    const file = fileEntry instanceof File && fileEntry.size > 0 ? fileEntry : null
    const text = getString(formData, 'bulkPayload')
    const parsed = await parseCustomerImportSource({ text, file })
    const duplicateIssues = await buildDatabaseDuplicateIssues(parsed.rows, companyId)
    const preview = buildCustomerImportPreview({
      rows: parsed.rows,
      sourceKind: parsed.sourceKind,
      message: parsed.message,
      extraIssues: duplicateIssues,
    })

    return {
      status: preview.rows.length > 0 ? 'success' : 'error',
      message: preview.message,
      preview,
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Importunderlaget kunde inte läsas.',
      preview: null,
    }
  }
}

export async function commitCustomerImportAction(
  _prevState: CustomerImportCommitActionState,
  formData: FormData
): Promise<CustomerImportCommitActionState> {
  try {
    const result = await bulkCreateCustomersAction(formData)
    return {
      status: 'success',
      message: `Importen är sparad. ${result.created} kunder skapades.`,
      created: result.created,
      failed: result.failed,
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Importen kunde inte sparas.',
      created: 0,
      failed: 1,
    }
  }
}

export async function createCustomerAction(
  _prevState: IntakeActionState,
  formData: FormData
): Promise<IntakeActionState> {
  try {
    const { actorUserId, companyId } = await getActionTenantContext(formData)
    const params = buildCreateCustomerParams(formData, actorUserId, companyId)
    await assertNoDuplicateCustomerGraph(params)

    const customer = await createCustomerGraph(params)

    revalidatePath('/admin/customers')
    revalidatePath('/admin/customers/intake')

    return {
      status: 'success',
      message: `Kunden ${customer.customer_number ?? ''} skapades utan valideringsfel.`,
      fieldErrors: {},
      createdCustomerId: customer.id,
    }
  } catch (error) {
    return mapUnknownErrorToIntakeState(error)
  }
}

export async function bulkCreateCustomersAction(formData: FormData): Promise<{ created: number; failed: number }> {
  const { actorUserId, companyId } = await getActionTenantContext(formData)

  const raw = getString(formData, 'bulkPayload')
  if (!raw) {
    throw new Error('Ingen bulkdata skickades in')
  }

  const rows = parseBulkRows(raw || rowsToNormalizedCsv([]))
  if (rows.length === 0) {
    throw new Error('Bulkformatet måste ha en header-rad och minst en datarad')
  }

  let created = 0
  const errors: string[] = []

  for (const [index, row] of rows.entries()) {
    try {
      const params: CreateCustomerGraphParams = {
        actorUserId,
        companyId,
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
        siteType: (row.site_type as SiteType) || 'consumption',
        gridOwnerId: row.grid_owner_id || null,
        priceAreaCode: (row.price_area_code as PriceAreaCode | undefined) ?? null,
        moveInDate: row.move_in_date || null,
        annualConsumptionKwh: parseNumber(row.annual_consumption_kwh || ''),
        currentSupplierName: row.current_supplier_name || null,
        currentSupplierOrgNumber: row.current_supplier_org_number || null,
        street: row.street || null,
        postalCode: row.postal_code || null,
        city: row.city || null,
        careOf: row.care_of || null,
        country: row.country || null,
        movedFromStreet: row.moved_from_street || null,
        movedFromPostalCode: row.moved_from_postal_code || null,
        movedFromCity: row.moved_from_city || null,
        movedFromSupplierName: row.moved_from_supplier_name || null,
        contractOfferId: row.contract_offer_id || null,
        contractStartDate: row.contract_start_date || null,
        contractStatus: (row.contract_status as ContractStatus | undefined) ?? 'pending_signature',
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
      }

      const validationErrors = validateCreateCustomerParams(params)
      if (Object.keys(validationErrors).length > 0) {
        throw createValidationErrorFromFieldErrors(validationErrors)
      }

      await assertNoDuplicateCustomerGraph(params)
      await createCustomerGraph(params)
      created += 1
    } catch (error) {
      const intakeError = mapUnknownErrorToIntakeState(error)
      errors.push(`Rad ${index + 2}: ${intakeError.message ?? 'Okänt fel'}`)
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
    companyId,
  })

  revalidatePath('/admin/customers')
  revalidatePath('/admin/customers/intake')

  if (errors.length > 0) {
    throw new Error(
      `Importen sparades delvis: ${created} kunder skapades och ${errors.length} rader behöver åtgärdas. ${errors[0]}`
    )
  }

  return { created, failed: errors.length }
}