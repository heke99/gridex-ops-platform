import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {isQualifiedCustomerMasterdataProjection,isQualifiedCustomerMasterdataValidationContext,type CustomerMasterdataValidationContext,type SourceQualifiedCustomerMasterdataProjection} from '@/lib/ediel/production/customerMasterdataSource'
import {END_USER_ADDRESS_CODES,prodatEndUserAddressWireLines,type ProdatEndUserAddressObject} from './prodatEndUserAddress'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'

export type CustomerMasterdataRenderingSource=Readonly<{kind:'customer_masterdata_rendering';companyId:string;environment:'test'|'production';rawPayload:string;projection:SourceQualifiedCustomerMasterdataProjection;authorizesPersistence:false;authorizesTransport:false}>
const renderingSources=new WeakSet<object>()
export function bindCustomerMasterdataRenderingSource(input:{companyId:string;environment:'test'|'production';rawPayload:string;projection:SourceQualifiedCustomerMasterdataProjection}):CustomerMasterdataRenderingSource{
 if(!isQualifiedCustomerMasterdataProjection(input.projection)||input.projection.companyId!==input.companyId||input.projection.environment!==null&&input.projection.environment!==input.environment||!input.rawPayload)throw Error('customer_masterdata_rendering_source_unqualified')
 const value=Object.freeze({...input,kind:'customer_masterdata_rendering' as const,authorizesPersistence:false as const,authorizesTransport:false as const});renderingSources.add(value);return value
}
export function isQualifiedCustomerMasterdataRenderingSource(value:unknown):value is CustomerMasterdataRenderingSource{return !!value&&typeof value==='object'&&renderingSources.has(value)}

/** A protected projection is required before rendering. Persisted source fields
 * remain selectors; after rendering only the actual RAW/intent/route binding
 * can authorize the same customer source at validation and send. */
export function createCustomerMasterdataAddressFacts(input:{projection:SourceQualifiedCustomerMasterdataProjection;meteringPointId:string;identityAgency:'9'|'89'}):ProdatEndUserAddressObject[]{
 const p=input.projection
 if(!isQualifiedCustomerMasterdataProjection(p)||!input.meteringPointId||input.meteringPointId!==input.meteringPointId.trim()||!['9','89'].includes(input.identityAgency))throw Error('customer_masterdata_address_source_unqualified')
 return [{meteringPointId:input.meteringPointId,identityAgency:input.identityAgency,endUser:{...p.customerIdentity},availability:'available',addressLines:[...p.endUserMasterdata.streetParts],
  source:{kind:'customer_masterdata',companyId:p.companyId,customerId:p.customerId,reference:p.sourceReference,sourceContextId:p.sourceContextId,sourceDigest:p.sourceDigest,asOf:p.asOf}}]
}

export type CustomerMasterdataSourceRow={direction?:string|null;message_family?:string|null;message_code?:string|null;company_id?:string|null;customer_id?:string|null;environment?:string|null;raw_payload?:string|null;intent_id?:string|null;communication_route_id?:string|null;parsed_payload?:unknown}
export function assertCustomerMasterdataContextMatches(row:CustomerMasterdataSourceRow,context:CustomerMasterdataValidationContext):void{
 if(!isQualifiedCustomerMasterdataValidationContext(context)||row.direction!=='outbound'||row.company_id!==context.companyId||row.customer_id!==context.customerId||row.environment!==context.environment||row.raw_payload!==context.rawPayload||row.intent_id!==context.intentId||row.communication_route_id!==context.routeId)throw Error('customer_masterdata_source_context_mismatch')
}

export function assertCustomerMasterdataAddressOwnership(object:ProdatEndUserAddressObject,context:CustomerMasterdataValidationContext|undefined,renderingSource?:CustomerMasterdataRenderingSource):void{
 if(object.source.kind!=='customer_masterdata')return
 if(!context&&!isQualifiedCustomerMasterdataRenderingSource(renderingSource)||context&&!isQualifiedCustomerMasterdataValidationContext(context))throw Error('customer_masterdata_address_source_unqualified')
 const p=context?.projection??renderingSource!.projection,s=object.source
 if(s.companyId!==p.companyId||s.customerId!==p.customerId||s.sourceContextId!==p.sourceContextId||s.sourceDigest!==p.sourceDigest||s.reference!==p.sourceReference||s.asOf!==p.asOf||object.availability!=='available'||object.endUser.id!==p.customerIdentity.id||object.endUser.qualifier!==p.customerIdentity.qualifier||object.endUser.agency!==p.customerIdentity.agency||JSON.stringify(object.addressLines)!==JSON.stringify(p.endUserMasterdata.streetParts))throw Error('customer_masterdata_address_source_mismatch')
}

