//app/api/v1/customer-portal/sync/route.ts
import { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  ApiInputError,
  claimPortalWriteIdempotency,
  completePortalWriteIdempotency,
  failPortalWriteIdempotency,
  readJsonObject,
  requireIdempotencyKey,
} from '@/lib/api/strictRequest'
import { supabaseService } from '@/lib/supabase/service'
import { tenantDb } from '@/lib/supabase/tenantDb'
import { readSavedPortalAccount } from '@/lib/customer-portal/accountLinkPreservation'
import { technicalErrorDiagnostic } from '@/lib/logging/technicalError'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
} from '@/lib/integrations/apiAuth'
import {
  customerPortalJson,
  normalizeDigits,
  normalizeEmail,
  normalizeFacility,
} from '@/lib/customer-portal/externalApi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SyncPayloadSchema = z.object({
  external_customer_id: z.string().trim().min(1),
  external_account_id: z.string().trim().min(1).optional(),
  customer_portal_user_id: z.string().uuid(),
  auth_user_id: z.string().uuid(),
  email: z.string().email().optional(),
  personal_number: z.string().trim().min(1).optional(),
  organization_number: z.string().trim().min(1).optional(),
  customer_number: z.string().trim().min(1).optional(),
  facility_id: z.string().trim().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict().superRefine((value, context) => {
  if (value.customer_portal_user_id !== value.auth_user_id) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customer_portal_user_id'],
      message: 'customer_portal_user_id and auth_user_id must be identical',
    })
  }
})

type SyncPayload = z.infer<typeof SyncPayloadSchema>

type CustomerCandidate = {
  id: string
  company_id: string
  customer_number: string | null
  email: string | null
  personal_number: string | null
  org_number: string | null
}

type PortalIdentityDbStatus = 'active' | 'pending_review' | 'rejected' | 'disabled'
type PortalIdentityApiStatus = 'linked' | 'pending_review' | 'rejected'
type PortalIdentityMatchStrength = 'strong' | 'weak' | 'manual'

type PortalScopedQuery<T> = {
  eq: (field: string, value: string) => PortalScopedQuery<T>
  or: (filter: string) => PortalScopedQuery<T>
  limit: (count: number) => PromiseLike<{ data: T[] | null; error: unknown }>
  maybeSingle: () => PromiseLike<{ data: T | null; error: unknown }>
}

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function revokedPortalIdentity(error: unknown): boolean {
  const dbError = error as { code?: string; message?: string } | null
  return dbError?.code === '23514' &&
    dbError.message === 'customer_portal_identity_revoked'
}

async function assertPortalSubjectNotRevoked(companyId: string, externalCustomerId: string, authUserId: string, requireActiveIdentity = false) {
  const portal = tenantDb(companyId)
  const [identity, account] = await Promise.all([
    (portal.from('customer_portal_identities').select('status,customer_id') as PortalScopedQuery<{ status: string; customer_id: string | null }>)
      .eq('provider', 'gridex_website')
      .eq('external_customer_id', externalCustomerId)
      .eq('auth_user_id', authUserId)
      .maybeSingle(),
    (portal.from('customer_portal_accounts').select('status,is_active') as PortalScopedQuery<{ status: string; is_active: boolean }>)
      .or(`portal_user_id.eq.${authUserId},user_id.eq.${authUserId}`)
      .limit(50),
  ])
  if (identity.error) throw identity.error
  if (account.error) throw account.error
  if ((account.data ?? []).length === 50) {
    throw new ApiInputError('Portalkopplingen kräver manuell kontroll.', 'portal_account_ambiguous', 409)
  }
  if (identity.data?.status === 'disabled' ||
      (requireActiveIdentity && identity.data?.status !== 'active') ||
      (account.data ?? []).some((row) => row.status !== 'active' || row.is_active !== true)) {
    throw new ApiInputError('Portalåtkomsten har spärrats.', 'portal_identity_revoked', 409)
  }
  return identity.data
}

function strongMatch(input: {
  emailMatched: boolean
  customerNumberMatched: boolean
  identifierMatched: boolean
  facilityMatched: boolean
}) {
  return (
    (input.emailMatched && input.customerNumberMatched) ||
    (input.emailMatched && input.identifierMatched) ||
    (input.customerNumberMatched && input.facilityMatched) ||
    (input.identifierMatched && input.facilityMatched)
  )
}

