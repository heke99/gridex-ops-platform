import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),providerCalls:0,failProvider:false,skipCallback:false}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:mocks.rpc}}))
vi.mock('@/lib/email/sendEdielEmail',()=>({sendEdielEmail:vi.fn(async (_input,entry)=>{
 if(!mocks.skipCallback)await entry.beforeProviderCall({from:'esco@example.invalid',to:'dso@example.invalid',rfcMessageId:'<fixture>',mimeArchiveRef:'storage://fixture',mimeSha256:'b'.repeat(64),mimeLength:123})
 mocks.providerCalls++
 if(mocks.failProvider)throw Object.assign(new Error('connection lost'),{code:'ECONNRESET'})
 return {accepted:['dso@example.invalid'],rejected:[],messageId:'<fixture>',response:'250 fixture'}
})}))
import { SmtpDeliveryUncertainError } from '@/lib/ediel/transport/smtpOutcome'
import { sendGenericFencedEdielEmail } from '@/lib/ediel/transport/outboundAttempt'
const context={message:{id:'message',company_id:'company',environment:'test',raw_payload:'fixture',communication_route_id:'route'} as EdielMessageRow,actorUserId:'actor',mimeMode:'attachment',payload:Buffer.from('fixture'),encoding:'latin1'}
const input={to:'dso@example.invalid',subject:'fixture'}
const observedAt='2026-09-30T12:34:56.789Z'
describe('all-family durable outbound journal',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.providerCalls=0;mocks.failProvider=false;mocks.skipCallback=false;mocks.rpc.mockImplementation(async(_name,{p_input})=>({error:null,data:p_input.action==='observe'?{classification:'accepted',observedAt}:{proceed:true}}))})
 it('commits prepare and entry before provider, then captures outcome',async()=>{
  const actions:string[]=[]
  mocks.rpc.mockImplementation(async(_name,{p_input})=>{actions.push(p_input.action);if(p_input.action==='enter')expect(mocks.providerCalls).toBe(0);return{error:null,data:p_input.action==='observe'?{classification:'accepted',observedAt}:{proceed:true}}})
  expect(await sendGenericFencedEdielEmail(input,context)).toMatchObject({accepted:['dso@example.invalid'],dispatchObservedAt:observedAt})
  expect(actions).toEqual(['prepare','enter','observe']);expect(mocks.providerCalls).toBe(1)
 })
 it('holds accepted classification without an authentic observation clock for reconciliation',async()=>{
  mocks.rpc.mockImplementation(async(_name,{p_input})=>({error:null,data:p_input.action==='observe'?{classification:'accepted'}:{proceed:true}}))
  await expect(sendGenericFencedEdielEmail(input,context)).rejects.toMatchObject({code:'ediel_delivery_uncertain',smtpMessageId:'<fixture>'})
  expect(mocks.providerCalls).toBe(1)
  expect(mocks.rpc.mock.calls.map(c=>c[1].p_input.action)).toEqual(['prepare','enter','observe'])
 })
 it('suppresses entered unknown without provider retry',async()=>{
  mocks.rpc.mockResolvedValue({error:null,data:{proceed:false,state:'entered',classification:null}})
  await expect(sendGenericFencedEdielEmail(input,context)).rejects.toBeInstanceOf(SmtpDeliveryUncertainError)
  expect(mocks.providerCalls).toBe(0);expect(mocks.rpc).toHaveBeenCalledTimes(1)
 })
 it('projects an immutable accepted receipt without provider retry',async()=>{
  mocks.rpc.mockResolvedValue({error:null,data:{proceed:false,classification:'accepted',providerReceipt:{accepted:[input.to],rejected:[],messageId:'<old>',response:'250 old'},observedAt:'2026-09-30T00:00:00Z'}})
  const result=await sendGenericFencedEdielEmail(input,context);expect(result.dispatchReplay).toBe(true);expect(result.messageId).toBe('<old>');expect(mocks.providerCalls).toBe(0)
 })
 it('retains no-resend on lost entry response',async()=>{
  mocks.rpc.mockImplementation(async(_name,{p_input})=>p_input.action==='enter'?{data:null,error:new Error('response lost')}:{data:p_input.action==='observe'?{classification:'unknown'}:{proceed:true},error:null})
  await expect(sendGenericFencedEdielEmail(input,context)).rejects.toBeInstanceOf(SmtpDeliveryUncertainError);expect(mocks.providerCalls).toBe(0)
  expect(mocks.rpc.mock.calls.map(c=>c[1].p_input.action)).toEqual(['prepare','enter','observe'])
 })
 it('captures transport error without inventing acceptance or releasing entered attempt',async()=>{
  mocks.failProvider=true
  await expect(sendGenericFencedEdielEmail(input,context)).rejects.toBeInstanceOf(SmtpDeliveryUncertainError)
  const observation=mocks.rpc.mock.calls.find(c=>c[1].p_input.action==='observe')?.[1].p_input.result
  expect(observation.error.code).toBe('ECONNRESET');expect(observation.accepted).toBeUndefined()
  expect(mocks.rpc.mock.calls.some(c=>c[1].p_input.action==='release')).toBe(false)
 })
})
