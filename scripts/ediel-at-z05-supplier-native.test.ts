// masterplan: AT-Z05L-SUPPLIER, AT-Z05LK-SUPPLIER
import {type SupabaseClient} from '@supabase/supabase-js'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const provider=vi.hoisted(()=>vi.fn())
const sourceSession=vi.hoisted(()=>({client:null as SupabaseClient|null}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>{
 if(!sourceSession.client)throw Error('native_actual_source_session_required')
 return sourceSession.client
}}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:provider})}}))
vi.mock('@/lib/ediel/core/messageBuilder',async importOriginal=>
 (await import('../__tests__/helpers/p16bHold')).captureP16bPreflight(importOriginal))
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {nationalRescissionNativeChain} from './helpers/nationalRescissionNative'
import {nationalEndNativeChain,type ReceivedEndCandidate} from './helpers/ediel-national-end-native-fixture'
import {bilateralClosureNativeChain} from './helpers/ediel-bilateral-lk-native-fixture'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {getEdielMessageById} from '@/lib/ediel/db'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {validateUnsmGrammar} from '@/lib/ediel/core/unsmGrammar'
import {validateAckPreflight} from '@/lib/ediel/core/ackPreflight'
import {resolveInboundTenantFromIdentifiers} from '@/lib/ediel/tenant/resolveInboundTenant'
import {parseRulebookMessage} from '@/lib/ediel/rulebook/messageParser'
import {type EdielMessageRow} from '@/lib/ediel/types'
import {type Parts} from '../__tests__/fixtures/prodat-register'
const {receivedHStart,nationalRescissionOperation}=nationalRescissionNativeChain({provider,sourceSession})
const {receivedNationalRescissionEnd,nationalEndEffects}=nationalEndNativeChain({nationalRescissionOperation,provider})
const {receivedLkEnd,lkEffects}=bilateralClosureNativeChain({receivedHStart,provider})
const variants=['L','LK'] as const
async function receivedEnd(variant:typeof variants[number],candidate:ReceivedEndCandidate={}){
 if(variant==='L'){
  const f=await receivedNationalRescissionEnd(true,false,candidate)
  return{...f,sourceId:f.endSourceId,wire:f.endWire,startSourceId:f.sourceId,effects:()=>nationalEndEffects(f)}
 }
 const f=await receivedLkEnd(true,candidate)
 return{...f,effects:()=>lkEffects(f)}
}
const immutable=(id:string)=>sql(`SELECT jsonb_build_object('raw',raw_payload,
 'direction',direction,'company',company_id,'hash',immutable_payload_hash,'renderedAt',immutable_rendered_at,'receivedAt',message_received_at,
 'context',execution_context_snapshot,'captured',(SELECT to_jsonb(s)
 FROM gridex_received_sources.sources s WHERE s.source_message_id=m.id))
 FROM public.ediel_messages m WHERE id=${literal(id)}`)
// Full durable business rows across all tenants. The sole permitted end period
// and this received source's review/final-value cases are inspected separately.
const unrelated=(periodId:string,sourceId:string)=>sql(`SELECT jsonb_build_object(
 'periods',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.customer_supply_periods p WHERE id<>${literal(periodId)}::uuid),
 'customers',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM public.customers c),
 'contracts',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM public.customer_contracts c),
 'sites',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.customer_sites s),
 'points',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.metering_points p),
 'tasks',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM public.customer_cases c WHERE metadata->>'source_ediel_message_id' IS DISTINCT FROM ${literal(sourceId)}))`)
const acknowledgements=(sourceId:string)=>sql<EdielMessageRow[]>(`SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY message_family),'[]')
 FROM public.ediel_messages m WHERE related_message_id=${literal(sourceId)} AND direction='outbound'`)
const invoicee=(name:string):Parts=>['NAD','IV',['SYNTHETIC-BILL','','89'],'',name,'Invoice Street','Town','','12345','SE']
const withInvoicee=(name:string)=>(parts:Parts[]):Parts[]=>[...parts,invoicee(name)]
afterEach(()=>{sourceSession.client=null;vi.unstubAllEnvs();vi.restoreAllMocks()})

