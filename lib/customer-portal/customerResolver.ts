import type { NextRequest } from 'next/server'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { supabaseService } from '@/lib/supabase/service'

export type CustomerPortalIdentifiers = {
  externalCustomerId: string | null
  customerNumber: string | null
  email: string | null
  authUserId: string | null
  customerPortalUserId: string | null
}

export type ResolvedPortalCustomer = {
  id: string | null
  company_id: string
  customer_id: string
  external_customer_id: string | null
  customer_number: string | null
  email: string | null
  auth_user_id: string | null
  match_strength: string | null
  match_method: string | null
  provider: string | null
  customer: Record<string, unknown>
}

export type PortalCustomerResolution =
  | { ok: true; customer: ResolvedPortalCustomer }
  | { ok: false; status: number; error: string; code: string; identifiers: CustomerPortalIdentifiers }

const CUSTOMER_SELECT = 'id,company_id,customer_number,external_customer_id,customer_type,status,first_name,last_name,full_name,company_name,email,phone,created_at,intake_status,intake_missing_fields,intake_quality_score'
const CUSTOMER_FALLBACK_SELECT = 'id,company_id,customer_number,customer_type,status,first_name,last_name,full_name,company_name,email,phone,created_at'
const CUSTOMER_MINIMAL_SELECT = 'id,company_id,customer_number,status,email,phone,created_at'
const IDENTITY_SELECT = 'id,company_id,customer_id,external_customer_id,email,status,match_strength,match_method,provider'
const ACCOUNT_SELECT = 'id,company_id,customer_id,user_id,email,status,is_active'
const ACCOUNT_FALLBACK_SELECT = 'id,company_id,customer_id,user_id,email,status'
const PROFILE_SELECT = 'user_id,email,first_name,last_name,full_name,phone,language_code,timezone,onboarding_state'

export function isMissingPortalSchemaError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  const code = maybe?.code ?? ''
  const message = maybe?.message ?? ''
  return ['42P01', '42703', 'PGRST204', 'PGRST205', '42P10'].includes(code) || /schema cache|does not exist|column .* does not exist|no unique or exclusion constraint/i.test(message)
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeEmail(value: unknown): string | null {
  const email = clean(value)?.toLowerCase() ?? null
  return email && email.includes('@') ? email : null
}

function headerOrQuery(request: NextRequest, headers: string[], queries: string[]): string | null {
  for (const header of headers) {
    const value = clean(request.headers.get(header))
    if (value) return value
  }
  for (const query of queries) {
    const value = clean(request.nextUrl.searchParams.get(query))
    if (value) return value
  }
  return null
}

export function portalIdentifiersFromRequest(request: NextRequest): CustomerPortalIdentifiers {
  const externalCustomerId = headerOrQuery(
    request,
    ['x-gridex-external-customer-id', 'x-external-customer-id'],
    ['external_customer_id', 'externalCustomerId', 'customer_external_id']
  )
  return {
    externalCustomerId,
    customerNumber: headerOrQuery(request, ['x-gridex-customer-number', 'x-customer-number'], ['customer_number', 'customerNumber']),
    email: normalizeEmail(headerOrQuery(request, ['x-gridex-customer-email', 'x-customer-email'], ['email', 'customer_email'])),
    authUserId: headerOrQuery(request, ['x-gridex-auth-user-id', 'x-auth-user-id'], ['auth_user_id', 'authUserId']),
    customerPortalUserId: headerOrQuery(request, ['x-gridex-customer-portal-user-id', 'x-customer-portal-user-id'], ['customer_portal_user_id', 'customerPortalUserId']),
  }
}

function asRows<T>(data: T[] | null): T[] {
  return Array.isArray(data) ? data : []
}

