const {PGlite}=require('@electric-sql/pglite')
const {readFileSync}=require('node:fs')
const {resolve}=require('node:path')
const tenantA='ea660000-0000-4000-8000-000000000001',tenantB='ea660000-0000-4000-8000-000000000002'
const clients=['ea660000-0000-4000-8000-000000000011','ea660000-0000-4000-8000-000000000012',
  'ea660000-0000-4000-8000-000000000013','ea660000-0000-4000-8000-000000000014']
async function createBudgetCore(){
  const db=new PGlite()
  await db.exec(`create role service_role bypassrls;create role anon;create role authenticated;create schema private;
    create table public.companies(id uuid primary key,status text default 'active',is_active boolean default true);
    create table public.integration_api_clients(id uuid primary key,company_id uuid,status text default 'active',
      rate_limit_per_minute integer default 10,deleted_at timestamptz,revoked_at timestamptz,expires_at timestamptz);
    create table public.integration_api_rate_limit_buckets(api_client_id uuid,company_id uuid,route text,
      window_started_at timestamptz,request_count integer default 0,updated_at timestamptz,
      primary key(api_client_id,route,window_started_at));
    insert into public.companies(id) values('${tenantA}'),('${tenantB}');
    insert into public.integration_api_clients(id,company_id) values('${clients[0]}','${tenantA}'),
      ('${clients[1]}','${tenantA}'),('${clients[2]}','${tenantA}'),('${clients[3]}','${tenantB}');
    grant usage on schema public,private to service_role;grant all on all tables in schema public to service_role;`)
  await db.exec(readFileSync(resolve(__dirname,'../supabase/migrations/20260930225914_integration_api_aggregate_tenant_budget.sql'),'utf8'))
  await db.exec('set role service_role')
  const request=async(client=clients[0],route='/synthetic/resource',limit=10,window=3600)=>(await db.query(
    'select * from public.integration_api_rate_limit_check($1::uuid,$2,$3,$4)',[client,route,limit,window])).rows[0]
  const snapshot=async()=>Object.fromEntries(await Promise.all(['public.integration_api_rate_limit_buckets','private.integration_api_tenant_budget_buckets']
    .map(async table=>[table,(await db.query(`select to_jsonb(t) as row from ${table} t order by to_jsonb(t)::text`)).rows.map(row=>row.row)])))
  return {db,request,snapshot,tenantA,tenantB,clients}
}
module.exports={createBudgetCore}
