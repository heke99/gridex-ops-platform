const assert=require('node:assert/strict')
const {test}=require('node:test')
const {createConsumerCore}=require('./support-attachment-consumer-20261001-core.cjs')
test('the real committed scan intent is claimed even after the legacy generic bridge processed it',async()=>{
  const f=await createConsumerCore();try{
    const rows=await f.claim()
    assert.equal(rows.length,1)
    assert.equal(rows[0].attachmentId,f.id(30));assert.equal(rows[0].scanIntentId,f.id(33))
    assert.equal(rows[0].claimToken,f.id(90))
    assert.equal((await f.db.query('select status from canonical_event_outbox')).rows[0].status,'processed')
  }finally{await f.db.close()}
})
test('a current actor obtains a short-lived owner-bound read nonce and still receives no release',async()=>{
  const f=await createConsumerCore();try{
    const prepared=await f.prepare()
    assert.equal(prepared.binding.attachmentId,f.id(30));assert.equal(prepared.expiresAt-prepared.issuedAt,60)
    assert.deepEqual(await f.finish(prepared.nonceId),{releaseAllowed:false,outcome:'blocked_scanner_qualification',physicalHashVerified:false})
    await assert.rejects(f.finish(prepared.nonceId),e=>e.code==='42501')
  }finally{await f.db.close()}
})
test('exact authoritative callback commits receipt and current-token completion once; late final job fault rolls both back',async()=>{
  const f=await createConsumerCore();try{
    const [claim]=await f.claim(),challenge=await f.reserve()
    await f.db.query('select public.gridex_bind_support_attachment_scan_claim_v1($1,$2,$3)',[claim.scanIntentId,claim.claimToken,challenge.nonceId])
    const commit=(token=claim.claimToken)=>f.db.query('select public.gridex_commit_support_attachment_scan_callback_v1($1,$2,$3::jsonb) as result',
      [challenge.nonceId,token,JSON.stringify(f.proof(challenge))]).then(r=>r.rows[0].result)
    await f.db.exec(`reset role;create function private.consumer_late_fault()returns trigger language plpgsql as $$
      begin if new.status='evidence_recorded' then raise exception 'synthetic_final_scan_completion_fault';end if;return new;end;$$;
      create trigger consumer_late_fault before update on private.support_attachment_scan_jobs for each row execute function private.consumer_late_fault();set role service_role;`)
    const before=await f.consumerSnapshot();await assert.rejects(commit(),e=>e.message==='synthetic_final_scan_completion_fault')
    assert.deepEqual(await f.consumerSnapshot(),before)
    assert.equal((await f.db.query('select status from private.support_attachment_scan_jobs')).rows[0].status,'processing')
    await f.db.exec('reset role;drop trigger consumer_late_fault on private.support_attachment_scan_jobs;set role service_role')
    assert.equal((await commit()).replayed,false)
    assert.equal((await commit(null)).replayed,true)
    assert.equal((await f.db.query('select count(*)::int as n from private.support_attachment_scan_receipts')).rows[0].n,1)
    assert.equal((await f.db.query('select status from private.support_attachment_scan_jobs')).rows[0].status,'evidence_recorded')
  }finally{await f.db.close()}
})
test('current scanner root expiry during the final completion wait rolls receipt, nonce consumption and job completion back',async()=>{
  const f=await createConsumerCore();try{
    const [claim]=await f.claim(),challenge=await f.reserve()
    await f.db.query('select public.gridex_bind_support_attachment_scan_claim_v1($1,$2,$3)',[claim.scanIntentId,claim.claimToken,challenge.nonceId])
    await f.db.exec(`reset role;create function private.consumer_late_root_wait()returns trigger language plpgsql as $$
      begin if new.status='evidence_recorded' then perform pg_sleep(0.3);end if;return new;end;$$;
      create trigger consumer_late_root_wait before update on private.support_attachment_scan_jobs for each row execute function private.consumer_late_root_wait();
      update private.support_attachment_scanner_roots set valid_until=clock_timestamp()+interval '0.2 seconds';set role service_role;`)
    const before=await f.consumerSnapshot()
    await assert.rejects(f.db.query('select public.gridex_commit_support_attachment_scan_callback_v1($1,$2,$3::jsonb)',
      [challenge.nonceId,claim.claimToken,JSON.stringify(f.proof(challenge))]),e=>e.code==='42501')
    assert.deepEqual(await f.consumerSnapshot(),before)
    assert.equal((await f.db.query('select status from private.support_attachment_scan_jobs')).rows[0].status,'processing')
  }finally{await f.db.close()}
})
test('250 noisy intents cannot omit a quiet tenant and persisted limit-one turns rotate',async()=>{
  for(const limit of [20,1]){
    const f=await createConsumerCore();try{
      await f.seedIntents(f.id(1),f.id(9),f.id(11),249)
      await f.seedIntents(f.id(2),f.id(1000),f.id(1001),1)
      const rows=await f.claim(limit)
      if(limit===20){assert.equal(rows.filter(row=>row.companyId===f.id(1)).length,5);assert.equal(rows.filter(row=>row.companyId===f.id(2)).length,1)}
      else{assert.equal(rows[0].companyId,f.id(1));assert.equal((await f.claim(1,null,f.id(91)))[0].companyId,f.id(2))}
    }finally{await f.db.close()}
  }
})
test('low roles, malformed limits, stale tokens, missing receipt and changed original intent cannot claim or complete authority',async()=>{
  const f=await createConsumerCore();try{
    const before=await f.consumerSnapshot()
    for(const role of ['anon','authenticated']){
      await f.db.exec('reset role;set role '+role)
      await assert.rejects(f.claim(),e=>e.code==='42501');await assert.rejects(f.prepare(),e=>e.code==='42501')
      await assert.rejects(f.db.query('select public.gridex_get_support_attachment_scan_callback_v1($1)',[f.id(90)]),e=>e.code==='42501')
    }
    await f.db.exec('reset role;set role service_role')
    await assert.rejects(f.claim(21),e=>e.code==='22023');assert.deepEqual(await f.consumerSnapshot(),before)
    const [claim]=await f.claim(),claimed=await f.consumerSnapshot()
    await assert.rejects(f.db.query('select public.gridex_finish_support_attachment_scan_claim_v1($1,$2,$3)',
      [claim.scanIntentId,f.id(99),'blocked_scanner_qualification']),e=>e.code==='42501')
    await assert.rejects(f.db.query('select public.gridex_finish_support_attachment_scan_claim_v1($1,$2,$3)',
      [claim.scanIntentId,claim.claimToken,'evidence_recorded']),e=>e.code==='42501')
    assert.deepEqual(await f.consumerSnapshot(),claimed)
    await f.db.exec("update canonical_event_outbox set payload=payload||'{\"visibility\":\"customer\"}'")
    const changed=await f.consumerSnapshot()
    await assert.rejects(f.db.query('select public.gridex_finish_support_attachment_scan_claim_v1($1,$2,$3)',
      [claim.scanIntentId,claim.claimToken,'blocked_scanner_qualification']),e=>e.code==='23503')
    assert.deepEqual(await f.consumerSnapshot(),changed)
  }finally{await f.db.close()}
})
test('protected nonce cannot change actor/owner/object, bypass expiry or survive current session revocation',async()=>{
  const f=await createConsumerCore();try{
    const prepared=await f.prepare(),before=await f.consumerSnapshot()
    await assert.rejects(f.finish(prepared.nonceId,null,{...f.context,customerId:f.id(10)}),e=>e.code==='42501')
    const witness={objectId:prepared.binding.objectId,objectVersion:prepared.binding.objectVersion,objectUpdatedAt:prepared.binding.objectUpdatedAt,
      sha256:prepared.binding.sha256,byteSize:prepared.binding.byteSize}
    await assert.rejects(f.finish(prepared.nonceId,{...witness,sha256:'b'.repeat(64)}),e=>e.code==='23503')
    assert.deepEqual(await f.consumerSnapshot(),before)
    await f.db.exec(`insert into private.support_attachment_read_nonces(nonce_id,company_id,attachment_id,actor_context,binding,issued_at,expires_at)
      select '${f.id(98)}',company_id,attachment_id,actor_context,binding,floor(extract(epoch from clock_timestamp()))::bigint-2,
        floor(extract(epoch from clock_timestamp()))::bigint-1 from private.support_attachment_read_nonces where nonce_id='${prepared.nonceId}'`)
    const expired=await f.consumerSnapshot();await assert.rejects(f.finish(f.id(98),witness),e=>e.code==='42501')
    assert.deepEqual(await f.consumerSnapshot(),expired)
    await f.db.exec(`reset role;update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${f.id(4)}';set role service_role`)
    await assert.rejects(f.finish(prepared.nonceId,witness),e=>e.code==='42501')
    assert.deepEqual(await f.consumerSnapshot(),expired)
  }finally{await f.db.close()}
})
test('protected-read actor budget survives current session rotation and the finite tenant ceiling is shared',async()=>{
  const f=await createConsumerCore();try{
    for(let i=0;i<20;i++)await f.prepare()
    const before=await f.consumerSnapshot()
    await f.db.exec(`reset role;insert into auth.sessions values('${f.id(99)}','${f.id(3)}',null);set role service_role`)
    await assert.rejects(f.prepare({...f.context,sessionId:f.id(99)}),e=>e.code==='54000')
    assert.deepEqual(await f.consumerSnapshot(),before)
  }finally{await f.db.close()}
  const g=await createConsumerCore();try{
    const first=await g.prepare()
    await g.db.exec(`insert into private.support_attachment_read_nonces(company_id,attachment_id,actor_context,binding,issued_at,expires_at)
      select company_id,attachment_id,'{}'::jsonb,binding,issued_at,expires_at from private.support_attachment_read_nonces,
        generate_series(1,999) where nonce_id='${first.nonceId}'`)
    const before=await g.consumerSnapshot();await assert.rejects(g.prepare(),e=>e.code==='54000')
    assert.deepEqual(await g.consumerSnapshot(),before)
  }finally{await g.db.close()}
})
test('portal owner authority does not inherit OPS access to an internal attachment',async()=>{
  const f=await createConsumerCore();try{
    await f.db.exec(`reset role;insert into customer_portal_accounts(id,company_id,customer_id,user_id,portal_user_id,role,status,is_active)
      values('${f.id(97)}','${f.id(1)}','${f.id(9)}','${f.id(3)}','${f.id(3)}','owner','active',true);set role service_role`)
    const before=await f.consumerSnapshot()
    await assert.rejects(f.prepare({...f.context,mode:'portal'}),e=>e.code==='P0002')
    assert.deepEqual(await f.consumerSnapshot(),before)
  }finally{await f.db.close()}
})
