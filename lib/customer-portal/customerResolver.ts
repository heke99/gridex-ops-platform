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
const ACCOUNT_SELECT = 'id,company_id,customer_id,user_id,portal_user_id,external_account_id,customer_number,external_customer_id,email,user_email,status,is_active'
const ACCOUNT_FALLBACK_SELECT = 'id,company_id,customer_id,user_id,email,status'
const PROFILE_SELECT = 'user_id,email,first_name,last_name,full_name,phone,language_code,timezone,onboarding_state'
const CUSTOMER_PORTAL_ACCOUNT_ROLE = 'owner'
const WEBSITE_PORTAL_PROVIDER = 'gridex_website'

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

function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
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

function hasStrongFirstLinkFactors(identifiers: CustomerPortalIdentifiers, resolved: ResolvedPortalCustomer): boolean {
  const hasExistingLink = Boolean(resolved.id)
  if (hasExistingLink) return true
  const hasEmail = Boolean(identifiers.email && identifiers.email === resolved.email)
  const hasCustomerNumber = Boolean(identifiers.customerNumber && identifiers.customerNumber === resolved.customer_number)
  const hasExternalCustomerId = Boolean(identifiers.externalCustomerId && identifiers.externalCustomerId === resolved.external_customer_id)
  return (hasExternalCustomerId && (hasEmail || hasCustomerNumber)) || (hasCustomerNumber && hasEmail)
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

async function selectPortalAccountsByUser(companyId: string, userId: string): Promise<Record<string, unknown>[]> {
  const lookups: Array<{ field: 'portal_user_id' | 'external_account_id' | 'user_id'; select: string }> = [
    ...(isUuid(userId) ? [
      { field: 'portal_user_id' as const, select: ACCOUNT_SELECT },
      { field: 'user_id' as const, select: ACCOUNT_SELECT },
      { field: 'user_id' as const, select: ACCOUNT_FALLBACK_SELECT },
    ] : []),
    { field: 'external_account_id', select: ACCOUNT_SELECT },
  ]

  for (const lookup of lookups) {
    const account = await supabaseService
      .from('customer_portal_accounts')
      .select(lookup.select)
      .eq('company_id', companyId)
      .eq(lookup.field, userId)
      .limit(5) as { data: Record<string, unknown>[] | null; error: unknown | null }

    if (!account.error) {
      const rows = asRows(account.data as Record<string, unknown>[] | null).filter((row) => row.customer_id && activeAccount(row))
      if (rows.length > 0) return rows
      continue
    }

    if (!isMissingPortalSchemaError(account.error)) throw account.error
  }

  return []
}

async function linkedByAccount(companyId: string, userId: string): Promise<ResolvedPortalCustomer | null> {
  const rows = await selectPortalAccountsByUser(companyId, userId)
  if (rows.length === 1) {
    const row = rows[0]
    return finishResolved(companyId, String(row.customer_id), {
      id: str(row, 'id'),
      externalCustomerId: str(row, 'external_customer_id'),
      customerNumber: str(row, 'customer_number'),
      email: normalizeEmail(row.email) ?? normalizeEmail(row.user_email),
      authUserId: str(row, 'user_id') ?? userId,
      customerPortalUserId: str(row, 'portal_user_id') ?? userId,
      provider: 'customer_portal_accounts',
      matchMethod: str(row, 'portal_user_id') ? 'customer_portal_accounts.portal_user_id' : str(row, 'external_account_id') ? 'customer_portal_accounts.external_account_id' : 'customer_portal_accounts.user_id',
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


async function hasAmbiguousEmailMatch(companyId: string, email: string): Promise<boolean> {
  const identityRows = await selectPortalIdentities(companyId, 'email', email, 3)
  const identityCustomers = new Set(identityRows.map((row) => str(row, 'customer_id')).filter(Boolean))
  if (identityCustomers.size > 1) return true

  const result = await supabaseService
    .from('customers')
    .select('id')
    .eq('company_id', companyId)
    .eq('email', email)
    .limit(3)
  if (result.error) {
    if (isMissingPortalSchemaError(result.error)) return false
    throw result.error
  }
  return new Set(asRows(result.data as unknown as Record<string, unknown>[] | null).map((row) => str(row, 'id')).filter(Boolean)).size > 1
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
    external_customer_id: source.externalCustomerId ?? str(merged, 'external_customer_id'),
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
  const fields = isUuid(userId)
    ? ['auth_user_id', 'customer_portal_user_id', 'external_account_id'] as const
    : ['external_account_id'] as const

  for (const field of fields) {
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
  const externalCustomerId = clean(input.externalCustomerId) ?? str(customer, 'external_customer_id')
  const matchMethod = clean(input.matchMethod) ?? 'gridex_web_auth_user_auto_link'
  const accountIdentitySnapshot = {
    source: 'gridex_website_supabase',
    email,
    customer_number: customerNumber,
    external_customer_id: externalCustomerId,
    portal_user_id: userId,
    linked_at: now,
  }

  const portalUserId = isUuid(userId) ? userId : null
  let accountId: string | null = null
  const accountRows = await selectPortalAccountsByUser(input.client.company_id, userId)
  const existingAccount = accountRows.find((row) => str(row, 'customer_id') === input.customerId) ?? null

  const accountPayload = {
    company_id: input.client.company_id,
    customer_id: input.customerId,
    portal_user_id: portalUserId,
    external_account_id: userId,
    customer_number: customerNumber,
    external_customer_id: externalCustomerId,
    email,
    user_email: email,
    role: CUSTOMER_PORTAL_ACCOUNT_ROLE,
    status: 'active',
    is_active: true,
    activated_at: now,
    verified_at: now,
    match_method: matchMethod,
    verified_identity_snapshot: accountIdentitySnapshot,
    metadata: {
      source: 'gridex_website_supabase',
      auto_linked_at: now,
      api_client_id: input.client.id,
      portal_user_id: userId,
    },
    updated_at: now,
  }

  if (existingAccount?.id) {
    accountId = String(existingAccount.id)
    const { error } = await supabaseService
      .from('customer_portal_accounts')
      .update(accountPayload)
      .eq('id', accountId)
    if (error && !isMissingPortalSchemaError(error)) throw error
  } else {
    const { data, error } = await supabaseService
      .from('customer_portal_accounts')
      .insert({ ...accountPayload, user_id: null, invited_at: now, created_at: now })
      .select('id')
      .maybeSingle()
    if (error && !isMissingPortalSchemaError(error)) throw error
    accountId = data?.id ? String(data.id) : null
  }

  let identityId = clean(input.identityId)
  if (!identityId && externalCustomerId) {
    const existingByExternal = await supabaseService
      .from('customer_portal_identities')
      .select('id')
      .eq('company_id', input.client.company_id)
      .eq('provider', WEBSITE_PORTAL_PROVIDER)
      .eq('external_customer_id', externalCustomerId)
      .limit(1)
      .maybeSingle()
    if (!existingByExternal.error && existingByExternal.data?.id) identityId = String(existingByExternal.data.id)
    if (existingByExternal.error && !isMissingPortalSchemaError(existingByExternal.error)) throw existingByExternal.error
  }

  if (!identityId) {
    const existingByAccount = await selectPortalIdentitiesByUser(input.client.company_id, userId)
    const row = existingByAccount.find((candidate) => str(candidate, 'customer_id') === input.customerId) ?? null
    if (row?.id) identityId = String(row.id)
  }

  if (!identityId) {
    const existingIdentity = await supabaseService
      .from('customer_portal_identities')
      .select('id')
      .eq('company_id', input.client.company_id)
      .eq('customer_id', input.customerId)
      .eq('provider', WEBSITE_PORTAL_PROVIDER)
      .limit(1)
      .maybeSingle()
    if (!existingIdentity.error && existingIdentity.data?.id) identityId = String(existingIdentity.data.id)
    if (existingIdentity.error && !isMissingPortalSchemaError(existingIdentity.error)) throw existingIdentity.error
  }

  const identityPayload = {
    company_id: input.client.company_id,
    customer_id: input.customerId,
    provider: WEBSITE_PORTAL_PROVIDER,
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
      portal_user_id: userId,
    },
    customer_number: customerNumber,
    auth_user_id: portalUserId,
    customer_portal_user_id: portalUserId,
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
    return { ok: false, status: 422, code: 'missing_customer_identifier', error: 'Kundidentifierare saknas.', identifiers }
  }

  try {
    const userId = clean(identifiers.customerPortalUserId) ?? clean(identifiers.authUserId)
    const resolved =
      (userId ? await linkedByAccount(input.client.company_id, userId) : null) ??
      (identifiers.externalCustomerId ? await linkedByExternal(input.client.company_id, identifiers.externalCustomerId) : null) ??
      (identifiers.customerNumber ? await customerByField(input.client.company_id, 'customer_number', identifiers.customerNumber, 'customers.customer_number') : null) ??
      (identifiers.email ? await linkedByEmail(input.client.company_id, identifiers.email) : null)

    if (!resolved) {
      if (identifiers.email && await hasAmbiguousEmailMatch(input.client.company_id, identifiers.email)) {
        return { ok: false, status: 409, code: 'ambiguous_customer_match', error: 'Flera kunder matchar samma e-post inom tenant. Skicka customer_number eller external_customer_id.', identifiers }
      }
      return { ok: false, status: 404, code: 'customer_not_found', error: 'Kunden hittades inte eller är inte länkad till API-klienten.', identifiers }
    }

    const mayLinkUser = userId ? hasStrongFirstLinkFactors(identifiers, resolved) : false
    if (userId && !mayLinkUser) {
      return {
        ok: false,
        status: 403,
        code: 'customer_portal_link_requires_sync',
        error: 'Första kundportalkopplingen kräver redan länkad användare eller minst två matchande kunduppgifter.',
        identifiers,
      }
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
