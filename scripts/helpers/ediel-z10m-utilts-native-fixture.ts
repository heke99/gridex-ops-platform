// Disposable physical E66 inputs and actual canonical/storage owners for M.
// No F birth, accepted-source marker, fulfilled followup or live DSO send.
import {randomUUID} from 'node:crypto'
import {expect} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {nativeSql as sql,literal} from './ediel-normal-switch-native-fixture'
import {utiltsNativeSourceFixture,utiltsTestEnvironmentWire,utiltsRecountUnt} from '../../__tests__/helpers/utiltsNativeSourceFixture'
import {registerUtiltsIssuer,seedUtiltsIssuerHistoryGround} from './utiltsConsumptionParties'
import {initialCanonicalUtiltsDecision,recordFinalCanonicalUtiltsDecision} from '@/lib/ediel/flows/utiltsCanonicalValidation'
import {readCanonicalUtiltsIssuerIdentityAuthority,readCanonicalPeriodicReasonAuthority} from '@/lib/ediel/core/runtimeDecision'
import {runUtiltsRuntimeForMessage,utiltsRuntimeSegments} from '@/lib/ediel/utiltsEngine'
import {qualifyReceivedUtiltsStructure} from '@/lib/ediel/utilts/qualifyReceivedStructure'
import {matchUtiltsTransactionsForTenant} from '@/lib/ediel/flows/utiltsDataRequest.part-1'
import {prepareUtiltsConsumptionContracts} from '@/lib/ediel/utilts/consumptionPreparation'
import {buildUtiltsTransactionPersistencePayload,persistUtiltsTransactionResults} from '@/lib/ediel/utilts/transactionPersistence'
import {inspectStructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
import {canonicalUtiltsTransactions} from '@/lib/ediel/utilts/canonicalObservationScope'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import type {UtiltsConsumptionContract} from '@/lib/ediel/utilts/consumptionContract'

type MUtiltsScope={companyId:string;customerId:string;siteId:string;pointId:string;gridId:string;
  external:string;sender:string;receiver:string;gridAreaCode:string;actorUserId:string;reviewer:{id:string}}
type MMemberOptions={meter:string;registers:readonly string[];startValues:readonly string[];endValues:readonly string[];
  energy:string;period:{startMinute:string;endMinute:string}}

/** Each IDE carries its complete selected register inventory. Energy is one
 * point aggregate, never a fabricated per-register observation. */
export function mUtiltsWire(f:MUtiltsScope,options:MMemberOptions){
  if(!options.registers.length||options.registers.length!==options.startValues.length||options.registers.length!==options.endValues.length)
    throw new Error('native_m_utilts_reading_membership_required')
  const document='M-DOC-'+randomUUID().replaceAll('-','').slice(0,24),transaction='M-READ-'+randomUUID().replaceAll('-','').slice(0,24)
  const {startMinute:start,endMinute:end}=options.period
  const lines=["UNA:+.? '",`UNB+UNOC:3+${f.receiver}:ZZ+${f.sender}:ZZ+260831:1811+MCTRL++23-DDQ-E66-T++1'`,
    "UNH+1+UTILTS:D:02B:UN:E5SE5A'",`BGM+E66::260+${document}+9+AB'`,"DTM+137:202609301811:203'","DTM+735:?+0100:406'",
    "MKS+23+E02::260'",`NAD+MS+${f.receiver}:SVK:260'`,`NAD+MR+${f.sender}:SVK:260'`,"NAD+DDQ'",`IDE+24+${transaction}'`,
    `LOC+172+${f.external}::9'`,`LOC+239+${f.gridAreaCode}:SVK:260'`,"LIN+++8716867000030:::9'",
    `DTM+324:${start}${end}:719'`,`DTM+597:${end}:203'`,"DTM+354:1:804'","STS+7++E64::260'","MEA+AAZ++KWH'","CCI+++E12::260'","CAV+E17::260'"]
  let sequence=1
  for(const [index,register] of options.registers.entries()){
    for(const [value,at] of [[options.startValues[index],start],[options.endValues[index],end]]){
      lines.push(`SEQ++${sequence++}'`,`RFF+AES:${register}'`,`RFF+MG:${options.meter}'`,`QTY+220:${value}'`,
        `DTM+597:${at}:203'`,"CCI+++E22::260'","CAV+E27::260'")
    }
  }
  lines.push(`SEQ++${sequence}'`,`QTY+136:${options.energy}'`,"UNT+1+1'","UNZ+1+MCTRL'")
  return utiltsRecountUnt(utiltsTestEnvironmentWire(lines.join('\n')))
}

/** Generic native UTILTS source capture, as in the existing reading suite.
 * Only ordinary physical/issuer inputs are synthetic. Actual receipt clock,
 * immutable source, guide, canonical seals, qualification and storage remain
 * owner outputs. This is not the M PRODAT birth or a mailbox/reply exchange. */
export async function prepareMUtiltsMember(f:MUtiltsScope,raw:string){
  registerUtiltsIssuer(sql,literal,f.receiver,f.actorUserId)
  const fresh=utiltsNativeSourceFixture(raw,randomUUID())
  sql(`INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,execution_context_snapshot,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
    SELECT ${literal(fresh.id)},${literal(f.companyId)},${literal(f.customerId)},${literal(f.siteId)},${literal(f.pointId)},${literal(f.gridId)},'test','inbound','edifact','UTILTS','E66','received',${literal(fresh.raw)},'{}',clock_timestamp(),'{}',${literal(fresh.parsed.applicationReference)},${literal(fresh.parsed.senderEdielId)},${literal(fresh.parsed.receiverEdielId)},${literal(fresh.parsed.interchangeReference)},pack.id,p.profile_key,p.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,p.profile
    FROM public.ediel_message_profiles p JOIN public.ediel_rule_packs pack ON pack.id=p.rule_pack_id
    WHERE p.message_code='E66' AND p.direction IN('inbound','both') AND p.is_enabled AND p.profile_key='UTILTS:E66:E5SE5A:current-r3';`)
  const result=await supabaseService.from('ediel_messages').select('*').eq('id',fresh.id).eq('company_id',f.companyId).single()
  expect(result.error).toBeNull()
  const message=result.data as EdielMessageRow
  expect(message).toMatchObject({id:fresh.id,company_id:f.companyId,environment:'test',direction:'inbound',message_family:'UTILTS',message_code:'E66',
    raw_payload:fresh.raw,rule_profile_key:'UTILTS:E66:E5SE5A:current-r3'})
  expect(message.message_received_at).toBeTruthy()
  seedUtiltsIssuerHistoryGround(sql,literal,message.id,f.actorUserId)
  const initial=await initialCanonicalUtiltsDecision(message),policy=initial.policy
  const issuerIdentityAuthority=readCanonicalUtiltsIssuerIdentityAuthority({decision:initial,message})??undefined
  const periodicReasonAuthority=readCanonicalPeriodicReasonAuthority({decision:initial,message})??undefined
  const provisional=runUtiltsRuntimeForMessage(message,{canonicalPolicy:policy,issuerIdentityAuthority,periodicReasonAuthority})
  const matches=await matchUtiltsTransactionsForTenant({message,facts:provisional.facts})
  const validated:EdielMessageRow={...message,business_match_status:matches.every(match=>match.matchStatus==='matched')?'matched':'unmatched',
    parsed_payload:{...message.parsed_payload,utiltsTransactionMatches:matches,normalizedMeteringPayload:{...provisional.normalizedPayload,utiltsTransactionMatches:matches}}}
  const qualified=await qualifyReceivedUtiltsStructure({message:validated,canonicalPolicy:policy,issuerIdentityAuthority,periodicReasonAuthority,
    runtime:runUtiltsRuntimeForMessage(validated,{canonicalPolicy:policy,issuerIdentityAuthority,periodicReasonAuthority})})
  // Keep the same initial, policy, authority and one-use qualified runtime.
  // No caller readset or serialized accepted decision can substitute here.
  await recordFinalCanonicalUtiltsDecision({original:message,validated,initialDecision:initial,runtime:qualified.runtime})
  const contracts=await prepareUtiltsConsumptionContracts({message:validated,runtime:qualified.runtime,policy,matches,dataRequest:null,
    fallback:{customerId:f.customerId,siteId:f.siteId,meteringPointId:f.pointId,gridOwnerId:f.gridId},allowConsumption:true})
  const input={actorUserId:f.reviewer.id,companyId:f.companyId,environment:'test' as const,sourceMessageId:message.id,messageCode:'E66',
    rawPayload:message.raw_payload!,contracts,transactions:buildUtiltsTransactionPersistencePayload({messageCode:'E66',
      transactions:qualified.runtime.facts.transactions,rawSegments:utiltsRuntimeSegments(qualified.runtime.facts),
      dispositions:qualified.runtime.transactionDispositions,matches})}
  const wire=tokenizeEdifact(message.raw_payload!),physical=canonicalUtiltsTransactions(wire.segments.slice(wire.segments.findIndex(segment=>segment.tag==='UNH')),wire.una,0)
  // Physical observation only; these decoded identities never supply expected
  // inventory or authority to qualification, preparation or persistence.
  const readings=physical.flatMap(transaction=>transaction.observations.flatMap(observation=>observation.quantities.filter(quantity=>quantity.qualifier==='220').map(quantity=>{
    const time=observation.segments.filter(segment=>segment.tag==='DTM'&&segmentComposite(segment,1,wire.una)[0]==='597')
    return {transactionId:transaction.transactionId,register:observation.references.filter(reference=>reference.qualifier==='AES').map(reference=>reference.value),
      meter:observation.references.filter(reference=>reference.qualifier==='MG').map(reference=>reference.value),value:quantity.value,raw:quantity.raw,
      times:time.map(segment=>segmentComposite(segment,1,wire.una))}
  })))
  return {message,qualified,input,readings,persist:()=>persistUtiltsTransactionResults(input)}
}

type MValueRow={qualifier:string;quantity:number;raw_value:string;source_order:number;observation_id:string;reading_at:string|null}
type MEffects={source:Record<string,unknown>|null;durableSource:Record<string,unknown>|null;
  series:Record<string,unknown>[];values:MValueRow[];bindings:Record<string,unknown>[];
  contracts:Record<string,unknown>[];storedContracts:UtiltsConsumptionContract[];
  reservations:{planned_response_type:string;persistence_status:string}[];outbound:Record<string,unknown>[];outbox:Record<string,unknown>[]}

/** Complete source-scoped rows, with stable order. SELECT only; no effect,
 * actor grant, source repair, replay marker or followup reconciliation. */
export function mUtiltsEffects(f:MUtiltsScope,sourceId:string){
  return sql<MEffects>(`SELECT jsonb_build_object(
    'source',(SELECT to_jsonb(m) FROM public.ediel_messages m WHERE m.company_id=${literal(f.companyId)} AND m.id=${literal(sourceId)}),
    'durableSource',(SELECT to_jsonb(s) FROM gridex_received_sources.sources s WHERE s.company_id=${literal(f.companyId)} AND s.source_message_id=${literal(sourceId)}),
    'series',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.source_transaction_reference,s.id),'[]') FROM public.meter_reading_series s WHERE s.company_id=${literal(f.companyId)} AND s.source_ediel_message_id=${literal(sourceId)}),
    'values',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY s.source_transaction_reference,v.source_order,v.id),'[]') FROM public.meter_reading_values v JOIN public.meter_reading_series s ON s.id=v.series_id AND s.company_id=v.company_id WHERE v.company_id=${literal(f.companyId)} AND s.source_ediel_message_id=${literal(sourceId)}),
    'bindings',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.source_message_id),'[]') FROM gridex_utilts_binding.receipts r WHERE r.company_id=${literal(f.companyId)} AND r.source_message_id=${literal(sourceId)}),
    'contracts',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.transaction_id,c.series_id),'[]') FROM gridex_utilts_binding.contracts c WHERE c.company_id=${literal(f.companyId)} AND c.source_message_id=${literal(sourceId)}),
    'storedContracts',(SELECT coalesce(jsonb_agg(gridex_utilts_binding.stored_contract_v1(c.company_id,c.source_message_id,c.transaction_id) ORDER BY c.transaction_id,c.series_id),'[]') FROM gridex_utilts_binding.contracts c WHERE c.company_id=${literal(f.companyId)} AND c.source_message_id=${literal(sourceId)}),
    'reservations',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.source_transaction_id),'[]') FROM public.ediel_ack_transaction_results a WHERE a.company_id=${literal(f.companyId)} AND a.source_message_id=${literal(sourceId)}),
    'outbound',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]') FROM public.ediel_messages m WHERE m.company_id=${literal(f.companyId)} AND m.related_message_id=${literal(sourceId)} AND m.direction='outbound'),
    'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM public.ediel_outbox o WHERE o.company_id=${literal(f.companyId)} AND o.source_message_id=${literal(sourceId)}))`)
}

/** The service mints an actual observed snapshot; this pure inspected result
 * is not a transferable qualification capability or M fulfillment marker. */
export async function mStructuralSnapshot(f:MUtiltsScope,cutoffAt:string){
  const {data,error}=await supabaseService.rpc('gridex_source_object_snapshot_v1',{p_company_id:f.companyId,p_environment:'test',p_cutoff:cutoffAt})
  expect(error).toBeNull()
  const readset=inspectStructuralReadset({companyId:f.companyId,environment:'test',cutoffAt},data)
  expect(readset.timeline).toMatchObject({status:'inspected',boundedReadComplete:true})
  expect(readset.unresolvedSources).toBe(false)
  return readset
}
