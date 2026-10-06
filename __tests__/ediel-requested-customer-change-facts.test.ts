// Real gateway and register evidence; declared source/catalog/queue ports.
// Native tests separately qualify issuer, review, SQL and actual send effects.
import type {CustomerLifeEventBasis} from '@/lib/ediel/production/lifeEventSource'
import {createHash} from 'node:crypto'
import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rpc:vi.fn(),finalize:vi.fn(),reserve:vi.fn(),read:vi.fn(),intent:vi.fn(),queue:vi.fn(),update:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/core/kernel',()=>({finalizeCanonicalOutboundDraft:io.finalize}))
vi.mock('@/lib/ediel/production/lifeEventSource',()=>({readCustomerLifeEventSource:io.read,reserveCustomerLifeEventSource:io.reserve,customerLifeEventContext:()=>({declaredDeathContext:true})}))
vi.mock('@/lib/ediel/intent/intentEngine',()=>({getEdielMessageIntentById:io.intent,evaluateIntentValidation:()=>({ok:true}),updateIntentLifecycle:io.update}))
vi.mock('@/lib/ediel/core/versionRegistry',()=>({resolveCanonicalOutboundVersion:async()=> 'E2SE6A'}))
vi.mock('@/lib/ediel/flows/shared',()=>({queuePreparedEdielMessage:io.queue}))
import {renderAndQueueCustomerLifeEvent} from '@/lib/ediel/intent/customerLifeEventGateway'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {line,characteristic} from './fixtures/prodat-register'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const point='735999000000001'
const selectedTokens=[{tag:'NAD',elements:[['NAD'],['UD'],['SELECTED-CUSTOMER','SE2','260'],[''],['DESIRED NEW CUSTOMER'],['SELECTED ROAD 1'],['TEST'],[''],['12345'],['SE']]},{tag:'NAD',elements:[['NAD'],['IV'],['SELECTED-INVOICEE','SE2','260'],[''],['DESIRED NEW INVOICEE'],['OTHER ROAD 2'],['TEST'],[''],['54321'],['SE']]}]
const raw=guideOrderedFixtureRaw([line('1',point,undefined,'9'),...characteristic('Z13','E34'),['NAD','UD',['SELECTED-CUSTOMER','SE2','260'],'','DESIRED NEW CUSTOMER','SELECTED ROAD 1','TEST','','12345','SE'],['NAD','IV',['SELECTED-INVOICEE','SE2','260'],'','DESIRED NEW INVOICEE','OTHER ROAD 2','TEST','','54321','SE']],'Z09')
const sha=(v:string)=>createHash('sha256').update(v).digest('hex')
const basis={status:'authorized',companyId:id(1),environment:'test',eventId:id(2),customerId:id(3),siteId:id(4),meteringPointId:id(5),pointId:point,rawPayload:raw,sourceReference:'declared signed PDF',sourceVersion:'1',sourceDigest:'a'.repeat(64),documentReference:'OWN',interchangeReference:'I',messageReference:'M',transactionReference:'LI'}
const selection=()=>({status:'authorized',companyId:id(1),environment:'test',eventId:id(2),artifactId:id(6),customerId:id(3),sourceReference:basis.sourceReference,sourceVersion:basis.sourceVersion,sourceHash:basis.sourceDigest,claimsHash:'b'.repeat(64),payloadHash:sha(raw),effectiveAt:'2026-10-20T23:00:00Z',scope:[{periodId:id(7),customerId:id(3),siteId:id(4),meteringPointId:id(5),pointId:point,identityAgency:'9',effectiveAt:'2026-10-20T23:00:00Z'}],customerTokens:structuredClone(selectedTokens)})
const route={companyId:id(1),environment:'test',route:{id:id(8)},senderEdielId:'54321',receiverEdielId:'21660',applicationReference:'23-DDQ-PRODAT'}
const input=()=>({companyId:id(1),eventId:id(2),actorUserId:id(9),intentId:id(10),outboundRequestId:id(11),routeContext:route as never})
beforeEach(()=>{
 vi.resetAllMocks();io.rpc.mockResolvedValue({data:selection(),error:null});io.read.mockResolvedValue(basis)
 io.intent.mockResolvedValue({id:id(10),companyId:id(1),operationId:id(2),messageFamily:'PRODAT',messageCode:'Z09',routeProfileId:id(12)})
 io.reserve.mockResolvedValueOnce({status:'reserved',messageId:null,outboundRequestId:id(11)}).mockResolvedValue({status:'reserved',messageId:id(13),outboundRequestId:id(11)})
 io.finalize.mockImplementation(async({draft})=>({id:id(13),intent_id:draft.intentId,outbound_request_id:draft.outboundRequestId,raw_payload:draft.rawPayload,status:'draft'}))
})

