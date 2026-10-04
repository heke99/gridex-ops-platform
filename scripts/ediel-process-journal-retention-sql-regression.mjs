// Called by ediel-record-retention-sql-regression.mjs: actual SQL with bounded
// synthetic schema/issuer/provider/closure/Auth-bridge boundaries, NOT native.
import {createHash,createHmac} from 'node:crypto'
import assert from 'node:assert/strict'
export async function runProcessJournalRetentionSqlRegression({db,uid,quote,grant,authenticatedCall,service,retentionKey}){
 await grant(uid(2),['ediel.retention.read','ediel.retention.legal_history']);await grant(uid(30),['ediel.retention.read','ediel.retention.legal_history'])
 const call=(actor,name,args)=>authenticatedCall(actor,`SELECT public.${name}('${uid(1)}','${actor}',${args}) b`)
 const basis=(k,id)=>call(uid(2),'ediel_process_journal_retention_basis_v1',`${quote(k)},${quote(id)}`)
 const submit=(k,id,doc,token)=>call(uid(2),'ediel_submit_process_journal_retention_v1',`${quote(k)},${quote(id)},${quote(doc.toString('base64'))},${token?quote(token):'NULL'}`)
 const review=(id,actor=uid(30))=>call(actor,'ediel_review_process_journal_retention_v1',`'${id}','approve','SYNTHETIC separate own source review'`)
 const purge=id=>call(uid(2),'ediel_purge_process_journal_retention_v1',`'${id}'`)
 const policy=async(k,id,doc,patch={})=>{
  const b=await basis(k,id),operation={correction_process_fact_body:'redact_process_fact_body',correction_process_readset_body:'redact_process_readset_body',correction_process_combined_readset_body:'redact_process_combined_readset_body'}[k]
  const bytes=Buffer.from(JSON.stringify({format:'ediel_process_journal_retention_policy_v1',...b,operation,companyId:uid(1),documentHash:createHash('sha256').update(doc).digest('hex'),issuerLegalReference:'SYNTHETIC LEGAL COMPETENCE TEST ONLY',legalBasisReference:'SYNTHETIC class-only legal decision',journalPurposeReference:'SYNTHETIC separate bounded process journal purpose',accessRevocationRequired:true,issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),retainUntil:new Date(Date.now()-1000).toISOString(),journalRetainUntil:new Date(Date.now()+3600000).toISOString(),...patch}))
  return {issuerId:uid(50),payloadBase64:bytes.toString('base64'),signatureHex:createHmac('sha256',retentionKey).update(bytes).digest('hex')}
 }
 await db.exec(`INSERT INTO customer_contracts(id,company_id,customer_id,status,signature_snapshot) VALUES('${uid(1400)}','${uid(1)}','${uid(200)}','signed','{"synthetic":"actual-capture"}')`)
 const fact=(await db.query(`SELECT id::text,facts_hash FROM gridex_correction_process.facts WHERE row_id='${uid(1400)}' ORDER BY id DESC LIMIT 1`)).rows[0]
 await db.exec(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_active bool DEFAULT true;INSERT INTO boundary_permissions(actor,company,permission,allowed) VALUES('${uid(2)}','${uid(1)}','customers.read',true);UPDATE companies SET status='active' WHERE id='${uid(1)}'`)
 const visibility=(await service(`SELECT public.gridex_witness_correction_process_fact_v1('${uid(1)}',${fact.id},'${fact.facts_hash}','${uid(2)}') b`)).rows[0].b;assert.equal(visibility.authority,'none');assert.equal(visibility.factsHash,fact.facts_hash)
 await db.exec(`UPDATE companies SET status='archived' WHERE id='${uid(1)}'`)
 const metadata=(await db.query(`SELECT to_jsonb(f)-'old_fact'-'new_fact' b FROM gridex_correction_process.facts f WHERE id=${fact.id}`)).rows[0].b
 assert.equal((await basis('correction_process_fact_body',fact.id)).allIncludedScopesClosed,true)
 await db.exec(`INSERT INTO customers(id,company_id,status) VALUES('${uid(1409)}','${uid(1)}','active')`)
 const scopedBody={companyId:uid(1),customerId:uid(200),process:{facts:[{id:fact.id,old:null,new:{customer_id:uid(200),contract_id:uid(1400)},factsHash:fact.facts_hash}],complete:false,authority:'none'}}
 for(const [table,id,body]of [['readsets',uid(1401),scopedBody],['combined_snapshots',uid(1402),{...scopedBody,source:{readsetText:JSON.stringify({companyId:uid(1),customerId:uid(200)})}}],['readsets',uid(1403),{companyId:uid(1),complete:false,authority:'none'}],['combined_snapshots',uid(1404),{companyId:uid(1),customerId:uid(200),source:{readsetText:JSON.stringify({companyId:uid(1),customerId:uid(1409)})}}]]){
  const bytes=JSON.stringify(body),cols=table==='readsets'?',customer_id':',subject_message_id,visibility_snapshot',values=table==='readsets'?`,${id===uid(1403)?'NULL':quote(uid(200))}`:`,'${uid(7)}',pg_current_snapshot()::text`
  await db.exec(`INSERT INTO gridex_correction_process.${table}(id,company_id,environment,cutoff_at,readset_text,readset_hash${cols}) VALUES('${id}','${uid(1)}','production',now(),${quote(bytes)},encode(sha256(convert_to(${quote(bytes)},'UTF8')),'hex')${values})`)
 }
 const noIssuer=await submit('correction_process_fact_body',fact.id,Buffer.from('SYNTHETIC no issuer'),null);assert.equal(noIssuer.issuerQualified,false);assert.equal((await review(noIssuer.decisionId)).status,'held');assert.equal((await purge(noIssuer.decisionId)).status,'held')
 const mixed=await basis('correction_process_combined_readset_body',uid(1404));assert.equal(mixed.allIncludedScopesClosed,false);assert.ok(mixed.includedCustomers.includes(uid(200)));assert.ok(mixed.includedCustomers.includes(uid(1409)))
 const wildcard=await basis('correction_process_readset_body',uid(1403));assert.equal(wildcard.unknownScopeExpandedToCompany,true);assert.equal(wildcard.allIncludedScopesClosed,false)
 await db.exec(`INSERT INTO companies(id,status) VALUES('${uid(1499)}','archived');INSERT INTO customers(id,company_id,status) VALUES('${uid(1498)}','${uid(1499)}','archived');INSERT INTO gridex_correction_process.readsets(id,company_id,environment,cutoff_at,customer_id,readset_text,readset_hash) VALUES('${uid(1497)}','${uid(1)}','production',now(),'${uid(200)}',${quote(JSON.stringify({companyId:uid(1),customerId:uid(1498)}))},encode(sha256(convert_to(${quote(JSON.stringify({companyId:uid(1),customerId:uid(1498)}))},'UTF8')),'hex'))`)
 await assert.rejects(()=>basis('correction_process_readset_body',uid(1497)),/foreign_included_scope/)
 await db.exec(`UPDATE customers SET status='archived' WHERE id='${uid(1409)}'`)
 for(const[k,id]of [['correction_process_fact_body',fact.id],['correction_process_readset_body',uid(1401)],['correction_process_combined_readset_body',uid(1402)]]){
  const doc=Buffer.from('SYNTHETIC exact separate '+k),d=await submit(k,id,doc,await policy(k,id,doc));assert.equal(d.issuerQualified,true)
  await assert.rejects(()=>review(d.decisionId,uid(2)),/separate_reviewer_required/);assert.equal((await review(d.decisionId)).status,'approved')
  const original=await call(uid(30),'ediel_read_process_journal_retention_v1',`'${d.decisionId}'`);assert.deepEqual(Buffer.from(original.documentBase64,'base64'),doc)
  await db.exec(`INSERT INTO user_permission_overrides(user_id,company_id,permission_key,effect,is_active) VALUES('${uid(30)}','${uid(1)}','ediel.retention.legal_history','deny',true)`);assert.equal((await purge(d.decisionId)).status,'held');await db.exec(`DELETE FROM user_permission_overrides WHERE user_id='${uid(30)}'`)
  const before=(await db.query('SELECT count(*)::int n FROM gridex_ediel_retention.process_tombstones')).rows[0].n
  await db.exec(`CREATE FUNCTION public.process_late_block() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='ediel.retention.process_redacted' THEN RAISE EXCEPTION 'actual late process audit rollback';END IF;RETURN NEW;END$$;CREATE TRIGGER process_late_block BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION public.process_late_block()`)
  await assert.rejects(()=>purge(d.decisionId),/late process audit rollback/);assert.equal((await db.query('SELECT count(*)::int n FROM gridex_ediel_retention.process_tombstones')).rows[0].n,before);await db.exec('DROP TRIGGER process_late_block ON audit_logs;DROP FUNCTION public.process_late_block()')
  const p=await purge(d.decisionId);assert.equal(p.status,'redacted');assert.equal((await purge(d.decisionId)).replay,true)
  await assert.rejects(()=>service(`SELECT public.ediel_require_process_journal_available_v1('${uid(1)}',${quote(k)},${quote(id)})`),/tombstoned/)
  await assert.rejects(()=>db.exec(`UPDATE gridex_correction_process.${k==='correction_process_fact_body'?'facts':k==='correction_process_readset_body'?'readsets':'combined_snapshots'} SET ${k==='correction_process_fact_body'?"new_fact='{}'":"readset_text='{}'"} WHERE id=${quote(id)}`),/append_only|tombstoned/)
 }
 assert.deepEqual((await db.query(`SELECT to_jsonb(f)-'old_fact'-'new_fact' b FROM gridex_correction_process.facts f WHERE id=${fact.id}`)).rows[0].b,metadata)
 assert.equal((await db.query(`SELECT count(*)::int n FROM gridex_ediel_retention.process_events WHERE target_id IN('${fact.id}','${uid(1401)}','${uid(1402)}')`)).rows[0].n,3)
 await db.exec(`UPDATE companies SET status='active' WHERE id='${uid(1)}'`)
 const replay=(await service(`SELECT public.gridex_witness_correction_process_fact_v1('${uid(1)}',${fact.id},'${fact.facts_hash}','${uid(2)}') b`)).rows[0].b;assert.equal(replay.witnessId,visibility.witnessId);assert.equal(replay.retentionUnavailable,true);assert.equal(replay.bytesAvailable,false);assert.equal(replay.authority,'none')
 const purgedUnwitnessed=(await db.query(`SELECT t.target_id,t.source_hash FROM gridex_ediel_retention.process_tombstones t WHERE retention_class='correction_process_fact_body' AND target_id<>${quote(fact.id)} ORDER BY target_id LIMIT 1`)).rows[0]
 await assert.rejects(()=>service(`SELECT public.gridex_witness_correction_process_fact_v1('${uid(1)}',${purgedUnwitnessed.target_id},'${purgedUnwitnessed.source_hash}','${uid(2)}')`),/tombstoned/)
 await assert.rejects(()=>db.exec(`INSERT INTO gridex_correction_process.witnesses(fact_id,company_id,facts_hash) VALUES(${purgedUnwitnessed.target_id},'${uid(1)}','${purgedUnwitnessed.source_hash}')`),/tombstoned/)
 await db.exec(`UPDATE companies SET status='archived' WHERE id='${uid(1)}'`)
 // Correct 012305's overbroad ANY-customer guard: an independent newly
 // collected contract remains usable although old history is tombstoned.
 await db.exec(`INSERT INTO customer_contracts(id,company_id,customer_id,status,signature_snapshot) VALUES('${uid(1405)}','${uid(1)}','${uid(200)}','signed','{"synthetic":"independent"}');INSERT INTO ediel_messages(id,company_id,customer_id,environment,direction,message_standard,message_family,message_code,raw_payload) VALUES('${uid(1406)}','${uid(1)}','${uid(200)}','production','outbound','edifact','PRODAT','Z03','SYNTHETIC unknown transport original');INSERT INTO gridex_received_sources.switch_originals VALUES('${uid(1406)}','${uid(1)}','${uid(1405)}')`)
 await service(`SELECT public.ediel_require_message_consumed_records_v1('${uid(1)}','${uid(1406)}')`)
 await service(`SELECT gridex_ediel_transport.mutate_v1(${quote({action:'prepare',companyId:uid(1),messageId:uid(1406)})})`)
 await db.exec(`INSERT INTO gridex_received_sources.normal_switch_confirmations VALUES('${uid(1407)}','${uid(1)}','${uid(1405)}','${uid(1406)}','${uid(1406)}')`)
 await db.exec(`INSERT INTO gridex_received_sources.normal_supply_activations VALUES('${uid(1407)}','${uid(1)}','${uid(1406)}')`)
 await assert.rejects(()=>db.exec(`INSERT INTO gridex_received_sources.normal_switch_confirmations VALUES('${uid(1408)}','${uid(1)}','${uid(201)}','${uid(1406)}','${uid(1406)}')`),/records_retention_tombstoned/)
 await db.exec(`INSERT INTO customer_portal_accounts(company_id,customer_id,status,is_active,created_at) VALUES('${uid(1)}','${uid(200)}','active',true,clock_timestamp());INSERT INTO customer_portal_claims(company_id,customer_id,status,created_at) VALUES('${uid(1)}','${uid(200)}','approved',clock_timestamp())`)
 await service(`SELECT public.ediel_require_portal_retention_access_v1('${uid(1)}','${uid(200)}')`)
 // The actual source capture must produce its own immutable retention origin,
 // while ordinary updates keep capturing. No general trigger-disable bypass.
 const recordDoc=Buffer.from('SYNTHETIC exact signature retention origin'),recordBasis=(await db.query(`SELECT gridex_ediel_retention.record_basis_v1('${uid(1)}','contract_signature_personal_snapshot','${uid(1405)}') b`)).rows[0].b
 const recordBytes=Buffer.from(JSON.stringify({format:'ediel_customer_record_retention_policy_v1',...recordBasis,companyId:uid(1),documentHash:createHash('sha256').update(recordDoc).digest('hex'),issuerLegalReference:'SYNTHETIC LEGAL COMPETENCE TEST ONLY',legalBasisReference:'SYNTHETIC signature source only',journalPurposeReference:'SYNTHETIC separately finite origin purpose',accessRevocationRequired:true,issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),retainUntil:new Date(Date.now()-1000).toISOString(),journalRetainUntil:new Date(Date.now()+3600000).toISOString()}))
 const recordToken={issuerId:uid(50),payloadBase64:recordBytes.toString('base64'),signatureHex:createHmac('sha256',retentionKey).update(recordBytes).digest('hex')}
 const record=await call(uid(2),'ediel_submit_customer_record_retention_v1',`'contract_signature_personal_snapshot','${uid(1405)}',${quote(recordDoc.toString('base64'))},${quote(recordToken)}`);assert.equal(record.issuerQualified,true)
 assert.equal((await call(uid(30),'ediel_review_customer_record_retention_v1',`'${record.decisionId}','approve','SYNTHETIC separate exact source signature'`)).status,'approved')
 const factsBefore=(await db.query(`SELECT count(*)::int n FROM gridex_correction_process.facts WHERE row_id='${uid(1405)}'`)).rows[0].n
 assert.equal((await call(uid(2),'ediel_begin_customer_record_retention_v1',`'${record.decisionId}'`)).status,'redacted')
 assert.equal((await db.query(`SELECT count(*)::int n FROM gridex_correction_process.facts WHERE row_id='${uid(1405)}'`)).rows[0].n,factsBefore)
 assert.equal((await db.query(`SELECT count(*)::int n FROM gridex_ediel_retention.process_retention_origins WHERE target_id='${uid(1405)}' AND decision_id='${record.decisionId}'`)).rows[0].n,1)
 const effectsBefore=(await db.query('SELECT count(*)::int n FROM provider_effects')).rows[0].n
 await assert.rejects(()=>service(`SELECT gridex_ediel_transport.mutate_v1(${quote({action:'prepare',companyId:uid(1),messageId:uid(1406)})})`),/records_retention_tombstoned/)
 assert.equal((await db.query('SELECT count(*)::int n FROM provider_effects')).rows[0].n,effectsBefore)
 for(const role of ['anon','authenticated','service_role']){await db.exec('SET ROLE '+role);for(const table of ['process_decisions','process_tombstones','process_retention_origins'])await assert.rejects(()=>db.query('SELECT * FROM gridex_ediel_retention.'+table),/permission denied/);await db.exec('RESET ROLE')}
 console.log('PASS actual three process-journal class SQL: exact native source/whole scope/HMAC/separate reviewer/deadline/current deny/private ACL/late rollback/no restore; unknown company-wide and included active scopes hold; independent collected contract/portal can operate without reviving tombstoned history. Synthetic schema/issuer/source-byte/Auth bridge boundaries, NOT native/legal approval.')
}
