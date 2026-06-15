import { z } from 'zod'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { supabaseService } from '@/lib/supabase/service'
import { ensureCustomerNumber, reserveApplicationNumber, reserveContractNumber, reserveCustomerNumber } from '@/lib/customer-numbers/customerNumbers'
import { emitDomainEvent } from '@/lib/events/domainEvents'
import { seedDefaultEmailEventRules, triggerEmailEvent } from '@/lib/email/emailEvents'
import { seedDefaultEmailTemplates } from '@/lib/email/emailTemplates'
import { assessWebsiteApplicationReadiness, customerIntakeStatusForReadiness, type WebsiteApplicationReadiness } from '@/lib/website/applicationReview'
import { resolveEnergyContext } from '@/lib/energy/resolver'
import { ensureGridOwnerInformationRequest } from '@/lib/energy/gridOwnerRequests'
import { resolvePublicContractOffer, type PublicContractOffer } from '@/lib/website/publicContracts'
import type { EnergyResolverResult } from '@/lib/energy/types'
import {
  findFacilityConflicts,
  mapFacilityBusinessError,
  normalizeFacilityId,
  recordFacilityDataIssue,
  type FacilityBusinessErrorCode,
} from '@/lib/energy/facilityDataErrors'
import { getBaseAppUrl } from '@/lib/auth/urls'

const OPTIONAL_TEXT = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined),
  z.string().optional()
)

const CustomerSchema = z.object({
  customer_type: z.enum(['private', 'business']).default('private'),
  first_name: OPTIONAL_TEXT,
  last_name: OPTIONAL_TEXT,
  full_name: OPTIONAL_TEXT,
  company_name: OPTIONAL_TEXT,
  personal_number: OPTIONAL_TEXT,
  org_number: OPTIONAL_TEXT,
  email: OPTIONAL_TEXT,
  phone: OPTIONAL_TEXT,
  invoice_email: OPTIONAL_TEXT,
  billing_street: OPTIONAL_TEXT,
  billing_postal_code: OPTIONAL_TEXT,
  billing_city: OPTIONAL_TEXT,
  billing_country: OPTIONAL_TEXT,
}).default({})

const SiteSchema = z.object({
  facility_id: OPTIONAL_TEXT,
  site_name: OPTIONAL_TEXT,
  site_type: z.enum(['consumption', 'production', 'combined']).optional(),
  street: OPTIONAL_TEXT,
  postal_code: OPTIONAL_TEXT,
  city: OPTIONAL_TEXT,
  country: OPTIONAL_TEXT,
  price_area_code: OPTIONAL_TEXT,
  price_area: OPTIONAL_TEXT,
  grid_area_code: OPTIONAL_TEXT,
  gridAreaCode: OPTIONAL_TEXT,
  grid_owner_id: OPTIONAL_TEXT,
  gridOwnerId: OPTIONAL_TEXT,
  grid_owner_verification_status: OPTIONAL_TEXT,
  gridOwnerVerificationStatus: OPTIONAL_TEXT,
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  sweref99_x: z.coerce.number().optional(),
  sweref99_y: z.coerce.number().optional(),
  move_in_date: OPTIONAL_TEXT,
  annual_consumption_kwh: z.coerce.number().optional(),
}).optional()

const MeteringPointSchema = z.object({
  metering_point_id: OPTIONAL_TEXT,
  meter_point_id: OPTIONAL_TEXT,
  ediel_metering_point_id: OPTIONAL_TEXT,
  anlage_id: OPTIONAL_TEXT,
  site_facility_id: OPTIONAL_TEXT,
  reading_frequency: OPTIONAL_TEXT,
  measurement_type: OPTIONAL_TEXT,
  price_area_code: OPTIONAL_TEXT,
  price_area: OPTIONAL_TEXT,
  grid_area_code: OPTIONAL_TEXT,
  gridAreaCode: OPTIONAL_TEXT,
  start_date: OPTIONAL_TEXT,
  installation_date: OPTIONAL_TEXT,
  estimated_annual_consumption_kwh: z.coerce.number().optional(),
}).optional()

const ContractSchema = z.object({
  contract_name: OPTIONAL_TEXT,
  contract_type: OPTIONAL_TEXT,
  contract_number: OPTIONAL_TEXT,
  price_plan_id: OPTIONAL_TEXT,
  price_plan_version_id: OPTIONAL_TEXT,
  contract_offer_id: OPTIONAL_TEXT,
  product_code: OPTIONAL_TEXT,
  starts_at: OPTIONAL_TEXT,
  expected_start_at: OPTIONAL_TEXT,
  requested_start_date: OPTIONAL_TEXT,
  requestedStartDate: OPTIONAL_TEXT,
  confirmed_start_date: OPTIONAL_TEXT,
  confirmedStartDate: OPTIONAL_TEXT,
  actual_start_date: OPTIONAL_TEXT,
  actualStartDate: OPTIONAL_TEXT,
  requested_start_mode: OPTIONAL_TEXT,
  requestedStartMode: OPTIONAL_TEXT,
  calculated_earliest_start_date: OPTIONAL_TEXT,
  calculatedEarliestStartDate: OPTIONAL_TEXT,
  signed_at: OPTIONAL_TEXT,
  monthly_fee_sek: z.coerce.number().optional(),
  invoice_fee_sek: z.coerce.number().optional(),
  markup_ore_per_kwh: z.coerce.number().optional(),
  spot_markup_ore_per_kwh: z.coerce.number().optional(),
  variable_fee_ore_per_kwh: z.coerce.number().optional(),
  fixed_price_ore_per_kwh: z.coerce.number().optional(),
  green_fee_mode: OPTIONAL_TEXT,
  green_fee_value: z.coerce.number().optional(),
  binding_months: z.coerce.number().int().optional(),
  notice_months: z.coerce.number().int().optional(),
  campaign_code: OPTIONAL_TEXT,
  price_version: OPTIONAL_TEXT,
  terms_version: OPTIONAL_TEXT,
}).optional()

const ApplicationSchema = z.object({
  external_customer_id: OPTIONAL_TEXT,
  customer_external_id: OPTIONAL_TEXT,
  external_account_id: OPTIONAL_TEXT,
  source: OPTIONAL_TEXT,
  grid_owner_id: OPTIONAL_TEXT,
  network_owner_id: OPTIONAL_TEXT,
  electricity_supplier_id: OPTIONAL_TEXT,
  price_plan_id: OPTIONAL_TEXT,
  price_plan_version_id: OPTIONAL_TEXT,
  contract_offer_id: OPTIONAL_TEXT,
  product_code: OPTIONAL_TEXT,
  requested_start_date: OPTIONAL_TEXT,
  confirmed_start_date: OPTIONAL_TEXT,
  actual_start_date: OPTIONAL_TEXT,
  requested_start_mode: OPTIONAL_TEXT,
  requestedStartMode: OPTIONAL_TEXT,
  calculated_earliest_start_date: OPTIONAL_TEXT,
  calculatedEarliestStartDate: OPTIONAL_TEXT,
  grid_area_code: OPTIONAL_TEXT,
  gridAreaCode: OPTIONAL_TEXT,
  price_area_code: OPTIONAL_TEXT,
  priceAreaCode: OPTIONAL_TEXT,
  resolution_status: OPTIONAL_TEXT,
  resolutionStatus: OPTIONAL_TEXT,
  grid_owner_verification_status: OPTIONAL_TEXT,
  gridOwnerVerificationStatus: OPTIONAL_TEXT,
  customer: CustomerSchema,
  site: SiteSchema,
  metering_point: MeteringPointSchema,
  contract: ContractSchema,
  consents: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
})

type ApplicationInput = z.infer<typeof ApplicationSchema>


type WebsiteLegalAcceptanceVersion = {
  id: string
  type: string
  version: string
  title: string
  body: string | null
  published_at: string | null
}

const REQUIRED_WEBSITE_LEGAL_ACCEPTANCES: Array<{
  legalType: string
  acceptanceType: string
  field: string
  aliases: string[]
  label: string
}> = [
  { legalType: 'terms', acceptanceType: 'terms', field: 'consents.terms', aliases: ['terms', 'terms_accepted', 'accept_terms', 'accepted_terms'], label: 'allmänna villkor' },
  { legalType: 'privacy_policy', acceptanceType: 'privacy_policy', field: 'consents.privacy_policy', aliases: ['privacy_policy', 'privacy_policy_accepted', 'privacy_accepted', 'gdpr_accepted'], label: 'integritetspolicy' },
  { legalType: 'withdrawal', acceptanceType: 'withdrawal_info', field: 'consents.withdrawal', aliases: ['withdrawal', 'withdrawal_info', 'withdrawal_accepted', 'cooling_off_accepted'], label: 'ångerrättsinformation' },
  { legalType: 'power_of_attorney', acceptanceType: 'power_of_attorney', field: 'consents.power_of_attorney', aliases: ['power_of_attorney', 'poa_accepted', 'power_of_attorney_accepted'], label: 'fullmakt' },
  { legalType: 'price_terms', acceptanceType: 'price_snapshot', field: 'consents.price_terms', aliases: ['price_terms', 'price_snapshot', 'price_terms_accepted', 'price_snapshot_accepted'], label: 'prisvillkor/prisbild' },
]

function consentAccepted(consents: Record<string, unknown> | undefined, aliases: string[]): boolean {
  if (!consents) return false
  return aliases.some((alias) => {
    const value = consents[alias]
    return value === true || value === 'true' || value === 1 || value === '1' || value === 'yes' || value === 'accepted'
  })
}

async function listPublishedWebsiteLegalVersions(companyId: string): Promise<WebsiteLegalAcceptanceVersion[] | null> {
  const { data, error } = await supabaseService
    .from('legal_text_versions')
    .select('id,type,version,title,body,published_at')
    .eq('company_id', companyId)
    .eq('status', 'published')
    .in('type', REQUIRED_WEBSITE_LEGAL_ACCEPTANCES.map((item) => item.legalType))

  if (error) {
    if (missingSchema(error)) return null
    throw error
  }

  return (data ?? []) as WebsiteLegalAcceptanceVersion[]
}

async function assertWebsiteLegalAcceptances(input: {
  companyId: string
  consents?: Record<string, unknown>
  publicOffer: PublicContractOffer
}): Promise<WebsiteLegalAcceptanceVersion[]> {
  const versions = await listPublishedWebsiteLegalVersions(input.companyId)
  if (versions === null) return []

  const byType = new Map(versions.map((row) => [row.type, row]))
  const missingVersions = REQUIRED_WEBSITE_LEGAL_ACCEPTANCES.filter((item) => !byType.has(item.legalType))
  if (missingVersions.length > 0) {
    throw new WebsiteApplicationError({
      message: `Hemsidan kan inte ta emot avtal eftersom OPS saknar publicerad juridisk version för: ${missingVersions.map((item) => item.label).join(', ')}.`,
      status: 422,
      code: 'legal_versions_missing',
      field: 'legal_text_versions',
      stage: 'legal_acceptance',
      hint: 'Publicera allmänna villkor, integritetspolicy, ångerrätt, fullmakt och prisvillkor i tenantens bolagskort i OPS.',
    })
  }

  const missingConsents = REQUIRED_WEBSITE_LEGAL_ACCEPTANCES.filter((item) => !consentAccepted(input.consents, item.aliases))
  if (missingConsents.length > 0) {
    throw new WebsiteApplicationError({
      message: `Kunden måste godkänna ${missingConsents.map((item) => item.label).join(', ')} innan ansökan kan skickas.`,
      status: 422,
      code: 'legal_acceptance_missing',
      field: missingConsents[0]?.field ?? 'consents',
      stage: 'legal_acceptance',
      hint: 'Skicka separata consent-flaggor för villkor, integritet, ångerrätt, fullmakt och prisvillkor.',
    })
  }

  return REQUIRED_WEBSITE_LEGAL_ACCEPTANCES.map((item) => byType.get(item.legalType)).filter((row): row is WebsiteLegalAcceptanceVersion => Boolean(row))
}

async function persistCustomerLegalAcceptances(input: {
  companyId: string
  customerId: string
  contractId: string | null
  applicationId: string
  publicOffer: PublicContractOffer | null
  legalVersions: WebsiteLegalAcceptanceVersion[]
  consents?: Record<string, unknown>
  rawPayload: unknown
}) {
  if (input.legalVersions.length === 0) return
  const now = new Date().toISOString()
  const rows = REQUIRED_WEBSITE_LEGAL_ACCEPTANCES.map((definition) => {
    const legal = input.legalVersions.find((row) => row.type === definition.legalType)
    if (!legal) return null
    return {
      company_id: input.companyId,
      customer_id: input.customerId,
      contract_id: input.contractId,
      contract_application_id: input.applicationId,
      acceptance_type: definition.acceptanceType,
      legal_text_version_id: legal.id,
      accepted_at: now,
      source: 'website',
      snapshot: {
        legal_text: {
          id: legal.id,
          type: legal.type,
          version: legal.version,
          title: legal.title,
          body: legal.body,
          published_at: legal.published_at,
        },
        public_offer: input.publicOffer,
        consent_key: definition.field,
        consents: input.consents ?? {},
      },
      metadata: {
        source: 'website_customer_applications',
        application_id: input.applicationId,
        raw_payload: input.rawPayload,
      },
    }
  }).filter(Boolean)

  const { error } = await supabaseService.from('customer_legal_acceptances').insert(rows)
  if (error && !missingSchema(error)) throw error
}

