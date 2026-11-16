import {createHash} from 'node:crypto'
import {supabaseService} from '@/lib/supabase/service'
import {encodeEdifactLatin1} from '@/lib/ediel/core/edifactEncoding'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'

/** A positive certification original proves test provenance only. It never
 * substitutes for canonical admission or authorizes a live business effect. */
export type SourceQualifiedPositiveFixture=Readonly<{
 kind:'source_qualified_positive_fixture';version:1;registrationId:string;companyId:string;runId:string;
 roleCode:string;caseCode:string;suite:string;revision:string;stepNo:number;wireSha256:string;originalFileSha256:string;
 expectedOutcome:'positive';expectedDiagnosticCodes:readonly [];testReceiverEdielId:string;validUntil:string;
 sourceReference:string;ownerDecisionReference:string;authorizesBusinessEffect:false;
}>
type Draft={companyId?:string|null;environment?:string|null;direction?:string|null;rawPayload?:string|null}
const returned=new WeakMap<object,{raw:string;actorUserId:string}>(),drafts=new WeakMap<object,SourceQualifiedPositiveFixture>()
const hash=(raw:string)=>createHash('sha256').update(encodeEdifactLatin1(raw)).digest('hex')
function matches(q:SourceQualifiedPositiveFixture,company:string,raw:string){try{
 const wire=tokenizeEdifact(raw),unbs=wire.segments.filter(s=>s.tag==='UNB')
 return q.companyId===company&&q.expectedOutcome==='positive'&&q.authorizesBusinessEffect===false
  &&q.expectedDiagnosticCodes.length===0&&Date.parse(q.validUntil)>Date.now()&&q.wireSha256===hash(raw)
  &&q.originalFileSha256===q.wireSha256&&unbs.length===1&&segmentComposite(unbs[0],3,wire.una)[0]===q.testReceiverEdielId
  &&segmentComposite(unbs[0],11,wire.una)[0]==='1'
}catch{return false}}
export async function resolveSourceQualifiedPositiveFixtureDraft(input:{companyId:string;runId:string;stepNo:number;actorUserId:string;rawPayload:string;diagnosticCodes:readonly string[]}):Promise<SourceQualifiedPositiveFixture|null>{
 if(input.diagnosticCodes.length)return null
 await assertEdielTenantActor({companyId:input.companyId,actorUserId:input.actorUserId,permissionAnyOf:['communication.write','ediel_testing.write']})
 const {data,error}=await supabaseService.rpc('gridex_ediel_positive_fixture_read_v1',{p_context:input})
 if(error)throw Error('ediel_positive_fixture_authority_unavailable',{cause:error});if(data===null)return null
 const q=data as SourceQualifiedPositiveFixture
 if(!q||q.kind!=='source_qualified_positive_fixture'||q.version!==1||!q.registrationId||!q.runId||!q.roleCode||!q.caseCode||!q.suite||!q.revision
  ||!q.sourceReference||!q.ownerDecisionReference||q.runId!==input.runId||q.stepNo!==input.stepNo||!Array.isArray(q.expectedDiagnosticCodes)||!matches(q,input.companyId,input.rawPayload))throw Error('ediel_positive_fixture_authority_scope_invalid')
 const frozen=Object.freeze({...q,expectedDiagnosticCodes:Object.freeze([]) as readonly []});returned.set(frozen,{raw:input.rawPayload,actorUserId:input.actorUserId});return frozen
}
export function sourceQualifiedPositiveFixtureMatchesDraft(input:{draft:Draft;qualification?:SourceQualifiedPositiveFixture|null;diagnosticCodes:readonly string[]}):boolean{
 const q=input.qualification,b=q?returned.get(q):null
 return Boolean(q&&b&&input.diagnosticCodes.length===0&&input.draft.direction==='outbound'&&input.draft.environment==='test'&&input.draft.companyId
  &&b.raw===input.draft.rawPayload&&matches(q,input.draft.companyId,input.draft.rawPayload??''))
}
export function bindSourceQualifiedPositiveFixtureDraft(draft:Draft,qualification:SourceQualifiedPositiveFixture){
 if(!sourceQualifiedPositiveFixtureMatchesDraft({draft,qualification,diagnosticCodes:[]}))throw Error('ediel_positive_fixture_draft_binding_invalid');drafts.set(draft,qualification)
}
export function readSourceQualifiedPositiveFixtureDraft(draft:Draft):SourceQualifiedPositiveFixture|null{
 const q=drafts.get(draft);return q&&sourceQualifiedPositiveFixtureMatchesDraft({draft,qualification:q,diagnosticCodes:[]})?q:null
}
export async function prepareSourceQualifiedPositiveFixtureWitness(input:{qualification:SourceQualifiedPositiveFixture;actorUserId:string;rawPayload:string}):Promise<{witnessId:string;qualification:SourceQualifiedPositiveFixture}>{
 const q=input.qualification,b=returned.get(q)
 if(!b||b.actorUserId!==input.actorUserId||b.raw!==input.rawPayload||!matches(q,q.companyId,input.rawPayload))throw Error('ediel_positive_fixture_witness_required')
 await assertEdielTenantActor({companyId:q.companyId,actorUserId:input.actorUserId,permissionAnyOf:['communication.write','ediel_testing.write']})
 const {data,error}=await supabaseService.rpc('gridex_ediel_positive_fixture_prepare_v1',{p_context:{companyId:q.companyId,runId:q.runId,stepNo:q.stepNo,actorUserId:input.actorUserId,rawPayload:input.rawPayload,registrationId:q.registrationId}})
 if(error||typeof data?.witnessId!=='string'||data?.qualification?.registrationId!==q.registrationId||data?.qualification?.wireSha256!==q.wireSha256)throw Error('ediel_positive_fixture_witness_required',{cause:error})
 return {witnessId:data.witnessId,qualification:q}
}