async function facilityCustomerIds(companyId: string, facilityId: string): Promise<Set<string>> {
  const normalized = normalizeFacility(facilityId)
  if (!normalized) return new Set()

  const variants = Array.from(new Set([facilityId.trim(), normalized].filter(Boolean)))
  const { data, error } = await supabaseService
    .from('customer_sites')
    .select('customer_id')
    .eq('company_id', companyId)
    .in('facility_id', variants)

  if (error) throw error
  return new Set((data ?? []).map((row) => String(row.customer_id)).filter(Boolean))
}

async function loadCandidates(companyId: string, payload: Required<Pick<SyncPayload, 'email' | 'customer_number' | 'facility_id'>> & { identifier: string }) {
  const customerIds = new Set<string>()
  const candidates: CustomerCandidate[] = []

  const addRows = (rows: CustomerCandidate[] | null | undefined) => {
    for (const row of rows ?? []) {
      if (!customerIds.has(row.id)) {
        customerIds.add(row.id)
        candidates.push(row)
      }
    }
  }

  if (payload.customer_number) {
    const { data, error } = await supabaseService
      .from('customers')
      .select('id,company_id,customer_number,email,personal_number,org_number')
      .eq('company_id', companyId)
      .eq('customer_number', payload.customer_number)
      .limit(10)
    if (error) throw error
    addRows(data as CustomerCandidate[])
  }

  if (payload.email) {
    const { data, error } = await supabaseService
      .from('customers')
      .select('id,company_id,customer_number,email,personal_number,org_number')
      .eq('company_id', companyId)
      .ilike('email', payload.email)
      .limit(20)
    if (error) throw error
    addRows(data as CustomerCandidate[])
  }

  if (payload.identifier) {
    let result = await supabaseService
      .from('customers')
      .select('id,company_id,customer_number,email,personal_number,org_number')
      .eq('company_id', companyId)
      .or(`personal_number.eq.${payload.identifier},org_number.eq.${payload.identifier},normalized_personal_number.eq.${payload.identifier},normalized_org_number.eq.${payload.identifier}`)
      .limit(20)

    if (result.error && missingSchema(result.error)) {
      result = await supabaseService
        .from('customers')
        .select('id,company_id,customer_number,email,personal_number,org_number')
        .eq('company_id', companyId)
        .or(`personal_number.eq.${payload.identifier},org_number.eq.${payload.identifier}`)
        .limit(20)
    }
    if (result.error) throw result.error
    addRows(result.data as CustomerCandidate[])
  }

  if (payload.facility_id) {
    const siteCustomerIds = await facilityCustomerIds(companyId, payload.facility_id)
    if (siteCustomerIds.size > 0) {
      const { data, error } = await supabaseService
        .from('customers')
        .select('id,company_id,customer_number,email,personal_number,org_number')
        .eq('company_id', companyId)
        .in('id', Array.from(siteCustomerIds))
      if (error) throw error
      addRows(data as CustomerCandidate[])
    }
  }

  return candidates
}

