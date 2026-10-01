const {test} = require('node:test')
const assert = require('node:assert/strict')
const {createSensitiveContactFixture} = require('./support-sensitive-contact-20260930-core.cjs')

test('T31 consumes one sensitive proof with actual guarded contact mutation and rejects the identical replay', async () => {
  const f = await createSensitiveContactFixture()
  try {
    const input = f.bind()
    const result = await f.execute(input)
    assert.equal(result.contactRevision,1)
    assert.equal(result.caseRevision,2)
    const after = await f.snapshot()
    assert.equal(after.customers.find(row=>row.id===f.command.customerId).phone,'+4600999')
    assert.equal(after.customers.find(row=>row.id===f.command.customerId).email,'old@example.invalid')
    assert.equal(after.canonical_command_results.length,1)
    assert.equal(after.canonical_event_outbox.length,1)
    assert.equal((await f.db.query('select count(*)::int n from private.gridex_support_sensitive_consumptions')).rows[0].n,1)
    await assert.rejects(f.execute(input), error=>error.message==='support_sensitive_proof_replayed')
    assert.deepEqual(await f.snapshot(),after)
  } finally { await f.db.close() }
})

for (const [name,change,proofChange,expected] of [
  ['expired proof',{}, {issuedAt:Math.floor(Date.now()/1000)-100,expiresAt:Math.floor(Date.now()/1000)-1}, 'support_sensitive_proof_invalid'],
  ['wrong exact action',{}, {action:'customer.billing.change'}, 'support_sensitive_proof_invalid'],
  ['wrong payload hash',{}, {requestHash:'f'.repeat(64)}, 'support_sensitive_proof_invalid'],
  ['wrong same-company customer',{customerId:'ed310000-0000-4000-8000-000000000010'}, {}, 'support_resource_unavailable'],
  ['stale case revision',{expectedCaseRevision:0}, {}, 'support_revision_conflict'],
  ['stale contact revision',{expectedContactRevision:2}, {}, 'contact_revision_conflict'],
]) test('denies '+name+' without a spent nonce or partial mutation', async () => {
  const f = await createSensitiveContactFixture()
  try {
    const before = await f.snapshot()
    await assert.rejects(f.execute(f.bind(change,proofChange)), error=>error.message===expected)
    assert.deepEqual(await f.snapshot(),before)
    assert.equal((await f.db.query('select count(*)::int n from private.gridex_support_sensitive_consumptions')).rows[0].n,0)
  } finally { await f.db.close() }
})

test('rechecks both current support and independent contact permission before consuming a proof', async () => {
  const f = await createSensitiveContactFixture()
  try {
    await f.db.exec(`delete from user_permissions where permission_id='${f.id(6)}';`)
    const before = await f.snapshot()
    await assert.rejects(f.execute(f.bind()), error=>error.message==='profile_actor_forbidden')
    assert.deepEqual(await f.snapshot(),before)
    assert.equal((await f.db.query('select count(*)::int n from private.gridex_support_sensitive_consumptions')).rows[0].n,0)
  } finally { await f.db.close() }
})

test('a late audit failure rolls back the actual contact engine and nonce, allowing a corrected attempt', async () => {
  const f = await createSensitiveContactFixture()
  try {
    await f.db.exec(`reset role; create function public.sensitive_test_audit_failure() returns trigger language plpgsql as $$
      begin if new.event_type='SUPPORT_SENSITIVE_CONTACT_COMMAND' then raise exception 'injected_sensitive_audit_failure'; end if; return new; end $$;
      create trigger sensitive_test_audit_failure before insert on canonical_audit_events for each row execute function sensitive_test_audit_failure(); set role service_role;`)
    const input = f.bind(), before = await f.snapshot()
    await assert.rejects(f.execute(input), error=>error.message==='injected_sensitive_audit_failure')
    assert.deepEqual(await f.snapshot(),before)
    assert.equal((await f.db.query('select count(*)::int n from private.gridex_support_sensitive_consumptions')).rows[0].n,0)
    await f.db.exec('reset role; drop trigger sensitive_test_audit_failure on canonical_audit_events; set role service_role;')
    assert.equal((await f.execute(input)).contactRevision,1)
  } finally { await f.db.close() }
})

