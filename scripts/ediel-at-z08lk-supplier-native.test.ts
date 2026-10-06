// masterplan: AT-Z08LK-SUPPLIER
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
// Preserve the existing chain's declared P16B preflight capture. No source,
// validation decision, original, period, closure receipt or ACK is fabricated.
vi.mock('@/lib/ediel/core/messageBuilder',async importOriginal=>
 (await import('../__tests__/helpers/p16bHold')).captureP16bPreflight(importOriginal))
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {nationalRescissionNativeChain} from './helpers/nationalRescissionNative'
import {bilateralClosureNativeChain} from './helpers/ediel-bilateral-lk-native-fixture'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
const {receivedHStart}=nationalRescissionNativeChain({provider,sourceSession})
const {receivedLkEnd,lkEffects}=bilateralClosureNativeChain({receivedHStart,provider})
const sourceSnapshot=(id:string)=>sql(`SELECT jsonb_build_object('raw',raw_payload,
 'hash',immutable_payload_hash,'renderedAt',immutable_rendered_at,
 'receivedAt',message_received_at,'context',execution_context_snapshot,
 'captured',(SELECT to_jsonb(s) FROM gridex_received_sources.sources s WHERE s.source_message_id=m.id))
 FROM public.ediel_messages m WHERE id=${literal(id)}`)
const unrelatedPeriods=(periodId:string)=>sql(`SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb) FROM public.customer_supply_periods p WHERE p.id<>${literal(periodId)}::uuid`)
afterEach(()=>{sourceSession.client=null;vi.unstubAllEnvs();vi.restoreAllMocks()})

// Candidates are independently received originals, changed before source birth.
// Both pass actual syntax/application/function qualification in the fixture;
// actual native correlation and the inbound consumer must refuse effects.
it.each([
 ['LI',{lineItemReference:'LK-UNMATCHED-OWN-REFERENCE'}],
 ['end minute',{endDate:'202610161331'}],
] as const)('actual canonical LK end with wrong %s cannot execute any period end or positive closure',async(_label,candidate)=>{
 const f=await receivedLkEnd(true,candidate),before=lkEffects(f)
 const originalBefore=sourceSnapshot(f.original.id),receivedBefore=sourceSnapshot(f.sourceId),unrelatedBefore=unrelatedPeriods(f.periodId)
 expect(before).toMatchObject({period:{id:f.periodId,source_end_message_id:null},
  ends:0,transitions:0,positive:0,followups:0,audits:0})
 expect(sql(`SELECT to_jsonb(gridex_bilateral_prodat.matched_closure_operation_v1(m,w.wire,w.wire->'objects'->0) IS NULL)
  FROM public.ediel_messages m CROSS JOIN LATERAL
  (SELECT gridex_received_sources.normal_switch_wire_v1(m.raw_payload) wire) w
  WHERE m.id=${literal(f.sourceId)}`)).toBe(true)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 expect(lkEffects(f)).toEqual(before)
 expect(()=>sql(`SELECT public.ediel_apply_supply_source_v1(${literal(f.companyId)},${literal(f.sourceId)},${literal(f.actorUserId)})`))
  .toThrow('bilateral_closure_exact_sent_original_required')
 expect(lkEffects(f)).toEqual(before)
 expect(sourceSnapshot(f.original.id)).toEqual(originalBefore)
 expect(sourceSnapshot(f.sourceId)).toEqual(receivedBefore)
 expect(unrelatedPeriods(f.periodId)).toEqual(unrelatedBefore)
},120000)

it.each(['outbound Z08 request','inbound Z05 end'] as const)(
 'actual sealed %s rejects byte mutation and preserves the unended period',async lane=>{
 const f=await receivedLkEnd(true),id=lane==='outbound Z08 request'?f.original.id:f.sourceId
 const before=lkEffects(f),originalBefore=sourceSnapshot(f.original.id),receivedBefore=sourceSnapshot(f.sourceId),unrelatedBefore=unrelatedPeriods(f.periodId)
 const mutated=(lane==='outbound Z08 request'?f.original.raw_payload!:f.wire).replace('202610161330','202610161331')
 expect(mutated).not.toBe(lane==='outbound Z08 request'?f.original.raw_payload:f.wire)
 expect(()=>sql(`UPDATE public.ediel_messages SET raw_payload=${literal(mutated)} WHERE id=${literal(id)}`))
  .toThrow(lane==='outbound Z08 request'?'bilateral_prodat_outbound_atomic_original_required':'immutable_ediel_payload_cannot_change')
 expect(lkEffects(f)).toEqual(before)
 expect(sourceSnapshot(f.original.id)).toEqual(originalBefore)
 expect(sourceSnapshot(f.sourceId)).toEqual(receivedBefore)
 expect(unrelatedPeriods(f.periodId)).toEqual(unrelatedBefore)
},120000)
