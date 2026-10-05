// masterplan: IMP-01, AT-IMP-01
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), audit: vi.fn(), revalidate: vi.fn(), admin: vi.fn(), writes: [] as Array<{ table: string; row: Record<string, unknown> }> }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminActionAccess: io.admin }))
vi.mock('@/lib/audit/actionLogger', () => ({ logAdminActionAndUsage: io.audit, logUsageEvent: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: io.revalidate }))
vi.mock('@/lib/ediel/security/expisoftCertificateDirectory', () => ({ fetchReceiverCertificatesFromExpisoft: vi.fn() }))
import { importPlatformActorsAction } from '@/app/admin/ediel/actors/actions'

// Declared database/admin fixture for the actual preview/apply action; this
// proves diagnostics and zero writes to the atomic importer, not source trust.
function input(mode: 'preview' | 'apply') {
  const form = new FormData()
  form.set('actorImportFile', new File(['<Market Code="EL" Country="SE"><Company><Name>Synthetic ESCO</Name><Key Type="EdielId">21660</Key><Role>ESCO</Role></Company></Market>'], 'synthetic.xml', { type: 'application/xml' }))
  form.set('importMode', mode)
  form.set('confirmApply', 'IMPORTERA')
  return form
}
describe('actual registry zero-route preview/apply consumer', () => {
  beforeEach(() => {
    vi.clearAllMocks(); io.writes.length = 0
    io.rpc.mockReset(); io.rpc.mockImplementation(async(name,args)=>{
      if(name==='ediel_read_registry_preview_snapshot_v1'){expect(args).toEqual({p_actor_user_id:'00000000-0000-4000-8000-000000000001',p_ediel_ids:['21660']});return{data:{snapshotHash:'a'.repeat(64),actors:[]},error:null}}
      if(name==='ediel_read_actor_registry_batch_v1'){expect(args).toMatchObject({p_actor_user_id:'00000000-0000-4000-8000-000000000001',p_source_kind:'companies_xml'});return{data:null,error:null}}
      throw Error(`unexpected_registry_rpc:${name}`)
    })
    io.admin.mockResolvedValue({ userId: '00000000-0000-4000-8000-000000000001' })
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
  it('persists a blocking all-zero diagnostic and marks preview unsafe even for a non-grid actor', async () => {
    await importPlatformActorsAction(input('preview'))
    const run = io.writes.find((write) => write.table === 'platform_actor_import_runs')!.row
    expect(run).toMatchObject({ status: 'completed_with_warnings', safe: false, records_upserted: 0 })
    expect(run.error_log).toContainEqual(expect.objectContaining({ issueType: 'ediel_registry_zero_routes_source_held', severity: 'blocking' }))
    expect(io.writes).toContainEqual(expect.objectContaining({ table: 'platform_actor_import_issues', row: expect.objectContaining({ issue_type: 'ediel_registry_zero_routes_source_held', severity: 'blocking' }) }))
    expect(io.rpc.mock.calls.map(([name])=>name)).toEqual(['ediel_read_registry_preview_snapshot_v1'])
  })
  it('retains the diagnostic preview then rejects new apply without an actor/route mutation RPC', async () => {
    await expect(importPlatformActorsAction(input('apply'))).rejects.toThrow('ediel_registry_zero_routes_source_held')
    expect(io.writes.some((write) => write.table === 'platform_actor_import_runs' && write.row.safe === false)).toBe(true)
    expect(io.rpc.mock.calls.map(([name])=>name)).toEqual(['ediel_read_actor_registry_batch_v1','ediel_read_registry_preview_snapshot_v1','ediel_read_registry_preview_snapshot_v1'])
  })
  it('retains source-specific missing route fields and country in the actual preview', async () => {
    const form = input('preview')
    form.set('actorImportFile',new File(['<Market Code="EL"><Company><Name>Synthetic ESCO</Name><Key Type="EdielId">21660</Key><EDIFACTDetails Type="PRODAT"><PartyId>21660</PartyId><CommunicationAddress Type="SMTP">edi@example.invalid</CommunicationAddress></EDIFACTDetails></Company></Market>'],'synthetic.xml',{type:'application/xml'}))
    await importPlatformActorsAction(form)
    const run=io.writes.find((write)=>write.table==='platform_actor_import_runs')!.row
    expect(run).toMatchObject({safe:false,status:'completed_with_warnings'})
    expect(run.error_log).toContainEqual(expect.objectContaining({issueType:'actor_registry_declared_route_source_required',metadata:expect.objectContaining({sourceDiagnostic:expect.objectContaining({missingFields:['interchangePartyId']})})}))
    expect(run.error_log).toContainEqual(expect.objectContaining({issueType:'actor_registry_source_country_required'}))
    expect(io.rpc.mock.calls.map(([name])=>name)).toEqual(['ediel_read_registry_preview_snapshot_v1'])
  })
  it('does not write a preview or inspect the registry after platform authorization rejects', async () => {
    io.admin.mockRejectedValue(new Error('platform_admin_required'))
    await expect(importPlatformActorsAction(input('apply'))).rejects.toThrow('platform_admin_required')
    expect(io.from).not.toHaveBeenCalled(); expect(io.rpc).not.toHaveBeenCalled()
  })
  it('reads a genuine prior result before current parsing/preview and never reapplies the old batch',async()=>{
    io.rpc.mockResolvedValue({data:{importRunId:'old-run',uiRunId:'old-ui',totalRecords:1,created:1,updated:0,unchanged:0,conflicts:0,errors:0,routeIds:['00000000-0000-4000-8000-000000000002'],activation:'held',reusedExistingRun:true},error:null})
    const form=input('apply')
    form.set('actorImportFile',new File(['<PreviousRegistryFormat/>'],'synthetic.xml',{type:'application/xml'}))
    await importPlatformActorsAction(form)
    expect(io.rpc).toHaveBeenCalledOnce();expect(io.rpc.mock.calls[0][0]).toBe('ediel_read_actor_registry_batch_v1')
    expect(io.from).not.toHaveBeenCalled();expect(io.writes).toEqual([])
    expect(io.audit).toHaveBeenCalledWith(expect.objectContaining({action:'actor_import.reused',billable:false,entityId:'old-ui'}))
  })
})
