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

 const currentGrantResults=[]
 const currentGrantSnapshot=async()=>{
  const tables=(await db.query("SELECT schemaname,tablename FROM pg_catalog.pg_tables WHERE schemaname='public' OR schemaname LIKE 'gridex_%' ORDER BY schemaname,tablename")).rows
  const rows={}
  for(const table of tables){
   const identifier=value=>'"'+value.replaceAll('"','""')+'"'
   rows[table.schemaname+'.'+table.tablename]=(await db.query('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),\'[]\'::jsonb) state FROM '+identifier(table.schemaname)+'.'+identifier(table.tablename)+' t')).rows[0].state
  }
  return rows
 }
 const currentGrantCheck=async(name,fn)=>{await fn();currentGrantResults.push(name)}
 const currentGrantPage=async()=>{
  const version=(await db.query('SELECT version FROM ediel_data_access_grants WHERE id=$1',[grant.grantId])).rows[0].version
  return db.query('SELECT ediel_beneficiary_series_page_v1($1,$2,$3,$4,$5,$6,$7,$8,$9)',[uid(2),uid(20),grant.grantId,version,'analysis',uid(211),['quantity'],'2026-01-01','2026-02-01'])
 }
 const currentGrantRefusal=async(fn,pattern)=>{
  await db.exec('SAVEPOINT current_grant_refusal')
  try{await assert.rejects(fn,pattern)}finally{await db.exec('ROLLBACK TO SAVEPOINT current_grant_refusal;RELEASE SAVEPOINT current_grant_refusal')}
 }
 const currentGrantHeld=async(change,pattern,read=()=>pages())=>{
  await db.exec('BEGIN')
  try {
   await db.exec(change)
   const before=await currentGrantSnapshot()
   await currentGrantRefusal(read,pattern)
   assert.deepEqual(await currentGrantSnapshot(),before,'refused read must preserve every finite-fixture row')
  }finally{await db.exec('ROLLBACK')}
  assert.deepEqual(await pages(),quantityPage,'rollback must retain the same positive receipt')
 }
 await currentGrantCheck('positive-current-read-and-retained-receipt',async()=>{
  assert.deepEqual(await pages(),quantityPage)
  assert.deepEqual(await pages(uid(3),grant2.grantId,'quality-monitoring',['quality']),qualityPage)
  assert.equal(await receiptCount(),2)
 })
 await currentGrantCheck('stale-version-denied-with-zero-row-effects',()=>currentGrantHeld("UPDATE ediel_data_access_grants SET valid_from='2001-01-01' WHERE id='"+grant.grantId+"'",/ediel_grant_not_current/))
 await currentGrantCheck('expired-grant-denied-with-zero-row-effects',()=>currentGrantHeld("UPDATE ediel_data_access_grants SET valid_to='2002-01-01' WHERE id='"+grant.grantId+"'",/ediel_grant_not_current/,currentGrantPage))
 await currentGrantCheck('revoked-beneficiary-membership-denied-with-zero-row-effects',()=>currentGrantHeld("UPDATE company_memberships SET is_active=false WHERE company_id='"+uid(2)+"'",/ediel_beneficiary_forbidden/))
 await currentGrantCheck('revoked-upstream-evidence-denied-with-zero-row-effects',()=>currentGrantHeld("UPDATE ediel_service_evidence SET status='revoked' WHERE assignment_id='"+aid+"' AND kind='dso_contract'",/ediel_assignment_not_authorized/))
 // Use the existing command owner, rather than substituting a fabricated
 // successful revocation result or permanently UPDATEing the grant ourselves.
 const revokeInput={action:'revoke_grant',commandId:uid(701),assignmentId:aid,
  expectedVersion:(await db.query('SELECT version FROM ediel_service_assignments WHERE id=$1',[aid])).rows[0].version,
  grantId:grant.grantId,expectedGrantVersion:quantityPage.grantVersion}
 await db.exec('BEGIN')
 try {
  const beforeRevocation=await currentGrantSnapshot()
  const revoked=await command(revokeInput)
  await currentGrantCheck('actual-revoke-command-advances-own-version',async()=>{
   assert.equal(revoked.status,'revoked');assert.equal(revoked.accessGranted,false)
   assert.equal(revoked.grantId,quantityPage.grantId)
   assert.ok(Number(revoked.grantVersion)>quantityPage.grantVersion)
   const own=(await db.query('SELECT status,version,revoked_at FROM ediel_data_access_grants WHERE id=$1',[grant.grantId])).rows[0]
   assert.equal(own.status,'revoked');assert.equal(Number(own.version),Number(revoked.grantVersion));assert.ok(own.revoked_at)
   const after=await currentGrantSnapshot()
   for(const table of Object.keys(beforeRevocation)){
    if(!['public.ediel_data_access_grants','public.ediel_service_history','gridex_service_administration.commands'].includes(table))assert.deepEqual(after[table],beforeRevocation[table],table+' must remain unchanged on own revocation')
   }
   const beforeGrants=beforeRevocation['public.ediel_data_access_grants'],afterGrants=after['public.ediel_data_access_grants']
   assert.equal(afterGrants.length,beforeGrants.length)
   assert.deepEqual(afterGrants.filter(row=>row.id!==grant.grantId),beforeGrants.filter(row=>row.id!==grant.grantId))
   const oldGrant=beforeGrants.find(row=>row.id===grant.grantId),newGrant=afterGrants.find(row=>row.id===grant.grantId)
   assert.equal(Number(newGrant.version),Number(oldGrant.version)+1)
   assert.equal(newGrant.updated_at,newGrant.revoked_at,'revocation and scope update share the command transaction time')
   assert.deepEqual({...newGrant,status:oldGrant.status,revoked_at:oldGrant.revoked_at,version:oldGrant.version,updated_at:oldGrant.updated_at},oldGrant)
   const history=after['public.ediel_service_history'],oldHistory=beforeRevocation['public.ediel_service_history']
   assert.deepEqual(history.filter(row=>oldHistory.some(old=>old.id===row.id)),oldHistory)
   const appendedHistory=history.filter(row=>!oldHistory.some(old=>old.id===row.id))
   assert.equal(appendedHistory.length,1,'one exact own grant transition must be audited')
   assert.equal(appendedHistory[0].entity_table,'ediel_data_access_grants')
   assert.equal(appendedHistory[0].entity_id,grant.grantId);assert.equal(appendedHistory[0].company_id,uid(1))
   assert.deepEqual(appendedHistory[0].before_record,oldGrant);assert.deepEqual(appendedHistory[0].after_record,newGrant)
   assert.ok(appendedHistory[0].recorded_at)
   const commands=after['gridex_service_administration.commands'],oldCommands=beforeRevocation['gridex_service_administration.commands']
   assert.deepEqual(commands.filter(row=>row.command_id!==revokeInput.commandId),oldCommands)
   const appendedCommands=commands.filter(row=>row.command_id===revokeInput.commandId)
   assert.equal(appendedCommands.length,1);assert.equal(appendedCommands[0].company_id,uid(1));assert.equal(appendedCommands[0].actor_user_id,uid(20))
   assert.deepEqual(appendedCommands[0].input,revokeInput);assert.deepEqual(appendedCommands[0].result,revoked)
  })
  const revokedState=await currentGrantSnapshot()
  await currentGrantCheck('cached-previous-page-cannot-authorize-a-new-read',async()=>{
   assert.deepEqual(quantityPage.rows,[{quantity:'17.250'}])
   await currentGrantRefusal(()=>pages(),/ediel_grant_not_current/)
   await currentGrantRefusal(()=>pages(),/ediel_grant_not_current/)
   await currentGrantRefusal(currentGrantPage,/ediel_grant_not_current/)
   assert.deepEqual(await currentGrantSnapshot(),revokedState)
  })
  await currentGrantCheck('revoke-replay-preserves-exact-result-and-all-rows',async()=>{
   assert.deepEqual(await command(revokeInput),revoked)
   assert.deepEqual(await currentGrantSnapshot(),revokedState)
  })
  await currentGrantCheck('independent-beneficiary-retains-own-quality-only-read',async()=>{
   assert.deepEqual(await pages(uid(3),grant2.grantId,'quality-monitoring',['quality']),qualityPage)
   await currentGrantRefusal(()=>pages(uid(3),grant.grantId,'analysis',['quantity']),/no rows|query returned no rows/)
   assert.deepEqual(await currentGrantSnapshot(),revokedState)
  })
 }finally{await db.exec('ROLLBACK')}
 assert.deepEqual(await pages(),quantityPage)
 console.log('SC010_SC071_CURRENT_GRANT_RESULT '+JSON.stringify({checks:currentGrantResults,
  boundary:'existing SQL owners with finite actor/source/issuer/storage fixtures',
  leasedExportWorker:'NOT_EXERCISED',nativeConcurrency:'NOT_EXERCISED',wholeScenarios:'NOT_APPROVED'}))
 console.log('Projection replay SQL: '+replayChecks+' PASS plus same OID/ACL; real forward owner, bounded synthetic dependencies, NOT native races/legal approval')
`
const text=base.replace(load,()=>load+forward).replace(marker,()=>tripwire+marker).replaceAll('.ediel-projection-provenance','.ediel-sc010-sc071-current-grant')
const temp=fileURLToPath(new URL('./.ediel-sc010-sc071-current-grant-forward.tmp.mjs',import.meta.url))
writeFileSync(temp,text)
try{const result=spawnSync(process.execPath,[temp],{stdio:'inherit',env:process.env});if(result.error)throw result.error;process.exitCode=result.status??1}finally{unlinkSync(temp)}
