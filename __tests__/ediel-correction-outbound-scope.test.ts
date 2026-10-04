import { createHash } from 'node:crypto'
import {transportJournalFixture} from './fixtures/ediel-transport-journal'
import { beforeEach, expect, it, vi } from 'vitest'
import { closureFixture } from './helpers/closureWireFixtures'
import type { EdielMessageRow } from '@/lib/ediel/types'

const io = vi.hoisted(() => ({
  provider: vi.fn(),
  rpc: vi.fn(),
  message: null as EdielMessageRow | null,
  attemptId: '', stage: 'none', actions: [] as string[],
}))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))
vi.mock('@/lib/email/sendEdielEmail', () => ({
  sendEdielEmail: async (_input: unknown, entry?: import('@/lib/email/sendEdielEmail').EdielProviderEntry) => {
    if(io.message) io.actions.push('beforeProviderCall')
    await journal.beforeProvider(_input as import('@/lib/email/sendEdielEmail').SendEdielEmailInput,entry)
    if(io.message) io.actions.push('provider')
    io.provider()
    return { accepted: ['receiver@example.invalid'], rejected: [], messageId: 'synthetic' }
  },
}))

let journal:ReturnType<typeof transportJournalFixture>
beforeEach(() => {
 journal=transportJournalFixture()
  vi.clearAllMocks()
  io.message=null;io.attemptId='';io.stage='none';io.actions=[]
  // This is the old SQL result for a stale non-Z08 row code and a malformed
  // raw Z08 body. The real SQL boundary is exercised by the native companion.
  io.rpc.mockImplementation(async(name,args)=>name==='gridex_outbound_dispatch_v1'?{data:{scoped:false},error:null}:journal.rpc(name,args))
})

function outgoing(raw:string) { return {from:'sender@example.invalid',to:'receiver@example.invalid',subject:'synthetic',attachments:[{filename:'synthetic.edi',content:Buffer.from(raw),contentType:'application/edifact'}]} }

/** Only scoped database receipts are synthetic. Real fenced entry, MIME
 * callback ordering and observation-clock decoding remain unchanged. */
function sealedClockFixture(mode:'valid'|'missing'|'invalid'|'foreign-clock') {
  const raw=closureFixture({reason:'Z25'}).wire.replace('BGM+Z05','BGM+Z08')
  const message={id:'00000000-0000-4000-8000-000000000007',company_id:'00000000-0000-4000-8000-000000000002',
    environment:'test',direction:'outbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z08',raw_payload:raw,communication_route_id:null} as EdielMessageRow
  io.message=message
  const observedAt='2026-09-30T12:34:56.789Z',events=new Map<string,string>()
  let acceptedReceipt:Record<string,unknown>|null=null
  io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
    expect(name).toBe('gridex_outbound_dispatch_v1')
    const input=args.p_input as Record<string,unknown>
    expect(input).toMatchObject({companyId:message.company_id,environment:'test',messageId:message.id,actorUserId:'00000000-0000-4000-8000-000000000003'})
    expect(input.attemptId).toMatch(/^[0-9a-f-]{36}$/)
    if(input.action==='witness'){
      const action=events.get(String(input.eventId));expect(action).toBeDefined();io.actions.push(`sealed:witness:${action}`)
      return{data:{scoped:true,eventId:input.eventId,witnessed:true},error:null}
    }
    const action=String(input.action),eventId=`00000000-0000-4000-8000-${String(events.size+90).padStart(12,'0')}`
    io.actions.push(`sealed:${action}`)
    if(action==='prepare'){
      expect(input.binding).toMatchObject({originalHash:createHash('sha256').update(raw).digest('hex'),payloadBase64:Buffer.from(raw).toString('base64'),businessExpectationPlan:null})
      if(acceptedReceipt)return{data:{scoped:true,proceed:false,acceptedReceipt},error:null}
      io.attemptId=String(input.attemptId);io.stage='prepared';events.set(eventId,action)
      return{data:{scoped:true,proceed:true,eventId},error:null}
    }
    expect(input.attemptId).toBe(io.attemptId)
    if(action==='enter'){
      expect(io.stage).toBe('prepared');expect(io.provider).not.toHaveBeenCalled();io.stage='entered';events.set(eventId,action)
      return{data:{scoped:true,proceed:true,eventId},error:null}
    }
    expect(action).toBe('result');expect(io.stage).toBe('entered');expect(io.provider).toHaveBeenCalledOnce()
    expect(input.result).toEqual({accepted:['receiver@example.invalid'],rejected:[],messageId:'synthetic',response:null})
    acceptedReceipt={...input.result as Record<string,unknown>,observedAt};io.stage='observed';events.set(eventId,action)
    return{data:{scoped:true,eventId,facts:{classification:'accepted'},
      ...(mode==='missing'?{}:{observedAt:mode==='invalid'?'not-a-clock':observedAt}),
      observationClock:mode==='foreign-clock'?'caller_clock':'database_provider_result_capture'},error:null}
  })
  return{message,raw,observedAt}
}

