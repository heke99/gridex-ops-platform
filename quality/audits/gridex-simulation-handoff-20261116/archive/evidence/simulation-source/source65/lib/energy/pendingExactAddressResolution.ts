import { supabaseService } from '@/lib/supabase/service'
import { resolveEnergyContext } from '@/lib/energy/resolver'
import {
  DEFAULT_OPS_PAPILITE_GRID_OWNER_MIN_CONFIDENCE,
  resolveOpsPapiliteGridOwnerForSite,
} from '@/lib/energy/opsPrecisionGridOwnerResolution'
import {
  ensureLantmaterietExactAddressPoint,
  lantmaterietExactAddressConfigured,
} from '@/lib/energy/lantmaterietExactAddress'

type JsonRecord = Record<string, unknown>

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function dueForExactAddressAttempt(result: JsonRecord) {
  const last = clean(result.last_exact_address_attempt_at)
  if (!last) return true
  const timestamp = Date.parse(last)
  if (!Number.isFinite(timestamp)) return true
  return Date.now() - timestamp >= 55 * 60 * 1000
}

async function loadSite(input: { companyId: string; customerId: string; siteId: string }) {
  const { data, error } = await supabaseService
    .from('customer_sites')
    .select('id,company_id,customer_id,street,postal_code,city,country,grid_owner_id,selected_grid_owner_id,grid_area_code,price_area_code,address_hash,resolution_id,resolution_status,resolution_confidence,metadata')
    .eq('id', input.siteId)
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .maybeSingle()
  if (error) throw error
  return data as JsonRecord | null
}

