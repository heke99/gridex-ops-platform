// masterplan: AI-01, AT-AI-01, SC-065
import {beforeEach,describe,expect,it,vi} from 'vitest'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:(...args:unknown[])=>({abortSignal:()=>rpc(...args)})}}))
import {readAiListPartyBasis,requireAiListPartyBasis} from '@/lib/ediel/aiListPartyBasis'
import {buildAiListOutboundDraft} from '@/lib/ediel/aiList'
import {parseAiBiTechnicalFile,assertAiListOutboundMessage} from '@/lib/ediel/aiListFormat'
import {canonicalAckRequirementsForFamilyCode} from '@/lib/ediel/rulebook/canonicalEdielFacade'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const selector={companyId:id(1),actorUserId:id(2),intentId:id(3)}
const qualifiedPort={status:'source_qualified',companyId:id(1),environment:'test',intentId:id(3),communicationRouteId:id(4),routeProfileId:id(5),legalSupplier:'12345',legalSupplierName:'Own Supplier',legalNetwork:'54321',legalNetworkName:'Own Network',technicalSender:'HOST',technicalReceiver:'NETWORK-GATEWAY',sourceBasis:{supplier:{sourceSha256:'a'.repeat(64)},networkDispatch:{sourceSha256:'b'.repeat(64)},transportMandate:{syntheticUnitBoundary:true}}}
const transportScope={companyId:id(1),environment:'test',sender:'HOST',receiver:'NETWORK-GATEWAY',communicationRouteId:id(4)}
beforeEach(()=>{rpc.mockReset();rpc.mockResolvedValue({data:qualifiedPort,error:null})})
describe('source-qualified legal AI header versus technical dispatch',()=>{
 it('renders the legal network first and supplier second while retaining technical sender/receiver in the real draft',async()=>{
  const parties=await readAiListPartyBasis(selector)
  const draft=await buildAiListOutboundDraft({headerParties:parties,actorUserId:id(2),companyId:id(1),listType:'AI',environment:'test',senderEdielId:'HOST',senderName:'Technical Hosting',receiverEdielId:'NETWORK-GATEWAY',receiverName:'Technical Gateway',communicationRouteId:id(4),fromDate:'20261001',toDate:'20261101',details:[{anlaggningsId:'735123456789012345',kodlista:'9',natavrakningsomrade:'NET',balansansvarsId:'11111',elanvandarId:'199001011234',elanvandarNamn:'Source Customer'}]})
  expect(draft.senderEdielId).toBe('HOST');expect(draft.receiverEdielId).toBe('NETWORK-GATEWAY')
  expect(parseAiBiTechnicalFile(draft.rawPayload!,'AI').header).toMatchObject({networkEdielId:'54321',networkName:'Own Network',supplierEdielId:'12345',supplierName:'Own Supplier'})
  expect(()=>assertAiListOutboundMessage({message_standard:draft.messageStandard,message_family:draft.messageFamily,raw_payload:draft.rawPayload,sender_ediel_id:draft.senderEdielId,receiver_ediel_id:draft.receiverEdielId,file_name:draft.fileName,mime_type:draft.mimeType})).not.toThrow()
  expect(rpc).toHaveBeenCalledWith('ediel_ai_outbound_party_basis_v1',{p_company_id:id(1),p_actor_user_id:id(2),p_intent_id:id(3)})
 })
 it('projects explicit ACK-none for this physical AI code without a BI/wildcard/default grant',()=>{
  expect(canonicalAckRequirementsForFamilyCode({family:'AI_LIST',code:'AI'})).toMatchObject({requiresContrl:false,requiresAperak:false,supportsNegativeAperak:false,supportsUtiltsErr:false,businessResponses:[]})
  for(const code of ['BI','UNKNOWN',''])expect(()=>canonicalAckRequirementsForFamilyCode({family:'AI_LIST',code})).toThrow('ediel_ack_family_unsupported')
 })
 it('does not grant header authority to caller data, copies, or a different transport/tenant scope',async()=>{
  const parties=await readAiListPartyBasis(selector)
  expect(()=>requireAiListPartyBasis(parties,transportScope)).not.toThrow()
  for(const copied of [{...parties},structuredClone(parties)])expect(()=>requireAiListPartyBasis(copied,transportScope)).toThrow('ai_list_party_basis_scope_mismatch')
  for(const changed of [{...transportScope,companyId:id(9)},{...transportScope,environment:'production'},{...transportScope,sender:'12345'},{...transportScope,receiver:'54321'},{...transportScope,communicationRouteId:id(9)}])expect(()=>requireAiListPartyBasis(parties,changed)).toThrow('ai_list_party_basis_scope_mismatch')
 })
 it('holds missing authenticated owner/mandate or foreign/malformed protected responses instead of falling back to route names',async()=>{
  for(const response of [{...qualifiedPort,status:'held'},{...qualifiedPort,companyId:id(9)},{...qualifiedPort,intentId:id(9)},{...qualifiedPort,legalSupplierName:'Technical;Label'},{...qualifiedPort,legalNetwork:'GATEWAY'},{...qualifiedPort,sourceBasis:null},null]){
   rpc.mockResolvedValue({data:response,error:null})
   await expect(readAiListPartyBasis(selector)).rejects.toThrow('ai_list_party_basis_unconfirmed')
  }
  rpc.mockResolvedValue({data:null,error:Error('ai_list_transport_mandate_source_unqualified')})
  await expect(readAiListPartyBasis(selector)).rejects.toThrow('ai_list_transport_mandate_source_unqualified')
 })
})
