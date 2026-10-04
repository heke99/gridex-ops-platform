// Restore/compose the REAL 184042 source context plus real ANJ/217 wrappers,
// real scope journal/assessment and new 62832 source getter. Existing admin
// harness supplies explicitly synthetic approvals/identity/source-attestation
// ports. No real grant, authentic decision, native replay or activation proof.
import{readFileSync}from'node:fs';import assert from'node:assert/strict'
export default async function probeServiceOriginSource({db,uid,command}){
 let checks=0;const check=(a,b)=>{assert.deepEqual(a,b);checks++};const rejects=async(f,r)=>{await assert.rejects(f,r);checks++}
 const admin=readFileSync(new URL('../supabase/migrations/20260930184042_ediel_service_administration_commands_v1.sql',import.meta.url),'utf8')
 const from=admin.indexOf('CREATE OR REPLACE FUNCTION gridex_service_permission.context_v1('),to=admin.indexOf('END $$;',from)
 await db.exec(admin.slice(from,to+7).replace('gridex_service_permission.context_v1(','gridex_service_permission.context_before_agreement_reference_v1('))
 await db.exec('ALTER TABLE ediel_messages ADD COLUMN immutable_rendered_at timestamptz;ALTER TABLE ediel_messages ADD COLUMN immutable_payload_hash text;')
 await db.exec('ALTER TABLE metering_permissions ADD COLUMN IF NOT EXISTS source_z13_message_id uuid;ALTER TABLE metering_permissions ADD COLUMN IF NOT EXISTS outbound_z13_message_id uuid;ALTER TABLE metering_permissions ADD COLUMN IF NOT EXISTS outbound_z18_message_id uuid;ALTER TABLE metering_permissions ADD COLUMN IF NOT EXISTS rff_li_reference text;ALTER TABLE metering_permissions ADD COLUMN IF NOT EXISTS market_state_version bigint DEFAULT 0;')
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001062832_ediel_service_origin_recovery_execution_phase.sql',import.meta.url),'utf8'))
 // Verify the source clone's complete original body equals the real source
 // owner except its exact historic preparation-authority block/name.
 const definitions=(await db.query("SELECT pg_get_functiondef('gridex_service_permission.context_before_agreement_reference_v1(uuid,uuid,uuid,bigint,text,uuid)'::regprocedure) old,pg_get_functiondef('gridex_service_permission.context_source_base_v1(uuid,uuid,uuid,bigint,text,uuid)'::regprocedure) next")).rows[0]
 const a=definitions.old.indexOf(' PERFORM u.id FROM public.user_profiles'),b=definitions.old.indexOf(' SELECT * INTO STRICT a FROM',a)
 check(definitions.old.slice(0,a).concat(definitions.old.slice(b)).replace('context_before_agreement_reference_v1(','context_source_base_v1('),definitions.next)
 const c=uid(1),preparer=uid(20),executor=uid(980),pid=uid(981),mid=uid(982),iid=uid(983)
 const created=await command({action:'create_assignment',commandId:uid(984),fields:{beneficiary_company_id:uid(2),provider_actor_id:uid(30),actor_profile_id:uid(40),customer_id:uid(10),dso_actor_id:uid(31),environment:'test',mode:'V',purpose:'phase source probe',object_ids:['point-a'],product_ids:['8716867000030'],field_sets:['quantity'],data_start:'2026-01-01',data_end:'2027-01-01',valid_from:'2000-01-01',valid_to:null}})
 const aid=created.assignmentId
 await db.query("INSERT INTO metering_permissions(id,company_id,customer_id,status,source_z13_message_id,outbound_z13_message_id) VALUES($1,$2,$3,'z13_ready',$4,$4)",[pid,c,uid(10),mid])
 await db.query('INSERT INTO ediel_assignment_permission_links(company_id,assignment_id,permission_id) VALUES($1,$2,$3)',[c,aid,pid])
 for(const kind of ['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles'])await db.query("INSERT INTO ediel_service_evidence(company_id,assignment_id,kind,source_reference,source_sha256,source_version,valid_from,status,approved_by,approved_at,approved_assignment_version,permission_purpose_code,permission_reporting_frequency,permission_request_grid_area,permission_reporting_term_kind,permission_customer_classification,permission_agreement_reference,permission_requested_method) VALUES($1,$2,$3,'DECLARED SYNTHETIC SOURCE',repeat('a',64),'fixture','2000-01-01','verified',$4,'2000-01-01',1,'B72','D','TES','bounded','nonprivate','SOURCE-ANJ','Z04')",[c,aid,kind,preparer])
 await db.query("UPDATE ediel_service_assignments SET status='active' WHERE id=$1",[aid])
 const version=(await db.query('SELECT version FROM ediel_service_assignments WHERE id=$1',[aid])).rows[0].version
 const context=()=>db.query('SELECT gridex_service_permission.context_v1($1,$2,$3,$4,\'Z13\',$5) b',[c,aid,preparer,version,pid]).then(r=>r.rows[0].b)
 const basis=await context();check(basis.status,'authorized');check(basis.agreementReference,'SOURCE-ANJ');check(basis.requestedMethod,'Z04')
 const raw="UNH+1+PRODAT:D:96B:UN:E2SE6A'BGM+Z13+DOC+9'RFF+ANJ:SOURCE-ANJ'LIN+1'CCI++Z04'CAV+Z04'UNT+7+1'"
 await db.query("INSERT INTO ediel_message_intents(id) VALUES($1)",[iid])
 await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,intent_id,customer_id,raw_payload,immutable_rendered_at,immutable_payload_hash) VALUES($1,$2,'test','outbound','PRODAT','Z13',$3,$4,$5,now(),encode(sha256(convert_to($5,'UTF8')),'hex'))",[mid,c,iid,uid(10),raw])
 await db.query("INSERT INTO gridex_service_permission.origins(intent_id,company_id,assignment_id,permission_id,actor_user_id,message_code,command_key,basis,message_id) VALUES($1,$2,$3,$4,$5,'Z13','SOURCE-PROBE',$6,$7)",[iid,c,aid,pid,preparer,basis,mid])
 await db.query("INSERT INTO user_profiles VALUES($1,'active');",[executor])
 await db.query("INSERT INTO company_memberships VALUES($1,$2,'active',true,now())",[c,executor])
 await db.exec('CREATE TABLE phase_permissions(actor uuid,company uuid,permission text);CREATE OR REPLACE FUNCTION public.gridex_actor_has_company_permission(a uuid,c uuid,p text) RETURNS bool LANGUAGE sql AS $$SELECT EXISTS(SELECT FROM public.phase_permissions WHERE actor=a AND company=c AND permission=p)$$;')
 await db.query("INSERT INTO phase_permissions VALUES($1,$2,'ediel.send')",[executor,c])
 await db.query("UPDATE user_profiles SET user_status='inactive' WHERE id=$1",[preparer])
 await rejects(context,/actor_forbidden/)
 const read=async(phase='send')=>{await db.exec('SET ROLE service_role');try{return(await db.query('SELECT public.ediel_service_permission_message_basis_v1($1,$2,$3,$4) b',[c,mid,executor,phase])).rows[0].b}finally{await db.exec('RESET ROLE')}}
 const originalSnapshot=JSON.stringify((await db.query('SELECT * FROM gridex_service_permission.origins WHERE message_id=$1',[mid])).rows)
 check((await read()).basis,basis);check((await read()).actorUserId,preparer)
 await rejects(()=>read('prepare'),/forbidden/)
 await db.query("INSERT INTO phase_permissions VALUES($1,$2,'communication.write')",[executor,c]);check((await read('prepare')).basis,basis)
 await db.exec("UPDATE tenant_ediel_profiles SET is_enabled=false");await rejects(read,/basis_stale/);await db.exec("UPDATE tenant_ediel_profiles SET is_enabled=true")
 await db.query("UPDATE ediel_messages SET raw_payload=$1,immutable_payload_hash=encode(sha256(convert_to($1,'UTF8')),'hex') WHERE id=$2",[raw.replace('SOURCE-ANJ','FORGED-ANJ'),mid]);await rejects(read,/agreement_reference_required/)
 await db.query("UPDATE ediel_messages SET raw_payload=$1,immutable_payload_hash=encode(sha256(convert_to($1,'UTF8')),'hex') WHERE id=$2",[raw.replace('CAV+Z04','CAV+Z03'),mid]);await rejects(read,/requested_method_required/)
 await db.query("UPDATE ediel_messages SET raw_payload=$1,immutable_payload_hash=encode(sha256(convert_to($1,'UTF8')),'hex') WHERE id=$2",[raw,mid]);check((await read()).basis,basis)
 await db.query('UPDATE ediel_messages SET immutable_payload_hash=NULL WHERE id=$1',[mid]);await rejects(read,/source_message_changed/)
 await db.query("UPDATE ediel_messages SET immutable_payload_hash=encode(sha256(convert_to(raw_payload,'UTF8')),'hex') WHERE id=$1",[mid])
 await db.query('UPDATE ediel_messages SET immutable_rendered_at=NULL WHERE id=$1',[mid]);await rejects(read,/source_message_changed/)
 await db.query('UPDATE ediel_messages SET immutable_rendered_at=now() WHERE id=$1',[mid])
 await db.query("UPDATE ediel_service_evidence SET status='revoked' WHERE assignment_id=$1 AND kind='end_user_contract'",[aid]);await rejects(read,/basis_stale/)
 check((await db.query("SELECT has_function_privilege('service_role','gridex_service_permission.context_source_v1(uuid,uuid,uuid,bigint,text,uuid)','EXECUTE') b")).rows[0].b,false)
 check((await db.query("SELECT has_function_privilege('service_role','gridex_service_permission.require_original_source_current_v1(uuid,uuid)','EXECUTE') b")).rows[0].b,false)
 check(JSON.stringify((await db.query('SELECT * FROM gridex_service_permission.origins WHERE message_id=$1',[mid])).rows),originalSnapshot)
 console.log(`${checks} real service source context/ANJ/217 phase composition checks passed; external approvals/source ports declared synthetic, native/authentic not run`)
}
