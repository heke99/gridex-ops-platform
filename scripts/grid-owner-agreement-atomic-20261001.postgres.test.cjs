const assert = require('node:assert/strict')
const { test } = require('node:test')
const { fixture } = require('./grid-owner-agreement-atomic-20261001-core.cjs')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { runInNewContext } = require('node:vm')
const ts = require('../node_modules/typescript')

test('actual PostgreSQL save provisions the missing implemented feature and replays one atomic result', async () => {
  const f = await fixture()
  try {
    const first = await f.execute()
    assert.equal(first.agreement.company_id, f.id(1)); assert.equal(first.agreement.revision, 1)
    const before = await f.snapshot()
    const replay = await f.execute()
    assert.equal(replay.agreement.id, first.agreement.id); assert.equal(replay.replayed, true)
    assert.deepEqual(await f.snapshot(), before)
  } finally { await f.db.close() }
})

test('tenant-bound platform name and revoked live session deny before optional grid-owner creation', async () => {
  const f = await fixture()
  try {
    const before = await f.snapshot()
    const payload = {...f.command.payload,gridOwnerId:null,newGridOwner:{name:'Must never be created'}}
    await assert.rejects(f.execute({actorUserId:f.id(5),sessionId:f.id(6),payload}), error => error.code === '42501')
    await f.root(`delete from auth.sessions where id='${f.id(4)}'`)
    await assert.rejects(f.execute({payload}), error => error.code === '42501')
    assert.deepEqual(await f.snapshot(), before)
  } finally { await f.db.close() }
})

test('global company-null agreements retain global owner and resolver fields', async () => {
  const f = await fixture()
  try {
    const result = await f.execute({companyId:null,payload:{...f.command.payload,gridOwnerId:null,newGridOwner:{name:'Global owner'},preferredApplicationReference:'23-DGI-PRODAT'}})
    assert.equal(result.agreement.company_id, null)
    assert.equal(result.agreement.preferred_application_reference, '23-DGI-PRODAT')
    const rows = await f.root(`select company_id from grid_owners where id='${result.agreement.grid_owner_id}'`)
    assert.equal(rows.rows[0].company_id, null)
  } finally { await f.db.close() }
})

test('the forward preserves every old compatible row byte/value except the explicit new revision column',async()=>{
  const f=await fixture({legacy:true})
  try{
    const after=(await f.root("select to_jsonb(t)-'revision' as value from grid_owner_access_agreements t where id='"+f.id(17)+"'")).rows[0].value
    assert.deepEqual(after,f.historical)
    assert.equal((await f.root("select revision from grid_owner_access_agreements where id='"+f.id(17)+"'")).rows[0].revision,0)
    await assert.rejects(fixture({legacy:true,incompatible:true}),/agreement_schema_incompatible/)
  }finally{await f.db.close()}
})

test('the forward rejects incompatible primary key, nullability, forced RLS and revision shape',async()=>{
  for(const option of ['missingPrimaryKey','nullableMetadata','forcedRls','incompatibleRevision']) {
    await assert.rejects(fixture({legacy:true,[option]:true}),/agreement_schema_incompatible/)
  }
})

test('current expiry, profile and global role revocation deny fresh and replayed writes', async () => {
  for (const change of [
    f => "update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='"+f.id(4)+"'",
    f => "update user_profiles set user_status='disabled' where id='"+f.id(3)+"'",
    f => "update admin_users set is_active=false where user_id='"+f.id(3)+"'",
    f => "update auth.users set email_confirmed_at=null where id='"+f.id(3)+"'",
  ]) {
    const f = await fixture()
    try {
      await f.execute()
      const before = await f.snapshot()
      await f.root(change(f))
      await assert.rejects(f.execute(), error => error.code === '42501')
      await assert.rejects(f.execute({idempotencyKey:'fresh-authority-denial-0001'}), error => error.code === '42501')
      assert.deepEqual(await f.snapshot(), before)
    } finally { await f.db.close() }
  }
})

