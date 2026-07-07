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
import { normalizeGridOwnerIdToOps } from '@/lib/grid-owners/platformGridOwnerResolver'
import { processWebsiteApplicationIntake, type CustomerIntakeDecision } from '@/lib/customer-operations/customerIntakeOrchestrator'
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
import { ensureCustomerPortalUserLink } from '@/lib/customer-portal/customerResolver'
import { applyCustomerSiteAddressCandidate, createOrUpdateCustomerSiteFromAddress } from '@/lib/customer-sites/addressIntake'
import { enqueueCustomerDataRequestAutomation } from '@/lib/customer-operations/automation'
import { ensureCustomerApplicationWorkflow, transitionCustomerApplicationWorkflow } from '@/lib/website/applicationWorkflow'
import { commitApplicationProvisioning, failApplicationProvisioning } from '@/lib/website/provisioningSaga'
import { buildPublicLegalUrl, loadCompanySlugById } from '@/lib/legal/publicLegalDocuments'
import { normalizeCustomerType } from '@/lib/customers/normalizeCustomerType'
import { matchCustomerIdentity, type CustomerMatchDecision } from '@/lib/customers/matchingService'

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
  offer_reference: OPTIONAL_TEXT,
  offerReference: OPTIONAL_TEXT,
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

// Structured power of attorney object accepted by the website API. The API must
// NOT accept only `powerOfAttorney: true`; it accepts a structured object with
// signer/scope/method/evidence. The frontend-provided legal text is never
// trusted — the active legal/fullmakt text is loaded by textVersionId.
const PowerOfAttorneySchema = z.object({
  accepted: z.coerce.boolean().optional(),
  scope: z.array(z.string()).optional(),
  signerName: OPTIONAL_TEXT,
  signer_name: OPTIONAL_TEXT,
  signerIdentityNumber: OPTIONAL_TEXT,
  signer_identity_number: OPTIONAL_TEXT,
  method: OPTIONAL_TEXT,
  acceptedAt: OPTIONAL_TEXT,
  accepted_at: OPTIONAL_TEXT,
  textVersionId: OPTIONAL_TEXT,
  text_version_id: OPTIONAL_TEXT,
  ipAddress: OPTIONAL_TEXT,
  ip_address: OPTIONAL_TEXT,
  userAgent: OPTIONAL_TEXT,
  user_agent: OPTIONAL_TEXT,
}).optional()

const ApplicationSchema = z.object({
  offer_reference: OPTIONAL_TEXT,
  offerReference: OPTIONAL_TEXT,
  external_customer_id: OPTIONAL_TEXT,
  customer_external_id: OPTIONAL_TEXT,
  external_account_id: OPTIONAL_TEXT,
  auth_user_id: OPTIONAL_TEXT,
  customer_portal_user_id: OPTIONAL_TEXT,
  web_auth_user_id: OPTIONAL_TEXT,
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
  legalAcceptances: z.array(z.record(z.unknown())).optional(),
  legal_acceptances: z.array(z.record(z.unknown())).optional(),
  powerOfAttorney: PowerOfAttorneySchema,
  power_of_attorney: PowerOfAttorneySchema,
  metadata: z.record(z.unknown()).optional(),
})

type StructuredPowerOfAttorney = z.infer<typeof PowerOfAttorneySchema>

type NormalizedStructuredPoa = {
  accepted: boolean
  scope: string[]
  signerName: string | null
  signerIdentityNumber: string | null
  method: string | null
  acceptedAt: string | null
  textVersionId: string | null
  ipAddress: string | null
  userAgent: string | null
}

// Normalizes the structured powerOfAttorney object (camel or snake case).
function normalizeStructuredPoa(body: ApplicationInput): NormalizedStructuredPoa | null {
  const raw = (body.powerOfAttorney ?? body.power_of_attorney) as StructuredPowerOfAttorney | undefined
  if (!raw) return null
  const pick = (a: unknown, b: unknown) => (typeof a === 'string' && a.trim() ? a.trim() : typeof b === 'string' && b.trim() ? b.trim() : null)
  return {
    accepted: raw.accepted === true,
    scope: Array.isArray(raw.scope) ? raw.scope.map((value) => String(value)) : [],
    signerName: pick(raw.signerName, raw.signer_name),
    signerIdentityNumber: pick(raw.signerIdentityNumber, raw.signer_identity_number),
    method: pick(raw.method, null),
    acceptedAt: pick(raw.acceptedAt, raw.accepted_at),
    textVersionId: pick(raw.textVersionId, raw.text_version_id),
    ipAddress: pick(raw.ipAddress, raw.ip_address),
    userAgent: pick(raw.userAgent, raw.user_agent),
  }
}

function structuredPoaIsExternallySendable(poa: NormalizedStructuredPoa | null): boolean {
  return Boolean(poa?.accepted === true && poa.signerName && poa.signerIdentityNumber && poa.method)
}

function validateStructuredPoaForExternalSendability(poa: NormalizedStructuredPoa | null): WebsiteApplicationError | null {
  if (!poa?.accepted) return null

  const missing: Array<{ field: string; label: string }> = []
  if (!poa.signerName) missing.push({ field: 'powerOfAttorney.signerName', label: 'signerName' })
  if (!poa.signerIdentityNumber) missing.push({ field: 'powerOfAttorney.signerIdentityNumber', label: 'signerIdentityNumber' })
  if (!poa.method) missing.push({ field: 'powerOfAttorney.method', label: 'method' })

  if (missing.length === 0) return null

  return validationError(
    `Strukturerad fullmakt är markerad accepted=true men saknar ${missing.map((item) => item.label).join(', ')}. Skicka signerName, signerIdentityNumber och method eller skicka bara legacy consent som intern, icke sändbar accept.`,
    missing[0]?.field ?? 'powerOfAttorney',
    'Automatisk nätägarkommunikation kräver komplett strukturerad powerOfAttorney. Legacy consents.power_of_attorney=true blir aldrig externt sändbar.',
  )
}

type ApplicationInput = z.infer<typeof ApplicationSchema>


type WebsiteLegalAcceptanceVersion = {
  id: string
  type: string
  version: string
  title: string
  body: string | null
  published_at: string | null
  status?: string | null
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

function hasStoredAcceptance(acceptanceIds: Record<string, string>, legalType: string) {
  return typeof acceptanceIds[legalType] === 'string' && acceptanceIds[legalType].trim().length > 0
}

function contractLegalMailEvidenceReady(input: {
  acceptanceIds: Record<string, string>
  powerOfAttorneyRequired: boolean
  powerOfAttorneyId?: string | null
}) {
  return Boolean(
    hasStoredAcceptance(input.acceptanceIds, 'terms') &&
    hasStoredAcceptance(input.acceptanceIds, 'privacy_policy') &&
    hasStoredAcceptance(input.acceptanceIds, 'withdrawal') &&
    hasStoredAcceptance(input.acceptanceIds, 'price_terms') &&
    (!input.powerOfAttorneyRequired || (
      hasStoredAcceptance(input.acceptanceIds, 'power_of_attorney') &&
      typeof input.powerOfAttorneyId === 'string' &&
      input.powerOfAttorneyId.trim().length > 0
    ))
  )
}

function resultList(value: unknown): Array<Record<string, unknown>> {
  const items = Array.isArray(value) ? value : [value]
  return items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
}

function emailTriggerSucceeded(value: unknown): boolean {
  const items = resultList(value)
  return items.length > 0 && items.every((item) => item.ok !== false)
}

function emailTriggerErrorText(value: unknown): string {
  const values = resultList(value)
    .map((item) => typeof item.error === 'string' ? item.error : typeof item.error === 'object' && item.error !== null && 'message' in item.error ? String((item.error as { message?: unknown }).message ?? '') : '')
    .filter(Boolean)
  return values.join(' | ')
}

function pushWarning(warnings: string[], warning: string) {
  if (!warnings.includes(warning)) warnings.push(warning)
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
  if (versions === null) {
    // Legal evidence is mandatory for website applications. A schema mismatch
    // that prevents OPS from reading published legal versions must fail clearly
    // rather than silently skipping legal acceptances.
    throw new WebsiteApplicationError({
      message: 'Hemsidan kan inte ta emot avtal eftersom OPS inte kunde läsa publicerade juridiska versioner.',
      status: 500,
      code: 'legal_bundle_missing',
      field: 'legal_text_versions',
      stage: 'legal_acceptance',
      hint: 'Kör senaste migration så att legal_text_versions finns och publicera juridiska versioner i bolagskortet.',
    })
  }

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
  requestAudit?: RequestAuditMetadata
}): Promise<Record<string, string>> {
  if (input.legalVersions.length === 0) return {}
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
      accepted_ip: input.requestAudit?.ipAddress ?? null,
      accepted_ip_hash: input.requestAudit?.ipHash ?? null,
      accepted_user_agent: input.requestAudit?.userAgent ?? null,
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
        request_audit: input.requestAudit ?? {},
        raw_payload: input.rawPayload,
      },
    }
  }).filter(Boolean)

  const { data, error } = await supabaseService
    .from('customer_legal_acceptances')
    .insert(rows)
    .select('id,acceptance_type')
  if (error) {
    // Required legal evidence — a schema mismatch must fail clearly so we never
    // persist a "complete" customer without recorded legal acceptances.
    if (missingSchema(error)) {
      throw new WebsiteApplicationError({
        message: 'Juridiska godkännanden kunde inte sparas eftersom databasens schema för customer_legal_acceptances inte matchar.',
        status: 500,
        code: 'legal_bundle_missing',
        field: 'customer_legal_acceptances',
        stage: 'legal_acceptance',
        hint: 'Kör senaste migration för customer_legal_acceptances och retrya ansökan.',
        details: schemaErrorDetail(error),
      })
    }
    throw error
  }

  // Map acceptance_type -> id, keyed back to the canonical legal type so the
  // API response can expose legal_acceptances ids.
  const acceptanceTypeToLegalType = new Map(
    REQUIRED_WEBSITE_LEGAL_ACCEPTANCES.map((item) => [item.acceptanceType, item.legalType]),
  )
  const ids: Record<string, string> = {}
  for (const acceptanceRow of (data ?? []) as Array<{ id: string; acceptance_type: string }>) {
    const legalType = acceptanceTypeToLegalType.get(acceptanceRow.acceptance_type)
    if (legalType && acceptanceRow.id) ids[legalType] = String(acceptanceRow.id)
  }
  return ids
}

// Loads a specific legal text version by id, scoped to the tenant. Used so the
// website API binds the POA to the active legal text it references rather than
// any text supplied by the frontend.
async function loadLegalTextVersionById(
  companyId: string,
  textVersionId: string | null,
): Promise<WebsiteLegalAcceptanceVersion | null> {
  if (!textVersionId) return null
  if (!isUuid(textVersionId)) {
    throw new WebsiteApplicationError({
      message: 'Angiven fullmaktsversion (textVersionId) måste vara OPS legal_text_versions.id i UUID-format, inte ett versionsnamn.',
      status: 422,
      code: 'power_of_attorney_version_invalid',
      field: 'powerOfAttorney.textVersionId',
      stage: 'power_of_attorney',
      hint: 'Hämta legal.power_of_attorney_version_id från GET /api/v1/website/public-contracts och skicka det som powerOfAttorney.textVersionId.',
      details: { expected: 'uuid', received_format: 'version_label_or_invalid_uuid' },
    })
  }
  const { data, error } = await supabaseService
    .from('legal_text_versions')
    .select('id,type,version,title,body,published_at,status')
    .eq('company_id', companyId)
    .eq('id', textVersionId)
    .maybeSingle()
  if (error) {
    if (missingSchema(error)) {
      throw new WebsiteApplicationError({
        message: 'Fullmaktsversionen kunde inte läsas eftersom databasens schema för legal_text_versions inte matchar.',
        status: 500,
        code: 'legal_bundle_missing',
        field: 'legal_text_versions',
        stage: 'legal_acceptance',
        hint: 'Kör senaste migration för legal_text_versions och retrya ansökan.',
        details: schemaErrorDetail(error),
      })
    }
    throw error
  }
  return (data as WebsiteLegalAcceptanceVersion | null) ?? null
}

