// Focused actual PostgreSQL function proof; no hosted/native/provider claim.
const assert=require('node:assert/strict')
const {test}=require('node:test')
const {readFileSync,readdirSync}=require('node:fs')
const {resolve}=require('node:path')
const {PGlite}=require('@electric-sql/pglite')
const {createQueueCore}=require('./residual-tenant-queues-20260930-core.cjs')
const migrations=resolve(__dirname,'../supabase/migrations')
const tenantA='ea640000-0000-4000-8000-000000000001',tenantB='ea640000-0000-4000-8000-000000000002'
function current(name){
  const pattern=new RegExp('create (?:or replace )?function public\\.'+name+'\\([\\s\\S]*?as (\\$[A-Za-z_]*\\$)[\\s\\S]*?\\1;','i')
  const candidates=readdirSync(migrations).filter(name=>/^\d{14}_.+\.sql$/.test(name)).sort()
    .map(filename=>({filename,sql:readFileSync(resolve(migrations,filename),'utf8').match(pattern)?.[0]})).filter(row=>row.sql)
  assert.ok(candidates.length);return candidates.at(-1)
}
test('actual provider event claim serves a later quiet tenant within a bounded batch',async()=>{
  if(current('gridex_claim_invoice_provider_events').filename==='20260930225911_partner_email_invoice_retry_fair_claims.sql'){
    const f=await createQueueCore()
    try{await f.seed('provider_event');const rows=await f.claim('provider_event');assert.ok(rows.some(row=>row.company_id===f.tenantB))}
    finally{await f.db.close()}
    return
  }
  const db=new PGlite()
  try{
    await db.exec(`create role service_role bypassrls;create role anon;create role authenticated;create schema private;
      create table public.companies(id uuid primary key);
      create table public.invoice_provider_events(id uuid primary key default gen_random_uuid(),company_id uuid,
        status text default 'received',received_at timestamptz default now(),processing_token uuid,
        processing_started_at timestamptz,attempt_count integer default 0,failure_reason text);
      insert into public.companies values('${tenantA}'),('${tenantB}');
      grant usage on schema public,private to service_role;grant all on all tables in schema public to service_role;`)
    const selected=current('gridex_claim_invoice_provider_events')
    await db.exec(selected.sql)
    await db.exec(`insert into public.invoice_provider_events(company_id,received_at)
      select '${tenantA}',now()-interval '2 hours' from generate_series(1,250);
      insert into public.invoice_provider_events(company_id,received_at) values('${tenantB}',now()-interval '1 hour');
      set role service_role;`)
    const rows=(await db.query(`select company_id from public.gridex_claim_invoice_provider_events(null,array['received'],20,gen_random_uuid(),365)`)).rows
    console.log(`PROVIDER_QUEUE_CORE_SAMPLE function=${selected.filename} noisy_due=250 quiet_due=1 total=${rows.length} quiet=${rows.filter(row=>row.company_id===tenantB).length}`)
    assert.ok(rows.some(row=>row.company_id===tenantB),'one older tenant must not fill the whole provider-event batch')
  }finally{await db.close()}
})
test('multiple active API clients of one tenant share an aggregate finite request budget',async()=>{
  const db=new PGlite()
  try{
    await db.exec(`create role service_role bypassrls;create role anon;create role authenticated;create schema private;
      create table public.companies(id uuid primary key,status text default 'active',is_active boolean default true);
      create table public.integration_api_clients(id uuid primary key,company_id uuid,status text,rate_limit_per_minute integer,
        deleted_at timestamptz,revoked_at timestamptz,expires_at timestamptz);
      create table public.integration_api_rate_limit_buckets(api_client_id uuid,company_id uuid,route text,
        window_started_at timestamptz,request_count integer default 0,updated_at timestamptz,
        primary key(api_client_id,route,window_started_at));
      insert into public.companies(id) values('${tenantA}'),('${tenantB}');
      insert into public.integration_api_clients(id,company_id,status,rate_limit_per_minute) values
        ('ea640000-0000-4000-8000-000000000011','${tenantA}','active',10),
        ('ea640000-0000-4000-8000-000000000012','${tenantA}','active',10),
        ('ea640000-0000-4000-8000-000000000013','${tenantA}','active',10),
        ('ea640000-0000-4000-8000-000000000014','${tenantB}','active',10);`)
    const selected=current('integration_api_rate_limit_check')
    await db.exec(selected.filename==='20260930225914_integration_api_aggregate_tenant_budget.sql'
      ?readFileSync(resolve(migrations,selected.filename),'utf8'):selected.sql)
    const outcomes=[]
    for(const client of ['011','012','013'])for(let index=0;index<6;index++)outcomes.push((await db.query(
      `select * from public.integration_api_rate_limit_check('ea640000-0000-4000-8000-000000000${client}','/synthetic/resource',10,3600)`)).rows[0])
    const quiet=(await db.query(`select * from public.integration_api_rate_limit_check('ea640000-0000-4000-8000-000000000014','/synthetic/resource',10,3600)`)).rows[0]
    console.log(`TENANT_BUDGET_CORE_SAMPLE same_tenant_clients=3 attempted=18 allowed=${outcomes.filter(row=>row.allowed).length} other_tenant_first_allowed=${quiet.allowed}`)
    assert.equal(quiet.allowed,true)
    assert.ok(outcomes.filter(row=>row.allowed).length<=10,'creating more clients must not multiply a tenant configured request budget')
  }finally{await db.close()}
})
