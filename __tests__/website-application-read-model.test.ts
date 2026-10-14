import { beforeEach, expect, it, vi } from 'vitest'

const io=vi.hoisted(()=>({tables:{} as Record<string,Array<Record<string,unknown>>>,error:null as null|{code:string},calls:[] as Array<{table:string;filters:Array<[string,unknown]>}>}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
  const filters:Array<[string,unknown]>=[]; io.calls.push({table,filters})
  const q={select:()=>q,order:()=>q,limit:()=>q,eq:(key:string,value:unknown)=>{filters.push([key,value]);return q},in:(key:string,value:unknown)=>{filters.push([key,value]);return q},
    then:(resolve:(v:unknown)=>unknown)=>resolve({data:(io.tables[table]??[]).filter(row=>filters.every(([key,v])=>Array.isArray(v)?v.includes(row[key]):row[key]===v)),error:table==='gridex_website_application_work_items_v'?io.error:null})}
  return q
}}}))
import { listWebsiteApplications } from '@/lib/admin/websiteIntegrationOps'

beforeEach(()=>{io.tables={};io.error=null;io.calls=[]})

it('hydrates the shared filtered identity without merging different API-client signups',async()=>{
  io.tables.gridex_website_application_work_items_v=[
    {application_id:'a',company_id:'company',source_table:'website_customer_applications',status:'pending_review',work_state:'action_required',is_pending:true,linked_external_intake_id:'mirror'},
    {application_id:'b',company_id:'company',source_table:'website_customer_applications',status:'pending_review',work_state:'action_required',is_pending:true,linked_external_intake_id:null},
  ]
  io.tables.website_customer_applications=[{id:'a',company_id:'company',status:'partial',idempotency_key:'shared'},{id:'b',company_id:'company',status:'pending_review',idempotency_key:'shared'}]
  io.tables.external_contract_intakes=[{id:'mirror',company_id:'company',status:'failed',idempotency_key:'shared',created_customer_id:'customer'}]
  const rows=await listWebsiteApplications({companyId:'company',status:'pending_review'})
  expect(rows.map(r=>r.id)).toEqual(['a','b'])
  expect(rows.map(r=>r.status)).toEqual(['pending_review','pending_review'])
  expect(rows[0]).toMatchObject({customer_id:'customer',work_state:'action_required',is_pending:true})
  expect(io.calls[0].filters).toEqual([['company_id','company'],['status','pending_review']])
  expect(io.calls.slice(1).every(c=>!c.filters.some(([key])=>key==='status'))).toBe(true)
})

it('does not turn a missing shared schema or concurrent source deletion into an empty list',async()=>{
  io.error={code:'PGRST205'}
  await expect(listWebsiteApplications({companyId:'company'})).rejects.toMatchObject({code:'PGRST205'})
  io.error=null
  io.tables.gridex_website_application_work_items_v=[{application_id:'gone',company_id:'company',source_table:'website_customer_applications',status:'pending_review',work_state:'action_required',is_pending:true,linked_external_intake_id:null}]
  await expect(listWebsiteApplications({companyId:'company'})).rejects.toThrow('Uppdatera sidan')
})
