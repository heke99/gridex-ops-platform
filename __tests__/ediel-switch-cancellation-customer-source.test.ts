// masterplan: AT-Z03C-SUPPLIER
// Cross-actor cancellation preparation component overlay only.
// Finite RPC DTOs/finalizer/outbox ports are not native or physical ACK proof.
import {createHash} from 'node:crypto'
import {raw,line,characteristic} from './fixtures/prodat-register'
import {head} from './fixtures/prodat-identity'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { closureFixture } from './helpers/closureWireFixtures'
import { source } from './fixtures/prodat-identity'
import { createFakeSupabase, type Row } from './helpers/supabaseMock'

const io = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), finalize: vi.fn(), queue: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/ediel/core/kernel', () => ({ finalizeCanonicalOutboundDraft: io.finalize }))
vi.mock('@/lib/ediel/flows/shared', () => ({ queuePreparedEdielMessage: io.queue }))

import { renderAndQueueSwitchCancellation } from '@/lib/ediel/intent/switchCancellationGateway'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import type { SwitchCancellationBasis } from '@/lib/ediel/production/switchCancellationSource'
import type { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const own = { company: id(1), actor: id(2), intent: id(3), switch: id(4), operation: id(5),
  request: id(6), message: id(7), original: id(8) }
const input = { companyId: own.company, actorUserId: own.actor, intentId: own.intent,
  switchRequestId: own.switch, outboundRequestId: own.request,
  routeContext: { companyId: own.company, environment: 'test', senderEdielId: '12345', receiverEdielId: '54321',
    applicationReference: '23-DDQ-PRODAT', actor: { tenantIdentity: { legalActorId: id(9) },
      legalActorEdielId: '12345', marketRoles: ['electricity_supplier'] }, route: { id: id(10) } } as
    Awaited<ReturnType<typeof resolveCanonicalOutboundContext>> }
let tables: Record<string, Row[]>
let db: ReturnType<typeof createFakeSupabase>
let reservations: Array<Record<string, unknown>>
let basis: SwitchCancellationBasis
const boundMessage = (patch: Row = {}): Row => ({ id: own.message, company_id: own.company, intent_id: own.intent,
  outbound_request_id: own.request, source_operation_id: own.operation, status: 'draft', ...patch })
const reserved = (messageId: string | null = null) => ({ status: 'reserved', operationId: own.operation,
  intentId: own.intent, outboundRequestId: own.request, messageId })
const writes = () => db.calls.filter(call => call.operation !== 'select')

const nativeOriginal=()=>{const row=tables.ediel_messages[0];return {status:'authorized',companyId:own.company,customerId:basis.customerId,environment:'test',asOf:'2026-10-06T12:00:00Z',sourceKind:'registered_customer_address',sourceReference:'authentic-original-registered-address',sourceDigest:'b'.repeat(64),sourceContextId:id(71),customerIdentity:{id:basis.customerIdentity,qualifier:basis.customerQualifier,agency:'260'},endUserMasterdata:{nameParts:[basis.customerName],streetParts:['Street'],postalCode:'12345',city:'City',country:'SE'},cancellationSourceBinding:{switchRequestId:own.switch,actorUserId:own.actor,originalMessageId:own.original,originalHash:basis.originalHash,environment:'test',originalPreparerId:row.created_by},messageBinding:{id:own.original,environment:'test',intentId:row.intent_id,routeId:row.communication_route_id,payloadHash:row.immutable_payload_hash}}}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-06T12:00:00Z'))
  // Reuse the existing protocol fixture/parser for descriptive source fields.
  // The RPC owner, rather than this fixture, owns authorization in production.
  const wire = closureFixture({ reason: 'Z22', minute: '202701010000', li: 'OWN-CANCEL-LI' }).wire
    .replace('BGM+Z05+', 'BGM+Z03+').replace('DTM+93:', 'DTM+92:')
    .replace('RFF+Z05:NET-1', 'RFF+Z05:NET').replace('CUSTOMER-1::89', '5566778899:SE1:260')
  const object = parseProdatMessage(source(wire, 'Z03')).lineItems[0]
  basis = { status: 'authorized', companyId: own.company, environment: 'test', switchRequestId: own.switch,
    operationId: own.operation, intentId: own.intent, outboundRequestId: own.request, messageId: null,
    originalMessageId: own.original, originalHash: '', originalSubtype: 'L', deadline: '2026-12-28',
    customerId: id(11), siteId: id(12), meteringPointId: id(13), legalActorId: id(9), legalSenderId: '12345',
    legalReceiverId: '54321', pointId: object.meteringPointId!, identityAgency: '9', gridArea: object.gridAreaId!,
    li: object.lineItemReference!, startAt: '2027-01-01T00:00:00+01:00', customerIdentity: object.endUserId!,
    customerQualifier: 'SE1', customerName: 'Synthetic', sourceObject: {}, requestedMethod: 'Z04' }
  const originalRaw=raw([...head(),line('1',basis.pointId,undefined,'9'),['DTM',['92','202701010000','203']],...characteristic('Z13','Z22'),...characteristic('Z04',basis.requestedMethod),['RFF',['LI',basis.li]],['RFF',['Z05',basis.gridArea]],['RFF',['ANJ','OWN-CANCEL-AGREEMENT']],['NAD','UD',[basis.customerIdentity,basis.customerQualifier,'260'],'',basis.customerName,'Street','City','','12345','SE'],['NAD','Z02',['11111','160','SVK']]],'Z03')
  basis.originalHash=createHash('sha256').update(originalRaw).digest('hex')
  tables = {supplier_switch_requests:[{id:own.switch,company_id:own.company,customer_id:basis.customerId,site_id:basis.siteId,customer_site_id:basis.siteId,metering_point_id:basis.meteringPointId,contract_id:id(15),customer_contract_id:id(15)}],customer_contracts:[{id:id(15),company_id:own.company,customer_id:basis.customerId,billing_address_same_as_site:true}],ediel_message_intents: [{ id: own.intent, company_id: own.company, environment: 'test', market: 'electricity',
    message_family: 'PRODAT', message_code: 'Z03', business_process: 'supplier_switch', direction: 'outbound',
    supplier_switch_request_id: own.switch, operation_id: own.operation, metering_point_id: basis.pointId,
    sender_ediel_id: '12345', receiver_ediel_id: '54321',
    application_reference: '23-DDQ-PRODAT', route_profile_id: id(14), interchange_reference: 'OWN-CANCEL-UNB',
    message_reference: '1', transaction_reference: basis.li, idempotency_key: 'OWN-CANCEL-INTENT',
    payload: { actorRole: 'supplier', transactionSubtype: 'C' }, render_status: 'not_rendered', outbox_status: 'not_queued' }],
  ediel_messages: [{id:own.original,company_id:own.company,environment:'test',direction:'outbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z03',customer_id:basis.customerId,intent_id:id(80),communication_route_id:id(81),created_by:own.actor,immutable_rendered_at:'2026-10-06T12:00:00Z',immutable_payload_hash:basis.originalHash,raw_payload:originalRaw}] }
  db = createFakeSupabase({ tables })
  io.from.mockImplementation((table: string) => {
    if (!(table in tables)) throw Error(`undeclared_table:${table}`)
    const query = db.client.from(table)
    // This overlay honors actual selected columns, unlike the general fake.
    const selected=query.select.bind(query),single=query.maybeSingle.bind(query),materialize=query.then.bind(query)
    let columns='*',singleMode=false
    query.select=(value:string)=>{columns=value;return selected(value)}
    query.maybeSingle=()=>{singleMode=true;return single()}
    query.then=(onfulfilled,onrejected)=>Promise.resolve(materialize()).then(result=>{
      const data=result.data
      if(!singleMode||data===null||columns==='*')return result
      if(typeof data!=='object'||Array.isArray(data))throw Error('selected_single_row_required')
      const row:Row=Object.fromEntries(Object.entries(data))
      return{...result,data:Object.fromEntries(columns.split(',').map(key=>[key,row[key]]))}
    }).then(onfulfilled,onrejected)
    return Object.assign(query, { returns: () => query })
  })
  reservations = [reserved(), reserved(own.message)]
  io.rpc.mockImplementation(async (name: string,args:Record<string,unknown>) => {
    if(name==='ediel_switch_cancellation_customer_masterdata_basis_v1'){
      expect(args).toEqual({p_company_id:own.company,p_switch_id:own.switch,p_actor_user_id:own.actor})
      return{data:nativeOriginal(),error:null}
    }
    if(name==='ediel_switch_cancellation_customer_masterdata_message_basis_v1'){
      expect(args).toEqual({p_company_id:own.company,p_message_id:own.message,p_actor_user_id:own.actor})
      const row=tables.ediel_messages.find(row=>row.id===own.message)!
      return{data:{...nativeOriginal(),sourceContextId:row.created_by===id(90)?id(73):id(72),messageBinding:{id:row.id,environment:row.environment,intentId:row.intent_id,routeId:row.communication_route_id,payloadHash:createHash('sha256').update(row.raw_payload as string).digest('hex')},cancellationBinding:{operationId:own.operation,switchRequestId:own.switch,actorUserId:own.actor,originalMessageId:own.original,originalHash:basis.originalHash,preparerId:row.created_by}},error:null}
    }
    if(name==='ediel_prepare_switch_cancellation_customer_masterdata_v1'){
      expect(args).toEqual({p_company_id:own.company,p_operation_id:own.operation,p_actor_user_id:own.actor,p_intent_id:own.intent,p_route_id:input.routeContext.route.id,p_raw_payload:expect.any(String)})
      const {messageBinding:_originalBinding,cancellationSourceBinding:_sourceBinding,...originalProjection}=nativeOriginal()
      const data={...originalProjection,sourceContextId:id(72),cancellationBinding:{operationId:own.operation,switchRequestId:own.switch,actorUserId:own.actor,intentId:own.intent,routeId:input.routeContext.route.id,environment:'test',originalMessageId:own.original,originalHash:basis.originalHash,payloadHash:createHash('sha256').update(args.p_raw_payload as string).digest('hex')}}
      return{data,error:null}
    }
    if (name === 'ediel_switch_cancellation_source_v1') return { data: basis, error: null }
    if (name !== 'ediel_reserve_switch_cancellation_v1' || !reservations.length) throw Error(`undeclared_rpc:${name}`)
    return { data: reservations.shift(), error: null }
  })
  io.finalize.mockImplementation(async params=>{
    const message=winnerDraft(params.draft,{created_by:own.actor,parsed_payload:params.draft.parsedPayload,
      immutable_rendered_at:'2026-10-06T12:00:00Z',immutable_payload_hash:createHash('sha256').update(params.draft.rawPayload).digest('hex')})
    tables.ediel_messages.push(message)
    return message
  })
  io.queue.mockResolvedValue(undefined)
})

