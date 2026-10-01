// Actual native incoming apply/replay/source-correlation owner + new physical
// receipt forward. Reduced surrounding schema, accepted canonical fixtures and
// positive permission resolver are declared mechanical models, not native proof.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),ts=require('typescript')
import {fileURLToPath,pathToFileURL} from 'node:url'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite(),root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const read=p=>fs.readFileSync(root+'/supabase/migrations/'+p,'utf8')
const part=(sql,start)=>{const i=sql.indexOf(start);assert.ok(i>=0,start);return sql.slice(i,sql.indexOf('$$;',i)+3)}
// Same bounded pure TS loading pattern as the existing native guide generator.
// The actual canonical parser is the oracle; imports cannot touch runtime IO.
const moduleCache=new Map()
function loadPure(file){
 if(!path.extname(file))file+='.ts'
 if(moduleCache.has(file))return moduleCache.get(file).exports
 if(!file.startsWith(root+path.sep))throw Error('Canonical parser import outside repository')
 const loaded={exports:{}};moduleCache.set(file,loaded)
 const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const localRequire=name=>{if(name.startsWith('@/'))return loadPure(path.join(root,name.slice(2)));if(name.startsWith('.'))return loadPure(path.resolve(path.dirname(file),name));throw Error('Canonical parser import must remain pure: '+name)}
 new Function('require','module','exports',output)(localRequire,loaded,loaded.exports);return loaded.exports
}
const canonical=loadPure(path.join(root,'lib/ediel/prodat/prodatRegisterGroups.ts')),tokenizer=loadPure(path.join(root,'lib/ediel/core/edifactTokenizer.ts'))
let checks=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_ediel_ack_replay;CREATE SCHEMA gridex_ediel_ack_guide;CREATE SCHEMA gridex_prodat_object_batch;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);CREATE TABLE public.companies(id uuid PRIMARY KEY,is_active boolean,status text);
 CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,user_status text);
 CREATE TABLE public.company_memberships(id uuid DEFAULT gen_random_uuid(),company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
 CREATE TABLE public.fixture_permissions(actor uuid,company uuid,key text,allowed boolean,valid_from timestamptz,valid_to timestamptz);
 CREATE FUNCTION public.gridex_actor_has_company_permission(a uuid,c uuid,k text) RETURNS boolean LANGUAGE sql VOLATILE AS $$SELECT EXISTS(SELECT FROM auth.users WHERE id=a AND deleted_at IS NULL AND(banned_until IS NULL OR banned_until<=clock_timestamp())) AND coalesce((SELECT allowed AND (valid_from IS NULL OR valid_from<=clock_timestamp()) AND (valid_to IS NULL OR valid_to>clock_timestamp()) FROM public.fixture_permissions WHERE actor=a AND company=c AND key=k),false)$$;
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text,
 message_standard text DEFAULT 'edifact',message_received_at timestamptz DEFAULT now(),execution_context_snapshot jsonb DEFAULT '{}',message_sent_at timestamptz,immutable_rendered_at timestamptz,immutable_payload_hash text,requires_contrl boolean,requires_aperak boolean,contrl_status text,aperak_status text,utilts_err_status text,failure_reason text,status text,failed_at timestamptz,acknowledged_at timestamptz,ack_due_at timestamptz,updated_by uuid,updated_at timestamptz,related_message_id uuid);
 CREATE TABLE gridex_received_sources.sources(source_message_id uuid PRIMARY KEY,company_id uuid,environment text,raw_payload text,payload_hash text,received_context jsonb,source_received_at timestamptz,origin text,message_code text,captured_at timestamptz);
 CREATE TABLE gridex_received_sources.validation_assessments(id uuid PRIMARY KEY,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,facts_text text,facts_hash text,owner text,previous_assessment_id uuid);
 CREATE SCHEMA gridex_ediel_inbound_context;CREATE FUNCTION gridex_ediel_inbound_context.require_ack_v1(public.ediel_messages,public.ediel_messages) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
 CREATE TABLE public.ediel_ack_chains(company_id uuid,source_message_id uuid,ack_message_id uuid,ack_family text,ack_scope text,transaction_reference text,outcome text);
 CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable';END$$;
 CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;
 CREATE FUNCTION gridex_prodat_object_batch.require_service_v1() RETURNS void LANGUAGE plpgsql AS $$BEGIN IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;END$$;`)
 await db.exec(part(read('20260923135706_ediel_utilts_consumption_binding_v1.sql'),'CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'))
 await db.exec(read('20260930170932_ediel_inbound_ack_source_atomic_authority.sql'))
 await db.exec(read('20260930203615_ediel_ack_first14_and_committed_replay.sql'))
 await db.exec(part(read('20260930231746_ediel_native_prodat_ack_immutable_scope.sql'),'CREATE FUNCTION gridex_ediel_ack_guide.prodat_outcomes_v1'))
 await db.exec(part(read('20260930144205_ediel_permission_source_atomic_transitions.sql'),'CREATE FUNCTION gridex_received_sources.wire_tokens_bounded_v1'))
 await db.exec(part(read('20260930144205_ediel_permission_source_atomic_transitions.sql'),'CREATE FUNCTION gridex_received_sources.closure_wire_tokens_v2'))
 await db.exec(part(read('20260930164804_ediel_prodat_retry_correction_authority.sql'),'CREATE FUNCTION gridex_received_sources.prodat_recovery_wire_v1'))
 const baseline=(await db.query("SELECT pg_get_functiondef('gridex_ack_authority.apply_before_committed_replay_v1(uuid,text,uuid,uuid,uuid)'::regprocedure) d")).rows[0].d
 const oid=(await db.query("SELECT 'gridex_ack_authority.apply_before_committed_replay_v1(uuid,text,uuid,uuid,uuid)'::regprocedure::oid o")).rows[0].o
 await db.exec(read('20261001140000_ediel_inbound_prodat_physical_outcome_owner.sql'))
 assert.equal((await db.query("SELECT 'gridex_ack_authority.apply_before_committed_replay_v1(uuid,text,uuid,uuid,uuid)'::regprocedure::oid o")).rows[0].o,oid);checks++
 const company=id(1),actor=id(2)
 await db.query("INSERT INTO auth.users(id) VALUES($1)",[actor]);await db.query("INSERT INTO public.companies VALUES($1,true,'active')",[company])
 await db.query("INSERT INTO public.user_profiles VALUES($1,'active');",[actor])
 await db.query("INSERT INTO public.company_memberships(company_id,user_id,status,is_active,accepted_at)VALUES($1,$2,'active',true,now())",[company,actor])
 await db.query("INSERT INTO public.fixture_permissions(actor,company,key,allowed) VALUES($1,$2,'communication.write',true),($1,$2,'communication.read',true)",[actor,company])
 function sourceWire(label,objects,code='Z09'){const body=[`UNH+S+PRODAT:D:97A:UN:E2SE6A`,`BGM+${code}+DOC-${label}+9+S01`,`NAD+FR+LOCAL:160:SVK+++++++SE`,`NAD+DO+REMOTE:160:SVK+++++++SE`,...objects.flatMap((o,i)=>[`LIN+${o.sequence??i+1}++${o.point}:::${o.agency??'9'}${o.register!==undefined?'+1:'+o.register:''}`,...(o.li?[`RFF+LI:${o.li}`]:[])])];return `UNB+UNOC:3+LOCAL:14+REMOTE:14+261001:1200+I-${label}++23-DDQ-PRODAT++++1'`+body.join("'")+`'UNT+${body.length+1}+S'UNZ+1+I-${label}'`}
 function ackWire(label,groups){const body=[`UNH+A+APERAK:D:96A:UN:E2SE6A`,`BGM+APERAK+ACK-${label}+34`,`RFF+ACW:DOC-${label}`,`NAD+FR+REMOTE:160:SVK+++++++SE`,`NAD+DO+LOCAL:160:SVK+++++++SE`,...groups.flatMap(o=>[`ERC+${o.positive?'100':'41'}::260`,...(o.positive?[]:[`FTX+AAO+++226`]),`RFF+Z07:${o.point}`,...(o.li?[`RFF+LI:${o.li}`]:[])])];return `UNB+UNOC:3+REMOTE:14+LOCAL:14+261001:1201+A-${label}++23-DDQ-PRODAT++++1'`+body.join("'")+`'UNT+${body.length+1}+A'UNZ+1+A-${label}'`}
 async function seed(n,label,objects,groups,code='Z09'){
  const sid=id(n),aid=id(n+1),sr=sourceWire(label,objects,code),ar=ackWire(label,groups)
  await db.query("INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_sent_at,immutable_rendered_at,immutable_payload_hash,requires_contrl,requires_aperak,contrl_status,aperak_status,utilts_err_status,status)VALUES($1,$2,'test','outbound','PRODAT',$6,$3,now()-interval '1 hour',now()-interval '2 hours',encode(sha256(convert_to($3,'UTF8')),'hex'),false,true,'not_required','pending','not_required','sent'),($4,$2,'test','inbound','APERAK','APERAK',$5,NULL,now(),encode(sha256(convert_to($5,'UTF8')),'hex'),false,false,'not_required','not_required','not_required','received')",[sid,company,sr,aid,ar,code])
  const facts=JSON.stringify({syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted'})
  await db.query("INSERT INTO gridex_received_sources.validation_assessments VALUES($1,$2,$3,'test',encode(sha256(convert_to($4,'UTF8')),'hex'),$5,encode(sha256(convert_to($5,'UTF8')),'hex'),'canonical-runtime-with-registry-v1',NULL)",[id(n+2),aid,company,ar,facts])
  return {sid,aid,sr,ar}
 }
 async function service(fn){await db.exec('SET ROLE service_role');try{return await fn()}finally{await db.exec('RESET ROLE')}}
 const apply=(f,who=actor)=>service(async()=> (await db.query("SELECT public.gridex_apply_inbound_ack_source_v1($1,'test',$2,$3,$4) r",[company,f.aid,f.sid,who])).rows[0].r)
 const receipt=(f,who=actor,c=company)=>service(async()=>(await db.query("SELECT public.ediel_read_inbound_prodat_physical_outcomes_v1($1,'test',$2,$3,$4) r",[c,f.aid,f.sid,who])).rows[0].r)
 const counts=async()=>(await db.query('SELECT(SELECT count(*)::int FROM gridex_ack_authority.source_correlations)c,(SELECT count(*)::int FROM gridex_ack_authority.applied_receipts)a,(SELECT count(*)::int FROM gridex_ack_authority.prodat_physical_receipts)p')).rows[0]
 const published=(await db.query('SELECT gridex_ack_authority.prodat_physical_source_projection_version_v1() v')).rows[0].v
 for(const [file,hash]of Object.entries(published))assert.equal((await import('node:crypto')).createHash('sha256').update(fs.readFileSync(root+'/'+file)).digest('hex'),hash);checks++
 const parityCases=[
  ['Z04',[{point:'REG',li:'FIRST-LI',register:'1'},{point:'REG',register:'2'}]],
  ['Z06',[{point:'REG',li:'FIRST-LI',register:'1'},{point:'REG',register:'2'},{point:'MISSING'}]],
  ['Z10',[{point:'REG',li:'FIRST-LI',register:'1'},{point:'REG',li:'LATER-FORBIDDEN',register:'2'}]],
  ['Z04',[{point:'REG',li:'FIRST-LI',register:'1'},{point:'REG',register:'2',sequence:'4'}]],
  ['Z09',[{point:'REG',li:'FIRST-LI',register:'1'},{point:'REG',register:'2'}]],
  ['Z04',[{point:'REG',li:'FIRST-LI',register:'1'},{point:'REG',register:'2',agency:'89'}]],
  ['Z04',[{point:'REG',li:'FIRST-LI',register:'1'},{point:'REG',register:'3'}]],
  ['Z04',[{point:'REG',li:'FIRST-LI',register:'1'},{point:'REG',register:'BAD'}]],
  ['Z04',[{point:'REG',li:'FIRST-LI',register:'1'},{point:'REG'}]],
  ['Z04',[{point:'A',li:'A',register:'1'},{point:'B',li:'B'},{point:'A',register:'2'}]],
  ['Z04',[{point:'X'.repeat(26),li:'BAD-ID',register:'1'},{point:'X'.repeat(26),register:'2'}]],
 ]
 for(const[code,input]of parityCases){
  const raw=sourceWire('PARITY-'+checks,input,code),t=tokenizer.tokenizeEdifact(raw),groups=canonical.prodatRegisterGroups(t.segments,t.una).groups
  const expected=groups.filter(g=>!g.validRegisterChain||g.registerPosition===1).map(g=>{
   const firstNad=g.segments.findIndex(x=>x.tag==='NAD'),own=g.segments.slice(0,firstNad<0?undefined:firstNad),refs=own.filter(x=>x.tag==='RFF'&&tokenizer.segmentComposite(x,1,t.una)[0]==='LI')
   return {lineIndex:g.segments[0].index,id:g.itemId,identityAgency:g.identityAgency,li:refs.length?tokenizer.segmentComposite(refs[0],1,t.una)[1]:null,validRegisterChain:g.validRegisterChain,registerLineIndices:g.validRegisterChain?groups.filter(x=>x.firstLineIndex===g.lineIndex).map(x=>x.segments[0].index):[g.segments[0].index]}
  })
  assert.deepEqual((await db.query('SELECT gridex_ack_authority.prodat_physical_source_objects_v1($1)r',[raw])).rows[0].r,expected);checks++
 }
 const register=await seed(80,'REGONLY',[{point:'REGONLY',li:'FIRST-LI',register:'1'},{point:'REGONLY',register:'2'}],[{point:'REGONLY',li:'FIRST-LI',positive:true}],'Z04');const completeRegister=await apply(register)
 assert.equal(completeRegister.finalAckReached,true);assert.equal(completeRegister.sourceAccepted,true);assert.equal((await receipt(register)).physicalOutcomes.length,1);checks++
 const registerMixed=await seed(90,'REGMIX',[{point:'REGMIX',li:'REGMIX-LI',register:'1'},{point:'REGMIX',register:'2'},{point:'MISSING-MIX'}],[{point:'REGMIX',li:'REGMIX-LI',positive:true},{point:'MISSING-MIX'}],'Z06');const completedMixed=await apply(registerMixed)
 assert.equal(completedMixed.finalAckReached,true);assert.equal(completedMixed.sourceAccepted,false);assert.equal((await receipt(registerMixed)).physicalOutcomes.length,2);assert.deepEqual((await db.query("SELECT gridex_ack_authority.prodat_correction_objects_v1($1,'test',$2,$3)r",[company,registerMixed.aid,registerMixed.sid])).rows[0].r,[{point:'MISSING-MIX',identityAgency:'9'}]);checks++
 const negativeRegister=await seed(100,'REGNEG',[{point:'REGNEG',register:'1'},{point:'REGNEG',register:'2'},{point:'OWN-OTHER',li:'OWN-OTHER-LI'}],[{point:'REGNEG'}],'Z10');const negativeRegisterResult=await apply(negativeRegister)
 assert.equal(negativeRegisterResult.finalAckReached,false);const negativeRegisterReceipt=await receipt(negativeRegister);assert.equal(negativeRegisterReceipt.physicalOutcomes[0].physicalReference.lineItemReference,null)
 assert.deepEqual((await db.query("SELECT gridex_ack_authority.prodat_correction_objects_v1($1,'test',$2,$3)r",[company,negativeRegister.aid,negativeRegister.sid])).rows[0].r,[{point:'REGNEG',identityAgency:'9'},{point:'REGNEG',identityAgency:'9'}]);checks++
 const reversed=await seed(110,'REVERSED',[{point:'POINT-Z',li:'Z-LI'},{point:'POINT-A',li:'A-LI'}],[{point:'POINT-Z',li:'Z-LI'},{point:'POINT-A',li:'A-LI',positive:true}]);await apply(reversed);assert.deepEqual((await db.query("SELECT gridex_ack_authority.prodat_correction_objects_v1($1,'test',$2,$3)r",[company,reversed.aid,reversed.sid])).rows[0].r,[{point:'POINT-Z',identityAgency:'9',li:'Z-LI'}]);checks++
 const baselineCounts=await counts();const f=await seed(10,'ONE',[{point:'POINT-A'}],[{point:'POINT-A'}]);
 const composed=(await db.query("SELECT pg_get_functiondef('gridex_ack_authority.apply_before_committed_replay_v1(uuid,text,uuid,uuid,uuid)'::regprocedure) d")).rows[0].d
 await db.exec(baseline);await assert.rejects(apply(f),/negative_scope_unavailable/);assert.deepEqual(await counts(),baselineCounts);checks++
 await db.exec(composed);const made=await apply(f)
 assert.equal(made.outcome,'negative');assert.equal(made.scope,'object');assert.equal(made.finalAckReached,true);assert.equal(made.sourceAccepted,false)
 const r=await receipt(f);assert.deepEqual(r.sourceProjectionVersion,published);assert.equal(r.physicalOutcomes[0].physicalReference.lineItemReference,null);assert.equal(r.physicalOutcomes[0].physicalReference.objectId,'POINT-A');assert.match(r.physicalOutcomes[0].reference,/@prodat-physical-source:/);checks++
 const objects=(await db.query("SELECT gridex_ack_authority.prodat_correction_objects_v1($1,'test',$2,$3) r",[company,f.aid,f.sid])).rows[0].r
 assert.deepEqual(objects,[{point:'POINT-A',identityAgency:'9'}]);checks++
 const before=await counts();assert.equal((await apply(f)).idempotent,true);assert.deepEqual(await counts(),before);checks++
 const mixed=await seed(20,'MIX',[{point:'BAD'},{point:'GOOD',li:'REAL-LI'}],[{point:'BAD'},{point:'GOOD',li:'REAL-LI',positive:true}]);await apply(mixed)
 const mr=await receipt(mixed);assert.equal(mr.physicalOutcomes.length,2);assert.deepEqual(mr.physicalOutcomes.map(o=>o.outcome).sort(),['negative','positive']);checks++
 assert.deepEqual((await db.query("SELECT gridex_ack_authority.prodat_correction_objects_v1($1,'test',$2,$3) r",[company,mixed.aid,mixed.sid])).rows[0].r,[{point:'BAD',identityAgency:'9'}]);checks++
 await db.query("UPDATE public.fixture_permissions SET allowed=false WHERE key='communication.write'")
 assert.equal((await apply(f)).idempotent,true);checks++ // existing exact receipt READ-only replay
 await db.query("UPDATE public.fixture_permissions SET allowed=false WHERE key='communication.read'")
 await assert.rejects(receipt(f),/actor_unqualified/);await assert.rejects(apply(f),/actor_unqualified/);checks++
 await db.query('UPDATE public.fixture_permissions SET allowed=true')
 await assert.rejects(receipt(f,id(99)),/actor_unqualified/);await assert.rejects(receipt(f,actor,id(99)),/actor_unqualified/);checks++
 const fresh=await seed(30,'ROLL',[{point:'ROLL'}],[{point:'ROLL'}]);const beforeRollback=await counts()
 await db.exec("CREATE FUNCTION fixture_fail_capture()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'physical_capture_failed';END$$;CREATE TRIGGER fixture_fail_capture BEFORE INSERT ON gridex_ack_authority.prodat_physical_receipts FOR EACH ROW EXECUTE FUNCTION fixture_fail_capture()")
 await assert.rejects(apply(fresh),/physical_capture_failed/);assert.deepEqual(await counts(),beforeRollback)
 assert.equal((await db.query('SELECT aperak_status FROM public.ediel_messages WHERE id=$1',[fresh.sid])).rows[0].aperak_status,'pending');checks++
 await db.exec('DROP TRIGGER fixture_fail_capture ON gridex_ack_authority.prodat_physical_receipts')
 const bad=await seed(40,'BADPOS',[{point:'BADPOS'}],[{point:'BADPOS',positive:true}]);const beforeBad=await counts();await assert.rejects(apply(bad),/missing_li_positive_forbidden/);assert.deepEqual(await counts(),beforeBad);checks++
 await assert.rejects(receipt({aid:id(999),sid:f.sid},id(99)),/actor_unqualified/);checks++
 const foreignPoint=await seed(44,'FOREIGNPOINT',[{point:'OWNPOINT',li:'OWN-LI'}],[{point:'FOREIGNPOINT',li:'OWN-LI'}]);const beforeForeign=await counts();await assert.rejects(apply(foreignPoint),/physical_scope_required/);assert.deepEqual(await counts(),beforeForeign);checks++
 const ambiguous=await seed(46,'AMBIGUOUS',[{point:'SAME'},{point:'SAME'}],[{point:'SAME'}]);await assert.rejects(apply(ambiguous),/physical_scope_required/);assert.deepEqual(await counts(),beforeForeign);checks++
 const denied=await seed(50,'DENY',[{point:'DENY'}],[{point:'DENY'}]);await db.query('UPDATE public.fixture_permissions SET allowed=false');await assert.rejects(apply(denied),/actor_unqualified/);checks++;await db.query('UPDATE public.fixture_permissions SET allowed=true')
 const actorDenied=await seed(55,'ACTORFLAGS',[{point:'ACTORFLAGS'}],[{point:'ACTORFLAGS'}]);const beforeActorFlags=await counts()
 for(const deny of ["UPDATE auth.users SET deleted_at=now()","UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 hour'","UPDATE public.companies SET is_active=false","UPDATE public.companies SET status='pending'"]){
  await db.exec(deny);await assert.rejects(apply(actorDenied),/actor_unqualified/);await assert.rejects(receipt(f),/actor_unqualified/);await assert.rejects(receipt({aid:id(999),sid:f.sid}),/actor_unqualified/);assert.deepEqual(await counts(),beforeActorFlags);checks++
  await db.exec("UPDATE auth.users SET deleted_at=NULL,banned_until=NULL;UPDATE public.companies SET is_active=true,status='active'")
 }
 // The actual outer owner's post-effect guard must see timed policy expiry
 // after an inner receipt INSERT wait; one statement rolls back every effect.
 const timed=await seed(60,'TIMED',[{point:'TIMED'}],[{point:'TIMED'}]);const beforeTimed=await counts()
 await db.exec("CREATE FUNCTION fixture_wait_capture()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM pg_sleep(0.15);RETURN NEW;END$$;CREATE TRIGGER fixture_wait_capture AFTER INSERT ON gridex_ack_authority.prodat_physical_receipts FOR EACH ROW EXECUTE FUNCTION fixture_wait_capture()")
 await db.query("UPDATE public.fixture_permissions SET valid_to=clock_timestamp()+interval '0.10 seconds' WHERE key='communication.write'")
 await assert.rejects(apply(timed),/actor_unqualified/);assert.deepEqual(await counts(),beforeTimed);assert.equal((await db.query('SELECT aperak_status FROM public.ediel_messages WHERE id=$1',[timed.sid])).rows[0].aperak_status,'pending');checks++
 await db.exec('DROP TRIGGER fixture_wait_capture ON gridex_ack_authority.prodat_physical_receipts');await db.query('UPDATE public.fixture_permissions SET valid_to=NULL')
 // Preserve the actual private receipt body; model a wait only around it to
 // exercise the public read port's second current authorization check.
 await db.exec("ALTER FUNCTION gridex_ack_authority.prodat_physical_receipt_v1(uuid,text,uuid,uuid) RENAME TO fixture_physical_receipt;CREATE FUNCTION gridex_ack_authority.prodat_physical_receipt_v1(c uuid,e text,a uuid,s uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE r jsonb;BEGIN r:=gridex_ack_authority.fixture_physical_receipt(c,e,a,s);PERFORM pg_sleep(0.15);RETURN r;END$$")
 await db.query("UPDATE public.fixture_permissions SET valid_to=clock_timestamp()+interval '0.10 seconds'")
 await assert.rejects(receipt(f),/actor_unqualified/);assert.deepEqual(await counts(),beforeTimed);checks++
 await db.query('UPDATE public.fixture_permissions SET valid_to=NULL')
 await db.exec('DROP FUNCTION gridex_ack_authority.prodat_physical_receipt_v1(uuid,text,uuid,uuid);ALTER FUNCTION gridex_ack_authority.fixture_physical_receipt(uuid,text,uuid,uuid) RENAME TO prodat_physical_receipt_v1')
 const partial=await seed(70,'PARTIAL',[{point:'PARTIALBAD'},{point:'UNANSWERED',li:'WAIT-LI'}],[{point:'PARTIALBAD'}]);const partResult=await apply(partial)
 assert.equal(partResult.finalAckReached,false);assert.equal(partResult.sourceAccepted,false);assert.deepEqual((await db.query("SELECT gridex_ack_authority.prodat_correction_objects_v1($1,'test',$2,$3)r",[company,partial.aid,partial.sid])).rows[0].r,[{point:'PARTIALBAD',identityAgency:'9'}]);checks++
 await assert.rejects(db.query("UPDATE gridex_ack_authority.prodat_physical_receipts SET scopes='[]'"),/immutable/);checks++
 await assert.rejects(db.exec('TRUNCATE gridex_ack_authority.prodat_physical_receipts'),/immutable/);checks++
 await assert.rejects(db.query("SELECT gridex_ack_authority.prodat_correction_objects_v1($1,'production',$2,$3)",[company,f.aid,f.sid]),/receipt_changed/);checks++
 assert.equal((await db.query("SELECT gridex_ack_authority.prodat_correction_objects_v1($1,'test',$2,$3)r",[company,id(500),f.sid])).rows[0].r,null);checks++
 for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("SELECT has_function_privilege($1,'gridex_ack_authority.prodat_correction_objects_v1(uuid,text,uuid,uuid)','EXECUTE') allowed",[role])).rows[0].allowed,false);checks++
 assert.equal((await db.query("SELECT has_function_privilege('authenticated','public.ediel_read_inbound_prodat_physical_outcomes_v1(uuid,text,uuid,uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,false);checks++
 console.log(JSON.stringify({status:'PASS',checks,evidence:'reduced-mechanical-only',actual:'incoming native apply/replay/correlation plus physical-owner forward',nativeAcceptance:'NOT_RUN'}))
}catch(error){console.error(JSON.stringify({status:'FAIL',message:error.message,code:error.code,where:error.where}));process.exitCode=1}finally{await db.close()}