/** Provenance equality, not a second national field engine. The common parser
 * and canonical policy still decide shape, applicability, and own LIN scope. */
export function customerMasterdataSendIssue(row:CustomerMasterdataSourceRow,context?:CustomerMasterdataValidationContext):EdielRulebookIssue|null{
 if(!context)return null // The native original/send gate requires live authority.
 const held=(description:string):EdielRulebookIssue=>({scope:'prodat_dependent',severity:'error',blocking:true,code:'PRODAT_CUSTOMER_MASTERDATA_SOURCE_UNQUALIFIED',title:'Kunduppgifter saknar eget källunderlag',description,fieldPath:'NAD+UD'})
 try{assertCustomerMasterdataContextMatches(row,context)}catch{return held('Skyddad kundkälla matchar inte egna meddelandebytes, kund, tenant, miljö, intent och route.')}
 return customerMasterdataWireIssue(context.rawPayload,row.message_family,row.message_code,context.projection)
}
export function customerMasterdataRenderingIssue(input:{rawPayload?:string|null;companyId?:string|null;environment?:string|null;family?:string|null;code?:string|null;source:CustomerMasterdataRenderingSource}):EdielRulebookIssue|null{
 if(!isQualifiedCustomerMasterdataRenderingSource(input.source)||input.rawPayload!==input.source.rawPayload||input.companyId!==input.source.companyId||input.environment!==input.source.environment)return {scope:'prodat_dependent',severity:'error',blocking:true,code:'PRODAT_CUSTOMER_MASTERDATA_SOURCE_UNQUALIFIED',title:'Renderingen saknar eget källunderlag',description:'Renderingskällan matchar inte faktiska bytes, tenant eller miljö.',fieldPath:'NAD+UD'}
 return customerMasterdataWireIssue(input.rawPayload,input.family,input.code,input.source.projection)
}
function customerMasterdataWireIssue(rawPayload:string,family:string|null|undefined,code:string|null|undefined,projection:SourceQualifiedCustomerMasterdataProjection):EdielRulebookIssue|null{
 const held=(description:string):EdielRulebookIssue=>({scope:'prodat_dependent',severity:'error',blocking:true,code:'PRODAT_CUSTOMER_MASTERDATA_SOURCE_UNQUALIFIED',title:'Kunduppgifter saknar eget källunderlag',description,fieldPath:'NAD+UD'})
 const wire=tokenizeEdifact(rawPayload),headers=wire.segments.filter(s=>s.tag==='UNH'),bgms=wire.segments.filter(s=>s.tag==='BGM')
 if(headers.length!==1||segmentComposite(headers[0],2,wire.una)[0]!=='PRODAT'||bgms.length!==1||!END_USER_ADDRESS_CODES.includes(segmentComposite(bgms[0],1,wire.una)[0]??'')||family!=='PRODAT'||code!==segmentComposite(bgms[0],1,wire.una)[0])return held('Kundkällan kräver sitt faktiska egna tillämpliga PRODAT-original.')
 const parties=wire.segments.filter(s=>s.tag==='NAD'&&segmentComposite(s,1,wire.una)[0]==='UD'),p=projection
 for(const party of parties){
  const identity=segmentComposite(party,2,wire.una),name=segmentComposite(party,4,wire.una),street=segmentComposite(party,5,wire.una)
  if(JSON.stringify(identity)!==JSON.stringify([p.customerIdentity.id,p.customerIdentity.qualifier,p.customerIdentity.agency])||JSON.stringify(name)!==JSON.stringify(p.endUserMasterdata.nameParts)||JSON.stringify(street)!==JSON.stringify(prodatEndUserAddressWireLines(p.endUserMasterdata.streetParts))||JSON.stringify(segmentComposite(party,6,wire.una))!==JSON.stringify([p.endUserMasterdata.city])||JSON.stringify(segmentComposite(party,8,wire.una))!==JSON.stringify([p.endUserMasterdata.postalCode])||JSON.stringify(segmentComposite(party,9,wire.una))!==JSON.stringify([p.endUserMasterdata.country]))return held('Faktiska UD-värden avviker från den skyddade källans identitet, namn eller folkbokföringsadress.')
 }
 return null
}