test('a second actual live session can replay only the same actor and exact command', async () => {
  const f = await fixture()
  try {
    await f.root("insert into auth.sessions(id,user_id) values('"+f.id(13)+"','"+f.id(3)+"')")
    const first = await f.execute()
    const before = await f.snapshot()
    const second = await f.execute({sessionId:f.id(13)})
    assert.equal(second.agreement.id, first.agreement.id); assert.equal(second.replayed, true)
    assert.deepEqual(await f.snapshot(), before)
    await assert.rejects(f.execute({payload:{...f.command.payload,agreementReference:'Changed same-key payload'}}), error => error.code === 'PT409')
    assert.deepEqual(await f.snapshot(), before)
  } finally { await f.db.close() }
})

test('foreign current grid-owner and route relationships deny without graph changes', async () => {
  const f = await fixture()
  try {
    await f.root("insert into communication_routes(id,company_id,grid_owner_id) values('"+f.id(14)+"','"+f.id(2)+"','"+f.id(8)+"')")
    const before = await f.snapshot()
    await assert.rejects(f.execute({payload:{...f.command.payload,gridOwnerId:f.id(8)}}), error => error.code === 'PT404')
    await assert.rejects(f.execute({payload:{...f.command.payload,preferredRouteId:f.id(14)}}), error => error.code === 'PT404')
    assert.deepEqual(await f.snapshot(), before)
  } finally { await f.db.close() }
})

test('actual revision conflict and late immutable audit failure roll back a newly created owner and agreement', async () => {
  const f = await fixture()
  try {
    const first = await f.execute()
    const before = await f.snapshot()
    await assert.rejects(f.execute({id:first.agreement.id,idempotencyKey:'agreement-stale-update-0001',expectedRevision:0}), error => error.code === 'PT409')
    await f.root("create function private.agreement_test_audit_failure() returns trigger language plpgsql as $$begin raise exception 'owned_late_audit_failure'; end$$")
    await f.root("create trigger owned_late_failure before insert on private.gridex_agreement_audit_v1 for each row execute function private.agreement_test_audit_failure()")
    await assert.rejects(f.execute({idempotencyKey:'late-owner-rollback-0001',payload:{...f.command.payload,gridOwnerId:null,newGridOwner:{name:'Must roll back'}}}), /owned_late_audit_failure/)
    assert.deepEqual(await f.snapshot(), before)
  } finally { await f.db.close() }
})

test('late clock recheck rolls back both audit facts and graph changes', async () => {
  const f = await fixture()
  try {
    const before = await f.snapshot()
    await f.root("create function private.agreement_test_expiry() returns trigger language plpgsql as $$begin update auth.sessions set not_after=clock_timestamp() where id='"+f.id(4)+"'; return new; end$$")
    await f.root("create trigger owned_late_expiry before insert on private.gridex_agreement_audit_v1 for each row execute function private.agreement_test_expiry()")
    await assert.rejects(f.execute({payload:{...f.command.payload,gridOwnerId:null,newGridOwner:{name:'Late clock rollback owner'}}}), error => error.code === '42501')
    assert.deepEqual(await f.snapshot(), before)
    const session = await f.root("select not_after from auth.sessions where id='"+f.id(4)+"'")
    assert.equal(session.rows[0].not_after, null)
  } finally { await f.db.close() }
})

test('archive increments exactly once and stale revision cannot mutate current agreement', async () => {
  const f = await fixture()
  try {
    const first = await f.execute()
    const archive = {operation:'archive',id:first.agreement.id,expectedRevision:1,idempotencyKey:'agreement-archive-0001',payload:{}}
    const archived = await f.execute(archive)
    assert.equal(archived.agreement.status, 'archived'); assert.equal(archived.agreement.revision, 2)
    const before = await f.snapshot()
    assert.equal((await f.execute(archive)).replayed, true)
    assert.deepEqual(await f.snapshot(), before)
    await assert.rejects(f.execute({...archive,idempotencyKey:'agreement-archive-stale-0001'}), error => error.code === 'PT409')
  } finally { await f.db.close() }
})

