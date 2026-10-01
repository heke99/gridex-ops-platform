import {beforeEach,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({source:vi.fn(),intent:vi.fn(),render:vi.fn(),request:vi.fn(),route:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:vi.fn()}}))
vi.mock('@/lib/supabase/tenantDb',()=>({tenantDb:()=>({from:()=>({select:()=>({eq:()=>({eq:()=>({eq:()=>({limit:()=>({returns:async()=>({data:[],error:null})})})})})})})})}))
vi.mock('@/lib/cis/db',()=>({createOutboundRequest:m.request}))
vi.mock('@/lib/ediel/core/kernel',()=>({resolveCanonicalOutboundContext:m.route}))
vi.mock('@/lib/ediel/intent/intentEngine',()=>({createEdielMessageIntent:m.intent}))
vi.mock('@/lib/ediel/intent/meteringMethodChangeGateway',()=>({renderAndQueueMeteringMethodChange:m.render}))
vi.mock('@/lib/ediel/production/meteringMethodChangeSource',()=>({readMeteringMethodChangeSource:m.source,assertMeteringMethodChangeCanonicalRoute:vi.fn()}))
import {prepareAndQueueMeteringMethodChangeZ09} from '@/lib/ediel/flows/prodatMeteringMethodChange'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
beforeEach(()=>{vi.clearAllMocks();m.route.mockResolvedValue({senderEdielId:'12345',receiverEdielId:'54321',environment:'test',route:{id:id(2)},routeRuntime:{route_profile_id:id(3)},applicationReference:'23-DDQ-PRODAT'});m.source.mockResolvedValue({status:'authorized',companyId:id(1),environment:'test',eventId:id(4),customerId:id(5),siteId:id(6),meteringPointId:id(7),pointId:'735123456789012345',gridArea:'TES',legalReceiverId:'54321'});m.intent.mockImplementation(async input=>({...input,id:id(8)}));m.request.mockResolvedValue({id:id(9)});m.render.mockResolvedValue({status:'queued',message:{id:id(10)}})})
it('holds unavailable actual agreement before creating any intent/request/draft',async()=>{
 m.source.mockResolvedValue({status:'held',missing:['authentic_customer_agreed_method_event']})
 expect(await prepareAndQueueMeteringMethodChangeZ09({companyId:id(1),eventId:id(4),actorUserId:id(11)})).toEqual({status:'held',missing:['authentic_customer_agreed_method_event']})
 expect(m.intent).not.toHaveBeenCalled();expect(m.request).not.toHaveBeenCalled();expect(m.render).not.toHaveBeenCalled()
})
it('creates actual intent and source request before delegating to the guarded gateway with exact short UNB reference',async()=>{
 await prepareAndQueueMeteringMethodChangeZ09({companyId:id(1),eventId:id(4),actorUserId:id(11)})
 const i=m.intent.mock.calls[0][0]
 expect(i.interchangeReference).toMatch(/^[A-F0-9]{14}$/)
 expect(i.transactionReference.length).toBeLessThanOrEqual(35)
 expect(i.transactionReference).not.toBe(i.interchangeReference)
 expect(i).toMatchObject({operationId:id(4),customerSiteId:id(6),meteringPointId:'735123456789012345'})
 expect(m.request.mock.calls[0][0]).toMatchObject({sourceId:id(8),operationId:id(4),siteId:id(6),environment:'test',meteringPointId:id(7)})
 expect(m.render.mock.calls[0][0]).toMatchObject({intentId:id(8),outboundRequestId:id(9),eventId:id(4),actorUserId:id(11)})
 expect(m.intent.mock.invocationCallOrder[0]).toBeLessThan(m.render.mock.invocationCallOrder[0])
})
