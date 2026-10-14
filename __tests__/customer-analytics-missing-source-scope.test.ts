import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it } from 'vitest'
const db = new PGlite()
const company='00000000-0000-4000-8000-000000000001'
const customer='10000000-0000-4000-8000-000000000001'
const other='10000000-0000-4000-8000-000000000002'
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table metering_points(id uuid primary key,company_id uuid,customer_id uuid,grid_owner_id uuid,month date);
 create function gridex_missing_metering_points_v1(p_company uuid,p_month date) returns table(metering_point_id uuid,grid_owner_id uuid) language sql stable as $$select id,grid_owner_id from metering_points where company_id=p_company and month=p_month$$;
 insert into metering_points values('20000000-0000-4000-8000-000000000001','${company}','${customer}',null,'2026-09-01'),('20000000-0000-4000-8000-000000000002','${company}','${other}',null,'2026-09-01'),('20000000-0000-4000-8000-000000000003','${company}','${other}',null,'2026-09-01'),('20000000-0000-4000-8000-000000000004','${company}','${customer}',null,'2026-10-01');`)
 const name=fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_analytics_customer_missing_meter_scope.sql'))!
 await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'))
}, 30_000)
afterAll(async()=>db.close())
it('counts only the selected customer and month from the shared source helper',async()=>{
 expect((await db.query(`select gridex_missing_metering_points_count_v1('${company}','2026-09-01','${customer}') n`)).rows).toEqual([{n:1}])
 expect((await db.query(`select gridex_missing_metering_points_count_v1('${company}','2026-09-01','${other}') n`)).rows).toEqual([{n:2}])
 expect((await db.query(`select gridex_missing_metering_points_count_v1('${company}','2026-09-01',null) n`)).rows).toEqual([{n:3}])
 expect((await db.query(`select gridex_missing_metering_points_count_v1('00000000-0000-4000-8000-000000000099','2026-09-01','${customer}') n`)).rows).toEqual([{n:0}])
})

// Exercise the real application loader in addition to the SQL scope contract.
const io = vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/analytics/customerPortfolio',()=>({getPortfolioMonthForCompany:async()=>undefined}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:()=>{
 const query:Record<string,unknown>={}
 for(const name of ['select','eq','in','gte','lt','order','limit'])query[name]=()=>query
 query.then=(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:[],count:0,error:null}).then(resolve)
 return query
}}}))
import { vi } from 'vitest'
import { getCustomerAnalytics } from '@/lib/analytics/db'
it('passes the selected customer and normalized month through the real analytics loader',async()=>{
 io.rpc.mockResolvedValue({data:2,error:null})
 const result=await getCustomerAnalytics(company,customer,'2026-09')
 expect(io.rpc).toHaveBeenCalledWith('gridex_missing_metering_points_count_v1',{p_company:company,p_month:'2026-09-01',p_customer:customer})
 expect(result.missingMeteringValues).toBe(2)
})
it('propagates a missing-count read failure instead of showing a false zero',async()=>{
 io.rpc.mockResolvedValue({data:null,error:{message:'schema cache unavailable'}})
 await expect(getCustomerAnalytics(company,customer,'2026-09')).rejects.toMatchObject({message:'schema cache unavailable'})
})
it('preserves source RLS and denies anonymous invocation',async()=>{
 await db.exec(`alter table metering_points enable row level security;grant select on metering_points to authenticated;create policy company_scope on metering_points for select to authenticated using(company_id=current_setting('test.company_id')::uuid);
 insert into metering_points values('20000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000099','${customer}',null,'2026-09-01');
 set test.company_id='${company}';set role authenticated;`)
 try {
  expect((await db.query(`select gridex_missing_metering_points_count_v1('${company}','2026-09-16',null) n`)).rows).toEqual([{n:3}])
  expect((await db.query(`select gridex_missing_metering_points_count_v1('00000000-0000-4000-8000-000000000099','2026-09-01',null) n`)).rows).toEqual([{n:0}])
 }finally{await db.exec('reset role')}
 expect((await db.query(`select has_function_privilege('anon','gridex_missing_metering_points_count_v1(uuid,date,uuid)','execute') allowed`)).rows).toEqual([{allowed:false}])
})
