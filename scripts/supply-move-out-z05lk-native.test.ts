// reality-defects: (reality scenario H "the customer leaves", FINDINGS H1, H7)
// A grid owner's PRODAT Z05 received for an ordinary own supply period that WE never asked to end (no own
// Z08): L (CAV Z22, another supplier took over) and LK (CAV Z23, a new customer moved in with another
// supplier, i.e. our customer moved out). Reuses the approved independent national end producer of
// scripts/ediel-at-z05-supplier-native.test.ts (real admission, signature, Z03/Z04 source owners); only the
// Z05's transaction reason differs between the two cases. Synthetic data only, disposable replay.
import {type SupabaseClient} from '@supabase/supabase-js'
import {expect,it,vi} from 'vitest'
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
import {nationalEndNativeChain} from './helpers/ediel-national-end-native-fixture'
import {prepareIndependentNationalEndTarget} from './helpers/ediel-z05-independent-end-native-fixture'
import {bilateralClosureNativeChain} from './helpers/ediel-bilateral-lk-native-fixture'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {generateBillingUnderlaysForMonth} from '@/lib/billing/underlayEngine'
import {type Parts} from '../__tests__/fixtures/prodat-register'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'

const {nationalRescissionOperation}=nationalRescissionNativeChain({provider,sourceSession})
const {receivedNationalRescissionEnd}=nationalEndNativeChain({nationalRescissionOperation,provider})
const {receivedHStart}=nationalRescissionNativeChain({provider,sourceSession})
const {receivedLkEnd,lkEffects}=bilateralClosureNativeChain({receivedHStart,provider})
/** The approved Z05 L wire with CAV Z23 (change of customer and supplier) instead of Z22. */
const asMoveOut=(parts:Parts[]):Parts[]=>parts.map(p=>p[0]==='CAV'&&Array.isArray(p[1])&&p[1][0]==='Z22'?['CAV',['Z23']]:p)

async function receiveIndependentEnd(variant:'L'|'LK'){
 const f=await receivedNationalRescissionEnd(true,false,{lineItemReference:`${variant}-OTHER-SUPPLIER-NOTICE`,qualification:'observe',retainOriginalMailbox:true,
  ...(variant==='LK'?{transformParts:asMoveOut}:{})},sibling=>prepareIndependentNationalEndTarget(sibling,provider))
 // The suite's disposable ACK route gets its local transport before the first reply, exactly as
 // scripts/ediel-at-z05-supplier-native.test.ts configureAckProfile does (no decision, no witness).
 const {from,host,port}=edielSmtpConfig()
 expect(sql(`WITH configured AS(UPDATE public.ediel_route_profiles p SET is_active=true,mailbox=${literal(from)},smtp_host=${literal(host)},smtp_port=${literal(port)}
  FROM public.communication_routes r WHERE r.id=p.communication_route_id AND r.company_id=p.company_id AND r.company_id=${literal(f.companyId)} AND r.route_scope='ediel_ack' AND p.environment='test'
  RETURNING p.id) SELECT to_jsonb(count(*)) FROM configured`)).toBe(1)
 const before=sql<Record<string,unknown>>(`SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE id=${literal(f.periodId)}`)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.endSourceId})
 const after=sql<Record<string,unknown>>(`SELECT jsonb_build_object('period',(SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE id=${literal(f.periodId)}),
  'message',(SELECT jsonb_build_object('status',status,'code',message_code) FROM public.ediel_messages WHERE id=${literal(f.endSourceId)}),
  'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('type',event_type,'status',event_status,'message',message,'reason',payload->>'reason') ORDER BY created_at),'[]') FROM public.ediel_message_events WHERE ediel_message_id=${literal(f.endSourceId)}),
  'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('family',message_family,'outcome',ack_outcome)),'[]') FROM public.ediel_messages WHERE related_message_id=${literal(f.endSourceId)} AND direction='outbound'),
  'contract',(SELECT jsonb_build_object('status',status,'reason',termination_reason) FROM public.customer_contracts WHERE id=${literal(f.contractId)}),
  'tasks',(SELECT coalesce(jsonb_agg(task_type ORDER BY task_type),'[]') FROM public.customer_operation_tasks WHERE customer_id=${literal(f.customerId)}))`)
 console.info('H7_Z05_INDEPENDENT',variant,JSON.stringify({decision:[f.decision.syntaxDecision,f.decision.applicationDecision,f.decision.functionalDecision],
  issues:f.decision.issues?.slice?.(0,5),before:{status:before.status,end:before.end_date},after}))
 return {f,before,after:after as {period:Record<string,unknown>;events:Array<Record<string,unknown>>;contract:Record<string,unknown>;tasks:string[]}}
}


it('H7: an ordinary move-out notice (independent Z05 LK) ends our period with the same follow-up as a switch away',async()=>{
 const {f,after}=await receiveIndependentEnd('LK')
 const wire=sql<string>(`SELECT to_jsonb(raw_payload) FROM public.ediel_messages WHERE id=${literal(f.endSourceId)}`)
 expect(wire).toMatch(/CAV\+Z23'/)
 expect(after.period,JSON.stringify(after.events)).toMatchObject({source_end_message_id:f.endSourceId,end_date:f.nationalEndPlan.endDate})
 expect(['ending','ended']).toContain(after.period.status)
 expect(after.contract).toMatchObject({status:'terminated',reason:'supply_end'})
 expect(after.tasks).toContain('final_invoice_pending')
 const acks=(after as unknown as {acks:Array<{family:string;outcome:string}>}).acks
 expect(acks.map(a=>[a.family,a.outcome]).sort()).toEqual([['APERAK','positive'],['CONTRL','positive']])
 // No bilateral closure receipt is invented for an end we never asked for.
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_bilateral_prodat.closure_end_receipts WHERE source_message_id=${literal(f.endSourceId)}`)).toBe(0)
 // Replaying the same source changes nothing.
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.endSourceId})
 expect(sql(`SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE id=${literal(f.periodId)}`)).toEqual(after.period)
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=${literal(f.endSourceId)}`)).toBe(1)
 // The month after the move-out has no underlay.
 const end=String(after.period.end_date),next=new Date(Date.UTC(Number(end.slice(0,4)),Number(end.slice(5,7)),1)).toISOString().slice(0,7)
 expect((await generateBillingUnderlaysForMonth({companyId:f.companyId,billingMonth:next,meteringPointId:f.pointId})).results).toEqual([])
},300000)

it('H7 control: a Z05 LK that answers our own sent Z08 LK still ends through the bilateral closure owner',async()=>{
 const f=await receivedLkEnd(true,{retainOriginalMailbox:true})
 const {from,host,port}=edielSmtpConfig()
 sql(`UPDATE public.ediel_route_profiles p SET is_active=true,mailbox=${literal(from)},smtp_host=${literal(host)},smtp_port=${literal(port)}
  FROM public.communication_routes r WHERE r.id=p.communication_route_id AND r.company_id=p.company_id AND r.company_id=${literal(f.companyId)} AND r.route_scope='ediel_ack' AND p.environment='test'`)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 // Same effects the approved AT-Z05LK acceptance asserts: own end, one closure receipt, one transition,
 // positive APERAK, final-value follow-up and the bilateral audit row.
 expect(lkEffects(f)).toMatchObject({period:{id:f.periodId,source_end_message_id:f.sourceId},ends:1,transitions:1,positive:1,followups:1,audits:1})
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 expect(lkEffects(f)).toMatchObject({ends:1,transitions:1,positive:1})
},300000)
