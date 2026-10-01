import {supabaseService} from '@/lib/supabase/service'
import type {CreateEdielMessageInput,EdielMessageRow} from '@/lib/ediel/types'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
declare const bilateralDraftBrand:unique symbol
type Own=Readonly<{objectId:string;identityAgency:'9'|'89';firstLineIndex:number;lineItemReference:string;profileVersionId:string;process:'normal_start_h'|'closure_request_lk';sourceHash:string;sourceGrammarHash:string;rulePackId:string;messageProfileId:string;pointId:string;customerId:string;siteId:string;contractId:string;contractHash:string;eventAt:string}>
export type QualifiedBilateralProdatOutboundDraft=Readonly<{version:1;owner:'immutable-bilateral-prodat-outbound-profile-v1';companyId:string;environment:'test'|'production';actorUserId:string;payloadHash:string;messageCode:'Z03'|'Z08';objects:readonly Own[];[bilateralDraftBrand]:true}>
const issued=new WeakMap<QualifiedBilateralProdatOutboundDraft,{raw:string}>()
const record=(x:unknown):Record<string,unknown>|null=>x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:null
const uuid=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x)
const hash=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)
/** Physical bytes select the exceptional owner. Parsed/public approval flags
 * do not select either a profile or an ordinary path. */
export function requiresBilateralProdatOutboundOwner(draft:CreateEdielMessageInput):boolean{
 if(!draft.rawPayload)return false
 const wire=tokenizeEdifact(draft.rawPayload),family=wire.segments.find(s=>s.tag==='UNH'),bgm=wire.segments.find(s=>s.tag==='BGM')
 if(!family||segmentComposite(family,2,wire.una)[0]!=='PRODAT'||!bgm)return false
 const code=segmentComposite(bgm,1,wire.una)[0]
 if(!['Z03','Z08'].includes(code))return false
 let characteristic:string|undefined
 for(const s of wire.segments){if(s.tag==='CCI')characteristic=segmentComposite(s,2,wire.una)[0];else if(s.tag==='CAV'&&characteristic==='Z13'&&segmentComposite(s,1,wire.una)[0]===(code==='Z03'?'Z25':'Z23'))return true}
 return false
}
/** Read-only qualification. Native persistence independently derives the
 * profile under the current authorization graph in its INSERT transaction. */
export async function qualifyBilateralProdatOutboundDraft(input:{draft:CreateEdielMessageInput;actorUserId:string}):Promise<QualifiedBilateralProdatOutboundDraft|null>{
 const {draft,actorUserId}=input
 if(!requiresBilateralProdatOutboundOwner(draft))return null
 if(draft.direction!=='outbound'||draft.messageFamily!=='PRODAT'||!uuid(draft.companyId)||!uuid(actorUserId)||!['test','production'].includes(draft.environment??''))throw Error('bilateral_prodat_outbound_actual_scope_required')
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
 const {data,error}=await rpc('ediel_qualify_bilateral_prodat_outbound_draft_v1',{p_company_id:draft.companyId,p_actor_user_id:actorUserId,p_environment:draft.environment,p_raw_payload:draft.rawPayload})
 if(error)throw error
 const r=record(data)
 if(!r)throw Error('bilateral_prodat_outbound_current_profile_required')
 if(r.version!==1||r.owner!=='immutable-bilateral-prodat-outbound-profile-v1'||r.companyId!==draft.companyId||r.actorUserId!==actorUserId||r.environment!==draft.environment||r.payloadHash!==evidenceHash(draft.rawPayload!)||r.messageCode!==draft.messageCode||!Array.isArray(r.objects))throw Error('bilateral_prodat_outbound_profile_receipt_unqualified')
 const wire=tokenizeEdifact(draft.rawPayload!),groups=prodatRegisterGroups(wire.segments,wire.una).groups.filter(g=>g.validRegisterChain&&g.firstLineIndex===g.lineIndex)
 if(!groups.length||groups.length!==r.objects.length)throw Error('bilateral_prodat_outbound_whole_physical_scope_required')
 for(const [i,g]of groups.entries()){
  const o=record(r.objects[i]),refs=g.segments.filter(t=>t.tag==='RFF'&&segmentComposite(t,1,wire.una)[0]==='LI'),li=refs.length===1?segmentComposite(refs[0],1,wire.una)[1]:null
  if(!o||g.messageIndex!==0||o.objectId!==g.itemId||o.identityAgency!==g.identityAgency||o.firstLineIndex!==g.firstLineIndex||o.lineItemReference!==li||!li||o.process!==(r.messageCode==='Z03'?'normal_start_h':'closure_request_lk')||!['profileVersionId','rulePackId','messageProfileId','pointId','customerId','siteId','contractId'].every(k=>uuid(o[k]))||!['sourceHash','sourceGrammarHash','contractHash'].every(k=>hash(o[k]))||typeof o.eventAt!=='string'||!Number.isFinite(Date.parse(o.eventAt)))throw Error('bilateral_prodat_outbound_own_scope_required')
 }
 const q=Object.freeze({...r,objects:Object.freeze(r.objects.map(o=>Object.freeze({...record(o)!})))}) as unknown as QualifiedBilateralProdatOutboundDraft
 issued.set(q,{raw:draft.rawPayload!});return q
}
export function bilateralProdatOutboundDraftQualified(input:{draft:CreateEdielMessageInput;actorUserId:string;qualification?:QualifiedBilateralProdatOutboundDraft|null}):boolean{
 const q=input.qualification,w=q?issued.get(q):null
 return Boolean(q&&w&&w.raw===input.draft.rawPayload&&q.companyId===input.draft.companyId&&q.actorUserId===input.actorUserId&&q.environment===input.draft.environment&&q.messageCode===input.draft.messageCode&&q.payloadHash===evidenceHash(input.draft.rawPayload??''))
}
/** The complete native owner prepares and consumes its witness in the same
 * transaction as original/receipt/reference/event persistence. */
export async function createAtomicBilateralProdatOriginal(draft:CreateEdielMessageInput,actorUserId:string):Promise<EdielMessageRow>{
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
 const {data,error}=await rpc('ediel_create_bilateral_prodat_original_v1',{p_company_id:draft.companyId,p_actor_user_id:actorUserId,p_draft:draft})
 if(error)throw error
 const r=record(data),m=record(r?.message)
 if(r?.version!==1||!m||!uuid(m.id)||m.company_id!==draft.companyId||m.environment!==draft.environment||m.direction!=='outbound'||m.message_family!=='PRODAT'||m.message_code!==draft.messageCode||m.raw_payload!==draft.rawPayload||m.created_by!==actorUserId||m.immutable_payload_hash!==evidenceHash(draft.rawPayload??''))throw Error('bilateral_prodat_outbound_atomic_original_receipt_unqualified')
 return m as unknown as EdielMessageRow
}
