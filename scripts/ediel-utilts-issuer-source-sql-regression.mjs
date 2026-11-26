// Actual additive SQL on PGlite; component-only modeled actor/source ports.
// No native PG17/Supabase/CSPRNG/producer or real-market authority qualification.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createHash,createHmac,randomBytes} from 'node:crypto'
import assert from 'node:assert/strict'
const here=path.dirname(fileURLToPath(import.meta.url)),candidate=path.resolve(here,'..')
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const hash=x=>createHash('sha256').update(x).digest('hex')
export async function runIssuerSourceSqlRegression({sourceRoot,pgliteModule}={}){
 const root=sourceRoot||process.env.EDIEL_ISSUER_SOURCE_ROOT
 const modulePath=pgliteModule||process.env.EDIEL_PGLITE_MODULE
 if(!root||!modulePath)throw Error('Explicit source root and PGlite module required')
 const {PGlite}=await import(pathToFileURL(modulePath).href),db=new PGlite()
 const results=[],check=(name,action)=>action().then(()=>results.push(name))
 const migration=f=>fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8')
 const company=uid(1),submit=uid(2),application=uid(3),reviewer=uid(4),foreign=uid(5),mailbox=uid(6),secondApp=uid(7)
 let command=100
 const original=(role,text)=>({role,reference:'TEST:'+role,version:'1',uri:'test:'+role,mimeType:role==='payload'?'application/edifact':'text/plain',bytesBase64:Buffer.from(text).toString('base64'),sha256:hash(text)})
 const body={legalIdentity:['88991','160','SVK'],transportSender:['T3-TEST'],validUntil:new Date(Date.now()+86400000).toISOString(),measurementUsageFrom:'2020-01-01T00:00:00Z',measurementUsageUntil:'2030-01-01T00:00:00Z',mailboxId:mailbox,applications:[{applicationReference:'owned-app',actorUserId:application,repository:'test:source',commit:'a'.repeat(40),tree:'b'.repeat(40),entryPath:'issue.ts',entrySha256:'c'.repeat(64),producerReference:'test:finite-port'},{applicationReference:'second-app',actorUserId:secondApp,repository:'test:second-source',commit:'d'.repeat(40),tree:'e'.repeat(40),entryPath:'second-issue.ts',entrySha256:'f'.repeat(64),producerReference:'test:finite-second-port'}]}
 async function rpc(name,actor,args){await db.exec('SET ROLE service_role');try{return (await db.query(`SELECT public.${name}($1,$2,${args.map((_,i)=>'$'+(i+3)).join(',')}) value`,[company,actor,...args])).rows[0].value}finally{try{await db.exec('RESET ROLE')}catch{/* Failed fixture transaction is rolled back by its owner. */}}}
 const archive=(kind,body,originals=[],actor=submit)=>rpc('archive_utilts_issuer_source_v1',actor,[{version:1,commandId:uid(command++),environment:'test',kind,body,originals}])
 const review=(receipt,actor=reviewer)=>rpc('review_utilts_issuer_source_v1',actor,[receipt.artifactId,{version:1,commandId:uid(command++),decision:'approve',reason:'Explicit controlled synthetic TEST review only',artifactSha256:receipt.artifactSha256,scopeSha256:receipt.scopeSha256}])
 const birthOriginals=['test_policy','test_mandate','test_retention_decision','test_application_inventory'].map(role=>role==='test_application_inventory'?{...original(role,JSON.stringify(body.applications)),mimeType:'application/json'}:original(role,'CONTROLLED SYNTHETIC TEST '+role))
 let born,issued,checkpoint,source
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
   CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_ack_authority;CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_ediel_services;
   CREATE TABLE public.companies(id uuid PRIMARY KEY,status text);CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,user_status text);
   CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
   CREATE TABLE public.permissions(id uuid DEFAULT gen_random_uuid(),key text UNIQUE,name text,description text,category text,is_active boolean DEFAULT true);
   CREATE TABLE public.user_permissions(user_id uuid,company_id uuid,permission_id uuid,permission_key text,is_active boolean,status text,effect text);
   CREATE TABLE public.user_roles(user_id uuid,company_id uuid,role_id uuid,is_active boolean,status text);
   CREATE TABLE public.roles(id uuid,is_active boolean);CREATE TABLE public.role_permissions(role_id uuid,permission_id uuid,permission_key text,effect text);
   CREATE FUNCTION public.gridex_actor_has_company_permission(a uuid,c uuid,k text) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT FROM public.user_permissions WHERE user_id=a AND company_id=c AND permission_key=k AND effect='allow' AND is_active AND status='active') AND NOT EXISTS(SELECT FROM public.user_permissions WHERE user_id=a AND company_id=c AND permission_key=k AND effect='deny' AND is_active)$$;
   CREATE TABLE public.ediel_mailboxes(id uuid PRIMARY KEY,company_id uuid,environment text,email_address text,is_active boolean);
   CREATE TABLE public.inbound_email_messages(id uuid PRIMARY KEY,company_id uuid,environment text,mailbox_id uuid,internet_message_id text,raw_message_sha256 text,raw_email text,raw_edifact_payload text);
   CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,message_family text,raw_payload text,inbound_email_message_id uuid);
   CREATE TABLE public.tenant_actor_identifiers(identifier_value text);CREATE TABLE public.platform_actor_identifiers(identifier_value text);
   CREATE TABLE gridex_received_sources.sources(source_message_id uuid PRIMARY KEY,company_id uuid,environment text,origin text,received_context jsonb,raw_payload text,payload_hash text,captured_at timestamptz);
   CREATE TABLE gridex_received_sources.validation_assessments(id uuid PRIMARY KEY,company_id uuid,source_message_id uuid,facts_text text);
   CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable_source_facet';END$$;
   CREATE FUNCTION gridex_received_sources.require_utilts_transaction_v1(uuid,uuid,text,text,text,jsonb) RETURNS void LANGUAGE sql AS $$SELECT$$;
   CREATE FUNCTION gridex_received_sources.require_utilts_header_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
   CREATE FUNCTION gridex_received_sources.capture_fixture() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN INSERT INTO gridex_received_sources.sources VALUES(NEW.id,NEW.company_id,NEW.environment,'database_insert','{"contextOrigin":"database_insert"}',NEW.raw_payload,encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex'),clock_timestamp());RETURN NEW;END$$;
   CREATE TRIGGER gridex_capture_received_utilts_source AFTER INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.capture_fixture();`)
  const binding=migration('20260923135706_ediel_utilts_consumption_binding_v1.sql')
  await db.exec(binding.slice(binding.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),binding.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
  const ack=migration('20260930170932_ediel_inbound_ack_source_atomic_authority.sql')
  await db.exec(ack.slice(ack.indexOf('CREATE FUNCTION gridex_ack_authority.wire_v1'),ack.indexOf('CREATE FUNCTION gridex_ack_authority.source_match_v1')))
  const service=migration('20261001000926_ediel_service_evidence_archive_review.sql')
  await db.exec(service.slice(service.indexOf('CREATE FUNCTION gridex_ediel_services.receipt_hmac_sha256_v1'),service.indexOf('CREATE FUNCTION gridex_ediel_services.scoped_review_permission_v1')))
  await db.exec(migration('20261001015127_ediel_utilts_foreign_issuer_observed_identity_authority.sql'))
  await db.exec(fs.readFileSync(path.join(candidate,'supabase/migrations/20261101182158_ediel_utilts_issuer_source_intake.sql'),'utf8'))
  await db.query("INSERT INTO public.companies VALUES($1,'active')",[company])
  for(const id of [submit,application,reviewer,foreign,secondApp]){await db.query("INSERT INTO public.user_profiles VALUES($1,'active')",[id]);await db.query("INSERT INTO public.company_memberships VALUES($1,$2,'active',true,clock_timestamp())",[company,id])}
  for(const [actor,key] of [[submit,'submit'],[application,'submit'],[secondApp,'submit'],[reviewer,'review']])await db.query("INSERT INTO public.user_permissions VALUES($1,$2,NULL,$3,true,'active','allow')",[actor,company,'ediel.utilts_issuer_source.'+key])
  await db.query("INSERT INTO public.ediel_mailboxes VALUES($1,$2,'test','owned@test.invalid',true)",[mailbox,company])
  const birth=await archive('test_birth',body,birthOriginals)
  await check('archive custody has no authority rows',async()=>{assert.equal(birth.status,'archived');assert.equal((await db.query('SELECT count(*)::int n FROM gridex_utilts_issuer.issuer_versions')).rows[0].n,0)})
  await check('missing native pgcrypto holds birth without fake entropy',async()=>{const held=await review(birth);assert.equal(held.status,'held');assert.ok(held.reasonCodes.includes('crypto_unavailable'))})
  // EXPLICIT MODELED ENTROPY PORT ONLY: Node CSPRNG bytes, not extension/native crypto evidence.
  await db.exec('CREATE TABLE public.fixture_entropy(bytes bytea)')
  for(let i=0;i<20;i++)await db.query('INSERT INTO public.fixture_entropy VALUES($1)',[randomBytes(32)])
  await db.exec(`CREATE OR REPLACE FUNCTION gridex_utilts_issuer_intake.entropy_v1() RETURNS bytea LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE value bytea;BEGIN DELETE FROM public.fixture_entropy WHERE ctid=(SELECT ctid FROM public.fixture_entropy LIMIT 1) RETURNING bytes INTO value;IF value IS NULL THEN RAISE EXCEPTION 'finite entropy port exhausted';END IF;RETURN value;END$$;`)
  await check('self/foreign/no explicit issuer permission rejected',async()=>{await assert.rejects(review(birth,submit),/actor_forbidden|separate_reviewer/);await assert.rejects(review(birth,foreign),/actor_forbidden/)})
  await check('exact archive retry stable and conflicting command rejected',async()=>{
   const input={version:1,commandId:uid(command++),environment:'test',kind:'test_birth',body,originals:birthOriginals}
   const first=await rpc('archive_utilts_issuer_source_v1',submit,[input]);assert.deepEqual(await rpc('archive_utilts_issuer_source_v1',submit,[input]),first)
   await assert.rejects(rpc('archive_utilts_issuer_source_v1',submit,[{...input,body:{...body,validUntil:new Date(Date.now()+90000000).toISOString()}}]),/command_conflict/)
  })
  await check('tampered originals and noncanonical scalar metadata rejected',async()=>{
   await assert.rejects(archive('test_birth',body,[{...birthOriginals[0],sha256:'0'.repeat(64)},...birthOriginals.slice(1)]),/original_hash_invalid/)
   await assert.rejects(archive('test_birth',body,[{...birthOriginals[0],reference:true},...birthOriginals.slice(1)]),/string_required/)
  })
  await check('wrong review hash fails before birth',async()=>{await assert.rejects(rpc('review_utilts_issuer_source_v1',reviewer,[birth.artifactId,{version:1,commandId:uid(command++),decision:'approve',reason:'TEST',artifactSha256:'0'.repeat(64),scopeSha256:birth.scopeSha256}]),/review_scope_invalid/)})
  await check('explicit current deny overrides scoped grant',async()=>{
   await db.query("INSERT INTO public.user_permissions VALUES($1,$2,NULL,'ediel.utilts_issuer_source.review',true,'active','deny')",[reviewer,company])
   try{await assert.rejects(review(birth),/actor_forbidden/)}finally{await db.query("DELETE FROM public.user_permissions WHERE user_id=$1 AND effect='deny'",[reviewer])}
  })
  await check('independent birth rejects inventory original detached from declared applications',async()=>{
   const wrong=await archive('test_birth',{...body,legalIdentity:['88993','160','SVK']},birthOriginals.map(x=>x.role==='test_application_inventory'?{...original(x.role,'[]'),mimeType:'application/json'}:x))
   await assert.rejects(review(wrong),/inventory_original_mismatch/)
  })
  born=await review(birth)
  await check('ordinary test birth creates fresh authority and independent private keys',async()=>{assert.equal(born.status,'approved');assert.equal(born.assurance,'controlled_test_only');assert.equal(born.productionAuthorityGranted,false);assert.equal((await db.query('SELECT count(*)::int n FROM gridex_utilts_issuer_intake.keys')).rows[0].n,4);assert.equal((await db.query('SELECT count(DISTINCT encode(secret,\'hex\'))::int n FROM gridex_utilts_issuer_intake.keys')).rows[0].n,4)})
  await check('ordinary birth response supplies app IDs and frozen inventory without SQL discovery',async()=>{assert.equal(born.applicationBindings.length,2);assert.equal(born.applicationBindings[0].actorUserId,application);assert.match(born.applicationInventorySha256,/^[a-f0-9]{64}$/);assert.match(born.reviewId,/^[a-f0-9-]{36}$/)})
  await check('birth timestamps are real server clocks and terminal approval cannot be overwritten',async()=>{
   const stamp=(await db.query('SELECT approved_at,valid_from FROM gridex_utilts_issuer.issuer_versions WHERE id=$1',[born.issuerVersionId])).rows[0]
   assert.ok(Date.now()-new Date(stamp.approved_at).getTime()<30000);assert.equal(new Date(stamp.approved_at).getTime(),new Date(stamp.valid_from).getTime())
   await assert.rejects(review(birth),/terminal_review/)
  })
  await check('same physical identity cannot be reset into new empty epoch',async()=>{const duplicate=await archive('test_birth',body,birthOriginals);await assert.rejects(review(duplicate),/identity_already_existed/)})
  await check('production approval remains HOLD',async()=>{const prod=await rpc('archive_utilts_issuer_source_v1',submit,[{version:1,commandId:uid(command++),environment:'production',kind:'prospective',body,originals:['registry','legal_decision','transport_mandate'].map(role=>original(role,'TEST custody only'))}]);assert.equal((await review(prod)).status,'held')})
  const payload="UNA:+.? 'UNB+UNOC:3+T3-TEST+RECEIVER+261101:1830+I++23-MDDQ-UTILTS++++1'UNH+M+UTILTS:D:02B:UN:E5SE5A'BGM+E66::260+OWN-DOC+9+AB'NAD+MS+88991:160:SVK'NAD+MR+54321:160:SVK'IDE+24+OWN-TX'UNT+6+M'UNZ+1+I'"
  await check('old physical issuer with NULL admission cannot receive a new TEST birth',async()=>{
   const old=uid(800),raw=payload.replace('88991:160:SVK','88992:160:SVK')
   await db.query("INSERT INTO public.ediel_messages VALUES($1,$2,'test','inbound','edifact','UTILTS',$3,NULL)",[old,company,raw])
   assert.equal((await db.query('SELECT namespace_id FROM gridex_utilts_issuer.source_admissions WHERE source_message_id=$1',[old])).rows[0].namespace_id,null)
   const rekey=await archive('test_birth',{...body,legalIdentity:['88992','160','SVK']},birthOriginals)
   await assert.rejects(review(rekey),/identity_already_existed/)
   assert.equal((await db.query('SELECT namespace_id FROM gridex_utilts_issuer.source_admissions WHERE source_message_id=$1',[old])).rows[0].namespace_id,null)
  })
  await check('ordinary metadata exposes actual TEST usage bounds and retention binding only',async()=>{
   const meta=await rpc('read_utilts_issuer_source_v1',submit,[birth.artifactId,false])
   assert.ok(Date.now()-new Date(meta.testEpochBornAt).getTime()<30000);assert.deepEqual(meta.legalIdentity,body.legalIdentity);assert.deepEqual(meta.transportSender,body.transportSender)
   assert.equal(new Date(meta.measurementUsageFrom).getTime(),new Date(body.measurementUsageFrom).getTime());assert.equal(meta.retentionArtifactId,birth.artifactId);assert.ok(meta.originals.every(x=>!Object.hasOwn(x,'bytesBase64')))
  })
  const issueBody={epochId:born.epochId,applicationId:born.applicationBindings.find(x=>x.actorUserId===application).applicationId,mailboxId:mailbox,fromAddress:'issuer@test.invalid',toAddress:'owned@test.invalid',payloadOriginalRole:'payload'}
  issued=await archive('test_issue',issueBody,[original('payload',payload)],application)
  await check('issue mints actual MIME and exact RFC issuance identity before reception',async()=>{assert.equal(issued.status,'issued');assert.ok(issued.issuanceId);const mime=issued.originals.find(x=>x.role==='issued_mime');assert.equal(hash(Buffer.from(mime.bytesBase64,'base64')),issued.mimeSha256);assert.ok(Buffer.from(mime.bytesBase64,'base64').toString().includes('Message-ID: '+issued.internetMessageId));assert.equal(issued.marketActivationGranted,false)})
  await check('unknown app, wrong physical issuer, foreign mailbox and late observation period rejected',async()=>{
   await assert.rejects(archive('test_issue',{...issueBody,applicationId:uid(990)},[original('payload',payload)],application),/application_required/)
   await assert.rejects(archive('test_issue',issueBody,[original('payload',payload.replace('88991:160:SVK','70007:160:SVK'))],application),/physical_issuer_invalid/)
   await assert.rejects(archive('test_issue',issueBody,[original('payload',payload.replace('UTILTS++++1','UTILTS++++0'))],application),/physical_issuer_invalid/)
   await assert.rejects(archive('test_issue',{...issueBody,mailboxId:uid(991)},[original('payload',payload)],application),/mailbox_scope_invalid/)
   const outside=payload.replace("'UNT+6+M'","'DTM+163:19990101:102'UNT+7+M'")
   await assert.rejects(archive('test_issue',issueBody,[original('payload',outside)],application),/usage_out_of_scope/)
  })
  await check('replay retains exact current issuance and original MIME',async()=>{
   const replay=await archive('test_replay',{epochId:born.epochId,applicationId:issueBody.applicationId,issuanceId:issued.issuanceId},[],application)
   assert.equal(replay.issuanceId,issued.issuanceId);assert.equal(replay.internetMessageId,issued.internetMessageId);assert.equal(replay.mimeSha256,issued.mimeSha256)
  })
  const second=await archive('test_issue',{...issueBody,applicationId:born.applicationBindings.find(x=>x.actorUserId===secondApp).applicationId},[original('payload',payload)],secondApp)
  await check('equal payload hashes across ALL registered applications retain DISTINCT issuance identities',async()=>{assert.notEqual(second.issuanceId,issued.issuanceId);assert.notEqual(second.internetMessageId,issued.internetMessageId)})
  source=uid(700);const email=uid(701),mime=issued.originals.find(x=>x.role==='issued_mime')
  await db.query("INSERT INTO public.inbound_email_messages VALUES($1,$2,'test',$3,$4,$5,$6,$7)",[email,company,mailbox,issued.internetMessageId,issued.mimeSha256,Buffer.from(mime.bytesBase64,'base64').toString(),payload])
  await db.query("INSERT INTO public.ediel_messages VALUES($1,$2,'test','inbound','edifact','UTILTS',$3,$4)",[source,company,payload,email])
  const head=(await db.query('SELECT sequence,head_sha256 FROM gridex_utilts_issuer_intake.journal WHERE epoch_id=$1 ORDER BY sequence DESC LIMIT 1',[born.epochId])).rows[0]
  const cp=await archive('test_checkpoint',{epochId:born.epochId,expectedSequence:String(head.sequence),expectedHeadSha256:head.head_sha256,applicationInventorySha256:born.applicationInventorySha256},[original('checkpoint_approval','CONTROLLED TEST independent checkpoint')])
  checkpoint=await review(cp)
  await check('checkpoint independently seals full journal head',async()=>{assert.equal(checkpoint.status,'approved');assert.ok(checkpoint.journalHeadSha256)})
  await check('actual SQL HMAC primitive matches standard HMAC and checkpoint uses reviewer-only key',async()=>{
   const seal=(await db.query('SELECT c.seal_bytes,c.mac_hex,k.secret,k.purpose,k.actor_id FROM gridex_utilts_issuer_intake.checkpoints c JOIN gridex_utilts_issuer_intake.keys k ON k.id=c.key_id WHERE c.artifact_id=$1',[cp.artifactId])).rows[0]
   assert.equal(createHmac('sha256',Buffer.from(seal.secret)).update(Buffer.from(seal.seal_bytes)).digest('hex'),seal.mac_hex);assert.equal(seal.purpose,'reviewer');assert.equal(seal.actor_id,reviewer)
  })
  await check('history wrong source tuple and changed physical MIME reject before grounding',async()=>{
   const missing=await archive('history',{epochId:born.epochId,sourceMessageId:uid(999),currentIssuanceId:issued.issuanceId,checkpointArtifactId:cp.artifactId})
   await assert.rejects(review(missing),/source_scope_invalid/)
   await db.exec('BEGIN');try{
    await db.query("UPDATE public.inbound_email_messages SET raw_message_sha256=repeat('0',64) WHERE id=$1",[email])
    const changed=await archive('history',{epochId:born.epochId,sourceMessageId:source,currentIssuanceId:issued.issuanceId,checkpointArtifactId:cp.artifactId})
    await assert.rejects(review(changed),/unmanaged_source/)
   }finally{await db.exec('ROLLBACK')}
  })
  const hist=await archive('history',{epochId:born.epochId,sourceMessageId:source,currentIssuanceId:issued.issuanceId,checkpointArtifactId:cp.artifactId})
  const ground=await review(hist)
  await check('stage2 grounds actual tuple and excludes only current issuance, not equal hashes',async()=>{assert.equal(ground.status,'approved');const row=(await db.query('SELECT * FROM gridex_utilts_issuer.source_absence_grounds WHERE source_message_id=$1',[source])).rows[0];assert.equal(row.normalized_issued_identifiers.length,2);assert.ok(row.normalized_issued_identifiers.every(x=>x.originalIssuanceReference===second.issuanceId));assert.equal((await db.query('SELECT gridex_utilts_issuer.read_v1($1,$2) value',[company,source])).rows[0].value.messageReferenceCollision,true)})
  await check('actual E66 324:719 range plus 597:203 respects TEST usage dates and 735 offset',async()=>{
   const period=payload.replace("'UNT+6+M'","'DTM+735:?+0200:406'DTM+324:202607010000202608010000:719'DTM+597:202608010000:203'UNT+9+M'").replace('OWN-DOC','PERIOD-DOC').replace('OWN-TX','PERIOD-TX')
   assert.equal((await archive('test_issue',issueBody,[original('payload',period)],application)).status,'issued')
   for(const raw of [period.replace('202607010000202608010000','202608010000202607010000'),period.replace('202607010000202608010000','202602300000202608010000'),period.replace('?+0200:406','?+1460:406'),period.replace('202607010000202608010000','199901010000202608010000'),period.replace('202608010000:203','199901010000:203')])await assert.rejects(archive('test_issue',issueBody,[original('payload',raw)],application),/usage_period_invalid|date field value out of range|usage_offset_invalid|usage_out_of_scope/)
  })
  await check('303 offsets resolve actual UTC instant and invalid calendar/offset fails closed',async()=>{
   const offset=payload.replace("'UNT+6+M'","'DTM+597:202607010000?+0200:303'UNT+7+M'").replace('OWN-DOC','OFFSET-DOC').replace('OWN-TX','OFFSET-TX')
   assert.equal((await archive('test_issue',issueBody,[original('payload',offset)],application)).status,'issued')
   const instant=(await db.query("SELECT gridex_utilts_issuer_intake.instant_v1('202607010000+0200','303') value")).rows[0].value
   assert.equal(new Date(instant).toISOString(),'2026-06-30T22:00:00.000Z')
   for(const raw of [offset.replace('?+0200','?+1500'),offset.replace('202607010000','202602300000'),offset.replace('202607010000','202607012400')])await assert.rejects(archive('test_issue',issueBody,[original('payload',raw)],application),/usage_offset_invalid|date field value out of range|usage_calendar_invalid/)
  })
  await check('new correction preserves old issuance and deletion is an immutable tombstone only',async()=>{
   const corrected=await archive('test_correction',{...issueBody,priorIssuanceId:issued.issuanceId},[original('payload',payload.replace('OWN-DOC','CORRECTED-DOC').replace('OWN-TX','CORRECTED-TX'))],application)
   assert.notEqual(corrected.issuanceId,issued.issuanceId)
   const deletion=await archive('test_delete',{epochId:born.epochId,applicationId:issueBody.applicationId,issuanceId:issued.issuanceId,reason:'TEST retain tombstone, no physical erase',retentionArtifactId:birth.artifactId},[],application)
   assert.equal((await review(deletion)).status,'approved');assert.equal((await db.query('SELECT count(*)::int n FROM gridex_utilts_issuer_intake.issuances WHERE id=$1',[issued.issuanceId])).rows[0].n,1)
   const retention=await archive('test_retention',{epochId:born.epochId,retentionArtifactId:birth.artifactId,reason:'TEST retention event'},[original('test_retention_decision','CONTROLLED TEST retain originals')])
   assert.equal((await review(retention)).status,'approved')
  })
  await check('actual journal MAC corruption fails protected metadata read',async()=>{
   await db.exec('BEGIN');try{await db.exec("ALTER TABLE gridex_utilts_issuer_intake.journal DISABLE TRIGGER USER;UPDATE gridex_utilts_issuer_intake.journal SET mac_hex=repeat('0',64)");await assert.rejects(rpc('read_utilts_issuer_source_v1',submit,[hist.artifactId,false]),/journal_mac_invalid/)}finally{await db.exec('ROLLBACK')}
  })
  await check('retained issuance original corruption fails protected read rather than fabricating availability',async()=>{
   await db.exec('BEGIN');try{await db.exec("ALTER TABLE gridex_utilts_issuer_intake.issuances DISABLE TRIGGER USER");await db.query("UPDATE gridex_utilts_issuer_intake.issuances SET mime_bytes=convert_to('missing TEST original','UTF8') WHERE id=$1",[issued.issuanceId]);await assert.rejects(rpc('read_utilts_issuer_source_v1',submit,[hist.artifactId,false]),/issuance_original_unavailable/)}finally{await db.exec('ROLLBACK')}
  })
  await check('private secrets and direct tables inaccessible to service role',async()=>{await db.exec('SET ROLE service_role');try{await assert.rejects(db.exec('SELECT secret FROM gridex_utilts_issuer_intake.keys'),/permission denied/)}finally{await db.exec('RESET ROLE')}assert.ok(!JSON.stringify(ground).includes('secret'))})
  await check('journal mutation rejected',async()=>{await assert.rejects(db.exec('UPDATE gridex_utilts_issuer_intake.journal SET event=event'),/immutable/)})
  await check('protected read verifies MAC and derives metadata only',async()=>{const out=await rpc('read_utilts_issuer_source_v1',submit,[hist.artifactId,false]);assert.equal(out.status,'approved');assert.ok(out.originals.every(x=>!Object.hasOwn(x,'bytesBase64')))})
  await check('unmanaged same-issuer physical source makes checkpoint HOLD even if null admission',async()=>{
   await db.exec('BEGIN');try{
    await db.query("INSERT INTO public.ediel_messages VALUES($1,$2,'test','inbound','edifact','UTILTS',$3,NULL)",[uid(950),company,payload.replace('OWN-DOC','UNMANAGED').replace('T3-TEST+RECEIVER','OTHER-SENDER+RECEIVER')])
    assert.equal((await db.query('SELECT namespace_id FROM gridex_utilts_issuer.source_admissions WHERE source_message_id=$1',[uid(950)])).rows[0].namespace_id,null)
    const latest=(await db.query('SELECT sequence,head_sha256 FROM gridex_utilts_issuer_intake.journal WHERE epoch_id=$1 ORDER BY sequence DESC LIMIT 1',[born.epochId])).rows[0]
    const unsafe=await archive('test_checkpoint',{epochId:born.epochId,expectedSequence:String(latest.sequence),expectedHeadSha256:latest.head_sha256,applicationInventorySha256:born.applicationInventorySha256},[original('checkpoint_approval','TEST must reject unmanaged')])
    await assert.rejects(review(unsafe),/unmanaged_source/)
   }finally{await db.exec('ROLLBACK')}
  })
  await check('anon and authenticated cannot invoke protected issuer RPCs',async()=>{
   for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);try{await assert.rejects(db.query('SELECT public.read_utilts_issuer_source_v1($1,$2,$3,false)',[company,submit,birth.artifactId]),/permission denied/)}finally{await db.exec('RESET ROLE')}}
  })
  await check('an existing issuer revocation blocks managed issuance without a mirrored intake event',async()=>{
   // Finite external-authority port, not an ordinary underlay producer seed.
   await db.exec('BEGIN')
   try{
    const decision='CONTROLLED SYNTHETIC TEST external issuer revocation'
    await db.query(`INSERT INTO gridex_utilts_issuer.revocations VALUES(gen_random_uuid(),$1,$2,NULL,clock_timestamp(),'test:external-revocation','1',convert_to($3,'UTF8'),encode(sha256(convert_to($3,'UTF8')),'hex'),clock_timestamp(),$4)`,[born.namespaceId,born.issuerVersionId,decision,reviewer])
    await assert.rejects(archive('test_issue',issueBody,[original('payload',payload)],application),/epoch_unavailable/)
   }finally{await db.exec('ROLLBACK')}
  })
  await check('ordinary revocation is append-only and blocks future issue while retaining history',async()=>{
   const decision=original('ignored','CONTROLLED TEST revoke epoch'),{role,...decisionOriginal}=decision
   const revoked=await rpc('revoke_utilts_issuer_source_v1',reviewer,[{version:1,commandId:uid(command++),environment:'test',artifactId:birth.artifactId,targetKind:'epoch',targetId:born.epochId,decisionOriginal,reason:'TEST terminate closed epoch'}])
   assert.equal(revoked.status,'revoked');assert.ok(revoked.reviewId);await assert.rejects(archive('test_issue',issueBody,[original('payload',payload)],application),/epoch_unavailable/)
   assert.equal((await db.query('SELECT gridex_utilts_issuer.read_v1($1,$2) value',[company,source])).rows[0].value.holdReason,'ediel_utilts_foreign_issuer_basis_revoked')
   assert.equal((await db.query('SELECT count(*)::int n FROM gridex_utilts_issuer.source_absence_grounds WHERE source_message_id=$1',[source])).rows[0].n,1)
  })
  return {engine:'PGlite component',nativePg17:false,nativeCrypto:false,entropyPort:'explicit modeled Node CSPRNG -> private finite SQL port',checks:results,fixtures:{birth:born,issue:issued,checkpoint,history:ground}}
 }finally{await db.close()}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await runIssuerSourceSqlRegression(),null,2))}catch(error){console.error(error.message);if(error.where)console.error(error.where);process.exitCode=1}
}
