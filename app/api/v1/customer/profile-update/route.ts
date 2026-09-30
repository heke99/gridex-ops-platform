import { NextRequest } from 'next/server'
import { ApiInputError, readJsonObject, requireIdempotencyKey } from '@/lib/api/strictRequest'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { changeCustomerContact, ContactCommandError } from '@/lib/customer-operations/contactCommand'
import { changeCustomerBillingProfileFromApi, BillingProfileCommandError } from '@/lib/billing/billingProfileCommand'
import { changeCustomerProfilePreferences } from '@/lib/customer-operations/profilePreferencesCommand'
import { changeCustomerFacilityProfile } from '@/lib/customer-operations/facilityProfileCommand'
import { publicPortalProfileUpdateResult, PortalProfileResultError } from '@/lib/customer-portal/publicDto'
import { missingIntegrationApiScopes } from '@/lib/integrations/apiAuth'
import {
  parseCustomerProfileUpdateRequest,
  type CustomerProfileUpdateRequest,
} from '@/lib/customer-portal/profileUpdateContract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function requiredScopes(payload: CustomerProfileUpdateRequest): string[] {
  if (payload.profile && 'invoice_email' in payload.profile) return ['customer_billing.write']
  return [
    ...(payload.profile ? ['customer_contact.write'] : []),
    ...(payload.facility_data ? ['customer_facility_data.write'] : []),
  ]
}

export async function POST(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, {
    anyOf: ['customer_contact.write', 'customer_billing.write', 'customer_facility_data.write'],
  })
  if (!context.ok) return context.response

  try {
    const payload = parseCustomerProfileUpdateRequest(await readJsonObject(request))
    const missingScopes = missingIntegrationApiScopes(context.client.scopes ?? [], requiredScopes(payload))
    if (missingScopes.length > 0) {
      throw new ApiInputError(`API-klienten saknar scope: ${missingScopes.join(', ')}.`, 'api_scope_missing', 403)
    }
    const legalField = payload.profile && Object.keys(payload.profile).find((field) =>
      ['first_name', 'last_name', 'full_name', 'company_name'].includes(field))
    if (legalField) {
      throw new ApiInputError(
        'Ändring av juridisk kundidentitet kräver en separat behörig och verifierad process.',
        'profile_field_not_supported', 422, `profile.${legalField}`,
      )
    }
    const idempotencyKey = requireIdempotencyKey(request)
    const subject = context.identity.customer_portal_user_id
    if (!subject) {
      throw new ApiInputError('Aktiv kundkoppling saknas.', 'customer_delegation_link_mismatch', 403)
    }
    if (payload.facility_data ||
        (payload.profile && ('language_code' in payload.profile || 'timezone' in payload.profile))) {
      const actor = { kind: 'api' as const, clientId: context.client.id, subject }
      const commandInput = { companyId: context.client.company_id, customerId: context.identity.customer_id,
        actor, idempotencyKey, payload }
      const result = payload.facility_data
        ? await changeCustomerFacilityProfile(commandInput)
        : await changeCustomerProfilePreferences(commandInput)
      await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt,
        resultCount: 1, metadata: { idempotency_replay: result.replayed },
      })
      return customerPortalJson(publicPortalProfileUpdateResult(result.body), { status: result.statusCode })
    }
    if (payload.profile && 'invoice_email' in payload.profile) {
      const billing = await changeCustomerBillingProfileFromApi({
        companyId: context.client.company_id, customerId: context.identity.customer_id,
        actor: { kind: 'api', clientId: context.client.id, subject },
        idempotencyKey, payload,
      })
      await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt,
        resultCount: 1, metadata: { idempotency_replay: billing.replayed },
      })
      return customerPortalJson(publicPortalProfileUpdateResult(billing.body), { status: billing.statusCode })
    }
    const contact = await changeCustomerContact({
      companyId: context.client.company_id, customerId: context.identity.customer_id,
      actor: { kind: 'api', clientId: context.client.id, subject },
      expectedRevision: payload.expected_contact_revision, idempotencyKey,
      changes: {
        ...(payload.profile && 'email' in payload.profile ? { email: payload.profile.email } : {}),
        ...(payload.profile && 'phone' in payload.profile ? { phone: payload.profile.phone } : {}),
      },
    })
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt,
      resultCount: 1, metadata: { idempotency_replay: contact.replayed },
    })
    if ('publicBody' in contact) {
      return customerPortalJson(publicPortalProfileUpdateResult(contact.publicBody), { status: contact.statusCode })
    }
    return customerPortalJson({ data: {
      completion_reference: contact.completionReference,
      status: 'accepted', created_at: contact.createdAt,
      profile_updated: contact.changed, contact_revision: contact.revision,
      facility_updated: false, address_result: null,
    } }, { status: 200 })
  } catch (error) {
    const handledError = error instanceof ContactCommandError || error instanceof BillingProfileCommandError || error instanceof PortalProfileResultError
      ? new ApiInputError('Kundändringen kunde inte sparas.', error.code, error.status)
      : error
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error: handledError })
  }
}