test('service can read but cannot bypass the private writer, and audit anchors are immutable', async () => {
  const f = await fixture()
  try {
    await f.execute()
    for (const query of [
      "insert into grid_owner_access_agreements(company_id) values('"+f.id(1)+"')",
      "update grid_owner_access_agreements set status='active'",
      "delete from grid_owner_access_agreements",
      "select * from private.gridex_agreement_results_v1",
    ]) await assert.rejects(f.db.query(query), error => error.code === '42501')
    for (const role of ['anon','authenticated']) {
      await f.db.exec('reset role; set role '+role)
      await assert.rejects(f.db.query('select public.gridex_grid_owner_agreement_command_v1($1)',[JSON.stringify(f.command)]), error => error.code === '42501')
      await assert.rejects(f.db.query('select * from grid_owner_access_agreements'), error => error.code === '42501')
    }
    await f.db.exec('reset role')
    await assert.rejects(f.db.query("update private.gridex_agreement_audit_v1 set operation='changed'"), error => error.code === '42501')
    await assert.rejects(f.db.query("delete from private.gridex_agreement_results_v1"), error => error.code === '42501')
  } finally { await f.db.close() }
})

test('reserved quarantine and noncanonical manual object identities cannot be registered', async () => {
  const f = await fixture()
  try {
    const before = await f.snapshot()
    for (const path of ['customer-support-quarantine:object.pdf','grid-owner-agreements:../object.pdf','grid-owner-agreements:folder/%2e%2e/object.pdf','grid-owner-agreements:folder/object.pdf?query']) {
      await assert.rejects(f.execute({payload:{...f.command.payload,documentPath:path}}), error => error.code === '22023')
      assert.deepEqual(await f.snapshot(), before)
    }
  } finally { await f.db.close() }
})

test('actual durable upload receipt attaches atomically and reconciliation cannot authorize attached-object deletion', async () => {
  const f = await fixture()
  try {
    const payload = {...f.command.payload,documentFile:{bucket:'grid-owner-agreements',name:'owned.pdf',sha256:'a'.repeat(64),size:20,contentType:'application/pdf'}}
    const prepared = await f.execute({operation:'prepare_upload',payload})
    const receipt = {payload,uploadIntentId:prepared.intent.id,cleanupToken:prepared.intent.token}
    const saved = await f.execute(receipt)
    assert.equal(saved.agreement.document_path,prepared.intent.bucket+':'+prepared.intent.path)
    const recovered = await f.execute({...receipt,operation:'abort_upload'})
    assert.equal(recovered.committed.agreement.id,saved.agreement.id); assert.equal(recovered.cleanup,null)
    await assert.rejects(f.execute({...receipt,operation:'cleanup_complete'}), error => error.code === 'PT409')
  } finally { await f.db.close() }
})

test('prepare replay requires the current exact agreement resource before returning a committed receipt',async()=>{
  const f=await fixture()
  try{
    const payload={...f.command.payload,documentFile:{bucket:'grid-owner-agreements',name:'owned.pdf',sha256:'a'.repeat(64),size:20,contentType:'application/pdf'}}
    const prepared=await f.execute({operation:'prepare_upload',payload})
    const saved=await f.execute({payload,uploadIntentId:prepared.intent.id,cleanupToken:prepared.intent.token})
    const replay=await f.execute({operation:'prepare_upload',payload})
    assert.equal(replay.committed.agreement.id,saved.agreement.id)
    await f.root("delete from grid_owner_access_agreements where id='"+saved.agreement.id+"'")
    await assert.rejects(f.execute({operation:'prepare_upload',payload}),error=>error.code==='PT404')
  }finally{await f.db.close()}
})

