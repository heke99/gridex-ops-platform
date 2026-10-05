// Synthetic owned tenant/issuer originals exercise actual installed owners.
// These fixtures establish mechanics, never an external incident or approval.
import {createHash,randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
const smtp=vi.hoisted(()=>({send:vi.fn(),options:vi.fn(),beforeSend:undefined as (()=>void)|undefined}))
vi.mock('nodemailer',()=>({default:{createTransport:(options:unknown)=>{smtp.options(options);return {sendMail:async()=>{smtp.beforeSend?.();return smtp.send()}}}}}))
import {seedNormalSwitchNativeFixture,nativeSql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {supabaseService} from '@/lib/supabase/service'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {getEdielMessageById} from '@/lib/ediel/db'
import {verifyRelayTrace} from '@/lib/ediel/transport/relayTrace'
const sha=(s:string)=>createHash('sha256').update(s).digest('hex')
const rpc=supabaseService.rpc.bind(supabaseService) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
afterEach(()=>{smtp.send.mockReset();smtp.options.mockReset();smtp.beforeSend=undefined;vi.unstubAllEnvs()})
async function seed(){
 vi.stubEnv('EDIEL_SHARED_MAILBOX_ADDRESS','synthetic@example.invalid');vi.stubEnv('EDIEL_APP_DKIM_ENABLED','false')
 vi.stubEnv('EMAIL_PROVIDER','resend');vi.stubEnv('EDIEL_SMTP_FROM','synthetic@example.invalid')
 vi.stubEnv('EDIEL_SMTP_USER','synthetic@example.invalid');vi.stubEnv('EDIEL_SMTP_PASS','synthetic-only')
 vi.stubEnv('EDIEL_EMAIL_PROVIDER','strato')
 const f=await seedNormalSwitchNativeFixture(),reviewer=randomUUID(),m=f.originalZ03
 // Reserve routing explicitly has a current operative TLS policy. The native
 // canonical original, contract and source owner remain the actual producers.
 nativeSql(`UPDATE public.ediel_route_profiles SET is_active=true,tls_required=true WHERE id=${literal(f.routeProfileId)} AND company_id=${literal(f.companyId)};
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
 VALUES(${literal(reviewer)},'authenticated','authenticated',${literal(reviewer+'@example.invalid')},now(),'{}','{}',now(),now(),false,false);
 INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(reviewer)},${literal(reviewer+'@example.invalid')},'Synthetic separate reserve reviewer','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
 INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
 VALUES(${literal(f.companyId)},${literal(reviewer)},'member','active',now(),'{}','member',true,now(),'member');
 INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
 SELECT ${literal(reviewer)},${literal(f.companyId)},id,key FROM public.permissions WHERE key='communication.write';`)
 // TR-08: allRelayHopsVerified must name a verified, persisted read-back trace (synthetic headers only).
 const probe='probe-'+randomUUID(),traceHeaders=['Received: from smtp.own.example.invalid (smtp.own.example.invalid [192.0.2.10]) by mx.example.invalid with ESMTPS id b (version=TLS1_3 cipher=TLS_AES_256_GCM_SHA384); Sun, 4 Oct 2026 12:00:02 +0200',
  'Received: from app.example.invalid ([198.51.100.5]) by smtp.own.example.invalid with ESMTPSA id d (TLSv1.2:ECDHE-RSA-AES256-GCM-SHA384); Sun, 4 Oct 2026 12:00:00 +0200',
  'Authentication-Results: mx.example.invalid; spf=pass','X-Gridex-Relay-Probe: '+probe,''].join('\r\n')
 const trace=verifyRelayTrace({rawHeaders:traceHeaders,probeId:probe,ownHosts:['smtp.own.example.invalid']})
 nativeSql(`SELECT to_jsonb(public.ediel_record_relay_trace_v1(${literal(f.companyId)},'test',${literal(reviewer)},convert_to(${literal(traceHeaders)},'UTF8'),${literal(JSON.stringify(trace))}::jsonb));`)
 const now=Date.now(),from=new Date(now-60000).toISOString(),to=new Date(now+600000).toISOString()
 const source={schema:'gridex_transport_exception_incident_v1',normativeSha256:'5204d4514774b04b8eedb039e1f4799ed447c7fef14554577935e2d7bd93f951',
  companyId:f.companyId,messageId:m.id,environment:'test',originalHash:sha(m.raw_payload!),routeId:m.communication_route_id,
  senderEdielId:m.sender_ediel_id,receiverEdielId:m.receiver_ediel_id,receiverEmail:m.receiver_email,case:'temporary_encryption_failure',
  tls:{required:true,allRelayHopsVerified:true,relayTraceSha256:trace.rawHeadersSha256,certificateVerified:true,minimumVersion:'TLS1.2',originalReference:'synthetic://native-mechanics-tls-only',originalSha256:'a'.repeat(64),validFrom:from,validTo:to},
  counterparty:{receiverEdielId:m.receiver_ediel_id,temporaryReserveConfirmed:true,originalReference:'synthetic://native-mechanics-counterparty-only',originalSha256:'b'.repeat(64),validFrom:from,validTo:to},
  incident:{temporaryOnly:true,failureCode:'cms_encryption_failed',originalSha256:'c'.repeat(64),observedAt:from}}
 const approval={schema:'gridex_transport_exception_approval_v1',sourceDigest:sha(JSON.stringify(source)),companyId:f.companyId,messageId:m.id,case:source.case,
  approved:true,approvedBy:reviewer,approvalReference:'synthetic://native-mechanics-review-only',validFrom:from,validTo:to,maximumAttempts:2}
 const publish=`public.ediel_publish_transport_exception_v1(${literal(f.companyId)},${literal(m.id)},${literal(f.actorUserId)},convert_to(${literal(JSON.stringify(source))},'UTF8'),convert_to(${literal(JSON.stringify(approval))},'UTF8'))`
 return {f,m,reviewer,source,approval,publish}
}
const read=(s:Awaited<ReturnType<typeof seed>>,id:string)=>rpc('ediel_read_transport_exception_v1',{
 p_company_id:s.f.companyId,p_message_id:s.m.id,p_actor_user_id:s.f.actorUserId,p_exception_id:id})
const effects=(s:Awaited<ReturnType<typeof seed>>)=>nativeSql(`SELECT jsonb_build_object(
 'operations',(SELECT count(*) FROM gridex_transport_exception.operations WHERE message_id=${literal(s.m.id)}),
 'alarms',(SELECT count(*) FROM gridex_transport_exception.alarms WHERE message_id=${literal(s.m.id)}),
 'attempts',(SELECT count(*) FROM gridex_ediel_transport.attempts WHERE message_id=${literal(s.m.id)}));`)
// CI's postgres is not a superuser and holds only the creator's ADMIN
// membership (no SET/INHERIT). A SET-capable membership exists only inside
// this transaction and is revoked before commit, so the owner keeps no members.
const asTransportExceptionOwner=(statement:string)=>nativeSql<string>(`BEGIN;GRANT gridex_ediel_transport_exception_owner TO CURRENT_USER WITH SET TRUE;
 SET LOCAL ROLE gridex_ediel_transport_exception_owner;DO $owner$BEGIN PERFORM set_config('gridex.transport_exception_owner_result',coalesce((${statement})::text,''),true);END$owner$;
 RESET ROLE;REVOKE gridex_ediel_transport_exception_owner FROM CURRENT_USER;SELECT to_jsonb(nullif(current_setting('gridex.transport_exception_owner_result'),''));COMMIT;`)
it('native prospective owner stays unseeded and service/foreign/current revoked actors cannot fabricate reserve facts',async()=>{
 const s=await seed(),before=effects(s)
 expect(nativeSql(`SELECT jsonb_build_object('login',rolcanlogin,'members',(SELECT count(*) FROM pg_auth_members WHERE roleid=r.oid AND (inherit_option OR set_option))) FROM pg_roles r WHERE rolname='gridex_ediel_transport_exception_owner';`)).toEqual({login:false,members:0})
 expect(await read(s,randomUUID())).toMatchObject({error:null,data:{status:'held',missing:['transport_exception_approved_source_absent']}})
 expect(()=>nativeSql(`SET ROLE service_role;SELECT to_jsonb(${s.publish});RESET ROLE;`)).toThrow(/permission denied/)
 const foreign=await rpc('ediel_read_transport_exception_v1',{p_company_id:s.f.companyId,p_message_id:s.m.id,p_actor_user_id:randomUUID(),p_exception_id:randomUUID()})
 expect(foreign.error).not.toBeNull();expect(effects(s)).toEqual(before);expect(smtp.send).not.toHaveBeenCalled()
},120000)
it('native actual normal original dispatch binds source/approval and records separate bounded attempt/deviation/alarm once',async()=>{
 const s=await seed()
 const id=asTransportExceptionOwner(`SELECT ${s.publish}`)
 expect(id).toMatch(/^[a-f0-9-]{36}$/)
 smtp.send.mockResolvedValue({accepted:[s.m.receiver_email],rejected:[],messageId:'synthetic-native-reserve-provider',response:'250 synthetic accepted'})
 const result=await sendEdielMessageViaSmtp(s.m,{actorUserId:s.f.actorUserId,temporarySecurityExceptionId:id})
 expect(result.accepted).toEqual([s.m.receiver_email]);expect(smtp.send).toHaveBeenCalledTimes(1)
 expect(smtp.options).toHaveBeenLastCalledWith(expect.objectContaining({requireTLS:true,tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'}}))
 expect(nativeSql(`SELECT jsonb_build_object('events',(SELECT jsonb_agg(e.kind ORDER BY e.captured_at) FROM gridex_transport_exception.events e WHERE e.message_id=${literal(s.m.id)}),
  'alarms',(SELECT count(*) FROM gridex_transport_exception.alarms WHERE message_id=${literal(s.m.id)}),
  'exact',(SELECT bool_and(binding->>'sourceDigest'=${literal(sha(JSON.stringify(s.source)))} AND binding->>'approvalDigest'=${literal(sha(JSON.stringify(s.approval)))}) FROM gridex_transport_exception.operations WHERE message_id=${literal(s.m.id)}));`))
  .toEqual({events:['prepared','entered','observed'],alarms:1,exact:true})
 const revocation={schema:'gridex_transport_exception_revocation_v1',approvalId:id,companyId:s.f.companyId,reasonReference:'synthetic://native-revocation-after-actual-acceptance'}
 asTransportExceptionOwner(`SELECT public.ediel_revoke_transport_exception_v1(${literal(id)},${literal(s.reviewer)},convert_to(${literal(JSON.stringify(revocation))},'UTF8')) IS NULL`)
 const fresh=await getEdielMessageById(s.m.id,{companyId:s.f.companyId})
 expect(fresh).not.toBeNull()
 await expect(sendEdielMessageViaSmtp(fresh!,{actorUserId:s.f.actorUserId,temporarySecurityExceptionId:id})).resolves.toMatchObject({accepted:[s.m.receiver_email]})
 expect(smtp.send).toHaveBeenCalledTimes(1);expect(effects(s)).toEqual({operations:1,alarms:1,attempts:1})
},120000)
it('native current source revocation holds before provider entry without partial transport/deviation/alarm writes',async()=>{
 const s=await seed(),id=asTransportExceptionOwner(`SELECT ${s.publish}`)
 nativeSql(`UPDATE public.user_permissions SET is_active=false WHERE user_id=${literal(s.reviewer)} AND company_id=${literal(s.f.companyId)} AND permission_id IN(SELECT id FROM public.permissions WHERE key='communication.write');`)
 const before=effects(s)
 await expect(sendEdielMessageViaSmtp(s.m,{actorUserId:s.f.actorUserId,temporarySecurityExceptionId:id})).rejects.toMatchObject({message:expect.stringMatching(/transport_exception_current_actor_required/)})
 expect(effects(s)).toEqual(before);expect(smtp.send).not.toHaveBeenCalled()
},120000)
it('native final administrator-alarm write failure rolls back the complete fresh prepare stage before SMTP',async()=>{
 const s=await seed(),id=asTransportExceptionOwner(`SELECT ${s.publish}`)
 const name='native_reserve_alarm_'+randomUUID().replaceAll('-',''),before=effects(s)
 nativeSql(`CREATE FUNCTION gridex_transport_exception.${name}() RETURNS trigger LANGUAGE plpgsql AS $probe$
 BEGIN IF NEW.message_id=${literal(s.m.id)}::uuid THEN RAISE EXCEPTION 'native_reserve_final_alarm_failure';END IF;RETURN NEW;END $probe$;
 CREATE TRIGGER ${name} BEFORE INSERT ON gridex_transport_exception.alarms FOR EACH ROW EXECUTE FUNCTION gridex_transport_exception.${name}();`)
 try{
  await expect(sendEdielMessageViaSmtp(s.m,{actorUserId:s.f.actorUserId,temporarySecurityExceptionId:id})).rejects.toMatchObject({message:expect.stringMatching(/native_reserve_final_alarm_failure/)})
  expect(effects(s)).toEqual(before);expect(smtp.send).not.toHaveBeenCalled()
  expect(nativeSql(`SELECT to_jsonb(count(*)) FROM gridex_transport_exception.events WHERE message_id=${literal(s.m.id)};`)).toBe(0)
 }finally{nativeSql(`DROP TRIGGER ${name} ON gridex_transport_exception.alarms;DROP FUNCTION gridex_transport_exception.${name}();`)}
},120000)
