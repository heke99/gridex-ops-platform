// SOURCE-only entry until the sole FG producer receives distinct runtime GO.
// Fresh explicitly SYNTHETIC external competence is a disposable mechanism
// boundary, never real market/issuer authority. Approved declarations, events,
// supply and originals are created only by their actual public owners.
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto'
import {chmodSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {dirname,resolve,sep} from 'node:path'
import {createClient} from '@supabase/supabase-js'
import type {SupabaseClient} from '@supabase/supabase-js'
import {expect,it,vi} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {assertInvoiceTestCustomer} from '@/lib/ediel/testing/invoiceTestCenterWorkspace'
import {archiveSignedCustomerContractPdf} from '@/lib/customer-contracts/documents'
import {buildAgreementPdfAttachment} from '@/lib/customer-contracts/agreementPdf'
import {savePowerOfAttorney} from '@/lib/operations/db'
import {ensureAuthorizationDocumentFromPowerOfAttorney} from '@/lib/legal/authorizationChain'
import {powerOfAttorneyCoverageFromScopes} from '@/lib/operations/powerOfAttorneyWorkflow'
import {prepareAndQueueEdielZ03} from '@/lib/ediel/flows/prodatSwitch'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {getEdielMessageById} from '@/lib/ediel/db'
import {archiveNetworkRegistrySource,reviewNetworkRegistrySource} from '@/lib/ediel/production/networkRegistrySource'
import type {NetworkRegistrySourceSubmission} from '@/lib/ediel/production/networkRegistrySource'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {captureFreshEdielSourceRulePackEvidence} from '@/lib/ediel/core/sourceRulePackEvidence'
import {createReceivedSourceOwnerSession} from '@/lib/ediel/sources/receivedSourceOwnerSession'
import {applyInboundBusinessStateMachine} from '@/lib/ediel/flows/inboundBusinessStateMachine'
import {decideProdatLifecycle} from '@/lib/ediel/stateMachines/prodatLifecycle'
import {applySupplyMarketSource} from '@/lib/ediel/flows/supplyMarketTransition'
import {readMeteringMethodChangeSource} from '@/lib/ediel/production/meteringMethodChangeSource'
import {reviewReceivedStructuralSource} from '@/lib/ediel/sources/reviewReceivedStructuralSource'
import {readQualifiedCustomerStructure} from '@/lib/ediel/sources/qualifiedCustomerStructure'
import {matchOutboundRequestForInbound,matchMeteringPointForInbound} from '@/lib/inbound-mail/inboundMatcher'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {prodatDate203,prodatMarketMinuteToUtc} from '@/lib/ediel/prodat/render/dates'
import {assertEdielSmtpReadiness} from '@/lib/ediel/mailReadiness'
import {nativeSql as sql,literal,nativeActorRoleSql,futureNativeSupplyDate} from './ediel-normal-switch-native-fixture'
import type {NormalSwitchStageNativeFixture} from './ediel-normal-switch-native-fixture'
import {nativeFixtureCompanyIdentitySql} from './native-fixture-company-identity'
import {syntheticSwedishOrganizationNumber} from '../../e2e/production/helpers/swedish-organization-number.mjs'
import {seedOriginalMailboxNative} from './originalMailboxNative'
import {buildCancellationProspectiveZ04} from './ediel-cancellation-prospective-source-2ea'
import type {CompositionInputs} from '../ediel-at-z09fg-supplier-composition-native.test'

vi.mock('server-only',()=>({}))
const smtp=vi.hoisted(()=>({send:vi.fn()}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:smtp.send})}}))

