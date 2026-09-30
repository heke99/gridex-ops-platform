import { NextRequest } from 'next/server'
import { ApiInputError, readJsonObject, requireIdempotencyKey } from '@/lib/api/strictRequest'
import { markCustomerNotificationsRead } from '@/lib/customer-portal/notificationCommands'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function notificationReferences(payload: Record<string, unknown>): string[] {
  if (Object.keys(payload).some((key) => key !== 'notification_references')) {
    throw new ApiInputError(
      'Förfrågan innehåller fält som inte tillhör notisläsning.',
      'notification_read_unknown_field',
      422,
    )
  }
  const references = Array.isArray(payload.notification_references)
    ? payload.notification_references
    : []
  if (references.length === 0) {
    throw new ApiInputError(
      'notification_references måste innehålla minst en notis.',
      'notification_references_required',
      422,
      'notification_references',
    )
  }
  if (references.length > 100) {
    throw new ApiInputError(
      'Högst 100 notiser kan markeras per anrop.',
      'notification_references_limit_exceeded',
      422,
      'notification_references',
    )
  }
  const invalid = references.some((reference) =>
    typeof reference !== 'string' ||
    !/^notification_[A-Za-z0-9_-]{32}$/.test(reference))
  if (invalid) {
    throw new ApiInputError(
      'notification_references måste innehålla giltiga publika notisreferenser.',
      'notification_reference_invalid',
      422,
      'notification_references',
    )
  }
  if (new Set(references).size !== references.length) {
    throw new ApiInputError(
      'notification_references får inte innehålla dubbla notiser.',
      'notification_reference_duplicate',
      422,
      'notification_references',
    )
  }
  return references
}

export async function POST(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_notifications.write'])
  if (!context.ok) return context.response

  try {
    const payload = await readJsonObject(request) as Record<string, unknown>
    const references = notificationReferences(payload)
    const subject = context.identity.customer_portal_user_id
    if (!subject) {
      throw new ApiInputError('Aktiv kundkoppling saknas.', 'customer_delegation_link_mismatch', 403)
    }
    const result = await markCustomerNotificationsRead({
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: context.identity.customer_id,
      subject,
      idempotencyKey: requireIdempotencyKey(request),
      notificationReferences: references,
    })

    await logCustomerPortalSuccess({
      request,
      client: context.client,
      startedAt: context.startedAt,
      resultCount: Number((result.body.data as { updated_count?: unknown } | undefined)?.updated_count ?? 0),
      metadata: { idempotency_replay: result.replayed },
    })
    return customerPortalJson(result.body, { status: result.statusCode })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
