// masterplan: TR-02, AT-TR-02
// masterplan: TR-04, AT-TR-04, SC-062
import {beforeEach,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
const io=vi.hoisted(()=>({calls:[] as Array<{name:string;args:Record<string,unknown>}>,error:null as unknown,readCompany:null as string|null}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:(name:string,args:Record<string,unknown>)=>{
  io.calls.push({name,args})
  const p=args.p_input as Record<string,unknown>|undefined
  return Promise.resolve({error:io.error,data:p?{version:1,observationId:'00000000-0000-4000-8000-000000000010',attemptId:'00000000-0000-4000-8000-000000000011',
    messageId:'00000000-0000-4000-8000-000000000012',sourceHash:p.sourceHash,observedAt:'2026-09-30T20:00:00Z',transportCorrelation:'source_matched_unverified',authorizesResend:false,deliveryProven:false}
    :{version:1,companyId:io.readCompany ?? args.p_company_id,messageId:args.p_message_id,authorizesResend:false,deliveryProven:false,observations:[]}})
}}}))
import {recordDsnSourceObservation,readDsnSourceObservations} from '@/lib/inbound-mail/dsnSourceObservations'
const uid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const raw='Content-Type: multipart/report; report-type=delivery-status; boundary=dsn\r\n\r\n--dsn\r\nContent-Type: message/delivery-status\r\n\r\nReporting-MTA: dns; synthetic.invalid\r\n\r\nFinal-Recipient: rfc822; recipient@example.invalid\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550 synthetic\r\n\r\n--dsn\r\nContent-Type: text/rfc822-headers\r\n\r\nMessage-ID: <original@example.invalid>\r\n\r\n--dsn--\r\n'
const scope={companyId:uid(1),actorUserId:uid(2),inboundEmailMessageId:uid(3),sourceField:'raw_email' as const,rawSource:raw}
beforeEach(()=>{io.calls=[];io.error=null;io.readCompany=null})
it('binds the exact fetched MIME hash and actual own parser to the protected source write',async()=>{
  const observation=await recordDsnSourceObservation(scope)
  expect(observation).toMatchObject({authorizesResend:false,deliveryProven:false,transportCorrelation:'source_matched_unverified'})
  expect(io.calls).toHaveLength(1)
  expect(io.calls[0].name).toBe('ediel_record_dsn_source_observation_v1')
  expect(io.calls[0].args.p_input).toMatchObject({companyId:uid(1),inboundEmailMessageId:uid(3),sourceHash:createHash('sha256').update(raw).digest('hex'),
    report:{recipients:[{action:'failed',status:'5.1.1',diagnosticCode:{type:'smtp',text:'550 synthetic'}}]}})
})
it('never treats returned original EDIFACT as a qualified delivery report',async()=>{
  expect(await recordDsnSourceObservation({...scope,rawSource:"UNB+UNOC:3+S+R+260930:1200+ORIGINAL'"})).toBeNull()
  expect(io.calls).toEqual([])
})
it('holds contradictory or ambiguous MIME before any native write',async()=>{
  expect(await recordDsnSourceObservation({...scope,rawSource:raw.replace('Status: 5.1.1','Status: 2.1.1')})).toBeNull()
  expect(io.calls).toEqual([])
})
it('requires the actual attachment identity when the report is an attachment',async()=>{
  await expect(recordDsnSourceObservation({...scope,sourceField:'attachment'})).rejects.toThrow('ediel_dsn_source_scope_required')
  expect(io.calls).toEqual([])
  await recordDsnSourceObservation({...scope,sourceField:'attachment',attachmentId:uid(8)})
  expect(io.calls[0].args.p_input).toMatchObject({sourceField:'attachment',attachmentId:uid(8)})
})
it('does not invent an observation when persistence fails',async()=>{
  io.error={message:'atomic write failed'}
  await expect(recordDsnSourceObservation(scope)).rejects.toThrow('ediel_dsn_source_observation_unconfirmed')
})
it('reads only the actual authorized company/message projection',async()=>{
  expect(await readDsnSourceObservations({companyId:uid(1),actorUserId:uid(2),messageId:uid(4)})).toMatchObject({companyId:uid(1),observations:[],deliveryProven:false})
  io.readCompany=uid(99)
  await expect(readDsnSourceObservations({companyId:uid(1),actorUserId:uid(2),messageId:uid(4)})).rejects.toThrow('ediel_dsn_source_observations_unavailable')
})
