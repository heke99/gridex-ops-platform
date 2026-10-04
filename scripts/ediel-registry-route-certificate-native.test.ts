import {readFileSync} from 'node:fs'
import {createHash,randomUUID,X509Certificate} from 'node:crypto'
import {expect,it} from 'vitest'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {importActorRegistryXml} from '@/lib/actor-registry/importActorRegistry'
import {readRegistryPreviewSnapshot} from '@/lib/actor-registry/registrySnapshotDiff'
import {materializeCompanyGridOwnerRoute} from '@/lib/ediel/routeMaterializer'

/** Combined installed native import/certificate/route/history consumer probe.
 * Synthetic GoTrue/platform actor and PUBLIC self-signed source certificate;
 * no private readiness/accepted/approved fact or certificate status is seeded.
 * A self-signed source proves DER custody, never real issuer or return-path trust. */
it('actual native exact certificate custody survives an SMTP source change while all new route materialization remains held',async()=>{
 const actor=randomUUID(),company=randomUUID(),grid=randomUUID(),pem=readFileSync(new URL('../__tests__/fixtures/ediel-synthetic-registry-certificate.txt',import.meta.url),'utf8')
 const cert=new X509Certificate(pem),fingerprint=createHash('sha256').update(cert.raw).digest('hex').toUpperCase()
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(company)},'Synthetic native certificate custody','active');
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES(${literal(actor)},'authenticated','authenticated',${literal(actor+'@example.invalid')},now(),'{}','{}',now(),now(),false,false);
 INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(actor)},${literal(actor+'@example.invalid')},'Synthetic native certificate reviewer','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
 INSERT INTO public.admin_users(user_id,role,is_active) VALUES(${literal(actor)},'platform_admin',true);`)
 const legal=sql<string>(`SELECT to_jsonb(n::text) FROM generate_series(90000,99999) n WHERE NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=n::text) ORDER BY n LIMIT 1`)
 const source=(smtp:string,fingerprintValue=fingerprint)=>`<Market Code="EL" Country="SE"><Company><Name>Synthetic native certificate ${actor}</Name><Key Type="EdielId">${legal}</Key><Role>DSO</Role><EDIFACTDetails Type="PRODAT"><PartyId>${legal}</PartyId><InterchangePartyId>${legal}</InterchangePartyId><CommunicationAddress Type="SMTP">${smtp}</CommunicationAddress></EDIFACTDetails><Certificate><PEM><![CDATA[${pem}]]></PEM><Purpose>encryption</Purpose><FingerprintSha256>${fingerprintValue}</FingerprintSha256></Certificate></Company></Market>`
 const apply=async(bytes:string)=>{
  const result=await importActorRegistryXml({xml:bytes,uploadedBy:actor,sourceFilename:'synthetic-certificate-registry.xml'})
  const routeIds=Reflect.get(result,'routeIds'),activation=Reflect.get(result,'activation')
  if(!Array.isArray(routeIds)||routeIds.length!==1||routeIds.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))||activation!=='held_pending_current_source_readiness')throw Error('native_import_checked_route_result_required')
  return{...result,routeIds:routeIds as string[],activation}
 }
 const before=source('old-certificate-scope@example.invalid'),first=await apply(before),snapshot=await readRegistryPreviewSnapshot(actor,[legal])
 expect(first.activation).toBe('held_pending_current_source_readiness');expect(snapshot.actors).toHaveLength(1)
 const marketActor=snapshot.actors[0].actorId
 const certificates=()=>sql<Array<{id:string;fingerprint:string;status:string;pem:string;sourceHash:string|null}>>(`SELECT jsonb_agg(jsonb_build_object('id',id,'fingerprint',fingerprint_sha256,'status',status,'pem',raw_certificate_pem,'sourceHash',metadata->>'sourceSha256')) FROM public.platform_actor_certificates WHERE actor_id=${literal(marketActor)} AND environment='production' AND purpose='encryption'`)
 const originalCert=certificates();expect(originalCert).toHaveLength(1);expect(originalCert[0]).toMatchObject({fingerprint,status:'unknown',pem:pem.trim(),sourceHash:createHash('sha256').update(before).digest('hex')})
 sql(`INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status,platform_market_actor_id) VALUES(${literal(grid)},${literal(company)},'Synthetic native registry grid',${literal(legal)},'production',true,'active',${literal(marketActor)})`)
 const operativeCount=()=>sql(`SELECT jsonb_build_object('communication',(SELECT count(*) FROM public.communication_routes WHERE company_id=${literal(company)}),'profiles',(SELECT count(*) FROM public.ediel_route_profiles WHERE company_id=${literal(company)}),'readiness',(SELECT count(*) FROM gridex_ediel_readiness.evidence WHERE company_id=${literal(company)}))`)
 const initial=operativeCount(),oldRoute=first.routeIds![0]
 expect(await materializeCompanyGridOwnerRoute({companyId:company,gridOwnerId:grid,platformActorRouteId:oldRoute,messageFamily:'PRODAT',environment:'production',actorUserId:actor})).toMatchObject({status:'blocked',reasonCode:'platform_route_not_verified',communicationRouteId:null,edielRouteProfileId:null})
 const changed=source('new-certificate-scope@example.invalid'),second=await apply(changed),current=await readRegistryPreviewSnapshot(actor,[legal])
 expect(current.snapshotHash).not.toBe(snapshot.snapshotHash);expect(second.activation).toBe('held_pending_current_source_readiness');expect(second.routeIds![0]).not.toBe(oldRoute)
 expect(certificates()).toEqual(originalCert)
 for(const id of [oldRoute,second.routeIds![0]])expect(await materializeCompanyGridOwnerRoute({companyId:company,gridOwnerId:grid,platformActorRouteId:id,messageFamily:'PRODAT',environment:'production',actorUserId:actor})).toMatchObject({status:'blocked',reasonCode:'platform_route_not_verified',communicationRouteId:null,edielRouteProfileId:null})
 expect(sql(`SELECT to_jsonb(bool_and(is_verified=false AND auto_send_allowed=false AND status='needs_review')) FROM public.platform_actor_routes WHERE actor_id=${literal(marketActor)}`)).toBe(true)
 const retained=sql<Array<{hash:string;length:number;certPem:string|null}>>(`SELECT jsonb_agg(jsonb_build_object('hash',source_sha256,'length',octet_length(source_bytes),'certPem',NULL) ORDER BY source_sha256) FROM gridex_registry_import.batches WHERE import_run_id IN(${literal(first.importRunId)},${literal(second.importRunId)})`)
 expect(retained).toEqual(expect.arrayContaining([before,changed].map(bytes=>({hash:createHash('sha256').update(bytes).digest('hex'),length:Buffer.byteLength(bytes),certPem:null}))))
 sql(`UPDATE public.platform_actor_routes SET edi_charset='UNOC' WHERE id=${literal(second.routeIds[0])}`)
 expect(sql(`SELECT to_jsonb(count(*)=1 AND bool_and(snapshot->>'communication_address'='new-certificate-scope@example.invalid' AND snapshot->>'edi_charset' IS NULL AND snapshot_hash=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'))) FROM gridex_registry_import.route_versions WHERE route_id=${literal(second.routeIds[0])}`)).toBe(true)
 expect(operativeCount()).toEqual(initial)
 await expect(apply(source('forged@example.invalid','A'.repeat(64)))).rejects.toThrow('source_fingerprint_mismatch');expect(operativeCount()).toEqual(initial);expect(certificates()).toEqual(originalCert)
 sql(`UPDATE public.admin_users SET is_active=false WHERE user_id=${literal(actor)}`)
 await expect(readRegistryPreviewSnapshot(actor,[legal])).rejects.toMatchObject({message:expect.stringContaining('platform_actor')})
 console.log(JSON.stringify({kind:'native_registry_certificate_source_scope',observedAt:new Date().toISOString(),company,sourceHashes:retained.map(row=>row.hash),certificateDerSha256:fingerprint,certificateTrust:'unknown',routeTargets:'synthetic changed addresses remain held',actualIssuerProven:false,returnPathProven:false,productionReadinessProven:false}))
},30000)
