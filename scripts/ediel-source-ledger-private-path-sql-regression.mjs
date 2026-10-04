// Actual clean-replay bodies; synthetic dependencies and conditional public
// CREATE only. This is bounded SQL, not native market approval or exploit reach.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const audit='../quality/audits/ediel-masterplan-v2/integration-20261001/source-ledger-private-alias-restored/'
const specs=[
 ['activate_supply_before_source_guard_v1','uuid,uuid,uuid,date,uuid,text','b7fa3112e3dc01935574d40783b6bc0ea55c7919fad97aad46bb5dc71c46162b'],
 ['gridex_apply_exact_z02_core_before_current_source_v1','uuid,uuid,uuid,uuid,uuid,uuid,uuid','f4fcc0c6746d6f54629e00daced7a2551f934c8dc03de748d330d1cdefbe496a']
]
const forward=readFileSync(new URL('../supabase/migrations/20261001061731_ediel_private_source_alias_catalog_path.sql',import.meta.url),'utf8')
const checks=[],check=(name,a,b)=>{assert.deepEqual(a,b,name);checks.push(name)}
const identity=s=>'gridex_received_sources.'+s[0]+'('+s[1]+')'
const catalog=async s=>(await db.query('SELECT to_jsonb(p) catalog FROM pg_proc p WHERE p.oid=$1::regprocedure',[identity(s)])).rows[0].catalog
const z02='SELECT gridex_received_sources.gridex_apply_exact_z02_core_before_current_source_v1(NULL,NULL,NULL,NULL,NULL,NULL,NULL) result'
try{
 await db.exec(readFileSync(new URL('./fixtures/ediel-z02-core-embedded-schema.sql',import.meta.url),'utf8'))
 await db.exec('CREATE ROLE bounded_source_owner NOLOGIN NOINHERIT BYPASSRLS;CREATE TABLE public.supplier_switch_requests(id uuid);CREATE TABLE public.customer_application_workflows(id uuid);CREATE TABLE gridex_received_sources.z02_core_applications(id uuid);GRANT USAGE ON SCHEMA public,gridex_received_sources,gridex_ediel_transport TO bounded_source_owner;GRANT SELECT,UPDATE ON ALL TABLES IN SCHEMA public,gridex_received_sources,gridex_ediel_transport TO bounded_source_owner;')
 for(const s of specs){
  const ddl=readFileSync(new URL(audit+s[0]+'.sql',import.meta.url),'utf8'),body=ddl.slice(ddl.indexOf('AS $$')+5,ddl.lastIndexOf('$$;'))
  check(s[0]+'/actual-clean-body-hash',createHash('sha256').update(body).digest('hex'),s[2])
  await db.exec(ddl);await db.exec('ALTER FUNCTION '+identity(s)+' OWNER TO bounded_source_owner;REVOKE ALL ON FUNCTION '+identity(s)+' FROM PUBLIC,anon,authenticated,service_role;ALTER FUNCTION '+identity(s)+" SET lock_timeout='900ms'")
 }
 const before=await Promise.all(specs.map(catalog))
 for(let i=0;i<specs.length;i++){
  check(specs[i][0]+'/actual-legacy-path',before[i].proconfig.filter(c=>c.startsWith('search_path=')),[i===0?'search_path=public':'search_path=pg_catalog, public'])
  check(specs[i][0]+'/definer',before[i].prosecdef,true)
  for(const role of ['anon','authenticated','service_role'])check(specs[i][0]+'/'+role+'/closed-before',(await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') permitted',[role,identity(specs[i])])).rows[0].permitted,false)
 }
 // The exact native Z02 first refusal uses variadic jsonb_build_object. An
 // untrusted public CREATE holder could shadow it with a closer signature.
 // No actual application/schema CREATE grant is inferred by this probe.
 await db.exec('CREATE FUNCTION public.jsonb_build_object(text,boolean,text,text) RETURNS jsonb LANGUAGE sql AS $$SELECT \'{"conditional_public_shadow":true}\'::jsonb$$;GRANT EXECUTE ON FUNCTION public.jsonb_build_object(text,boolean,text,text) TO bounded_source_owner;')
 check('RED old public resolver executes conditional closer overload',(await db.query(z02)).rows[0].result,{conditional_public_shadow:true})
 await db.exec(forward)
 const after=await Promise.all(specs.map(catalog))
 for(let i=0;i<specs.length;i++){
  const {proconfig:oldConfig,...oldMetadata}=before[i],{proconfig:newConfig,...newMetadata}=after[i]
  check(specs[i][0]+'/all-other-pg-proc-preserved',newMetadata,oldMetadata)
  check(specs[i][0]+'/path-only-at-original-position',newConfig,oldConfig.map(c=>c.startsWith('search_path=')?'search_path=pg_catalog':c))
  check(specs[i][0]+'/nonempty-other-config',newConfig.includes('lock_timeout=900ms'),true)
  for(const role of ['anon','authenticated','service_role']){
   check(specs[i][0]+'/'+role+'/closed-after',(await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') permitted',[role,identity(specs[i])])).rows[0].permitted,false)
   await db.exec('SET ROLE '+role);await assert.rejects(()=>db.query('SELECT '+identity(specs[i]).replace('('+specs[i][1]+')','('+specs[i][1].split(',').map(()=> 'NULL').join(',')+')')),/permission denied/);await db.exec('RESET ROLE');checks.push(specs[i][0]+'/'+role+'/actual-call-denied')
  }
 }
 check('GREEN native Z02 refusal ignores closer public overload',(await db.query(z02)).rows[0].result,{ok:false,code:'z02_request_site_customer_mismatch'})
 await assert.rejects(()=>db.query('SELECT gridex_received_sources.activate_supply_before_source_guard_v1(NULL,NULL,NULL,NULL,NULL,NULL)'),/supply_activation_company_required/);checks.push('activation-original-first-refusal-preserved')
 await db.exec(forward);check('idempotent second forward retains exact catalog',await Promise.all(specs.map(catalog)),after)
 // Hash drift is rejected before ALTER and the transaction rollback restores
 // the whole pair. Never accept a neighbouring or changed historical body.
 await db.exec('BEGIN');const definition=(await db.query('SELECT pg_get_functiondef($1::regprocedure) definition',[identity(specs[1])])).rows[0].definition;await db.exec(definition.replace(after[1].prosrc,after[1].prosrc+'\n-- Deliberate bounded hash drift\n'))
 const drifted=await Promise.all(specs.map(catalog));await assert.rejects(()=>db.exec(forward),/private_source_alias_body_review_required/);await db.exec('ROLLBACK');check('hash-drift-rollback-exact-pair',await Promise.all(specs.map(catalog)),after);checks.push('hash-drift-refused-with-no-catalog-partial-effect');assert.notDeepEqual(drifted,after)
 console.log(JSON.stringify({status:'PASS',checks:checks.length,names:checks,evidenceKind:'BOUNDED_ACTUAL_BODY_SYNTHETIC_DEPENDENCIES',native:false,wholeCriterionApproved:false},null,2))
}finally{await db.close()}