it('refuses a normally returned concurrent draft when its current protected customer source is invalid before queue',async()=>{
 reservations=[reserved(),reserved(own.message)]
 const original=structuredClone(tables.ediel_messages[0])
 const previous=io.rpc.getMockImplementation()!
 let winnerReturned=false
 io.finalize.mockImplementation(async params=>{
  const winner=winnerDraft(params.draft,{parsed_payload:params.draft.parsedPayload,immutable_rendered_at:'2026-10-06T12:00:00Z',
   immutable_payload_hash:createHash('sha256').update(params.draft.rawPayload).digest('hex')})
  tables.ediel_messages.push(winner)
  winnerReturned=true
  return winner
 })
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='ediel_switch_cancellation_customer_masterdata_message_basis_v1'){
   expect(winnerReturned).toBe(true)
   expect(args).toEqual({p_company_id:own.company,p_message_id:own.message,p_actor_user_id:own.actor})
   return{data:null,error:Error('customer_masterdata_current_source_changed')}
  }
  return previous(name,args)
 })
 await expect(renderAndQueueSwitchCancellation(input)).rejects.toThrow('customer_masterdata_current_source_changed')
 expect(io.finalize).toHaveBeenCalledOnce()
 expect(io.rpc.mock.calls.filter(([name])=>name==='ediel_switch_cancellation_customer_masterdata_message_basis_v1')).toHaveLength(1)
 expect(io.queue).not.toHaveBeenCalled()
 expect(writes()).toEqual([])
 expect(tables.ediel_messages[0]).toEqual(original)
})
afterEach(() => vi.useRealTimers())


