import {loadSwitchCancellationCustomerMasterdataValidationContext,type CustomerMasterdataValidationContext} from '@/lib/ediel/production/customerMasterdataSource'
import {customerMasterdataSendIssue,createCustomerMasterdataAddressFacts} from '@/lib/ediel/prodat/customerMasterdataAuthority'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {readContractInvoicee,type ContractInvoiceeContext} from './contractInvoicee'
import {createHash} from 'node:crypto'
import {tenantDb} from '@/lib/supabase/tenantDb'
import {tokenizeEdifact,segmentComposite,segmentOriginalRaw,type EdifactTokenizedSegment} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactEnvelope,validateUnsmGrammar} from '@/lib/ediel/core/edifactValidation'
import {readProdatParty} from '@/lib/ediel/prodat/prodatPartyFields'
import {prodatEndUserAddressWireLines} from '@/lib/ediel/prodat/prodatEndUserAddress'
import {renderProdatDateField} from '@/lib/ediel/prodat/prodatDateFields'
import type {ProdatDependentConditionFacts} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {supabaseService} from '@/lib/supabase/service'
import type {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
export type SwitchCancellationBasis={status:'authorized';companyId:string;environment:'test'|'production';switchRequestId:string;originalMessageId:string;originalHash:string;
 operationId:string|null;intentId:string|null;outboundRequestId:string|null;messageId:string|null;customerId:string;siteId:string;meteringPointId:string;
 legalActorId:string;legalSenderId:string;legalReceiverId:string;pointId:string;identityAgency:'9'|'89';gridArea:string;li:string;startAt:string;originalSubtype:'L'|'LK';deadline:string;
 customerIdentity:string;customerQualifier:'SE1'|'SE2';customerName:string;sourceObject:Record<string,unknown>;requestedMethod:string}
export type SwitchCancellationHeld={status:'held';missing:string[]}
type Projection={customerMasterdataContext:CustomerMasterdataValidationContext|null;agreementReference:string;customerName:string;customerNameLines:string[];customerAddressLines:string[];customerCity:string;customerPostalCode:string;customerCountry:string;balanceResponsibleId:string|null;invoicee:ContractInvoiceeContext|null;facts:ProdatDependentConditionFacts}
const qualified=new WeakMap<SwitchCancellationBasis,{actorUserId:string;basisHash:string;projection:Projection}>()
const digest=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex')
const held=():SwitchCancellationHeld=>({status:'held',missing:['qualified_immutable_original_cancellation_projection']})
type ScopedSelect=ReturnType<ReturnType<typeof supabaseService.from>['select']>
/** Projection capability is held only by this fresh helper result. Pure source
 * projection adds no one-use/TTL authority; reserve/bind/send still own that. */
export function switchCancellationProjection(basis:SwitchCancellationBasis,actorUserId:string):Projection{
 const q=qualified.get(basis)
 if(!q||q.actorUserId!==actorUserId||q.basisHash!==digest(JSON.stringify(basis)))throw Error('switch_cancellation_source_projection_unqualified')
 const {customerMasterdataContext,...ordinary}=q.projection
 return {...structuredClone(ordinary),customerMasterdataContext}
}
export async function readSwitchCancellationSource(input:{companyId:string;switchRequestId:string;actorUserId:string}):Promise<SwitchCancellationBasis|SwitchCancellationHeld>{
 input={companyId:input.companyId,switchRequestId:input.switchRequestId,actorUserId:input.actorUserId}
 const{data,error}=await supabaseService.rpc('ediel_switch_cancellation_source_v1',{p_company_id:input.companyId,p_switch_id:input.switchRequestId,p_actor_user_id:input.actorUserId})
 if(error)throw error
 if(!data||!['authorized','held'].includes(data.status))throw Error('switch_cancellation_source_result_invalid')
 if(data.status==='held')return data
 const b=data as SwitchCancellationBasis
 if(typeof b.requestedMethod!=='string'||!b.requestedMethod)throw Error('switch_cancellation_source_requested_method_invalid')
 if(!input.actorUserId||b.companyId!==input.companyId||b.switchRequestId!==input.switchRequestId
  ||!['test','production'].includes(b.environment)||!['L','LK'].includes(b.originalSubtype)||!['9','89'].includes(b.identityAgency)
  ||typeof b.originalMessageId!=='string'||!b.originalMessageId||!/^[a-f0-9]{64}$/.test(b.originalHash))return held()
 const basisHash=digest(JSON.stringify(b))
 const{data:row,error:readError}=await (tenantDb(input.companyId).from('ediel_messages').select('id,company_id,environment,direction,message_standard,message_family,message_code,customer_id,intent_id,communication_route_id,created_by,raw_payload,immutable_rendered_at,immutable_payload_hash') as ScopedSelect).eq('id',b.originalMessageId).returns<Record<string,unknown>[]>().maybeSingle()
 if(readError)throw readError
 if(!row||row.id!==b.originalMessageId||row.company_id!==b.companyId||row.environment!==b.environment
  ||row.customer_id!==b.customerId
  ||row.direction!=='outbound'||row.message_standard!=='edifact'||row.message_family!=='PRODAT'||row.message_code!=='Z03'
  ||!row.immutable_rendered_at||row.immutable_payload_hash!==b.originalHash||typeof row.raw_payload!=='string'||!row.raw_payload
  ||digest(row.raw_payload)!==b.originalHash)return held()
 let projection:Projection
 try{
  const raw=row.raw_payload,wire=tokenizeEdifact(raw),{segments,una}=wire
  const grammar=validateUnsmGrammar(wire)
  if(!raw.endsWith(una.segmentTerminator)||!validateEdifactEnvelope(raw).ok||!grammar.syntaxOk||grammar.qualification!=='qualified'
   ||segments.filter(s=>s.tag==='UNH').length!==1||segments.filter(s=>s.tag==='LIN').length!==1)return held()
  // Keep original physical text: legacy token raw trimming must not rewrite1154.
  const parts=(s:EdifactTokenizedSegment|undefined,n:number)=>segmentComposite(s?{...s,raw:segmentOriginalRaw(s)??s.raw}:undefined,n,una)
  if(parts(segments.find(s=>s.tag==='UNH'),2).join('|')!=='PRODAT|D|97A|UN|E2SE6A')return held()
  const lin=segments.findIndex(s=>s.tag==='LIN'),own=segments.slice(lin,segments.findIndex(s=>s.tag==='UNT'))
  if(parts(own[0],3).join('|')!==[b.pointId,'','',b.identityAgency].join('|'))return held()
  if(['FR','DO'].some(role=>segments.slice(0,lin).filter(s=>s.tag==='NAD'&&parts(s,1).join('|')===role).length!==1))return held()
  if(readProdatParty('FR',segments,una).id!==b.legalSenderId||readProdatParty('DO',segments,una).id!==b.legalReceiverId
   ||segments.filter(s=>s.tag==='BGM').length!==1||parts(segments.find(s=>s.tag==='BGM'),1)[0]!=='Z03')return held()
  const firstParty=own.findIndex(s=>s.tag==='NAD'),objectFields=firstParty<0?own:own.slice(0,firstParty)
  const reference=(name:string)=>{
   const refs=objectFields.filter(s=>s.tag==='RFF'&&parts(s,1)[0]===name)
   if(refs.length!==1)return null
   const c=parts(refs[0],1),v=c[1]
   return refs[0].elements.length===2&&typeof v==='string'&&v.trim()&&Array.from(v).length<=35&&!/[\x00-\x1f\x7f]/.test(v)&&c.slice(2).every(x=>x==='')?v:null
  }
  const agreementReference=reference('ANJ')
  if(!agreementReference||reference('LI')!==b.li||reference('Z05')!==b.gridArea)return held()
  const characteristic=(name:string)=>{
   const ccis=objectFields.filter(s=>s.tag==='CCI'&&parts(s,2)[0]===name)
   if(ccis.length!==1)return null
   const at=objectFields.indexOf(ccis[0]),value=objectFields[at+1]
   return value?.tag==='CAV'&&parts(value,1).length===1?parts(value,1)[0]:null
  }
  if(characteristic('Z13')!==(b.originalSubtype==='L'?'Z22':'Z23')||characteristic('Z04')!==b.requestedMethod)return held()
  const starts=objectFields.filter(s=>s.tag==='DTM'&&parts(s,1)[0]==='92'),expected=renderProdatDateField('210',b.startAt)
  if(starts.length!==1||!expected||parts(starts[0],1).join('|')!==segmentComposite(tokenizeEdifact(expected+"'").segments[0],1).join('|'))return held()
  const uds=own.filter(s=>s.tag==='NAD'&&parts(s,1).join('|')==='UD'),brps=own.filter(s=>s.tag==='NAD'&&parts(s,1).join('|')==='Z02')
  if(uds.length!==1||brps.length>1)return held()
  const user=readProdatParty('UD',own,una),brp=readProdatParty('Z02',own,una)
  if(!user.identityValid||user.id!==b.customerIdentity||user.idQualifier!==b.customerQualifier||user.agency!=='260'
   ||!user.name||!user.addressLines.some(v=>v&&v!=='.')||!user.city||!user.postalCode||!user.country
   ||brps.length===1&&!brp.identityValid)return held()
  // Reject a lossy legacy trim rather than silently changing original slots.
  if(parts(uds[0],4).join('|')!==user.nameLines.join('|')||parts(uds[0],5).join('|')!==user.addressLines.join('|')
   ||parts(uds[0],6).join('|')!==user.city||parts(uds[0],8).join('|')!==user.postalCode||parts(uds[0],9).join('|')!==user.country)return held()
  // P26.A: a first-slot '.' is only the wire marker for an allowed-empty first
  // street component; map it back to its source slot and require an exact round trip.
  const addressLines=user.addressLines[0]==='.'?['',...user.addressLines.slice(1)]:[...user.addressLines]
  if(addressLines.includes('.')||JSON.stringify(prodatEndUserAddressWireLines(addressLines))!==JSON.stringify(user.addressLines))return held()
  projection={customerMasterdataContext:null,agreementReference,customerName:user.name,customerNameLines:user.nameLines,customerAddressLines:addressLines,
   customerCity:user.city,customerPostalCode:user.postalCode,customerCountry:user.country,balanceResponsibleId:brp.id,invoicee:null,
   facts:{market:'electricity',endUserAddressObjects:[{meteringPointId:b.pointId,identityAgency:b.identityAgency,
    endUser:{id:user.id,qualifier:b.customerQualifier,agency:'260'},availability:'available',addressLines,
    source:{kind:'caller_selection',companyId:b.companyId,reference:`immutable-original:${b.originalMessageId}:${b.originalHash}`}}]}}
 }catch{return held()}
 // Qualify the exact immutable original for this current preparer. The
 // dedicated reader preserves prepare-only and different-creator eligibility.
 const context=await loadSwitchCancellationCustomerMasterdataValidationContext(row as unknown as EdielMessageRow,b.switchRequestId,input.actorUserId)
 if(!context||customerMasterdataSendIssue(row,context))return held()
 projection.customerMasterdataContext=context
 projection.facts.endUserAddressObjects=createCustomerMasterdataAddressFacts({projection:context.projection,meteringPointId:b.pointId,identityAgency:b.identityAgency})
 return qualifyBilling(b,input.actorUserId,projection,basisHash)
}
async function qualifyBilling(b:SwitchCancellationBasis,actorUserId:string,projection:Projection,basisHash:string):Promise<SwitchCancellationBasis|SwitchCancellationHeld>{
 const{data:selection,error}=await (tenantDb(b.companyId).from('supplier_switch_requests').select('id,company_id,customer_id,site_id,customer_site_id,metering_point_id,contract_id,customer_contract_id') as ScopedSelect).eq('id',b.switchRequestId).returns<Record<string,unknown>[]>().maybeSingle()
 if(error)throw error
 if(!selection||selection.id!==b.switchRequestId||selection.company_id!==b.companyId||selection.customer_id!==b.customerId
  ||selection.metering_point_id!==b.meteringPointId||(selection.site_id??selection.customer_site_id)!==b.siteId
  ||selection.site_id&&selection.customer_site_id&&selection.site_id!==selection.customer_site_id
  ||selection.contract_id&&selection.customer_contract_id&&selection.contract_id!==selection.customer_contract_id)return held()
 const contractId=selection.customer_contract_id??selection.contract_id
 if(typeof contractId!=='string'||!contractId)return held()
 const billing=await readContractInvoicee({companyId:b.companyId,customerId:b.customerId,contractId,meteringPointId:b.pointId,identityAgency:b.identityAgency,
   endUser:{identity:{id:b.customerIdentity,qualifier:b.customerQualifier,agency:'260'},nameParts:projection.customerNameLines,
    streetParts:projection.customerAddressLines,postalCode:projection.customerPostalCode,city:projection.customerCity,country:projection.customerCountry}})
 if(digest(JSON.stringify(b))!==basisHash)return held()
 projection.invoicee=billing.invoicee
 projection.facts.invoiceeObjects=[billing.fact]
 qualified.set(b,{actorUserId,basisHash,projection})
 return b
}
export async function reserveSwitchCancellationSource(input:{companyId:string;switchRequestId:string;actorUserId:string;intentId:string;outboundRequestId:string}):Promise<{status:'reserved';operationId:string;intentId:string;outboundRequestId:string;messageId:string|null}|SwitchCancellationHeld>{
 const{data,error}=await supabaseService.rpc('ediel_reserve_switch_cancellation_v1',{p_company_id:input.companyId,p_switch_id:input.switchRequestId,p_actor_user_id:input.actorUserId,p_intent_id:input.intentId,p_outbound_request_id:input.outboundRequestId})
 if(error)throw error
 if(!data||!['reserved','held'].includes(data.status))throw Error('switch_cancellation_reservation_result_invalid')
 return data
}
export function assertSwitchCancellationRoute(b:SwitchCancellationBasis,route:Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>){
 if(route.companyId!==b.companyId||route.environment!==b.environment||route.actor.tenantIdentity?.legalActorId!==b.legalActorId||route.actor.legalActorEdielId!==b.legalSenderId
  ||route.receiverEdielId!==b.legalReceiverId||!route.actor.marketRoles.includes('electricity_supplier')||route.applicationReference!=='23-DDQ-PRODAT')throw Error('switch_cancellation_canonical_legal_route_mismatch')
}
