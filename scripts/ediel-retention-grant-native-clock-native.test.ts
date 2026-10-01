// Mandatory ordinary native proof of the installed retention-only grant clock.
// Actual local GoTrue actors/company memberships and native override rows; no
// private source approval/accepted business/policy/issuer/deletion seeds.
import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {expect,it} from 'vitest'
import {decisionNativeSql as sql,decisionUser,literal} from './helpers/ediel-decision-original-native-fixture'

const keys=['submit','review','purge','source_bytes','customer_fields','original_bytes','mime_bytes',
'artifact_decision_evidence','blob_decision_evidence','record_decision_evidence','process_decision_evidence',
'decision_policy_evidence','billing_source_evidence','invoice_copy_evidence','settlement_copy_evidence',
'finance_decision_evidence'].map(k=>'ediel.retention.'+k)
const permitted=(company:string,actor:string,key:string)=>sql<boolean>(
'SELECT to_jsonb(gridex_ediel_retention.permission_v1('+literal(company)+','+literal(actor)+','+literal(key)+'))')
async function actorFixture(){
 const company=randomUUID()
 sql('INSERT INTO public.companies(id,name,status) VALUES('+literal(company)+",'Synthetic retention native-clock tenant','archived')")
 // Existing helper uses a nonempty genuine grant list. Remove only the own
 // fixture's direct retention grant before testing explicit native overrides.
 const actor=await decisionUser(company,['ediel.retention.review'],randomUUID()+'Aa1!')
 sql('DELETE FROM public.user_permissions WHERE company_id='+literal(company)+' AND user_id='+literal(actor.id)+" AND permission_key='ediel.retention.review'")
 return{company,actor}
}
function nativeSqlProcess(input:string,expectLockMarker=false){
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('retention_clock_owned_local_only')
 const child=spawn('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']})
 let output='',errors='',readyResolve:()=>void=()=>{},readyReject:(e:Error)=>void=()=>{}
 const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject})
 if(!expectLockMarker)readyResolve()
 const readyTimeout=expectLockMarker?setTimeout(()=>{child.kill('SIGTERM');readyReject(Error('retention_native_lock_not_observed'))},8000):undefined
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8')
 child.stdout.on('data',(chunk:string)=>{output+=chunk;if(output.includes('RETENTION_NATIVE_LOCK_HELD')){if(readyTimeout)clearTimeout(readyTimeout);readyResolve()}})
 child.stderr.on('data',(chunk:string)=>{errors+=chunk})
 const done=new Promise<string>((resolve,reject)=>{
  child.on('error',(error:Error)=>{if(readyTimeout)clearTimeout(readyTimeout);if(expectLockMarker)readyReject(error);reject(error)})
  child.on('close',(code:number|null)=>{if(readyTimeout)clearTimeout(readyTimeout);if(code===0)resolve(output.trim());else{const error=Error('retention_native_sql_failed:'+String(code)+':'+errors);if(expectLockMarker)readyReject(error);reject(error)}})
 })
 child.stdin.end(input)
 return{child,ready,done}
}
it('actual installed retention-only function preserves sixteen current keys, private owner/ACL and native clock after current actor locks',()=>{
 const body=sql<{keys:string[];owner:string;securityDefiner:boolean;volatile:string;config:string[];oldOverrideClock:boolean;clockAfterCurrentActor:boolean}>(
 "SELECT jsonb_build_object('keys',ARRAY(SELECT (m)[1] FROM regexp_matches(p.prosrc,'''(ediel\\.retention\\.[^'']+)''','g') m),'owner',p.proowner::regrole::text,'securityDefiner',p.prosecdef,'volatile',p.provolatile,'config',p.proconfig,'oldOverrideClock',position('o.valid_from<=now()' in p.prosrc)>0 OR position('now()<o.valid_to' in p.prosrc)>0,'clockAfterCurrentActor',position('retention_grant_observed_at:=clock_timestamp()' in p.prosrc)>position('public.ediel_retention_lock_auth_actor_v1(actor)' in p.prosrc) AND position('retention_grant_observed_at:=clock_timestamp()' in p.prosrc)<position(' IF NOT EXISTS(SELECT FROM public.permissions WHERE key=wanted AND is_active)' in p.prosrc)) FROM pg_proc p WHERE p.oid='gridex_ediel_retention.permission_v1(uuid,uuid,text)'::regprocedure")
 expect(body.keys).toEqual(keys);expect(body.owner).toBe('gridex_ediel_retention_owner');expect(body.securityDefiner).toBe(true);expect(body.volatile).toBe('v');expect(body.config).toContain('search_path=pg_catalog');expect(body.oldOverrideClock).toBe(false);expect(body.clockAfterCurrentActor).toBe(true)
 const acl=sql<Record<string,boolean>>("SELECT jsonb_build_object('publicUsage',has_schema_privilege('authenticated','gridex_ediel_retention','USAGE'),'appExecute',has_function_privilege('authenticated','gridex_ediel_retention.permission_v1(uuid,uuid,text)','EXECUTE'),'serviceExecute',has_function_privilege('service_role','gridex_ediel_retention.permission_v1(uuid,uuid,text)','EXECUTE'),'anonExecute',has_function_privilege('anon','gridex_ediel_retention.permission_v1(uuid,uuid,text)','EXECUTE'),'authenticatorOwner',pg_has_role('authenticator','gridex_ediel_retention_owner','MEMBER'))")
 expect(Object.values(acl).every(value=>value===false)).toBe(true)
},30000)
it('all sixteen native classes require a current own grant and preserve future/expired/DENY/company boundaries',async()=>{
 const f=await actorFixture()
 expect(sql<number>('SELECT to_jsonb(count(*)) FROM public.permissions WHERE is_active AND key=ANY(ARRAY['+keys.map(literal).join(',')+'])')).toBe(16)
 for(const key of keys){
  expect(permitted(f.company,f.actor.id,key)).toBe(false)
  const id=randomUUID()
  sql('INSERT INTO public.user_permission_overrides(id,user_id,company_id,permission_key,effect,is_active,valid_from,valid_to) VALUES('+literal(id)+','+literal(f.actor.id)+','+literal(f.company)+','+literal(key)+",'allow',true,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour')")
  expect(permitted(f.company,f.actor.id,key)).toBe(true)
  expect(permitted(randomUUID(),f.actor.id,key)).toBe(false)
  sql('UPDATE public.user_permission_overrides SET valid_from=clock_timestamp()+interval \'1 hour\',valid_to=clock_timestamp()+interval \'2 hours\' WHERE id='+literal(id));expect(permitted(f.company,f.actor.id,key)).toBe(false)
  sql('UPDATE public.user_permission_overrides SET valid_from=clock_timestamp()-interval \'2 hours\',valid_to=clock_timestamp()-interval \'1 hour\' WHERE id='+literal(id));expect(permitted(f.company,f.actor.id,key)).toBe(false)
  sql('INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,is_active,status,effect) SELECT '+literal(f.actor.id)+','+literal(f.company)+",id,key,true,'active','allow' FROM public.permissions WHERE key="+literal(key))
  sql('UPDATE public.user_permission_overrides SET effect=\'deny\',valid_from=clock_timestamp()-interval \'1 hour\',valid_to=clock_timestamp()+interval \'1 hour\' WHERE id='+literal(id));expect(permitted(f.company,f.actor.id,key)).toBe(false)
  sql('UPDATE public.user_permission_overrides SET valid_to=clock_timestamp()-interval \'1 second\' WHERE id='+literal(id));expect(permitted(f.company,f.actor.id,key)).toBe(true)
  sql('DELETE FROM public.user_permissions WHERE company_id='+literal(f.company)+' AND user_id='+literal(f.actor.id)+' AND permission_key='+literal(key)+';DELETE FROM public.user_permission_overrides WHERE id='+literal(id))
  expect(permitted(f.company,f.actor.id,key)).toBe(false)
 }
},30000)
it('same native transaction refuses an ALLOW expired during elapsed time while transaction now still predates valid_to',async()=>{
 const f=await actorFixture(),id=randomUUID(),key=keys[1]
 const result=sql<{transactionBeforeExpiry:boolean;nativeAfterExpiry:boolean;permitted:boolean}>(
 'BEGIN;INSERT INTO public.user_permission_overrides(id,user_id,company_id,permission_key,effect,is_active,valid_from,valid_to) VALUES('+literal(id)+','+literal(f.actor.id)+','+literal(f.company)+','+literal(key)+",'allow',true,now()-interval '1 hour',now()+interval '150 milliseconds');SELECT pg_sleep(0.3);SELECT jsonb_build_object('transactionBeforeExpiry',now()<valid_to,'nativeAfterExpiry',clock_timestamp()>=valid_to,'permitted',gridex_ediel_retention.permission_v1("+literal(f.company)+','+literal(f.actor.id)+','+literal(key)+')) FROM public.user_permission_overrides WHERE id='+literal(id)+';ROLLBACK')
 expect(result).toEqual({transactionBeforeExpiry:true,nativeAfterExpiry:true,permitted:false})
 expect(sql<number>('SELECT to_jsonb(count(*)) FROM public.user_permission_overrides WHERE id='+literal(id))).toBe(0)
},30000)
it('a distinct current reviewer class grant is neither borrowed by the actor nor retained past its own expiry',async()=>{
 const f=await actorFixture(),key=keys[3],id=randomUUID()
 const reviewer=await decisionUser(f.company,['ediel.retention.review'],randomUUID()+'Aa1!')
 sql('INSERT INTO public.user_permission_overrides(id,user_id,company_id,permission_key,effect,is_active,valid_from,valid_to) VALUES('+literal(id)+','+literal(reviewer.id)+','+literal(f.company)+','+literal(key)+",'allow',true,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour')")
 expect(permitted(f.company,reviewer.id,key)).toBe(true);expect(permitted(f.company,f.actor.id,key)).toBe(false)
 sql('UPDATE public.user_permission_overrides SET valid_to=clock_timestamp()-interval \'1 second\' WHERE id='+literal(id))
 expect(permitted(f.company,reviewer.id,key)).toBe(false)
},30000)
it('a genuinely blocked current Auth row lock cannot retain an ALLOW past expiry',async()=>{
 const f=await actorFixture(),id=randomUUID(),key=keys[1]
 const holder=nativeSqlProcess('BEGIN;DO $$BEGIN PERFORM id FROM auth.users WHERE id='+literal(f.actor.id)+" FOR UPDATE;END$$;SELECT 'RETENTION_NATIVE_LOCK_HELD';SELECT pg_sleep(3);COMMIT;",true)
 // done is always observed, including a failure before the lock marker.
 const holderDone=holder.done
 void holderDone.catch(()=>undefined)
 try{
  await holder.ready
  sql('INSERT INTO public.user_permission_overrides(id,user_id,company_id,permission_key,effect,is_active,valid_from,valid_to) VALUES('+literal(id)+','+literal(f.actor.id)+','+literal(f.company)+','+literal(key)+",'allow',true,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 second')")
  const waiter=nativeSqlProcess('BEGIN;SET LOCAL lock_timeout=\'6 seconds\';WITH checked AS MATERIALIZED (SELECT gridex_ediel_retention.permission_v1('+literal(f.company)+','+literal(f.actor.id)+','+literal(key)+") permitted) SELECT jsonb_build_object('transactionBeforeExpiry',now()<(SELECT valid_to FROM public.user_permission_overrides WHERE id="+literal(id)+"),'nativeAfterExpiry',clock_timestamp()>=(SELECT valid_to FROM public.user_permission_overrides WHERE id="+literal(id)+"),'permitted',checked.permitted) FROM checked;ROLLBACK;")
  // This process has no lock-marker protocol; observe only its final SQL proof.
  const raw=await waiter.done,proof=JSON.parse(raw) as {transactionBeforeExpiry:boolean;nativeAfterExpiry:boolean;permitted:boolean}
  expect(proof.transactionBeforeExpiry).toBe(true);expect(proof.nativeAfterExpiry).toBe(true);expect(proof.permitted).toBe(false)
  await holderDone
 }finally{
  holder.child.kill('SIGTERM');await holderDone.catch(()=>undefined)
  sql('DELETE FROM public.user_permission_overrides WHERE id='+literal(id))
 }
},30000)
