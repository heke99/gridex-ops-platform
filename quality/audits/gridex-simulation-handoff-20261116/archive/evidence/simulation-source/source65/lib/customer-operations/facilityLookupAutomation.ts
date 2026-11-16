import { requestMissingFacilityInformation } from '@/lib/customer-operations/requestMissingFacilityInformation'
import { supabaseService } from '@/lib/supabase/service'

export type FacilityLookupAutomationResult = {
  status:
    | 'not_needed'
    | 'ready_to_send'
    | 'waiting_response'
    | 'needs_review'
    | 'blocked'
    | 'skipped'
  requestId: string | null
  channel: string | null
  routeId: string | null
  outboundRequestId?: string | null
  edielMessageId?: string | null
  operationId?: string | null
  dispatchStatus?: string | null
  nextStep: string
  warnings: string[]
  blockers: Array<{ code: string; message: string; source?: string }>
}

type JsonRecord = Record<string, unknown>

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function readSite(input: { companyId: string; customerId: string; siteId: string }): Promise<JsonRecord | null> {
  const { data, error } = await supabaseService
    .from('customer_sites')
    .select('id,company_id,customer_id,grid_owner_id,grid_area_code,price_area_code,resolution_status,address_hash,metadata')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('id', input.siteId)
    .maybeSingle()
  if (error) throw error
  return (data as JsonRecord | null) ?? null
}

async function readCanonicalMeteringPoint(input: { companyId: string; customerId: string; siteId: string }): Promise<JsonRecord | null> {
  const { data, error } = await supabaseService
    .from('metering_points')
    .select('id,site_facility_id,metering_point_id,ediel_metering_point_id,status,archived_at,customer_site_id,site_id')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .or(`customer_site_id.eq.${input.siteId},site_id.eq.${input.siteId}`)
    .order('updated_at', { ascending: false })
    .limit(10)
  if (error) throw error
  const rows = (data ?? []) as JsonRecord[]
  return rows.find((row) => {
    const status = clean(row.status)?.toLowerCase() ?? ''
    const active = !row.archived_at && !['inactive', 'archived', 'closed'].includes(status)
    return Boolean(
      active &&
        clean(row.site_facility_id) &&
        (clean(row.metering_point_id) || clean(row.ediel_metering_point_id)),
    )
  }) ?? null
}

function mapStatus(status: string): FacilityLookupAutomationResult['status'] {
  if (status === 'manual_email_queued' || status === 'waiting_manual_response') return 'waiting_response'
  if (status === 'not_needed') return 'not_needed'
  if (status.startsWith('blocked_')) return 'blocked'
  return 'needs_review'
}

export async function ensureFacilityLookupAutomation(input: {
  companyId: string
  customerId: string
  siteId: string
  actorUserId?: string | null
  customerApplicationId?: string | null
  resolutionId?: string | null
  source?: string | null
  operationId?: string | null
}): Promise<FacilityLookupAutomationResult> {
  const site = await readSite(input)
  if (!site) {
    return {
      status: 'blocked',
      requestId: null,
      channel: null,
      routeId: null,
      operationId: input.operationId ?? null,
      nextStep: 'Anläggning saknas. Komplettera kundkortet innan nätägaruppgifter kan begäras.',
      warnings: [],
      blockers: [{ code: 'customer_site_missing', message: 'Anläggning saknas.', source: 'facility_lookup_automation' }],
    }
  }

  const meteringPoint = await readCanonicalMeteringPoint(input)
  if (meteringPoint) {
    return {
      status: 'not_needed',
      requestId: null,
      channel: null,
      routeId: null,
      operationId: input.operationId ?? null,
      nextStep: 'Verifierade anläggnings- och mätpunktsuppgifter finns. Fortsätt med leverantörsbyte.',
      warnings: [],
      blockers: [],
    }
  }

  // PRODAT Z01 requires anläggnings-id. The only valid channel for obtaining a
  // missing identifier is the controlled manual information request pipeline.
  // The former environment switch to Ediel is intentionally removed.
  const manual = await requestMissingFacilityInformation({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.siteId,
    actorUserId: input.actorUserId ?? null,
    source: input.source ?? 'facility_lookup_automation',
  })

  return {
    status: mapStatus(manual.status),
    requestId: manual.requestId,
    channel: manual.channel ?? 'manual_email',
    routeId: null,
    outboundRequestId: null,
    edielMessageId: null,
    operationId: input.operationId ?? null,
    dispatchStatus: manual.status,
    nextStep: manual.nextAction.message,
    warnings: [],
    blockers: manual.blockers.map((blocker) => ({ ...blocker, source: 'manual_information_orchestrator' })),
  }
}
