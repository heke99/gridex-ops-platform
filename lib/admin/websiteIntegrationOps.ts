import { supabaseService } from '@/lib/supabase/service'
import type { CompanyEmailSettings, EffectiveSender } from '@/lib/email/companyEmailSettings'
import type { CompanyEmailDnsRecord } from '@/lib/email/dnsRecords'
import type { CompanyEmailTemplate } from '@/lib/email/emailTemplates'
import type { EmailEventRule } from '@/lib/email/emailEvents'

type QueryResult<T> = Promise<T[]>

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

export type WebsiteApplicationAdminRow = {
  id: string
  company_id: string
  api_client_id: string | null
  customer_id: string | null
  customer_site_id: string | null
  metering_point_id: string | null
  contract_id: string | null
  external_customer_id: string
  external_account_id: string | null
  customer_number: string | null
  source: string | null
  status: string
  idempotency_key: string | null
  payload: Record<string, unknown> | null
  raw_payload?: Record<string, unknown> | null
  response_payload: Record<string, unknown> | null
  warnings: unknown[] | null
  missing_fields?: unknown[] | null
  blocking_reasons?: unknown[] | null
  next_step?: string | null
  requested_start_date?: string | null
  confirmed_start_date?: string | null
  actual_start_date?: string | null
  requested_start_mode?: string | null
  calculated_earliest_start_date?: string | null
  resolution_id?: string | null
  grid_owner_information_request_id?: string | null
  grid_area_code?: string | null
  grid_owner_id?: string | null
  price_area_code?: string | null
  resolution_status?: string | null
  resolution_confidence?: number | null
  facility_data_verified_at?: string | null
  timeline?: unknown[] | null
  audit_log?: unknown[] | null
  assigned_to?: string | null
  admin_note?: string | null
  error_stage?: string | null
  error_code?: string | null
  error_message?: string | null
  processed_at?: string | null
  created_at: string
  updated_at: string | null
  companies?: { name?: string | null } | null
  customers?: { full_name?: string | null; company_name?: string | null; email?: string | null; phone?: string | null } | null
  integration_api_clients?: { name?: string | null; key_prefix?: string | null } | null
}

export type WebhookDeliveryAdminRow = {
  id: string
  company_id: string
  webhook_subscription_id: string
  domain_event_id: string
  event_type: string
  status: string
  attempts: number
  max_attempts: number
  next_attempt_at: string | null
  last_attempt_at: string | null
  delivered_at: string | null
  failed_at: string | null
  response_status: number | null
  response_body: string | null
  failure_reason: string | null
  payload: Record<string, unknown> | null
  target_url?: string | null
  locked_at?: string | null
  locked_by?: string | null
  created_at: string
  webhook_subscriptions?: { endpoint_url?: string | null; name?: string | null; api_client_id?: string | null } | null
}

export type WebhookSubscriptionAdminRow = {
  id: string
  company_id: string
  api_client_id: string | null
  name: string
  endpoint_url: string
  event_types: string[] | null
  status: string
  signing_secret_ref: string | null
  last_success_at: string | null
  last_failure_at: string | null
  failure_count?: number | null
  created_at: string
  updated_at: string | null
  companies?: { name?: string | null } | null
  integration_api_clients?: { name?: string | null; key_prefix?: string | null } | null
}

export type BillingPartnerCustomerSummary = {
  id: string
  company_id: string
  customer_id: string
  customer_number: string | null
  provider: string
  provider_customer_id: string | null
  provider_debtor_id: string | null
  provider_status: string | null
  dispute_count?: number | null
  last_synced_at?: string | null
  created_at: string
  updated_at: string | null
}

export type TenantReadiness = {
  websiteApi: boolean
  apiClient: boolean
  webhook: boolean
  emailSender: boolean
  domainVerification: boolean
  templates: boolean
  billingMapping: boolean
  notes: string[]
}

function normalizeExternalIntakeStatus(status: string | null | undefined): string {
  if (status === 'created') return 'customer_created'
  if (status === 'partially_created') return 'pending_review'
  if (status === 'duplicate_ignored') return 'duplicate_facility_id'
  return status ?? 'received'
}

