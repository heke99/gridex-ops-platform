import { createHash } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

const io = vi.hoisted(() => ({ rpc: vi.fn(), provider: vi.fn(), status: vi.fn(), current: vi.fn(), register: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc,
  from: () => { throw new Error('unexpected_operational_read_or_mutation') } } }))
vi.mock('@/lib/ediel/db', () => ({ updateEdielMessageStatus: io.status, createEdielMessageEvent: vi.fn(),
  getEdielRouteProfileByCommunicationRouteId: io.current }))
vi.mock('@/lib/email/sendEdielEmail', () => ({ sendEdielEmail: io.provider }))
vi.mock('@/lib/ediel/services/reporting', () => ({ loadServiceReportingValidationContext: io.current }))
vi.mock('@/lib/ediel/production/dateEventContext', () => ({ loadProdatDateEventValidationContext: io.current }))
vi.mock('@/lib/ediel/businessExpectations', () => ({ registerEdielBusinessExpectations: io.register,
  prepareEdielBusinessExpectationPlan: io.current }))
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport/index.part-2'

const companyId='10000000-0000-4000-8000-000000000001', messageId='20000000-0000-4000-8000-000000000001'
const actorUserId='30000000-0000-4000-8000-000000000001', raw='DECLARED SYNTHETIC ALREADY ACCEPTED ORIGINAL'
const observedAt='2026-09-29T10:00:00.123Z'
const receipt = () => ({ status:'accepted_projection',companyId,environment:'test',messageId,
  attemptId:'40000000-0000-4000-8000-000000000001',lane:'generic_journal',originalHash:createHash('sha256').update(raw).digest('hex'),
  observedAt,frozenRecipient:'original@example.invalid',providerReceipt:{accepted:['original@example.invalid'],rejected:[],messageId:'<frozen@example.invalid>',response:'250 synthetic'},
  businessExpectationPlan:{version:1},authorizesProviderEntry:false,deliveryProven:false,projectionStatus:'acknowledged' })
const message=():EdielMessageRow=>({id:messageId,company_id:companyId,environment:'test',direction:'outbound',message_family:'PRODAT',
  message_code:'Z13',message_standard:'edifact',status:'acknowledged',raw_payload:raw,parsed_payload:{sourcePermissionBasis:{laterRevoked:true}}}) as unknown as EdielMessageRow
beforeEach(()=>{
 vi.clearAllMocks();io.rpc.mockImplementation(async(name:string)=>{
  if(name==='gridex_ediel_accepted_transport_projection_v1'||name==='gridex_ediel_repair_accepted_transport_projection_v1')return {data:receipt(),error:null}
  throw new Error(`unexpected_rpc:${name}`)
 });io.register.mockResolvedValue([])
})
it('repairs frozen accepted clock before current route, service, guide or provider calls',async()=>{
 const result=await sendEdielMessageViaSmtp(message(),{actorUserId})
 expect(result).toEqual({accepted:['original@example.invalid'],rejected:[],messageId:'<frozen@example.invalid>',dispatchObservedAt:observedAt})
 expect(io.rpc.mock.calls.map(([name])=>name)).toEqual(['gridex_ediel_accepted_transport_projection_v1','gridex_ediel_repair_accepted_transport_projection_v1'])
 expect(io.register).toHaveBeenCalledWith({companyId,environment:'test',messageId,actorUserId})
 expect(io.current).not.toHaveBeenCalled();expect(io.provider).not.toHaveBeenCalled();expect(io.status).not.toHaveBeenCalled()
})
it('does not repair a stale caller row with bytes different from the private original',async()=>{
 const source=message();source.raw_payload='CHANGED'
 await expect(sendEdielMessageViaSmtp(source,{actorUserId})).rejects.toMatchObject({code:'ediel_delivery_uncertain',smtpMessageId:'<frozen@example.invalid>'})
 expect(io.rpc).toHaveBeenCalledTimes(1);expect(io.provider).not.toHaveBeenCalled();expect(io.register).not.toHaveBeenCalled()
})
it('keeps accepted provider evidence when atomic repair cannot establish its projection',async()=>{
 io.rpc.mockImplementation(async(name:string)=>name==='gridex_ediel_accepted_transport_projection_v1'?{data:receipt(),error:null}:{data:null,error:new Error('repair_unavailable')})
 await expect(sendEdielMessageViaSmtp(message(),{actorUserId})).rejects.toMatchObject({code:'ediel_delivery_uncertain',smtpMessageId:'<frozen@example.invalid>'})
 expect(io.provider).not.toHaveBeenCalled();expect(io.current).not.toHaveBeenCalled()
})
it('holds historical sent status without actual journal proof instead of manufacturing a clock or resending',async()=>{
 io.rpc.mockResolvedValue({data:null,error:null})
 await expect(sendEdielMessageViaSmtp(message(),{actorUserId})).rejects.toThrow('ediel_historical_transport_receipt_unavailable')
 expect(io.provider).not.toHaveBeenCalled();expect(io.current).not.toHaveBeenCalled();expect(io.status).not.toHaveBeenCalled()
})
it('enforces the current actor and tenant scope at the private reader',async()=>{
 io.rpc.mockResolvedValue({data:null,error:new Error('ediel_accepted_projection_actor_forbidden')})
 await expect(sendEdielMessageViaSmtp(message(),{actorUserId})).rejects.toThrow('actor_forbidden')
 expect(io.rpc).toHaveBeenCalledWith('gridex_ediel_accepted_transport_projection_v1',{p_company_id:companyId,p_environment:'test',p_actor_user_id:actorUserId,p_message_id:messageId})
 expect(io.provider).not.toHaveBeenCalled();expect(io.register).not.toHaveBeenCalled()
})
