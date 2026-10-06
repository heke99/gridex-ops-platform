// Real gateway and register evidence; declared source/catalog/queue ports.
// Native tests separately qualify issuer, review, SQL and actual send effects.
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
 vi.clearAllMocks();io.rpc.mockResolvedValue({data:selection(),error:null});io.read.mockResolvedValue(basis)
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
