import { z } from 'zod'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { supabaseService } from '@/lib/supabase/service'
import { ensureCustomerNumber, reserveCustomerNumber } from '@/lib/customer-numbers/customerNumbers'
import { emitDomainEvent } from '@/lib/events/domainEvents'
import { seedDefaultEmailEventRules, triggerEmailEvent } from '@/lib/email/emailEvents'
import { seedDefaultEmailTemplates } from '@/lib/email/emailTemplates'

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
  start_date: OPTIONAL_TEXT,
  installation_date: OPTIONAL_TEXT,
  estimated_annual_consumption_kwh: z.coerce.number().optional(),
}).optional()

const ContractSchema = z.object({
  contract_name: OPTIONAL_TEXT,
  contract_type: OPTIONAL_TEXT,
  starts_at: OPTIONAL_TEXT,
  expected_start_at: OPTIONAL_TEXT,
  signed_at: OPTIONAL_TEXT,
  monthly_fee_sek: z.coerce.number().optional(),
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
  customer: CustomerSchema,
  site: SiteSchema,
  metering_point: MeteringPointSchema,
  contract: ContractSchema,
  consents: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
})

type ApplicationInput = z.infer<typeof ApplicationSchema>

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
  | 'application_record_create'
  | 'communication_trigger'
  | 'domain_event_create'
  | 'webhook_queue'

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
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Kundansökan kunde inte behandlas.'
}

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
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

  const customer = {
    customer_type: raw.customer_type ?? rawCustomer.customer_type ?? 'private',
    first_name: raw.first_name ?? rawCustomer.first_name,
    last_name: raw.last_name ?? rawCustomer.last_name,
    full_name: raw.name ?? raw.full_name ?? rawCustomer.full_name ?? rawCustomer.name,
    company_name: raw.company_name ?? rawCustomer.company_name,
    personal_number: raw.personal_number ?? rawCustomer.personal_number,
    org_number: raw.org_number ?? rawCustomer.org_number,
    email: raw.email ?? rawCustomer.email,
    phone: raw.phone ?? rawCustomer.phone,
    invoice_email: raw.invoice_email ?? rawCustomer.invoice_email,
    billing_street: raw.billing_street ?? rawCustomer.billing_street ?? rawAddress.street,
    billing_postal_code: raw.billing_postal_code ?? rawCustomer.billing_postal_code ?? rawAddress.postal_code,
    billing_city: raw.billing_city ?? rawCustomer.billing_city ?? rawAddress.city,
    billing_country: raw.billing_country ?? rawCustomer.billing_country ?? rawAddress.country,
  }

  const topLevelMeteringPointId = firstClean(
    raw.metering_point_id,
    raw.meter_point_id,
    raw.ediel_metering_point_id,
    raw.anlage_id
  )
  const topLevelFacilityId = firstClean(
    raw.facility_id,
    raw.site_facility_id,
    raw.anlage_id,
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
      'address',
      'street_address',
      'postal_code',
      'zip',
      'city',
      'country',
      'price_area_code',
      'price_area',
      'move_in_date',
    ]) ||
    firstDefined(raw.annual_consumption_kwh, raw.estimated_annual_consumption_kwh) !== undefined
  )

  const site = hasTopLevelSite
    ? {
        ...(nestedSite ?? {}),
        facility_id: firstDefined(nestedSite?.facility_id, raw.facility_id, raw.site_facility_id, raw.anlage_id, topLevelFacilityId),
        site_name: firstDefined(nestedSite?.site_name, raw.site_name),
        site_type: firstDefined(nestedSite?.site_type, raw.site_type),
        street: firstDefined(nestedSite?.street, raw.street, raw.address_line1, raw.address, raw.street_address, rawAddress.street),
        postal_code: firstDefined(nestedSite?.postal_code, raw.postal_code, raw.zip, rawAddress.postal_code),
        city: firstDefined(nestedSite?.city, raw.city, rawAddress.city),
        country: firstDefined(nestedSite?.country, raw.country, rawAddress.country),
        price_area_code: firstDefined(nestedSite?.price_area_code, nestedSite?.price_area, raw.price_area_code, raw.price_area),
        move_in_date: firstDefined(nestedSite?.move_in_date, raw.move_in_date, raw.start_date),
        annual_consumption_kwh: firstDefined(
          nestedSite?.annual_consumption_kwh,
          raw.annual_consumption_kwh,
          raw.estimated_annual_consumption_kwh
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
      'installation_date',
    ]) ||
    firstDefined(raw.estimated_annual_consumption_kwh, raw.annual_consumption_kwh) !== undefined
  )

  const meteringPoint = hasTopLevelMeteringPoint
    ? {
        ...(nestedMeteringPoint ?? {}),
        metering_point_id: firstDefined(nestedMeteringPoint?.metering_point_id, raw.metering_point_id, topLevelMeteringPointId),
        meter_point_id: firstDefined(nestedMeteringPoint?.meter_point_id, raw.meter_point_id, topLevelMeteringPointId),
        ediel_metering_point_id: firstDefined(nestedMeteringPoint?.ediel_metering_point_id, raw.ediel_metering_point_id, topLevelMeteringPointId),
        anlage_id: firstDefined(nestedMeteringPoint?.anlage_id, raw.anlage_id, site?.facility_id, topLevelFacilityId),
        site_facility_id: firstDefined(nestedMeteringPoint?.site_facility_id, raw.site_facility_id, site?.facility_id, topLevelFacilityId),
        reading_frequency: firstDefined(nestedMeteringPoint?.reading_frequency, raw.reading_frequency),
        measurement_type: firstDefined(nestedMeteringPoint?.measurement_type, raw.measurement_type),
        price_area_code: firstDefined(
          nestedMeteringPoint?.price_area_code,
          nestedMeteringPoint?.price_area,
          raw.price_area_code,
          raw.price_area,
          site?.price_area_code
        ),
        start_date: firstDefined(nestedMeteringPoint?.start_date, raw.start_date, site?.move_in_date),
        installation_date: firstDefined(nestedMeteringPoint?.installation_date, raw.installation_date, raw.start_date, site?.move_in_date),
        estimated_annual_consumption_kwh: firstDefined(
          nestedMeteringPoint?.estimated_annual_consumption_kwh,
          raw.estimated_annual_consumption_kwh,
          raw.annual_consumption_kwh,
          site?.annual_consumption_kwh
        ),
      }
    : undefined

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
    metadata: {
      ...(isObject(raw.metadata) ? raw.metadata : {}),
      original_payload_shape: isObject(raw.customer) || nestedSite || nestedMeteringPoint ? 'nested' : 'simplified',
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
  customerNumber: string
  siteId?: string | null
  facilityId?: string | null
  meteringPointId?: string | null
  contractName?: string | null
  startDate?: string | null
}) {
  const cancellationDeadline = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
  return {
    customer_name: input.customer.full_name ?? input.customer.company_name ?? input.customer.email ?? input.customerNumber,
    customer_number: input.customerNumber,
    company_name: input.companyName,
    contract_name: input.contractName ?? 'Elavtal',
    start_date: input.startDate ?? '',
    facility_id: input.facilityId ?? '',
    metering_point_id: input.meteringPointId ?? '',
    support_email: 'kundservice@gridex.se',
    cancellation_deadline: cancellationDeadline,
    portal_url: 'https://app.gridex.se/login',
  }
}

