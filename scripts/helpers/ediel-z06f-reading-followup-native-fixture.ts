// Genuine local producer chain only. The customer/legal/SMTP inputs are
// declared disposable synthetic facts; private accepted owners are never seeded.
import {randomUUID} from 'node:crypto'
import {expect} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {nativeSql as sql,literal,futureNativeSupplyDate} from './ediel-normal-switch-native-fixture'
import {createRequestedChangeSupplyFixture} from './ediel-requested-change-native-fixture'
import {createBilateralSourceOperator} from './ediel-bilateral-customer-native-fixture'
import {z06fNativeStructureWire,z06fNativeReadingWire,type Z06fNativeReadingOptions} from './ediel-z06f-reading-followup-native-wire'
import {utiltsNativeSourceFixture} from '../../__tests__/helpers/utiltsNativeSourceFixture'
import {registerUtiltsIssuer,seedUtiltsIssuerHistoryGround} from './utiltsConsumptionParties'
import {tokenizeEdifact,segmentSourceSpan,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {reviewReceivedStructuralSource} from '@/lib/ediel/sources/reviewReceivedStructuralSource'
import {approveSafeMasterdataChanges} from '@/lib/ediel/safeApplyReview'
import {resolveCanonicalRuntimeDecisionWithRegistry,readCanonicalUtiltsIssuerIdentityAuthority,readCanonicalPeriodicReasonAuthority} from '@/lib/ediel/core/runtimeDecision'
import {captureFreshEdielSourceRulePackEvidence} from '@/lib/ediel/core/sourceRulePackEvidence'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {createReceivedSourceOwnerSession} from '@/lib/ediel/sources/receivedSourceOwnerSession'
import {initialCanonicalUtiltsDecision,recordFinalCanonicalUtiltsDecision} from '@/lib/ediel/flows/utiltsCanonicalValidation'
import {runUtiltsRuntimeForMessage,utiltsRuntimeSegments} from '@/lib/ediel/utiltsEngine'
import {qualifyReceivedUtiltsStructure} from '@/lib/ediel/utilts/qualifyReceivedStructure'
import {matchUtiltsTransactionsForTenant} from '@/lib/ediel/flows/utiltsDataRequest.part-1'
import {prepareUtiltsConsumptionContracts} from '@/lib/ediel/utilts/consumptionPreparation'
import {buildUtiltsTransactionPersistencePayload,persistUtiltsTransactionResults} from '@/lib/ediel/utilts/transactionPersistence'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'
import {seedOriginalMailboxNative,recordOriginalMailboxNativeReception} from './originalMailboxNative'

type Z06fChangeInputOptions={rawTransform?:(raw:string)=>string;direction?:'inbound'|'outbound'}
type Z06fChangeOptions=Z06fChangeInputOptions&{deferFirstApply?:boolean}

/** Editing creates a new physical input before admission. Only its UNT count
 * changes automatically; no accepted source or existing original is rewritten. */
function recountChangedMessage(raw:string){
 const wire=tokenizeEdifact(raw),heads=wire.segments.filter(segment=>segment.tag==='UNH'),tails=wire.segments.filter(segment=>segment.tag==='UNT')
 if(heads.length!==1||tails.length!==1)throw Error('native_change_single_message_required')
 const head=heads[0],tail=tails[0],span=segmentSourceSpan(tail)
 if(!span||tail.index<=head.index||segmentComposite(head,1,wire.una)[0]!==segmentComposite(tail,2,wire.una)[0])throw Error('native_change_message_reference_required')
 const parts=tail.raw.split(wire.una.dataElementSeparator);parts[1]=String(tail.index-head.index+1)
 return raw.slice(0,span.startOffset)+parts.join(wire.una.dataElementSeparator)+raw.slice(span.endOffset)
}

function stampTest(raw:string,reference:string){
 const t=tokenizeEdifact(raw),unb=t.segments.find(x=>x.tag==='UNB')!,span=segmentSourceSpan(unb)!,parts=unb.raw.split(t.una.dataElementSeparator)
 while(parts.length<12)parts.push('');parts[5]=reference;parts[9]='1';parts[11]='1'
 const unz=t.segments.find(x=>x.tag==='UNZ')!,tail=segmentSourceSpan(unz)!,tailParts=unz.raw.split(t.una.dataElementSeparator);tailParts[2]=reference
 return raw.slice(0,span.startOffset)+parts.join(t.una.dataElementSeparator)+raw.slice(span.endOffset,tail.startOffset)+tailParts.join(t.una.dataElementSeparator)+raw.slice(tail.endOffset)
}
export async function createZ06fReadingNativeFixture(provider:(email:string)=>void){
 // Future supply is original declared source valid time; every source admission
 // remains its real native clock_timestamp(), never the UNB or selected date.
 const f=await createRequestedChangeSupplyFixture(provider,{requestedStartDate:futureNativeSupplyDate()})
 const operator=await createBilateralSourceOperator(f.companyId,['communication.read','communication.write','communication.send','customers.read','metering.read','metering.write','ediel_testing.write'])
 expect(sql(`SELECT to_jsonb(EXISTS(SELECT FROM public.admin_users WHERE user_id IN(${literal(f.actorUserId)},${literal(operator.id)})))`)).toBe(false)
 expect(await reviewReceivedStructuralSource({companyId:f.companyId,environment:'test',sourceMessageId:f.source,reviewerUserId:operator.id,confirmedOriginal:true,replacesSourceMessageId:null})).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
 const capture=async(raw:string,family:'PRODAT'|'UTILTS',code:string,profile:string|null,direction:'inbound'|'outbound'='inbound')=>{
  const fresh=utiltsNativeSourceFixture(stampTest(raw,randomUUID().replaceAll('-','').slice(0,14)),randomUUID()),id=fresh.id
  // IMP05 (20261005130401): a prescribed CONTRL/APERAK returns from the mailbox
  // the inbound PRODAT original actually reached. Birth that retained mail
  // prospectively, link both mail columns and record its first reception via
  // the canonical SEND-authorized owner. Outbound input has no reception.
  const mail=direction==='inbound'&&family==='PRODAT'?await seedOriginalMailboxNative(sql,literal,{companyId:f.companyId,environment:'test',raw:fresh.raw,smtpFrom:edielSmtpConfig().from}):null
  sql(`INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,execution_context_snapshot,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference,${mail?'inbound_email_message_id,mailbox_message_id,':''}canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
  SELECT ${literal(id)},${literal(f.companyId)},${literal(f.customerId)},${literal(f.siteId)},${literal(f.pointId)},${literal(f.gridId)},'test',${literal(direction)},'edifact',${literal(family)},${literal(code)},'received',${literal(fresh.raw)},${family==='PRODAT'?`'{"prodatDependentFacts":{"market":"electricity","meterReadingsSentInUtilts":true}}'`:"'{}'"},clock_timestamp(),'{}',${literal(fresh.parsed.applicationReference)},${literal(fresh.parsed.senderEdielId)},${literal(fresh.parsed.receiverEdielId)},${literal(fresh.parsed.interchangeReference)},${mail?literal(mail.inboundEmailMessageId)+','+literal(mail.inboundEmailMessageId)+',':''}pack.id,p.profile_key,p.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,p.profile
  FROM public.ediel_message_profiles p JOIN public.ediel_rule_packs pack ON pack.id=p.rule_pack_id WHERE p.message_code=${literal(code)} AND p.direction IN('inbound','both') AND p.is_enabled ${profile?`AND p.profile_key=${literal(profile)}`:''} ORDER BY p.profile_key LIMIT 1;`)
  if(mail)await recordOriginalMailboxNativeReception({companyId:f.companyId,sourceMessageId:id,actorUserId:f.actorUserId,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,sourcePayloadHash:mail.sourcePayloadHash})
  const result=await supabaseService.from('ediel_messages').select('*').eq('id',id).single();expect(result.error).toBeNull()
  const message=result.data as EdielMessageRow;expect(message.message_received_at).toBeTruthy()
  if(mail)expect(message).toMatchObject({inbound_email_message_id:mail.inboundEmailMessageId,mailbox_message_id:mail.inboundEmailMessageId})
  return message
 }
 // Negative/held controls receive only their actual admitted original. They
 // must invoke the real processor/reviewer and observe its own disposition.
 const captureChange=async(kind:'F'|'G'='F',document=randomUUID().replaceAll('-',''),options:Z06fChangeInputOptions={})=>{
  const raw=z06fNativeStructureWire(f,kind,document)
  const input=options.rawTransform?recountChangedMessage(options.rawTransform(raw)):raw
  return capture(input,'PRODAT','Z06',`PRODAT:Z06:${kind}:26.A:r3`,options.direction)
 }
 const change=async(kind:'F'|'G'='F',document=randomUUID().replaceAll('-',''),options:Z06fChangeOptions={})=>{
  const message=await captureChange(kind,document,options),decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
  const recorded=await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:f.companyId,decision});expect(recorded.status).toBe('recorded');
 // Production inbound order: record validation, then capture the frozen rule-pack basis.
 await captureFreshEdielSourceRulePackEvidence(f.companyId,message.id);
  const owner=createReceivedSourceOwnerSession(recorded);expect(owner).not.toBeNull();await owner!.finish()
  expect(await reviewReceivedStructuralSource({companyId:f.companyId,environment:'test',sourceMessageId:message.id,reviewerUserId:operator.id,confirmedOriginal:true,replacesSourceMessageId:null})).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
  const apply=()=>approveSafeMasterdataChanges({edielMessageId:message.id,actorUserId:operator.id})
  if(!options.deferFirstApply)expect(await apply()).toMatchObject({status:'applied',appliedCount:1})
  return {message,apply}
 }
 const reading=async(options:Z06fNativeReadingOptions={})=>{
  const raw=z06fNativeReadingWire(f,options)
  // The grid-owner issuer carries its synthetic approved issuer registration
  // and a reviewed history ground bound to this admission (as in the ESCO suite).
  registerUtiltsIssuer(sql,literal,f.receiver,f.actorUserId)
  const message=await capture(raw,'UTILTS','E66','UTILTS:E66:E5SE5A:current-r3')
  seedUtiltsIssuerHistoryGround(sql,literal,message.id,f.actorUserId)
  const initial=await initialCanonicalUtiltsDecision(message),policy=initial.policy
  const issuerIdentityAuthority=readCanonicalUtiltsIssuerIdentityAuthority({decision:initial,message})??undefined,periodicReasonAuthority=readCanonicalPeriodicReasonAuthority({decision:initial,message})??undefined
  const provisional=runUtiltsRuntimeForMessage(message,{canonicalPolicy:policy,issuerIdentityAuthority,periodicReasonAuthority}),matches=await matchUtiltsTransactionsForTenant({message,facts:provisional.facts})
  const validated:EdielMessageRow={...message,business_match_status:matches.every(x=>x.matchStatus==='matched')?'matched':'unmatched',parsed_payload:{...message.parsed_payload,utiltsTransactionMatches:matches,normalizedMeteringPayload:{...provisional.normalizedPayload,utiltsTransactionMatches:matches}}}
  const qualified=await qualifyReceivedUtiltsStructure({message:validated,canonicalPolicy:policy,issuerIdentityAuthority,periodicReasonAuthority,runtime:runUtiltsRuntimeForMessage(validated,{canonicalPolicy:policy,issuerIdentityAuthority,periodicReasonAuthority})})
  await recordFinalCanonicalUtiltsDecision({original:message,validated,initialDecision:initial,runtime:qualified.runtime})
  const contracts=await prepareUtiltsConsumptionContracts({message:validated,runtime:qualified.runtime,policy,matches,dataRequest:null,fallback:{customerId:f.customerId,siteId:f.siteId,meteringPointId:f.pointId,gridOwnerId:f.gridId},allowConsumption:true})
  const input={actorUserId:operator.id,companyId:f.companyId,environment:'test' as const,sourceMessageId:message.id,messageCode:'E66',rawPayload:message.raw_payload!,contracts,transactions:buildUtiltsTransactionPersistencePayload({messageCode:'E66',transactions:qualified.runtime.facts.transactions,rawSegments:utiltsRuntimeSegments(qualified.runtime.facts),dispositions:qualified.runtime.transactionDispositions,matches})}
  return {message,qualified,input,persist:()=>persistUtiltsTransactionResults(input)}
 }
 const read=(source:string)=>supabaseService.rpc('ediel_read_z06f_reading_followup_v1',{p_company_id:f.companyId,p_environment:'test',p_actor_user_id:operator.id,p_source_message_id:source})
 const snapshots=()=>sql<Record<string,unknown>>(`SELECT jsonb_build_object('expectations',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM gridex_received_reading_expectations.expectations e WHERE company_id=${literal(f.companyId)}),'observations',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.expectation_id,o.transaction_id),'[]') FROM gridex_received_reading_expectations.observations o WHERE company_id=${literal(f.companyId)}),'series',(SELECT count(*) FROM public.meter_reading_series WHERE company_id=${literal(f.companyId)}),'contracts',(SELECT count(*) FROM gridex_utilts_binding.contracts WHERE company_id=${literal(f.companyId)}),'reservations',(SELECT count(*) FROM public.ediel_ack_transaction_results WHERE company_id=${literal(f.companyId)}),'outbound',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND direction='outbound'))`)
 return {f,operator,change,captureChange,reading,read,snapshots}
}