it.each(variants)('actual Z05%s commits its own end, physical acknowledgements and scoped final-value task while preserving history and every unrelated graph',async variant=>{
 const f=await receivedEnd(variant),before=f.effects() as {period:Record<string,unknown>}
 const sourceBefore=immutable(f.sourceId),originalBefore=immutable(f.original.id),startBefore=immutable(f.startSourceId),unrelatedBefore=unrelated(f.periodId,f.sourceId)
 const businessBefore=sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND direction='outbound' AND message_family='PRODAT'`)
 expect(before.period).toMatchObject({id:f.periodId,source_end_message_id:null})
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 const after=f.effects()
 expect(after).toMatchObject({period:{id:f.periodId,company_id:f.companyId,customer_id:f.customerId,
  metering_point_id:f.pointId,source_message_id:f.startSourceId,start_date:before.period.start_date,
  market_start_at:before.period.market_start_at,market_state_version:Number(before.period.market_state_version)+1,
  end_date:'2026-10-16',market_end_at:'2026-10-16T12:30:00+00:00',source_end_message_id:f.sourceId,status:'ending'},
  ends:1,transitions:1,positive:1,followups:1,audits:1})
 const source=(await getEdielMessageById(f.sourceId))!,acks=acknowledgements(f.sourceId)
 expect(acks.map(m=>[m.message_family,m.ack_outcome])).toEqual([['APERAK','positive'],['CONTRL','positive']])
 const sourceWire=tokenizeEdifact(f.wire),sourceUnb=sourceWire.segments.find(s=>s.tag==='UNB')
 const li=segmentComposite(sourceWire.segments.find(s=>s.tag==='RFF'&&segmentComposite(s,1,sourceWire.una)[0]==='LI'),1,sourceWire.una)[1]
 for(const ack of acks){
  expect(ack).toMatchObject({company_id:f.companyId,environment:'test',related_message_id:f.sourceId,direction:'outbound'})
  expect(validateUnsmGrammar(ack.raw_payload!).issues.filter(i=>i.severity==='error')).toEqual([])
  expect(validateAckPreflight({ackMessage:ack,sourceMessage:source})).toMatchObject({ok:true})
  const parsed=parseRulebookMessage(ack.raw_payload!)
  expect([parsed.sender,parsed.receiver]).toEqual([f.sender,f.receiver])
  const wire=tokenizeEdifact(ack.raw_payload!)
  if(ack.message_family==='CONTRL'){
   const uci=wire.segments.find(s=>s.tag==='UCI')
   expect(segmentComposite(uci,1,wire.una)[0]).toBe(segmentComposite(sourceUnb,5,sourceWire.una)[0])
   expect(segmentComposite(uci,2,wire.una)).toEqual(segmentComposite(sourceUnb,2,sourceWire.una))
   expect(segmentComposite(uci,3,wire.una)).toEqual(segmentComposite(sourceUnb,3,sourceWire.una))
   expect(segmentComposite(uci,4,wire.una)).toEqual(['1'])
  }else{
   expect(wire.segments.filter(s=>s.tag==='ERC').map(s=>segmentComposite(s,1,wire.una)[0])).toEqual(['100'])
   const refs=wire.segments.filter(s=>s.tag==='RFF').map(s=>segmentComposite(s,1,wire.una))
   expect(refs).toContainEqual(['Z07',f.external]);expect(refs).toContainEqual(['LI',li])
   expect(refs).toContainEqual(['ACW',segmentComposite(sourceWire.segments.find(s=>s.tag==='BGM'),2,sourceWire.una)[0]])
  }
 }
 const tasks=sql<Record<string,unknown>[]>(`SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.customer_cases c
  WHERE company_id=${literal(f.companyId)} AND reason_category='final_metering_and_billing' AND metadata->>'source_ediel_message_id'=${literal(f.sourceId)}`)
 expect(tasks).toHaveLength(1);expect(tasks[0]).toMatchObject({company_id:f.companyId,customer_id:f.customerId,
  metering_point_id:f.pointId,reason_category:'final_metering_and_billing',status:'open',metadata:{source_ediel_message_id:f.sourceId,review_intent:'final_metering_and_billing'}})
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND direction='outbound' AND message_family='PRODAT'`)).toBe(businessBefore)
 expect(unrelated(f.periodId,f.sourceId)).toEqual(unrelatedBefore)
 expect(immutable(f.original.id)).toEqual(originalBefore);expect(immutable(f.startSourceId)).toEqual(startBefore);expect(immutable(f.sourceId)).toEqual(sourceBefore)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 expect(f.effects()).toEqual(after);expect(acknowledgements(f.sourceId)).toEqual(acks)
 expect(sql(`SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.customer_cases c WHERE company_id=${literal(f.companyId)} AND reason_category='final_metering_and_billing' AND metadata->>'source_ediel_message_id'=${literal(f.sourceId)}`)).toEqual(tasks)
 expect(unrelated(f.periodId,f.sourceId)).toEqual(unrelatedBefore)
},120000)

