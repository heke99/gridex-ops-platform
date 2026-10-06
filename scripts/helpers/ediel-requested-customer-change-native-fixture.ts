// Real local signed contract/source pipeline and public archive/review commands.
// Only remote issuer/key/representation facts and SMTP are synthetic boundaries.
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {expect} from 'vitest'
import {createRequestedChangeSupplyFixture} from './ediel-requested-change-native-fixture'
import {createBilateralSourceOperator,customerChangeMinute} from './ediel-bilateral-customer-native-fixture'
import {bilateralCustomerNativeWire} from './ediel-bilateral-customer-native-wire'
import {nativeSql as sql,literal,futureNativeSupplyDate} from './ediel-normal-switch-native-fixture'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact,segmentSourceSpan,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {reviewReceivedStructuralSource} from '@/lib/ediel/sources/reviewReceivedStructuralSource'
import type {RequestedCustomerChangeSubmission} from '@/lib/ediel/production/requestedCustomerChangeSource'
export async function createRequestedCustomerChangeNativeFixture(provider:(email:string)=>void){
 const f=await createRequestedChangeSupplyFixture(provider,{requestedStartDate:futureNativeSupplyDate()}),uploader=await createBilateralSourceOperator(f.companyId),reviewer=await createBilateralSourceOperator(f.companyId),reader=await createBilateralSourceOperator(f.companyId,['communication.read','customers.read','contracts.read'])
 expect(await reviewReceivedStructuralSource({companyId:f.companyId,environment:'test',sourceMessageId:f.source,reviewerUserId:reviewer.id,confirmedOriginal:true,replacesSourceMessageId:null})).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
 // The customer flow automatically selects a generic tenant route. The
 // supply fixture's grid-specific supplier_switch/Z03 route is a different
 // public configuration input and remains unchanged.
 const customerRouteId=randomUUID(),customerRouteProfileId=randomUUID()
 sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email) VALUES(${literal(customerRouteId)},${literal(f.companyId)},'Synthetic requested customer route','customer_masterdata',NULL,'bilateral_test',true,'recipient@example.invalid');
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,transport_security_mode,smtp_to,receiver_email,message_family,business_code) VALUES(${literal(customerRouteProfileId)},${literal(f.companyId)},${literal(customerRouteId)},'Synthetic requested customer profile','test','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,'unencrypted','recipient@example.invalid','recipient@example.invalid','PRODAT','Z09');`)
 const counterparty=sql<string>(`SELECT to_jsonb(actor_id) FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=${literal(f.receiver)} AND is_verified`),agreementId=randomUUID(),keyId=randomUUID(),representationId=randomUUID(),secret=Buffer.from('SYNTHETIC OUTGOING EXTERNAL ISSUER ONLY 0123456789012345'),authorityHash=createHash('sha256').update('SYNTHETIC OUTGOING LEGAL MANDATE CONTROL ONLY').digest('hex')
 sql(`INSERT INTO public.tenant_bilateral_agreements(id,company_id,environment,counterparty_actor_id,capability_code,terms,is_enabled,valid_from,valid_to,source_reference)VALUES(${literal(agreementId)},${literal(f.companyId)},'test',${literal(counterparty)},'prodat_z09e_requested_customer_change','{}',true,'2020-01-01','2099-01-01','SYNTHETIC outgoing legal mandate control');`)
 let rawPayload=bilateralCustomerNativeWire({sender:f.sender,receiver:f.receiver,point:f.external,customerIdentity:f.customerIdentity.id,reference:'LI'+randomUUID().replaceAll('-','').toUpperCase(),marketMinute:customerChangeMinute(f.requestedStartDate),repeatRegister:false,invoicee:true}).replace('BGM+Z06+','BGM+Z09+')
 // National Z09 forbids C829/repeated registers, Z12 reporting frequency
 // and installation-address IT. Keep mandatory BRP Z02 and complete UD/IV.
 // Encode the retained physical segments so actual envelope counts agree.
 const base=EdifactEnvelopeCodec.decode(rawPayload)
 let omitFrequency=false
 const body=base.segments.filter(segment=>{
  if(segment.tag==='CCI')omitFrequency=segmentComposite(segment,2,base.una)[0]==='Z12'
  else if(segment.tag!=='CAV')omitFrequency=false
  return !['UNB','UNH','UNT','UNZ'].includes(segment.tag)&&!omitFrequency&&!(segment.tag==='NAD'&&segmentComposite(segment,1,base.una)[0]==='IT')
 }).map(segment=>segment.raw)
 const unh=base.segments.find(segment=>segment.tag==='UNH')!
 rawPayload=EdifactEnvelopeCodec.encode({sender:f.sender,receiver:f.receiver,senderQualifier:base.senderQualifier,receiverQualifier:base.receiverQualifier,senderSubAddress:base.senderSubAddress,receiverSubAddress:base.receiverSubAddress,applicationReference:base.applicationReference,acknowledgementRequest:true,environment:'test',interchangeReference:base.interchangeReference!,messages:[{messageReference:segmentComposite(unh,1,base.una)[0],messageTypeToken:unh.elements[2],businessSegments:body}]})
 const headerClock=sql<{unb:string;dtm:string}>(`SELECT jsonb_build_object('unb',to_char(clock_timestamp() AT TIME ZONE 'Etc/GMT-1','YYMMDD:HH24MI'),'dtm',to_char(clock_timestamp() AT TIME ZONE 'Etc/GMT-1','YYYYMMDDHH24MI'))`)
 let tokens=tokenizeEdifact(rawPayload);const header=tokens.segments.find(s=>s.tag==='UNB')!,span=segmentSourceSpan(header)!,parts=header.raw.split(tokens.una.dataElementSeparator);parts[4]=headerClock.unb
 rawPayload=rawPayload.slice(0,span.startOffset)+parts.join(tokens.una.dataElementSeparator)+rawPayload.slice(span.endOffset);tokens=tokenizeEdifact(rawPayload)
 const created=tokens.segments.find(s=>s.tag==='DTM'&&segmentComposite(s,1,tokens.una)[0]==='137')
 if(created){const location=segmentSourceSpan(created)!;rawPayload=rawPayload.slice(0,location.startOffset)+`DTM+137:${headerClock.dtm}:203`+rawPayload.slice(location.endOffset)}
 const claims=sql<Record<string,unknown>>(`SELECT gridex_requested_customer_changes.source_claims_v1(${literal(f.companyId)},'test',${literal(agreementId)},${literal(f.period)},${literal(f.contractId)},${literal(rawPayload)})`)
 expect(claims.supplyQualified).toBe(true)
 // Explicit external registry controls only; no private ready artifact, review,
 // classification, event, original or receipt is directly inserted.
 sql(`INSERT INTO gridex_requested_customer_changes.issuer_keys(id,company_id,environment,counterparty_actor_id,legal_authority_reference,legal_authority_hash,receipt_signing_key,valid_from,valid_to)VALUES(${literal(keyId)},${literal(f.companyId)},'test',${literal(counterparty)},'SYNTHETIC external issuer competence',${literal(authorityHash)},decode('${secret.toString('hex')}','hex'),'2020-01-01','2099-01-01');
 INSERT INTO gridex_requested_customer_changes.representations(id,company_id,environment,issuer_key_id,legal_actor_id,agreement_id,purpose,legal_authority_reference,legal_authority_hash,valid_from,valid_to)VALUES(${literal(representationId)},${literal(f.companyId)},'test',${literal(keyId)},${literal(String(claims.legalActorId))},${literal(agreementId)},'prodat_z09e_requested_customer_change','SYNTHETIC external legal representation',${literal(authorityHash)},'2020-01-01','2099-01-01')`)
 const clause={locator:'SYNTHETIC outgoing agreement page1',quote:'The synthetic DSO authorizes this exact requested customer and invoicee change.'},pdf=(label:string)=>Buffer.from(`%PDF-1.7\nSYNTHETIC ${label}\n${clause.quote}\n%%EOF`)
 function submission(reference:string,bytes:Buffer,withReceipt=true):RequestedCustomerChangeSubmission{
  const actual=sql<Record<string,unknown>>(`SELECT gridex_requested_customer_changes.source_claims_v1(${literal(f.companyId)},'test',${literal(agreementId)},${literal(f.period)},${literal(f.contractId)},${literal(rawPayload)})`)
  const receiptBytes=Buffer.from(JSON.stringify({format:'ediel_requested_customer_change_receipt_v1',purpose:'prodat_z09e_requested_customer_change',receiptId:randomUUID(),claims:actual,sourceHash:createHash('sha256').update(bytes).digest('hex'),sourceReference:reference,sourceVersion:'1',authorizedFields:['227','228','229','231','232','316','250','251','252','253','317','318'],clause,issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()}))
  return{environment:'test',agreementId,supplyPeriodId:f.period,contractId:f.contractId,rawPayload,source:{bytesBase64:bytes.toString('base64'),mimeType:'application/pdf',reference,version:'1'},...(withReceipt?{issuerReceipt:{keyId,representationId,payloadBase64:receiptBytes.toString('base64'),signatureHex:createHmac('sha256',secret).update(receiptBytes).digest('hex')}}:{})}
 }
 return{...f,uploader,reviewer,reader,agreementId,keyId,representationId,rawPayload,clause,pdf,submission}
}
