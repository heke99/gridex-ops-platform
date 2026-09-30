const assert=require('node:assert/strict')
const {test}=require('node:test')
const {createBudgetCore}=require('./residual-tenant-budget-20260930-core.cjs')
test('one global tenant budget covers differing resource paths and clients while a quiet tenant remains independent',async()=>{
  const f=await createBudgetCore()
  try{
    const outcomes=[]
    for(let index=0;index<20;index++)outcomes.push(await f.request(f.clients[index%3],'/synthetic/invoices/'+index))
    assert.equal(outcomes.filter(row=>row.allowed).length,10)
    assert.equal(outcomes.filter(row=>!row.allowed).length,10)
    assert.equal((await f.request(f.clients[3])).allowed,true)
    const counters=(await f.db.query('select company_id,request_count from private.integration_api_tenant_budget_buckets order by company_id')).rows
    assert.deepEqual(counters,[{company_id:f.tenantA,request_count:20},{company_id:f.tenantB,request_count:1}])
    console.log('TENANT_GLOBAL_BUDGET_CORE_SAMPLE clients=3 resource_paths=20 allowed=10 denied=10 quiet_count=1')
  }finally{await f.db.close()}
})
test('explicit private ceiling narrows aggregate traffic while the original lower client-route allowance still applies',async()=>{
  const f=await createBudgetCore()
  try{
    await f.db.exec(`reset role;insert into private.integration_api_tenant_budget_policies values('${f.tenantA}',3600,4);set role service_role;`)
    const rows=[]
    for(let index=0;index<6;index++)rows.push(await f.request(f.clients[index%3],'/synthetic/'+index))
    assert.equal(rows.filter(row=>row.allowed).length,4)
    assert.equal(rows.at(-1).limit_value,4)
  }finally{await f.db.close()}
  const route=await createBudgetCore()
  try{
    assert.equal((await route.request(route.clients[0],'/synthetic/route',2)).allowed,true)
    assert.equal((await route.request(route.clients[0],'/synthetic/route',2)).allowed,true)
    const denied=await route.request(route.clients[0],'/synthetic/route',2)
    assert.equal(denied.allowed,false);assert.equal(denied.limit_value,2);assert.equal(denied.request_count,3)
  }finally{await route.db.close()}
})
test('revoked, expired, inactive-tenant and low-role requests cannot consume either budget',async()=>{
  const f=await createBudgetCore()
  try{
    const before=await f.snapshot()
    await f.db.exec(`update public.integration_api_clients set revoked_at=now() where id='${f.clients[0]}';
      update public.integration_api_clients set expires_at=now()-interval '1 second' where id='${f.clients[1]}';
      update public.companies set status='paused' where id='${f.tenantB}';`)
    for(const client of [f.clients[0],f.clients[1],f.clients[3]])await assert.rejects(f.request(client),error=>error.code==='42501')
    for(const role of ['anon','authenticated']){await f.db.exec('reset role;set role '+role);await assert.rejects(f.request(f.clients[2]),error=>error.code==='42501')}
    await f.db.exec('reset role;set role service_role');assert.deepEqual(await f.snapshot(),before)
  }finally{await f.db.close()}
})
test('a late client bucket write failure rolls back the already incremented tenant counter',async()=>{
  const f=await createBudgetCore()
  try{
    await f.db.exec(`reset role;create function private.synthetic_client_budget_failure()returns trigger language plpgsql as $$begin raise exception 'synthetic_client_budget_failure';end;$$;
      create trigger synthetic_client_budget_failure before insert on public.integration_api_rate_limit_buckets for each row execute function private.synthetic_client_budget_failure();set role service_role;`)
    const before=await f.snapshot();await assert.rejects(f.request(),error=>error.code==='P0001');assert.deepEqual(await f.snapshot(),before)
  }finally{await f.db.close()}
})
test('wall-clock expiry during a real SQL wait rolls both counter writes back',async()=>{
  const f=await createBudgetCore()
  try{
    await f.db.exec(`reset role;create function private.synthetic_client_budget_wait()returns trigger language plpgsql as $$begin perform pg_sleep(0.25);return new;end;$$;
      create trigger synthetic_client_budget_wait before insert on public.integration_api_rate_limit_buckets for each row execute function private.synthetic_client_budget_wait();
      update public.integration_api_clients set expires_at=clock_timestamp()+interval '0.15 seconds' where id='${f.clients[0]}';set role service_role;`)
    const before=await f.snapshot();await assert.rejects(f.request(),error=>error.code==='42501');assert.deepEqual(await f.snapshot(),before)
  }finally{await f.db.close()}
})
test('new bucket cleanup is bounded to100 rows for each ephemeral counter family',async()=>{
  const f=await createBudgetCore()
  try{
    await f.db.exec(`insert into public.integration_api_rate_limit_buckets(api_client_id,company_id,route,window_started_at,request_count)
      select '${f.clients[0]}','${f.tenantA}','/synthetic/old/'||n,now()-interval '3 hours',1 from generate_series(1,250)n;
      insert into private.integration_api_tenant_budget_buckets(company_id,window_seconds,window_started_at,request_count)
      select '${f.tenantA}',3600,now()-interval '3 hours'-make_interval(secs=>n),1 from generate_series(1,250)n;`)
    assert.equal((await f.request()).allowed,true)
    const rows=await f.db.query(`select
      (select count(*)::int from public.integration_api_rate_limit_buckets where window_started_at<now()-interval '2 hours') as client_old,
      (select count(*)::int from private.integration_api_tenant_budget_buckets where window_started_at<now()-interval '2 hours') as tenant_old`)
    assert.deepEqual(rows.rows,[{client_old:150,tenant_old:150}])
  }finally{await f.db.close()}
})
