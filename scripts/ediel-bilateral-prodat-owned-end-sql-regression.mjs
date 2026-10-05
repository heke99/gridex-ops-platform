// Finite PostgreSQL mechanics, not authentic issuer, native replay or normative
// acceptance. Execute the complete prior H owner fixture, then the ACTUAL latest
// national supply body and this forward. Existing national functions stay intact.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const priorUrl=new URL('./ediel-bilateral-prodat-own-supply-sql-regression.mjs',import.meta.url)
const prior=readFileSync(priorUrl,'utf8')
const continuation=String.raw`
 await db.exec('UPDATE profile_mechanical_fixture SET current=true');
 // Match the native Supabase database's UTC JSON snapshot serialization. Wire
 // minute decoding remains the actual explicit Swedish standard-time owner.
 await db.exec("SET TIME ZONE 'UTC'");
 await db.exec("ALTER TABLE company_memberships ADD COLUMN id uuid DEFAULT gen_random_uuid();CREATE SCHEMA gridex_regulated_supply;CREATE FUNCTION gridex_regulated_supply.lock_graph_v1() RETURNS void LANGUAGE plpgsql AS $$BEGIN PERFORM gridex_received_sources.lock_prodat_execution_actor_graph_v1();END$$;CREATE FUNCTION gridex_regulated_supply.ground_current_v1(uuid,uuid,uuid,timestamptz) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;")
 // Exact private predecessor, including latest regulated/native full-scope
 // guards. Its other branches remain present and unmodified in the derived body.
 const latestFn=(name)=>{const s=readFileSync(new URL('../supabase/migrations/20261001004331_ediel_regulated_supply_ground_archive_review.sql',import.meta.url),'utf8'),a=s.indexOf('CREATE OR REPLACE FUNCTION '+name),b=s.indexOf('$$;',a);assert.ok(a>=0&&b>a,name);return s.slice(a,b+3);};
 await db.exec(latestFn('gridex_received_sources.apply_supply_before_legal_context_v1'));
 await db.exec(latestFn('gridex_received_sources.supply_period_source_basis_v1'));
 await db.exec("CREATE OR REPLACE FUNCTION gridex_bilateral_prodat.recorded_profile_authority_v1(p uuid,c uuid) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT FROM public.profile_mechanical_fixture WHERE profile_id=p AND company_id=c AND current)$$;");
 const endObjects=[{...own[0],li:'LI-END-A',end:'209902011330'},...(process.env.EDIEL_MIXED_NATIONAL_SOURCE==='1'?[{...own[2],li:'LI-END-L',end:'209902011330'}]:[])];
 let endWire=raw('Z05',endObjects);for(const o of endObjects)endWire=endWire.replace('DTM+92:'+o.start,'DTM+93:'+o.end);const endId=id(350);
 await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,status,message_received_at) VALUES($1,$2,'test','inbound','edifact','PRODAT','Z05',$3,'received',now())",[endId,id(1),endWire]);
 await db.query('INSERT INTO legal_context_fixture VALUES($1,$2)',[endId,{companyId:id(1),family:'PRODAT',code:'Z05',actorRole:'electricity_supplier',legalActorId:id(50),legalEdielId:'12345'}]);
 const endFacts={...facts,applicationDecision:'accepted',reasonCodes:[],registerValidation:{...facts.registerValidation,objects:endObjects.map((o,i)=>({disposition:'accepted',messageIndex:0,messageReference:'M',objectId:o.point,identityAgency:'9',registers:[{lineIndex:i,lineNumber:String(i+1),segmentIndex:i}]}))}};
 await db.query("INSERT INTO gridex_received_sources.validation_assessments VALUES($1,$2,$3,'test',encode(sha256(convert_to($4,'UTF8')),'hex'),$5,encode(sha256(convert_to($5,'UTF8')),'hex'),NULL)",[id(351),endId,id(1),endWire,JSON.stringify(endFacts)]);
 await db.query('INSERT INTO profile_mechanical_fixture VALUES($1,$2,$3,$4,$5,true)',[id(1),endId,endObjects[0].point,endObjects[0].li,id(950)]);
 await db.exec("CREATE OR REPLACE FUNCTION gridex_bilateral_prodat.own_source_capability_v1(m public.ediel_messages,wire jsonb,own jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE f public.profile_mechanical_fixture%rowtype;BEGIN IF wire IS DISTINCT FROM gridex_received_sources.normal_switch_wire_v1(m.raw_payload) OR (SELECT count(*) FROM jsonb_array_elements(wire->'objects') o WHERE o=own)<>1 THEN RETURN NULL;END IF;SELECT * INTO f FROM public.profile_mechanical_fixture WHERE company_id=m.company_id AND source_message_id=m.id AND point=own->>'point' AND li=own->>'li' AND current;IF f.profile_id IS NULL THEN RETURN NULL;END IF;RETURN jsonb_build_object('owner','immutable-bilateral-prodat-profile-v1','process',CASE wire->>'code' WHEN 'Z04' THEN 'normal_start_h' WHEN 'Z05' THEN 'own_end_h' END,'objectId',own->>'point','lineItemReference',own->>'li','profileVersionId',f.profile_id);END$$;");
 const endSnapshot=async()=> (await db.query('SELECT to_jsonb(p) b FROM customer_supply_periods p ORDER BY id')).rows;
 const beforeEnd=await endSnapshot();
 assert.equal((await run(endId)).rows[0].b.applied,false);checks++;
 if(process.env.EDIEL_EXPECT_OWNED_END_BASELINE_RED==='1')assert.equal((await run(endId)).rows[0].b.applied,true,'P13/AT-Z05H must commit the accepted own end through the genuine native owner');
 const nationalBefore=(await db.query("SELECT oid::text,proowner,proacl::text,proconfig,prosecdef,pg_get_functiondef(oid) body FROM pg_proc WHERE oid='gridex_received_sources.apply_supply_before_legal_context_v1(uuid,uuid,uuid)'::regprocedure")).rows;
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001083335_ediel_bilateral_prodat_owned_end_and_recorded_supply_currentness.sql',import.meta.url),'utf8'));checks++;
 assert.deepEqual((await db.query("SELECT oid::text,proowner,proacl::text,proconfig,prosecdef,pg_get_functiondef(oid) body FROM pg_proc WHERE oid='gridex_received_sources.apply_supply_before_legal_context_v1(uuid,uuid,uuid)'::regprocedure")).rows,nationalBefore);checks++;
 const endNoEffects=async()=>{assert.deepEqual(await endSnapshot(),beforeEnd);for(const t of ['gridex_received_sources.supply_source_transitions','gridex_bilateral_prodat.supply_effect_receipts'])assert.equal((await db.query('SELECT count(*)::int n FROM '+t+' WHERE source_message_id=$1',[endId])).rows[0].n,0);assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE entity_id=$1",[endId])).rows[0].n,0);};
 await db.query('UPDATE profile_mechanical_fixture SET current=false WHERE source_message_id=$1',[endId]);await assert.rejects(run(endId),/current_profile_required/);await endNoEffects();checks++;
 await db.query('UPDATE profile_mechanical_fixture SET current=true WHERE source_message_id=$1',[endId]);
 await db.exec("UPDATE user_permissions SET effect='deny'");assert.equal((await run(endId)).rows[0].b.applied,false);await endNoEffects();checks++;await db.exec("UPDATE user_permissions SET effect='allow'");
 await db.exec('CREATE TRIGGER fixture_reject_end_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_bilateral_audit_fixture()');await assert.rejects(run(endId),/declared_last_audit_failure/);await endNoEffects();checks++;await db.exec('DROP TRIGGER fixture_reject_end_audit ON audit_logs');
 const ended=(await run(endId)).rows[0].b;assert.equal(ended.applied,true);assert.equal(ended.periods.length,endObjects.length);for(const p of ended.periods){assert.equal(p.source_end_message_id,endId);assert.equal(p.market_state_version,2);assert.equal(p.status,'ending');}checks++;
 assert.equal((await db.query('SELECT raw_payload FROM ediel_messages WHERE id=$1',[endId])).rows[0].raw_payload,endWire);assert.equal((await db.query('SELECT count(*)::int n FROM gridex_bilateral_prodat.supply_effect_receipts WHERE source_message_id=$1',[endId])).rows[0].n,1);checks++;
 assert.equal((await run(endId)).rows[0].b.idempotent,true);assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs WHERE entity_id=$1',[endId])).rows[0].n,1);checks++;
 const firstPeriod=ended.periods.find(p=>p.customer_id===id(3));const basis=async()=>db.query('SELECT gridex_received_sources.supply_period_source_basis_v1($1,$2,$3,$4) b',[id(1),firstPeriod.id,'2099-02-01T12:29:00Z','2099-02-01T12:30:00Z']);
 assert.equal((await basis()).rows[0].b.qualified,true);checks++;
 await db.query('UPDATE profile_mechanical_fixture SET current=false WHERE source_message_id=$1',[id(30)]);assert.equal((await basis()).rows[0].b,null);await assert.rejects(run(),/recorded.*profile/);checks++;await db.query('UPDATE profile_mechanical_fixture SET current=true WHERE source_message_id=$1',[id(30)]);
 await db.query('UPDATE profile_mechanical_fixture SET current=false WHERE source_message_id=$1',[endId]);await assert.rejects(run(endId),/recorded.*profile/);checks++;
 assert.equal((await basis()).rows[0].b,null);checks++;
 assert.equal((await db.query("SELECT has_function_privilege('service_role','gridex_bilateral_prodat.confirm_h_end_v1(uuid,uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,false);checks++;
 console.log('PASS '+checks+' complete prior+owned H end/profile/revocation/replay/rollback PostgreSQL mechanics; finite profile/currentness/primary fixtures are NOT authentic native acceptance');
`
const start=prior.indexOf('const {PGlite}'),anchor=prior.indexOf(' console.log(`PASS'),finish=prior.indexOf('}finally{',anchor)
assert.ok(start>0&&anchor>start&&finish>anchor)
const body=(prior.slice(start,anchor)+continuation+prior.slice(finish)).replaceAll('import.meta.url','fixtureUrl')
await new (Object.getPrototypeOf(async function(){}).constructor)('readFileSync','pathToFileURL','assert','fixtureUrl',body)(readFileSync,pathToFileURL,assert,priorUrl.href).catch(e=>{console.error({message:e.message,code:e.code,where:e.where,position:e.position,internalQuery:e.internalQuery,near:e.position&&e.query?.slice(Math.max(0,Number(e.position)-200),Number(e.position)+100),stack:e.code?undefined:e.stack});process.exitCode=1})
