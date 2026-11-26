import { beforeEach, expect, it, vi } from 'vitest'
import { dispatchFacilityLookupEdifact, processReadyFacilityLookupEdifactDispatches } from '@/lib/customer-operations/facilityLookupEdifactDispatch'

type Row = Record<string, unknown>
const scope = { companyId:'synthetic-company',requestId:'synthetic-facility-request',actorUserId:'synthetic-actor' }
const io = vi.hoisted(() => ({
  request:null as Row | null,
  outbound:null as Row | null,
  scanned:null as Row | null,
  reads:[] as string[],
  writes:[] as Array<{table:string,patch:Row}>,
  original:vi.fn(), readiness:vi.fn(), owner:vi.fn(), route:vi.fn(), environment:vi.fn(),
  createOutbound:vi.fn(), createIntent:vi.fn(), queue:vi.fn(), event:vi.fn(), bridge:vi.fn(),
}))

vi.mock('@/lib/supabase/service',async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {supabaseService:createClient('http://127.0.0.1:6721','synthetic-unit-key',{
    auth:{persistSession:false,autoRefreshToken:false},
    global:{fetch:async (input,init) => {
      const url = new URL(String(input))
      const table = url.pathname.split('/').at(-1)!
      expect(url.searchParams.get('company_id')).toBe('eq.' + scope.companyId)
      if (init?.method === 'PATCH') {
        expect(url.searchParams.get('id')).toMatch(/^eq\./)
        io.writes.push({table,patch:JSON.parse(String(init.body))})
        return new Response(null,{status:204})
      }
      io.reads.push(table)
      if (table === 'grid_owner_information_requests') {
        const selectedId = url.searchParams.get('id')
        if (selectedId === null) {
          expect(url.searchParams.get('status')).toBe('in.(ready_to_send,waiting_response)')
          expect(url.searchParams.get('request_type')).toBe('eq.facility_lookup')
          expect(url.searchParams.get('channel')).toBe('eq.ediel')
          return Response.json(io.scanned ? [io.scanned] : [])
        }
        expect(selectedId).toBe('eq.' + scope.requestId)
        return Response.json(io.request ? [io.request] : [])
      }
      if (table === 'outbound_requests') {
        expect(url.searchParams.get('source_id')).toBe('eq.' + scope.requestId)
        return Response.json(io.outbound ? [io.outbound] : [])
      }
      throw new Error('Unexpected synthetic table ' + table)
    }},
  })}
})
vi.mock('@/lib/ediel/prodat/z01OriginalReplay',() => ({readZ01OriginalForRequest:io.original}))
vi.mock('@/lib/customer-operations/customerProcessRouteReadiness',() => ({evaluateCustomerProcessRouteReadiness:io.readiness}))
vi.mock('@/lib/grid-owners/platformGridOwnerResolver',() => ({resolvePlatformGridOwnerByAnyId:io.owner}))
vi.mock('@/lib/ediel/core/kernel',() => ({resolveCanonicalOutboundContext:io.route}))
vi.mock('@/lib/ediel/flows/shared',() => ({resolveOutboundRuntimeEnvironment:io.environment}))
vi.mock('@/lib/ediel/intent/intentEngine',() => ({createEdielMessageIntent:io.createIntent}))
vi.mock('@/lib/ediel/intent/renderGateway',() => ({renderAndQueueFacilityLookupZ01:io.queue}))
vi.mock('@/lib/cis/db',() => ({createOutboundRequest:io.createOutbound}))
vi.mock('@/lib/customers/customerOperationEvents',() => ({emitCustomerOperationEvent:io.event}))
vi.mock('@/lib/ediel/outbox/legacyOutboundBridge',() => ({markLegacyOutboundSupersededByIntent:io.bridge}))

const message = {
  id:'message',communication_route_id:'route',route_profile_id:'profile',source_operation_id:'operation',
}
const newOutbound = {id:'outbound',status:'queued',operation_id:'operation'}

