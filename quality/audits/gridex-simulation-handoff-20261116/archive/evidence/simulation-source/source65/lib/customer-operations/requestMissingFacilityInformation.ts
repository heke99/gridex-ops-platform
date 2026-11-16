import { supabaseService } from '@/lib/supabase/service'
import { requestMissingFacilityInformation as requestMissingFacilityInformationCore } from '@/lib/customer-operations/requestMissingFacilityInformationCore'

type RequestInput = Parameters<typeof requestMissingFacilityInformationCore>[0]
type RequestResult = Awaited<ReturnType<typeof requestMissingFacilityInformationCore>>
type JsonRecord = Record<string, unknown>

const CANONICAL_GEOGRAPHIC_STATUSES = new Set([
  'grid_area_master_validated',
  'facility_data_requested',
  'facility_data_received',
  'facility_verified',
])

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function blockForUnverifiedCanonicalGridOwner(input: RequestInput, message: string): Promise<RequestResult> {
  const now = new Date().toISOString()
  const latest = await supabaseService
    .from('grid_owner_information_requests')
    .select('id,case_reference,poa_id,metadata')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('customer_site_id', input.siteId)
    .in('request_type', ['facility_lookup', 'facility_identifier_lookup'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latest.error) throw latest.error

  const request = (latest.data as JsonRecord | null) ?? null
  const requestId = clean(request?.id)
  if (requestId) {
    const metadata = request?.metadata && typeof request.metadata === 'object' && !Array.isArray(request.metadata)
      ? request.metadata as JsonRecord
      : {}
    const blocked = await supabaseService
      .from('grid_owner_information_requests')
      .update({
        status: 'needs_review',
        dispatch_status: 'not_started',
        dispatch_error_code: 'grid_owner_verification_required',
        dispatch_error_message: message,
        last_error_code: 'grid_owner_verification_required',
        last_error_message: message,
        metadata: {
          ...metadata,
          grid_owner_verification_required_at: now,
          grid_owner_verification_required_source: 'request_missing_facility_information_guard',
        },
        updated_at: now,
        updated_by: clean(input.actorUserId),
      })
      .eq('company_id', input.companyId)
      .eq('id', requestId)
      .select('id')
    if (blocked.error) throw blocked.error
  }

  const siteUpdate = await supabaseService
    .from('customer_sites')
    .update({
      facility_data_status: 'needs_review',
      next_action: 'Verifiera nätägaren för exakt anläggning innan uppgifter begärs externt.',
      updated_at: now,
      updated_by: clean(input.actorUserId),
    })
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('id', input.siteId)
    .select('id')
  if (siteUpdate.error) throw siteUpdate.error
  if (!siteUpdate.data?.length) throw new Error('customer_site_not_found_or_wrong_tenant')

  return {
    status: 'needs_review',
    requestId,
    caseReference: clean(request?.case_reference),
    channel: 'manual_email',
    emailOutboxId: null,
    poaId: clean(request?.poa_id),
    nextAction: {
      code: 'grid_owner_verification_required',
      message,
    },
    blockers: [{ code: 'grid_owner_verification_required', message }],
  } as RequestResult
}

function hasCanonicalGeographicGridOwner(site: JsonRecord): boolean {
  const gridOwnerId = clean(site.grid_owner_id)
  const gridAreaCode = clean(site.grid_area_code)
  const resolutionStatus = clean(site.resolution_status)
  return Boolean(
    gridOwnerId
    && gridAreaCode
    && resolutionStatus
    && CANONICAL_GEOGRAPHIC_STATUSES.has(resolutionStatus),
  )
}

/**
 * Public facility-information orchestrator.
 *
 * Facility lookup is routed by the canonical geographical owner of the exact
 * customer site. `selected_grid_owner_id` is a review candidate only and is
 * never an external-send authority. Grid-owner Ediel/PRODAT/customer-flow
 * readiness is deliberately NOT part of this gate: those are transport and
 * supplier-switch concerns, not geographical ownership.
 *
 * Canonical geography requires customer_sites.grid_owner_id + grid_area_code
 * and a lifecycle state that can only exist after grid-area master validation
 * (or later facility-data states). The database outbox trigger enforces the
 * same facility-specific invariant again at queue/send time.
 */
export async function requestMissingFacilityInformation(input: RequestInput): Promise<RequestResult> {
  const siteResult = await supabaseService
    .from('customer_sites')
    .select('id,grid_owner_id,selected_grid_owner_id,grid_area_code,resolution_status,resolution_id')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('id', input.siteId)
    .maybeSingle()
  if (siteResult.error) throw siteResult.error
  if (!siteResult.data?.id) throw new Error('customer_site_not_found_or_wrong_tenant')

  const site = siteResult.data as JsonRecord
  if (!hasCanonicalGeographicGridOwner(site)) {
    return blockForUnverifiedCanonicalGridOwner(
      input,
      'Exakt geografisk nätägare är ännu inte kanoniskt verifierad för anläggningen. Verifiera nätområde/nätägare innan fullmakt eller kunduppgifter skickas externt.',
    )
  }

  return requestMissingFacilityInformationCore(input)
}
