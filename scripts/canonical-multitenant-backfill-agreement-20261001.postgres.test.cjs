// Execute exact repair scripts on a typed nullable historical shape. This is
// PostgreSQL core, not native migration replay or hosted tenant-data approval.
const {test}=require('node:test')
const assert=require('node:assert/strict')
const {readFileSync}=require('node:fs')
const {resolve}=require('node:path')
const {PGlite}=require('@electric-sql/pglite')
const source=name=>readFileSync(resolve(__dirname,'canonical-multitenant-backfill-'+name+'.sql'),'utf8').replace(/^\\.*$/gm,'')
const A='e48f0000-0000-4000-8000-000000000001',B='e48f0000-0000-4000-8000-000000000002'
const customer='e48f0000-0000-4000-8000-000000000011',site='e48f0000-0000-4000-8000-000000000021',point='e48f0000-0000-4000-8000-000000000031'
async function fixture({siteCompany=A,pointCompany=null,missingSite=false,parentNull=false,parentSurfaceAbsent=false}={}){
 const db=new PGlite()
 await db.exec(`create role authenticated;create role anon;
  create table companies(id uuid primary key,name text not null);
  create table customers(id uuid primary key,company_id uuid);
  create table customer_sites(id uuid primary key,company_id uuid,customer_id uuid);
  create table metering_points(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,correlation_id uuid);
  create table audit_logs(id uuid primary key default gen_random_uuid(),company_id uuid,actor_user_id uuid,entity_type text,
   entity_id text,action text,old_values jsonb,new_values jsonb,metadata jsonb);`)
 await db.query('insert into companies values($1,\'Synthetic A\'),($2,\'Synthetic B\')',[A,B])
 await db.query('insert into customers values($1,$2)',[customer,A])
 if(!missingSite) await db.query('insert into customer_sites values($1,$2,null)',[site,parentNull?null:siteCompany])
 await db.query('insert into metering_points values($1,$2,$3,$4,null)',[point,pointCompany,customer,site])
 if(parentSurfaceAbsent) await db.exec('drop table customer_sites')
 return db
}
async function pointState(db){return (await db.query('select to_jsonb(p) as value from metering_points p')).rows[0].value}
async function audits(db){return (await db.query('select to_jsonb(a) as value from audit_logs a order by id')).rows.map(r=>r.value)}
for(const [name,options] of [['different tenant parents',{siteCompany:B}],['missing linked parent',{missingSite:true}],['parent with unknown tenant',{parentNull:true}],
 ['absent linked parent surface',{parentSurfaceAbsent:true}]]){
 test('actual dry-run marks '+name+' for manual review instead of safe fill',async()=>{
  const db=await fixture(options)
  try{
   await db.exec(source('dry-run'))
   const rows=(await db.query('select * from canonical_multitenant_repair_candidates where table_name=\'metering_points\'')).rows
   assert.ok(rows.length>0)
   assert.equal(rows.some(row=>row.classification==='safe_fill_from_parent'),false)
   assert.ok(rows.every(row=>row.classification.startsWith('ambiguous_')||row.classification.startsWith('manual_review_')))
   assert.equal((await pointState(db)).company_id,null)
   assert.deepEqual(await audits(db),[])
  }finally{await db.close()}
 })
 test('actual apply leaves '+name+' and every correlation/audit effect untouched',async()=>{
  const db=await fixture(options)
  try{
   const before=await pointState(db)
   await db.exec(source('apply'))
   assert.deepEqual(await pointState(db),before)
   assert.deepEqual(await audits(db),[])
  }finally{await db.close()}
 })
}
test('all parent agreement gives one audited company repair, one correlation repair and zero replay effects',async()=>{
 const db=await fixture()
 try{
  await db.exec(source('dry-run'))
  const rows=(await db.query('select * from canonical_multitenant_repair_candidates where table_name=\'metering_points\'')).rows
  assert.ok(rows.every(row=>row.classification==='safe_fill_from_parent'))
  await db.exec(source('apply'))
  const after=await pointState(db),first=await audits(db)
  assert.equal(after.company_id,A);assert.match(after.correlation_id,/^[0-9a-f-]{36}$/)
  assert.equal(first.filter(row=>row.action==='canonical_multitenant_company_id_backfill').length,1)
  assert.equal(first.filter(row=>row.action==='canonical_multitenant_correlation_id_backfill').length,1)
  const companyAudit=first.find(row=>row.action==='canonical_multitenant_company_id_backfill')
  assert.deepEqual(companyAudit.old_values,{company_id:null})
  assert.deepEqual(companyAudit.new_values,{company_id:A})
  assert.equal(companyAudit.metadata.safe_derivation,true)
  await db.exec(source('apply'))
  assert.deepEqual(await pointState(db),after);assert.deepEqual(await audits(db),first)
 }finally{await db.close()}
})
test('existing non-null tenant mismatch gets no company, correlation or audit mutation',async()=>{
 const db=await fixture({pointCompany:B})
 try{
  const before=await pointState(db)
  await db.exec(source('apply'))
  assert.deepEqual(await pointState(db),before);assert.deepEqual(await audits(db),[])
 }finally{await db.close()}
})
test('unauthorized caller retains table/repair denial with zero effects',async()=>{
 const db=await fixture()
 try{
  const before=await pointState(db)
  await db.exec('set role authenticated')
  await assert.rejects(db.exec(source('apply')),error=>error.code==='42501')
  await db.exec('rollback;reset role')
  assert.deepEqual(await pointState(db),before);assert.deepEqual(await audits(db),[])
 }finally{await db.close()}
})
test('late audit rejection rolls back the complete company/correlation repair',async()=>{
 const db=await fixture()
 try{
  await db.exec(`create function reject_test_audit() returns trigger language plpgsql as $$begin raise exception 'injected_audit_failure';end$$;
   create trigger reject_test_audit before insert on audit_logs for each row execute function reject_test_audit();`)
  const before=await pointState(db)
  await assert.rejects(db.exec(source('apply')),error=>error.message==='injected_audit_failure')
  await db.exec('rollback')
  assert.deepEqual(await pointState(db),before);assert.deepEqual(await audits(db),[])
 }finally{await db.close()}
})
