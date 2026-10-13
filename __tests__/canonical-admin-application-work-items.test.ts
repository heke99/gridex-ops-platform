import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it } from 'vitest'

const companyA = '00000000-0000-4000-8000-000000000001'
const companyB = '00000000-0000-4000-8000-000000000002'
const db = new PGlite()

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table companies(id uuid primary key, name text);
    create table website_customer_applications (
      id uuid primary key, company_id uuid not null, api_client_id uuid,
      status text, idempotency_key text, intake_id uuid,
      created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create table external_contract_intakes (
      id uuid primary key, company_id uuid not null, status text,
      idempotency_key text, intake_id uuid, payload jsonb default '{}',
      created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create table data_quality_issues(id uuid primary key,company_id uuid,status text,issue_type text,valid_source boolean);
    create view gridex_actionable_data_quality_issues_v as select * from data_quality_issues where status='open' and valid_source;
    create view company_dashboard_summary_v with(security_invoker=true) as
      select c.id company_id,c.name company_name,
      (select count(*) from external_contract_intakes x where x.company_id=c.id and x.status in ('needs_review','partially_created','failed')) pending_customer_applications,
      (select count(*) from data_quality_issues x where x.company_id=c.id and x.status='open' and x.issue_type='missing_metering_values') missing_metering_values
      from companies c;
    create function gridex_platform_dashboard_summary_v1() returns jsonb language sql stable security invoker
      as $$ select jsonb_build_object('pending_customer_applications',(select count(*) from external_contract_intakes where status in ('needs_review','partially_created','failed')),'missing_metering_values',(select count(*) from data_quality_issues where status='open' and issue_type='missing_metering_values'),'other_metric',7) $$;
    insert into companies values ('${companyA}','A'),('${companyB}','B');
  `)
  await db.exec(fs.readFileSync('supabase/migrations/20261013094648_canonical_admin_application_work_items.sql','utf8'))
}, 30_000)

afterAll(async () => { await db.close() })

it('uses canonical applications and hides their external mirrors without losing unlinked partial applications', async () => {
  await db.exec(`
    insert into website_customer_applications(id,company_id,status,idempotency_key) values
    ('10000000-0000-4000-8000-000000000001','${companyA}','partial',null),
    ('10000000-0000-4000-8000-000000000002','${companyA}','ready_for_switch','same-key'),
    ('10000000-0000-4000-8000-000000000003','${companyB}','completed','same-key');
    insert into external_contract_intakes(id,company_id,status,idempotency_key,payload) values
    ('20000000-0000-4000-8000-000000000001','${companyA}','failed','different-key','{"website_application_id":"10000000-0000-4000-8000-000000000002"}'),
    ('20000000-0000-4000-8000-000000000002','${companyA}','partially_created','fallback','{}');
  `)
  const {rows} = await db.query<{source_table:string;status:string;is_pending:boolean}>('select source_table,status,is_pending from gridex_website_application_work_items_v order by application_id')
  expect(rows).toHaveLength(4)
  expect(rows.filter(r=>r.is_pending)).toHaveLength(3)
  expect(rows.filter(r=>r.source_table==='external_contract_intakes')).toEqual([{source_table:'external_contract_intakes',status:'pending_review',is_pending:true}])
  const tenant = await db.query<{pending_customer_applications:number}>('select pending_customer_applications from company_dashboard_summary_v where company_id=$1',[companyA])
  expect(Number(tenant.rows[0].pending_customer_applications)).toBe(3)
  const platform = await db.query<{summary:{pending_customer_applications:number;other_metric:number}}>('select gridex_platform_dashboard_summary_v1() summary')
  expect(platform.rows[0].summary).toMatchObject({pending_customer_applications:3,other_metric:7})
})

it('does not merge separate API clients or different companies merely because idempotency keys match', async () => {
  await db.exec(`
    insert into website_customer_applications(id,company_id,api_client_id,status,idempotency_key) values
    ('10000000-0000-4000-8000-000000000004','${companyA}','30000000-0000-4000-8000-000000000001','pending_review','ambiguous'),
    ('10000000-0000-4000-8000-000000000005','${companyA}','30000000-0000-4000-8000-000000000002','pending_review','ambiguous');
    insert into external_contract_intakes(id,company_id,status,idempotency_key) values
    ('20000000-0000-4000-8000-000000000003','${companyA}','needs_review','ambiguous'),
    ('20000000-0000-4000-8000-000000000004','${companyB}','needs_review','fallback');
  `)
  const result=await db.query<{count:number}>('select count(*) from gridex_website_application_work_items_v')
  expect(Number(result.rows[0].count)).toBe(8)
})

it('counts only source-valid missing-meter issues without changing unrelated summary fields', async () => {
  await db.exec(`insert into data_quality_issues values
    ('40000000-0000-4000-8000-000000000001','${companyA}','open','missing_metering_values',false),
    ('40000000-0000-4000-8000-000000000002','${companyA}','open','missing_metering_values',true)`)
  const tenant=await db.query<{missing_metering_values:number}>('select missing_metering_values from company_dashboard_summary_v where company_id=$1',[companyA])
  expect(Number(tenant.rows[0].missing_metering_values)).toBe(1)
  const platform=await db.query<{summary:{missing_metering_values:number;other_metric:number}}>('select gridex_platform_dashboard_summary_v1() summary')
  expect(platform.rows[0].summary).toMatchObject({missing_metering_values:1,other_metric:7})
})

it('retains unknown application states for review and closes only known completed/cancelled states', async () => {
  await db.exec(`insert into website_customer_applications(id,company_id,status) values
    ('10000000-0000-4000-8000-000000000006','${companyA}','new_future_review_state'),
    ('10000000-0000-4000-8000-000000000007','${companyA}','cancelled')`)
  const {rows}=await db.query<{status:string;work_state:string;is_pending:boolean}>("select status,work_state,is_pending from gridex_website_application_work_items_v where status in ('new_future_review_state','cancelled') order by status")
  expect(rows).toEqual([
    {status:'cancelled',work_state:'closed',is_pending:false},
    {status:'new_future_review_state',work_state:'action_required',is_pending:true},
  ])
})

it('keeps tenant row-level security when applications are read through the shared view', async () => {
  await db.exec(`
    alter table website_customer_applications enable row level security;
    alter table external_contract_intakes enable row level security;
    create policy website_tenant on website_customer_applications to authenticated using(company_id=current_setting('gridex.test_company',true)::uuid);
    create policy external_tenant on external_contract_intakes to authenticated using(company_id=current_setting('gridex.test_company',true)::uuid);
    grant select on website_customer_applications,external_contract_intakes to authenticated;
    set role authenticated;
    select set_config('gridex.test_company','${companyB}',false);
  `)
  const {rows}=await db.query<{company_id:string}>('select company_id from gridex_website_application_work_items_v')
  expect(rows.length).toBeGreaterThan(0)
  expect(rows.every(r=>r.company_id===companyB)).toBe(true)
  await db.exec('reset role')
})

it('uses an explicit application ID before a conflicting fallback key', async () => {
  await db.exec(`
    insert into website_customer_applications(id,company_id,status,idempotency_key) values
    ('10000000-0000-4000-8000-000000000008','${companyA}','completed','explicit-owner'),
    ('10000000-0000-4000-8000-000000000009','${companyA}','pending_review','conflicting-key');
    insert into external_contract_intakes(id,company_id,status,idempotency_key,payload) values
    ('20000000-0000-4000-8000-000000000005','${companyA}','needs_review','conflicting-key','{"website_application_id":"10000000-0000-4000-8000-000000000008"}');
  `)
  const {rows}=await db.query<{application_id:string;linked_external_intake_id:string|null}>(`
    select application_id,linked_external_intake_id from gridex_website_application_work_items_v
    where application_id in ('10000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000009') order by application_id
  `)
  expect(rows).toEqual([
    {application_id:'10000000-0000-4000-8000-000000000008',linked_external_intake_id:'20000000-0000-4000-8000-000000000005'},
    {application_id:'10000000-0000-4000-8000-000000000009',linked_external_intake_id:null},
  ])
})

it('retains an external intake when its stronger intake ID has multiple canonical owners', async () => {
  await db.exec(`
    insert into website_customer_applications(id,company_id,status,idempotency_key,intake_id) values
    ('10000000-0000-4000-8000-000000000010','${companyA}','pending_review','intake-owner-a','50000000-0000-4000-8000-000000000001'),
    ('10000000-0000-4000-8000-000000000011','${companyA}','pending_review','intake-owner-b','50000000-0000-4000-8000-000000000001');
    insert into external_contract_intakes(id,company_id,status,idempotency_key,intake_id) values
    ('20000000-0000-4000-8000-000000000006','${companyA}','needs_review','intake-owner-a','50000000-0000-4000-8000-000000000001');
  `)
  const {rows}=await db.query<{application_id:string;source_table:string;linked_external_intake_id:string|null}>(`
    select application_id,source_table,linked_external_intake_id from gridex_website_application_work_items_v
    where application_id in ('10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000006') order by application_id
  `)
  expect(rows).toEqual([
    {application_id:'10000000-0000-4000-8000-000000000010',source_table:'website_customer_applications',linked_external_intake_id:null},
    {application_id:'10000000-0000-4000-8000-000000000011',source_table:'website_customer_applications',linked_external_intake_id:null},
    {application_id:'20000000-0000-4000-8000-000000000006',source_table:'external_contract_intakes',linked_external_intake_id:'20000000-0000-4000-8000-000000000006'},
  ])
})
