import { NextRequest } from 'next/server'
import { ApiInputError, executeIdempotentPortalWrite, readJsonObject } from '@/lib/api/strictRequest'
import { supabaseService } from '@/lib/supabase/service'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { applyCustomerSiteAddressCandidate } from '@/lib/customer-sites/addressIntake'
import { enqueueCustomerDataRequestAutomation } from '@/lib/customer-operations/automation'
import { createPortalCompletionCase } from '@/lib/customer-portal/db'
import { missingIntegrationApiScopes } from '@/lib/integrations/apiAuth'
import {
  CustomerContactChangeError,
  changedFields,
  normalizeContactEmail,
  normalizeContactPhone,
  planPrimaryContactSync,
} from '@/lib/customer-service/contactChange'
import { ContactChangeTransactionError, applyCustomerContactChange } from '@/lib/customer-service/contactChangeTransaction'
import {
  parseCustomerProfileUpdateRequest,
  type CustomerProfileUpdateRequest,
} from '@/lib/customer-portal/profileUpdateContract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type JsonRecord = Record<string, unknown>

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function definedValues(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  )
}

function requiredScopes(payload: CustomerProfileUpdateRequest): string[] {
  return [
    ...(payload.profile ? ['customer_contact.write'] : []),
    ...(payload.facility_data ? ['customer_facility_data.write'] : []),
  ]
}

async function updateCanonicalCustomerProfile(input: {
  companyId: string
  customerId: string
  apiClientId: string
  portalIdentityId: string | null
  profile: NonNullable<CustomerProfileUpdateRequest['profile']>
}) {
  const existing = await supabaseService
    .from('customers')
    .select('id,customer_type,first_name,last_name,full_name,company_name,email,phone,invoice_email,preferred_language,metadata,updated_at')
    .eq('company_id', input.companyId)
    .eq('id', input.customerId)
    .maybeSingle()
  if (existing.error) throw existing.error
  if (!existing.data) throw new ApiInputError('Kunden hittades inte för aktuell tenant.', 'resource_not_found', 404)
  const before = existing.data as JsonRecord

  let email: string | null | undefined
  let phone: string | null | undefined
  let invoiceEmail: string | null | undefined
  try {
    // Omitted fields stay untouched; this route never clears values it was not sent.
    email = normalizeContactEmail(input.profile.email ?? undefined) ?? undefined
    phone = normalizeContactPhone(input.profile.phone ?? undefined) ?? undefined
    invoiceEmail = normalizeContactEmail(input.profile.invoice_email ?? undefined) ?? undefined
  } catch (error) {
    if (error instanceof CustomerContactChangeError) {
      throw new ApiInputError(error.message, error.code, 422, 'profile')
    }
    throw error
  }

  const update = definedValues({
    first_name: input.profile.first_name,
    last_name: input.profile.last_name,
    full_name: input.profile.full_name,
    company_name: input.profile.company_name,
    email,
    phone,
    invoice_email: invoiceEmail,
    preferred_language: input.profile.language_code,
    metadata: input.profile.timezone
      ? { ...asRecord(before.metadata), portal_timezone: input.profile.timezone }
      : undefined,
  })
  if (Object.keys(changedFields(before, update)).length === 0) return true

  // Same primary-contact rule as the OPS customer card.
  const contactPatch = planPrimaryContactSync({
    customerType: String(before.customer_type ?? 'private'),
    contactName: null,
    email,
    phone,
  })

  // One transaction: version lock, customer, primary contact, fail-closed audit and outbox. The
  // actor is the linked portal account acting through the tenant API client, never an OPS user.
  try {
    await applyCustomerContactChange({
      companyId: input.companyId,
      customerId: input.customerId,
      actor: { kind: 'customer_portal', apiClientId: input.apiClientId, portalIdentityId: input.portalIdentityId },
      channel: 'customer_api',
      expectedUpdatedAt: String(before.updated_at),
      customerPatch: update,
      contactPatch,
    })
  } catch (error) {
    if (error instanceof ContactChangeTransactionError) {
      if (error.code === 'version_conflict') throw new ApiInputError(error.message, 'profile_version_conflict', 409)
      if (error.code === 'not_found') throw new ApiInputError(error.message, 'resource_not_found', 404)
      if (error.code === 'customer_archived') throw new ApiInputError(error.message, 'customer_archived', 409)
    }
    throw error
  }
  return true
}

