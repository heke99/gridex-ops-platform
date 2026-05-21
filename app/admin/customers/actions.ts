'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import { runBatch2BAutomation } from '@/lib/operations/batch2bAutomation'
import { parseCustomerImportFormData } from '@/lib/customers/importParser'
import type {
  CustomerImportActionState,
  CustomerImportPreviewRow,
  CustomerImportPreviewRowStatus,
  IntakeActionState,
  IntakeField,
  IntakeFieldErrors,
  IntakeFormValues,
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
  gridAreaCode: string | null
  moveInDate: string | null
  annualConsumptionKwh: number | null
  currentSupplierName: string | null
  currentSupplierOrgNumber: string | null
  customerConfirmationStatus: string | null
  authorizationStatus: string | null
  authorizationValidFrom: string | null
  authorizationValidTo: string | null
  expectedStartDate: string | null
  confirmedStartDate: string | null
  actualStartDate: string | null
  startDateSource: string | null
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
  powerOfAttorneyId: string | null
}

class IntakeValidationError extends Error {
  fieldErrors: IntakeFieldErrors

  constructor(message: string, fieldErrors: IntakeFieldErrors) {
    super(message)
    this.name = 'IntakeValidationError'
    this.fieldErrors = fieldErrors
  }
}


const INTAKE_VALUE_FIELDS: IntakeField[] = [
  'customerType',
  'intakeFlowType',
  'firstName',
  'lastName',
  'companyName',
  'contactTitle',
  'email',
  'phone',
  'personalNumber',
  'orgNumber',
  'apartmentNumber',
  'siteName',
  'facilityId',
  'meterPointId',
  'siteType',
  'gridOwnerId',
  'priceAreaCode',
  'gridAreaCode',
  'moveInDate',
  'annualConsumptionKwh',
  'currentSupplierName',
  'currentSupplierOrgNumber',
  'customerConfirmationStatus',
  'authorizationStatus',
  'authorizationValidFrom',
  'authorizationValidTo',
  'expectedStartDate',
  'confirmedStartDate',
  'actualStartDate',
  'startDateSource',
  'street',
  'postalCode',
  'city',
  'careOf',
  'country',
  'movedFromStreet',
  'movedFromPostalCode',
  'movedFromCity',
  'movedFromSupplierName',
  'contractOfferId',
  'contractStartDate',
  'contractStatus',
  'overrideReason',
  'contractTypeOverride',
  'fixedPriceOrePerKwh',
  'spotMarkupOrePerKwh',
  'variableFeeOrePerKwh',
  'monthlyFeeSek',
  'greenFeeMode',
  'greenFeeValue',
  'bindingMonths',
  'noticeMonths',
  'optionalFeeLines',
]

function getFormValues(formData: FormData): IntakeFormValues {
  const values: IntakeFormValues = { country: 'SE' }

  for (const field of INTAKE_VALUE_FIELDS) {
    const rawValue = formData.get(field)
    if (typeof rawValue === 'string') {
      values[field] = rawValue
    }
  }

  if (!values.country?.trim()) {
    values.country = 'SE'
  }

  return values
}

function onlyDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

function isSwedishIdentityNumber(value: string | null | undefined): boolean {
  const digits = onlyDigits(value)
  return digits.length === 10 || digits.length === 12
}

function isSwedishOrgNumber(value: string | null | undefined): boolean {
  const digits = onlyDigits(value)
  return digits.length === 10 || digits.length === 12
}

function isSwedishPhone(value: string | null | undefined): boolean {
  if (!value) return true
  const compact = value.replace(/[\s().-]/g, '')
  return /^(\+46|0046|0)\d{7,12}$/.test(compact)
}

