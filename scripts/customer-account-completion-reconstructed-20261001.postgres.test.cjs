/* eslint-disable @typescript-eslint/no-require-imports -- Standalone PostgreSQL business tests. */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const {fixture} = require('./customer-account-completion-reconstructed-20261001.core.cjs')

test('published canonical mismatch is characterized without claiming it corrected the old bytes', async()=>{
  const f=await fixture({baseline:true})
  try {
    const result=await f.run()
    assert.equal(result.error?.code,'42703','the actual old claim writer requests absent canonical columns')
    assert.equal(await f.count('customer_portal_accounts'),process.env.ACCOUNT_COMPLETION_BASELINE_RED==='1'?0:1,'the reproduced old partial account remains characterized')
  } finally {await f.db.close()}
})

test('new native account keeps the existing null external alias and mounted evidence fields',async()=>{
  const f=await fixture({draftPreservation:process.env.ACCOUNT_COMPLETION_DRAFT_RED==='1'})
  try {
    await f.run();const g=await f.graph();const a=g.customer_portal_accounts[0]
    assert.equal(a.portal_user_id,null)
    assert.equal(a.verified_identity_snapshot.inputName,'Synthetic Customer')
    assert.equal(a.verified_identity_snapshot.inputInstallationId,'735999000000001')
    assert.equal(a.verified_identity_snapshot.personalNumberLast4,'1234')
  }finally{await f.db.close()}
})
test('the existing mounted verification evidence shape is preserved on a new account',async()=>{
  const f=await fixture({draftPreservation:process.env.ACCOUNT_COMPLETION_DRAFT_RED==='1'})
  try{
    await f.run();const evidence=(await f.graph()).customer_portal_accounts[0].verified_identity_snapshot
    assert.equal(evidence.inputName,'Synthetic Customer');assert.equal(evidence.inputInstallationId,'735999000000001')
    assert.equal(evidence.personalNumberLast4,'1234');assert.equal(evidence.userEmail,'account@example.invalid')
  }finally{await f.db.close()}
})
test('an archived customer cannot gain a newly completed account',async()=>{
  const f=await fixture()
  try {
    await f.admin(`update public.customers set status='archived',archived_at=clock_timestamp() where id='${f.id(2)}'`)
    await f.run();assert.equal(await f.count('customer_portal_accounts'),0)
  }finally{await f.db.close()}
})
test('an archived selected site cannot gain a newly completed account',async()=>{
  const f=await fixture()
  try {
    await f.admin(`update public.customer_sites set archived_at=clock_timestamp() where id='${f.id(5)}'`)
    await f.run();assert.equal(await f.count('customer_portal_accounts'),0)
  }finally{await f.db.close()}
})

test('a late receipt hook changing the canonical event must roll back the entire completion', async () => {
  const f=await fixture()
  try {
    await f.db.exec(`reset role; create function private.synthetic_completion_late_hook() returns trigger language plpgsql as $$
      begin update public.customer_portal_events set payload='{"changed":true}' where id=new.event_id; return new; end $$;
      create trigger synthetic_completion_late_hook before insert on private.customer_portal_account_completion_receipts
      for each row execute function private.synthetic_completion_late_hook(); set role service_role;`)
    await f.run()
    assert.equal(await f.count('customer_portal_accounts'),0,'an altered event must not receive a completed account receipt')
  } finally { await f.db.close() }
})
for(const [table,change] of [['customer_portal_claims',"new.status:='rejected'"],['customer_portal_events',"new.event_type:='other'"],['customer_portal_accounts',"new.role:='billing'"]])
test('actual before-insert '+table+' rewrite cannot certify a different intended completion',async()=>{
  const f=await fixture()
  try{
    await f.admin(`create function private.synthetic_completion_wrong_fact() returns trigger language plpgsql as $$ begin ${change}; return new; end $$;
      create trigger synthetic_completion_wrong_fact before insert on public.${table} for each row execute function private.synthetic_completion_wrong_fact();`)
    await f.run();for(const rows of Object.values(await f.graph()))assert.equal(rows.length,0)
  }finally{await f.db.close()}
})
for(const [table,change]of [['customer_portal_claims',"new.metadata:='{}'"],['customer_portal_accounts',"new.verified_identity_snapshot:='{}'"],['customer_portal_events',"new.payload:='{}'"]])
test('created '+table+' evidence must equal the actual server-derived intended facts',async()=>{
  const f=await fixture()
  try{
    await f.admin(`create function private.synthetic_completion_wrong_evidence() returns trigger language plpgsql as $$ begin ${change}; return new; end $$;
      create trigger synthetic_completion_wrong_evidence before insert on public.${table} for each row execute function private.synthetic_completion_wrong_evidence();`)
    await f.run();for(const rows of Object.values(await f.graph()))assert.equal(rows.length,0)
  }finally{await f.db.close()}
})