async function ensureWebsitePowerOfAttorney(input: {
  companyId: string
  customerId: string
  contractId: string | null
  customerSiteId: string | null
  meteringPointId: string | null
  applicationId: string
  publicOffer: PublicContractOffer | null
  legalVersions: WebsiteLegalAcceptanceVersion[]
  consents?: Record<string, unknown>
  requestAudit?: RequestAuditMetadata
  rawPayload: unknown
  structuredPoa?: NormalizedStructuredPoa | null
}) {
  if (!consentAccepted(input.consents, ['power_of_attorney', 'poa_accepted', 'power_of_attorney_accepted'])) return null
  // Never trust frontend legal text: prefer the explicitly referenced active
  // legal version (textVersionId), then the published power_of_attorney version.
  const requestedVersionId = input.structuredPoa?.textVersionId ?? null
  let referencedLegal: WebsiteLegalAcceptanceVersion | null = null
  if (requestedVersionId) {
    // loadLegalTextVersionById throws on schema mismatch, so a null result here
    // means the supplied textVersionId does not belong to this tenant.
    referencedLegal = await loadLegalTextVersionById(input.companyId, requestedVersionId)
    if (!referencedLegal) {
      throw new WebsiteApplicationError({
        message: 'Angiven fullmaktsversion (textVersionId) tillhör inte detta bolag eller finns inte.',
        status: 422,
        code: 'power_of_attorney_version_tenant_mismatch',
        field: 'powerOfAttorney.textVersionId',
        stage: 'power_of_attorney',
        hint: 'Skicka en textVersionId som tillhör samma bolag som API-nyckeln, eller utelämna fältet så används den publicerade fullmaktsversionen.',
      })
    }
    if (referencedLegal.type !== 'power_of_attorney') {
      throw new WebsiteApplicationError({
        message: 'Angiven textVersionId refererar inte till en fullmaktsversion.',
        status: 422,
        code: 'power_of_attorney_version_missing',
        field: 'powerOfAttorney.textVersionId',
        stage: 'power_of_attorney',
      })
    }
    if (referencedLegal.status && referencedLegal.status !== 'published') {
      throw new WebsiteApplicationError({
        message: 'Angiven fullmaktsversion är inte publicerad.',
        status: 422,
        code: 'power_of_attorney_version_not_published',
        field: 'powerOfAttorney.textVersionId',
        stage: 'power_of_attorney',
        hint: 'Publicera fullmaktsversionen i bolagskortet innan kunder kan acceptera den.',
      })
    }
  }
  const legal = referencedLegal ?? input.legalVersions.find((row) => row.type === 'power_of_attorney')
  if (!legal) {
    // POA consent was given (gated above) but no published power_of_attorney
    // legal version exists for this tenant. This must fail clearly.
    throw new WebsiteApplicationError({
      message: 'Det finns ingen publicerad fullmaktsversion för bolaget, men kunden har accepterat fullmakt.',
      status: 422,
      code: 'power_of_attorney_version_missing',
      field: 'powerOfAttorney',
      stage: 'power_of_attorney',
      hint: 'Publicera en power_of_attorney-version i bolagskortet i OPS.',
    })
  }

  const now = new Date().toISOString()
  const submittedStructuredPoaIsSendable = structuredPoaIsExternallySendable(input.structuredPoa ?? null)
  let existingQuery = supabaseService
    .from('powers_of_attorney')
    .select('id,signer_name,signer_identity_number,method,evidence_payload,metadata')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('scope', 'supplier_switch')
    .in('status', ['active', 'accepted', 'signed'])

  existingQuery = input.contractId
    ? existingQuery.eq('contract_id', input.contractId)
    : existingQuery.is('contract_id', null)

  const existing = await existingQuery.limit(1).maybeSingle()

  if (existing.error && !missingSchema(existing.error)) throw existing.error
  if (existing.data?.id) {
    const existingEvidence = existing.data.evidence_payload as Record<string, unknown> | null | undefined
    const existingMetadata = existing.data.metadata as Record<string, unknown> | null | undefined
    const existingIsStructuredComplete =
      existingEvidence?.capture_type === 'structured_complete' ||
      existingEvidence?.externally_sendable_at_capture === true ||
      existingMetadata?.poa_capture_type === 'structured_complete' ||
      existingMetadata?.externally_sendable === true
    const existingLooksSendable = Boolean(
      clean(existing.data.signer_name) &&
      clean(existing.data.signer_identity_number) &&
      clean(existing.data.method) &&
      existingIsStructuredComplete,
    )
    // Reuse weak/legacy rows for weak submissions, and reuse complete rows for
    // complete submissions. If a customer later submits a complete structured
    // POA after an older weak one, insert a fresh complete row instead of
    // letting the weak row block external sendability.
    if (!submittedStructuredPoaIsSendable || existingLooksSendable) {
      const existingPowerOfAttorneyId = String(existing.data.id)
      await ensureWebsiteAuthorizationChainFromPowerOfAttorney({
        companyId: input.companyId,
        customerId: input.customerId,
        contractId: input.contractId,
        customerSiteId: input.customerSiteId,
        meteringPointId: input.meteringPointId,
        powerOfAttorneyId: existingPowerOfAttorneyId,
        applicationId: input.applicationId,
        reference: `POA-${input.applicationId}`,
        scopes: input.structuredPoa?.scope?.length ? input.structuredPoa.scope : ['supplier_switch', 'facility_information_lookup'],
        legal,
        snapshot: {
          source: 'website_customer_applications',
          application_id: input.applicationId,
          reused_power_of_attorney_id: existingPowerOfAttorneyId,
          legal_text: { id: legal.id, type: legal.type, version: legal.version, title: legal.title },
        },
        evidencePayload: { reused: true, legal_text_version_id: legal.id, source: 'website_api' },
      })
      return existingPowerOfAttorneyId
    }
  }

  const poa = input.structuredPoa?.accepted === true ? input.structuredPoa : null
  const externallySendableAtCapture = structuredPoaIsExternallySendable(poa)
  const scopes = poa && poa.scope.length > 0 ? poa.scope : ['supplier_switch', 'facility_information_lookup']
  const acceptedAt = poa?.acceptedAt ?? now
  const method = poa?.method ?? null
  // Legacy consent-only creates an internal legal acceptance only. It must not
  // silently inherit signer name, identity number or method from the customer
  // record, because that would make a weak consent look externally sendable.
  const signerName = poa?.signerName ?? null
  const signerIdentityNumber = poa?.signerIdentityNumber ?? null

  const snapshot = {
    legal_text: {
      id: legal.id,
      type: legal.type,
      version: legal.version,
      title: legal.title,
      body: legal.body,
      published_at: legal.published_at,
    },
    public_offer: input.publicOffer,
    consents: input.consents ?? {},
    application_id: input.applicationId,
    accepted_at: acceptedAt,
    scopes,
  }

  const evidencePayload = {
    accepted: true,
    accepted_at: acceptedAt,
    method,
    scopes,
    signer_name: signerName,
    signer_identity_number: signerIdentityNumber,
    ip_address: poa?.ipAddress ?? input.requestAudit?.ipAddress ?? null,
    user_agent: poa?.userAgent ?? input.requestAudit?.userAgent ?? null,
    legal_text_version_id: legal.id,
    legal_text_version: legal.version,
    source: 'website_api',
    externally_sendable_at_capture: externallySendableAtCapture,
    requires_completion: !externallySendableAtCapture,
    capture_type: externallySendableAtCapture ? 'structured_complete' : 'legacy_weak_consent',
  }

  const row = {
    company_id: input.companyId,
    customer_id: input.customerId,
    contract_id: input.contractId,
    site_id: input.customerSiteId,
    customer_site_id: input.customerSiteId,
    metering_point_id: input.meteringPointId,
    scope: 'supplier_switch',
    status: 'signed',
    signed_at: now,
    accepted_at: acceptedAt,
    valid_from: now.slice(0, 10),
    legal_text_version_id: legal.id,
    fullmakt_snapshot: snapshot,
    signer_name: signerName,
    signer_identity_number: signerIdentityNumber,
    method,
    evidence_payload: evidencePayload,
    source: 'website_api',
    accepted_ip: poa?.ipAddress ?? input.requestAudit?.ipAddress ?? null,
    accepted_ip_hash: input.requestAudit?.ipHash ?? null,
    accepted_user_agent: poa?.userAgent ?? input.requestAudit?.userAgent ?? null,
    accepted_source: 'website',
    reference: `POA-${input.applicationId}`,
    scope_summary: {
      scopes,
      supplier_switch: true,
      facility_information_lookup: scopes.includes('facility_information_lookup'),
      customer_site_id: input.customerSiteId,
      metering_point_id: input.meteringPointId,
      contract_id: input.contractId,
    },
    metadata: {
      source: 'website_customer_applications',
      application_id: input.applicationId,
      raw_payload: input.rawPayload,
      poa_capture_type: externallySendableAtCapture ? 'structured_complete' : 'legacy_weak_consent',
      externally_sendable: externallySendableAtCapture,
      requires_completion: !externallySendableAtCapture,
    },
    updated_at: now,
  }

  const { data, error } = await supabaseService
    .from('powers_of_attorney')
    .insert(row)
    .select('id')
    .maybeSingle()

  if (error) {
    // Do NOT silently swallow schema mismatches here. A required power of
    // attorney that cannot be persisted must fail the whole application so we
    // never produce a "complete" customer without legal authorization.
    if (missingSchema(error)) {
      throw new WebsiteApplicationError({
        message: 'Fullmakten kunde inte sparas eftersom databasens schema för powers_of_attorney inte matchar.',
        status: 500,
        code: 'powers_of_attorney_schema_mismatch',
        field: 'powers_of_attorney',
        stage: 'power_of_attorney',
        hint: 'Kör senaste migration för powers_of_attorney och retrya ansökan från admin.',
        details: schemaErrorDetail(error),
      })
    }
    throw error
  }

  const powerOfAttorneyId = data?.id ? String(data.id) : null
  if (powerOfAttorneyId) {
    const scopeResult = await supabaseService
      .from('power_of_attorney_scopes')
      .insert({
        company_id: input.companyId,
        power_of_attorney_id: powerOfAttorneyId,
        customer_id: input.customerId,
        site_id: input.customerSiteId,
        metering_point_id: input.meteringPointId,
        customer_contract_id: input.contractId,
        scope_type: 'supplier_switch',
        status: 'active',
        is_active: true,
        valid_from: now.slice(0, 10),
        metadata: { source: 'website_customer_applications', application_id: input.applicationId },
      })

    if (scopeResult.error && !missingSchema(scopeResult.error)) throw scopeResult.error

    // Immutable POA document snapshot (JSON) linked back onto the POA row.
    const documentId = await createPowerOfAttorneyDocumentSnapshot({
      companyId: input.companyId,
      customerId: input.customerId,
      contractId: input.contractId,
      customerSiteId: input.customerSiteId,
      meteringPointId: input.meteringPointId,
      powerOfAttorneyId,
      reference: row.reference,
      snapshot,
      evidencePayload,
    })
    const authorizationDocumentId = await ensureWebsiteAuthorizationChainFromPowerOfAttorney({
      companyId: input.companyId,
      customerId: input.customerId,
      contractId: input.contractId,
      customerSiteId: input.customerSiteId,
      meteringPointId: input.meteringPointId,
      powerOfAttorneyId,
      applicationId: input.applicationId,
      reference: row.reference,
      scopes,
      legal,
      snapshot,
      evidencePayload,
      internalSnapshotDocumentId: documentId,
    })

    if (authorizationDocumentId || documentId) {
      // The operational document_id must point at the authorization document chain
      // used by customer_info_requests/grid_owner_data_requests/outbound_requests.
      // The old customer_documents JSON snapshot is retained only as internal audit
      // metadata and must never be mailed to a grid owner as the POA attachment.
      await supabaseService
        .from('powers_of_attorney')
        .update({
          document_id: authorizationDocumentId ?? documentId,
          metadata: {
            ...row.metadata,
            authorization_document_id: authorizationDocumentId,
            internal_snapshot_document_id: documentId,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', powerOfAttorneyId)
        .then(() => undefined, () => undefined)
    }

    // Audit trail: created + accepted (+ internal JSON snapshot created). The
    // JSON snapshot is NOT a generated PDF, so it is recorded as
    // `snapshot_created`. A real `pdf_generated` event is only emitted when an
    // actual PDF is rendered for external grid-owner communication.
    await supabaseService.from('power_of_attorney_events').insert([
      { company_id: input.companyId, power_of_attorney_id: powerOfAttorneyId, event_type: 'created', payload: { application_id: input.applicationId, source: 'website_api' } },
      { company_id: input.companyId, power_of_attorney_id: powerOfAttorneyId, event_type: 'accepted', payload: evidencePayload },
      ...(documentId ? [{ company_id: input.companyId, power_of_attorney_id: powerOfAttorneyId, event_type: 'snapshot_created' as const, payload: { document_id: documentId, mime_type: 'application/json', internal_snapshot: true } }] : []),
    ]).then(() => undefined, () => undefined)
  }

  return powerOfAttorneyId
}

// Creates an immutable JSON document snapshot for a power of attorney and stores
// it in customer_documents (best-effort; tolerant of missing schema).
async function createPowerOfAttorneyDocumentSnapshot(input: {
  companyId: string
  customerId: string
  contractId: string | null
  customerSiteId: string | null
  meteringPointId: string | null
  powerOfAttorneyId: string
  reference: string
  snapshot: Record<string, unknown>
  evidencePayload: Record<string, unknown>
}): Promise<string | null> {
  const documentRow = {
    company_id: input.companyId,
    customer_id: input.customerId,
    customer_site_id: input.customerSiteId,
    metering_point_id: input.meteringPointId,
    contract_id: input.contractId,
    power_of_attorney_id: input.powerOfAttorneyId,
    document_type: 'power_of_attorney',
    title: `Signerad fullmakt ${input.reference}`,
    file_name: `fullmakt-${input.reference}.json`,
    mime_type: 'application/json',
    status: 'available',
    source: 'website_customer_applications',
    source_system: 'ops_powers_of_attorney',
    raw_payload: { snapshot: input.snapshot, evidence: input.evidencePayload },
    // Mark explicitly as the internal JSON snapshot. External grid-owner email
    // must attach a PDF (rendered or uploaded), never this JSON record.
    metadata: { document_kind: 'json_snapshot', internal_snapshot: true, external_pdf: false },
  }
  const { data, error } = await supabaseService
    .from('customer_documents')
    .insert(documentRow)
    .select('id')
    .maybeSingle()
  if (error) {
    if (missingSchema(error)) return null
    // Document storage is non-fatal for the POA write path.
    return null
  }
  return data?.id ? String(data.id) : null
}

async function ensureWebsiteAuthorizationChainFromPowerOfAttorney(input: {
  companyId: string
  customerId: string
  contractId: string | null
  customerSiteId: string | null
  meteringPointId: string | null
  powerOfAttorneyId: string
  applicationId: string
  reference: string
  scopes: string[]
  legal: WebsiteLegalAcceptanceVersion
  snapshot: Record<string, unknown>
  evidencePayload: Record<string, unknown>
  internalSnapshotDocumentId?: string | null
}): Promise<string | null> {
  const now = new Date().toISOString()
  const existing = await supabaseService
    .from('customer_authorization_documents')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('power_of_attorney_id', input.powerOfAttorneyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing.error && !missingSchema(existing.error)) throw existing.error

  let authorizationDocumentId = existing.data?.id ? String(existing.data.id) : null
  if (!authorizationDocumentId) {
    const baseRow: Record<string, unknown> = {
      company_id: input.companyId,
      customer_id: input.customerId,
      site_id: input.customerSiteId,
      metering_point_id: input.meteringPointId,
      customer_contract_id: input.contractId,
      power_of_attorney_id: input.powerOfAttorneyId,
      document_type: 'power_of_attorney',
      status: 'uploaded',
      title: `Signerad fullmakt ${input.reference}`,
      file_name: `fullmakt-${input.reference}.json`,
      mime_type: 'application/json',
      reference: input.reference,
      notes: 'Website POA snapshot bound to operational authorization chain.',
      uploaded_at: now,
      metadata: {
        source: 'website_customer_applications',
        application_id: input.applicationId,
        legal_text_version_id: input.legal.id,
        legal_text_version: input.legal.version,
        scopes: input.scopes,
        snapshot: input.snapshot,
        evidence: input.evidencePayload,
        internal_snapshot_document_id: input.internalSnapshotDocumentId ?? null,
      },
    }

    let inserted = await supabaseService
      .from('customer_authorization_documents')
      .insert(baseRow)
      .select('id')
      .maybeSingle()

    if (inserted.error && missingSchema(inserted.error)) {
      const fallbackRow = { ...baseRow }
      delete fallbackRow.customer_contract_id
      inserted = await supabaseService
        .from('customer_authorization_documents')
        .insert(fallbackRow)
        .select('id')
        .maybeSingle()
    }

    if (inserted.error) {
      if (missingSchema(inserted.error)) {
        throw new WebsiteApplicationError({
          message: 'Fullmaktens authorization document kunde inte sparas eftersom customer_authorization_documents saknas eller har fel schema.',
          status: 500,
          code: 'customer_authorization_document_schema_mismatch',
          field: 'customer_authorization_documents',
          stage: 'power_of_attorney',
          hint: 'Kör senaste migration för customer_authorization_documents och authorization_scopes innan ansökan retryas.',
          details: schemaErrorDetail(inserted.error),
        })
      }
      throw inserted.error
    }
    authorizationDocumentId = inserted.data?.id ? String(inserted.data.id) : null
  }

  if (authorizationDocumentId) {
    const existingScope = await supabaseService
      .from('authorization_scopes')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .eq('authorization_document_id', authorizationDocumentId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle()
    if (existingScope.error && !missingSchema(existingScope.error)) throw existingScope.error

    if (!existingScope.data?.id) {
      const scopeInsert = await supabaseService
        .from('authorization_scopes')
        .insert({
          company_id: input.companyId,
          customer_id: input.customerId,
          authorization_document_id: authorizationDocumentId,
          scope_type: 'supplier_switch_data',
          status: 'active',
          covers_grid_owner_data: true,
          covers_current_supplier_contract: true,
          covers_metering_data: true,
          valid_from: now.slice(0, 10),
          evidence_note: 'Signerad website-fullmakt verifierad och kopplad till uppgifts-/leverantörsbytesflödet.',
          metadata: {
            source: 'website_customer_applications',
            application_id: input.applicationId,
            power_of_attorney_id: input.powerOfAttorneyId,
            authorization_document_id: authorizationDocumentId,
            scopes: input.scopes,
          },
        })
      if (scopeInsert.error) {
        if (missingSchema(scopeInsert.error)) {
          throw new WebsiteApplicationError({
            message: 'Fullmaktens authorization scope kunde inte sparas eftersom authorization_scopes saknas eller har fel schema.',
            status: 500,
            code: 'authorization_scope_schema_mismatch',
            field: 'authorization_scopes',
            stage: 'power_of_attorney',
            hint: 'Kör senaste migration för authorization_scopes innan ansökan retryas.',
            details: schemaErrorDetail(scopeInsert.error),
          })
        }
        throw scopeInsert.error
      }
    }
  }

  return authorizationDocumentId
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
  | 'portal_user_link'
  | 'site_create'
  | 'metering_point_create'
  | 'contract_create'
  | 'contract_snapshot_create'
  | 'public_contract_lookup'
  | 'legal_acceptance'
  | 'application_record_create'
  | 'application_workflow'
  | 'application_workflow_transition'
  | 'customer_data_automation'
  | 'customer_intake_orchestrator'
  | 'manual_information_request_summary'
  | 'communication_trigger'
  | 'domain_event_create'
  | 'webhook_queue'
  | 'customer_intake_update'
  | 'energy_resolution'
  | 'grid_owner_information_request'
  | 'manual_information_request'
  | 'manual_review'
  | 'power_of_attorney'
  | 'facility_lookup'
  | 'email_dispatch'

class WebsiteApplicationError extends Error {
  status: number
  code: string
  field?: string
  hint?: string
  stage: ErrorStage
  details?: unknown
  action?: string

  constructor(input: {
    message: string
    status?: number
    code?: string
    field?: string
    hint?: string
    stage?: ErrorStage
    details?: unknown
    action?: string
  }) {
    super(input.message)
    this.name = 'WebsiteApplicationError'
    this.status = input.status ?? 500
    this.code = input.code ?? 'website_application_error'
    this.field = input.field
    this.hint = input.hint
    this.stage = input.stage ?? 'validation'
    this.details = input.details
    this.action = input.action
  }
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

// Like clean(), but only returns values safe to write into uuid columns.
// Non-UUID inputs (e.g. human-readable version names) are dropped instead of
// crashing the insert with `invalid input syntax for type uuid`.
function cleanUuid(value: unknown): string | null {
  const cleaned = clean(value)
  return isUuid(cleaned) ? cleaned : null
}

function duplicateIdempotencyKey(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const details = (error as { details?: string } | null)?.details ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return code === '23505' && /website_customer_applications_company_idempotency_uidx|company_id, idempotency_key/i.test(`${details} ${message}`)
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
  return ['42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist|could not find the function/i.test(message)
}

function schemaRepairStatus(error: unknown): 'pending_review' | null {
  return missingSchema(error) ? 'pending_review' : null
}

function websiteNextActionFromIntake(decision: CustomerIntakeDecision): { code: string; message: string } {
  const blocker = decision.blockers[0] ?? null
  if (decision.nextAction === 'wait_for_grid_owner' || decision.state === 'facility_lookup_waiting_response') {
    return { code: 'facility_identifier_requested', message: 'Anläggnings-ID saknas. Uppgifter har begärts från nätägaren via e-post.' }
  }
  if (decision.nextAction === 'request_facility_data' || decision.state === 'needs_facility_lookup') {
    return { code: 'facility_identifier_required', message: decision.customerMessage || 'Anläggnings-ID saknas. Uppgifter behöver begäras från nätägaren.' }
  }
  if (decision.nextAction === 'start_supplier_switch' || decision.state === 'ready_for_supplier_switch') {
    return { code: 'ready_for_switch', message: decision.customerMessage || 'Ansökan är klar för leverantörsbyte.' }
  }
  if (blocker?.code) {
    return { code: blocker.code, message: blocker.message || decision.customerMessage || 'Ansökan behöver granskas innan vi kan gå vidare.' }
  }
  return { code: decision.nextAction, message: decision.customerMessage || decision.adminMessage || 'Ansökan behandlas.' }
}

async function loadWebsiteManualInformationRequest(requestId: string | null): Promise<Record<string, unknown> | null> {
  if (!requestId) return null
  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('id,status,case_reference,channel')
    .eq('id', requestId)
    .maybeSingle()
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  if (!data) return null
  return {
    status: clean((data as Record<string, unknown>).status),
    case_reference: clean((data as Record<string, unknown>).case_reference),
    channel: clean((data as Record<string, unknown>).channel),
    request_id: clean((data as Record<string, unknown>).id),
  }
}

// Builds a non-sensitive diagnostic detail from a database error. Only the
// Postgres/PostgREST error code and a truncated message are surfaced — never
// row data, identity numbers or payloads.
function schemaErrorDetail(error: unknown): { db_code: string | null; db_message: string | null } {
  const code = (error as { code?: string } | null)?.code ?? null
  const rawMessage = (error as { message?: string } | null)?.message ?? null
  const message = rawMessage ? rawMessage.slice(0, 300) : null
  return { db_code: code, db_message: message }
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
const WEBSITE_PORTAL_PROVIDER = 'gridex_website'

type RequestAuditMetadata = {
  ipAddress?: string | null
  ipHash?: string | null
  userAgent?: string | null
}


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
  metadata?: Record<string, unknown> | null
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
  pricePlanVersionId?: string | null
  idempotencyKey?: string | null
}): Promise<WebsiteContractRow | null> {
  const { data, error } = await supabaseService
    .from('customer_contracts')
    .select('id,contract_name,starts_at,status,site_id,customer_site_id,metering_point_id,requested_start_date,contract_number,price_plan_id,price_plan_version_id,confirmed_start_date,actual_start_date,metadata')
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
    const metadata = (row as unknown as { metadata?: unknown }).metadata
    const meta = isObject(metadata) ? metadata : {}
    if (input.idempotencyKey && meta.website_application_idempotency_key === input.idempotencyKey) return true

    const rowSiteId = row.customer_site_id ?? row.site_id ?? null
    const siteMatches = matchesExpectedValue(rowSiteId, input.siteId ?? null)
    const meterMatches = matchesExpectedValue(row.metering_point_id ?? null, input.meteringPointId ?? null)
    const dateMatches = matchesExpectedDate(row.requested_start_date ?? row.starts_at ?? null, input.requestedStartDate ?? null)
    const nameMatches = !input.contractName || !row.contract_name || row.contract_name === input.contractName
    const versionMatches = !input.pricePlanVersionId || !row.price_plan_version_id || row.price_plan_version_id === input.pricePlanVersionId
    return siteMatches && meterMatches && dateMatches && nameMatches && versionMatches
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

function explicitGridAreaCodeFromInput(input: ApplicationInput): string | null {
  return clean(input.site?.grid_area_code) ?? clean(input.site?.gridAreaCode) ?? clean(input.metering_point?.grid_area_code) ?? clean(input.metering_point?.gridAreaCode) ?? clean(input.grid_area_code) ?? clean(input.gridAreaCode)
}

function explicitPriceAreaCodeFromInput(input: ApplicationInput): string | null {
  return clean(input.site?.price_area_code) ?? clean(input.site?.price_area) ?? clean(input.metering_point?.price_area_code) ?? clean(input.metering_point?.price_area) ?? clean(input.price_area_code) ?? clean(input.priceAreaCode)
}

function explicitGridOwnerIdFromInput(input: ApplicationInput): string | null {
  return clean(input.site?.grid_owner_id) ?? clean(input.site?.gridOwnerId) ?? clean(input.grid_owner_id) ?? clean(input.network_owner_id)
}

const VALID_PRICE_AREAS = new Set(['SE1', 'SE2', 'SE3', 'SE4'])

function isValidExplicitPriceArea(value: string | null): value is string {
  return Boolean(value && VALID_PRICE_AREAS.has(value.toUpperCase()))
}

// Central merge rule for explicit vs resolved energy context:
// explicit valid submitted input always wins; the resolver (Papilite/geo/master
// lookup) may only enrich values that are missing. A resolver failure or a
// diverging resolver result must never null or replace valid explicit input.
// Explicit grid owner ids are pre-normalized to the OPS grid_owners namespace
// (customer_sites.grid_owner_id must never store platform_grid_owners.id).
function mergeResolverWithExplicitInput(
  input: ApplicationInput,
  resolution: EnergyResolverResult,
  explicitGridOwner?: { opsGridOwnerId: string | null; warnings: string[] },
): EnergyResolverResult {
  const explicitGridAreaCode = explicitGridAreaCodeFromInput(input)
  const explicitPriceAreaCodeRaw = explicitPriceAreaCodeFromInput(input)
  const explicitPriceAreaCode = isValidExplicitPriceArea(explicitPriceAreaCodeRaw) ? explicitPriceAreaCodeRaw.toUpperCase() : null
  const gridAreaDisagrees = Boolean(explicitGridAreaCode && resolution.gridAreaCode && resolution.gridAreaCode !== explicitGridAreaCode)
  const priceAreaDisagrees = Boolean(explicitPriceAreaCode && resolution.priceArea && resolution.priceArea !== explicitPriceAreaCode)
  return {
    ...resolution,
    gridAreaCode: explicitGridAreaCode ?? resolution.gridAreaCode,
    priceArea: (explicitPriceAreaCode as EnergyResolverResult['priceArea'] | null) ?? resolution.priceArea,
    gridOwnerId: explicitGridOwner?.opsGridOwnerId ?? resolution.gridOwnerId,
    sourceChain: Array.from(new Set([
      ...(explicitGridAreaCode ? ['input.explicit_grid_area_code'] : []),
      ...resolution.sourceChain,
    ])),
    warnings: Array.from(new Set([
      ...resolution.warnings,
      ...(explicitGridOwner?.warnings ?? []),
      ...(resolution.gridAreaCode || !explicitGridAreaCode ? [] : ['explicit_grid_area_code_preserved_without_master_match']),
      ...(resolution.priceArea || !explicitPriceAreaCode ? [] : ['explicit_price_area_code_preserved']),
      ...(gridAreaDisagrees ? ['resolver_grid_area_disagrees_with_explicit_input'] : []),
      ...(priceAreaDisagrees ? ['resolver_price_area_disagrees_with_explicit_input'] : []),
    ])),
  }
}

function enrichApplicationWithEnergyResolution(input: ApplicationInput, resolution: EnergyResolverResult): ApplicationInput {
  const requestedStartMode = requestedStartModeFromInput(input)
  const calculatedStart = requestedStartMode === 'earliest_possible'
    ? clean(input.calculated_earliest_start_date) ?? clean(input.calculatedEarliestStartDate) ?? clean(input.contract?.calculated_earliest_start_date) ?? clean(input.contract?.calculatedEarliestStartDate) ?? calculatedEarliestStartDate()
    : undefined
  return {
    ...input,
    // grid_owner_id intentionally never falls back to the raw explicit input:
    // the merged resolution already carries the OPS-normalized owner id, and a
    // raw explicit id could reference the platform_grid_owners namespace.
    grid_owner_id: resolution.gridOwnerId ?? undefined,
    grid_area_code: resolution.gridAreaCode ?? explicitGridAreaCodeFromInput(input) ?? undefined,
    price_area_code: resolution.priceArea ?? explicitPriceAreaCodeFromInput(input) ?? undefined,
    resolution_status: resolution.resolutionStatus,
    grid_owner_verification_status: resolution.gridOwnerVerificationStatus ?? undefined,
    requested_start_mode: requestedStartMode,
    calculated_earliest_start_date: calculatedStart,
    site: input.site ? {
      ...input.site,
      grid_area_code: resolution.gridAreaCode ?? explicitGridAreaCodeFromInput(input) ?? undefined,
      grid_owner_id: resolution.gridOwnerId ?? undefined,
      grid_owner_verification_status: resolution.gridOwnerVerificationStatus ?? undefined,
      price_area_code: resolution.priceArea ?? explicitPriceAreaCodeFromInput(input) ?? undefined,
      latitude: resolution.coordinates?.latitude ?? undefined,
      longitude: resolution.coordinates?.longitude ?? undefined,
      sweref99_x: resolution.coordinates?.sweref99X ?? undefined,
      sweref99_y: resolution.coordinates?.sweref99Y ?? undefined,
    } : input.site,
    metering_point: input.metering_point ? {
      ...input.metering_point,
      grid_area_code: resolution.gridAreaCode ?? explicitGridAreaCodeFromInput(input) ?? input.metering_point.grid_area_code ?? input.metering_point.gridAreaCode,
      price_area_code: resolution.priceArea ?? explicitPriceAreaCodeFromInput(input) ?? input.metering_point.price_area_code ?? input.metering_point.price_area,
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
    street: clean(body.site?.street),
    postalCode: clean(body.site?.postal_code),
    city: clean(body.site?.city),
    country: clean(body.site?.country) ?? 'SE',
    gridAreaCode: explicitGridAreaCodeFromInput(body),
    facilityId: clean(body.site?.facility_id),
    meteringPointId: clean(body.metering_point?.metering_point_id) ?? clean(body.metering_point?.meter_point_id) ?? clean(body.metering_point?.ediel_metering_point_id) ?? clean(body.metering_point?.anlage_id),
    requestedStartMode: requestedStartModeFromInput(body),
    requestedStartDate: clean(body.requested_start_date) ?? clean(body.contract?.requested_start_date) ?? clean(body.contract?.starts_at),
    metadata: body.metadata ?? {},
  })
  const explicitGridOwnerNormalization = await normalizeGridOwnerIdToOps({
    gridOwnerId: explicitGridOwnerIdFromInput(body),
    companyId: input.companyId,
  })
  const resolved = mergeResolverWithExplicitInput(body, resolution, {
    opsGridOwnerId: explicitGridOwnerNormalization.opsGridOwnerId,
    warnings: explicitGridOwnerNormalization.warnings,
  })
  return { body: enrichApplicationWithEnergyResolution(body, resolved), resolution: resolved }
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
    const coded = error as { code?: unknown; details?: unknown }
    throw new WebsiteApplicationError({
      message: errorMessage(error),
      status: 500,
      code: typeof coded?.code === 'string' && coded.code ? coded.code : 'internal_error',
      stage: stageName,
      details: typeof coded?.details === 'object' && coded.details !== null
        ? { ...coded.details as Record<string, unknown>, raw_error: errorMessage(error) }
        : { raw_error: errorMessage(error) },
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
  const explicitSiteAddress = Boolean(
    nestedSite ||
    ['site', 'facility', 'installation', 'anlaggning'].includes(String(raw.address_type ?? raw.addressType ?? rawAddress.type ?? '').toLowerCase()) ||
    raw.billing_address_same_as_site === true || raw.billingAddressSameAsSite === true
  )
  const nestedMeteringPoint = isObject(raw.metering_point) ? { ...raw.metering_point } : null
  const nestedContract = isObject(raw.contract) ? { ...raw.contract } : null

  const customer = {
    customer_type:
      normalizeCustomerType(
        raw.customer_type ?? rawCustomer.customer_type ?? raw.customerType ?? rawCustomer.customerType ?? raw.type ?? rawCustomer.type,
      ) ?? 'private',
    first_name: raw.first_name ?? raw.firstName ?? rawCustomer.first_name ?? rawCustomer.firstName,
    last_name: raw.last_name ?? raw.lastName ?? rawCustomer.last_name ?? rawCustomer.lastName,
    full_name: raw.name ?? raw.full_name ?? raw.fullName ?? rawCustomer.full_name ?? rawCustomer.fullName ?? rawCustomer.name,
    company_name: raw.company_name ?? raw.companyName ?? rawCustomer.company_name ?? rawCustomer.companyName,
    // Private identity: accept every documented alias and collapse to the
    // canonical personal_number column used by the platform.
    personal_number:
      raw.personal_number ?? raw.personalNumber ??
      raw.personal_identity_number ?? raw.personalIdentityNumber ??
      raw.identity_number ?? raw.identityNumber ?? raw.personnummer ??
      rawCustomer.personal_number ?? rawCustomer.personalNumber ??
      rawCustomer.personal_identity_number ?? rawCustomer.personalIdentityNumber ??
      rawCustomer.identity_number ?? rawCustomer.identityNumber ?? rawCustomer.personnummer,
    // Business identity: accept every documented alias and collapse to the
    // canonical org_number column used by the platform.
    org_number:
      raw.org_number ?? raw.orgNumber ??
      raw.organization_number ?? raw.organizationNumber ??
      raw.organisation_number ?? raw.organisationNumber ??
      raw.organisationsnummer ?? raw.orgnr ??
      rawCustomer.org_number ?? rawCustomer.orgNumber ??
      rawCustomer.organization_number ?? rawCustomer.organizationNumber ??
      rawCustomer.organisation_number ?? rawCustomer.organisationNumber ??
      rawCustomer.organisationsnummer ?? rawCustomer.orgnr,
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
    raw.edielMeteringPointId
  )
  const topLevelFacilityId = firstClean(
    raw.facility_id,
    raw.facilityId,
    raw.site_facility_id,
    raw.siteFacilityId,
    raw.anlage_id,
    raw.anlaggningId
  )
  const hasTopLevelSite = Boolean(
    nestedSite ||
    topLevelFacilityId ||
    hasAnyCleanValue(raw, [
      'site_name',
      'site_type',
      ...(explicitSiteAddress ? [
        'street', 'address_line1', 'addressLine1', 'address', 'street_address', 'streetAddress',
        'postal_code', 'postalCode', 'zip', 'city', 'country',
      ] : []),
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
        street: firstDefined(nestedSite?.street, nestedSite?.address, explicitSiteAddress ? raw.street : undefined, explicitSiteAddress ? raw.address_line1 : undefined, explicitSiteAddress ? raw.addressLine1 : undefined, explicitSiteAddress ? raw.address : undefined, explicitSiteAddress ? raw.street_address : undefined, explicitSiteAddress ? raw.streetAddress : undefined, explicitSiteAddress ? rawAddress.street : undefined),
        postal_code: firstDefined(nestedSite?.postal_code, nestedSite?.postalCode, explicitSiteAddress ? raw.postal_code : undefined, explicitSiteAddress ? raw.postalCode : undefined, explicitSiteAddress ? raw.zip : undefined, explicitSiteAddress ? rawAddress.postal_code : undefined),
        city: firstDefined(nestedSite?.city, explicitSiteAddress ? raw.city : undefined, explicitSiteAddress ? rawAddress.city : undefined),
        country: firstDefined(nestedSite?.country, explicitSiteAddress ? raw.country : undefined, explicitSiteAddress ? rawAddress.country : undefined),
        price_area_code: firstDefined(nestedSite?.price_area_code, nestedSite?.priceAreaCode, nestedSite?.price_area, nestedSite?.priceArea, raw.price_area_code, raw.priceAreaCode, raw.price_area, raw.priceArea),
        grid_area_code: firstDefined(nestedSite?.grid_area_code, nestedSite?.gridAreaCode, raw.grid_area_code, raw.gridAreaCode),
        grid_owner_id: firstDefined(nestedSite?.grid_owner_id, nestedSite?.gridOwnerId, raw.grid_owner_id, raw.gridOwnerId, raw.network_owner_id),
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
        anlage_id: firstDefined(nestedMeteringPoint?.anlage_id, nestedMeteringPoint?.anlaggningId, raw.anlage_id, raw.anlaggningId),
        site_facility_id: firstDefined(nestedMeteringPoint?.site_facility_id, nestedMeteringPoint?.siteFacilityId, raw.site_facility_id, raw.siteFacilityId, site?.facility_id),
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
    offer_reference: firstDefined(nestedContract?.offer_reference, nestedContract?.offerReference, raw.offer_reference, raw.offerReference),
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
    external_account_id: firstDefined(raw.external_account_id, raw.externalAccountId, raw.auth_user_id, raw.authUserId, raw.customer_portal_user_id, raw.customerPortalUserId, raw.web_auth_user_id, raw.webAuthUserId),
    auth_user_id: firstDefined(raw.auth_user_id, raw.authUserId, raw.web_auth_user_id, raw.webAuthUserId),
    customer_portal_user_id: firstDefined(raw.customer_portal_user_id, raw.customerPortalUserId, raw.web_auth_user_id, raw.webAuthUserId, raw.auth_user_id, raw.authUserId),
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
    .eq('provider', WEBSITE_PORTAL_PROVIDER)
    .eq('external_customer_id', externalCustomerId)
    .in('status', ['active', 'pending_review'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data as { id: string; customer_id: string | null; status: string } | null
}

async function findExistingCustomer(
  companyId: string,
  input: ApplicationInput
): Promise<{ customer: CustomerRow | null; matchDecision: CustomerMatchDecision }> {
  const matchDecision = await matchCustomerIdentity({
    companyId,
    personalNumber: clean(input.customer.personal_number),
    orgNumber: clean(input.customer.org_number),
    email: clean(input.customer.email),
    phone: clean(input.customer.phone),
    select: 'id,customer_number,email,full_name,company_name',
  })

  if (matchDecision.outcome === 'matched') {
    return { customer: matchDecision.customer as CustomerRow, matchDecision }
  }

  if (matchDecision.outcome === 'ambiguous') {
    // Legacy behavior linked to the most recent candidate; keep the link so
    // repeat applications do not create duplicates, but the caller marks the
    // customer for duplicate review instead of silently merging.
    const candidate = matchDecision.candidates.find(
      (entry) => entry.matchedBy === matchDecision.matchedBy
    )?.customer ?? matchDecision.candidates[0]?.customer ?? null
    return { customer: (candidate as CustomerRow | null) ?? null, matchDecision }
  }

  return { customer: null, matchDecision }
}

async function upsertPortalIdentity(input: {
  client: IntegrationApiClient
  customerId: string
  externalCustomerId: string
  externalAccountId?: string | null
  authUserId?: string | null
  customerPortalUserId?: string | null
  customerNumber?: string | null
  email?: string | null
  applicationId?: string | null
}) {
  const now = new Date().toISOString()
  const payload = {
    company_id: input.client.company_id,
    customer_id: input.customerId,
    api_client_id: input.client.id,
    provider: WEBSITE_PORTAL_PROVIDER,
    external_customer_id: input.externalCustomerId,
    external_account_id: input.externalAccountId ?? input.customerPortalUserId ?? input.authUserId ?? null,
    customer_number: input.customerNumber ?? null,
    auth_user_id: input.authUserId ?? input.customerPortalUserId ?? null,
    customer_portal_user_id: input.customerPortalUserId ?? input.authUserId ?? null,
    last_resolved_at: now,
    email: input.email ?? null,
    status: 'active',
    match_strength: 'strong',
    match_method: 'website_application',
    linked_at: now,
    metadata: {
      source: 'website_customer_applications',
      api_client_id: input.client.id,
      application_id: input.applicationId ?? null,
      customer_portal_user_id: input.customerPortalUserId ?? input.authUserId ?? null,
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

async function createOrUpdateCustomer(client: IntegrationApiClient, input: ApplicationInput): Promise<{ customer: CustomerRow; created: boolean; customerNumberAssigned: boolean }> {
  const { customer: existing, matchDecision } = await findExistingCustomer(client.company_id, input)
  const customer = input.customer
  const name = fullName(customer)
  const email = normalizedEmail(customer.email)
  const customerNumber = existing?.customer_number ?? await reserveCustomerNumber(client.company_id)
  const externalCustomerId = clean(input.external_customer_id)
  const now = new Date().toISOString()

  if (existing) {
    const updatePayload = {
      customer_number: customerNumber,
      // Keep customers.external_customer_id in sync so tenant-scoped portal
      // resolution can fall back to it without a portal identity row.
      ...(externalCustomerId ? { external_customer_id: externalCustomerId } : {}),
      email: email ?? existing.email,
      phone: clean(customer.phone),
      full_name: name ?? existing.full_name,
      company_name: clean(customer.company_name) ?? existing.company_name,
      // Store identity in the canonical columns when the application provides it
      // (under any documented alias). Only set when present so a later
      // application never wipes an identity captured earlier. This is what makes
      // POA externally sendable when identity was missing on first contact.
      ...(digits(customer.personal_number) ? { personal_number: digits(customer.personal_number) } : {}),
      ...(digits(customer.org_number) ? { org_number: digits(customer.org_number) } : {}),
      invoice_email: normalizedEmail(customer.invoice_email) ?? email ?? undefined,
      billing_street: clean(customer.billing_street) ?? undefined,
      billing_postal_code: clean(customer.billing_postal_code) ?? undefined,
      billing_city: clean(customer.billing_city) ?? undefined,
      billing_country: clean(customer.billing_country) ?? 'SE',
      source: 'external_website',
      updated_at: now,
      // Ambiguous identity matches must never be silently merged: flag the
      // linked customer for duplicate review so it lands in the review queue.
      ...(matchDecision.needsReview ? { possible_duplicate: true, duplicate_review_status: 'pending' } : {}),
      metadata: {
        source: 'website_customer_applications',
        api_client_id: client.id,
        customer_match: matchDecision.auditMetadata,
      },
    }

    const { data, error } = await supabaseService
      .from('customers')
      .update(updatePayload)
      .eq('company_id', client.company_id)
      .eq('id', existing.id)
      .select('id,customer_number,email,full_name,company_name')
      .single()
    if (error && !missingSchema(error)) throw error
    if (data) return { customer: data as CustomerRow, created: false, customerNumberAssigned: !existing.customer_number }

    const fallback = await supabaseService
      .from('customers')
      .update({ customer_number: customerNumber, email: email ?? existing.email, full_name: name ?? existing.full_name, updated_at: now })
      .eq('company_id', client.company_id)
      .eq('id', existing.id)
      .select('id,customer_number,email,full_name,company_name')
      .single()
    if (fallback.error) throw fallback.error
    return { customer: fallback.data as CustomerRow, created: false, customerNumberAssigned: !existing.customer_number }
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
    ...(externalCustomerId ? { external_customer_id: externalCustomerId } : {}),
    invoice_email: normalizedEmail(customer.invoice_email) ?? email,
    billing_street: clean(customer.billing_street),
    billing_postal_code: clean(customer.billing_postal_code),
    billing_city: clean(customer.billing_city),
    billing_country: clean(customer.billing_country) ?? 'SE',
    source: 'external_website',
    metadata: {
      source: 'website_customer_applications',
      api_client_id: client.id,
      customer_match: matchDecision.auditMetadata,
    },
  }

  const { data, error } = await supabaseService
    .from('customers')
    .insert(insertPayload)
    .select('id,customer_number,email,full_name,company_name')
    .single()

  if (error && !missingSchema(error)) throw error
  if (data) return { customer: data as CustomerRow, created: true, customerNumberAssigned: true }

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
  return { customer: fallback.data as CustomerRow, created: true, customerNumberAssigned: true }
}

async function upsertSite(companyId: string, customerId: string, input: ApplicationInput): Promise<{ id: string; facility_id: string | null } | null> {
  const site = input.site
  if (!site) return null
  const facilityId = normalizeFacilityId(site.facility_id)
  let crossTenantFacilitySeen = false

  if (facilityId) {
    const conflicts = await findFacilityConflicts({ companyId, customerId, facilityId })
    crossTenantFacilitySeen = conflicts.crossTenantExists
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
    if (existing?.id) {
      const enrichment = {
        site_name: clean(site.site_name) ?? undefined,
        site_type: clean(site.site_type) ?? undefined,
        grid_area_code: clean(site.grid_area_code) ?? clean(site.gridAreaCode) ?? undefined,
        price_area_code: clean(site.price_area_code) ?? clean(site.price_area) ?? undefined,
        grid_owner_id: clean(site.grid_owner_id) ?? clean(site.gridOwnerId) ?? undefined,
        grid_owner_verification_status: clean(site.grid_owner_verification_status) ?? clean(site.gridOwnerVerificationStatus) ?? undefined,
        move_in_date: clean(site.move_in_date) ?? undefined,
        annual_consumption_kwh: site.annual_consumption_kwh ?? undefined,
        street: clean(site.street) ?? undefined,
        postal_code: clean(site.postal_code) ?? undefined,
        city: clean(site.city) ?? undefined,
        country: clean(site.country) ?? undefined,
        updated_at: new Date().toISOString(),
      }
      const cleaned = Object.fromEntries(Object.entries(enrichment).filter(([, value]) => value !== undefined))
      if (Object.keys(cleaned).length > 1) {
        const siteUpdateResult = await supabaseService
          .from('customer_sites')
          .update(cleaned)
          .eq('company_id', companyId)
          .eq('id', existing.id)

        if (siteUpdateResult.error && !missingSchema(siteUpdateResult.error)) throw siteUpdateResult.error
      }
      return existing as { id: string; facility_id: string | null }
    }
  }

  const hasSiteData = Boolean(facilityId || clean(site.street) || clean(site.city))
  if (!hasSiteData) return null

  // A complete website address is provisioned atomically with the new site.
  // This prevents a draft site without address history from being left behind
  // if the address commit fails.
  if (clean(site.street) && clean(site.postal_code) && clean(site.city)) {
    const created = await createOrUpdateCustomerSiteFromAddress({
      companyId,
      customerId,
      siteName: clean(site.site_name) ?? 'Anläggning',
      facilityId,
      address: {
        street: clean(site.street) ?? '',
        postalCode: clean(site.postal_code) ?? '',
        city: clean(site.city) ?? '',
        country: clean(site.country) ?? 'SE',
        source: 'website',
        sourceReference: null,
        claimedGridOwnerId: clean(site.grid_owner_id) ?? clean(site.gridOwnerId),
        claimedGridAreaCode: clean(site.grid_area_code) ?? clean(site.gridAreaCode),
        claimedPriceAreaCode: clean(site.price_area_code) ?? clean(site.price_area),
        metadata: {
          source: 'website_customer_applications',
          cross_tenant_facility_seen: crossTenantFacilitySeen,
          platform_only: crossTenantFacilitySeen,
        },
      },
    })
    const { error: enrichmentError } = await supabaseService
      .from('customer_sites')
      .update({
        site_name: clean(site.site_name) ?? 'Anläggning',
        facility_id: facilityId,
        site_type: clean(site.site_type) ?? 'consumption',
        status: 'active',
        grid_area_code: clean(site.grid_area_code) ?? clean(site.gridAreaCode),
        price_area_code: clean(site.price_area_code) ?? clean(site.price_area),
        grid_owner_id: clean(site.grid_owner_id) ?? clean(site.gridOwnerId),
        grid_owner_verification_status: clean(site.grid_owner_verification_status) ?? clean(site.gridOwnerVerificationStatus),
        move_in_date: clean(site.move_in_date),
        annual_consumption_kwh: site.annual_consumption_kwh ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', companyId)
      .eq('customer_id', customerId)
      .eq('id', created.siteId)
    if (enrichmentError && !missingSchema(enrichmentError)) throw enrichmentError
    if (enrichmentError && missingSchema(enrichmentError)) {
      console.warn('[website-applications] site enrichment skipped because schema differs', enrichmentError)
    }
    return { id: created.siteId, facility_id: facilityId }
  }

  // Explicit/enriched grid context must be persisted on the site columns even
  // when the address is incomplete. Previously these were forced to null and
  // only kept in metadata.claimed_*, which lost valid submitted values
  // (e.g. grid_area_code/price_area_code) for downstream route resolution.
  const fullPayload = {
    company_id: companyId,
    customer_id: customerId,
    site_name: clean(site.site_name) ?? 'Anläggning',
    facility_id: facilityId,
    site_type: clean(site.site_type) ?? 'consumption',
    status: 'active',
    price_area_code: clean(site.price_area_code) ?? clean(site.price_area),
    grid_area_code: clean(site.grid_area_code) ?? clean(site.gridAreaCode),
    grid_owner_id: clean(site.grid_owner_id) ?? clean(site.gridOwnerId),
    grid_owner_verification_status: clean(site.grid_owner_verification_status) ?? clean(site.gridOwnerVerificationStatus),
    move_in_date: clean(site.move_in_date),
    annual_consumption_kwh: site.annual_consumption_kwh ?? null,
    street: clean(site.street),
    postal_code: clean(site.postal_code),
    city: clean(site.city),
    country: clean(site.country) ?? 'SE',
    metadata: {
      source: 'website_customer_applications',
      address_source: 'website',
      claimed_grid_owner_id: clean(site.grid_owner_id) ?? clean(site.gridOwnerId),
      claimed_grid_area_code: clean(site.grid_area_code) ?? clean(site.gridAreaCode),
      claimed_price_area_code: clean(site.price_area_code) ?? clean(site.price_area),
      energy_resolution: input.metadata?.energy_resolution ?? null,
      cross_tenant_facility_seen: crossTenantFacilitySeen,
      platform_only: crossTenantFacilitySeen,
    },
  }

  const { data, error } = await supabaseService
    .from('customer_sites')
    .insert(fullPayload)
    .select('id,facility_id')
    .single()

  if (error && !missingSchema(error)) throw error
  if (data) return data as { id: string; facility_id: string | null }

  const fallbackPayloads: Array<Record<string, unknown>> = [
    {
      company_id: companyId,
      customer_id: customerId,
      site_name: clean(site.site_name) ?? 'Anläggning',
      facility_id: facilityId,
      status: 'active',
    },
    {
      company_id: companyId,
      customer_id: customerId,
      site_name: clean(site.site_name) ?? 'Anläggning',
      status: 'active',
    },
  ]

  let lastFallbackError: unknown = null
  for (const payload of fallbackPayloads) {
    const fallback = await supabaseService
      .from('customer_sites')
      .insert(payload)
      .select('id')
      .single()
    if (fallback.data?.id) return { id: String(fallback.data.id), facility_id: facilityId }
    if (fallback.error && !missingSchema(fallback.error)) throw fallback.error
    lastFallbackError = fallback.error
  }

  throw new WebsiteApplicationError({
    message: 'Kundansökan kunde inte skapa anläggning eftersom customer_sites-schemat inte matchar koden.',
    status: 500,
    code: 'customer_site_schema_mismatch',
    stage: 'site_create',
    details: lastFallbackError,
  })
}

async function upsertMeteringPoint(companyId: string, customerId: string, site: { id: string; facility_id: string | null } | null, input: ApplicationInput) {
  const metering = input.metering_point
  const meteringPointId = clean(metering?.metering_point_id)
    ?? clean(metering?.meter_point_id)
    ?? clean(metering?.ediel_metering_point_id)
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
    if (fallbackExisting.error && !missingSchema(fallbackExisting.error)) throw fallbackExisting.error
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
  const priceAreaCode = null
  const siteFacilityId = clean(metering?.site_facility_id) ?? clean(metering?.anlage_id) ?? site.facility_id ?? null
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
    metadata: {
      ...metadata,
      claimed_grid_area_code: clean(metering?.grid_area_code) ?? clean(metering?.gridAreaCode),
      claimed_price_area_code: clean(metering?.price_area_code) ?? clean(input.site?.price_area_code),
    },
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

  const fallbackPayloads: Array<Record<string, unknown>> = [
    {
      company_id: companyId,
      customer_id: customerId,
      site_id: site.id,
      metering_point_id: meteringPointId,
      status: 'active',
    },
    {
      company_id: companyId,
      customer_id: customerId,
      customer_site_id: site.id,
      metering_point_id: meteringPointId,
      status: 'active',
    },
    {
      company_id: companyId,
      customer_id: customerId,
      site_id: site.id,
      meter_point_id: meteringPointId,
      status: 'active',
    },
  ]

  let lastFallbackError: unknown = null
  for (const payload of fallbackPayloads) {
    const fallback = await supabaseService
      .from('metering_points')
      .insert(payload)
      .select('id')
      .single()
    if (fallback.data?.id) {
      return {
        id: String(fallback.data.id),
        metering_point_id: meteringPointId,
      }
    }
    if (fallback.error && !missingSchema(fallback.error)) throw fallback.error
    lastFallbackError = fallback.error
  }

  throw new WebsiteApplicationError({
    message: 'Kundansökan kunde inte skapa mätpunkt eftersom metering_points-schemat inte matchar koden.',
    status: 500,
    code: 'metering_point_schema_mismatch',
    stage: 'metering_point_create',
    details: lastFallbackError,
  })
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
    // Client-supplied fallbacks are UUID-gated: these values are written to
    // uuid columns (customer_contracts / contract_price_snapshots /
    // website_customer_applications). Version *names* like "2026-06-12-v1"
    // previously caused `invalid input syntax for type uuid` 500s mid-flow.
    pricePlanId: offer?.price_plan_id ?? cleanUuid(contract?.price_plan_id),
    pricePlanVersionId: offer?.price_plan_version_id ?? cleanUuid(contract?.price_plan_version_id),
    contractOfferId: offer?.id ?? cleanUuid(contract?.contract_offer_id),
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
  publicOffer: PublicContractOffer | null,
  options: { idempotencyKey?: string | null; applicationNumber?: string | null } = {}
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
    pricePlanVersionId: selected.pricePlanVersionId,
    idempotencyKey: options.idempotencyKey ?? null,
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
    // price_version is a text column: keep a human-readable version name here
    // even when it is not a UUID (UUID-gated out of price_plan_version_id).
    price_version: selected.pricePlanVersionId ?? clean(contract?.price_version) ?? clean(contract?.price_plan_version_id) ?? null,
    terms_version: selected.termsVersion,
    optional_fee_lines: feeLines,
    agreement_channel: WEBSITE_APPLICATION_CONTRACT_CHANNEL,
    metadata: {
      source: 'website_customer_applications',
      source_type: WEBSITE_APPLICATION_CONTRACT_SOURCE_TYPE,
      website_application_idempotency_key: options.idempotencyKey ?? null,
      application_number: options.applicationNumber ?? null,
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
    // external_contract_intakes.contract_offer_id is a uuid column — only
    // UUID-shaped identifiers may be written here.
    contract_offer_id: cleanUuid(input.pricePlanVersionId) ?? cleanUuid(payload.contract_offer_id) ?? cleanUuid(contract.price_plan_version_id) ?? cleanUuid(payload.price_plan_version_id),
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

  if (error && !missingSchema(error)) {
    if (duplicateIdempotencyKey(error) && input.idempotencyKey) {
      const { data: updated, error: updateError } = await supabaseService
        .from('website_customer_applications')
        .update({
          ...row,
          updated_at: new Date().toISOString(),
          processed_at: input.status === 'failed' ? null : row.processed_at,
        })
        .eq('company_id', input.client.company_id)
        .eq('idempotency_key', input.idempotencyKey)
        .select('id')
        .maybeSingle()
      if (updateError && !missingSchema(updateError)) throw updateError
      if (updated) {
        const repaired = updated as { id: string }
        await syncExternalContractIntakeRow({ ...input, applicationId: repaired.id })
        return repaired
      }
    }
    throw error
  }
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
  if (fallback.error && !missingSchema(fallback.error)) {
    if (duplicateIdempotencyKey(fallback.error) && input.idempotencyKey) {
      const { data: updated, error: updateError } = await supabaseService
        .from('website_customer_applications')
        .update({
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
          updated_at: new Date().toISOString(),
        })
        .eq('company_id', input.client.company_id)
        .eq('idempotency_key', input.idempotencyKey)
        .select('id')
        .maybeSingle()
      if (updateError && !missingSchema(updateError)) throw updateError
      if (updated) {
        const repaired = updated as { id: string }
        await syncExternalContractIntakeRow({ ...input, applicationId: repaired.id })
        return repaired
      }
    }
    throw fallback.error
  }
  if (fallback.error && missingSchema(fallback.error)) {
    throw new WebsiteApplicationError({
      message: 'Kundansökan kunde inte loggas eftersom website_customer_applications-schemat inte matchar koden.',
      status: 500,
      code: 'website_application_schema_mismatch',
      stage: 'application_record_create',
      details: fallback.error,
    })
  }
  const created = fallback.data as { id: string }
  await syncExternalContractIntakeRow({ ...input, applicationId: created.id })
  return created
}

// Marks an already-created application row as failed/partial. Used when a
// failure happens after the application row exists, so we update in place
// instead of inserting a duplicate that would collide on the unique
// (company_id, idempotency_key) index.
async function markApplicationFailed(input: {
  applicationId: string
  companyId: string
  status: string
  responsePayload: Record<string, unknown>
  errorStage: ErrorStage
  errorCode: string
  errorMessage: string
  missingFields?: unknown[]
  blockingReasons?: unknown[]
  nextStep?: string | null
  warnings?: string[]
}): Promise<{ id: string }> {
  const { error } = await supabaseService
    .from('website_customer_applications')
    .update({
      status: input.status,
      response_payload: input.responsePayload,
      error_stage: input.errorStage,
      error_code: input.errorCode,
      error_message: input.errorMessage,
      missing_fields: input.missingFields ?? [],
      blocking_reasons: input.blockingReasons ?? [],
      next_step: input.nextStep ?? null,
      warnings: input.warnings ?? [],
      processed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.applicationId)
    .eq('company_id', input.companyId)
  if (error && !missingSchema(error)) throw error
  return { id: input.applicationId }
}

async function loadIdempotentApplication(companyId: string, idempotencyKey: string | null) {
  if (!idempotencyKey) return null
  const { data, error } = await supabaseService
    .from('website_customer_applications')
    .select('id,idempotency_key,response_payload,payload,status,customer_id,customer_number,external_customer_id,customer_site_id,metering_point_id,contract_id,error_stage,error_code,error_message,warnings')
    .eq('company_id', companyId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  if (error) throw error
  return data as {
    id: string
    idempotency_key?: string | null
    response_payload: Record<string, unknown> | null
    payload?: Record<string, unknown> | null
    status: string
    customer_id: string | null
    customer_number: string | null
    external_customer_id: string | null
    customer_site_id?: string | null
    metering_point_id?: string | null
    contract_id?: string | null
    warnings?: string[] | null
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


function isRetryableFailedSiteProvisioningApplication(
  existing: NonNullable<Awaited<ReturnType<typeof loadIdempotentApplication>>>,
  externalCustomerId: string,
) {
  const response = existing.response_payload ?? {}
  const previousStage = existing.error_stage ?? clean(response.error_stage)
  const previousCode = existing.error_code ?? clean(response.code)
  const previousMessage = [existing.error_message, clean(response.error), clean(response.previous_error_message), clean(response.next_step)]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' · ')

  const sameExternalCustomer = (existing.external_customer_id ?? externalCustomerId) === externalCustomerId
  const failedBeforeDurableResources = !existing.customer_site_id && !existing.metering_point_id && !existing.contract_id
  const failedAtSiteCreate = previousStage === 'site_create'
  const provisioningError = /site_provisioning|anläggningsprovisionering|customer_sites|schema cache|migration|atomisk/i.test(previousMessage)
    || ['site_provisioning_function_unavailable', 'customer_site_schema_mismatch', 'incomplete_application', 'internal_error'].includes(previousCode ?? '')

  return Boolean(
    sameExternalCustomer &&
    failedBeforeDurableResources &&
    failedAtSiteCreate &&
    provisioningError &&
    ['failed', 'pending_review', 'partial'].includes(existing.status)
  )
}

async function releaseRetryableFailedIdempotency(input: {
  companyId: string
  existing: NonNullable<Awaited<ReturnType<typeof loadIdempotentApplication>>>
  idempotencyKey: string
}) {
  const releasedKey = `${input.idempotencyKey}:failed:${input.existing.id}`
  const responsePayload = {
    ...(input.existing.response_payload ?? {}),
    superseded_by_retry: true,
    superseded_at: new Date().toISOString(),
    original_idempotency_key: input.idempotencyKey,
  }
  const warnings = Array.from(new Set([...(input.existing.warnings ?? []), 'idempotency_released_for_site_provisioning_retry']))
  const { error } = await supabaseService
    .from('website_customer_applications')
    .update({
      idempotency_key: releasedKey,
      response_payload: responsePayload,
      warnings,
      next_step: 'Tidigare misslyckat site_create-försök har frigjorts för ny idempotent retry.',
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.existing.id)
    .eq('company_id', input.companyId)
    .eq('idempotency_key', input.idempotencyKey)

  if (error) throw error
  return releasedKey
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
      action: error.action ?? null,
      details: error.details ?? null,
    },
  }
}

export async function processWebsiteCustomerApplication(input: {
  client: IntegrationApiClient
  rawBody: unknown
  idempotencyKey?: string | null
  requestAudit?: RequestAuditMetadata
}) {
  const normalizedRaw = normalizeRawApplication(input.rawBody)

  // Reject unmappable customer types with a precise code instead of a generic
  // Zod validation error. Empty values default to 'private' in normalization.
  const normalizedCustomerType = (normalizedRaw.customer as Record<string, unknown> | undefined)?.customer_type
  if (typeof normalizedCustomerType === 'string' && !['private', 'business'].includes(normalizedCustomerType)) {
    return failureResponse(new WebsiteApplicationError({
      message: `Kundtypen "${normalizedCustomerType}" stöds inte. Använd private eller business.`,
      status: 422,
      code: 'customer_type_invalid',
      field: 'customer.customer_type',
      stage: 'validation',
      hint: 'Skicka customer.customer_type som private eller business. Aliasen consumer, company, företag och organization mappas automatiskt.',
    }))
  }

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

  // A structured powerOfAttorney.accepted=true satisfies the POA legal consent so
  // the existing legal-acceptance gate and POA persistence run unchanged.
  const structuredPoa = normalizeStructuredPoa(body)
  // If a structured powerOfAttorney object is supplied it must be accepted.
  // (Legacy callers may instead send consents.power_of_attorney=true without the
  // structured object — that remains valid and is not affected here.)
  if (structuredPoa && structuredPoa.accepted !== true) {
    return failureResponse(new WebsiteApplicationError({
      message: 'powerOfAttorney.accepted måste vara true när en strukturerad fullmakt skickas med.',
      status: 422,
      code: 'power_of_attorney_not_accepted',
      field: 'powerOfAttorney.accepted',
      stage: 'power_of_attorney',
      hint: 'Sätt powerOfAttorney.accepted=true när kunden har godkänt fullmakten, annars utelämna powerOfAttorney-objektet.',
    }))
  }
  const structuredPoaValidation = validateStructuredPoaForExternalSendability(structuredPoa)
  if (structuredPoaValidation) return failureResponse(structuredPoaValidation)
  if (structuredPoa?.accepted) {
    body = { ...body, consents: { ...(body.consents ?? {}), power_of_attorney: true } }
  }

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
  let customerResult: { customer: CustomerRow; created: boolean; customerNumberAssigned: boolean } | null = null
  let site: { id: string; facility_id: string | null } | null = null
  let meteringPoint: { id: string; metering_point_id: string | null } | null = null
  let contract: WebsiteContractCreateResult | null = null
  let publicOffer: PublicContractOffer | null = null
  let legalAcceptanceVersions: WebsiteLegalAcceptanceVersion[] = []
  let applicationNumber: string | null = null
  // Once the application row exists, any later failure (e.g. power of attorney)
  // must UPDATE this row to failed/partial — never INSERT a second row, which
  // would collide on the unique (company_id, idempotency_key) index and leave a
  // misleading success row behind.
  let applicationRowId: string | null = null

  try {
    const existingIdempotent = await stage('idempotency', () => loadIdempotentApplication(input.client.company_id, input.idempotencyKey ?? null))
    let releasedFailedIdempotencyForRetry = false
    if (existingIdempotent) {
      if (isFailedIdempotentApplication(existingIdempotent, body)) {
        if (
          input.idempotencyKey &&
          isRetryableFailedSiteProvisioningApplication(existingIdempotent, externalCustomerId)
        ) {
          await stage('idempotency', () => releaseRetryableFailedIdempotency({
            companyId: input.client.company_id,
            existing: existingIdempotent,
            idempotencyKey: input.idempotencyKey as string,
          }))
          console.warn('[website-applications] released failed site_create idempotency for retry', {
            application_id: existingIdempotent.id,
            company_id: input.client.company_id,
          })
          releasedFailedIdempotencyForRetry = true
        } else {
          const incomplete = expectsSiteOrMetering(body) && !hasCompleteSiteAndMetering(existingIdempotent)
          return idempotentFailure(existingIdempotent, externalCustomerId, incomplete ? 'incomplete_application' : undefined)
        }
      }

      if (!releasedFailedIdempotencyForRetry) {
        // The previous application for this Idempotency-Key was treated as a
        // success, but it produced no power of attorney. If the retry now carries
        // an accepted structured powerOfAttorney, repair the existing application
        // inline and return success instead of forcing the website/customer into a
        // 409 loop. Admin repair remains a fallback only when the incoming retry
        // still lacks the legal data needed to create the POA.
        const previousHasPoa = Boolean(existingIdempotent.response_payload?.power_of_attorney_id)
        if (!previousHasPoa && structuredPoa?.accepted === true) {
          const repaired = await stage('power_of_attorney', () => repairMissingPoaOnIdempotentApplication({
            client: input.client,
            existingApplication: existingIdempotent,
            body,
            rawBody: input.rawBody,
            structuredPoa,
            externalCustomerId,
            requestAudit: input.requestAudit,
          }))
          if (repaired?.ok) {
            return successResponse(repaired.data, repaired.warnings)
          }
          return failureResponse(new WebsiteApplicationError({
            message: repaired?.message ?? 'Fullmakten kunde inte skapas på den befintliga ansökan.',
            status: 409,
            code: repaired?.code ?? 'idempotent_application_missing_poa',
            field: 'powerOfAttorney',
            stage: 'power_of_attorney',
            action: 'retry_with_new_idempotency_key_or_repair',
            hint: 'Kontrollera att payloaden innehåller komplett powerOfAttorney med textVersionId från OPS publicerade juridik och kör sedan retry/admin-repair.',
            details: {
              application_id: existingIdempotent.id,
              external_customer_id: existingIdempotent.external_customer_id ?? externalCustomerId,
              action: 'retry_with_new_idempotency_key_or_repair',
            },
          }))
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
        return { customer: { ...(data as CustomerRow), customer_number: customerNumber }, created: false, customerNumberAssigned: !clean(data.customer_number) }
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

    const selectedOfferReference = clean(body.offer_reference) ?? clean(body.offerReference) ?? clean(body.contract?.offer_reference) ?? clean(body.contract?.offerReference)
    const selectedPricePlanVersionId = clean(body.price_plan_version_id) ?? clean(body.contract?.price_plan_version_id)
    const selectedPricePlanId = clean(body.price_plan_id) ?? clean(body.contract?.price_plan_id)
    const selectedContractOfferId = clean(body.contract_offer_id) ?? clean(body.contract?.contract_offer_id)
    const selectedProductCode = clean(body.product_code) ?? clean(body.contract?.product_code)
    const hasSelectedPublicContract = Boolean(selectedOfferReference || selectedPricePlanVersionId || selectedPricePlanId || selectedContractOfferId || selectedProductCode)
    if (!hasSelectedPublicContract) {
      throw new WebsiteApplicationError({
        message: 'Kundansökan måste referera till ett publicerat avtal från Ops.',
        status: 422,
        code: 'public_contract_required',
        field: 'contract.offer_reference',
        stage: 'public_contract_lookup',
        hint: 'Hämta avtal via GET /api/v1/website/public-contracts och skicka offer_reference. Skicka inte egna priser eller fritextavtal som juridisk sanning.',
      })
    }

    publicOffer = hasSelectedPublicContract
      ? await stage('public_contract_lookup', () => resolvePublicContractOffer({
          client: input.client,
          offerReference: selectedOfferReference,
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
        field: 'offer_reference',
        stage: 'public_contract_lookup',
        hint: 'Hemsidan ska hämta avtal via GET /api/v1/website/public-contracts och skicka offer_reference från svaret.',
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

    // When the resolved public contract publishes a power_of_attorney legal
    // version, fullmakt is required (legal.power_of_attorney_required = true).
    // A structured powerOfAttorney object accepted by the customer is then
    // mandatory — consents.power_of_attorney=true alone is not enough, because a
    // bare boolean can never carry the signer identity needed for external
    // grid-owner communication.
    const powerOfAttorneyRequired = legalAcceptanceVersions.some((version) => version.type === 'power_of_attorney')
    if (powerOfAttorneyRequired && structuredPoa?.accepted !== true) {
      throw new WebsiteApplicationError({
        message: 'Det valda avtalet kräver fullmakt. Skicka ett strukturerat powerOfAttorney-objekt med accepted=true.',
        status: 422,
        code: 'power_of_attorney_missing',
        field: 'powerOfAttorney',
        stage: 'power_of_attorney',
        hint: 'consents.power_of_attorney=true räcker inte. Skicka powerOfAttorney med accepted, signerName, signerIdentityNumber och method.',
      })
    }

    applicationNumber = await stage('application_record_create', () => reserveApplicationNumber(input.client.company_id))

    const energyResolution = await stage('energy_resolution', () => runEnergyResolution({
      companyId: input.client.company_id,
      customerId: resolvedCustomerResult.customer.id,
      customerSiteId: null,
      body,
    }))
    body = energyResolution.body
    readiness = assessWebsiteApplicationReadiness(body)

    site = readiness.canCreateSite
      ? await stage('site_create', () => upsertSite(input.client.company_id, resolvedCustomerResult.customer.id, body))
      : null

    const siteAddress = body.site
    if (site?.id && siteAddress?.street && siteAddress.postal_code && siteAddress.city) {
      const siteId = site.id
      const addressResult = await stage('site_create', () => applyCustomerSiteAddressCandidate({
        companyId: input.client.company_id,
        customerId: resolvedCustomerResult.customer.id,
        siteId,
        address: {
          street: siteAddress.street,
          postalCode: siteAddress.postal_code,
          city: siteAddress.city,
          country: siteAddress.country ?? 'SE',
          source: 'website',
          sourceReference: input.idempotencyKey ?? null,
          claimedGridOwnerId: clean(siteAddress.grid_owner_id) ?? clean(siteAddress.gridOwnerId),
          claimedGridAreaCode: clean(siteAddress.grid_area_code) ?? clean(siteAddress.gridAreaCode),
          claimedPriceAreaCode: clean(siteAddress.price_area_code) ?? clean(siteAddress.price_area),
          metadata: { application_source: clean(body.source) ?? 'website' },
        },
      }))
      // Do not start external automation here. Contract, immutable legal
      // acceptances and the application record must exist first.
      void addressResult
    }

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
      publicOffer,
      { idempotencyKey: input.idempotencyKey ?? null, applicationNumber }
    ))
    const identity = await stage('portal_identity_create', () => upsertPortalIdentity({
      client: input.client,
      customerId: resolvedCustomerResult.customer.id,
      externalCustomerId,
      externalAccountId: clean(body.external_account_id) ?? clean(body.customer_portal_user_id) ?? clean(body.auth_user_id) ?? clean(body.web_auth_user_id),
      authUserId: clean(body.auth_user_id) ?? clean(body.web_auth_user_id) ?? clean(body.customer_portal_user_id),
      customerPortalUserId: clean(body.customer_portal_user_id) ?? clean(body.auth_user_id) ?? clean(body.web_auth_user_id),
      customerNumber,
      email: normalizedEmail(body.customer.email),
    }))

    const portalUserId = clean(body.customer_portal_user_id) ?? clean(body.auth_user_id) ?? clean(body.web_auth_user_id) ?? clean(body.external_account_id)
    if (portalUserId) {
      await stage('portal_user_link', () => ensureCustomerPortalUserLink({
        client: input.client,
        customerId: resolvedCustomerResult.customer.id,
        userId: portalUserId,
        email: normalizedEmail(body.customer.email),
        externalCustomerId,
        customerNumber,
        identityId: identity.id,
        matchMethod: 'website_application_auth_user',
      }))
    }

    const applicationStatus = readiness.status

    const responsePayload: Record<string, unknown> = {
      customer_id: resolvedCustomerResult.customer.id,
      customer_number: customerNumber,
      application_number: applicationNumber,
      external_customer_id: externalCustomerId,
      portal_identity_id: identity.id,
      customer_site_id: site?.id ?? null,
      site_id: site?.id ?? null,
      metering_point_id: meteringPoint?.id ?? null,
      contract_id: contract?.id ?? null,
      contract_number: contract?.contract_number ?? null,
      offer_reference: publicOffer ? selectedOfferReference ?? (selectedContractOfferId?.startsWith('offer_') ? selectedContractOfferId : null) : null,
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
    applicationRowId = application.id

    const legalAcceptanceIds = await stage('legal_acceptance', () => persistCustomerLegalAcceptances({
      companyId: input.client.company_id,
      customerId: resolvedCustomerResult.customer.id,
      contractId: contract?.id ?? null,
      applicationId: application.id,
      publicOffer,
      legalVersions: legalAcceptanceVersions,
      consents: body.consents,
      rawPayload: input.rawBody,
      requestAudit: input.requestAudit,
    }))
    if (Object.keys(legalAcceptanceIds).length > 0) {
      responsePayload.legal_acceptances = legalAcceptanceIds
    }

    // Collected here and merged into the final response warnings later, because
    // the main `warnings` array is assembled further down.
    const poaWarnings: string[] = []
    // Only a complete structured powerOfAttorney accepted by the customer is
    // externally sendable. Legacy consents.power_of_attorney=true remains an
    // internal legal acceptance and must never inherit customer identity/name.
    const poaExternallySendable = structuredPoaIsExternallySendable(structuredPoa)
    const effectiveSignerMethod = structuredPoa?.method ?? null

    const powerOfAttorneyId = await stage('power_of_attorney', () => ensureWebsitePowerOfAttorney({
      companyId: input.client.company_id,
      customerId: resolvedCustomerResult.customer.id,
      contractId: contract?.id ?? null,
      customerSiteId: site?.id ?? null,
      meteringPointId: meteringPoint?.id ?? null,
      applicationId: application.id,
      publicOffer,
      legalVersions: legalAcceptanceVersions,
      consents: body.consents,
      requestAudit: input.requestAudit,
      rawPayload: input.rawBody,
      structuredPoa,
    }))

    if (powerOfAttorneyId) {
      // The POA legal version id used: the customer-supplied textVersionId when
      // provided (already validated to belong to this tenant and be a published
      // power_of_attorney version), otherwise the published POA version.
      const poaLegalVersionId =
        structuredPoa?.textVersionId ??
        legalAcceptanceVersions.find((version) => version.type === 'power_of_attorney')?.id ??
        null
      const tenantSlug = await loadCompanySlugById(input.client.company_id)
      const poaDocumentUrl = tenantSlug && poaLegalVersionId
        ? buildPublicLegalUrl(tenantSlug, 'power_of_attorney', poaLegalVersionId)
        : null
      responsePayload.power_of_attorney_id = powerOfAttorneyId
      responsePayload.power_of_attorney = {
        status: 'signed',
        scope: structuredPoa && structuredPoa.scope.length > 0 ? structuredPoa.scope : ['supplier_switch', 'facility_information_lookup'],
        method: effectiveSignerMethod,
        externally_sendable: poaExternallySendable,
        // When the POA cannot be sent externally, fullmakt must be completed
        // (signer identity/name) before automated grid-owner communication.
        requires_completion: !poaExternallySendable,
        text_version_id: poaLegalVersionId,
        document_url: poaDocumentUrl,
      }
      if (!poaExternallySendable) {
        poaWarnings.push(
          'Fullmakten är registrerad som juridisk accept men är inte externt sändbar. Automatisk nätägarkommunikation kräver strukturerad powerOfAttorney med signerName, signerIdentityNumber och method.',
        )
      }
      const applicationUpdateResult = await supabaseService
        .from('website_customer_applications')
        .update({
          response_payload: { ...responsePayload, power_of_attorney_id: powerOfAttorneyId },
          updated_at: new Date().toISOString(),
        })
        .eq('id', application.id)

      if (applicationUpdateResult.error && !missingSchema(applicationUpdateResult.error)) throw applicationUpdateResult.error
    }

    // This is the durable commit point. No external grid-owner or Ediel automation
    // is allowed before all internal references, legal state and workflow metadata
    // are atomically verified in PostgreSQL.
    const workflow = await stage('application_workflow', () => commitApplicationProvisioning({
      companyId: input.client.company_id,
      applicationId: application.id,
      customerId: resolvedCustomerResult.customer.id,
      siteId: site?.id ?? null,
      meteringPointId: meteringPoint?.id ?? null,
      contractId: contract?.id ?? null,
      powerOfAttorneyId,
      desiredState: readiness.canStartSwitch ? 'ready_for_switch' : site?.id && powerOfAttorneyId ? 'pending_customer_data' : 'pending_review',
      snapshot: {
        application_status: applicationStatus,
        resolver_status: energyResolution.resolution.resolutionStatus,
        grid_area_code: readiness.gridAreaCode,
        price_area: readiness.priceArea,
        legal_acceptance_complete: Boolean(powerOfAttorneyId),
        facility_verified: readiness.facilityVerified,
      },
    }))

    const committedSiteId = site?.id ?? null
    const facilityMissing = Boolean(committedSiteId) && !site?.facility_id
    // Missing facility id must use MANUAL grid-owner communication only (handled
    // in the nextAction block below via requestMissingFacilityInformation). It
    // must never create the Ediel-channel grid_owner_information_request or the
    // PRODAT Z01-first customer-data automation, which would race the manual
    // request and produce a parallel open request for the same site.
    const gridOwnerRequestMayBeCreated = readiness.canRequestGridOwnerInformation && !facilityMissing

    const gridOwnerRequest = gridOwnerRequestMayBeCreated
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

    if (committedSiteId && powerOfAttorneyId && !facilityMissing) {
      await stage('customer_data_automation', () => enqueueCustomerDataRequestAutomation({
        companyId: input.client.company_id,
        customerId: resolvedCustomerResult.customer.id,
        siteId: committedSiteId,
        meteringPointId: meteringPoint?.id ?? null,
        source: 'website_application_committed',
        operationId: workflow.operationId,
      }))
    }

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

    // Operational nextAction + (optional) manual information request block. These
    // expose only operational status to the website/API caller — never technical
    // Ediel diagnostics. When facility_id is missing and POA exists, the manual
    // e-mail information request is queued (PRODAT Z01 is never rendered here).
    let nextAction: { code: string; message: string }
    let manualInformationRequest: Record<string, unknown> | null = null

    if (!powerOfAttorneyId && facilityMissing) {
      nextAction = { code: 'power_of_attorney_required', message: 'Fullmakt krävs innan anläggningsuppgifter kan begäras från nätägaren.' }
    } else if (powerOfAttorneyId && facilityMissing && !poaExternallySendable) {
      nextAction = {
        code: 'poa_not_externally_sendable',
        message: 'Fullmakten är registrerad men kan inte skickas automatiskt till nätägaren. Komplettera med signerName, signerIdentityNumber och method i strukturerad powerOfAttorney.',
      }
    } else if (powerOfAttorneyId && facilityMissing) {
      const intakeDecision = await stage('customer_intake_orchestrator', () => processWebsiteApplicationIntake({
        companyId: input.client.company_id,
        customerId: resolvedCustomerResult.customer.id,
        siteId: committedSiteId as string,
        actorUserId: null,
      }))
      manualInformationRequest = await stage('manual_information_request_summary', () =>
        loadWebsiteManualInformationRequest(intakeDecision.references.gridOwnerInformationRequestId),
      )
      nextAction = websiteNextActionFromIntake(intakeDecision)
    } else if (readiness.canStartSwitch) {
      nextAction = { code: 'ready_for_switch', message: 'Ansökan är klar för leverantörsbyte.' }
    } else {
      nextAction = { code: 'in_progress', message: readiness.nextStep ?? 'Ansökan behandlas.' }
    }

    responsePayload.next_action = nextAction
    responsePayload.nextAction = nextAction
    if (manualInformationRequest) {
      responsePayload.manual_information_request = manualInformationRequest
      responsePayload.manualInformationRequest = manualInformationRequest
    }
    await supabaseService
      .from('website_customer_applications')
      .update({ response_payload: { ...responsePayload }, updated_at: new Date().toISOString() })
      .eq('id', application.id)
      .eq('company_id', input.client.company_id)
      .then(() => undefined, () => undefined)

    await stage('application_workflow_transition', () => transitionCustomerApplicationWorkflow({
      companyId: input.client.company_id,
      applicationId: application.id,
      state: readiness.canStartSwitch
        ? 'ready_for_switch'
        : gridOwnerRequest?.requestId || (site?.id && powerOfAttorneyId)
          ? 'pending_customer_data'
          : 'pending_review',
      snapshotPatch: {
        grid_owner_information_request_id: gridOwnerRequest?.requestId ?? null,
        grid_owner_information_request_status: gridOwnerRequest?.status ?? null,
        customer_operation_requested: Boolean(site?.id && powerOfAttorneyId),
      },
    }))

    const warnings: string[] = [...readiness.warnings, ...(gridOwnerRequest?.warnings ?? []), ...poaWarnings]
    let communicationResults: unknown[] = []
    let triggeredEmailEvents: string[] = []

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
        const initialApplicationEmail = { eventKey: 'contract.application_received' as const }
        const contractLegalMailReady = Boolean(
          contract?.id &&
          publicOffer &&
          contractLegalMailEvidenceReady({
            acceptanceIds: legalAcceptanceIds,
            powerOfAttorneyRequired,
            powerOfAttorneyId,
          })
        )
        triggeredEmailEvents = [
          initialApplicationEmail.eventKey,
          ...(contractLegalMailReady ? ['contract.confirmation_sent', 'contract.cooling_off_sent'] : []),
        ]

        communicationResults = await Promise.all(triggeredEmailEvents.map(async (eventKey) => {
          const result = await triggerEmailEvent({
            companyId: input.client.company_id,
            customerId: resolvedCustomerResult.customer.id,
            siteId: site?.id ?? null,
            meteringPointId: meteringPoint?.id ?? null,
            eventKey,
            to: email,
            variables,
            idempotencyKey: `website_application:${application.id}:${eventKey}`,
            metadata: {
              application_id: application.id,
              contract_id: contract?.id ?? null,
              external_customer_id: externalCustomerId,
              customer_number: customerNumber,
              source: 'website_customer_applications',
            },
          }).catch((error) => [{ ok: false, eventKey, error: errorMessage(error) }])

          return {
            eventKey,
            ok: emailTriggerSucceeded(result),
            result,
          }
        }))

        const failedEmailResults = communicationResults
          .filter((item): item is { eventKey: string; ok: boolean; result: unknown } => {
            if (!item || typeof item !== 'object') return false
            const candidate = item as { eventKey?: unknown; ok?: unknown; result?: unknown }
            return typeof candidate.eventKey === 'string' && typeof candidate.ok === 'boolean'
          })
          .filter((item) => item.ok === false)
        if (failedEmailResults.length > 0) {
          pushWarning(warnings, 'communication_failed')
          pushWarning(warnings, 'confirmation_email_pending')
          if (failedEmailResults.some((item) => item.eventKey === 'contract.confirmation_sent' || item.eventKey === 'contract.cooling_off_sent')) {
            pushWarning(warnings, 'legal_email_pending')
          }
          if (failedEmailResults.some((item) => /sender|avsändare|domain|domän|verified|verifierad/i.test(emailTriggerErrorText(item.result)))) {
            pushWarning(warnings, 'legal_email_sender_not_verified')
          }
        }
      } catch (error: unknown) {
        pushWarning(warnings, 'communication_failed')
        pushWarning(warnings, 'confirmation_email_pending')
        pushWarning(warnings, 'legal_email_pending')
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

      if (resolvedCustomerResult.customerNumberAssigned) {
        await emitDomainEvent({
          companyId: input.client.company_id,
          eventType: 'customer_number.assigned',
          aggregateType: 'customer',
          aggregateId: resolvedCustomerResult.customer.id,
          subjectCustomerId: resolvedCustomerResult.customer.id,
          source: 'website_customer_applications',
          idempotencyKey: input.idempotencyKey ? `website-customer-number:${input.client.company_id}:${input.idempotencyKey}` : `customer-number:${input.client.company_id}:${resolvedCustomerResult.customer.id}:${customerNumber}`,
          payload: {
            customer_number: customerNumber,
            external_customer_id: externalCustomerId,
            application_id: application.id,
            api_client_id: input.client.id,
          },
        })
      }

      if (contract?.id) {
        // Website submission emits only the application lifecycle event here.
        // Legal mail events with names ending in `_sent` are emitted after the
        // actual communication_log is marked sent by the email outbox/provider
        // webhook, never inferred from application creation or switch readiness.
        const contractLifecycleEvents = ['contract.application_received']
        for (const eventType of contractLifecycleEvents) {
          await emitDomainEvent({
            companyId: input.client.company_id,
            eventType,
            aggregateType: 'customer_contract',
            aggregateId: contract.id,
            subjectCustomerId: resolvedCustomerResult.customer.id,
            source: 'website_customer_applications',
            idempotencyKey: input.idempotencyKey ? `website-contract:${eventType}:${input.client.company_id}:${input.idempotencyKey}` : null,
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
      }
    } catch (error) {
      pushWarning(warnings, 'domain_event_pending')
      pushWarning(warnings, 'webhook_delivery_pending')
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
        triggered: email ? triggeredEmailEvents : [],
        results: communicationResults,
      },
    }, warnings)
  } catch (error) {
    const appError = error instanceof WebsiteApplicationError
      ? error
      : new WebsiteApplicationError({ message: errorMessage(error), status: 500, code: 'internal_error', stage: 'application_record_create' })

    const safeErrorMessage = operationalErrorMessage(appError)
    const controlledBusinessError = isControlledBusinessError(appError)
    const schemaStatus = schemaRepairStatus(error) ?? schemaRepairStatus(appError)
    // If the application row already exists, the failure happened mid-pipeline
    // (e.g. power of attorney) after customer/site/contract were provisioned —
    // that is a partial success, not a clean failure.
    const genericFailureStatus = applicationRowId ? 'partial' : 'failed'
    const businessStatus = schemaStatus ?? (controlledBusinessError ? controlledBusinessStatus(appError) : genericFailureStatus)
    const businessNextStep = schemaStatus
      ? 'Teknisk admin behöver köra senaste migration/schema-fix och sedan reparera eller retrya ansökan från admin.'
      : controlledBusinessError
        ? controlledBusinessNextStep(appError)
        : 'Tekniskt fel kräver åtgärd innan ansökan kan fortsätta.'
    const failedBlockingReasons = [
      ...readiness.blockingReasons,
      controlledBusinessError ? controlledBusinessBlockingReason(appError) : technicalBlockingReason(appError),
    ]
    const failedResponsePayload: Record<string, unknown> = {
      error: safeErrorMessage,
      code: appError.code,
      error_stage: appError.stage,
      status: businessStatus,
      // Never leave a stale/implied power of attorney on a failed application —
      // a partial provisioning that lost the fullmakt must read as null.
      power_of_attorney_id: null,
      missing_fields: readiness.missingFields,
      blocking_reasons: failedBlockingReasons,
      next_step: businessNextStep,
      requested_start_date: readiness.requestedStartDate,
      confirmed_start_date: readiness.confirmedStartDate,
      actual_start_date: readiness.actualStartDate,
      can_start_switch: false,
      can_send_agreement_confirmation: false,
      can_activate_customer: false,
    }
    // When the application row already exists (mid-pipeline failure), update it
    // in place. Re-inserting would violate the unique idempotency index and the
    // original row would otherwise remain in a misleading success state.
    const failedApplication = applicationRowId
      ? await markApplicationFailed({
          applicationId: applicationRowId,
          companyId: input.client.company_id,
          status: businessStatus,
          responsePayload: failedResponsePayload,
          errorStage: appError.stage,
          errorCode: appError.code,
          errorMessage: safeErrorMessage,
          missingFields: readiness.missingFields,
          blockingReasons: failedBlockingReasons,
          nextStep: businessNextStep,
          warnings: readiness.warnings,
        }).catch((failedUpdateError) => {
          console.warn('[website-applications] failed to mark application failed', failedUpdateError)
          return null
        })
      : await createApplicationRow({
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
        power_of_attorney_id: null,
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

    if (failedApplication?.id && customerResult?.customer?.id) {
      await failApplicationProvisioning({
        companyId: input.client.company_id,
        applicationId: failedApplication.id,
        code: appError.code,
        detail: errorMessage(appError),
      })
      await ensureCustomerApplicationWorkflow({
        companyId: input.client.company_id,
        applicationId: failedApplication.id,
        customerId: customerResult.customer.id,
        customerSiteId: site?.id ?? null,
        meteringPointId: meteringPoint?.id ?? null,
        contractId: contract?.id ?? null,
        state: 'failed',
        snapshot: {
          error_stage: appError.stage,
          error_code: appError.code,
          error_message: safeErrorMessage,
        },
      }).then((workflow) => transitionCustomerApplicationWorkflow({
        companyId: input.client.company_id,
        applicationId: failedApplication.id,
        state: 'failed',
        failureCode: appError.code,
        failureDetailInternal: errorMessage(appError),
        snapshotPatch: { workflow_operation_id: workflow.operationId },
      })).catch((workflowError) => {
        console.warn('[website-applications] failed to persist failed workflow state', workflowError)
      })
    }

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


type MissingPoaInlineRepairResult = {
  ok: boolean
  code?: string
  message?: string
  data: Record<string, unknown>
  warnings: string[]
}

// Inline self-healing for idempotent replays where the original successful
// application row was missing its power_of_attorney_id. The public website API
// must not force normal customers into an admin-repair/idempotency loop when
// the retry payload already contains a complete accepted powerOfAttorney from
// OPS legal documents. This is deliberately narrow: it only creates the missing
// POA on the existing application and updates the stored response/payload.
async function repairMissingPoaOnIdempotentApplication(input: {
  client: IntegrationApiClient
  existingApplication: {
    id: string
    response_payload: Record<string, unknown> | null
    payload?: Record<string, unknown> | null
    status: string
    customer_id: string | null
    customer_number: string | null
    external_customer_id: string | null
    customer_site_id?: string | null
    metering_point_id?: string | null
    contract_id?: string | null
    warnings?: string[] | null
  }
  body: ApplicationInput
  rawBody: unknown
  structuredPoa: NormalizedStructuredPoa | null
  externalCustomerId: string
  requestAudit?: RequestAuditMetadata
}): Promise<MissingPoaInlineRepairResult | null> {
  const existing = input.existingApplication
  const responsePayload = (existing.response_payload ?? {}) as Record<string, unknown>
  const existingPoaId = clean(responsePayload.power_of_attorney_id)
  const warnings = Array.isArray(existing.warnings) ? existing.warnings.map((warning) => String(warning)) : []

  if (existingPoaId) {
    return {
      ok: true,
      data: {
        ...responsePayload,
        idempotent: true,
        repaired: false,
        application_id: existing.id,
        customer_id: existing.customer_id ?? (responsePayload.customer_id as string | undefined) ?? null,
        customer_number: existing.customer_number ?? (responsePayload.customer_number as string | undefined) ?? null,
        external_customer_id: existing.external_customer_id ?? input.externalCustomerId,
        status: existing.status,
      },
      warnings,
    }
  }

  if (!existing.customer_id) {
    return {
      ok: false,
      code: 'customer_missing',
      message: 'Ansökan saknar kund och kan inte repareras automatiskt.',
      data: responsePayload,
      warnings,
    }
  }

  if (input.structuredPoa?.accepted !== true) {
    return {
      ok: false,
      code: 'power_of_attorney_missing',
      message: 'Retry-payloaden saknar accepterad strukturerad fullmakt.',
      data: responsePayload,
      warnings,
    }
  }

  const selectedOfferReference = clean(input.body.offer_reference) ?? clean(input.body.offerReference) ?? clean(input.body.contract?.offer_reference) ?? clean(input.body.contract?.offerReference)
  const selectedPricePlanVersionId = clean(input.body.price_plan_version_id) ?? clean(input.body.contract?.price_plan_version_id)
  const selectedPricePlanId = clean(input.body.price_plan_id) ?? clean(input.body.contract?.price_plan_id)
  const selectedContractOfferId = clean(input.body.contract_offer_id) ?? clean(input.body.contract?.contract_offer_id)
  const selectedProductCode = clean(input.body.product_code) ?? clean(input.body.contract?.product_code)

  const publicOffer = await resolvePublicContractOffer({
    client: input.client,
    offerReference: selectedOfferReference,
    pricePlanVersionId: selectedPricePlanVersionId,
    pricePlanId: selectedPricePlanId,
    contractOfferId: selectedContractOfferId,
    productCode: selectedProductCode,
    customerType: input.body.customer.customer_type,
  })

  if (!publicOffer) {
    return {
      ok: false,
      code: 'public_contract_not_available',
      message: 'Avtalet kunde inte verifieras mot publicerade OPS-avtal och fullmakten kan inte repareras automatiskt.',
      data: responsePayload,
      warnings,
    }
  }

  const legalVersions = await assertWebsiteLegalAcceptances({
    companyId: input.client.company_id,
    consents: input.body.consents,
    publicOffer,
  })

  const { data: existingAcceptances, error: acceptanceLoadError } = await supabaseService
    .from('customer_legal_acceptances')
    .select('id')
    .eq('company_id', input.client.company_id)
    .eq('contract_application_id', existing.id)
    .limit(1)
  if (acceptanceLoadError && !missingSchema(acceptanceLoadError)) throw acceptanceLoadError

  if ((!existingAcceptances || existingAcceptances.length === 0) && legalVersions.length > 0) {
    await persistCustomerLegalAcceptances({
      companyId: input.client.company_id,
      customerId: existing.customer_id,
      contractId: existing.contract_id ?? null,
      applicationId: existing.id,
      publicOffer,
      legalVersions,
      consents: input.body.consents,
      rawPayload: input.rawBody,
      requestAudit: input.requestAudit,
    })
  }

  const powerOfAttorneyId = await ensureWebsitePowerOfAttorney({
    companyId: input.client.company_id,
    customerId: existing.customer_id,
    contractId: existing.contract_id ?? null,
    customerSiteId: existing.customer_site_id ?? null,
    meteringPointId: existing.metering_point_id ?? null,
    applicationId: existing.id,
    publicOffer,
    legalVersions,
    consents: input.body.consents,
    requestAudit: input.requestAudit,
    rawPayload: input.rawBody,
    structuredPoa: input.structuredPoa,
  })

  if (!powerOfAttorneyId) {
    return {
      ok: false,
      code: 'power_of_attorney_missing',
      message: 'Fullmakten kunde inte skapas på den befintliga ansökan.',
      data: responsePayload,
      warnings,
    }
  }

  const poaExternallySendable = structuredPoaIsExternallySendable(input.structuredPoa)
  const poaLegalVersionId =
    input.structuredPoa?.textVersionId ??
    legalVersions.find((version) => version.type === 'power_of_attorney')?.id ??
    null
  const tenantSlug = await loadCompanySlugById(input.client.company_id)
  const poaDocumentUrl = tenantSlug && poaLegalVersionId
    ? buildPublicLegalUrl(tenantSlug, 'power_of_attorney', poaLegalVersionId)
    : null

  const updatedResponsePayload: Record<string, unknown> = {
    ...responsePayload,
    power_of_attorney_id: powerOfAttorneyId,
    power_of_attorney: {
      status: 'signed',
      scope: input.structuredPoa && input.structuredPoa.scope.length > 0 ? input.structuredPoa.scope : ['supplier_switch', 'facility_information_lookup'],
      method: input.structuredPoa?.method ?? null,
      externally_sendable: poaExternallySendable,
      requires_completion: !poaExternallySendable,
      text_version_id: poaLegalVersionId,
      document_url: poaDocumentUrl,
      repaired: true,
    },
    repaired_at: new Date().toISOString(),
    repaired_reason: 'idempotent_missing_power_of_attorney',
  }

  const { error: updateError } = await supabaseService
    .from('website_customer_applications')
    .update({
      payload: input.body,
      raw_payload: input.rawBody,
      response_payload: updatedResponsePayload,
      error_stage: null,
      error_code: null,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id)
    .eq('company_id', input.client.company_id)
  if (updateError && !missingSchema(updateError)) throw updateError

  await emitDomainEvent({
    companyId: input.client.company_id,
    eventType: 'website_application.repaired',
    aggregateType: 'website_customer_application',
    aggregateId: existing.id,
    subjectCustomerId: existing.customer_id,
    source: 'website_customer_applications_inline_repair',
    idempotencyKey: `website-application-inline-repair:${input.client.company_id}:${existing.id}:${powerOfAttorneyId}`,
    payload: {
      application_id: existing.id,
      power_of_attorney_id: powerOfAttorneyId,
      externally_sendable: poaExternallySendable,
      reason: 'idempotent_missing_power_of_attorney',
    },
  }).catch((eventError) => {
    console.warn('[website-applications] inline POA repair audit event failed', eventError)
  })

  const repairedWarnings = poaExternallySendable
    ? warnings
    : [...warnings, 'Fullmakten är registrerad men måste kompletteras innan extern nätägarkommunikation.']

  return {
    ok: true,
    data: {
      ...updatedResponsePayload,
      idempotent: true,
      repaired: true,
      application_id: existing.id,
      customer_id: existing.customer_id,
      customer_number: existing.customer_number ?? (responsePayload.customer_number as string | undefined) ?? null,
      external_customer_id: existing.external_customer_id ?? input.externalCustomerId,
      status: existing.status,
    },
    warnings: repairedWarnings,
  }
}

export type RepairWebsiteCustomerApplicationResult = {
  ok: boolean
  status: 'repaired' | 'completed' | 'no_action' | 'failed'
  code?: string
  message: string
  applicationId: string
  powerOfAttorneyId?: string | null
}

// Admin/platform-guarded repair for an application whose power of attorney was
// lost during a partial/failed run. It re-reads the stored payload, re-creates
// the missing power of attorney (and legal acceptances if absent), updates the
// response payload and status, and writes an audit event.
//
// This MUST only be invoked from a platform/admin-guarded server action — it is
// never exposed as a public endpoint and takes no caller-supplied tenant scope.
export async function repairWebsiteCustomerApplication(
  applicationId: string,
): Promise<RepairWebsiteCustomerApplicationResult> {
  const { data: appRow, error: loadError } = await supabaseService
    .from('website_customer_applications')
    .select('id,company_id,api_client_id,customer_id,contract_id,customer_site_id,metering_point_id,status,payload,raw_payload,response_payload,external_customer_id')
    .eq('id', applicationId)
    .maybeSingle()
  if (loadError) throw loadError
  if (!appRow) {
    return { ok: false, status: 'failed', code: 'application_not_found', message: 'Ansökan hittades inte.', applicationId }
  }

  const companyId = String(appRow.company_id)
  const customerId = appRow.customer_id ? String(appRow.customer_id) : null
  if (!customerId) {
    return { ok: false, status: 'failed', code: 'customer_missing', message: 'Ansökan saknar kund och kan inte repareras automatiskt.', applicationId }
  }

  const { data: customerRow, error: customerError } = await supabaseService
    .from('customers')
    .select('id')
    .eq('company_id', companyId)
    .eq('id', customerId)
    .maybeSingle()
  if (customerError) throw customerError
  if (!customerRow) {
    return { ok: false, status: 'failed', code: 'customer_missing', message: 'Kunden för ansökan finns inte längre.', applicationId }
  }

  const responsePayload = (appRow.response_payload ?? {}) as Record<string, unknown>
  const existingPoaId = clean(responsePayload.power_of_attorney_id)
  if (existingPoaId) {
    return { ok: true, status: 'no_action', message: 'Fullmakt finns redan registrerad på ansökan.', applicationId, powerOfAttorneyId: existingPoaId }
  }

  const storedPayload = (appRow.payload ?? appRow.raw_payload ?? {}) as Record<string, unknown>
  const normalizedRaw = normalizeRawApplication(storedPayload)
  const parsed = ApplicationSchema.safeParse(normalizedRaw)
  if (!parsed.success) {
    return { ok: false, status: 'failed', code: 'payload_invalid', message: 'Sparad payload kunde inte tolkas för reparation.', applicationId }
  }
  let body = parsed.data
  const structuredPoa = normalizeStructuredPoa(body)
  if (structuredPoa?.accepted === true) {
    body = { ...body, consents: { ...(body.consents ?? {}), power_of_attorney: true } }
  }
  if (!consentAccepted(body.consents, ['power_of_attorney', 'poa_accepted', 'power_of_attorney_accepted'])) {
    return { ok: false, status: 'no_action', code: 'power_of_attorney_missing', message: 'Den sparade ansökan innehåller ingen accepterad fullmakt att reparera.', applicationId }
  }

  const minimalClient = {
    id: appRow.api_client_id ? String(appRow.api_client_id) : 'repair',
    company_id: companyId,
    name: 'repair',
    status: 'active',
    key_prefix: '',
    secret_hash: '',
    scopes: ['*'],
    allowed_ips: [],
    rate_limit_per_minute: 0,
    expires_at: null,
  } as IntegrationApiClient

  const selectedOfferReference = clean(body.offer_reference) ?? clean(body.offerReference) ?? clean(body.contract?.offer_reference) ?? clean(body.contract?.offerReference)
  const selectedPricePlanVersionId = clean(body.price_plan_version_id) ?? clean(body.contract?.price_plan_version_id)
  const selectedPricePlanId = clean(body.price_plan_id) ?? clean(body.contract?.price_plan_id)
  const selectedContractOfferId = clean(body.contract_offer_id) ?? clean(body.contract?.contract_offer_id)
  const selectedProductCode = clean(body.product_code) ?? clean(body.contract?.product_code)

  const publicOffer = await resolvePublicContractOffer({
    client: minimalClient,
    offerReference: selectedOfferReference,
    pricePlanVersionId: selectedPricePlanVersionId,
    pricePlanId: selectedPricePlanId,
    contractOfferId: selectedContractOfferId,
    productCode: selectedProductCode,
    customerType: body.customer.customer_type,
  }).catch(() => null)

  let legalVersions: WebsiteLegalAcceptanceVersion[] = []
  if (publicOffer) {
    legalVersions = await assertWebsiteLegalAcceptances({
      companyId,
      consents: body.consents,
      publicOffer,
    })
  }

  // Re-create legal acceptances only if none exist for this application yet.
  const { data: existingAcceptances } = await supabaseService
    .from('customer_legal_acceptances')
    .select('id')
    .eq('company_id', companyId)
    .eq('contract_application_id', applicationId)
    .limit(1)
  if ((!existingAcceptances || existingAcceptances.length === 0) && legalVersions.length > 0) {
    await persistCustomerLegalAcceptances({
      companyId,
      customerId,
      contractId: appRow.contract_id ? String(appRow.contract_id) : null,
      applicationId,
      publicOffer,
      legalVersions,
      consents: body.consents,
      rawPayload: storedPayload,
    })
  }

  const powerOfAttorneyId = await ensureWebsitePowerOfAttorney({
    companyId,
    customerId,
    contractId: appRow.contract_id ? String(appRow.contract_id) : null,
    customerSiteId: appRow.customer_site_id ? String(appRow.customer_site_id) : null,
    meteringPointId: appRow.metering_point_id ? String(appRow.metering_point_id) : null,
    applicationId,
    publicOffer,
    legalVersions,
    consents: body.consents,
    rawPayload: storedPayload,
    structuredPoa,
  })

  if (!powerOfAttorneyId) {
    return { ok: false, status: 'failed', code: 'power_of_attorney_missing', message: 'Fullmakten kunde inte skapas vid reparation.', applicationId }
  }

  const poaExternallySendable = structuredPoaIsExternallySendable(structuredPoa)
  const nextStatus = poaExternallySendable ? 'completed' : 'repaired'
  const updatedResponsePayload: Record<string, unknown> = {
    ...responsePayload,
    power_of_attorney_id: powerOfAttorneyId,
    power_of_attorney: {
      status: 'signed',
      externally_sendable: poaExternallySendable,
      requires_completion: !poaExternallySendable,
      repaired: true,
    },
    repaired_at: new Date().toISOString(),
  }

  const { error: updateError } = await supabaseService
    .from('website_customer_applications')
    .update({
      status: nextStatus,
      response_payload: updatedResponsePayload,
      error_stage: null,
      error_code: null,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', applicationId)
    .eq('company_id', companyId)
  if (updateError && !missingSchema(updateError)) throw updateError

  await emitDomainEvent({
    companyId,
    eventType: 'website_application.repaired',
    aggregateType: 'website_customer_application',
    aggregateId: applicationId,
    subjectCustomerId: customerId,
    source: 'website_customer_applications_repair',
    idempotencyKey: `website-application-repair:${companyId}:${applicationId}:${powerOfAttorneyId}`,
    payload: {
      application_id: applicationId,
      power_of_attorney_id: powerOfAttorneyId,
      externally_sendable: poaExternallySendable,
      previous_status: appRow.status,
      new_status: nextStatus,
    },
  }).catch((eventError) => {
    console.warn('[website-applications] repair audit event failed', eventError)
  })

  return {
    ok: true,
    status: nextStatus,
    message: poaExternallySendable
      ? 'Fullmakten skapades och ansökan markerades som klar.'
      : 'Fullmakten skapades men måste kompletteras för extern sändning.',
    applicationId,
    powerOfAttorneyId,
  }
}
