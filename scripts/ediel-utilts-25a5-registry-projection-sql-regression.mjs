// Hermetic finite regression using actual registry/witness/protected-plan SQL.
// Global catalog and message rows below are declared synthetic ports, not native
// replay, production state, certification, provider or customer evidence.
import assert from 'node:assert/strict'
import {readFileSync,existsSync,cpSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {runInNewContext} from 'node:vm'
import {createRequire} from 'node:module'
import {resolve,dirname} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
const root=resolve(process.env.EDIEL_U5_SOURCE_ROOT||dirname(fileURLToPath(import.meta.url))+'/..')
const source=f=>readFileSync(resolve(root,f),'utf8')
const hash=s=>createHash('sha256').update(s).digest('hex')
const migration='supabase/migrations/20261021052940_ediel_swedish_utilts25a5_registry_and_source_editions.sql'
const sql=existsSync(resolve(root,migration))?source(migration):null
const primary='b76a61b9aa6f136771e5db4948296d1b632b8d775314eb6c93783595ae419db2'
const oldTechnical='05abbd87fb53e2a4e5e0583741e4dad6fed9f525010420e93c12e9b5c3dfda98'
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
function fn(text,name){
 const at=text.search(new RegExp('create(?: or replace)? function '+name.replaceAll('.','\\.')+'\\(','i'));assert.ok(at>=0,'actual function '+name)
 const tail=text.slice(at),open=/\bas\s+(\$[^$]*\$)/i.exec(tail);assert.ok(open)
 const end=tail.indexOf(open[1]+';',open.index+open[0].length);assert.ok(end>=0)
 return tail.slice(0,end+open[1].length+1)
}
const baseline=source('supabase/migrations/20260713100000_ediel_completion_and_platform_contract.sql')
const effective=source('supabase/migrations/20261001142560_ediel_rule_pack_effective_date_and_inbound_grace.sql')
const locked=source('supabase/migrations/20260930193136_ediel_locked_original_rule_pack_witness.sql')
const technical=source('supabase/migrations/20260930232522_ediel_canonical_logical_ack_native_identity.sql')
const {PGlite}=await import(process.env.EDIEL_PGLITE_MODULE?pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href:'@electric-sql/pglite')
const db=new PGlite();let checks=0
const pass=()=>checks++
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA gridex_ediel_source_rules;CREATE SCHEMA gridex_ediel_transport;CREATE SCHEMA gridex_ediel_common_header;CREATE SCHEMA gridex_ediel_readiness;CREATE SCHEMA gridex_ediel_ack_guide;`)
 for(const table of ['ediel_rule_packs','ediel_rule_pack_sources','ediel_message_profiles','ediel_runtime_capabilities']){
  const at=baseline.indexOf('create table if not exists public.'+table+' (');assert.ok(at>=0)
  await db.exec(baseline.slice(at,baseline.indexOf('\n);',at)+4))
 }
 await db.exec(`CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text,execution_context_snapshot jsonb);
 CREATE TABLE gridex_ediel_ack_guide.editions(source_version text PRIMARY KEY,input_manifest jsonb NOT NULL,projection jsonb NOT NULL,installed_at timestamptz NOT NULL DEFAULT clock_timestamp());
 CREATE TABLE gridex_ediel_ack_guide.edition_extensions(original_source_version text PRIMARY KEY REFERENCES gridex_ediel_ack_guide.editions(source_version),extended_source_version text NOT NULL REFERENCES gridex_ediel_ack_guide.editions(source_version));
 CREATE TABLE gridex_ediel_readiness.source_editions(source_version text PRIMARY KEY,input_manifest jsonb NOT NULL,catalog jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
 CREATE TABLE gridex_ediel_transport.technical_expectation_editions(source_version text PRIMARY KEY,input_manifest jsonb NOT NULL,projection jsonb NOT NULL,installed_at timestamptz NOT NULL DEFAULT clock_timestamp());`)
 await db.exec(fn(baseline,'public.resolve_canonical_ediel_rule_pack'))
 await db.exec(fn(effective,'gridex_ediel_source_rules.pack_effective_v1'))
 await db.exec(fn(locked,'public.resolve_canonical_ediel_rule_pack_with_witness_v1'))
 await db.exec(`INSERT INTO public.ediel_rule_packs(id,market,family,guide_version,guide_revision,unh_association_code,valid_from,valid_to,status,source_document,source_hash,field_matrix_version)VALUES('${uid(1)}','electricity','UTILTS','25-A-3','3','E5SE5A','2025-06-01','2026-09-30','active','frozen U3','${'a'.repeat(64)}','25-A-3'),('${uid(2)}','electricity','UTILTS','25-A-4','4','E5SE5A','2026-10-01',NULL,'future','frozen U4','${'b'.repeat(64)}','25-A-4');
 INSERT INTO public.ediel_message_profiles(id,rule_pack_id,message_code,direction,business_process,profile_key,profile)SELECT '${uid(10)}',id,'E66','inbound','validated_metering','OLD:U3','{"family":"UTILTS","messageCode":"E66","guideVersion":"25-A-3","guideRevision":"3"}' FROM public.ediel_rule_packs WHERE id='${uid(1)}';
 INSERT INTO public.ediel_message_profiles(id,rule_pack_id,message_code,direction,business_process,profile_key,profile)SELECT '${uid(11)}',id,'E66','inbound','validated_metering','OLD:U4','{"family":"UTILTS","messageCode":"E66","guideVersion":"25-A-4","guideRevision":"4"}' FROM public.ediel_rule_packs WHERE id='${uid(2)}';`)
 // Before the actual forward exists this assertion is the meaningful RED: the
 // actual existing SQL chooses U4 on the new source date, not Swedish U5.
 if(!sql){const r=(await db.query("select * from public.resolve_canonical_ediel_rule_pack('electricity','UTILTS','E66','','inbound','2026-10-01')")).rows[0];assert.equal(r.guide_version,'25-A-5');throw Error('missing new forward')}
 // Declared retained26A original witness, distinct from the new26B bytes.
 const oldHandbook='3e30d38b5cea1682a210dcd9ec08e4d77091baa87a234baeb07b4e4789a0e9b3'
 await db.query("insert into public.ediel_rule_pack_sources(rule_pack_id,source_type,priority,title,revision,valid_from,source_hash,source_locator) values($1,'market_handbook',2,'declared retained26A','26A','2026-04-01',$2,'https://www.elmarknadshandboken.se/Dokumentation/Texter/NEMHB.pdf')",[uid(1),oldHandbook])
 // Real existing immutable require_v1 is exercised against declared synthetic
 // protected receipt/message rows. Common-header is an explicit denied lane.
 const basisSQL=source('supabase/migrations/20260930180104_ediel_immutable_source_rule_pack_basis.sql')
 await db.exec(`CREATE TABLE gridex_ediel_source_rules.receipts(source_message_id uuid PRIMARY KEY,company_id uuid,environment text,direction text,payload_sha256 text,evidence jsonb);`)
 await db.exec(fn(basisSQL,'gridex_ediel_source_rules.require_v1'))
 await db.exec(fn(basisSQL,'gridex_ediel_source_rules.immutable'))
 await db.exec(`CREATE TRIGGER immutable_receipts BEFORE UPDATE OR DELETE ON gridex_ediel_source_rules.receipts FOR EACH ROW EXECUTE FUNCTION gridex_ediel_source_rules.immutable();
 CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_ediel_source_rules.receipts FOR EACH STATEMENT EXECUTE FUNCTION gridex_ediel_source_rules.immutable();
 CREATE FUNCTION gridex_ediel_common_header.require_ack_v1(public.ediel_messages) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'declared_common_header_port_not_used';END$$;`)
 const edition=(text,marker)=>JSON.parse(text.match(new RegExp('-- BEGIN '+marker+"[\\s\\S]*?FROM \\(SELECT '((?:[^']|'')*)'::jsonb value\\) edition;"))[1].replaceAll("''","'"))
 const old=edition(technical,'CANONICAL TECHNICAL EXPECTATION PROJECTION')
 await db.query('INSERT INTO gridex_ediel_transport.technical_expectation_editions VALUES($1,$2,$3,clock_timestamp())',[old.sourceVersion,old.inputManifest,old.projection])
 for(const name of ['gridex_ediel_transport.canonical_message_code_v1','gridex_ediel_transport.require_technical_expectation_plan_v1','gridex_ediel_transport.require_technical_expectation_binding_v1'])await db.exec(fn(technical,name))
 await db.exec(`REVOKE ALL ON FUNCTION public.resolve_canonical_ediel_rule_pack(text,text,text,text,text,date),public.resolve_canonical_ediel_rule_pack_with_witness_v1(text,text,text,text,text,date),gridex_ediel_transport.canonical_message_code_v1(text,text),gridex_ediel_transport.require_technical_expectation_plan_v1(public.ediel_messages,jsonb),gridex_ediel_transport.require_technical_expectation_binding_v1(public.ediel_messages,jsonb),gridex_ediel_source_rules.require_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
 GRANT EXECUTE ON FUNCTION public.resolve_canonical_ediel_rule_pack_with_witness_v1(text,text,text,text,text,date) TO service_role;`)
 const currentAck=edition(sql,'CANONICAL ACK GUIDE PROJECTION'),response=edition(sql,'CANONICAL RESPONSE GUIDE PROJECTION'),newTechnical=edition(sql,'CANONICAL TECHNICAL EXPECTATION PROJECTION')
 // This historical matching but unextended edition catches the old generator's
 // broad P/U/T-only extension SQL; its identity is declared fixture data.
 const historicalAck=structuredClone(currentAck.projection);delete historicalAck.qualifiedCurrentSources;delete historicalAck.qualifiedMarketHandbook
 await db.query('INSERT INTO gridex_ediel_ack_guide.editions VALUES($1,$2,$3,clock_timestamp())',['c'.repeat(64),{},historicalAck])
 const tables=['public.ediel_rule_packs','public.ediel_rule_pack_sources','public.ediel_message_profiles','public.ediel_runtime_capabilities','gridex_ediel_ack_guide.editions','gridex_ediel_ack_guide.edition_extensions','gridex_ediel_readiness.source_editions','gridex_ediel_transport.technical_expectation_editions','gridex_ediel_source_rules.receipts']
 async function snapshot(){const out={};for(const t of tables)out[t]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') value from ${t} t`)).rows[0].value;out.functions=(await db.query("select coalesce(jsonb_agg(to_jsonb(p) order by p.oid),'[]') value from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('gridex_ediel_source_rules','gridex_ediel_transport') or p.oid in ('public.resolve_canonical_ediel_rule_pack(text,text,text,text,text,date)'::regprocedure,'public.resolve_canonical_ediel_rule_pack_with_witness_v1(text,text,text,text,text,date)'::regprocedure)")).rows[0].value;return out}
 const meta=async name=>(await db.query("select to_jsonb(p)-'prosrc' value,prosrc from pg_proc p where oid=$1::regprocedure",[name])).rows[0]
 const protectedNames=['public.resolve_canonical_ediel_rule_pack(text,text,text,text,text,date)','gridex_ediel_source_rules.pack_effective_v1(uuid,text,date)','gridex_ediel_transport.require_technical_expectation_plan_v1(public.ediel_messages,jsonb)','gridex_ediel_transport.require_technical_expectation_binding_v1(public.ediel_messages,jsonb)','gridex_ediel_transport.canonical_message_code_v1(text,text)']
 const beforeMeta=Object.fromEntries(await Promise.all(protectedNames.map(async n=>[n,await meta(n)])))
 // Fail both early and after projection/selector changes. The actual forward
 // owns BEGIN/COMMIT; explicit ROLLBACK follows its aborted transaction.
 for(const [name,text,error]of [['public.resolve_canonical_ediel_rule_pack',baseline,/ediel_u5_selector_predecessor_required/],['gridex_ediel_transport.canonical_message_code_v1',technical,/ediel_u5_logical_identity_changed/]]){
  const definition=fn(text,name).replace(/^create function/i,'CREATE OR REPLACE FUNCTION'),perturbed=definition.replace('$$;',()=> '\n-- declared predecessor drift\n$$;');await db.exec(perturbed)
  const before=await snapshot();await assert.rejects(db.exec(sql),error);await db.exec('ROLLBACK');assert.deepEqual(await snapshot(),before,'whole catalog/row/function rollback');pass()
  await db.exec(definition)
 }
 const before=await snapshot();await db.exec(sql);pass()
 for(const name of protectedNames){const after=await meta(name);assert.deepEqual(after.value,beforeMeta[name].value,'existing pg_proc metadata '+name);if(name.includes('binding_v1')||name.includes('canonical_message_code'))assert.equal(after.prosrc,beforeMeta[name].prosrc);pass()}
 for(const t of tables){const oldRows=before[t];const after=(await snapshot())[t];for(const row of oldRows)assert.ok(after.some(r=>JSON.stringify(r)===JSON.stringify(row)),'old row preserved '+t);pass()}
 const resolvePack=async(date,direction='inbound',code='E66')=>(await db.query("select * from public.resolve_canonical_ediel_rule_pack_with_witness_v1('electricity','UTILTS',$1,'',$2,$3)",[code,direction,date])).rows[0]?.resolve_canonical_ediel_rule_pack_with_witness_v1
 const selected=await resolvePack('2026-10-01');assert.equal(selected.guide_version,'25-A-5');assert.equal(selected.original_version,'25-A-5:r5');assert.notEqual(selected.source_hash,primary);assert.ok(selected.original_snapshot.guideSources.some(s=>s.source_type==='technical_guide'&&s.revision==='25-A-5'&&s.source_hash===primary&&s.source_locator));pass()
 const handbook=selected.original_snapshot.guideSources.find(s=>s.source_type==='market_handbook');assert.equal(handbook.revision,'26B');assert.equal(handbook.valid_from,'2026-10-01');assert.equal(handbook.source_hash,'36d6a92ac55adecf427d8af21278144c045458a7234ca6487c95a1f4df2a1876');assert.notEqual(handbook.source_hash,hash(source('docs/ediel/handbook-26b/source-reconciliation.json')));assert.equal(handbook.metadata.allFrozenCriteriaRecertified,false);assert.ok(handbook.metadata.openQualifications.includes('exact chapter-by-chapter comparison with original 26A'));assert.equal(selected.profile.sourceDependencies.marketHandbook.revision,'26B');pass()
 const u3Selected=await resolvePack('2026-09-30');assert.equal(u3Selected.original_version,'25-A-3:r3');assert.ok(u3Selected.original_snapshot.guideSources.some(s=>s.revision==='26A'&&s.source_hash===oldHandbook));assert.ok(!u3Selected.original_snapshot.guideSources.some(s=>s.revision==='26B'));pass()
 for(const date of ['2026-10-01','2026-10-14','2026-10-15','2026-10-21']){assert.equal((await resolvePack(date)).guide_version,'25-A-5');assert.equal((await db.query('select gridex_ediel_source_rules.pack_effective_v1($1,\'outbound\',$2) ok',[uid(2),date])).rows[0].ok,false);pass()}
 for(const [date,dir,expected]of [['2026-10-01','inbound',true],['2026-10-14','inbound',true],['2026-10-15','inbound',false],['2026-10-01','outbound',false]]){assert.equal((await db.query('select gridex_ediel_source_rules.pack_effective_v1($1,$2,$3) ok',[uid(1),dir,date])).rows[0].ok,expected);pass()}
 for(const status of ['draft','retired']){await db.query('update public.ediel_rule_packs set status=$1 where id=$2',[status,selected.rule_pack_id]);await assert.rejects(resolvePack('2026-10-21'),/canonical_rule_pack_resolution_count:0/);assert.equal((await db.query("select gridex_ediel_source_rules.pack_effective_v1($1,'outbound','2026-10-21') ok",[uid(2)])).rows[0].ok,false);pass()}
 await db.query("update public.ediel_rule_packs set status='active' where id=$1",[selected.rule_pack_id])
 await db.query('update public.ediel_message_profiles set is_enabled=false where rule_pack_id=$1',[selected.rule_pack_id]);await assert.rejects(resolvePack('2026-10-21'),/canonical_rule_pack_resolution_count:0/);await db.query('update public.ediel_message_profiles set is_enabled=true where rule_pack_id=$1',[selected.rule_pack_id]);pass()
 await assert.rejects(resolvePack('2026-10-21','outbound','S06'),/canonical_rule_pack_resolution_count:0/);await assert.rejects(resolvePack('2026-10-21','inbound','S08'),/canonical_rule_pack_resolution_count:0/);pass()
 assert.deepEqual((await db.query('select original_source_version,extended_source_version from gridex_ediel_ack_guide.edition_extensions')).rows,[{original_source_version:currentAck.sourceVersion,extended_source_version:response.sourceVersion}]);pass()
 assert.equal((await db.query('select source_version from gridex_ediel_ack_guide.editions order by installed_at desc,source_version limit 1')).rows[0].source_version,response.sourceVersion);pass()
 assert.deepEqual(currentAck.projection.originalSources,historicalAck.originalSources);assert.ok(response.projection.registeredGuideScopes.some(s=>s.guideVersion==='25-A-5'));assert.ok(response.projection.registeredGuideScopes.some(s=>s.guideVersion==='25-A-4'));pass()
 for(const e of [currentAck,response,newTechnical]){assert.equal(e.sourceVersion,hash(JSON.stringify({inputManifest:e.inputManifest,projection:e.projection})));assert.equal(e.inputManifest['docs/ediel/utilts-25a5/source-manifest.json'],hash(source('docs/ediel/utilts-25a5/source-manifest.json')));for(const [f,digest]of Object.entries(e.inputManifest))assert.equal(hash(source(f)),digest,'complete actual input '+f);assert.equal(e.projection.qualifiedCurrentSources[0].sha256,primary);pass()}
 assert.deepEqual(newTechnical.projection.logicalCodes,old.projection.logicalCodes);pass()
 // An absent successor, expired window or duplicate matching row must
 // refuse; none may revive the same-start superseded U4 candidate.
 await db.exec('BEGIN');await db.query('delete from public.ediel_rule_packs where id=$1',[selected.rule_pack_id]);await assert.rejects(resolvePack('2026-10-21'),/resolution_count:0/);await db.exec('ROLLBACK');pass()
 await db.query("update public.ediel_rule_packs set valid_to='2026-10-20' where id=$1",[selected.rule_pack_id]);await assert.rejects(resolvePack('2026-10-21'),/resolution_count:0/);await db.query('update public.ediel_rule_packs set valid_to=NULL where id=$1',[selected.rule_pack_id]);pass()
 const dup=(await db.query("insert into public.ediel_message_profiles(rule_pack_id,message_code,direction,business_process,profile_key,profile) select rule_pack_id,message_code,'both',business_process,'declared-duplicate',profile from public.ediel_message_profiles where id=$1 returning id",[selected.message_profile_id])).rows[0].id
 await assert.rejects(resolvePack('2026-10-21'),/resolution_count:2/);await db.query('delete from public.ediel_message_profiles where id=$1',[dup]);pass()
 const dupCap=(await db.query("insert into public.ediel_runtime_capabilities(rule_pack_id,message_code,direction) values($1,'E66','both') returning id",[selected.rule_pack_id])).rows[0].id
 await assert.rejects(resolvePack('2026-10-21'),/more than one row/);await db.query('delete from public.ediel_runtime_capabilities where id=$1',[dupCap]);pass()
 const caps=(await db.query('select message_code,direction,builder_ready,state_machine_ready,verification from public.ediel_runtime_capabilities where rule_pack_id=$1',[selected.rule_pack_id])).rows
 assert.equal(caps.length,14);assert.ok(caps.some(c=>c.message_code==='E66'&&c.direction==='inbound'&&!c.builder_ready&&c.state_machine_ready));assert.ok(caps.some(c=>c.message_code==='E73'&&c.direction==='outbound'&&c.builder_ready));assert.ok(caps.some(c=>c.message_code==='S06'&&c.direction==='inbound'&&!c.builder_ready&&!c.state_machine_ready));assert.ok(caps.every(c=>c.verification.nativeTests==='NOT_RUN'&&c.verification.marketAuthorization==='NOT_GRANTED'));pass()
 const beforeValidator='gridex_ediel_transport.require_technical_expectation_plan_before_swedish_utilts25a5_v1(public.ediel_messages,jsonb)',newValidator='gridex_ediel_transport.require_technical_expectation_plan_swedish_utilts25a5_v1(public.ediel_messages,jsonb)'
 assert.equal((await meta(beforeValidator)).prosrc,beforeMeta[protectedNames[2]].prosrc);assert.equal((await meta(newValidator)).prosrc,beforeMeta[protectedNames[2]].prosrc.replaceAll(oldTechnical,newTechnical.sourceVersion));pass()
 async function messageBasis(n,version='25-A-5',revision='5',family='APERAK',code='313',witnessPrimary=primary,basisChange=()=>{}){
  const id=uid(n),company=uid(100),raw='synthetic-wire-'+n,v=version+':r'+revision
  const scope=(version==='25-A-5'?newTechnical:old).projection.scopes.find(s=>s.guideVersion===version)
  const basis={version:v,snapshot:{version:v,rulePack:{family:version==='26.A'?'PRODAT':'UTILTS',guide_version:version,guide_revision:revision},guideSources:[{source_type:'technical_guide',revision:version,source_hash:version==='25-A-5'?witnessPrimary:version==='25-A-3'?'a'.repeat(64):version==='25-A-4'?'b'.repeat(64):'e'.repeat(64),source_locator:'https://www.ediel.se/Portal/Document/3364'}]}}
  basisChange(basis)
  await db.query('insert into public.ediel_messages values($1,$2,\'test\',\'outbound\',$3,$4,$5,\'{}\')',[id,company,family,code,raw])
  await db.query('insert into gridex_ediel_source_rules.receipts values($1,$2,\'test\',\'outbound\',$3,$4)',[id,company,hash(raw),basis])
  const profileKey=family==='APERAK'?null:family==='UTILTS_ERR'?'utilts_err':'utilts_e73'
  const policy={guideRevision:scope.canonicalGuideRevision,profileKey,referenceDate:'2026-10-21',sourceTrace:[{authority:'guide',document:scope.documentName,section:'own'},{authority:'acknowledgement',document:scope.documentName,section:'own'}]}
  const plan={...newTechnical.projection.constraints,policy},binding={technicalExpectationPlan:plan,admissionDecision:{version:1,family,code:family==='UTILTS_ERR'?'ERR':family==='APERAK'?'APERAK':code,guide:{guideRevision:scope.canonicalGuideRevision},referenceDate:policy.referenceDate,profileKey,sourceTrace:policy.sourceTrace}}
  return {id,company,plan,binding,basis}
 }
 const validate=async(m,plan=m.plan)=>(await db.query('select gridex_ediel_transport.require_technical_expectation_plan_v1(m,$2) value from public.ediel_messages m where id=$1',[m.id,plan])).rows[0].value
 const binding=async(m,b=m.binding)=>(await db.query('select gridex_ediel_transport.require_technical_expectation_binding_v1(m,$2) value from public.ediel_messages m where id=$1',[m.id,b])).rows[0].value
 for(const [n,family,code]of [[30,'APERAK','313'],[31,'UTILTS_ERR','ERR'],[32,'UTILTS','E73']]){const m=await messageBasis(n,'25-A-5','5',family,code);assert.deepEqual(await validate(m),m.plan);assert.deepEqual(await binding(m),m.binding);pass()}
 const u5=await messageBasis(33);for(const alter of [p=>p.policy.guideRevision='25-A-4',p=>p.policy.profileKey='forged',p=>p.policy.sourceTrace=[],p=>p.policy.referenceDate='2026-02-30',p=>p.offset=31]){const plan=structuredClone(u5.plan);alter(plan);await assert.rejects(validate(u5,plan));pass()}
 const mismatch=structuredClone(u5.binding);mismatch.admissionDecision.sourceTrace=[];await assert.rejects(binding(u5,mismatch),/same_admission_required/);pass()
 for(const [n,alter]of [[45,b=>b.snapshot.guideSources=[]],[46,b=>b.snapshot.guideSources[0].source_locator=' '],[47,b=>b.snapshot.version='25-A-4:r4']]){const m=await messageBasis(n,'25-A-5','5','APERAK','313',primary,alter);await assert.rejects(validate(m),/u5_original_primary_required/);pass()}
 const mismatchedBasis=await messageBasis(48,'25-A-5','4');await assert.rejects(validate(mismatchedBasis),/original_guide_required/);pass()
 const wrong=await messageBasis(34,'25-A-5','5','APERAK','313','f'.repeat(64));await assert.rejects(validate(wrong),/u5_original_primary_required/);pass()
 // A third, newest malicious edition may never change either fixed route.
 await db.query('insert into gridex_ediel_transport.technical_expectation_editions values($1,$2,$3,clock_timestamp())',['f'.repeat(64),{}, {constraints:{},scopes:[],profiles:[],ackMatrix:[],logicalCodes:{}}])
 assert.deepEqual(await validate(u5),u5.plan);pass()
 for(const [n,version,revision]of [[35,'25-A-3','3'],[36,'25-A-4','4'],[38,'26.A','3']]){const m=await messageBasis(n,version,revision);const prior=structuredClone(m.plan);assert.deepEqual(await validate(m),prior);assert.deepEqual(await binding(m),m.binding);pass()}
 // Deliberately disable only the new fixed edition in this synthetic catalog:
 // U5 must fail, while U3/U4 still traverse the exact saved old validator.
 await db.query('delete from gridex_ediel_transport.technical_expectation_editions where source_version=$1',[newTechnical.sourceVersion]);await assert.rejects(validate(u5));const u4=await messageBasis(37,'25-A-4','4');assert.deepEqual(await validate(u4),u4.plan);pass()
 await db.query('insert into gridex_ediel_transport.technical_expectation_editions values($1,$2,$3,clock_timestamp())',[newTechnical.sourceVersion,newTechnical.inputManifest,newTechnical.projection])
 for(const family of ['AI_LIST','CONTRL']){await db.query('insert into public.ediel_messages values($1,$2,\'test\',\'outbound\',$3,$3,\'no-national-basis\',\'{}\')',[uid(family==='AI_LIST'?40:41),uid(100),family]);assert.equal(await validate({id:uid(family==='AI_LIST'?40:41),plan:null}),null);pass()}
 await assert.rejects(db.exec('update gridex_ediel_source_rules.receipts set evidence=\'{}\''),/basis_immutable/);pass()
 for(const name of [beforeValidator,newValidator,'gridex_ediel_source_rules.pack_superseded_by_swedish_utilts25a5_v1(text,text,text,text,date)']){const acl=(await db.query("select has_function_privilege('authenticated',$1,'execute') a,has_function_privilege('service_role',$1,'execute') s",[name])).rows[0];assert.deepEqual(acl,{a:false,s:false});pass()}
 // Exercise the real deterministic generator with adverse *temporary*
 // source fixtures. The actual immutable source root is never modified and no
 // result from these declared negative fixtures is adopted or published.
 const temporary=mkdtempSync(resolve(tmpdir(),'gridex-u5-source-contract-'))
 try{
  for(const directory of ['lib','docs'])cpSync(resolve(root,directory),resolve(temporary,directory),{recursive:true})
  const manifestPath=resolve(temporary,'docs/ediel/utilts-25a5/source-manifest.json'),manifestBytes=readFileSync(manifestPath,'utf8'),target=resolve(temporary,'new-forward.sql')
  const realRequire=createRequire(import.meta.url)
  const project=(name,marker)=>{
   writeFileSync(target,marker);const file=resolve(root,'scripts/'+name);let error=null
   const projectRequire=id=>{if(!['node:fs','node:path','node:crypto','typescript'].includes(id))throw Error('Unexpected generator dependency:'+id);return realRequire(id)}
   try{runInNewContext(source('scripts/'+name),{require:projectRequire,__filename:file,__dirname:dirname(file),process:{argv:[process.execPath,file,'--repo-root',temporary,'--migration',target,'--current-swedish-utilts']},console:{log(){}}},{filename:file,timeout:30000})}catch(e){error=e}
   assert.ok(error,'negative source must refuse');assert.equal(readFileSync(target,'utf8'),marker);return String(error)
  }
  const bad=JSON.parse(manifestBytes);bad.primarySource.sha256='f'.repeat(64);writeFileSync(manifestPath,JSON.stringify(bad));assert.match(project('generate-ediel-native-ack-guide-projection.cjs','-- CANONICAL ACK GUIDE PROJECTION PLACEHOLDER'),/Qualified current Swedish UTILTS primary required/);pass();writeFileSync(manifestPath,manifestBytes)
  const handbookPath=resolve(temporary,'docs/ediel/handbook-26b/source-reconciliation.json'),handbookBytes=readFileSync(handbookPath,'utf8'),badBook=JSON.parse(handbookBytes);badBook.currentHandbook.edition='26A';writeFileSync(handbookPath,JSON.stringify(badBook));assert.match(project('generate-ediel-native-ack-guide-projection.cjs','-- CANONICAL ACK GUIDE PROJECTION PLACEHOLDER'),/Qualified current handbook26B dependency required/);pass();writeFileSync(handbookPath,handbookBytes)
  const guidePath=resolve(temporary,'lib/ediel/rulebook/ackGuidePolicy.ts'),guideBytes=readFileSync(guidePath,'utf8');writeFileSync(guidePath,guideBytes+'\ncommonHeaderOriginalSource({} as never)\n');assert.match(project('generate-ediel-native-ack-guide-projection.cjs','-- CANONICAL ACK GUIDE PROJECTION PLACEHOLDER'),/Runtime common-header authority cannot execute in source projection/);pass();writeFileSync(guidePath,guideBytes)
  assert.match(project('generate-ediel-native-response-guide-projection.cjs','-- CANONICAL RESPONSE GUIDE PROJECTION PLACEHOLDER'),/Generate this current epoch ACK edition before response/);pass()
 }finally{rmSync(temporary,{recursive:true,force:true})}
 console.log(JSON.stringify({scope:'finite_actual_SQL_with_synthetic_catalog_and_protected_receipts_not_native',migration,sqlSHA256:hash(sql),checks,result:'PASS',native:'NOT_RUN',production:'NOT_RUN'}))
}finally{await db.close()}
