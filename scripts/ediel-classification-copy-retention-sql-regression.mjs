// Actual original 23512 STABLE owner body, and the new native-copy functions.
// Synthetic auth/schema/issuer and unqualified original rows are DECLARED;
// this proves bounded mechanisms, never actual legal/native market authority.
import {readFileSync} from 'node:fs'
const baseUrl=new URL('./ediel-decision-evidence-sql-regression.mjs',import.meta.url)
const own=new URL('../supabase/migrations/',import.meta.url)
let base=readFileSync(baseUrl,'utf8').replace("const own=new URL('../supabase/migrations/',import.meta.url)",`const own=new URL(${JSON.stringify(own.href)})`)
const end=base.indexOf(" console.log(JSON.stringify({status:'PASS',checks,scope:'six actual original-byte namespaces")
if(end<0)throw Error('actual bounded predecessor boundary changed')
base=base.slice(0,end)
const phase=String.raw`
{
 const original='20261001023512_ediel_partial_customer_life_event_source_effects.sql',oldSchema='20260930233247_ediel_customer_life_event_source_authority.sql'
 const table=(file,name)=>{const all=readFileSync(new URL(file,own),'utf8'),start=all.indexOf('CREATE TABLE '+name+'(');if(start<0)throw Error('actual table missing '+name);return all.slice(start,all.indexOf(';',start)+1)}
 await db.exec('CREATE SCHEMA gridex_customer_life_events;CREATE SCHEMA gridex_ediel_ack_replay;CREATE TABLE public.customers(id uuid PRIMARY KEY,company_id uuid);CREATE TABLE gridex_received_sources.validation_assessments(id uuid PRIMARY KEY);CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,message_family text,message_code text,raw_payload text);CREATE TABLE public.tenant_bilateral_agreements(id uuid PRIMARY KEY);CREATE TABLE public.metering_points(id uuid PRIMARY KEY);CREATE TABLE public.customer_supply_periods(id uuid PRIMARY KEY);')
 // Only a named graph-order boundary, without claimed approval or business.
 await db.exec('CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE plpgsql VOLATILE AS $$BEGIN PERFORM pg_advisory_xact_lock(991815);END$$;')
 for(const name of ['inbound_grounds','transitions','customer_versions'])await db.exec(table(oldSchema,'gridex_customer_life_events.'+name))
 const originalText=readFileSync(new URL(original,own),'utf8'),cut=originalText.indexOf('CREATE TABLE gridex_customer_life_events.inbound_context_receipts(')
 await db.exec(originalText.slice(originalText.indexOf('CREATE TABLE gridex_customer_life_events.inbound_classifications('),cut))
 await db.exec(source(original,'gridex_customer_life_events.wire_partition_v1'))
 await db.exec(source(original,'gridex_customer_life_events.inbound_basis_v1'))
 const ownerName='gridex_customer_life_events.owner_proof_consistent_v1',ownerOriginal=source(original,ownerName)
 await db.exec(ownerOriginal)
 // Red uses the EXACT original STABLE declaration/body, not a VOLATILE
 // fixture substitute. The forbidden locking patch fails before body claims.
 check((await db.query("SELECT provolatile FROM pg_proc WHERE oid='gridex_customer_life_events.owner_proof_consistent_v1(jsonb,jsonb,uuid)'::regprocedure")).rows[0].provolatile,'s')
 await db.exec(ownerOriginal.replace('BEGIN','BEGIN PERFORM id FROM public.ediel_messages FOR SHARE;'))
 await assert.rejects(()=>db.query('SELECT '+ownerName+"('{}','{}',"+q(id(70))+')'),e=>e.code==='0A000'&&/SELECT FOR SHARE is not allowed in a non-volatile function/.test(e.message));checks++
 await db.exec(ownerOriginal)
 // The exact 715 prerequisite removes only permission-key uniqueness; its
 // two original classes are a separate proof dependent on installed 071000.
 const ddl715=readFileSync(new URL('20261001071500_ediel_customer_invoice_retention_decision_original_classes.sql',own),'utf8'),uniqueStart=ddl715.indexOf('DO $$DECLARE constraint_name'),uniqueEnd=ddl715.indexOf('END$$;',uniqueStart)
 await db.exec(ddl715.slice(uniqueStart,uniqueEnd+7))
 const identity=await db.query("SELECT to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid='gridex_customer_life_events.owner_proof_consistent_v1(jsonb,jsonb,uuid)'::regprocedure")
 const bytes=Buffer.alloc(1048577,65),receipt=Buffer.from('SYNTHETIC signed classification-copy content'),rev=Buffer.from('SYNTHETIC revocation original'),mid=id(70),target=id(71)
 await db.exec('INSERT INTO public.ediel_messages VALUES('+[q(mid),q(id(1)),"'test'","'inbound'","'edifact'","'PRODAT'","'Z06'","'SYNTHETIC unqualified received original'"].join(',')+');')
 await db.exec('INSERT INTO gridex_customer_life_events.inbound_classifications(id,company_id,source_message_id,source_payload_hash,classification,approved_scope,allowed_customer_fields,source_reference,source_version,source_original,source_sha256,classification_original,classification_sha256,owner_decision_reference,approved_by,approved_at) VALUES('+[q(target),q(id(1)),q(mid),q('a'.repeat(64)),"'other_masterdata'","'[{\"pointId\":\"synthetic\"}]'","ARRAY['227']","'SYNTHETIC original'","'1'","decode('"+bytes.toString('hex')+"','hex')",q(hash(bytes)),"decode('"+receipt.toString('hex')+"','hex')",q(hash(receipt)),"'SYNTHETIC unqualified decision'",q(id(2)),"clock_timestamp()"].join(',')+');')
 await db.exec('INSERT INTO gridex_customer_life_events.classification_revocations(classification_id,source_reference,source_original,source_sha256) VALUES('+[q(target),"'SYNTHETIC old revocation'","decode('"+rev.toString('hex')+"','hex')",q(hash(rev))].join(',')+');')
 // Two other unqualified, independent originals for late physical-write probes.
 for(const [message,classification] of [[72,73],[74,75]]){
  await db.exec('INSERT INTO public.ediel_messages SELECT '+q(id(message))+',company_id,environment,direction,message_standard,message_family,message_code,raw_payload FROM public.ediel_messages WHERE id='+q(mid))
  await db.exec('INSERT INTO gridex_customer_life_events.inbound_classifications SELECT (jsonb_populate_record(NULL::gridex_customer_life_events.inbound_classifications,to_jsonb(q)||jsonb_build_object(\'id\','+q(id(classification))+',\'source_message_id\','+q(id(message))+'))).* FROM gridex_customer_life_events.inbound_classifications q WHERE id='+q(target))
 }
 await assert.rejects(()=>db.exec('UPDATE gridex_customer_life_events.inbound_classifications SET source_original=NULL WHERE id='+q(target)),e=>e.code==='23514'&&e.message==='received_source_evidence_is_append_only');checks++
 await assert.rejects(()=>call('ediel_read_retention_decision_original_v1',[id(1),id(2),'life_event_classification_source_original_bytes',target,false]),/no rows|class_grant/);checks++
 await db.exec(readFileSync(new URL('20261001081500_ediel_customer_classification_copy_retention.sql',own),'utf8'))
 check((await db.query("SELECT to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid='gridex_customer_life_events.owner_proof_consistent_v1(jsonb,jsonb,uuid)'::regprocedure")).rows,identity.rows)
 check((await db.query("SELECT provolatile FROM pg_proc WHERE oid='gridex_ediel_retention.classification_copy_source_current_v1(uuid,uuid)'::regprocedure")).rows[0].provolatile,'v')
 for(const role of ['anon','authenticated','service_role']){check((await db.query("SELECT has_function_privilege('"+role+"','gridex_ediel_retention.classification_copy_source_current_v1(uuid,uuid)','EXECUTE') a")).rows[0].a,false);for(const view of ['customer_classification_source_originals','customer_classification_receipt_originals','customer_classification_revocation_originals'])check((await db.query("SELECT has_table_privilege('"+role+"','gridex_ediel_retention."+view+"','SELECT') a")).rows[0].a,false)}
 check((await db.query('SELECT gridex_ediel_retention.classification_copy_source_current_v1('+q(id(1))+','+q(mid)+') a')).rows[0].a,true)
 check((await db.query('SELECT gridex_ediel_retention.classification_copy_source_current_v1('+q(id(99))+','+q(mid)+') a')).rows[0].a,false)
 // No actual committed transition exists: the full original body stays false.
 check((await db.query('SELECT '+ownerName+"('{}','{}',"+q(mid)+') a')).rows[0].a,false)
 const kinds=['life_event_classification_source_original_bytes','life_event_classification_receipt_original_bytes','life_event_classification_revocation_original_bytes'],originals=[bytes,receipt,rev],pending=[]
 for(const [i,kind] of kinds.entries()){
  const metadata=await call('ediel_read_retention_decision_original_v1',[id(1),id(2),kind,target,true]);check([metadata.bytesAvailable,metadata.documentHash,metadata.documentByteLength],[true,hash(originals[i]),originals[i].length]);check(Buffer.from(metadata.documentBase64,'base64'),originals[i])
  const basis=(await db.query('SELECT gridex_ediel_retention.decision_evidence_basis_v1('+q(id(1))+','+q(kind)+','+q(target)+') b')).rows[0].b,document=Buffer.from('SYNTHETIC separate '+kind+' policy'),policy=await call('ediel_submit_decision_evidence_retention_v1',[id(1),id(2),kind,target,document.toString('base64'),signed(basis,document)])
  check(policy.issuerQualified,true);pending.push(policy.policyId)
  await actor(3);check((await call('ediel_review_decision_evidence_retention_v1',[id(1),id(3),policy.policyId,'approve','SYNTHETIC independent class review'])).status,'approved');await actor(2)
 }
 await db.exec("UPDATE public.user_permissions SET effect='deny' WHERE user_id="+q(id(3))+" AND permission_key='ediel.retention.record_decision_evidence'")
 await assert.rejects(()=>call('ediel_purge_decision_evidence_retention_v1',[id(1),id(2),pending[0]]),/current_reviewer/);checks++
 check((await db.query('SELECT source_original IS NOT NULL b FROM gridex_customer_life_events.inbound_classifications WHERE id='+q(target))).rows[0].b,true)
 await db.exec("UPDATE public.user_permissions SET effect='allow' WHERE user_id="+q(id(3))+" AND permission_key='ediel.retention.record_decision_evidence'")
 for(const [i,kind] of kinds.entries()){
  check((await call('ediel_purge_decision_evidence_retention_v1',[id(1),id(2),pending[i]])).bytesAvailable,false)
  check((await call('ediel_purge_decision_evidence_retention_v1',[id(1),id(2),pending[i]])).replay,true)
  const original=await call('ediel_read_retention_decision_original_v1',[id(1),id(2),kind,target,true]);check([original.bytesAvailable,original.documentBase64,original.documentHash,original.documentByteLength],[false,null,hash(originals[i]),originals[i].length])
  if(i<2)check((await call('ediel_read_retention_decision_original_v1',[id(1),id(2),kinds[2],target,false])).bytesAvailable,true)
  check((await db.query('SELECT gridex_ediel_retention.classification_copy_source_current_v1('+q(id(1))+','+q(mid)+') a')).rows[0].a,false)
  check((await db.query('SELECT '+ownerName+"('{}','{}',"+q(mid)+') a')).rows[0].a,false)
  check((await db.query('SELECT gridex_customer_life_events.inbound_basis_v1('+q(id(1))+','+q(mid)+','+q(id(2))+') b')).rows[0].b.status,'held')
 }
 check((await db.query('SELECT count(*)::int n FROM gridex_ediel_retention.classification_copy_revocations')).rows[0].n,3)
 for(const tab of ['inbound_classifications','classification_revocations']){
  await assert.rejects(()=>db.exec('DELETE FROM gridex_customer_life_events.'+tab),e=>e.code==='23514'&&e.message==='received_source_evidence_is_append_only');checks++
  await assert.rejects(()=>db.exec('TRUNCATE gridex_customer_life_events.'+tab+' CASCADE'),e=>e.code==='23514'&&e.message==='received_source_evidence_is_append_only');checks++
 }
 await assert.rejects(()=>db.exec("UPDATE gridex_customer_life_events.inbound_classifications SET source_original=decode('41','hex') WHERE id="+q(target)),e=>e.code==='23514'&&e.message==='received_source_evidence_is_append_only');checks++
 // Same-transaction expiry/redemption after tombstone insertion tests the
 // last physical guard. It is explicitly not a two-session lock/race proof.
 const physicalKind=kinds[0]
 for(const [classification,mode] of [[73,'late_permission'],[75,'late_expiry']]){
  const copyTarget=id(classification),basis=(await db.query('SELECT gridex_ediel_retention.decision_evidence_basis_v1('+q(id(1))+','+q(physicalKind)+','+q(copyTarget)+') b')).rows[0].b,document=Buffer.from('SYNTHETIC '+mode+' only'),expiresAt=new Date(Date.now()+2000).toISOString(),policy=await call('ediel_submit_decision_evidence_retention_v1',[id(1),id(2),physicalKind,copyTarget,document.toString('base64'),signed(basis,document,mode==='late_expiry'?{expiresAt}:{})])
  await actor(3);check((await call('ediel_review_decision_evidence_retention_v1',[id(1),id(3),policy.policyId,'approve','SYNTHETIC separate late-write review'])).status,'approved');await actor(2)
  const action=mode==='late_permission'?"UPDATE public.user_permissions SET effect='deny' WHERE user_id="+q(id(3))+" AND permission_key='ediel.retention.record_decision_evidence';":'PERFORM pg_sleep(2.1);'
  await db.exec('CREATE FUNCTION gridex_ediel_retention.synthetic_late_physical_probe() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN IF NEW.target_id='+q(copyTarget)+'::uuid THEN '+action+'END IF;RETURN NEW;END$$;CREATE TRIGGER synthetic_late_physical_probe AFTER INSERT ON gridex_ediel_retention.decision_evidence_tombstones FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.synthetic_late_physical_probe();')
  await assert.rejects(()=>call('ediel_purge_decision_evidence_retention_v1',[id(1),id(2),policy.policyId]),mode==='late_permission'?/current_reviewer/:/received_source_evidence_is_append_only/);checks++
  check((await db.query('SELECT source_original IS NOT NULL b FROM gridex_customer_life_events.inbound_classifications WHERE id='+q(copyTarget))).rows[0].b,true)
  check((await db.query('SELECT count(*)::int n FROM gridex_ediel_retention.decision_evidence_tombstones WHERE target_id='+q(copyTarget))).rows[0].n,0)
  check((await db.query('SELECT count(*)::int n FROM gridex_ediel_retention.classification_copy_revocations WHERE classification_id='+q(copyTarget))).rows[0].n,0)
  await db.exec('DROP TRIGGER synthetic_late_physical_probe ON gridex_ediel_retention.decision_evidence_tombstones;DROP FUNCTION gridex_ediel_retention.synthetic_late_physical_probe();')
 }
 check((await db.query('SELECT count(*)::int n FROM gridex_customer_life_events.transitions')).rows[0].n,0)
 check((await db.query('SELECT count(*)::int n FROM gridex_customer_life_events.customer_versions')).rows[0].n,0)
 console.log(JSON.stringify({status:'PASS',checks,scope:'published six-original regression plus three actual23512 copy classes; actual original STABLE locking-red/helper-green/OID+ACL+config; independent policy/class hashes; deny+erasure+no restore+fresh held+no business effects',authority:'Explicit synthetic schema/auth/issuer, seeded UNQUALIFIED original classifications and graph-order port; NOT genuine Supabase/current legal classification/concurrency/browser or whole DB05',originalSha256:createHash('sha256').update(readFileSync(new URL(original,own))).digest('hex'),newMigrationSha256:createHash('sha256').update(readFileSync(new URL('20261001081500_ediel_customer_classification_copy_retention.sql',own))).digest('hex')}))
}
}finally{await db.close()}
`
try{await import('data:text/javascript;base64,'+Buffer.from(base+phase).toString('base64'))}catch(error){console.error(JSON.stringify({status:'FAIL',name:error.name,code:error.code,message:error.message,detail:error.detail}));process.exitCode=1}