type Actor={id:string;email:string;password:string;client:SupabaseClient}
type Profile=CompositionInputs['profiles'][number]
type Artifact=Profile['declaration']
type Stage=NormalSwitchStageNativeFixture&{request:Actor;reviewer:Actor;pdf:Buffer;initialDeclaration:Artifact}
const digest=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex')
const permissions=['communication.read','communication.write','communication.send','customers.read','customers.write','contracts.read','contracts.write','contracts.create','contracts.publish','pricing.read','pricing.write','pricing.publish','metering.read','metering.write','operations.read','operations.write','ediel.source.review','ediel.network_registry.review']
let stage='INITIALIZE',inventoryPath='',proofPath=''
const secrets=new Set<string>()
function tempPath(name:string){
 const root=process.env.RUNNER_TEMP,value=process.env[name]
 if(!root||!value||!resolve(value).startsWith(resolve(root)+sep))throw Error('fg_owned_runner_temp_path_required')
 const file=resolve(value);mkdirSync(dirname(file),{recursive:true,mode:0o700});chmodSync(dirname(file),0o700);return file
}
function secret(value:string|Buffer){
 const bytes=Buffer.isBuffer(value)?value:Buffer.from(value)
 const variants=[bytes.toString('hex'),bytes.toString('base64'),bytes.toString('base64url')]
 if(Buffer.from(bytes.toString('utf8')).equals(bytes))variants.push(bytes.toString('utf8'))
 for(const v of variants)if(v.length>=8)secrets.add(v)
 if(!inventoryPath)throw Error('fg_secret_inventory_before_use_required')
 writeFileSync(inventoryPath,JSON.stringify({schema:'fg_secret_inventory_v1',values:[...secrets]})+'\n',{mode:0o600});chmodSync(inventoryPath,0o600)
 return value
}
const password=()=>secret(randomBytes(32).toString('base64url')+'Aa1!') as string
const hmac=(key:Buffer,bytes:Buffer)=>secret(createHmac('sha256',key).update(bytes).digest('hex')) as string
const clock=()=>sql<string>('SELECT to_jsonb(clock_timestamp())')
// Clean native replay lacks these hosted reference catalog keys (same precedent
// as ediel-z04d-production-native-fixture.ts). Reference rows only: no role,
// user grant, override or deny is written here; actor() still grants per actor
// and asserts the canonical tenant context independently.
const replayMissingCatalogKeys=['contracts.create','contracts.publish','pricing.read','pricing.write','pricing.publish']
function referenceCatalog(){
 stage='PERMISSION_CATALOG'
 sql(`INSERT INTO public.permissions(key,name,description,category,is_active)
  SELECT key,key,'Synthetic FG disposable preparation reference','native_fixture',true
  FROM unnest(ARRAY[${replayMissingCatalogKeys.map(literal).join(',')}]::text[]) key
  ON CONFLICT(key) DO NOTHING`)
 expect(sql(`SELECT coalesce(jsonb_agg(key ORDER BY key),'[]') FROM public.permissions WHERE key=ANY(ARRAY[${permissions.map(literal).join(',')}]::text[]) AND is_active`)).toEqual([...permissions].sort())
}
// Value-free failure label: an own fixed error code, otherwise only the
// producer call-site line. Never an assertion message, SQL text or value.
function failureLabel(error:unknown){
 const message=error instanceof Error?error.message:''
 // Own codes always contain an underscore; a bare hex HMAC/token never does.
 if(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(message)&&message.length<=80)return message
 const site=error instanceof Error?/ediel-z09fg-composition-inputs-native-producer\.ts:(\d{1,5}):(\d{1,4})/.exec(error.stack??''):null
 return site?`ASSERTION_AT_LINE_${site[1]}`:'UNLABELED'
}
function initialize(){
 if(process.env.GRIDEX_FG_PRODUCER_INTENT!=='SYNTHETIC_DISPOSABLE_PREPARATION'||process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('fg_explicit_disposable_preparation_required')
 inventoryPath=tempPath('GRIDEX_FG_SECRET_INVENTORY');proofPath=tempPath('GRIDEX_FG_PREPARATION_PROOF')
 const status=JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS!,'utf8')) as Record<string,unknown>
 if(status.API_URL!=='http://127.0.0.1:54321')throw Error('fg_exact_loopback_status_required')
 for(const[k,v]of Object.entries(status))if(typeof v==='string'){
  if(/key|secret|password|token/i.test(k))secret(v)
  if(/url/i.test(k)){try{const u=new URL(v);if(u.password)secret(decodeURIComponent(u.password))}catch{ /* Non-URL status fields carry no URL password. */ }}
 }
 const pass=password()
 for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EDIEL_EMAIL_PROVIDER:'strato',EDIEL_SMTP_HOST:'smtp.example.invalid',EDIEL_SMTP_PORT:'465',EDIEL_SMTP_SECURE:'true',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_REPLY_TO:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:pass}))vi.stubEnv(k,v)
 smtp.send.mockImplementation(async(options:unknown)=>{
  const o=options as {envelope?:{from?:string;to?:string[]};raw?:Buffer}
  expect(o.envelope?.from).toBe('synthetic@example.invalid');expect(o.envelope?.to).toEqual(['recipient@example.invalid']);expect(Buffer.isBuffer(o.raw)&&o.raw!.length>0).toBe(true)
  return{accepted:['recipient@example.invalid'],rejected:[],messageId:'SYNTHETIC-FG-'+randomUUID(),response:'250 explicitly synthetic accepted'}
 })
}
async function actor(companyId:string){
 const email='fg-'+randomUUID()+'@example.invalid',pass=password()
 const created=await supabaseService.auth.admin.createUser({email,password:pass,email_confirm:true})
 expect(created.error).toBeNull();expect(created.data.user?.id).toBeTruthy();const id=created.data.user!.id
 sql(`INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(id)},${literal(email)},'SYNTHETIC FG source actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
 INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key) VALUES(${literal(companyId)},${literal(id)},'member','active',clock_timestamp(),'member',true,clock_timestamp(),'member');
 ${nativeActorRoleSql(companyId,id)}
 -- The canonical tenant context projects role grants only (20261014004020);
 -- grant on this actor's own disposable company role, as createBilateralSourceOperator does.
 INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key) SELECT r.id,r.key,p.id,p.key FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id JOIN public.permissions p ON p.key=ANY(ARRAY[${permissions.map(literal).join(',')}]::text[]) WHERE ur.user_id=${literal(id)} AND ur.company_id=${literal(companyId)} AND r.key LIKE 'native_actor_%';`)
 const client=createClient('http://127.0.0.1:54321',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})
 const signed=await client.auth.signInWithPassword({email,password:pass})
 for(const v of [signed.data.session?.access_token,signed.data.session?.refresh_token])if(v)secret(v)
 expect(signed.error).toBeNull();expect((await client.auth.getUser()).data.user?.id).toBe(id)
 const context=await client.rpc('canonical_authenticated_tenant_context',{p_selected_company_id:companyId});expect(context.error).toBeNull()
 expect(context.data).toMatchObject({authorized:true,selected_company_id:companyId})
 for(const key of permissions)expect((context.data as {permissions:string[]}).permissions,key).toContain(key)
 expect(sql(`SELECT to_jsonb(EXISTS(SELECT FROM public.admin_users WHERE user_id=${literal(id)} AND is_active))`)).toBe(false)
 return{id,email,password:pass,client}
}
async function signContractWithRegisteredToken(input:{companyId:string;customerId:string;contractId:string;actorUserId:string}){
 await assertInvoiceTestCustomer(input)
 const token=secret(randomBytes(32).toString('hex')) as string
 const prepared=await supabaseService.rpc('gridex_prepare_customer_contract_signature_request_v1',{p_company_id:input.companyId,p_customer_id:input.customerId,p_contract_id:input.contractId,p_token_hash:token,p_recipient_email:'synthetic-'+input.customerId+'@example.invalid',p_expires_at:new Date(Date.parse(clock())+3600000).toISOString(),p_actor_user_id:input.actorUserId,p_channel:'internal'})
 expect(prepared.error).toBeNull()
 const finalized=await supabaseService.rpc('gridex_finalize_customer_contract_signature_v1',{p_token_hash:token,p_signed_ip_hash:null,p_signed_user_agent:'SYNTHETIC FG invoice-test acceptance ONLY'});expect(finalized.error).toBeNull()
 const result=await supabaseService.from('customer_contracts').select('*').eq('company_id',input.companyId).eq('id',input.contractId).single();expect(result.error).toBeNull()
 const signed=result.data!;expect(signed).toMatchObject({status:'signed'});for(const key of ['signed_at','locked_at','signature_snapshot_sha256','contract_price_snapshot_id','contract_product_version_id','contract_publication_version_id','legal_bundle_version_id'] as const)expect(signed[key],key).toBeTruthy()
 return signed
}
async function archive(f:{companyId:string;contractId:string;pdf:Buffer;request:Actor;reviewer:Actor},kind:'masterdata_declaration'|'contract_requested_method'|'metering_method_event',claims:Record<string,unknown>):Promise<Artifact>{
 stage='ARCHIVE_'+kind
 const scope=await f.request.client.rpc('ediel_contract_intake_scope_v1',{p_company_id:f.companyId,p_actor_user_id:f.request.id,p_contract_id:f.contractId,p_environment:'test',p_kind:kind});expect(scope.error).toBeNull()
 const nativeScope=scope.data as {legalActorId:string};expect(nativeScope.legalActorId).toBeTruthy()
 const key=randomUUID(),representation=randomUUID(),signingKey=secret(randomBytes(32)) as Buffer
 const legal='SYNTHETIC FG issuer competence ONLY',rep='SYNTHETIC FG kind-specific representation ONLY'
 sql(`INSERT INTO gridex_contract_source_intake.issuer_keys(id,company_id,environment,issuer_code,legal_authority_reference,legal_authority_source_hash,signing_key,valid_from,valid_to) VALUES(${literal(key)},${literal(f.companyId)},'test','SYNTHETIC FG',${literal(legal)},${literal(digest(legal))},decode(${literal(signingKey.toString('hex'))},'hex'),clock_timestamp(),clock_timestamp()+interval '1 day');
 INSERT INTO gridex_contract_source_intake.representations(id,company_id,environment,issuer_key_id,legal_actor_id,kind,legal_representation_reference,legal_authority_source_hash,valid_from,valid_to) VALUES(${literal(representation)},${literal(f.companyId)},'test',${literal(key)},${literal(nativeScope.legalActorId)},${literal(kind)},${literal(rep)},${literal(digest(rep))},clock_timestamp(),clock_timestamp()+interval '1 day');`)
 const purpose={masterdata_declaration:'signed_contract_customer_masterdata',contract_requested_method:'signed_contract_requested_metering_method',metering_method_event:'signed_contract_customer_agreed_method_event'}[kind]
 const now=clock(),bytes=Buffer.from(JSON.stringify({format:'ediel_contract_original_source_v1',agreementHash:digest(f.pdf),claims:{sourceReference:'SYNTHETIC FG '+randomUUID(),sourceVersion:'1',...claims},expiresAt:new Date(Date.parse(now)+3600000).toISOString(),issuedAt:now,issuerCode:'SYNTHETIC FG',legalAuthorityReference:legal,nativeScope,purpose,receiptId:randomUUID(),representationReference:rep}))
 const captured=await f.request.client.rpc('ediel_archive_contract_original_source_v1',{p_company_id:f.companyId,p_actor_user_id:f.request.id,p_contract_id:f.contractId,p_environment:'test',p_kind:kind,p_submission:{agreementBase64:f.pdf.toString('base64'),sourceBase64:bytes.toString('base64'),issuerKeyId:key,representationId:representation,signatureHex:hmac(signingKey,bytes)}})
 expect(captured.error).toBeNull();expect(captured.data).toMatchObject({status:'archived'});const a=captured.data as Omit<Artifact,'sourceId'>
 const reviewed=await f.reviewer.client.rpc('ediel_review_contract_original_source_v1',{p_company_id:f.companyId,p_actor_user_id:f.reviewer.id,p_artifact_id:a.artifactId,p_review:{sourceHash:a.sourceHash,agreementHash:a.agreementHash,claimsHash:a.claimsHash,decision:'approve',reason:'SYNTHETIC independently reviewed exact kind/source bytes'}})
 expect(reviewed.error).toBeNull();expect(reviewed.data).toMatchObject({status:'authorized'});const sourceId=(reviewed.data as {sourceId:string}).sourceId
 const read=await f.request.client.rpc('ediel_read_contract_original_source_v1',{p_company_id:f.companyId,p_actor_user_id:f.request.id,p_artifact_id:a.artifactId});expect(read.error).toBeNull()
 expect(read.data).toMatchObject({...a,sourceId,status:'authorized',kind,contractId:f.contractId,environment:'test',missing:[]})
 return{artifactId:a.artifactId,sourceId,sourceHash:a.sourceHash,agreementHash:a.agreementHash,claimsHash:a.claimsHash}
}
async function network(companyId:string,receiver:string,request:Actor,reviewer:Actor){
 stage='NETWORK_ORIGINAL'
 const networkActorId=sql<string>(`SELECT to_jsonb(actor_id) FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=${literal(receiver)} AND is_verified`),keyId=randomUUID(),representationId=randomUUID(),signingKey=secret(randomBytes(32)) as Buffer,legal='SYNTHETIC NETWORK ISSUER COMPETENCE ONLY',rep='SYNTHETIC NETWORK LEGAL REPRESENTATION ONLY'
 sql(`INSERT INTO gridex_network_registry_sources.issuer_keys(id,company_id,environment,network_actor_id,registry_version,legal_authority_reference,legal_authority_hash,receipt_signing_key,valid_from,valid_to) VALUES(${literal(keyId)},${literal(companyId)},'test',${literal(networkActorId)},'SYNTHETIC-FG-1',${literal(legal)},${literal(digest(legal))},decode(${literal(signingKey.toString('hex'))},'hex'),clock_timestamp(),clock_timestamp()+interval '1 day');INSERT INTO gridex_network_registry_sources.representations(id,company_id,environment,issuer_key_id,network_actor_id,legal_authority_reference,legal_authority_hash,valid_from,valid_to) VALUES(${literal(representationId)},${literal(companyId)},'test',${literal(keyId)},${literal(networkActorId)},${literal(rep)},${literal(digest(rep))},clock_timestamp(),clock_timestamp()+interval '1 day');`)
 const clause={locator:'page1 synthetic',quote:'SYNTHETIC exact dated network registry ONLY'}
 const now=clock(),source=Buffer.from(`%PDF-1.7\nSYNTHETIC FG network registry competence ONLY\n${clause.quote}\n%%EOF`),reference='SYNTHETIC-FG-network-'+randomUUID(),version='1'
 const base={environment:'test' as const,networkActorId,validFrom:new Date(Math.floor(Date.parse(now)/60000)*60000).toISOString(),validUntil:new Date(Math.floor((Date.parse(now)+3600000)/60000)*60000).toISOString(),source:{bytesBase64:source.toString('base64'),mimeType:'application/pdf' as const,reference,version}}
 const claims=sql<Record<string,unknown>>(`SELECT gridex_network_registry_sources.claims_v1(${literal(companyId)},${literal(base)}::jsonb)`),packet=Buffer.from(JSON.stringify({format:'ediel_network_registry_receipt_v1',receiptId:randomUUID(),claims,sourceHash:digest(source),sourceReference:reference,sourceVersion:version,registryVersion:'SYNTHETIC-FG-1',clause,issuedAt:now,expiresAt:new Date(Date.parse(now)+3600000).toISOString()}))
 const submission:NetworkRegistrySourceSubmission={...base,issuerReceipt:{keyId,representationId,payloadBase64:packet.toString('base64'),signatureHex:hmac(signingKey,packet)}}
 const a=await archiveNetworkRegistrySource({...submission,companyId,actorUserId:request.id});expect(a.missing).toEqual([])
 expect(await reviewNetworkRegistrySource({...a,companyId,actorUserId:reviewer.id,decision:'approve',reason:'SYNTHETIC separate current network review',clause})).toMatchObject({status:'authorized'})
}
async function foundation():Promise<Stage>{
 stage='FOUNDATION'
 const companyId=randomUUID(),customerId=randomUUID(),siteId=randomUUID(),pointId=randomUUID(),contractId=randomUUID(),gridId=randomUUID(),switchId=randomUUID(),routeId=randomUUID(),routeProfileId=randomUUID(),marketActor=randomUUID(),customerName='SYNTHETIC FG Own Customer',requestedStartDate=futureNativeSupplyDate(),customerIdentity='199001011234',brpEdielId='99876',marker={test_center:{kind:'invoice_test_customer'}}
 const first17='735123456789'+String(Math.floor(Math.random()*100000)).padStart(5,'0'),weighted=[...first17].reduce((sum,digit,index)=>sum+Number(digit)*(index%2===0?3:1),0),external=first17+String((10-weighted%10)%10)
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(companyId)},'SYNTHETIC FG disposable source preparation','active')`)
 const request=await actor(companyId),reviewer=await actor(companyId),actorUserId=request.id
 sql(`UPDATE public.company_capabilities SET enabled=true,readiness_status='ready' WHERE company_id=${literal(companyId)} AND capability_code='ediel_test'`)
 const sender=sql<string>(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('native_outbound_legal_actor_identifier',0));
 WITH available AS (SELECT candidate::text value FROM generate_series(40000,49999) candidate WHERE NOT EXISTS(SELECT FROM public.tenant_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=candidate::text) AND NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=candidate::text) ORDER BY candidate LIMIT 1), allocated AS (INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) SELECT ${literal(companyId)},'test',${literal(actorUserId)},'EdielId',value,clock_timestamp()-interval '1 day' FROM available RETURNING identifier_value) SELECT to_jsonb(identifier_value) FROM allocated;COMMIT;`)
 const receiver=sql<string>(`BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('native_outbound_dispatch_actor_identifier',0));WITH actor AS (INSERT INTO public.platform_market_actors(id,name,status,match_status,visible_to_tenants) VALUES(${literal(marketActor)},${literal(`Synthetic normal grid ${marketActor}`)},'active','verified',true) RETURNING id),available AS (SELECT candidate::text value FROM generate_series(60000,89999) candidate WHERE NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=candidate::text) ORDER BY candidate LIMIT 1),allocated AS (INSERT INTO public.platform_actor_identifiers(actor_id,identifier_type,identifier_value,is_verified) SELECT actor.id,'EdielId',available.value,true FROM actor CROSS JOIN available RETURNING identifier_value) SELECT to_jsonb(identifier_value) FROM allocated;COMMIT;`)
 const supplierEdielId=sender
 sql(`INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) VALUES(${literal(companyId)},'test','electricity',true,clock_timestamp()-interval '1 day');
 INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) VALUES(${literal(companyId)},'test',${literal(actorUserId)},'electricity_supplier',clock_timestamp()-interval '1 day');
 INSERT INTO public.ediel_actor_settings(company_id,environment,actor_name,actor_ediel_id,ediel_id) VALUES(${literal(companyId)},'test','Synthetic normal supplier',${literal(sender)},${literal(sender)});
 INSERT INTO public.ediel_brp_settings(company_id,environment,brp_ediel_id,brp_name) VALUES(${literal(companyId)},'test',${literal(brpEdielId)},'Synthetic native BRP');
 INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status,owner_code) VALUES(${literal(gridId)},${literal(companyId)},'Synthetic normal grid',${literal(receiver)},'test',true,'active','TES');
 INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email) VALUES(${literal(routeId)},${literal(companyId)},'Synthetic normal route','supplier_switch',${literal(gridId)},'bilateral_test',true,'recipient@example.invalid');
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,transport_security_mode,smtp_to,receiver_email,message_family,business_code) VALUES(${literal(routeProfileId)},${literal(companyId)},${literal(routeId)},'Synthetic normal profile','test','edifact',${literal(sender)},${literal(receiver)},'23-DDQ-PRODAT',true,'unencrypted','recipient@example.invalid','recipient@example.invalid','PRODAT','Z03');
 INSERT INTO public.platform_actor_roles(actor_id,actor_role,is_active) VALUES(${literal(marketActor)},'grid_owner',true);
 INSERT INTO public.platform_actor_routes(actor_id,message_family,environment,status,is_verified,application_reference,communication_type,communication_address,metadata) VALUES(${literal(marketActor)},'PRODAT','production','active',true,'23-DDQ-PRODAT','email','recipient@example.invalid','{"subaddress_status":"not_required_confirmed"}');
 INSERT INTO public.platform_actor_certificates(actor_id,environment,purpose,status,fingerprint_sha256,ediel_id,valid_to,raw_certificate_pem) VALUES(${literal(marketActor)},'production','encryption','valid','synthetic',${literal(receiver)},'2099-01-01','synthetic-readiness-only');`)
 const pricing={schema:'gridex_contract_pricing_v5',pricing_model:'spot',energy_direction:'consumption',interval_resolution:'hourly',vat_rate:0.25,
  price_areas:['SE3'],base_components:[{source_type:'spot',label:'Spotpris',weight_percent:100,price_area:'SE3'}],
  price_components:[{component_code:'spot_markup',component_type:'markup',name:'Påslag',calculation_type:'per_kwh',amount:4,unit:'ore_per_kwh',website_card_visible:true},
   {component_code:'monthly_fee',component_type:'fee',name:'Månadsavgift',calculation_type:'fixed_monthly',amount:49,unit:'sek_month',website_card_visible:true}]}
 const offer={name:`Synthetic archive ${contractId}`,slug:`synthetic-archive-${contractId}`,
  lifecycle_status:'draft',contract_type:'variable_hourly',customer_type:'both',pricing_model:'spot',energy_direction:'consumption',
  terms_version:'test-v1',spot_markup_ore_per_kwh:4,monthly_fee_sek:49,invoice_fee_sek:19,default_binding_months:0,
  default_notice_months:1,automatic_renewal:true,automatic_renewal_term_months:12,
  power_of_attorney_required:true,valid_from:'2026-09-24'}
 const organizationNumber=sql<string>(nativeFixtureCompanyIdentitySql(companyId,
  Array.from({length:32},(_,attempt)=>syntheticSwedishOrganizationNumber(`normal-switch:${companyId}:${attempt}`))))
 const {data:created,error:createError}=await supabaseService.rpc('gridex_upsert_internal_contract_offer_v2',{
  p_company_id:companyId,p_offer_id:null,p_payload:offer,p_pricing_snapshot:pricing,p_actor_user_id:actorUserId,
 })
 expect(createError).toBeNull()
 const canonical=created as {ok?:boolean;code?:string;offer?:{id?:string}} | null
 expect(canonical,JSON.stringify(canonical)).toMatchObject({ok:true})
 const offerId=canonical?.offer?.id
 expect(offerId).toMatch(/^[0-9a-f-]{36}$/)
 // Publication readiness is part of the real canonical contract path. All
 // routing and legal rows below belong only to this disposable synthetic tenant.
 sql(`INSERT INTO public.ediel_actor_settings(company_id,environment,actor_name,actor_ediel_id,ediel_id)
  VALUES(${literal(companyId)},'production','Synthetic archive supplier',${literal(supplierEdielId)},${literal(supplierEdielId)});
  INSERT INTO public.ediel_brp_settings(company_id,environment,brp_ediel_id,brp_name)
  VALUES(${literal(companyId)},'production',${literal(brpEdielId)},'Synthetic BRP');
  INSERT INTO public.ediel_route_profiles(company_id,environment,route_name,message_family)
  VALUES(${literal(companyId)},'production','Synthetic PRODAT','PRODAT'),
   (${literal(companyId)},'production','Synthetic UTILTS','UTILTS');
  INSERT INTO public.company_email_settings(company_id,sender_name,sender_email,verification_status)
  VALUES(${literal(companyId)},'Synthetic Archive','synthetic@example.invalid','verified');
  INSERT INTO public.company_email_templates(company_id,template_key,name,subject,body_html,is_active)
  VALUES(${literal(companyId)},'contract.confirmation_sent','Synthetic confirmation',
   'Synthetic confirmation','<p>Synthetic confirmation</p>',true);
  INSERT INTO public.email_event_rules(company_id,event_key,template_key,enabled)
  VALUES(${literal(companyId)},'contract.confirmation_sent','contract.confirmation_sent',true);
  UPDATE public.tenant_legal_profiles SET legal_name='Synthetic Archive AB',organization_number=${literal(organizationNumber)},
   postal_address='{"address_line_1":"Testgatan 1","postal_code":"123 45","city":"Teststad","country_code":"SE"}',
   customer_service_email='service@example.invalid',phone='0101234567',website='https://example.invalid',
   complaints_contact='{"email":"complaints@example.invalid"}',
   data_protection_contact='{"email":"privacy@example.invalid"}',
   billing_information='{"email":"billing@example.invalid"}',
   dispute_resolution_information='{"authority":"ARN","description":"Synthetic dispute contact for archive fixture"}',
   source_company_snapshot=(SELECT public.gridex_company_legal_profile_defaults(to_jsonb(c))->'source_company_snapshot'
    FROM public.companies c WHERE c.id=${literal(companyId)}),
   source_company_snapshot_sha256=(SELECT public.gridex_company_legal_profile_defaults(to_jsonb(c))->>'source_company_snapshot_sha256'
    FROM public.companies c WHERE c.id=${literal(companyId)}),
   review_required=false,reviewed_at=now() WHERE company_id=${literal(companyId)};`)
 expect(sql(`SELECT to_jsonb(has_actor_setting AND has_brp AND has_prodat_route AND has_utilts_route AND has_sender_identity)
  FROM public.platform_go_live_readiness_v WHERE company_id=${literal(companyId)}`)).toBe(true)
 expect(sql(`SELECT jsonb_build_object('verified',completeness_status='verified' AND NOT review_required,
  'missing',missing_fields,'source',source_company_snapshot->>'legal_name_source')
  FROM public.tenant_legal_profiles WHERE company_id=${literal(companyId)}`)).toEqual({verified:true,missing:[],source:'tenant_explicit'})
 const legalVersionId=sql<string>(`SELECT to_jsonb(public.gridex_materialize_legal_bundle_version(
  ${literal(companyId)},(SELECT contract_product_version_id FROM public.contract_offers WHERE id=${literal(offerId)}),
  NULL,${literal(actorUserId)}))`)
 expect(legalVersionId).toMatch(/^[0-9a-f-]{36}$/)
 sql(`UPDATE public.contract_offers SET legal_bundle_version_id=${literal(legalVersionId)} WHERE id=${literal(offerId)};`)
 const {data:published,error:publishError}=await supabaseService.rpc('gridex_publish_internal_contract_version',{
  p_company_id:companyId,p_offer_id:offerId,p_actor_user_id:actorUserId,
 })
 expect(publishError).toBeNull()
 expect(published,JSON.stringify(published)).toMatchObject({ok:true,mode:'published'})
 // Channel publication snapshots an active template tied to these immutable
 // product and plan versions. Give this synthetic offer one selectable price.
 sql(`WITH template AS (
  INSERT INTO public.contract_price_options(company_id,contract_product_version_id,
   price_plan_version_id,option_reference,option_code,customer_name,contract_type,
   binding_months,notice_months,auto_renew_enabled,renewal_term_months,status,
   customer_type,is_default,selection_required,created_by)
  SELECT ${literal(companyId)},contract_product_version_id,price_plan_version_id,
   'archive-default','archive-default','Synthetic hourly price','variable_hourly',
   0,1,true,12,'active','both',true,false,${literal(actorUserId)}
  FROM public.contract_offers WHERE id=${literal(offerId)}
  RETURNING id,company_id,price_plan_version_id
 ) INSERT INTO public.contract_price_option_area_prices(company_id,contract_price_option_id,
  price_plan_version_id,price_row_reference,price_area,amount,unit,created_by)
 SELECT company_id,id,price_plan_version_id,'archive-se3','SE3',4,'ore_per_kwh',
  ${literal(actorUserId)} FROM template;`)
 const {data:channel,error:channelError}=await supabaseService.rpc('gridex_publish_contract_channel',{
  p_company_id:companyId,p_offer_id:offerId,p_channel:'internal',p_actor_user_id:actorUserId,
 })
 expect(channelError).toBeNull()
 expect(channel,JSON.stringify(channel)).toMatchObject({ok:true,channel:'internal'})
 const publicationVersionId=(channel as {contract_publication_version_id?:string}|null)?.contract_publication_version_id
 expect(publicationVersionId).toMatch(/^[0-9a-f-]{36}$/)
 expect(sql(`SELECT to_jsonb(contract_product_version_id IS NOT NULL AND price_plan_version_id IS NOT NULL
  AND legal_bundle_version_id IS NOT NULL) FROM public.contract_offers WHERE id=${literal(offerId)}`)).toBe(true)
 sql(`INSERT INTO public.customers(id,company_id,first_name,last_name,name,customer_number,personal_number,email,source,is_test_data,metadata)
  VALUES(${literal(customerId)},${literal(companyId)},'Synthetic','Archive',${literal(customerName)},${literal(customerId)},${literal(customerIdentity)},${literal(`synthetic-${customerId}@example.invalid`)},'invoice_test_center',true,${literal(marker)}::jsonb);
  INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,facility_id,grid_owner_id,grid_area_code,price_area_code,status,is_test_data,metadata)
  VALUES(${literal(siteId)},${literal(companyId)},${literal(customerId)},'Archive site',${literal(external)},${literal(gridId)},'TES','SE3','active',true,${literal(marker)}::jsonb);
  INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,meter_point_id,metering_point_id,ediel_metering_point_id,grid_owner_id,grid_owner_ediel_id,grid_area_code,price_area_code,status,reading_frequency,measurement_type,product_direction,is_settlement_relevant,is_test_data,metadata)
  VALUES(${literal(pointId)},${literal(companyId)},${literal(customerId)},${literal(siteId)},${literal(siteId)},${literal(external)},${literal(external)},${literal(external)},${literal(gridId)},${literal(receiver)},'TES','SE3','active','hourly','consumption','consumption',true,true,${literal(marker)}::jsonb);
  INSERT INTO public.customer_contracts(id,company_id,customer_id,site_id,metering_point_id,
   contract_offer_id,status,contract_version,requested_start_date,starts_at,metadata,created_by,contract_publication_version_id,
   contract_product_id,contract_product_version_id,price_plan_id,price_plan_version_id,
   price_book_id,legal_bundle_version_id,offer_reference,commercial_snapshot,legal_snapshot)
  SELECT ${literal(contractId)},${literal(companyId)},${literal(customerId)},${literal(siteId)},
   ${literal(pointId)},${literal(offerId)},'draft','v1',${literal(requestedStartDate)}::date,${literal(requestedStartDate)}::date,${literal(marker)}::jsonb,
   ${literal(actorUserId)},v.id,p.contract_product_id,v.contract_product_version_id,
   v.price_plan_id,v.price_plan_version_id,v.price_book_id,v.legal_bundle_version_id,
   v.offer_reference,p.commercial_snapshot,l.rendered_snapshot
  FROM public.contract_publication_versions v
  JOIN public.contract_product_versions p ON p.id=v.contract_product_version_id
  JOIN public.legal_bundle_versions l ON l.id=v.legal_bundle_version_id
  WHERE v.id=${literal(publicationVersionId)} AND v.status='published';`)
 expect(sql(`SELECT to_jsonb(contract_publication_version_id IS NOT NULL AND contract_product_version_id IS NOT NULL
  AND price_plan_version_id IS NOT NULL AND legal_bundle_version_id IS NOT NULL)
  FROM public.customer_contracts WHERE id=${literal(contractId)}`)).toBe(true)
 {
  const signed=await signContractWithRegisteredToken({companyId,customerId,contractId,actorUserId})
  expect(signed).toMatchObject({status:'signed',signature_snapshot_sha256:expect.stringMatching(/^[a-f0-9]{64}$/)})
  const signedFacts=sql<{old:string;next:string;signedAt:string|null}[]>(`SELECT jsonb_agg(jsonb_build_object(
   'old',old_fact->>'status','next',new_fact->>'status','signedAt',new_fact->>'signed_at') ORDER BY id)
   FROM gridex_correction_process.facts WHERE table_name='customer_contracts' AND row_id=${literal(contractId)}
    AND operation='UPDATE' AND new_fact->>'status'='signed'`)
  expect(signedFacts).toEqual([{old:'pending_signature',next:'signed',signedAt:expect.any(String)}])
 }

 // The native PDF archive is produced from the actual signed publication and
 // signature records. Its digest is bound once through the ordinary document
 // owner; a ready flag never substitutes for storage/readback evidence.
 const signed=sql<Record<string,unknown>>(`SELECT to_jsonb(c) FROM public.customer_contracts c WHERE id=${literal(contractId)}`)
 const legalVersions=sql<{type:string;title:string;version:string;id:string;body:string}[]>(`SELECT jsonb_agg(jsonb_build_object('type',module_key,'title',title,'version',coalesce(template_version,left(content_sha256,12)),'id',id,'body',rendered_body)) FROM public.legal_bundle_version_documents WHERE legal_bundle_version_id=${literal(signed.legal_bundle_version_id)}`)
 const attachment=buildAgreementPdfAttachment({companyName:'Synthetic Archive AB',organizationNumber,customerName,customerEmail:`synthetic-${customerId}@example.invalid`,customerNumber:customerId,contractNumber:String(signed.contract_number??contractId),contractName:'Synthetic native hourly',contractType:'variable_hourly',signedAt:String(signed.signed_at),startsAt:requestedStartDate,offerReference:String(signed.offer_reference),contractPublicationVersionId:String(signed.contract_publication_version_id),pricePlanVersionId:String(signed.price_plan_version_id),legalBundleVersionId:String(signed.legal_bundle_version_id),signatureSnapshotSha256:String(signed.signature_snapshot_sha256),legalVersions,monthlyFeeSek:49,spotMarkupOrePerKwh:4})
 const pdfBuffer=Buffer.from(attachment.content,'base64'),documentSha256=createHash('sha256').update(pdfBuffer).digest('hex')
 await archiveSignedCustomerContractPdf({companyId,customerContractId:contractId,pdfBuffer,documentSha256,generationSnapshot:{schema:'gridex_signed_contract_document_v1',contract_id:contractId,signature_snapshot_sha256:signed.signature_snapshot_sha256,synthetic:true}})
 const bound=await supabaseService.from('customer_contracts').update({document_sha256:documentSha256}).eq('id',contractId).eq('company_id',companyId).is('document_sha256',null);expect(bound.error).toBeNull()

 await network(companyId,receiver,request,reviewer)
 const storedDoc=await supabaseService.storage.from('customer-contract-documents').download(sql<string>(`SELECT to_jsonb(storage_path) FROM public.customer_contract_documents WHERE customer_contract_id=${literal(contractId)} AND company_id=${literal(companyId)} AND document_sha256=${literal(documentSha256)} ORDER BY id LIMIT 1`));expect(storedDoc.error).toBeNull();expect(digest(Buffer.from(await storedDoc.data!.arrayBuffer()))).toBe(documentSha256)
 const brpActor=sql<string>(`BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('native_brp_actor_${brpEdielId}',0));
 WITH existing AS (SELECT actor_id FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=${literal(brpEdielId)} ORDER BY actor_id LIMIT 1),
 created AS (INSERT INTO public.platform_market_actors(id,name,status,match_status,visible_to_tenants) SELECT gen_random_uuid(),'Synthetic native BRP','active','verified',true WHERE NOT EXISTS(SELECT FROM existing) RETURNING id),
 ident AS (INSERT INTO public.platform_actor_identifiers(actor_id,identifier_type,identifier_value,is_verified) SELECT id,'EdielId',${literal(brpEdielId)},true FROM created RETURNING actor_id)
 SELECT to_jsonb(coalesce((SELECT actor_id FROM existing),(SELECT actor_id FROM ident)));COMMIT;`)
 sql(`INSERT INTO public.platform_actor_roles(actor_id,actor_role,is_active) SELECT ${literal(brpActor)},'balance_responsible',true WHERE NOT EXISTS(SELECT FROM public.platform_actor_roles WHERE actor_id=${literal(brpActor)} AND actor_role='balance_responsible' AND is_active);
 INSERT INTO public.platform_actor_roles(actor_id,actor_role,is_active) SELECT ${literal(marketActor)},'grid_owner',true WHERE NOT EXISTS(SELECT FROM public.platform_actor_roles WHERE actor_id=${literal(marketActor)} AND actor_role='grid_owner' AND is_active)`)
 const registryGroundId=randomUUID(),brpRegistrySource=Buffer.from('SYNTHETIC BRP registry ground '+registryGroundId)
 sql(`INSERT INTO gridex_brp_changes.registry_grounds(id,company_id,environment,dso_actor_id,brp_actor_id,dso_ediel_id,brp_ediel_id,grid_area_code,registry_version,source_reference,source_sha256,registry_snapshot,approved_by,approved_at,valid_from)
  SELECT ${literal(registryGroundId)},${literal(companyId)},'test',${literal(marketActor)},${literal(brpActor)},${literal(receiver)},${literal(brpEdielId)},p.grid_area_code,'SYNTHETIC-1',${literal('SYNTHETIC native BRP registry '+registryGroundId)},${literal(createHash('sha256').update(brpRegistrySource).digest('hex'))},gridex_brp_changes.registry_snapshot_v1(${literal(marketActor)},${literal(brpActor)}),${literal(actorUserId)},clock_timestamp(),clock_timestamp()
  FROM public.metering_points p WHERE p.id=${literal(pointId)}`)
 const brpUploader=request,brpReviewer=reviewer
 const brpSelector={environment:'test' as const,contractId,registryGroundId,identityAgency:'9' as const}
 const brpScope=await brpUploader.client.rpc('ediel_signed_brp_declaration_scope_v1',{p_company_id:companyId,p_actor_user_id:brpUploader.id,p_selector:{...brpSelector,agreementHash:documentSha256}})
 expect(brpScope.error,JSON.stringify(brpScope.error)).toBeNull();expect(brpScope.data,JSON.stringify(brpScope.data)).toMatchObject({status:'scope_available'})
 const brpKey=randomUUID(),brpRepresentation=randomUUID(),brpSecret=secret(randomBytes(32)) as Buffer,brpLegal='SYNTHETIC BRP DECLARATION ISSUER ONLY',brpRepresentationLegal='SYNTHETIC BRP DECLARATION REPRESENTATION ONLY'
 sql(`INSERT INTO gridex_brp_declaration_intake.issuer_keys(id,company_id,environment,issuer_code,legal_source_reference,legal_source_sha256,signing_key,valid_from,valid_to) VALUES(${literal(brpKey)},${literal(companyId)},'test','SYNTHETIC',${literal(brpLegal)},${literal(createHash('sha256').update(brpLegal).digest('hex'))},decode(${literal(brpSecret.toString('hex'))},'hex'),clock_timestamp(),clock_timestamp()+interval '1 day');
 INSERT INTO gridex_brp_declaration_intake.issuer_representations(id,company_id,environment,issuer_key_id,legal_actor_id,purpose,legal_source_reference,legal_source_sha256,valid_from,valid_to) VALUES(${literal(brpRepresentation)},${literal(companyId)},'test',${literal(brpKey)},${literal((brpScope.data as {claims:{legalActorId:string}}).claims.legalActorId)},'signed_contract_brp_declaration',${literal(brpRepresentationLegal)},${literal(createHash('sha256').update(brpRepresentationLegal).digest('hex'))},clock_timestamp(),clock_timestamp()+interval '1 day')`)
 const brpSource=Buffer.from('SYNTHETIC signed BRP declaration source '+contractId),brpSourceReference='SYNTHETIC-native-brp-'+contractId
 const brpClaimsHash=(brpScope.data as {claimsHash:string}).claimsHash,issuedAt=clock(),expiresAt=new Date(Date.parse(issuedAt)+3600000).toISOString()
 const brpPayload=Buffer.from(JSON.stringify({format:'ediel_signed_brp_declaration_receipt_v1',purpose:'signed_contract_brp_declaration',companyId,environment:'test',issuerCode:'SYNTHETIC',receiptId:randomUUID(),issuerLegalReference:brpLegal,representationLegalReference:brpRepresentationLegal,claimsHash:brpClaimsHash,agreementHash:documentSha256,sourceHash:createHash('sha256').update(brpSource).digest('hex'),sourceReference:brpSourceReference,sourceVersion:'1',issuedAt,expiresAt}))
 const brpArchive=await brpUploader.client.rpc('ediel_archive_signed_brp_declaration_v1',{p_company_id:companyId,p_actor_user_id:brpUploader.id,p_submission:{...brpSelector,agreementBase64:pdfBuffer.toString('base64'),sourceBase64:brpSource.toString('base64'),sourceReference:brpSourceReference,sourceVersion:'1',issuerReceipt:{keyId:brpKey,representationId:brpRepresentation,payloadBase64:brpPayload.toString('base64'),signatureHex:hmac(brpSecret,brpPayload)}}})
 expect(brpArchive.error,JSON.stringify(brpArchive.error)).toBeNull();expect(brpArchive.data).toMatchObject({status:'archived',issuerQualified:true})
 const archivedBrp=brpArchive.data as {artifactId:string;agreementHash:string;sourceHash:string;claimsHash:string}
 const brpReview=await brpReviewer.client.rpc('ediel_review_signed_brp_declaration_v1',{p_company_id:companyId,p_actor_user_id:brpReviewer.id,p_artifact_id:archivedBrp.artifactId,p_review:{agreementHash:archivedBrp.agreementHash,sourceHash:archivedBrp.sourceHash,claimsHash:archivedBrp.claimsHash,decision:'approve',reason:'SYNTHETIC separate review of the signed BRP declaration',clause:{locator:'page1 synthetic',quote:'SYNTHETIC balance responsible party declaration'}}})
 expect(brpReview.error,JSON.stringify(brpReview.error)).toBeNull();expect(brpReview.data,JSON.stringify(brpReview.data)).toMatchObject({status:'authorized'})

 const intake={companyId,contractId,pdf:pdfBuffer,request,reviewer},now=clock()
 await archive(intake,'masterdata_declaration',{customerIdentity:{id:customerIdentity,qualifier:'SE2',agency:'260'},endUserMasterdata:{nameParts:[customerName],streetParts:['Testgatan 1'],postalCode:'123 45',city:'Teststad',country:'SE'},validFrom:now,validTo:new Date(Date.parse(now)+90*86400000).toISOString()})
 const initialDeclaration=await archive(intake,'contract_requested_method',{previousDeclarationId:null,requestedMethod:'Z04'})
 // Explicit test-only manual authorization is created by its existing public
 // admin writer and exact chain helper. It is a declared synthetic legal fact,
 // never a private owner receipt or claim of real customer authentication.
 const poaReference=`POA${switchId.replace(/-/g,'').slice(0,12).toUpperCase()}`
 const poa=await savePowerOfAttorney(supabaseService,{customer_id:customerId,site_id:siteId,companyId,reference:poaReference,scope:'supplier_switch',status:'draft',signed_at:null,valid_from:'2026-01-01',valid_to:'2099-01-01',method:'manual_pdf',signer_name:customerName,signer_identity_number:customerIdentity,accepted_at:null,accepted_source:'synthetic_native_fixture',signedScopes:['supplier_switch','grid_owner_data','metering_data'],scopeSummary:{scopes:['supplier_switch','grid_owner_data','metering_data']}})
 const poaLink=await supabaseService.from('powers_of_attorney').update({contract_id:contractId,customer_contract_id:contractId}).eq('id',poa.id).eq('company_id',companyId);expect(poaLink.error).toBeNull()
 await savePowerOfAttorney(supabaseService,{id:poa.id,customer_id:customerId,site_id:siteId,companyId,reference:poaReference,scope:'supplier_switch',status:'signed',signed_at:new Date().toISOString(),valid_from:'2026-01-01',valid_to:'2099-01-01',method:'manual_pdf',signer_name:customerName,signer_identity_number:customerIdentity,accepted_at:new Date().toISOString(),accepted_source:'synthetic_native_fixture',signedScopes:['supplier_switch','grid_owner_data','metering_data'],scopeSummary:{scopes:['supplier_switch','grid_owner_data','metering_data']}})
 const poaScopes=['supplier_switch','grid_owner_data','metering_data']
 const authorization=await ensureAuthorizationDocumentFromPowerOfAttorney({companyId,customerId,powerOfAttorneyId:poa.id,siteId,meteringPointId:pointId,contractId,coverage:powerOfAttorneyCoverageFromScopes(poaScopes),signedScopes:poaScopes})
 const authorizationDocumentId=authorization.authorizationDocumentId;expect(authorizationDocumentId).toBeTruthy()
 expect(sql(`SELECT to_jsonb(switch_ready) FROM public.customer_contract_lifecycle_readiness_v WHERE customer_contract_id=${literal(contractId)}`)).toBe(true)
 // P26.A: the invoicee is an independent caller selection, never inferred.
 // The synthetic selection names the end user at the same address.
 const invoiceeAddress={lines:['Testgatan 1','',''],postalCode:'123 45',city:'Teststad',country:'SE',representation:{convention:'original',reference:'SYNTHETIC',mode:1}}
 const invoiceeSnapshot={portalData:{powerOfAttorneyReference:poaReference,dependentConditionFacts:{invoiceeObjects:[{meteringPointId:external,identityAgency:'9',
  endUser:{identity:{id:customerIdentity,qualifier:'SE2',agency:'260'},address:invoiceeAddress},
  invoicee:{identity:{id:customerIdentity,qualifier:'SE2',agency:'260'},nameLines:[customerName],address:invoiceeAddress,availability:'available'},
  event:{state:'none',reference:`fixture-invoicee:${switchId}`},source:{kind:'caller_selection',companyId,reference:`fixture-invoicee:${switchId}`}}]}}}
 sql(`INSERT INTO public.supplier_switch_requests(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,grid_owner_id,contract_id,customer_contract_id,power_of_attorney_id,authorization_document_id,request_type,status,requested_start_date,prodat_variant,prodat_reason,lifecycle_blocked,validation_snapshot) VALUES(${literal(switchId)},${literal(companyId)},${literal(customerId)},${literal(siteId)},${literal(siteId)},${literal(pointId)},${literal(gridId)},${literal(contractId)},${literal(contractId)},${literal(poa.id)},${literal(authorizationDocumentId)},'switch','ready',${literal(requestedStartDate)},'L','Z22',false,${literal(JSON.stringify(invoiceeSnapshot))}::jsonb);`)

 const result:Stage={companyId,actorUserId,customerId,siteId,pointId,contractId,switchId,external,sender,receiver,gridId,routeId,routeProfileId,marketActorId:marketActor,customerIdentity:{id:customerIdentity,qualifier:'SE2',agency:'260'},requestedStartDate,brpEdielId,gridAreaCode:'TES',documentSha256,authorizationDocumentId:authorizationDocumentId!,powerOfAttorneyId:poa.id,request,reviewer,pdf:pdfBuffer,initialDeclaration}
 expect(sql(`SELECT jsonb_build_object('originals',(SELECT count(*) FROM gridex_received_sources.switch_originals WHERE company_id=${literal(companyId)}),'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(companyId)}))`)).toEqual({originals:0,periods:0})
 return result
}

