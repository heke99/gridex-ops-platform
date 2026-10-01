import {createHash,randomUUID} from 'node:crypto'
import {existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {afterEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
const io=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
const gatewayPath=new URL('../lib/ediel/transport/exception/source.ts',import.meta.url)
const message={id:randomUUID(),company_id:randomUUID(),environment:'test',direction:'outbound',message_standard:'edifact',
 message_family:'PRODAT',message_code:'Z03',sender_ediel_id:'43210',receiver_ediel_id:'76543',
 communication_route_id:randomUUID(),route_profile_id:randomUUID(),receiver_email:'synthetic@example.invalid',raw_payload:'synthetic original bytes'} as EdielMessageRow
const actorUserId=randomUUID(),exceptionId=randomUUID(),digest=createHash('sha256').update(message.raw_payload!).digest('hex')
const original=()=>({status:'authorized',version:1,approvalId:exceptionId,companyId:message.company_id,environment:message.environment,
 messageId:message.id,actorUserId,originalHash:digest,routeId:message.communication_route_id,senderEdielId:'43210',receiverEdielId:'76543',
 receiverEmail:'synthetic@example.invalid',case:'temporary_encryption_failure',sourceDigest:'a'.repeat(64),approvalDigest:'b'.repeat(64),
 tlsEvidenceDigest:'c'.repeat(64),validFrom:new Date(Date.now()-60000).toISOString(),validTo:new Date(Date.now()+60000).toISOString(),
 priorCrlSha256:[],certificateAuthorityId:null,cdpLocations:[]})
// Before the producer exists this returns a clear missing-feature result, so
// the positive behavior first fails an assertion rather than an import error.
async function read(){
 if(!existsSync(fileURLToPath(gatewayPath)))return {status:'held',reason:'exception_gateway_missing'}
 return (await import('@/lib/ediel/transport/exception/source')).readTransportExceptionAuthorization({message,actorUserId,exceptionId})
}
afterEach(()=>{io.rpc.mockReset()})
it('qualifies a current private-source temporary incident for only its actual immutable original',async()=>{
 io.rpc.mockResolvedValue({data:original(),error:null})
 expect(await read()).toMatchObject({status:'authorized',approvalId:exceptionId,case:'temporary_encryption_failure'})
})
it('holds an absent approved incident without creating a plaintext authorization',async()=>{
 io.rpc.mockResolvedValue({data:{status:'held',missing:['transport_exception_approved_source_absent']},error:null})
 expect(await read()).toEqual({status:'held',missing:['transport_exception_approved_source_absent']})
})
it.each([
 {companyId:randomUUID()},{messageId:randomUUID()},{actorUserId:randomUUID()},{environment:'production'},
 {originalHash:'f'.repeat(64)},{senderEdielId:'FORGED'},{receiverEdielId:'FORGED'},
 {receiverEmail:'foreign@example.invalid'},{routeId:randomUUID()},
 {case:'disable_tls'},{tlsEvidenceDigest:null},{validTo:new Date(Date.now()-1).toISOString()},
 {case:'crl_refresh_failure',priorCrlSha256:[]},
])('rejects an authority port result with wrong scope or reserve conditions %o',async mutation=>{
 io.rpc.mockResolvedValue({data:{...original(),...mutation},error:null})
 await expect(read()).rejects.toThrow(/transport_exception/)
})
it('does not let a caller clone or mutate the issued source capability into a reserve operation',async()=>{
 io.rpc.mockResolvedValue({data:original(),error:null})
 const authorization=await read(),source=await import('@/lib/ediel/transport/exception/source')
 expect(source.transportExceptionBinding(authorization,message,actorUserId)).toMatchObject({approvalId:exceptionId,originalHash:digest})
 expect(()=>source.transportExceptionBinding(structuredClone(authorization),message,actorUserId)).toThrow(/transport_exception/)
 expect(()=>source.transportExceptionBinding({...authorization,case:'recipient_certificate_unavailable'},message,actorUserId)).toThrow(/transport_exception/)
})
