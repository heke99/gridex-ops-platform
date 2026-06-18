import { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { applyCustomerSiteAddressCandidate } from '@/lib/customer-sites/addressIntake'
import { enqueueCustomerDataRequestAutomation } from '@/lib/customer-operations/automation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type JsonRecord = Record<string, unknown>

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function facilityAddressFromPayload(payload: JsonRecord): JsonRecord | null {
  const direct = record(payload.facility_address ?? payload.site)
  if (Object.keys(direct).length > 0) return direct
  const address = record(payload.address)
  const type = String(payload.address_type ?? payload.addressType ?? address.type ?? '').toLowerCase()
  return ['site', 'facility', 'installation', 'anlaggning'].includes(type) ? address : null
}

export async function POST(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_portal.write'])
  if (!context.ok) return context.response

  try {
    const payload = record(await request.json().catch(() => ({})))
    const siteId = clean(payload.customer_site_id) ?? clean(payload.site_id)
    const address = facilityAddressFromPayload(payload)
    let addressResult: unknown = null

    if (siteId && address) {
      const result = await applyCustomerSiteAddressCandidate({
        companyId: context.client.company_id,
        customerId: context.identity.customer_id,
        siteId,
        address: {
          street: address.street,
          postalCode: address.postal_code ?? address.postalCode,
          city: address.city,
          country: address.country ?? 'SE',
          careOf: address.care_of ?? address.careOf,
          apartmentNumber: address.apartment_number ?? address.apartmentNumber,
          source: 'customer_portal',
          sourceReference: clean(payload.external_request_id) ?? null,
          metadata: { payload_type: 'profile_update' },
        },
      })
      addressResult = result
      if (result.status === 'updated' || result.status === 'unchanged') {
        await enqueueCustomerDataRequestAutomation({
          companyId: context.client.company_id,
          customerId: context.identity.customer_id,
          siteId,
        })
      }
    }

    const { data, error } = await supabaseService
      .from('customer_portal_completions')
      .insert({
        company_id: context.client.company_id,
        customer_id: context.identity.customer_id,
        site_id: siteId,
        completion_type: 'profile_update',
        status: addressResult ? 'accepted' : 'submitted',
        submitted_payload: payload,
        result_payload: addressResult,
      })
      .select('id,status,created_at')
      .single()

    if (error) throw error
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: 1, metadata: { completion_id: data.id, address_result: addressResult } })
    return customerPortalJson({ data: { ...data, address_result: addressResult } })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
