import { supabaseService } from '@/lib/supabase/service'
import { resolveEnergyContext } from '@/lib/energy/resolver'
import { normalizeGridOwnerIdToOps } from '@/lib/grid-owners/platformGridOwnerResolver'
import {
  ensureLantmaterietExactAddressPoint,
  lantmaterietExactAddressConfigured,
} from '@/lib/energy/lantmaterietExactAddress'

type JsonRecord = Record<string, unknown>

const MIN_PAPILITE_GRID_OWNER_CONFIDENCE = 0.65

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function postal(value: unknown): string | null {
  const digits = clean(value)?.replace(/\D/g, '') ?? ''
  return /^\d{5}$/.test(digits) ? digits : null
}

function normalizedCity(value: unknown): string {
  return (clean(value) ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('sv-SE')
    .replace(/\s+/g, ' ')
    .trim()
}

function dueForExactAddressAttempt(result: JsonRecord) {
  const last = clean(result.last_exact_address_attempt_at)
  if (!last) return true
  const timestamp = Date.parse(last)
  if (!Number.isFinite(timestamp)) return true
  return Date.now() - timestamp >= 55 * 60 * 1000
}

function selectedOwnerConfidence(site: JsonRecord | null): number | null {
  const selection = record(record(site?.metadata).provisional_grid_owner_selection)
  const value = numberValue(selection.confidence)
  if (value === null) return null
  return Math.max(0, Math.min(1, value))
}

async function loadSite(input: { companyId: string; customerId: string; siteId: string }) {
  const { data, error } = await supabaseService
    .from('customer_sites')
    .select('id,company_id,customer_id,street,postal_code,city,country,grid_owner_id,selected_grid_owner_id,grid_area_code,price_area_code,address_hash,resolution_status,metadata')
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

async function wakeForProvisionalGridOwner(input: {
  jobId: string
  previousResult: JsonRecord
  gridOwnerId: string
  confidence: number | null
  source: string
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
        automation_state: 'provisional_grid_owner_selected',
        grid_owner_resolution_mode: 'provisional_facility_lookup_only',
        provisional_grid_owner_id: input.gridOwnerId,
        provisional_grid_owner_source: input.source,
        provisional_grid_owner_confidence: input.confidence,
        exact_address_status: 'not_required_papilite_confident',
        last_exact_address_attempt_at: now,
      },
      updated_at: now,
    })
    .eq('id', input.jobId)
    .eq('status', 'queued')
  if (error) throw error
}

type PapiliteProvisionalResult = {
  status:
    | 'selected'
    | 'cache_missing'
    | 'cache_invalid'
    | 'city_mismatch'
    | 'confidence_low'
    | 'polygon_no_match'
    | 'price_area_conflict'
    | 'grid_owner_unmapped'
  confidence: number | null
  gridOwnerId: string | null
  gridAreaCode: string | null
  priceArea: string | null
}

