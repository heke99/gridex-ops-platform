import {beforeEach,expect,it,vi} from 'vitest'
import {source,head} from './fixtures/prodat-identity'
import {raw,line,characteristic} from './fixtures/prodat-register'
const io=vi.hoisted(()=>({rpc:vi.fn(),provider:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/email/sendEdielEmail',()=>({sendEdielEmail:async(input:Record<string,unknown>,entry:{beforeProviderCall:(binding:Record<string,unknown>)=>Promise<void>})=>{
 await entry.beforeProviderCall({to:input.to,from:'own@example.invalid',mimeArchiveRef:'fixture://original',mimeSha256:'a'.repeat(64),mimeLength:123})
 io.provider();return {accepted:[input.to],rejected:[],messageId:'fixture-provider',response:'250 fixture'}
}}))
import {sendGenericFencedEdielEmail} from '@/lib/ediel/transport/outboundAttempt'
import {prepareEdielMeteringMethodExpectationPlan} from '@/lib/ediel/meteringMethodExpectationPolicy'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
const observedAt='2026-10-01T11:05:00Z'
beforeEach(()=>{vi.clearAllMocks();io.rpc.mockImplementation(async(_name,{p_input})=>({data:p_input.action==='observe'?{classification:'accepted',observedAt}:{proceed:true},error:null}))})
it.each(['F','G'] as const)('actual generic journal preserves the same admitted physical Z09%s plan before provider entry',async(variant)=>{
 const message={...source(raw([...head(),line('1','735123456789012345',undefined,'9'),['DTM',['157','202610050000','203']],...characteristic('Z13',variant==='F'?'E64':'E32'),...characteristic('Z04',variant==='F'?'Z04':'Z03')],'Z09'),'Z09'),direction:'outbound' as const,company_id:'own-company'}
 const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z09',subtypeOrReasonCode:variant,direction:'outbound',referenceDate:'2026-10-01',mode:'catalog_evidence'}),plan=prepareEdielMeteringMethodExpectationPlan(message,policy)
 const context={message,actorUserId:'actual-actor',mimeMode:'attachment',payload:Buffer.from(message.raw_payload!),encoding:'latin1',meteringMethodExpectationPlan:plan}
 await sendGenericFencedEdielEmail({to:'dso@example.invalid',subject:'fixture'},context)
 const prepare=io.rpc.mock.calls.find(([,{p_input}])=>p_input.action==='prepare')![1].p_input
 expect(prepare.binding.meteringMethodExpectationPlan).toEqual(plan)
 expect(prepare.binding.meteringMethodExpectationPlan).toMatchObject({sourceSubtype:variant,validityDay:'2026-10-05',offset:40,automaticResendAllowed:false})
 expect(io.rpc.mock.calls.map(([,{p_input}])=>p_input.action)).toEqual(['prepare','enter','observe']);expect(io.provider).toHaveBeenCalledTimes(1)
})
it('accepted private journal outcome still returns before any new provider or watch computation',async()=>{
 io.rpc.mockResolvedValue({data:{proceed:false,classification:'accepted',providerReceipt:{accepted:['dso@example.invalid'],rejected:[],messageId:'original-provider',response:'250 original'},observedAt},error:null})
 const message={...source(raw([...head(),line('1','735123456789012345',undefined,'9')],'Z09'),'Z09'),direction:'outbound' as const,company_id:'own-company'}
 const result=await sendGenericFencedEdielEmail({to:'dso@example.invalid',subject:'fixture'},{message,actorUserId:'actual-actor',mimeMode:'attachment',payload:Buffer.from(message.raw_payload!),encoding:'latin1'})
 expect(result).toMatchObject({dispatchReplay:true,messageId:'original-provider',dispatchObservedAt:observedAt});expect(io.provider).not.toHaveBeenCalled();expect(io.rpc).toHaveBeenCalledTimes(1)
})
