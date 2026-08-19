import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  reclaimRows: [] as Array<Record<string, unknown>>,
  reclaimError: null as { code?: string; message?: string } | null,
  scopedRows: [] as Array<Record<string, unknown>>,
  scopedError: null as { code?: string; message?: string } | null,
  fallbackRows: [] as Array<Record<string, unknown>>,
  fallbackError: null as { code?: string; message?: string } | null,
  liveLeaseActorIds: new Set<string>(),
  leaseError: null as { code?: string; message?: string } | null,
  refresh: vi.fn(),
}))

vi.mock('@/lib/ediel/certificates/actorCertificateRefresh', () => ({
  refreshCertificatesForActor: state.refresh,
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      if (table === 'ediel_certificate_refresh_jobs') {
        return {
          update() {
            const reclaim = {
              eq() { return reclaim },
              lt() { return reclaim },
              select() {
                return Promise.resolve({ data: state.reclaimRows, error: state.reclaimError })
              },
            }
            return reclaim
          },
          select() {
            let actorId: string | null = null
            const lease = {
              eq(column: string, value: unknown) {
                if (column === 'platform_market_actor_id') actorId = String(value)
                return lease
              },
              gte() { return lease },
              limit() {
                return Promise.resolve({
                  data: actorId && state.liveLeaseActorIds.has(actorId)
                    ? [{ id: `lease:${actorId}` }]
                    : [],
                  error: state.leaseError,
                })
              },
            }
            return lease
          },
        }
      }

      if (table === 'ediel_blocked_grid_owner_certificate_refresh_candidates_v') {
        return {
          select() { return this },
          limit() { return Promise.resolve({ data: state.scopedRows, error: state.scopedError }) },
        }
      }

      if (table === 'ediel_certificate_refresh_candidates_v') {
        return {
          select() { return this },
          limit() { return Promise.resolve({ data: state.fallbackRows, error: state.fallbackError }) },
        }
      }

      throw new Error(`unexpected table ${table}`)
    },
  },
}))

import {
  reclaimStaleCertificateRefreshJobs,
  runScheduledCertificateRefreshRecovery,
} from '@/lib/ediel/certificates/scheduledRefreshRecovery'

beforeEach(() => {
  state.reclaimRows = []
  state.reclaimError = null
  state.scopedRows = []
  state.scopedError = null
  state.fallbackRows = []
  state.fallbackError = null
  state.liveLeaseActorIds.clear()
  state.leaseError = null
  state.refresh.mockReset()
})

describe('scheduled certificate refresh recovery', () => {
  it('reclaims stale jobs and skips a candidate with a live lease', async () => {
    state.reclaimRows = [{ id: 'stale-1' }]
    state.scopedRows = [{
      platform_market_actor_id: 'actor-1',
      grid_owner_id: 'owner-1',
      company_id: 'company-1',
      ediel_id: '24800',
    }]
    state.liveLeaseActorIds.add('actor-1')

    const result = await runScheduledCertificateRefreshRecovery({ limit: 1 })

    expect(result.reclaimed).toBe(1)
    expect(result.skippedActiveLease).toBe(1)
    expect(result.processed).toBe(0)
    expect(result.ok).toBe(true)
    expect(state.refresh).not.toHaveBeenCalled()
  })

  it('deduplicates candidates and records successful refresh results', async () => {
    state.scopedRows = [
      { platform_market_actor_id: 'actor-2', grid_owner_id: 'owner-2', company_id: 'company-1', ediel_id: '23300' },
      { platform_market_actor_id: 'actor-2', grid_owner_id: 'owner-2', company_id: 'company-1', ediel_id: '23300' },
      { platform_market_actor_id: '', grid_owner_id: 'ignored', company_id: 'company-1', ediel_id: '00000' },
    ]
    state.refresh.mockResolvedValue({
      ok: true,
      found: 2,
      inserted: 1,
      updated: 1,
      valid: 2,
      expired: 0,
      errors: [],
    })

    const result = await runScheduledCertificateRefreshRecovery({ limit: 50 })

    expect(result.candidates).toBe(1)
    expect(result.processed).toBe(1)
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
    expect(state.refresh).toHaveBeenCalledWith({
      actorId: 'actor-2',
      gridOwnerId: 'owner-2',
      triggeredBy: 'scheduled_30_day',
    })
  })

  it('falls back to the legacy candidate view and isolates refresh failures', async () => {
    state.scopedError = { code: '42P01', message: 'relation missing' }
    state.fallbackRows = [{
      platform_market_actor_id: 'actor-3',
      grid_owner_id: null,
      company_id: null,
      ediel_id: '30300',
    }]
    state.refresh.mockRejectedValue(new Error('Expisoft lookup failed'))

    const result = await runScheduledCertificateRefreshRecovery({ limit: 0 })

    expect(result.candidates).toBe(1)
    expect(result.processed).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.ok).toBe(false)
    expect(result.results[0]).toMatchObject({ status: 'failed', error: 'Expisoft lookup failed' })
  })

  it('fails closed on a non-schema reclaim error and tolerates missing schema', async () => {
    state.reclaimError = { code: 'P0001', message: 'database unavailable' }
    await expect(reclaimStaleCertificateRefreshJobs()).rejects.toMatchObject({ code: 'P0001' })

    state.reclaimError = { code: '42P01', message: 'relation missing' }
    await expect(reclaimStaleCertificateRefreshJobs()).resolves.toMatchObject({
      reclaimed: 0,
      skipped: true,
      reason: 'schema_missing',
    })
  })
})