async function applyPapiliteProvisionalGridOwner(input: {
  companyId: string
  customerId: string
  siteId: string
  site: JsonRecord
}): Promise<PapiliteProvisionalResult> {
  const postCode = postal(input.site.postal_code)
  if (!postCode) {
    return { status: 'cache_invalid', confidence: null, gridOwnerId: null, gridAreaCode: null, priceArea: null }
  }

  const now = new Date().toISOString()
  const cache = await supabaseService
    .from('platform_address_lookup_cache')
    .select('latitude,longitude,confidence,postal_code,city,provider,raw_payload,expires_at,updated_at')
    .eq('postal_code', postCode)
    .eq('provider', 'papilite_postal_centroid')
    .gt('expires_at', now)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (cache.error) throw cache.error
  if (!cache.data) {
    return { status: 'cache_missing', confidence: null, gridOwnerId: null, gridAreaCode: null, priceArea: null }
  }

  const cached = cache.data as JsonRecord
  const raw = record(cached.raw_payload)
  const latitude = numberValue(cached.latitude)
  const longitude = numberValue(cached.longitude)
  const cacheConfidence = numberValue(cached.confidence)
  if (
    raw.coordinate_scope !== 'postal_centroid' ||
    raw.provider !== 'papilite' ||
    latitude === null ||
    longitude === null ||
    cacheConfidence === null
  ) {
    return { status: 'cache_invalid', confidence: cacheConfidence, gridOwnerId: null, gridAreaCode: null, priceArea: null }
  }

  const siteCity = normalizedCity(input.site.city)
  const cacheCity = normalizedCity(cached.city)
  if (siteCity && cacheCity && siteCity !== cacheCity) {
    return { status: 'city_mismatch', confidence: cacheConfidence, gridOwnerId: null, gridAreaCode: null, priceArea: null }
  }

  const polygon = await supabaseService.rpc('gridex_lonlat_to_grid_area', {
    p_longitude: longitude,
    p_latitude: latitude,
  })
  if (polygon.error) throw polygon.error
  const row = Array.isArray(polygon.data) ? polygon.data[0] : polygon.data
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return { status: 'polygon_no_match', confidence: cacheConfidence, gridOwnerId: null, gridAreaCode: null, priceArea: null }
  }

  const polygonRow = row as JsonRecord
  const polygonConfidence = numberValue(polygonRow.confidence)
  const confidence = Math.max(0, Math.min(1, Math.min(cacheConfidence, polygonConfidence ?? cacheConfidence)))
  const gridAreaCode = clean(polygonRow.grid_area_code)
  const priceArea = clean(polygonRow.price_area)?.toUpperCase() ?? null
  const currentPriceArea = clean(input.site.price_area_code)?.toUpperCase() ?? null
  if (currentPriceArea && priceArea && currentPriceArea !== priceArea) {
    return { status: 'price_area_conflict', confidence, gridOwnerId: null, gridAreaCode, priceArea }
  }
  if (confidence <= MIN_PAPILITE_GRID_OWNER_CONFIDENCE) {
    return { status: 'confidence_low', confidence, gridOwnerId: null, gridAreaCode, priceArea }
  }

  const normalizedOwner = await normalizeGridOwnerIdToOps({
    gridOwnerId: clean(polygonRow.grid_owner_id),
    companyId: input.companyId,
  })
  if (!normalizedOwner.opsGridOwnerId) {
    return { status: 'grid_owner_unmapped', confidence, gridOwnerId: null, gridAreaCode, priceArea }
  }

  const metadata = record(input.site.metadata)
  const selectedAt = new Date().toISOString()
  const update = await supabaseService
    .from('customer_sites')
    .update({
      selected_grid_owner_id: normalizedOwner.opsGridOwnerId,
      metadata: {
        ...metadata,
        provisional_grid_owner_selection: {
          source: 'papilite_postal_centroid_svk_polygon',
          canonical: false,
          postal_code: postCode,
          city: clean(input.site.city),
          grid_area_code_candidate: gridAreaCode,
          grid_owner_id: normalizedOwner.opsGridOwnerId,
          grid_owner_name: clean(polygonRow.grid_owner_name),
          price_area: priceArea,
          confidence,
          confidence_threshold: MIN_PAPILITE_GRID_OWNER_CONFIDENCE,
          selected_at: selectedAt,
          purpose: 'facility_information_routing',
        },
      },
      updated_at: selectedAt,
    })
    .eq('id', input.siteId)
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .is('grid_owner_id', null)
    .select('id,selected_grid_owner_id')
  if (update.error) throw update.error
  if (!update.data?.length) {
    const refreshed = await loadSite({ companyId: input.companyId, customerId: input.customerId, siteId: input.siteId })
    const canonical = clean(refreshed?.grid_owner_id)
    const provisional = clean(refreshed?.selected_grid_owner_id)
    if (canonical || provisional === normalizedOwner.opsGridOwnerId) {
      return {
        status: 'selected',
        confidence,
        gridOwnerId: canonical ?? provisional,
        gridAreaCode,
        priceArea,
      }
    }
    return { status: 'grid_owner_unmapped', confidence, gridOwnerId: null, gridAreaCode, priceArea }
  }

  return {
    status: 'selected',
    confidence,
    gridOwnerId: normalizedOwner.opsGridOwnerId,
    gridAreaCode,
    priceArea,
  }
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
    .in('status', ['draft', 'ready_to_send', 'ready_to_send_manual_email', 'needs_review', 'blocked_missing_poa', 'blocked_missing_grid_owner_contact', 'blocked_missing_manual_mailbox'])
    .order('created_at', { ascending: false })
  if (error) throw error

  const requestRows = (requests ?? []) as JsonRecord[]
  const requestIds = requestRows
    .map((request) => clean(request.id))
    .filter((value): value is string => Boolean(value))
  if (requestIds.length === 0) return

  // Scope delivery evidence to THIS site's request ids. Never scan another
  // tenant's outbox merely to reconcile one site's provisional request.
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
      // A competing canonical request may already exist. Do not make exact
      // resolution fail because an old provisional, never-sent row cannot be
      // rebound; the downstream idempotent orchestrator will reuse/create the
      // canonical request safely.
      console.warn('[pending-exact-address] provisional request reconciliation skipped', {
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
    papiliteSelected: 0,
    papiliteInsufficient: 0,
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

    try {
      const site = await loadSite({ companyId, customerId, siteId })
      if (!site || clean(site.grid_owner_id)) {
        await recordAttempt(jobId, previousResult, {
          exact_address_status: clean(site?.grid_owner_id) ? 'already_canonical' : 'site_missing',
        })
        continue
      }

      const alreadySelected = clean(site.selected_grid_owner_id)
      const existingConfidence = selectedOwnerConfidence(site)
      if (
        alreadySelected &&
        (existingConfidence === null || existingConfidence > MIN_PAPILITE_GRID_OWNER_CONFIDENCE)
      ) {
        await wakeForProvisionalGridOwner({
          jobId,
          previousResult,
          gridOwnerId: alreadySelected,
          confidence: existingConfidence,
          source: clean(record(record(site.metadata).provisional_grid_owner_selection).source) ?? 'existing_selected_grid_owner',
        })
        summary.woken += 1
        continue
      }

      // Papilite is always the first provider for the continuation path. The
      // postcode centroid is allowed to select only a provisional grid owner
      // for facility-information routing. It never materializes canonical
      // grid_owner_id/grid_area_code and can never authorize supplier switch.
      const papilite = await applyPapiliteProvisionalGridOwner({ companyId, customerId, siteId, site })
      if (papilite.status === 'selected' && papilite.gridOwnerId) {
        await wakeForProvisionalGridOwner({
          jobId,
          previousResult,
          gridOwnerId: papilite.gridOwnerId,
          confidence: papilite.confidence,
          source: 'papilite_postal_centroid_svk_polygon',
        })
        summary.papiliteSelected += 1
        summary.woken += 1
        continue
      }

      summary.papiliteInsufficient += 1
      if (!lantmaterietConfigured) {
        await recordAttempt(jobId, previousResult, {
          exact_address_status: 'papilite_insufficient_lantmateriet_not_configured',
          papilite_resolution_status: papilite.status,
          papilite_grid_owner_confidence: papilite.confidence,
          papilite_confidence_threshold: MIN_PAPILITE_GRID_OWNER_CONFIDENCE,
        })
        continue
      }

      // Lantmäteriet is a precision fallback only after Papilite is missing,
      // conflicting, unmappable, or at/below the 65% grid-owner threshold.
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
          papilite_resolution_status: papilite.status,
          papilite_grid_owner_confidence: papilite.confidence,
        })
        continue
      }

      const resolved = await resolveEnergyContext({
        companyId,
        customerId,
        customerSiteId: siteId,
        customerApplicationId: clean(record(job.payload).application_id),
        street: clean(site.street),
        postalCode: clean(site.postal_code),
        city: clean(site.city),
        country: clean(site.country) ?? 'SE',
      })

      const refreshed = await loadSite({ companyId, customerId, siteId })
      const canonicalGridOwnerId = clean(refreshed?.grid_owner_id)
      const fullyCanonical = Boolean(
        canonicalGridOwnerId
        && clean(refreshed?.grid_area_code)
        && resolved.gridOwnerVerificationStatus === 'verified',
      )

      if (!fullyCanonical) {
        await recordAttempt(jobId, previousResult, {
          exact_address_status: 'point_resolved_but_grid_owner_not_ready',
          exact_address_resolution_id: resolved.resolutionId ?? null,
          grid_owner_verification_status: resolved.gridOwnerVerificationStatus ?? null,
          grid_owner_verification_issues: resolved.gridOwnerVerificationIssues ?? [],
        })
        continue
      }

      summary.canonicalized += 1
      await reconcileUnsentFacilityRequest({
        companyId,
        siteId,
        gridOwnerId: canonicalGridOwnerId as string,
        gridAreaCode: clean(refreshed?.grid_area_code),
        priceArea: clean(refreshed?.price_area_code),
      })

      const now = new Date().toISOString()
      const { error: wakeError } = await supabaseService
        .from('customer_operation_jobs')
        .update({
          run_after: now,
          result: {
            ...previousResult,
            dependency_wait: false,
            dependency_code: null,
            automation_state: 'dependency_resolved',
            exact_address_status: 'canonical_grid_owner_resolved',
            exact_address_resolution_id: resolved.resolutionId ?? null,
            last_exact_address_attempt_at: now,
          },
          updated_at: now,
        })
        .eq('id', jobId)
        .eq('status', 'queued')
      if (wakeError) throw wakeError
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
