import { NextRequest } from 'next/server'
import {
  ApiInputError,
  executeIdempotentPortalWrite,
  readJsonObject,
  requireIdempotencyKey,
  requireIsoDate,
} from '@/lib/api/strictRequest'
import { supabaseService } from '@/lib/supabase/service'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'

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
    const allowedFields = new Set([
      'email',
      'customer_number',
      'external_customer_id',
      'customer_contract_reference',
      'facility_reference',
      'requested_move_out_date',
      'reason',
      'new_address',
      'contact_details',
      'metadata',
    ])
    const unknownFields = Object.keys(payload).filter(
      (field) => !allowedFields.has(field),
    )
    if (unknownFields.length > 0) {
      throw new ApiInputError(
        'Flyttanmälan innehåller fält som inte ingår i API-kontraktet.',
        'unknown_field',
        400,
        unknownFields[0],
      )
    }
    const idempotencyKey = requireIdempotencyKey(request)
    const facilityReference = clean(payload.facility_reference)
    if (!facilityReference) {
      throw new ApiInputError(
        'facility_reference krävs.',
        'facility_reference_required',
        422,
        'facility_reference',
      )
    }
    const moveOutDate = requireIsoDate(
      payload.requested_move_out_date,
      'requested_move_out_date',
    )
    const newAddress = record(payload.new_address)
    const contactDetails = record(payload.contact_details)
    const metadata = record(payload.metadata)
    const result = await executeIdempotentPortalWrite<Record<string, unknown>>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: context.identity.customer_id,
      operation: '/api/v1/customer/move-out',
      payload,
      execute: async () => {
        const { data, error } = await supabaseService
          .rpc('gridex_submit_customer_move_out_v1', {
            p_command: {
              company_id: context.client.company_id,
              customer_id: context.identity.customer_id,
              api_client_id: context.client.id,
              idempotency_key: idempotencyKey,
              facility_reference: facilityReference,
              customer_contract_reference:
                clean(payload.customer_contract_reference),
              requested_move_out_date: moveOutDate,
              reason: clean(payload.reason),
              new_address: newAddress,
              contact_details: contactDetails,
              metadata,
            },
          })
        if (error) throw error
        const response =
          data && typeof data === 'object' && !Array.isArray(data)
            ? (data as Record<string, unknown>)
            : {}
        return {
          statusCode: response.replayed === true ? 200 : 201,
          body: { data: response },
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