async function upsertIdentity(input: {
  companyId: string
  customerId: string | null
  externalCustomerId: string
  externalAccountId: string | null
  authUserId: string
  email: string | null
  status: PortalIdentityApiStatus
  dbStatus: PortalIdentityDbStatus
  matchStrength: PortalIdentityMatchStrength
  matchMethod: string
  metadata: Record<string, unknown>
}) {
  const now = new Date().toISOString()
  const payload = {
    company_id: input.companyId,
    customer_id: input.customerId,
    provider: 'gridex_website',
    external_customer_id: input.externalCustomerId,
    external_account_id: input.externalAccountId,
    auth_user_id: input.authUserId,
    customer_portal_user_id: input.authUserId,
    email: input.email,
    status: input.dbStatus,
    match_strength: input.matchStrength,
    match_method: input.matchMethod,
    linked_at: input.status === 'linked' ? now : null,
    metadata: input.metadata,
    updated_at: now,
  }

  const { data, error } = await supabaseService
    .from('customer_portal_identities')
    .upsert(payload, { onConflict: 'company_id,provider,external_customer_id' })
    .select('id,status,customer_id,match_strength,match_method')
    .single()

  if (error) {
    if (revokedPortalIdentity(error)) {
      throw new ApiInputError('Portalidentiteten är spärrad.', 'portal_identity_revoked', 409)
    }
    throw error
  }
  return data
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  let idempotencyRecordId: string | null = null
  const auth = await requireIntegrationApiAccess(request, ['customer_sync.write'])

  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson({ error: auth.error }, { status: auth.status })
  }

  try {
    const idempotencyKey = requireIdempotencyKey(request)
    const parsed = SyncPayloadSchema.safeParse(await readJsonObject(request))
    if (!parsed.success) {
      return customerPortalJson({
        error: 'Ogiltig strikt portal sync-request.',
        code: 'portal_sync_validation_error',
        details: parsed.error.issues,
      }, { status: 422 })
    }
    const body = parsed.data
    const portalUserIdHeader = request.headers
      .get('x-gridex-customer-portal-user-id')
      ?.trim()
    const authUserIdHeader = request.headers
      .get('x-gridex-auth-user-id')
      ?.trim()
    if (
      !portalUserIdHeader ||
      !authUserIdHeader ||
      portalUserIdHeader !== authUserIdHeader ||
      portalUserIdHeader !== body.customer_portal_user_id ||
      authUserIdHeader !== body.auth_user_id
    ) {
      return customerPortalJson({
        error: 'Portalidentiteten i headers och payload måste vara komplett och identisk.',
        code: 'portal_identity_mismatch',
      }, { status: 422 })
    }
    const externalCustomerId = body.external_customer_id
    const externalAccountId = String(body.external_account_id ?? '').trim() || null
    const email = normalizeEmail(body.email)
    const customerNumber = String(body.customer_number ?? '').trim()
    const identifier = normalizeDigits(body.personal_number ?? body.organization_number)
    const facilityId = String(body.facility_id ?? '').trim()
    const claim = await claimPortalWriteIdempotency({
      companyId: auth.context.companyId,
      clientId: auth.client.id,
      customerId: null,
      operation: '/api/v1/customer-portal/sync',
      idempotencyKey,
      payload: body,
    })
    if (claim.replay) {
      const savedResult = (claim.responseBody as { data?: { access_granted?: boolean; portal_role?: string } } | null)?.data
      const granted = savedResult?.access_granted === true
      const currentIdentity = await assertPortalSubjectNotRevoked(auth.context.companyId, externalCustomerId, body.auth_user_id, granted)
      if (granted) {
        const currentAccount = currentIdentity?.customer_id
          ? await readSavedPortalAccount({ companyId: auth.context.companyId, customerId: currentIdentity.customer_id, userId: body.auth_user_id })
          : null
        if (!currentAccount || currentAccount.role !== savedResult?.portal_role) {
          // Retain the immutable completed result, but do not replay an owner
          // label that the current saved relationship no longer supports.
          throw new ApiInputError('Portalkopplingen kräver manuell kontroll.', 'portal_account_ambiguous', 409)
        }
      }
      return customerPortalJson(claim.responseBody, {
        status: claim.statusCode ?? 200,
        headers: { 'Idempotency-Replayed': 'true' },
      })
    }
    idempotencyRecordId = claim.recordId
    await assertPortalSubjectNotRevoked(auth.context.companyId, externalCustomerId, body.auth_user_id)

    const identityFactors = [email, customerNumber, identifier, facilityId].filter(Boolean).length
    if (identityFactors < 2) {
      const identity = await upsertIdentity({
        companyId: auth.context.companyId,
        customerId: null,
        externalCustomerId,
        externalAccountId,
        authUserId: body.auth_user_id,
        email: email || null,
        status: 'rejected',
        dbStatus: 'rejected',
        matchStrength: 'manual',
        matchMethod: 'insufficient_identity_factors',
        metadata: {
          reason: 'E-post eller en ensam uppgift räcker inte för åtkomst.',
          received_factors: { email: Boolean(email), customer_number: Boolean(customerNumber), identifier: Boolean(identifier), facility_id: Boolean(facilityId) },
          source_payload: body.metadata ?? {},
        },
      })
      await logIntegrationApiRequest({ client: auth.client, request, statusCode: 200, startedAt, metadata: { outcome: 'rejected', identity_id: identity.id } })
      const responseBody = { data: { outcome: 'rejected', status: 'rejected', access_granted: false, reason: 'insufficient_identity_factors' } }
      await completePortalWriteIdempotency({ recordId: claim.recordId, companyId: auth.context.companyId, statusCode: 200, responseBody })
      return customerPortalJson(responseBody, { headers: { 'Idempotency-Replayed': 'false' } })
    }

    const candidates = await loadCandidates(auth.context.companyId, {
      email,
      customer_number: customerNumber,
      facility_id: facilityId,
      identifier,
    })

    const facilityMatches = facilityId ? await facilityCustomerIds(auth.context.companyId, facilityId) : new Set<string>()

    let best: { customer: CustomerCandidate; flags: Record<string, boolean>; isStrong: boolean } | null = null
    for (const customer of candidates) {
      const flags = {
        emailMatched: Boolean(email && normalizeEmail(customer.email) === email),
        customerNumberMatched: Boolean(customerNumber && customer.customer_number === customerNumber),
        identifierMatched: Boolean(identifier && (normalizeDigits(customer.personal_number) === identifier || normalizeDigits(customer.org_number) === identifier)),
        facilityMatched: Boolean(facilityId && facilityMatches.has(customer.id)),
      }
      const isStrong = strongMatch(flags)
      if (isStrong) {
        best = { customer, flags, isStrong }
        break
      }
      if (!best && Object.values(flags).filter(Boolean).length > 0) {
        best = { customer, flags, isStrong: false }
      }
    }

    if (best?.isStrong) {
      const account = await readSavedPortalAccount({
        companyId: auth.context.companyId,
        customerId: best.customer.id,
        userId: body.auth_user_id,
      })
      const identity = await upsertIdentity({
        companyId: auth.context.companyId,
        customerId: best.customer.id,
        externalCustomerId,
        externalAccountId,
        authUserId: body.auth_user_id,
        email: email || best.customer.email,
        status: 'linked',
        dbStatus: 'active',
        matchStrength: 'strong',
        matchMethod: Object.entries(best.flags).filter(([, ok]) => ok).map(([key]) => key).join('+'),
        metadata: {
          matched_customer_id: best.customer.id,
          flags: best.flags,
          source_payload: body.metadata ?? {},
        },
      })
      await logIntegrationApiRequest({ client: auth.client, request, statusCode: 200, startedAt, metadata: { outcome: 'linked', identity_id: identity.id, customer_id: best.customer.id } })
      const responseBody = { data: {
        status: 'linked',
        customer_reference: externalCustomerId,
        customer_number: best.customer.customer_number,
        external_customer_id: externalCustomerId,
        customer_portal_user_id: body.customer_portal_user_id,
        auth_user_id: body.auth_user_id,
        ...(account ? { portal_role: account.role } : {}),
        created: false,
        access_granted: account !== null,
      } }
      await completePortalWriteIdempotency({ recordId: claim.recordId, companyId: auth.context.companyId, statusCode: 200, responseBody })
      return customerPortalJson(responseBody, { headers: { 'Idempotency-Replayed': 'false' } })
    }

    const identity = await upsertIdentity({
      companyId: auth.context.companyId,
      customerId: best?.customer.id ?? null,
      externalCustomerId,
      externalAccountId,
      authUserId: body.auth_user_id,
      email: email || best?.customer.email || null,
      status: 'pending_review',
      dbStatus: 'pending_review',
      matchStrength: best ? 'weak' : 'manual',
      matchMethod: best ? 'partial_match' : 'no_match',
      metadata: {
        candidate_customer_id: best?.customer.id ?? null,
        flags: best?.flags ?? {},
        source_payload: body.metadata ?? {},
      },
    })

    const outcome = best ? 'pending_review' : 'lead_created'
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 200, startedAt, metadata: { outcome, identity_id: identity.id } })
    const responseBody = { data: { outcome, status: 'pending_review', access_granted: false } }
    await completePortalWriteIdempotency({ recordId: claim.recordId, companyId: auth.context.companyId, statusCode: 200, responseBody })
    return customerPortalJson(responseBody, { headers: { 'Idempotency-Replayed': 'false' } })
  } catch (error) {
    const controlled = error instanceof ApiInputError
    const status = controlled ? error.status : 500
    const errorCode = controlled ? error.code : 'portal_sync_failed'
    const clientMessage = controlled ? error.message : 'Kundlänkning kunde inte behandlas.'
    const diagnostic = technicalErrorDiagnostic(error)
    if (idempotencyRecordId) {
      await failPortalWriteIdempotency({
        recordId: idempotencyRecordId,
        companyId: auth.context.companyId,
        errorCode,
      }).catch(() => undefined)
    }
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: status,
      startedAt,
      errorCode,
      metadata: { database_code: diagnostic.code },
    })
    return customerPortalJson({
      error: clientMessage,
      code: errorCode,
      ...(controlled && error.field ? { field: error.field } : {}),
    }, { status })
  }
}