import {isQualifiedCustomerMasterdataValidationContext} from '@/lib/ediel/production/customerMasterdataSource'
import {customerMasterdataSendIssue,assertCustomerMasterdataContextMatches} from '@/lib/ediel/prodat/customerMasterdataAuthority'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {readProdatRegisterEvidence} from '@/lib/ediel/prodat/prodatRegisterEvidence'
import {readSwitchCancellationSource} from '@/lib/ediel/production/switchCancellationSource'
import {buildSwitchCancellationDraft} from '@/lib/ediel/intent/renderers/switchCancellation'
it('forwards the fresh reserved preparation bound to actual cancellation bytes intent route and current actor',async()=>{
 const original=structuredClone(tables.ediel_messages[0])
 expect(await renderAndQueueSwitchCancellation(input)).toMatchObject({status:'queued'})
 const params=io.finalize.mock.calls[0][0],draft=params.draft,context=params.customerMasterdataContext
 expect(isQualifiedCustomerMasterdataValidationContext(context)).toBe(true)
 expect(draft.parsedPayload.customerMasterdataSourceContextId).toBe(id(72))
 expect(context).toMatchObject({companyId:own.company,customerId:basis.customerId,environment:'test',intentId:own.intent,routeId:input.routeContext.route.id,rawPayload:draft.rawPayload})
 const row={direction:draft.direction,company_id:draft.companyId,customer_id:draft.customerId,environment:draft.environment,raw_payload:draft.rawPayload,intent_id:draft.intentId,communication_route_id:draft.communicationRouteId,message_family:draft.messageFamily,message_code:draft.messageCode}
 expect(()=>assertCustomerMasterdataContextMatches(row,context)).not.toThrow()
 expect(customerMasterdataSendIssue(row,context)).toBeNull()
 const wire=tokenizeEdifact(draft.rawPayload)
 const facts=readProdatRegisterEvidence({code:'Z03',rawSegments:wire.segments.map(s=>s.raw),una:wire.una,parsedPayload:draft.parsedPayload,companyId:own.company,customerMasterdataContext:context})!
 expect(facts.endUserAddressObjects![0].source).toMatchObject({kind:'customer_masterdata',sourceContextId:id(72),sourceDigest:'b'.repeat(64),reference:'authentic-original-registered-address'})
 expect(tables.ediel_messages[0]).toEqual(original)
 expect(io.rpc.mock.calls.filter(([name])=>name==='ediel_switch_cancellation_customer_masterdata_basis_v1')).toHaveLength(1)
 expect(io.queue).toHaveBeenCalledOnce()
})
it('does not turn a cloned cancellation basis into a private customer-source credential',async()=>{
 const source=await readSwitchCancellationSource({companyId:own.company,switchRequestId:own.switch,actorUserId:own.actor})
 expect(source.status).toBe('authorized');if(source.status!=='authorized')throw Error('fixture held')
 const intent={id:own.intent,companyId:own.company,environment:'test',messageCode:'Z03',operationId:own.operation,transactionReference:basis.li,applicationReference:'23-DDQ-PRODAT',interchangeReference:'OWN-CANCEL-UNB',messageReference:'1'} as Parameters<typeof buildSwitchCancellationDraft>[0]['intent']
 await expect(buildSwitchCancellationDraft({actorUserId:own.actor,basis:{...source},intent,routeContext:input.routeContext,outboundRequestId:own.request})).rejects.toThrow('projection_unqualified')
 expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
})
it('fails closed when the actual original reader revokes its current customer source',async()=>{
 const previous=io.rpc.getMockImplementation()!
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='ediel_switch_cancellation_customer_masterdata_basis_v1'?{data:null,error:Error('customer_masterdata_current_source_changed')}:previous(name,args))
 await expect(renderAndQueueSwitchCancellation(input)).rejects.toThrow('customer_masterdata_current_source_changed')
 expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled();expect(writes()).toEqual([])
})
it('holds an original without an authentic protected customer source instead of copying a parsed id',async()=>{
 tables.ediel_messages[0].parsed_payload={customerMasterdataSourceContextId:id(71)}
 const previous=io.rpc.getMockImplementation()!
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='ediel_switch_cancellation_customer_masterdata_basis_v1'?{data:null,error:null}:previous(name,args))
 expect(await renderAndQueueSwitchCancellation(input)).toMatchObject({status:'held'})
 expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled();expect(writes()).toEqual([])
})
it('prepares with a different current actor without borrowing the original creator context',async()=>{
 tables.ediel_messages[0].created_by=id(90)
 expect(await renderAndQueueSwitchCancellation(input)).toMatchObject({status:'queued'})
 const context=io.finalize.mock.calls[0][0].customerMasterdataContext
 expect(context.projection.sourceContextId).toBe(id(72))
 expect(context.projection.sourceContextId).not.toBe(id(71))
 expect(io.rpc.mock.calls.filter(([name])=>name==='ediel_prepare_switch_cancellation_customer_masterdata_v1')).toHaveLength(1)
})
it.each(['customerId','bindingIntent','bindingRawHash'])('rejects a forged native original %s before finalization',async field=>{
 const previous=io.rpc.getMockImplementation()!
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  const result=await previous(name,args)
  if(name!=='ediel_switch_cancellation_customer_masterdata_basis_v1')return result
  const data=structuredClone(result.data)
  if(field==='customerId')data.customerId=id(90)
  else data.messageBinding[field==='bindingIntent'?'intentId':'payloadHash']=field==='bindingIntent'?id(90):'e'.repeat(64)
  return{data,error:null}
 })
 await expect(renderAndQueueSwitchCancellation(input)).rejects.toThrow(field==='customerId'?'customer_masterdata_source_result_invalid':'customer_masterdata_cancellation_original_binding_invalid')
 expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled();expect(writes()).toEqual([])
})

