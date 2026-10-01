/* eslint-disable @typescript-eslint/no-require-imports -- Isolated PostgreSQL business tests. */
const {test}=require('node:test')
const assert=require('node:assert/strict')
const {fixture}=require('./customer-portal-claim-attempt-evidence-20261001.core.cjs')

test('actual Action and writer use one canonical PostgreSQL batch, preserve historical facts and only record rejected attempts',async()=>{
  const f=await fixture()
  try{
    const before=await f.graph(),result=await f.run(),after=await f.graph()
    assert.equal(result.error,null);assert.equal(result.state.ok,false);assert.equal(f.writes.length,1);assert.equal(f.writes[0].count,2)
    assert.deepEqual(after.customer_portal_accounts,before.customer_portal_accounts);assert.deepEqual(after.customer_portal_events,before.customer_portal_events)
    for(const row of before.customer_portal_claims)assert.deepEqual(after.customer_portal_claims.find(r=>r.id===row.id),row)
    const attempts=after.customer_portal_claims.filter(row=>row.metadata.source==='native_self_claim_attempt_v1')
    assert.equal(attempts.length,2)
    for(const row of attempts){assert.equal(row.status,'rejected');assert.equal(row.claimed_at,null)
      assert.equal(row.metadata.personal_number_last4,'1234');assert.equal(f.project(row).name_matched,false)
      assert.equal(JSON.stringify(row).includes('199001011234'),false)}
  }finally{await f.db.close()}
})
test('actual late second-row SQL failure rolls back the complete attempted batch and clean retry saves both without changing originals',async()=>{
  const f=await fixture()
  try{
    const before=await f.graph()
    await f.db.exec(`create sequence claim_attempt_fault_witness;
      create function claim_attempt_late_fault() returns trigger language plpgsql as $$ begin
        if new.metadata->>'source'='native_self_claim_attempt_v1' then
          perform nextval('claim_attempt_fault_witness');
          if new.customer_id='${f.id(12)}' then raise exception 'synthetic_owned_late_claim_fault' using errcode='XX000';end if;
        end if;return new;end $$;
      create trigger claim_attempt_late_fault before insert on public.customer_portal_claims for each row execute function claim_attempt_late_fault();`)
    const denied=await f.run()
    assert.equal(denied.error?.code,'XX000');assert.equal(denied.error,f.errors[0],'same original database error is propagated')
    assert.equal((await f.db.query('select last_value::int value from claim_attempt_fault_witness')).rows[0].value,2,'both row boundaries really reached')
    assert.equal(f.writes.length,1);assert.equal(f.writes[0].count,2);assert.deepEqual(await f.graph(),before)
    await f.db.exec('drop trigger claim_attempt_late_fault on public.customer_portal_claims')
    const retried=await f.run(),after=await f.graph()
    assert.equal(retried.error,null);assert.equal(retried.state.ok,false);assert.equal(after.customer_portal_claims.length,before.customer_portal_claims.length+2)
    assert.deepEqual(after.customer_portal_accounts,before.customer_portal_accounts);assert.deepEqual(after.customer_portal_events,before.customer_portal_events)
    for(const row of before.customer_portal_claims)assert.deepEqual(after.customer_portal_claims.find(r=>r.id===row.id),row)
  }finally{await f.db.close()}
})
test('actual scoped no-candidate insert uses only the already-resolved company and no customer or account inference',async()=>{
  const f=await fixture()
  try{
    f.readRows.customers=[]
    const before=await f.graph(),result=await f.run({company_slug:'attempt-a'}),after=await f.graph()
    assert.equal(result.error,null);assert.equal(result.state.ok,false)
    const row=after.customer_portal_claims.find(row=>row.metadata.source==='native_self_claim_attempt_v1')
    assert.equal(row.company_id,f.id(1));assert.equal(row.customer_id,null);assert.equal(row.user_id,f.id(3))
    assert.equal(row.metadata.email_matched,false);assert.equal(f.project(row).email_matched,false)
    assert.deepEqual(after.customer_portal_accounts,before.customer_portal_accounts);assert.deepEqual(after.customer_portal_events,before.customer_portal_events)
  }finally{await f.db.close()}
})
