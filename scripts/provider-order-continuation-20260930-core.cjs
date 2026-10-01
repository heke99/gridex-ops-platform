// In-memory PostgreSQL-core fixture only. Native history is a separate proof.
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { PGlite } = require('@electric-sql/pglite')
const companyA='ea630000-0000-4000-8000-000000000001',companyB='ea630000-0000-4000-8000-000000000002'
const customerA='ea630000-0000-4000-8000-000000000011',customerB='ea630000-0000-4000-8000-000000000012'
const contractA='ea630000-0000-4000-8000-000000000021',contractB='ea630000-0000-4000-8000-000000000022'
const itemA='ea630000-0000-4000-8000-000000000031',itemB='ea630000-0000-4000-8000-000000000032'
const invoiceA='ea630000-0000-4000-8000-000000000041',invoiceB='ea630000-0000-4000-8000-000000000042'
const older='ea630000-0000-4000-8000-000000000051',newer='ea630000-0000-4000-8000-000000000052',quiet='ea630000-0000-4000-8000-000000000053'
const token='ea630000-0000-4000-8000-000000000061'
const payload={amount_inc_vat:125,currency:'SEK',paid_at:'2026-09-30T10:00:00Z'}
async function createCoreFixture() {
  const db=new PGlite()
  await db.exec(`create role service_role bypassrls; create role anon; create role authenticated;
    create schema private; create schema auth; create table auth.users(id uuid primary key);
    create table public.companies(id uuid primary key,status text default 'active');
    create table public.customers(id uuid primary key,company_id uuid,metadata jsonb default '{}');
    create table public.invoice_export_items(id uuid primary key,company_id uuid,customer_id uuid,
      customer_contract_id uuid,contract_id uuid,billing_underlay_id uuid,provider text,environment text,
      provider_invoice_guid text,provider_invoice_number text,provider_ocr text,provider_status text,status text,
      amount_ex_vat numeric,vat_amount numeric,amount_inc_vat numeric,total_kwh numeric,currency text,
      period_start date,period_end date,purchase_status text,status_payload jsonb default '{}',metadata jsonb default '{}',
      last_reconciled_at timestamptz,reconciliation_status text,updated_at timestamptz default now(),
      request_payload jsonb default '{"immutable":"original"}');
    create table public.customer_invoices(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,
      customer_contract_id uuid,contract_id uuid,billing_underlay_id uuid,partner_export_id uuid,
      invoice_export_item_id uuid,canonical_export_item_id uuid,partner_invoice_reference text,invoice_number text,
      period_start date,period_end date,total_kwh numeric,amount_ex_vat numeric,vat_amount numeric,amount_inc_vat numeric,
      status text,paid_at timestamptz,source_system text,raw_payload jsonb default '{"create_invoice":{"guid":"original"},"purchase":{"evidence":"retained"}}',updated_at timestamptz default now(),
      calculation_snapshot jsonb default '{"immutable":"calculation"}',calculation_snapshot_sha256 text default 'synthetic-original-hash',
      unique(company_id,invoice_export_item_id));
    create table public.invoice_provider_events(id uuid primary key,company_id uuid,matched_invoice_export_item_id uuid,
      provider text,environment text,provider_invoice_guid text,event_type text,payload jsonb,status text,
      received_at timestamptz default now(),processed_at timestamptz,processing_token uuid,
      processing_started_at timestamptz,failure_reason text,attempt_count integer default 0);`)
  const website=readFileSync(resolve(__dirname,'../supabase/migrations/20260609162000_batch_7_website_integration_foundation.sql'),'utf8')
  for(const table of ['domain_events','event_outbox']) {
    const sql=website.match(new RegExp('create table if not exists public\\.'+table+' \\([\\s\\S]*?\\n\\);'))?.[0]
    if(!sql) throw new Error('core_fixture_source_missing:'+table)
    await db.exec(sql)
  }
  await db.exec(`create unique index on public.domain_events(idempotency_key) where idempotency_key is not null;
    create unique index on public.event_outbox(domain_event_id,destination_type,destination_key) where destination_key is not null;
    insert into public.companies(id) values('${companyA}'),('${companyB}');
    insert into public.customers(id,company_id,metadata) values('${customerA}','${companyA}','{"profile":"unchanged"}'),
      ('${customerB}','${companyB}','{"profile":"unchanged"}');
    insert into public.invoice_export_items(id,company_id,customer_id,customer_contract_id,contract_id,provider,environment,
      provider_invoice_guid,provider_invoice_number,provider_status,status,amount_ex_vat,vat_amount,amount_inc_vat,
      total_kwh,currency,period_start,period_end,metadata) values
      ('${itemA}','${companyA}','${customerA}','${contractA}','${contractA}','capway_aptic','test','synthetic-invoice-a','SYNTHETIC-A','unpaid','sent',100,25,125,1,'SEK','2026-09-01','2026-10-01','{"billing_month":"2026-09"}'),
      ('${itemB}','${companyB}','${customerB}','${contractB}','${contractB}','capway_aptic','test','synthetic-invoice-b','SYNTHETIC-B','unpaid','sent',100,25,125,1,'SEK','2026-09-01','2026-10-01','{"billing_month":"2026-09"}');
    insert into public.customer_invoices(id,company_id,customer_id,customer_contract_id,contract_id,invoice_export_item_id,
      status,amount_ex_vat,vat_amount,amount_inc_vat,total_kwh) values
      ('${invoiceA}','${companyA}','${customerA}','${contractA}','${contractA}','${itemA}','sent',100,25,125,1),
      ('${invoiceB}','${companyB}','${customerB}','${contractB}','${contractB}','${itemB}','sent',100,25,125,1);`)
  for(const [id,company,item,guid,type,age] of [[older,companyA,itemA,'synthetic-invoice-a','invoice.overdue',3],
    [newer,companyA,itemA,'synthetic-invoice-a','invoice.paid',2],[quiet,companyB,itemB,'synthetic-invoice-b','invoice.paid',1]]) {
    await db.query(`insert into public.invoice_provider_events(id,company_id,matched_invoice_export_item_id,provider,environment,
      provider_invoice_guid,event_type,payload,status,received_at,processing_token,processing_started_at)
      values($1,$2,$3,'capway_aptic','test',$4,$5,$6::jsonb,'processing',now()-make_interval(secs=>$7),$8,now())`,
      [id,company,item,guid,type,JSON.stringify(payload),age,token])
  }
  await db.exec(readFileSync(resolve(__dirname,'../supabase/migrations/20260930215935_invoice_provider_event_atomic_application.sql'),'utf8'))
  await db.exec('grant usage on schema public,private to service_role; grant all on all tables in schema public to service_role; set role service_role;')
  const apply=(id,state,company=companyA,claimToken=token,eventPayload=payload,type=state==='overdue'?'invoice.overdue':'invoice.paid')=>
    db.query('select public.gridex_apply_invoice_provider_event_v1($1::uuid,$2::uuid,$3::uuid,$4,$5::jsonb,$6,null,$7::numeric,$8) as result',
      [company,id,claimToken,type,JSON.stringify(eventPayload),state,eventPayload.amount_inc_vat ?? null,eventPayload.currency ?? null]).then(result=>result.rows[0].result)
  const rows=table=>db.query('select to_jsonb(t) as value from public.'+table+' t order by id').then(result=>result.rows.map(row=>row.value))
  const snapshot=async()=>Object.fromEntries(await Promise.all(['invoice_export_items','customer_invoices','invoice_provider_events','domain_events','event_outbox','customers']
    .map(async table=>[table,await rows(table)])))
  return {db,apply,rows,snapshot,companyA,companyB,customerA,customerB,itemA,itemB,invoiceA,invoiceB,older,newer,quiet,token,payload}
}
module.exports={createCoreFixture}
