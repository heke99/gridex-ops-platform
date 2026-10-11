// masterplan: AT-Z03H-SUPPLIER, AT-Z04H-SUPPLIER
// Real physical parser/reference qualification; declared finite readonly DB IO.
import {beforeEach,expect,it,vi} from 'vitest'
import {captureBilateralSwitchBirthResources,resolveBilateralSwitchBirthResources} from '@/lib/inbound-mail/bilateralSwitchBirthResources'
import type {InboundEntityMatch} from '@/lib/inbound-mail/inboundMatcher'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {line,characteristic} from './fixtures/prodat-register'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
const io=vi.hoisted(()=>({from:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from}}))
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const scope={companyId:id(1),requestId:id(31),customerId:id(32),siteId:id(33),pointId:id(34)},physical='735999000000001'
type Row=Record<string,unknown>
const wire=(options:{second?:string;secondPoint?:string;agency?:string;code?:string}={})=>guideOrderedFixtureRaw([
 line('1',physical,'1',options.agency??'9'),...characteristic('Z13','Z25'),line('2',options.secondPoint??physical,options.second??'2',options.agency??'9'),
],options.code??'Z04')
const selected=():InboundEntityMatch=>({status:'matched',entityType:'outbound_request',entityId:scope.requestId,confidence:1,reasons:[],candidates:[{
 id:scope.requestId,company_id:scope.companyId,customer_id:scope.customerId,site_id:scope.siteId,metering_point_id:scope.pointId,request_type:'supplier_switch',
}]})
const capture=(match=selected(),meteringPointMatch?:InboundEntityMatch|null)=>captureBilateralSwitchBirthResources({companyId:scope.companyId,outboundMatch:match,meteringPointMatch})
let rows:Record<string,Row[]>,errors:Record<string,unknown>,reads:Array<{table:string;columns:string;filters:Array<[string,unknown]>}>
function setup(){
 rows={outbound_requests:[{id:scope.requestId,company_id:scope.companyId,customer_id:scope.customerId,site_id:scope.siteId,metering_point_id:scope.pointId,request_type:'supplier_switch',payload:{environment:'test'}}],
  metering_points:[{id:scope.pointId,company_id:scope.companyId,customer_id:scope.customerId,site_id:scope.siteId,customer_site_id:scope.siteId,ediel_metering_point_id:physical}],
  customers:[{id:scope.customerId,company_id:scope.companyId}],customer_sites:[{id:scope.siteId,company_id:scope.companyId,customer_id:scope.customerId}]}
 errors={};reads=[]
 io.from.mockImplementation((table:string)=>{
  if(!(table in rows))throw Error('undeclared_resource_read:'+table)
  const read={table,columns:'',filters:[] as Array<[string,unknown]>};reads.push(read)
  const q={select:(columns:string)=>{read.columns=columns;return q},eq:(k:string,v:unknown)=>{read.filters.push([k,v]);return q},maybeSingle:async()=>{
   const found=rows[table].filter(r=>read.filters.every(([k,v])=>r[k]===v))
   return {data:found.length===1?found[0]:null,error:errors[table]??(found.length>1?Error('finite_multiple_rows'):null)}
  }};return q
 })
}
const resolve=(rawPayload=wire(),environment:'test'|'production'='test')=>resolveBilateralSwitchBirthResources({candidate:scope,rawPayload,environment})
beforeEach(()=>{vi.clearAllMocks();setup()})
it.each(['9','89'])('qualifies exact physical agency%s/current owned tuple with only exact scoped reads',async agency=>{
 expect(capture()).toEqual(scope);expect(Object.isFrozen(capture())).toBe(true)
 expect(await resolve(wire({agency}))).toEqual(scope)
 expect(reads.map(r=>r.table)).toEqual(['outbound_requests','metering_points','customers','customer_sites'])
 const expectedIds:Record<string,string>={outbound_requests:scope.requestId,metering_points:scope.pointId,customers:scope.customerId,customer_sites:scope.siteId}
 for(const r of reads)expect(r.filters).toEqual([['company_id',scope.companyId],['id',expectedIds[r.table]]])
 expect(reads[0].columns.split(',')).toContain('payload');expect(reads[0].columns.split(',')).not.toContain('environment')
})
it('qualifies production only when the actual request payload environment matches',async()=>{
 rows.outbound_requests[0].payload={environment:'production'}
 expect(await resolve(wire(),'production')).toEqual(scope)
 expect(await resolve()).toBeNull()
})
it.each(['missing','ambiguous','not_checked']as const)('refuses outbound status%s before any reference lookup',status=>{
 const match=selected();match.status=status;expect(capture(match)).toBeNull();expect(reads).toEqual([])
})
it.each([null,'ediel_message','metering_point'])('refuses unrelated match entity%s',entityType=>{
 const match=selected();match.entityType=entityType;expect(capture(match)).toBeNull()
})
it.each([{candidates:[]},{candidates:[{},{}]}])('refuses zero/multiple selected candidates',({candidates})=>{
 const match=selected();match.candidates=candidates;expect(capture(match)).toBeNull()
})
it.each(['id','company_id','customer_id','site_id','metering_point_id','request_type'])('refuses invalid candidate%s',field=>{
 const match=selected();match.candidates[0][field]='foreign';expect(capture(match)).toBeNull()
})
it.each(['matched','ambiguous']as const)('never forces a %s independent metering match',status=>{
 expect(capture(selected(),{status,entityType:'metering_point',entityId:null,confidence:1,reasons:[],candidates:[]})).toBeNull()
})
it.each(['missing','not_checked']as const)('permits candidate snapshot for independent status%s',status=>{
 expect(capture(selected(),{status,entityType:null,entityId:null,confidence:0,reasons:[],candidates:[]})).toEqual(scope)
})
it('freezes the primitive match tuple rather than retaining mutable candidates',()=>{
 const match=selected(),frozen=capture(match);match.entityId=id(91);match.candidates[0].metering_point_id=id(92)
 expect(frozen).toEqual(scope)
})
it.each([null,{},[],{environment:'production'},{environment:'foreign'},'test'])('refuses actual request payload%j',async payload=>{
 rows.outbound_requests[0].payload=payload;expect(await resolve()).toBeNull();expect(reads).toHaveLength(1)
})
it.each(['outbound_requests','metering_points','customers','customer_sites'])('requires actual current owned%s',async table=>{
 rows[table]=[];expect(await resolve()).toBeNull()
})
it.each([
 ['outbound_requests','company_id'],['outbound_requests','id'],['outbound_requests','customer_id'],['outbound_requests','site_id'],['outbound_requests','metering_point_id'],['outbound_requests','request_type'],
 ['metering_points','company_id'],['metering_points','id'],['metering_points','customer_id'],['metering_points','site_id'],['metering_points','customer_site_id'],['metering_points','ediel_metering_point_id'],
 ['customers','company_id'],['customers','id'],['customer_sites','company_id'],['customer_sites','id'],['customer_sites','customer_id'],
])('refuses conflicting current%s.%s',async(table,field)=>{
 rows[table][0][field]=field==='ediel_metering_point_id'?physical+' ':id(99)
 expect(await resolve()).toBeNull()
})
it('supports a null compatibility pointer with the exact actual canonical site relation',async()=>{
 rows.metering_points[0].customer_site_id=null;expect(await resolve()).toEqual(scope)
})
it('refuses null canonical point.site_id even when the compatibility pointer matches',async()=>{
 rows.metering_points[0].site_id=null;expect(rows.metering_points[0].customer_site_id).toBe(scope.siteId)
 expect(await resolve()).toBeNull()
})
it.each(['outbound_requests','metering_points','customers','customer_sites'])('propagates%s SQL error instead of fabricating qualification',async table=>{
 const error=Error('declared_SQL_'+table);errors[table]=error;await expect(resolve()).rejects.toBe(error)
})
it.each(['outbound_requests','metering_points','customers','customer_sites'])('refuses ambiguous%s rows',async table=>{
 rows[table].push({...rows[table][0]});await expect(resolve()).rejects.toThrow('finite_multiple_rows')
})
it.each([{second:''},{second:'3'},{secondPoint:'735999000000002'},{agency:'260'},{code:'Z05'}])('refuses malformed/different physical source%j before any DB read',async options=>{
 expect(await resolve(wire(options))).toBeNull();expect(reads).toEqual([])
})
it.each([null,undefined,'not-edifact'])('refuses absent/invalid original payload%s before reference lookup',async rawPayload=>{
 expect(await resolveBilateralSwitchBirthResources({candidate:scope,rawPayload,environment:'test'})).toBeNull();expect(reads).toEqual([])
})
it('pins candidate and environment before the first awaited request read',async()=>{
 const candidate={...scope},arg={candidate,rawPayload:wire(),environment:'test' as 'test'|'production'},from=io.from.getMockImplementation()!
 io.from.mockImplementation((table:string)=>{
  const q=from(table),original=q.maybeSingle
  q.maybeSingle=async()=>{const result=await original();candidate.pointId=id(98);arg.environment='production';return result};return q
 })
 expect(await resolveBilateralSwitchBirthResources(arg)).toEqual(scope)
 expect(candidate.pointId).toBe(id(98))
})
it('refuses two otherwise valid independent physical objects rather than selecting one',async()=>{
 const raw=guideOrderedFixtureRaw([line('1',physical,undefined,'9'),...characteristic('Z13','Z25'),
  line('2','735999000000002',undefined,'9'),...characteristic('Z13','Z25')],'Z04')
 const tokens=tokenizeEdifact(raw),groups=prodatRegisterGroups(tokens.segments,tokens.una,'Z04')
 expect(groups.problems).toEqual([]);expect(groups.groups.every(g=>g.validRegisterChain)).toBe(true)
 expect(await resolve(raw)).toBeNull();expect(reads).toEqual([])
})
it.each(['Z22','Z23','Z28'])('refuses other transaction reason%s before reference reads',async reason=>{
 expect(await resolve(wire().replace('CAV+Z25',`CAV+${reason}`))).toBeNull();expect(reads).toEqual([])
})
it('does not borrow a legacy point alias when canonical physical identity is absent',async()=>{
 rows.metering_points[0].ediel_metering_point_id=null;rows.metering_points[0].meter_point_id=physical
 expect(await resolve()).toBeNull()
})