function str(row: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = row?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function activeAccount(row: Record<string, unknown>): boolean {
  if (row.is_active === false) return false
  const status = str(row, 'status')?.toLowerCase()
  return !status || ['active', 'confirmed', 'enabled'].includes(status)
}

async function fetchCustomer(companyId: string, customerId: string): Promise<Record<string, unknown> | null> {
  let customer = await supabaseService
    .from('customers')
    .select(CUSTOMER_SELECT)
    .eq('company_id', companyId)
    .eq('id', customerId)
    .maybeSingle()

  if (customer.error && isMissingPortalSchemaError(customer.error)) {
    customer = await supabaseService
      .from('customers')
      .select(CUSTOMER_FALLBACK_SELECT)
      .eq('company_id', companyId)
      .eq('id', customerId)
      .maybeSingle()
  }
  if (customer.error && isMissingPortalSchemaError(customer.error)) {
    customer = await supabaseService
      .from('customers')
      .select(CUSTOMER_MINIMAL_SELECT)
      .eq('company_id', companyId)
      .eq('id', customerId)
      .maybeSingle()
  }
  if (customer.error) throw customer.error
  return (customer.data ?? null) as Record<string, unknown> | null
}

async function fetchProfile(input: { email?: string | null; authUserId?: string | null }): Promise<Record<string, unknown> | null> {
  const authUserId = clean(input.authUserId)
  if (authUserId) {
    const byUser = await supabaseService
      .from('customer_profiles')
      .select(PROFILE_SELECT)
      .eq('user_id', authUserId)
      .limit(1)
      .maybeSingle()
    if (!byUser.error && byUser.data) return byUser.data as Record<string, unknown>
    if (byUser.error && !isMissingPortalSchemaError(byUser.error)) throw byUser.error
  }

  const email = normalizeEmail(input.email)
  if (!email) return null
  const byEmail = await supabaseService
    .from('customer_profiles')
    .select(PROFILE_SELECT)
    .eq('email', email)
    .limit(2)
  if (byEmail.error) {
    if (isMissingPortalSchemaError(byEmail.error)) return null
    throw byEmail.error
  }
  const rows = asRows(byEmail.data as Record<string, unknown>[] | null)
  return rows.length === 1 ? rows[0] : null
}

function composeFullName(source: Record<string, unknown>): string | null {
  const fullName = str(source, 'full_name')
  if (fullName) return fullName
  const firstName = str(source, 'first_name')
  const lastName = str(source, 'last_name')
  const combined = [firstName, lastName].filter(Boolean).join(' ').trim()
  return combined || str(source, 'company_name') || null
}

function mergeCustomerProfile(customer: Record<string, unknown>, profile: Record<string, unknown> | null): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...customer }
  if (profile) {
    for (const key of ['first_name', 'last_name', 'full_name', 'phone', 'email']) {
      if (!clean(merged[key]) && clean(profile[key])) merged[key] = clean(profile[key])
    }
  }
  const fullName = composeFullName(merged)
  if (fullName) merged.full_name = fullName
  if (!clean(merged.email) && clean(profile?.email)) merged.email = clean(profile?.email)
  return merged
}