async function companyName(companyId: string): Promise<string> {
  const { data, error } = await supabaseService
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .maybeSingle()
  if (error) throw error
  return clean(data?.name) ?? 'Gridex'
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
  const facilityId = clean(site.facility_id)

  if (facilityId) {
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

async function createContract(companyId: string, customerId: string, siteId: string | null, meteringPointId: string | null, input: ApplicationInput) {
  const contract = input.contract
  if (!contract) return null
  const contractName = clean(contract.contract_name) ?? 'Elavtal'
  const startsAt = clean(contract.starts_at) ?? clean(contract.expected_start_at) ?? clean(input.site?.move_in_date)

  const fullPayload = {
    company_id: companyId,
    customer_id: customerId,
    site_id: siteId,
    source_type: 'website_application',
    status: 'application_received',
    contract_name: contractName,
    contract_type: clean(contract.contract_type) ?? 'variable_monthly',
    starts_at: startsAt,
    signed_at: clean(contract.signed_at) ?? new Date().toISOString(),
    monthly_fee_sek: contract.monthly_fee_sek ?? null,
    spot_markup_ore_per_kwh: contract.spot_markup_ore_per_kwh ?? null,
    variable_fee_ore_per_kwh: contract.variable_fee_ore_per_kwh ?? null,
    fixed_price_ore_per_kwh: contract.fixed_price_ore_per_kwh ?? null,
    green_fee_mode: clean(contract.green_fee_mode) ?? 'none',
    green_fee_value: contract.green_fee_value ?? null,
    binding_months: contract.binding_months ?? null,
    notice_months: contract.notice_months ?? null,
    optional_fee_lines: [
      {
        source: 'website_customer_applications',
        metering_point_id: meteringPointId,
        consents: input.consents ?? {},
        source_metadata: input.metadata ?? {},
      },
    ],
    agreement_channel: 'external_website',
  }

  const { data, error } = await supabaseService
    .from('customer_contracts')
    .insert(fullPayload)
    .select('id,contract_name,starts_at,status')
    .single()

  if (error && !missingSchema(error)) throw error
  if (data) return data as { id: string; contract_name: string | null; starts_at: string | null; status: string }

  const fallback = await supabaseService
    .from('customer_contracts')
    .insert({
      company_id: companyId,
      customer_id: customerId,
      site_id: siteId,
      source_type: 'website_application',
      status: 'draft',
      contract_name: contractName,
      contract_type: clean(contract.contract_type) ?? 'variable_monthly',
      starts_at: startsAt,
      green_fee_mode: clean(contract.green_fee_mode) ?? 'none',
      agreement_channel: 'external_website',
    })
    .select('id,contract_name,starts_at,status')
    .single()
  if (fallback.error) throw fallback.error
  return fallback.data as { id: string; contract_name: string | null; starts_at: string | null; status: string }
}

async function createApplicationRow(input: {
  client: IntegrationApiClient
  externalCustomerId: string
  externalAccountId?: string | null
  customer?: CustomerRow | null
  customerSiteId?: string | null
  meteringPointId?: string | null
  contractId?: string | null
  payload: ApplicationInput | Record<string, unknown>
  rawPayload?: unknown
  responsePayload: Record<string, unknown>
  idempotencyKey?: string | null
  status: string
  warnings?: unknown[]
  errorStage?: string | null
  errorCode?: string | null
  errorMessage?: string | null
}) {
  const row = {
    company_id: input.client.company_id,
    api_client_id: input.client.id,
    customer_id: input.customer?.id ?? null,
    customer_site_id: input.customerSiteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    contract_id: input.contractId ?? null,
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
    processed_at: input.status === 'failed' ? null : new Date().toISOString(),
  }

  const { data, error } = await supabaseService
    .from('website_customer_applications')
    .insert(row)
    .select('id')
    .single()

  if (error && !missingSchema(error)) throw error
  if (data) return data as { id: string }

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
  return fallback.data as { id: string }
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
      error: error.message,
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
      details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    }))
  }

  const body = parsed.data
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
    let customerResult: { customer: CustomerRow; created: boolean }

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

    const customerNumber = customerResult.customer.customer_number ?? await stage('customer_number_create', () => ensureCustomerNumber({
      companyId: input.client.company_id,
      customerId: customerResult.customer.id,
    }))
    customerResult.customer.customer_number = customerNumber

    const site = await stage('site_create', () => upsertSite(input.client.company_id, customerResult.customer.id, body))
    const meteringPoint = await stage('metering_point_create', () => upsertMeteringPoint(input.client.company_id, customerResult.customer.id, site, body))
    const contract = await stage('contract_create', () => createContract(
      input.client.company_id,
      customerResult.customer.id,
      site?.id ?? null,
      meteringPoint?.id ?? null,
      body
    ))
    const identity = await stage('portal_identity_create', () => upsertPortalIdentity({
      client: input.client,
      customerId: customerResult.customer.id,
      externalCustomerId,
      externalAccountId: clean(body.external_account_id),
      email: normalizedEmail(body.customer.email),
    }))

    const applicationStatus = contract
      ? 'application_received'
      : site?.id && meteringPoint?.id
        ? 'application_received'
        : 'customer_created'

    const responsePayload = {
      customer_id: customerResult.customer.id,
      customer_number: customerNumber,
      external_customer_id: externalCustomerId,
      portal_identity_id: identity.id,
      customer_site_id: site?.id ?? null,
      metering_point_id: meteringPoint?.id ?? null,
      contract_id: contract?.id ?? null,
      status: applicationStatus,
      created_customer: customerResult.created,
    }

    const application = await stage('application_record_create', () => createApplicationRow({
      client: input.client,
      externalCustomerId,
      externalAccountId: clean(body.external_account_id),
      customer: customerResult.customer,
      customerSiteId: site?.id ?? null,
      meteringPointId: meteringPoint?.id ?? null,
      contractId: contract?.id ?? null,
      payload: body,
      rawPayload: input.rawBody,
      responsePayload,
      idempotencyKey: input.idempotencyKey ?? null,
      status: applicationStatus,
    }))

    const warnings: string[] = []
    let communicationResults: unknown[] = []

    const email = normalizedEmail(body.customer.email)
    if (email) {
      try {
        const company = await companyName(input.client.company_id)
        const variables = eventVariables({
          companyName: company,
          customer: customerResult.customer,
          customerNumber,
          siteId: site?.id ?? null,
          facilityId: site?.facility_id ?? clean(body.site?.facility_id),
          meteringPointId: meteringPoint?.metering_point_id ?? clean(body.metering_point?.metering_point_id),
          contractName: contract?.contract_name ?? clean(body.contract?.contract_name),
          startDate: contract?.starts_at ?? clean(body.contract?.starts_at) ?? clean(body.site?.move_in_date),
        })
        await seedDefaultEmailTemplates(input.client.company_id).catch(() => null)
        await seedDefaultEmailEventRules(input.client.company_id).catch(() => null)
        communicationResults = await Promise.all([
          triggerEmailEvent({
            companyId: input.client.company_id,
            customerId: customerResult.customer.id,
            eventKey: 'contract.application_received',
            to: email,
            variables,
          }).catch((error) => [{ ok: false, error: errorMessage(error) }]),
          triggerEmailEvent({
            companyId: input.client.company_id,
            customerId: customerResult.customer.id,
            eventKey: 'contract.cooling_off_sent',
            to: email,
            variables,
          }).catch((error) => [{ ok: false, error: errorMessage(error) }]),
        ])

        const flattenedResults = communicationResults.flatMap((item) => Array.isArray(item) ? item : [item]) as Array<{ ok?: boolean; error?: unknown }>
        if (flattenedResults.some((result) => result?.ok === false)) {
          warnings.push('confirmation_email_pending')
        }
      } catch (error) {
        warnings.push('confirmation_email_pending')
        communicationResults = [{ ok: false, error: errorMessage(error), stage: 'communication_trigger' }]
      }
    }

    try {
      await emitDomainEvent({
        companyId: input.client.company_id,
        eventType: customerResult.created ? 'customer.created' : 'customer.updated',
        aggregateType: 'customer',
        aggregateId: customerResult.customer.id,
        subjectCustomerId: customerResult.customer.id,
        source: 'website_customer_applications',
        idempotencyKey: input.idempotencyKey ? `website-customer:${input.client.company_id}:${input.idempotencyKey}:customer` : null,
        payload: {
          customer_number: customerNumber,
          external_customer_id: externalCustomerId,
          application_id: application.id,
          api_client_id: input.client.id,
        },
      })

      if (contract?.id) {
        await emitDomainEvent({
          companyId: input.client.company_id,
          eventType: 'contract.application_received',
          aggregateType: 'customer_contract',
          aggregateId: contract.id,
          subjectCustomerId: customerResult.customer.id,
          source: 'website_customer_applications',
          idempotencyKey: input.idempotencyKey ? `website-contract:${input.client.company_id}:${input.idempotencyKey}` : null,
          payload: {
            customer_number: customerNumber,
            external_customer_id: externalCustomerId,
            contract_id: contract.id,
            application_id: application.id,
            communication_results: communicationResults,
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
        triggered: email ? ['contract.application_received', 'contract.cooling_off_sent'] : [],
        results: communicationResults,
      },
    }, warnings)
  } catch (error) {
    const appError = error instanceof WebsiteApplicationError
      ? error
      : new WebsiteApplicationError({ message: errorMessage(error), status: 500, code: 'internal_error', stage: 'application_record_create' })

    await createApplicationRow({
      client: input.client,
      externalCustomerId,
      externalAccountId: clean(body.external_account_id),
      payload: body,
      rawPayload: input.rawBody,
      responsePayload: {
        error: appError.message,
        code: appError.code,
        error_stage: appError.stage,
      },
      idempotencyKey: input.idempotencyKey ?? null,
      status: 'failed',
      errorStage: appError.stage,
      errorCode: appError.code,
      errorMessage: appError.message,
      warnings: [],
    }).catch((failedInsertError) => {
      console.warn('[website-applications] failed to log failed application', failedInsertError)
    })

    return failureResponse(appError)
  }
}
