import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash,createHmac} from 'node:crypto'

// Real forward SQL, explicitly bounded synthetic public schema/auth/issuer and
// snapshot-writer fixtures. This is never Supabase, issuer or native evidence.
export async function runProcessRetentionRegression({db,uid,quote,service,authenticatedCall,grant,retentionKey}) {
 const migration=name=>readFileSync(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8')
 for(const table of ['customer_contract_events','customer_sites','supplier_switch_requests','supplier_switch_events','customer_cases','customer_case_events','customer_operation_jobs','customer_operation_tasks','customer_operation_events'])await db.exec(`CREATE TABLE IF NOT EXISTS public.${table}(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,contract_id uuid,customer_contract_id uuid,outbound_z03_message_id uuid,status text);`)
 await db.exec('ALTER TABLE customer_portal_accounts ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT clock_timestamp();ALTER TABLE customer_portal_claims ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT clock_timestamp();ALTER TABLE ediel_messages ADD COLUMN IF NOT EXISTS original_message_id uuid;')
 await db.exec(migration('20260924073337_correction_process_facts_v1.sql'))
 await db.exec(migration('20260924080601_correction_process_witness_v1.sql'))
 await db.exec(migration('20260924085942_correction_process_readset_v1.sql'))
 const combined=migration('20260924120822_e035_combined_correction_snapshot.sql')
 await db.exec(combined.slice(combined.indexOf('CREATE TABLE gridex_correction_process.combined_snapshots'),combined.indexOf('CREATE FUNCTION gridex_correction_process.open_combined_v1')))
 await db.exec(migration('20260924145224_correction_process_archive_dates_v4.sql'))
 await db.exec(`CREATE TABLE IF NOT EXISTS gridex_received_sources.switch_originals(message_id uuid,company_id uuid,contract_id uuid);
 CREATE TABLE gridex_received_sources.normal_switch_confirmations(period_id uuid PRIMARY KEY,company_id uuid,contract_id uuid,source_message_id uuid,original_message_id uuid);
 CREATE TABLE gridex_received_sources.normal_supply_activations(period_id uuid PRIMARY KEY,company_id uuid,source_message_id uuid);
 CREATE FUNCTION public.ediel_retention_lock_auth_actor_v1(a uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$BEGIN PERFORM id FROM auth.users WHERE id=a FOR SHARE;PERFORM id FROM public.user_profiles WHERE id=a FOR SHARE;RETURN EXISTS(SELECT FROM auth.users u JOIN public.user_profiles p ON p.id=u.id WHERE u.id=a AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now()) AND p.user_status='active' AND p.disabled_at IS NULL);END$$;
 GRANT EXECUTE ON FUNCTION public.ediel_retention_lock_auth_actor_v1(uuid) TO gridex_ediel_retention_owner;`)
 await db.exec(`CREATE SCHEMA gridex_bilateral_customer_sources;CREATE TABLE gridex_bilateral_customer_sources.artifacts(id uuid,company_id uuid,contract_id uuid);ALTER TABLE gridex_requested_changes.confirmed_customer_versions ADD COLUMN IF NOT EXISTS event_id uuid,ADD COLUMN IF NOT EXISTS bilateral_artifact_id uuid;
 CREATE FUNCTION public.activate_customer_supply_v1(p_company_id uuid,p_supplier_switch_request_id uuid,p_source_message_id uuid,p_actual_start_date date DEFAULT NULL,p_actor_user_id uuid DEFAULT NULL,p_idempotency_key text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$DECLARE proof record;m record;BEGIN IF EXISTS(SELECT FROM gridex_ediel_retention.process_events WHERE false) THEN RETURN '{"idempotent":true}';END IF;/* normal_supply_activations fixture boundary */PERFORM gridex_ediel_inbound_context.require_v1(p_company_id,m.id);RETURN '{}';END$$;`)
 await db.exec(migration('20261001015945_ediel_process_journal_class_retention.sql'))
 await grant(uid(2),['ediel.retention.read']);await grant(uid(30),['ediel.retention.read'])
 const company=uid(1),actor=uid(2),reviewer=uid(30)
 // Older unrelated address/portal tombstones do not prevent an independently
 // qualified new contract. The original exact contract still cannot be reused.
 await db.exec(`INSERT INTO customer_contracts(id,company_id,customer_id,status,signature_snapshot) VALUES('${uid(401)}','${company}','${uid(200)}','signed','{"freshSource":"SYNTHETIC NEW INDEPENDENT CONTRACT"}');`)
 await service(`SELECT public.ediel_require_contract_records_available_v1('${company}','${uid(401)}')`)
 await assert.rejects(()=>service(`SELECT public.ediel_require_contract_records_available_v1('${company}','${uid(201)}')`),/retention_tombstoned/)
 await db.exec(`INSERT INTO customer_portal_accounts(company_id,customer_id,status,is_active,created_at) VALUES('${company}','${uid(200)}','active',true,clock_timestamp()+interval '1 second');INSERT INTO customer_portal_claims(company_id,customer_id,status,created_at) VALUES('${company}','${uid(200)}','approved',clock_timestamp()+interval '1 second')`)
 await service(`SELECT public.ediel_require_portal_retention_access_v1('${company}','${uid(200)}')`)
 // Actual prospective capture runs on the real public contract transition.
 const fact=(await db.query(`SELECT id::text id FROM gridex_correction_process.facts WHERE row_id='${uid(401)}' ORDER BY id DESC LIMIT 1`)).rows[0].id
 const snapshot=JSON.stringify({companyId:company,complete:false,authority:'none',process:{facts:[{customerId:uid(200),contractId:uid(401)}]}})
 await db.exec(`INSERT INTO gridex_correction_process.readsets(id,company_id,environment,cutoff_at,customer_id,readset_text,readset_hash) VALUES('${uid(402)}','${company}','test',clock_timestamp(),'${uid(200)}',${quote(snapshot)},'${createHash('sha256').update(snapshot).digest('hex')}');INSERT INTO gridex_correction_process.combined_snapshots(id,company_id,environment,subject_message_id,cutoff_at,visibility_snapshot,readset_text,readset_hash) VALUES('${uid(403)}','${company}','test','${uid(7)}',clock_timestamp(),pg_current_snapshot()::text,${quote(snapshot)},'${createHash('sha256').update(snapshot).digest('hex')}')`)
 const basis=(kind,target)=>authenticatedCall(actor,`SELECT public.ediel_process_journal_retention_basis_v1('${company}','${actor}',${quote(kind)},${quote(target)}) b`)
 const submit=(kind,target,document,receipt=null)=>authenticatedCall(actor,`SELECT public.ediel_submit_process_journal_retention_v1('${company}','${actor}',${quote(kind)},${quote(target)},${quote(document.toString('base64'))},${receipt?quote(receipt):'NULL'}) b`)
 const review=(id,who=reviewer)=>authenticatedCall(who,`SELECT public.ediel_review_process_journal_retention_v1('${company}','${who}','${id}','approve','SYNTHETIC separate current legal journal review') b`)
 const purge=id=>authenticatedCall(actor,`SELECT public.ediel_purge_process_journal_retention_v1('${company}','${actor}','${id}') b`)
 const policy=async(kind,target,document,patch={})=>{
  const b=await basis(kind,target),payload=Buffer.from(JSON.stringify({format:'ediel_process_journal_retention_policy_v1',...b,operation:({correction_process_fact_body:'redact_process_fact_body',correction_process_readset_body:'redact_process_readset_body',correction_process_combined_readset_body:'redact_process_combined_readset_body'})[kind],companyId:company,documentHash:createHash('sha256').update(document).digest('hex'),issuerLegalReference:'SYNTHETIC LEGAL COMPETENCE TEST ONLY',legalBasisReference:'SYNTHETIC exact process class only',journalPurposeReference:'SYNTHETIC finite hash/identity continuity only',accessRevocationRequired:true,issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),retainUntil:new Date(Date.now()-1000).toISOString(),journalRetainUntil:new Date(Date.now()+3600000).toISOString(),...patch}))
  return {issuerId:uid(50),payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',retentionKey).update(payload).digest('hex')}
 }
 const noIssuer=await submit('correction_process_fact_body',fact,Buffer.from('SYNTHETIC absent legal issuer'))
 assert.equal(noIssuer.issuerQualified,false);assert.equal((await review(noIssuer.decisionId)).status,'held');assert.equal((await purge(noIssuer.decisionId)).status,'held')
 // Every included scope must close. A missing dimension expands to the actual
 // company's customers; an active unrelated scope therefore holds the snapshot.
 await db.exec(`INSERT INTO customers(id,company_id,status) VALUES('${uid(404)}','${company}','active')`)
 assert.equal((await basis('correction_process_readset_body',uid(402))).unknownScopeExpandedToCompany,true)
 assert.equal((await basis('correction_process_readset_body',uid(402))).allIncludedScopesClosed,false)
 const closedPolicyDoc=Buffer.from('SYNTHETIC closed exact scope')
 const premature=await submit('correction_process_readset_body',uid(402),closedPolicyDoc,await policy('correction_process_readset_body',uid(402),closedPolicyDoc))
 assert.equal((await review(premature.decisionId)).status,'held')
 // Fixture closure is an external lifecycle boundary, not a native market proof.
 await db.exec(`UPDATE customers SET status='archived' WHERE company_id='${company}' AND status IS DISTINCT FROM 'archived';UPDATE customer_supply_periods SET status='ended',end_date=current_date-1,actual_end_date=current_date-1 WHERE company_id='${company}';`)
 for(const [kind,target,table] of [['correction_process_fact_body',fact,'facts'],['correction_process_readset_body',uid(402),'readsets'],['correction_process_combined_readset_body',uid(403),'combined_snapshots']]) {
  const document=Buffer.from('SYNTHETIC independent exact policy '+kind),source=await basis(kind,target)
  assert.equal(source.allIncludedScopesClosed,true)
  const d=await submit(kind,target,document,await policy(kind,target,document));assert.equal(d.issuerQualified,true)
  await assert.rejects(()=>review(d.decisionId,actor),/separate_reviewer_required/)
  assert.equal((await review(d.decisionId)).status,'approved')
  await db.exec(`INSERT INTO user_permission_overrides(user_id,company_id,permission_key,effect,is_active) VALUES('${reviewer}','${company}','ediel.retention.legal_history','deny',true)`)
  assert.equal((await purge(d.decisionId)).status,'held');await db.exec(`DELETE FROM user_permission_overrides WHERE user_id='${reviewer}'`)
  // A genuine last audit INSERT failure must roll back the tombstone and bytes.
  await db.exec(`CREATE FUNCTION public.synthetic_late_process_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='ediel.retention.process_redacted' THEN RAISE EXCEPTION 'SYNTHETIC_LATE_PROCESS_AUDIT_FAILURE';END IF;RETURN NEW;END$$;CREATE TRIGGER synthetic_late_process_audit_failure BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.synthetic_late_process_audit_failure();`)
  await assert.rejects(()=>purge(d.decisionId),/SYNTHETIC_LATE_PROCESS_AUDIT_FAILURE/)
  assert.equal((await db.query(`SELECT count(*)::int n FROM gridex_ediel_retention.process_tombstones WHERE retention_class=${quote(kind)} AND target_id=${quote(target)}`)).rows[0].n,0);assert.equal((await basis(kind,target)).sourceHash,source.sourceHash)
  await db.exec('DROP TRIGGER synthetic_late_process_audit_failure ON public.audit_logs;DROP FUNCTION public.synthetic_late_process_audit_failure()')
  assert.equal((await purge(d.decisionId)).status,'redacted');assert.equal((await purge(d.decisionId)).replay,true)
  const row=(await db.query(`SELECT to_jsonb(f) b FROM gridex_correction_process.${table} f WHERE id=${kind==='correction_process_fact_body'?target:quote(target)} `)).rows[0].b
  const retained=kind==='correction_process_fact_body'?row.new_fact:JSON.parse(row.readset_text)
  assert.equal(retained.retentionUnavailable,true);assert.equal(retained.sourceHash,source.sourceHash);assert.equal(retained.authority,'none');assert.equal(retained.complete,false)
  assert.equal(kind==='correction_process_fact_body'?row.facts_hash:row.readset_hash,source.sourceHash)
  await assert.rejects(()=>service(`SELECT public.ediel_require_process_journal_available_v1('${company}',${quote(kind)},${quote(target)})`),/tombstoned/)
  await assert.rejects(()=>db.exec(`UPDATE gridex_correction_process.${table} SET ${kind==='correction_process_fact_body'?'new_fact=\'{"restored":true}\'':"readset_text='{}'"} WHERE id=${kind==='correction_process_fact_body'?target:quote(target)}`),/append_only|tombstoned/)
 }
 for(const role of ['anon','authenticated','service_role']){await db.exec(`SET ROLE ${role}`);await assert.rejects(()=>db.exec('SELECT * FROM gridex_ediel_retention.process_decisions'),/permission denied/);await assert.rejects(()=>db.exec('INSERT INTO gridex_ediel_retention.process_tombstones DEFAULT VALUES'),/permission denied/);await db.exec('RESET ROLE')}
 console.log('PASS actual three process class SQL policies/review/closed-scope/hash/retained markers/current reviewer revoke/late-audit rollback/replay/private ACL; synthetic schema/auth/issuer/snapshot-writer/closure boundaries, NOT native replay or legal authority')
}
