import { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { isMissingSchemaError } from '@/lib/customer-portal/apiData'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function idsFromPayload(payload: Record<string, unknown>): string[] {
  const many = Array.isArray(payload.ids) ? payload.ids : []
  const one = typeof payload.id === 'string' ? [payload.id] : []
  return Array.from(new Set([...one, ...many].map((value) => String(value).trim()).filter(Boolean)))
}

export async function POST(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_portal.write'])
  if (!context.ok) return context.response

  try {
    const payload = await request.json().catch(() => ({})) as Record<string, unknown>
    const ids = idsFromPayload(payload)
    if (ids.length === 0) return customerPortalJson({ error: 'notification id saknas.', code: 'notification_id_missing' }, { status: 422 })

    const { data, error } = await supabaseService
      .from('customer_notifications')
      .update({ status: 'read', read_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('company_id', context.client.company_id)
      .eq('customer_id', context.identity.customer_id)
      .in('id', ids)
      .select('id,status,read_at')

    if (error) {
      if (isMissingSchemaError(error)) {
        await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 0 })
        return customerPortalJson({ data: [] })
      }
      throw error
    }

    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: data?.length ?? 0 })
    return customerPortalJson({ data: data ?? [] })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