test('database wall-clock expiry during an actual audit write rolls back effect and spent nonce', async () => {
  const f = await createSensitiveContactFixture()
  try {
    await f.db.exec(`reset role; create function public.sensitive_test_clock_wait() returns trigger language plpgsql as $$
      begin if new.event_type='CUSTOMER_CONTACT_COMMAND' then perform pg_sleep(2.2); end if; return new; end $$;
      create trigger sensitive_test_clock_wait before insert on canonical_audit_events for each row execute function sensitive_test_clock_wait(); set role service_role;`)
    const input = f.bind({}, {expiresAt:Math.floor(Date.now()/1000)+2}), before = await f.snapshot()
    await assert.rejects(f.execute(input), error=>error.message==='support_sensitive_proof_invalid')
    assert.deepEqual(await f.snapshot(),before)
    assert.equal((await f.db.query('select count(*)::int n from private.gridex_support_sensitive_consumptions')).rows[0].n,0)
  } finally { await f.db.close() }
})

test('service role cannot rewrite or delete spent proofs; low roles cannot invoke or read the ledger', async () => {
  const f = await createSensitiveContactFixture()
  try {
    await f.execute(f.bind())
    await assert.rejects(f.db.exec('delete from private.gridex_support_sensitive_consumptions'), error=>error.code==='42501')
    await assert.rejects(f.db.exec('update private.gridex_support_sensitive_consumptions set expires_at=now()'), error=>error.code==='42501')
    for (const role of ['anon','authenticated']) {
      await f.db.exec('reset role; set role '+role)
      await assert.rejects(f.execute(f.bind()), error=>error.code==='42501')
      await assert.rejects(f.db.exec('select * from private.gridex_support_sensitive_consumptions'), error=>error.code==='42501')
    }
  } finally { await f.db.close() }
})

test('a fresh proof cannot use the same logical command key for a different payload', async () => {
  const f = await createSensitiveContactFixture()
  try {
    await f.execute(f.bind())
    const after = await f.snapshot()
    const changed = f.bind({expectedCaseRevision:2,expectedContactRevision:1,changes:{phone:'+4600123'}},{nonceHash:'e'.repeat(64)})
    await assert.rejects(f.execute(changed),error=>error.message==='contact_idempotency_conflict')
    assert.deepEqual(await f.snapshot(),after)
    assert.equal((await f.db.query('select count(*)::int n from private.gridex_support_sensitive_consumptions')).rows[0].n,1)
  } finally { await f.db.close() }
})

test('a fresh nonce cannot replay an already completed contact command or append another support event', async () => {
  const f = await createSensitiveContactFixture()
  try {
    await f.db.exec(`insert into customer_contacts(id,company_id,customer_id,type,is_primary,email,phone)
      values('${f.id(12)}','${f.command.companyId}','${f.command.customerId}','primary',true,'old@example.invalid','+4600000')`)
    await f.execute(f.bind())
    const after = await f.snapshot()
    await assert.rejects(f.execute(f.bind({expectedCaseRevision:2},{nonceHash:'e'.repeat(64)})),
      error=>error.message==='support_sensitive_command_already_completed')
    assert.deepEqual(await f.snapshot(),after)
    assert.equal((await f.db.query('select count(*)::int n from private.gridex_support_sensitive_consumptions')).rows[0].n,1)
  } finally { await f.db.close() }
})

test('a fresh proof and fresh command key can record a verified no-change contact without another contact outbox effect', async () => {
  const f = await createSensitiveContactFixture()
  try {
    await f.execute(f.bind())
    const result = await f.execute(f.bind({expectedCaseRevision:2,expectedContactRevision:1,idempotencyKey:'sensitive-contact-native-0002'},
      {nonceHash:'e'.repeat(64)}))
    assert.equal(result.changed,false);assert.equal(result.replayed,false)
    assert.equal(result.caseRevision,3);assert.equal(result.contactRevision,1)
    const after=await f.snapshot()
    assert.equal(after.canonical_event_outbox.length,1)
    assert.equal(after.customer_case_events.length,2)
    assert.equal((await f.db.query('select count(*)::int n from private.gridex_support_sensitive_consumptions')).rows[0].n,2)
  } finally { await f.db.close() }
})

for (const [name,setup,expected] of [
  ['deleted real staff session',f=>`reset role; delete from auth.sessions where id='${f.id(4)}'; set role service_role;`,'support_actor_forbidden'],
  ['current support permission revoked',f=>`delete from user_permissions where permission_id='${f.id(5)}';`,'support_actor_forbidden'],
  ['closed case',f=>`update customer_cases set status='closed' where id='${f.id(11)}';`,'support_case_closed'],
]) test('denies '+name+' at the database boundary without consumption',async()=>{
  const f=await createSensitiveContactFixture()
  try {
    await f.db.exec(setup(f));const before=await f.snapshot()
    await assert.rejects(f.execute(f.bind()),error=>error.message===expected)
    assert.deepEqual(await f.snapshot(),before)
    assert.equal((await f.db.query('select count(*)::int n from private.gridex_support_sensitive_consumptions')).rows[0].n,0)
  }finally{await f.db.close()}
})
