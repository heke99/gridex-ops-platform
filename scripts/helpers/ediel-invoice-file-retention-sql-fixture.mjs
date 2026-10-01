import {readFileSync} from 'node:fs'
import {createHash,createHmac} from 'node:crypto'
import assert from 'node:assert/strict'
// Real installed new owner functions; public invoice, Storage metadata, Auth,
// issuer and qualified billing boundaries are finite SYNTHETIC SQL mechanics.
// DELETE of storage.objects is NOT physical Storage/HTTP deletion evidence.
export async function runInvoiceFileRetentionRegression({db,uid,q,call,key,issuer}){
 await db.exec(`CREATE SCHEMA storage;CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text,metadata jsonb);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA storage TO gridex_ediel_retention_owner,authenticated;GRANT SELECT,DELETE ON storage.objects TO authenticated;CREATE POLICY synthetic_storage_read ON storage.objects FOR SELECT TO authenticated USING(true);
 CREATE FUNCTION public.ediel_retention_session_actor_v1() RETURNS uuid LANGUAGE sql AS $$SELECT current_setting('boundary.actor')::uuid$$;
 ALTER TABLE customer_invoices ADD COLUMN pdf_path text,ADD COLUMN pdf_url text,ADD COLUMN period_start date,ADD COLUMN period_end date;
 CREATE TABLE customer_invoice_documents(id uuid PRIMARY KEY,company_id uuid,invoice_id uuid,customer_id uuid,storage_bucket text,file_path text,public_url text,metadata jsonb);CREATE TABLE customer_sites(id uuid,company_id uuid,customer_id uuid);
 ALTER TABLE invoice_documents ADD COLUMN storage_path text;
 `)
 await db.exec(readFileSync(new URL('../../supabase/migrations/20261001071000_ediel_invoice_file_copy_class_retention.sql',import.meta.url),'utf8'))
 for(const file of ['20261001071100_ediel_invoice_customer_document_locator_scope.sql','20261001071200_ediel_finance_copy_closed_export_states.sql'])await db.exec(readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'))
 const c=uid(1),actor=uid(2),reviewer=uid(4),path=`companies/${c}/invoices/owned-finite.pdf`,object=uid(2100),pdf=Buffer.from('%PDF-1.7\nSYNTHETIC bounded file\n%%EOF')
 for(const a of [actor,reviewer])await db.exec(`INSERT INTO boundary_grants VALUES('${c}','${a}','ediel.retention.invoice_copy_evidence',true)`)
 await db.exec(`INSERT INTO storage.objects VALUES('${object}','billing-exports',${q(path)},'${JSON.stringify({boundary:'SYNTHETIC metadata only',size:pdf.length})}');
 UPDATE customer_invoices SET pdf_path=${q('billing-exports/'+path)},period_start='2020-01-01',period_end='2020-02-01' WHERE id='${uid(11)}';
 INSERT INTO customer_invoice_documents VALUES('${uid(2101)}','${c}','${uid(11)}','${uid(3)}','billing-exports',${q(path)},NULL,'{}');
 INSERT INTO invoice_documents(id,company_id,invoice_export_item_id,storage_path) VALUES('${uid(2102)}','${c}','${uid(12)}',${q('billing-exports/'+path)});`)
 const classes=[['customer_invoice_document_pdf_bytes',uid(2101)],['invoice_export_document_pdf_bytes',uid(2102)],['customer_invoice_pdf_bytes',uid(11)]]
 const sources=[]
 for(const [k,target] of classes){
  const l=await call(actor,'ediel_invoice_file_locator_v1',`${q(k)},${q(target)}`)
  await db.exec('SET ROLE service_role')
  try{const s=(await db.query(`SELECT public.ediel_register_invoice_file_source_v1('${c}','${actor}',${q(k)},${q(target)},${q(l.targetHash)},'${object}',${q(createHash('sha256').update(pdf).digest('hex'))},${pdf.length}) b`)).rows[0].b;sources.push(s)}finally{await db.exec('RESET ROLE')}
 }
 // Finished retry/configuration/review attempts still leave their actual item open.
 for(const status of ['FAILED_RETRYABLE','CONFIGURATION_ERROR','NEEDS_REVIEW','DISPUTED']){
  await db.exec(`UPDATE invoice_export_items SET status=${q(status)} WHERE id='${uid(12)}'`)
  assert.equal((await call(actor,'ediel_finance_copy_retention_basis_v1',`'invoice_export_item_body','${uid(12)}'`)).allIncludedScopesClosed,false,status)
  assert.equal((await call(actor,'ediel_invoice_file_retention_basis_v1',`${q(classes[0][0])},${q(classes[0][1])}`)).allIncludedScopesClosed,false,status)
 }
 await db.exec(`UPDATE invoice_export_items SET status='credited' WHERE id='${uid(12)}'`)
 // A URL-only reference to the same object cannot pretend to be a captured copy.
 await db.exec(`INSERT INTO customer_invoice_documents(id,company_id,invoice_id,public_url) VALUES('${uid(2199)}','${c}','${uid(11)}',${q('https://example.invalid/storage/v1/object/public/billing-exports/'+path)})`)
 await assert.rejects(()=>db.query(`SELECT * FROM gridex_ediel_retention.invoice_file_shared_scope_v1('billing-exports',${q(path)})`),/ambiguous_shared_copy_held/)
 await db.exec(`DELETE FROM customer_invoice_documents WHERE id='${uid(2199)}'`)
 // Even a correctly signed receipt cannot substitute a different captured byte length.
 const firstBasis=await call(actor,'ediel_invoice_file_retention_basis_v1',`${q(classes[0][0])},${q(classes[0][1])}`),badDoc=Buffer.from('SYNTHETIC altered exact byte length policy'),badPayload=Buffer.from(JSON.stringify({format:'ediel_invoice_file_retention_policy_v1',...firstBasis,byteLength:pdf.length+1,companyId:c,operation:'delete_storage_pdf',documentHash:createHash('sha256').update(badDoc).digest('hex'),issuerLegalReference:'SYNTHETIC finance competence only',legalBasisReference:'SYNTHETIC exact PDF class',journalPurposeReference:'SYNTHETIC finite retained hash identity',accessRevocationRequired:true,issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),retainUntil:new Date(Date.now()-1000).toISOString(),journalRetainUntil:new Date(Date.now()+3600000).toISOString()})),badReceipt={issuerId:issuer,payloadBase64:badPayload.toString('base64'),signatureHex:createHmac('sha256',key).update(badPayload).digest('hex')}
 const badDecision=await call(actor,'ediel_submit_invoice_file_retention_v1',`${q(classes[0][0])},${q(classes[0][1])},${q(badDoc.toString('base64'))},${q(badReceipt)}`);assert.equal(badDecision.issuerQualified,false);assert.equal((await call(reviewer,'ediel_review_invoice_file_retention_v1',`${q(badDecision.decisionId)},'approve','SYNTHETIC altered length cannot qualify'`)).status,'held')
 const decisions=[]
 for(const [index,[k,target]] of classes.entries()){
  const basis=await call(actor,'ediel_invoice_file_retention_basis_v1',`${q(k)},${q(target)}`)
  assert.equal(basis.allIncludedScopesClosed,true)
  const document=Buffer.from('SYNTHETIC independent exact copy policy '+k),payload=Buffer.from(JSON.stringify({format:'ediel_invoice_file_retention_policy_v1',...basis,companyId:c,operation:'delete_storage_pdf',documentHash:createHash('sha256').update(document).digest('hex'),issuerLegalReference:'SYNTHETIC finance competence only',legalBasisReference:'SYNTHETIC exact PDF class',journalPurposeReference:'SYNTHETIC finite retained hash identity',accessRevocationRequired:true,issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),retainUntil:new Date(Date.now()-1000).toISOString(),journalRetainUntil:new Date(Date.now()+3600000).toISOString()})),receipt={issuerId:issuer,payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',key).update(payload).digest('hex')}
  const d=await call(actor,'ediel_submit_invoice_file_retention_v1',`${q(k)},${q(target)},${q(document.toString('base64'))},${q(receipt)}`);assert.equal(d.issuerQualified,true)
  await assert.rejects(()=>call(actor,'ediel_review_invoice_file_retention_v1',`${q(d.decisionId)},'approve','SYNTHETIC'`),/separate_reviewer/)
  if(index===2)await assert.rejects(()=>call(actor,'ediel_begin_invoice_file_purge_v1',`${q(decisions[0])}`),/each_copy_current_legal_review/)
  assert.equal((await call(reviewer,'ediel_review_invoice_file_retention_v1',`${q(d.decisionId)},'approve','SYNTHETIC independent reviewer'`)).status,'approved');decisions.push(d.decisionId)
 }
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_ediel_retention.invoice_file_tombstones')).rows[0].n,0)
 await db.exec(`INSERT INTO boundary_grants VALUES('${c}','${reviewer}','ediel.retention.review',false)`)
 await assert.rejects(()=>call(actor,'ediel_begin_invoice_file_purge_v1',`${q(decisions[0])}`),/current_legal_review/)
 await db.exec(`DELETE FROM boundary_grants WHERE actor='${reviewer}' AND NOT allowed`)
 await db.exec(`CREATE FUNCTION public.synthetic_last_pdf_tombstone_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.source_id='${sources[2].sourceId}' THEN RAISE EXCEPTION 'SYNTHETIC_LAST_PDF_TOMBSTONE_FAILURE';END IF;RETURN NEW;END$$;CREATE TRIGGER synthetic_last_pdf_failure BEFORE INSERT ON gridex_ediel_retention.invoice_file_tombstones FOR EACH ROW EXECUTE FUNCTION public.synthetic_last_pdf_tombstone_failure()`)
 await assert.rejects(()=>call(actor,'ediel_begin_invoice_file_purge_v1',`${q(decisions[0])}`),/SYNTHETIC_LAST_PDF_TOMBSTONE_FAILURE/)
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_ediel_retention.invoice_file_tombstones')).rows[0].n,0)
 await db.exec('DROP TRIGGER synthetic_last_pdf_failure ON gridex_ediel_retention.invoice_file_tombstones')
 const begun=await call(actor,'ediel_begin_invoice_file_purge_v1',`${q(decisions[0])}`);assert.equal(begun.status,'storage_purge_pending')
 await assert.rejects(()=>call(actor,'ediel_finish_invoice_file_purge_v1',`${q(decisions[0])}`),/still_present/)
 await db.exec(`SET boundary.actor='${actor}';SET ROLE authenticated`)
 try{await db.exec(`DELETE FROM storage.objects WHERE id='${object}'`)}finally{await db.exec('RESET ROLE')}
 assert.equal((await db.query(`SELECT count(*)::int n FROM gridex_ediel_retention.invoice_file_events WHERE kind='storage_delete_authorized'`)).rows[0].n,3)
 assert.equal((await call(actor,'ediel_finish_invoice_file_purge_v1',`${q(decisions[0])}`)).bytesAvailable,false)
 assert.equal((await call(actor,'ediel_begin_invoice_file_purge_v1',`${q(decisions[0])}`)).replay,true)
 await assert.rejects(()=>db.exec(`INSERT INTO storage.objects VALUES('${object}','billing-exports',${q(path)},'{}')`),/original_immutable/)
 await assert.rejects(()=>db.exec(`UPDATE customer_invoice_documents SET file_path='restore.pdf' WHERE id='${uid(2101)}'`),/reference_immutable/)
 for(const [k,target] of classes)await assert.rejects(()=>db.query(`SELECT public.ediel_require_invoice_file_copy_available_v1('${c}',${q(k)},${q(target)})`),/tombstoned/)
 for(const role of ['anon','authenticated','service_role']){await db.exec('SET ROLE '+role);await assert.rejects(()=>db.query('SELECT * FROM gridex_ediel_retention.invoice_file_decisions'),/permission denied/);await db.exec('RESET ROLE')}
 console.log('PASS actual three independent PDF copy source/issuer policies/separate reviewer/currentDENY/shared references/late rollback/metadata delete authorization/receipt replay/no restore/private ACL. Storage metadata/Auth/billing/issuer boundaries SYNTHETIC, NOT native replay, physical erasure or legal approval.')
}
