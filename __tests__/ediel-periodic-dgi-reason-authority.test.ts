import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
const io=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
import {readPeriodicReasonAuthority,periodicReasonFacts} from '@/lib/ediel/utilts/periodicReasonAuthority'
import {runUtiltsRuntimeForMessage,takeUtiltsRuntimeOwner} from '@/lib/ediel/utiltsEngine'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {parseCanonicalMessageRow} from '@/lib/ediel/core/canonicalMessage'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
const company='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',review1='33333333-3333-4333-8333-333333333333',review2='44444444-4444-4444-8444-444444444444'
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
function source(reason='E23'){
 const row=energyHandoffMessage('2026-10-01',company);return {...row,id,application_reference:'23-DGI-E66-T',raw_payload:row.raw_payload!.replaceAll('23-DDQ-E66-T','23-DGI-E66-T').replace('NAD+DDQ','NAD+DGI').replace('STS+7++E88::260',`STS+7++${reason}::260`)}
}
function policy(row:ReturnType<typeof source>){const selected=resolveCanonicalMessagePolicy(row,parseCanonicalMessageRow(row));if(!selected)throw Error('fixture selected policy missing');return selected}
function native(row:ReturnType<typeof source>,reason='E23',changes:Record<string,unknown>={}){
 return {version:1,companyId:company,environment:'test',sourceMessageId:id,sourcePayloadHash:hash(row.raw_payload!),status:'qualified',expectedReasons:[{transactionIndex:0,transactionId:'GRIDEX2607E66001',reasonCode:reason,receivedReasonCode:row.raw_payload!.includes('STS+7++E23::260')?'E23':'E88',scopeHash:'a'.repeat(64),agreementReviewIds:[review1,review2]}],holdReason:null,...changes}
}
beforeEach(()=>io.rpc.mockReset())
describe('actual periodic DGI national consumer with declared protected I/O model, not native evidence',()=>{
 it('consumes protected current ESCO defaultE23 using own physical IDE and preserves the actual owner',async()=>{
  const row=source(),selected=policy(row);io.rpc.mockResolvedValue({data:native(row),error:null})
  const authority=await readPeriodicReasonAuthority({message:row,policy:selected});const runtime=runUtiltsRuntimeForMessage(row,{canonicalPolicy:selected,periodicReasonAuthority:authority})
  expect(runtime.transactionDispositions[0]).toMatchObject({disposition:'accepted',responseType:'positive_aperak'});expect(runtime.validation.issues.some(x=>x.code==='UTILTS_PERIODIC_DGI_REASON_INVALID')).toBe(false)
  expect(takeUtiltsRuntimeOwner(runtime,row,selected,undefined,authority)).not.toBeNull()
  expect(io.rpc).toHaveBeenCalledWith('gridex_read_periodic_dgi_e66_reason_v1',{p_company_id:company,p_message_id:id})
 })
 it('rejects inherited E88 without authenticated agreement, at original field223, with zero accepted transactions or ERR',async()=>{
  const row=source('E88'),selected=policy(row);io.rpc.mockResolvedValue({data:native(row),error:null})
  const authority=await readPeriodicReasonAuthority({message:row,policy:selected}),runtime=runUtiltsRuntimeForMessage(row,{canonicalPolicy:selected,periodicReasonAuthority:authority})
  expect(runtime.transactionDispositions[0]).toMatchObject({disposition:'guide_rejected',responseType:'negative_aperak'});expect(runtime.transactionDispositions.some(x=>x.disposition==='accepted')).toBe(false);expect(runtime.ackPlan.shouldSendUtiltsErr).toBe(false)
  expect(runtime.validation.issues.find(x=>x.code==='UTILTS_PERIODIC_DGI_REASON_INVALID')).toMatchObject({aperakErcCode:'42',aperakFieldCode:'223',referenceQualifier:'ACW',referenceNumber:'GRIDEX2607E66001',aperakInvalidOccurrence:{elementIndex:3,componentIndex:0}})
  expect(takeUtiltsRuntimeOwner(runtime,row,selected,undefined,authority)).not.toBeNull()
 })
 it('permits E88 only with the actual scoped two-contract review receipts returned by the native owner',async()=>{
  const row=source('E88'),selected=policy(row);io.rpc.mockResolvedValue({data:native(row,'E88'),error:null})
  const authority=await readPeriodicReasonAuthority({message:row,policy:selected})
  expect(runUtiltsRuntimeForMessage(row,{canonicalPolicy:selected,periodicReasonAuthority:authority}).transactionDispositions[0].disposition).toBe('accepted')
 })
 it('preserves other qualified receiver roles only with their protected same-source not-applicable receipt',async()=>{
  const row=source(),selected=policy(row);io.rpc.mockResolvedValue({data:native(row,'E23',{status:'not_applicable',expectedReasons:[],holdReason:null}),error:null})
  const authority=await readPeriodicReasonAuthority({message:row,policy:selected})
  expect(runUtiltsRuntimeForMessage(row,{canonicalPolicy:selected,periodicReasonAuthority:authority}).transactionDispositions[0].disposition).toBe('accepted')
  expect(periodicReasonFacts({authority:authority!,message:row,policy:selected}).status).toBe('not_applicable')
 })
 it.each(['missing-token','missing-receipt','revoked-representation'])('holds %s before positive effects without fabricating field223 rejection',async which=>{
  const row=source(),selected=policy(row);io.rpc.mockResolvedValue(which==='missing-receipt'?{data:null,error:null}:{data:native(row,'E23',{status:'held',expectedReasons:[],holdReason:'current_representation_required'}),error:null})
  const authority=which==='missing-token'?undefined:await readPeriodicReasonAuthority({message:row,policy:selected}),runtime=runUtiltsRuntimeForMessage(row,{canonicalPolicy:selected,periodicReasonAuthority:authority})
  expect(runtime.transactionDispositions[0]).toMatchObject({disposition:'internal_review',responseType:'none'});expect(runtime.ackPlan.shouldSendAperak).toBe(false);expect(runtime.ackPlan.shouldSendUtiltsErr).toBe(false)
  expect(runtime.validation.issues.some(x=>x.aperakFieldCode==='223')).toBe(false)
 })
 it('rejects copied capabilities, changed original bytes and a different selected policy',async()=>{
  const row=source(),selected=policy(row);io.rpc.mockResolvedValue({data:native(row),error:null});const authority=(await readPeriodicReasonAuthority({message:row,policy:selected}))!
  for(const input of [{authority:{...authority},message:row,policy:selected},{authority,message:source('E88'),policy:selected},{authority,message:row,policy:{...selected}}])expect(()=>periodicReasonFacts(input)).toThrow('ediel_periodic_reason_authority_invalid')
 })
 it.each(['source','scope','own-IDE','missing-contract'])('refuses mismatched protected DTO %s',async which=>{
  const row=source(),selected=policy(row),r=native(row)
  if(which==='source')r.sourcePayloadHash='f'.repeat(64)
  if(which==='scope')r.companyId='55555555-5555-4555-8555-555555555555'
  if(which==='own-IDE')r.expectedReasons[0].transactionId='SIBLING'
  if(which==='missing-contract'){r.expectedReasons[0].reasonCode='E88';r.expectedReasons[0].agreementReviewIds=[]}
  io.rpc.mockResolvedValue({data:r,error:null});await expect(readPeriodicReasonAuthority({message:row,policy:selected})).rejects.toThrow('ediel_periodic_reason_read_scope_invalid')
 })
 it('cannot finalize an otherwise accepted source under a different periodic capability',async()=>{
  const row=source(),selected=policy(row);io.rpc.mockResolvedValue({data:native(row),error:null});const a=await readPeriodicReasonAuthority({message:row,policy:selected}),b=await readPeriodicReasonAuthority({message:row,policy:selected}),runtime=runUtiltsRuntimeForMessage(row,{canonicalPolicy:selected,periodicReasonAuthority:a})
  expect(takeUtiltsRuntimeOwner(runtime,row,selected,undefined,b)).toBeNull()
 })
})
