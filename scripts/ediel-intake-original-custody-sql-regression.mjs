// Compose signed-BRP original custody and nationalH original custody. Exact
// source-stage bodies are used; finite synthetic source-purpose keys/scopes
// below are not genuine source authority or qualification of a market send.
import {readFileSync} from 'node:fs'
const own=new URL('../supabase/migrations/',import.meta.url)
let script=readFileSync(new URL('./ediel-signed-brp-intake-current-sql-regression.mjs',import.meta.url),'utf8')
script=script.replace("const own=new URL('../supabase/migrations/',import.meta.url)",`const own=new URL(${JSON.stringify(own.href)})`)
script=script.replace(/new URL\('(\.\/[^']+)',import\.meta\.url\)/g,(_,file)=>`new URL(${JSON.stringify(new URL(file,import.meta.url).href)})`)
script=script.replaceAll('new URL(file,import.meta.url).href',`new URL(file,${JSON.stringify(import.meta.url)}).href`)
const marker=" console.log(JSON.stringify({status:'PASS',checks,scope:'actual BRP"
if(!script.includes(marker))throw Error('bounded intake predecessor changed')
const phase=String.raw`
 {
  // The unrelated bilateral source-receipt registry is a finite, empty,
  // explicitly synthetic lock boundary. No bilateral authority is granted.
  await db.exec('CREATE SCHEMA IF NOT EXISTS gridex_bilateral_prodat;CREATE FUNCTION gridex_bilateral_prodat.lock_source_receipts_v1() RETURNS void LANGUAGE plpgsql AS $$BEGIN PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();END$$;')
  if(!(await db.query("SELECT to_regprocedure('gridex_received_sources.permission_transition_immutable_v1()') f")).rows[0].f)await db.exec(source('20260930144205_ediel_permission_source_atomic_transitions.sql','gridex_received_sources.permission_transition_immutable_v1'))
  const nationalH=process.env.GRIDEX_NATIONAL_H_SOURCE_MIGRATION||new URL('20261001114500_ediel_national_supply_rescission_archived_mandate.sql',own)
  // Empty grammar schema permits compilation; it contains no qualified pack.
  await db.exec('CREATE TABLE IF NOT EXISTS public.ediel_rule_packs(id uuid PRIMARY KEY)')
  await db.exec(readFileSync(nationalH,'utf8'))
  const functions=(await db.query("SELECT oid,to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid IN('gridex_ediel_retention.protected_copy_row_v1(uuid,text,uuid)'::regprocedure,'gridex_supply_rescission.receipt_current_v1(gridex_supply_rescission.artifacts)'::regprocedure) ORDER BY oid")).rows
  await db.exec(readFileSync(new URL('20261001115100_ediel_supply_rescission_original_copy_retention.sql',own),'utf8'))
  check((await db.query("SELECT oid,to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid IN('gridex_ediel_retention.protected_copy_row_v1(uuid,text,uuid)'::regprocedure,'gridex_supply_rescission.receipt_current_v1(gridex_supply_rescission.artifacts)'::regprocedure) ORDER BY oid")).rows,functions)
  const artifact=id(160),issuer=id(161),rep=id(162),dso=id(163),bytes=Buffer.from('SYNTHETIC national legal original custody test only'),scope={companyId:company,environment:'test',legalActorId:legal,dsoActorId:dso,gridArea:'SYNTHETIC-GRID',effectiveAt:new Date(Date.now()+600000).toISOString()},key=Buffer.from('SYNTHETIC NATIONAL H ONLY 01234567890123456789'),hashScope=(await db.query('SELECT encode(sha256(convert_to('+q(scope)+'::jsonb::text,\'UTF8\')),\'hex\') h')).rows[0].h
  await db.exec('INSERT INTO gridex_supply_rescission.issuer_keys VALUES('+[q(issuer),q(company),"'test'","'SYNTHETIC H ISSUER'","'SYNTHETIC H LEGAL'",q('d'.repeat(64)),"decode('"+key.toString('hex')+"','hex')","'2020-01-01'","'2099-01-01'"].join(',')+');INSERT INTO gridex_supply_rescission.issuer_representations VALUES('+[q(rep),q(company),"'test'",q(issuer),q(legal),q(dso),"'SYNTHETIC-GRID'","'SYNTHETIC H REPRESENTATION'",q('e'.repeat(64)),"'2020-01-01'","'2099-01-01'"].join(',')+');')
  const payload=Buffer.from(JSON.stringify({format:'ediel_national_supply_rescission_receipt_v1',purpose:'national_prodat_z08h_legal_rescission',issuerCode:'SYNTHETIC H ISSUER',companyId:company,environment:'test',scope,sourceHash:hash(bytes),sourceReference:'SYNTHETIC H SOURCE',sourceVersion:'1',receiptId:'SYNTHETIC H RECEIPT',legalCaseReference:'SYNTHETIC H CASE',legalDecisionReference:'SYNTHETIC H DECISION',legalPrerequisitesReference:'SYNTHETIC H PREREQUISITES',legalPrerequisitesCompletedAt:new Date(Date.now()-60000).toISOString(),issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()})),receipt={keyId:issuer,representationId:rep,payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',key).update(payload).digest('hex')}
  await db.exec('INSERT INTO gridex_supply_rescission.artifacts(id,company_id,environment,selector,scope,scope_hash,source_bytes,source_hash,mime_type,source_reference,source_version,issuer_receipt,receipt_hash,submitted_by) VALUES('+[q(artifact),q(company),"'test'",q({}),q(scope),q(hashScope),"decode('"+bytes.toString('hex')+"','hex')",q(hash(bytes)),"'text/plain'","'SYNTHETIC H SOURCE'","'1'",q(receipt),q('f'.repeat(64)),q(id(2))].join(',')+')')
  check((await db.query('SELECT gridex_supply_rescission.receipt_current_v1(a) b FROM gridex_supply_rescission.artifacts a WHERE id='+q(artifact))).rows[0].b,true)
  const kind='supply_rescission_source_original_bytes',b=(await db.query('SELECT gridex_ediel_retention.decision_evidence_basis_v1('+q(company)+','+q(kind)+','+q(artifact)+') b')).rows[0].b,document=Buffer.from('SYNTHETIC independent H-original policy'),policy=await call('ediel_submit_decision_evidence_retention_v1',[company,id(2),kind,artifact,document.toString('base64'),signed(b,document)])
  check([b.sourceHash,b.byteLength],[hash(bytes),bytes.length]);await actor(3);check((await call('ediel_review_decision_evidence_retention_v1',[company,id(3),policy.policyId,'approve','SYNTHETIC independent H-copy reviewer'])).status,'approved');await actor(2)
  await assert.rejects(()=>db.exec('UPDATE gridex_supply_rescission.artifacts SET source_bytes=NULL WHERE id='+q(artifact)),/append_only/);checks++
  await assert.rejects(()=>db.exec('UPDATE gridex_supply_rescission.artifacts SET source_hash='+q('0'.repeat(64))+' WHERE id='+q(artifact)),/append_only/);checks++
  await assert.rejects(()=>db.exec('TRUNCATE gridex_supply_rescission.artifacts CASCADE'),/permission_transition_is_immutable/);checks++
  check((await call('ediel_purge_decision_evidence_retention_v1',[company,id(2),policy.policyId])).bytesAvailable,false)
  const original=await call('ediel_read_retention_decision_original_v1',[company,id(2),kind,artifact,true]);check([original.bytesAvailable,original.documentBase64,original.documentHash,original.documentByteLength],[false,null,hash(bytes),bytes.length]);check((await call('ediel_purge_decision_evidence_retention_v1',[company,id(2),policy.policyId])).replay,true)
  check((await db.query('SELECT gridex_supply_rescission.receipt_current_v1(a) b FROM gridex_supply_rescission.artifacts a WHERE id='+q(artifact))).rows[0].b,false)
  check((await db.query('SELECT scope_hash='+q(hashScope)+' AND source_hash='+q(hash(bytes))+' AND issuer_receipt IS NOT NULL AND selector IS NOT NULL b FROM gridex_supply_rescission.artifacts WHERE id='+q(artifact))).rows[0].b,true)
  check((await db.query("SELECT count(*)::int n FROM unnest(ARRAY['anon','authenticated','service_role']) role WHERE has_table_privilege(role,'gridex_ediel_retention.supply_rescission_source_originals','SELECT') OR has_function_privilege(role,'gridex_ediel_retention.supply_rescission_original_guard_v1()','EXECUTE')")).rows[0].n,0)
 }
`
script=script.replace(marker,()=>phase+marker)
script=script.replace('actual BRP scope/archive/native hashes/separate review/source declaration/immutable origin/current reviewer+issuer revoke+null date rejection/private ACL; composed original-copy regression','composed signed BRP and nationalH original-copy custody; source/declaration copies independent; current receipt retired after qualified purge; function metadata unchanged')
try{await import('data:text/javascript;base64,'+Buffer.from(script).toString('base64'))}catch(error){console.error(JSON.stringify({status:'FAIL',name:error.name,code:error.code,message:error.message,detail:error.detail,input:error.input}));process.exitCode=1}