// IV is physically present in both candidates. Absence of the ordinary optional
// IV group, or field310 without independently known death, is never a defect.
it.each(variants)('actual Z05%s complete IV is favorable and a missing present-group name has its own field251 diagnostic and no business effect',async variant=>{
 const valid=await receivedEnd(variant,{transformParts:withInvoicee('Synthetic Invoicee')})
 expect([valid.decision.syntaxDecision,valid.decision.applicationDecision,valid.decision.functionalDecision]).toEqual(['accepted','accepted','accepted'])
 await processInboundEdielMessage({actorUserId:valid.actorUserId,edielMessageId:valid.sourceId});expect(valid.effects()).toMatchObject({ends:1,positive:1,followups:1})
 const f=await receivedEnd(variant,{transformParts:withInvoicee(''),qualification:'observe'}),before=f.effects(),graph=unrelated(f.periodId,f.sourceId),raw=immutable(f.sourceId)
 expect(f.decision.applicationDecision,JSON.stringify(f.decision.issues)).toBe('rejected')
 expect(f.decision.issues.some(i=>i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber==='251'&&i.prodatDiagnostic.errorKind==='missing'),JSON.stringify(f.decision.issues)).toBe(true)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 expect(f.effects()).toEqual(before);expect(unrelated(f.periodId,f.sourceId)).toEqual(graph);expect(immutable(f.sourceId)).toEqual(raw)
},120000)

it.each(variants)('actual Z05%s missing mandatory end date is rejected with field211 and cannot end any period or create positive/final-value effects',async variant=>{
 const f=await receivedEnd(variant,{qualification:'observe',transformParts:parts=>parts.filter(p=>!(p[0]==='DTM'&&Array.isArray(p[1])&&p[1][0]==='93'))}),before=f.effects(),graph=unrelated(f.periodId,f.sourceId),raw=immutable(f.sourceId)
 expect(f.decision.applicationDecision,JSON.stringify(f.decision.issues)).toBe('rejected')
 expect(f.decision.issues.some(i=>i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber==='211'&&i.prodatDiagnostic.errorKind==='missing'),JSON.stringify(f.decision.issues)).toBe(true)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 expect(f.effects()).toEqual(before);expect(unrelated(f.periodId,f.sourceId)).toEqual(graph);expect(immutable(f.sourceId)).toEqual(raw)
},120000)

