import { describe,it,expect,vi,beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
const m=vi.hoisted(()=>({rows:[] as Record<string,unknown>[],queries:[] as {table:string,filters:Record<string,unknown>}[],uploadedBytes:0,uploads:0,removes:0}))
vi.mock('@/lib/integrations/apiAuth',()=>({requireIntegrationApiAccess:vi.fn(async()=>({ok:true,client:{id:'client_synthetic',company_id:'company_synthetic'}})),logIntegrationApiRequest:vi.fn(async()=>{})}))
vi.mock('@/lib/api/strictRequest',async original=>({...await original<object>(),executeIdempotentPortalWrite:vi.fn(async()=>({replayed:true,statusCode:201,body:{entity_id:'poa_public'}}))}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{
 storage:{from:()=>({upload:async(_path:string,bytes:Buffer)=>{m.uploads++;m.uploadedBytes+=bytes.length;return {error:null}},remove:async()=>{m.removes++;return {error:null}}})},
 from(table:string){
  const q={table,filters:{} as Record<string,unknown>};m.queries.push(q)
  const b={select(){return b},eq(k:string,v:unknown){q.filters[k]=v;return b},gte(){return b},lte(){return b},in(){return b},order(){return b},limit(){return b},
   async maybeSingle(){return {error:null,data:table==='customers'?{id:'customer_internal',customer_reference:'customer_public',customer_type:'private',first_name:'Test',last_name:'Person',identity_number:'191212121212'}:{id:'site_internal',customer_id:'customer_internal',facility_reference:'site_public',site_type:'consumption'}}},
   then(resolve:(v:unknown)=>unknown){return Promise.resolve({error:null,data:m.rows.filter(row=>Object.entries(q.filters).every(([k,v])=>row[k]===v))}).then(resolve)}
  };return b
 }
}}))
import { handleSimplePartnerApi } from '@/lib/partner-api/simple'
beforeEach(()=>{m.rows=[];m.queries=[];m.uploadedBytes=0;m.uploads=0;m.removes=0})
async function measurements(){
 const r=await handleSimplePartnerApi(new NextRequest('https://example.invalid/api/partner/v1/customer/customer_public/site/site_public/measurement?from_date=2026-01-01&to_date=2026-01-01'),'GET',['customer','customer_public','site','site_public','measurement'])
 expect(r!.status).toBe(200);return r!.json()
}
function reading(status:string,quantity:number,unit='kWh',direction='consumption'){
 return {company_id:'company_synthetic',customer_site_id:'site_internal',period_start:'2026-01-01T00:00:00Z',resolution:'1h',period_end:'2026-01-01T01:00:00Z',revision_status:status,quantity_kwh:quantity,unit,direction}
}
describe('OPS metering and replay efficiency probes',()=>{
 it('returns both replaced and current readings for one corrected interval',async()=>{
  m.rows=[reading('replaced',10),reading('current',12)]
  const body=await measurements();expect(body.measurements.map((x:{value:number})=>x.value)).toEqual([10,12])
  expect(m.queries.find(q=>q.table==='normalized_metering_values')!.filters).not.toHaveProperty('revision_status')
 })
 it('labels quantity_kwh with source Wh rather than schema kWh',async()=>{
  m.rows=[reading('current',1,'Wh')]
  const body=await measurements();expect(body.measurements[0]).toMatchObject({value:1,unit:'Wh'})
 })
 it('emits net direction outside documented measurement vocabulary',async()=>{
  m.rows=[reading('current',1,'kWh','net_consumption')]
  const body=await measurements();expect(body.measurements[0].type).toBe('NET_CONSUMPTION')
 })
 it('completed POA replay still transfers file to storage and deletes it',async()=>{
  const bytes=Buffer.concat([Buffer.from('%PDF-1.7\n'),Buffer.alloc(128*1024,32),Buffer.from('\n%%EOF')])
  const request=new NextRequest('https://example.invalid/api/partner/v1/customer/customer_public/site/site_public/powerofattorney',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'synthetic_replay'},body:JSON.stringify({poa_type:'PAPER',transaction_type:'SWITCH',file_extension:'pdf',file_base64:bytes.toString('base64')})})
  const response=await handleSimplePartnerApi(request,'POST',['customer','customer_public','site','site_public','powerofattorney'])
  expect(response!.status).toBe(201);expect(m.uploads).toBe(1);expect(m.removes).toBe(1);expect(m.uploadedBytes).toBe(bytes.length)
  expect(m.queries.filter(q=>q.table==='powers_of_attorney')).toHaveLength(0)
 })
})
