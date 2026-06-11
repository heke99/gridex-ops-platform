import { supabaseService } from '@/lib/supabase/service'
import type { GridOwnerInformationRequestInput, GridOwnerInformationRequestResult, PriceArea } from '@/lib/energy/types'
import { normaliseGridAreaCode } from '@/lib/energy/resolver'

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function normalisePriceArea(value: unknown): PriceArea | null {
  const area = clean(value)?.toUpperCase()
  return area === 'SE1' || area === 'SE2' || area === 'SE3' || area === 'SE4' ? area : null
}

async function findContactRoute(input: GridOwnerInformationRequestInput) {
  const gridAreaCode = normaliseGridAreaCode(input.gridAreaCode)
  const query = supabaseService
    .from('grid_owner_contact_routes')
    .select('*')
    .eq('status', 'active')
    .eq('request_type', input.requestType ?? 'facility_lookup')
    .or(`company_id.is.null,company_id.eq.${input.companyId}`)
    .order('priority', { ascending: true })
    .limit(25)

  const { data, error } = await query
  if (error) {
    if (missingSchema(error)) return null
    throw error
  }

  const rows = data ?? []
  return rows.find((row) => {
    const ownerMatches = !row.grid_owner_id || !input.gridOwnerId || row.grid_owner_id === input.gridOwnerId
    const areaMatches = !row.grid_area_code || !gridAreaCode || String(row.grid_area_code).toUpperCase() === gridAreaCode
    return ownerMatches && areaMatches
  }) ?? rows[0] ?? null
}

