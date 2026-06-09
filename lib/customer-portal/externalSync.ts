import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { emitDomainEvent } from '@/lib/events/domainEvents'
import { supabaseService } from '@/lib/supabase/service'

export type CustomerPortalSyncInput = {
  externalCustomerId?: string | null
  externalAccountId?: string | null
  email?: string | null
  customerNumber?: string | null
  identityNumber?: string | null
  organizationNumber?: string | null
  facilityId?: string | null
  meteringPointId?: string | null
  provider?: string | null
  payload?: Record<string, unknown>
}

export type CustomerPortalSyncResult = {
  status: 'linked' | 'pending_review' | 'no_match'
  customerId: string | null
  matchMethod: string
  requestId: string | null
  warnings: string[]
}

function normalizedText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function normalizedEmail(value: unknown): string | null {
  return normalizedText(value)?.toLowerCase() ?? null
}

function digits(value: unknown): string | null {
  const text = normalizedText(value)?.replace(/\D/g, '') ?? ''
  return text || null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

async function siteOrMeteringPointMatches(input: {
  companyId: string
  customerId: string
  facilityId?: string | null
  meteringPointId?: string | null
}): Promise<boolean> {
  if (input.facilityId) {
    const { data, error } = await supabaseService
      .from('customer_sites')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .or(`facility_id.eq.${input.facilityId},normalized_facility_id.eq.${input.facilityId}`)
      .limit(1)
    if (!error && (data ?? []).length > 0) return true
  }

  if (input.meteringPointId) {
    const { data, error } = await supabaseService
      .from('metering_points')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .or(`metering_point_id.eq.${input.meteringPointId},normalized_metering_point_id.eq.${input.meteringPointId},site_facility_id.eq.${input.meteringPointId}`)
      .limit(1)
    if (!error && (data ?? []).length > 0) return true
  }

  return false
}

async function findStrongCustomerMatch(companyId: string, input: CustomerPortalSyncInput): Promise<{ customerId: string; method: string } | null> {
  const email = normalizedEmail(input.email)
  const customerNumber = normalizedText(input.customerNumber)
  const identityNumber = digits(input.identityNumber)
  const organizationNumber = digits(input.organizationNumber)
  const facilityId = normalizedText(input.facilityId)
  const meteringPointId = normalizedText(input.meteringPointId)

  let candidates: Record<string, unknown>[] = []
  if (email) {
    const { data, error } = await supabaseService
      .from('customers')
      .select('id,email,normalized_email,customer_number,personal_number,identity_number,org_number,organization_number,normalized_personal_number,normalized_org_number')
      .eq('company_id', companyId)
      .or(`email.ilike.${email},normalized_email.eq.${email}`)
      .limit(10)
    if (!error) candidates = (data ?? []) as Record<string, unknown>[]
  }

  for (const candidate of candidates) {
    const customerId = normalizedText(candidate.id)
    if (!customerId) continue
    const candidateCustomerNumber = normalizedText(candidate.customer_number)
    const candidateIdentity = digits(candidate.identity_number) ?? digits(candidate.personal_number) ?? digits(candidate.normalized_personal_number)
    const candidateOrg = digits(candidate.organization_number) ?? digits(candidate.org_number) ?? digits(candidate.normalized_org_number)

    if (customerNumber && candidateCustomerNumber === customerNumber) return { customerId, method: 'email_customer_number' }
    if (identityNumber && candidateIdentity === identityNumber) return { customerId, method: 'email_identity_number' }
    if (organizationNumber && candidateOrg === organizationNumber) return { customerId, method: 'email_organization_number' }
    if (await siteOrMeteringPointMatches({ companyId, customerId, facilityId, meteringPointId })) return { customerId, method: 'email_site_or_metering_point' }
  }

  if (facilityId || meteringPointId) {
    const { data, error } = await supabaseService
      .from('metering_points')
      .select('customer_id')
      .eq('company_id', companyId)
      .or([
        facilityId ? `site_facility_id.eq.${facilityId}` : null,
        meteringPointId ? `metering_point_id.eq.${meteringPointId}` : null,
        meteringPointId ? `normalized_metering_point_id.eq.${meteringPointId}` : null,
      ].filter(Boolean).join(','))
      .limit(2)
    if (!error && (data ?? []).length === 1 && normalizedText(data?.[0]?.customer_id)) {
      return { customerId: String(data?.[0]?.customer_id), method: 'unique_metering_point' }
    }
  }

  return null
}

export async function syncExternalCustomerPortalIdentity(input: {
  client: IntegrationApiClient
  body: CustomerPortalSyncInput
  requestId?: string | null
  idempotencyKey?: string | null
}): Promise<CustomerPortalSyncResult> {
  const provider = normalizedText(input.body.provider) ?? 'tenant_portal'
  const rawPayload = isObject(input.body.payload) ? input.body.payload : input.body as Record<string, unknown>
  const warnings: string[] = []
  const match = await findStrongCustomerMatch(input.client.company_id, input.body)

  if (!match) warnings.push('Ingen säker kundmatchning. Ärendet kräver granskning innan Mina sidor-data kan exponeras.')

  const requestRow = {
    company_id: input.client.company_id,
    api_client_id: input.client.id,
    provider,
    external_customer_id: normalizedText(input.body.externalCustomerId),
    external_account_id: normalizedText(input.body.externalAccountId),
    email: normalizedEmail(input.body.email),
    customer_number: normalizedText(input.body.customerNumber),
    facility_id: normalizedText(input.body.facilityId),
    metering_point_id: normalizedText(input.body.meteringPointId),
    matched_customer_id: match?.customerId ?? null,
    match_method: match?.method ?? 'none',
    status: match ? 'linked' : 'pending_review',
    idempotency_key: input.idempotencyKey,
    request_id: input.requestId,
    input_payload: rawPayload,
    warnings,
  }

  const requestMutation = input.idempotencyKey
    ? supabaseService
        .from('tenant_customer_sync_requests')
        .upsert(requestRow, { onConflict: 'company_id,idempotency_key', ignoreDuplicates: false })
    : supabaseService
        .from('tenant_customer_sync_requests')
        .insert(requestRow)

  const { data, error } = await requestMutation.select('id').maybeSingle()

  if (error && error.code !== '42P01' && error.code !== 'PGRST205') throw error

  if (match) {
    const externalCustomerId = normalizedText(input.body.externalCustomerId)
    const now = new Date().toISOString()
    const linkRow = {
      company_id: input.client.company_id,
      customer_id: match.customerId,
      provider,
      external_customer_id: externalCustomerId,
      external_account_id: normalizedText(input.body.externalAccountId),
      status: 'active',
      match_method: match.method,
      verified_at: now,
      metadata: { sync_request_id: data?.id ?? null },
    }

    const linkMutation = externalCustomerId
      ? supabaseService
          .from('tenant_portal_customer_links')
          .upsert(linkRow, { onConflict: 'company_id,provider,external_customer_id' })
      : supabaseService
          .from('tenant_portal_customer_links')
          .insert(linkRow)

    await linkMutation.then(({ error: linkError }) => {
      if (linkError && linkError.code !== '42P01' && linkError.code !== 'PGRST205') throw linkError
    })

    const identityRow = {
      company_id: input.client.company_id,
      customer_id: match.customerId,
      provider,
      external_customer_id: externalCustomerId,
      external_account_id: normalizedText(input.body.externalAccountId),
      email: normalizedEmail(input.body.email),
      status: 'active',
      match_strength: 'strong',
      match_method: match.method,
      linked_at: now,
      reviewed_at: now,
      metadata: { sync_request_id: data?.id ?? null },
    }

    const identityMutation = externalCustomerId
      ? supabaseService
          .from('customer_portal_identities')
          .upsert(identityRow, { onConflict: 'company_id,provider,external_customer_id' })
      : supabaseService
          .from('customer_portal_identities')
          .insert(identityRow)

    await identityMutation.then(({ error: identityError }) => {
      if (identityError && identityError.code !== '42P01' && identityError.code !== 'PGRST205') throw identityError
    })

    await emitDomainEvent({
      companyId: input.client.company_id,
      eventType: 'customer_portal.identity_linked',
      aggregateType: 'customer',
      aggregateId: match.customerId,
      subjectCustomerId: match.customerId,
      source: 'tenant_portal_api',
      payload: { provider, match_method: match.method, external_customer_id: input.body.externalCustomerId },
      idempotencyKey: input.idempotencyKey ? `customer_portal_sync:${input.client.company_id}:${input.idempotencyKey}` : null,
    })
  }

  return {
    status: match ? 'linked' : 'pending_review',
    customerId: match?.customerId ?? null,
    matchMethod: match?.method ?? 'none',
    requestId: data?.id ? String(data.id) : null,
    warnings,
  }
}
