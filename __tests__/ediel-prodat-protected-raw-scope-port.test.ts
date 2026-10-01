import {createHash} from 'node:crypto'
import {beforeEach,expect,it,vi} from 'vitest'
import type {CreateEdielMessageInput,EdielMessageRow} from '@/lib/ediel/types'
const io=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
import {readProtectedOutboundAckReplay} from '@/lib/ediel/core/ackPolicy'
import {persistAtomicOutboundAck} from '@/lib/ediel/core/atomicAckPersistence'
const hash=(raw:string)=>createHash('sha256').update(raw).digest('hex')
// Mechanical external RPC receipt only. Actual SQL authority/concurrency has
// independent regressions and a native suite; these objects claim neither.
const source={id:'source',company_id:'company',environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z04',raw_payload:'actual immutable source'} as unknown as EdielMessageRow
const ack={id:'ack',company_id:'company',environment:'test',direction:'outbound',message_standard:'edifact',message_family:'APERAK',related_message_id:'source',raw_payload:'immutable mixed ACK',ack_outcome:'negative',parsed_payload:{relatedTransactionReference:'untrusted obsolete object alias'}} as unknown as EdielMessageRow
const scope=(reference:string,outcome='positive')=>({scope:'object',reference,physicalReference:{lineIndex:Number(reference),id:'actual point '+reference,li:'actual LI '+reference},outcome})
const wantedRaw='new physical own positive object ACK'
const authority={companyId:'company',environment:'test',actorUserId:'actor',sourceMessage:source,ackFamily:'APERAK' as const,sequenceField:'relatedTransactionReference' as const,sequenceValue:'wrong caller cache',requestedRawPayload:wantedRaw}
const receipt=(patch:Record<string,unknown>={})=>({version:2,sourceMessage:source,ackMessage:ack,requestedPayloadHash:hash(wantedRaw),requestedScopes:[scope('7')],ackScopes:[scope('7'),scope('19','negative')],...patch})
beforeEach(()=>vi.resetAllMocks())
it('derives PRODAT object selection from exact physical raw request without a transaction/hash alias',async()=>{
 io.rpc.mockResolvedValue({data:receipt(),error:null})
 expect(await readProtectedOutboundAckReplay(authority)).toEqual(ack)
 expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_read_outbound_ack_scope_replay_v2',{p_company_id:'company',p_environment:'test',p_source_message_id:'source',p_source_payload_hash:hash(source.raw_payload!),p_actor_user_id:'actor',p_ack_family:'APERAK',p_ack_raw_payload:wantedRaw})
})
it.each([{requestedPayloadHash:hash('foreign')},{requestedScopes:[scope('7','negative')]},{ackScopes:[scope('19')]},{requestedScopes:[]},{version:1},{ackScopes:[{...scope('7'),physicalReference:{lineIndex:7,id:'foreign point',li:'actual LI 7'}}]}])('rejects mismatched native scope receipt %j without secondary RPC or fallback',async patch=>{
 io.rpc.mockResolvedValue({data:receipt(patch),error:null})
 await expect(readProtectedOutboundAckReplay(authority)).rejects.toThrow()
 expect(io.rpc).toHaveBeenCalledOnce()
})
it('does not recover current grant denial or partially fixed scopes through legacy selectors',async()=>{
 for(const error of ['ediel_ack_replay_actor_not_authorized','ediel_prodat_ack_scope_partially_fixed','ediel_prodat_ack_scope_conflicting_outcome']){
  io.rpc.mockResolvedValue({data:null,error:Error(error)})
  await expect(readProtectedOutboundAckReplay(authority)).rejects.toThrow(error)
 }
 expect(io.rpc).toHaveBeenCalledTimes(3)
})
it('sends PRODAT to one native atomic scope owner while stripping foreign resource and authority draft metadata',async()=>{
 io.rpc.mockResolvedValue({data:receipt(),error:null})
 const input:CreateEdielMessageInput={actorUserId:'actor',companyId:'company',environment:'test',direction:'outbound',messageStandard:'edifact',messageFamily:'APERAK',messageCode:'APERAK',rawPayload:wantedRaw,customerId:'foreign',canonicalRulePackId:'caller-pack',sourceOperationId:'caller-hash'}
 expect(await persistAtomicOutboundAck(input,{...authority,outcome:'positive'})).toEqual(ack)
 const [name,args]=io.rpc.mock.calls[0];expect(name).toBe('ediel_create_outbound_ack_scope_atomic_v2');expect(args.p_draft.rawPayload).toBe(wantedRaw)
 for(const key of ['p_sequence_field','p_sequence_value'])expect(args).not.toHaveProperty(key)
 for(const key of ['actorUserId','customerId','canonicalRulePackId','sourceOperationId'])expect(args.p_draft).not.toHaveProperty(key)
 expect(io.rpc).toHaveBeenCalledOnce()
})