async function existingOpenRequest(input: GridOwnerInformationRequestInput) {
  if (!input.customerSiteId) return null
  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('customer_site_id', input.customerSiteId)
    .eq('request_type', input.requestType ?? 'facility_lookup')
    .in('status', ['draft', 'ready_to_send', 'sent', 'waiting_response', 'needs_review'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (missingSchema(error)) return null
    throw error
  }
  return data ?? null
}

export async function ensureGridOwnerInformationRequest(input: GridOwnerInformationRequestInput): Promise<GridOwnerInformationRequestResult> {
  const warnings: string[] = []
  const gridAreaCode = normaliseGridAreaCode(input.gridAreaCode)
  const priceArea = normalisePriceArea(input.priceArea)

  if (!input.companyId || (!gridAreaCode && !input.gridOwnerId)) {
    return {
      requestId: null,
      status: 'skipped',
      channel: null,
      nextStep: 'Nätområde eller nätägare saknas. Kör Energy Resolver eller granska ansökan manuellt först.',
      warnings: ['missing_grid_owner_context'],
    }
  }

  const existing = await existingOpenRequest(input)
  if (existing) {
    return {
      requestId: existing.id as string,
      status: existing.status,
      channel: existing.channel,
      routeId: existing.contact_route_id ?? null,
      nextStep: existing.status === 'waiting_response'
        ? 'Invänta svar från nätägaren och markera anläggningsuppgifter mottagna när svaret kommit.'
        : 'Granska och skicka/hantera befintlig nätägarbegäran.',
      warnings,
    }
  }

  const route = await findContactRoute(input)
  if (!route) warnings.push('grid_owner_contact_route_missing')

  const channel = (route?.channel ?? 'manual') as 'email' | 'ediel' | 'portal' | 'manual'
  const status = route && channel !== 'manual' ? 'ready_to_send' : 'draft'
  const now = new Date().toISOString()

  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .insert({
      company_id: input.companyId,
      customer_id: clean(input.customerId),
      customer_site_id: clean(input.customerSiteId),
      customer_application_id: clean(input.customerApplicationId),
      resolution_id: clean(input.resolutionId),
      grid_owner_id: clean(input.gridOwnerId),
      grid_area_code: gridAreaCode,
      price_area: priceArea,
      request_type: input.requestType ?? 'facility_lookup',
      status,
      channel,
      template_id: clean(route?.template_id) ?? 'facility_lookup.default',
      contact_route_id: clean(route?.id),
      requires_poa: route?.requires_poa ?? true,
      created_by: clean(input.createdBy),
      metadata: {
        created_from: 'energy_resolver',
        auto_send_allowed: Boolean(route?.auto_send_allowed),
        production_guard: 'switch_blocked_until_facility_verified',
      },
      updated_at: now,
    })
    .select('id,status,channel,contact_route_id')
    .single()

  if (error) {
    if (missingSchema(error)) {
      return {
        requestId: null,
        status: 'skipped',
        channel: null,
        nextStep: 'Kör migrationen för grid_owner_information_requests innan nätägarbegäran kan skapas.',
        warnings: [...warnings, 'grid_owner_information_requests_schema_missing'],
      }
    }
    throw error
  }

  if (input.resolutionId) {
    const resolutionResult = await supabaseService
      .from('customer_site_resolution')
      .update({ resolution_status: 'facility_data_requested', updated_at: now })
      .eq('id', input.resolutionId)
      .eq('company_id', input.companyId)
    if (resolutionResult.error && !missingSchema(resolutionResult.error)) throw resolutionResult.error
  }

  if (input.customerApplicationId) {
    const appResult = await supabaseService
      .from('website_customer_applications')
      .update({
        grid_owner_information_request_id: data.id,
        status: status === 'ready_to_send' ? 'information_request_ready' : 'needs_facility_data',
        updated_at: now,
      })
      .eq('id', input.customerApplicationId)
      .eq('company_id', input.companyId)
    if (appResult.error && !missingSchema(appResult.error)) throw appResult.error
  }

  return {
    requestId: data.id as string,
    status: data.status,
    channel: data.channel,
    routeId: data.contact_route_id ?? null,
    nextStep: status === 'ready_to_send'
      ? 'Granska begäran och skicka den till nätägaren. Leverantörsbyte är blockerat tills anläggningsuppgifter är mottagna.'
      : 'Komplettera kontaktväg eller hantera nätägarbegäran manuellt. Leverantörsbyte är blockerat tills anläggningsuppgifter är mottagna.',
    warnings,
  }
}

export async function markFacilityDataReceived(input: {
  companyId: string
  customerId?: string | null
  customerSiteId?: string | null
  customerApplicationId?: string | null
  requestId?: string | null
  facilityId?: string | null
  meteringPointId?: string | null
  receivedPayload?: Record<string, unknown>
  actorUserId?: string | null
}) {
  const now = new Date().toISOString()
  const facilityId = clean(input.facilityId)
  const meteringPointId = clean(input.meteringPointId)

  if (input.requestId) {
    const requestResult = await supabaseService
      .from('grid_owner_information_requests')
      .update({
        status: 'received',
        facility_id: facilityId,
        metering_point_id: meteringPointId,
        received_payload: input.receivedPayload ?? {},
        received_at: now,
        updated_at: now,
      })
      .eq('id', input.requestId)
      .eq('company_id', input.companyId)
    if (requestResult.error && !missingSchema(requestResult.error)) throw requestResult.error
  }

  if (input.customerSiteId) {
    const siteResult = await supabaseService
      .from('customer_sites')
      .update({
        facility_id: facilityId ?? undefined,
        facility_data_verified_at: now,
        updated_at: now,
      })
      .eq('id', input.customerSiteId)
      .eq('company_id', input.companyId)
    if (siteResult.error && !missingSchema(siteResult.error)) throw siteResult.error
  }

  if (input.customerSiteId && meteringPointId) {
    const meterResult = await supabaseService
      .from('metering_points')
      .update({ facility_data_verified_at: now, updated_at: now })
      .eq('company_id', input.companyId)
      .eq('customer_site_id', input.customerSiteId)
      .or(`metering_point_id.eq.${meteringPointId},ediel_metering_point_id.eq.${meteringPointId},meter_point_id.eq.${meteringPointId}`)
    if (meterResult.error && !missingSchema(meterResult.error)) throw meterResult.error
  }

  const resolutionResult = await supabaseService
    .from('customer_site_resolution')
    .update({ resolution_status: 'facility_verified', facility_data_verified_at: now, verified_by: clean(input.actorUserId), updated_at: now })
    .eq('company_id', input.companyId)
    .eq('customer_site_id', input.customerSiteId ?? '')
  if (resolutionResult.error && !missingSchema(resolutionResult.error)) throw resolutionResult.error

  if (input.customerApplicationId) {
    const appResult = await supabaseService
      .from('website_customer_applications')
      .update({ status: 'facility_data_received', facility_data_verified_at: now, updated_at: now })
      .eq('id', input.customerApplicationId)
      .eq('company_id', input.companyId)
    if (appResult.error && !missingSchema(appResult.error)) throw appResult.error
  }

  return {
    ok: true,
    status: 'facility_data_received' as const,
    nextStep: 'Kör readiness-kontroll. Om fullmakt, avtal, nätområde och startläge är klara kan leverantörsbyte startas.',
  }
}