async function recordAttempt(jobId: string, previous: JsonRecord, patch: JsonRecord) {
  const { error } = await supabaseService
    .from('customer_operation_jobs')
    .update({
      result: {
        ...previous,
        ...patch,
        last_exact_address_attempt_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('status', 'queued')
  if (error) throw error
}

async function wakeCanonicalGridOwner(input: {
  jobId: string
  previousResult: JsonRecord
  resolutionMode: 'canonical_papilite_svk' | 'canonical_svk_exact_point' | 'already_canonical'
  gridOwnerId: string
  gridAreaCode: string
  confidence?: number | null
  resolutionId?: string | null
  operationalVerificationStatus?: string | null
  operationalVerificationIssues?: string[]
}) {
  const now = new Date().toISOString()
  const { error } = await supabaseService
    .from('customer_operation_jobs')
    .update({
      run_after: now,
      result: {
        ...input.previousResult,
        dependency_wait: false,
        dependency_code: null,
        automation_state: 'dependency_resolved',
        grid_owner_resolution_mode: input.resolutionMode,
        canonical_grid_owner_id: input.gridOwnerId,
        canonical_grid_area_code: input.gridAreaCode,
        canonical_grid_owner_confidence: input.confidence ?? null,
        exact_address_status: input.resolutionMode === 'canonical_papilite_svk'
          ? 'not_required_papilite_high_confidence'
          : input.resolutionMode === 'already_canonical'
            ? 'already_canonical'
            : 'canonical_grid_owner_resolved',
        exact_address_resolution_id: input.resolutionId ?? null,
        grid_owner_operational_verification_status: input.operationalVerificationStatus ?? null,
        grid_owner_operational_verification_issues: input.operationalVerificationIssues ?? [],
        last_exact_address_attempt_at: now,
      },
      updated_at: now,
    })
    .eq('id', input.jobId)
    .eq('status', 'queued')
  if (error) throw error
}

async function reconcileUnsentFacilityRequest(input: {
  companyId: string
  siteId: string
  gridOwnerId: string
  gridAreaCode: string | null
  priceArea: string | null
}) {
  const { data: requests, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('id,status,grid_owner_id,dispatch_status')
    .eq('company_id', input.companyId)
    .eq('customer_site_id', input.siteId)
    .in('request_type', ['facility_lookup', 'facility_identifier_lookup'])
    .in('status', [
      'draft',
      'ready_to_send',
      'ready_to_send_manual_email',
      'needs_review',
      'blocked_missing_poa',
      'blocked_missing_grid_owner_contact',
      'blocked_missing_manual_mailbox',
    ])
    .order('created_at', { ascending: false })
  if (error) throw error

  const requestRows = (requests ?? []) as JsonRecord[]
  const requestIds = requestRows
    .map((request) => clean(request.id))
    .filter((value): value is string => Boolean(value))
  if (requestIds.length === 0) return

  const { data: outboxRows, error: outboxError } = await supabaseService
    .from('manual_email_outbox')
    .select('request_id')
    .in('request_id', requestIds)
    .eq('external_delivery', true)
    .in('status', ['queued', 'sending', 'sent', 'delivered'])
  if (outboxError) throw outboxError

  const sentRequestIds = new Set(
    (outboxRows ?? [])
      .map((row) => clean(row.request_id))
      .filter((value): value is string => Boolean(value)),
  )

  for (const request of requestRows) {
    const requestId = clean(request.id)
    if (!requestId || sentRequestIds.has(requestId)) continue
    const { error: updateError } = await supabaseService
      .from('grid_owner_information_requests')
      .update({
        grid_owner_id: input.gridOwnerId,
        grid_area_code: input.gridAreaCode,
        price_area: input.priceArea,
        status: 'draft',
        dispatch_status: 'not_started',
        dispatch_error_code: null,
        dispatch_error_message: null,
        last_error_code: null,
        last_error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .eq('company_id', input.companyId)
    if (updateError) {
      console.warn('[pending-exact-address] unsent request reconciliation skipped', {
        requestId,
        code: updateError.code ?? null,
      })
    }
  }
}

export async function processPendingExactAddressResolutions(input: { limit?: number } = {}) {
  const lantmaterietConfigured = lantmaterietExactAddressConfigured()
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 5), 1), 10)
  const { data, error } = await supabaseService
    .from('customer_operation_jobs')
    .select('id,company_id,customer_id,customer_site_id,status,result,payload,run_after')
    .eq('job_type', 'customer_application_continuation')
    .eq('status', 'queued')
    .order('run_after', { ascending: true })
    .limit(Math.max(limit * 4, 20))
  if (error) throw error

  const jobs = ((data ?? []) as JsonRecord[])
    .filter((job) => {
      const result = record(job.result)
      return clean(result.dependency_code) === 'grid_owner_resolution'
        && Boolean(clean(job.customer_site_id))
        && dueForExactAddressAttempt(result)
    })
    .slice(0, limit)

  const summary = {
    configured: lantmaterietConfigured,
    scanned: jobs.length,
    attempted: 0,
    papiliteVerified: 0,
    papiliteFallback: 0,
    // Kept for response compatibility while the old postcode-polygon path is retired.
    svkPostalVerified: 0,
    svkPostalInsufficient: 0,
    exactPointsCached: 0,
    canonicalized: 0,
    woken: 0,
    noMatch: 0,
    ambiguous: 0,
    errors: 0,
  }

  for (const job of jobs) {
    const jobId = clean(job.id)
    const companyId = clean(job.company_id)
    const customerId = clean(job.customer_id)
    const siteId = clean(job.customer_site_id)
    if (!jobId || !companyId || !customerId || !siteId) continue
    const previousResult = record(job.result)
    const applicationId = clean(record(job.payload).application_id)

    try {
      let site = await loadSite({ companyId, customerId, siteId })
      if (!site) {
        await recordAttempt(jobId, previousResult, { exact_address_status: 'site_missing' })
        continue
      }

      const existingGridOwnerId = clean(site.grid_owner_id)
      const existingGridAreaCode = clean(site.grid_area_code)
      if (existingGridOwnerId && existingGridAreaCode) {
        await wakeCanonicalGridOwner({
          jobId,
          previousResult,
          resolutionMode: 'already_canonical',
          gridOwnerId: existingGridOwnerId,
          gridAreaCode: existingGridAreaCode,
          confidence: typeof site.resolution_confidence === 'number' ? site.resolution_confidence : null,
          resolutionId: clean(site.resolution_id),
        })
        summary.woken += 1
        continue
      }

      // OPS precision pass #1: Papilite supplies a postcode centroid, but SVK
      // geometry/masterdata remains the authority for grid area and grid owner.
      // The spatial RPC only reaches the default 0.95 confidence when the point
      // is >=1.5 km inside one unique active SVK grid area. Otherwise we fail
      // closed and use the exact GeoTorget/Lantmateriet address point below.
      const papilite = await resolveOpsPapiliteGridOwnerForSite({
        companyId,
        customerId,
        siteId,
        customerApplicationId: applicationId,
        postalCode: clean(site.postal_code),
        city: clean(site.city),
        country: clean(site.country) ?? 'SE',
        currentPriceArea: clean(site.price_area_code),
        metadata: record(site.metadata),
      })

      let papiliteProjectionMissing = false
      if (papilite.status === 'verified' && papilite.gridOwnerId && papilite.gridAreaCode) {
        const refreshedSite = await loadSite({ companyId, customerId, siteId })
        if (!refreshedSite) {
          await recordAttempt(jobId, previousResult, {
            exact_address_status: 'site_missing',
            papilite_precision_status: papilite.status,
          })
          continue
        }
        site = refreshedSite
        const canonicalGridOwnerId = clean(site.grid_owner_id)
        const canonicalGridAreaCode = clean(site.grid_area_code)
        if (canonicalGridOwnerId && canonicalGridAreaCode) {
          await reconcileUnsentFacilityRequest({
            companyId,
            siteId,
            gridOwnerId: canonicalGridOwnerId,
            gridAreaCode: canonicalGridAreaCode,
            priceArea: clean(site.price_area_code) ?? papilite.priceArea,
          })
          await wakeCanonicalGridOwner({
            jobId,
            previousResult: {
              ...previousResult,
              papilite_precision_status: papilite.status,
              papilite_precision_confidence: papilite.confidence,
              papilite_precision_threshold: papilite.minConfidence,
              papilite_geodata_version: papilite.geodataVersion,
            },
            resolutionMode: 'canonical_papilite_svk',
            gridOwnerId: canonicalGridOwnerId,
            gridAreaCode: canonicalGridAreaCode,
            confidence: papilite.confidence,
            resolutionId: papilite.resolutionId,
          })
          summary.papiliteVerified += 1
          summary.canonicalized += 1
          summary.woken += 1
          continue
        }
        // Fail closed: never wake continuation on an unbound Papilite claim.
        papiliteProjectionMissing = true
      }

      summary.papiliteFallback += 1
      summary.svkPostalInsufficient += 1

      if (!lantmaterietConfigured) {
        const exactAddressStatus = papiliteProjectionMissing
          ? 'papilite_verified_but_site_projection_missing'
          : 'papilite_precision_insufficient_lantmateriet_not_configured'
        await recordAttempt(jobId, previousResult, {
          exact_address_status: exactAddressStatus,
          papilite_precision_status: papilite.status,
          papilite_precision_confidence: papilite.confidence,
          papilite_precision_threshold: papilite.minConfidence ?? DEFAULT_OPS_PAPILITE_GRID_OWNER_MIN_CONFIDENCE,
          papilite_geodata_version: papilite.geodataVersion,
          papilite_resolution_id: papilite.resolutionId,
        })
        continue
      }

      // OPS precision pass #2: GeoTorget/Lantmateriet supplies an exact address
      // point only when Papilite/SVK did not reach canonical confidence. The
      // exact point is then mapped through the same SVK geometry/masterdata;
      // Lantmateriet never becomes the grid-owner authority.
      summary.attempted += 1
      const exact = await ensureLantmaterietExactAddressPoint({
        street: clean(site.street),
        postalCode: clean(site.postal_code),
        city: clean(site.city),
        country: clean(site.country) ?? 'SE',
      })

      if (exact.status === 'no_match') summary.noMatch += 1
      if (exact.status === 'ambiguous') summary.ambiguous += 1
      if (exact.status === 'cached') summary.exactPointsCached += 1

      if (exact.status !== 'cached') {
        await recordAttempt(jobId, previousResult, {
          exact_address_status: exact.status,
          exact_address_candidate_count: exact.candidateCount,
          papilite_precision_status: papilite.status,
          papilite_precision_confidence: papilite.confidence,
          papilite_precision_threshold: papilite.minConfidence,
          papilite_verified_but_site_projection_missing: papiliteProjectionMissing,
        })
        continue
      }

      const resolved = await resolveEnergyContext({
        companyId,
        customerId,
        customerSiteId: siteId,
        customerApplicationId: applicationId,
        street: clean(site.street),
        postalCode: clean(site.postal_code),
        city: clean(site.city),
        country: clean(site.country) ?? 'SE',
      })

      const refreshed = await loadSite({ companyId, customerId, siteId })
      const canonicalGridOwnerId = clean(refreshed?.grid_owner_id)
      const canonicalGridAreaCode = clean(refreshed?.grid_area_code)
      const canonicalPriceArea = clean(refreshed?.price_area_code)
      if (!canonicalGridOwnerId || !canonicalGridAreaCode) {
        await recordAttempt(jobId, previousResult, {
          exact_address_status: 'point_resolved_but_grid_owner_not_ready',
          exact_address_resolution_id: resolved.resolutionId ?? null,
          grid_owner_operational_verification_status: resolved.gridOwnerVerificationStatus ?? null,
          grid_owner_operational_verification_issues: resolved.gridOwnerVerificationIssues ?? [],
          papilite_precision_status: papilite.status,
          papilite_precision_confidence: papilite.confidence,
        })
        continue
      }

      await reconcileUnsentFacilityRequest({
        companyId,
        siteId,
        gridOwnerId: canonicalGridOwnerId,
        gridAreaCode: canonicalGridAreaCode,
        priceArea: canonicalPriceArea,
      })
      await wakeCanonicalGridOwner({
        jobId,
        previousResult: {
          ...previousResult,
          papilite_precision_status: papilite.status,
          papilite_precision_confidence: papilite.confidence,
          papilite_precision_threshold: papilite.minConfidence,
        },
        resolutionMode: 'canonical_svk_exact_point',
        gridOwnerId: canonicalGridOwnerId,
        gridAreaCode: canonicalGridAreaCode,
        confidence: resolved.confidence,
        resolutionId: resolved.resolutionId ?? null,
        operationalVerificationStatus: resolved.gridOwnerVerificationStatus ?? null,
        operationalVerificationIssues: resolved.gridOwnerVerificationIssues ?? [],
      })
      summary.canonicalized += 1
      summary.woken += 1
    } catch (jobError) {
      summary.errors += 1
      console.error('[pending-exact-address] job failed', {
        jobId,
        error: jobError instanceof Error ? jobError.message : String(jobError),
      })
      await recordAttempt(jobId, previousResult, {
        exact_address_status: 'technical_error',
      }).catch(() => undefined)
    }
  }

  return summary
}
