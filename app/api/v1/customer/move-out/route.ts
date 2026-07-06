import { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { createPortalCompletionCase } from '@/lib/customer-portal/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type JsonRecord = Record<string, unknown>

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

export async function POST(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_portal.write'])
  if (!context.ok) return context.response

  try {
    const payload = record(await request.json().catch(() => ({})))
    const siteId = clean(payload.site_id) ?? clean(payload.customer_site_id)
    const moveOutDate = clean(payload.move_out_date) ?? clean(payload.moveOutDate) ?? new Date().toISOString().slice(0, 10)

    if (siteId) {
      const update = await supabaseService
        .from('customer_sites')
        .update({
          move_out_date: moveOutDate,
          status: 'pending_move',
          resolution_status: 'address_change_pending',
          updated_at: new Date().toISOString(),
        })
        .eq('company_id', context.client.company_id)
        .eq('customer_id', context.identity.customer_id)
        .eq('id', siteId)
      if (update.error) throw update.error
    }

    const { data, error } = await supabaseService
      .from('customer_portal_completions')
      .insert({
        company_id: context.client.company_id,
        customer_id: context.identity.customer_id,
        site_id: siteId,
        completion_type: 'move_out',
        status: siteId ? 'accepted' : 'submitted',
        submitted_payload: payload,
        result_payload: siteId ? { customer_site_id: siteId, move_out_date: moveOutDate } : null,
      })
      .select('id,status,created_at')
      .single()

    if (error) throw error

    // Not auto-applied (no site id): create the ops case so the move-out
    // request reaches an operator instead of dying in the completions table.
    if (!siteId) {
      await createPortalCompletionCase({
        companyId: context.client.company_id,
        customerId: context.identity.customer_id,
        completionId: String(data.id),
        completionType: 'move_out',
        payload,
      }).catch(() => null)
    }

    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1, metadata: { completion_id: data.id, customer_site_id: siteId, move_out_date: moveOutDate } })
    return customerPortalJson({ data })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