// Byte-identical SQL source literal to the immutable consumer, without importing its test registrations.
const backendIdentitySql=`SELECT jsonb_build_object(
 'engineSchemaVersion',public.canonical_current_ediel_engine_schema_version(),
 'migrationVersion',(SELECT max(version) FROM supabase_migrations.schema_migrations),
 'functionDefinitionsSha256',(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'||pg_get_functiondef(p.oid),E'\\n' ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'UTF8')),'hex')
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind='f' AND
 (n.nspname LIKE 'gridex_%' OR n.nspname='public' AND(p.proname LIKE 'ediel_%' OR p.proname LIKE 'gridex_%' OR p.proname='canonical_current_ediel_engine_schema_version'))))`

async function baseline(f:Stage){
 stage='Z03_AND_PHYSICAL_Z04'
 const queued=await prepareAndQueueEdielZ03({actorUserId:f.actorUserId,switchRequestId:f.switchId,communicationRouteId:f.routeId,environment:'test'})
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.switch_originals WHERE message_id=${literal(queued.id)}`)).toBe(1)
 await sendEdielMessageViaSmtp(queued,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})
 const sent=await getEdielMessageById(queued.id);expect(sent?.message_sent_at).toBeTruthy()
 expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m WHERE id=${literal(queued.id)}`)).toBe(true)
 const tokenized=tokenizeEdifact(sent!.raw_payload!),li=tokenized.segments.find(t=>t.tag==='RFF'&&segmentComposite(t,1,tokenized.una)[0]==='LI'),caseReference=li?segmentComposite(li,1,tokenized.una)[1]:null;expect(caseReference).toBeTruthy()
 // The canonical intake stores message_received_at as a millisecond ISO
 // instant (inboundStatusUpdater.ts:457). Retained mail, reception and source
 // must name the same instant, so the DB-clock receipt is millisecond-exact.
 const wire=buildCancellationProspectiveZ04({...f,caseReference:caseReference!}),receivedAt=new Date(Date.parse(clock())).toISOString()
 expect(Date.parse(receivedAt)).toBeGreaterThanOrEqual(Date.parse(sent!.message_sent_at!))
 const mail=await seedOriginalMailboxNative(sql,literal,{companyId:f.companyId,environment:'test',raw:wire,receivedAt,smtpFrom:assertEdielSmtpReadiness().from})
 const outboundMatch=await matchOutboundRequestForInbound({companyId:f.companyId,parsed:mail.parsed,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId}),meteringPointMatch=await matchMeteringPointForInbound({companyId:f.companyId,parsed:mail.parsed})
 const id=await createInboundEdielMessage({companyId:f.companyId,actorUserId:f.actorUserId,environment:'test',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed,outboundMatch,meteringPointMatch});expect(id).toMatch(/^[0-9a-f-]{36}$/)
 const message=(await getEdielMessageById(id!))!;expect(message).toMatchObject({company_id:f.companyId,environment:'test',direction:'inbound',message_code:'Z04',raw_payload:wire,inbound_email_message_id:mail.inboundEmailMessageId})
 expect(Date.parse(message.message_received_at!)).toBe(Date.parse(receivedAt))
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_inbound_receptions.receptions WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(id)} AND inbound_email_message_id=${literal(mail.inboundEmailMessageId)} AND parse_result_id=${literal(mail.parseResultId)} AND classification='first_reception' AND canonical_payload_hash=${literal(digest(wire))}`)).toBe(1)
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message,{actorUserId:f.actorUserId});expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision]).toEqual(['accepted','accepted','accepted'])
 const validation=await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:f.companyId,decision});expect(validation.status).toBe('recorded')
 await captureFreshEdielSourceRulePackEvidence(f.companyId,message.id)
 const session=createReceivedSourceOwnerSession(validation);expect(session).not.toBeNull()
 // Keep the first native apply behind the state machine's same pure entry
 // classification, after canonical validation and the one-use source session.
 expect(message).toMatchObject({message_family:'PRODAT'})
 expect(decideProdatLifecycle(message)?.outcome).toBe('supplier_switch_accepted')
 const supply=await applySupplyMarketSource({actorUserId:f.actorUserId,message})
 const switched=await applyInboundBusinessStateMachine({message,actorUserId:f.actorUserId,matchedSwitchRequestId:f.switchId,onSourceSwitchCommitted:session!.onSwitchCommitted,committedSupplyResult:supply})
 if(switched.outcome!=='supplier_switch_accepted'){
  // Diagnose only the retained first native result; never invoke a writer again.
  // Exactly the fields ediel_apply_supply_source_v1 checks (20261001043234:195-196):
  // leaf count, leaf syntax/functional decisions, application header, and the
  // first leaf issue code. Closed enums/fixed codes only; a/m/r abbreviations.
  const ab=(v:unknown)=>({accepted:'a',manual_review:'m',rejected:'r'} as Record<string,string>)[String(v)]??'x'
  const ledger=sql<{leaves:number;syn:string|null;fun:string|null;hdr:string|null;issue:string|null}>(`SELECT jsonb_build_object('leaves',(SELECT count(*) FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=${literal(message.id)} AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments c WHERE c.previous_assessment_id=v.id)),
   'syn',l.facts_text::jsonb->>'syntaxDecision','fun',l.facts_text::jsonb->>'functionalDecision','hdr',(SELECT f.application_facts_text::jsonb->>'headerDecision' FROM gridex_received_sources.prodat_application_facets f WHERE f.assessment_id=l.id),
   'issue',lower(l.facts_text::jsonb#>>'{issues,0,code}')) FROM (SELECT v.* FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=${literal(message.id)} AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments c WHERE c.previous_assessment_id=v.id) ORDER BY v.id LIMIT 1) l`)
  const ledgerLabel=`fg_z04_leaf${ledger.leaves}_s${ab(ledger.syn)}_f${ab(ledger.fun)}_h${ab(ledger.hdr)}_${ledger.issue??'noissue'}`
  if(!supply.applied&&supply.reason==='supply_complete_own_application_and_function_required')throw Error(ledgerLabel.replace(/[^a-z0-9_]/g,'_').slice(0,80))
  throw Error(['fg_baseline_switch',switched.outcome,supply.applied?'applied_before_projection':supply.reason??'no_reason',...(supply.partition??[]).filter(entry=>entry.disposition!=='applied').slice(0,1).map(entry=>('reason' in entry?String(entry.reason):'held'))].join('_').replace(/[^a-z0-9_]/g,'_').slice(0,80))
 }
 await session!.finish()
 const review=await reviewReceivedStructuralSource({companyId:f.companyId,environment:'test',sourceMessageId:message.id,reviewerUserId:f.reviewer.id,confirmedOriginal:true,replacesSourceMessageId:null})
 if(review.status!=='recorded'||review.sourceDisposition!=='accepted'){
  // Value-free diagnosis: closed receipt enums plus the owner's own fixed
  // reason-code prefixes (text before any ':'), never ids, SQL or payloads.
  const reasons=review.status==='recorded'?sql<string[]>(`SELECT coalesce(jsonb_agg(DISTINCT lower(split_part(r,':',1))),'[]') FROM gridex_received_sources.object_assessments a CROSS JOIN LATERAL jsonb_array_elements((a.facts_text::jsonb)->'objects') o CROSS JOIN LATERAL jsonb_array_elements_text(o->'reasons') r WHERE a.id=${literal(review.assessmentId)}`):[]
  throw Error(['fg_baseline_review',review.status,review.sourceDisposition,...reasons].join('_').replace(/[^a-z0-9_]/g,'_').slice(0,80))
 }
 const period=sql<string>(`SELECT to_jsonb(id) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(message.id)} AND metering_point_id=${literal(f.pointId)}`);expect(period).toMatch(/^[0-9a-f-]{36}$/)
 return{source:message.id,period}
}
async function qualifiedSupply(f:Stage,b:{source:string;period:string},effectiveAt:string){
 const supply=await supabaseService.rpc('ediel_read_source_supply_at_v1',{p_company_id:f.companyId,p_actor_user_id:f.reviewer.id,p_period_id:b.period,p_at:effectiveAt})
 expect(supply.error).toBeNull();expect(supply.data).toMatchObject({qualified:true,companyId:f.companyId,periodId:b.period,customerId:f.customerId,siteId:f.siteId,meteringPointId:f.pointId,initialSourceMessageId:b.source})
 expect(sql(`SELECT to_jsonb(start_date) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)} AND id=${literal(b.period)}`)).toBe(f.requestedStartDate)
 const baseline=await getEdielMessageById(b.source)
 // Intake binds customer/site from the matched sent Z03 request; a Z04 L names
 // its point only in LIN, which the intake point matcher does not read
 // (inboundMatcher.ts:234-262), so metering_point_id stays null by design.
 // The canonical point binding is the source-owned supply period (and the
 // supply read above), asserted exactly here.
 expect(baseline).toMatchObject({company_id:f.companyId,environment:'test',direction:'inbound',message_family:'PRODAT',message_code:'Z04',customer_id:f.customerId,site_id:f.siteId})
 expect(sql(`SELECT jsonb_build_object('source',source_message_id,'point',metering_point_id,'customer',customer_id,'company',company_id) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)} AND id=${literal(b.period)}`)).toEqual({source:b.source,point:f.pointId,customer:f.customerId,company:f.companyId})
 expect(baseline?.raw_payload).toBeTruthy()
}
async function currentArtifact(f:Stage,a:Artifact,kind:'contract_requested_method'|'metering_method_event'){
 const read=await f.request.client.rpc('ediel_read_contract_original_source_v1',{p_company_id:f.companyId,p_actor_user_id:f.request.id,p_artifact_id:a.artifactId})
 expect(read.error).toBeNull();expect(read.data).toMatchObject({...a,status:'authorized',kind,contractId:f.contractId,environment:'test',missing:[],nativeScope:{companyId:f.companyId,contractId:f.contractId,customerId:f.customerId,siteId:f.siteId,meteringPointId:f.pointId,pointId:f.external,identityAgency:'9',legalSenderId:f.sender,legalReceiverId:f.receiver,gridArea:f.gridAreaCode,agreementHash:digest(f.pdf)}})
}
async function profile(subtype:'F'|'G'):Promise<Profile>{
 const f=await foundation(),b=await baseline(f)
 stage='FINAL_'+subtype+'_ORIGINALS'
 const baselineMarketMinute=f.requestedStartDate.replaceAll('-','')+'0000',date=new Date(f.requestedStartDate+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+2)
 const effectiveMarketMinute=date.toISOString().slice(0,10).replaceAll('-','')+'0000',effectiveAt=prodatMarketMinuteToUtc(effectiveMarketMinute);expect(effectiveAt).toBeTruthy()
 await qualifiedSupply(f,b,effectiveAt!)
 // The supporting initial declaration remained the sole current leaf through
 // actual Z03 dispatch and Z04 intake. Only now add its one legitimate child.
 const declaration=await archive(f,'contract_requested_method',{previousDeclarationId:f.initialDeclaration.sourceId,requestedMethod:subtype==='F'?'Z04':'Z03'})
 const event=await archive(f,'metering_method_event',{effectiveAt,requestedMethodDeclarationId:declaration.sourceId,subtype,supplyPeriodId:b.period})
 const basis=await readMeteringMethodChangeSource({companyId:f.companyId,eventId:event.sourceId,actorUserId:f.request.id});expect(basis.status).toBe('authorized')
 if(basis.status!=='authorized')throw Error('fg_current_method_source_required')
 expect(basis).toMatchObject({companyId:f.companyId,environment:'test',eventId:event.sourceId,supplyPeriodId:b.period,supplySourceMessageId:b.source,contractId:f.contractId,customerId:f.customerId,siteId:f.siteId,meteringPointId:f.pointId,pointId:f.external,identityAgency:'9',legalSenderId:f.sender,legalReceiverId:f.receiver,gridArea:f.gridAreaCode,brpEdielId:f.brpEdielId,subtype,reason:subtype==='F'?'E64':'E32',method:subtype==='F'?'Z04':'Z03'})
 expect(prodatDate203(basis.effectiveAt)).toBe(effectiveMarketMinute)
 await currentArtifact(f,declaration,'contract_requested_method');await currentArtifact(f,event,'metering_method_event')
 await qualifiedSupply(f,b,effectiveAt!)
 const selected=await readQualifiedCustomerStructure({companyId:f.companyId,customerId:f.customerId,siteId:f.siteId,meteringPointId:f.pointId,actorUserId:f.reviewer.id,environment:'test',periodStart:baselineMarketMinute,periodEnd:baselineMarketMinute})
 expect(selected.status).toBe('selected');if(selected.status!=='selected')throw Error('fg_actual_baseline_structure_required')
 expect(selected.selection.coverage).toMatchObject({baselineSourceMessageId:b.source,supplyPeriodId:b.period});expect(selected.selection.states.some(x=>x.sourceMessageId===b.source)).toBe(true)
 const baselineMethod=selected.fields.measurementMethod;expect(typeof baselineMethod==='string'&&baselineMethod.length>0).toBe(true)
 const result:Profile={subtype,companyId:f.companyId,eventId:event.sourceId,contractId:f.contractId,supplyPeriodId:b.period,baselineSourceMessageId:b.source,preferredRouteId:randomUUID(),requestActor:{id:f.request.id,email:f.request.email,password:f.request.password},reviewActor:{id:f.reviewer.id,email:f.reviewer.email,password:f.reviewer.password},declaration,event,expected:{customerId:f.customerId,siteId:f.siteId,meteringPointId:f.pointId,pointId:f.external,identityAgency:'9',legalSenderId:f.sender,legalReceiverId:f.receiver,gridArea:f.gridAreaCode,brpEdielId:f.brpEdielId,requestedStartDate:f.requestedStartDate,baselineMarketMinute,effectiveMarketMinute,baselineMethod:baselineMethod!,confirmedMethod:subtype==='F'?'Z04':'Z02'}}
 // Prospective own customer-masterdata route only; no desired/origin/request,
 // source acceptance, received ACK or structural state is inserted here.
 const smtpConfig=assertEdielSmtpReadiness(),ackRouteId=randomUUID()
 sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email) VALUES(${literal(result.preferredRouteId)},${literal(f.companyId)},'SYNTHETIC FG desired-method route','customer_masterdata',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,transport_security_mode,mailbox,smtp_host,smtp_port,smtp_to,receiver_email) VALUES(${literal(randomUUID())},${literal(f.companyId)},${literal(result.preferredRouteId)},'SYNTHETIC FG desired-method profile','test','edifact','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,'unencrypted',${literal(smtpConfig.from)},${literal(smtpConfig.host)},${smtpConfig.port},'recipient@example.invalid','recipient@example.invalid');`)
 // Public prospective technical reply input for the later independent Z06,
 // as the passing Z06F acceptance configureAckRoute: one generic ediel_ack
 // profile on the current shared SMTP account (20261005130401 return route).
 sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email) VALUES(${literal(ackRouteId)},${literal(f.companyId)},'SYNTHETIC FG technical ACK route','ediel_ack',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,transport_security_mode,smtp_to,receiver_email,mailbox,smtp_host,smtp_port) VALUES(${literal(randomUUID())},${literal(f.companyId)},${literal(ackRouteId)},'SYNTHETIC FG technical ACK profile','test','edifact','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,true,'unencrypted','recipient@example.invalid','recipient@example.invalid',${literal(smtpConfig.from)},${literal(smtpConfig.host)},${smtpConfig.port});`)
 expect(sql(`SELECT jsonb_build_object('origins',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM gridex_metering_method_changes.origins r WHERE company_id=${literal(f.companyId)} AND event_id=${literal(event.sourceId)}),'desired',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM gridex_metering_method_changes.desired_change_receipts r WHERE company_id=${literal(f.companyId)} AND event_id=${literal(event.sourceId)}),'request',(SELECT to_jsonb(r) FROM public.outbound_requests r JOIN gridex_metering_method_changes.origins o ON o.outbound_request_id=r.id AND o.company_id=r.company_id WHERE o.company_id=${literal(f.companyId)} AND o.event_id=${literal(event.sourceId)}))`)).toEqual({origins:[],desired:[],request:null})
 return result
}
it('prepares fresh SYNTHETIC F/G original inputs through authenticated public owners without Z09 prequeue',async()=>{
 try{
  initialize()
  referenceCatalog()
  const manifestPath=tempPath('GRIDEX_Z09FG_COMPOSITION_INPUTS');expect(existsSync(manifestPath)).toBe(false)
  const F=await profile('F'),G=await profile('G'),backend=sql<CompositionInputs['backend']>(backendIdentitySql)
  expect(backend.engineSchemaVersion).toBeTruthy();expect(backend.migrationVersion).toBeTruthy();expect(backend.functionDefinitionsSha256).toMatch(/^[a-f0-9]{64}$/)
  const inputs:CompositionInputs={schema:'ediel_z09fg_composition_inputs_v1',apiUrl:'http://127.0.0.1:54321',backend,profiles:[F,G]}
  expect(F.companyId).not.toBe(G.companyId);expect(F.eventId).not.toBe(G.eventId);expect(F.expected.meteringPointId).not.toBe(G.expected.meteringPointId)
  const raw=JSON.stringify(inputs)+'\n';writeFileSync(manifestPath,raw,{mode:0o600,flag:'wx'});chmodSync(manifestPath,0o600)
  stage='READY_FOR_IMMUTABLE_CONSUMER'
  writeFileSync(proofPath,JSON.stringify({purpose:'synthetic_preparation_through_actual_public_ports',stage,backend,manifestSHA256:digest(raw),profiles:inputs.profiles.map(p=>({subtype:p.subtype,companyId:p.companyId,eventId:p.eventId,declaration:p.declaration,event:p.event,baselineSourceMessageId:p.baselineSourceMessageId,supplyPeriodId:p.supplyPeriodId})),nativeConsumer:'NOT_RUN_BY_PREPARATION',authenticMarketEvidence:'NOT_PROVIDED'})+'\n',{mode:0o600});chmodSync(proofPath,0o600)
 }catch(error){
  // Do not let a child-process SQL/error object print credential-bearing SQL,
  // auth sessions or secret manifest bytes into Vitest's failure formatter.
  const code=typeof error==='object'&&error!==null&&'code'in error&&typeof error.code==='string'&&/^[A-Z0-9_]{1,40}$/.test(error.code)?error.code:'PREPARATION_ASSERTION_OR_PORT_FAILURE'
  const label=failureLabel(error)
  if(proofPath)writeFileSync(proofPath,JSON.stringify({purpose:'original_preparation_failed_stage',stage,code,label,nativeConsumer:'NOT_REACHED',wholeFG:'NOT_APPROVED'})+'\n',{mode:0o600})
  throw Error(`synthetic_fg_preparation_failed:${stage}:${code}:${label}`)
 }finally{vi.unstubAllEnvs();vi.restoreAllMocks();smtp.send.mockReset()}
},120000)
