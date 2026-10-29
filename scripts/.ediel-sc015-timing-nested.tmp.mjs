// Executed source-custody/review/grant consumer SQL; declared synthetic issuer
// registry and source/storage dependencies. Not native/external legal approval.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const base=readFileSync(new URL('./.ediel-sc015-ack-bootstrap.tmp.mjs',import.meta.url),'utf8')
const marker=" console.log('Actual positive ACK service-scope SQL consumer: "
assert.equal(base.split(marker).length,2)
const extension=String.raw`
 const {createHash,createHmac}=await import('node:crypto')
 await db.exec("ALTER TABLE permissions ADD key text UNIQUE,ADD name text,ADD description text,ADD category text,ADD is_active boolean DEFAULT true;ALTER TABLE user_permissions ADD user_id uuid,ADD company_id uuid,ADD permission_id uuid,ADD permission_key text,ADD is_active boolean DEFAULT true,ADD status text DEFAULT 'active',ADD effect text DEFAULT 'allow';ALTER TABLE user_roles ADD user_id uuid,ADD role_id uuid,ADD company_id uuid,ADD is_active boolean DEFAULT true,ADD status text DEFAULT 'active';ALTER TABLE roles ADD is_active boolean DEFAULT true;ALTER TABLE role_permissions ADD role_id uuid,ADD permission_id uuid,ADD permission_key text,ADD effect text DEFAULT 'allow';")
 await db.exec("ALTER TABLE ediel_service_evidence ADD IF NOT EXISTS permission_agreement_reference text,ADD IF NOT EXISTS permission_requested_method text;CREATE SCHEMA gridex_metering_method_changes;CREATE FUNCTION gridex_metering_method_changes.requested_method_supported_v1(method text) RETURNS boolean LANGUAGE sql AS 'SELECT $1 IN (''Z03'',''Z04'')'")
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001000926_ediel_service_evidence_archive_review.sql',import.meta.url),'utf8'))
 await db.exec(getFunction(new URL('../supabase/migrations/20260930235816_ediel_service_permission_source_requested_method.sql',import.meta.url),'CREATE OR REPLACE FUNCTION public.ediel_service_administration_command_v1'))
 if(process.env.EDIEL_PERMISSION_TERMS_BASELINE!=='1') await db.exec(readFileSync(new URL('../supabase/migrations/20261001041436_ediel_service_evidence_source_permission_terms.sql',import.meta.url),'utf8'))
 await db.exec("UPDATE metering_permissions SET metadata=jsonb_set(metadata,'{marketPermission,mode}','\"S17\"'::jsonb)")
 let evidenceChecks=0;const echeck=async f=>{await f();evidenceChecks++}
 const reviewer=uid(320),keyid=uid(321),nativeScope=(await db.query('SELECT gridex_service_administration.scope_v1(a) s FROM ediel_service_assignments a WHERE a.id=$1',[aid])).rows[0].s,scopeHash=(await db.query('SELECT encode(sha256(convert_to(gridex_service_administration.scope_v1(a)::text,\'UTF8\')),\'hex\') h FROM ediel_service_assignments a WHERE a.id=$1',[aid])).rows[0].h
 const pdf=Buffer.from('%PDF-1.7\nSynthetic bounded ESCO contract archive. NOT external issuer approval.\n%%EOF'),pdfHash=createHash('sha256').update(pdf).digest('hex'),syntheticKey=Buffer.alloc(32,0x49)
 // Explicit synthetic trusted issuer provisioning is distinct from review or
 // acceptance receipts. No service evidence is inserted as verified.
 await db.query('INSERT INTO auth.users VALUES($1)',[reviewer]);await db.query("INSERT INTO user_profiles VALUES($1,'active')",[reviewer]);await db.query("INSERT INTO company_memberships VALUES($1,$2,'active',true,now())",[uid(1),reviewer])
 await db.query("INSERT INTO gridex_ediel_services.issuer_keys(id,company_id,environment,issuer_code,legal_issuer_reference,legal_authority_source_hash,receipt_signing_key,valid_from,valid_to) VALUES($1,$2,'test','synthetic-ESCO-issuer','SYNTHETIC LOCAL FIXTURE NOT EXTERNAL AUTHORITY',$3,$4,'2000-01-01','2099-01-01')",[keyid,uid(1),pdfHash,syntheticKey])
 const heldAssessment=async()=>(await db.query('SELECT ediel_service_assignment_assessment_v1($1,$2) r',[uid(1),aid])).rows[0].r
 await echeck(async()=>{assert.equal((await heldAssessment()).status,'held');await assert.rejects(requireScope(),/unique_current_grant_required/)})
 const archive=(submission,actor=uid(20),company=uid(1))=>db.query('SELECT ediel_archive_service_evidence_v1($1,$2,$3) r',[company,actor,submission]).then(r=>r.rows[0].r)
 const review=(artifact,evidence,actor=reviewer,changes={})=>db.query('SELECT ediel_review_service_evidence_v1($1,$2,$3,$4,$5) r',[uid(1),actor,artifact.artifactId,evidence,{decision:'approve',reason:'Independent synthetic mechanism review, not legal certification',sourceHash:artifact.sourceHash,scopeHash:artifact.scopeHash,...changes}]).then(r=>r.rows[0].r)
 const nativeTerms=(await db.query("SELECT gridex_ediel_services.evidence_terms_v1(jsonb_populate_record(NULL::public.ediel_service_evidence,'{\"valid_from\":\"2000-01-01T00:00:00Z\",\"valid_to\":null}')) t")).rows[0].t
 let lastArtifact,lastEvidence,lastSubmission;const nativeArtifacts=[]
 const staged=await command({action:'stage_evidence',commandId:uid(329),assignmentId:aid,expectedVersion:2,fields:{kind:'end_user_contract',source_reference:'missing-external-issuer',source_sha256:pdfHash,source_version:'synthetic-v1',valid_from:'2000-01-01',valid_to:null}})
 const unauth=await archive({assignmentId:aid,scopeBasisVersion:1,kind:'end_user_contract',terms:nativeTerms,source:{bytesBase64:pdf.toString('base64'),mimeType:'application/pdf',reference:'missing-external-issuer',version:'synthetic-v1'}})
 await echeck(async()=>{assert.ok(unauth.missing.includes('authentic_current_issuer_and_representation_receipt'));await assert.rejects(review(unauth,staged.evidenceId),/reviewer_forbidden/)})
 // Materialized permission gets no default role/user grants.
 await echeck(async()=>{assert.equal((await db.query("SELECT count(*) n FROM user_permissions WHERE permission_key='ediel.service_evidence.review'")).rows[0].n,0)})
 await db.query("INSERT INTO user_permissions(id,user_id,company_id,permission_id,permission_key) SELECT $1,$2,$3,id,key FROM permissions WHERE key='ediel.service_evidence.review'",[uid(322),reviewer,uid(1)])
 await echeck(async()=>{assert.equal((await review(unauth,staged.evidenceId)).status,'held');assert.equal((await db.query('SELECT status FROM ediel_service_evidence WHERE id=$1',[staged.evidenceId])).rows[0].status,'pending')})
 let index=0
 for(const kind of ['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles']){
  index++;const representationId=uid(330+index),reference='synthetic-ESCO-'+kind,sourceVersion='synthetic-v1'
  await db.query("INSERT INTO gridex_ediel_services.issuer_representations(id,company_id,environment,issuer_key_id,legal_actor_id,beneficiary_company_id,customer_id,dso_actor_id,evidence_kind,scope_hash,legal_representation_reference,legal_authority_source_hash,valid_from,valid_to) VALUES($1,$2,'test',$3,$4,$5,$6,$7,$8,$9,'SYNTHETIC LOCAL LEGAL REPRESENTATION FIXTURE',$10,'2000-01-01','2099-01-01')",[representationId,uid(1),keyid,uid(30),uid(2),uid(10),uid(31),kind,scopeHash,pdfHash])
  const payload={format:'ediel_service_evidence_receipt_v1',issuerCode:'synthetic-ESCO-issuer',receiptId:uid(350+index),companyId:uid(1),environment:'test',assignmentId:aid,scopeBasisVersion:1,scope:nativeScope,evidenceKind:kind,evidenceTerms:nativeTerms,sourceHash:pdfHash,sourceReference:reference,sourceVersion,transportRelationId:null,transportActorId:null,issuedAt:'2026-01-01T00:00:00Z',expiresAt:'2090-01-01T00:00:00Z'},raw=Buffer.from(JSON.stringify(payload))
  const submission={assignmentId:aid,scopeBasisVersion:1,kind,terms:nativeTerms,source:{bytesBase64:pdf.toString('base64'),mimeType:'application/pdf',reference,version:sourceVersion},issuerReceipt:{keyId:keyid,representationId,payloadBase64:raw.toString('base64'),signatureHex:createHmac('sha256',syntheticKey).update(raw).digest('hex')}}
  const artifact=await archive(submission),evidence=await command({action:'stage_evidence',commandId:uid(370+index),assignmentId:aid,expectedVersion:2,fields:{kind,source_reference:reference,source_sha256:pdfHash,source_version:sourceVersion,valid_from:'2000-01-01',valid_to:null}})
  assert.deepEqual(artifact.missing,['separate_qualified_reviewer_required']);assert.equal((await review(artifact,evidence.evidenceId)).status,'verified');evidenceChecks++
  nativeArtifacts.push({artifact,evidence:evidence.evidenceId,submission});lastArtifact=artifact;lastEvidence=evidence.evidenceId;lastSubmission=submission
 }
 await echeck(async()=>{assert.equal((await heldAssessment()).status,'authorized');await assert.rejects(requireScope(),/receipt_changed/);const freshRaw=ackRaw.replace('+A+', '+NATIVE-REVIEW-A+');await capture(freshRaw);await requireScope(freshRaw)})
 await echeck(async()=>{const got=(await db.query('SELECT ediel_read_service_evidence_archive_v1($1,$2,$3,true) r',[uid(1),reviewer,lastArtifact.artifactId])).rows[0].r;assert.equal(got.sourceHash,pdfHash);assert.equal(got.bytesBase64,pdf.toString('base64'));assert.equal(got.issuerCurrent,true);assert.equal(got.marketActivationGranted,false)})
 await echeck(async()=>{await assert.rejects(review(lastArtifact,lastEvidence,uid(20)),/reviewer_forbidden/);await assert.rejects(review(lastArtifact,lastEvidence,reviewer,{sourceHash:'f'.repeat(64)}),/actual_hash_required/);await assert.rejects(archive({...lastSubmission,scopeBasisVersion:2}),/current_scope_required/)})
 const eEffects=async()=>(await db.query('SELECT (SELECT count(*) FROM gridex_ediel_services.artifacts) archives,(SELECT count(*) FROM gridex_ediel_services.reviews) reviews,(SELECT count(*) FROM gridex_ediel_ack_replay.positive_service_scope_receipts) ack_receipts')).rows[0]
 const eRollback=async(change,verify)=>{const stableE=await eEffects();await db.exec('BEGIN');try{await db.exec(change);await verify()}finally{await db.exec('ROLLBACK')}assert.deepEqual(await eEffects(),stableE);assert.equal((await heldAssessment()).status,'authorized')}
 await echeck(()=>eRollback("UPDATE user_permissions SET is_active=false WHERE user_id='"+reviewer+"'",async()=>{assert.equal((await heldAssessment()).status,'held');await assert.rejects(review(lastArtifact,lastEvidence),/reviewer_forbidden/)}))
 await echeck(()=>eRollback("UPDATE company_memberships SET is_active=false WHERE user_id='"+reviewer+"'",async()=>{assert.equal((await heldAssessment()).status,'held')}))
 await echeck(()=>eRollback("INSERT INTO gridex_ediel_services.issuer_revocations VALUES('representation','"+uid(335)+"','SYNTHETIC REVOKED',repeat('c',64),now())",async()=>{assert.equal((await heldAssessment()).status,'held');assert.equal((await review(lastArtifact,lastEvidence)).status,'held')}))
 await echeck(()=>eRollback("INSERT INTO gridex_ediel_services.issuer_revocations VALUES('key','"+keyid+"','SYNTHETIC REVOKED',repeat('c',64),now())",async()=>{assert.equal((await heldAssessment()).status,'held')}))
 await echeck(async()=>{await assert.rejects(db.exec('UPDATE gridex_ediel_services.artifacts SET source_bytes=source_bytes||decode(\'00\',\'hex\')'),/original_immutable/);await assert.rejects(db.exec('DELETE FROM gridex_ediel_services.reviews'),/original_immutable/);await assert.rejects(db.exec('TRUNCATE gridex_ediel_services.issuer_keys CASCADE'),/original_immutable/)})
 await echeck(async()=>{const tampered={...lastSubmission,source:{...lastSubmission.source,reference:'tampered-external-contract'},issuerReceipt:{...lastSubmission.issuerReceipt,signatureHex:'a'.repeat(64)}},a=await archive(tampered),e=await command({action:'stage_evidence',commandId:uid(390),assignmentId:aid,expectedVersion:2,fields:{kind:'privacy_roles',source_reference:tampered.source.reference,source_sha256:pdfHash,source_version:'synthetic-v1',valid_from:'2000-01-01',valid_to:null}});assert.ok(a.missing.includes('authentic_current_issuer_and_representation_receipt'));assert.equal((await review(a,e.evidenceId)).status,'held')})
 await echeck(async()=>{const native=(await db.query('SELECT encode(gridex_ediel_services.receipt_hmac_sha256_v1($1,$2),\'hex\') h',[Buffer.from('Independent RFC2104 '+String.fromCodePoint(0x00e5)+' raw payload'),Buffer.alloc(80,0x6b)])).rows[0].h;assert.equal(native,createHmac('sha256',Buffer.alloc(80,0x6b)).update('Independent RFC2104 '+String.fromCodePoint(0x00e5)+' raw payload').digest('hex'))})
 await echeck(async()=>{await db.exec('BEGIN');try{await db.query("INSERT INTO user_permissions(id,user_id,company_id,permission_id,permission_key) SELECT $1,$2,$3,id,key FROM permissions WHERE key='ediel.service_evidence.review'",[uid(399),uid(20),uid(1)]);await assert.rejects(review(lastArtifact,lastEvidence,uid(20)),/separate_owned_review_required/)}finally{await db.exec('ROLLBACK')}})
 await echeck(()=>eRollback("UPDATE ediel_service_evidence SET status='revoked' WHERE id='"+lastEvidence+"'",async()=>{assert.equal((await heldAssessment()).status,'held')}))
 await echeck(async()=>{const changed={...lastSubmission,source:{...lastSubmission.source,reference:'claimed-unbound-terms'},terms:{...lastSubmission.terms,permission_reporting_frequency:'invented'}},a=await archive(changed),e=await command({action:'stage_evidence',commandId:uid(398),assignmentId:aid,expectedVersion:2,fields:{kind:'privacy_roles',source_reference:changed.source.reference,source_sha256:pdfHash,source_version:'synthetic-v1',valid_from:'2000-01-01',valid_to:null,permission_reporting_frequency:'invented'}});assert.ok(a.missing.includes('authentic_current_issuer_and_representation_receipt'));assert.equal((await review(a,e.evidenceId)).status,'held')})
 await echeck(async()=>{const acl=(await db.query("SELECT has_table_privilege('service_role','gridex_ediel_services.reviews','INSERT') receipt,has_table_privilege('service_role','gridex_ediel_services.issuer_keys','SELECT') secrets,has_function_privilege('authenticated','public.ediel_review_service_evidence_v1(uuid,uuid,uuid,uuid,jsonb)','EXECUTE') review")).rows[0];assert.deepEqual(acl,{receipt:false,secrets:false,review:false})})
 await echeck(()=>eRollback("UPDATE metering_permissions SET metadata=jsonb_set(metadata,'{marketPermission,mode}','\"V\"'::jsonb)",async()=>{await assert.rejects(db.query('SELECT gridex_ediel_ack_replay.positive_service_scope_projection_v1($1,$2,$3,$4)',[uid(1),'test',uid(210),ackRaw]),/unique_current_grant_required/)}))

 await db.exec("ALTER TABLE metering_permissions ADD UNIQUE(company_id,id);CREATE TABLE public.user_permission_overrides(id uuid);")
 // The retained resolver above is an explicitly finite READ-ONLY boundary. It
 // grants no archive/source/assignment authority; actual producer gates below
 // exercise new SQL and genuine archive/stage/separate review commands.
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001020640_ediel_service_permission_manual_source_commands.sql',import.meta.url),'utf8'))
 const forward=readFileSync(new URL('../supabase/migrations/20261001043917_ediel_service_source_network_period_timing.sql',import.meta.url),'utf8'),producerEnd=forward.indexOf('CREATE TABLE gridex_service_permission.request_timing_receipts(')
 const baseline=process.env.EDIEL_SERVICE_TIMING_BASELINE==='1'
 await db.exec(getFunction(new URL('../supabase/migrations/20261001043917_ediel_service_source_network_period_timing.sql',import.meta.url),'CREATE FUNCTION gridex_service_permission.lock_request_writer_v1'))
 const oidBefore=(await db.query("SELECT oid,proacl::text acl FROM pg_proc WHERE oid='public.ediel_coordinate_service_permission_v1(uuid,uuid,uuid,bigint,text)'::regprocedure")).rows[0]
 if(baseline)await db.exec(forward.slice(0,producerEnd)+'COMMIT;');else await db.exec(forward.replace('CREATE FUNCTION gridex_service_permission.lock_request_writer_v1','CREATE OR REPLACE FUNCTION gridex_service_permission.lock_request_writer_v1'))
 let timingChecks=0,serial=0;const tcheck=async f=>{await f();timingChecks++}
 const effectCount=async()=>(await db.query("SELECT jsonb_build_object('permissions',(SELECT count(*) FROM metering_permissions),'links',(SELECT count(*) FROM ediel_assignment_permission_links),'origins',(SELECT count(*) FROM gridex_service_permission.origins)) c")).rows[0].c
 const approveFresh=async({mode='V',start='2020-01-01T00:00:00Z',end=null,networkStart='2026-01-01',networkEnd=null,extra=null}={})=>{
  const count=++serial,created=await command({action:'create_assignment',commandId:uid(5000+count*100),fields:{...fields,mode,data_start:start,data_end:end,purpose:'Synthetic bounded timing purpose '+count,...(extra||{})}}),assignment=created.assignmentId
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
 await db.exec("CREATE FUNCTION public.timing_insert_tripwire() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'timing_replay_insert_attempt';END $$;CREATE TRIGGER timing_no_link_insert BEFORE INSERT ON ediel_assignment_permission_links FOR EACH ROW EXECUTE FUNCTION timing_insert_tripwire();CREATE TRIGGER timing_no_receipt_insert BEFORE INSERT ON gridex_service_permission.request_timing_receipts FOR EACH ROW EXECUTE FUNCTION timing_insert_tripwire()")
 await tcheck(async()=>{const before=await effectCount();assert.deepEqual(await valid.request(),first);assert.deepEqual(await effectCount(),before)})
 await tcheck(async()=>{const before=await effectCount();await db.exec('BEGIN');try{await db.query("UPDATE user_profiles SET user_status='inactive' WHERE id=$1",[reviewer]);assert.equal((await valid.request()).status,'held');assert.deepEqual(await effectCount(),before)}finally{await db.exec('ROLLBACK')}})
 await db.exec('DROP TRIGGER timing_no_link_insert ON ediel_assignment_permission_links')
 await tcheck(async()=>{const f=await approveFresh({start:'2026-07-01T00:00:00Z',networkStart:'2026-01-01'}),before=await effectCount();await assert.rejects(f.request(),/timing_replay_insert_attempt/);assert.deepEqual(await effectCount(),before);assert.equal((await db.query('SELECT count(*) n FROM gridex_service_permission.request_timing_receipts WHERE assignment_id=$1',[f.assignment])).rows[0].n,0)})
 await tcheck(async()=>{const acl=(await db.query("SELECT has_table_privilege('service_role','gridex_service_permission.request_timing_receipts','SELECT') r,has_table_privilege('service_role','gridex_service_permission.request_timing_receipts','INSERT') w")).rows[0];assert.deepEqual(acl,{r:false,w:false})})
 console.log('Actual timing producer/consumer forward: '+timingChecks+' checks PASS; '+(checks+scopeChecks+evidenceChecks)+' inherited checks PASS; finite retained-source boundary NOT native')
 await db.close();process.exit(0)

 console.log('Actual ESCO archived-source/issuer/separate-review/current-grant mechanism: '+evidenceChecks+' PASS; synthetic trusted catalog/source-storage fixtures, NOT native/external approval proof')
`
const generated=base.replace(marker,()=>extension+marker),temp=fileURLToPath(new URL('./.ediel-service-evidence-nested.tmp.mjs',import.meta.url))
writeFileSync(temp,generated)
try{const run=spawnSync(process.execPath,[temp],{stdio:'inherit',env:process.env});if(run.error)throw run.error;process.exitCode=run.status??1}finally{unlinkSync(temp)}