async function resolveFacilitySite(input: {
  companyId: string
  customerId: string
  facilityReference: string
}) {
  const result = await supabaseService
    .from('customer_sites')
    .select('id,facility_reference')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('facility_reference', input.facilityReference)
    .maybeSingle()
  if (result.error) throw result.error
  if (!result.data?.id) {
    throw new ApiInputError(
      'Anläggningsreferensen hittades inte för kunden.',
      'resource_not_found',
      404,
      'facility_data.facility_reference',
    )
  }
  return String(result.data.id)
}

export async function POST(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, {
    anyOf: ['customer_contact.write', 'customer_facility_data.write'],
  })
  if (!context.ok) return context.response

  try {
    const payload = parseCustomerProfileUpdateRequest(await readJsonObject(request))
    const missingScopes = missingIntegrationApiScopes(
      context.client.scopes ?? [],
      requiredScopes(payload),
    )
    if (missingScopes.length > 0) {
      throw new ApiInputError(
        `API-klienten saknar scope: ${missingScopes.join(', ')}.`,
        'api_scope_missing',
        403,
      )
    }

    const result = await executeIdempotentPortalWrite<Record<string, unknown>>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: context.identity.customer_id,
      operation: '/api/v1/customer/profile-update',
      payload,
      execute: async () => {
        // F22: validate every referenced resource before the first mutation so a
        // missing/foreign facility reference can never leave a partial profile change.
        const siteId: string | null = payload.facility_data
          ? await resolveFacilitySite({
              companyId: context.client.company_id,
              customerId: context.identity.customer_id,
              facilityReference: payload.facility_data.facility_reference,
            })
          : null

        const profileUpdated = payload.profile
          ? await updateCanonicalCustomerProfile({
              companyId: context.client.company_id,
              customerId: context.identity.customer_id,
              apiClientId: context.client.id,
              portalIdentityId: context.identity.id,
              profile: payload.profile,
            })
          : false

        let addressResult: unknown = null
        if (payload.facility_data && siteId) {
          const address = payload.facility_data.address
          const applied = await applyCustomerSiteAddressCandidate({
            companyId: context.client.company_id,
            customerId: context.identity.customer_id,
            siteId,
            address: {
              street: address.street,
              postalCode: address.postal_code,
              city: address.city,
              country: address.country ?? 'SE',
              careOf: address.care_of,
              apartmentNumber: address.apartment_number,
              source: 'customer_portal',
              sourceReference: clean(payload.facility_data.external_request_id),
              metadata: { payload_type: 'profile_update', ...(payload.metadata ?? {}) },
            },
          })
          addressResult = applied
          if (applied.status === 'updated' || applied.status === 'unchanged') {
            // Awaited (F13): a fire-and-forget promise can be dropped when the serverless
            // function is frozen after the response. A failure is logged and never undoes
            // the already saved profile change.
            try {
              await enqueueCustomerDataRequestAutomation({
                companyId: context.client.company_id,
                customerId: context.identity.customer_id,
                siteId,
              })
            } catch (error) {
              console.error('[customer-portal] profile automation enqueue failed', error)
            }
          }
        }

        const facilityAccepted = !payload.facility_data || Boolean(
          addressResult && typeof addressResult === 'object' &&
          ['updated', 'unchanged'].includes(String((addressResult as { status?: unknown }).status ?? '')),
        )
        const accepted = facilityAccepted && (profileUpdated || Boolean(payload.facility_data))

        const completion = await supabaseService
          .from('customer_portal_completions')
          .insert({
            company_id: context.client.company_id,
            api_client_id: context.client.id,
            customer_id: context.identity.customer_id,
            site_id: siteId,
            completion_type: 'profile_update',
            status: accepted ? 'accepted' : 'submitted',
            submitted_payload: payload,
            result_payload: {
              profile_updated: profileUpdated,
              address_result: addressResult,
            },
          })
          .select('id,completion_reference,status,created_at')
          .single()
        if (completion.error) throw completion.error

        if (!accepted) {
          await createPortalCompletionCase({
            companyId: context.client.company_id,
            customerId: context.identity.customer_id,
            siteId,
            completionId: String(completion.data.id),
            completionType: 'profile_update',
            payload,
          })
        }

        return {
          statusCode: 200,
          body: {
            data: {
              completion_reference: completion.data.completion_reference,
              status: completion.data.status,
              created_at: completion.data.created_at,
              profile_updated: profileUpdated,
              facility_updated: facilityAccepted && Boolean(payload.facility_data),
              address_result: addressResult,
            },
          },
        }
      },
    })

    await logCustomerPortalSuccess({
      request,
      client: context.client,
      startedAt: context.startedAt,
      resultCount: 1,
      metadata: { idempotency_replay: result.replayed },
    })
    return customerPortalJson(result.body, { status: result.statusCode })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
