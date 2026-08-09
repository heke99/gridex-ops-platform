//app/api/v1/customer-portal/sync/route.ts
import { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  ApiInputError,
  executeIdempotentPortalWrite,
  readJsonObject,
} from '@/lib/api/strictRequest'
import { supabaseService } from '@/lib/supabase/service'
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
import { publicPortalIdentity } from '@/lib/customer-portal/publicIdentity'

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

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function serializePortalSyncError(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') {
    return { message: String(error ?? 'Okänt fel') }
  }

  const record = error as Record<string, unknown>
  return {
    name: error instanceof Error ? error.name : undefined,
    message: error instanceof Error ? error.message : record.message,
    code: record.code,
    details: record.details,
    hint: record.hint,
  }
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

async function loadCandidates(
  companyId: string,
  payload: Required<Pick<SyncPayload, 'email' | 'customer_number' | 'facility_id'>> & { identifier: string },
): Promise<{ candidates: CustomerCandidate[]; facilityMatches: Set<string> }> {
  const customerIds = new Set<string>()
  const candidates: CustomerCandidate[] = []
  const facilityMatches = payload.facility_id
    ? await facilityCustomerIds(companyId, payload.facility_id)
    : new Set<string>()

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

  if (facilityMatches.size > 0) {
    const { data, error } = await supabaseService
      .from('customers')
      .select('id,company_id,customer_number,email,personal_number,org_number')
      .eq('company_id', companyId)
      .in('id', Array.from(facilityMatches))
    if (error) throw error
    addRows(data as CustomerCandidate[])
  }

  return { candidates, facilityMatches }
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
    .select('id,status,customer_id,match_strength,match_method,linked_at,last_seen_at')
    .single()

  if (error) throw error
  return data
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const auth = await requireIntegrationApiAccess(request, ['customer_sync.write'])

  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson({ error: auth.error }, { status: auth.status })
  }

  try {
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

    const write = await executeIdempotentPortalWrite<Record<string, unknown>>({
      request,
      companyId: auth.context.companyId,
      clientId: auth.client.id,
      customerId: null,
      operation: '/api/v1/customer-portal/sync',
      payload: body,
      execute: async () => {
        const externalCustomerId = body.external_customer_id
        const externalAccountId = String(body.external_account_id ?? '').trim() || null
        const email = normalizeEmail(body.email)
        const customerNumber = String(body.customer_number ?? '').trim()
        const identifier = normalizeDigits(body.personal_number ?? body.organization_number)
        const facilityId = String(body.facility_id ?? '').trim()

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
          return {
            statusCode: 200,
            body: {
              data: {
                outcome: 'rejected',
                status: 'rejected',
                access_granted: false,
                reason: 'insufficient_identity_factors',
                portal_identity_reference: publicPortalIdentity(auth.context.companyId, identity).portal_identity_reference,
              },
            },
          }
        }

        const resolved = await loadCandidates(auth.context.companyId, {
          email,
          customer_number: customerNumber,
          facility_id: facilityId,
          identifier,
        })

        let best: { customer: CustomerCandidate; flags: Record<string, boolean>; isStrong: boolean } | null = null
        for (const customer of resolved.candidates) {
          const flags = {
            emailMatched: Boolean(email && normalizeEmail(customer.email) === email),
            customerNumberMatched: Boolean(customerNumber && customer.customer_number === customerNumber),
            identifierMatched: Boolean(identifier && (normalizeDigits(customer.personal_number) === identifier || normalizeDigits(customer.org_number) === identifier)),
            facilityMatched: Boolean(facilityId && resolved.facilityMatches.has(customer.id)),
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
          return {
            statusCode: 200,
            body: {
              data: {
                status: 'linked',
                customer_reference: externalCustomerId,
                customer_number: best.customer.customer_number,
                external_customer_id: externalCustomerId,
                portal_identity_reference: publicPortalIdentity(auth.context.companyId, identity).portal_identity_reference,
                portal_role: 'owner',
                created: false,
                access_granted: true,
              },
            },
          }
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
        return {
          statusCode: 200,
          body: {
            data: {
              outcome,
              status: 'pending_review',
              access_granted: false,
              portal_identity_reference: publicPortalIdentity(auth.context.companyId, identity).portal_identity_reference,
            },
          },
        }
      },
    })

    return customerPortalJson(write.body, { status: write.statusCode })
  } catch (error) {
    const controlled = error instanceof ApiInputError
    const status = controlled ? error.status : 500
    const errorCode = controlled ? error.code : 'portal_sync_failed'
    const clientMessage = controlled ? error.message : 'Kundlänkning kunde inte behandlas.'
    const errorMetadata = serializePortalSyncError(error)
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: status,
      startedAt,
      errorCode,
      metadata: { portal_sync_error: errorMetadata },
    })
    return customerPortalJson({
      error: clientMessage,
      code: errorCode,
      ...(controlled && error.field ? { field: error.field } : {}),
    }, { status })
  }
}