function mapExternalContractIntakeRow(row: Record<string, unknown>): WebsiteApplicationAdminRow {
  const issues = Array.isArray(row.issues) ? row.issues : []
  const payload = (row.payload && typeof row.payload === 'object' ? row.payload : {}) as Record<string, unknown>
  const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    api_client_id: null,
    customer_id: (row.created_customer_id as string | null) ?? null,
    customer_site_id: (row.created_site_id as string | null) ?? null,
    metering_point_id: (row.created_metering_point_id as string | null) ?? null,
    contract_id: (row.created_contract_id as string | null) ?? null,
    external_customer_id: String(row.external_customer_id ?? row.idempotency_key ?? row.id),
    external_account_id: null,
    customer_number: (row.customer_number as string | null) ?? null,
    source: String(row.source_channel ?? 'external_contract_intake'),
    status: normalizeExternalIntakeStatus(String(row.status ?? 'received')),
    idempotency_key: (row.idempotency_key as string | null) ?? null,
    payload: {
      ...payload,
      customer: {
        full_name: fullName || row.company_name || row.email || null,
        company_name: row.company_name ?? null,
        email: row.email ?? null,
        phone: row.phone ?? null,
      },
      site: {
        facility_id: row.facility_id ?? null,
        street: row.street ?? null,
        postal_code: row.postal_code ?? null,
        city: row.city ?? null,
        price_area_code: row.price_area_code ?? null,
      },
      metering_point: {
        metering_point_id: row.meter_point_id ?? null,
      },
    },
    raw_payload: payload,
    response_payload: {
      source_table: 'external_contract_intakes',
      created_customer_id: row.created_customer_id ?? null,
      created_site_id: row.created_site_id ?? null,
      created_metering_point_id: row.created_metering_point_id ?? null,
      created_contract_id: row.created_contract_id ?? null,
      created_case_id: row.created_case_id ?? null,
      created_info_request_id: row.created_info_request_id ?? null,
      issues,
    },
    warnings: issues,
    missing_fields: issues,
    blocking_reasons: issues.map((issue) => ({ field: 'intake', label: String(issue), action: 'Granska och komplettera webbansökan.' })),
    next_step: issues.length > 0 ? 'Granska och komplettera webbansökan innan switch eller fakturering.' : 'Granska skapad kundkedja och starta nästa operativa steg.',
    requested_start_date: (row.requested_start_date as string | null) ?? null,
    confirmed_start_date: null,
    actual_start_date: null,
    requested_start_mode: 'earliest_possible',
    calculated_earliest_start_date: null,
    resolution_id: null,
    grid_owner_information_request_id: (row.created_info_request_id as string | null) ?? null,
    grid_area_code: null,
    grid_owner_id: null,
    price_area_code: (row.price_area_code as string | null) ?? null,
    resolution_status: null,
    resolution_confidence: null,
    facility_data_verified_at: null,
    timeline: [],
    audit_log: [],
    assigned_to: null,
    admin_note: null,
    error_stage: row.status === 'failed' ? 'external_contract_intake' : null,
    error_code: row.status === 'failed' ? 'intake_failed' : null,
    error_message: issues.length > 0 ? issues.map(String).join(' · ') : null,
    processed_at: row.updated_at as string | null,
    created_at: String(row.created_at),
    updated_at: (row.updated_at as string | null) ?? null,
    companies: row.companies as { name?: string | null } | null | undefined,
    customers: {
      full_name: fullName || null,
      company_name: (row.company_name as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
    },
    integration_api_clients: null,
  }
}

async function listExternalContractIntakes(input: {
  companyId?: string | null
  status?: string | null
  limit?: number
} = {}): QueryResult<WebsiteApplicationAdminRow> {
  let query = supabaseService
    .from('external_contract_intakes')
    .select('*,companies(name)')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 200))

  if (input.companyId) query = query.eq('company_id', input.companyId)
  if (input.status) query = query.eq('status', input.status)

  const { data, error } = await query
  if (error) {
    if (missingSchema(error)) return []
    throw error
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map(mapExternalContractIntakeRow)
}

async function listLegacyWebsiteApplications(input: {
  companyId?: string | null
  status?: string | null
  limit?: number
} = {}): QueryResult<WebsiteApplicationAdminRow> {
  let query = supabaseService
    .from('website_customer_applications')
    .select('*,companies(name),customers(full_name,company_name,email,phone),integration_api_clients(name,key_prefix)')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 200))

  if (input.companyId) query = query.eq('company_id', input.companyId)
  if (input.status) query = query.eq('status', input.status)

  const { data, error } = await query
  if (error) {
    if (missingSchema(error)) return []
    throw error
  }
  return (data ?? []) as WebsiteApplicationAdminRow[]
}

export async function listWebsiteApplications(input: {
  companyId?: string | null
  status?: string | null
  limit?: number
} = {}): QueryResult<WebsiteApplicationAdminRow> {
  const [external, legacy] = await Promise.all([
    listExternalContractIntakes(input),
    listLegacyWebsiteApplications(input),
  ])
  const byKey = new Map<string, WebsiteApplicationAdminRow>()
  for (const row of [...external, ...legacy]) {
    const key = row.idempotency_key ? `${row.company_id}:${row.idempotency_key}` : `${row.company_id}:${row.id}`
    if (!byKey.has(key)) byKey.set(key, row)
  }
  return [...byKey.values()]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, Math.min(Math.max(input.limit ?? 100, 1), 200))
}

