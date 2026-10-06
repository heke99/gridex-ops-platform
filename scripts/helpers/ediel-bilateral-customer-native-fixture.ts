// Disposable local native mechanism fixture. The remote legal issuer/key and
// agreement are explicitly synthetic boundaries. All private source/canonical,
// archive/review/version/availability records use actual production producers.
import {createClient} from '@supabase/supabase-js'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {expect} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {createRequestedChangeSupplyFixture} from './ediel-requested-change-native-fixture'
import {nativeSql as sql,literal,futureNativeSupplyDate} from './ediel-normal-switch-native-fixture'
import {bilateralCustomerNativeWire} from './ediel-bilateral-customer-native-wire'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {captureFreshEdielSourceRulePackEvidence} from '@/lib/ediel/core/sourceRulePackEvidence'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {createReceivedSourceOwnerSession} from '@/lib/ediel/sources/receivedSourceOwnerSession'
import {reviewReceivedStructuralSource} from '@/lib/ediel/sources/reviewReceivedStructuralSource'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {BilateralCustomerSourceSubmission} from '@/lib/ediel/production/bilateralCustomerSource'
import {seedOriginalMailboxNative} from './originalMailboxNative'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {assertEdielSmtpReadiness} from '@/lib/ediel/mailReadiness'

export const bilateralSourceOperatorPermissions=['communication.read','communication.write','customers.read','customers.write','contracts.read','contracts.write','ediel.source.review']
export async function createBilateralSourceOperator(companyId:string,keys=bilateralSourceOperatorPermissions){
 const email=`bilateral-${randomUUID()}@example.invalid`,password=process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD??randomUUID()+randomUUID()
 const created=await supabaseService.auth.admin.createUser({email,password,email_confirm:true});expect(created.error).toBeNull()
 const id=created.data.user!.id,role=randomUUID(),key=`bilateral_${role}`
 sql(`INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(id)},${literal(email)},'Disposable bilateral operator','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
 INSERT INTO public.roles(id,key,name,scope) VALUES(${literal(role)},${literal(key)},'Disposable bilateral source role','company');
 INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key) VALUES(${literal(companyId)},${literal(id)},'member','active',now(),'member',true,now(),'member');
 INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active) VALUES(${literal(id)},${literal(companyId)},${literal(role)},${literal(key)},'active',true);
 INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key) SELECT ${literal(role)},${literal(key)},id,key FROM public.permissions WHERE key=ANY(ARRAY[${keys.map(literal).join(',')}]);`)
 const client=createClient('http://127.0.0.1:54321',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}})
 const login=await client.auth.signInWithPassword({email,password});expect(login.error).toBeNull()
 const context=await client.rpc('canonical_authenticated_tenant_context',{p_selected_company_id:companyId});expect(context.error).toBeNull()
 expect(context.data).toMatchObject({authorized:true,selected_company_id:companyId})
 for(const permission of keys)expect((context.data as {permissions:string[]}).permissions).toContain(permission)
 return {id,email,roleId:role,client}
}

/** The dated customer change takes effect two days into the future supply. */
export function customerChangeMinute(requestedStartDate:string){
 const date=new Date(`${requestedStartDate}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+2);return `${date.toISOString().slice(0,10).replaceAll('-','')}0000`
}
export async function captureBilateralCustomerNativeSource(f:Awaited<ReturnType<typeof createRequestedChangeSupplyFixture>>,options:{repeatRegister?:boolean;invoicee?:boolean;name?:string;physicalBirth?:boolean;sourceWire?:string}={}){
 const {physicalBirth,sourceWire,...wireOptions}=options
 let sourceMessageId:string=randomUUID()
 const wire=sourceWire??bilateralCustomerNativeWire({sender:f.receiver,receiver:f.sender,point:f.external,customerIdentity:f.customerIdentity.id,reference:'LI'+randomUUID().replaceAll('-','').toUpperCase(),marketMinute:customerChangeMinute(f.requestedStartDate),...wireOptions})
 if(physicalBirth){
  // Prospective custody: the actual parser/intake owns the source birth. No
  // graph matches, frozen profile or mailbox selector is patched afterward.
  const mail=await seedOriginalMailboxNative(sql,literal,{companyId:f.companyId,environment:'test',raw:wire,smtpFrom:assertEdielSmtpReadiness().from})
  const id=await createInboundEdielMessage({companyId:f.companyId,actorUserId:f.actorUserId,environment:'test',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed})
  expect(id).toBeTruthy()
  if(!id)throw new Error('actual_bilateral_physical_source_birth_required')
  sourceMessageId=id
 }else{
 sql(`INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 SELECT ${literal(sourceMessageId)},${literal(f.companyId)},${literal(f.customerId)},${literal(f.siteId)},${literal(f.pointId)},'test','inbound','edifact','PRODAT','Z06','received',${literal(wire)},'{}',clock_timestamp(),'23-DDQ-PRODAT',${literal(f.receiver)},${literal(f.sender)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z06:E:26.A:r3' AND profile.is_enabled`)
 }
 const saved=await supabaseService.from('ediel_messages').select('*').eq('id',sourceMessageId).single();expect(saved.error).toBeNull()
 const message=saved.data as EdielMessageRow,decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
 const receipt=await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:f.companyId,decision});expect(receipt.status).toBe('recorded');
 // Production inbound order: record validation, then capture the frozen rule-pack basis.
 await captureFreshEdielSourceRulePackEvidence(f.companyId,message.id);
 const session=createReceivedSourceOwnerSession(receipt);expect(session).not.toBeNull();await session!.finish()
 return {sourceMessageId,message,wire}
}

