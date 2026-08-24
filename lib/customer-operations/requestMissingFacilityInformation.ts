import { supabaseService } from '@/lib/supabase/service'
import { requestMissingFacilityInformation as requestMissingFacilityInformationCore } from '@/lib/customer-operations/requestMissingFacilityInformationCore'

type RequestInput = Parameters<typeof requestMissingFacilityInformationCore>[0]
type RequestResult = Awaited<ReturnType<typeof requestMissingFacilityInformationCore>>
type JsonRecord = Record<string, unknown>

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

async function hasSiteSpecificVerifiedGridOwner(input: {
  companyId: string
  customerId: string
  siteId: string
  resolutionId: string | null
  gridOwnerId: string
}): Promise<boolean> {
  if (!input.resolutionId) return false
  const resolution = await supabaseService
    .from('customer_site_resolution')
    .select('id,customer_id,customer_site_id,grid_owner_id,resolution_status,automation_allowed,source_claims')
    .eq('id', input.resolutionId)
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('customer_site_id', input.siteId)
    .maybeSingle()
  if (resolution.error) throw resolution.error
  const row = resolution.data as JsonRecord | null
  const claims = row?.source_claims && typeof row.source_claims === 'object' && !Array.isArray(row.source_claims)
    ? row.source_claims as JsonRecord
    : {}
  return Boolean(
    row?.id
    && clean(row.grid_owner_id) === input.gridOwnerId
    && clean(row.resolution_status) === 'grid_area_master_validated'
    && row.automation_allowed === true
    && claims.manual_grid_owner_confirmation === true,
  )
}

/**
 * Public facility-information orchestrator.
 *
 * selected_grid_owner_id is only a candidate for review. External communication
 * requires the exact site to carry a canonical grid_owner_id that points to a
 * customer-flow verified grid owner. A technical-only owner may be used only
 * when the exact customer/site resolution is grid_area_master_validated with
 * explicit manual_grid_owner_confirmation evidence and automation_allowed=true.
 * The database transport trigger enforces the same invariant again at queue time.
 */
export async function requestMissingFacilityInformation(input: RequestInput): Promise<RequestResult> {
  const siteResult = await supabaseService
    .from('customer_sites')
    .select('id,grid_owner_id,selected_grid_owner_id,resolution_status,resolution_id')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('id', input.siteId)
    .maybeSingle()
  if (siteResult.error) throw siteResult.error
  if (!siteResult.data?.id) throw new Error('customer_site_not_found_or_wrong_tenant')

  const canonicalGridOwnerId = clean(siteResult.data.grid_owner_id)
  if (!canonicalGridOwnerId) {
    return blockForUnverifiedCanonicalGridOwner(
      input,
      'Nätägaren är endast föreslagen för anläggningen. Verifiera exakt nätägare innan fullmakt eller kunduppgifter skickas externt.',
    )
  }

  const ownerResult = await supabaseService
    .from('grid_owners')
    .select('id,verified_for_customer_flow,technical_owner_only,verification_status')
    .eq('id', canonicalGridOwnerId)
    .maybeSingle()
  if (ownerResult.error) throw ownerResult.error
  const owner = ownerResult.data as JsonRecord | null
  const baseOwnerReady = Boolean(
    owner?.id
    && owner.verified_for_customer_flow === true
    && clean(owner.verification_status) === 'verified',
  )
  const siteSpecificVerified = baseOwnerReady && owner?.technical_owner_only === true
    ? await hasSiteSpecificVerifiedGridOwner({
        companyId: input.companyId,
        customerId: input.customerId,
        siteId: input.siteId,
        resolutionId: clean(siteResult.data.resolution_id),
        gridOwnerId: canonicalGridOwnerId,
      })
    : false
  const ownerReady = Boolean(
    baseOwnerReady
    && (owner?.technical_owner_only !== true || siteSpecificVerified),
  )
  if (!ownerReady) {
    return blockForUnverifiedCanonicalGridOwner(
      input,
      'Nätägaren är kopplad till anläggningen men är inte verifierad för kundflöde. Verifiera nätägaren innan fullmakt eller kunduppgifter skickas externt.',
    )
  }

  return requestMissingFacilityInformationCore(input)
}
