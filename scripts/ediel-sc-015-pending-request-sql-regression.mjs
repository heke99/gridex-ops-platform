// masterplan: SC-015
// Extend the unchanged archive/review/timing harness. Actual current coordinator,
// manual pending resolver and 170000 timing gate run; upstream issuer registry,
// original transport/binding witness and canonical storage ports remain finite.
// No SMTP, native replay or authentic legal approval is claimed.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

let base = readFileSync(new URL('./ediel-service-request-timing-sql-regression.mjs', import.meta.url), 'utf8')
const replaceOnce = (before, after) => { assert.equal(base.split(before).length, 2, before); base = base.replace(before, () => after) }
// Change only the generated execution copy. All retained harness files stay byte-identical.
const ports = 'CREATE FUNCTION gridex_service_administration.require_manual_actor_v1(c uuid,actor uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status=\'active\') OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status=\'active\' AND is_active AND accepted_at IS NOT NULL) OR public.gridex_actor_has_company_permission(actor,c,\'metering.write\') IS NOT TRUE THEN RAISE EXCEPTION \'ediel_service_manual_actor_forbidden\';END IF;END $$;CREATE FUNCTION public.ediel_resolve_service_permission_command_v1(p_company_id uuid,p_assignment_id uuid,p_actor_user_id uuid,p_expected_version bigint,p_permission_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$SELECT jsonb_build_object(\'status\',\'permission_required\',\'permissionId\',p.id) FROM public.metering_permissions p WHERE p.company_id=p_company_id AND p.id=p_permission_id$$;'
replaceOnce(ports, '')
const setup = ' const forward=readFileSync('
const admission = String.raw`
 // Missing schema / original-admission ports are declared fixtures, not private
 // receipt results produced by the source/transport owners. Timing and separate
 // archive/review/assignment approval below still run through real commands.
 await db.exec("ALTER TABLE customers ADD UNIQUE(company_id,id);ALTER TABLE ediel_messages ADD IF NOT EXISTS status text,ADD IF NOT EXISTS outbound_request_id uuid,ADD IF NOT EXISTS message_sent_at timestamptz,ADD IF NOT EXISTS immutable_payload_hash text,ADD IF NOT EXISTS immutable_rendered_at timestamptz;ALTER TABLE metering_permissions ADD IF NOT EXISTS source_z13_message_id uuid,ADD IF NOT EXISTS outbound_z13_message_id uuid;CREATE TABLE outbound_requests(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,source_type text,source_id uuid,request_type text,operation_id uuid,payload jsonb);CREATE TABLE customer_operation_tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,customer_id uuid,task_type text,status text,priority text,title text,description text,assigned_to uuid,metadata jsonb,created_by uuid,updated_by uuid);CREATE SCHEMA gridex_ediel_outbound_owner;CREATE TABLE gridex_ediel_outbound_owner.sc015_original_port(company_id uuid,message_id uuid,sha text);CREATE FUNCTION gridex_ediel_outbound_owner.require_v1(c uuid,m uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT FROM gridex_ediel_outbound_owner.sc015_original_port f JOIN public.ediel_messages e ON e.company_id=f.company_id AND e.id=f.message_id WHERE f.company_id=c AND f.message_id=m AND f.sha=encode(sha256(convert_to(e.raw_payload,'UTF8')),'hex') AND f.sha=e.immutable_payload_hash AND e.immutable_rendered_at IS NOT NULL) THEN RAISE EXCEPTION 'sc015_declared_original_byte_witness_unavailable';END IF;RETURN '{}'::jsonb;END$$;")
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001020640_ediel_service_permission_manual_source_commands.sql',import.meta.url),'utf8'))
`
const manualLoad = " await db.exec(readFileSync(new URL('../supabase/migrations/20261001020640_ediel_service_permission_manual_source_commands.sql',import.meta.url),'utf8'))"
replaceOnce(setup, manualLoad + '\n' + setup)
// Bootstrap schema before the inherited ACK captures its full-row projection.
// Its later unchanged replay guard must continue to compare the same schema.
const ackMarker = ' const ackRaw='
let ack = readFileSync(new URL('./ediel-positive-ack-service-scope-sql-regression.mjs', import.meta.url), 'utf8')
assert.equal(ack.split(ackMarker).length, 2)
ack = ack.replace(ackMarker, () => admission.replace(manualLoad, '') + ackMarker)
const ackTemp = fileURLToPath(new URL('./.ediel-sc015-ack-bootstrap.tmp.mjs', import.meta.url))
let evidence = readFileSync(new URL('./ediel-service-evidence-sql-regression.mjs', import.meta.url), 'utf8')
const ackPath = "'./ediel-positive-ack-service-scope-sql-regression.mjs'"
assert.equal(evidence.split(ackPath).length, 2)
evidence = evidence.replace(ackPath, "'./.ediel-sc015-ack-bootstrap.tmp.mjs'")
const evidenceTemp = fileURLToPath(new URL('./.ediel-sc015-evidence-bootstrap.tmp.mjs', import.meta.url))
replaceOnce("'./ediel-service-evidence-sql-regression.mjs'", "'./.ediel-sc015-evidence-bootstrap.tmp.mjs'")
replaceOnce("networkEnd=null}={})=>{", "networkEnd=null,extra=null}={})=>{")
replaceOnce("purpose:'Synthetic bounded timing purpose '+count}", "purpose:'Synthetic bounded timing purpose '+count,...(extra||{})}")
const marker = " assert.equal(first.status,'permission_required')\n"
const cases = String.raw`
 await db.exec(readFileSync(new URL('../supabase/migrations/20261004170000_ediel_service_resolve_permission_request_timing.sql',import.meta.url),'utf8'))
 {
 const valid=await approveFresh({start:'2026-06-01T00:00:00Z',networkStart:'2026-01-01'}),first=await valid.request()
 assert.equal(first.status,'permission_required')
 let sc015=0
 const probe=async(name,f)=>{await f();sc015++;console.log('SC015 PASS '+name)}
 const purpose=(await db.query('SELECT purpose FROM ediel_service_assignments WHERE id=$1',[valid.assignment])).rows[0].purpose
 const retainedId=uid(88001),retainedIntent=uid(88002),retainedRequest=uid(88003)
 const retainedWire="UNB+UNOC:3+12345:14+54321:14+261003:1200+PENDING++23-DGI-PRODAT'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z13+PENDING-DOC+9'NAD+FR+21660:160:SVK'NAD+DO+54321:160:SVK'LIN+1++point-a:::9'RFF+LI:SC015-RETAINED'UNT+7+M'UNZ+1+PENDING'"
 // Explicit retained source/binding facts stand in for a prior transport owner.
 // They are NOT newly minted authority/results from this finite scenario. No
 // private service archive/review/assignment approval is seeded.
 await db.query('INSERT INTO ediel_message_intents(id) VALUES($1)',[retainedIntent])
 await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,intent_id,customer_id,raw_payload,status,outbound_request_id,message_sent_at,immutable_rendered_at,immutable_payload_hash) VALUES($1,$2,'test','outbound','PRODAT','Z13',$3,$4,$5,'sent',$6,now()-interval '2 days',now()-interval '2 days',encode(sha256(convert_to($5,'UTF8')),'hex'))",[retainedId,uid(1),retainedIntent,uid(10),retainedWire,retainedRequest])
 await db.query("INSERT INTO outbound_requests VALUES($1,$2,$3,'manual',$4,'metering_access',$5,$6)",[retainedRequest,uid(1),uid(10),retainedIntent,first.permissionId,{servicePermissionCommandKey:retainedIntent,environment:'test'}])
 await db.query("INSERT INTO gridex_service_permission.origins(intent_id,company_id,assignment_id,permission_id,actor_user_id,message_code,command_key,basis,message_id) VALUES($1,$2,$3,$4,$5,'Z13','SC015-DECLARED-PRIOR-ORIGIN',$6,$7)",[retainedIntent,uid(1),valid.assignment,first.permissionId,uid(20),{scopeBasisVersion:1},retainedId])
 await db.query("INSERT INTO gridex_ediel_outbound_owner.sc015_original_port SELECT company_id,id,immutable_payload_hash FROM ediel_messages WHERE id=$1",[retainedId])
 await db.query("UPDATE metering_permissions SET status='waiting_for_customer_approval',source_z13_message_id=$1,outbound_z13_message_id=$1 WHERE id=$2",[retainedId,first.permissionId])
 const old=async()=>(await db.query("SELECT jsonb_build_object('message',(SELECT to_jsonb(m) FROM ediel_messages m WHERE id=$1),'permission',(SELECT to_jsonb(p) FROM metering_permissions p WHERE id=$2),'origin',(SELECT to_jsonb(o) FROM gridex_service_permission.origins o WHERE message_id=$1),'request',(SELECT to_jsonb(r) FROM outbound_requests r WHERE id=$3),'grants',(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY id),'[]') FROM ediel_data_access_grants g)) b",[retainedId,first.permissionId,retainedRequest])).rows[0].b
 const before=await old()
 await probe('declared retained original is pending inside its 21-day handling window',async()=>{const row=before.message;assert.equal(before.permission.status,'waiting_for_customer_approval');assert.ok(Date.parse(row.message_sent_at)>Date.now()-21*86400000);assert.equal(row.raw_payload,retainedWire)})
 await db.query('INSERT INTO companies(id) VALUES($1),($2)',[uid(88004),uid(88005)])
 const same=await approveFresh({start:'2026-06-01T00:00:00Z',networkStart:'2026-01-01',extra:{purpose,beneficiary_company_id:uid(88004)}})
 const reused=await same.request()
 await probe('other independently reviewed beneficiary shares the retained pending request',async()=>{assert.equal(reused.status,'reuse_permission',JSON.stringify(reused));assert.equal(reused.permissionId,first.permissionId);assert.equal(reused.messageId,retainedId);assert.equal(reused.marketPermissionState,'pending');assert.equal(reused.accessGranted,false);assert.deepEqual(await old(),before)})
 await probe('current immutable timing retry has zero new permission/origin/request/grant effects',async()=>{const count=await effectCount();assert.deepEqual(await same.request(),reused);assert.deepEqual(await effectCount(),count);assert.deepEqual(await old(),before)})
 const third=await approveFresh({start:'2026-06-01T00:00:00Z',networkStart:'2026-01-01',extra:{purpose,beneficiary_company_id:uid(88005)}})
 await probe('another tenant identifier cannot bypass same-object pending coordination',async()=>{const r=await third.request();assert.equal(r.status,'reuse_permission');assert.equal(r.permissionId,first.permissionId);assert.equal(r.messageId,retainedId);assert.equal(r.accessGranted,false);assert.deepEqual(await old(),before)})
 const added=await approveFresh({start:'2026-06-01T00:00:00Z',networkStart:'2026-01-01',extra:{purpose,beneficiary_company_id:uid(88004),object_ids:['point-a','point-extra']}})
 const next=await added.request()
 await probe('relevant extra object obtains its own source-scoped request immediately',async()=>{assert.equal(next.status,'permission_required',JSON.stringify(next));assert.notEqual(next.permissionId,first.permissionId);const rows=(await db.query('SELECT a.id,a.company_id,a.customer_id,a.provider_actor_id,a.dso_actor_id,a.environment,a.object_ids,p.permission_scope,p.metadata FROM ediel_service_assignments a JOIN ediel_assignment_permission_links l ON l.assignment_id=a.id JOIN metering_permissions p ON p.id=l.permission_id WHERE a.id=ANY($1::uuid[]) ORDER BY a.id',[[valid.assignment,added.assignment]])).rows;assert.equal(rows.length,2);for(const key of ['company_id','customer_id','provider_actor_id','dso_actor_id','environment','permission_scope'])assert.equal(rows[0][key],rows[1][key]);assert.deepEqual((await db.query('SELECT object_ids FROM ediel_service_assignments WHERE id=$1',[added.assignment])).rows[0].object_ids,['point-a','point-extra']);assert.deepEqual(await old(),before)})
 await probe('additional-object request replay retains its immutable owner and does not duplicate',async()=>{const count=await effectCount();assert.deepEqual(await added.request(),next);assert.deepEqual(await effectCount(),count);assert.deepEqual(await old(),before)})
 await probe('current resolver holds missing current timing and gives no beneficiary authority',async()=>{await db.exec('BEGIN');try{await db.query("INSERT INTO gridex_ediel_services.issuer_revocations VALUES('representation',$1,'SC015 current revocation',repeat('c',64),now())",[(await db.query("SELECT r.id FROM gridex_ediel_services.issuer_representations r JOIN ediel_service_assignments a ON r.scope_hash=encode(sha256(convert_to(gridex_service_administration.scope_v1(a)::text,'UTF8')),'hex') WHERE a.id=$1 AND r.evidence_kind='dso_contract'",[same.assignment])).rows[0].id]);const r=await same.request();assert.equal(r.status,'held');assert.deepEqual(await old(),before)}finally{await db.exec('ROLLBACK')}})
 await probe('retained original byte witness cannot be replaced by a current caller',async()=>{await db.exec('BEGIN');try{await db.query('UPDATE ediel_messages SET raw_payload=raw_payload||$1 WHERE id=$2',['forged',retainedId]);await db.exec('SET ROLE service_role');await assert.rejects(db.query("SELECT public.ediel_coordinate_service_permission_v1($1,$2,$3,2,'request_access') r",[uid(1),same.assignment,uid(20)]),/sc015_declared_original_byte_witness_unavailable/)}finally{await db.exec('ROLLBACK')}assert.deepEqual(await old(),before)})
 const currentOwners=[]
 const {readdirSync}=await import('node:fs')
 for(const [file,name,signature,installedSignature] of [
  ['20261001043917_ediel_service_source_network_period_timing.sql','public.ediel_coordinate_service_permission_v1','public.ediel_coordinate_service_permission_v1(uuid,uuid,uuid,bigint,text)'],
  ['20261004170000_ediel_service_resolve_permission_request_timing.sql','public.ediel_resolve_service_permission_command_v1','public.ediel_resolve_service_permission_command_v1(uuid,uuid,uuid,bigint,uuid)'],
  ['20261001043917_ediel_service_source_network_period_timing.sql','gridex_service_permission.current_request_timing_v1','gridex_service_permission.current_request_timing_v1(uuid,uuid,uuid,bigint,boolean)'],
  ['20261001043917_ediel_service_source_network_period_timing.sql','gridex_service_permission.lock_request_writer_v1','gridex_service_permission.lock_request_writer_v1()'],
  ['20261001020640_ediel_service_permission_manual_source_commands.sql','gridex_service_administration.require_manual_actor_v1','gridex_service_administration.require_manual_actor_v1(uuid,uuid)'],
  ['20261001020640_ediel_service_permission_manual_source_commands.sql','public.ediel_resolve_service_permission_command_v1','public.ediel_resolve_service_permission_command_v1(uuid,uuid,uuid,bigint,uuid)','gridex_service_permission.resolve_before_request_timing_v1(uuid,uuid,uuid,bigint,uuid)'],
  ['20261001020640_ediel_service_permission_manual_source_commands.sql','public.ediel_coordinate_service_permission_v1','public.ediel_coordinate_service_permission_v1(uuid,uuid,uuid,bigint,text)','gridex_service_administration.coordinate_before_source_timing_v1(uuid,uuid,uuid,bigint,text)'],
 ]){
  const source=readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'),pattern=new RegExp('CREATE(?: OR REPLACE)? FUNCTION '+name.replaceAll('.','\\.')+'\\(','gi'),matches=[...source.matchAll(pattern)]
  assert.equal(matches.length,1);const start=matches[0].index,end=source.indexOf('$$;',source.indexOf('$$',start)+2),definition=source.slice(start,end+3),body=definition.slice(definition.indexOf('$$')+2,definition.lastIndexOf('$$'))
  const actual=(await db.query('SELECT prosrc FROM pg_proc WHERE oid=$1::regprocedure',[installedSignature||signature])).rows[0].prosrc;assert.equal(actual,body,'entire installed body equals exact production owner')
  const names=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort().filter(n=>{pattern.lastIndex=0;return pattern.test(readFileSync(new URL('../supabase/migrations/'+n,import.meta.url),'utf8'))})
  if(!installedSignature)assert.equal(names.at(-1),file,'latest explicit current owner definition')
  currentOwners.push({signature:installedSignature||signature,migration:file,latestExplicitDefinition:names.at(-1),definitionSha256:createHash('sha256').update(definition).digest('hex'),installedBodySha256:createHash('sha256').update(actual).digest('hex'),exactBody:true,privatePredecessor:!!installedSignature})
 }
 console.log('SC015_RESULT '+JSON.stringify({checks:sc015,owners:currentOwners,source:{messageId:retainedId,permissionId:first.permissionId,rawAndBindingUnchanged:true,distinctNewObjectPermission:next.permissionId,pendingReuseAccessGranted:false},ports:'Synthetic issuer registry and retained original/binding/transport source; actual archive/review/timing/current coordinator/resolver; NOT native/legal acceptance'}))
 console.log('SC015 pending request current SQL: '+sc015+' PASS; actual owners with finite declared upstream ports; NOT native/legal proof')
 }
`
replaceOnce(marker, marker + cases)
replaceOnce("'./.ediel-service-timing-nested.tmp.mjs'", "'./.ediel-sc015-timing-nested.tmp.mjs'")
const temporary = fileURLToPath(new URL('./.ediel-sc015-pending-outer.tmp.mjs', import.meta.url))
writeFileSync(ackTemp, ack)
writeFileSync(evidenceTemp, evidence)
writeFileSync(temporary, base)
try {
  const run = spawnSync(process.execPath, [temporary], { stdio: 'inherit', env: process.env })
  if (run.error) throw run.error
  process.exitCode = run.status ?? 1
} finally { for (const path of [temporary,evidenceTemp,ackTemp]) unlinkSync(path) }
