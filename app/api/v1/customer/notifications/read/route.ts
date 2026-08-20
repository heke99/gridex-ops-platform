import { NextRequest } from 'next/server'
import { ApiInputError, executeIdempotentPortalWrite, readJsonObject } from '@/lib/api/strictRequest'
import { supabaseService } from '@/lib/supabase/service'
import { isPublicReference, publicReference } from '@/lib/integrations/publicReferences'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function notificationReferences(payload: Record<string, unknown>): string[] {
  const canonical = Array.isArray(payload.notification_references)
    ? payload.notification_references
    : []
  const references = Array.from(new Set(
    canonical
      .map((value) => String(value).trim())
      .filter(Boolean),
  ))
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
  const invalid = references.find((reference) => !isPublicReference(reference) || !reference.startsWith('notification_'))
  if (invalid) {
    throw new ApiInputError(
      'notification_references måste innehålla giltiga publika notisreferenser.',
      'notification_reference_invalid',
      422,
      'notification_references',
    )
  }
  return references
}

async function resolveNotificationIds(input: {
  companyId: string
  customerId: string
  references: string[]
}): Promise<Map<string, string>> {
  const resolved = new Map<string, string>()
  const pageSize = 1_000
  // query-loop-budget: paginated-scan page=1000
  // Public references are one-way hashes, so resolution walks disjoint pages;
  // this is not a repeated child query for one parent collection.
  for (let from = 0; resolved.size < input.references.length; from += pageSize) {
    const { data, error } = await supabaseService
      .from('customer_notifications')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw error
    const rows = data ?? []
    for (const row of rows) {
      const reference = publicReference('notification', input.companyId, row.id)
      if (reference && input.references.includes(reference)) resolved.set(reference, String(row.id))
    }
    if (rows.length < pageSize) break
  }
  return resolved
}

export async function POST(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_notifications.write'])
  if (!context.ok) return context.response

  try {
    const payload = await readJsonObject(request) as Record<string, unknown>
    const references = notificationReferences(payload)
    const canonicalPayload = { notification_references: references }
    const result = await executeIdempotentPortalWrite<Record<string, unknown>>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: context.identity.customer_id,
      operation: '/api/v1/customer/notifications/read',
      payload: canonicalPayload,
      execute: async () => {
        const resolved = await resolveNotificationIds({
          companyId: context.client.company_id,
          customerId: context.identity.customer_id,
          references,
        })
        if (resolved.size !== references.length) {
          throw new ApiInputError(
            'En eller flera notisreferenser hittades inte för kunden.',
            'notification_reference_not_found',
            404,
            'notification_references',
          )
        }
        const readAt = new Date().toISOString()
        const { data, error } = await supabaseService
          .from('customer_notifications')
          .update({ status: 'read', read_at: readAt, updated_at: readAt })
          .eq('company_id', context.client.company_id)
          .eq('customer_id', context.identity.customer_id)
          .in('id', [...resolved.values()])
          .select('id')
        if (error) throw error

        return {
          statusCode: 200,
          body: {
            data: {
              updated_count: data?.length ?? 0,
              notification_references: references,
              read_at: readAt,
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