it.each(['operationId','switchRequestId','actorUserId','intentId','routeId','originalMessageId','originalHash','payloadHash','environment'])('rejects foreign or forged cancellation preparation %s before INSERT and outbox',async field=>{
 const previous=io.rpc.getMockImplementation()!
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  const result=await previous(name,args)
  if(name!=='ediel_prepare_switch_cancellation_customer_masterdata_v1')return result
  return{data:{...result.data,cancellationBinding:{...result.data.cancellationBinding,[field]:field.endsWith('Hash')?'e'.repeat(64):field==='environment'?'production':id(90)}},error:null}
 })
 await expect(renderAndQueueSwitchCancellation(input)).rejects.toThrow('customer_masterdata_cancellation_binding_invalid')
 expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled();expect(writes()).toEqual([])
})
it('refuses the old original context id when the preparation port tries to return it',async()=>{
 const previous=io.rpc.getMockImplementation()!
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  const result=await previous(name,args)
  return name==='ediel_prepare_switch_cancellation_customer_masterdata_v1'?{data:{...result.data,sourceContextId:id(71)},error:null}:result
 })
 await expect(renderAndQueueSwitchCancellation(input)).rejects.toThrow('customer_masterdata_cancellation_binding_invalid')
 expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
})
it('preserves another preparer on an already bound sent message replay',async()=>{
 reservations=[reserved(own.message)]
 tables.ediel_messages.push(boundMessage({status:'sent',created_by:id(90)}))
 expect(await renderAndQueueSwitchCancellation(input)).toMatchObject({status:'existing',message:{created_by:id(90)}})
 expect(io.rpc.mock.calls.some(([name])=>name==='ediel_prepare_switch_cancellation_customer_masterdata_v1')).toBe(false)
 expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
})
it('does not finalize after the genuine preparation owner revokes current prepare authority',async()=>{
 const previous=io.rpc.getMockImplementation()!
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='ediel_prepare_switch_cancellation_customer_masterdata_v1'?{data:null,error:Error('customer_life_event_actor_forbidden')}:previous(name,args))
 await expect(renderAndQueueSwitchCancellation(input)).rejects.toThrow('customer_life_event_actor_forbidden')
 expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled();expect(writes()).toEqual([])
})