function isSwedishPostalCode(value: string | null | undefined): boolean {
  if (!value) return true
  return /^\d{3}\s?\d{2}$/.test(value.trim())
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
    if (!normalizeOptionalString(params.personalNumber)) {
      errors.personalNumber = 'Privatkund kräver personnummer för säkert kundintag.'
    } else if (!isSwedishIdentityNumber(params.personalNumber)) {
      errors.personalNumber = 'Personnummer ska anges med 10 eller 12 siffror.'
    }
  } else {
    if (!normalizeOptionalString(params.companyName)) {
      errors.companyName = 'Företag eller förening kräver namn.'
    }
    if (!normalizeOptionalString(params.orgNumber)) {
      errors.orgNumber = 'Företag eller förening kräver organisationsnummer.'
    } else if (!isSwedishOrgNumber(params.orgNumber)) {
      errors.orgNumber = 'Organisationsnummer ska anges med 10 eller 12 siffror.'
    }
    if (!normalizeOptionalString(params.firstName)) {
      errors.firstName = 'Kontaktpersonens förnamn krävs.'
    }
    if (!normalizeOptionalString(params.lastName)) {
      errors.lastName = 'Kontaktpersonens efternamn krävs.'
    }
  }

  if (!normalizeOptionalString(params.email) && !normalizeOptionalString(params.phone)) {
    errors.email = 'Ange e-post eller telefonnummer så kunden kan kontaktas.'
  }

  if (!isEmail(params.email)) {
    errors.email = 'E-postadressen har ogiltigt format.'
  }

  if (!isSwedishPhone(params.phone)) {
    errors.phone = 'Telefonnummer ska vara ett svenskt nummer, till exempel 0701234567 eller +46701234567.'
  }

  if (!isSwedishPostalCode(params.postalCode)) {
    errors.postalCode = 'Postnummer ska anges som 12345 eller 123 45.'
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

  for (const [field, value, label] of [
    ['authorizationValidFrom', params.authorizationValidFrom, 'Fullmakt giltig från'],
    ['authorizationValidTo', params.authorizationValidTo, 'Fullmakt giltig till'],
    ['expectedStartDate', params.expectedStartDate, 'Förväntat startdatum'],
    ['confirmedStartDate', params.confirmedStartDate, 'Bekräftat startdatum'],
    ['actualStartDate', params.actualStartDate, 'Faktiskt startdatum'],
  ] as Array<[IntakeField, string | null, string]>) {
    if (normalizeOptionalString(value) && !isIsoDate(value)) {
      errors[field] = `${label} måste anges som YYYY-MM-DD.`
    }
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
    gridAreaCode: getNullableString(formData, 'gridAreaCode'),
    moveInDate: getNullableString(formData, 'moveInDate'),
    annualConsumptionKwh: parseNumber(getString(formData, 'annualConsumptionKwh')),
    currentSupplierName: getNullableString(formData, 'currentSupplierName'),
    currentSupplierOrgNumber: getNullableString(formData, 'currentSupplierOrgNumber'),
    customerConfirmationStatus: getNullableString(formData, 'customerConfirmationStatus'),
    authorizationStatus: getNullableString(formData, 'authorizationStatus'),
    authorizationValidFrom: getNullableString(formData, 'authorizationValidFrom'),
    authorizationValidTo: getNullableString(formData, 'authorizationValidTo'),
    expectedStartDate: getNullableString(formData, 'expectedStartDate'),
    confirmedStartDate: getNullableString(formData, 'confirmedStartDate'),
    actualStartDate: getNullableString(formData, 'actualStartDate'),
    startDateSource: getNullableString(formData, 'startDateSource'),
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
  companyId?: string | null
  entityType: string
  entityId: string
  action: string
  newValues?: Record<string, unknown>
  metadata?: Record<string, unknown>
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
  customerType: CustomerType
  firstName: string | null
  lastName: string | null
  companyName: string | null
  email: string | null
  phone: string | null
  title: string | null
  companyId: string
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
      company_id: params.companyId,
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
  street: string | null
  postalCode: string | null
  city: string | null
  careOf: string | null
  moveInDate: string | null
  country: string | null
  companyId: string
}) {
  if (!params.street && !params.postalCode && !params.city) {
    return null
  }

  const { data, error } = await supabaseService
    .from('customer_addresses')
    .insert({
      company_id: params.companyId,
      customer_id: params.customerId,
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

async function maybeCreatePowerOfAttorneyFromIntake(params: {
  companyId: string
  actorUserId: string
  customerId: string
  siteId: string | null
  status: string | null
  validFrom: string | null
  validTo: string | null
}) {
  const normalizedStatus = params.status === 'signed' || params.status === 'sent' || params.status === 'expired' || params.status === 'revoked'
    ? params.status
    : params.status === 'missing'
      ? null
      : 'draft'

  if (!normalizedStatus) return null

  try {
    const { data, error } = await supabaseService
      .from('powers_of_attorney')
      .insert({
        company_id: params.companyId,
        customer_id: params.customerId,
        site_id: params.siteId,
        scope: 'supplier_switch',
        status: normalizedStatus,
        signed_at: normalizedStatus === 'signed' ? new Date().toISOString() : null,
        valid_from: params.validFrom,
        valid_to: params.validTo,
        document_path: null,
        reference: `INTAKE-${params.customerId.slice(0, 8)}`,
        notes: 'Skapad från kundintag. Dokument kan kompletteras på kundkortet.',
        created_by: params.actorUserId,
        updated_by: params.actorUserId,
      })
      .select('id')
      .maybeSingle()

    if (error) {
      if (!databaseObjectMissing(error) && error.code !== '42703') {
        console.warn('Power of attorney from intake could not be created', error)
      }
      return null
    }

    return data?.id ?? null
  } catch (error) {
    if (!databaseObjectMissing(error)) {
      console.warn('Power of attorney from intake could not be created', error)
    }
    return null
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
      poa.status === 'signed' &&
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

    if (context.powerOfAttorneyId) {
      await supabaseService.from('powers_of_attorney').delete().eq('id', context.powerOfAttorneyId)
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
    console.error('Customer intake rollback failed', cleanupError)
  }
}


function databaseObjectMissing(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(
    maybe &&
      (maybe.code === '42P01' ||
        maybe.code === 'PGRST205' ||
        /does not exist|schema cache|relation .* does not exist/i.test(maybe.message ?? ''))
  )
}

async function maybeSingleExists(
  table: string,
  companyId: string,
  column: string,
  value: string | null
): Promise<boolean> {
  const normalized = normalizeOptionalString(value)
  if (!normalized) return false

  try {
    let query = supabaseService
      .from(table)
      .select('id')
      .eq('company_id', companyId)
      .limit(1)

    query = column === 'email'
      ? query.ilike(column, normalized)
      : query.eq(column, normalized)

    const { data, error } = await query.maybeSingle()

    if (error) {
      if (databaseObjectMissing(error)) return false
      throw error
    }

    return Boolean(data)
  } catch (error) {
    if (databaseObjectMissing(error)) return false
    throw error
  }
}

async function findIntakeDuplicates(
  params: CreateCustomerGraphParams
): Promise<IntakeFieldErrors> {
  const errors: IntakeFieldErrors = {}

  const checks = await Promise.all([
    maybeSingleExists('customers', params.companyId, 'email', params.email),
    maybeSingleExists('customers', params.companyId, 'personal_number', params.personalNumber),
    maybeSingleExists('customers', params.companyId, 'org_number', params.orgNumber),
    maybeSingleExists('customer_sites', params.companyId, 'facility_id', params.facilityId),
    maybeSingleExists('metering_points', params.companyId, 'meter_point_id', params.meterPointId),
  ])

  if (checks[0]) {
    errors.email = 'En kund med denna e-post finns redan i detta bolag.'
  }
  if (checks[1]) {
    errors.personalNumber = 'En kund med detta personnummer finns redan i detta bolag.'
  }
  if (checks[2]) {
    errors.orgNumber = 'En kund med detta organisationsnummer finns redan i detta bolag.'
  }
  if (checks[3]) {
    errors.facilityId = 'Denna anläggning finns redan i detta bolag.'
  }
  if (checks[4]) {
    errors.meterPointId = 'Denna mätpunkt finns redan i detta bolag.'
  }

  return errors
}

function buildMissingDataList(params: CreateCustomerGraphParams, switchRequestResult: unknown): string[] {
  const missing: string[] = []

  if (!normalizeOptionalString(params.facilityId)) missing.push('anläggnings-id')
  if (!normalizeOptionalString(params.meterPointId)) missing.push('mätpunkts-id')
  if (!normalizeOptionalString(params.gridOwnerId)) missing.push('nätägare')
  if (!normalizeOptionalString(params.gridAreaCode)) missing.push('nätområde')
  if (!normalizeOptionalString(params.priceAreaCode)) missing.push('elområde')
  if (!normalizeOptionalString(params.currentSupplierName)) missing.push('nuvarande elleverantör')
  if (!normalizeOptionalString(params.customerConfirmationStatus) || params.customerConfirmationStatus !== 'confirmed') {
    missing.push('kundbekräftelse')
  }

  const hasAnyStartDate = Boolean(
    normalizeOptionalString(params.contractStartDate) ||
      normalizeOptionalString(params.expectedStartDate) ||
      normalizeOptionalString(params.confirmedStartDate) ||
      normalizeOptionalString(params.actualStartDate) ||
      normalizeOptionalString(params.moveInDate)
  )

  if (!hasAnyStartDate) missing.push('förväntat avtalsstartdatum')

  if (params.intakeFlowType && params.authorizationStatus !== 'signed') {
    missing.push(params.authorizationStatus === 'sent' ? 'fullmakt ej signerad' : 'fullmakt saknas')
  }

  const maybeSwitch = switchRequestResult as { created?: boolean; reason?: string } | null
  if (params.intakeFlowType && maybeSwitch && !maybeSwitch.created && maybeSwitch.reason) {
    missing.push(maybeSwitch.reason.toLowerCase())
  }

  return Array.from(new Set(missing))
}

function buildAddressWarnings(params: CreateCustomerGraphParams): string[] {
  const warnings: string[] = []
  const addressParts = [params.street, params.postalCode, params.city].map((value) => normalizeOptionalString(value))
  const filledAddressParts = addressParts.filter(Boolean).length

  if (filledAddressParts > 0 && filledAddressParts < 3) {
    warnings.push('Anläggningsadressen är ofullständig. Kontrollera gata, postnummer och ort innan switch eller fakturering startas.')
  }

  const currentAddress = [params.street, params.postalCode, params.city]
    .map((value) => normalizeOptionalString(value)?.toLowerCase() ?? '')
    .join('|')
  const movedFromAddress = [params.movedFromStreet, params.movedFromPostalCode, params.movedFromCity]
    .map((value) => normalizeOptionalString(value)?.toLowerCase() ?? '')
    .join('|')

  if (params.intakeFlowType !== 'switch' && currentAddress.replace(/\|/g, '') && currentAddress === movedFromAddress) {
    warnings.push('Flyttadress och ny anläggningsadress verkar vara samma. Kontrollera adressen innan flödet skickas vidare.')
  }

  return warnings
}

type IntakeStatus = 'draft' | 'incomplete' | 'needs_completion' | 'ready_for_contract' | 'ready_for_operations'

function determineIntakeStatus(params: CreateCustomerGraphParams, missingData: string[], contractId: string | null): IntakeStatus {
  const hasCoreIdentity = Boolean(
    (params.customerType === 'private' && params.firstName && params.lastName && params.personalNumber) ||
      (params.customerType !== 'private' && params.companyName && params.orgNumber)
  )
  const hasContact = Boolean(params.email || params.phone)

  if (!hasCoreIdentity || !hasContact) return 'incomplete'
  if (missingData.length > 0) return 'needs_completion'
  if (!contractId) return 'ready_for_contract'
  return 'ready_for_operations'
}


function calculateIntakeQualityScore(params: CreateCustomerGraphParams, missingData: string[]): number {
  let score = 100

  const importantValues = [
    params.firstName || params.companyName,
    params.lastName || params.orgNumber,
    params.email || params.phone,
    params.facilityId,
    params.meterPointId,
    params.gridOwnerId,
    params.contractOfferId || params.contractTypeOverride,
    params.contractStartDate,
  ]

  score -= importantValues.filter((value) => !normalizeOptionalString(value as string | null | undefined)).length * 8
  score -= missingData.length * 6

  return Math.max(0, Math.min(100, score))
}

async function updateCustomerIntakeQuality(params: {
  customerId: string
  missingData: string[]
  qualityScore: number
  intakeStatus: IntakeStatus
  addressWarnings?: string[]
}) {
  try {
    const { error } = await supabaseService
      .from('customers')
      .update({
        intake_status: params.intakeStatus,
        intake_missing_fields: params.missingData,
        intake_quality_score: params.qualityScore,
        intake_warnings: params.addressWarnings ?? [],
      })
      .eq('id', params.customerId)

    if (error && !databaseObjectMissing(error) && error.code !== '42703') {
      console.warn('Customer intake quality could not be updated', error)
    }
  } catch (error) {
    if (!databaseObjectMissing(error)) {
      console.warn('Customer intake quality could not be updated', error)
    }
  }
}

async function createIntakeFollowUps(params: {
  companyId: string
  actorUserId: string
  customerId: string
  siteId: string | null
  meteringPointId: string | null
  contractId: string | null
  gridOwnerId: string | null
  currentSupplierName: string | null
  missingData: string[]
  addressWarnings?: string[]
}) {
  const warnings = params.addressWarnings ?? []
  if (params.missingData.length === 0 && warnings.length === 0) return

  const blockerReason = params.missingData.length > 0
    ? `Kundintag kräver komplettering: ${params.missingData.join(', ')}.`
    : `Kundintag kräver adresskontroll: ${warnings.join(' ')}`
  const requestedCategories = params.missingData.map((value) => ({ key: value }))

  try {
    const { error: requestError } = await supabaseService
      .from('customer_info_requests')
      .insert({
        company_id: params.companyId,
        customer_id: params.customerId,
        site_id: params.siteId,
        metering_point_id: params.meteringPointId,
        request_type: 'customer_intake_completion',
        target_party_type: params.gridOwnerId ? 'grid_owner' : 'customer_or_supplier',
        target_party_name: params.currentSupplierName,
        grid_owner_id: params.gridOwnerId,
        current_supplier_name: params.currentSupplierName,
        status: 'manual_review_required',
        requested_data_categories: requestedCategories,
        blocker_reason: blockerReason,
        notes: 'Automatiskt skapad från kundintag när obligatoriska driftuppgifter saknades.',
        created_by: params.actorUserId,
        updated_by: params.actorUserId,
      })

    if (requestError && !databaseObjectMissing(requestError)) {
      console.warn('Customer intake info request could not be created', requestError)
    }
  } catch (error) {
    if (!databaseObjectMissing(error)) {
      console.warn('Customer intake info request could not be created', error)
    }
  }

  try {
    const { data: createdCase, error: caseError } = await supabaseService
      .from('customer_cases')
      .insert({
        company_id: params.companyId,
        customer_id: params.customerId,
        site_id: params.siteId,
        metering_point_id: params.meteringPointId,
        customer_contract_id: params.contractId,
        case_type: params.missingData.some((value) => value.includes('fullmakt'))
          ? 'missing_authorization'
          : 'technical_blocker',
        status: 'action_required',
        priority: params.missingData.some((value) => value.includes('fullmakt') || value.includes('mätpunkt'))
          ? 'high'
          : 'normal',
        title: 'Kundintag kräver komplettering',
        description: blockerReason,
        reason_category: 'customer_intake_missing_data',
        billing_blocked: params.missingData.some((value) => value.includes('mätpunkt') || value.includes('startdatum')),
        billing_manual_review: true,
        source: 'customer_intake',
        next_action: 'Komplettera saknade uppgifter innan leverantörsbyte eller fakturering går vidare.',
        metadata: {
          missingData: params.missingData,
          addressWarnings: warnings,
          createdFrom: 'createCustomerAction',
        },
        created_by: params.actorUserId,
        updated_by: params.actorUserId,
      })
      .select('id')
      .maybeSingle()

    if (caseError) {
      if (!databaseObjectMissing(caseError)) {
        console.warn('Customer intake case could not be created', caseError)
      }
      return
    }

    if (createdCase?.id) {
      const { error: eventError } = await supabaseService.from('customer_case_events').insert({
        company_id: params.companyId,
        customer_case_id: createdCase.id,
        customer_id: params.customerId,
        event_type: 'created_from_customer_intake',
        event_status: 'warning',
        message: blockerReason,
        payload: { missingData: params.missingData },
        created_by: params.actorUserId,
      })

      if (eventError && !databaseObjectMissing(eventError)) {
        console.warn('Customer intake case event could not be created', eventError)
      }
    }
  } catch (error) {
    if (!databaseObjectMissing(error)) {
      console.warn('Customer intake case could not be created', error)
    }
  }
}

function mapUnknownErrorToIntakeState(
  error: unknown,
  values: IntakeFormValues = {}
): IntakeActionState {
  if (error instanceof IntakeValidationError) {
    return {
      status: 'error',
      message: error.message,
      fieldErrors: error.fieldErrors,
      values,
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
        values,
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
    values,
    createdCustomerId: null,
  }
}

async function createCustomerGraph(params: CreateCustomerGraphParams) {
  const fieldErrors = validateCreateCustomerParams(params)
  if (Object.keys(fieldErrors).length > 0) {
    throw createValidationErrorFromFieldErrors(fieldErrors)
  }

  const duplicateErrors = await findIntakeDuplicates(params)
  if (Object.keys(duplicateErrors).length > 0) {
    throw createValidationErrorFromFieldErrors(duplicateErrors)
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
  const normalizedGridAreaCode = normalizeOptionalString(params.gridAreaCode)
  const normalizedMoveInDate = normalizeOptionalString(params.moveInDate)
  const normalizedCurrentSupplierName = normalizeOptionalString(params.currentSupplierName)
  const normalizedCurrentSupplierOrgNumber = normalizeOptionalString(
    params.currentSupplierOrgNumber
  )
  const normalizedCustomerConfirmationStatus = normalizeOptionalString(params.customerConfirmationStatus)
  const normalizedAuthorizationStatus = normalizeOptionalString(params.authorizationStatus)
  const normalizedAuthorizationValidFrom = normalizeOptionalString(params.authorizationValidFrom)
  const normalizedAuthorizationValidTo = normalizeOptionalString(params.authorizationValidTo)
  const normalizedExpectedStartDate = normalizeOptionalString(params.expectedStartDate)
  const normalizedConfirmedStartDate = normalizeOptionalString(params.confirmedStartDate)
  const normalizedActualStartDate = normalizeOptionalString(params.actualStartDate)
  const normalizedStartDateSource = normalizeOptionalString(params.startDateSource)
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
    powerOfAttorneyId: null,
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
      customerType: params.customerType,
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      companyName: normalizedCompanyName,
      title: normalizedContactTitle,
      email: normalizedEmail,
      phone: normalizedPhone,
      companyId: params.companyId,
    })
    creationContext.contactId = contact?.id ?? null

    const address = await createFacilityAddress({
      customerId: customer.id,
      street: normalizedStreet,
      postalCode: normalizedPostalCode,
      city: normalizedCity,
      careOf: normalizedCareOf,
      moveInDate: normalizedMoveInDate,
      country: normalizedCountry,
      companyId: params.companyId,
    })
    creationContext.addressId = address?.id ?? null

    const shouldCreateSite = Boolean(
      normalizedSiteName ||
        normalizedFacilityId ||
        normalizedStreet ||
        normalizedGridOwnerId ||
        normalizedGridAreaCode ||
        params.priceAreaCode ||
        normalizedMoveInDate
    )

    let siteId: string | null = null

    if (shouldCreateSite) {
      const { data: site, error: siteError } = await supabaseService
        .from('customer_sites')
        .insert({
          company_id: params.companyId,
          customer_id: customer.id,
          site_name: normalizedSiteName || displayName || 'Ny anläggning',
          facility_id: normalizedFacilityId,
          site_type: params.siteType ?? 'consumption',
          status: 'draft',
          grid_owner_id: normalizedGridOwnerId,
          price_area_code: params.priceAreaCode ?? null,
          grid_area_code: normalizedGridAreaCode,
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
          company_id: params.companyId,
          site_id: siteId,
          meter_point_id: normalizedMeterPointId,
          site_facility_id: normalizedFacilityId,
          status: 'draft',
          measurement_type: 'consumption',
          reading_frequency: 'hourly',
          grid_owner_id: normalizedGridOwnerId,
          price_area_code: params.priceAreaCode ?? null,
          grid_area_code: normalizedGridAreaCode,
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
        ? await getContractOfferById(params.contractOfferId, params.companyId)
        : null

      const contract = await createCustomerContract({
        companyId: params.companyId,
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
        startsAt: normalizedContractStartDate ?? normalizedConfirmedStartDate ?? normalizedExpectedStartDate,
        expectedStartAt: normalizedExpectedStartDate,
        confirmedStartAt: normalizedConfirmedStartDate,
        actualStartAt: normalizedActualStartDate,
        startDateSource: normalizedStartDateSource,
        signedAt:
          normalizedContractStatus === 'signed' || normalizedContractStatus === 'active'
            ? normalizedContractStartDate || normalizedConfirmedStartDate || new Date().toISOString()
            : null,
        overrideReason: normalizedOverrideReason,
        actorUserId: params.actorUserId,
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
      })

      await syncContractLifecycleEvents({
        customerId: customer.id,
        contractId: contract.id,
        contractStatus: normalizedContractStatus,
        contractStartDate: normalizedContractStartDate ?? normalizedConfirmedStartDate ?? normalizedExpectedStartDate,
        actorUserId: params.actorUserId,
      })
    }

    creationContext.powerOfAttorneyId = await maybeCreatePowerOfAttorneyFromIntake({
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      customerId: customer.id,
      siteId,
      status: normalizedAuthorizationStatus,
      validFrom: normalizedAuthorizationValidFrom,
      validTo: normalizedAuthorizationValidTo,
    })

    const switchRequestResult = await maybeCreateSwitchRequestFromIntake({
      customerId: customer.id,
      siteId,
      intakeFlowType: params.intakeFlowType,
    })

    creationContext.switchRequestId =
      switchRequestResult && switchRequestResult.created
        ? (switchRequestResult.requestId ?? null)
        : null

    const missingData = buildMissingDataList(params, switchRequestResult)
    const addressWarnings = buildAddressWarnings(params)
    const intakeQualityScore = calculateIntakeQualityScore(params, missingData)
    const intakeStatus = determineIntakeStatus(params, missingData, creationContext.contractId)

    await createIntakeFollowUps({
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      customerId: customer.id,
      siteId,
      meteringPointId: creationContext.meteringPointId,
      contractId: creationContext.contractId,
      gridOwnerId: normalizedGridOwnerId,
      currentSupplierName: normalizedCurrentSupplierName,
      missingData,
      addressWarnings,
    })

    await updateCustomerIntakeQuality({
      customerId: customer.id,
      missingData,
      qualityScore: intakeQualityScore,
      intakeStatus,
      addressWarnings,
    })

    const batch2BAutomationResult = await runBatch2BAutomation({
      companyId: params.companyId,
      actorUserId: params.actorUserId,
    }).catch((error) => ({
      error: error instanceof Error ? error.message : 'Automationsmotorn kunde inte köras efter kundintag.',
    }))

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
      companyId: params.companyId,
      metadata: {
        intakeFlowType: params.intakeFlowType,
        siteId,
        switchRequest: switchRequestResult ?? null,
        missingData,
        addressWarnings,
        intakeStatus,
        intakeFollowUpsCreated: missingData.length > 0 || addressWarnings.length > 0,
        intakeQualityScore,
        customerConfirmationStatus: normalizedCustomerConfirmationStatus,
        authorizationStatus: normalizedAuthorizationStatus,
        startDates: {
          desired: normalizedMoveInDate,
          expected: normalizedExpectedStartDate,
          confirmed: normalizedConfirmedStartDate,
          actual: normalizedActualStartDate,
          source: normalizedStartDateSource,
        },
        batch2BAutomation: batch2BAutomationResult,
        transactionReadyMode: 'server_validated_rollback',
      },
    })

    return customer
  } catch (error) {
    await cleanupCreatedGraph(creationContext)
    throw error
  }
}

export async function createCustomerAction(
  _prevState: IntakeActionState,
  formData: FormData
): Promise<IntakeActionState> {
  try {
    await requireAdminActionAccess({ anyOf: ['customers.write', 'masterdata.write'] })
    const actorUserId = await getActorUserId()
    const companyId = await requireOperationalCompanyId(actorUserId)
    await requireCompanyOperationalForWrites(companyId)
    const params = buildCreateCustomerParams(formData, actorUserId, companyId)

    const customer = await createCustomerGraph(params)

    revalidatePath('/admin/customers')
    revalidatePath('/admin/customers/intake')

    return {
      status: 'success',
      message: `Kunden ${customer.customer_number ?? ''} skapades utan valideringsfel.`,
      fieldErrors: {},
      values: { country: 'SE' },
      createdCustomerId: customer.id,
    }
  } catch (error) {
    return mapUnknownErrorToIntakeState(error, getFormValues(formData))
  }
}

async function resolveContractOfferIdForImport(params: {
  companyId: string
  row: Record<string, string>
  fallbackContractOfferId: string | null
  forceFallback: boolean
}): Promise<string | null> {
  if (params.forceFallback && params.fallbackContractOfferId) return params.fallbackContractOfferId
  if (params.row.contract_offer_id?.trim()) return params.row.contract_offer_id.trim()
  if (params.fallbackContractOfferId) return params.fallbackContractOfferId

  const lookup = rowValue(params.row, 'contract_offer_name', 'campaign_name', 'campaign_code')
  if (!lookup) return null

  const { data, error } = await supabaseService
    .from('contract_offers')
    .select('id')
    .eq('company_id', params.companyId)
    .eq('is_active', true)
    .or(`name.ilike.${lookup},campaign_name.ilike.${lookup},slug.ilike.${lookup}`)
    .limit(1)
    .maybeSingle()

  if (error) {
    if (databaseObjectMissing(error)) return null
    throw error
  }

  return data?.id ?? null
}

async function insertImportRow(params: {
  importBatchId: string | null | undefined
  companyId: string
  rowNumber: number
  status: CustomerImportPreviewRowStatus | 'failed'
  row: Record<string, string>
  customerId?: string | null
  errorMessage?: string | null
  warnings?: string[]
  missingFields?: string[]
  uncertainFields?: string[]
  duplicateWarnings?: string[]
  confidence?: number
}) {
  if (!params.importBatchId) return

  await supabaseService.from('customer_import_rows').insert({
    import_batch_id: params.importBatchId,
    company_id: params.companyId,
    row_number: params.rowNumber,
    status: params.status,
    normalized_payload: params.row,
    customer_id: params.customerId ?? null,
    error_message: params.errorMessage ?? null,
    warnings: params.warnings ?? [],
    issues: {
      missingFields: params.missingFields ?? [],
      uncertainFields: params.uncertainFields ?? [],
      duplicateWarnings: params.duplicateWarnings ?? [],
      confidence: params.confidence ?? null,
    },
    parser_confidence: params.confidence ?? null,
  })
}

export async function bulkCreateCustomersAction(formData: FormData) {
  await requireAdminActionAccess({ anyOf: ['customers.write', 'masterdata.write'] })
  const actorUserId = await getActorUserId()
  const companyId = await requireOperationalCompanyId(actorUserId)
  await requireCompanyOperationalForWrites(companyId)

  const parsedImport = await parseCustomerImportFormData(formData)
  const rows = parsedImport.rows
  if (rows.length === 0) {
    throw new Error(parsedImport.warnings[0] ?? 'Importunderlaget innehöll inga kundrader.')
  }

  const fallbackContractOfferId = getNullableString(formData, 'fallbackContractOfferId')
  const forceFallbackContract = formData.get('applyFallbackContractToAll') === 'on'
  const file = formData.get('bulkFile')
  const fileName = file && typeof file === 'object' && 'name' in file ? String((file as File).name) : null
  const importBatchResult = await supabaseService
    .from('customer_import_batches')
    .insert({
      company_id: companyId,
      source_kind: parsedImport.sourceKind,
      source_type: parsedImport.sourceKind,
      file_name: fileName,
      status: 'previewed',
      total_rows: rows.length,
      rows_total: rows.length,
      created_rows: 0,
      rows_created: 0,
      failed_rows: 0,
      rows_failed: 0,
      warnings: parsedImport.warnings,
      issues: parsedImport.warnings.map((warning) => ({ warning })),
      metadata: {
        fallbackContractOfferId,
        forceFallbackContract,
      },
      created_by: actorUserId,
    })
    .select('id')
    .maybeSingle()

  if (importBatchResult.error && !databaseObjectMissing(importBatchResult.error)) {
    throw importBatchResult.error
  }

  const importBatch = importBatchResult.data

  let created = 0
  let review = 0
  let failed = 0
  const errors: string[] = []

  for (const [index, originalRow] of rows.entries()) {
    const rowNumber = index + 2
    const row: Record<string, string> = {
      ...originalRow,
      country: originalRow.country || 'SE',
    }

    try {
      row.contract_offer_id = await resolveContractOfferIdForImport({
        companyId,
        row,
        fallbackContractOfferId,
        forceFallback: forceFallbackContract,
      }) ?? ''

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
        gridAreaCode: row.grid_area_code || row.grid_area_id || null,
        moveInDate: row.move_in_date || row.start_date || null,
        annualConsumptionKwh: parseNumber(row.annual_consumption_kwh || ''),
        currentSupplierName: row.current_supplier_name || null,
        currentSupplierOrgNumber: row.current_supplier_org_number || null,
        customerConfirmationStatus: row.customer_confirmation_status || row.customer_confirmation || null,
        authorizationStatus: row.authorization_status || row.power_of_attorney_status || null,
        authorizationValidFrom: row.authorization_valid_from || null,
        authorizationValidTo: row.authorization_valid_to || null,
        expectedStartDate: row.expected_start_date || row.contract_expected_start_date || null,
        confirmedStartDate: row.confirmed_start_date || null,
        actualStartDate: row.actual_start_date || null,
        startDateSource: row.start_date_source || null,
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
        contractStartDate: row.contract_start_date || row.expected_start_date || null,
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
      const duplicateErrors = await findIntakeDuplicates(params)
      const missingFields = importRowMissingFields(row)
      const uncertainFields = importRowUncertainFields(row)
      const duplicateWarnings = Object.values(duplicateErrors).filter((value): value is string => Boolean(value))
      const warnings = [...importRowWarnings(row), ...duplicateWarnings]
      const confidence = calculateImportConfidence(row, missingFields, uncertainFields, duplicateWarnings)
      const status = Object.keys(validationErrors).length > 0
        ? 'missing_fields'
        : classifyImportRow({ missingFields, uncertainFields, duplicateWarnings, confidence })

      if (status !== 'ready_to_create') {
        review += 1
        await insertImportRow({
          importBatchId: importBatch?.id,
          companyId,
          rowNumber,
          status,
          row,
          warnings,
          missingFields: [...missingFields, ...Object.values(validationErrors).filter((value): value is string => Boolean(value))],
          uncertainFields,
          duplicateWarnings,
          confidence,
        })
        continue
      }

      const customer = await createCustomerGraph(params)
      created += 1

      await insertImportRow({
        importBatchId: importBatch?.id,
        companyId,
        rowNumber,
        status: 'created',
        row,
        customerId: customer.id,
        warnings,
        missingFields,
        uncertainFields,
        duplicateWarnings,
        confidence,
      })
    } catch (error) {
      failed += 1
      const intakeError = mapUnknownErrorToIntakeState(error)
      const message = `Rad ${rowNumber}: ${intakeError.message ?? 'Okänt fel'}`
      errors.push(message)

      await insertImportRow({
        importBatchId: importBatch?.id,
        companyId,
        rowNumber,
        status: 'failed',
        row,
        errorMessage: intakeError.message ?? 'Okänt fel',
        warnings: [],
        missingFields: [],
        uncertainFields: [],
        duplicateWarnings: [],
        confidence: 0,
      })
    }
  }

  if (importBatch?.id) {
    const finalStatus = failed > 0 || review > 0 ? 'partially_imported' : 'completed'
    await supabaseService
      .from('customer_import_batches')
      .update({
        status: finalStatus,
        created_rows: created,
        rows_created: created,
        failed_rows: failed + review,
        rows_failed: failed + review,
        imported_at: new Date().toISOString(),
        metadata: {
          fallbackContractOfferId,
          forceFallbackContract,
          reviewRows: review,
          failedRows: failed,
        },
      })
      .eq('id', importBatch.id)
  }

  await insertAuditLog({
    actorUserId,
    entityType: 'customer_bulk_import',
    entityId: importBatch?.id ?? actorUserId,
    action: 'customer_bulk_import_completed',
    newValues: {
      created,
      review,
      failed,
    },
    companyId,
    metadata: {
      totalRows: rows.length,
      sourceKind: parsedImport.sourceKind,
      warnings: parsedImport.warnings,
      firstError: errors[0] ?? null,
    },
  })

  revalidatePath('/admin/customers')
  revalidatePath('/admin/customers/intake')
  revalidatePath('/admin/customers/imports')

  return { totalRows: rows.length, createdRows: created, reviewRows: review, failedRows: failed, warnings: parsedImport.warnings, firstError: errors[0] ?? null }
}

function importPreviewLabel(row: Record<string, string>): string {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
  return row.company_name || name || row.email || row.org_number || row.personal_number || 'Kundrad'
}

function importUniqueKey(row: Record<string, string>): string {
  return row.org_number || row.personal_number || row.email || row.facility_id || row.meter_point_id || ''
}

function normalizeLookupValue(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function rowValue(row: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function importRowMissingFields(row: Record<string, string>): string[] {
  const missing: string[] = []
  const customerType = normalizeCustomerType(row.customer_type || 'private')

  if (customerType === 'private') {
    if (!rowValue(row, 'first_name')) missing.push('förnamn')
    if (!rowValue(row, 'last_name')) missing.push('efternamn')
    if (!rowValue(row, 'personal_number')) missing.push('personnummer')
  } else {
    if (!rowValue(row, 'company_name')) missing.push('företags-/föreningsnamn')
    if (!rowValue(row, 'org_number')) missing.push('organisationsnummer')
  }

  if (!rowValue(row, 'email') && !rowValue(row, 'phone')) missing.push('e-post eller telefon')
  if (!rowValue(row, 'facility_id')) missing.push('anläggnings-id')
  if (!rowValue(row, 'meter_point_id')) missing.push('mätpunkts-id')
  if (!rowValue(row, 'grid_owner_id', 'grid_owner_name')) missing.push('nätägare')
  if (!rowValue(row, 'grid_area_code', 'grid_area_id')) missing.push('nätområde')
  if (!rowValue(row, 'contract_offer_id', 'contract_offer_name', 'campaign_name')) missing.push('avtal/kampanj')
  if (!rowValue(row, 'contract_start_date', 'expected_start_date', 'move_in_date', 'start_date')) missing.push('förväntat startdatum')
  if (!rowValue(row, 'authorization_status', 'power_of_attorney_status')) missing.push('fullmaktsstatus')

  return missing
}

function importRowUncertainFields(row: Record<string, string>): string[] {
  const uncertain: string[] = []

  if (row.personal_number && !isSwedishIdentityNumber(row.personal_number)) uncertain.push('personnummer')
  if (row.org_number && !isSwedishOrgNumber(row.org_number)) uncertain.push('organisationsnummer')
  if (row.email && !isEmail(row.email)) uncertain.push('e-post')
  if (row.phone && !isSwedishPhone(row.phone)) uncertain.push('telefon')
  if (row.postal_code && !isSwedishPostalCode(row.postal_code)) uncertain.push('postnummer')
  if (row.price_area_code && !['SE1', 'SE2', 'SE3', 'SE4'].includes(row.price_area_code.toUpperCase())) uncertain.push('elområde')

  return uncertain
}

function calculateImportConfidence(row: Record<string, string>, missingFields: string[], uncertainFields: string[], duplicateWarnings: string[]): number {
  let score = 100
  score -= missingFields.length * 10
  score -= uncertainFields.length * 8
  score -= duplicateWarnings.length * 20

  if (row.source_kind === 'pdf' || row.parser_source === 'pdf') score -= 8
  if (!rowValue(row, 'contract_offer_id', 'contract_offer_name', 'campaign_name')) score -= 8

  return Math.max(0, Math.min(100, score))
}

function classifyImportRow(params: {
  missingFields: string[]
  uncertainFields: string[]
  duplicateWarnings: string[]
  confidence: number
}): CustomerImportPreviewRowStatus {
  if (params.duplicateWarnings.length > 0) return 'duplicate_warning'
  if (params.missingFields.length > 0) return 'missing_fields'
  if (params.uncertainFields.length > 0 || params.confidence < 85) return 'requires_review'
  return 'ready_to_create'
}

function importRowWarnings(row: Record<string, string>): string[] {
  const warnings: string[] = []
  const customerType = normalizeCustomerType(row.customer_type || 'private')
  if (customerType === 'private' && (!row.first_name || !row.last_name)) {
    warnings.push('Privatkund bör ha för- och efternamn.')
  }
  if (customerType === 'private' && !row.personal_number) {
    warnings.push('Privatkund saknar personnummer.')
  }
  if (customerType !== 'private' && (!row.company_name || !row.org_number)) {
    warnings.push('Företagskund bör ha bolagsnamn och organisationsnummer.')
  }
  if (!row.email && !row.personal_number && !row.org_number) {
    warnings.push('Saknar tydlig unik kundnyckel för dubblettkontroll.')
  }
  if (row.personal_number && !isSwedishIdentityNumber(row.personal_number)) {
    warnings.push('Personnummer har ovanligt format.')
  }
  if (row.org_number && !isSwedishOrgNumber(row.org_number)) {
    warnings.push('Organisationsnummer har ovanligt format.')
  }
  if (row.phone && !isSwedishPhone(row.phone)) {
    warnings.push('Telefonnummer har ovanligt format.')
  }
  if (row.postal_code && !isSwedishPostalCode(row.postal_code)) {
    warnings.push('Postnummer har ovanligt format.')
  }
  if (!row.facility_id && !row.meter_point_id) {
    warnings.push('Anläggnings-id eller mätpunkts-id saknas.')
  }
  if (!row.grid_area_code && !row.grid_area_id) {
    warnings.push('Nätområde/områdes-id saknas.')
  }
  if (!row.authorization_status && !row.power_of_attorney_status) {
    warnings.push('Fullmaktsstatus saknas.')
  }
  if (!row.customer_confirmation_status && !row.customer_confirmation) {
    warnings.push('Kundbekräftelse saknas.')
  }
  return warnings
}

export async function previewCustomerImportAction(
  _prevState: CustomerImportActionState,
  formData: FormData
): Promise<CustomerImportActionState> {
  try {
    await requireAdminActionAccess({ anyOf: ['customers.write', 'masterdata.read'] })
    const actorUserId = await getActorUserId()
    const companyId = await requireOperationalCompanyId(actorUserId)
    const parsedImport = await parseCustomerImportFormData(formData)

    const duplicateKeys = parsedImport.rows
      .map((row) => normalizeLookupValue(importUniqueKey(row)))
      .filter(Boolean)
      .slice(0, 200)

    const existingKeys = new Set<string>()
    if (duplicateKeys.length > 0) {
      const { data: existingCustomers } = await supabaseService
        .from('customers')
        .select('email,personal_number,org_number')
        .eq('company_id', companyId)
        .or(
          duplicateKeys
            .flatMap((key) => [
              `email.ilike.${key}`,
              `personal_number.eq.${key}`,
              `org_number.eq.${key}`,
            ])
            .join(',')
        )

      for (const customer of existingCustomers ?? []) {
        for (const value of [customer.email, customer.personal_number, customer.org_number]) {
          if (value) existingKeys.add(normalizeLookupValue(String(value)))
        }
      }
    }

    const rows: CustomerImportPreviewRow[] = parsedImport.rows.slice(0, 50).map((row, index) => {
      const uniqueKey = importUniqueKey(row)
      const duplicateWarnings = uniqueKey && existingKeys.has(normalizeLookupValue(uniqueKey))
        ? ['Möjlig dubblett hittades i kundregistret.']
        : []
      const missingFields = importRowMissingFields(row)
      const uncertainFields = importRowUncertainFields(row)
      const warnings = [...importRowWarnings(row), ...duplicateWarnings]
      const confidence = calculateImportConfidence(row, missingFields, uncertainFields, duplicateWarnings)
      const status = classifyImportRow({ missingFields, uncertainFields, duplicateWarnings, confidence })

      return {
        rowNumber: index + 2,
        label: importPreviewLabel(row),
        uniqueKey,
        status,
        confidence,
        warnings,
        missingFields,
        uncertainFields,
        duplicateWarnings,
        payload: row,
      }
    })

    return {
      status: 'success',
      message: `Förhandsgranskning klar: ${parsedImport.rows.length} rader hittades. Kontrollera varningar innan import.`,
      totalRows: parsedImport.rows.length,
      createdRows: 0,
      failedRows: 0,
      reviewRows: rows.filter((row) => row.status !== 'ready_to_create').length,
      warnings: parsedImport.warnings,
      rows,
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Importunderlaget kunde inte förhandsgranskas.',
      totalRows: 0,
      createdRows: 0,
      failedRows: 0,
      reviewRows: 0,
      warnings: [],
      rows: [],
    }
  }
}

export async function commitCustomerImportAction(
  _prevState: CustomerImportActionState,
  formData: FormData
): Promise<CustomerImportActionState> {
  try {
    const result = await bulkCreateCustomersAction(formData)
    return {
      status: result.failedRows > 0 ? 'error' : 'success',
      message:
        result.reviewRows > 0 || result.failedRows > 0
          ? `Importen skapade ${result.createdRows} kunder. ${result.reviewRows} rader ligger i granskningskö och ${result.failedRows} rader misslyckades.`
          : `Importen slutfördes med ${result.createdRows} skapade kunder.`,
      totalRows: result.totalRows,
      createdRows: result.createdRows,
      failedRows: result.failedRows,
      reviewRows: result.reviewRows,
      warnings: result.warnings,
      rows: [],
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Importen kunde inte slutföras.',
      totalRows: 0,
      createdRows: 0,
      failedRows: 0,
      reviewRows: 0,
      warnings: [],
      rows: [],
    }
  }
}
