import { NextRequest } from 'next/server'
import { ApiInputError, executeIdempotentPortalWrite, readJsonObject } from '@/lib/api/strictRequest'
import { supabaseService } from '@/lib/supabase/service'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function notificationIds(payload: Record<string, unknown>): string[] {
  const canonical = Array.isArray(payload.notification_ids)
    ? payload.notification_ids
    : []
  // Temporary compatibility aliases are accepted at runtime only. OpenAPI and
  // generated clients use notification_ids as the single canonical field.
  const legacyMany = Array.isArray(payload.ids) ? payload.ids : []
  const legacyOne = typeof payload.id === 'string' ? [payload.id] : []
  const ids = Array.from(new Set(
    [...canonical, ...legacyOne, ...legacyMany]
      .map((value) => String(value).trim())
      .filter(Boolean),
  ))
  if (ids.length === 0) {
    throw new ApiInputError(
      'notification_ids måste innehålla minst en notis.',
      'notification_ids_required',
      422,
      'notification_ids',
    )
  }
  if (ids.length > 100) {
    throw new ApiInputError(
      'Högst 100 notiser kan markeras per anrop.',
      'notification_ids_limit_exceeded',
      422,
      'notification_ids',
    )
  }
  const invalid = ids.find((id) => !UUID_PATTERN.test(id))
  if (invalid) {
    throw new ApiInputError(
      'notification_ids måste innehålla giltiga UUID-värden.',
      'notification_id_invalid',
      422,
      'notification_ids',
    )
  }
  return ids
}

export async function POST(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_notifications.write'])
  if (!context.ok) return context.response

  try {
    const payload = await readJsonObject(request) as Record<string, unknown>
    const ids = notificationIds(payload)
    const canonicalPayload = { notification_ids: ids }
    const result = await executeIdempotentPortalWrite<Record<string, unknown>>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: context.identity.customer_id,
      operation: '/api/v1/customer/notifications/read',
      payload: canonicalPayload,
      execute: async () => {
        const readAt = new Date().toISOString()
        const { data, error } = await supabaseService
          .from('customer_notifications')
          .update({ status: 'read', read_at: readAt, updated_at: readAt })
          .eq('company_id', context.client.company_id)
          .eq('customer_id', context.identity.customer_id)
          .in('id', ids)
          .select('id,status,read_at')
        if (error) throw error

        return {
          statusCode: 200,
          body: {
            data: {
              data: data ?? [],
              updated_count: data?.length ?? 0,
            },
          },
        }
      },
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
