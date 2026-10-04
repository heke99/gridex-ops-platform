// Actual PostgreSQL receipt consumer over real service commands with explicitly
// finite synthetic private source/storage/review dependencies. Not native or
// external legal approval; the genuine native full chain is a separate suite.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const original=readFileSync(new URL('./ediel-service-grant-set-sql-regression.mjs',import.meta.url),'utf8')
const marker=' // Restore only the public filtered body and finite dependency context'
assert.equal(original.split(marker).length,2)
const extension=String.raw`
 // Exact physical application and contract version are finite synthetic
 // dependency declarations, not receipts forged into a genuine native owner.
 await db.exec("CREATE SCHEMA gridex_ediel_services;ALTER TABLE gridex_utilts_binding.contracts ADD contract_version integer DEFAULT 1;UPDATE gridex_utilts_binding.contracts SET contract=contract||'{\"version\":1}',contract_hash=encode(sha256(convert_to((contract||'{\"version\":1}')::text,'UTF8')),'hex');")
 await db.query('UPDATE ediel_messages SET raw_payload=replace(raw_payload,$1,$2) WHERE id=$3',["+260930:1200+S'","+260930:1200+S++23-DGI-E66-T'",uid(210)])
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001022500_ediel_beneficiary_projection_provenance_receipts.sql',import.meta.url),'utf8'))
 let provenanceChecks=0
 const provenanceCheck=async fn=>{await fn();provenanceChecks++}
 const pages=async(beneficiary=uid(2),grantId=grant.grantId,purpose='analysis',requested=['quantity'])=>(await beneficiaryPage(beneficiary,grantId,purpose,requested)).rows[0].ediel_beneficiary_series_page_v1
 const receiptCount=async()=>(await db.query('SELECT count(*) n FROM gridex_ediel_services.projection_receipts')).rows[0].n
 let quantityPage,qualityPage
 await provenanceCheck(async()=>{quantityPage=await pages();assert.deepEqual(quantityPage.rows,[{quantity:'17.250'}]);assert.equal(quantityPage.provenance.sourceRole,'DGI');assert.equal(quantityPage.provenance.sourceSenderEdielId,'54321');assert.equal(quantityPage.provenance.sourceMessageId,uid(210));assert.equal(quantityPage.provenance.purpose,'analysis');assert.equal(quantityPage.provenance.qualityOrigin,null);assert.deepEqual(quantityPage.provenance.fields,['quantity']);assert.match(quantityPage.provenance.sourceRawHash,/^[0-9a-f]{64}$/);assert.match(quantityPage.provenance.contractHash,/^[0-9a-f]{64}$/);assert.equal(await receiptCount(),1)})
 await provenanceCheck(async()=>{qualityPage=await pages(uid(3),grant2.grantId,'quality-monitoring',['quality']);assert.deepEqual(qualityPage.rows,[{quality:'56'}]);assert.equal(qualityPage.provenance.sourceRole,'DGI');assert.equal(qualityPage.provenance.sourceRawHash,quantityPage.provenance.sourceRawHash);assert.equal(qualityPage.provenance.contractHash,quantityPage.provenance.contractHash);assert.equal(qualityPage.provenance.qualityOrigin.column,'meter_reading_values.quality');assert.equal(qualityPage.provenance.qualityOrigin.sourceMessageId,uid(210));assert.equal(qualityPage.provenance.purpose,'quality-monitoring');assert.notEqual(qualityPage.consumerReceiptId,quantityPage.consumerReceiptId);assert.equal(await receiptCount(),2)})
 await provenanceCheck(async()=>{const again=await pages();assert.deepEqual(again,quantityPage);assert.equal(await receiptCount(),2);assert.equal(JSON.stringify(quantityPage).includes('raw_payload'),false);assert.equal(JSON.stringify(quantityPage).includes('observations'),false);assert.equal(JSON.stringify(quantityPage).includes('quality":"56'),false)})
 await provenanceCheck(async()=>{await assert.rejects(pages(uid(2),grant.grantId,'unrelated'),/outside_grant/);await assert.rejects(pages(uid(2),grant.grantId,'analysis',['quality']),/outside_grant/);await assert.rejects(pages(uid(2),grant2.grantId,'quality-monitoring',['quality']),/no rows|query returned no rows/);assert.equal(await receiptCount(),2)})
 const provenanceHeld=async(change,pattern)=>{await db.exec('BEGIN');try{await db.exec(change);await assert.rejects(pages(),pattern)}finally{await db.exec('ROLLBACK')}assert.equal(await receiptCount(),2);assert.deepEqual(await pages(),quantityPage)}
 await provenanceCheck(()=>provenanceHeld("UPDATE company_memberships SET is_active=false WHERE company_id='"+uid(2)+"'",/beneficiary_forbidden/))
 await provenanceCheck(()=>provenanceHeld("UPDATE ediel_data_access_grants SET status='revoked',revoked_at=now() WHERE id='"+grant.grantId+"'",/grant_not_current/))
 await provenanceCheck(()=>provenanceHeld("UPDATE tenant_actor_roles SET valid_to=now()",/current_captured_role_unavailable/))
 await provenanceCheck(()=>provenanceHeld("UPDATE gridex_ediel_inbound_context.fixture SET basis=jsonb_set(basis,'{applicationReference}','\"23-DDQ-E66-T\"') WHERE message_id='"+uid(210)+"'",/source_provenance_unavailable/))
 await provenanceCheck(()=>provenanceHeld("UPDATE gridex_utilts_binding.contracts SET contract_hash=repeat('f',64)",/native_origin_unavailable/))
 await provenanceCheck(async()=>{await assert.rejects(db.exec('UPDATE gridex_ediel_services.projection_receipts SET proof=proof'),/receipt_immutable/);await assert.rejects(db.exec('DELETE FROM gridex_ediel_services.projection_receipts'),/receipt_immutable/);await assert.rejects(db.exec('TRUNCATE gridex_ediel_services.projection_receipts'),/receipt_immutable/);assert.equal(await receiptCount(),2)})
 await provenanceCheck(async()=>{const acl=(await db.query("SELECT has_table_privilege('service_role','gridex_ediel_services.projection_receipts','SELECT') r,has_table_privilege('service_role','gridex_ediel_services.projection_receipts','INSERT') w,has_function_privilege('authenticated','public.ediel_beneficiary_series_page_v1(uuid,uuid,uuid,bigint,text,uuid,text[],timestamptz,timestamptz,integer,timestamptz,uuid)','EXECUTE') execute")).rows[0];assert.deepEqual(acl,{r:false,w:false,execute:false})})
 console.log('Projection provenance SQL: '+provenanceChecks+' PASS; actual receipt consumer with finite synthetic source/review/storage dependencies, NOT native/legal approval')
`
const modified=original.replace(marker,()=>extension+marker).replaceAll('.ediel-grant-set-runner.tmp.mjs','.ediel-projection-provenance-runner-inner.tmp.mjs').replaceAll('.ediel-grant-set-consumer.tmp.mjs','.ediel-projection-provenance-consumer.tmp.mjs')
const temp=fileURLToPath(new URL('./.ediel-projection-provenance-runner.tmp.mjs',import.meta.url))
writeFileSync(temp,modified)
try{const result=spawnSync(process.execPath,[temp],{stdio:'inherit',env:process.env});if(result.error)throw result.error;process.exitCode=result.status??1}finally{unlinkSync(temp)}