type CustomerRow = {
  id: string
  customer_number: string | null
  email: string | null
  full_name: string | null
  company_name: string | null
}

type ErrorStage =
  | 'validation'
  | 'idempotency'
  | 'customer_lookup'
  | 'customer_create'
  | 'customer_number_create'
  | 'portal_identity_create'
  | 'site_create'
  | 'metering_point_create'
  | 'contract_create'
  | 'contract_snapshot_create'
  | 'public_contract_lookup'
  | 'legal_acceptance'
  | 'application_record_create'
  | 'communication_trigger'
  | 'domain_event_create'
  | 'webhook_queue'
  | 'customer_intake_update'
  | 'energy_resolution'
  | 'grid_owner_information_request'
  | 'manual_review'

class WebsiteApplicationError extends Error {
  status: number
  code: string
  field?: string
  hint?: string
  stage: ErrorStage
  details?: unknown

  constructor(input: {
    message: string
    status?: number
    code?: string
    field?: string
    hint?: string
    stage?: ErrorStage
    details?: unknown
  }) {
    super(input.message)
    this.name = 'WebsiteApplicationError'
    this.status = input.status ?? 500
    this.code = input.code ?? 'website_application_error'
    this.field = input.field
    this.hint = input.hint
    this.stage = input.stage ?? 'validation'
    this.details = input.details
  }
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizedEmail(value: unknown): string | null {
  return clean(value)?.toLowerCase() ?? null
}

function digits(value: unknown): string | null {
  const output = clean(value)?.replace(/\D/g, '') ?? ''
  return output || null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    const parts = [record.message, record.details, record.hint, record.code]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    if (parts.length > 0) return parts.join(' · ')
  }
  return 'Kundansökan kunde inte behandlas.'
}

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function omitKeys<T extends Record<string, unknown>>(payload: T, keys: string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...payload }
  for (const key of keys) delete copy[key]
  return copy
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
  contract_number?: string | null
  price_plan_id?: string | null
  price_plan_version_id?: string | null
  confirmed_start_date?: string | null
  actual_start_date?: string | null
}

function matchesExpectedValue(actual: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected) return true
  return actual === expected
}

function matchesExpectedDate(actual: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected) return true
  return Boolean(actual && String(actual).slice(0, 10) === String(expected).slice(0, 10))
}

