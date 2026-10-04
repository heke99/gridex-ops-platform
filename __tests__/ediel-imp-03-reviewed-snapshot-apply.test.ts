// masterplan: IMP-03, AT-IMP-03
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), audit: vi.fn(), revalidate: vi.fn(), admin: vi.fn(), writes: [] as Array<{ table: string; row: Record<string, unknown> }>, snapshotHash: 'a'.repeat(64) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminActionAccess: io.admin }))
vi.mock('@/lib/audit/actionLogger', () => ({ logAdminActionAndUsage: io.audit, logUsageEvent: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: io.revalidate }))
vi.mock('@/lib/ediel/security/expisoftCertificateDirectory', () => ({ fetchReceiverCertificatesFromExpisoft: vi.fn() }))
import { importPlatformActorsAction } from '@/app/admin/ediel/actors/actions'

// Synthetic registry source with one complete EL PRODAT route. The database
// is a declared mock: this proves the actual admin preview/apply consumer binds
// the reviewed diff to the snapshot and source it was computed against.
const user = '00000000-0000-4000-8000-000000000001'
const source = '<Market Code="EL" CountryCode="SE"><Company><Name>Synthetic Supplier</Name><Key Type="EdielId">21660</Key><Role>PowerSupplier</Role><EDIFACTDetails Type="PRODAT"><PartyId>21660</PartyId><InterchangePartyId>21660</InterchangePartyId><CommunicationAddress Type="SMTP">edi@example.invalid</CommunicationAddress></EDIFACTDetails></Company></Market>'
const sourceSha = createHash('sha256').update(source).digest('hex')
function form(mode: 'preview' | 'apply', reviewed?: { snapshotHash?: string; sourceSha256?: string }) {
  const f = new FormData()
  f.set('actorImportFile', new File([source], 'synthetic.xml', { type: 'application/xml' }))
  f.set('importMode', mode)
  f.set('confirmApply', 'IMPORTERA')
  if (reviewed?.snapshotHash) f.set('reviewedSnapshotHash', reviewed.snapshotHash)
  if (reviewed?.sourceSha256) f.set('reviewedSourceSha256', reviewed.sourceSha256)
  return f
}
const applied = { importRunId: 'run', uiRunId: 'ui', totalRecords: 1, created: 1, updated: 0, unchanged: 0, conflicts: 0, errors: 0, routeIds: ['00000000-0000-4000-8000-000000000002'], activation: 'held_pending_current_source_readiness', reusedExistingRun: false }
const rpcNames = () => io.rpc.mock.calls.map(([name]) => name)
const previewRun = () => io.writes.find((w) => w.table === 'platform_actor_import_runs')?.row as { metadata: { preview: Record<string, unknown> } } | undefined

describe('IMP-03 preview/apply is a diff against a valid reviewed snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks(); io.writes.length = 0; io.snapshotHash = 'a'.repeat(64)
    io.admin.mockResolvedValue({ userId: user })
    io.rpc.mockReset(); io.rpc.mockImplementation(async (name: string) => {
      if (name === 'ediel_read_registry_preview_snapshot_v1') return { data: { snapshotHash: io.snapshotHash, actors: [] }, error: null }
      if (name === 'ediel_read_actor_registry_batch_v1') return { data: null, error: null }
      if (name === 'ediel_apply_actor_registry_v1') return { data: applied, error: null }
      throw Error(`unexpected_registry_rpc:${name}`)
    })
    io.from.mockImplementation((table: string) => {
      const query: Record<string, unknown> = {
        select: vi.fn(() => query), in: vi.fn(() => query), eq: vi.fn(async () => ({ data: [], error: null })),
        insert: vi.fn((row: Record<string, unknown>) => { io.writes.push({ table, row }); return query }),
        single: vi.fn(async () => ({ data: { id: 'synthetic-preview' }, error: null })),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
      }
      return query
    })
  })

  it('preview records the snapshot hash and exact source hash without any registry mutation (review separated from register data)', async () => {
    await importPlatformActorsAction(form('preview'))
    expect(previewRun()!.metadata.preview).toMatchObject({ snapshotHash: 'a'.repeat(64), sourceSha256: sourceSha, newActors: 1, routesSeen: 1 })
    expect(rpcNames()).toEqual(['ediel_read_registry_preview_snapshot_v1'])
    expect(rpcNames()).not.toContain('ediel_apply_actor_registry_v1')
  })

  it('applies atomically only when the reviewed snapshot and source still match', async () => {
    await importPlatformActorsAction(form('apply', { snapshotHash: 'a'.repeat(64), sourceSha256: sourceSha }))
    expect(rpcNames()).toEqual(['ediel_read_actor_registry_batch_v1', 'ediel_read_registry_preview_snapshot_v1', 'ediel_read_actor_registry_batch_v1', 'ediel_apply_actor_registry_v1'])
    expect(io.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'actor_import.completed', metadata: expect.objectContaining({ activation: 'held_pending_current_source_readiness' }) }))
  })

  it('rejects apply without a reviewed snapshot and never calls the atomic importer', async () => {
    await expect(importPlatformActorsAction(form('apply'))).rejects.toThrow('ediel_registry_reviewed_snapshot_required')
    expect(rpcNames()).not.toContain('ediel_apply_actor_registry_v1')
  })

  it('rejects apply when the registry changed after review (stale snapshot) and re-records a fresh preview', async () => {
    io.snapshotHash = 'b'.repeat(64)
    await expect(importPlatformActorsAction(form('apply', { snapshotHash: 'a'.repeat(64), sourceSha256: sourceSha }))).rejects.toThrow('ediel_registry_reviewed_snapshot_stale')
    expect(rpcNames()).not.toContain('ediel_apply_actor_registry_v1')
    expect(previewRun()!.metadata.preview).toMatchObject({ snapshotHash: 'b'.repeat(64) })
  })

  it('rejects apply of a different file than the one reviewed', async () => {
    await expect(importPlatformActorsAction(form('apply', { snapshotHash: 'a'.repeat(64), sourceSha256: 'c'.repeat(64) }))).rejects.toThrow('ediel_registry_reviewed_snapshot_stale')
    expect(rpcNames()).not.toContain('ediel_apply_actor_registry_v1')
  })
})
