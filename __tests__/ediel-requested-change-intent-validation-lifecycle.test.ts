// masterplan: AT-Z09E-SUPPLIER
import {beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'

// Real gateway, intent loader, evaluator and lifecycle writer. Source, renderer,
// canonical finalizer and queue are declared ports; this is not native authority.
const io=vi.hoisted(()=>({row:{} as Record<string,unknown>,existing:null as Record<string,unknown>|null,
 steps:[] as string[],queued:[] as Record<string,unknown>[],updates:[] as Record<string,unknown>[],
 writeError:null as Error|null,read:vi.fn(),assert:vi.fn(),finalize:vi.fn(),queue:vi.fn(),render:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
 const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:table==='ediel_message_intents'?io.row:io.existing,error:null}),
 update:(patch:Record<string,unknown>)=>({eq:async()=>{
  io.steps.push('lifecycle');if(io.writeError)return{error:io.writeError}
  io.updates.push(structuredClone(patch));Object.assign(io.row,patch);return{error:null}
 }})};return query
}}}))
vi.mock('@/lib/ediel/production/requestedChangeSource',()=>({readRequestedChangeSource:io.read,assertRequestedChangeSendSource:io.assert}))
vi.mock('@/lib/ediel/intent/renderers/lifeEvent',()=>({buildRequestedChangeDraft:io.render}))
vi.mock('@/lib/ediel/core/kernel',()=>({finalizeCanonicalOutboundDraft:io.finalize}))
vi.mock('@/lib/ediel/core/versionRegistry',()=>({resolveCanonicalOutboundVersion:async()=> 'E2SE6A'}))
vi.mock('@/lib/ediel/flows/shared',()=>({queuePreparedEdielMessage:io.queue}))
import {renderAndQueueRequestedChange} from '@/lib/ediel/intent/lifeEventGateway'
import {evaluateIntentValidation,getEdielMessageIntentById} from '@/lib/ediel/intent/intentEngine'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const input={companyId:id(1),eventId:id(2),actorUserId:id(3),intentId:id(4),outboundRequestId:id(5),routeContext:{route:{id:id(6)},defaultMessageVersion:'E2SE6A'} as never}
const message={id:id(7),company_id:id(1),intent_id:id(4),outbound_request_id:id(5),source_operation_id:id(2),status:'draft',raw_payload:'DECLARED exact original'} as EdielMessageRow
beforeEach(()=>{
 vi.resetAllMocks();vi.useRealTimers();io.steps=[];io.queued=[];io.updates=[];io.writeError=null;io.existing=null
 io.row={id:id(4),company_id:id(1),environment:'test',market:'electricity',message_family:'PRODAT',message_code:'Z09',business_process:'customer_masterdata',direction:'outbound',sender_ediel_id:'12345',receiver_ediel_id:'54321',application_reference:'23-DDQ-PRODAT',route_profile_id:id(8),communication_route_id:id(6),customer_id:id(9),customer_site_id:id(10),operation_id:id(2),facility_id:'735999123456789012',metering_point_id:'735999123456789012',grid_area_code:'TES',interchange_reference:'ORIGINAL',message_reference:'1',transaction_reference:'ORIGINAL',payload:{actorRole:'supplier',requestedChangeEventId:id(2),variant:'E'},idempotency_key:'requested-change:'+id(2),validation_status:'draft',validation_result:{},blocking_reasons:[],render_status:'not_rendered',outbox_status:'not_queued'}
 io.read.mockResolvedValue({status:'authorized',eventId:id(2),environment:'test'})
 io.render.mockReturnValue({rawPayload:message.raw_payload})
 io.finalize.mockImplementation(async()=>{io.steps.push('finalize');return structuredClone(message)})
 io.assert.mockImplementation(async()=>{io.steps.push('current-source')})
 io.queue.mockImplementation(async()=>{io.steps.push('queue');io.queued.push(structuredClone(io.row))})
})
it('persists the real computed validation after finalization/current checks and before queue, including stale nonblocking reasons',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-06T21:00:00Z'))
 io.row.blocking_reasons=[{code:'old_blocker',message:'old projection'}]
 const loaded=await getEdielMessageIntentById(id(4));expect(loaded).not.toBeNull()
 const expected=evaluateIntentValidation(loaded!);expect(expected.ok).toBe(true)
 expect((await renderAndQueueRequestedChange(input)).status).toBe('queued')
 expect(io.steps).toEqual(['finalize','current-source','lifecycle','queue','lifecycle'])
 expect(io.queued[0]).toMatchObject({validation_status:expected.status,validation_result:expected,blocking_reasons:expected.blockingReasons,ediel_message_id:message.id,outbound_request_id:id(5),render_status:'rendered'})
 expect(io.updates[0].updated_by).toBe(id(3));expect(io.row.outbox_status).toBe('queued')
 vi.useRealTimers()
})
it.each(['application_reference','sender_ediel_id','route_profile_id'])('actual evaluator rejects missing %s without rendering, lifecycle writes or queue',async(field)=>{
 io.row[field]='';expect((await renderAndQueueRequestedChange(input)).status).toBe('held')
 expect(io.render).not.toHaveBeenCalled();expect(io.finalize).not.toHaveBeenCalled();expect(io.updates).toEqual([]);expect(io.queue).not.toHaveBeenCalled()
})
it.each(['finalizer','current source','message identity','lifecycle write'])('%s refusal never queues or advances outbox',async(failure)=>{
 if(failure==='finalizer')io.finalize.mockRejectedValue(Error('declared_finalizer_refused'))
 if(failure==='current source')io.assert.mockRejectedValue(Error('declared_current_source_refused'))
 if(failure==='message identity')io.finalize.mockResolvedValue({...message,intent_id:id(99)})
 if(failure==='lifecycle write')io.writeError=Error('declared_lifecycle_write_refused')
 await expect(renderAndQueueRequestedChange(input)).rejects.toThrow()
 expect(io.queue).not.toHaveBeenCalled();expect(io.row.outbox_status).toBe('not_queued')
 expect(io.row.validation_status).toBe('draft');expect(io.row.validation_result).toEqual({})
})
it('held current source never certifies validation or prepares a message',async()=>{
 io.read.mockResolvedValue({status:'held',missing:['declared_current_source']})
 expect((await renderAndQueueRequestedChange(input)).status).toBe('held');expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled();expect(io.updates).toEqual([])
})
it.each(['sent','acknowledged'])('existing %s original is source-checked without validation rewrite, rendering or requeue',async(status)=>{
 io.existing={...message,status};const before=structuredClone(io.row)
 const result=await renderAndQueueRequestedChange(input);expect(result.status).toBe('existing');if(result.status!=='existing')throw Error('existing_original_required');expect(result.message).toEqual(io.existing)
 expect(io.assert).toHaveBeenCalledWith(io.existing,id(3));expect(io.render).not.toHaveBeenCalled();expect(io.updates).toEqual([]);expect(io.row).toEqual(before);expect(io.queue).not.toHaveBeenCalled()
})
it('draft retry retains original bytes and identity while revalidating before queue',async()=>{
 io.existing={...message};const before=structuredClone(io.existing)
 await renderAndQueueRequestedChange(input);expect(io.existing).toEqual(before)
 expect(io.queued[0]).toMatchObject({validation_status:'validated',ediel_message_id:message.id,outbound_request_id:id(5)})
 expect(io.queue).toHaveBeenCalledWith(expect.objectContaining({messageId:message.id,intentId:id(4),outboundRequestId:id(5)}))
})
it('a concurrent already sent original returned by canonical finalizer is not rewritten or queued',async()=>{
 io.finalize.mockResolvedValue({...message,status:'sent'})
 expect((await renderAndQueueRequestedChange(input)).status).toBe('existing');expect(io.updates).toEqual([]);expect(io.queue).not.toHaveBeenCalled()
})
