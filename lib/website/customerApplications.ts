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
  reading_frequency: OPTIONAL_TEXT,
  measurement_type: OPTIONAL_TEXT,
  price_area_code: OPTIONAL_TEXT,
  start_date: OPTIONAL_TEXT,
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
    if (error) throw error
    if (data) return data as CustomerRow
  }

  if (email) {
    const { data, error } = await supabaseService
      .from('customers')
      .select('id,customer_number,email,full_name,company_name')
      .eq('company_id', companyId)
      .eq('normalized_email', email)
      .limit(1)
      .maybeSingle()
    if (error) throw error
    if (data) return data as CustomerRow
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
  const { data, error } = await supabaseService
    .from('customer_portal_identities')
    .upsert({
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
    }, { onConflict: 'company_id,provider,external_customer_id' })
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
    const { data, error } = await supabaseService
      .from('customers')
      .update({
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
      })
      .eq('company_id', client.company_id)
      .eq('id', existing.id)
      .select('id,customer_number,email,full_name,company_name')
      .single()
    if (error) throw error
    return { customer: data as CustomerRow, created: false }
  }

  const { data, error } = await supabaseService
    .from('customers')
    .insert({
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
    })
    .select('id,customer_number,email,full_name,company_name')
    .single()

  if (error) throw error
  return { customer: data as CustomerRow, created: true }
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

  const { data, error } = await supabaseService
    .from('customer_sites')
    .insert({
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
    })
    .select('id,facility_id')
    .single()

  if (error) throw error
  return data as { id: string; facility_id: string | null }
}

async function upsertMeteringPoint(companyId: string, customerId: string, site: { id: string; facility_id: string | null } | null, input: ApplicationInput) {
  const metering = input.metering_point
  const meteringPointId = clean(metering?.metering_point_id) ?? clean(metering?.meter_point_id) ?? site?.facility_id ?? null
  if (!meteringPointId || !site?.id) return null

  const { data: existing, error: existingError } = await supabaseService
    .from('metering_points')
    .select('id,metering_point_id')
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .eq('site_id', site.id)
    .or(`metering_point_id.eq.${meteringPointId},meter_point_id.eq.${meteringPointId}`)
    .limit(1)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing?.id) return existing as { id: string; metering_point_id: string | null }

  const { data, error } = await supabaseService
    .from('metering_points')
    .insert({
      company_id: companyId,
      customer_id: customerId,
      site_id: site.id,
      meter_point_id: meteringPointId,
      metering_point_id: meteringPointId,
      site_facility_id: site.facility_id,
      status: 'active',
      measurement_type: clean(metering?.measurement_type) ?? 'consumption',
      reading_frequency: clean(metering?.reading_frequency) ?? 'monthly',
      price_area_code: clean(metering?.price_area_code) ?? clean(input.site?.price_area_code),
      start_date: clean(metering?.start_date) ?? clean(input.site?.move_in_date),
      metadata: { source: 'website_customer_applications' },
    })
    .select('id,metering_point_id')
    .single()

  if (error) throw error
  return data as { id: string; metering_point_id: string | null }
}

async function createContract(companyId: string, customerId: string, siteId: string | null, meteringPointId: string | null, input: ApplicationInput) {
  const contract = input.contract
  if (!contract) return null
  const contractName = clean(contract.contract_name) ?? 'Elavtal'
  const startsAt = clean(contract.starts_at) ?? clean(contract.expected_start_at) ?? clean(input.site?.move_in_date)

  const { data, error } = await supabaseService
    .from('customer_contracts')
    .insert({
      company_id: companyId,
      customer_id: customerId,
      site_id: siteId,
      customer_site_id: siteId,
      metering_point_id: meteringPointId,
      source_type: 'website_application',
      status: 'application_received',
      contract_name: contractName,
      contract_type: clean(contract.contract_type) ?? 'variable_monthly',
      starts_at: startsAt,
      expected_start_at: clean(contract.expected_start_at) ?? startsAt,
      signed_at: clean(contract.signed_at) ?? new Date().toISOString(),
      monthly_fee_sek: contract.monthly_fee_sek ?? null,
      spot_markup_ore_per_kwh: contract.spot_markup_ore_per_kwh ?? null,
      variable_fee_ore_per_kwh: contract.variable_fee_ore_per_kwh ?? null,
      fixed_price_ore_per_kwh: contract.fixed_price_ore_per_kwh ?? null,
      green_fee_mode: clean(contract.green_fee_mode) ?? 'none',
      green_fee_value: contract.green_fee_value ?? null,
      binding_months: contract.binding_months ?? null,
      notice_months: contract.notice_months ?? null,
      campaign_code: clean(contract.campaign_code),
      price_version: clean(contract.price_version),
      terms_version: clean(contract.terms_version),
      metadata: {
        source: 'website_customer_applications',
        consents: input.consents ?? {},
        source_metadata: input.metadata ?? {},
      },
    })
    .select('id,contract_name,starts_at,status')
    .single()

  if (error) throw error
  return data as { id: string; contract_name: string | null; starts_at: string | null; status: string }
}

