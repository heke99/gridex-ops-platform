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
 await db.exec("ALTER TABLE metering_permissions ADD UNIQUE(company_id,id);CREATE TABLE public.user_permission_overrides(id uuid);CREATE FUNCTION gridex_service_administration.require_manual_actor_v1(c uuid,actor uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL) OR public.gridex_actor_has_company_permission(actor,c,'metering.write') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_service_manual_actor_forbidden';END IF;END $$;CREATE FUNCTION public.ediel_resolve_service_permission_command_v1(p_company_id uuid,p_assignment_id uuid,p_actor_user_id uuid,p_expected_version bigint,p_permission_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$SELECT jsonb_build_object('status','permission_required','permissionId',p.id) FROM public.metering_permissions p WHERE p.company_id=p_company_id AND p.id=p_permission_id$$;")
 // The retained resolver above is an explicitly finite READ-ONLY boundary. It
 // grants no archive/source/assignment authority; actual producer gates below
 // exercise new SQL and genuine archive/stage/separate review commands.
 const forward=readFileSync(new URL('../supabase/migrations/20261001043917_ediel_service_source_network_period_timing.sql',import.meta.url),'utf8'),producerEnd=forward.indexOf('CREATE TABLE gridex_service_permission.request_timing_receipts(')
 const baseline=process.env.EDIEL_SERVICE_TIMING_BASELINE==='1'
 await db.exec(getFunction(new URL('../supabase/migrations/20261001043917_ediel_service_source_network_period_timing.sql',import.meta.url),'CREATE FUNCTION gridex_service_permission.lock_request_writer_v1'))
 const oidBefore=(await db.query("SELECT oid,proacl::text acl FROM pg_proc WHERE oid='public.ediel_coordinate_service_permission_v1(uuid,uuid,uuid,bigint,text)'::regprocedure")).rows[0]
 if(baseline)await db.exec(forward.slice(0,producerEnd)+'COMMIT;');else await db.exec(forward.replace('CREATE FUNCTION gridex_service_permission.lock_request_writer_v1','CREATE OR REPLACE FUNCTION gridex_service_permission.lock_request_writer_v1'))
 let timingChecks=0,serial=0;const tcheck=async f=>{await f();timingChecks++}
 const effectCount=async()=>(await db.query("SELECT jsonb_build_object('permissions',(SELECT count(*) FROM metering_permissions),'links',(SELECT count(*) FROM ediel_assignment_permission_links),'origins',(SELECT count(*) FROM gridex_service_permission.origins)) c")).rows[0].c
 const approveFresh=async({mode='V',start='2020-01-01T00:00:00Z',end=null,networkStart='2026-01-01',networkEnd=null}={})=>{
  const count=++serial,created=await command({action:'create_assignment',commandId:uid(5000+count*100),fields:{...fields,mode,data_start:start,data_end:end,purpose:'Synthetic bounded timing purpose '+count}}),assignment=created.assignmentId
  const scope=(await db.query('SELECT gridex_service_administration.scope_v1(a) s FROM ediel_service_assignments a WHERE id=$1',[assignment])).rows[0].s,scopehash=(await db.query("SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') h",[scope])).rows[0].h
  if(count===1)await tcheck(async()=>{const before=(await db.query('SELECT count(*) n FROM gridex_ediel_services.artifacts')).rows[0].n;await assert.rejects(archive({assignmentId:assignment,scopeBasisVersion:1,kind:'service_contract',terms:{valid_from:'2000-01-01',valid_to:null,permission_network_contract_start:'2026-01-01',permission_network_contract_end:null},source:{bytesBase64:pdf.toString('base64'),mimeType:'application/pdf',reference:'Wrong actual contract kind must not archive DSO timing',version:'synthetic-v1'}}),/ediel_service_archive_network_period_kind_invalid/);assert.equal((await db.query('SELECT count(*) n FROM gridex_ediel_services.artifacts')).rows[0].n,before)})
  for(const [index,kind] of ['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles'].entries()){
   const repr=uid(5001+count*100+index),reference='bounded-network-period-'+count+'-'+kind,terms={valid_from:'2000-01-01',valid_to:null,permission_agreement_reference:kind==='end_user_contract'?'SYN-SIGNED-TIMING-AGREEMENT':null,permission_requested_method:kind==='end_user_contract'?'Z04':null,permission_network_contract_start:kind==='dso_contract'?networkStart:null,permission_network_contract_end:kind==='dso_contract'?networkEnd:null}
   await db.query("INSERT INTO gridex_ediel_services.issuer_representations(id,company_id,environment,issuer_key_id,legal_actor_id,beneficiary_company_id,customer_id,dso_actor_id,evidence_kind,scope_hash,legal_representation_reference,legal_authority_source_hash,valid_from,valid_to) VALUES($1,$2,'test',$3,$4,$5,$6,$7,$8,$9,'SYNTHETIC EXTERNAL PERIOD FACTS ONLY',$10,'2000-01-01','2099-01-01')",[repr,uid(1),keyid,scope.providerActorId,scope.beneficiaryCompanyId,scope.customerId,scope.dsoActorId,kind,scopehash,pdfHash])
   const normalized=(await db.query('SELECT gridex_ediel_services.evidence_terms_v1(jsonb_populate_record(NULL::public.ediel_service_evidence,$1)) t',[terms])).rows[0].t
   const payload={format:'ediel_service_evidence_receipt_v1',issuerCode:'synthetic-ESCO-issuer',receiptId:uid(5010+count*100+index),companyId:uid(1),environment:'test',assignmentId:assignment,scopeBasisVersion:1,scope,evidenceKind:kind,evidenceTerms:normalized,sourceHash:pdfHash,sourceReference:reference,sourceVersion:'synthetic-v1',transportRelationId:null,transportActorId:null,issuedAt:new Date().toISOString(),expiresAt:'2090-01-01T00:00:00Z'},raw=Buffer.from(JSON.stringify(payload))
   const artifact=await archive({assignmentId:assignment,scopeBasisVersion:1,kind,terms,source:{bytesBase64:pdf.toString('base64'),mimeType:'application/pdf',reference,version:'synthetic-v1'},issuerReceipt:{keyId:keyid,representationId:repr,payloadBase64:raw.toString('base64'),signatureHex:createHmac('sha256',syntheticKey).update(raw).digest('hex')}})
   const staged=await command({action:'stage_evidence',commandId:uid(5020+count*100+index),assignmentId:assignment,expectedVersion:1,fields:{kind,source_reference:reference,source_sha256:pdfHash,source_version:'synthetic-v1',...terms}})
   const reviewed=await review(artifact,staged.evidenceId);assert.equal(reviewed.status,'verified',JSON.stringify({kind,missing:reviewed.missing,artifactMissing:artifact.missing}))
  }
  assert.equal((await command({action:'approve_assignment',commandId:uid(5030+count*100),assignmentId:assignment,expectedVersion:1})).status,'approved_waiting_permission')
  const request=async()=>{await db.exec('SET ROLE service_role');try{return(await db.query('SELECT public.ediel_coordinate_service_permission_v1($1,$2,$3,2,\'request_access\') r',[uid(1),assignment,uid(20)])).rows[0].r}finally{await db.exec('RESET ROLE')}}
  return{assignment,request}
 }
 await tcheck(async()=>{const f=await approveFresh(),before=await effectCount(),r=await f.request();assert.equal(r.status,'held','old coordinator must not authorize a source period outside three years/network contract');assert.deepEqual(await effectCount(),before)})
 if(baseline)throw Error('baseline unexpectedly passed actual missing timing consumer')
 await tcheck(async()=>{await requireScope(ackRaw.replace('+A+', '+NATIVE-REVIEW-A+'))})
 await tcheck(async()=>{const after=(await db.query("SELECT oid,proacl::text acl FROM pg_proc WHERE oid='public.ediel_coordinate_service_permission_v1(uuid,uuid,uuid,bigint,text)'::regprocedure")).rows[0];assert.deepEqual(after,oidBefore)})
 const period=async(mode,start,end,day,networkStart='2000-01-01',networkEnd=null)=>(await db.query('SELECT gridex_service_permission.evaluate_request_period_v1($1,$2,$3,$4,$5,$6) r',[mode,start,end,day,networkStart,networkEnd])).rows[0].r
 for(const [mode,start,end,day,networkStart,networkEnd,expected] of [
  ['V','2023-02-28T00:00:00Z',null,'2026-02-28','2000-01-01',null,'authorized'],
  ['V','2023-02-27T00:00:00Z',null,'2026-02-28','2000-01-01',null,'held'],
  ['V','2021-02-28T00:00:00Z',null,'2024-02-29','2000-01-01',null,'authorized'],
  ['V','2021-02-27T00:00:00Z',null,'2024-02-29','2000-01-01',null,'held'],
  ['V','2026-03-28T23:30:00Z',null,'2026-03-29','2026-03-29',null,'authorized'],
  ['V','2026-03-28T22:30:00Z',null,'2026-03-29','2026-03-29',null,'held'],
  ['V','2026-10-25T00:00:00Z','2026-10-26T00:00:00Z','2026-10-25','2026-10-25','2026-10-26','authorized'],
  ['V','2026-10-25T00:00:00Z','2026-10-25T12:00:00Z','2026-10-25','2026-10-25',null,'held'],
  ['V','2026-10-24T00:00:00Z',null,'2026-10-25','2000-01-01','2026-10-24','held'],
  ['V','2026-10-26T00:00:00Z',null,'2026-10-25','2000-01-01',null,'held'],
  ['V','2026-10-25T00:00:00Z','2026-10-27T00:00:00Z','2026-10-25','2000-01-01','2026-10-26','held'],
  ['VH','2026-10-24T00:00:00Z','2026-10-24T23:00:00+01:00','2026-10-25','2026-10-24','2026-10-24','authorized'],
  ['VH','2026-10-24T00:00:00Z',null,'2026-10-25','2000-01-01',null,'held'],
  ['VH','2026-10-25T00:00:00Z','2026-10-26T00:00:00Z','2026-10-25','2000-01-01',null,'held'],
  ['VH','2026-10-23T00:00:00Z','2026-10-25T00:00:00Z','2026-10-25','2000-01-01',null,'held'],
  ['VH','2026-10-23T00:00:00Z','2026-10-24T00:00:00Z','2026-10-25','2026-10-24',null,'held'],
  ['VH','2026-10-23T00:00:00Z','2026-10-24T00:00:00Z','2026-10-25','2000-01-01','2026-10-23','held'],
 ])await tcheck(async()=>assert.equal((await period(mode,start,end,day,networkStart,networkEnd)).status,expected))
 const valid=await approveFresh({start:'2026-06-01T00:00:00Z',networkStart:'2026-01-01'}),first=await valid.request()
 assert.equal(first.status,'permission_required')
 await db.exec("CREATE FUNCTION public.timing_insert_tripwire() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'timing_replay_insert_attempt';END $$;CREATE TRIGGER timing_no_link_insert BEFORE INSERT ON ediel_assignment_permission_links FOR EACH ROW EXECUTE FUNCTION timing_insert_tripwire();CREATE TRIGGER timing_no_receipt_insert BEFORE INSERT ON gridex_service_permission.request_timing_receipts FOR EACH ROW EXECUTE FUNCTION timing_insert_tripwire()")
 await tcheck(async()=>{const before=await effectCount();assert.deepEqual(await valid.request(),first);assert.deepEqual(await effectCount(),before)})
 await tcheck(async()=>{const before=await effectCount();await db.exec('BEGIN');try{await db.query("UPDATE user_profiles SET user_status='inactive' WHERE id=$1",[reviewer]);assert.equal((await valid.request()).status,'held');assert.deepEqual(await effectCount(),before)}finally{await db.exec('ROLLBACK')}})
 await db.exec('DROP TRIGGER timing_no_link_insert ON ediel_assignment_permission_links')
 await tcheck(async()=>{const f=await approveFresh({start:'2026-07-01T00:00:00Z',networkStart:'2026-01-01'}),before=await effectCount();await assert.rejects(f.request(),/timing_replay_insert_attempt/);assert.deepEqual(await effectCount(),before);assert.equal((await db.query('SELECT count(*) n FROM gridex_service_permission.request_timing_receipts WHERE assignment_id=$1',[f.assignment])).rows[0].n,0)})
 await tcheck(async()=>{const acl=(await db.query("SELECT has_table_privilege('service_role','gridex_service_permission.request_timing_receipts','SELECT') r,has_table_privilege('service_role','gridex_service_permission.request_timing_receipts','INSERT') w")).rows[0];assert.deepEqual(acl,{r:false,w:false})})
 console.log('Actual timing producer/consumer forward: '+timingChecks+' checks PASS; '+(checks+scopeChecks+evidenceChecks)+' inherited checks PASS; finite retained-source boundary NOT native')
 await db.close();process.exit(0)

`
const end=" console.log('Actual ESCO archived-source/issuer/separate-review/current-grant mechanism: "
assert.equal(base.split(end).length,2);base=base.replace(end,()=>proof+end)
const temp=fileURLToPath(new URL('./.ediel-service-timing-nested.tmp.mjs',import.meta.url));writeFileSync(temp,base)
try{const run=spawnSync(process.execPath,[temp],{stdio:'inherit',env:process.env});if(run.error)throw run.error;process.exitCode=run.status??1}finally{unlinkSync(temp)}