it.each(variants)('actual Z05%s current receiving supplier role withdrawal holds before runtime and preserves its sealed original and every business graph',async variant=>{
 const f=await receivedEnd(variant)
 // Wire/profile qualification is favorable; current tenant role resolution is
 // a separate real consumer. Preserve historical receive identity and clock.
 expect([f.decision.syntaxDecision,f.decision.applicationDecision,f.decision.functionalDecision]).toEqual(['accepted','accepted','accepted'])
 sql(`UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp()-interval '1 second'
  WHERE company_id=${literal(f.companyId)} AND environment='test' AND role_code='electricity_supplier'`)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.tenant_actor_roles WHERE company_id=${literal(f.companyId)} AND environment='test' AND role_code='electricity_supplier' AND(valid_to IS NULL OR valid_to>clock_timestamp())`)).toBe(0)
 const before=f.effects(),graph=unrelated(f.periodId,f.sourceId),raw=immutable(f.sourceId)
 const routing=await resolveInboundTenantFromIdentifiers({existingCompanyId:f.companyId,environment:'test',
  senderEdielId:f.receiver,receiverEdielId:f.sender,marketActorEdielId:f.sender,
  applicationReference:'23-DDQ-PRODAT',messageFamily:'PRODAT',messageCode:'Z05'})
 expect(routing).toMatchObject({status:'ambiguous',companyId:null})
 expect(routing.evidence.filter(e=>e.source==='verified_legal_identity')).toEqual([])
 const held=await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 expect(held).toMatchObject({company_id:f.companyId,tenant_resolution_status:'tenant_ambiguous',business_match_status:'business_blocked',processing_status:'routing_unresolved'})
 const diagnostics=sql<Record<string,unknown>[]>(`SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM public.ediel_unresolved_items u WHERE source_message_id=${literal(f.sourceId)}`)
 expect(diagnostics).toHaveLength(1)
 expect(diagnostics[0]).toMatchObject({company_id:f.companyId,environment:'test',source_message_id:f.sourceId,issue_type:'tenant_ambiguous'})
 expect(f.effects()).toEqual(before);expect(unrelated(f.periodId,f.sourceId)).toEqual(graph);expect(immutable(f.sourceId)).toEqual(raw)
},120000)

it.each([
 ['LI',{lineItemReference:'L-UNMATCHED-OWN-REFERENCE'}],['end minute',{endDate:'202610161331'}],
] as const)('actual national L wrong %s cannot execute any end, positive ACK or final-value task',async(_label,candidate)=>{
 const f=await receivedEnd('L',candidate),before=f.effects(),graph=unrelated(f.periodId,f.sourceId),raw=immutable(f.sourceId),original=immutable(f.original.id)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 expect(f.effects()).toEqual(before);expect(unrelated(f.periodId,f.sourceId)).toEqual(graph)
 // Only the unchanged LI+point selector chooses the exact national branch.
 // A wrong LI may fall through another real matcher, never an assumed exception.
 if(_label==='end minute')expect(()=>sql(`SELECT public.ediel_apply_supply_source_v1(${literal(f.companyId)},${literal(f.sourceId)},${literal(f.actorUserId)})`)).toThrow('supply_rescission_exact_sent_original_required')
 expect(immutable(f.sourceId)).toEqual(raw);expect(immutable(f.original.id)).toEqual(original)
},120000)

it.each(['outbound H request','inbound L end'] as const)('actual sealed %s rejects byte mutation without losing immutable history or creating an end',async lane=>{
 const f=await receivedEnd('L'),id=lane==='outbound H request'?f.original.id:f.sourceId,before=f.effects(),graph=unrelated(f.periodId,f.sourceId),raw=immutable(f.sourceId),original=immutable(f.original.id)
 const wire=lane==='outbound H request'?f.original.raw_payload!:f.wire,mutated=wire.replace('202610161330','202610161331')
 expect(mutated).not.toBe(wire)
 expect(()=>sql(`UPDATE public.ediel_messages SET raw_payload=${literal(mutated)} WHERE id=${literal(id)}`)).toThrow(lane==='outbound H request'?'supply_rescission_atomic_original_required':'immutable_ediel_payload_cannot_change')
 expect(f.effects()).toEqual(before);expect(unrelated(f.periodId,f.sourceId)).toEqual(graph);expect(immutable(f.sourceId)).toEqual(raw);expect(immutable(f.original.id)).toEqual(original)
},120000)

// The retained finite facade cases also execute its outbound early return before
// any RPC. Here the actual native source guard independently seals direction.
it.each(variants)('actual received Z05%s direction cannot be changed into outbound to bypass the inbound consumer',async variant=>{
 const f=await receivedEnd(variant),before=f.effects(),graph=unrelated(f.periodId,f.sourceId),raw=immutable(f.sourceId)
 expect(()=>sql(`UPDATE public.ediel_messages SET direction='outbound' WHERE id=${literal(f.sourceId)}`))
  .toThrow('immutable_ediel_received_context_cannot_change')
 expect(f.effects()).toEqual(before);expect(unrelated(f.periodId,f.sourceId)).toEqual(graph);expect(immutable(f.sourceId)).toEqual(raw)
},120000)
