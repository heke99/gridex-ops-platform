import {createHash} from 'node:crypto'
import {supabaseService} from '@/lib/supabase/service'
import type {CustomerLifeEventBasis,CustomerLifeEventHeld} from './lifeEventSource'
import {copyProdatRegisterFacts} from '@/lib/ediel/prodat/prodatRegisterEvidence'
import type {ProdatDependentConditionFacts} from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'

/** Qualified protocol selections only. Current queue/send authority remains in
 * the immutable event/original owners; serialized register facts are not a grant. */
type Selection={readonly status:'qualified'}
type Scope={companyId:string;eventId:string;actorUserId:string;basis:CustomerLifeEventBasis}
const qualified=new WeakMap<Selection,{binding:string;facts:ProdatDependentConditionFacts}>()
const record=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v===v.trim()&&!/[\x00-\x1f\x7f]/.test(v)
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const invalid=():never=>{throw Error('requested_customer_change_selected_facts_invalid')}
const binding=(s:Scope)=>JSON.stringify([s.companyId,s.eventId,s.actorUserId,s.basis.companyId,s.basis.eventId,s.basis.environment,s.basis.customerId,s.basis.siteId,s.basis.meteringPointId,s.basis.pointId,s.basis.sourceReference,s.basis.sourceVersion,s.basis.sourceDigest,s.basis.rawPayload])
function nad(value:unknown,party:'UD'|'IV',reference:string){
 const token=record(value),e=token?.elements
 if(token?.tag!=='NAD'||!Array.isArray(e)||e.length!==10||e.some(v=>!Array.isArray(v)||v.some(c=>typeof c!=='string'))||JSON.stringify(e[0])!==JSON.stringify(['NAD'])||JSON.stringify(e[1])!==JSON.stringify([party])||e[2].length!==3||e[3].length!==1||e[3][0]!==''||e[7].length!==1||e[7][0]!==''||e[4].length<1||e[4].length>2||e[5].length<1||e[5].length>3||[6,8,9].some(i=>e[i].length!==1||!text(e[i][0])))return invalid()
 const lines=e[5] as string[]
 if(lines.some(v=>v!==v.trim()||v==='.')||!lines.some(text))return invalid()
 // One signed EDIFACT NAD C059 convention: omitted trailing components are
 // empty slots. No address normalization or real-world equivalence is inferred.
 const address={lines:[lines[0]??'',lines[1]??'',lines[2]??''],city:e[6][0],postalCode:e[8][0],country:e[9][0],representation:{convention:'signed_edifact_nad_c059_slots_v1',reference,mode:1}}
 return {identity:{id:e[2][0],qualifier:e[2][1],agency:e[2][2]},nameLines:e[4] as string[],lines,address}
}
export async function readRequestedCustomerChangeFacts(scope:Scope):Promise<Selection|CustomerLifeEventHeld|undefined>{
 if(scope.basis.companyId!==scope.companyId||scope.basis.eventId!==scope.eventId)return invalid()
 // New additive RPC follows the existing ungenerated requested-source port;
 // generated types are imported only from an authentic resulting-tree capture.
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as (name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>
 const {data,error}=await rpc('ediel_requested_customer_change_selected_facts_v1',{p_company_id:scope.companyId,p_actor_user_id:scope.actorUserId,p_event_id:scope.eventId})
 if(error)throw error
 if(data===null)return undefined
 const r=record(data)
 if(r?.status==='held'){
  if(!Array.isArray(r.missing)||!r.missing.length||r.missing.some(v=>!text(v)))return invalid()
  return {status:'held',missing:[...r.missing] as string[]}
 }
 const b=scope.basis
 if(r?.status!=='authorized'||r.companyId!==scope.companyId||r.eventId!==scope.eventId||r.environment!==b.environment||r.customerId!==b.customerId||!isEvidenceUuid(r.artifactId)||!hash(r.claimsHash)||r.sourceReference!==b.sourceReference||r.sourceVersion!==b.sourceVersion||r.sourceHash!==b.sourceDigest||!hash(r.sourceHash)||r.payloadHash!==createHash('sha256').update(b.rawPayload).digest('hex')||!text(r.effectiveAt)||!Number.isFinite(Date.parse(r.effectiveAt))||!Array.isArray(r.scope)||r.scope.length!==1||!Array.isArray(r.customerTokens))return invalid()
 if(r.customerTokens.length===1||r.customerTokens.some(t=>record(t)?.tag==='DTM'))return {status:'held',missing:['explicit_signed_ud_iv_address_comparison_required']}
 if(r.customerTokens.length!==2)return invalid()
 const own=record(r.scope[0])
 if(!own||own.customerId!==b.customerId||own.siteId!==b.siteId||own.meteringPointId!==b.meteringPointId||own.pointId!==b.pointId||!text(own.pointId)||!isEvidenceUuid(own.periodId)||!['9','89'].includes(String(own.identityAgency))||typeof own.identityAgency!=='string'||own.effectiveAt!==r.effectiveAt)return invalid()
 const reference=`requested_customer_change:${r.artifactId}:${r.claimsHash}`
 const ud=nad(r.customerTokens[0],'UD',reference),iv=nad(r.customerTokens[1],'IV',reference)
 const source={kind:'caller_selection',companyId:scope.companyId,reference}
 const facts=copyProdatRegisterFacts({market:'electricity',endUserAddressObjects:[{meteringPointId:own.pointId,identityAgency:own.identityAgency,endUser:ud.identity,availability:'available',addressLines:ud.lines,source}],invoiceeObjects:[{meteringPointId:own.pointId,identityAgency:own.identityAgency,endUser:{identity:ud.identity,address:ud.address},invoicee:{identity:iv.identity,nameLines:iv.nameLines,address:iv.address,availability:'available'},event:{state:'unknown'},source}]})
 const selection=Object.freeze({status:'qualified' as const})
 qualified.set(selection,{binding:binding(scope),facts})
 return selection
}
export function requestedCustomerChangeRegisterFacts(selection:Selection,scope:Scope):ProdatDependentConditionFacts{
 const owned=qualified.get(selection)
 if(!owned||owned.binding!==binding(scope))return invalid()
 return copyProdatRegisterFacts(owned.facts)
}
