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
  customer_portal_user_id: string | null
  match_strength: string | null
  match_method: string | null
  provider: string | null
  customer: Record<string, unknown>
}

export type PortalCustomerResolution =
  | { ok: true; customer: ResolvedPortalCustomer }
  | { ok: false; status: number; error: string; code: string; identifiers: CustomerPortalIdentifiers }

const CUSTOMER_SELECT = 'id,company_id,customer_number,external_customer_id,customer_type,status,first_name,last_name,full_name,company_name,name,email,phone,created_at,intake_status,intake_missing_fields,intake_quality_score'
const CUSTOMER_FALLBACK_SELECT = 'id,company_id,customer_number,customer_type,status,first_name,last_name,full_name,company_name,name,email,phone,created_at'
const CUSTOMER_MINIMAL_SELECT = 'id,company_id,customer_number,status,email,phone,created_at'
const IDENTITY_SELECT = 'id,company_id,customer_id,external_customer_id,external_account_id,customer_number,email,status,match_strength,match_method,provider,auth_user_id,customer_portal_user_id'
const IDENTITY_FALLBACK_SELECT = 'id,company_id,customer_id,external_customer_id,email,status,match_strength,match_method,provider'
const ACCOUNT_SELECT = 'id,company_id,customer_id,user_id,email,user_email,status,is_active'
const ACCOUNT_FALLBACK_SELECT = 'id,company_id,customer_id,user_id,email,status'
const PROFILE_SELECT = 'user_id,email,first_name,last_name,full_name,phone,language_code,timezone,onboarding_state'
const CUSTOMER_PORTAL_ACCOUNT_ROLE = 'owner'

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
    authUserId: headerOrQuery(request, ['x-gridex-auth-user-id', 'x-auth-user-id', 'x-gridex-web-auth-user-id'], ['auth_user_id', 'authUserId', 'web_auth_user_id', 'webAuthUserId']),
    customerPortalUserId: headerOrQuery(request, ['x-gridex-customer-portal-user-id', 'x-customer-portal-user-id', 'x-gridex-portal-user-id'], ['customer_portal_user_id', 'customerPortalUserId', 'portal_user_id', 'portalUserId']),
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
  for (const select of [CUSTOMER_SELECT, CUSTOMER_FALLBACK_SELECT, CUSTOMER_MINIMAL_SELECT]) {
    const customer = await supabaseService
      .from('customers')
      .select(select)
      .eq('company_id', companyId)
      .eq('id', customerId)
      .maybeSingle()

    if (!customer.error) return (customer.data ?? null) as Record<string, unknown> | null
    if (!isMissingPortalSchemaError(customer.error)) throw customer.error
  }
  return null
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
  return combined || str(source, 'company_name') || str(source, 'name') || null
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

  const identity = await selectPortalIdentities(companyId, 'external_customer_id', externalCustomerId, 1)
  if (identity.length === 1 && identity[0].customer_id) {
    const row = identity[0]
    return finishResolved(companyId, String(row.customer_id), {
      id: str(row, 'id'),
      externalCustomerId,
      customerNumber: str(row, 'customer_number'),
      email: normalizeEmail(row.email),
      authUserId: str(row, 'auth_user_id'),
      customerPortalUserId: str(row, 'customer_portal_user_id'),
      provider: str(row, 'provider') ?? 'customer_portal_identity',
      matchMethod: str(row, 'match_method') ?? 'customer_portal_identities.external_customer_id',
      matchStrength: str(row, 'match_strength') ?? 'strong',
    })
  }

  return customerByField(companyId, 'external_customer_id', externalCustomerId, 'customers.external_customer_id')
}