async function linkedByExternal(companyId: string, externalCustomerId: string): Promise<ResolvedPortalCustomer | null> {
  const link = await supabaseService
    .from('tenant_portal_customer_links')
    .select('id,company_id,customer_id,provider,external_customer_id,status')
    .eq('company_id', companyId)
    .eq('external_customer_id', externalCustomerId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (!link.error && link.data?.customer_id) {
    return finishResolved(companyId, String(link.data.customer_id), {
      id: String(link.data.id ?? ''),
      externalCustomerId,
      provider: str(link.data as Record<string, unknown>, 'provider') ?? 'tenant_portal',
      matchMethod: 'tenant_portal_customer_links.external_customer_id',
      matchStrength: 'strong',
    })
  }
  if (link.error && !isMissingPortalSchemaError(link.error)) throw link.error

  const identity = await supabaseService
    .from('customer_portal_identities')
    .select(IDENTITY_SELECT)
    .eq('company_id', companyId)
    .eq('external_customer_id', externalCustomerId)
    .eq('status', 'active')
    .not('customer_id', 'is', null)
    .limit(1)
    .maybeSingle()

  if (!identity.error && identity.data?.customer_id) {
    const row = identity.data as Record<string, unknown>
    return finishResolved(companyId, String(row.customer_id), {
      id: str(row, 'id'),
      externalCustomerId,
      email: normalizeEmail(row.email),
      provider: str(row, 'provider') ?? 'customer_portal_identity',
      matchMethod: str(row, 'match_method') ?? 'customer_portal_identities.external_customer_id',
      matchStrength: str(row, 'match_strength') ?? 'strong',
    })
  }
  if (identity.error && !isMissingPortalSchemaError(identity.error)) throw identity.error

  return customerByField(companyId, 'external_customer_id', externalCustomerId, 'customers.external_customer_id')
}

async function customerByField(companyId: string, field: 'external_customer_id' | 'customer_number' | 'email', value: string, method: string): Promise<ResolvedPortalCustomer | null> {
  const query = supabaseService
    .from('customers')
    .select(CUSTOMER_SELECT)
    .eq('company_id', companyId)
    .eq(field, value)
    .limit(field === 'email' ? 2 : 1)

  const result = await query
  if (result.error) {
    if (isMissingPortalSchemaError(result.error)) return null
    throw result.error
  }
  const rows = asRows(result.data as Record<string, unknown>[] | null)
  if (rows.length !== 1) return null
  return finishResolved(companyId, String(rows[0].id), {
    externalCustomerId: str(rows[0], 'external_customer_id'),
    customerNumber: str(rows[0], 'customer_number'),
    email: normalizeEmail(rows[0].email),
    matchMethod: method,
    matchStrength: field === 'email' ? 'medium' : 'strong',
    prefetchedCustomer: rows[0],
  })
}

async function linkedByAccount(companyId: string, userId: string): Promise<ResolvedPortalCustomer | null> {
  let account: { data: Record<string, unknown>[] | null; error: unknown | null } = await supabaseService
    .from('customer_portal_accounts')
    .select(ACCOUNT_SELECT)
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .limit(5) as { data: Record<string, unknown>[] | null; error: unknown | null }

  if (account.error && isMissingPortalSchemaError(account.error)) {
    account = await supabaseService
      .from('customer_portal_accounts')
      .select(ACCOUNT_FALLBACK_SELECT)
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .limit(5) as { data: Record<string, unknown>[] | null; error: unknown | null }
  }
  if (account.error) {
    if (isMissingPortalSchemaError(account.error)) return null
    throw account.error
  }

  const rows = asRows(account.data as Record<string, unknown>[] | null).filter((row) => row.customer_id && activeAccount(row))
  if (rows.length !== 1) return null
  const row = rows[0]
  return finishResolved(companyId, String(row.customer_id), {
    id: str(row, 'id'),
    email: normalizeEmail(row.email),
    authUserId: userId,
    provider: 'customer_portal_accounts',
    matchMethod: 'customer_portal_accounts.user_id',
    matchStrength: 'strong',
  })
}

async function linkedByEmail(companyId: string, email: string): Promise<ResolvedPortalCustomer | null> {
  const identity = await supabaseService
    .from('customer_portal_identities')
    .select(IDENTITY_SELECT)
    .eq('company_id', companyId)
    .eq('email', email)
    .eq('status', 'active')
    .not('customer_id', 'is', null)
    .limit(2)

  if (!identity.error) {
    const rows = asRows(identity.data as Record<string, unknown>[] | null)
    if (rows.length === 1) {
      const row = rows[0]
      return finishResolved(companyId, String(row.customer_id), {
        id: str(row, 'id'),
        externalCustomerId: str(row, 'external_customer_id'),
        email,
        provider: str(row, 'provider') ?? 'customer_portal_identity',
        matchMethod: 'customer_portal_identities.email',
        matchStrength: 'medium',
      })
    }
  } else if (!isMissingPortalSchemaError(identity.error)) {
    throw identity.error
  }

  return customerByField(companyId, 'email', email, 'customers.email')
}

async function finishResolved(companyId: string, customerId: string, source: {
  id?: string | null
  externalCustomerId?: string | null
  customerNumber?: string | null
  email?: string | null
  authUserId?: string | null
  provider?: string | null
  matchMethod?: string | null
  matchStrength?: string | null
  prefetchedCustomer?: Record<string, unknown> | null
}): Promise<ResolvedPortalCustomer | null> {
  const customer = source.prefetchedCustomer ?? await fetchCustomer(companyId, customerId)
  if (!customer || String(customer.company_id) !== companyId) return null
  const profile = await fetchProfile({ email: source.email ?? str(customer, 'email'), authUserId: source.authUserId })
  const merged = mergeCustomerProfile(customer, profile)
  return {
    id: source.id ?? null,
    company_id: companyId,
    customer_id: customerId,
    external_customer_id: source.externalCustomerId ?? str(merged, 'external_customer_id') ?? str(merged, 'customer_number'),
    customer_number: source.customerNumber ?? str(merged, 'customer_number'),
    email: normalizeEmail(source.email ?? merged.email),
    auth_user_id: source.authUserId ?? null,
    match_strength: source.matchStrength ?? null,
    match_method: source.matchMethod ?? null,
    provider: source.provider ?? null,
    customer: merged,
  }
}

export async function resolvePortalCustomer(input: {
  client: IntegrationApiClient
  request?: NextRequest
  identifiers?: Partial<CustomerPortalIdentifiers>
}): Promise<PortalCustomerResolution> {
  const identifiers: CustomerPortalIdentifiers = {
    externalCustomerId: input.identifiers?.externalCustomerId ?? (input.request ? portalIdentifiersFromRequest(input.request).externalCustomerId : null),
    customerNumber: input.identifiers?.customerNumber ?? (input.request ? portalIdentifiersFromRequest(input.request).customerNumber : null),
    email: normalizeEmail(input.identifiers?.email ?? (input.request ? portalIdentifiersFromRequest(input.request).email : null)),
    authUserId: input.identifiers?.authUserId ?? (input.request ? portalIdentifiersFromRequest(input.request).authUserId : null),
    customerPortalUserId: input.identifiers?.customerPortalUserId ?? (input.request ? portalIdentifiersFromRequest(input.request).customerPortalUserId : null),
  }

  if (!identifiers.externalCustomerId && !identifiers.customerNumber && !identifiers.email && !identifiers.authUserId && !identifiers.customerPortalUserId) {
    return { ok: false, status: 400, code: 'customer_identifier_missing', error: 'Kundidentifierare saknas.', identifiers }
  }

  try {
    const userId = identifiers.authUserId ?? identifiers.customerPortalUserId
    const resolved =
      (userId ? await linkedByAccount(input.client.company_id, userId) : null) ??
      (identifiers.externalCustomerId ? await linkedByExternal(input.client.company_id, identifiers.externalCustomerId) : null) ??
      (identifiers.customerNumber ? await customerByField(input.client.company_id, 'customer_number', identifiers.customerNumber, 'customers.customer_number') : null) ??
      (identifiers.email ? await linkedByEmail(input.client.company_id, identifiers.email) : null)

    if (!resolved) {
      return { ok: false, status: 404, code: 'customer_not_found', error: 'Kunden hittades inte eller är inte länkad till API-klienten.', identifiers }
    }

    return { ok: true, customer: resolved }
  } catch (error) {
    if (isMissingPortalSchemaError(error)) {
      return { ok: false, status: 503, code: 'customer_portal_schema_missing', error: 'Kundportalens datamodell är inte färdig i OPS.', identifiers }
    }
    throw error
  }
}
