import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkAckDeadlines } from '@/lib/ediel/sla/checkAckDeadlines'
const io=vi.hoisted(()=>({calls:[] as Array<{table:string,op:string,args:unknown[]}>,matched:true,event:vi.fn()}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:io.event}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from(table:string){
  let updating=false
  const query:Record<string,unknown>={}
  for(const op of ['select','in','order','limit','eq','update']) query[op]=(...args:unknown[])=>{io.calls.push({table,op,args});if(op==='update') updating=true;return query}
  query.maybeSingle=async()=>({data:table==='ediel_messages'?{id:'source',company_id:'tenant-a',environment:'test',message_family:'PRODAT'}:null,error:null})
  query.then=(resolve:(value:unknown)=>unknown)=>resolve({data:table==='ediel_sla_timers'?(updating?(io.matched?[{id:'timer'}]:[]):[{id:'timer',company_id:'tenant-a',ediel_message_id:'source',timer_type:'contrl_due',status:'open',due_at:'2026-09-30T12:30:00Z'}]):[],error:null})
  return query
}}}))
beforeEach(()=>{io.calls=[];io.matched=true;vi.clearAllMocks();io.event.mockResolvedValue(null)})
describe('timer sweep concurrency guard',()=>{
  it('uses a tenant/status compare and swap rather than overwriting a concurrent resolution',async()=>{
    io.matched=false
    const result=await checkAckDeadlines({actorUserId:'actor',companyId:'tenant-a',now:'2026-09-30T13:00:00Z'})
    expect(result.updated).toBe(0)
    expect(io.calls).toContainEqual({table:'ediel_sla_timers',op:'eq',args:['company_id','tenant-a']})
    expect(io.calls).toContainEqual({table:'ediel_sla_timers',op:'eq',args:['status','open']})
    expect(io.event).not.toHaveBeenCalled()
  })
  it('rejects invalid caller time before reading or updating timers',async()=>{
    await expect(checkAckDeadlines({actorUserId:'actor',now:'invalid'})).rejects.toThrow('ack_deadline_now_invalid')
    expect(io.calls).toEqual([])
  })
})
