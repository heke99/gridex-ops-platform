import {beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({readPrior:vi.fn(),dataRequest:vi.fn(),facilityRequest:vi.fn(),gridOwner:vi.fn(),readiness:vi.fn(),environment:vi.fn(),materialize:vi.fn(),route:vi.fn(),createOutbound:vi.fn(),createIntent:vi.fn(),render:vi.fn(),status:vi.fn()}))
vi.mock('@/lib/ediel/prodat/z01OriginalReplay',()=>({readZ01OriginalForRequest:io.readPrior}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:io.facilityRequest})})})})}}))
vi.mock('@/lib/ediel/flows/shared',()=>({ensureActorUserId:(v:string)=>v,makeServerClient:async()=>({}),getGridOwnerDataRequestById:io.dataRequest,findOrCreateDataRequestOutbound:io.createOutbound,resolveOutboundRuntimeEnvironment:io.environment}))
vi.mock('@/lib/masterdata/db',()=>({getGridOwnerById:io.gridOwner}))
vi.mock('@/lib/grid-owners/platformGridOwnerResolver',()=>({resolvePlatformGridOwnerByAnyId:io.gridOwner}))
vi.mock('@/lib/customer-operations/customerProcessRouteReadiness',()=>({evaluateCustomerProcessRouteReadiness:io.readiness}))
vi.mock('@/lib/ediel/core/kernel',()=>({resolveCanonicalOutboundContext:io.route}))
vi.mock('@/lib/ediel/routeMaterializer',()=>({materializeCompanyGridOwnerRoute:io.materialize}))
vi.mock('@/lib/ediel/customerInfoEnvironmentResolver',()=>({resolveCustomerInfoOperationEnvironment:io.environment}))
vi.mock('@/lib/ediel/flows/routeDecisionContext',()=>({resolveDecisionBackedOutboundContext:io.route,RouteDecisionBlockedError:class extends Error{}}))
vi.mock('@/lib/cis/db',()=>({createOutboundRequest:io.createOutbound}))
vi.mock('@/lib/cis/db-data',()=>({updateGridOwnerDataRequestStatus:io.status}))
vi.mock('@/lib/ediel/intent/intentEngine',()=>({createEdielMessageIntent:io.createIntent,updateIntentLifecycle:io.status}))
vi.mock('@/lib/ediel/intent/renderGateway',()=>({renderAndQueueFacilityLookupZ01:io.render,renderAndQueueCustomerMasterdataZ01:io.render}))
vi.mock('@/lib/customers/customerOperationEvents',()=>({emitCustomerOperationEvent:io.status}))
vi.mock('@/lib/ediel/outbox/legacyOutboundBridge',()=>({markLegacyOutboundSupersededByIntent:io.status}))
import {dispatchFacilityLookupEdifact} from '@/lib/customer-operations/facilityLookupEdifactDispatch'
import {prepareAndQueueProdatZ01FromDataRequest} from '@/lib/ediel/flows/prodatCustomerMasterdata'
// Only control-flow I/O fixtures: readPrior is a declared protected-original
// port here. These values establish neither historical proof nor legal grants.
const original={id:'message',raw_payload:'OLD EXACT WIRE',company_id:'company',environment:'test',communication_route_id:'old-route',route_profile_id:'old-profile',source_operation_id:'operation',status:'acknowledged'}
const outbound={id:'outbound',status:'acknowledged'}
beforeEach(()=>{
 vi.clearAllMocks()
 io.facilityRequest.mockResolvedValue({data:{id:'request',company_id:'company',customer_id:'customer',customer_site_id:'site',request_type:'facility_lookup',grid_owner_id:'REMOVED-TODAY',channel:'ediel',metadata:{},ediel_message_id:'message',outbound_request_id:'outbound',operation_id:'operation'},error:null})
 io.dataRequest.mockResolvedValue({id:'request',company_id:'company',customer_id:'customer',site_id:'site',request_scope:'customer_masterdata',grid_owner_id:'REMOVED-TODAY',operation_id:'operation',response_payload:{edielMessageId:'message',outboundRequestId:'outbound'}})
 io.readPrior.mockResolvedValue({message:original,outbound})
 for(const port of [io.gridOwner,io.readiness,io.environment,io.materialize,io.route,io.createOutbound,io.createIntent,io.render])port.mockRejectedValue(new Error('today_source_removed'))
})
describe('public Z01 preparation returns a protected original before current source preparation',()=>{
 it.each(['facility','customer'] as const)('preserves the exact old %s outcome with removed current routing and customer source',async kind=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-20T12:45:00Z'))
  try{
   const result=kind==='facility'?await dispatchFacilityLookupEdifact({companyId:'company',requestId:'request',actorUserId:'actor'}):await prepareAndQueueProdatZ01FromDataRequest({gridOwnerDataRequestId:'request',actorUserId:'actor'})
   expect(io.readPrior).toHaveBeenCalledWith(expect.objectContaining({companyId:'company',actorUserId:'actor',requestId:'request',customerId:'customer',siteId:'site',operationId:'operation',messageIds:expect.arrayContaining(['message']),outboundIds:['outbound']}))
   if(kind==='facility')expect(result).toMatchObject({status:'already_waiting',edielMessageId:'message',outboundRequestId:'outbound',communicationRouteId:'old-route',edielRouteProfileId:'old-profile'})
   else expect(result).toMatchObject({prepared:true,message:original,outbound})
   for(const port of [io.gridOwner,io.readiness,io.environment,io.materialize,io.route,io.createOutbound,io.createIntent,io.render,io.status])expect(port).not.toHaveBeenCalled()
  }finally{vi.useRealTimers()}
 })
 it.each(['facility','customer'] as const)('holds unqualified %s original without updating the old request or trying a new route',async kind=>{
  io.readPrior.mockRejectedValue(new Error('ediel_tenant_actor_forbidden'))
  await expect(kind==='facility'?dispatchFacilityLookupEdifact({companyId:'company',requestId:'request',actorUserId:'actor'}):prepareAndQueueProdatZ01FromDataRequest({gridOwnerDataRequestId:'request',actorUserId:'actor'})).rejects.toThrow('ediel_tenant_actor_forbidden')
  for(const port of [io.gridOwner,io.readiness,io.environment,io.materialize,io.route,io.createOutbound,io.createIntent,io.render,io.status])expect(port).not.toHaveBeenCalled()
 })
})
