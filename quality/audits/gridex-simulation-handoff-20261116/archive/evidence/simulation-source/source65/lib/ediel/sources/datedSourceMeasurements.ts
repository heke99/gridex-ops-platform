import {supabaseService} from '@/lib/supabase/service'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {inspectStructuralReadset,type StructuralReadset} from './structuralSourceReadset'
import {readStructuralMeasurementProjection} from './structuralSourceWire'
import {bindReceivedProdatIgnoredFields} from '@/lib/ediel/core/receivedProdatIgnoredFieldBinding'
import {evidenceHash,isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'

/** Opens the SAME protected original snapshot and its linked canonical facets.
 * No caller fields, status JSON, local rule selection or current scalar fallback
 * can supply measurement/product facts. Missing historical facets stay UNKNOWN.
 */
export async function readDatedSourceMeasurements(input:{companyId:string;environment:'test'|'production';actorUserId:string;cutoffAt:string}):Promise<StructuralReadset>{
 await assertEdielTenantActor({companyId:input.companyId,actorUserId:input.actorUserId,permissionAnyOf:['communication.write','ediel_testing.write']})
 const {data:snapshot,error}=await supabaseService.rpc('gridex_source_object_snapshot_v1',{p_company_id:input.companyId,p_environment:input.environment,p_cutoff:input.cutoffAt}).abortSignal(AbortSignal.timeout(2000))
 if(error)throw new Error('dated_structure_snapshot_unconfirmed')
 const readset=inspectStructuralReadset(input,snapshot)
 const timeline=readset.timeline
 if(timeline.status!=='inspected'||!timeline.boundedReadComplete||readset.unresolvedSources||!timeline.snapshotId||!timeline.readsetHash)throw new Error('dated_structure_snapshot_unqualified')
 const {data:receipt,error:facetError}=await supabaseService.rpc('gridex_read_prodat_ignored_fields_v1',{p_company_id:input.companyId,p_environment:input.environment,p_actor_user_id:input.actorUserId,p_snapshot_id:timeline.snapshotId,p_readset_hash:timeline.readsetHash}).abortSignal(AbortSignal.timeout(2000))
 if(facetError||!isEvidenceRecord(receipt)||receipt.version!==1||receipt.companyId!==input.companyId||receipt.environment!==input.environment||receipt.snapshotId!==timeline.snapshotId||receipt.readsetHash!==timeline.readsetHash||!Array.isArray(receipt.facets)||receipt.facets.length>1000)throw new Error('dated_structure_field_facets_unconfirmed')
 const seen=new Set<string>()
 for(const facet of receipt.facets){
  if(!isEvidenceRecord(facet)||Object.keys(facet).length!==4||!['sourceMessageId','canonicalAssessmentId','fieldsText','fieldsHash'].every(key=>Object.hasOwn(facet,key))||!isEvidenceUuid(facet.sourceMessageId)||!isEvidenceUuid(facet.canonicalAssessmentId))throw new Error('dated_structure_field_facet_scope_invalid')
  const source=readset.sources.find(item=>item.sourceMessageId===facet.sourceMessageId),asOf=source?.asOf
  if(!source||asOf?.canonicalAssessmentId!==facet.canonicalAssessmentId)continue
  const key=`${facet.sourceMessageId}/${facet.canonicalAssessmentId}`
  if(seen.has(key))throw new Error('dated_structure_field_facet_ambiguous');seen.add(key)
  if(facet.fieldsText===null&&facet.fieldsHash===null)continue
  if(typeof facet.fieldsText!=='string'||Buffer.byteLength(facet.fieldsText,'utf8')>262144||facet.fieldsHash!==evidenceHash(facet.fieldsText))throw new Error('dated_structure_field_facet_hash_invalid')
  const ignored=bindReceivedProdatIgnoredFields(JSON.parse(facet.fieldsText),source.rawPayload)
  if(!ignored)throw new Error('dated_structure_field_facet_physical_scope_invalid')
  for(const version of readset.versions.filter(item=>item.sourceMessageId===source.sourceMessageId)){
   const measurements=readStructuralMeasurementProjection(source.rawPayload,version.wire.object,ignored)
   if(measurements)version.measurements=measurements
  }
 }
 return readset
}
