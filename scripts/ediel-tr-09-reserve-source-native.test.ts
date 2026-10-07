// masterplan: TR-09, AT-TR-09
// Native owner/send mechanics over owned synthetic tenants. X.500 results,
// relay policy, counterparty approval and certificate issuer/register are
// explicit synthetic inputs, never authentic market or all-hop TLS evidence.
import {execFileSync,spawnSync} from 'node:child_process'
import {createHash,randomUUID,X509Certificate} from 'node:crypto'
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll,afterEach,beforeAll,expect,it,vi} from 'vitest'
const smtp=vi.hoisted(()=>({send:vi.fn(),options:vi.fn()}))
vi.mock('nodemailer',()=>({default:{createTransport:(options:unknown)=>{smtp.options(options);return {sendMail:smtp.send}}}}))
import {seedNormalSwitchNativeFixture,nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {supabaseService} from '@/lib/supabase/service'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {resolveOutboundRecipientCertificate} from '@/lib/ediel/security/outboundRecipientCertificate'

const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex')
const rpc=supabaseService.rpc.bind(supabaseService) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
let directory:string,leafPem:string,anchor:string,expiredCrl:string,revokedCrl:string
const cdps=['https://synthetic.example.invalid/first.crl','https://synthetic.example.invalid/second.crl']
const recipientMailbox='recipient@example.invalid'
const openssl=(args:string[])=>execFileSync('openssl',args,{cwd:directory,encoding:'utf8',timeout:10000,maxBuffer:65536,stdio:['ignore','pipe','pipe']})
const crlVerification=(file:string)=>{
 const result=spawnSync('openssl',['crl','-in',file,'-noout','-verify','-CAfile','ca.pem'],{
  cwd:directory,encoding:'utf8',timeout:10000,maxBuffer:65536,stdio:['ignore','pipe','pipe']})
 expect(result.error).toBeUndefined();expect(result.signal).toBeNull()
 expect([0,1]).toContain(result.status)
 return result
}
beforeAll(()=>{
 directory=mkdtempSync(join(tmpdir(),'ediel-tr09-native-pki-'))
 try{
  console.info('TR09 owned fixture OpenSSL:',openssl(['version']).trim())
  writeFileSync(join(directory,'index.txt'),'');writeFileSync(join(directory,'serial'),'1000\n');writeFileSync(join(directory,'crlnumber'),'1000\n')
  writeFileSync(join(directory,'ca.cnf'),[
   '[ca]','default_ca=synthetic','[synthetic]',`dir=${directory}`,'database=$dir/index.txt','new_certs_dir=$dir','serial=$dir/serial','crlnumber=$dir/crlnumber',
   'certificate=$dir/ca.pem','private_key=$dir/ca.key','default_days=365','default_crl_days=1','default_md=sha256','policy=policy','x509_extensions=recipient',
   '[policy]','commonName=supplied','[recipient]','basicConstraints=critical,CA:FALSE','keyUsage=critical,digitalSignature,keyEncipherment',
   'extendedKeyUsage=emailProtection',`subjectAltName=email:${recipientMailbox}`,`crlDistributionPoints=${cdps.map(value=>'URI:'+value).join(',')}`,''
  ].join('\n'))
  openssl(['req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.pem','-days','365','-subj','/CN=SYNTHETIC TR09 native CA',
   '-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign'])
  openssl(['req','-new','-newkey','rsa:2048','-nodes','-keyout','leaf.key','-out','leaf.csr','-subj','/CN=SYNTHETIC TR09 recipient'])
  openssl(['ca','-config','ca.cnf','-batch','-in','leaf.csr','-out','leaf.pem'])
  const date=(time:number)=>new Date(time).toISOString().replace(/[-:T]/g,'').replace(/\.\d{3}Z$/,'Z')
  const previous=['-crl_lastupdate',date(Date.now()-2*86400000),'-crl_nextupdate',date(Date.now()-86400000)]
  openssl(['ca','-config','ca.cnf','-gencrl',...previous,'-out','previous.crl'])
  openssl(['ca','-config','ca.cnf','-revoke','leaf.pem'])
  openssl(['ca','-config','ca.cnf','-gencrl',...previous,'-out','revoked.crl'])
  leafPem=readFileSync(join(directory,'leaf.pem'),'utf8');anchor=readFileSync(join(directory,'ca.pem'),'utf8')
  expiredCrl=readFileSync(join(directory,'previous.crl'),'utf8');revokedCrl=readFileSync(join(directory,'revoked.crl'),'utf8')
 }catch(error){rmSync(directory,{recursive:true,force:true});throw error}
})
afterAll(()=>{if(directory)rmSync(directory,{recursive:true,force:true})})
afterEach(()=>{vi.restoreAllMocks();smtp.send.mockReset();smtp.options.mockReset();vi.unstubAllEnvs()})

// ADMIN membership in CI does not permit SET ROLE. Grant SET only inside this
// owned transaction and revoke before commit; no owner keeps a member or ACL.
const asOwner=(role:'gridex_ediel_transport_exception_owner'|'gridex_ediel_certificate_authority_owner',statement:string)=>sql<string>(`BEGIN;
 GRANT ${role} TO CURRENT_USER WITH SET TRUE;SET LOCAL ROLE ${role};
 DO $owner$BEGIN PERFORM set_config('gridex.tr09_native_result',coalesce((${statement})::text,''),true);END$owner$;
 RESET ROLE;REVOKE ${role} FROM CURRENT_USER;
 SELECT to_jsonb(nullif(current_setting('gridex.tr09_native_result'),''));COMMIT;`)
async function seed(){
 vi.stubEnv('EDIEL_SHARED_MAILBOX_ADDRESS','synthetic@example.invalid');vi.stubEnv('EDIEL_APP_DKIM_ENABLED','false')
 vi.stubEnv('EMAIL_PROVIDER','resend');vi.stubEnv('EDIEL_EMAIL_PROVIDER','strato');vi.stubEnv('EDIEL_SMTP_FROM','synthetic@example.invalid')
 vi.stubEnv('EDIEL_SMTP_USER','synthetic@example.invalid');vi.stubEnv('EDIEL_SMTP_PASS','synthetic-only')
 const f=await seedNormalSwitchNativeFixture(),m=f.originalZ03,reviewer=randomUUID()
 sql(`UPDATE public.ediel_route_profiles SET is_active=true,tls_required=true,transport_security_mode='required_encrypted',encryption_mode='smime'
  WHERE id=${literal(f.routeProfileId)} AND company_id=${literal(f.companyId)};
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
 VALUES(${literal(reviewer)},'authenticated','authenticated',${literal(reviewer+'@example.invalid')},now(),'{}','{}',now(),now(),false,false);
 INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(reviewer)},${literal(reviewer+'@example.invalid')},'Synthetic TR09 reviewer','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
 INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
 VALUES(${literal(f.companyId)},${literal(reviewer)},'member','active',now(),'{}','member',true,now(),'member');
 INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
 SELECT ${literal(reviewer)},${literal(f.companyId)},id,key FROM public.permissions WHERE key='communication.write';`)
 const from=new Date(Date.now()-60000).toISOString(),to=new Date(Date.now()+600000).toISOString()
 const source={schema:'gridex_transport_exception_incident_v1',normativeSha256:'5204d4514774b04b8eedb039e1f4799ed447c7fef14554577935e2d7bd93f951',
  companyId:f.companyId,messageId:m.id,environment:'test',originalHash:sha(m.raw_payload!),routeId:m.communication_route_id,
  senderEdielId:m.sender_ediel_id,receiverEdielId:m.receiver_ediel_id,receiverEmail:m.receiver_email,case:'recipient_certificate_unavailable',
  tls:{required:true,allRelayHopsVerified:true,certificateVerified:true,minimumVersion:'TLS1.2',originalReference:'synthetic://tr09-relay-policy-only',originalSha256:'a'.repeat(64),validFrom:from,validTo:to},
  counterparty:{receiverEdielId:m.receiver_ediel_id,temporaryReserveConfirmed:true,originalReference:'synthetic://tr09-counterparty-only',originalSha256:'b'.repeat(64),validFrom:from,validTo:to},
  incident:{directorySearchCompleted:true,resultCount:0,originalSha256:'c'.repeat(64),observedAt:from}}
 const approval={schema:'gridex_transport_exception_approval_v1',sourceDigest:sha(JSON.stringify(source)),companyId:f.companyId,messageId:m.id,case:source.case,
  approved:true,approvedBy:reviewer,approvalReference:'synthetic://tr09-separate-reviewer',validFrom:from,validTo:to,maximumAttempts:2}
 return {f,m,reviewer,source,approval}
}
type Seed=Omit<Awaited<ReturnType<typeof seed>>,'source'|'approval'> & {source:{case:string};approval:object}
const publish=(s:Seed,source:object=s.source,approval:object={...s.approval,case:Reflect.get(source,'case'),sourceDigest:sha(JSON.stringify(source))})=>
 asOwner('gridex_ediel_transport_exception_owner',`SELECT public.ediel_publish_transport_exception_v1(${literal(s.f.companyId)},${literal(s.m.id)},${literal(s.f.actorUserId)},
 convert_to(${literal(JSON.stringify(source))},'UTF8'),convert_to(${literal(JSON.stringify(approval))},'UTF8'))`)
const effects=(s:Seed)=>sql<{approvals:number;operations:number;alarms:number;attempts:number;entries:number}>(`SELECT jsonb_build_object(
 'approvals',(SELECT count(*) FROM gridex_transport_exception.approvals WHERE message_id=${literal(s.m.id)}),
 'operations',(SELECT count(*) FROM gridex_transport_exception.operations WHERE message_id=${literal(s.m.id)}),
 'alarms',(SELECT count(*) FROM gridex_transport_exception.alarms WHERE message_id=${literal(s.m.id)}),
 'attempts',(SELECT count(*) FROM gridex_ediel_transport.attempts WHERE message_id=${literal(s.m.id)}),
 'entries',(SELECT count(*) FROM gridex_ediel_transport.attempts WHERE message_id=${literal(s.m.id)} AND entered_at IS NOT NULL));`)
type Original={raw:string;hash:string;rendered:string;archives:Array<Record<string,unknown>&{id:string}>}
const original=(s:Seed)=>{
 const value=sql<Original>(`SELECT jsonb_build_object('raw',m.raw_payload,'hash',m.immutable_payload_hash,'rendered',m.immutable_rendered_at,
 'archives',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.ediel_message_payloads p
 WHERE p.ediel_message_id=m.id AND p.company_id=m.company_id)) FROM public.ediel_messages m
 WHERE m.id=${literal(s.m.id)} AND m.company_id=${literal(s.f.companyId)}`)
 expect(value).toMatchObject({raw:s.m.raw_payload,hash:sha(s.m.raw_payload!)})
 expect(value.rendered).not.toBeNull()
 return value
}
const originalUnchanged=(s:Seed,before:Original)=>{
 const after=original(s)
 expect({raw:after.raw,hash:after.hash,rendered:after.rendered}).toEqual({raw:before.raw,hash:before.hash,rendered:before.rendered})
 // The actual send owner archives fresh MIME before provider entry. Every old
 // archived row stays identical; additional pre-send archives are permitted.
 for(const retained of before.archives)expect(after.archives.find(row=>row.id===retained.id)).toEqual(retained)
}
const exactSourceCustody=(s:Seed,id:string)=>sql(`SELECT to_jsonb(source_original=convert_to(${literal(JSON.stringify(s.source))},'UTF8')
 AND approval_original=convert_to(${literal(JSON.stringify(s.approval))},'UTF8')
 AND source_digest=encode(sha256(source_original),'hex') AND approval_digest=encode(sha256(approval_original),'hex')
 AND source_facts=convert_from(source_original,'UTF8')::jsonb AND approval_facts=convert_from(approval_original,'UTF8')::jsonb
 AND company_id=${literal(s.f.companyId)}::uuid AND message_id=${literal(s.m.id)}::uuid AND environment='test'
 AND kind=${literal(s.source.case)} AND maximum_attempts=2 AND valid_to>valid_from AND valid_to<=valid_from+interval '24 hours')
 FROM gridex_transport_exception.approvals WHERE id=${literal(id)}`)
const journal=(s:Seed)=>sql(`SELECT jsonb_build_object(
 'events',(SELECT jsonb_agg(kind ORDER BY captured_at) FROM gridex_transport_exception.events WHERE message_id=${literal(s.m.id)}),
 'exact',(SELECT bool_and(binding->>'sourceDigest'=${literal(sha(JSON.stringify(s.source)))} AND binding->>'approvalDigest'=${literal(sha(JSON.stringify(s.approval)))}) FROM gridex_transport_exception.operations WHERE message_id=${literal(s.m.id)}),
 'alarm',(SELECT bool_and(responsible_user_id=${literal(s.reviewer)}::uuid AND facts->>'mandatoryTls'='true' AND facts->>'administratorAlarm'='true' AND facts->>'case'=${literal(s.source.case)}) FROM gridex_transport_exception.alarms WHERE message_id=${literal(s.m.id)}));`)
// Read-only full-row multisets retain cardinality without exposing payloads.
// Reservation/revocation scope comes from their actual message/approval keys.
const rowHashes=(table:string,where:string)=>`(SELECT jsonb_build_object('count',count(*),'rows',
 coalesce(jsonb_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') ORDER BY to_jsonb(t)::text),'[]'::jsonb)) FROM ${table} t WHERE ${where})`
const transportTables=['gridex_ediel_transport.attempts','gridex_transport_exception.approvals',
 'gridex_transport_exception.operations','gridex_transport_exception.events','gridex_transport_exception.alarms']
const scopeTables=[...transportTables,'public.ediel_messages','public.ediel_message_events','public.ediel_message_payloads',
 'public.ediel_outbox','public.ediel_message_intents','public.supplier_switch_requests','public.customer_supply_periods',
 'public.customers','public.customer_sites','public.customer_contracts','public.metering_points','public.outbound_requests',
 'public.grid_owner_data_requests','public.customer_info_requests','public.ediel_business_expectations',
 'public.ediel_route_profiles','public.communication_routes','public.ediel_certificates',
 'public.ediel_test_runs','public.ediel_test_run_messages','public.ediel_business_references',
 'gridex_ediel_outbound_owner.witnesses','gridex_ediel_outbound_owner.consumptions','gridex_ediel_source_rules.receipts',
 'gridex_ediel_inbound_context.receipts','gridex_received_sources.sources','gridex_ediel_inbound_receptions.receptions',
 'gridex_bilateral_prodat.outbound_operations','gridex_bilateral_prodat.outbound_receipts','gridex_bilateral_prodat.artifacts',
 'gridex_bilateral_prodat.profile_versions','gridex_bilateral_prodat.origins','gridex_business_expectations.bindings',
 'gridex_outbound_dispatch.attempts','gridex_outbound_dispatch.events','gridex_outbound_dispatch.witnesses']
const scopeGraph=(s:Seed,tables=scopeTables)=>sql<Record<string,unknown>>(`SELECT jsonb_build_object(
 ${tables.map(table=>`${literal(table)},${rowHashes(table,`t.company_id=${literal(s.f.companyId)}`)}`).join(',')},
 'gridex_ediel_transport.reservations',${rowHashes('gridex_ediel_transport.reservations',`t.message_id IN(SELECT id FROM public.ediel_messages WHERE company_id=${literal(s.f.companyId)})`)},
 'gridex_transport_exception.revocations',${rowHashes('gridex_transport_exception.revocations',`t.approval_id IN(SELECT id FROM gridex_transport_exception.approvals WHERE company_id=${literal(s.f.companyId)})`)})`)
const ownerMembers=()=>sql(`SELECT to_jsonb(count(*)) FROM pg_auth_members x JOIN pg_roles r ON r.oid=x.roleid
 WHERE r.rolname IN('gridex_ediel_transport_exception_owner','gridex_ediel_certificate_authority_owner') AND (x.inherit_option OR x.set_option)`)
const tlsContinues=()=>expect(smtp.options).toHaveBeenLastCalledWith(expect.objectContaining({requireTLS:true,tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'}}))
const accepted=(s:Seed)=>({accepted:[s.m.receiver_email],rejected:[],messageId:'synthetic-tr09-'+randomUUID(),response:'250 synthetic accepted'})
function publishCache(s:Seed,crl=expiredCrl){
 const leaf=new X509Certificate(leafPem)
 // A signed RFC822 identity must qualify the real prospective SMTP target;
 // mutable certificate labels cannot supply this recipient binding.
 expect(s.m.receiver_email).toBe(recipientMailbox)
 expect(leaf.checkEmail(s.m.receiver_email??'',{subject:'always'})).toBe(recipientMailbox)
 expect(leaf.checkEmail('other-recipient@example.invalid',{subject:'always'})).toBeUndefined()
 const register=JSON.stringify({syntheticOnly:true,receiver:s.m.receiver_ediel_id,leaf:sha(leaf.raw),anchor:sha(anchor),crl:sha(crl)})
 const scope={companyId:s.f.companyId,environment:'test',receiverEdielId:s.m.receiver_ediel_id,actorUserId:s.f.actorUserId,registerVersion:'synthetic-'+randomUUID(),
  originalReference:'synthetic://tr09-certificate-register',legalAuthorityReference:'synthetic://tr09-legal',processAuthorityReference:'synthetic://tr09-process',
  ownerRegisterReference:'synthetic://tr09-owner',validFrom:new Date(Date.now()-60000).toISOString(),validTo:new Date(Date.now()+600000).toISOString()}
 const materials={anchors:[anchor],intermediates:[],crls:[crl],recipientFingerprints:[leaf.fingerprint256.replaceAll(':','').toLowerCase()]}
 const registrationId=asOwner('gridex_ediel_certificate_authority_owner',`SELECT public.gridex_ediel_certificate_trust_publish_v1(${literal(scope)}::jsonb,
 convert_to(${literal(register)},'UTF8'),${literal(materials)}::jsonb)`),certificateId=randomUUID()
 // Public cache rows are public certificate/route fixture inputs. Private
 // authority, incidents, operations and alarms are produced only by owners.
 sql(`INSERT INTO public.ediel_certificates(id,company_id,certificate_fingerprint,secret_reference,status,environment,subject,issuer,serial_number,fingerprint_sha256,
 public_certificate_pem,valid_from,valid_to,owner_ediel_id,message_family,message_type,purpose,usage)
 VALUES(${literal(certificateId)},${literal(s.f.companyId)},${literal(leaf.fingerprint256)},'public://synthetic-tr09','active','test',${literal(leaf.subject)},${literal(leaf.issuer)},
 ${literal(leaf.serialNumber)},${literal(leaf.fingerprint256)},${literal(leafPem)},${literal(new Date(leaf.validFrom).toISOString())},${literal(new Date(leaf.validTo).toISOString())},
 ${literal(s.m.receiver_ediel_id)},'PRODAT','PRODAT','encryption','outbound_recipient');
 UPDATE public.ediel_route_profiles SET receiver_certificate_id=${literal(certificateId)} WHERE id=${literal(s.f.routeProfileId)} AND company_id=${literal(s.f.companyId)};`)
 return {registrationId,certificateId,crl}
}
async function crlSeed(crl=expiredCrl){
 const s=await seed(),cache=publishCache(s,crl)
 const source={...s.source,case:'crl_refresh_failure',incident:{observedAt:s.source.incident.observedAt,allCertificateCdpsAttempted:true,nearestPreviousCachedCrl:true,
  certificateAuthorityId:cache.registrationId,cdpResults:cdps.map(cdp=>({cdp,result:'failed',originalSha256:sha('synthetic retrieval failure '+cdp)})),priorCrlSha256:[sha(crl)]}}
 // Rebind the approval to these exact original bytes, without a caller-issued
 // capability or private admission row.
 return {...s,source,approval:{...s.approval,case:source.case,sourceDigest:sha(JSON.stringify(source))},cache}
}
const resolveCache=(s:Seed,certificateId:string)=>resolveOutboundRecipientCertificate({companyId:s.f.companyId,certificateId,receiverEdielId:s.m.receiver_ediel_id,
 environment:'test',certificateEnvironment:'test',messageFamily:'PRODAT',businessCode:'Z03',ownEdielId:s.m.sender_ediel_id})

it('native completed empty X.500 source permits only its exact plaintext original over mandatory TLS and journals a separate alarm',async()=>{
 const s=await seed(),before=original(s),id=publish(s)
 expect(ownerMembers()).toBe(0);expect(exactSourceCustody(s,id)).toBe(true)
 const beforeSend=effects(s)
 // A synthetic local test route is still required_encrypted. The selector is
 // necessary; no caller option or route-wide plaintext fallback is enabled.
 await expect(sendEdielMessageViaSmtp(s.m,{actorUserId:s.f.actorUserId})).rejects.toThrow('mottagarens publika S/MIME-certifikat')
 expect(effects(s)).toEqual(beforeSend);expect(smtp.send).not.toHaveBeenCalled()
 smtp.send.mockResolvedValue(accepted(s))
 const delivered=await sendEdielMessageViaSmtp(s.m,{actorUserId:s.f.actorUserId,temporarySecurityExceptionId:id})
 expect(smtp.send).toHaveBeenCalledTimes(1);tlsContinues()
 const raw=smtp.send.mock.calls[0][0].raw as Buffer
 expect(raw.toString('ascii')).toContain('Content-Type: application/EDIFACT')
 expect(raw.toString('ascii')).not.toContain('application/pkcs7-mime')
 const encoded=raw.toString('ascii').split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\s/g,'')
 expect(Buffer.from(encoded,'base64')).toEqual(Buffer.from(s.m.raw_payload!,'latin1'))
 expect(effects(s)).toEqual({approvals:1,operations:1,alarms:1,attempts:1,entries:1})
 expect(journal(s)).toEqual({events:['prepared','entered','observed'],exact:true,alarm:true});originalUnchanged(s,before)
 const alarms=await rpc('ediel_transport_exception_alarms_v1',{p_company_id:s.f.companyId,p_actor_user_id:s.reviewer})
 expect(alarms).toMatchObject({error:null,data:[expect.objectContaining({messageId:s.m.id,responsibleUserId:s.reviewer,facts:expect.objectContaining({case:s.source.case,mandatoryTls:true,administratorAlarm:true})})]})

 // The same valid selector consumes the actual accepted receipt. It cannot
 // spend another budget operation, alarm or SMTP entry. Public projection
 // repair and fresh preparation archives do not invent a second delivery.
 const acceptedJournal=scopeGraph(s,transportTables),acceptedWire=original(s)
 expect(await sendEdielMessageViaSmtp(s.m,{actorUserId:s.f.actorUserId,temporarySecurityExceptionId:id})).toEqual(delivered)
 expect(smtp.send).toHaveBeenCalledTimes(1);expect(scopeGraph(s,transportTables)).toEqual(acceptedJournal)
 expect(exactSourceCustody(s,id)).toBe(true);originalUnchanged(s,acceptedWire)

 // A separate canonical original exercises the prepared-attempt budget. Safe
 // public release cancels each reservation before SMTP; it does not refund
 // the already journaled bounded exception operation.
 const budget=await seed(),budgetWire=original(budget),budgetId=publish(budget)
 expect(budget.f.companyId).not.toBe(s.f.companyId);expect(budget.m.id).not.toBe(s.m.id)
 expect(budget.m.raw_payload).not.toBe(s.m.raw_payload);expect(exactSourceCustody(budget,budgetId)).toBe(true)
 const prepares:Array<Record<string,unknown>>=[],actions:string[]=[]
 vi.spyOn(supabaseService,'rpc').mockImplementation((async(name:string,args:Record<string,unknown>)=>{
  const input=args.p_input as Record<string,unknown>|undefined
  if(name!=='gridex_ediel_transport_attempt_v1'||input?.messageId!==budget.m.id)return rpc(name,args)
  expect(input).toMatchObject({companyId:budget.f.companyId,environment:'test',actorUserId:budget.f.actorUserId})
  actions.push(String(input.action))
  if(input.action==='enter'){
   const prepare=prepares.find(value=>value.attemptId===input.attemptId)
   expect(prepare).toBeDefined()
   const beforeReplay=scopeGraph(budget)
   const replay=await rpc(name,{p_input:prepare})
   expect(replay.error).toBeNull();expect(replay.data).toEqual({proceed:false,state:'prepared',classification:null,providerReceipt:null,observedAt:null})
   expect(scopeGraph(budget)).toEqual(beforeReplay)
   const release={companyId:input.companyId,environment:input.environment,messageId:input.messageId,
    actorUserId:input.actorUserId,attemptId:input.attemptId,action:'release'}
   const released=await rpc(name,{p_input:release})
   expect(released.error).toBeNull();expect(released.data).toEqual({proceed:true,state:'released'})
  }
  const beforeHeld=input.action==='enter'||input.action==='observe'?scopeGraph(budget):null
  // The module-bound original RPC forwards real results, never fabricated
  // authority or a replacement receipt, and cannot recurse through this spy.
  const result=await rpc(name,args)
  if(input.action==='prepare'){
   expect(result.error).toBeNull();expect(result.data).toEqual({proceed:true,state:'prepared'})
   expect(input.owner).toEqual({kind:'direct'})
   expect(input.binding).toMatchObject({originalHash:sha(budget.m.raw_payload!),routeId:budget.m.communication_route_id,
    to:budget.m.receiver_email,mimeMode:'ediel-singlepart-base64',transportException:{approvalId:budgetId,
     sourceDigest:sha(JSON.stringify(budget.source)),approvalDigest:sha(JSON.stringify(budget.approval))}})
   expect(input.attemptId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
   expect(prepares.some(value=>value.attemptId===input.attemptId)).toBe(false)
   prepares.push(structuredClone(input))
  }else if(input.action==='enter'){
   expect(result.error).toBeNull();expect(result.data).toEqual({proceed:false,state:'released'})
   expect(scopeGraph(budget)).toEqual(beforeHeld)
  }else if(input.action==='observe'){
   expect(result).toMatchObject({data:null,error:{code:'P0001',message:'ediel_transport_result_invalid'}})
   expect(scopeGraph(budget)).toEqual(beforeHeld)
  }
  return result
 }) as unknown as typeof supabaseService.rpc)
 const transportCount=smtp.options.mock.calls.length
 for(const count of [1,2]){
  const beforeReservation=original(budget)
  await expect(sendEdielMessageViaSmtp(budget.m,{actorUserId:budget.f.actorUserId,temporarySecurityExceptionId:budgetId})).rejects.toMatchObject({
   code:'ediel_delivery_uncertain',cause:expect.objectContaining({message:'ediel_transport_entry_denied'})})
  expect(prepares).toHaveLength(count);expect(smtp.send).toHaveBeenCalledTimes(1)
  expect(smtp.options).toHaveBeenCalledTimes(transportCount+count);tlsContinues()
  expect(effects(budget)).toEqual({approvals:1,operations:count,alarms:count,attempts:count,entries:0})
  expect(journal(budget)).toEqual({events:Array.from({length:count},()=>['prepared','released']).flat(),exact:true,alarm:true})
  expect(sql(`SELECT jsonb_build_object('state',r.state,'attempt',r.attempt_id,
   'unentered',bool_and(a.entered_at IS NULL AND a.observed_at IS NULL AND a.classification IS NULL AND a.provider_result IS NULL))
   FROM gridex_ediel_transport.reservations r JOIN gridex_ediel_transport.attempts a ON a.message_id=r.message_id
   WHERE r.message_id=${literal(budget.m.id)} GROUP BY r.state,r.attempt_id`)).toEqual({state:'released',attempt:prepares[count-1].attemptId,unentered:true})
  expect(exactSourceCustody(budget,budgetId)).toBe(true);originalUnchanged(budget,beforeReservation)
 }
 expect(actions).toEqual(['prepare','enter','observe','prepare','enter','observe'])
 const thirdAttempt=randomUUID(),thirdPrepare={...prepares[1],attemptId:thirdAttempt}
 expect(prepares.some(value=>value.attemptId===thirdAttempt)).toBe(false)
 // Reuse only the actual sender's qualified archived binding. Changing one
 // prospective UUID reaches the real third public prepare without another
 // high-level send's legitimate pre-prepare archive/event writes.
 const beforeBudgetRefusal=scopeGraph(budget)
 const refused=await rpc('gridex_ediel_transport_attempt_v1',{p_input:thirdPrepare})
 expect(refused).toMatchObject({data:null,error:{code:'P0001',message:'transport_exception_bounded_attempt_budget_exhausted'}})
 expect(scopeGraph(budget)).toEqual(beforeBudgetRefusal);expect(smtp.send).toHaveBeenCalledTimes(1)
 expect(scopeGraph(s,transportTables)).toEqual(acceptedJournal)
 expect(effects(budget)).toEqual({approvals:1,operations:2,alarms:2,attempts:2,entries:0})
 expect(exactSourceCustody(budget,budgetId)).toBe(true);originalUnchanged(budget,budgetWire);originalUnchanged(s,acceptedWire)
 expect(ownerMembers()).toBe(0)
},120000)

it('native reserve publisher rejects incomplete directory search, invented cases, foreign bindings, TLS downgrade and unbounded approval without effects',async()=>{
 const s=await seed(),before=effects(s),wire=original(s)
 const invalid=[
  {...s.source,incident:{...s.source.incident,directorySearchCompleted:false}},
  {...s.source,incident:{...s.source.incident,resultCount:1}},
  {...s.source,case:'disable_tls'},
  {...s.source,companyId:randomUUID()},
  {...s.source,environment:'production'},
  {...s.source,routeId:randomUUID()},
  {...s.source,receiverEdielId:'99999'},
  {...s.source,receiverEmail:'foreign@example.invalid'},
  {...s.source,originalHash:'f'.repeat(64)},
  {...s.source,tls:{...s.source.tls,required:false}},
  {...s.source,tls:{...s.source.tls,allRelayHopsVerified:false}},
  {...s.source,counterparty:{...s.source.counterparty,temporaryReserveConfirmed:false}}
 ]
 for(const source of invalid)expect(()=>publish(s,source)).toThrow(/transport_exception_/)
 for(const approval of [{...s.approval,maximumAttempts:4},{...s.approval,validTo:new Date(Date.now()+25*3600000).toISOString()},
  {...s.approval,validTo:new Date(Date.now()-1000).toISOString()},{...s.approval,sourceDigest:'f'.repeat(64)}])expect(()=>publish(s,s.source,approval)).toThrow(/transport_exception_exact_current_bounded_approval_required/)
 expect(effects(s)).toEqual(before);originalUnchanged(s,wire);expect(ownerMembers()).toBe(0);expect(smtp.send).not.toHaveBeenCalled()
},120000)

it('native no-certificate approval rechecks its current TLS route and the actual owner recipient cache',async()=>{
 const s=await seed(),id=publish(s),before=effects(s),wire=original(s)
 sql(`UPDATE public.ediel_route_profiles SET tls_required=false WHERE id=${literal(s.f.routeProfileId)} AND company_id=${literal(s.f.companyId)}`)
 try{
  await expect(sendEdielMessageViaSmtp(s.m,{actorUserId:s.f.actorUserId,temporarySecurityExceptionId:id})).rejects.toMatchObject({message:expect.stringContaining('transport_exception_current_owned_tls_route_required')})
  expect(effects(s)).toEqual(before);expect(smtp.send).not.toHaveBeenCalled()
 }finally{sql(`UPDATE public.ediel_route_profiles SET tls_required=true WHERE id=${literal(s.f.routeProfileId)} AND company_id=${literal(s.f.companyId)}`)}
 publishCache(s)
 await expect(sendEdielMessageViaSmtp(s.m,{actorUserId:s.f.actorUserId,temporarySecurityExceptionId:id})).rejects.toMatchObject({message:expect.stringContaining('transport_exception_completed_no_certificate_search_required')})
 expect(effects(s)).toEqual(before);originalUnchanged(s,wire);expect(smtp.send).not.toHaveBeenCalled();expect(ownerMembers()).toBe(0)
},120000)

it('native source revoked after actual prepare is reread at entry and refuses SMTP while retaining the separate prepared deviation',async()=>{
 const s=await seed(),id=publish(s),wire=original(s),real=supabaseService.rpc.bind(supabaseService)
 let revoked=false
 vi.spyOn(supabaseService,'rpc').mockImplementation(((name:string,args:Record<string,unknown>)=>{
  const input=args.p_input as Record<string,unknown>|undefined
  if(name==='gridex_ediel_transport_attempt_v1'&&input?.messageId===s.m.id&&input.action==='enter'){
   expect(effects(s)).toMatchObject({operations:1,alarms:1,attempts:1,entries:0})
   const revocation={schema:'gridex_transport_exception_revocation_v1',approvalId:id,companyId:s.f.companyId,reasonReference:'synthetic://tr09-withdrawal-between-prepare-entry'}
   asOwner('gridex_ediel_transport_exception_owner',`SELECT public.ediel_revoke_transport_exception_v1(${literal(id)},${literal(s.reviewer)},convert_to(${literal(JSON.stringify(revocation))},'UTF8')) IS NULL`)
   revoked=true
  }
  return real(name,args)
 }) as typeof supabaseService.rpc)
 await expect(sendEdielMessageViaSmtp(s.m,{actorUserId:s.f.actorUserId,temporarySecurityExceptionId:id})).rejects.toMatchObject({
  cause:expect.objectContaining({message:expect.stringContaining('transport_exception_fresh_entry_authority_required')})})
 expect(revoked).toBe(true);expect(effects(s)).toEqual({approvals:1,operations:1,alarms:1,attempts:1,entries:0})
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_transport_exception.events WHERE message_id=${literal(s.m.id)} AND kind IN('entered','observed')`)).toBe(0)
 originalUnchanged(s,wire);expect(smtp.send).not.toHaveBeenCalled();expect(ownerMembers()).toBe(0)
},120000)

it('native all actual certificate CDPs failing permits the exact expired signed cached CRL for encrypted S/MIME only, with an administrator alarm',async()=>{
 const s=await crlSeed(),wire=original(s),before=effects(s)
 // No historical clock is passed to the consumer. Leaf/CA remain current;
 // this cached signed CRL has a real nextUpdate before the actual test clock.
 expect(openssl(['crl','-in','previous.crl','-noout','-nextupdate'])).toMatch(/nextUpdate=/)
 const next=openssl(['crl','-in','previous.crl','-noout','-nextupdate']).trim().replace('nextUpdate=','')
 expect(Date.parse(next)).toBeLessThan(Date.now())
 await expect(resolveCache(s,s.cache.certificateId)).rejects.toMatchObject({message:expect.stringContaining('certificate_trust_pkix_or_fresh_authenticated_crl_failed')})
 expect(effects(s)).toEqual(before)
 const id=publish(s,s.source,s.approval)
 expect(exactSourceCustody(s,id)).toBe(true)
 smtp.send.mockResolvedValue(accepted(s))
 await sendEdielMessageViaSmtp(s.m,{actorUserId:s.f.actorUserId,temporarySecurityExceptionId:id,smtpMimeMode:'ediel-smime-enveloped'})
 expect(smtp.send).toHaveBeenCalledTimes(1);tlsContinues()
 const raw=smtp.send.mock.calls[0][0].raw as Buffer
 expect(raw.toString('ascii')).toContain('application/pkcs7-mime; smime-type=enveloped-data')
 expect(raw.includes(Buffer.from(s.m.raw_payload!,'latin1'))).toBe(false)
 writeFileSync(join(directory,'sent.eml'),raw)
 const decoded=openssl(['smime','-decrypt','-in','sent.eml','-recip','leaf.pem','-inkey','leaf.key'])
 const parts=decoded.split(/\r?\n\r?\n/)
 expect(parts).toHaveLength(2)
 expect(parts[0]).toContain('Content-Type: application/EDIFACT')
 expect(parts[0]).toContain('Content-Transfer-Encoding: base64')
 const body=parts[1].replace(/\s/g,'')
 expect(Buffer.from(body,'base64')).toEqual(Buffer.from(s.m.raw_payload!,'latin1'))
 expect(effects(s)).toEqual({approvals:1,operations:1,alarms:1,attempts:1,entries:1})
 expect(journal(s)).toEqual({events:['prepared','entered','observed'],exact:true,alarm:true})
 expect(sql(`SELECT to_jsonb(bool_and(binding->'priorCrlSha256'=${literal([sha(expiredCrl)])}::jsonb AND binding->>'certificateAuthorityId'=${literal(s.cache.registrationId)}
 AND binding->'cdpLocations'=${literal(cdps)}::jsonb)) FROM gridex_transport_exception.operations WHERE message_id=${literal(s.m.id)}`)).toBe(true)
 originalUnchanged(s,wire);expect(ownerMembers()).toBe(0)
 // The issued capability is scoped to the real consumer, not a global switch.
 await expect(resolveCache(s,s.cache.certificateId)).rejects.toMatchObject({message:expect.stringContaining('certificate_trust_pkix_or_fresh_authenticated_crl_failed')})
},120000)

it.each(['omitted_actual_cdp','corrupt_signature','revoked_recipient'] as const)('native previous-CRL reserve keeps %s held before operation, alarm or SMTP entry',async failure=>{
 let crl=expiredCrl
 if(failure==='revoked_recipient')crl=revokedCrl
 if(failure==='corrupt_signature'){
  // Alter a signature octet, preserving valid DER, issuer and dates. Merely
  // corrupting the ASN.1 header would establish only a parse failure.
  const der=Buffer.from(expiredCrl.replace(/-----[^\r\n]+-----|\s/g,''),'base64')
  if(der.length<64)throw Error('synthetic_crl_signature_required')
  der[der.length-1]^=1
  crl='-----BEGIN X509 CRL-----\n'+der.toString('base64').match(/.{1,64}/g)!.join('\n')+'\n-----END X509 CRL-----\n'
  writeFileSync(join(directory,'corrupt-signature.crl'),crl)
  const fields=['-noout','-issuer','-lastupdate','-nextupdate']
  expect(openssl(['crl','-in','corrupt-signature.crl',...fields])).toEqual(openssl(['crl','-in','previous.crl',...fields]))
  const valid=crlVerification('previous.crl'),invalid=crlVerification('corrupt-signature.crl')
  console.info('TR09 actual CRL diagnostic contrast:',{valid:{status:valid.status,stdout:valid.stdout,stderr:valid.stderr},
   invalid:{status:invalid.status,stdout:invalid.stdout,stderr:invalid.stderr}})
  expect(valid.status).toBe(0);expect(valid.stderr).toMatch(/verify OK/);expect(valid.stderr).not.toMatch(/verify failure/)
  // OpenSSL versions differ on exit status for a parsed bad signature. The
  // actual CLI diagnostic establishes this fixture's failure on either build.
  expect(invalid.stderr).toMatch(/verify failure/);expect(invalid.stderr).not.toMatch(/verify OK/)
 }
 const s=await crlSeed(crl)
 if(failure==='omitted_actual_cdp'){
  s.source.incident.cdpResults=s.source.incident.cdpResults.slice(0,1)
  s.approval.sourceDigest=sha(JSON.stringify(s.source))
 }
 const id=publish(s,s.source,s.approval),before=effects(s),wire=original(s)
 await expect(sendEdielMessageViaSmtp(s.m,{actorUserId:s.f.actorUserId,temporarySecurityExceptionId:id,smtpMimeMode:'ediel-smime-enveloped'})).rejects.toMatchObject({message:expect.stringContaining('transport_exception_previous_crl_crypto_held')})
 expect(effects(s)).toEqual(before);originalUnchanged(s,wire);expect(smtp.send).not.toHaveBeenCalled();expect(ownerMembers()).toBe(0)
},120000)

it('native CRL publisher rejects a succeeded CDP, a different cached original and a foreign certificate owner atomically',async()=>{
 const s=await crlSeed(),before=effects(s),wire=original(s)
 for(const incident of [
  {...s.source.incident,allCertificateCdpsAttempted:false},
  {...s.source.incident,nearestPreviousCachedCrl:false},
  {...s.source.incident,cdpResults:[{...s.source.incident.cdpResults[0],result:'succeeded'}]},
  {...s.source.incident,priorCrlSha256:['f'.repeat(64)]},
  {...s.source.incident,certificateAuthorityId:randomUUID()}
 ])expect(()=>publish(s,{...s.source,incident})).toThrow(/transport_exception_/)
 expect(effects(s)).toEqual(before);originalUnchanged(s,wire);expect(ownerMembers()).toBe(0);expect(smtp.send).not.toHaveBeenCalled()
},120000)
