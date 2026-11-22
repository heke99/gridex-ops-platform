import { withApiContractRepresentation } from '@/lib/integrations/apiResponseProfile'
import { NextRequest } from 'next/server'
import { ApiInputError, executeIdempotentPortalWrite, readJsonObject } from '@/lib/api/strictRequest'
import { supabaseService } from '@/lib/supabase/service'
import { isPublicReference } from '@/lib/integrations/publicReferences'
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
  const { data, error } = await supabaseService.rpc('gridex_resolve_customer_notification_references_v1', {
    p_company_id: input.companyId,
    p_customer_id: input.customerId,
    p_references: input.references,
  })
  if (error) throw error
  const resolved = new Map<string, string>()
  for (const row of data ?? []) {
    if (resolved.has(row.notification_reference)) throw new Error('Ambiguous customer notification reference.')
    resolved.set(row.notification_reference, row.id)
  }
  return resolved
}

 async function profiledPOST(request: NextRequest) {
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
        const ids = [...resolved.values()]
        const now = new Date().toISOString()
        const { data, error } = await supabaseService
          .from('customer_notifications')
          .update({ status: 'read', read_at: now, updated_at: now })
          .eq('company_id', context.client.company_id)
          .eq('customer_id', context.identity.customer_id)
          .in('id', ids)
          .is('read_at', null)
          .select('id,read_at')
        if (error) throw error

        const updated = data ?? []
        const updatedIds = new Set(updated.map(row => row.id))
        const untouchedIds = ids.filter(id => !updatedIds.has(id))
        const persisted = [...updated]
        if (untouchedIds.length) {
          const { data: existing, error: readError } = await supabaseService
            .from('customer_notifications')
            .select('id,read_at')
            .eq('company_id', context.client.company_id)
            .eq('customer_id', context.identity.customer_id)
            .in('id', untouchedIds)
          if (readError) throw readError
          persisted.push(...(existing ?? []))
        }
        const times = persisted.map(row => Date.parse(row.read_at ?? ''))
        if (times.length !== ids.length || times.some(time => !Number.isFinite(time))) {
          throw new Error('Unable to confirm persisted notification read state.')
        }
        // The legacy scalar represents the latest persisted read time in a batch.
        const readAt = new Date(Math.max(...times)).toISOString()

        return {
          statusCode: 200,
          body: {
            data: {
              updated_count: updated.length,
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

export const POST = withApiContractRepresentation('customer', profiledPOST)
