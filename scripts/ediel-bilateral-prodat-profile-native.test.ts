import {randomUUID} from 'node:crypto'
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {archiveBilateralProdatGround,reviewBilateralProdatGround,readBilateralProdatGroundBytes} from '@/lib/ediel/production/bilateralProdatProfileIntake'
/** Real disposable contract/signature/PDF/POA and current role owners. The
 * trusted issuer configuration is explicitly synthetic: these assertions grant
 * no real legal-ground, bilateral or Ediel acceptance approval. Private archives,
 * reviews, grounds and origin receipts are always minted by their actual RPC. */

import {createBilateralProdatGroundNativeFixture as fixture} from './helpers/ediel-bilateral-prodat-profile-native-fixture'
const review=(f:Awaited<ReturnType<typeof fixture>>,artifact:Record<string,unknown>)=>({companyId:f.companyId,actorUserId:f.reviewer,artifactId:String(artifact.artifactId),sourceHash:String(artifact.sourceHash),scopeHash:String(artifact.scopeHash),decision:'approve' as const,reason:'Separate qualified synthetic test original review'})
it('real native archive/review/profile producer requires actual issuer proof, separate grants and exact immutable current scope',async()=>{
 const f=await fixture(),unsigned=await archiveBilateralProdatGround({companyId:f.companyId,actorUserId:f.actorUserId,...f.submission}),beforeSwitch=sql(`SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE id=${literal(f.switchId)}`)
 expect((await reviewBilateralProdatGround(review(f,unsigned))).status).toBe('held')
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_bilateral_prodat.profile_versions WHERE company_id=${literal(f.companyId)}`)).toBe(0)
 const archived=await archiveBilateralProdatGround({companyId:f.companyId,actorUserId:f.actorUserId,...f.signed()}),authorized=await reviewBilateralProdatGround(review(f,archived));expect(authorized.status).toBe('authorized')
 expect(sql(`SELECT jsonb_build_object('grounds',(SELECT count(*) FROM gridex_bilateral_prodat.profile_versions WHERE company_id=${literal(f.companyId)}),'origins',(SELECT count(*) FROM gridex_bilateral_prodat.origins WHERE company_id=${literal(f.companyId)}),'current',gridex_bilateral_prodat.ground_current_v1(${literal(authorized.profileVersionId)},${literal(f.companyId)},now()))`)).toEqual({grounds:1,origins:1,current:true})
 expect(Buffer.from((await readBilateralProdatGroundBytes({companyId:f.companyId,actorUserId:f.actorUserId,artifactId:String(archived.artifactId)})).bytes)).toEqual(f.bytes)
 expect((await reviewBilateralProdatGround(review(f,archived))).profileVersionId).toBe(authorized.profileVersionId)
 await expect(readBilateralProdatGroundBytes({companyId:randomUUID(),actorUserId:f.actorUserId,artifactId:String(archived.artifactId)})).rejects.toThrow()
 sql(`UPDATE public.user_permissions SET effect='deny' WHERE user_id=${literal(f.reviewer)} AND company_id=${literal(f.companyId)} AND permission_key='ediel.bilateral_profile.review';`)
 expect(sql(`SELECT to_jsonb(gridex_bilateral_prodat.ground_current_v1(${literal(authorized.profileVersionId)},${literal(f.companyId)},now()))`)).toBe(false)
 expect(sql(`SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE id=${literal(f.switchId)}`)).toEqual(beforeSwitch)
 expect(sql(`SELECT jsonb_build_object('periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}),'sourceTransitions',(SELECT count(*) FROM gridex_received_sources.supply_source_transitions WHERE company_id=${literal(f.companyId)}))`)).toEqual({periods:0,sourceTransitions:0})
},120000)
it('actual final immutable origin insert failure rolls back separate review and ground atomically',async()=>{
 const f=await fixture(),artifact=await archiveBilateralProdatGround({companyId:f.companyId,actorUserId:f.actorUserId,...f.signed()}),constraint=`bilateral_origin_rollback_${randomUUID().replaceAll('-','')}`
 const counts=()=>sql(`SELECT jsonb_build_object('reviews',(SELECT count(*) FROM gridex_bilateral_prodat.reviews WHERE company_id=${literal(f.companyId)}),'grounds',(SELECT count(*) FROM gridex_bilateral_prodat.profile_versions WHERE company_id=${literal(f.companyId)}),'origins',(SELECT count(*) FROM gridex_bilateral_prodat.origins WHERE company_id=${literal(f.companyId)}))`),before=counts()
 sql(`ALTER TABLE gridex_bilateral_prodat.origins ADD CONSTRAINT ${constraint} CHECK(company_id<>${literal(f.companyId)}::uuid) NOT VALID`)
 try{await expect(reviewBilateralProdatGround(review(f,artifact))).rejects.toThrow();expect(counts()).toEqual(before)}finally{sql(`ALTER TABLE gridex_bilateral_prodat.origins DROP CONSTRAINT ${constraint}`)}
},120000)
it('private original/issuer/ground custody cannot be forged by application roles',()=>{
 for(const role of ['anon','authenticated','service_role'])for(const table of ['source_capability_receipts','profile_versions','artifacts','reviews','origins','issuer_keys','issuer_representations','issuer_revocations'])expect(sql(`SELECT to_jsonb(has_table_privilege(${literal(role)},${literal(`gridex_bilateral_prodat.${table}`)},'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))`)).toBe(false)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE p.key='ediel.bilateral_profile.review'`)).toBe(0)
})


it('concurrent actual reviewer-grant revocation serializes before source/market locks and returns held without a new profile or review',async()=>{
 const f=await fixture(),artifact=await archiveBilateralProdatGround({companyId:f.companyId,actorUserId:f.actorUserId,...f.signed()}),application=`bilateral_review_race_${randomUUID()}`
 const counts=()=>sql(`SELECT jsonb_build_object('reviews',(SELECT count(*) FROM gridex_bilateral_prodat.reviews WHERE company_id=${literal(f.companyId)}),'profiles',(SELECT count(*) FROM gridex_bilateral_prodat.profile_versions WHERE company_id=${literal(f.companyId)}),'origins',(SELECT count(*) FROM gridex_bilateral_prodat.origins WHERE company_id=${literal(f.companyId)}),'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}))`),before=counts()
 sql(`DELETE FROM public.user_roles WHERE user_id=${literal(f.reviewer)}`)
 const db='postgresql://postgres:postgres@127.0.0.1:54322/postgres',writer=spawn('psql',[db,'-XAtq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']})
 let output='',errors='';writer.stdout.on('data',chunk=>{output+=String(chunk)});writer.stderr.on('data',chunk=>{errors+=String(chunk)})
 const done=new Promise<void>((resolve,reject)=>{writer.on('error',reject);writer.on('close',code=>code===0?resolve():reject(Error(errors||`writer exited ${code}`)))})
 let worker:Promise<{stdout:string;stderr:string}>|undefined
 try{
  writer.stdin.write(`BEGIN;UPDATE public.user_permissions SET effect='deny' WHERE user_id=${literal(f.reviewer)} AND company_id=${literal(f.companyId)} AND permission_key='ediel.bilateral_profile.review';SELECT 'REVIEW_GRANT_LOCKED';\n`)
  for(let i=0;i<250&&!output.includes('REVIEW_GRANT_LOCKED');i++)await new Promise(resolve=>setTimeout(resolve,20))
  expect(output,errors).toContain('REVIEW_GRANT_LOCKED')
  const command=review(f,artifact)
  worker=promisify(execFile)('psql',[db,'-XAtq','-v','ON_ERROR_STOP=1','-c',`SET ROLE service_role;SELECT public.ediel_review_bilateral_prodat_ground_v1(${literal(f.companyId)},${literal(f.reviewer)},${literal(artifact.artifactId)},${literal({sourceHash:command.sourceHash,scopeHash:command.scopeHash,decision:command.decision,reason:command.reason})}::jsonb);`],{encoding:'utf8',env:{...process.env,PGAPPNAME:application},timeout:15000})
  worker.catch(()=>undefined)
  let blocked=false
  for(let i=0;i<250&&!blocked;i++){
   blocked=sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name=${literal(application)} AND l.relation='public.user_permissions'::regclass AND l.mode='ShareLock' AND NOT l.granted))`)
   if(!blocked)await new Promise(resolve=>setTimeout(resolve,20))
  }
  expect(blocked).toBe(true)
  expect(sql(`SELECT to_jsonb(NOT EXISTS(SELECT FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name=${literal(application)} AND l.relation IN('public.ediel_messages'::regclass,'public.customer_supply_periods'::regclass)))`)).toBe(true)
  expect(counts()).toEqual(before);writer.stdin.end('COMMIT;\n');await done
  await expect(worker).rejects.toThrow(/bilateral_prodat_review_actor_forbidden/)
  expect(counts()).toEqual(before)
 }finally{if(!writer.stdin.destroyed)writer.stdin.end('ROLLBACK;\n');await done.catch(()=>undefined);if(worker)await worker.catch(()=>undefined)}
},120000)