async function customerByField(companyId: string, field: 'external_customer_id' | 'customer_number' | 'email', value: string, method: string): Promise<ResolvedPortalCustomer | null> {
  const selects = [CUSTOMER_SELECT, CUSTOMER_FALLBACK_SELECT, CUSTOMER_MINIMAL_SELECT]
  for (const select of selects) {
    const result = await supabaseService
      .from('customers')
      .select(select)
      .eq('company_id', companyId)
      .eq(field, value)
      .limit(field === 'email' ? 2 : 1)

    if (result.error) {
      if (isMissingPortalSchemaError(result.error)) {
        if (field === 'external_customer_id') return null
        continue
      }
      throw result.error
    }

    const rows = asRows(result.data as unknown as Record<string, unknown>[] | null)
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
  return null
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
  if (rows.length === 1) {
    const row = rows[0]
    return finishResolved(companyId, String(row.customer_id), {
      id: str(row, 'id'),
      email: normalizeEmail(row.email) ?? normalizeEmail(row.user_email),
      authUserId: userId,
      customerPortalUserId: userId,
      provider: 'customer_portal_accounts',
      matchMethod: 'customer_portal_accounts.user_id',
      matchStrength: 'strong',
    })
  }

  const identities = await selectPortalIdentitiesByUser(companyId, userId)
  const active = identities.filter((row) => row.customer_id && activeIdentity(row))
  if (active.length !== 1) return null
  const row = active[0]
  return finishResolved(companyId, String(row.customer_id), {
    id: str(row, 'id'),
    externalCustomerId: str(row, 'external_customer_id'),
    customerNumber: str(row, 'customer_number'),
    email: normalizeEmail(row.email),
    authUserId: str(row, 'auth_user_id') ?? userId,
    customerPortalUserId: str(row, 'customer_portal_user_id') ?? userId,
    provider: str(row, 'provider') ?? 'customer_portal_identity',
    matchMethod: str(row, 'match_method') ?? 'customer_portal_identities.user_id',
    matchStrength: str(row, 'match_strength') ?? 'strong',
  })
}

async function linkedByEmail(companyId: string, email: string): Promise<ResolvedPortalCustomer | null> {
  const rows = await selectPortalIdentities(companyId, 'email', email, 2)
  if (rows.length === 1 && rows[0].customer_id) {
    const row = rows[0]
    return finishResolved(companyId, String(row.customer_id), {
      id: str(row, 'id'),
      externalCustomerId: str(row, 'external_customer_id'),
      customerNumber: str(row, 'customer_number'),
      email,
      authUserId: str(row, 'auth_user_id'),
      customerPortalUserId: str(row, 'customer_portal_user_id'),
      provider: str(row, 'provider') ?? 'customer_portal_identity',
      matchMethod: 'customer_portal_identities.email',
      matchStrength: 'medium',
    })
  }

  return customerByField(companyId, 'email', email, 'customers.email')
}

async function finishResolved(companyId: string, customerId: string, source: {
  id?: string | null
  externalCustomerId?: string | null
  customerNumber?: string | null
  email?: string | null
  authUserId?: string | null
  customerPortalUserId?: string | null
  provider?: string | null
  matchMethod?: string | null
  matchStrength?: string | null
  prefetchedCustomer?: Record<string, unknown> | null
}): Promise<ResolvedPortalCustomer | null> {
  const customer = source.prefetchedCustomer ?? await fetchCustomer(companyId, customerId)
  if (!customer || String(customer.company_id) !== companyId) return null
  const userId = source.authUserId ?? source.customerPortalUserId ?? null
  const profile = await fetchProfile({ email: source.email ?? str(customer, 'email'), authUserId: userId })
  const merged = mergeCustomerProfile(customer, profile)
  return {
    id: source.id ?? null,
    company_id: companyId,
    customer_id: customerId,
    external_customer_id: source.externalCustomerId ?? str(merged, 'external_customer_id') ?? str(merged, 'customer_number'),
    customer_number: source.customerNumber ?? str(merged, 'customer_number'),
    email: normalizeEmail(source.email ?? merged.email),
    auth_user_id: source.authUserId ?? userId,
    customer_portal_user_id: source.customerPortalUserId ?? userId,
    match_strength: source.matchStrength ?? null,
    match_method: source.matchMethod ?? null,
    provider: source.provider ?? null,
    customer: merged,
  }
}

function activeIdentity(row: Record<string, unknown>): boolean {
  const status = str(row, 'status')?.toLowerCase()
  return !status || status === 'active'
}

async function selectPortalIdentities(companyId: string, field: 'external_customer_id' | 'email', value: string, limit: number): Promise<Record<string, unknown>[]> {
  for (const select of [IDENTITY_SELECT, IDENTITY_FALLBACK_SELECT]) {
    const result = await supabaseService
      .from('customer_portal_identities')
      .select(select)
      .eq('company_id', companyId)
      .eq(field, value)
      .eq('status', 'active')
      .not('customer_id', 'is', null)
      .limit(limit)

    if (!result.error) return asRows(result.data as unknown as Record<string, unknown>[] | null)
    if (!isMissingPortalSchemaError(result.error)) throw result.error
  }
  return []
}

async function selectPortalIdentitiesByUser(companyId: string, userId: string): Promise<Record<string, unknown>[]> {
  for (const field of ['auth_user_id', 'customer_portal_user_id', 'external_account_id'] as const) {
    for (const select of [IDENTITY_SELECT, IDENTITY_FALLBACK_SELECT]) {
      const result = await supabaseService
        .from('customer_portal_identities')
        .select(select)
        .eq('company_id', companyId)
        .eq(field, field === 'external_account_id' ? userId : userId)
        .not('customer_id', 'is', null)
        .limit(5)

      if (!result.error) {
        const rows = asRows(result.data as unknown as Record<string, unknown>[] | null)
        if (rows.length > 0) return rows
        break
      }
      if (!isMissingPortalSchemaError(result.error)) throw result.error
    }
  }
  return []
}

export async function ensureCustomerPortalUserLink(input: {
  client: IntegrationApiClient
  customerId: string
  userId: string
  email?: string | null
  externalCustomerId?: string | null
  customerNumber?: string | null
  identityId?: string | null
  matchMethod?: string | null
}): Promise<{ accountId: string | null; identityId: string | null; matchMethod: string } | null> {
  const userId = clean(input.userId)
  if (!userId) return null

  const customer = await fetchCustomer(input.client.company_id, input.customerId)
  if (!customer) return null

  const now = new Date().toISOString()
  const email = normalizeEmail(input.email ?? customer.email)
  const customerNumber = clean(input.customerNumber) ?? str(customer, 'customer_number')
  const externalCustomerId = clean(input.externalCustomerId) ?? str(customer, 'external_customer_id') ?? customerNumber
  const matchMethod = clean(input.matchMethod) ?? 'gridex_web_auth_user_auto_link'

  let accountId: string | null = null
  const existingAccount = await supabaseService
    .from('customer_portal_accounts')
    .select('id')
    .eq('customer_id', input.customerId)
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()

  if (existingAccount.error && !isMissingPortalSchemaError(existingAccount.error)) throw existingAccount.error

  if (existingAccount.data?.id) {
    accountId = String(existingAccount.data.id)
    const { error } = await supabaseService
      .from('customer_portal_accounts')
      .update({
        company_id: input.client.company_id,
        email,
        user_email: email,
        role: CUSTOMER_PORTAL_ACCOUNT_ROLE,
        status: 'active',
        is_active: true,
        activated_at: now,
        verified_at: now,
        match_method: matchMethod,
        updated_at: now,
      })
      .eq('id', accountId)
    if (error && !isMissingPortalSchemaError(error)) throw error
  } else {
    const { data, error } = await supabaseService
      .from('customer_portal_accounts')
      .insert({
        company_id: input.client.company_id,
        user_id: userId,
        user_email: email,
        customer_id: input.customerId,
        role: CUSTOMER_PORTAL_ACCOUNT_ROLE,
        is_active: true,
        invited_at: now,
        activated_at: now,
        verified_at: now,
        match_method: matchMethod,
        verified_identity_snapshot: {
          source: 'gridex_website_supabase',
          email,
          customer_number: customerNumber,
          external_customer_id: externalCustomerId,
          linked_at: now,
        },
        status: 'active',
        email,
        metadata: {
          source: 'gridex_website_supabase',
          auto_linked_at: now,
          api_client_id: input.client.id,
        },
        updated_at: now,
      })
      .select('id')
      .maybeSingle()
    if (error && !isMissingPortalSchemaError(error)) throw error
    accountId = data?.id ? String(data.id) : null
  }

  let identityId = clean(input.identityId)
  if (!identityId) {
    const existingIdentity = await supabaseService
      .from('customer_portal_identities')
      .select('id')
      .eq('company_id', input.client.company_id)
      .eq('customer_id', input.customerId)
      .limit(1)
      .maybeSingle()
    if (!existingIdentity.error && existingIdentity.data?.id) identityId = String(existingIdentity.data.id)
    if (existingIdentity.error && !isMissingPortalSchemaError(existingIdentity.error)) throw existingIdentity.error
  }

  const identityPayload = {
    company_id: input.client.company_id,
    customer_id: input.customerId,
    provider: 'external_website',
    external_customer_id: externalCustomerId,
    external_account_id: userId,
    email,
    status: 'active',
    match_strength: 'strong',
    match_method: matchMethod,
    linked_at: now,
    metadata: {
      source: 'gridex_website_supabase',
      account_id: accountId,
      api_client_id: input.client.id,
      auto_linked_at: now,
    },
    customer_number: customerNumber,
    auth_user_id: userId,
    customer_portal_user_id: userId,
    last_resolved_at: now,
    updated_at: now,
  }

  if (identityId) {
    const { error } = await supabaseService
      .from('customer_portal_identities')
      .update(identityPayload)
      .eq('id', identityId)
      .eq('company_id', input.client.company_id)
    if (error && !isMissingPortalSchemaError(error)) throw error
  } else {
    const { data, error } = await supabaseService
      .from('customer_portal_identities')
      .insert({ ...identityPayload, api_client_id: input.client.id, created_at: now })
      .select('id')
      .maybeSingle()
    if (error && !isMissingPortalSchemaError(error)) throw error
    identityId = data?.id ? String(data.id) : null
  }

  return { accountId, identityId, matchMethod }
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
    const userId = clean(identifiers.customerPortalUserId) ?? clean(identifiers.authUserId)
    const resolved =
      (userId ? await linkedByAccount(input.client.company_id, userId) : null) ??
      (identifiers.externalCustomerId ? await linkedByExternal(input.client.company_id, identifiers.externalCustomerId) : null) ??
      (identifiers.customerNumber ? await customerByField(input.client.company_id, 'customer_number', identifiers.customerNumber, 'customers.customer_number') : null) ??
      (identifiers.email ? await linkedByEmail(input.client.company_id, identifiers.email) : null)

    if (!resolved) {
      return { ok: false, status: 404, code: 'customer_not_found', error: 'Kunden hittades inte eller är inte länkad till API-klienten.', identifiers }
    }

    const linked = userId
      ? await ensureCustomerPortalUserLink({
          client: input.client,
          customerId: resolved.customer_id,
          userId,
          email: identifiers.email ?? resolved.email,
          externalCustomerId: identifiers.externalCustomerId ?? resolved.external_customer_id,
          customerNumber: identifiers.customerNumber ?? resolved.customer_number,
          identityId: resolved.id,
          matchMethod: resolved.match_method ?? 'gridex_web_auth_user_auto_link',
        })
      : null

    if (linked) {
      return {
        ok: true,
        customer: {
          ...resolved,
          id: linked.identityId ?? resolved.id,
          auth_user_id: userId,
          customer_portal_user_id: userId,
          match_method: linked.matchMethod,
          provider: resolved.provider ?? 'customer_portal_accounts',
        },
      }
    }

    return { ok: true, customer: resolved }
  } catch (error) {
    if (isMissingPortalSchemaError(error)) {
      return { ok: false, status: 503, code: 'customer_portal_schema_missing', error: 'Kundportalens datamodell är inte färdig i OPS.', identifiers }
    }
    throw error
  }
}
