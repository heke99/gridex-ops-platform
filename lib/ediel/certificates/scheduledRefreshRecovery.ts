import { supabaseService } from '@/lib/supabase/service'
import { refreshCertificatesForActor } from './actorCertificateRefresh'

const LEASE_MINUTES = 30
const DEFAULT_LIMIT = 50

type Candidate = {
  actorId: string
  gridOwnerId: string | null
  companyId: string | null
  edielId: string | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function missingSchema(error: unknown) {
  const row = error as { code?: string; message?: string } | null
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(row?.code ?? '')
    || /schema cache|does not exist|column .* does not exist/i.test(row?.message ?? '')
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  return String(error ?? 'Okänt certifikatrefresh-fel')
}

function leaseCutoffIso() {
  return new Date(Date.now() - LEASE_MINUTES * 60 * 1000).toISOString()
}

export async function reclaimStaleCertificateRefreshJobs() {
  const cutoff = leaseCutoffIso()
  const now = new Date().toISOString()
  const { data, error } = await supabaseService
    .from('ediel_certificate_refresh_jobs')
    .update({
      status: 'failed',
      finished_at: now,
      error_message: `Refresh-jobbet överskred ${LEASE_MINUTES} minuters lease och återtogs säkert av scheduler.`,
      updated_at: now,
    })
    .eq('status', 'running')
    .lt('started_at', cutoff)
    .select('id,platform_market_actor_id,grid_owner_id,ediel_id,started_at')

  if (error) {
    if (missingSchema(error)) return { reclaimed: 0, skipped: true, reason: 'schema_missing' }
    throw error
  }

  return { reclaimed: data?.length ?? 0, rows: data ?? [] }
}

async function listDueCandidates(limit: number): Promise<Candidate[]> {
  const scoped = await supabaseService
    .from('ediel_blocked_grid_owner_certificate_refresh_candidates_v')
    .select('platform_market_actor_id,grid_owner_id,company_id,ediel_id')
    .limit(limit * 4)

  let rows: Array<Record<string, unknown>> = []
  if (!scoped.error) {
    rows = (scoped.data ?? []) as Array<Record<string, unknown>>
  } else if (!missingSchema(scoped.error)) {
    throw scoped.error
  } else {
    const fallback = await supabaseService
      .from('ediel_certificate_refresh_candidates_v')
      .select('platform_market_actor_id,grid_owner_id,company_id,ediel_id')
      .limit(limit * 4)
    if (fallback.error) {
      if (missingSchema(fallback.error)) return []
      throw fallback.error
    }
    rows = (fallback.data ?? []) as Array<Record<string, unknown>>
  }

  const deduped = new Map<string, Candidate>()
  for (const row of rows) {
    const actorId = clean(row.platform_market_actor_id)
    if (!actorId) continue
    const gridOwnerId = clean(row.grid_owner_id)
    const key = `${actorId}:${gridOwnerId ?? 'none'}`
    if (!deduped.has(key)) {
      deduped.set(key, {
        actorId,
        gridOwnerId,
        companyId: clean(row.company_id),
        edielId: clean(row.ediel_id),
      })
    }
    if (deduped.size >= limit) break
  }
  return [...deduped.values()]
}

async function hasLiveLease(candidate: Candidate) {
  let query = supabaseService
    .from('ediel_certificate_refresh_jobs')
    .select('id,started_at')
    .eq('status', 'running')
    .gte('started_at', leaseCutoffIso())
    .eq('platform_market_actor_id', candidate.actorId)
    .limit(1)

  if (candidate.gridOwnerId) query = query.eq('grid_owner_id', candidate.gridOwnerId)

  const { data, error } = await query
  if (error) {
    if (missingSchema(error)) return false
    throw error
  }
  return Boolean(data?.length)
}

export async function runScheduledCertificateRefreshRecovery(input: { limit?: number } = {}) {
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT))
  const reclaimed = await reclaimStaleCertificateRefreshJobs()
  const candidates = await listDueCandidates(limit)
  const results: Array<Record<string, unknown>> = []
  let processed = 0
  let skippedActiveLease = 0
  let succeeded = 0
  let failed = 0

  for (const candidate of candidates) {
    try {
      if (await hasLiveLease(candidate)) {
        skippedActiveLease += 1
        results.push({ ...candidate, status: 'skipped_active_lease' })
        continue
      }

      const result = await refreshCertificatesForActor({
        actorId: candidate.actorId,
        gridOwnerId: candidate.gridOwnerId,
        triggeredBy: 'scheduled_30_day',
      })
      processed += 1
      if (result.ok) succeeded += 1
      else failed += 1
      results.push({
        ...candidate,
        status: result.ok ? 'completed' : result.skipped ? 'skipped' : 'failed',
        found: result.found,
        inserted: result.inserted,
        updated: result.updated,
        valid: result.valid,
        expired: result.expired,
        reason: result.reason ?? null,
        errors: result.errors ?? [],
      })
    } catch (error) {
      processed += 1
      failed += 1
      results.push({ ...candidate, status: 'failed', error: errorMessage(error) })
    }
  }

  return {
    ok: failed === 0,
    reclaimed: reclaimed.reclaimed,
    candidates: candidates.length,
    processed,
    succeeded,
    failed,
    skippedActiveLease,
    leaseMinutes: LEASE_MINUTES,
    results,
  }
}