for(const table of ['customer_portal_claims','customer_portal_events']) test('actual '+table+' failure rolls back every new completion row and can retry',async()=>{
  const f=await fixture()
  try{
    const before=await f.graph(),quiet=await f.quiet()
    await f.admin(`create function private.synthetic_completion_failure() returns trigger language plpgsql as $$ begin raise exception 'owned_late_business_fault' using errcode='P0001'; end $$;
      create trigger synthetic_completion_failure before insert on public.${table} for each row execute function private.synthetic_completion_failure();`)
    const denied=await f.run();assert.equal(denied.state.ok,false);assert.deepEqual(await f.graph(),before)
    assert.equal(await f.quiet(),quiet)
    await f.admin(`drop trigger synthetic_completion_failure on public.${table}`)
    const saved=await f.run();assert.match(saved.error.digest,/NEXT_REDIRECT/)
    const g=await f.graph();for(const rows of Object.values(g)) assert.equal(rows.length,1)
    assert.equal(g.customer_portal_claims[0].status,'approved')
    assert.equal(g.customer_portal_claims[0].metadata.schemaVersion,1)
    assert.equal(g.customer_portal_claims[0].metadata.personal_number_last4,'1234')
    assert.equal(JSON.stringify(g).includes('199001011234'),false,'completion graph has no full personal number')
    assert.equal(await f.quiet(),quiet)
  }finally{await f.db.close()}
})
test('a different independently current session reuses the same sealed effect and original creating-session provenance',async()=>{
  const f=await fixture()
  try{
    await f.run();const before=await f.graph(),command=structuredClone(f.commands[0])
    await f.admin(`insert into auth.sessions(id,user_id,not_after) values('${f.id(7)}','${f.id(3)}',clock_timestamp()+interval '1 day')`)
    f.actor.session=f.id(7);const replay=await f.run();assert.match(replay.error.digest,/NEXT_REDIRECT/)
    assert.deepEqual(await f.graph(),before);assert.equal(before.receipts[0].creating_session_id,f.id(4))
    command.sessionId=f.id(7);const result=await f.execute(command);assert.equal(result.status,'replayed')
    await f.admin(`update public.customer_portal_accounts set role='viewer' where id='${result.accountId}'`)
    const currentRole=await f.execute(command);assert.equal(currentRole.role,'viewer');assert.equal(currentRole.status,'replayed')
    assert.equal((await f.graph()).receipts.length,1)
  }finally{await f.db.close()}
})
for(const role of ['billing','viewer'])test('pre-existing '+role+' native relation is byte-preserved without retroactive approval',async()=>{
  const f=await fixture()
  try{
    await f.admin(`insert into public.customer_portal_accounts(id,company_id,customer_id,user_id,portal_user_id,role,status,is_active,metadata,verified_identity_snapshot)
      values('${f.id(6)}','${f.id(1)}','${f.id(2)}','${f.id(3)}','${f.id(8)}','${role}','active',true,'{"saved":true}','{"original":true}')`)
    const before=await f.graph();await f.run();assert.deepEqual(await f.graph(),before)
    const result=await f.execute(f.commands[0]);assert.equal(result.status,'existing');assert.equal(result.role,role);assert.equal(result.receiptId,null)
  }finally{await f.db.close()}
})
for(const kind of ['disabled','inactive','portal-only','ambiguous'])test('existing '+kind+' aliases hold completion without rewriting or creating an owner',async()=>{
  const f=await fixture()
  try{
    await f.admin(`insert into public.customer_portal_accounts(id,company_id,customer_id,user_id,portal_user_id,role,status,is_active)
      values('${f.id(6)}','${f.id(1)}','${f.id(2)}',${kind==='portal-only'?'null':"'"+f.id(3)+"'"},${kind==='ambiguous'?'null':"'"+f.id(3)+"'"},'viewer','${kind==='disabled'?'disabled':'active'}',${kind==='disabled'||kind==='inactive'?'false':'true'});
      ${kind==='ambiguous'?`insert into public.customer_portal_accounts(id,company_id,customer_id,user_id,portal_user_id,role,status,is_active) values('${f.id(9)}','${f.id(1)}','${f.id(2)}','${f.id(8)}','${f.id(3)}','billing','active',true);`:''}`)
    const before=await f.graph();const result=await f.run();assert.equal(result.state.ok,false);assert.equal(f.errors.at(-1),'PT409');assert.deepEqual(await f.graph(),before)
  }finally{await f.db.close()}
})
for(const table of ['customer_portal_accounts','customer_portal_claims','customer_portal_events'])test('deleted '+table+' graph cannot replay or recreate a retained completion',async()=>{
  const f=await fixture()
  try{
    await f.run();const command=f.commands[0];await f.admin(`delete from public.${table} where company_id='${f.id(1)}'`)
    const before=await f.graph();await assert.rejects(f.execute(command),e=>e.code==='PT409');assert.deepEqual(await f.graph(),before)
  }finally{await f.db.close()}
})
test('changed stable body or source revision conflicts without consuming a new effect',async()=>{
  const f=await fixture()
  try{
    await f.run();const before=await f.graph(),body=structuredClone(f.commands[0]);body.input.firstName='Synthetic'
    await assert.rejects(f.execute(body),e=>e.code==='PT409')
    await f.admin(`update public.customers set profile_revision=profile_revision+1 where id='${f.id(2)}'`)
    await assert.rejects(f.execute(f.commands[0]),e=>e.code==='PT409');assert.deepEqual(await f.graph(),before)
  }finally{await f.db.close()}
})
test('a second full matching point hidden by the outer limit(1) denies authoritative completion',async()=>{
  const f=await fixture()
  try{
    await f.admin(`insert into public.companies(id,slug) values('${f.id(30)}','other-completion');
      insert into public.customers(id,company_id,full_name,personal_number,email,customer_number) values('${f.id(20)}','${f.id(30)}','Synthetic Customer','199001011234','account@example.invalid','SYN-COMP-2');
      insert into public.customer_sites(id,company_id,customer_id,facility_id) values('${f.id(21)}','${f.id(30)}','${f.id(20)}','735999000000099');
      insert into public.metering_points(id,company_id,customer_id,site_id,meter_point_id) values('${f.id(22)}','${f.id(1)}','${f.id(2)}','${f.id(5)}','735999000000001'),('${f.id(23)}','${f.id(30)}','${f.id(20)}','${f.id(21)}','735999000000001');`)
    const before=await f.graph();const denied=await f.run({company_slug:''});assert.equal(denied.state.ok,false);assert.equal(f.errors.at(-1),'PT409');assert.deepEqual(await f.graph(),before)
  }finally{await f.db.close()}
})
test('conflicting non-null point site aliases cannot complete a link',async()=>{
  const f=await fixture()
  try{
    await f.admin(`update public.customer_sites set facility_id='735999000000099' where id='${f.id(5)}';
      insert into public.customer_sites(id,company_id,customer_id,facility_id) values('${f.id(25)}','${f.id(1)}','${f.id(2)}','735999000000088');
      insert into public.metering_points(id,company_id,customer_id,site_id,customer_site_id,meter_point_id) values('${f.id(24)}','${f.id(1)}','${f.id(2)}','${f.id(5)}','${f.id(25)}','735999000000001');`)
    await f.run();assert.equal(f.errors.at(-1),'PT409');assert.equal(await f.count('customer_portal_accounts'),0)
  }finally{await f.db.close()}
})
test('confirmed-email/session clock is rechecked after a real late receipt wait',async()=>{
  const f=await fixture()
  try{
    await f.admin(`create sequence private.synthetic_completion_wait; grant usage,select on sequence private.synthetic_completion_wait to service_role;
      create function private.synthetic_completion_wait() returns trigger language plpgsql as $$ begin perform nextval('private.synthetic_completion_wait'); perform pg_sleep(1.3); return new; end $$;
      create trigger synthetic_completion_wait before insert on private.customer_portal_account_completion_receipts for each row execute function private.synthetic_completion_wait();
      update auth.sessions set not_after=clock_timestamp()+interval '1 second' where id='${f.id(4)}'`)
    await f.run();const waited=(await f.db.query('select is_called from private.synthetic_completion_wait')).rows[0].is_called
    assert.equal(waited,true,'the receipt-stage wait was actually reached');assert.equal(f.errors.at(-1),'42501')
    for(const rows of Object.values(await f.graph()))assert.equal(rows.length,0)
  }finally{await f.db.close()}
})
