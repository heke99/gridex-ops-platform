import {beforeEach,describe,expect,it,vi} from 'vitest'
import {timelineScope,timelineReceipt,timelineBody,timelineSource,timelineAssessment,timelineFacts} from './helpers/sourceDecisionTimelineFixtures'
import {ownerId} from './helpers/sourceOwnerFixtures'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
const mocks=vi.hoisted(()=>({authorize:vi.fn(),rpc:vi.fn()}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:mocks.authorize}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:(...args:unknown[])=>({abortSignal:()=>mocks.rpc(...args)})}}))
import {readDatedSourceMeasurements} from '@/lib/ediel/sources/datedSourceMeasurements'
const input={...timelineScope,actorUserId:ownerId(45)}
function fixture(){
 const source=timelineSource(),raw=source.rawPayload.replace("CCI++Z04'CAV+Z03'","CCI++Z04'CAV+Z04'")
 const facts=timelineFacts(raw),factsText=JSON.stringify(facts),assessment=timelineAssessment(101,null,{factsText,factsHash:evidenceHash(factsText)})
 const snapshot=timelineReceipt(timelineBody([{...source,rawPayload:raw,payloadHash:evidenceHash(raw),assessments:[assessment]}]))
 const facets={version:1,...timelineScope,snapshotId:snapshot.snapshotId,readsetHash:snapshot.readsetHash,facets:[{sourceMessageId:source.sourceMessageId,canonicalAssessmentId:assessment.canonicalAssessmentId,fieldsText:'[]',fieldsHash:evidenceHash('[]')}]}
 return {snapshot,facets}
}
beforeEach(()=>{vi.clearAllMocks();mocks.authorize.mockResolvedValue(undefined)})
describe('actual dated source measurement read boundary',()=>{
 it('reads mask only through the same immutable snapshot and leaves absent old facets unknown',async()=>{
  const f=fixture();f.facets.facets[0].fieldsText=null as unknown as string;f.facets.facets[0].fieldsHash=null as unknown as string
  mocks.rpc.mockImplementation(async name=>({data:name==='gridex_source_object_snapshot_v1'?f.snapshot:f.facets,error:null}))
  const read=await readDatedSourceMeasurements(input)
  expect(read.timeline.status).toBe('inspected');expect(read.versions).toHaveLength(1)
  expect(read.versions[0]).not.toHaveProperty('measurements')
  expect(mocks.rpc).toHaveBeenCalledWith('gridex_read_prodat_ignored_fields_v1',expect.objectContaining({p_company_id:input.companyId,p_snapshot_id:f.snapshot.snapshotId,p_readset_hash:f.snapshot.readsetHash,p_actor_user_id:input.actorUserId}))
 })
 it('does not accept another snapshot hash or a fabricated stored mask hash',async()=>{
  for(const change of ['snapshot','fields']){
   const f=fixture();if(change==='snapshot')f.facets.readsetHash='f'.repeat(64);else f.facets.facets[0].fieldsHash='f'.repeat(64)
   mocks.rpc.mockImplementation(async name=>({data:name==='gridex_source_object_snapshot_v1'?f.snapshot:f.facets,error:null}))
   await expect(readDatedSourceMeasurements(input)).rejects.toThrow(change==='snapshot'?'dated_structure_field_facets_unconfirmed':'dated_structure_field_facet_hash_invalid')
  }
 })
 it('keeps the current tenant actor before personal source reads',async()=>{
  mocks.authorize.mockRejectedValue(new Error('ediel_tenant_actor_forbidden'))
  await expect(readDatedSourceMeasurements(input)).rejects.toThrow('ediel_tenant_actor_forbidden');expect(mocks.rpc).not.toHaveBeenCalled()
 })
})
