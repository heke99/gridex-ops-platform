import {nativeActorRoleSql} from './ediel-normal-switch-native-fixture'
import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {expect} from 'vitest'
import {closureFixture} from '../../__tests__/helpers/closureWireFixtures'
import {supabaseService} from '@/lib/supabase/service'

// Shared owned-local SQL and seed for the correction-context native suites.
export const literal=(v:unknown)=>"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'"
export function sql<T>(query:string):T{
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_local_only')
 const out=execFileSync('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',timeout:10000,maxBuffer:2_000_000}).trim()
 return out?JSON.parse(out) as T:undefined as T
}
export const raw=()=>closureFixture({reason:'Z24'}).wire
export const project=(wire:string)=>sql<Record<string,unknown>>(`SELECT gridex_received_sources.correction_wire_observation_v1(${literal(wire)});`)
export async function seed(wire=raw()){
 const companyId=randomUUID(),actorUserId=randomUUID(),sourceMessageId=randomUUID()
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.permissions WHERE key='communication.send'`)).toBe(1)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_message_profiles WHERE profile_key='PRODAT:Z05:C:26.A:r3' AND is_enabled`)).toBe(1)
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(companyId)},'Synthetic correction capture','active');
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
 VALUES(${literal(actorUserId)},'authenticated','authenticated',${literal(`${actorUserId}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
 INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(actorUserId)},${literal(`${actorUserId}@example.invalid`)},'Synthetic capture actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
 INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
 VALUES(${literal(companyId)},${literal(actorUserId)},'company_admin','active',now(),'{}','company_admin',true,now(),'company_admin');
 ${nativeActorRoleSql(companyId,actorUserId)}`)
 return seedCorrectionSource({companyId,actorUserId,wire,sourceMessageId})
}

/** The C correction source in an existing tenant; grants the actor the
 * communication permissions the capture requires. */
export async function seedCorrectionSource(input:{companyId:string;actorUserId:string;wire?:string;sourceMessageId?:string}){
 const {companyId,actorUserId}=input,wire=input.wire??raw(),sourceMessageId=input.sourceMessageId??randomUUID()
 sql(`INSERT INTO public.user_roles(user_id,role_id,role,company_id,status,is_active)
 SELECT ${literal(actorUserId)},id,'company_admin',${literal(companyId)},'active',true FROM public.roles WHERE key='company_admin' ON CONFLICT DO NOTHING;
 INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
 SELECT ${literal(actorUserId)},${literal(companyId)},p.id,p.key FROM public.permissions p WHERE p.key IN('communication.send','communication.write','communication.read')
  AND NOT EXISTS(SELECT FROM public.user_permissions u WHERE u.user_id=${literal(actorUserId)} AND u.company_id=${literal(companyId)} AND u.permission_key=p.key);
 -- Pin the actual enabled C registry profile like the retained closure fixture.
 -- Code/date-only inference sees L, LK and C as three Z05 candidates; it cannot
 -- use parsed subtype to choose one. Preserve the real receive/commit clock.
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 SELECT ${literal(sourceMessageId)},${literal(companyId)},'test','inbound','edifact','PRODAT','Z05','received',${literal(wire)},'{"subtype":"C"}',clock_timestamp(),'23-DDQ-PRODAT','12345','54321',pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
 FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id
 WHERE profile.profile_key='PRODAT:Z05:C:26.A:r3' AND profile.is_enabled;`)
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.sources WHERE source_message_id=${literal(sourceMessageId)}`)).toBe(1)
 expect(sql(`SELECT to_jsonb(company_id=${literal(companyId)}::uuid AND environment='test' AND origin='database_insert'
  AND message_code='Z05' AND raw_payload=${literal(wire)} AND payload_hash=encode(sha256(convert_to(raw_payload,'UTF8')),'hex')
  AND received_context @> jsonb_build_object('version',1,'contextOrigin','database_insert','sourceMessageId',source_message_id,
   'companyId',company_id,'environment',environment,'messageCode',message_code,'payloadHash',payload_hash)
  AND (received_context->>'sourceReceivedAt')::timestamptz=source_received_at
  AND isfinite((received_context->>'capturedAt')::timestamptz) AND (received_context->>'capturedAt')::timestamptz<=captured_at)
  FROM gridex_received_sources.sources WHERE source_message_id=${literal(sourceMessageId)}`)).toBe(true)
 const permission=await supabaseService.rpc('gridex_actor_has_company_permission',{p_actor_user_id:actorUserId,p_company_id:companyId,p_permission:'communication.send'})
 expect(permission.error).toBeNull();expect(permission.data).toBe(true)
 expect(sql(`SELECT jsonb_build_object('companyActive',c.is_active,'companyStatus',c.status,'userStatus',u.user_status,'membershipActive',m.is_active,'membershipStatus',m.status) FROM public.companies c JOIN public.company_memberships m ON m.company_id=c.id JOIN public.user_profiles u ON u.id=m.user_id WHERE c.id=${literal(companyId)} AND u.id=${literal(actorUserId)}`))
  .toEqual({companyActive:true,companyStatus:'active',userStatus:'active',membershipActive:true,membershipStatus:'active'})
 return {companyId,actorUserId,sourceMessageId,environment:'test' as const}
}
