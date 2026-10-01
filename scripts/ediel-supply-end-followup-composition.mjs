// Composes the real own supply receipts/getter with the operational command.
// Uses the parent harness's declared synthetic canonical/legal boundary ports.
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
let checks=0,created
export default async function compose({phase,db,id,sourceId,ended,initialSourceId,run,incomingSource,objects}){
 const command=async(receipt,company=id(1),actor=id(2))=>{
  await db.exec('SET ROLE service_role')
  try{return(await db.query('SELECT public.ediel_project_supply_end_followup_v1($1,$2,$3) b',[company,receipt,actor])).rows[0].b}finally{await db.exec('RESET ROLE')}
 }
 const receipt=ended.effectReceiptIds[0]
 if(phase==='birth'){
  const schema=readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8')
  const start=schema.indexOf('CREATE TABLE public.customer_cases (')
  assert(start>=0)
  await db.exec(schema.slice(start,schema.indexOf('\n);',start)+3))
  await db.exec('ALTER TABLE public.customer_cases ADD CONSTRAINT customer_cases_pkey PRIMARY KEY(id)')
  await db.exec(readFileSync(new URL('../supabase/migrations/20261001054018_ediel_supply_end_followup_receipt_command.sql',import.meta.url),'utf8'));checks++
  const initial=(await db.query('SELECT gridex_received_sources.committed_supply_effects_v1($1,$2) b',[id(1),initialSourceId])).rows[0].b[0].receiptId
  assert.equal((await command(initial)).status,'not_applicable');checks++
  await assert.rejects(command(receipt,id(99)),/own_receipt_required/);checks++
  await db.exec("UPDATE company_memberships SET status='inactive'")
  await assert.rejects(command(receipt),/execution_actor_unqualified/);checks++
  await db.exec("UPDATE company_memberships SET status='active'")
  await db.exec("CREATE FUNCTION public.fail_followup_fixture() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'declared_followup_link_failure';END$$;CREATE TRIGGER fail_followup BEFORE INSERT ON gridex_received_sources.supply_end_followups FOR EACH ROW EXECUTE FUNCTION public.fail_followup_fixture()")
  await assert.rejects(command(receipt),/declared_followup_link_failure/);checks++
  assert.equal((await db.query('SELECT count(*)::int n FROM customer_cases')).rows[0].n,0);checks++
  await db.exec('DROP TRIGGER fail_followup ON gridex_received_sources.supply_end_followups')
  created=await command(receipt);assert.equal(created.status,'created');checks++
  const task=(await db.query('SELECT * FROM customer_cases WHERE id=$1',[created.caseId])).rows[0]
  assert.equal(task.customer_id,id(3));assert.equal(task.metering_point_id,id(5));assert.equal(task.site_id,id(4));assert.equal(task.supplier_switch_request_id,id(10));checks++
  assert.equal(task.reason_category,'final_metering_and_billing');assert.equal(task.metadata.supply_period_id,ended.periods[0].id);assert.equal(task.metadata.effect_receipt_id,receipt);checks++
  await db.query("UPDATE customer_cases SET status='closed' WHERE id=$1",[created.caseId])
  assert.equal((await command(receipt)).status,'existing');assert.equal((await db.query('SELECT status FROM customer_cases WHERE id=$1',[created.caseId])).rows[0].status,'closed');checks++
  await assert.rejects(db.exec('UPDATE gridex_received_sources.supply_end_followups SET created_at=now()'),/immutable/);checks++
  await db.exec('SET ROLE service_role');await assert.rejects(db.query('SELECT * FROM gridex_received_sources.supply_end_followups'),/permission denied/);await db.exec('RESET ROLE');checks++
 }else{
  // The real parent Z05C source has now restored the first period. Existing
  // operational truth remains; it is never reopened or granted new authority.
  assert.equal((await command(receipt)).caseId,created.caseId);checks++
  // A second genuine end subsequently restored BEFORE projection cannot mint
  // a stale new final-billing task. All business writes still use actual owner.
  await incomingSource(id(601),id(602),'Z05',[{...objects[3],start:'202701010000'}]);const end=(await run(id(601))).rows[0].b;assert.equal(end.applied,true)
  await incomingSource(id(603),id(604),'Z05',[{...objects[3],reason:'Z24',start:'202701010000'}]);assert.equal((await run(id(603))).rows[0].b.applied,true)
  assert.equal((await command(end.effectReceiptIds[0])).reason,'own_end_no_longer_current');checks++
  assert.equal((await db.query('SELECT count(*)::int n FROM customer_cases')).rows[0].n,1);checks++
  console.log(JSON.stringify({checks,status:'PASS',scope:'actual own-end receipt to idempotent operational task; no native acceptance claim'}))
 }
}
