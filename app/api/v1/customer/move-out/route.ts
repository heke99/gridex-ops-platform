import { NextRequest } from 'next/server'
import { executeIdempotentPortalWrite, readJsonObject, requireIsoDate } from '@/lib/api/strictRequest'
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
  const context = await requireCustomerPortalApiContext(request, ['customer_facility_data.write'])
  if (!context.ok) return context.response

  try {
    const payload = record(await readJsonObject(request))
    const result = await executeIdempotentPortalWrite<Record<string, unknown>>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: context.identity.customer_id,
      operation: '/api/v1/customer/move-out',
      payload,
      execute: async () => {
        const siteId = clean(payload.site_id) ?? clean(payload.customer_site_id)
        const moveOutDate = requireIsoDate(clean(payload.move_out_date) ?? clean(payload.moveOutDate), 'move_out_date')

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
            .select('id')
            .maybeSingle()
          if (update.error) throw update.error
          if (!update.data) {
            return { statusCode: 404, body: { error: 'Anläggningen hittades inte för kunden.', code: 'customer_site_not_found' } }
          }
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

        if (!siteId) {
          await createPortalCompletionCase({
            companyId: context.client.company_id,
            customerId: context.identity.customer_id,
            completionId: String(data.id),
            completionType: 'move_out',
            payload,
          })
        }

        return { statusCode: 200, body: { data } }
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