it('returns the witnessed Z08 provider-result database clock without substituting local time',async()=>{
  const {sendCorrectionFencedEmail}=await import('@/lib/ediel/sources/correctionOutboundDispatch')
  const {message,raw,observedAt}=sealedClockFixture('valid')
  await expect(sendCorrectionFencedEmail(outgoing(raw),{message,actorUserId:'00000000-0000-4000-8000-000000000003',mimeMode:'synthetic',payload:Buffer.from(raw),encoding:'latin1'})).resolves.toMatchObject({dispatchObservedAt:observedAt})
  expect(io.actions).toEqual(['beforeProviderCall','sealed:prepare','sealed:witness:prepare','sealed:enter','sealed:witness:enter','provider','sealed:result','sealed:witness:result'])
})

it.each(['missing','invalid','foreign-clock'] as const)('holds a %s Z08 clock after acceptance and replays without repeating provider entry',async mode=>{
  const {sendCorrectionFencedEmail}=await import('@/lib/ediel/sources/correctionOutboundDispatch')
  const {message,raw,observedAt}=sealedClockFixture(mode)
  const send=()=>sendCorrectionFencedEmail(outgoing(raw),{message,actorUserId:'00000000-0000-4000-8000-000000000003',mimeMode:'synthetic',payload:Buffer.from(raw),encoding:'latin1'})
  await expect(send()).rejects.toMatchObject({code:'ediel_delivery_uncertain',smtpMessageId:'synthetic'})
  await expect(send()).resolves.toMatchObject({dispatchReplay:true,dispatchObservedAt:observedAt,messageId:'synthetic'})
  expect(io.provider).toHaveBeenCalledOnce()
  expect(io.actions).toEqual(['beforeProviderCall','sealed:prepare','sealed:witness:prepare','sealed:enter','sealed:witness:enter','provider','sealed:result','sealed:witness:result','beforeProviderCall','sealed:prepare'])
})

it('holds a potential Z08 before SMTP when the database does not scope its original', async () => {
  const { sendCorrectionFencedEmail } = await import('@/lib/ediel/sources/correctionOutboundDispatch')
  const raw = closureFixture({ reason: 'Z25' }).wire.replace('BGM+Z05', 'BGM+Z08').slice(0, -1)
  const message = {
    id: '00000000-0000-4000-8000-000000000001', company_id: '00000000-0000-4000-8000-000000000002',
    environment: 'test', direction: 'outbound', message_standard:'edifact', message_family: 'PRODAT', message_code: 'Z01', raw_payload: raw,
  } as EdielMessageRow

  await expect(sendCorrectionFencedEmail(
    { from:'sender@example.invalid',to: 'receiver@example.invalid', subject: 'synthetic' },
    { message, actorUserId: '00000000-0000-4000-8000-000000000003', mimeMode: 'synthetic',
      payload: Buffer.from(raw, 'utf8'), encoding: 'latin1' },
  )).rejects.toThrow('outbound_dispatch_scope_mismatch')
  expect(io.provider).not.toHaveBeenCalled()
})