it('continues a different creator bound draft using its preserved bytes and preparation in prepare phase',async()=>{
 await renderAndQueueSwitchCancellation(input)
 const {draft}=io.finalize.mock.calls[0][0]
 const existing=boundMessage({created_by:id(90),direction:'outbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z03',environment:'test',customer_id:basis.customerId,intent_id:own.intent,communication_route_id:input.routeContext.route.id,original_message_id:own.original,switch_request_id:own.switch,raw_payload:draft.rawPayload,parsed_payload:draft.parsedPayload})
  tables.ediel_messages.splice(tables.ediel_messages.findIndex(row=>row.id===own.message),1,existing);const before=structuredClone(existing)
 reservations=[reserved(own.message)];io.finalize.mockClear();io.queue.mockClear();io.rpc.mockClear()
 vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
 expect(await renderAndQueueSwitchCancellation(input)).toMatchObject({status:'queued',message:{id:own.message,created_by:id(90),raw_payload:before.raw_payload}})
 expect(existing).toEqual(before)
 expect(io.finalize).not.toHaveBeenCalled()
 expect(io.rpc.mock.calls.some(([name])=>name==='ediel_prepare_switch_cancellation_customer_masterdata_v1')).toBe(false)
 expect(io.rpc.mock.calls.some(([name])=>name==='ediel_switch_cancellation_customer_masterdata_message_basis_v1')).toBe(true)
 expect(io.queue).toHaveBeenCalledOnce()
})

