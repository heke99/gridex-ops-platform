import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalAtomicZ02JobResult } from '@/lib/customer-operations/z02AtomicEvidence'

describe('canonical Z02 atomic worker convergence', () => {
  it('accepts only the complete DB gate chain', () => {
    expect(canonicalAtomicZ02JobResult({
      z02_correlation_status: 'exact', z02_payload_validation_status: 'valid',
      z02_snapshot_freshness_status: 'valid', z02_atomic_core_applied: true,
      z02_atomic_core: { ok: true, meteringPointRecordId: '11111111-1111-4111-8111-111111111111' },
    })?.ok).toBe(true)
    expect(canonicalAtomicZ02JobResult({
      z02_correlation_status: 'exact', z02_payload_validation_status: 'valid',
      z02_atomic_core_applied: true, z02_atomic_core: { ok: true },
    })).toBeNull()
  })
  it('does not run the legacy second app-layer core apply from the worker', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/customer-operations/automation.part-2.ts'), 'utf8')
    const start = source.indexOf('export async function processInboundResponse')
    const end = source.indexOf('export type DispatchBlockerEntry', start)
    const worker = source.slice(start, end)
    expect(worker).not.toContain('applyInboundGridOwnerResponse(')
    expect(worker).toContain('canonicalAtomicZ02JobResult(job.result)')
    expect(worker).toContain("clean(point.status) !== 'active'")
  })
  it('derives price area from canonical platform registry and guards stale snapshots', () => {
    const migration = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260903213000_z02_snapshot_market_context_guard.sql'), 'utf8')
    expect(migration).toContain('from public.platform_grid_areas pga')
    expect(migration).toContain("'z02_price_area_conflict'")
    expect(migration).toContain("'z02_grid_area_price_area_unresolved'")
    expect(migration).toContain('v_annual < 0')
    expect(migration).toContain("z02_snapshot_freshness_status', 'valid'")
  })
})
