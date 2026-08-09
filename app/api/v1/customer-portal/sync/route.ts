import { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  ApiInputError,
  executeIdempotentPortalWrite,
  readJsonObject,
} from '@/lib/api/strictRequest'
import {
  customerPortalJson,
  normalizeDigits,
  normalizeEmail,
} from '@/lib/customer-portal/externalApi'
import {
  resolvePortalCustomerCandidates,
  type PortalCustomerCandidate,
} from '@/lib/customer-portal/identityResolver'
import { publicPortalIdentity } from '@/lib/customer-portal/publicIdentity'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
} from '@/lib/integrations/apiAuth'
import { supabaseService } from '@/lib/supabase/service'

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

type PortalIdentityDbStatus = 'active' | 'pending_review' | 'rejected' | 'disabled'
type PortalIdentityApiStatus = 'linked' | 'pending_review' | 'rejected'
type PortalIdentityMatchStrength = 'strong' | 'weak' | 'manual'

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

function strongMatch(input: PortalCustomerCandidate['flags']): boolean {
  return (
    (input.emailMatched && input.customerNumberMatched) ||
    (input.emailMatched && input.identifierMatched) ||
    (input.customerNumberMatched && input.facilityMatched) ||
    (input.identifierMatched && input.facilityMatched)
  )
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
  const { data, error } = await supabaseService
    .from('customer_portal_identities')
    .upsert({
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
    }, { onConflict: 'company_id,provider,external_customer_id' })
    .select('id,status,customer_id,match_strength,match_method,linked_at,last_seen_at')
    .single()
  if (error) throw error
  return data
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const auth = await requireIntegrationApiAccess(request, ['customer_sync.write'])
  if (!auth.ok) {
    await logIntegrationApiRequest({
      client: auth.client ?? null,
      request,
      statusCode: auth.status,
      startedAt,
      errorCode: auth.errorCode,
    })
    return customerPortalJson({ error: auth.error, code: auth.errorCode }, { status: auth.status })
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
    const portalUserIdHeader = request.headers.get('x-gridex-customer-portal-user-id')?.trim()
    const authUserIdHeader = request.headers.get('x-gridex-auth-user-id')?.trim()
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
              received_factors: {
                email: Boolean(email),
                customer_number: Boolean(customerNumber),
                identifier: Boolean(identifier),
                facility_id: Boolean(facilityId),
              },
              source_payload: body.metadata ?? {},
            },
          })
          await logIntegrationApiRequest({
            client: auth.client,
            request,
            statusCode: 200,
            startedAt,
            metadata: { outcome: 'rejected', identity_id: identity.id },
          })
          return {
            statusCode: 200,
            body: {
              data: {
                outcome: 'rejected',
                status: 'rejected',
                access_granted: false,
                reason: 'insufficient_identity_factors',
                portal_identity_reference: publicPortalIdentity(
                  auth.context.companyId,
                  identity,
                ).portal_identity_reference,
              },
            },
          }
        }

        const candidates = await resolvePortalCustomerCandidates({
          companyId: auth.context.companyId,
          email,
          customerNumber,
          identifier,
          facilityId,
        })

        let best: {
          customer: PortalCustomerCandidate
          flags: PortalCustomerCandidate['flags']
          isStrong: boolean
        } | null = null

        for (const customer of candidates) {
          const flags = customer.flags
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
            matchMethod: Object.entries(best.flags)
              .filter(([, ok]) => ok)
              .map(([key]) => key)
              .join('+'),
            metadata: {
              matched_customer_id: best.customer.id,
              flags: best.flags,
              source_payload: body.metadata ?? {},
            },
          })
          await logIntegrationApiRequest({
            client: auth.client,
            request,
            statusCode: 200,
            startedAt,
            metadata: {
              outcome: 'linked',
              identity_id: identity.id,
              customer_id: best.customer.id,
            },
          })
          return {
            statusCode: 200,
            body: {
              data: {
                status: 'linked',
                customer_reference: externalCustomerId,
                customer_number: best.customer.customer_number,
                external_customer_id: externalCustomerId,
                portal_identity_reference: publicPortalIdentity(
                  auth.context.companyId,
                  identity,
                ).portal_identity_reference,
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
        await logIntegrationApiRequest({
          client: auth.client,
          request,
          statusCode: 200,
          startedAt,
          metadata: { outcome, identity_id: identity.id },
        })
        return {
          statusCode: 200,
          body: {
            data: {
              outcome,
              status: 'pending_review',
              access_granted: false,
              portal_identity_reference: publicPortalIdentity(
                auth.context.companyId,
                identity,
              ).portal_identity_reference,
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
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: status,
      startedAt,
      errorCode,
      metadata: { portal_sync_error: serializePortalSyncError(error) },
    })
    return customerPortalJson({
      error: clientMessage,
      code: errorCode,
      ...(controlled && error.field ? { field: error.field } : {}),
    }, { status })
  }
}
