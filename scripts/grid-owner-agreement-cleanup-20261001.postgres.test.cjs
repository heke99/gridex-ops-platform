const {test}=require('node:test')
const assert=require('node:assert/strict')
const {fixture}=require('./grid-owner-agreement-cleanup-20261001-core.cjs')

test('a private pending upload cannot be published by another manual agreement command',async()=>{
  const f=await fixture()
  try{
    const prepared=await f.prepare()
    const before=await f.snapshot()
    await assert.rejects(f.execute({idempotencyKey:'other-manual-reference-0001',payload:{...f.command.payload,documentPath:prepared.intent.bucket+':'+prepared.intent.path}}),error=>error.code==='PT409')
    assert.deepEqual(await f.snapshot(),before)
  }finally{await f.db.close()}
})

test('an aged never-attached intent is sealed and claimed only for its explicit company',async()=>{
  const f=await fixture()
  try{
    const prepared=await f.prepare()
    await f.root("update private.gridex_agreement_uploads_v1 set created_at=clock_timestamp()-interval '1 hour' where id='"+prepared.intent.id+"'")
    assert.deepEqual(await f.claim(f.id(2)),[])
    const receipts=await f.claim()
    assert.equal(receipts.length,1)
    assert.equal(receipts[0].uploadIntentId,prepared.intent.id)
    assert.equal(receipts[0].bucket,prepared.intent.bucket)
    assert.equal(receipts[0].path,prepared.intent.path)
    await assert.rejects(f.execute({payload:f.payload,uploadIntentId:prepared.intent.id,cleanupToken:prepared.intent.token}),error=>error.code==='42501')
  }finally{await f.db.close()}
})


test('old actual manual publication and attached committed objects are never exposed to cleanup',async()=>{
  const f=await fixture({legacyReference:true})
  try{
    await f.root("update private.gridex_agreement_uploads_v1 set created_at=clock_timestamp()-interval '1 hour'")
    assert.deepEqual(await f.claim(),[])
    assert.equal((await f.snapshot()).agreements.length,1)
    const prepared=await f.prepare()
    await f.execute({payload:f.payload,uploadIntentId:prepared.intent.id,cleanupToken:prepared.intent.token})
    await f.root("update private.gridex_agreement_uploads_v1 set created_at=clock_timestamp()-interval '1 hour'")
    assert.deepEqual(await f.claim(),[])
  }finally{await f.db.close()}
})