it('journals a valid non-Z08 outbound PRODAT before its provider entry', async () => {
  const { sendCorrectionFencedEmail } = await import('@/lib/ediel/sources/correctionOutboundDispatch')
  const raw = closureFixture().wire.replace('BGM+Z05', 'BGM+Z03')
  const message = {
    id: '00000000-0000-4000-8000-000000000004', company_id: '00000000-0000-4000-8000-000000000002',
    environment: 'test', direction: 'outbound', message_standard:'edifact', message_family: 'PRODAT', message_code: 'Z03', raw_payload: raw,
  } as EdielMessageRow

  await expect(sendCorrectionFencedEmail(
    { from:'sender@example.invalid',to: 'receiver@example.invalid', subject: 'synthetic' },
    { message, actorUserId: '00000000-0000-4000-8000-000000000003', mimeMode: 'synthetic',
      payload: Buffer.from(raw, 'utf8'), encoding: 'latin1' },
  )).resolves.toMatchObject({ accepted: ['receiver@example.invalid'] })
  expect(io.provider).toHaveBeenCalledOnce()
  expect(journal.actions).toEqual(['prepare','enter','observe'])
})

it('journals a canonical Z08 LK exemption without weakening the sealed H lane', async () => {
  io.rpc.mockImplementation(async(name,args)=>name==='gridex_outbound_dispatch_v1'?{data:{scoped:false,unscopedReason:'canonical_lk_exemption'},error:null}:journal.rpc(name,args))
  const { sendCorrectionFencedEmail } = await import('@/lib/ediel/sources/correctionOutboundDispatch')
  const raw = closureFixture({ reason: 'Z23' }).wire.replace('BGM+Z05', 'BGM+Z08')
  const message = {
    id: '00000000-0000-4000-8000-000000000005', company_id: '00000000-0000-4000-8000-000000000002',
    environment: 'test', direction: 'outbound', message_standard:'edifact', message_family: 'PRODAT', message_code: 'Z08', raw_payload: raw,
    rule_profile_key: 'PRODAT:Z08:LK:26.A:r3',
  } as EdielMessageRow

  await expect(sendCorrectionFencedEmail(
    { from:'sender@example.invalid',to: 'receiver@example.invalid', subject: 'synthetic' },
    { message, actorUserId: '00000000-0000-4000-8000-000000000003', mimeMode: 'synthetic',
      payload: Buffer.from(raw, 'utf8'), encoding: 'latin1' },
  )).resolves.toMatchObject({ accepted: ['receiver@example.invalid'] })
  expect(io.provider).toHaveBeenCalledOnce()
  expect(journal.actions).toEqual(['prepare','enter','observe'])
})

it('holds an entered unknown generic attempt on retry without another provider call',async()=>{
 const {sendCorrectionFencedEmail}=await import('@/lib/ediel/sources/correctionOutboundDispatch')
 const raw=closureFixture().wire.replace('BGM+Z05','BGM+Z03')
 const message={id:'00000000-0000-4000-8000-000000000006',company_id:'00000000-0000-4000-8000-000000000002',environment:'test',direction:'outbound',message_family:'PRODAT',message_code:'Z03',raw_payload:raw} as EdielMessageRow
 io.provider.mockImplementation(()=>{throw Error('connection response lost after provider entry')})
 const send=()=>sendCorrectionFencedEmail({from:'sender@example.invalid',to:'receiver@example.invalid',subject:'synthetic'}, {message,actorUserId:'00000000-0000-4000-8000-000000000003',mimeMode:'synthetic',payload:Buffer.from(raw,'utf8'),encoding:'latin1'})
 await expect(send()).rejects.toMatchObject({code:'ediel_delivery_uncertain'})
 await expect(send()).rejects.toMatchObject({code:'ediel_delivery_uncertain'})
 expect(io.provider).toHaveBeenCalledOnce()
 expect(journal.actions).toEqual(['prepare','enter','observe','prepare'])
})