beforeEach(() => {
  vi.resetAllMocks()
  io.writes.length = 0
  io.reads.length = 0
  io.outbound = null
  io.scanned = null
  io.request = {id:scope.requestId,company_id:scope.companyId,status:'ready_to_send',request_type:'facility_lookup',
    customer_id:'customer',customer_site_id:'site',grid_owner_id:'owner',grid_area_code:'TEST',price_area:'SE3',
    channel:'ediel',operation_id:'operation',metadata:{}}
  io.original.mockResolvedValue(null)
  io.readiness.mockResolvedValue({ready:true,communicationRouteId:'route',routeProfileId:'profile',blockers:[]})
  io.owner.mockResolvedValue({id:'owner'})
  io.environment.mockResolvedValue('test')
  io.route.mockResolvedValue({route:{id:'route'},environment:'test',senderEdielId:'sender',receiverEdielId:'receiver'})
  io.createOutbound.mockResolvedValue(newOutbound)
  io.createIntent.mockResolvedValue({id:'intent'})
  io.queue.mockResolvedValue({status:'queued',message})
})

function expectNoNewDispatch() {
  for (const port of [io.readiness,io.owner,io.environment,io.route,io.createOutbound,io.createIntent,io.queue,io.event,io.bridge]) {
    expect(port).not.toHaveBeenCalled()
  }
  expect(io.reads).toEqual(['grid_owner_information_requests'])
  expect(io.writes).toEqual([])
}

it.each(['completed','cancelled'])('does not create or repair a dispatch for %s without a protected original', async status => {
  Object.assign(io.request!,{status,outbound_request_id:'outbound'})
  io.outbound = newOutbound
  expect(await dispatchFacilityLookupEdifact(scope)).toMatchObject({
    status:'skipped',requestId:scope.requestId,outboundRequestId:'outbound',blockerCode:'facility_lookup_request_terminal',
  })
  expect(io.original).toHaveBeenCalledWith(expect.objectContaining({
    companyId:scope.companyId,actorUserId:scope.actorUserId,requestId:scope.requestId,requestKind:'facility_lookup',
  }))
  expectNoNewDispatch()
})

it('returns the protected original for completed requests before evaluating the current route', async () => {
  Object.assign(io.request!,{status:'completed',ediel_message_id:'message',outbound_request_id:'outbound'})
  io.original.mockResolvedValue({message,outbound:newOutbound})
  expect(await dispatchFacilityLookupEdifact(scope)).toMatchObject({
    status:'already_waiting',edielMessageId:'message',outboundRequestId:'outbound',operationId:'operation',
  })
  expectNoNewDispatch()
})

it('does not hide failure to authorize the original on a completed request', async () => {
  Object.assign(io.request!,{status:'completed'})
  io.original.mockRejectedValue(new Error('ediel_tenant_actor_forbidden'))
  await expect(dispatchFacilityLookupEdifact(scope)).rejects.toThrow('ediel_tenant_actor_forbidden')
  expectNoNewDispatch()
})

it('still prepares the ordinary ready request', async () => {
  expect(await dispatchFacilityLookupEdifact(scope)).toMatchObject({status:'queued',outboundRequestId:'outbound',edielMessageId:'message'})
  expect(io.createOutbound).toHaveBeenCalledOnce()
  expect(io.queue).toHaveBeenCalledOnce()
  expect(io.writes).toContainEqual(expect.objectContaining({table:'grid_owner_information_requests',patch:expect.objectContaining({status:'waiting_response'})}))
})

it('still repairs an eligible waiting request that has a legacy outbound without EDIFACT', async () => {
  Object.assign(io.request!,{status:'waiting_response',outbound_request_id:'outbound'})
  io.outbound = newOutbound
  expect(await dispatchFacilityLookupEdifact(scope)).toMatchObject({status:'queued',outboundRequestId:'outbound',edielMessageId:'message'})
  expect(io.createOutbound).not.toHaveBeenCalled()
  expect(io.queue).toHaveBeenCalledOnce()
  expect(io.bridge).toHaveBeenCalledOnce()
})

it('skips a candidate that completed between the normal cron scan and the scoped request re-read', async () => {
  io.scanned = {...io.request,metadata:{auto_send_allowed:true}}
  Object.assign(io.request!,{status:'completed'})
  const result = await processReadyFacilityLookupEdifactDispatches({companyId:scope.companyId,actorUserId:scope.actorUserId})
  expect(result).toEqual({candidates:1,queued:0,blocked:0,skipped:1,errors:[]})
  expect(io.reads).toEqual(['grid_owner_information_requests','grid_owner_information_requests'])
  expect(io.readiness).not.toHaveBeenCalled()
  expect(io.writes).toEqual([])
})
