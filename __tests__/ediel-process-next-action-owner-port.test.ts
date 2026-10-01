import { beforeEach, describe, expect, it, vi } from 'vitest'
const port=vi.hoisted(()=>({rpc:vi.fn(),db:vi.fn(),select:vi.fn(),ids:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:port.rpc}}))
vi.mock('@/lib/supabase/tenantDb',()=>({tenantDb:port.db}))
import { readEdielProcessNextActions } from '@/lib/ediel/operations/processNextAction'
const actor='current-actor',company='own-company',source='own-source'
const row={id:'private-watch',source_message_id:source,expected_code:'Z02',due_at:'2026-10-01T12:30:00Z',status:'pending',metadata:{
  anchorType:'actual_accepted_smtp_observed_at',anchorAt:'2026-10-01T12:00:00Z',timerKind:'internal_sender_watch',remoteReceiptKnown:false}}
const m={id:source,company_id:company,environment:'test',direction:'outbound',message_family:'PRODAT',message_code:'Z01',status:'sent',requires_contrl:true,
  contrl_status:'received',contrl_due_at:null,requires_aperak:false,aperak_status:'not_required'}
const input={companyId:company,actorUserId:actor,environment:'test' as const,messageIds:[source],evaluatedAt:'2026-10-01T12:20:00Z',access:{canRead:true,canReview:false,canPrepare:false}}
beforeEach(()=>{
  vi.resetAllMocks()
  port.rpc.mockImplementation(async(name:string)=>({error:null,data:name==='gridex_ediel_business_expectations_v1'?[row]:[]}))
  port.ids.mockResolvedValue({error:null,data:[m]});port.select.mockReturnValue({in:port.ids})
  port.db.mockReturnValue({from:(table:string)=>{expect(table).toBe('ediel_messages');return {select:port.select}}})
})
describe('OPS02 protected owner-to-read-only consumer',()=>{
  it('uses exact actor/tenant/environment/source private RPC before actual tenant-scoped source rows',async()=>{
    const d=await readEdielProcessNextActions(input)
    expect(d.get(source)).toMatchObject({cause:'business_response_pending',waitingFor:['Z02_or_negative_APERAK'],allowedActions:['read_source'],authorizesProviderEntry:false})
    expect(port.rpc).toHaveBeenCalledWith('gridex_ediel_business_expectations_v1',{p_input:{companyId:company,environment:'test',actorUserId:actor,messageId:source,limit:100,action:'read'}})
    expect(port.rpc).toHaveBeenCalledWith('gridex_ediel_metering_method_expectations_v1',{p_input:{companyId:company,environment:'test',actorUserId:actor,messageId:source,limit:100,action:'read'}})
    expect(port.db).toHaveBeenCalledWith(company);expect(port.ids).toHaveBeenCalledWith('id',[source])
    expect(port.rpc.mock.invocationCallOrder[0]).toBeLessThan(port.db.mock.invocationCallOrder[0])
    expect(port.rpc.mock.invocationCallOrder[1]).toBeLessThan(port.db.mock.invocationCallOrder[0])
  })
  it('denied current owner read propagates and never falls back to public waiting/ready metadata',async()=>{
    port.rpc.mockResolvedValue({error:new Error('ediel_expectation_actor_not_authorized'),data:null})
    await expect(readEdielProcessNextActions(input)).rejects.toThrow('actor_not_authorized');expect(port.db).not.toHaveBeenCalled()
  })
  it('foreign/missing/duplicate native sources and ambiguous private watches never become an allowed action',async()=>{
    for(const sources of [[{...m,company_id:'foreign'}],[],[m,m]]){
      port.ids.mockResolvedValue({error:null,data:sources});await expect(readEdielProcessNextActions(input)).rejects.toThrow('exact_source_required')
    }
    port.ids.mockResolvedValue({error:null,data:[m]});port.rpc.mockResolvedValue({error:null,data:[row,row]})
    await expect(readEdielProcessNextActions(input)).rejects.toThrow('expectation_ambiguous')
  })
  it('reads explicitly requested new sources rather than an arbitrary oldest100 global prefix',async()=>{
    await readEdielProcessNextActions({...input,messageIds:[source,source]});expect(port.rpc).toHaveBeenCalledTimes(2)
    await expect(readEdielProcessNextActions({...input,messageIds:Array.from({length:101},(_,i)=>String(i))})).rejects.toThrow('scope_limit')
    expect(port.rpc).toHaveBeenCalledTimes(2)
  })
  it('an identical cross-owner observation is deduped but conflicting rows fail before source reads',async()=>{
    port.rpc.mockResolvedValue({error:null,data:[row]});expect((await readEdielProcessNextActions(input)).size).toBe(1)
    port.db.mockClear();port.rpc.mockImplementation(async(name:string)=>({error:null,data:[name==='gridex_ediel_business_expectations_v1'?row:{...row,status:'fulfilled'}]}))
    await expect(readEdielProcessNextActions(input)).rejects.toThrow('expectation_ambiguous');expect(port.db).not.toHaveBeenCalled()
  })
  it('either private owner denial prevents tenant source reads even when the other owner succeeds',async()=>{
    port.rpc.mockImplementation(async(name:string)=>name==='gridex_ediel_business_expectations_v1'?{error:null,data:[row]}:{error:new Error('method_actor_denied'),data:null})
    await expect(readEdielProcessNextActions(input)).rejects.toThrow('method_actor_denied');expect(port.db).not.toHaveBeenCalled()
  })
  it('ordinary method owner observations use the actual Z09 source and validity-day clock',async()=>{
    const method={...row,expected_code:'Z06',due_at:'2026-11-10T23:00:00Z',metadata:{timerRuleId:'TM-METHOD40',timerKind:'source_validity_day_watch',anchorType:'z09_validity_day',validityDay:'2026-10-01',dueDay:'2026-11-10',actualAcceptedAt:'2026-10-01T12:00:00Z',remoteReceiptKnown:false,automaticResendAllowed:false,authorizesMarketEffects:false,observationCriterion:'same_applied_own_Z06_explicit_method_customer_point_agency_parties_and_not_before_validity_day'}}
    port.rpc.mockImplementation(async(name:string)=>({error:null,data:name==='gridex_ediel_metering_method_expectations_v1'?[method]:[]}))
    port.ids.mockResolvedValue({error:null,data:[{...m,message_code:'Z09'}]})
    expect((await readEdielProcessNextActions(input)).get(source)).toMatchObject({cause:'business_response_pending',waitingFor:['Z06'],timeBasis:{anchor:'z09_validity_day',actualAcceptedAt:'2026-10-01T12:00:00.000Z'}})
  })
})