test('failed save records only exact unattached cleanup; no grant or revoked session is needed to remove that owned orphan', async () => {
  const f = await fixture()
  try {
    const before = await f.snapshot()
    const payload = {...f.command.payload,gridOwnerId:f.id(8),documentFile:{bucket:'grid-owner-agreements',name:'owned.pdf',sha256:'b'.repeat(64)}}
    const prepared = await f.execute({operation:'prepare_upload',payload})
    const receipt = {payload,uploadIntentId:prepared.intent.id,cleanupToken:prepared.intent.token}
    await assert.rejects(f.execute(receipt), error => error.code === 'PT404')
    await f.root("delete from auth.sessions where id='"+f.id(4)+"'")
    const cleanup = await f.execute({...receipt,operation:'abort_upload'})
    assert.equal(cleanup.committed,null); assert.equal(cleanup.cleanup.path,prepared.intent.path)
    await assert.rejects(f.execute({...receipt,operation:'cleanup_complete',cleanupToken:f.id(15)}), error => error.code === '42501')
    assert.deepEqual(await f.snapshot(),before)
    assert.equal((await f.execute({...receipt,operation:'cleanup_complete'})).cleaned,true)
  } finally { await f.db.close() }
})

test('new private agreement bucket stays server-only even under inherited permissive Storage reads', async () => {
  const f = await fixture()
  try {
    await f.root("insert into storage.buckets(id,name,public) values('other-private-fixture','Other private fixture',false)")
    await f.root("insert into storage.objects(bucket_id,name) values('grid-owner-agreements','owned-fixture.pdf'),('other-private-fixture','quiet-fixture.pdf')")
    for (const role of ['anon','authenticated']) {
      await f.db.exec('reset role; set role '+role)
      assert.deepEqual((await f.db.query('select id from storage.buckets order by id')).rows, [{id:'other-private-fixture'}])
      assert.deepEqual((await f.db.query('select bucket_id from storage.objects order by bucket_id')).rows, [{bucket_id:'other-private-fixture'}])
    }
  } finally { await f.db.close() }
})

// Stop the actual authored callback at SQL; no canned successful SQL value.
const authored = []
runInNewContext(ts.transpileModule(readFileSync(resolve(__dirname,'grid-owner-agreement-atomic-20261001.native.test.ts'),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {
  exports:{}, require: name => {
    if(name==='node:crypto') return require(name)
    if(name==='vitest') return {it:(name,run)=>authored.push({name,run}),expect:()=>{throw new Error('agreement_capture_must_stop_before_expect')}}
    if(name==='./customer-read-proof-native') return {quote:value=>"'"+value.replaceAll("'","''")+"'",proofSql:sql=>{throw {capturedAgreementSql:sql}}}
    throw new Error('agreement_unexpected_native_dependency:'+name)
  },
})
for(const proof of authored) test('prepared native SQL construction on real core PostgreSQL: '+proof.name,async()=>{
  let source
  try{proof.run();assert.fail('agreement_native_sql_not_captured')}
  catch(error){if(typeof error?.capturedAgreementSql!=='string')throw error;source=error.capturedAgreementSql}
  const f=await fixture()
  try{
    await f.db.exec("reset role; alter table companies add column name text;\n"+
      "alter table auth.users add column aud text,add column role text,add column email text,add column raw_app_meta_data jsonb,add column raw_user_meta_data jsonb,\n"+
      "add column created_at timestamptz,add column updated_at timestamptz,add column is_sso_user boolean,add column is_anonymous boolean;\n"+
      "alter table auth.sessions add column created_at timestamptz,add column updated_at timestamptz; alter table user_profiles add column email text,add column full_name text;\n"+
      "create table outbound_requests(id uuid primary key,company_id uuid); create table tenant_email_outbox(id uuid primary key,company_id uuid);")
    const results=await f.db.exec(source)
    assert.ok(results.some(result=>result.rows.some(row=>row.proof_receipt?.passed===true)))
  }finally{await f.db.close()}
})