async function createApplicationRow(input: {
  client: IntegrationApiClient
  externalCustomerId: string
  externalAccountId?: string | null
  customer: CustomerRow
  customerSiteId?: string | null
  meteringPointId?: string | null
  contractId?: string | null
  payload: ApplicationInput
  responsePayload: Record<string, unknown>
  idempotencyKey?: string | null
  status: string
}) {
  const { data, error } = await supabaseService
    .from('website_customer_applications')
    .insert({
      company_id: input.client.company_id,
      api_client_id: input.client.id,
      customer_id: input.customer.id,
      customer_site_id: input.customerSiteId ?? null,
      metering_point_id: input.meteringPointId ?? null,
      contract_id: input.contractId ?? null,
      external_customer_id: input.externalCustomerId,
      external_account_id: input.externalAccountId ?? null,
      customer_number: input.customer.customer_number,
      source: clean(input.payload.source) ?? 'external_website',
      status: input.status,
      idempotency_key: input.idempotencyKey ?? null,
      payload: input.payload,
      response_payload: input.responsePayload,
    })
    .select('id')
    .single()

  if (error) throw error
  return data as { id: string }
}

async function loadIdempotentApplication(companyId: string, idempotencyKey: string | null) {
  if (!idempotencyKey) return null
  const { data, error } = await supabaseService
    .from('website_customer_applications')
    .select('id,response_payload,status')
    .eq('company_id', companyId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  if (error) throw error
  return data as { id: string; response_payload: Record<string, unknown>; status: string } | null
}

export async function processWebsiteCustomerApplication(input: {
  client: IntegrationApiClient
  rawBody: unknown
  idempotencyKey?: string | null
}) {
  const parsed = ApplicationSchema.safeParse(input.rawBody)
  if (!parsed.success) {
    return {
      ok: false as const,
      status: 400,
      body: {
        error: 'Ogiltig kundansökan.',
        details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
    }
  }

  const body = parsed.data
  const externalCustomerId = clean(body.external_customer_id) ?? clean(body.customer_external_id)
  if (!externalCustomerId) {
    return { ok: false as const, status: 400, body: { error: 'external_customer_id krävs.' } }
  }
  if (!normalizedEmail(body.customer.email)) {
    return { ok: false as const, status: 400, body: { error: 'customer.email krävs.' } }
  }

  const existingIdempotent = await loadIdempotentApplication(input.client.company_id, input.idempotencyKey ?? null)
  if (existingIdempotent) {
    return {
      ok: true as const,
      status: 200,
      body: {
        data: {
          ...(existingIdempotent.response_payload ?? {}),
          idempotent: true,
          application_id: existingIdempotent.id,
        },
      },
    }
  }

  const existingIdentity = await loadExistingIdentity(input.client.company_id, externalCustomerId)
  let customerResult: { customer: CustomerRow; created: boolean }

  if (existingIdentity?.customer_id) {
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
    customerResult = { customer: { ...(data as CustomerRow), customer_number: customerNumber }, created: false }
  } else {
    customerResult = await createOrUpdateCustomer(input.client, body)
  }

  const customerNumber = customerResult.customer.customer_number ?? await ensureCustomerNumber({
    companyId: input.client.company_id,
    customerId: customerResult.customer.id,
  })
  customerResult.customer.customer_number = customerNumber

  const site = await upsertSite(input.client.company_id, customerResult.customer.id, body)
  const meteringPoint = await upsertMeteringPoint(input.client.company_id, customerResult.customer.id, site, body)
  const contract = await createContract(
    input.client.company_id,
    customerResult.customer.id,
    site?.id ?? null,
    meteringPoint?.id ?? null,
    body
  )
  const identity = await upsertPortalIdentity({
    client: input.client,
    customerId: customerResult.customer.id,
    externalCustomerId,
    externalAccountId: clean(body.external_account_id),
    email: normalizedEmail(body.customer.email),
  })

  const responsePayload = {
    customer_id: customerResult.customer.id,
    customer_number: customerNumber,
    external_customer_id: externalCustomerId,
    portal_identity_id: identity.id,
    customer_site_id: site?.id ?? null,
    metering_point_id: meteringPoint?.id ?? null,
    contract_id: contract?.id ?? null,
    status: contract ? 'application_received' : 'customer_created',
    created_customer: customerResult.created,
  }

  const application = await createApplicationRow({
    client: input.client,
    externalCustomerId,
    externalAccountId: clean(body.external_account_id),
    customer: customerResult.customer,
    customerSiteId: site?.id ?? null,
    meteringPointId: meteringPoint?.id ?? null,
    contractId: contract?.id ?? null,
    payload: body,
    responsePayload,
    idempotencyKey: input.idempotencyKey ?? null,
    status: contract ? 'application_received' : 'linked_existing_customer',
  })

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

  const email = normalizedEmail(body.customer.email)
  const communicationResults = email
    ? await Promise.all([
        triggerEmailEvent({
          companyId: input.client.company_id,
          customerId: customerResult.customer.id,
          eventKey: 'contract.application_received',
          to: email,
          variables,
        }).catch((error) => [{ ok: false, error: error instanceof Error ? error.message : String(error) }]),
        triggerEmailEvent({
          companyId: input.client.company_id,
          customerId: customerResult.customer.id,
          eventKey: 'contract.cooling_off_sent',
          to: email,
          variables,
        }).catch((error) => [{ ok: false, error: error instanceof Error ? error.message : String(error) }]),
      ])
    : []

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

  return {
    ok: true as const,
    status: 200,
    body: {
      data: {
        ...responsePayload,
        application_id: application.id,
        communication: {
          triggered: email ? ['contract.application_received', 'contract.cooling_off_sent'] : [],
          results: communicationResults,
        },
      },
    },
  }
}
