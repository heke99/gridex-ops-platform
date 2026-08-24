import { supabaseService } from '@/lib/supabase/service'
import { resolveEnergyContext } from '@/lib/energy/resolver'
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
    .select('id,company_id,customer_id,street,postal_code,city,country,grid_owner_id,grid_area_code,price_area_code,address_hash,resolution_status')
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
  const configured = lantmaterietExactAddressConfigured()
  if (!configured) {
    return {
      configured: false,
      scanned: 0,
      attempted: 0,
      exactPointsCached: 0,
      canonicalized: 0,
      woken: 0,
      noMatch: 0,
      ambiguous: 0,
      errors: 0,
    }
  }

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
    configured: true,
    scanned: jobs.length,
    attempted: 0,
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
