const assert=require('node:assert/strict')
const {test}=require('node:test')
const {createScannerCore,sha}=require('./support-attachment-scan-20260930-core.cjs')
test('a committed private attachment gains an exact one-use scan receipt but remains blocked for provider qualification',async()=>{
  const f=await createScannerCore()
  try{
    const challenge=await f.reserve()
    assert.equal(challenge.companyId,f.id(1));assert.equal(challenge.attachmentId,f.id(30))
    assert.equal(challenge.objectVersion,'synthetic-object-v1')
    const first=await f.record(challenge)
    assert.equal(first.verdict,'clean');assert.equal(first.replayed,false);assert.equal(first.releaseAllowed,false)
    const completed=await f.snapshot()
    assert.equal((await f.record(challenge)).replayed,true)
    assert.deepEqual(await f.snapshot(),completed)
    const decision=await f.assess()
    assert.equal(decision.outcome,'blocked_provider_qualification');assert.equal(decision.releaseAllowed,false)
    assert.equal(completed['public.customer_support_attachments'][0].scan_status,'quarantined')
  }finally{await f.db.close()}
})
test('wrong owner, exact intake lineage, storage witness, signed binding or physical hash cannot consume a nonce',async()=>{
  const f=await createScannerCore()
  try{
    const ch=await f.reserve(),before=await f.snapshot()
    for(const patch of [{requestHash:'b'.repeat(64)},{nonceHash:sha(f.id(99))},{physicalSha256:'b'.repeat(64)},
      {physicalByteSize:24},{bindingJson:JSON.stringify({...ch,customerId:f.id(10)})}])
      await assert.rejects(f.record(ch,f.proof(ch,patch)),error=>error.code==='23505')
    await assert.rejects(f.db.query('select public.gridex_reserve_support_attachment_scan_v1($1::uuid,$2::uuid,$3::jsonb)',
      [f.id(2),f.id(30),JSON.stringify(f.trust)]),error=>error.code==='P0002')
    assert.deepEqual(await f.snapshot(),before)
    await f.db.exec(`update storage.objects set version='synthetic-v2' where id='${f.id(31)}'`)
    await assert.rejects(f.record(ch),error=>error.code==='23505')
    assert.deepEqual(await f.snapshot(),before)
  }finally{await f.db.close()}
})
test('changed verdict replay, revoked scanner root and expired signed proof do not create a second effect',async()=>{
  const f=await createScannerCore()
  try{
    const ch=await f.reserve();await f.record(ch);const committed=await f.snapshot()
    await assert.rejects(f.record(ch,f.proof(ch,{verdict:'malicious'})),error=>error.code==='23505')
    await assert.rejects(f.record(ch,f.proof(ch,{expiresAt:ch.issuedAt})),error=>error.code==='42501')
    await f.db.exec(`reset role;update private.support_attachment_scanner_roots set status='revoked';set role service_role;`)
    await assert.rejects(f.record(ch),error=>error.code==='42501')
    await assert.rejects(f.assess(),error=>error.code==='42501')
    assert.deepEqual(await f.snapshot(),committed)
  }finally{await f.db.close()}
})
test('malicious and unknown evidence never permits release and clean text alone is not a receipt',async()=>{
  for(const verdict of ['malicious','unknown']){
    const f=await createScannerCore()
    try{
      assert.equal((await f.assess()).outcome,'blocked_unscanned')
      const ch=await f.reserve();await f.record(ch,f.proof(ch,{verdict}))
      assert.equal((await f.assess()).outcome,'blocked_scan_verdict')
      assert.equal((await f.assess()).releaseAllowed,false)
      assert.equal((await f.snapshot())['public.customer_support_attachments'][0].scan_status,'quarantined')
    }finally{await f.db.close()}
  }
})
test('current protected-read grant, owner and session remain required after a clean receipt',async()=>{
  const f=await createScannerCore()
  try{
    const ch=await f.reserve();await f.record(ch);const committed=await f.snapshot()
    const witness={objectId:ch.objectId,objectVersion:ch.objectVersion,objectUpdatedAt:ch.objectUpdatedAt,sha256:ch.sha256,byteSize:ch.byteSize}
    assert.equal((await f.assess(witness)).physicalHashVerified,true)
    await assert.rejects(f.assess({...witness,objectVersion:'forged'}),error=>error.code==='23503')
    await assert.rejects(f.assess(witness,{...f.context,customerId:f.id(10)}),error=>error.code==='P0002')
    await f.db.exec(`update public.user_permissions set is_active=false where id='${f.id(22)}'`)
    await assert.rejects(f.assess(),error=>error.code==='42501')
    await f.db.exec(`update public.user_permissions set is_active=true where id='${f.id(22)}';reset role;
      update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${f.id(4)}';set role service_role;`)
    await assert.rejects(f.assess(),error=>error.code==='42501')
    assert.deepEqual(await f.snapshot(),committed)
  }finally{await f.db.close()}
})
test('low roles cannot reserve, record or assess; late nonce consumption failure rolls the receipt insert back',async()=>{
  const f=await createScannerCore()
  try{
    const ch=await f.reserve(),before=await f.snapshot()
    for(const role of ['anon','authenticated']){
      await f.db.exec('reset role;set role '+role)
      await assert.rejects(f.reserve(),error=>error.code==='42501')
      await assert.rejects(f.record(ch),error=>error.code==='42501')
      await assert.rejects(f.assess(),error=>error.code==='42501')
    }
    await f.db.exec(`reset role;create function private.synthetic_scan_consume_fault()returns trigger language plpgsql as $$
      begin raise exception 'synthetic_scan_consume_fault';end;$$;
      create trigger synthetic_scan_consume_fault before update on private.support_attachment_scan_challenges
        for each row execute function private.synthetic_scan_consume_fault();set role service_role;`)
    await assert.rejects(f.record(ch),error=>error.code==='P0001')
    assert.deepEqual(await f.snapshot(),before)
  }finally{await f.db.close()}
})
test('scanner root expiry during a real late SQL wait rolls nonce creation back',async()=>{
  const f=await createScannerCore()
  try{
    await f.db.exec(`reset role;create function private.synthetic_scan_root_wait()returns trigger language plpgsql as $$
      begin perform pg_sleep(0.3);return new;end;$$;
      create trigger synthetic_scan_root_wait before insert on private.support_attachment_scan_challenges
        for each row execute function private.synthetic_scan_root_wait();
      update private.support_attachment_scanner_roots set valid_until=clock_timestamp()+interval '0.2 seconds';set role service_role;`)
    const before=await f.snapshot()
    await assert.rejects(f.reserve(),error=>error.code==='42501')
    assert.deepEqual(await f.snapshot(),before)
  }finally{await f.db.close()}
})
test('the exact committed intake actor/channel attribution cannot be replaced in an otherwise owner-matching attachment',async()=>{
  const f=await createScannerCore()
  try{
    await f.db.exec(`reset role;insert into auth.users(id)values('${f.id(99)}');set role service_role;
      update public.customer_support_attachments set actor_user_id='${f.id(99)}' where id='${f.id(30)}';`)
    const before=await f.snapshot()
    await assert.rejects(f.reserve(),error=>error.code==='23503')
    assert.deepEqual(await f.snapshot(),before)
  }finally{await f.db.close()}
})
