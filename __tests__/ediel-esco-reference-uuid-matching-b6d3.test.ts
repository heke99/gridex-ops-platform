// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO
import {beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {matchPermissionForAutomation} from '@/lib/ediel/matching/permissionMatcher'
import {matchProcessForAutomation} from '@/lib/ediel/matching/processMatcher'
import {matchCustomerForAutomation} from '@/lib/ediel/matching/customerMatcher'
import {findCustomersByIdentifierValues} from '@/lib/customers/matchingService'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'

type Row=Record<string,unknown>
type Query={table:string;filters:Array<[string,unknown]>;or:string;limit:number}
const db=vi.hoisted(()=>({tables:{} as Record<string,Row[]>,queries:[] as Query[],error:null as Row|null}))
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COMPANY='00000000-0000-4000-8000-000000000001',FOREIGN='00000000-0000-4000-8000-000000000002'
const ID='00000000-0000-7000-8000-000000000003',BGM='97ac37e2449b44aa8a94',Z09='SYNTHETIC-PERMISSION-d3f5b46a'

// Model the database's UUID-column cast before evaluating the OR, even if a
// different text arm matches. Exercise real consumers, canonical parsing and
// tenant filters; SMTP/public native execution remains a separate proof.
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from(table:string){
 const query:Query={table,filters:[],or:'',limit:0};db.queries.push(query)
 const chain={select:()=>chain,limit:(n:number)=>{query.limit=n;return chain},
  eq:(key:string,value:unknown)=>{query.filters.push([key,value]);return chain},
  in:(key:string,values:unknown[])=>{query.filters.push([key,values]);return chain},
  or:(value:string)=>{query.or=value;return chain},
  then:(resolve:(value:unknown)=>unknown)=>{
   const arms=query.or?query.or.split(',').map(part=>{const [column,op,...value]=part.split('.');expect(op).toBe('eq');return {column,value:value.join('.')}}):[]
   const invalid=arms.find(arm=>['id','grid_owner_data_request_id','outbound_request_id'].includes(arm.column)&&!uuid.test(arm.value))
   const error=db.error??(invalid?{code:'22P02',message:'invalid input syntax for type uuid: '+invalid.value}:null)
   const rows=(db.tables[table]??[]).filter(row=>query.filters.every(([key,value])=>Array.isArray(value)?value.includes(row[key]):row[key]===value))
    .filter(row=>arms.length===0||arms.some(arm=>row[arm.column]===arm.value)).slice(0,query.limit)
   return resolve({data:error?null:rows,error})
  }}
 return chain
}}}))
function wire(permission=Z09){return EdifactEnvelopeCodec.encode({sender:'7359990000001',receiver:'7359990000002',
 applicationReference:'23-DGI-PRODAT',interchangeReference:'SYNTHETIC01',environment:'test',acknowledgementRequest:true,
 messages:[{messageReference:'1',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:[`BGM+Z14+${BGM}+9`,'LIN+1++735999000000000001:9',`RFF+Z09:${permission}`]}]})}
function message(overrides:Row={}):EdielMessageRow{return {id:ID,company_id:COMPANY,external_reference:BGM,
 raw_payload:wire(),
 direction:'inbound',message_standard:'edifact',parsed_payload:{},validation_report:{},...overrides} as unknown as EdielMessageRow}
beforeEach(()=>{db.queries=[];db.tables={};db.error=null})
it('matches national Z09 text without casting it as permission UUID or crossing tenants',async()=>{
 db.tables.ediel_permissions=[{id:ID,company_id:COMPANY,permission_reference:Z09},{id:FOREIGN,company_id:FOREIGN,permission_reference:Z09}]
 const result=await matchPermissionForAutomation({message:message()})
 expect(result.map(r=>r.entityId)).toEqual([ID]);expect(result[0]).toMatchObject({score:175,reason:'permission_reference_exact'})
 expect(db.queries[0].filters).toEqual([['company_id',COMPANY]])
})
it('retains real permission UUID lookup, including newer UUID versions',async()=>{
 db.tables.ediel_permissions=[{id:ID,company_id:COMPANY}]
 expect((await matchPermissionForAutomation({message:message({raw_payload:wire(ID)})})).map(r=>r.entityId)).toEqual([ID])
})
it('matches BGM text in supplier switches and customer-info requests without UUID cast failure',async()=>{
 db.tables.supplier_switch_requests=[{id:ID,company_id:COMPANY,external_reference:BGM},{id:FOREIGN,company_id:FOREIGN,external_reference:BGM}]
 db.tables.customer_info_requests=[{id:ID,company_id:COMPANY,correlation_reference:BGM},{id:FOREIGN,company_id:FOREIGN,correlation_reference:BGM}]
 const result=await matchProcessForAutomation({message:message()})
 expect(result.map(r=>[r.entityId,r.details.processType])).toEqual([[ID,'supplier_switch'],[ID,'customer_info_request']])
 expect(db.queries.every(q=>q.filters.some(([key,value])=>key==='company_id'&&value===COMPANY))).toBe(true)
})
it('retains UUID process and linked customer-info lookups',async()=>{
 db.tables.supplier_switch_requests=[{id:ID,company_id:COMPANY}]
 db.tables.customer_info_requests=[{id:FOREIGN,company_id:COMPANY,outbound_request_id:ID}]
 const result=await matchProcessForAutomation({message:message({external_reference:ID})})
 expect(result.map(r=>[r.entityId,r.details.processType])).toEqual([[ID,'supplier_switch'],[FOREIGN,'customer_info_request']])
})
it('matches a customer text identifier through the actual automation caller',async()=>{
 db.tables.customers=[{id:ID,company_id:COMPANY,customer_number:BGM},{id:FOREIGN,company_id:FOREIGN,customer_number:BGM}]
 expect((await matchCustomerForAutomation({message:message()})).map(r=>r.entityId)).toEqual([ID])
})
it.each(['00000000-0000-0000-0000-000000000000','ABCDEFAB-1234-7000-FFFF-123456789ABC'])('retains canonical customer ID %s',async id=>{
 db.tables.customers=[{id,company_id:COMPANY}]
 expect(await findCustomersByIdentifierValues({companyId:COMPANY,values:[id],columns:['id']})).toEqual(db.tables.customers)
})
it('makes no unfiltered customer query when only an invalid UUID ID arm remains',async()=>{
 db.tables.customers=[{id:ID,company_id:COMPANY}]
 expect(await findCustomersByIdentifierValues({companyId:COMPANY,values:[BGM],columns:['id']})).toEqual([])
 expect(db.queries).toEqual([])
})
it('makes no automation lookup for unresolved tenant',async()=>{
 const input={message:message({company_id:null})}
 expect(await matchPermissionForAutomation(input)).toEqual([]);expect(await matchProcessForAutomation(input)).toEqual([])
 expect(await matchCustomerForAutomation(input)).toEqual([]);expect(db.queries).toEqual([])
})
it.each(['permission','process','customer'] as const)('propagates genuine %s database failures',async kind=>{
 const error={code:'08006',message:'SYNTHETIC_DATABASE_UNAVAILABLE'};db.error=error
 const match=kind==='permission'?matchPermissionForAutomation:kind==='process'?matchProcessForAutomation:matchCustomerForAutomation
 await expect(match({message:message()})).rejects.toEqual(error)
})
