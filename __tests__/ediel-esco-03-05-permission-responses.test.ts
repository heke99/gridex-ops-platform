// masterplan: ESCO-03, AT-ESCO-03, ESCO-05, AT-ESCO-05
import {beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:()=>{throw Error('no table access expected')}}}))
import {applyPermissionEvent} from '@/lib/ediel/permissions/permissionEngine'
import {handleZ14PermissionResponse} from '@/lib/ediel/permissions/z14HandleResponse'
import {canTransitionPermissionState,type EnergyServicePermissionState} from '@/lib/ediel/permissions/permissionStateMachine'
import {classifyProductionInboundDecision} from '@/lib/ediel/inbound/productionInboundDecisionEngine'
import {applyPermissionMarketSource} from '@/lib/ediel/permissions/permissionMarketTransition'

const company='00000000-0000-4000-8000-000000000001'
// National PRODAT Z14 with field 223 (CCI Z13) and 322 (CCI Z23) inside the LIN group.
const z14=(reason:string,status:string)=>["UNB+UNOC:3+54321:14+12345:14+261001:1200+I++23-DGI-PRODAT","UNH+M+PRODAT:D:97A:UN:E2SE6A","BGM+Z14+DOC+9",
 "DTM+137:202610011200:203","NAD+FR+54321:160:SVK","NAD+DO+12345:160:SVK","LIN+1++735123456789012345:::9","CCI++Z13",`CAV+${reason}`,"CCI++Z23",`CAV+${status}`,
 "RFF+LI:LI-A","RFF+Z05:TES","NAD+UD+PERSON-A:SE1:260","UNT+14+M","UNZ+1+I"].join("'")+"'"
const aperak="UNB+UNOC:3+54321:14+12345:14+261001:1200+A++23-DGI-PRODAT'UNH+1+APERAK:D:96A:UN:E2SE6A'BGM+312+A+9'ERC+100::260'RFF+ACW:LI-A'UNT+5+1'UNZ+1+A'"
const decide=(raw:string,family='PRODAT',code='Z14')=>classifyProductionInboundDecision({messageFamily:family,messageCode:code,actorRole:'energy_service_company',rawPayload:raw} as never)
const negativeAperak=(notes:readonly string[])=>notes.some(note=>/selected negative APERAK/i.test(note))
const ACTIVE:EnergyServicePermissionState='active_after_z14v_or_z14vh'

beforeEach(()=>{io.rpc.mockReset().mockRejectedValue(Error('no permission RPC expected'))})

describe('ESCO-03 an APERAK accepts processing of the request, not the customer decision',()=>{
 it('a positive APERAK on the sent Z13 moves to awaiting the customer decision, never to an active permission',()=>{
  const acked=applyPermissionEvent({currentState:'z13_sent',event:'aperak_positive'})
  expect(acked).toBe('aperak_positive')
  expect(acked).not.toBe(ACTIVE)
  expect(canTransitionPermissionState(acked,'awaiting_customer_approval_21d')).toBe(true)
  // Only the separate Z14/Z14N business response decides.
  expect(applyPermissionEvent({currentState:'awaiting_customer_approval_21d',event:'z14v_received'})).toBe(ACTIVE)
  expect(applyPermissionEvent({currentState:'awaiting_customer_approval_21d',event:'z14n_a13'})).toBe('z14n_a13_withdrawn')
 })
 it('repeated or late ACKs cannot produce or overwrite a market decision',()=>{
  expect(applyPermissionEvent({currentState:'aperak_positive',event:'aperak_positive'})).toBe('aperak_positive')
  expect(applyPermissionEvent({currentState:ACTIVE,event:'aperak_positive'})).toBe(ACTIVE)
  expect(applyPermissionEvent({currentState:'z14n_a13_withdrawn',event:'aperak_positive'})).toBe('z14n_a13_withdrawn')
 })
 it('an inbound APERAK is registered as an ACK with no permission effect, and the permission executor never runs for it',async()=>{
  const decision=decide(aperak,'APERAK','312')
  expect(decision.businessEffect).toBe('register_ack')
  expect(decision.businessEffect).not.toBe('activate_permission')
  await expect(applyPermissionMarketSource({actorUserId:'user',message:{id:'ack',company_id:company,direction:'inbound',message_family:'APERAK',message_code:'312'} as never}))
   .resolves.toMatchObject({applied:false,permissionId:null,reason:'not_inbound_permission_source'})
  expect(io.rpc).not.toHaveBeenCalled()
 })
})

describe('ESCO-05 A13/A76 denial is a business answer, not a protocol error',()=>{
 it('A13 (active denial) and A76 (passive denial) end the request as denied without a permission',()=>{
  const a13=handleZ14PermissionResponse({currentState:'awaiting_customer_approval_21d',responseCode:'N',reasonCode:'A13'})
  const a76=handleZ14PermissionResponse({currentState:'awaiting_customer_approval_21d',responseCode:'N',reasonCode:'A76'})
  expect([a13,a76]).toEqual(['z14n_a13_withdrawn','z14n_a76_timeout'])
  expect(()=>applyPermissionEvent({currentState:'denied_withdrawn',event:'z14v_received'})).toThrow(/Otillåten/)
  expect(canTransitionPermissionState(a13,ACTIVE)).toBe(false)
  expect(canTransitionPermissionState(a76,ACTIVE)).toBe(false)
  expect(()=>handleZ14PermissionResponse({currentState:'awaiting_customer_approval_21d',responseCode:'N',reasonCode:'X99'})).toThrow('z14_negative_reason_unqualified')
 })
 it('a correct Z14 denial is classified as reject_permission and does not select a negative APERAK',()=>{
  for(const status of ['A13','A76']){
   const decision=decide(z14('Z96',status))
   expect(decision.scenario).toBe('prodat_permission_rejected')
   expect(decision.businessEffect).toBe('reject_permission')
   expect(negativeAperak(decision.notes)).toBe(false)
   expect(decision.notes).toContain('Z14N är ett affärsbesked om nekad tillgång. Det är inte automatiskt negativ APERAK om payload/process är korrekt.')
  }
 })
})