export async function listWebsiteApplicationsForCustomer(companyId: string, customerId: string): QueryResult<WebsiteApplicationAdminRow> {
  const external = await supabaseService
    .from('external_contract_intakes')
    .select('*,companies(name)')
    .eq('company_id', companyId)
    .eq('created_customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(10)

  const legacy = await supabaseService
    .from('website_customer_applications')
    .select('*,integration_api_clients(name,key_prefix)')
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(10)

  if (external.error && !missingSchema(external.error)) throw external.error
  if (legacy.error && !missingSchema(legacy.error)) throw legacy.error

  const externalRows = external.error ? [] : ((external.data ?? []) as Array<Record<string, unknown>>).map(mapExternalContractIntakeRow)
  const legacyRows = legacy.error ? [] : (legacy.data ?? []) as WebsiteApplicationAdminRow[]
  return [...externalRows, ...legacyRows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10)
}

export async function listWebhookSubscriptions(input: { companyId?: string | null; limit?: number } = {}): QueryResult<WebhookSubscriptionAdminRow> {
  let query = supabaseService
    .from('webhook_subscriptions')
    .select('id, company_id, api_client_id, name, endpoint_url, event_types, status, signing_secret_ref, last_success_at, last_failure_at, failure_count, created_at, updated_at, companies(name), integration_api_clients(name,key_prefix)')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 200))

  if (input.companyId) query = query.eq('company_id', input.companyId)

  const { data, error } = await query
  if (error) {
    if (missingSchema(error)) return []
    throw error
  }
  return (data ?? []) as WebhookSubscriptionAdminRow[]
}

export async function listWebhookDeliveries(input: { companyId?: string | null; status?: string | null; limit?: number } = {}): QueryResult<WebhookDeliveryAdminRow> {
  let query = supabaseService
    .from('webhook_deliveries')
    .select('id, company_id, webhook_subscription_id, domain_event_id, event_type, status, attempts, max_attempts, next_attempt_at, last_attempt_at, delivered_at, failed_at, response_status, response_body, failure_reason, payload, target_url, locked_at, locked_by, created_at, webhook_subscriptions(name,endpoint_url,api_client_id)')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 200))

  if (input.companyId) query = query.eq('company_id', input.companyId)
  if (input.status) query = query.eq('status', input.status)

  const { data, error } = await query
  if (error) {
    if (missingSchema(error)) return []
    throw error
  }
  return (data ?? []) as WebhookDeliveryAdminRow[]
}

export async function listBillingPartnerCustomersForCustomer(companyId: string, customerId: string): QueryResult<BillingPartnerCustomerSummary> {
  const { data, error } = await supabaseService
    .from('billing_partner_customers')
    .select('id, company_id, customer_id, customer_number, provider, provider_customer_id, provider_debtor_id, provider_status, dispute_count, last_synced_at, created_at, updated_at')
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    if (missingSchema(error)) return []
    throw error
  }
  return (data ?? []) as BillingPartnerCustomerSummary[]
}

export function computeTenantReadiness(input: {
  apiClients: Array<{ status?: string | null; scopes?: string[] | null }>
  webhooks: Array<{ status?: string | null }>
  emailSettings: CompanyEmailSettings | null
  dnsRecords: CompanyEmailDnsRecord[]
  templates: CompanyEmailTemplate[]
  eventRules: EmailEventRule[]
  effectiveSender: EffectiveSender
  billingPartnerCount?: number
}): TenantReadiness {
  const notes: string[] = []
  const apiClient = input.apiClients.some((client) => client.status === 'active' && (client.scopes ?? []).includes('website_applications.write'))
  const webhook = input.webhooks.some((webhook) => webhook.status === 'active')
  const domainVerification = input.emailSettings?.verification_status === 'verified'
  const emailSender = domainVerification || input.effectiveSender.mode === 'fallback'
  const requiredTemplates = ['contract.application_received', 'switch.started', 'switch.confirmed', 'switch.action_required', 'customer.welcome_active']
  const templateKeys = new Set(input.templates.filter((template) => template.is_active).map((template) => template.template_key))
  const templates = requiredTemplates.every((key) => templateKeys.has(key)) && input.eventRules.some((rule) => rule.event_key === 'contract.application_received' && rule.enabled)
  const billingMapping = Number(input.billingPartnerCount ?? 0) > 0

  if (!apiClient) notes.push('Saknar aktiv API-client med website_applications.write.')
  if (!webhook) notes.push('Saknar aktiv webhook subscription.')
  if (!domainVerification && input.effectiveSender.mode === 'fallback') notes.push('E-post skickas via fallback eftersom domänen inte är verifierad.')
  if (!templates) notes.push('Standardmallar eller event rules saknas för kundmail/switch-flöde.')
  if (!billingMapping) notes.push('Capway/billing partner mapping saknas ännu.')
  if (input.emailSettings?.verification_status === 'disabled' || input.emailSettings?.sender_mode === 'disabled') notes.push('E-postavsändaren är avstängd.')
  if (input.dnsRecords.some((record) => record.status === 'failed')) notes.push('Minst en DNS-post har felstatus.')

  return {
    websiteApi: apiClient,
    apiClient,
    webhook,
    emailSender,
    domainVerification,
    templates,
    billingMapping,
    notes,
  }
}
