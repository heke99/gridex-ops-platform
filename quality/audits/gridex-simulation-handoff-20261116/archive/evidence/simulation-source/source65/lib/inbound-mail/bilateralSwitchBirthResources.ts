import {supabaseService} from '@/lib/supabase/service'
import {parseCanonicalEdielPayload} from '@/lib/ediel/core/canonicalMessage'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {prodatCharacteristicValues} from '@/lib/ediel/prodat/prodatCharacteristicFields'
import {prodatRegisterFieldState} from '@/lib/ediel/prodat/prodatRegisterFields'
import {prodatRegisterGroups,prodatRegisterRuleScopes} from '@/lib/ediel/prodat/prodatRegisterGroups'
import type {InboundEntityMatch} from '@/lib/inbound-mail/inboundMatcher'

const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
export type BilateralSwitchBirthResources=Readonly<{
 companyId:string;requestId:string;customerId:string;siteId:string;pointId:string
}>

/** Snapshot references after actor authorization, before receipt/catalog awaits.
 * A matched request is correlation, not business or bilateral authority. */
export function captureBilateralSwitchBirthResources(input:{companyId:string;
 outboundMatch?:InboundEntityMatch|null;meteringPointMatch?:InboundEntityMatch|null
}):BilateralSwitchBirthResources|null{
 const companyId=input.companyId,meterStatus=input.meteringPointMatch?.status??'not_checked',match=input.outboundMatch
 if(!['missing','not_checked'].includes(meterStatus)||!uuid(companyId)||!match)return null
 const {status,entityType,entityId,candidates}=match
 if(status!=='matched'||entityType!=='outbound_request'||!uuid(entityId)||!Array.isArray(candidates)||candidates.length!==1)return null
 const row=candidates[0]
 if(!row||typeof row!=='object'||Array.isArray(row))return null
 const {id,company_id,customer_id,site_id,metering_point_id,request_type}=row
 if(id!==entityId||company_id!==companyId||request_type!=='supplier_switch'
  ||!uuid(customer_id)||!uuid(site_id)||!uuid(metering_point_id))return null
 return Object.freeze({companyId,requestId:id,customerId:customer_id,siteId:site_id,pointId:metering_point_id})
}

/** Read-only qualification of a missing first-birth reference. The caller must
 * have selected the actual positive H catalog branch. Private original/ACK/
 * business owners still requalify their current source under their own locks. */
export async function resolveBilateralSwitchBirthResources(input:{
 candidate:BilateralSwitchBirthResources;rawPayload:string|null|undefined;environment:'test'|'production'
}):Promise<BilateralSwitchBirthResources|null>{
 const source=input.candidate,candidate={companyId:source.companyId,requestId:source.requestId,customerId:source.customerId,siteId:source.siteId,pointId:source.pointId},rawPayload=input.rawPayload,environment=input.environment
 if(!['test','production'].includes(environment)||!Object.values(candidate).every(uuid)
  ||!validateEdifactEnvelope(rawPayload).syntaxOk)return null
 const {segments,una}=tokenizeEdifact(rawPayload),unhs=segments.filter(t=>t.tag==='UNH'),bgms=segments.filter(t=>t.tag==='BGM')
 if(unhs.length!==1||bgms.length!==1||segmentComposite(bgms[0],1,una)[0]!=='Z04')return null
 const association=segmentComposite(unhs[0],2,una)
 if(association.length!==5||association.slice(0,4).join(':')!=='PRODAT:D:97A:UN'||!association[4])return null
 const canonical=parseCanonicalEdielPayload({rawPayload,direction:'inbound',standardHint:'edifact'})
 if(canonical.family!=='PRODAT'||canonical.messageCode!=='Z04'||canonical.applicationReference!=='23-DDQ-PRODAT')return null
 const {groups,problems}=prodatRegisterGroups(segments,una,'Z04'),first=groups[0]
 if(problems.length||!first||!first.itemId||!['9','89'].includes(first.identityAgency??'')
  ||groups.some(group=>{
   const identity=prodatRegisterFieldState('209',group.segments,una)
   return !group.validRegisterChain||!identity?.present||identity.malformed||group.messageIndex!==first.messageIndex
    ||group.itemId!==first.itemId||group.identityAgency!==first.identityAgency
  }))return null
 const reasons=prodatRegisterRuleScopes('223',segments,una,'Z04')??[]
 if(!reasons.length||!reasons.every(scope=>{
  const values=prodatCharacteristicValues('223',scope,una);return values.length===1&&values[0]==='Z25'
 }))return null
 const {data:request,error:requestError}=await supabaseService.from('outbound_requests')
  .select('id,company_id,customer_id,site_id,metering_point_id,request_type,payload')
  .eq('company_id',candidate.companyId).eq('id',candidate.requestId).maybeSingle()
 if(requestError)throw requestError
 if(!request||request.id!==candidate.requestId||request.company_id!==candidate.companyId||request.request_type!=='supplier_switch'
  ||request.customer_id!==candidate.customerId||request.site_id!==candidate.siteId||request.metering_point_id!==candidate.pointId
  ||!request.payload||typeof request.payload!=='object'||Array.isArray(request.payload)||request.payload.environment!==environment)return null
 const {data:point,error:pointError}=await supabaseService.from('metering_points')
  .select('id,company_id,customer_id,site_id,customer_site_id,ediel_metering_point_id')
  .eq('company_id',candidate.companyId).eq('id',candidate.pointId).maybeSingle()
 if(pointError)throw pointError
 if(!point||point.id!==candidate.pointId||point.company_id!==candidate.companyId||point.customer_id!==candidate.customerId
  ||point.site_id!==candidate.siteId
  ||(point.customer_site_id!==null&&point.customer_site_id!==candidate.siteId)||point.ediel_metering_point_id!==first.itemId)return null
 const {data:customer,error:customerError}=await supabaseService.from('customers')
  .select('id,company_id').eq('company_id',candidate.companyId).eq('id',candidate.customerId).maybeSingle()
 if(customerError)throw customerError
 if(!customer||customer.id!==candidate.customerId||customer.company_id!==candidate.companyId)return null
 const {data:site,error:siteError}=await supabaseService.from('customer_sites')
  .select('id,company_id,customer_id').eq('company_id',candidate.companyId).eq('id',candidate.siteId).maybeSingle()
 if(siteError)throw siteError
 if(!site||site.id!==candidate.siteId||site.company_id!==candidate.companyId||site.customer_id!==candidate.customerId)return null
 return Object.freeze(candidate)
}
