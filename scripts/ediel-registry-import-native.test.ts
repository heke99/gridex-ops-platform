import {randomUUID} from 'node:crypto'
import {expect,it} from 'vitest'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {parseActorRegistryTxt} from '@/lib/actor-registry/parseActorRegistryTxt'
import {applyActorRegistryRecords} from '@/lib/actor-registry/importActorRegistry'
import {diffRegistryRecord,readRegistryPreviewSnapshot} from '@/lib/actor-registry/registrySnapshotDiff'
import {supabaseService} from '@/lib/supabase/service'
const header='Market;CompanyName;SvkId;EdielId;Address1;Address2;PostCode;Place;CountryCode;WebSiteAddress;Type PRODAT;SubAddress;CommunicationAddress;InterchangePartyId;PartyId;Type UTILTS;SubAddress;CommunicationAddress;InterchangePartyId;PartyId'
/** Synthetic own registry/custody data and an actual installed platform guard.
 * No private readiness, certificate or external legal issuer is seeded. Import
 * authority is scoped local fixture authorization, not a real portal identity. */
it('actual native TXT apply and preview preserve source kind, route history and revoked platform authority',async()=>{
 const actor=randomUUID()
 sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES(${literal(actor)},'authenticated','authenticated',${literal(actor+'@example.invalid')},now(),'{}','{}',now(),now(),false,false);
 INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(actor)},${literal(actor+'@example.invalid')},'Synthetic registry native actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
 INSERT INTO public.admin_users(user_id,role,is_active) VALUES(${literal(actor)},'platform_admin',true);`)
 const legal=sql<string>(`SELECT to_jsonb(n::text) FROM generate_series(50000,59999) n WHERE NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=n::text) ORDER BY n LIMIT 1;`)
 const text=header+`\nEL;Synthetic native ${actor};SYN;${legal};Synthetic street\nFloor 2;;12345;Town;DK;;PRODAT;;old@example.invalid;${legal};${legal};UTILTS;;old@example.invalid;${legal};${legal}`
 const parsed=parseActorRegistryTxt(text),apply=(source:string)=>applyActorRegistryRecords({sourceBytes:source,sourceKind:'companies_txt',actorUserId:actor,sourceFilename:'synthetic-native.txt',actors:parseActorRegistryTxt(source)})
 const first=await apply(text);expect(first.created).toBe(1);expect(first.activation).toBe('held_pending_current_source_readiness')
 expect((await apply(text)).reusedExistingRun).toBe(true)
 const snapshot=await readRegistryPreviewSnapshot(actor,[legal]);expect(snapshot.actors).toHaveLength(1)
 expect(snapshot.actors[0]).toMatchObject({countryCode:'DK',edielId:legal})
 expect(diffRegistryRecord(parsed[0],snapshot.actors[0])).toEqual([])
 const second=text.replaceAll('old@example.invalid','new@example.invalid');await apply(second)
 const changed=await readRegistryPreviewSnapshot(actor,[legal]);expect(changed.snapshotHash).not.toBe(snapshot.snapshotHash)
 expect(diffRegistryRecord(parseActorRegistryTxt(second)[0],snapshot.actors[0])).toEqual(['routes'])
 expect(sql(`SELECT to_jsonb(bool_and(is_verified=false AND auto_send_allowed=false AND status='needs_review')) FROM public.platform_actor_routes WHERE actor_id=${literal(changed.actors[0].actorId)}`)).toBe(true)
 expect(sql(`SELECT to_jsonb(source_kind) FROM gridex_registry_import.batches WHERE source_sha256=(SELECT source_hash FROM public.actor_registry_import_runs WHERE id=${literal(first.importRunId)})`)).toBe('companies_txt')
 const route=sql<string>(`SELECT to_jsonb(id) FROM public.platform_actor_routes WHERE actor_id=${literal(changed.actors[0].actorId)} AND communication_address='new@example.invalid' AND message_family='PRODAT' LIMIT 1`)
 sql(`UPDATE public.platform_actor_routes SET edi_charset='UNOC' WHERE id=${literal(route)}`)
 expect(sql(`SELECT to_jsonb(count(*)=1 AND bool_and(snapshot->>'communication_address'='new@example.invalid' AND snapshot->>'edi_charset' IS NULL AND snapshot_hash=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'))) FROM gridex_registry_import.route_versions WHERE route_id=${literal(route)}`)).toBe(true)
 sql(`UPDATE public.admin_users SET is_active=false WHERE user_id=${literal(actor)}`)
 await expect(readRegistryPreviewSnapshot(actor,[legal])).rejects.toMatchObject({message:expect.stringContaining('platform_actor')})
 const forbidden=await supabaseService.rpc('ediel_apply_actor_registry_v1',{p_actor_user_id:actor,p_source_base64:Buffer.from(text).toString('base64'),p_source_sha256:'a'.repeat(64),p_source_kind:'companies_txt',p_source_filename:'forbidden.txt',p_records:parsed})
 expect(forbidden.error).not.toBeNull()
},30000)
