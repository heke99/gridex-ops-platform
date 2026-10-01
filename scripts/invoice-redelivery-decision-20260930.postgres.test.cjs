const {test}=require('node:test')
const assert=require('node:assert/strict')
const {createRedeliveryFixture}=require('./invoice-redelivery-decision-20260930-core.cjs')
test('T17 records a separate verified owner destination and preserves original financial/document rows',async()=>{
  const f=await createRedeliveryFixture()
  try{const before=await f.snapshot();const result=await f.decide()
    assert.equal(result.destinationEmail,'new@example.invalid');assert.equal(result.status,'verified_delivery_decision')
    assert.equal(result.deliveryStatus,'blocked_provider_adapter');assert.match(result.financialSnapshotSha256,/^[a-f0-9]{64}$/)
    assert.match(result.documentReferencesSha256,/^[a-f0-9]{64}$/);assert.deepEqual(await f.snapshot(),before)
    const replay=await f.decide();assert.equal(replay.decisionId,result.decisionId);assert.equal(replay.replayed,true)
    const repeats=await Promise.all([f.decide(),f.decide()]);assert.equal(repeats[0].decisionId,repeats[1].decisionId)
    assert.equal((await f.db.query('select count(*)::int as n from invoice_redelivery_decisions')).rows[0].n,1)
  }finally{await f.db.close()}
})
test('T17 unverified, wrong-resource, revoked and non-owner cases persist no decision or audit',async()=>{
  const cases=[
    ['unconfirmed Auth',f=>`update auth.users set email_confirmed_at=null where id='${f.id(4)}'`,{},'redelivery_destination_unverified'],
    ['wrong Auth email',f=>`update auth.users set email='contact-only@example.invalid' where id='${f.id(4)}'`,{},'redelivery_destination_mismatch'],
    ['viewer relationship',f=>`update customer_portal_accounts set role='viewer' where id='${f.id(10)}'`,{},'redelivery_destination_owner_required'],
    ['blocked owner',f=>`update customer_portal_accounts set is_active=false where id='${f.id(10)}'`,{},'redelivery_destination_owner_required'],
    ['foreign owner',f=>`update customer_portal_accounts set company_id='${f.id(2)}' where id='${f.id(10)}'`,{},'redelivery_destination_owner_required'],
    ['other customer owner',f=>`update customer_portal_accounts set customer_id='${f.id(99)}' where id='${f.id(10)}'`,{},'redelivery_destination_owner_required'],
    ['alias mismatch',f=>`update customer_portal_accounts set portal_user_id='${f.id(3)}' where id='${f.id(10)}'`,{},'redelivery_destination_owner_required'],
    ['revoked export',()=>`update user_permissions set is_active=false`,{},'redelivery_actor_forbidden'],
    ['revoked session',f=>`delete from auth.sessions where id='${f.id(5)}'`,{},'redelivery_actor_forbidden'],
    ['expired session',f=>`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${f.id(5)}'`,{},'redelivery_actor_forbidden'],
    ['unverified client field',()=>'',{verified:true},'invalid_redelivery_command'],
    ['stale profile',()=>'',{expectedRevision:1},'redelivery_revision_conflict'],
    ['stale override',()=>'',{expectedOverrideRevision:1},'redelivery_revision_conflict'],
    ['missing original document',()=>`delete from customer_invoice_documents`,{},'redelivery_document_references_unavailable'],
    ['missing document reference',()=>`update customer_invoice_documents set file_path=null`,{},'redelivery_document_references_unavailable'],
    ['missing accepted GUID',()=>`update invoice_export_items set provider_invoice_guid=null`,{},'redelivery_original_unavailable'],
    ['explicit null override',()=>`update customer_contracts set billing_profile_override='{"email":null}'`,{},'redelivery_email_destination_required'],
  ]
  const f=await createRedeliveryFixture()
  try{const before=await f.snapshot()
    for(const [label,mutation,changes,code] of cases){
      await f.db.exec('begin; reset role; '+mutation(f)+'; set role service_role;')
      await assert.rejects(()=>f.decide(changes),e=>e.message===code,label)
      await f.db.exec('rollback; set role service_role;')
      assert.deepEqual(await f.snapshot(),before,label)
      assert.equal((await f.db.query('select count(*)::int as n from invoice_redelivery_decisions')).rows[0].n,0,label)
      assert.equal((await f.db.query('select count(*)::int as n from domain_events')).rows[0].n,0,label)
    }
  }finally{await f.db.close()}
})
test('T17 replay requires current authority, unchanged consumed Auth proof and original document/financial hashes',async()=>{
  const f=await createRedeliveryFixture()
  try{await f.decide()
    for(const [mutation,changes,code] of [
      ['update user_permissions set is_active=false',{},'redelivery_actor_forbidden'],
      ['update customer_portal_accounts set role=\'billing\'',{},'redelivery_destination_owner_required'],
      ["update auth.users set email_confirmed_at=email_confirmed_at+interval '1 second' where email='new@example.invalid'",{},'redelivery_idempotency_conflict'],
      ["update customer_invoice_documents set metadata='{}'",{},'redelivery_idempotency_conflict'],
      ["update customer_invoices set amount_inc_vat=999",{},'redelivery_idempotency_conflict'],
      ['',{reason:'Changed intent with same key'},'redelivery_idempotency_conflict'],
      ['',{expectedRevision:1},'redelivery_revision_conflict'],
    ]){
      await f.db.exec('begin; reset role; '+mutation+'; set role service_role;')
      await assert.rejects(()=>f.decide(changes),e=>e.message===code)
      await f.db.exec('rollback; set role service_role;')
      assert.equal((await f.db.query('select count(*)::int as n from invoice_redelivery_decisions')).rows[0].n,1)
      assert.equal((await f.db.query('select count(*)::int as n from domain_events')).rows[0].n,1)
    }
  }finally{await f.db.close()}
})
test('T17 low privilege cannot execute the command, read the decision or bypass immutable decisions',async()=>{
  const f=await createRedeliveryFixture()
  try{await f.decide()
    const grants=await f.db.query("select has_function_privilege('authenticated','public.gridex_record_invoice_redelivery_decision_v1(jsonb)','execute') as command,has_function_privilege('anon','private.gridex_invoice_redelivery_auth_email_v1(uuid)','execute') as auth,has_table_privilege('authenticated','public.invoice_redelivery_decisions','select') as read")
    assert.deepEqual(grants.rows[0],{command:false,auth:false,read:false})
    await assert.rejects(()=>f.db.query(`insert into invoice_redelivery_decisions select (jsonb_populate_record(null::invoice_redelivery_decisions,
      to_jsonb(d)||jsonb_build_object('id',gen_random_uuid(),'idempotency_key','forged-direct-insert'))).* from invoice_redelivery_decisions d`),e=>e.message==='redelivery_command_required')
    await assert.rejects(()=>f.db.query('update invoice_redelivery_decisions set reason=$1',['changed']),e=>e.code==='42501')
    await f.db.exec('reset role;')
    await assert.rejects(()=>f.db.query('delete from invoice_redelivery_decisions'),e=>e.message==='redelivery_decision_immutable')
    await f.db.exec('set role authenticated;')
    await assert.rejects(()=>f.decide(),e=>e.code==='42501')
  }finally{await f.db.close()}
})
test('T17 explicit contract recipient is qualified independently of the changed customer default',async()=>{
  const f=await createRedeliveryFixture()
  try{await f.db.exec(`reset role; update customers set billing_profile='{"recipient":"Synthetic Customer","distributionMethod":"email","email":"unrelated-default@example.invalid"}';
    update customer_contracts set billing_profile_override='{"email":"new@example.invalid"}',billing_profile_override_revision=9; set role service_role;`)
    const before=await f.snapshot();const value=await f.decide({expectedOverrideRevision:9})
    assert.equal(value.destinationEmail,'new@example.invalid');assert.equal(value.contractOverrideRevision,9)
    assert.equal((await f.db.query('select email_source from invoice_redelivery_decisions')).rows[0].email_source,'contract_override')
    assert.deepEqual(await f.snapshot(),before)
  }finally{await f.db.close()}
})
test('T17 final live session clock and a late persistence fault roll back both decision and audit',async()=>{
  const f=await createRedeliveryFixture()
  try{
    await f.db.exec(`reset role; create temporary sequence redelivery_late_marker; grant usage,select on sequence redelivery_late_marker to service_role;
      create function pg_temp.delay_redelivery() returns trigger language plpgsql as $$
      begin perform nextval('pg_temp.redelivery_late_marker'); perform pg_sleep(0.15); return new; end $$;
      create trigger synthetic_redelivery_delay after insert on invoice_redelivery_decisions for each row execute function pg_temp.delay_redelivery();
      update auth.sessions set not_after=clock_timestamp()+interval '0.08 seconds'; set role service_role;`)
    await assert.rejects(()=>f.decide(),e=>e.message==='redelivery_actor_forbidden')
    assert.equal((await f.db.query('select is_called from pg_temp.redelivery_late_marker')).rows[0].is_called,true)
    assert.equal((await f.db.query('select count(*)::int as n from invoice_redelivery_decisions')).rows[0].n,0)
    assert.equal((await f.db.query('select count(*)::int as n from domain_events')).rows[0].n,0)
    await f.db.exec(`reset role; drop trigger synthetic_redelivery_delay on invoice_redelivery_decisions;
      update auth.sessions set not_after=null;
      create function pg_temp.fail_redelivery() returns trigger language plpgsql as $$
      begin raise exception 'synthetic_late_decision_failure' using errcode='XX000'; end $$;
      create trigger synthetic_redelivery_fault after insert on invoice_redelivery_decisions for each row execute function pg_temp.fail_redelivery(); set role service_role;`)
    await assert.rejects(()=>f.decide(),e=>e.message==='synthetic_late_decision_failure')
    assert.equal((await f.db.query('select count(*)::int as n from invoice_redelivery_decisions')).rows[0].n,0)
    assert.equal((await f.db.query('select count(*)::int as n from domain_events')).rows[0].n,0)
  }finally{await f.db.close()}
})
