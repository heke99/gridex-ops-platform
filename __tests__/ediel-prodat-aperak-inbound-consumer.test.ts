import {expect,it,vi} from 'vitest'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'
import type {InboundEntityMatch} from '@/lib/inbound-mail/inboundMatcher'

const state=vi.hoisted(()=>({writes:[] as {table:string;kind:string;payload:Record<string,unknown>;filters?:Record<string,unknown>}[],tasks:[] as Record<string,unknown>[]}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>({
 select(){return {eq(){return this},limit(){return this},maybeSingle:async()=>({data:null,error:null})}},
 insert(payload:Record<string,unknown>){state.writes.push({table,kind:'insert',payload});return {select(){return {maybeSingle:async()=>({data:{id:'inbound-ack'},error:null})}}}},
 update(payload:Record<string,unknown>){const write={table,kind:'update',payload,filters:{} as Record<string,unknown>};state.writes.push(write);return {eq(key:string,value:unknown){write.filters[key]=value;return this}}},
})}}))
vi.mock('@/lib/inbound-mail/inboundTaskFactory',()=>({createInboundMailTask:async(task:Record<string,unknown>)=>{state.tasks.push(task)}}))

import {applyCanonicalInboundAckStatusUpdate} from '@/lib/inbound-mail/canonicalInboundAckStatusUpdater'

const matched:InboundEntityMatch={status:'matched',entityType:'ediel_message',entityId:'outbound-source',confidence:1,reasons:[],candidates:[{id:'outbound-source'}]}
const missing:InboundEntityMatch={status:'missing',entityType:null,entityId:null,confidence:0,reasons:[],candidates:[]}

it('persists a correlated PRODAT BGM27/314 as a negative result and describes its own profile',async()=>{
 state.writes=[];state.tasks=[]
 const parsed=parseEdifactPayload("UNA:+.? 'UNB+UNOC:3+54321:14+12345:14+260927:1200+I++23-DDQ-PRODAT'UNH+1+APERAK:D:96A:UN:E2SE6A'BGM+++27'RFF+ACW:D'ERC+42::260'FTX+AAO++314::260+Felaktigt Sekvensnummer 4'UNT+6+1'UNZ+1+I'")
 expect(parsed.references.ACW).toEqual(['D'])
 const result=await applyCanonicalInboundAckStatusUpdate({companyId:'tenant-A',environment:'test',parsed,
  outboundMatch:matched,meteringPointMatch:missing,inboundEmailMessageId:'inbound-mail-A'})
 expect(result).toMatchObject({status:'manual_review',matchStatus:'negative_aperak',inboundEdielMessageId:'inbound-ack'})
 const inbound=state.writes.find(write=>write.table==='ediel_messages'&&write.kind==='insert')!.payload
 const outboundWrite=state.writes.find(write=>write.table==='ediel_messages'&&write.kind==='update')!
 const outbound=outboundWrite.payload
 expect(inbound).toMatchObject({company_id:'tenant-A',ack_outcome:'negative',aperak_status:'rejected',processing_status:'manual_review'})
 expect(outbound).toMatchObject({ack_outcome:'negative',aperak_status:'rejected',related_message_id:'inbound-ack'})
 expect(outboundWrite.filters).toEqual({company_id:'tenant-A',direction:'outbound',id:'outbound-source'})
 expect(String(outbound.failure_reason)).toContain('PRODAT-APERAK (BGM 27)')
 expect(state.tasks).toEqual([expect.objectContaining({companyId:'tenant-A',taskType:'ediel_negative_aperak',description:expect.stringContaining('BGM 27')})])
})
