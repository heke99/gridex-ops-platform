import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:(...args:unknown[])=>({abortSignal:()=>rpc(...args)})}}))
import {qualifyAiListProspectiveOriginal} from '@/lib/ediel/aiListOrigination'
import {AI_LIST_SOURCE_PROFILE} from '@/lib/ediel/aiListFormat'
import type {CreateEdielMessageInput} from '@/lib/ediel/types'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const raw='AI;54321;Network;12345;Supplier;202610011200;;20261001;20261101;Ver20140401\nNET;735123456789012345;9;;;;;Street;12345;Town;12345;;;;;;;199001011234;Person;;;'
const draft:CreateEdielMessageInput={actorUserId:id(1),companyId:id(2),intentId:id(3),sourceOperationId:id(4),direction:'outbound',messageStandard:'ai_list',messageFamily:'AI_LIST',messageCode:'AI',messageVersion:AI_LIST_SOURCE_PROFILE.technicalVersion,environment:'test',processType:'ai_list_export',senderEdielId:'12345',receiverEdielId:'54321',rawPayload:raw,fileName:'AI.csv',mimeType:'text/csv; charset=utf-8'}
const receipt={owner:'ai-list-private-original-v1',companyId:id(2),intentId:id(3),operationId:id(4),environment:'test',sourceHash:createHash('sha256').update(raw,'utf8').digest('hex'),sourceSha256:AI_LIST_SOURCE_PROFILE.sourceSha256,technicalVersion:AI_LIST_SOURCE_PROFILE.technicalVersion,snapshotId:id(5),processingDecisionId:id(6),readsetHash:'a'.repeat(64),headerBasis:{owner:'actual-native-header-basis'}}
beforeEach(()=>{rpc.mockReset();rpc.mockResolvedValue({data:receipt,error:null})})
describe('prospective technical AI original port',()=>{
 it('requires its own fresh protected original receipt instead of a normal EDIFACT witness',async()=>{
  expect(await qualifyAiListProspectiveOriginal({draft,actorUserId:id(1)})).toEqual(receipt)
  expect(rpc).toHaveBeenCalledWith('gridex_ai_prepare_outbound_original_v1',{p_company_id:id(2),p_actor_user_id:id(1),p_intent_id:id(3),p_draft_text:JSON.stringify(draft)})
 })
 it('keeps physical CSV and a genuine request operation before any native call',async()=>{
  await expect(qualifyAiListProspectiveOriginal({draft:{...draft,sourceOperationId:null},actorUserId:id(1)})).rejects.toThrow('ai_list_prospective_actor_operation_required')
  await expect(qualifyAiListProspectiveOriginal({draft:{...draft,receiverEdielId:'OTHER'},actorUserId:id(1)})).rejects.toThrow('ai_list_outbound_party_scope_mismatch')
  expect(rpc).not.toHaveBeenCalled()
 })
 it('rejects wrong tenant, operation, exact source bytes, version and unavailable private receipts',async()=>{
  for(const altered of [{...receipt,companyId:id(9)},{...receipt,operationId:id(9)},{...receipt,sourceHash:'b'.repeat(64)},{...receipt,technicalVersion:'CLAIMED'},{...receipt,sourceSha256:'b'.repeat(64)},null]){
   rpc.mockResolvedValue({data:altered,error:null})
   await expect(qualifyAiListProspectiveOriginal({draft,actorUserId:id(1)})).rejects.toThrow('ai_list_prospective_original_unconfirmed')
  }
 })
})
