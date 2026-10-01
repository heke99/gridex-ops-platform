import {beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
const io=vi.hoisted(()=>({inserted:null as Record<string,unknown>|null,prior:{} as Record<string,unknown>,upsert:vi.fn(),update:vi.fn(),event:vi.fn()}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:io.event}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{}}))
vi.mock('@/lib/supabase/tenantDb',()=>({tenantDb:()=>({from:()=>({
 upsert:(row:unknown,options:unknown)=>{io.upsert(row,options);return {select:()=>({maybeSingle:async()=>({data:io.inserted,error:null})})}},
 select:()=>({eq:()=>({maybeSingle:async()=>({data:io.prior,error:null})})}),update:io.update,
})})}))
import {createOutboxItem} from '@/lib/ediel/outbox/createOutboxItem'
const message={id:'ACK',company_id:'TENANT',environment:'test',message_family:'APERAK',message_code:'APERAK',related_message_id:'SOURCE',ack_outcome:'positive'} as EdielMessageRow
beforeEach(()=>{vi.clearAllMocks();io.inserted=null;io.prior={id:'OUTBOX',company_id:'TENANT',environment:'test',ediel_message_id:'ACK',source_message_id:'SOURCE',route_profile_id:null,status:'failed'}})
it('a concurrent existing failed entry remains immutable when first-response origination loses the unique lock',async()=>{
 const result=await createOutboxItem({actorUserId:'ACTOR',message,sourceMessageId:'SOURCE',status:'queued',lockKey:'OWN',queueOnlyIfInserted:true})
 expect(result).toBe(io.prior);expect(result?.status).toBe('failed')
 expect(io.upsert).toHaveBeenCalledWith(expect.objectContaining({status:'queued'}),{onConflict:'lock_key',ignoreDuplicates:true})
 expect(io.update).not.toHaveBeenCalled();expect(io.event).not.toHaveBeenCalled()
})
it('a retained cancelled/failed original can repair an absent prepared entry without triggering queued retry',async()=>{
 io.inserted={...io.prior,status:'prepared'}
 expect(await createOutboxItem({actorUserId:'ACTOR',message:{...message,status:'failed'},sourceMessageId:'SOURCE',status:'prepared',queueOnlyIfInserted:true})).toMatchObject({status:'prepared'})
 expect(io.update).not.toHaveBeenCalled();expect(io.event).toHaveBeenCalledWith(expect.objectContaining({payload:expect.objectContaining({outboxStatus:'prepared'})}))
})
it('an actual first new response is queued on its initial insertion',async()=>{
 io.inserted={...io.prior,status:'queued'}
 expect(await createOutboxItem({actorUserId:'ACTOR',message,sourceMessageId:'SOURCE',status:'queued',queueOnlyIfInserted:true})).toMatchObject({status:'queued'})
 expect(io.update).not.toHaveBeenCalled();expect(io.event).toHaveBeenCalledWith(expect.objectContaining({payload:expect.objectContaining({outboxStatus:'queued'})}))
})
