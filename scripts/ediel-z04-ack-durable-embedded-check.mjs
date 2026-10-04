// Focused genuine SQL proof, plus a local disposable-CI syntax producer.
// Public columns/defaults/constraints and guards come from the committed native
// snapshot; private owners come from their actual migrations. No full replay,
// Supabase/PostgREST/RLS proof, transport or business authority is claimed.
import {readFileSync} from 'node:fs'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
import {createServer} from 'vite'

const root=fileURLToPath(new URL('..',import.meta.url))
const modules=await createServer({root,configFile:false,resolve:{alias:{'@':root}},server:{middlewareMode:true},appType:'custom'})
const sqlLiteral=value=>"'"+String(value).replaceAll("'","''")+"'"
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
async function syntaxFacet(source){
 assert.ok(uuid(source.id)&&uuid(source.company_id),'synthetic fixture UUID scope')
 assert.equal(source.direction,'inbound');assert.equal(source.environment,'test');assert.equal(source.message_family,'PRODAT');assert.equal(source.message_code,'Z04')
 assert.equal(source.metadata?.nativeFixture,'ediel-z04-ack-durable-v1')
 const hash=createHash('sha256').update(source.raw_payload,'utf8').digest('hex')
 assert.equal(hash,source.immutable_payload_hash,'actual immutable source bytes')
 const {validateEdifactSyntax}=await modules.ssrLoadModule('/lib/ediel/core/syntaxValidator.ts')
 const result=validateEdifactSyntax(source)
 assert.equal(result.ok,true,'fixture must produce genuine positive syntax decision')
 return {hash,facts:JSON.stringify({version:1,owner:'canonical-runtime-syntax-v1',syntaxDecision:result.ok?'accepted':'rejected',reasonCodes:result.issues.filter(issue=>issue.severity==='error').map(issue=>issue.code)})}
}
if(process.argv.includes('--record-native-syntax-facet')){
 try{
  // This helper has no configurable database destination. It only serves the
  // disposable local stack in clean-native-replay/typegen, never a hosted DB.
  const localDb='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  const psql=input=>execFileSync('psql',[localDb,'-XAtq','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:15000,maxBuffer:1024*1024}).trim()
  const supplied=JSON.parse(readFileSync(0,'utf8'))
  assert.ok(uuid(supplied.id)&&uuid(supplied.company_id),'synthetic fixture UUID scope')
  const source=JSON.parse(psql(`SELECT to_jsonb(m) FROM public.ediel_messages m JOIN public.companies c ON c.id=m.company_id WHERE m.id=${sqlLiteral(supplied.id)}::uuid AND m.company_id=${sqlLiteral(supplied.company_id)}::uuid AND c.name='Z04 ACK durable fixture' AND m.metadata->>'nativeFixture'='ediel-z04-ack-durable-v1';`))
  assert.equal(source.raw_payload,supplied.raw_payload);assert.equal(source.id,supplied.id);assert.equal(source.company_id,supplied.company_id)
  const {hash,facts}=await syntaxFacet(source)
  // The technical syntax port requires the fixture's current tenant actor (142520).
  const actor=psql(`SELECT user_id FROM public.company_memberships WHERE company_id=${sqlLiteral(source.company_id)}::uuid AND status='active' AND is_active`)
  assert.ok(uuid(actor),'single current fixture actor')
  psql(`BEGIN; SET LOCAL ROLE service_role; SELECT public.ediel_record_technical_syntax_facet_v2(${sqlLiteral(source.company_id)}::uuid,${sqlLiteral(source.id)}::uuid,${sqlLiteral(hash)},${sqlLiteral(facts)},${sqlLiteral(actor)}::uuid,'prepare'); COMMIT;`)
  // Production receive order (lib/ediel/flows/inboundProcessing.ts): the
  // canonical owner decides and records the source validation, including its
  // PRODAT response facet, through the same service-role RPC as the app.
  if(!process.env.SUPABASE_SERVICE_ROLE_KEY){
   const status=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',timeout:60000}))
   assert.equal(status.API_URL,'http://127.0.0.1:54321','disposable local stack only')
   process.env.NEXT_PUBLIC_SUPABASE_URL=status.API_URL;process.env.SUPABASE_SERVICE_ROLE_KEY=status.SERVICE_ROLE_KEY;process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=status.ANON_KEY
  }
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:54321','disposable local stack only')
  const {resolveCanonicalRuntimeDecisionWithRegistry}=await modules.ssrLoadModule('/lib/ediel/core/runtimeDecision.ts')
  const {recordReceivedSourceValidation}=await modules.ssrLoadModule('/lib/ediel/core/receivedSourceValidationLedger.ts')
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source)
  // The fixture omits field 213: syntax passes, the application owner rejects it.
  assert.equal(decision.syntaxDecision,'accepted',JSON.stringify(decision.issues))
  assert.equal(decision.applicationDecision,'rejected',JSON.stringify(decision.issues))
  assert.ok(decision.issues.some(issue=>issue.prodatDiagnostic?.fieldNumber==='213'),'field 213 is the rejection')
  const recorded=await recordReceivedSourceValidation({original:source,validated:source,resolvedCompanyId:source.company_id,decision})
  assert.equal(recorded?.status,'recorded',JSON.stringify(recorded))
  console.log('Synthetic disposable-CI source: actual canonical syntax facet committed')
 }catch(error){console.error(error.message);process.exitCode=1}finally{await modules.close()}
}else{
 let db,checks=0
 const schema=readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8')
 const read=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')
 function nativeFunction(name){
  const start=schema.indexOf('CREATE FUNCTION public.'+name+'(');assert.ok(start>=0,name)
  const raw=schema.slice(start),tag=raw.match(/\bAS (\$[\w]*\$)/)?.[1];assert.ok(tag,name)
  const end=raw.indexOf(tag+';',raw.indexOf(tag)+tag.length);assert.ok(end>=0,name)
  return raw.slice(0,end+tag.length+1)
 }
 function nativeTable(name,namespace='public'){
  const statement=schema.match(new RegExp('CREATE TABLE '+namespace.replaceAll('.','\\.')+'\\.'+name+' \\([\\s\\S]*?\\n\\);'))?.[0]
  assert.ok(statement,name);return statement
 }
 const tables=['companies','ediel_messages','ediel_outbox','ediel_message_profiles','ediel_rule_packs','ediel_rule_pack_sources','ediel_rule_pack_snapshots','communication_routes','ediel_route_profiles','tenant_actor_identifiers','tenant_actor_roles','tenant_ediel_profiles','tenant_counterparty_relations','platform_actor_identifiers']
 const publicGuards=['gridex_validate_ediel_message_contract','gridex_validate_ediel_outbox_contract','gridex_validate_ediel_outbox_tenant_and_snapshot','gridex_capture_ediel_rule_pack_snapshot','gridex_bind_inbound_ediel_rule_pack_evidence']
 async function state(){
  const names=[...tables,'gridex_ediel_wire_namespace.reservations','gridex_ediel_wire_namespace.coverage','gridex_ediel_inbound_context.receipts','gridex_ediel_technical_ack.sources','gridex_ediel_technical_ack.syntax_facets','gridex_ediel_technical_ack.replies']
  const result={}
  for(const name of names)result[name]=(await db.query('select coalesce(jsonb_agg(rowdata order by rowdata::text),\'[]\'::jsonb) value from (select to_jsonb(t) rowdata from '+name+' t) rows')).rows[0].value
  return result
 }
 try{
  const modulePath=process.env.EDIEL_PGLITE_MODULE
  if(!modulePath)throw Error('EDIEL_PGLITE_MODULE required; pinned temporary @electric-sql/pglite@0.3.14')
  const packageInfo=JSON.parse(readFileSync(new URL('../package.json',pathToFileURL(modulePath)),'utf8'))
  assert.equal(packageInfo.name,'@electric-sql/pglite');assert.equal(packageInfo.version,'0.3.14')
  const {PGlite}=await import(pathToFileURL(modulePath).href);db=new PGlite()
  // PGlite lacks pgcrypto. Built-in PostgreSQL SHA256 supplies the actual
  // digest result to the unmodified message/namespace/context owner functions.
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema extensions;create schema gridex_utilts_binding;create schema gridex_ediel_readiness;create schema gridex_received_sources;
   create function extensions.digest(bytea,text) returns bytea language sql immutable as 'select sha256($1)';
   set search_path=public,extensions;
   create table gridex_ediel_readiness.source_editions(source_version text primary key,input_manifest jsonb,catalog jsonb,recorded_at timestamptz default clock_timestamp());`)
  await db.exec(nativeFunction('gridex_normalize_org_number')+nativeFunction('gridex_new_external_tenant_reference'))
  const environmentType=schema.match(/CREATE TYPE public\.ediel_environment_type AS ENUM \([\s\S]*?\n\);/)?.[0];assert.ok(environmentType)
  await db.exec(environmentType)
  for(const name of tables){
   await db.exec(nativeTable(name))
   for(const statement of schema.matchAll(new RegExp('ALTER TABLE ONLY public\\.'+name+'\\n[\\s\\S]*?;','g'))){
    if(/ADD CONSTRAINT .* (PRIMARY KEY|UNIQUE) \(/.test(statement[0]))await db.exec(statement[0])
   }
  }
  await db.exec(nativeTable('validation_assessments','gridex_received_sources'))
  for(const statement of schema.matchAll(/CREATE UNIQUE INDEX [^;]+ ON public\.(ediel_rule_pack_sources|ediel_outbox) [^;]+;/g))await db.exec(statement[0])
  const token=read('20260923135706_ediel_utilts_consumption_binding_v1.sql')
  await db.exec(token.slice(token.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),token.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
  for(const name of publicGuards)await db.exec(nativeFunction(name))
  for(const line of schema.split('\n'))if(line.startsWith('CREATE TRIGGER')&&publicGuards.some(name=>line.includes('FUNCTION public.'+name+'(')))await db.exec(line)
  await db.exec(read('20260930171116_ediel_wire_reference_namespace.sql'))
  await db.exec(read('20260930173632_ediel_immutable_source_legal_context.sql'))
  const rule=read('20260930180104_ediel_immutable_source_rule_pack_basis.sql')
  await db.exec(rule.slice(rule.indexOf('CREATE OR REPLACE FUNCTION gridex_ediel_inbound_context.derive'),rule.indexOf('CREATE SCHEMA gridex_ediel_source_rules')))
  // Exact prospective technical source/syntax/reply owners AND their current
  // public snapshot trigger override. Do not substitute pre-184410 snapshot.
  const technical=read('20260930184410_ediel_protected_technical_contrl_source_basis.sql')
  await db.exec(technical.slice(0,technical.indexOf('CREATE OR REPLACE FUNCTION gridex_ediel_source_rules.capture_v1')).replace(/^BEGIN;\s*/m,''))
  await db.exec(read('20260930192030_ediel_aperak_unused_document_namespace.sql'))
  await db.exec(read('20260930200005_ediel_persisted_technical_contrl_basis_read.sql'))
  await db.exec(read('20260930213117_ediel_contrl_empty_application_namespace.sql'))
  const seed=read('20260713100000_ediel_completion_and_platform_contract.sql')
  for(const prefix of ['insert into public.ediel_rule_packs(market','insert into public.ediel_rule_pack_sources(rule_pack_id','with prodat_pack as (']){
   const start=seed.indexOf(prefix),end=seed.indexOf(';',start);assert.ok(start>=0&&end>start,prefix)
   await db.exec(seed.slice(start,end+1))
  }
  const current=readFileSync(new URL('./ediel-z04-ack-durable-regression.sql',import.meta.url),'utf8')
  const setup=current.split('-- BEGIN Z04_FIXTURE_SETUP\n')[1]?.split('-- END Z04_FIXTURE_SETUP')[0];assert.ok(setup)
  await db.exec(setup);checks++
  const f=(await db.query('select * from pg_temp.gridex_z04_ack_fixture')).rows[0]
  const source=(await db.query('select * from public.ediel_messages where id=$1',[f.source_message_id])).rows[0]
  const {hash,facts}=await syntaxFacet(source);checks++
  const capture=()=>db.query('select public.ediel_capture_technical_syntax_ack_basis_v1($1,$2) evidence',[f.company_id,f.source_message_id])
  const record=()=>db.query('select public.ediel_record_technical_syntax_facet_v1($1,$2,$3,$4) evidence',[f.company_id,f.source_message_id,hash,facts])
  await db.exec('set role service_role');await assert.rejects(capture(),/ediel_technical_ack_basis_required/);await db.exec('reset role');checks++
  // Real xmin fence: even valid canonical facts in this transaction fail.
  await db.exec('begin;set local role service_role');await record();await assert.rejects(capture(),/ediel_technical_ack_basis_required/);await db.exec('rollback');checks++
  await db.exec('set role service_role');const recorded=(await record()).rows[0].evidence;await db.exec('reset role')
  assert.equal(recorded.authorizesBusinessEffect,false);assert.equal(recorded.scope,'canonical_syntax_only');checks++
  const baseline=await state()
  const sourceBasis=baseline['gridex_ediel_technical_ack.sources'][0]
  assert.equal(sourceBasis.status,'ready');assert.equal(sourceBasis.company_id,f.company_id);assert.equal(sourceBasis.payload_sha256,hash);checks++
  await db.exec('set role service_role');assert.deepEqual((await record()).rows[0].evidence,recorded);await db.exec('reset role')
  assert.deepEqual(await state(),baseline);checks++
  const proof=current.split('-- BEGIN Z04_ACK_PROOF\n')[1]?.replaceAll(":'z04_fixture_company_id'",sqlLiteral(f.company_id)).replaceAll(":'z04_fixture_source_id'",sqlLiteral(f.source_message_id));assert.ok(proof)
  const boundary=' INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,\n  related_message_id';assert.ok(proof.includes(boundary))
  const malformed=proof.replace(boundary," contrl_wire:='CONTRL synthetic original-only ACK';aperak_wire:='FTX+AAO++213::260 RFF+Z07:735123456789012345';\n"+boundary)
  await assert.rejects(db.exec(malformed),/ediel_wire_reference_source_invalid/);await db.exec('rollback');checks++
  assert.deepEqual(await state(),baseline);checks++
  // The original committed source basis cannot replace a current qualified
  // endpoint. Revoke its actual identifier inside the ACK transaction only.
  const expiredEndpoint=proof.replace('RESET ROLE;','RESET ROLE;\nUPDATE public.tenant_actor_identifiers SET valid_to=clock_timestamp() WHERE company_id='+sqlLiteral(f.company_id)+'::uuid;')
  await assert.rejects(db.exec(expiredEndpoint),/ediel_technical_endpoint_unqualified/);await db.exec('rollback');checks++
  assert.deepEqual(await state(),baseline);checks++
  console.log('Missing/uncommitted syntax basis and historical malformed physical ACK: expected RED reproduced')
  assert.ok(/\nROLLBACK;\nDROP TABLE pg_temp\.gridex_z04_ack_fixture;\s*$/.test(proof))
  await db.exec(proof.replace(/\nROLLBACK;\nDROP TABLE pg_temp\.gridex_z04_ack_fixture;\s*$/,''));checks++
  const {rows}=await db.query('select * from public.ediel_messages order by direction,message_family');assert.equal(rows.length,3)
  const [{validateEdifactSyntax},{canonicalProdat26AFieldRules},{validateFieldMatrixPayload},{projectProdatDiagnostics},fixture]=await Promise.all([
   modules.ssrLoadModule('/lib/ediel/core/syntaxValidator.ts'),modules.ssrLoadModule('/lib/ediel/prodat/prodat26AFieldMatrix.ts'),modules.ssrLoadModule('/lib/ediel/rulebook/fieldMatrix.ts'),modules.ssrLoadModule('/lib/ediel/prodat/prodatDiagnosticProjection.ts'),modules.ssrLoadModule('/__tests__/fixtures/prodat-register.ts')])
  for(const message of rows){assert.equal(validateEdifactSyntax(message).ok,true,message.message_family);checks++}
  const errors=projectProdatDiagnostics(validateFieldMatrixPayload(fixture.input(source.raw_payload),canonicalProdat26AFieldRules('Z04').filter(rule=>rule.fieldNumber==='213'))).applicationErrors
  assert.deepEqual(errors.map(error=>[error.ercCode,error.fieldCode,error.referenceNumber]),[['41','213','735123456789012345']]);checks++
  await db.exec('set local role service_role')
  const persisted=(await db.query('select public.ediel_read_persisted_technical_contrl_basis_v1($1,$2,$3) result',[f.company_id,'test',f.contrl_id])).rows[0].result
  await db.exec('reset role')
  assert.equal(persisted.ackMessage.related_message_id,source.id);assert.equal(persisted.technicalSyntaxAckEvidence.syntaxDecision,'accepted');assert.equal(persisted.technicalSyntaxAckEvidence.kind,'technical_syntax_ack')
  assert.equal(Object.hasOwn(persisted.technicalSyntaxAckEvidence,'rulePackId'),false);checks++
  await db.exec('rollback');assert.deepEqual(await state(),baseline);checks++
  assert.equal((await db.query('select count(*)::int n from gridex_ediel_technical_ack.replies')).rows[0].n,0);checks++
  await db.exec('drop table pg_temp.gridex_z04_ack_fixture')
  console.log(`Focused PostgreSQL exact native two-phase ACK body/current technical owners/physical syntax/own-field213/full-row-retry/atomic collision/rollback checks: ${checks} PASS`)
 }catch(error){console.error(error.message,error.where??'');process.exitCode=1}finally{await modules.close();if(db)await db.close()}
}