it('passes the independently selected signed UD/IV facts to the real original gateway without changing its immutable desired bytes',async()=>{
 expect(await renderAndQueueCustomerLifeEvent(input())).toMatchObject({status:'queued',message:{raw_payload:raw}})
 expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_requested_customer_change_selected_facts_v1',{p_company_id:id(1),p_actor_user_id:id(9),p_event_id:id(2)})
 const draft=io.finalize.mock.calls[0][0].draft
 expect(draft.rawPayload).toBe(raw)
 expect(draft.parsedPayload.prodatEngine.registerEvidence.facts.endUserAddressObjects).toEqual([expect.objectContaining({meteringPointId:point,identityAgency:'9',endUser:{id:'SELECTED-CUSTOMER',qualifier:'SE2',agency:'260'},availability:'available',addressLines:['SELECTED ROAD 1'],source:expect.objectContaining({kind:'caller_selection',companyId:id(1)})})])
 expect(draft.parsedPayload.prodatEngine.registerEvidence.facts.invoiceeObjects).toEqual([expect.objectContaining({invoicee:expect.objectContaining({identity:{id:'SELECTED-INVOICEE',qualifier:'SE2',agency:'260'},nameLines:['DESIRED NEW INVOICEE'],availability:'available'}),event:{state:'unknown'}})])
 expect(io.finalize.mock.calls[0][0].deathStatusContext).toEqual({declaredDeathContext:true})
 expect(io.queue).toHaveBeenCalledTimes(1)
})

