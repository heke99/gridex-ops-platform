// Executes the real forward PostgreSQL receipt owner over the existing finite
// synthetic source/storage/review test boundaries. No native/legal claim.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const base=readFileSync(new URL('./ediel-beneficiary-projection-provenance-sql-regression.mjs',import.meta.url),'utf8')
const load=" await db.exec(readFileSync(new URL('../supabase/migrations/20261001022500_ediel_beneficiary_projection_provenance_receipts.sql',import.meta.url),'utf8'))"
assert.equal(base.split(load).length,2)
const forward=String.raw`
 const beforeForward=(await db.query("SELECT oid,proacl FROM pg_proc WHERE oid='public.ediel_beneficiary_series_page_v1(uuid,uuid,uuid,bigint,text,uuid,text[],timestamptz,timestamptz,integer,timestamptz,uuid)'::regprocedure")).rows[0]
 if(process.env.EDIEL_PROJECTION_REPLAY_BASELINE!=='1')await db.exec(readFileSync(new URL('../supabase/migrations/20261001035402_ediel_beneficiary_receipt_read_before_write_replay.sql',import.meta.url),'utf8'))
 const afterForward=(await db.query("SELECT oid,proacl FROM pg_proc WHERE oid='public.ediel_beneficiary_series_page_v1(uuid,uuid,uuid,bigint,text,uuid,text[],timestamptz,timestamptz,integer,timestamptz,uuid)'::regprocedure")).rows[0]
 assert.deepEqual(afterForward,beforeForward)
`
const marker=" console.log('Projection provenance SQL:"
assert.equal(base.split(marker).length,2)
const tripwire=String.raw`
 let replayChecks=0
 const replayCheck=async fn=>{await fn();replayChecks++}
 const replayStable=await effects()
 await db.exec("CREATE FUNCTION gridex_ediel_services.projection_insert_tripwire() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'projection_insert_attempt'; END $$;CREATE TRIGGER projection_insert_tripwire BEFORE INSERT ON gridex_ediel_services.projection_receipts FOR EACH ROW EXECUTE FUNCTION gridex_ediel_services.projection_insert_tripwire()")
 try {
  await replayCheck(async()=>{assert.deepEqual(await pages(),quantityPage);assert.deepEqual(await pages(uid(3),grant2.grantId,'quality-monitoring',['quality']),qualityPage);assert.equal(await receiptCount(),2);assert.deepEqual(await effects(),replayStable)})
  await replayCheck(async()=>{await assert.rejects(pages(uid(2),grant.grantId,'unrelated'),/outside_grant/);await assert.rejects(pages(uid(2),grant.grantId,'analysis',['quality']),/outside_grant/);assert.equal(await receiptCount(),2);assert.deepEqual(await effects(),replayStable)})
  await replayCheck(async()=>{await db.exec('BEGIN');try{await db.exec("UPDATE company_memberships SET is_active=false WHERE company_id='"+uid(2)+"'");await assert.rejects(pages(),/beneficiary_forbidden/)}finally{await db.exec('ROLLBACK')}assert.equal(await receiptCount(),2);assert.deepEqual(await effects(),replayStable)})
  await replayCheck(async()=>{await assert.rejects(db.query('SELECT ediel_beneficiary_series_page_v1($1,$2,$3,2,$4,$5,$6,$7,$8,99)',[uid(2),uid(20),grant.grantId,'analysis',uid(211),['quantity'],'2026-01-01','2026-02-01']),/projection_insert_attempt/);assert.equal(await receiptCount(),2);assert.deepEqual(await effects(),replayStable)})
 } finally {await db.exec('DROP TRIGGER projection_insert_tripwire ON gridex_ediel_services.projection_receipts;DROP FUNCTION gridex_ediel_services.projection_insert_tripwire()')}
 console.log('Projection replay SQL: '+replayChecks+' PASS plus same OID/ACL; real forward owner, bounded synthetic dependencies, NOT native races/legal approval')
`
const text=base.replace(load,()=>load+forward).replace(marker,()=>tripwire+marker).replaceAll('.ediel-projection-provenance','.ediel-projection-replay')
const temp=fileURLToPath(new URL('./.ediel-projection-replay-forward.tmp.mjs',import.meta.url))
writeFileSync(temp,text)
try{const result=spawnSync(process.execPath,[temp],{stdio:'inherit',env:process.env});if(result.error)throw result.error;process.exitCode=result.status??1}finally{unlinkSync(temp)}
