import {beforeEach,expect,it,vi} from 'vitest'
const ports=vi.hoisted(()=>({rpc:vi.fn(),inbound:vi.fn(),outbound:vi.fn(),event:vi.fn(),sync:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:(...args:unknown[])=>ports.rpc(...args),from:()=>{throw Error('unexpected_database_port')}}}))
vi.mock('@/lib/ediel/core/kernel',async()=>{
 const actual=await import('@/lib/ediel/core/versionRegistry')
 return {resolveInboundAcceptedVersions:actual.resolveCanonicalInboundAcceptedVersions,
 resolveOutboundMessageVersion:()=>{throw Error('unexpected_outbound_version_port')},
 registerInboundCanonicalMessage:(...args:unknown[])=>ports.inbound(...args),
 createCanonicalOutboundMessage:(...args:unknown[])=>ports.outbound(...args)}
})
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:(...args:unknown[])=>ports.event(...args)}))
vi.mock('@/lib/ediel/actorTestingEngine',()=>({syncActorTestingForMessage:(...args:unknown[])=>ports.sync(...args)}))
import type {CreateEdielMessageInput} from '@/lib/ediel/types'
import {parseEdielFile,registerEdielFile} from '@/lib/ediel/fileEngine'
// Exact existing declared test strings, not customer data or original scenario membership.
// AI: __tests__/ediel-ai-file-engine.test.ts:4
const AI='AI;54321;BIG Network;12345;Supplier;202610011200;;20261001;20261101;Ver20140401\nNET;735123456789012345;9;;;;;Street;12345;Town;BRP;;;;;;;199001011234;Person;;;'
// BI: __tests__/ediel-ai-list-format.test.ts:42
const BI='BI;54321;Network;12345;Supplier;202609301200;20261001;;;Ver20140401'
const company='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002'
beforeEach(()=>{vi.clearAllMocks();ports.rpc.mockImplementation(async(name:string)=>({data:null,error:Error('legacy_registry_unavailable:'+name)}));ports.event.mockResolvedValue(null);ports.sync.mockResolvedValue(null);ports.inbound.mockImplementation(async({input}:{input:CreateEdielMessageInput})=>({id:'00000000-0000-4000-8000-000000000003',direction:input.direction,status:input.status,message_family:input.messageFamily,message_code:input.messageCode,message_version:input.messageVersion,sender_ediel_id:input.senderEdielId,receiver_ediel_id:input.receiverEdielId,created_at:'2026-11-16T00:00:00Z',updated_at:'2026-11-16T00:00:00Z'}))})
for(const [code,raw] of [['AI',AI],['BI',BI]] as const)it('valid '+code+' reaches the canonical inbound entry without legacy registry RPC',async()=>{
 expect(parseEdielFile(raw,code+'.csv')).toMatchObject({messageStandard:'ai_list',messageFamily:'AI_LIST',messageCode:code,messageVersion:'Ver20140401'})
 const result=await registerEdielFile({companyId:company,actorUserId:actor,direction:'inbound',mode:'tgt',ownActorEdielId:'12345',testPortalEdielId:'54321',rawPayload:raw,fileName:code+'.csv'})
 expect(result).toMatchObject({messageFamily:'AI_LIST',messageCode:code,messageVersion:'Ver20140401',senderEdielId:'54321',receiverEdielId:'12345'})
 expect(ports.inbound).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({actorUserId:actor,input:expect.objectContaining({companyId:company,messageStandard:'ai_list',messageFamily:'AI_LIST',messageCode:code,messageVersion:'Ver20140401',senderEdielId:'54321',receiverEdielId:'12345',validationReport:expect.objectContaining({ok:true,resolvedVersion:'Ver20140401',acceptedVersions:['Ver20140401']}),rawPayload:raw})}))
 expect(ports.rpc).not.toHaveBeenCalled();expect(ports.outbound).not.toHaveBeenCalled()
})
it('invalid technical version rejects before any kernel entry or registry RPC',async()=>{
 await expect(registerEdielFile({companyId:company,actorUserId:actor,direction:'inbound',mode:'tgt',ownActorEdielId:'12345',testPortalEdielId:'54321',rawPayload:AI.replace('Ver20140401','UNKNOWN'),fileName:'AI.csv'})).rejects.toThrow('ai_list_version_unsupported')
 expect(ports.rpc).not.toHaveBeenCalled();expect(ports.inbound).not.toHaveBeenCalled();expect(ports.outbound).not.toHaveBeenCalled();expect(ports.event).not.toHaveBeenCalled();expect(ports.sync).not.toHaveBeenCalled()
})
