// Test-only actual-catalog overlay on the existing owned disposable native
// stack. It never connects to a hosted project. Metadata is an input to an
// actual run, and does not qualify a future result.
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {nativeSql as sql,literal} from './ediel-normal-switch-native-fixture'

type FunctionImage={identity:string;ddl:string;owner:string|null;acl:string|null;bodyMD5:string}
type TriggerImage={name:string;ddl:string;enabled:'O'|'A';function:string;bodyMD5:string}
type Profile={functions:FunctionImage[];triggers:TriggerImage[];candidateSQLSHA256:string;candidateGuardBodyMD5:string}
type ExistingFunction={identity:string;ddl:string;owner:string;acl:string|null}
type Baseline={functions:ExistingFunction[];triggers:{name:string;ddl:string;enabled:'O'|'A'}[]}
const profile=JSON.parse(readFileSync(new URL('./ediel-poa-contract-trigger-profile.native.json',import.meta.url),'utf8')) as Profile
const ident=(v:string)=>'"'+v.replaceAll('"','""')+'"'
const functionNames=[...profile.functions.map(f=>f.identity),'public.gridex_customer_contracts_auto_renew_guard()']
const functionSelector=`p.oid=ANY(ARRAY[${functionNames.map(f=>`to_regprocedure(${literal(f)})::oid`).join(',')}])`
const aclExpression=`(SELECT jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)`
function snapshot():Baseline {
 return sql(`SELECT jsonb_build_object('functions',(SELECT coalesce(jsonb_agg(jsonb_build_object(
  'identity',n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')',
  'ddl',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'effectiveACL',${aclExpression}
 ) ORDER BY n.nspname,p.proname,p.proargtypes),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE ${functionSelector}),
 'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'ddl',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled) ORDER BY t.tgname),'[]'::jsonb) FROM pg_trigger t WHERE t.tgrelid='public.customer_contracts'::regclass AND NOT t.tgisinternal))`)
}
function aclDDL(f:ExistingFunction):string {
 // Revoke only for the function being restored. Current grantees may differ
 // from the saved list; normalize effective grants, not ACL array ordering.
 const grants=sql<{grantee:string;grantable:boolean}[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'grantable',a.is_grantable)),'[]') FROM aclexplode(coalesce(${literal(f.acl)}::aclitem[],acldefault('f',(SELECT oid FROM pg_roles WHERE rolname=${literal(f.owner)})))) a WHERE a.privilege_type='EXECUTE'`)
 const existing=sql<string[]>(`SELECT coalesce(jsonb_agg(DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END),'[]') FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure(${literal(f.identity)})`)
 return `ALTER FUNCTION ${f.identity} OWNER TO ${ident(f.owner)};`+
  [...new Set(['PUBLIC',...existing])].map(r=>`REVOKE ALL ON FUNCTION ${f.identity} FROM ${r==='PUBLIC'?'PUBLIC':ident(r)};`).join('\n')+
  grants.map(g=>`GRANT EXECUTE ON FUNCTION ${f.identity} TO ${g.grantee==='PUBLIC'?'PUBLIC':ident(g.grantee)}${g.grantable?' WITH GRANT OPTION':''};`).join('\n')
}
function triggerDDL(triggers:Baseline['triggers']):string {
 return triggers.map(t=>`${t.ddl};ALTER TABLE public.customer_contracts ${t.enabled==='A'?'ENABLE ALWAYS':'ENABLE'} TRIGGER ${ident(t.name)};`).join('\n')
}
const dropTriggers=(ts:Baseline['triggers'])=>ts.map(t=>`DROP TRIGGER ${ident(t.name)} ON public.customer_contracts;`).join('\n')
export function installPoaContractTriggerProfile() {
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_local_only')
 const migration=readFileSync('supabase/migrations/20261028091248_allow_contract_signature_before_supply_start.sql')
 if(createHash('sha256').update(migration).digest('hex')!==profile.candidateSQLSHA256)throw Error('poa_candidate_source_changed')
 if(profile.triggers.length!==26||profile.triggers.filter(t=>t.enabled==='A').length!==3||profile.functions.some(f=>!f.owner))throw Error('actual_profile_metadata_incomplete')
 const baseline=snapshot()
 const candidateBefore=sql<string>(`SELECT to_jsonb(md5(prosrc)) FROM pg_proc WHERE oid='public.gridex_customer_contracts_auto_renew_guard()'::regprocedure`)
 const oldActual=profile.triggers.find(t=>t.function==='public.gridex_customer_contracts_auto_renew_guard()')!
 if(candidateBefore===oldActual.bodyMD5||candidateBefore!==profile.candidateGuardBodyMD5)throw Error('candidate_guard_not_installed')
 // Atomic overlay; any dependency/ACL/role mismatch rolls back, never softened.
 sql(`BEGIN;SET LOCAL search_path=public,pg_catalog;
 ${profile.functions.map(f=>f.ddl+';').join('\n')}
 ${dropTriggers(baseline.triggers)}
 ${triggerDDL(profile.triggers)}
 COMMIT;`)
 // Apply actual effective ACL/owner after transactional function creation. Any
 // failure is fatal and restore() below is still required by the caller.
 let restored=false
 try {
  for(const f of profile.functions)sql(`BEGIN;${aclDDL({...f,owner:f.owner!})}COMMIT;`)
  const functionReadback=sql<boolean>(`SELECT to_jsonb(count(*)=${profile.functions.length} AND bool_and(coalesce(
   md5(p.prosrc)=f.body_md5 AND pg_get_userbyid(p.proowner)=f.owner
   AND coalesce(p.proacl,acldefault('f',p.proowner)) @> coalesce(f.acl::aclitem[],acldefault('f',p.proowner))
   AND coalesce(p.proacl,acldefault('f',p.proowner)) <@ coalesce(f.acl::aclitem[],acldefault('f',p.proowner)),false)))
   FROM (VALUES ${profile.functions.map(f=>`(${literal(f.identity)},${literal(f.bodyMD5)},${literal(f.owner)},${literal(f.acl)}::text)`).join(',')}) f(identity,body_md5,owner,acl)
   LEFT JOIN pg_proc p ON p.oid=to_regprocedure(f.identity)`)
  if(!functionReadback)throw Error('actual_profile_function_owner_acl_body_mismatch')
  const observed=sql<{name:string;enabled:string;bodyMD5:string}[]>(`SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'bodyMD5',md5(p.prosrc)) ORDER BY t.tgname) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public.customer_contracts'::regclass AND NOT t.tgisinternal`)
  const expected=profile.triggers.map(t=>({name:t.name,enabled:t.enabled,bodyMD5:t.function==='public.gridex_customer_contracts_auto_renew_guard()'?candidateBefore:t.bodyMD5})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)
  if(observed.length!==expected.length||observed.some((t,i)=>t.name!==expected[i].name||t.enabled!==expected[i].enabled||t.bodyMD5!==expected[i].bodyMD5))throw Error('actual_26_trigger_profile_mismatch')
 }catch(error){restore();throw error}
 function restore(){
  const now=snapshot()
  // Retain original baseline until after restoration succeeds; repeated calls
  // are harmless only after exact readback. Never use CASCADE to hide residue.
  sql(`BEGIN;SET LOCAL search_path=public,pg_catalog;${dropTriggers(now.triggers)}
   ${baseline.functions.map(f=>f.ddl+';').join('\n')}
   ${profile.functions.filter(f=>!baseline.functions.some(b=>b.identity===f.identity)).map(f=>`DROP FUNCTION ${f.identity} RESTRICT;`).join('\n')}
   ${triggerDDL(baseline.triggers)}COMMIT;`)
  for(const f of baseline.functions)sql(`BEGIN;${aclDDL(f)}COMMIT;`)
  const after=snapshot()
  // Effective ACL equality rather than textual ACL element order. DDL and
  // trigger mode/body/owner remain exact; no generated files are changed.
  const normalized=(b:Baseline)=>JSON.stringify({...b,functions:b.functions.map(f=>({...f,acl:undefined}))})
  if(normalized(after)!==normalized(baseline))throw Error('poa_profile_restore_mismatch')
  restored=true
 }
 return {restore:()=>{if(!restored)restore()},assertInstalled:()=>{
  if(restored)throw Error('poa_profile_already_restored')
  if(sql<number>(`SELECT to_jsonb(count(*)) FROM pg_trigger WHERE tgrelid='public.customer_contracts'::regclass AND NOT tgisinternal AND tgenabled IN ('O','A')`)!==26)throw Error('actual_profile_changed')
 },candidateGuardMD5:candidateBefore}
}