async function findExistingWebsiteApplicationContract(input: {
  companyId: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  requestedStartDate?: string | null
  contractName?: string | null
}): Promise<WebsiteContractRow | null> {
  const { data, error } = await supabaseService
    .from('customer_contracts')
    .select('id,contract_name,starts_at,status,site_id,customer_site_id,metering_point_id,requested_start_date,contract_number,price_plan_id,price_plan_version_id,confirmed_start_date,actual_start_date')
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

function reviewAuditEvent(action: string, oldValues: Record<string, unknown> | null, newValues: Record<string, unknown>, actor: string | null = null) {
  return {
    action,
    actor_user_id: actor,
    old_values: oldValues ?? {},
    new_values: newValues,
    created_at: new Date().toISOString(),
  }
}

async function updateCustomerIntakeStatus(companyId: string, customerId: string, readiness: WebsiteApplicationReadiness) {
  const { error } = await supabaseService
    .from('customers')
    .update({
      intake_status: customerIntakeStatusForReadiness(readiness),
      intake_missing_fields: readiness.missingFields,
      intake_quality_score: readiness.qualityScore,
      intake_warnings: readiness.warnings,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
    .eq('id', customerId)

  if (error && !missingSchema(error)) throw error
}


function addBusinessDays(date: Date, days: number): Date {
  const output = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  let remaining = days
  while (remaining > 0) {
    output.setUTCDate(output.getUTCDate() + 1)
    const day = output.getUTCDay()
    if (day !== 0 && day !== 6) remaining -= 1
  }
  return output
}

function calculatedEarliestStartDate(): string {
  // MVP-policy: produktion räknar datum server-side, inte i UI. Detta kan senare ersättas med tenant-/nätägarregler.
  return addBusinessDays(new Date(), 14).toISOString().slice(0, 10)
}

function requestedStartModeFromInput(input: ApplicationInput): 'earliest_possible' | 'specific_date' {
  const raw = clean(input.requested_start_mode) ?? clean(input.requestedStartMode) ?? clean(input.contract?.requested_start_mode) ?? clean(input.contract?.requestedStartMode)
  return raw === 'specific_date' ? 'specific_date' : 'earliest_possible'
}

function enrichApplicationWithEnergyResolution(input: ApplicationInput, resolution: EnergyResolverResult): ApplicationInput {
  const requestedStartMode = requestedStartModeFromInput(input)
  const calculatedStart = requestedStartMode === 'earliest_possible'
    ? clean(input.calculated_earliest_start_date) ?? clean(input.calculatedEarliestStartDate) ?? clean(input.contract?.calculated_earliest_start_date) ?? clean(input.contract?.calculatedEarliestStartDate) ?? calculatedEarliestStartDate()
    : undefined
  return {
    ...input,
    grid_owner_id: resolution.gridOwnerId ?? input.grid_owner_id ?? input.network_owner_id,
    grid_area_code: resolution.gridAreaCode ?? input.grid_area_code ?? input.gridAreaCode,
    price_area_code: resolution.priceArea ?? input.price_area_code ?? input.priceAreaCode,
    resolution_status: resolution.resolutionStatus,
    grid_owner_verification_status: resolution.gridOwnerVerificationStatus ?? undefined,
    requested_start_mode: requestedStartMode,
    calculated_earliest_start_date: calculatedStart,
    site: input.site ? {
      ...input.site,
      grid_area_code: resolution.gridAreaCode ?? input.site.grid_area_code ?? input.site.gridAreaCode,
      grid_owner_id: resolution.gridOwnerId ?? input.site.grid_owner_id ?? input.site.gridOwnerId,
      grid_owner_verification_status: resolution.gridOwnerVerificationStatus ?? undefined,
      price_area_code: resolution.priceArea ?? input.site.price_area_code ?? input.site.price_area,
      latitude: resolution.coordinates?.latitude ?? input.site.latitude,
      longitude: resolution.coordinates?.longitude ?? input.site.longitude,
      sweref99_x: resolution.coordinates?.sweref99X ?? input.site.sweref99_x,
      sweref99_y: resolution.coordinates?.sweref99Y ?? input.site.sweref99_y,
    } : input.site,
    metering_point: input.metering_point ? {
      ...input.metering_point,
      grid_area_code: resolution.gridAreaCode ?? input.metering_point.grid_area_code ?? input.metering_point.gridAreaCode,
      price_area_code: resolution.priceArea ?? input.metering_point.price_area_code ?? input.metering_point.price_area,
    } : input.metering_point,
    contract: input.contract ? {
      ...input.contract,
      requested_start_mode: requestedStartMode,
      calculated_earliest_start_date: calculatedStart,
    } : input.contract,
    metadata: {
      ...(input.metadata ?? {}),
      energy_resolution: resolution,
    },
  }
}

async function runEnergyResolution(input: {
  companyId: string
  customerId: string
  customerSiteId?: string | null
  customerApplicationId?: string | null
  body: ApplicationInput
}): Promise<{ body: ApplicationInput; resolution: EnergyResolverResult }> {
  const body = input.body
  const resolution = await resolveEnergyContext({
    companyId: input.companyId,
    customerId: input.customerId,
    customerSiteId: input.customerSiteId,
    customerApplicationId: input.customerApplicationId,
    street: clean(body.site?.street) ?? clean(body.customer.billing_street),
    postalCode: clean(body.site?.postal_code) ?? clean(body.customer.billing_postal_code),
    city: clean(body.site?.city) ?? clean(body.customer.billing_city),
    country: clean(body.site?.country) ?? clean(body.customer.billing_country) ?? 'SE',
    gridAreaCode: clean(body.grid_area_code) ?? clean(body.gridAreaCode) ?? clean(body.site?.grid_area_code) ?? clean(body.site?.gridAreaCode),
    facilityId: clean(body.site?.facility_id),
    meteringPointId: clean(body.metering_point?.metering_point_id) ?? clean(body.metering_point?.meter_point_id) ?? clean(body.metering_point?.ediel_metering_point_id) ?? clean(body.metering_point?.anlage_id),
    requestedStartMode: requestedStartModeFromInput(body),
    requestedStartDate: clean(body.requested_start_date) ?? clean(body.contract?.requested_start_date) ?? clean(body.contract?.starts_at),
    metadata: body.metadata ?? {},
  })
  return { body: enrichApplicationWithEnergyResolution(body, resolution), resolution }
}


function operationalErrorMessage(error: unknown): string {
  const message = error instanceof WebsiteApplicationError ? error.message : errorMessage(error)
  if (/customers_intake_status_check/i.test(message)) {
    return 'Kundens intagsstatus stöds inte av databasen. Kör senaste kundansökningsmigration och försök igen.'
  }
  if (/customer_contracts_status_check/i.test(message)) {
    return 'Avtal kunde inte skapas eftersom kundavtalets status inte stöds av databasen. Koden ska använda draft/pending_signature och senaste avtalsmigration måste vara körd.'
  }
  if (/customer_contracts_source_type_check/i.test(message)) {
    return 'Avtal kunde inte skapas eftersom kundavtalets source_type inte stöds av databasen. Kör senaste avtalsmigration och kontrollera ansökan igen.'
  }
  if (/customer_contracts.*metadata|metadata.*customer_contracts|PGRST204/i.test(message)) {
    return 'Kundavtalets schema saknar en kolumn som koden behöver. Kör senaste migration och uppdatera schema cache.'
  }
  if (/metering_point_create/i.test(message)) {
    return 'Mätpunktsflödet stoppades. Ansökan behöver ligga kvar i arbetskön tills anläggningsuppgifter är kompletta.'
  }
  if (/violates check constraint/i.test(message)) {
    return 'Databasen stoppade åtgärden på grund av en constraint. Kör senaste migration eller kontakta teknisk admin.'
  }
  if (message.length > 360) return `${message.slice(0, 360)}…`
  return message
}

function technicalBlockingReason(error: WebsiteApplicationError) {
  return {
    field: 'system',
    label: 'Tekniskt fel kräver åtgärd',
    severity: 'blocking' as const,
    message: operationalErrorMessage(error),
    action: 'Kör senaste migration/schema-fix och kontrollera ansökan igen.',
  }
}

const CONTROLLED_BUSINESS_ERROR_CODES = new Set<string>([
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
  'timeout',
])

function isControlledBusinessError(error: WebsiteApplicationError): boolean {
  return CONTROLLED_BUSINESS_ERROR_CODES.has(error.code)
}

function controlledBusinessErrorCode(error: WebsiteApplicationError): FacilityBusinessErrorCode {
  if (CONTROLLED_BUSINESS_ERROR_CODES.has(error.code)) return error.code as FacilityBusinessErrorCode
  return 'needs_customer_correction'
}

function controlledBusinessStatus(error: WebsiteApplicationError): string {
  return mapFacilityBusinessError(controlledBusinessErrorCode(error)).status
}

function controlledBusinessNextStep(error: WebsiteApplicationError): string {
  return mapFacilityBusinessError(controlledBusinessErrorCode(error)).recommendedAction
}

function controlledBusinessBlockingReason(error: WebsiteApplicationError) {
  const mapped = mapFacilityBusinessError(controlledBusinessErrorCode(error), { message: operationalErrorMessage(error) })
  return {
    field: mapped.issueType,
    label: mapped.title,
    severity: 'blocking' as const,
    message: mapped.message,
    action: mapped.recommendedAction,
  }
}

function validationError(message: string, field: string, hint?: string) {
  return new WebsiteApplicationError({
    message,
    status: 422,
    code: 'validation_error',
    field,
    hint,
    stage: 'validation',
  })
}

async function stage<T>(stageName: ErrorStage, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof WebsiteApplicationError) throw error
    throw new WebsiteApplicationError({
      message: errorMessage(error),
      status: 500,
      code: 'internal_error',
      stage: stageName,
      details: { raw_error: errorMessage(error) },
    })
  }
}

function firstClean(...values: unknown[]): string | undefined {
  for (const value of values) {
    const cleaned = clean(value)
    if (cleaned) return cleaned
  }
  return undefined
}

function firstDefined<T>(...values: Array<T | undefined | null>): T | undefined {
  for (const value of values) {
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

function normalizedSiteType(value: unknown): 'consumption' | 'production' | 'combined' | undefined {
  const cleaned = clean(value)?.toLowerCase()
  if (cleaned === 'consumption' || cleaned === 'production' || cleaned === 'combined') return cleaned
  return undefined
}

function hasAnyCleanValue(record: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => clean(record[key]))
}

function normalizeRawApplication(rawBody: unknown): Record<string, unknown> {
  const raw = isObject(rawBody) ? { ...rawBody } : {}
  const rawCustomer = isObject(raw.customer) ? { ...raw.customer } : {}
  const rawAddress = isObject(raw.address) ? raw.address : {}
  const rawSource = raw.source
  const nestedSite = isObject(raw.site) ? { ...raw.site } : null
  const nestedMeteringPoint = isObject(raw.metering_point) ? { ...raw.metering_point } : null
  const nestedContract = isObject(raw.contract) ? { ...raw.contract } : null

  const customer = {
    customer_type: raw.customer_type ?? rawCustomer.customer_type ?? 'private',
    first_name: raw.first_name ?? raw.firstName ?? rawCustomer.first_name ?? rawCustomer.firstName,
    last_name: raw.last_name ?? raw.lastName ?? rawCustomer.last_name ?? rawCustomer.lastName,
    full_name: raw.name ?? raw.full_name ?? raw.fullName ?? rawCustomer.full_name ?? rawCustomer.fullName ?? rawCustomer.name,
    company_name: raw.company_name ?? raw.companyName ?? rawCustomer.company_name ?? rawCustomer.companyName,
    personal_number: raw.personal_number ?? raw.personalNumber ?? rawCustomer.personal_number ?? rawCustomer.personalNumber,
    org_number: raw.org_number ?? raw.orgNumber ?? rawCustomer.org_number ?? rawCustomer.orgNumber,
    email: raw.email ?? rawCustomer.email,
    phone: raw.phone ?? rawCustomer.phone,
    invoice_email: raw.invoice_email ?? raw.invoiceEmail ?? rawCustomer.invoice_email ?? rawCustomer.invoiceEmail,
    billing_street: raw.billing_street ?? raw.billingStreet ?? rawCustomer.billing_street ?? rawCustomer.billingStreet ?? rawAddress.street,
    billing_postal_code: raw.billing_postal_code ?? raw.billingPostalCode ?? rawCustomer.billing_postal_code ?? rawCustomer.billingPostalCode ?? rawAddress.postal_code,
    billing_city: raw.billing_city ?? raw.billingCity ?? rawCustomer.billing_city ?? rawCustomer.billingCity ?? rawAddress.city,
    billing_country: raw.billing_country ?? raw.billingCountry ?? rawCustomer.billing_country ?? rawCustomer.billingCountry ?? rawAddress.country,
  }

  const topLevelMeteringPointId = firstClean(
    raw.metering_point_id,
    raw.meteringPointId,
    raw.meter_point_id,
    raw.meterPointId,
    raw.ediel_metering_point_id,
    raw.edielMeteringPointId,
    raw.anlage_id,
    raw.anlaggningId,
    raw.facility_metering_point_id
  )
  const topLevelFacilityId = firstClean(
    raw.facility_id,
    raw.facilityId,
    raw.site_facility_id,
    raw.siteFacilityId,
    raw.anlage_id,
    raw.anlaggningId,
    raw.customer_site_id,
    topLevelMeteringPointId
  )
  const hasTopLevelSite = Boolean(
    nestedSite ||
    topLevelFacilityId ||
    hasAnyCleanValue(raw, [
      'site_name',
      'site_type',
      'street',
      'address_line1',
      'addressLine1',
      'address',
      'street_address',
      'streetAddress',
      'postal_code',
      'postalCode',
      'zip',
      'city',
      'country',
      'price_area_code',
      'priceAreaCode',
      'price_area',
      'priceArea',
      'move_in_date',
      'moveInDate',
    ]) ||
    firstDefined(raw.annual_consumption_kwh, raw.annualConsumptionKwh, raw.estimated_annual_consumption_kwh, raw.estimatedAnnualConsumptionKwh) !== undefined
  )

  const site = hasTopLevelSite
    ? {
        ...(nestedSite ?? {}),
        facility_id: firstDefined(nestedSite?.facility_id, nestedSite?.facilityId, raw.facility_id, raw.facilityId, raw.site_facility_id, raw.siteFacilityId, raw.anlage_id, raw.anlaggningId, topLevelFacilityId),
        site_name: firstDefined(nestedSite?.site_name, nestedSite?.siteName, raw.site_name, raw.siteName),
        site_type: normalizedSiteType(firstDefined(nestedSite?.site_type, nestedSite?.siteType, raw.site_type, raw.siteType)),
        street: firstDefined(nestedSite?.street, nestedSite?.address, raw.street, raw.address_line1, raw.addressLine1, raw.address, raw.street_address, raw.streetAddress, rawAddress.street),
        postal_code: firstDefined(nestedSite?.postal_code, nestedSite?.postalCode, raw.postal_code, raw.postalCode, raw.zip, rawAddress.postal_code),
        city: firstDefined(nestedSite?.city, raw.city, rawAddress.city),
        country: firstDefined(nestedSite?.country, raw.country, rawAddress.country),
        price_area_code: firstDefined(nestedSite?.price_area_code, nestedSite?.priceAreaCode, nestedSite?.price_area, nestedSite?.priceArea, raw.price_area_code, raw.priceAreaCode, raw.price_area, raw.priceArea),
        move_in_date: firstDefined(nestedSite?.move_in_date, nestedSite?.moveInDate, raw.move_in_date, raw.moveInDate, raw.start_date, raw.startDate),
        annual_consumption_kwh: firstDefined(
          nestedSite?.annual_consumption_kwh,
          nestedSite?.annualConsumptionKwh,
          raw.annual_consumption_kwh,
          raw.annualConsumptionKwh,
          raw.estimated_annual_consumption_kwh,
          raw.estimatedAnnualConsumptionKwh
        ),
      }
    : undefined

  const hasTopLevelMeteringPoint = Boolean(
    nestedMeteringPoint ||
    topLevelMeteringPointId ||
    hasAnyCleanValue(raw, [
      'reading_frequency',
      'measurement_type',
      'start_date',
      'startDate',
      'installation_date',
      'installationDate',
    ]) ||
    firstDefined(raw.estimated_annual_consumption_kwh, raw.estimatedAnnualConsumptionKwh, raw.annual_consumption_kwh, raw.annualConsumptionKwh) !== undefined
  )

  const meteringPoint = hasTopLevelMeteringPoint
    ? {
        ...(nestedMeteringPoint ?? {}),
        metering_point_id: firstDefined(nestedMeteringPoint?.metering_point_id, nestedMeteringPoint?.meteringPointId, raw.metering_point_id, raw.meteringPointId, topLevelMeteringPointId),
        meter_point_id: firstDefined(nestedMeteringPoint?.meter_point_id, nestedMeteringPoint?.meterPointId, raw.meter_point_id, raw.meterPointId, topLevelMeteringPointId),
        ediel_metering_point_id: firstDefined(nestedMeteringPoint?.ediel_metering_point_id, nestedMeteringPoint?.edielMeteringPointId, raw.ediel_metering_point_id, raw.edielMeteringPointId, topLevelMeteringPointId),
        anlage_id: firstDefined(nestedMeteringPoint?.anlage_id, nestedMeteringPoint?.anlaggningId, raw.anlage_id, raw.anlaggningId, site?.facility_id, topLevelFacilityId),
        site_facility_id: firstDefined(nestedMeteringPoint?.site_facility_id, nestedMeteringPoint?.siteFacilityId, raw.site_facility_id, raw.siteFacilityId, site?.facility_id, topLevelFacilityId),
        reading_frequency: firstDefined(nestedMeteringPoint?.reading_frequency, raw.reading_frequency),
        measurement_type: firstDefined(nestedMeteringPoint?.measurement_type, raw.measurement_type),
        price_area_code: firstDefined(
          nestedMeteringPoint?.price_area_code,
          nestedMeteringPoint?.price_area,
          raw.price_area_code,
          raw.price_area,
          site?.price_area_code
        ),
        start_date: firstDefined(nestedMeteringPoint?.start_date, nestedMeteringPoint?.startDate, raw.start_date, raw.startDate, site?.move_in_date),
        installation_date: firstDefined(nestedMeteringPoint?.installation_date, nestedMeteringPoint?.installationDate, raw.installation_date, raw.installationDate, raw.start_date, raw.startDate, site?.move_in_date),
        estimated_annual_consumption_kwh: firstDefined(
          nestedMeteringPoint?.estimated_annual_consumption_kwh,
          nestedMeteringPoint?.estimatedAnnualConsumptionKwh,
          raw.estimated_annual_consumption_kwh,
          raw.estimatedAnnualConsumptionKwh,
          raw.annual_consumption_kwh,
          raw.annualConsumptionKwh,
          site?.annual_consumption_kwh
        ),
      }
    : undefined


  const contract = {
    ...(nestedContract ?? {}),
    contract_name: firstDefined(nestedContract?.contract_name, nestedContract?.contractName, raw.contract_name, raw.contractName, raw.product_name, raw.productName),
    contract_type: firstDefined(nestedContract?.contract_type, nestedContract?.contractType, raw.contract_type, raw.contractType),
    contract_number: firstDefined(nestedContract?.contract_number, nestedContract?.contractNumber, raw.contract_number, raw.contractNumber),
    price_plan_id: firstDefined(nestedContract?.price_plan_id, nestedContract?.pricePlanId, raw.price_plan_id, raw.pricePlanId),
    price_plan_version_id: firstDefined(nestedContract?.price_plan_version_id, nestedContract?.pricePlanVersionId, raw.price_plan_version_id, raw.pricePlanVersionId),
    contract_offer_id: firstDefined(nestedContract?.contract_offer_id, nestedContract?.contractOfferId, raw.contract_offer_id, raw.contractOfferId),
    product_code: firstDefined(nestedContract?.product_code, nestedContract?.productCode, raw.product_code, raw.productCode),
    starts_at: firstDefined(nestedContract?.starts_at, nestedContract?.startsAt, raw.starts_at, raw.startsAt, raw.start_date, raw.startDate),
    requested_start_date: firstDefined(nestedContract?.requested_start_date, nestedContract?.requestedStartDate, raw.requested_start_date, raw.requestedStartDate, raw.start_date, raw.startDate),
    requested_start_mode: firstDefined(nestedContract?.requested_start_mode, nestedContract?.requestedStartMode, raw.requested_start_mode, raw.requestedStartMode),
    calculated_earliest_start_date: firstDefined(nestedContract?.calculated_earliest_start_date, nestedContract?.calculatedEarliestStartDate, raw.calculated_earliest_start_date, raw.calculatedEarliestStartDate),
    monthly_fee_sek: firstDefined(nestedContract?.monthly_fee_sek, nestedContract?.monthlyFeeSek, raw.monthly_fee_sek, raw.monthlyFeeSek),
    invoice_fee_sek: firstDefined(nestedContract?.invoice_fee_sek, nestedContract?.invoiceFeeSek, raw.invoice_fee_sek, raw.invoiceFeeSek),
    markup_ore_per_kwh: firstDefined(nestedContract?.markup_ore_per_kwh, nestedContract?.markupOrePerKwh, raw.markup_ore_per_kwh, raw.markupOrePerKwh),
    spot_markup_ore_per_kwh: firstDefined(nestedContract?.spot_markup_ore_per_kwh, nestedContract?.spotMarkupOrePerKwh, raw.spot_markup_ore_per_kwh, raw.spotMarkupOrePerKwh),
    variable_fee_ore_per_kwh: firstDefined(nestedContract?.variable_fee_ore_per_kwh, nestedContract?.variableFeeOrePerKwh, raw.variable_fee_ore_per_kwh, raw.variableFeeOrePerKwh),
    fixed_price_ore_per_kwh: firstDefined(nestedContract?.fixed_price_ore_per_kwh, nestedContract?.fixedPriceOrePerKwh, raw.fixed_price_ore_per_kwh, raw.fixedPriceOrePerKwh),
    green_fee_mode: firstDefined(nestedContract?.green_fee_mode, nestedContract?.greenFeeMode, raw.green_fee_mode, raw.greenFeeMode),
    green_fee_value: firstDefined(nestedContract?.green_fee_value, nestedContract?.greenFeeValue, raw.green_fee_value, raw.greenFeeValue),
    binding_months: firstDefined(nestedContract?.binding_months, nestedContract?.bindingMonths, raw.binding_months, raw.bindingMonths),
    notice_months: firstDefined(nestedContract?.notice_months, nestedContract?.noticeMonths, raw.notice_months, raw.noticeMonths),
    campaign_code: firstDefined(nestedContract?.campaign_code, nestedContract?.campaignCode, raw.campaign_code, raw.campaignCode),
    terms_version: firstDefined(nestedContract?.terms_version, nestedContract?.termsVersion, raw.terms_version, raw.termsVersion),
  }

  const source = typeof rawSource === 'string'
    ? rawSource
    : isObject(rawSource)
      ? clean(rawSource.website) ?? clean(rawSource.channel) ?? 'external_website'
      : clean(raw.website) ?? clean(raw.channel) ?? 'external_website'

  return {
    ...raw,
    source,
    external_customer_id: raw.external_customer_id ?? raw.customer_external_id ?? raw.externalCustomerId,
    customer_external_id: raw.customer_external_id ?? raw.external_customer_id ?? raw.externalCustomerId,
    customer,
    site,
    metering_point: meteringPoint,
    contract,
    metadata: {
      ...(isObject(raw.metadata) ? raw.metadata : {}),
      original_payload_shape: isObject(raw.customer) || nestedSite || nestedMeteringPoint || nestedContract ? 'nested' : 'simplified',
      simple_payload_normalized: Boolean(!nestedSite && site) || Boolean(!nestedMeteringPoint && meteringPoint),
      raw_source: isObject(rawSource) ? rawSource : undefined,
    },
  }
}

function fullName(customer: ApplicationInput['customer']): string | null {
  const combined = [clean(customer.first_name), clean(customer.last_name)].filter(Boolean).join(' ')
  return clean(customer.full_name) ?? (combined || null) ?? clean(customer.company_name)
}

function eventVariables(input: {
  companyName: string
  customer: CustomerRow
  rawCustomer?: ApplicationInput['customer'] | null
  customerNumber: string
  siteId?: string | null
  facilityId?: string | null
  meteringPointId?: string | null
  contractName?: string | null
  startDate?: string | null
  supportEmail?: string | null
  portalUrl?: string | null
}) {
  const cancellationDeadline = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
  const rawFirstName = clean(input.rawCustomer?.first_name)
  const rawLastName = clean(input.rawCustomer?.last_name)
  const rawFullName = input.rawCustomer ? fullName(input.rawCustomer) : null
  const customerName = input.customer.full_name
    ?? input.customer.company_name
    ?? rawFullName
    ?? input.customer.email
    ?? input.customerNumber

  return {
    customer_name: customerName,
    first_name: rawFirstName ?? customerName,
    last_name: rawLastName ?? '',
    customer_email: input.customer.email ?? clean(input.rawCustomer?.email) ?? '',
    customer_phone: clean(input.rawCustomer?.phone) ?? '',
    customer_number: input.customerNumber,
    company_name: input.companyName,
    contract_name: input.contractName ?? 'Elavtal',
    start_date: input.startDate ?? '',
    facility_id: input.facilityId ?? '',
    metering_point_id: input.meteringPointId ?? '',
    support_email: input.supportEmail ?? '',
    cancellation_deadline: cancellationDeadline,
    portal_url: input.portalUrl ?? '',
  }
}

function safePortalUrl(): string | null {
  try {
    return `${getBaseAppUrl()}/login`
  } catch {
    return null
  }
}

async function companyEmailContext(companyId: string): Promise<{ name: string; supportEmail: string | null; portalUrl: string | null }> {
  const { data, error } = await supabaseService
    .from('companies')
    .select('name,support_email,primary_contact_email,branding')
    .eq('id', companyId)
    .maybeSingle()
  if (error) throw error

  const settingsResult = await supabaseService
    .from('company_email_settings')
    .select('sender_name,support_email,reply_to_email')
    .eq('company_id', companyId)
    .maybeSingle()

  const settings = settingsResult.error
    ? null
    : settingsResult.data as { sender_name?: string | null; support_email?: string | null; reply_to_email?: string | null } | null

  const branding = (data?.branding && typeof data.branding === 'object' && !Array.isArray(data.branding)
    ? data.branding
    : {}) as Record<string, unknown>

  return {
    name: clean(settings?.sender_name)
      ?? clean(branding.display_name)
      ?? clean(data?.name)
      ?? 'din elhandlare',
    supportEmail: clean(settings?.support_email) ?? clean(settings?.reply_to_email) ?? clean(branding.support_email) ?? clean(data?.support_email) ?? clean(data?.primary_contact_email),
    portalUrl: clean(branding.customer_portal_url) ?? clean(branding.website_url) ?? safePortalUrl(),
  }
}

async function loadExistingIdentity(companyId: string, externalCustomerId: string) {
  const { data, error } = await supabaseService
    .from('customer_portal_identities')
    .select('id,customer_id,external_customer_id,status')
    .eq('company_id', companyId)
    .eq('external_customer_id', externalCustomerId)
    .in('status', ['active', 'pending_review'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data as { id: string; customer_id: string | null; status: string } | null
}

async function findExistingCustomer(companyId: string, input: ApplicationInput): Promise<CustomerRow | null> {
  const email = normalizedEmail(input.customer.email)
  const customerId = digits(input.customer.personal_number ?? input.customer.org_number)

  if (customerId) {
    const { data, error } = await supabaseService
      .from('customers')
      .select('id,customer_number,email,full_name,company_name')
      .eq('company_id', companyId)
      .or(`personal_number.eq.${customerId},org_number.eq.${customerId},normalized_personal_number.eq.${customerId},normalized_org_number.eq.${customerId}`)
      .limit(1)
      .maybeSingle()
    if (error && !missingSchema(error)) throw error
    if (data) return data as CustomerRow

    if (error && missingSchema(error)) {
      const fallback = await supabaseService
        .from('customers')
        .select('id,customer_number,email,full_name,company_name')
        .eq('company_id', companyId)
        .or(`personal_number.eq.${customerId},org_number.eq.${customerId}`)
        .limit(1)
        .maybeSingle()
      if (fallback.error) throw fallback.error
      if (fallback.data) return fallback.data as CustomerRow
    }
  }

  if (email) {
    const { data, error } = await supabaseService
      .from('customers')
      .select('id,customer_number,email,full_name,company_name')
      .eq('company_id', companyId)
      .eq('normalized_email', email)
      .limit(1)
      .maybeSingle()
    if (error && !missingSchema(error)) throw error
    if (data) return data as CustomerRow

    if (error && missingSchema(error)) {
      const fallback = await supabaseService
        .from('customers')
        .select('id,customer_number,email,full_name,company_name')
        .eq('company_id', companyId)
        .eq('email', email)
        .limit(1)
        .maybeSingle()
      if (fallback.error) throw fallback.error
      if (fallback.data) return fallback.data as CustomerRow
    }
  }

  return null
}

async function upsertPortalIdentity(input: {
  client: IntegrationApiClient
  customerId: string
  externalCustomerId: string
  externalAccountId?: string | null
  email?: string | null
  applicationId?: string | null
}) {
  const now = new Date().toISOString()
  const payload = {
    company_id: input.client.company_id,
    customer_id: input.customerId,
    api_client_id: input.client.id,
    provider: 'external_website',
    external_customer_id: input.externalCustomerId,
    external_account_id: input.externalAccountId ?? null,
    email: input.email ?? null,
    status: 'active',
    match_strength: 'strong',
    match_method: 'website_application',
    linked_at: now,
    metadata: {
      source: 'website_customer_applications',
      api_client_id: input.client.id,
      application_id: input.applicationId ?? null,
    },
    updated_at: now,
  }

  const { data, error } = await supabaseService
    .from('customer_portal_identities')
    .upsert(payload, { onConflict: 'company_id,provider,external_customer_id' })
    .select('id')
    .single()

  if (error) throw error
  return data as { id: string }
}

async function createOrUpdateCustomer(client: IntegrationApiClient, input: ApplicationInput): Promise<{ customer: CustomerRow; created: boolean }> {
  const existing = await findExistingCustomer(client.company_id, input)
  const customer = input.customer
  const name = fullName(customer)
  const email = normalizedEmail(customer.email)
  const customerNumber = existing?.customer_number ?? await reserveCustomerNumber(client.company_id)
  const now = new Date().toISOString()

  if (existing) {
    const updatePayload = {
      customer_number: customerNumber,
      email: email ?? existing.email,
      phone: clean(customer.phone),
      full_name: name ?? existing.full_name,
      company_name: clean(customer.company_name) ?? existing.company_name,
      invoice_email: normalizedEmail(customer.invoice_email) ?? email ?? undefined,
      billing_street: clean(customer.billing_street) ?? undefined,
      billing_postal_code: clean(customer.billing_postal_code) ?? undefined,
      billing_city: clean(customer.billing_city) ?? undefined,
      billing_country: clean(customer.billing_country) ?? 'SE',
      source: 'external_website',
      updated_at: now,
      metadata: { source: 'website_customer_applications', api_client_id: client.id },
    }

    const { data, error } = await supabaseService
      .from('customers')
      .update(updatePayload)
      .eq('company_id', client.company_id)
      .eq('id', existing.id)
      .select('id,customer_number,email,full_name,company_name')
      .single()
    if (error && !missingSchema(error)) throw error
    if (data) return { customer: data as CustomerRow, created: false }

    const fallback = await supabaseService
      .from('customers')
      .update({ customer_number: customerNumber, email: email ?? existing.email, full_name: name ?? existing.full_name, updated_at: now })
      .eq('company_id', client.company_id)
      .eq('id', existing.id)
      .select('id,customer_number,email,full_name,company_name')
      .single()
    if (fallback.error) throw fallback.error
    return { customer: fallback.data as CustomerRow, created: false }
  }

  const insertPayload = {
    company_id: client.company_id,
    customer_type: customer.customer_type,
    status: 'active',
    first_name: clean(customer.first_name),
    last_name: clean(customer.last_name),
    full_name: name,
    company_name: clean(customer.company_name),
    personal_number: digits(customer.personal_number),
    org_number: digits(customer.org_number),
    email,
    phone: clean(customer.phone),
    customer_number: customerNumber,
    invoice_email: normalizedEmail(customer.invoice_email) ?? email,
    billing_street: clean(customer.billing_street),
    billing_postal_code: clean(customer.billing_postal_code),
    billing_city: clean(customer.billing_city),
    billing_country: clean(customer.billing_country) ?? 'SE',
    source: 'external_website',
    metadata: { source: 'website_customer_applications', api_client_id: client.id },
  }

  const { data, error } = await supabaseService
    .from('customers')
    .insert(insertPayload)
    .select('id,customer_number,email,full_name,company_name')
    .single()

  if (error && !missingSchema(error)) throw error
  if (data) return { customer: data as CustomerRow, created: true }

  const fallback = await supabaseService
    .from('customers')
    .insert({
      company_id: client.company_id,
      customer_type: customer.customer_type,
      status: 'active',
      full_name: name,
      email,
      phone: clean(customer.phone),
      customer_number: customerNumber,
    })
    .select('id,customer_number,email,full_name,company_name')
    .single()

  if (fallback.error) throw fallback.error
  return { customer: fallback.data as CustomerRow, created: true }
}

async function upsertSite(companyId: string, customerId: string, input: ApplicationInput): Promise<{ id: string; facility_id: string | null } | null> {
  const site = input.site
  if (!site) return null
  const facilityId = normalizeFacilityId(site.facility_id)

  if (facilityId) {
    const conflicts = await findFacilityConflicts({ companyId, customerId, facilityId })
    if (conflicts.crossTenantExists) {
      throw new WebsiteApplicationError({
        message: 'Anläggnings-ID finns i annan tenant. Systemet blockerar automation och visar inte annan tenants kunddata.',
        status: 409,
        code: 'cross_tenant_facility_conflict',
        stage: 'site_create',
        details: { facility_id: facilityId },
      })
    }
    const sameTenantConflict = conflicts.sameTenant[0]
    if (sameTenantConflict) {
      throw new WebsiteApplicationError({
        message: 'Anläggnings-ID finns redan hos en annan kund i samma bolag. Skapa inte dubblett; länka eller granska befintlig anläggning.',
        status: 409,
        code: 'duplicate_facility_id',
        stage: 'site_create',
        details: { facility_id: facilityId, existing_site_id: sameTenantConflict.id },
      })
    }

    const { data: existing, error: existingError } = await supabaseService
      .from('customer_sites')
      .select('id,facility_id')
      .eq('company_id', companyId)
      .eq('customer_id', customerId)
      .eq('facility_id', facilityId)
      .limit(1)
      .maybeSingle()
    if (existingError) throw existingError
    if (existing?.id) return existing as { id: string; facility_id: string | null }
  }

  const hasSiteData = Boolean(facilityId || clean(site.street) || clean(site.city))
  if (!hasSiteData) return null

  const fullPayload = {
    company_id: companyId,
    customer_id: customerId,
    site_name: clean(site.site_name) ?? 'Anläggning',
    facility_id: facilityId,
    site_type: clean(site.site_type) ?? 'consumption',
    status: 'active',
    price_area_code: clean(site.price_area_code),
    move_in_date: clean(site.move_in_date),
    annual_consumption_kwh: site.annual_consumption_kwh ?? null,
    street: clean(site.street),
    postal_code: clean(site.postal_code),
    city: clean(site.city),
    country: clean(site.country) ?? 'SE',
    metadata: { source: 'website_customer_applications' },
  }

  const { data, error } = await supabaseService
    .from('customer_sites')
    .insert(fullPayload)
    .select('id,facility_id')
    .single()

  if (error && !missingSchema(error)) throw error
  if (data) return data as { id: string; facility_id: string | null }

  const fallback = await supabaseService
    .from('customer_sites')
    .insert({
      company_id: companyId,
      customer_id: customerId,
      site_name: clean(site.site_name) ?? 'Anläggning',
      facility_id: facilityId,
      status: 'active',
    })
    .select('id,facility_id')
    .single()
  if (fallback.error) throw fallback.error
  return fallback.data as { id: string; facility_id: string | null }
}

async function upsertMeteringPoint(companyId: string, customerId: string, site: { id: string; facility_id: string | null } | null, input: ApplicationInput) {
  const metering = input.metering_point
  const meteringPointId = clean(metering?.metering_point_id)
    ?? clean(metering?.meter_point_id)
    ?? clean(metering?.ediel_metering_point_id)
    ?? clean(metering?.anlage_id)
    ?? site?.facility_id
    ?? null
  if (!meteringPointId || !site?.id) return null

  const matchExpression = [
    `metering_point_id.eq.${meteringPointId}`,
    `meter_point_id.eq.${meteringPointId}`,
    `ediel_metering_point_id.eq.${meteringPointId}`,
  ].join(',')

  const { data: existing, error: existingError } = await supabaseService
    .from('metering_points')
    .select('id,metering_point_id,meter_point_id,ediel_metering_point_id')
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .or(`site_id.eq.${site.id},customer_site_id.eq.${site.id}`)
    .or(matchExpression)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingError && !missingSchema(existingError)) throw existingError
  if (existing?.id) {
    return {
      id: String(existing.id),
      metering_point_id: clean(existing.metering_point_id) ?? clean(existing.meter_point_id) ?? clean(existing.ediel_metering_point_id),
    }
  }

  if (existingError && missingSchema(existingError)) {
    const fallbackExisting = await supabaseService
      .from('metering_points')
      .select('id,metering_point_id,meter_point_id')
      .eq('company_id', companyId)
      .eq('customer_id', customerId)
      .eq('site_id', site.id)
      .or(`metering_point_id.eq.${meteringPointId},meter_point_id.eq.${meteringPointId}`)
      .limit(1)
      .maybeSingle()
    if (fallbackExisting.error) throw fallbackExisting.error
    if (fallbackExisting.data?.id) {
      return {
        id: String(fallbackExisting.data.id),
        metering_point_id: clean(fallbackExisting.data.metering_point_id) ?? clean(fallbackExisting.data.meter_point_id),
      }
    }
  }

  const readingFrequency = clean(metering?.reading_frequency) ?? 'monthly'
  const measurementType = clean(metering?.measurement_type) ?? 'consumption'
  const startDate = clean(metering?.start_date) ?? clean(metering?.installation_date) ?? clean(input.site?.move_in_date)
  const installationDate = clean(metering?.installation_date) ?? startDate
  const annualConsumption = metering?.estimated_annual_consumption_kwh ?? input.site?.annual_consumption_kwh ?? null
  const priceAreaCode = clean(metering?.price_area_code) ?? clean(input.site?.price_area_code)
  const siteFacilityId = clean(metering?.site_facility_id) ?? clean(metering?.anlage_id) ?? site.facility_id ?? meteringPointId
  const metadata = {
    source: 'website_customer_applications',
    source_metadata: input.metadata ?? {},
  }

  const fullPayload = {
    company_id: companyId,
    customer_id: customerId,
    site_id: site.id,
    customer_site_id: site.id,
    meter_point_id: meteringPointId,
    metering_point_id: meteringPointId,
    ediel_metering_point_id: meteringPointId,
    anlage_id: clean(metering?.anlage_id) ?? siteFacilityId,
    site_facility_id: siteFacilityId,
    status: 'active',
    metering_type: 'consumption',
    measurement_type: measurementType,
    reading_frequency: readingFrequency,
    price_area_code: priceAreaCode,
    start_date: startDate,
    installation_date: installationDate,
    is_settlement_relevant: true,
    data_quality_status: 'incomplete',
    verification_status: 'pending',
    onboarding_status: 'application_received',
    estimated_annual_consumption_kwh: annualConsumption,
    metadata,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabaseService
    .from('metering_points')
    .insert(fullPayload)
    .select('id,metering_point_id,meter_point_id,ediel_metering_point_id')
    .single()

  if (error && !missingSchema(error)) throw error
  if (data) {
    return {
      id: String(data.id),
      metering_point_id: clean(data.metering_point_id) ?? clean(data.meter_point_id) ?? clean(data.ediel_metering_point_id),
    }
  }

  const fallback = await supabaseService
    .from('metering_points')
    .insert({
      company_id: companyId,
      customer_id: customerId,
      site_id: site.id,
      customer_site_id: site.id,
      metering_point_id: meteringPointId,
      meter_point_id: meteringPointId,
      status: 'active',
      measurement_type: measurementType,
      reading_frequency: readingFrequency,
      is_settlement_relevant: true,
      site_facility_id: siteFacilityId,
      price_area_code: priceAreaCode,
      start_date: startDate,
      metadata,
    })
    .select('id,metering_point_id,meter_point_id')
    .single()
  if (fallback.error) throw fallback.error
  return {
    id: String(fallback.data.id),
    metering_point_id: clean(fallback.data.metering_point_id) ?? clean(fallback.data.meter_point_id),
  }
}

type WebsiteContractCreateResult = {
  id: string
  contract_name: string | null
  starts_at: string | null
  status: string
  contract_number: string | null
  price_plan_id: string | null
  price_plan_version_id: string | null
  contract_price_snapshot_id?: string | null
}

function selectedOfferFields(offer: PublicContractOffer | null, contract: ApplicationInput['contract']) {
  return {
    pricePlanId: offer?.price_plan_id ?? clean(contract?.price_plan_id),
    pricePlanVersionId: offer?.price_plan_version_id ?? clean(contract?.price_plan_version_id),
    contractOfferId: offer?.id ?? clean(contract?.contract_offer_id),
    campaignVersionId: offer?.campaign_version_id ?? null,
    contractName: offer?.public_name ?? clean(contract?.contract_name) ?? 'Elavtal',
    contractType: offer?.contract_type ?? clean(contract?.contract_type) ?? 'variable_monthly',
    monthlyFeeSek: offer?.monthly_fee_sek ?? contract?.monthly_fee_sek ?? null,
    invoiceFeeSek: offer?.invoice_fee_sek ?? contract?.invoice_fee_sek ?? null,
    markupOrePerKwh: offer?.markup_ore_per_kwh ?? contract?.markup_ore_per_kwh ?? null,
    spotMarkupOrePerKwh: offer?.spot_markup_ore_per_kwh ?? contract?.spot_markup_ore_per_kwh ?? contract?.markup_ore_per_kwh ?? null,
    variableFeeOrePerKwh: offer?.variable_fee_ore_per_kwh ?? contract?.variable_fee_ore_per_kwh ?? null,
    fixedPriceOrePerKwh: offer?.fixed_price_ore_per_kwh ?? contract?.fixed_price_ore_per_kwh ?? null,
    greenFeeMode: offer?.green_fee_mode ?? clean(contract?.green_fee_mode) ?? 'none',
    greenFeeValue: offer?.green_fee_value ?? contract?.green_fee_value ?? null,
    termsVersion: offer?.terms_version ?? clean(contract?.terms_version) ?? null,
    productCode: offer?.product_code ?? clean(contract?.product_code) ?? null,
    billingModel: offer?.billing_model ?? null,
  }
}

async function createContractPriceSnapshot(input: {
  companyId: string
  customerId: string
  contractId: string
  offer: PublicContractOffer | null
  contract: ApplicationInput['contract']
  contractNumber: string | null
  customerNumber: string | null
  readiness: WebsiteApplicationReadiness
  consents?: Record<string, unknown>
  metadata?: Record<string, unknown>
}) {
  const selected = selectedOfferFields(input.offer, input.contract)
  const baseSnapshot = input.offer ? [
    {
      source: 'public_contract_offer',
      product_code: input.offer.product_code,
      billing_model: input.offer.billing_model,
      contract_type: input.offer.contract_type,
      valid_from: input.offer.valid_from,
      valid_to: input.offer.valid_to,
    },
  ] : []
  const feeSnapshot = [
    { code: 'monthly_fee', label: 'Månadsavgift', amount: selected.monthlyFeeSek, unit: 'SEK/month' },
    { code: 'invoice_fee', label: 'Fakturaavgift', amount: selected.invoiceFeeSek, unit: 'SEK/invoice' },
    { code: 'spot_markup', label: 'Påslag', amount: selected.spotMarkupOrePerKwh ?? selected.markupOrePerKwh, unit: 'ore/kWh' },
    { code: 'variable_fee', label: 'Rörlig avgift', amount: selected.variableFeeOrePerKwh, unit: 'ore/kWh' },
    { code: 'fixed_price', label: 'Fastpris', amount: selected.fixedPriceOrePerKwh, unit: 'ore/kWh' },
    { code: 'green_fee', label: 'Grön el', amount: selected.greenFeeValue, unit: selected.greenFeeMode ?? 'none' },
  ].filter((item) => item.amount !== null && item.amount !== undefined)

  const snapshotJson = {
    source: 'website_customer_applications',
    legal_snapshot_type: 'website_contract_acceptance',
    customer_number: input.customerNumber,
    contract_number: input.contractNumber,
    contract_name: selected.contractName,
    contract_type: selected.contractType,
    product_code: selected.productCode,
    billing_model: selected.billingModel,
    price_plan_id: selected.pricePlanId,
    price_plan_version_id: selected.pricePlanVersionId,
    contract_offer_id: selected.contractOfferId,
    campaign_version_id: selected.campaignVersionId,
    terms_version: selected.termsVersion,
    public_price_text: input.offer?.public_price_text ?? null,
    terms_url: input.offer?.terms_url ?? null,
    mix: {
      spot_weight_percent: input.offer?.spot_weight_percent ?? null,
      portfolio_weight_percent: input.offer?.portfolio_weight_percent ?? null,
      fixed_weight_percent: input.offer?.fixed_weight_percent ?? null,
    },
    requested_start_date: input.readiness.requestedStartDate,
    requested_start_mode: input.readiness.requestedStartMode,
    calculated_earliest_start_date: input.readiness.calculatedEarliestStartDate,
    missing_fields: input.readiness.missingFields,
    blocking_reasons: input.readiness.blockingReasons,
    consents: input.consents ?? {},
    public_offer: input.offer ?? null,
    source_metadata: input.metadata ?? {},
  }

  const { data, error } = await supabaseService
    .from('contract_price_snapshots')
    .insert({
      company_id: input.companyId,
      contract_id: input.contractId,
      customer_id: input.customerId,
      contract_number: input.contractNumber,
      public_contract_offer_id: input.offer?.id ?? null,
      public_price_text: input.offer?.public_price_text ?? null,
      terms_url: input.offer?.terms_url ?? null,
      spot_weight_percent: input.offer?.spot_weight_percent ?? null,
      portfolio_weight_percent: input.offer?.portfolio_weight_percent ?? null,
      fixed_weight_percent: input.offer?.fixed_weight_percent ?? null,
      customer_number: input.customerNumber,
      source: 'website_customer_applications',
      price_plan_version_id: selected.pricePlanVersionId,
      campaign_version_id: selected.campaignVersionId,
      pricing_model: selected.billingModel ?? selected.contractType ?? 'spot',
      base_price_components_snapshot: baseSnapshot,
      price_components_snapshot: feeSnapshot,
      snapshot_json: snapshotJson,
      valid_from: input.readiness.requestedStartDate ?? null,
      valid_to: input.offer?.valid_to ?? null,
    })
    .select('id')
    .single()

  if (error) {
    if (missingSchema(error)) return null
    throw error
  }

  return String(data.id)
}

async function createContract(
  companyId: string,
  customerId: string,
  siteId: string | null,
  meteringPointId: string | null,
  input: ApplicationInput,
  readiness: WebsiteApplicationReadiness,
  customerNumber: string,
  publicOffer: PublicContractOffer | null
): Promise<WebsiteContractCreateResult | null> {
  const contract = input.contract
  if (!contract && !publicOffer && !readiness.canCreateContract) return null
  const selected = selectedOfferFields(publicOffer, contract)
  const requestedStartDate = readiness.requestedStartDate
    ?? clean(contract?.requested_start_date)
    ?? clean(contract?.requestedStartDate)
    ?? clean(contract?.starts_at)
    ?? clean(contract?.expected_start_at)
    ?? clean(input.site?.move_in_date)
  const confirmedStartDate = readiness.confirmedStartDate ?? clean(contract?.confirmed_start_date) ?? clean(contract?.confirmedStartDate)
  const actualStartDate = readiness.actualStartDate ?? clean(contract?.actual_start_date) ?? clean(contract?.actualStartDate)
  const now = new Date().toISOString()
  const contractStatus = readiness.canStartSwitch ? WEBSITE_APPLICATION_READY_CONTRACT_STATUS : WEBSITE_APPLICATION_DRAFT_CONTRACT_STATUS

  const existingContract = await findExistingWebsiteApplicationContract({
    companyId,
    customerId,
    siteId,
    meteringPointId,
    requestedStartDate,
    contractName: selected.contractName,
  })
  if (existingContract) {
    return {
      id: existingContract.id,
      contract_name: existingContract.contract_name,
      starts_at: existingContract.starts_at,
      status: existingContract.status ?? contractStatus,
      contract_number: existingContract.contract_number ?? null,
      price_plan_id: existingContract.price_plan_id ?? selected.pricePlanId,
      price_plan_version_id: existingContract.price_plan_version_id ?? selected.pricePlanVersionId,
    }
  }

  const contractNumber = clean(contract?.contract_number) ?? await reserveContractNumber({ companyId, customerNumber })
  const feeLines = [
    {
      source: 'website_customer_applications',
      metering_point_id: meteringPointId,
      consents: input.consents ?? {},
      source_metadata: input.metadata ?? {},
      public_offer: publicOffer,
    },
  ]

  const fullPayload = {
    company_id: companyId,
    customer_id: customerId,
    site_id: siteId,
    customer_site_id: siteId,
    metering_point_id: meteringPointId,
    source_type: WEBSITE_APPLICATION_CONTRACT_SOURCE_TYPE,
    status: contractStatus,
    contract_number: contractNumber,
    contract_name: selected.contractName,
    contract_type: selected.contractType,
    price_plan_id: selected.pricePlanId,
    price_plan_version_id: selected.pricePlanVersionId,
    starts_at: requestedStartDate,
    expected_start_at: requestedStartDate,
    requested_start_date: requestedStartDate,
    requested_start_mode: readiness.requestedStartMode,
    calculated_earliest_start_date: readiness.calculatedEarliestStartDate,
    price_area_used: readiness.priceArea,
    grid_area_code_used: readiness.gridAreaCode,
    resolution_status: readiness.resolutionStatus,
    confirmed_start_date: confirmedStartDate,
    actual_start_date: actualStartDate,
    signed_at: clean(contract?.signed_at) ?? null,
    monthly_fee_sek: selected.monthlyFeeSek,
    invoice_fee_sek: selected.invoiceFeeSek,
    markup_ore_per_kwh: selected.markupOrePerKwh,
    spot_markup_ore_per_kwh: selected.spotMarkupOrePerKwh,
    variable_fee_ore_per_kwh: selected.variableFeeOrePerKwh,
    fixed_price_ore_per_kwh: selected.fixedPriceOrePerKwh,
    green_fee_mode: selected.greenFeeMode,
    green_fee_value: selected.greenFeeValue,
    binding_months: contract?.binding_months ?? null,
    notice_months: contract?.notice_months ?? null,
    campaign_code: clean(contract?.campaign_code) ?? null,
    price_version: selected.pricePlanVersionId ?? clean(contract?.price_version) ?? null,
    terms_version: selected.termsVersion,
    optional_fee_lines: feeLines,
    agreement_channel: WEBSITE_APPLICATION_CONTRACT_CHANNEL,
    metadata: {
      source: 'website_customer_applications',
      source_type: WEBSITE_APPLICATION_CONTRACT_SOURCE_TYPE,
      agreement_channel: WEBSITE_APPLICATION_CONTRACT_CHANNEL,
      contract_number: contractNumber,
      price_plan_id: selected.pricePlanId,
      price_plan_version_id: selected.pricePlanVersionId,
      contract_offer_id: selected.contractOfferId,
      public_offer: publicOffer,
      metering_point_id: meteringPointId,
      requested_start_date: requestedStartDate,
      requested_start_mode: readiness.requestedStartMode,
      calculated_earliest_start_date: readiness.calculatedEarliestStartDate,
      price_area_used: readiness.priceArea,
      grid_area_code_used: readiness.gridAreaCode,
      resolution_status: readiness.resolutionStatus,
      confirmed_start_date: confirmedStartDate,
      actual_start_date: actualStartDate,
      missing_fields: readiness.missingFields,
      blocking_reasons: readiness.blockingReasons,
      source_metadata: input.metadata ?? {},
    },
    updated_at: now,
  }

  const fallbackPayloads = [
    fullPayload,
    omitKeys(fullPayload, [
      'metadata',
      'optional_fee_lines',
      'expected_start_at',
      'requested_start_date',
      'confirmed_start_date',
      'actual_start_date',
      'agreement_channel',
      'campaign_code',
      'price_version',
      'terms_version',
      'invoice_fee_sek',
      'markup_ore_per_kwh',
      'price_plan_id',
      'price_plan_version_id',
    ]),
    {
      company_id: companyId,
      customer_id: customerId,
      site_id: siteId,
      customer_site_id: siteId,
      metering_point_id: meteringPointId,
      source_type: WEBSITE_APPLICATION_CONTRACT_SOURCE_TYPE,
      status: contractStatus,
      contract_number: contractNumber,
      contract_name: selected.contractName,
      contract_type: selected.contractType,
      starts_at: requestedStartDate,
      updated_at: now,
    },
  ]

  let firstError: unknown = null
  let lastError: unknown = null
  for (const payload of fallbackPayloads) {
    const fallback = await supabaseService
      .from('customer_contracts')
      .insert(payload)
      .select('id,contract_name,starts_at,status,contract_number,price_plan_id,price_plan_version_id')
      .single()

    if (!fallback.error && fallback.data) {
      const created = fallback.data as WebsiteContractCreateResult
      created.contract_price_snapshot_id = await createContractPriceSnapshot({
        companyId,
        customerId,
        contractId: created.id,
        offer: publicOffer,
        contract,
        contractNumber: clean(created.contract_number) ?? contractNumber,
        customerNumber,
        readiness,
        consents: input.consents,
        metadata: input.metadata,
      })
      return created
    }

    firstError = firstError ?? fallback.error
    lastError = fallback.error

    if (fallback.error && !missingSchema(fallback.error)) break
  }

  throw new WebsiteApplicationError({
    message: `Kundavtal kunde inte skapas: ${errorMessage(lastError)}`,
    status: 500,
    code: 'contract_create_failed',
    stage: 'contract_create',
    details: { full_error: errorMessage(firstError), fallback_error: errorMessage(lastError) },
  })
}

type CreateApplicationRowInput = {
  client: IntegrationApiClient
  externalCustomerId: string
  externalAccountId?: string | null
  customer?: CustomerRow | null
  customerSiteId?: string | null
  meteringPointId?: string | null
  contractId?: string | null
  contractNumber?: string | null
  applicationNumber?: string | null
  pricePlanId?: string | null
  pricePlanVersionId?: string | null
  contractPriceSnapshotId?: string | null
  payload: ApplicationInput | Record<string, unknown>
  rawPayload?: unknown
  responsePayload: Record<string, unknown>
  idempotencyKey?: string | null
  status: string
  warnings?: unknown[]
  errorStage?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  missingFields?: string[]
  blockingReasons?: unknown[]
  nextStep?: string | null
  requestedStartDate?: string | null
  confirmedStartDate?: string | null
  actualStartDate?: string | null
  requestedStartMode?: string | null
  calculatedEarliestStartDate?: string | null
  resolutionId?: string | null
  gridOwnerInformationRequestId?: string | null
  gridAreaCode?: string | null
  gridOwnerId?: string | null
  priceAreaCode?: string | null
  resolutionStatus?: string | null
  resolutionConfidence?: number | null
  timeline?: unknown[]
  auditLog?: unknown[]
}

function externalIntakeStatusFromWebsiteStatus(status: string): 'received' | 'processing' | 'needs_review' | 'created' | 'partially_created' | 'failed' | 'duplicate_ignored' | 'cancelled' {
  if (['failed', 'rejected', 'switch_rejected'].includes(status)) return 'failed'
  if (status === 'cancelled') return 'cancelled'
  if (['needs_information', 'pending_review', 'manual_review', 'pending_validation', 'needs_facility_data', 'information_request_ready', 'information_request_sent', 'waiting_grid_owner_response'].includes(status)) return 'needs_review'
  if (['ready_for_switch', 'customer_created', 'customer_matched', 'contract_created', 'confirmation_pending', 'confirmation_sent', 'completed', 'active', 'switch_confirmed'].includes(status)) return 'created'
  return 'received'
}

async function syncExternalContractIntakeRow(input: CreateApplicationRowInput & { applicationId: string }) {
  const payload = input.payload as ApplicationInput & Record<string, unknown>
  const customer: Record<string, unknown> = isObject(payload.customer) ? payload.customer : {}
  const site: Record<string, unknown> = isObject(payload.site) ? payload.site : {}
  const meteringPoint: Record<string, unknown> = isObject(payload.metering_point) ? payload.metering_point : {}
  const contract: Record<string, unknown> = isObject(payload.contract) ? payload.contract : {}
  const issues = [
    ...(input.missingFields ?? []).map((field) => `Saknad uppgift: ${field}`),
    ...(input.blockingReasons ?? []).map((reason) => typeof reason === 'string' ? reason : JSON.stringify(reason)),
    ...(input.errorMessage ? [input.errorMessage] : []),
  ].filter(Boolean)

  const externalStatus = externalIntakeStatusFromWebsiteStatus(input.status)
  const intakePayload = {
    company_id: input.client.company_id,
    status: externalStatus,
    source_channel: 'external_website_api',
    idempotency_key: input.idempotencyKey ?? `website-application:${input.applicationId}`,
    customer_type: clean(customer.customer_type) ?? clean(payload.customer_type) ?? 'private',
    first_name: clean(customer.first_name),
    last_name: clean(customer.last_name),
    company_name: clean(customer.company_name),
    email: normalizedEmail(customer.email),
    phone: clean(customer.phone),
    personal_number: digits(customer.personal_number),
    org_number: digits(customer.org_number),
    facility_id: clean(site.facility_id) ?? clean(payload.facility_id),
    meter_point_id: clean(meteringPoint.metering_point_id) ?? clean(meteringPoint.meter_point_id) ?? clean(payload.metering_point_id),
    street: clean(site.street),
    postal_code: clean(site.postal_code),
    city: clean(site.city),
    move_in_date: clean(site.move_in_date) ?? null,
    price_area_code: input.priceAreaCode ?? clean(site.price_area_code) ?? clean(payload.price_area_code),
    contract_offer_id: input.pricePlanVersionId ?? clean(payload.contract_offer_id) ?? clean(contract.price_plan_version_id) ?? clean(payload.price_plan_version_id),
    requested_start_date: input.requestedStartDate ?? clean(contract.requested_start_date) ?? clean(payload.requested_start_date),
    created_customer_id: input.customer?.id ?? null,
    created_site_id: input.customerSiteId ?? null,
    created_metering_point_id: input.meteringPointId ?? null,
    created_contract_id: input.contractId ?? null,
    contract_number: input.contractNumber ?? null,
    application_number: input.applicationNumber ?? null,
    created_info_request_id: input.gridOwnerInformationRequestId ?? null,
    payload: {
      ...payload,
      source_table: 'website_customer_applications',
      website_application_id: input.applicationId,
      external_customer_id: input.externalCustomerId,
      external_account_id: input.externalAccountId ?? null,
      response_payload: input.responsePayload,
    },
    issues,
    updated_at: new Date().toISOString(),
  }

  const result = await supabaseService
    .from('external_contract_intakes')
    .upsert(intakePayload, { onConflict: 'company_id,idempotency_key' })
    .select('id')
    .maybeSingle()

  if (result.error && !missingSchema(result.error)) {
    throw result.error
  }
}

async function createApplicationRow(input: CreateApplicationRowInput) {
  const row = {
    company_id: input.client.company_id,
    api_client_id: input.client.id,
    customer_id: input.customer?.id ?? null,
    customer_site_id: input.customerSiteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    contract_id: input.contractId ?? null,
    contract_number: input.contractNumber ?? null,
    application_number: input.applicationNumber ?? null,
    price_plan_id: input.pricePlanId ?? null,
    price_plan_version_id: input.pricePlanVersionId ?? null,
    contract_price_snapshot_id: input.contractPriceSnapshotId ?? null,
    external_customer_id: input.externalCustomerId,
    external_account_id: input.externalAccountId ?? null,
    customer_number: input.customer?.customer_number ?? null,
    source: clean((input.payload as { source?: unknown }).source) ?? 'external_website',
    status: input.status,
    idempotency_key: input.idempotencyKey ?? null,
    payload: input.payload,
    raw_payload: input.rawPayload ?? input.payload,
    response_payload: input.responsePayload,
    warnings: input.warnings ?? [],
    error_stage: input.errorStage ?? null,
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage ?? null,
    missing_fields: input.missingFields ?? [],
    blocking_reasons: input.blockingReasons ?? [],
    next_step: input.nextStep ?? null,
    requested_start_date: input.requestedStartDate ?? null,
    confirmed_start_date: input.confirmedStartDate ?? null,
    actual_start_date: input.actualStartDate ?? null,
    requested_start_mode: input.requestedStartMode ?? 'earliest_possible',
    calculated_earliest_start_date: input.calculatedEarliestStartDate ?? null,
    resolution_id: input.resolutionId ?? null,
    grid_owner_information_request_id: input.gridOwnerInformationRequestId ?? null,
    grid_area_code: input.gridAreaCode ?? null,
    grid_owner_id: input.gridOwnerId ?? null,
    price_area_code: input.priceAreaCode ?? null,
    resolution_status: input.resolutionStatus ?? null,
    resolution_confidence: input.resolutionConfidence ?? null,
    timeline: input.timeline ?? [],
    audit_log: input.auditLog ?? [],
    processed_at: input.status === 'failed' ? null : new Date().toISOString(),
  }

  const { data, error } = await supabaseService
    .from('website_customer_applications')
    .insert(row)
    .select('id')
    .single()

  if (error && !missingSchema(error)) throw error
  if (data) {
    const created = data as { id: string }
    await syncExternalContractIntakeRow({ ...input, applicationId: created.id })
    return created
  }

  const fallback = await supabaseService
    .from('website_customer_applications')
    .insert({
      company_id: input.client.company_id,
      api_client_id: input.client.id,
      customer_id: input.customer?.id ?? null,
      external_customer_id: input.externalCustomerId,
      customer_number: input.customer?.customer_number ?? null,
      source: clean((input.payload as { source?: unknown }).source) ?? 'external_website',
      status: input.status,
      idempotency_key: input.idempotencyKey ?? null,
      payload: input.payload,
      response_payload: input.responsePayload,
      warnings: input.warnings ?? [],
    })
    .select('id')
    .single()
  if (fallback.error) throw fallback.error
  const created = fallback.data as { id: string }
  await syncExternalContractIntakeRow({ ...input, applicationId: created.id })
  return created
}

async function loadIdempotentApplication(companyId: string, idempotencyKey: string | null) {
  if (!idempotencyKey) return null
  const { data, error } = await supabaseService
    .from('website_customer_applications')
    .select('id,response_payload,payload,status,customer_id,customer_number,external_customer_id,customer_site_id,metering_point_id,error_stage,error_code,error_message')
    .eq('company_id', companyId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  if (error) throw error
  return data as {
    id: string
    response_payload: Record<string, unknown> | null
    payload?: Record<string, unknown> | null
    status: string
    customer_id: string | null
    customer_number: string | null
    external_customer_id: string | null
    customer_site_id?: string | null
    metering_point_id?: string | null
    error_stage?: string | null
    error_code?: string | null
    error_message?: string | null
  } | null
}

function expectsSiteOrMetering(input: ApplicationInput | Record<string, unknown> | null | undefined): boolean {
  if (!input || typeof input !== 'object') return false
  const record = input as Record<string, unknown>
  const site = isObject(record.site) ? record.site : null
  const metering = isObject(record.metering_point) ? record.metering_point : null

  return Boolean(
    clean(site?.facility_id) ||
    clean(site?.street) ||
    clean(site?.city) ||
    clean(metering?.metering_point_id) ||
    clean(metering?.meter_point_id) ||
    clean(metering?.ediel_metering_point_id) ||
    clean(metering?.anlage_id) ||
    clean(record.facility_id) ||
    clean(record.site_facility_id) ||
    clean(record.metering_point_id) ||
    clean(record.meter_point_id) ||
    clean(record.ediel_metering_point_id) ||
    clean(record.anlage_id)
  )
}

function hasCompleteSiteAndMetering(existing: NonNullable<Awaited<ReturnType<typeof loadIdempotentApplication>>>) {
  const response = existing.response_payload ?? {}
  return Boolean(
    (existing.customer_site_id ?? clean(response.customer_site_id)) &&
    (existing.metering_point_id ?? clean(response.metering_point_id))
  )
}

function idempotentFailure(existing: NonNullable<Awaited<ReturnType<typeof loadIdempotentApplication>>>, externalCustomerId: string, reason?: string) {
  const response = existing.response_payload ?? {}
  const errorStage = existing.error_stage ?? clean(response.error_stage) ?? 'idempotency'
  const errorCode = reason ?? existing.error_code ?? clean(response.code) ?? 'internal_error'
  const errorMessage = existing.error_message ?? clean(response.error) ?? (reason === 'incomplete_application'
    ? 'Tidigare idempotent request blev ofullständig.'
    : 'Tidigare idempotent request misslyckades.')

  return failureResponse(new WebsiteApplicationError({
    message: 'Tidigare idempotent request misslyckades.',
    status: 409,
    code: 'idempotent_failed',
    stage: 'idempotency',
    hint: 'Använd ny Idempotency-Key efter att felet är åtgärdat, eller kör retry via admin.',
    details: {
      application_id: existing.id,
      external_customer_id: existing.external_customer_id ?? externalCustomerId,
      previous_status: existing.status,
      previous_error_stage: errorStage,
      previous_error_code: errorCode,
      previous_error_message: errorMessage,
    },
  }))
}

function isFailedIdempotentApplication(
  existing: NonNullable<Awaited<ReturnType<typeof loadIdempotentApplication>>>,
  currentInput?: ApplicationInput
) {
  const response = existing.response_payload ?? {}
  if (['needs_information', 'manual_review', 'pending_review', 'pending_validation', 'ready_for_switch'].includes(existing.status)) {
    return false
  }
  const responseCode = clean(response.code)
  const hasSuccessIdentity = Boolean(existing.customer_id && (existing.customer_number ?? clean(response.customer_number)))
  const requiresSiteAndMetering = expectsSiteOrMetering(currentInput) || expectsSiteOrMetering(existing.payload)

  return (
    existing.status === 'failed' ||
    Boolean(existing.error_stage || existing.error_code || existing.error_message) ||
    responseCode === 'internal_error' ||
    (requiresSiteAndMetering && !hasCompleteSiteAndMetering(existing)) ||
    (!hasSuccessIdentity && ['failed', 'rejected', 'cancelled'].includes(existing.status))
  )
}

function successResponse(data: Record<string, unknown>, warnings: string[] = []) {
  return {
    ok: true as const,
    status: 200,
    body: {
      data: {
        ...data,
        warnings,
      },
    },
  }
}

function failureResponse(error: WebsiteApplicationError) {
  return {
    ok: false as const,
    status: error.status,
    body: {
      error: operationalErrorMessage(error),
      code: error.code,
      field: error.field ?? null,
      hint: error.hint ?? null,
      error_stage: error.stage,
      details: error.details ?? null,
    },
  }
}

export async function processWebsiteCustomerApplication(input: {
  client: IntegrationApiClient
  rawBody: unknown
  idempotencyKey?: string | null
}) {
  const normalizedRaw = normalizeRawApplication(input.rawBody)
  const parsed = ApplicationSchema.safeParse(normalizedRaw)
  if (!parsed.success) {
    return failureResponse(new WebsiteApplicationError({
      message: 'Ogiltig kundansökan.',
      status: 422,
      code: 'validation_error',
      stage: 'validation',
      details: parsed.error.issues.map((issue: { path: Array<string | number>; message: string }) => ({ path: issue.path.join('.'), message: issue.message })),
    }))
  }

  let body = parsed.data
  const externalCustomerId = clean(body.external_customer_id) ?? clean(body.customer_external_id)
  if (!externalCustomerId) {
    return failureResponse(validationError(
      'external_customer_id krävs.',
      'external_customer_id',
      'Skicka ett stabilt kund-ID från hemsidan som external_customer_id.'
    ))
  }
  if (!normalizedEmail(body.customer.email)) {
    return failureResponse(validationError(
      'customer.email krävs.',
      'customer.email',
      'Skicka email under customer.email eller som top-level email.'
    ))
  }

  let readiness = assessWebsiteApplicationReadiness(body)
  let customerResult: { customer: CustomerRow; created: boolean } | null = null
  let site: { id: string; facility_id: string | null } | null = null
  let meteringPoint: { id: string; metering_point_id: string | null } | null = null
  let contract: WebsiteContractCreateResult | null = null
  let publicOffer: PublicContractOffer | null = null
  let legalAcceptanceVersions: WebsiteLegalAcceptanceVersion[] = []
  let applicationNumber: string | null = null

  try {
    const existingIdempotent = await stage('idempotency', () => loadIdempotentApplication(input.client.company_id, input.idempotencyKey ?? null))
    if (existingIdempotent) {
      if (isFailedIdempotentApplication(existingIdempotent, body)) {
        const incomplete = expectsSiteOrMetering(body) && !hasCompleteSiteAndMetering(existingIdempotent)
        return idempotentFailure(existingIdempotent, externalCustomerId, incomplete ? 'incomplete_application' : undefined)
      }

      return successResponse({
        ...(existingIdempotent.response_payload ?? {}),
        idempotent: true,
        application_id: existingIdempotent.id,
        customer_id: existingIdempotent.customer_id ?? (existingIdempotent.response_payload?.customer_id as string | undefined) ?? null,
        customer_number: existingIdempotent.customer_number ?? (existingIdempotent.response_payload?.customer_number as string | undefined) ?? null,
        external_customer_id: existingIdempotent.external_customer_id ?? externalCustomerId,
        status: existingIdempotent.status,
      })
    }

    const existingIdentity = await stage('customer_lookup', () => loadExistingIdentity(input.client.company_id, externalCustomerId))
    if (existingIdentity?.customer_id) {
      customerResult = await stage('customer_lookup', async () => {
        const { data, error } = await supabaseService
          .from('customers')
          .select('id,customer_number,email,full_name,company_name')
          .eq('company_id', input.client.company_id)
          .eq('id', existingIdentity.customer_id)
          .maybeSingle()
        if (error) throw error
        if (!data) throw new Error('Befintlig portal identity saknar giltig kund.')
        const customerNumber = await ensureCustomerNumber({
          companyId: input.client.company_id,
          customerId: String(data.id),
          existingCustomerNumber: clean(data.customer_number),
        })
        return { customer: { ...(data as CustomerRow), customer_number: customerNumber }, created: false }
      })
    } else {
      customerResult = await stage('customer_create', () => createOrUpdateCustomer(input.client, body))
    }

    if (!customerResult) {
      throw new WebsiteApplicationError({
        message: 'Kund kunde inte skapas eller matchas.',
        status: 500,
        code: 'customer_create_failed',
        stage: 'customer_create',
      })
    }

    const resolvedCustomerResult = customerResult
    const customerNumber = resolvedCustomerResult.customer.customer_number ?? await stage('customer_number_create', () => ensureCustomerNumber({
      companyId: input.client.company_id,
      customerId: resolvedCustomerResult.customer.id,
    }))
    resolvedCustomerResult.customer.customer_number = customerNumber

    const selectedPricePlanVersionId = clean(body.price_plan_version_id) ?? clean(body.contract?.price_plan_version_id)
    const selectedPricePlanId = clean(body.price_plan_id) ?? clean(body.contract?.price_plan_id)
    const selectedContractOfferId = clean(body.contract_offer_id) ?? clean(body.contract?.contract_offer_id)
    const selectedProductCode = clean(body.product_code) ?? clean(body.contract?.product_code)
    const hasSelectedPublicContract = Boolean(selectedPricePlanVersionId || selectedPricePlanId || selectedContractOfferId || selectedProductCode)
    if (!hasSelectedPublicContract) {
      throw new WebsiteApplicationError({
        message: 'Kundansökan måste referera till ett publicerat avtal från Ops.',
        status: 422,
        code: 'public_contract_required',
        field: 'contract.price_plan_version_id',
        stage: 'public_contract_lookup',
        hint: 'Hämta avtal via GET /api/v1/website/public-contracts och skicka contract_offer_id eller price_plan_version_id. Skicka inte egna priser eller fritextavtal som juridisk sanning.',
      })
    }

    publicOffer = hasSelectedPublicContract
      ? await stage('public_contract_lookup', () => resolvePublicContractOffer({
          client: input.client,
          pricePlanVersionId: selectedPricePlanVersionId,
          pricePlanId: selectedPricePlanId,
          contractOfferId: selectedContractOfferId,
          productCode: selectedProductCode,
          customerType: body.customer.customer_type,
        }))
      : null

    if (hasSelectedPublicContract && !publicOffer) {
      throw new WebsiteApplicationError({
        message: 'Valt avtal är inte publicerat eller tillhör inte denna tenant.',
        status: 422,
        code: 'public_contract_not_available',
        field: 'price_plan_version_id',
        stage: 'public_contract_lookup',
        hint: 'Hemsidan ska hämta avtal via GET /api/v1/website/public-contracts och skicka price_plan_version_id från svaret.',
      })
    }

    if (publicOffer) {
      const selectedPublicOffer = publicOffer
      legalAcceptanceVersions = await stage('legal_acceptance', () => assertWebsiteLegalAcceptances({
        companyId: input.client.company_id,
        consents: body.consents,
        publicOffer: selectedPublicOffer,
      }))
    }

    applicationNumber = await stage('application_record_create', () => reserveApplicationNumber(input.client.company_id))

    site = readiness.canCreateSite
      ? await stage('site_create', () => upsertSite(input.client.company_id, resolvedCustomerResult.customer.id, body))
      : null

    const energyResolution = await stage('energy_resolution', () => runEnergyResolution({
      companyId: input.client.company_id,
      customerId: resolvedCustomerResult.customer.id,
      customerSiteId: site?.id ?? null,
      body,
    }))
    body = energyResolution.body
    readiness = assessWebsiteApplicationReadiness(body)

    meteringPoint = readiness.canCreateMeteringPoint
      ? await stage('metering_point_create', () => upsertMeteringPoint(input.client.company_id, resolvedCustomerResult.customer.id, site, body))
      : null

    await stage('customer_intake_update', () => updateCustomerIntakeStatus(input.client.company_id, resolvedCustomerResult.customer.id, readiness))

    contract = await stage('contract_create', () => createContract(
      input.client.company_id,
      resolvedCustomerResult.customer.id,
      site?.id ?? null,
      meteringPoint?.id ?? null,
      body,
      readiness,
      customerNumber,
      publicOffer
    ))
    const identity = await stage('portal_identity_create', () => upsertPortalIdentity({
      client: input.client,
      customerId: resolvedCustomerResult.customer.id,
      externalCustomerId,
      externalAccountId: clean(body.external_account_id),
      email: normalizedEmail(body.customer.email),
    }))

    const applicationStatus = readiness.status

    const responsePayload = {
      customer_id: resolvedCustomerResult.customer.id,
      customer_number: customerNumber,
      application_number: applicationNumber,
      external_customer_id: externalCustomerId,
      portal_identity_id: identity.id,
      customer_site_id: site?.id ?? null,
      metering_point_id: meteringPoint?.id ?? null,
      contract_id: contract?.id ?? null,
      contract_number: contract?.contract_number ?? null,
      price_plan_id: contract?.price_plan_id ?? publicOffer?.price_plan_id ?? clean(body.price_plan_id) ?? clean(body.contract?.price_plan_id) ?? null,
      price_plan_version_id: contract?.price_plan_version_id ?? publicOffer?.price_plan_version_id ?? clean(body.price_plan_version_id) ?? clean(body.contract?.price_plan_version_id) ?? null,
      contract_price_snapshot_id: contract?.contract_price_snapshot_id ?? null,
      status: applicationStatus,
      created_customer: resolvedCustomerResult.created,
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
      resolution_id: energyResolution.resolution.resolutionId ?? null,
      resolution_status: energyResolution.resolution.resolutionStatus,
      resolution_confidence: energyResolution.resolution.confidence,
      grid_owner_verification_status: energyResolution.resolution.gridOwnerVerificationStatus ?? null,
      grid_owner_verification_issues: energyResolution.resolution.gridOwnerVerificationIssues ?? [],
      energy_resolution: energyResolution.resolution,
      can_request_grid_owner_information: readiness.canRequestGridOwnerInformation,
      can_start_switch: readiness.canStartSwitch,
      can_send_agreement_confirmation: readiness.canSendAgreementConfirmation,
      can_activate_customer: readiness.canActivateCustomer,
    }

    const initialTimeline = [
      timelineEvent('application_received', 'Ansökan mottagen från extern hemsida', {
        source: clean(body.source) ?? 'external_website',
        external_customer_id: externalCustomerId,
      }),
      ...(readiness.missingFields.length > 0
        ? [timelineEvent('needs_information', 'Ansökan behöver kompletteras', { missing_fields: readiness.missingFields })]
        : [timelineEvent('ready_for_switch', 'Ansökan är redo för intern kontroll', { next_step: readiness.nextStep })]),
    ]

    const application = await stage('application_record_create', () => createApplicationRow({
      client: input.client,
      externalCustomerId,
      externalAccountId: clean(body.external_account_id),
      customer: resolvedCustomerResult.customer,
      customerSiteId: site?.id ?? null,
      meteringPointId: meteringPoint?.id ?? null,
      contractId: contract?.id ?? null,
      contractNumber: contract?.contract_number ?? null,
      applicationNumber,
      pricePlanId: contract?.price_plan_id ?? publicOffer?.price_plan_id ?? clean(body.price_plan_id) ?? clean(body.contract?.price_plan_id) ?? null,
      pricePlanVersionId: contract?.price_plan_version_id ?? publicOffer?.price_plan_version_id ?? clean(body.price_plan_version_id) ?? clean(body.contract?.price_plan_version_id) ?? null,
      contractPriceSnapshotId: contract?.contract_price_snapshot_id ?? null,
      payload: body,
      rawPayload: input.rawBody,
      responsePayload,
      idempotencyKey: input.idempotencyKey ?? null,
      status: applicationStatus,
      warnings: readiness.warnings,
      missingFields: readiness.missingFields,
      blockingReasons: readiness.blockingReasons,
      nextStep: readiness.nextStep,
      requestedStartDate: readiness.requestedStartDate,
      confirmedStartDate: readiness.confirmedStartDate,
      actualStartDate: readiness.actualStartDate,
      requestedStartMode: readiness.requestedStartMode,
      calculatedEarliestStartDate: readiness.calculatedEarliestStartDate,
      resolutionId: energyResolution.resolution.resolutionId ?? null,
      gridAreaCode: readiness.gridAreaCode,
      gridOwnerId: energyResolution.resolution.gridOwnerId ?? null,
      priceAreaCode: readiness.priceArea,
      resolutionStatus: energyResolution.resolution.resolutionStatus,
      resolutionConfidence: energyResolution.resolution.confidence,
      timeline: initialTimeline,
      auditLog: [reviewAuditEvent('application_received', null, responsePayload)],
    }))

    await stage('legal_acceptance', () => persistCustomerLegalAcceptances({
      companyId: input.client.company_id,
      customerId: resolvedCustomerResult.customer.id,
      contractId: contract?.id ?? null,
      applicationId: application.id,
      publicOffer,
      legalVersions: legalAcceptanceVersions,
      consents: body.consents,
      rawPayload: input.rawBody,
    }))

    const gridOwnerRequest = readiness.canRequestGridOwnerInformation
      ? await stage('grid_owner_information_request', () => ensureGridOwnerInformationRequest({
          companyId: input.client.company_id,
          customerId: resolvedCustomerResult.customer.id,
          customerSiteId: site?.id ?? null,
          customerApplicationId: application.id,
          resolutionId: energyResolution.resolution.resolutionId ?? null,
          gridOwnerId: energyResolution.resolution.gridOwnerId ?? null,
          gridAreaCode: readiness.gridAreaCode,
          priceArea: readiness.priceArea,
        }))
      : null

    if (gridOwnerRequest?.requestId) {
      await supabaseService
        .from('website_customer_applications')
        .update({
          grid_owner_information_request_id: gridOwnerRequest.requestId,
          status: gridOwnerRequest.status === 'ready_to_send' ? 'information_request_ready' : applicationStatus,
          response_payload: {
            ...responsePayload,
            grid_owner_information_request_id: gridOwnerRequest.requestId,
            grid_owner_information_request_status: gridOwnerRequest.status,
            grid_owner_information_request_channel: gridOwnerRequest.channel,
          },
          next_step: gridOwnerRequest.nextStep,
          updated_at: new Date().toISOString(),
        })
        .eq('id', application.id)
        .eq('company_id', input.client.company_id)
    }

    const warnings: string[] = [...readiness.warnings, ...(gridOwnerRequest?.warnings ?? [])]
    let communicationResults: unknown[] = []

    const email = normalizedEmail(body.customer.email)
    if (email) {
      try {
        const company = await companyEmailContext(input.client.company_id)
        const variables = eventVariables({
          companyName: company.name,
          customer: resolvedCustomerResult.customer,
          rawCustomer: body.customer,
          customerNumber,
          siteId: site?.id ?? null,
          facilityId: site?.facility_id ?? clean(body.site?.facility_id),
          meteringPointId: meteringPoint?.metering_point_id ?? clean(body.metering_point?.metering_point_id),
          contractName: contract?.contract_name ?? clean(body.contract?.contract_name),
          startDate: readiness.requestedStartDate ?? contract?.starts_at ?? clean(body.contract?.starts_at) ?? clean(body.site?.move_in_date),
          supportEmail: company.supportEmail,
          portalUrl: company.portalUrl,
        })
        await seedDefaultEmailTemplates(input.client.company_id).catch(() => null)
        await seedDefaultEmailEventRules(input.client.company_id).catch(() => null)
        // Legacy webhook/event names such as contract.cooling_off_sent remain supported by outbox/docs,
        // but website intake sends only the canonical contract.application_received customer email.
        communicationResults = await Promise.all([
          triggerEmailEvent({
            companyId: input.client.company_id,
            customerId: resolvedCustomerResult.customer.id,
            siteId: site?.id ?? null,
            meteringPointId: meteringPoint?.id ?? null,
            eventKey: 'contract.application_received',
            to: email,
            variables,
            idempotencyKey: `website_application:${application.id}:contract.application_received`,
            metadata: {
              application_id: application.id,
              external_customer_id: externalCustomerId,
              customer_number: customerNumber,
              source: 'website_customer_applications',
            },
          }).catch((error) => [{ ok: false, error: errorMessage(error) }]),
        ])

        const flattenedResults = communicationResults.flatMap((item) => Array.isArray(item) ? item : [item]) as Array<{ ok?: boolean; error?: unknown }>
        if (flattenedResults.some((result) => result?.ok === false)) {
          warnings.push('confirmation_email_pending')
        }
      } catch (error: unknown) {
        warnings.push('confirmation_email_pending')
        communicationResults = [{ ok: false, error: errorMessage(error), stage: 'communication_trigger' }]
      }
    }

    try {
      await emitDomainEvent({
        companyId: input.client.company_id,
        eventType: resolvedCustomerResult.created ? 'customer.created' : 'customer.updated',
        aggregateType: 'customer',
        aggregateId: resolvedCustomerResult.customer.id,
        subjectCustomerId: resolvedCustomerResult.customer.id,
        source: 'website_customer_applications',
        idempotencyKey: input.idempotencyKey ? `website-customer:${input.client.company_id}:${input.idempotencyKey}:customer` : null,
        payload: {
          customer_number: customerNumber,
          external_customer_id: externalCustomerId,
          application_id: application.id,
          api_client_id: input.client.id,
          application_status: applicationStatus,
          missing_fields: readiness.missingFields,
          next_step: readiness.nextStep,
        },
      })

      if (contract?.id) {
        await emitDomainEvent({
          companyId: input.client.company_id,
          eventType: 'contract.application_received',
          aggregateType: 'customer_contract',
          aggregateId: contract.id,
          subjectCustomerId: resolvedCustomerResult.customer.id,
          source: 'website_customer_applications',
          idempotencyKey: input.idempotencyKey ? `website-contract:${input.client.company_id}:${input.idempotencyKey}` : null,
          payload: {
            customer_number: customerNumber,
            external_customer_id: externalCustomerId,
            contract_id: contract.id,
            application_id: application.id,
            communication_results: communicationResults,
            application_status: applicationStatus,
            missing_fields: readiness.missingFields,
            next_step: readiness.nextStep,
          },
        })
      }
    } catch (error) {
      warnings.push('domain_event_pending')
      await supabaseService
        .from('website_customer_applications')
        .update({ warnings, updated_at: new Date().toISOString() })
        .eq('id', application.id)
        .then(() => null)
      console.warn('[website-applications] domain event/webhook enqueue failed', error)
    }

    if (warnings.length > 0) {
      await supabaseService
        .from('website_customer_applications')
        .update({ warnings, updated_at: new Date().toISOString() })
        .eq('id', application.id)
        .then(() => null)
    }

    return successResponse({
      ...responsePayload,
      application_id: application.id,
      communication: {
        triggered: email ? ['contract.application_received'] : [],
        results: communicationResults,
      },
    }, warnings)
  } catch (error) {
    const appError = error instanceof WebsiteApplicationError
      ? error
      : new WebsiteApplicationError({ message: errorMessage(error), status: 500, code: 'internal_error', stage: 'application_record_create' })

    const safeErrorMessage = operationalErrorMessage(appError)
    const controlledBusinessError = isControlledBusinessError(appError)
    const businessStatus = controlledBusinessError ? controlledBusinessStatus(appError) : 'failed'
    const businessNextStep = controlledBusinessError ? controlledBusinessNextStep(appError) : 'Tekniskt fel kräver åtgärd innan ansökan kan fortsätta.'
    const failedBlockingReasons = [
      ...readiness.blockingReasons,
      controlledBusinessError ? controlledBusinessBlockingReason(appError) : technicalBlockingReason(appError),
    ]
    const failedApplication = await createApplicationRow({
      client: input.client,
      externalCustomerId,
      externalAccountId: clean(body.external_account_id),
      customer: customerResult?.customer ?? null,
      customerSiteId: site?.id ?? null,
      meteringPointId: meteringPoint?.id ?? null,
      contractId: contract?.id ?? null,
      contractNumber: contract?.contract_number ?? null,
      applicationNumber,
      pricePlanId: contract?.price_plan_id ?? publicOffer?.price_plan_id ?? clean(body.price_plan_id) ?? clean(body.contract?.price_plan_id) ?? null,
      pricePlanVersionId: contract?.price_plan_version_id ?? publicOffer?.price_plan_version_id ?? clean(body.price_plan_version_id) ?? clean(body.contract?.price_plan_version_id) ?? null,
      contractPriceSnapshotId: contract?.contract_price_snapshot_id ?? null,
      payload: body,
      rawPayload: input.rawBody,
      responsePayload: {
        error: safeErrorMessage,
        code: appError.code,
        error_stage: appError.stage,
        status: businessStatus,
        missing_fields: readiness.missingFields,
        blocking_reasons: failedBlockingReasons,
        next_step: businessNextStep,
        requested_start_date: readiness.requestedStartDate,
        confirmed_start_date: readiness.confirmedStartDate,
        actual_start_date: readiness.actualStartDate,
        can_start_switch: false,
        can_send_agreement_confirmation: false,
        can_activate_customer: false,
      },
      idempotencyKey: input.idempotencyKey ?? null,
      status: businessStatus,
      errorStage: appError.stage,
      errorCode: appError.code,
      errorMessage: safeErrorMessage,
      missingFields: readiness.missingFields,
      blockingReasons: failedBlockingReasons,
      nextStep: businessNextStep,
      requestedStartDate: readiness.requestedStartDate,
      confirmedStartDate: readiness.confirmedStartDate,
      actualStartDate: readiness.actualStartDate,
      timeline: [
        timelineEvent('application_received', 'Ansökan mottagen från extern hemsida', {
          source: clean(body.source) ?? 'external_website',
          external_customer_id: externalCustomerId,
        }),
        timelineEvent(controlledBusinessError ? businessStatus : 'failed', safeErrorMessage, { error_stage: appError.stage, error_code: appError.code, next_step: businessNextStep }),
      ],
      auditLog: [reviewAuditEvent('application_failed', null, {
        error_stage: appError.stage,
        error_code: appError.code,
        error_message: safeErrorMessage,
      })],
      warnings: readiness.warnings,
    }).catch((failedInsertError) => {
      console.warn('[website-applications] failed to log failed application', failedInsertError)
      return null
    })

    if (controlledBusinessError && failedApplication?.id) {
      const mapped = mapFacilityBusinessError(controlledBusinessErrorCode(appError), { message: safeErrorMessage })
      await recordFacilityDataIssue({
        companyId: input.client.company_id,
        customerId: customerResult?.customer?.id ?? null,
        customerSiteId: site?.id ?? null,
        meteringPointRowId: meteringPoint?.id ?? null,
        customerApplicationId: failedApplication.id,
        facilityId: site?.facility_id ?? clean(body.site?.facility_id),
        meteringPointId: meteringPoint?.metering_point_id ?? clean(body.metering_point?.metering_point_id),
        gridAreaCode: readiness.gridAreaCode,
        priceArea: readiness.priceArea,
        source: 'website_customer_application',
        sourceErrorCode: appError.code,
        sourceErrorText: safeErrorMessage,
        error: mapped,
        metadata: {
          external_customer_id: externalCustomerId,
          error_stage: appError.stage,
          details: appError.details ?? null,
        },
      }).catch((issueError) => {
        console.warn('[website-applications] failed to record facility data issue', issueError)
      })

      return successResponse({
        application_id: failedApplication.id,
        status: businessStatus,
        error: safeErrorMessage,
        code: appError.code,
        error_stage: appError.stage,
        next_step: businessNextStep,
        can_start_switch: false,
        requires_new_readiness_check: true,
      }, [...readiness.warnings, appError.code])
    }

    return failureResponse(appError)
  }
}
