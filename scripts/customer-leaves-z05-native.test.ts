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
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {generateBillingUnderlaysForMonth} from '@/lib/billing/underlayEngine'
import {type Parts} from '../__tests__/fixtures/prodat-register'

const {nationalRescissionOperation}=nationalRescissionNativeChain({provider,sourceSession})
const {receivedNationalRescissionEnd}=nationalEndNativeChain({nationalRescissionOperation,provider})
/** The approved Z05 L wire with CAV Z23 (change of customer and supplier) instead of Z22. */
const asMoveOut=(parts:Parts[]):Parts[]=>parts.map(p=>p[0]==='CAV'&&Array.isArray(p[1])&&p[1][0]==='Z22'?['CAV',['Z23']]:p)

async function receiveIndependentEnd(variant:'L'|'LK'){
 const f=await receivedNationalRescissionEnd(true,false,{lineItemReference:`${variant}-OTHER-SUPPLIER-NOTICE`,qualification:'observe',retainOriginalMailbox:true,
  ...(variant==='LK'?{transformParts:asMoveOut}:{})},sibling=>prepareIndependentNationalEndTarget(sibling,provider))
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

it('control: an independent Z05 L (switch away) ends our period; the month after it has no underlay (H1)',async()=>{
 const {f,after}=await receiveIndependentEnd('L')
 expect(after.period).toMatchObject({source_end_message_id:f.endSourceId,end_date:f.nationalEndPlan.endDate})
 expect(after.contract).toMatchObject({status:'terminated',reason:'supply_end'})
 expect(after.tasks).toContain('final_invoice_pending')
 // The end date is the day of the market end; billing must not run past the end into the following month.
 const end=String(after.period.end_date),next=new Date(Date.UTC(Number(end.slice(0,4)),Number(end.slice(5,7)),1)).toISOString().slice(0,7)
 const month=await generateBillingUnderlaysForMonth({companyId:f.companyId,billingMonth:next,meteringPointId:f.pointId})
 expect(month.results).toEqual([])
},300000)

it.fails('H7: an independent Z05 LK (our customer moved out, a new customer moved in elsewhere) ends our period',async()=>{
 const {f,after}=await receiveIndependentEnd('LK')
 expect(after.period,JSON.stringify(after.events)).toMatchObject({source_end_message_id:f.endSourceId})
},300000)