test('explicit NULL scope preserves global-company semantics without claiming a foreign tenant',async()=>{
  const f=await fixture()
  try{
    const prepared=await f.execute({companyId:null,operation:'prepare_upload',payload:{...f.payload,gridOwnerId:null}})
    await f.root("update private.gridex_agreement_uploads_v1 set created_at=clock_timestamp()-interval '1 hour' where id='"+prepared.intent.id+"'")
    assert.deepEqual(await f.claim(),[])
    const claims=await f.claim(null)
    assert.equal(claims.length,1);assert.equal(claims[0].companyId,null);assert.match(claims[0].path,/^platform\//)
  }finally{await f.db.close()}
})

test('fresh upload, active lease and bounded limits prevent competing claims',async()=>{
  const f=await fixture()
  try{
    await f.prepare();assert.deepEqual(await f.claim(),[])
    await f.root("update private.gridex_agreement_uploads_v1 set created_at=clock_timestamp()-interval '1 hour'")
    assert.equal((await f.claim(f.id(1),f.id(30),1)).length,1)
    assert.deepEqual(await f.claim(f.id(1),f.id(31),1),[])
    for(const limit of [0,11,null])await assert.rejects(f.claim(f.id(1),f.id(32),limit),error=>error.code==='22023')
    await assert.rejects(f.claim(f.id(1),null,1),error=>error.code==='22023')
  }finally{await f.db.close()}
})

test('exact current lease and references are rechecked before physical work or finish',async()=>{
  const f=await fixture()
  try{
    await f.prepare();await f.root("update private.gridex_agreement_uploads_v1 set created_at=clock_timestamp()-interval '1 hour'")
    const [receipt]=await f.claim()
    assert.equal(await f.validate(receipt),true)
    for(const changes of [{companyId:f.id(2)},{claimToken:f.id(35)},{attempt:2},{path:'foreign.pdf'},{fileSha256:'b'.repeat(64)}])assert.equal(await f.validate({...receipt,...changes}),false)
    await f.root("insert into grid_owner_access_agreements(company_id,document_path) values('"+f.id(1)+"','"+receipt.bucket+":"+receipt.path+"')")
    assert.equal(await f.validate(receipt),false)
    await assert.rejects(f.finish(receipt),error=>error.code==='PT409')
  }finally{await f.db.close()}
})

test('finish is exactly idempotent and cleaned objects remain eligible for periodic late-upload settlement',async()=>{
  const f=await fixture()
  try{
    await f.prepare();await f.root("update private.gridex_agreement_uploads_v1 set created_at=clock_timestamp()-interval '1 hour'")
    const [receipt]=await f.claim()
    assert.deepEqual(await f.finish(receipt),{finished:true,replayed:false})
    const before=await f.cleanupSnapshot()
    assert.deepEqual(await f.finish(receipt),{finished:true,replayed:true})
    assert.deepEqual(await f.cleanupSnapshot(),before)
    await assert.rejects(f.finish(receipt,'retry'),error=>error.code==='PT409')
    assert.deepEqual(await f.claim(),[])
    await f.root("update private.gridex_agreement_cleanup_claims_v1 set next_attempt_at=clock_timestamp()-interval '1 second'")
    const [next]=await f.claim(f.id(1),f.id(31))
    assert.equal(next.attempt,2);assert.equal(next.path,receipt.path)
    assert.equal(await f.validate(receipt),false)
    assert.deepEqual(await f.finish(next,'retry'),{finished:true,replayed:false})
    const facts=await f.cleanupSnapshot()
    assert.equal(facts.events.length,4);assert.equal(facts.uploads[0].status,'cleanup_required')
  }finally{await f.db.close()}
})

test('expired stale receipt cannot finish after a later claim',async()=>{
  const f=await fixture()
  try{
    await f.prepare();await f.root("update private.gridex_agreement_uploads_v1 set created_at=clock_timestamp()-interval '1 hour'")
    const [old]=await f.claim()
    await f.root("update private.gridex_agreement_cleanup_claims_v1 set lease_until=clock_timestamp()-interval '1 second'")
    const [next]=await f.claim(f.id(1),f.id(31))
    assert.equal(next.attempt,2)
    const before=await f.cleanupSnapshot()
    await assert.rejects(f.finish(old),error=>error.code==='PT409')
    assert.deepEqual(await f.cleanupSnapshot(),before)
  }finally{await f.db.close()}
})

test('late claim audit failure rolls back the seal, lease and attempt facts',async()=>{
  const f=await fixture()
  try{
    await f.prepare();await f.root("update private.gridex_agreement_uploads_v1 set created_at=clock_timestamp()-interval '1 hour'")
    const before=await f.cleanupSnapshot()
    await f.root("create function private.cleanup_fault() returns trigger language plpgsql as $$begin raise exception 'owned_cleanup_event_fault'; end$$")
    await f.root("create trigger owned_cleanup_fault before insert on private.gridex_agreement_cleanup_events_v1 for each row execute function private.cleanup_fault()")
    await assert.rejects(f.claim(),/owned_cleanup_event_fault/)
    assert.deepEqual(await f.cleanupSnapshot(),before)
  }finally{await f.db.close()}
})

test('late finish clock failure rolls back all completion and immutable attempt facts',async()=>{
  const f=await fixture()
  try{
    await f.prepare();await f.root("update private.gridex_agreement_uploads_v1 set created_at=clock_timestamp()-interval '1 hour'")
    const [issued]=await f.claim()
    await f.root("update private.gridex_agreement_cleanup_claims_v1 set lease_until=clock_timestamp()+interval '2 seconds'")
    const receipt=(await f.root("select private.gridex_agreement_cleanup_receipt_v1(u,c) as value from private.gridex_agreement_uploads_v1 u join private.gridex_agreement_cleanup_claims_v1 c on c.upload_intent_id=u.id")).rows[0].value
    assert.equal(receipt.uploadIntentId,issued.uploadIntentId)
    const before=await f.cleanupSnapshot()
    await f.root("create function private.cleanup_wait() returns trigger language plpgsql as $$begin if new.phase='finish' then perform pg_sleep(2.1); end if; return new; end$$")
    await f.root("create trigger owned_cleanup_wait before insert on private.gridex_agreement_cleanup_events_v1 for each row execute function private.cleanup_wait()")
    await assert.rejects(f.finish(receipt),error=>error.code==='PT409')
    assert.deepEqual(await f.cleanupSnapshot(),before)
  }finally{await f.db.close()}
})

test('old unchecked writer and all cleanup ledger DML are inaccessible to service and public roles',async()=>{
  const f=await fixture()
  try{
    await f.prepare();await f.root("update private.gridex_agreement_uploads_v1 set created_at=clock_timestamp()-interval '1 hour'")
    await f.claim()
    for(const sql of ["select private.gridex_agreement_command_v1_unchecked('{}')","select * from private.gridex_agreement_cleanup_claims_v1","update private.gridex_agreement_uploads_v1 set status='prepared'"]){
      await assert.rejects(f.db.query(sql),error=>error.code==='42501')
    }
    for(const role of ['anon','authenticated']){
      await f.db.exec('reset role; set role '+role)
      await assert.rejects(f.db.query('select public.gridex_claim_agreement_cleanup_v1($1,$2,1)',[f.id(1),f.id(30)]),error=>error.code==='42501')
    }
    await f.db.exec('reset role')
    await assert.rejects(f.db.query("delete from private.gridex_agreement_cleanup_events_v1"),error=>error.code==='42501')
    const owners=await f.db.query("select count(distinct proowner)::int as count from pg_proc where oid in('private.gridex_agreement_command_v1(jsonb)'::regprocedure,'private.gridex_agreement_command_v1_unchecked(jsonb)'::regprocedure,'private.gridex_claim_agreement_cleanup_v1(uuid,uuid,integer)'::regprocedure)")
    assert.equal(owners.rows[0].count,1)
  }finally{await f.db.close()}
})


const {readFileSync}=require('node:fs'),{resolve}=require('node:path'),{runInNewContext}=require('node:vm'),ts=require('typescript')
const authored=[]
runInNewContext(ts.transpileModule(readFileSync(resolve(__dirname,'grid-owner-agreement-cleanup-20261001.native.test.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:{},require:name=>{
    if(name==='node:crypto')return require(name)
    if(name==='vitest')return{it:(name,run)=>authored.push({name,run}),expect:()=>{throw new Error('cleanup_capture_must_stop_before_expect')}}
    if(name==='./customer-read-proof-native')return{quote:value=>"'"+value.replaceAll("'","''")+"'",proofSql:sql=>{throw{capturedCleanupSql:sql}}}
    throw new Error('cleanup_unexpected_native_dependency:'+name)
  },
})
for(const proof of authored)test('prepared native cleanup SQL construction on actual core PostgreSQL: '+proof.name,async()=>{
  let source;try{proof.run();assert.fail('cleanup_native_sql_not_captured')}catch(error){if(typeof error?.capturedCleanupSql!=='string')throw error;source=error.capturedCleanupSql}
  const f=await fixture()
  try{
    await f.db.exec("reset role; alter table companies add column name text; alter table auth.users add column aud text,add column role text,add column email text,add column raw_app_meta_data jsonb,add column raw_user_meta_data jsonb,add column created_at timestamptz,add column updated_at timestamptz,add column is_sso_user boolean,add column is_anonymous boolean; alter table auth.sessions add column created_at timestamptz,add column updated_at timestamptz; alter table user_profiles add column email text,add column full_name text;")
    for(const name of ['customers','customer_contracts','billing_underlays','customer_invoices','invoice_export_items','ediel_messages','outbound_requests','tenant_email_outbox'])await f.db.exec('create table '+name+'(id uuid primary key,company_id uuid)')
    const results=await f.db.exec(source)
    assert.ok(results.some(result=>result.rows.some(row=>row.proof_receipt?.passed===true)))
  }finally{await f.db.close()}
})

// Re-execute the unchanged atomic-stage proof callbacks with both actual
// forwards installed. Only fixture acquisition and test label are adapted.
new Function('require','__dirname',readFileSync(resolve(__dirname,'grid-owner-agreement-atomic-20261001.postgres.test.cjs'),'utf8'))(name=>{
    if(name==='./grid-owner-agreement-atomic-20261001-core.cjs')return{fixture}
    if(name==='node:test')return{test:(name,run)=>test('retained atomic agreement proof after cleanup forward: '+name,run)}
    return require(name)
  },__dirname)