it.each(['companyId','customerId','asOf','sourceDigest','city'])('refuses a changed fresh customer projection %s rather than forwarding editable native output',async field=>{
 const previous=io.rpc.getMockImplementation()!
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  const result=await previous(name,args)
  if(name!=='ediel_prepare_switch_cancellation_customer_masterdata_v1')return result
  const data=structuredClone(result.data)
  if(field==='city')data.endUserMasterdata.city='Other city'
  else data[field]=field==='asOf'?'2026-10-07T12:00:00Z':field==='sourceDigest'?'e'.repeat(64):id(90)
  return{data,error:null}
 })
 await expect(renderAndQueueSwitchCancellation(input)).rejects.toThrow(field==='sourceDigest'?'customer_masterdata_cancellation_binding_invalid':field==='city'?'customer_masterdata_cancellation_source_changed':'customer_masterdata_source_result_invalid')
 expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled();expect(writes()).toEqual([])
})

const winnerDraft=(draft:Record<string,unknown>,patch:Row={})=>boundMessage({created_by:id(90),direction:'outbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z03',environment:draft.environment,customer_id:draft.customerId,intent_id:draft.intentId,communication_route_id:draft.communicationRouteId,original_message_id:draft.originalMessageId,switch_request_id:draft.switchRequestId,raw_payload:draft.rawPayload,...patch})
it('rechecks a concurrent winner created by another preparer and queues its preserved real bytes',async()=>{
 reservations=[reserved(),reserved(own.message),reserved(own.message)]
 io.finalize.mockImplementation(async params=>{
  const winner=winnerDraft(params.draft)
  tables.ediel_messages.push(winner)
  throw{code:'23505'}
 })
 expect(await renderAndQueueSwitchCancellation(input)).toMatchObject({status:'queued',message:{created_by:id(90),id:own.message}})
 expect(io.rpc.mock.calls.filter(([name])=>name==='ediel_switch_cancellation_customer_masterdata_message_basis_v1')).toHaveLength(1)
 expect(io.queue).toHaveBeenCalledOnce()
 expect(tables.ediel_messages.find(row=>row.id===own.message)!.created_by).toBe(id(90))
})
it.each(['communication_route_id','environment','original_message_id','switch_request_id','source_operation_id'])('refuses a concurrent winner with wrong actual %s before outbox',async field=>{
 reservations=[reserved(),reserved(own.message),reserved(own.message)]
 io.finalize.mockImplementation(async params=>{
  tables.ediel_messages.push(winnerDraft(params.draft,{[field]:field==='environment'?'production':id(90)}))
  throw{code:'23505'}
 })
 await expect(renderAndQueueSwitchCancellation(input)).rejects.toThrow('switch_cancellation_existing_message_conflict')
 expect(io.queue).not.toHaveBeenCalled();expect(writes()).toEqual([])
})
it('refuses a concurrent winner whose actual preparation owner revokes the current preparing actor',async()=>{
 reservations=[reserved(),reserved(own.message),reserved(own.message)]
 io.finalize.mockImplementation(async params=>{tables.ediel_messages.push(winnerDraft(params.draft));throw{code:'23505'}})
 const previous=io.rpc.getMockImplementation()!
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='ediel_switch_cancellation_customer_masterdata_message_basis_v1'?{data:null,error:Error('customer_life_event_actor_forbidden')}:previous(name,args))
 await expect(renderAndQueueSwitchCancellation(input)).rejects.toThrow('customer_life_event_actor_forbidden')
 expect(io.queue).not.toHaveBeenCalled();expect(writes()).toEqual([])
})
