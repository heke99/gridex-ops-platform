import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import Ajv from 'ajv'
const m = vi.hoisted(() => ({ invoices: [] as Record<string, unknown>[], queries: [] as {table:string,limit:number,filters:Record<string, unknown>}[] }))
vi.mock('@/lib/integrations/apiAuth', () => ({
 requireIntegrationApiAccess: vi.fn(async () => ({ok:true,client:{id:'client_synthetic',company_id:'company_synthetic'}})),
 logIntegrationApiRequest: vi.fn(async()=>{})
}))
vi.mock('@/lib/supabase/service', () => ({supabaseService:{from(table:string){
 const q={table,limit:Infinity,filters:{} as Record<string,unknown>};m.queries.push(q)
 const customer={id:'customer_internal',customer_reference:'customer_public',customer_type:'private',first_name:'Test',last_name:'Person',identity_number:'191212121212',email:'test@example.invalid',company_name:'Test',billing_street:'Test street',billing_postal_code:'12345',billing_city:'Test',billing_country:'SE',phone:'0700000000'}
 const site={id:'site_internal',customer_id:customer.id,facility_reference:'site_public',street:'Test street',postal_code:'12345',city:'Test',country:'SE',site_type:'consumption'}
 const builder={
 select(){return builder},eq(k:string,v:unknown){q.filters[k]=v;return builder},order(){return builder},gte(){return builder},lte(){return builder},
 limit(n:number){q.limit=n;return builder},
 async maybeSingle(){return {data:table==='customers'?customer:site,error:null}},
 then(resolve:(v:unknown)=>unknown){
  const rows=table==='customer_contracts'?[{id:'target_contract'}]:m.invoices
  return Promise.resolve({data:rows.slice(0,q.limit),error:null}).then(resolve)
 }
 };return builder
}}}))
import { handleSimplePartnerApi } from '@/lib/partner-api/simple'
import { partnerOpenApi } from '@/lib/partner-api/openApi'
const schemas=JSON.parse(JSON.stringify(partnerOpenApi.components.schemas).replaceAll('#/components/schemas/','#/definitions/'))
const ajv=new Ajv({allErrors:true})
beforeEach(()=>{m.invoices=[];m.queries=[]})
async function get(path:string[]){
 const response=await handleSimplePartnerApi(new NextRequest('https://example.invalid/api/partner/v1/'+path.join('/')),'GET',path)
 expect(response?.status).toBe(200);return response!.json()
}
describe('additional review probes using real Partner handlers and published schemas',()=>{
 it('a complete non-null customer response violates both closed allOf branches',async()=>{
  const body=await get(['customer','customer_public'])
  const validate=ajv.compile({definitions:schemas,$ref:'#/definitions/Customer'})
  expect(validate(body)).toBe(false)
  expect(validate.errors).toEqual(expect.arrayContaining([expect.objectContaining({keyword:'additionalProperties',params:{additionalProperty:'entity_id'}})]))
  expect(validate.errors!.some(e=>e.keyword==='additionalProperties'&&e.params.additionalProperty==='first_name')).toBe(true)
 })
 it('a complete non-null site response also violates its published closed allOf',async()=>{
  const body=await get(['customer','customer_public','site','site_public'])
  const validate=ajv.compile({definitions:schemas,$ref:'#/definitions/Site'})
  expect(validate(body)).toBe(false)
  expect(validate.errors!.some(e=>e.keyword==='additionalProperties'&&e.params.additionalProperty==='entity_id')).toBe(true)
 })
 it('200 newer invoices for another site hide a real invoice of the requested site',async()=>{
  const invoice=(ref:string,contract:string)=>({invoice_reference:ref,invoice_number:ref,amount_inc_vat:100,currency:'SEK',due_date:'2026-10-30',issued_at:'2026-10-01T00:00:00Z',status:'issued',customer_contract_id:contract})
  m.invoices=[...Array.from({length:200},(_,i)=>invoice('other_'+i,'other_site_contract')),invoice('target_invoice','target_contract')]
  const hidden=await get(['customer','customer_public','site','site_public','invoice'])
  expect(hidden).toEqual({invoices:[]})
  const query=m.queries.find(q=>q.table==='customer_invoices')!
  expect(query.limit).toBe(200)
  expect(query.filters).toEqual({company_id:'company_synthetic',customer_id:'customer_internal'})
  m.invoices=[invoice('target_invoice','target_contract')]
  const visible=await get(['customer','customer_public','site','site_public','invoice'])
  expect(visible.invoices).toHaveLength(1)
  expect(visible.invoices[0].entity_id).toBe('target_invoice')
 })
})
