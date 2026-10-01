const {PGlite}=require('@electric-sql/pglite')
const {readFileSync}=require('node:fs')
const {resolve}=require('node:path')
const tenantA='ea650000-0000-4000-8000-000000000001',tenantB='ea650000-0000-4000-8000-000000000002'
async function createQueueCore(){
  const db=new PGlite()
  await db.exec(`create role service_role bypassrls;create role anon;create role authenticated;create schema private;
    create table public.companies(id uuid primary key);
    create table public.invoice_provider_events(id uuid primary key default gen_random_uuid(),company_id uuid,
      status text default 'received',received_at timestamptz default now(),processing_token uuid,
      processing_started_at timestamptz,attempt_count integer default 0,failure_reason text);
    create table public.tenant_email_outbox(id uuid primary key default gen_random_uuid(),company_id uuid not null,
      status text default 'queued',created_at timestamptz default now(),updated_at timestamptz default now(),
      dead_letter_at timestamptz,next_attempt_at timestamptz,locked_at timestamptz,locked_by text,lock_token uuid,
      delivery_uncertain_at timestamptz,last_error text,failure_reason text,attempts integer default 0,max_attempts integer default 5);
    create table public.invoice_export_items(id uuid primary key default gen_random_uuid(),company_id uuid not null,
      status text default 'failed_retryable',next_retry_at timestamptz default now(),metadata jsonb default '{}',
      request_payload jsonb default '{"original":"immutable"}',amount_inc_vat numeric default 125,
      unique(company_id,id));
    insert into public.companies values('${tenantA}'),('${tenantB}');
    grant usage on schema public,private to service_role;grant all on all tables in schema public to service_role;`)
  await db.exec(readFileSync(resolve(__dirname,'../supabase/migrations/20260930225911_partner_email_invoice_retry_fair_claims.sql'),'utf8'))
  await db.exec('set role service_role')
  const tables={provider_event:'invoice_provider_events',tenant_email:'tenant_email_outbox',approved_invoice_retry:'invoice_export_items'}
  const due={provider_event:'received_at',tenant_email:'created_at',approved_invoice_retry:'next_retry_at'}
  async function seed(queue,noisy=250,quiet=1){
    const table=tables[queue],date=due[queue]
    await db.exec(`insert into public.${table}(company_id,${date}${queue==='approved_invoice_retry'?',metadata':''})
      select '${tenantA}',now()-interval '2 hours'${queue==='approved_invoice_retry'?`, '{"approval":{"status":"approved","approved_by":"synthetic-operator"}}'::jsonb`:''} from generate_series(1,${noisy});
      insert into public.${table}(company_id,${date}${queue==='approved_invoice_retry'?',metadata':''})
      select '${tenantB}',now()-interval '1 hour'${queue==='approved_invoice_retry'?`, '{"approval":{"status":"approved","approved_by":"synthetic-operator"}}'::jsonb`:''} from generate_series(1,${quiet});`)
  }
  async function claim(queue,limit=20,company=null,token='ea650000-0000-4000-8000-000000000061'){
    if(queue==='provider_event')return(await db.query(`select * from public.gridex_claim_invoice_provider_events($1::uuid,array['received'],$2,$3::uuid,365)`,[company,limit,token])).rows
    if(queue==='tenant_email')return(await db.query(`select * from public.gridex_claim_tenant_email_outbox_fair_v1($1::uuid,$2,$3::uuid)`,[company,limit,token])).rows
    return(await db.query(`select * from public.gridex_claim_approved_invoice_retries_fair_v1($1::uuid,$2,$3::uuid) as item`,[company,limit,token])).rows.map(row=>row.item)
  }
  const snapshot=async()=>Object.fromEntries(await Promise.all([...Object.values(tables).map(table=>'public.'+table),
    'private.partner_dispatch_tenant_turns','private.approved_invoice_retry_leases'].map(async table=>[table,(await db.query(`select to_jsonb(t) as row from ${table} t order by to_jsonb(t)::text`)).rows.map(row=>row.row)])))
  return {db,seed,claim,snapshot,tenantA,tenantB,tables,due}
}
module.exports={createQueueCore}