import {readRequestedCustomerChangeFacts,requestedCustomerChangeRegisterFacts} from '@/lib/ediel/production/requestedCustomerChangeFacts'
const selectedScope=()=>({...input(),basis:basis as unknown as CustomerLifeEventBasis})
it('keeps a linked held original held before any reservation or finalizer, with no fallback',async()=>{
 io.rpc.mockResolvedValue({data:{status:'held',missing:['current_outgoing_customer_mandate_unavailable']},error:null})
 expect(await renderAndQueueCustomerLifeEvent(input())).toEqual({status:'held',missing:['current_outgoing_customer_mandate_unavailable']})
 expect(io.reserve).not.toHaveBeenCalled();expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
})
it('leaves unrelated unlinked life-event originals on their existing context and unchanged bytes',async()=>{
 io.rpc.mockResolvedValue({data:null,error:null})
 expect(await renderAndQueueCustomerLifeEvent(input())).toMatchObject({status:'queued'})
 expect(io.finalize.mock.calls[0][0].draft.parsedPayload.prodatEngine).toBeUndefined()
 expect(io.finalize.mock.calls[0][0].deathStatusContext).toEqual({declaredDeathContext:true})
})
it('propagates actual public qualification errors without reserving or queueing',async()=>{
 const error={code:'42501'};io.rpc.mockResolvedValue({data:null,error})
 await expect(renderAndQueueCustomerLifeEvent(input())).rejects.toBe(error)
 expect(io.reserve).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
})
it('does not allow copied qualification receipts, changed scope or mutation of copied facts to manufacture selections',async()=>{
 const scope=selectedScope(),selected=await readRequestedCustomerChangeFacts(scope)
 if(!selected||selected.status!=='qualified')throw Error('qualified control required')
 expect(()=>requestedCustomerChangeRegisterFacts({...selected},scope)).toThrow('selected_facts_invalid')
 expect(()=>requestedCustomerChangeRegisterFacts(selected,{...scope,actorUserId:id(99)})).toThrow('selected_facts_invalid')
 expect(()=>requestedCustomerChangeRegisterFacts(selected,{...scope,basis:{...scope.basis,rawPayload:'altered'}})).toThrow('selected_facts_invalid')
 const facts=requestedCustomerChangeRegisterFacts(selected,scope)
 facts.endUserAddressObjects![0].endUser.id='altered'
 expect(requestedCustomerChangeRegisterFacts(selected,scope).endUserAddressObjects![0].endUser.id).toBe('SELECTED-CUSTOMER')
})
const mutations:[string,(r:ReturnType<typeof selection>)=>void][]=[
 ['foreign company',r=>{r.companyId=id(99)}],['foreign event',r=>{r.eventId=id(99)}],['foreign customer',r=>{r.customerId=id(99)}],['foreign environment',r=>{r.environment='production'}],
 ['invalid artifact',r=>{r.artifactId='no'}],['invalid claims digest',r=>{r.claimsHash='invalid'}],['wire digest swapped with PDF digest',r=>{r.sourceHash=r.payloadHash}],['PDF digest swapped with wire digest',r=>{r.payloadHash=r.sourceHash}],
 ['changed source reference',r=>{r.sourceReference='other'}],['changed source version',r=>{r.sourceVersion='2'}],['changed wire bytes',r=>{r.payloadHash=sha('other')}],
 ['extra scope',r=>{r.scope.push({...r.scope[0]})}],['foreign site',r=>{r.scope[0].siteId=id(99)}],['foreign point row',r=>{r.scope[0].meteringPointId=id(99)}],['foreign external point',r=>{r.scope[0].pointId='OTHER'}],['unknown agency',r=>{r.scope[0].identityAgency='ZZ'}],['changed effective time',r=>{r.scope[0].effectiveAt='2030-01-01T00:00:00Z'}],
 ['reordered tokens',r=>{r.customerTokens.reverse()}],
 ['unknown city',r=>{r.customerTokens[0].elements[6]=['']}],['unknown country',r=>{r.customerTokens[1].elements[9]=['']}],['omitted postcode',r=>{r.customerTokens[1].elements[8]=[]}],['ambiguous street',r=>{r.customerTokens[1].elements[5]=['.']}],['padded street',r=>{r.customerTokens[0].elements[5]=[' ROAD ']}],['unknown identity representation',r=>{r.customerTokens[0].elements[2]=['SELECTED-CUSTOMER','SE1','89']}],['extra NAD component',r=>{r.customerTokens[0].elements.push(['extra'])}]
]
it.each(mutations)('refuses independently returned malformed selection: %s',async(_name,mutate)=>{
 const r=selection();mutate(r);io.rpc.mockResolvedValue({data:r,error:null})
 await expect(renderAndQueueCustomerLifeEvent(input())).rejects.toThrow()
 expect(io.reserve).not.toHaveBeenCalled();expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
})
it('preserves physical address component slots within the single signed NAD convention',async()=>{
 const r=selection();r.customerTokens[0].elements[5]=['','SECOND SLOT',''];io.rpc.mockResolvedValue({data:r,error:null})
 const scope=selectedScope(),selected=await readRequestedCustomerChangeFacts(scope)
 if(!selected||selected.status!=='qualified')throw Error('qualified control required')
 const facts=requestedCustomerChangeRegisterFacts(selected,scope)
 expect(facts.endUserAddressObjects![0].addressLines).toEqual(['','SECOND SLOT',''])
 expect(facts.invoiceeObjects![0].endUser.address.lines).toEqual(['','SECOND SLOT',''])
 expect(facts.invoiceeObjects![0].event).toEqual({state:'unknown'})
})

it.each(['missing IV','DTM329'])('holds an authentic unsupported %s selection without inventing availability or invoicee event',async(kind)=>{
 const r=selection();if(kind==='missing IV')r.customerTokens.pop();else r.customerTokens.push({tag:'DTM',elements:[['DTM'],['329','20261021','102']]})
 io.rpc.mockResolvedValue({data:r,error:null})
 expect(await renderAndQueueCustomerLifeEvent(input())).toEqual({status:'held',missing:['explicit_signed_ud_iv_address_comparison_required']})
 expect(io.reserve).not.toHaveBeenCalled();expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
})
