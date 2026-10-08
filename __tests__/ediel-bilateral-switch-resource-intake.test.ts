// masterplan: AT-Z03H-SUPPLIER, AT-Z04H-SUPPLIER
// Real public first-reception path; external DB/catalog ports are finite IO.
// This does not execute PostgreSQL or prove private ACK/business acceptance.
import {beforeEach,expect,it,vi} from 'vitest'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {parseInboundEmailContent} from '@/lib/inbound-mail/edielEmailParser'
import {ownerRulePack} from './helpers/sourceOwnerFixtures'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {line,characteristic} from './fixtures/prodat-register'
import {company,actor,mailId,parseId,newId,inboundReceptionBoundary} from './fixtures/inbound-reception-db'

const io=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from,rpc:io.rpc}}))
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const requestId=id(31),customerId=id(32),siteId=id(33),pointId=id(34),physical='735999000000001'
type Row=Record<string,unknown>
const wire=(second='2')=>guideOrderedFixtureRaw([line('1',physical,'1','9'),...characteristic('Z13','Z25'),['RFF',['LI','OWN']],line('2',physical,second,'9')],'Z04')
function parse(rawPayload:string){const p=parseInboundEmailContent({attachmentText:rawPayload});if(!p)throw Error('actual_parser_required');return p}
function registry(){
 const row=ownerRulePack();Object.assign(row,{profile_key:'PRODAT:Z04:H:26.A:r3',profile:{...row.profile,transactionSubtype:'H',reasonForTransaction:'Z25'}})
 Object.assign(row.original_snapshot.messageProfile,{profile_key:row.profile_key,profile:row.profile});return row
}
const candidate=()=>({id:requestId,company_id:company,customer_id:customerId,site_id:siteId,metering_point_id:pointId,request_type:'supplier_switch'})
let db:ReturnType<typeof inboundReceptionBoundary>
let rows:Record<string,Row[]>,resourceReads:Array<{table:string;filters:Array<[string,unknown]>}>
function setup(rawPayload=wire()){
 db=inboundReceptionBoundary(parse(rawPayload));db.state.existing=false;resourceReads=[]
 rows={outbound_requests:[{...candidate(),payload:{environment:'test'}}],
  metering_points:[{id:pointId,company_id:company,customer_id:customerId,site_id:siteId,customer_site_id:siteId,ediel_metering_point_id:physical}],
  customers:[{id:customerId,company_id:company}],customer_sites:[{id:siteId,company_id:company,customer_id:customerId}]}
 io.from.mockImplementation((table:string)=>{
  if(!(table in rows))return db.from(table)
  const call={table,filters:[] as Array<[string,unknown]>};resourceReads.push(call)
  const q={select:()=>q,eq:(k:string,v:unknown)=>{call.filters.push([k,v]);return q},maybeSingle:async()=>{
   const found=rows[table].filter(r=>call.filters.every(([k,v])=>r[k]===v))
   return found.length>1?{data:null,error:{code:'PGRST116',message:'multiple rows'}}:{data:found[0]??null,error:null}
  }};return q
 })
 io.rpc.mockImplementation(async(name:string,args:Row)=>name==='resolve_canonical_ediel_rule_pack_with_witness_v1'?{data:[registry()],error:null}:db.rpc(name,args))
}
const input=(rawPayload=wire())=>({companyId:company,actorUserId:actor,environment:'test',inboundEmailMessageId:mailId,parseResultId:parseId,parsed:parse(rawPayload),
 outboundMatch:{status:'matched' as const,entityType:'outbound_request',entityId:requestId,confidence:1,reasons:[],candidates:[candidate()]},
 meteringPointMatch:{status:'missing' as const,entityType:null,entityId:null,confidence:0,reasons:[],candidates:[]}})
beforeEach(()=>{vi.clearAllMocks();setup()})
it('binds the actual owned physical H point before the first immutable source INSERT',async()=>{
 const rawPayload=wire();expect(await createInboundEdielMessage(input(rawPayload))).toBe(newId)
 const writes=db.writes('ediel_messages');expect(writes).toHaveLength(1)
 expect(writes[0].payload).toMatchObject({raw_payload:rawPayload,company_id:company,environment:'test',outbound_request_id:requestId,
  customer_id:customerId,site_id:siteId,metering_point_id:pointId,rule_profile_key:'PRODAT:Z04:H:26.A:r3'})
 expect(resourceReads.map(r=>r.table)).toEqual(['outbound_requests','metering_points','customers','customer_sites'])
 for(const read of resourceReads){expect(read.filters).toContainEqual(['company_id',company]);expect(read.filters.find(([k])=>k==='id')).toBeDefined()}
 expect(db.state.rpcCalls.map(c=>c.name)).toEqual(['gridex_actor_has_company_permission','ediel_record_inbound_reception_v1'])
 expect(db.state.calls.filter(c=>c.operation!=='select'&&c.table!=='ediel_messages'&&c.table!=='ediel_message_events')).toEqual([])
 for(const name of ['bilateral_capability_verified','business_effect_authorized','execution_context_snapshot'])expect(writes[0].payload).not.toHaveProperty(name)
})