export async function createBilateralCustomerSourceFixture(provider:(email:string)=>void,options:{physicalBirth?:boolean;existingSupply?:Awaited<ReturnType<typeof createRequestedChangeSupplyFixture>>;sourceWire?:string}={}){
 const f=options.existingSupply??await createRequestedChangeSupplyFixture(provider,{requestedStartDate:futureNativeSupplyDate()}),source=await captureBilateralCustomerNativeSource(f,{repeatRegister:true,invoicee:true,physicalBirth:options.physicalBirth,sourceWire:options.sourceWire})
 const uploader=await createBilateralSourceOperator(f.companyId),reviewer=await createBilateralSourceOperator(f.companyId),reader=await createBilateralSourceOperator(f.companyId,['communication.read','customers.read','contracts.read'])
 // The actual original structural review qualifies only a post-ledger future
 // supply anchor. It cannot backfill the old default September start.
 // A reused supply has its genuine review already bound into outgoing
 // signed claims. Re-reviewing that baseline would change its assessment.
 if(!options.existingSupply){
  const baselineReview=await reviewReceivedStructuralSource({companyId:f.companyId,environment:'test',sourceMessageId:f.source,reviewerUserId:reviewer.id,confirmedOriginal:true,replacesSourceMessageId:null})
  expect(baselineReview).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
 }
 const counterpartyActorId=sql<string>(`SELECT to_jsonb(actor_id) FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=${literal(f.receiver)} AND is_verified`)
 expect(counterpartyActorId).toBeTruthy()
 const agreementId=randomUUID(),keyId=randomUUID(),representationId=randomUUID(),authorityHash=createHash('sha256').update('SYNTHETIC EXTERNAL BILATERAL MANDATE ONLY').digest('hex'),secret=Buffer.from('SYNTHETIC issuer key only 012345678901234567890123456789')
 // No private ready fact is inserted. These are explicit disposable external
 // legal registry controls, never a claim of an authentic DSO mandate.
 sql(`INSERT INTO public.tenant_bilateral_agreements(id,company_id,environment,counterparty_actor_id,capability_code,terms,is_enabled,valid_from,valid_to,source_reference) VALUES(${literal(agreementId)},${literal(f.companyId)},'test',${literal(counterpartyActorId)},'prodat_z06e_customer_change','{}',true,'2020-01-01','2099-01-01','SYNTHETIC SIGNED BILATERAL AGREEMENT ONLY');
 INSERT INTO gridex_bilateral_customer_sources.issuer_keys(id,company_id,environment,counterparty_actor_id,legal_authority_reference,legal_authority_hash,receipt_signing_key,valid_from,valid_to) VALUES(${literal(keyId)},${literal(f.companyId)},'test',${literal(counterpartyActorId)},'SYNTHETIC ISSUER COMPETENCE ONLY',${literal(authorityHash)},decode('${secret.toString('hex')}','hex'),'2020-01-01','2099-01-01');
 INSERT INTO gridex_bilateral_customer_sources.representations(id,company_id,environment,issuer_key_id,legal_actor_id,agreement_id,purpose,legal_authority_reference,legal_authority_hash,valid_from,valid_to) VALUES(${literal(representationId)},${literal(f.companyId)},'test',${literal(keyId)},${literal(f.actorUserId)},${literal(agreementId)},'prodat_z06e_customer_change','SYNTHETIC LEGAL REPRESENTATION ONLY',${literal(authorityHash)},'2020-01-01','2099-01-01')`)
 const clause={locator:'page1 synthetic bilateral clause',quote:'The synthetic DSO authorizes this exact dated customer and invoicee update.'}
 function submission(reference:string,bytes:Buffer,withReceipt=true,lifeEventKind:'customer_change'|'bankruptcy'='customer_change'):BilateralCustomerSourceSubmission{
  // The disposable signer reads the ACTUAL native claims as a challenge. It
  // cannot approve them or change any source/customer/role field through HTTP.
  const claims=sql<Record<string,unknown>>(`SELECT gridex_bilateral_customer_sources.source_claims_v1(${literal(f.companyId)},${literal(source.sourceMessageId)},${literal(agreementId)},${literal(f.period)},${literal(f.contractId)})`)
  const receiptBytes=Buffer.from(JSON.stringify({format:'ediel_bilateral_customer_source_receipt_v1',receiptId:randomUUID(),lifeEventKind,claims,sourceHash:createHash('sha256').update(bytes).digest('hex'),sourceReference:reference,sourceVersion:'1',authorizedFields:['227','228','229','231','232','316','250','251','252','253','317','318'],clause,issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()}))
  return {sourceMessageId:source.sourceMessageId,agreementId,supplyPeriodId:f.period,contractId:f.contractId,source:{bytesBase64:bytes.toString('base64'),mimeType:'application/pdf',reference,version:'1'},...(withReceipt?{issuerReceipt:{keyId,representationId,payloadBase64:receiptBytes.toString('base64'),signatureHex:createHmac('sha256',secret).update(receiptBytes).digest('hex')}}:{})}
 }
 const pdf=(label:string)=>Buffer.from(`%PDF-1.7\nSYNTHETIC ${label}\n${clause.quote}\n%%EOF`)
 return {...f,...source,agreementId,keyId,representationId,uploader,reviewer,reader,clause,submission,pdf}
}
