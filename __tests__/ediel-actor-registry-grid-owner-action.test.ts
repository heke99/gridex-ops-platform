// Admin import action wiring: preview stores the grid_owners plan, IMPORTERA
// applies it through the service port, and a repeated apply is a no-op.
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ rpc: vi.fn(), admin: vi.fn(), audit: vi.fn(), tables: {} as Record<string, Row[]> }))

function builder(table: string) {
  const rows = (io.tables[table] ??= [])
  const filters: Array<(row: Row) => boolean> = []
  let op: 'select' | 'insert' | 'update' = 'select', payload: Row | null = null, single = false
  const run = async () => {
    if (op === 'insert') { const row = { id: `${table}-${rows.length + 1}`, ...payload }; rows.push(row); return { data: single ? row : [row], error: null } }
    const hits = rows.filter(row => filters.every(f => f(row)))
    if (op === 'update') { for (const row of hits) Object.assign(row, payload); return { data: hits.map(row => ({ id: row.id })), error: null } }
    return { data: single ? hits[0] ?? null : hits, error: null }
  }
  const q: Record<string, unknown> = {
    select: () => q, order: () => q, range: () => q,
    insert: (value: Row) => { op = 'insert'; payload = value; return q },
    update: (value: Row) => { op = 'update'; payload = value; return q },
    eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return q },
    is: (column: string, value: unknown) => { filters.push(row => (row[column] ?? null) === value); return q },
    single: () => { single = true; return run() }, maybeSingle: () => { single = true; return run() },
    then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => run().then(ok, ko),
  }
  return q
}
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc, from: (table: string) => builder(table) } }))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminActionAccess: io.admin }))
vi.mock('@/lib/audit/actionLogger', () => ({ logAdminActionAndUsage: io.audit, logUsageEvent: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/ediel/security/expisoftCertificateDirectory', () => ({ fetchReceiverCertificatesFromExpisoft: vi.fn() }))
import { importPlatformActorsAction } from '@/app/admin/ediel/actors/actions'

const xml = readFileSync('__tests__/fixtures/ediel-actor-registry/companies.xml')
const seed = (): Row[] => JSON.parse(readFileSync('__tests__/fixtures/ediel-actor-registry/grid-owners-2026-10-09.json', 'utf8'))
const withoutClock = (row: Row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'updated_at'))
const userId = '00000000-0000-4000-8000-000000000001'
function form(mode: 'preview' | 'apply', sync = true) {
  const data = new FormData()
  data.set('actorImportFile', new File([xml], 'companies.xml', { type: 'application/xml' }))
  data.set('importMode', mode); data.set('confirmApply', 'IMPORTERA'); if (sync) data.set('syncGridOwners', 'on')
  return data
}

describe('importPlatformActorsAction grid_owners sync', () => {
  let applied: Row | null
  beforeEach(() => {
    io.tables = { grid_owners: seed() }; applied = null
    io.admin.mockResolvedValue({ userId }); io.audit.mockResolvedValue(undefined)
    io.rpc.mockImplementation(async (name: string) => {
      if (name === 'ediel_read_registry_preview_snapshot_v1') return { data: { actors: [], snapshotHash: 'a'.repeat(64) }, error: null }
      if (name === 'ediel_read_actor_registry_batch_v1') return { data: applied ? { ...applied, reusedExistingRun: true } : null, error: null }
      if (name === 'ediel_apply_actor_registry_v1') {
        io.tables.platform_actor_import_runs = [...(io.tables.platform_actor_import_runs ?? []), { id: 'ui-run', metadata: { atomicApplyVersion: 1 } }]
        applied = { importRunId: 'run', uiRunId: 'ui-run', reusedExistingRun: false, totalRecords: 704, created: 600, updated: 0, unchanged: 0, conflicts: 104, errors: 0, routeIds: ['r'], activation: 'held_pending_current_source_readiness' }
        return { data: applied, error: null }
      }
      throw Error(`unexpected rpc ${name}`)
    })
  })

  it('preview stores the plan without touching grid_owners', async () => {
    const before = JSON.stringify(io.tables.grid_owners)
    await importPlatformActorsAction(form('preview'))
    expect(JSON.stringify(io.tables.grid_owners)).toBe(before)
    const run = io.tables.platform_actor_import_runs.at(-1)!
    expect((run.metadata as Row).gridOwnerPlan).toMatchObject({ counts: { updated: 4, created: 2, linked: 0 } })
  })

  it('apply updates/creates once, records the result, and re-apply of the same bytes changes nothing', async () => {
    await importPlatformActorsAction(form('apply'))
    const rows = io.tables.grid_owners
    expect(rows.filter(r => r.ediel_id === '53200')).toHaveLength(1)
    expect(rows.find(r => r.ediel_id === '16900')).toMatchObject({ communication_email: '16900@kalmarenergi.se', verified_for_customer_flow: true, updated_by: userId })
    expect((io.tables.platform_actor_import_runs.find(r => r.id === 'ui-run')!.metadata as Row)).toMatchObject({ mode: 'apply', gridOwnerResult: { updated: 4, created: 2 } })
    const snapshot = JSON.stringify(rows.map(withoutClock))
    await importPlatformActorsAction(form('apply'))
    expect(io.rpc.mock.calls.filter(([name]) => name === 'ediel_apply_actor_registry_v1')).toHaveLength(1)
    expect(JSON.stringify(io.tables.grid_owners.map(withoutClock))).toBe(snapshot)
    expect(io.audit.mock.calls.at(-1)![0]).toMatchObject({ action: 'actor_import.reused', metadata: { gridOwnerResult: { updated: 0, created: 0 } } })
  })

  it('without the opt-in nothing is written to grid_owners', async () => {
    const before = JSON.stringify(io.tables.grid_owners)
    await importPlatformActorsAction(form('apply', false))
    expect(JSON.stringify(io.tables.grid_owners)).toBe(before)
  })
})
