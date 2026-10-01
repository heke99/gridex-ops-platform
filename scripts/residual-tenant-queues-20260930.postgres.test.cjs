const assert=require('node:assert/strict')
const {test}=require('node:test')
const {createQueueCore}=require('./residual-tenant-queues-20260930-core.cjs')
const {readFileSync}=require('node:fs')
const {resolve}=require('node:path')
for(const queue of ['provider_event','tenant_email','approved_invoice_retry']){
  test(queue+' noisy backlog cannot starve a quiet tenant; persisted limit-one turns rotate independently',async()=>{
    const f=await createQueueCore()
    try{
      await f.seed(queue)
      const rows=await f.claim(queue)
      assert.equal(rows.filter(row=>row.company_id===f.tenantA).length,5)
      assert.equal(rows.filter(row=>row.company_id===f.tenantB).length,1)
      assert.equal(rows[1].company_id,f.tenantB)
      console.log(`RESIDUAL_QUEUE_CORE_SAMPLE queue=${queue} noisy=250 quiet=1 batch=20 noisy_claimed=5 quiet_claimed=1`)
    }finally{await f.db.close()}
    const rotation=await createQueueCore()
    try{
      await rotation.seed(queue)
      assert.equal((await rotation.claim(queue,1))[0].company_id,rotation.tenantA)
      assert.equal((await rotation.claim(queue,1))[0].company_id,rotation.tenantB)
    }finally{await rotation.db.close()}
  })
}
test('provider claim preserves age, requested tenant/status, fresh processing and stale-token recovery rules',async()=>{
  const f=await createQueueCore()
  try{
    await f.db.exec(`insert into public.invoice_provider_events(company_id,status,received_at,processing_started_at,attempt_count,failure_reason)
      values('${f.tenantA}','received',now()-interval '366 days',null,0,'old'),
        ('${f.tenantA}','processing',now(),now(),2,'fresh'),
        ('${f.tenantA}','processing',now(),now()-interval '16 minutes',2,'stale'),
        ('${f.tenantB}','received',now(),null,0,null),
        (null,'received',now(),null,0,null);`)
    const rows=await f.claim('provider_event',20,f.tenantA)
    assert.equal(rows.length,1);assert.equal(rows[0].attempt_count,3);assert.equal(rows[0].failure_reason,null)
    assert.equal(rows[0].processing_token,'ea650000-0000-4000-8000-000000000061')
  }finally{await f.db.close()}
})
test('email future and dead-letter rows stay ineligible and stale cleanup is bounded without automatic resend',async()=>{
  const f=await createQueueCore()
  try{
    await f.db.exec(`insert into public.tenant_email_outbox(company_id,status,locked_at,attempts)
      select '${f.tenantA}','processing',now()-interval '16 minutes',3 from generate_series(1,35);
      insert into public.tenant_email_outbox(company_id,next_attempt_at,dead_letter_at) values
        ('${f.tenantA}',now()+interval '1 hour',null),('${f.tenantA}',null,now()),('${f.tenantB}',null,null);`)
    const rows=await f.claim('tenant_email',1)
    assert.equal(rows.length,1);assert.equal(rows[0].company_id,f.tenantB);assert.equal(rows[0].status,'processing')
    const statuses=(await f.db.query("select status,attempts from public.tenant_email_outbox where status='delivery_uncertain'")).rows
    assert.deepEqual(statuses,[{status:'delivery_uncertain',attempts:3}])
    assert.equal((await f.db.query("select count(*)::int as count from public.tenant_email_outbox where status='processing' and company_id=$1",[f.tenantA])).rows[0].count,34)
  }finally{await f.db.close()}
})
test('approved retry lease is current and token-bound, approval filtering precedes limit, original financial row stays unchanged',async()=>{
  const f=await createQueueCore()
  try{
    await f.db.exec(`insert into public.invoice_export_items(company_id,next_retry_at) select '${f.tenantA}',now()-interval '3 hours' from generate_series(1,250);`)
    await f.seed('approved_invoice_retry',1,1)
    const before=(await f.snapshot())['public.invoice_export_items']
    const row=(await f.claim('approved_invoice_retry',1))[0]
    assert.equal(row.company_id,f.tenantA);assert.equal((await f.claim('approved_invoice_retry',1))[0].company_id,f.tenantB)
    assert.deepEqual((await f.snapshot())['public.invoice_export_items'],before)
    const release=async(company,token)=>(await f.db.query(`select public.gridex_release_approved_invoice_retry_v1($1::uuid,$2::uuid,$3::uuid) as released`,[company,row.id,token])).rows[0].released
    assert.equal(await release(f.tenantB,row.claim_token),false)
    assert.equal(await release(f.tenantA,'ea650000-0000-4000-8000-000000000099'),false)
    assert.equal(await release(f.tenantA,row.claim_token),true)
    assert.equal((await f.claim('approved_invoice_retry',1))[0].id,row.id)
  }finally{await f.db.close()}
})
test('all three low-role claims and late persisted-turn failures have zero row/lease/turn effects',async()=>{
  const f=await createQueueCore()
  try{
    for(const queue of Object.keys(f.tables))await f.seed(queue,1,1)
    const before=await f.snapshot()
    for(const role of ['anon','authenticated']){
      await f.db.exec('reset role;set role '+role)
      for(const queue of Object.keys(f.tables))await assert.rejects(f.claim(queue),error=>error.code==='42501')
    }
    await f.db.exec(`reset role;create function private.synthetic_turn_failure()returns trigger language plpgsql as $$begin raise exception 'synthetic_turn_failure';end;$$;
      create trigger synthetic_turn_failure before insert or update on private.partner_dispatch_tenant_turns for each row execute function private.synthetic_turn_failure();set role service_role;`)
    for(const queue of Object.keys(f.tables))await assert.rejects(f.claim(queue),error=>error.code==='P0001')
    assert.deepEqual(await f.snapshot(),before)
  }finally{await f.db.close()}
})
test('production lease UPSERT cannot overwrite a fresh competing lease selected by an earlier snapshot',async()=>{
  const f=await createQueueCore()
  try{
    await f.seed('approved_invoice_retry',1,0)
    await f.db.exec(`insert into private.approved_invoice_retry_leases(company_id,item_id,claim_token,claimed_at)
      select company_id,id,'ea650000-0000-4000-8000-000000000099',clock_timestamp() from public.invoice_export_items;`)
    // Exercise the exact production write fragment against the newer lease,
    // representing the already chosen row of a prior READ COMMITTED snapshot.
    // This is a current-row CAS proof, not a two-session native claim receipt.
    const source=readFileSync(resolve(__dirname,'../supabase/migrations/20260930225911_partner_email_invoice_retry_fair_claims.sql'),'utf8')
    const fragment=source.match(/v_lease:=\$fragment\$, leases as \(([\s\S]*?)\n    \)\$fragment\$/)?.[1]
    assert.ok(fragment)
    const write=fragment.replaceAll('$7',"'ea650000-0000-4000-8000-000000000061'::uuid").replaceAll('$4','clock_timestamp()')
    const rows=(await f.db.query(`with applied as(select * from public.invoice_export_items),leases as(${write}) select item_id from leases`)).rows
    assert.equal(rows.length,0)
    assert.equal((await f.db.query('select claim_token from private.approved_invoice_retry_leases')).rows[0].claim_token,'ea650000-0000-4000-8000-000000000099')
    assert.equal((await f.claim('approved_invoice_retry',1)).length,0)
    const fixedWrite=fragment.replaceAll('$7',"'ea650000-0000-4000-8000-000000000061'::uuid")
      .replaceAll('$4',"'2026-09-30T12:00:00Z'::timestamptz")
    const runFixed=async()=>(await f.db.query(`with applied as(select * from public.invoice_export_items),leases as(${fixedWrite}) select item_id from leases`)).rows
    await f.db.exec("update private.approved_invoice_retry_leases set claimed_at='2026-09-30T10:00:00Z'")
    assert.equal((await runFixed()).length,0)
    await f.db.exec("update private.approved_invoice_retry_leases set claimed_at='2026-09-30T09:59:59.999999Z'")
    assert.equal((await runFixed()).length,1)
    assert.equal((await f.db.query('select claim_token from private.approved_invoice_retry_leases')).rows[0].claim_token,'ea650000-0000-4000-8000-000000000061')
  }finally{await f.db.close()}
})
