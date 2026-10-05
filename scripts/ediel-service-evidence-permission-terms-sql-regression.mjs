// Actual archive/review functions with finite declared dependencies. Not native.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
let base=readFileSync(new URL('./ediel-service-evidence-sql-regression.mjs',import.meta.url),'utf8')
const marker=" await db.exec(readFileSync(new URL('../supabase/migrations/20261001000926_ediel_service_evidence_archive_review.sql',import.meta.url),'utf8'))"
assert.equal(base.split(marker).length,2)
base=base.replace(marker,()=>` await db.exec("ALTER TABLE ediel_service_evidence ADD IF NOT EXISTS permission_agreement_reference text,ADD IF NOT EXISTS permission_requested_method text;CREATE SCHEMA gridex_metering_method_changes;CREATE FUNCTION gridex_metering_method_changes.requested_method_supported_v1(method text) RETURNS boolean LANGUAGE sql AS 'SELECT $1 IN (''Z03'',''Z04'')'")
`+marker+`
 await db.exec(getFunction(new URL('../supabase/migrations/20260930235816_ediel_service_permission_source_requested_method.sql',import.meta.url),'CREATE OR REPLACE FUNCTION public.ediel_service_administration_command_v1'))
 if(process.env.EDIEL_PERMISSION_TERMS_BASELINE!=='1') await db.exec(readFileSync(new URL('../supabase/migrations/20261001041436_ediel_service_evidence_source_permission_terms.sql',import.meta.url),'utf8'))`)
const proof=String.raw`
 await echeck(async()=>{
  const original=nativeArtifacts[0].submission,reference='SYNTHETIC-UNSIGNED-NEW-TERMS',receipt=JSON.parse(Buffer.from(original.issuerReceipt.payloadBase64,'base64').toString('utf8'))
  receipt.receiptId=uid(700);receipt.sourceReference=reference
  // The authenticated original terms omit both new fields. The independent
  // stage then claims them. Old9terms incorrectly accepted that mismatch.
  const raw=Buffer.from(JSON.stringify(receipt)),submission={...original,source:{...original.source,reference},issuerReceipt:{...original.issuerReceipt,payloadBase64:raw.toString('base64'),signatureHex:createHmac('sha256',syntheticKey).update(raw).digest('hex')}}
  const artifact=await archive(submission),staged=await command({action:'stage_evidence',commandId:uid(701),assignmentId:aid,expectedVersion:2,fields:{kind:'end_user_contract',source_reference:reference,source_sha256:pdfHash,source_version:'synthetic-v1',valid_from:'2000-01-01',valid_to:null,permission_agreement_reference:'UNSIGNED-AGREEMENT',permission_requested_method:'Z04'}})
  assert.equal((await review(artifact,staged.evidenceId)).status,'held','a verified issuer must not authenticate separately claimed agreement/method')
  assert.equal((await db.query('SELECT status FROM ediel_service_evidence WHERE id=$1',[staged.evidenceId])).rows[0].status,'pending')
 })
 await echeck(async()=>{const full=(await db.query("SELECT gridex_ediel_services.evidence_terms_v1(jsonb_populate_record(NULL::public.ediel_service_evidence,'{\"permission_agreement_reference\":\"SIGNED-AGREEMENT-17\",\"permission_requested_method\":\"Z04\"}')) t")).rows[0].t
  assert.equal(full.permission_agreement_reference,'SIGNED-AGREEMENT-17');assert.equal(full.permission_requested_method,'Z04')
  assert.deepEqual(Object.keys(full).sort(),['valid_from','valid_to','permission_agreement_reference','permission_requested_method','permission_purpose_code','permission_reporting_frequency','permission_request_grid_area','permission_reporting_term_kind','permission_customer_classification','permission_termination_reason','permission_termination_at'].sort())
 })
 console.log('Permission agreement/method authentic term forward: 2 actual consumer checks PASS; NOT native')
 console.log('Executed inherited checks: '+checks+' administration + '+scopeChecks+' positive-scope + '+evidenceChecks+' evidence; bounded declared dependencies')
 await db.close();process.exit(0)
`
const end=" console.log('Actual ESCO archived-source/issuer/separate-review/current-grant mechanism: "
assert.equal(base.split(end).length,2);base=base.replace(end,()=>proof+end)
const temp=fileURLToPath(new URL('./.ediel-permission-terms-nested.tmp.mjs',import.meta.url));writeFileSync(temp,base)
try{const run=spawnSync(process.execPath,[temp],{stdio:'inherit',env:process.env});if(run.error)throw run.error;process.exitCode=run.status??1}finally{unlinkSync(temp)}
