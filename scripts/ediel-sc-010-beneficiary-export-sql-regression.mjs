// Real new export SQL and existing source/grant/projection owners over the
// existing labelled finite fixtures. Single PGlite session, NOT native races.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const base = readFileSync(new URL('./ediel-beneficiary-projection-replay-sql-regression.mjs', import.meta.url), 'utf8')
const marker = " console.log('Projection replay SQL:"
assert.equal(base.split(marker).length, 2)
const extension = String.raw`
 // The inherited minimal series fixture has no key; add its real-schema ID
 // uniqueness here solely to support the new FK, not to fabricate authority.
 await db.exec('CREATE UNIQUE INDEX export_fixture_series_id ON public.meter_reading_series(id)')
 const exportMigration=new URL('../supabase/migrations/20261005101500_ediel_beneficiary_export_jobs.sql',import.meta.url)
 if(process.env.EDIEL_EXPORT_BASELINE!=='1'&&existsSync(exportMigration))await db.exec(readFileSync(exportMigration,'utf8'))
 const exportQuery=async(sql,args)=>(await db.query(sql,args)).rows[0].result
 const queue=async(key,changes={})=>{
  const p={company:uid(2),actor:uid(20),grant:grant.grantId,version:2,purpose:'analysis',series:uid(211),fields:['quantity'],start:'2026-01-01',end:'2026-02-01',limit:100,afterAt:null,afterId:null,...changes}
  return exportQuery('SELECT public.ediel_queue_beneficiary_export_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) result',[p.company,p.actor,key,p.grant,p.version,p.purpose,p.series,p.fields,p.start,p.end,p.limit,p.afterAt,p.afterId])
 }
 const claim=async(company=uid(2),actor=uid(20))=>exportQuery('SELECT public.ediel_claim_beneficiary_exports_v1($1,$2,10) result',[company,actor])
 const execute=(job,token,company=uid(2),actor=uid(20))=>exportQuery('SELECT public.ediel_execute_beneficiary_export_v1($1,$2,$3,$4) result',[company,actor,job,token])
 const result=(job,company=uid(2),actor=uid(20))=>exportQuery('SELECT public.ediel_read_beneficiary_export_v1($1,$2,$3) result',[company,actor,job])
 const count=async table=>(await db.query('SELECT count(*) n FROM '+table)).rows[0].n
 const exportDenied=async(fn,pattern)=>{await db.exec('SAVEPOINT export_denial');try{await assert.rejects(fn,pattern)}finally{await db.exec('ROLLBACK TO SAVEPOINT export_denial;RELEASE SAVEPOINT export_denial')}}
 const ownerSnapshot=async()=>{
  const tables=(await db.query("SELECT schemaname,tablename FROM pg_tables WHERE (schemaname='public' OR schemaname LIKE 'gridex_%') AND schemaname<>'gridex_ediel_exports' ORDER BY schemaname,tablename")).rows
  const rows={};const id=s=>'"'+s.replaceAll('"','""')+'"'
  for(const t of tables)rows[t.schemaname+'.'+t.tablename]=(await db.query('SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),\'[]\') state FROM '+id(t.schemaname)+'.'+id(t.tablename)+' r')).rows[0].state
  return rows
 }
 let exportChecks=0;const exportCheck=async(name,fn)=>{await fn();exportChecks++;console.log('PASS export '+name)}
 let queued
 await exportCheck('positive enqueue establishes a reachable real queue',async()=>{
  try{queued=await queue(uid(800))}catch(error){queued={status:'missing_export_consumer',message:error.message}}
  assert.equal(queued.status,'queued','SC010 requires a real production queue, not a synchronous projection')
  assert.equal(await count('gridex_ediel_exports.results'),0)
 })
 await exportCheck('exact request replay and changed-request collision',async()=>{
  assert.deepEqual(await queue(uid(800)),queued)
  await assert.rejects(()=>queue(uid(800),{limit:99}),/idempotency_scope_mismatch/)
  assert.equal(await count('gridex_ediel_exports.jobs'),1)
 })
 await exportCheck('wrong tenant, purpose, fields and actor cannot queue',async()=>{
  const before=await ownerSnapshot()
  for(const change of [{company:uid(3)},{actor:uid(999)},{purpose:'other'},{fields:['quality']},{series:uid(999)},{version:3}])await assert.rejects(()=>queue(uid(801),change))
  assert.deepEqual(await ownerSnapshot(),before);assert.equal(await count('gridex_ediel_exports.jobs'),1)
 })
 let lease
 await exportCheck('claim is actor/tenant scoped and yields one opaque token',async()=>{
  assert.deepEqual(await claim(uid(3)),[])
  await assert.rejects(()=>claim(uid(2),uid(999)),/beneficiary_forbidden/)
  const claims=await claim();assert.equal(claims.length,1);lease=claims[0]
  assert.deepEqual(Object.keys(lease).sort(),['jobId','leaseToken']);assert.equal(lease.jobId,queued.jobId)
  assert.deepEqual(await claim(),[])
 })
 await exportCheck('wrong and expired leases cannot produce output; reclaim rotates token',async()=>{
  const before=await ownerSnapshot()
  await assert.rejects(()=>execute(queued.jobId,uid(999)),/lease_not_current/)
  await db.query("UPDATE gridex_ediel_exports.jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[queued.jobId])
  await assert.rejects(()=>execute(queued.jobId,lease.leaseToken),/lease_not_current/)
  const next=(await claim())[0];assert.notEqual(next.leaseToken,lease.leaseToken)
  await assert.rejects(()=>execute(queued.jobId,lease.leaseToken),/lease_not_current/)
  lease=next;assert.equal(await count('gridex_ediel_exports.results'),0);assert.deepEqual(await ownerSnapshot(),before)
 })
 await exportCheck('execute writes one internal result using current DGI projection; worker response contains no values',async()=>{
  const before=await ownerSnapshot()
  assert.deepEqual(await execute(queued.jobId,lease.leaseToken),{jobId:queued.jobId,status:'completed'})
  const read=await result(queued.jobId);assert.equal(read.status,'completed');assert.deepEqual(read.page,quantityPage)
  assert.equal(await count('gridex_ediel_exports.results'),1)
  await assert.rejects(()=>execute(queued.jobId,lease.leaseToken),/lease_not_current/)
  await assert.rejects(()=>result(queued.jobId,uid(3)),/export_not_found/)
  assert.deepEqual(await ownerSnapshot(),before)
 })
 await exportCheck('captured multi-row window, page limit and tied cursor survive queue, lease and result read',async()=>{
  await db.exec('BEGIN')
  try{
   // Additional stored observations are finite accepted-storage fixtures,
   // not an assertion that the native source owner minted this series.
   for(const [id,at,quantity] of [[850,'2026-01-09','9.000'],[851,'2026-01-10','10.000'],[852,'2026-01-10','11.000'],[853,'2026-01-15','15.000'],[854,'2026-01-20','20.000']])await db.query('INSERT INTO meter_reading_values VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uid(id),uid(1),uid(211),at,quantity,'KWH','56','220'])
   const before=await ownerSnapshot(),receipts=await receiptCount(),outputs=await count('gridex_ediel_exports.results'),jobs=await count('gridex_ediel_exports.jobs')
   const retainedBefore=(await db.query('SELECT to_jsonb(r) state FROM gridex_ediel_exports.results r WHERE job_id=$1',[queued.jobId])).rows[0].state
   // A completed old page also needs fresh source proof: changed values
   // cannot be returned from retention, and its attempted receipt rolls back.
   await exportDenied(()=>result(queued.jobId),/result_basis_changed/)
   assert.deepEqual((await db.query('SELECT to_jsonb(r) state FROM gridex_ediel_exports.results r WHERE job_id=$1',[queued.jobId])).rows[0].state,retainedBefore)
   for(const change of [{start:'2025-12-31'},{end:'2027-01-02'},{limit:0},{limit:501}])await exportDenied(()=>queue(uid(810),change),/projection_outside_grant|projection_request_invalid/)
   assert.equal(await count('gridex_ediel_exports.jobs'),jobs);assert.equal(await receiptCount(),receipts);assert.equal(await count('gridex_ediel_exports.results'),outputs);assert.deepEqual(await ownerSnapshot(),before)
   const scope={start:'2026-01-10',end:'2026-01-20',limit:2}
   const first=await queue(uid(811),scope),firstLease=(await claim())[0]
   assert.equal(firstLease.jobId,first.jobId);assert.deepEqual(await execute(first.jobId,firstLease.leaseToken),{jobId:first.jobId,status:'completed'})
   assert.equal(await receiptCount(),receipts+1)
   const firstPage=(await result(first.jobId)).page
   assert.deepEqual(firstPage.rows,[{quantity:'10.000'},{quantity:'11.000'}]);assert.deepEqual(firstPage.provenance.fields,['quantity'])
   assert.equal(new Date(firstPage.next.readingAt).toISOString(),'2026-01-10T00:00:00.000Z');assert.equal(firstPage.next.valueId,uid(852))
   const firstProof=(await db.query('SELECT proof FROM gridex_ediel_services.projection_receipts WHERE id=$1',[firstPage.consumerReceiptId])).rows[0].proof
   assert.equal(firstProof.origin.purpose,'analysis');assert.deepEqual(firstProof.origin.fields,['quantity'])
   assert.deepEqual([firstProof.beneficiaryCompanyId,firstProof.actorUserId,firstProof.grantId,firstProof.grantVersion,firstProof.seriesId,firstProof.limit,firstProof.afterAt,firstProof.afterId],[uid(2),uid(20),grant.grantId,2,uid(211),2,null,null])
   assert.equal(new Date(firstProof.start).toISOString(),'2026-01-10T00:00:00.000Z');assert.equal(new Date(firstProof.end).toISOString(),'2026-01-20T00:00:00.000Z');assert.equal(await receiptCount(),receipts+1)
   const second=await queue(uid(812),{...scope,afterAt:firstPage.next.readingAt,afterId:firstPage.next.valueId}),secondLease=(await claim())[0]
   assert.equal(secondLease.jobId,second.jobId);assert.deepEqual(await execute(second.jobId,secondLease.leaseToken),{jobId:second.jobId,status:'completed'})
   assert.equal(await receiptCount(),receipts+2)
   const secondPage=(await result(second.jobId)).page
   assert.deepEqual(secondPage.rows,[{quantity:'15.000'}]);assert.equal(secondPage.next,null);assert.deepEqual(secondPage.provenance.fields,['quantity'])
   const secondProof=(await db.query('SELECT proof FROM gridex_ediel_services.projection_receipts WHERE id=$1',[secondPage.consumerReceiptId])).rows[0].proof
   assert.equal(secondProof.origin.purpose,'analysis');assert.deepEqual(secondProof.origin.fields,['quantity'])
   assert.deepEqual([secondProof.beneficiaryCompanyId,secondProof.actorUserId,secondProof.grantId,secondProof.grantVersion,secondProof.seriesId,secondProof.limit,secondProof.afterId],[uid(2),uid(20),grant.grantId,2,uid(211),2,uid(852)])
   assert.equal(new Date(secondProof.start).toISOString(),'2026-01-10T00:00:00.000Z');assert.equal(new Date(secondProof.end).toISOString(),'2026-01-20T00:00:00.000Z');assert.equal(new Date(secondProof.afterAt).toISOString(),'2026-01-10T00:00:00.000Z')
   assert.equal(await receiptCount(),receipts+2);assert.equal(await count('gridex_ediel_exports.results'),outputs+2)
   const after=await ownerSnapshot();delete before['gridex_ediel_services.projection_receipts'];delete after['gridex_ediel_services.projection_receipts'];assert.deepEqual(after,before)
  }finally{await db.exec('ROLLBACK')}
 })
 await exportCheck('beneficiary membership or user loss after lease blocks execution and retained results',async()=>{
  for(const loss of ["UPDATE company_memberships SET is_active=false WHERE company_id='"+uid(2)+"' AND user_id='"+uid(20)+"'","UPDATE user_profiles SET user_status='suspended' WHERE id='"+uid(20)+"'"]){
   await db.exec('BEGIN')
   try{
    const later=await queue(uid(813)),current=(await claim())[0];assert.equal(current.jobId,later.jobId)
    await db.exec(loss)
    const before=await ownerSnapshot(),receipts=await receiptCount(),outputs=await count('gridex_ediel_exports.results')
    assert.deepEqual(await execute(later.jobId,current.leaseToken),{jobId:later.jobId,status:'blocked'})
    assert.deepEqual((await db.query('SELECT status,expected_grant_version,lease_token,completed_at FROM gridex_ediel_exports.jobs WHERE id=$1',[later.jobId])).rows[0],{status:'blocked',expected_grant_version:2,lease_token:null,completed_at:null})
    await exportDenied(()=>result(queued.jobId),/beneficiary_forbidden/);await exportDenied(()=>queue(uid(814)),/beneficiary_forbidden/);await exportDenied(()=>claim(),/beneficiary_forbidden/)
    assert.equal(await count('gridex_ediel_exports.results'),outputs);assert.equal(await receiptCount(),receipts);assert.deepEqual(await ownerSnapshot(),before)
   }finally{await db.exec('ROLLBACK')}
  }
  await db.exec('BEGIN')
  try{
   await db.query('INSERT INTO auth.users VALUES($1)',[uid(21)])
   await db.query("INSERT INTO user_profiles VALUES($1,'active')",[uid(21)])
   await db.query("INSERT INTO company_memberships VALUES($1,$2,'active',true,now())",[uid(2),uid(21)])
   const later=await queue(uid(815)),current=(await claim())[0];assert.equal(current.jobId,later.jobId)
   const before=await ownerSnapshot(),receipts=await receiptCount(),outputs=await count('gridex_ediel_exports.results'),job=(await db.query('SELECT to_jsonb(j) state FROM gridex_ediel_exports.jobs j WHERE id=$1',[later.jobId])).rows[0].state
   assert.deepEqual(await claim(uid(2),uid(21)),[])
   await exportDenied(()=>execute(later.jobId,current.leaseToken,uid(2),uid(21)),/export_not_found/);await exportDenied(()=>result(queued.jobId,uid(2),uid(21)),/export_not_found/)
   assert.deepEqual((await db.query('SELECT to_jsonb(j) state FROM gridex_ediel_exports.jobs j WHERE id=$1',[later.jobId])).rows[0].state,job)
   assert.equal(await count('gridex_ediel_exports.results'),outputs);assert.equal(await receiptCount(),receipts);assert.deepEqual(await ownerSnapshot(),before)
  }finally{await db.exec('ROLLBACK')}
 })
 await exportCheck('active grant version drift blocks the old captured lease and cached result without upgrading it',async()=>{
  await db.exec('BEGIN')
  try{
   const later=await queue(uid(816)),current=(await claim())[0];assert.equal(current.jobId,later.jobId)
   const original=(await db.query('SELECT to_jsonb(g) state FROM ediel_data_access_grants g WHERE id=$1',[grant.grantId])).rows[0].state
   // A legitimate guarded UPDATE fires the retained real version/history
   // triggers; scope, status and revocation state remain unchanged.
   await db.query('UPDATE ediel_data_access_grants SET valid_from=valid_from WHERE id=$1',[grant.grantId])
   const changed=(await db.query('SELECT to_jsonb(g) state FROM ediel_data_access_grants g WHERE id=$1',[grant.grantId])).rows[0].state
   assert.equal(original.version,2);assert.equal(changed.version,3);assert.equal(changed.status,'active');assert.equal(changed.revoked_at,null)
   delete original.version;delete original.updated_at;delete changed.version;delete changed.updated_at;assert.deepEqual(changed,original)
   const fresh=await exportQuery('SELECT public.ediel_beneficiary_series_page_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',[uid(2),uid(20),grant.grantId,3,'analysis',uid(211),['quantity'],'2026-01-01','2026-02-01',100])
   assert.equal(fresh.grantVersion,3);assert.deepEqual(fresh.rows,quantityPage.rows)
   const before=await ownerSnapshot(),receipts=await receiptCount(),outputs=await count('gridex_ediel_exports.results')
   assert.deepEqual(await execute(later.jobId,current.leaseToken),{jobId:later.jobId,status:'blocked'})
   assert.deepEqual((await db.query('SELECT status,expected_grant_version,lease_token,completed_at FROM gridex_ediel_exports.jobs WHERE id=$1',[later.jobId])).rows[0],{status:'blocked',expected_grant_version:2,lease_token:null,completed_at:null})
   await exportDenied(()=>result(queued.jobId),/grant_not_current/);await exportDenied(()=>queue(uid(817)),/grant_not_current/)
   assert.equal(await count('gridex_ediel_exports.results'),outputs);assert.equal(await receiptCount(),receipts);assert.deepEqual(await ownerSnapshot(),before)
  }finally{await db.exec('ROLLBACK')}
 })
 await exportCheck('service credentials have no private-table access or public anonymous execute',async()=>{
  const acl=(await db.query("SELECT has_table_privilege('service_role','gridex_ediel_exports.results','SELECT') r,has_table_privilege('service_role','gridex_ediel_exports.jobs','INSERT') w,has_function_privilege('authenticated','public.ediel_read_beneficiary_export_v1(uuid,uuid,uuid)','EXECUTE') a")).rows[0]
  assert.deepEqual(acl,{r:false,w:false,a:false})
 })
 await exportCheck('current source role or technical endpoint loss after enqueue blocks actual execution without output',async()=>{
  for(const loss of ['UPDATE tenant_ediel_profiles SET is_enabled=false','UPDATE tenant_actor_identifiers SET valid_to=now()']){
   await db.exec('BEGIN')
   try{
    const later=await queue(uid(806))
    await db.exec(loss)
    const before=await ownerSnapshot(),receipts=await receiptCount(),outputs=await count('gridex_ediel_exports.results')
    const current=(await claim())[0];assert.equal(current.jobId,later.jobId)
    assert.deepEqual(await execute(later.jobId,current.leaseToken),{jobId:later.jobId,status:'blocked'})
    assert.equal((await db.query('SELECT status FROM gridex_ediel_exports.jobs WHERE id=$1',[later.jobId])).rows[0].status,'blocked')
    assert.equal(await count('gridex_ediel_exports.results'),outputs);assert.equal(await receiptCount(),receipts);assert.deepEqual(await ownerSnapshot(),before)
   }finally{await db.exec('ROLLBACK')}
  }
 })
 await exportCheck('active enqueue then actual revoke then lease blocks export and cached result reads',async()=>{
  await db.exec('BEGIN')
  try{
  const later=await queue(uid(802))
  const revoked=await command({action:'revoke_grant',commandId:uid(803),assignmentId:aid,expectedVersion:2,grantId:grant.grantId,expectedGrantVersion:2})
  assert.equal(revoked.status,'revoked')
  const before=await ownerSnapshot(),receipts=await receiptCount(),outputs=await count('gridex_ediel_exports.results')
  const current=(await claim())[0];assert.equal(current.jobId,later.jobId)
  assert.deepEqual(await execute(later.jobId,current.leaseToken),{jobId:later.jobId,status:'blocked'})
  assert.equal((await db.query('SELECT status FROM gridex_ediel_exports.jobs WHERE id=$1',[later.jobId])).rows[0].status,'blocked')
  await exportDenied(()=>result(queued.jobId),/grant_not_current/)
  await exportDenied(()=>queue(uid(804)),/grant_not_current/)
  await exportDenied(()=>queue(uid(805),{version:3}),/grant_not_current/)
  assert.equal(await count('gridex_ediel_exports.results'),outputs);assert.equal(await receiptCount(),receipts);assert.deepEqual(await ownerSnapshot(),before)
  assert.deepEqual((await pages(uid(3),grant2.grantId,'quality-monitoring',['quality'])).rows,qualityPage.rows)
  }finally{await db.exec('ROLLBACK')}
 })
 console.log('Beneficiary export SQL: '+exportChecks+' PASS; actual queue/lease/current projection/internal result, finite upstream fixtures, NOT native concurrent proof')
`
let modified = base.replace(marker, () => extension + marker)
modified = modified.replace("import {readFileSync,writeFileSync,unlinkSync}", "import {readFileSync,writeFileSync,unlinkSync,existsSync}")
// Inner generated runners import fs too; the injected extension uses existsSync.
modified = modified.replace("const forward=String.raw`", "const forward=String.raw`\n const existsSync=(url)=>{try{readFileSync(url);return true}catch{return false}}\n")
modified = modified.replaceAll('.ediel-projection-replay', '.ediel-sc010-export')
const temp = fileURLToPath(new URL('./.ediel-sc010-export-entry.tmp.mjs', import.meta.url))
writeFileSync(temp, modified)
try {
  const run = spawnSync(process.execPath, [temp], { stdio: 'inherit', env: process.env })
  if (run.error) throw run.error
  process.exitCode = run.status ?? 1
} finally { unlinkSync(temp) }
