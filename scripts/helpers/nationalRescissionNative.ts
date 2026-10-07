// Shared native chain: genuine H start, received H Z04, authenticated national
// legal original, independent review, mandate and real Z08 H rescission original.
// Test files keep their own hoisted mocks (provider, session) and pass them in.
import {expect,vi,type Mock} from 'vitest'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {createClient,type SupabaseClient} from '@supabase/supabase-js'

import {seedNormalSwitchNativeFixture,nativeSql as sql,literal} from './ediel-normal-switch-native-fixture'
import {createBilateralProdatGroundNativeFixture} from './ediel-bilateral-prodat-profile-native-fixture'
import {archiveBilateralProdatGround,reviewBilateralProdatGround} from '@/lib/ediel/production/bilateralProdatProfileIntake'
import {prepareAndQueueEdielZ03} from '@/lib/ediel/flows/prodatSwitch'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'


import {getEdielMessageById} from '@/lib/ediel/db'
import {supabaseService} from '@/lib/supabase/service'

import {guideOrderedFixtureBody} from '../../__tests__/helpers/prodatGuideOrderedFixture'
import {line,qty,common,characteristic,type Parts} from '../../__tests__/fixtures/prodat-register'
import {seedOriginalMailboxNative} from './originalMailboxNative'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite,segmentElementCount,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {originalAckPartyIdentities,originalAckLegalNadSegment} from '@/lib/ediel/core/originalAckPartyIdentities'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatRegisterReadingState} from '@/lib/ediel/prodat/prodatRegisterReadings'
import {readSourceQualifiedProdatBilateralCapability} from '@/lib/ediel/core/prodatBilateralSourceCapability'
import {qualifyPersistedBilateralProdatOutboundOriginal} from '@/lib/ediel/production/bilateralProdatOutboundDraft'
import {matchMeteringPointForInbound,matchOutboundRequestForInbound} from '@/lib/inbound-mail/inboundMatcher'
import {inboundLegalReceiverEdielId,resolveInboundTenantFromIdentifiers} from '@/lib/ediel/tenant/resolveInboundTenant'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {assertEdielSmtpReadiness} from '@/lib/ediel/mailReadiness'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'


import {prepareAndQueueSupplyRescissionZ08} from '@/lib/ediel/flows/prodatSupplyRescission'
import {readSupplyRescissionScope,archiveSupplyRescission,reviewSupplyRescission} from '@/lib/ediel/production/supplyRescissionIntake'

export function nationalRescissionNativeChain(deps:{provider:Mock;sourceSession:{client:SupabaseClient|null};customerName?:string}){
 const {provider,sourceSession}=deps
async function stage(){const f=await seedNormalSwitchNativeFixture({requestedStartDate:'2026-10-15',deferOriginal:true,initialSubtype:'H',customerName:deps.customerName});sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,is_active,status) SELECT ${literal(f.actorUserId)},${literal(f.companyId)},id,key,'allow',true,'active' FROM public.permissions WHERE key IN('communication.read','communication.write','communication.send','contracts.read','metering.read','metering.write');`);return f}
async function authorized(){
 const f=await createBilateralProdatGroundNativeFixture(await stage()),artifact=await archiveBilateralProdatGround({companyId:f.companyId,actorUserId:f.actorUserId,...f.signed()}),review=await reviewBilateralProdatGround({companyId:f.companyId,actorUserId:f.reviewer,artifactId:String(artifact.artifactId),sourceHash:String(artifact.sourceHash),scopeHash:String(artifact.scopeHash),decision:'approve',reason:'Independent review of synthetic original; mechanism only'})
 expect(review.status,JSON.stringify(review)).toBe('authorized');return {...f,profileVersionId:String(review.profileVersionId)}
}
const originate=(f:{actorUserId:string;switchId:string;routeId:string})=>prepareAndQueueEdielZ03({actorUserId:f.actorUserId,switchRequestId:f.switchId,communicationRouteId:f.routeId,environment:'test'})
async function receivedHStart(){
 const f=await authorized(),original=await originate(f)
 for(const [name,value]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(name,value)
 provider.mockReset();provider.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:[],messageId:'synthetic-H-start-original',response:'250 synthetic accepted'})
 const sent=await sendEdielMessageViaSmtp((await getEdielMessageById(original.id))!,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})
 expect(sent.accepted).toEqual(['recipient@example.invalid']);expect(sent.rejected).toEqual([])
 const qualification=await qualifyPersistedBilateralProdatOutboundOriginal(original,f.actorUserId)
 expect(qualification.qualification?.objects).toEqual([expect.objectContaining({profileVersionId:f.profileVersionId,
  process:'normal_start_h',objectId:f.external,customerId:f.customerId,siteId:f.siteId,contractId:f.contractId})])
 const originals=sql<{objects:{start:string;li:string}[]}>(`SELECT gridex_received_sources.normal_switch_wire_v1(${literal(original.raw_payload)})`).objects
 expect(originals).toHaveLength(1);const physical=originals[0]
 const parts=(raw:string):Parts[]=>{const wire=tokenizeEdifact(raw);return wire.segments.map(s=>[s.tag,
  ...Array.from({length:segmentElementCount(s,wire.una)},(_,i)=>{const values=segmentComposite(s,i+1,wire.una);return values.length===1?values[0]:values})])}
 const originalParts=parts(original.raw_payload!),endUsers=originalParts.filter(p=>p[0]==='NAD'&&p[1]==='UD')
 expect(endUsers).toHaveLength(1)
 expect(endUsers[0][2]).toEqual([f.customerIdentity.id,f.customerIdentity.qualifier,f.customerIdentity.agency])
 const envelope=EdifactEnvelopeCodec.decode(original.raw_payload!),parties=originalAckPartyIdentities({rawPayload:original.raw_payload!,expectedFamily:'PRODAT'}),
  refs={interchange:randomUUID().replaceAll('-','').slice(0,14),message:randomUUID().replaceAll('-','').slice(0,14),document:randomUUID().replaceAll('-','').slice(0,14),createdAt:new Date()}
 expect(envelope).toMatchObject({sender:f.sender,receiver:f.receiver,environment:'test',applicationReference:'23-DDQ-PRODAT'})
 const body:Parts[]=[['BGM','Z04',refs.document,'9','AB'],['DTM',['137',refs.createdAt.toISOString().replace(/[-:T]/g,'').slice(0,12),'203']],['DTM',['ZZZ','1','805']],
  ...parts(originalAckLegalNadSegment('FR',parties.legalReceiver)+"'"),...parts(originalAckLegalNadSegment('DO',parties.legalSender)+"'"),
  line('1',f.external,undefined,'9'),qty('1000'),...common(f.external,'Synthetic',physical.start),
  ...characteristic('Z07','Z12'),...characteristic('Z12','D',3),...characteristic('Z15','D'),
  // Receiver-local declarations precede immutable public birth. They describe
  // future UTILTS only; no reading inventory or accepted policy fact is seeded.
  ...characteristic('Z02','1',3),...characteristic('Z05','6',3),...characteristic('Z16','111',3),
  ['CCI','','Z14'],['CAV',['','','','L917','8716867000030']],
  ['NAD','IT',[f.external,'','9'],'','','Street','Town','','12345','SE'],['NAD','Z02',[f.brpEdielId,'160','SVK']]]
 const own=guideOrderedFixtureBody(body.map(p=>p[0]==='CAV'&&Array.isArray(p[1])&&p[1][0]==='Z22'?['CAV',['Z25']]
  :p[0]==='RFF'&&Array.isArray(p[1])&&p[1][0]==='LI'?['RFF',['LI',physical.li]]
  :p[0]==='RFF'&&Array.isArray(p[1])&&p[1][0]==='Z05'?['RFF',['Z05',f.gridAreaCode]]
  :p[0]==='NAD'&&p[1]==='UD'?endUsers[0]:p))
 const render=(p:Parts)=>p.map(v=>(typeof v==='string'?[v]:v).map(x=>x.replace(/[?':+]/g,c=>'?'+c)).join(':')).join('+')
 const wire=EdifactEnvelopeCodec.encode({sender:envelope.receiver!,receiver:envelope.sender!,senderQualifier:envelope.receiverQualifier,
  receiverQualifier:envelope.senderQualifier,senderSubAddress:envelope.receiverSubAddress,receiverSubAddress:envelope.senderSubAddress,
  interchangeReference:refs.interchange,applicationReference:envelope.applicationReference,acknowledgementRequest:true,environment:'test',createdAt:refs.createdAt,
  messages:[{messageReference:refs.message,messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:own.map(render)}]})
 const routeId=randomUUID(),profileId=randomUUID(),smtp=assertEdielSmtpReadiness()
 // Only prospective GIVEN routing. The production parser/birth chooses source
 // custody and the current profile; no canonical source/catalog INSERT occurs.
 sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
  VALUES(${literal(routeId)},${literal(f.companyId)},'Synthetic H ACK route','ediel_ack',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
  INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,
   sender_ediel_id,receiver_ediel_id,sender_sub_address,receiver_sub_address,application_reference,is_enabled,is_active,transport_security_mode,
   smtp_to,receiver_email,mailbox,smtp_host,smtp_port)
  VALUES(${literal(profileId)},${literal(f.companyId)},${literal(routeId)},'Synthetic H ACK profile','test','edifact','edifact',
   ${literal(envelope.sender)},${literal(envelope.receiver)},${literal(envelope.senderSubAddress)},${literal(envelope.receiverSubAddress)},
   ${literal(envelope.applicationReference)},true,true,'unencrypted','recipient@example.invalid','recipient@example.invalid',
   ${literal(smtp.from)},${literal(smtp.host)},${literal(smtp.port)});`)
  // Original field306 declares installation status on the first object.
  // Qualify its prospective positive premise before immutable mailbox birth.
  expect(sql(`SELECT jsonb_build_object('pointStatus',p.status,'siteStatus',s.status,
    'companyId',p.company_id,'customerId',p.customer_id,'siteId',p.site_id,
    'customerSiteId',p.customer_site_id,'external',p.ediel_metering_point_id)
    FROM public.metering_points p JOIN public.customer_sites s ON s.id=p.site_id
    AND s.company_id=p.company_id AND s.customer_id=p.customer_id
    WHERE p.id=${literal(f.pointId)} AND p.company_id=${literal(f.companyId)}
    AND p.customer_id=${literal(f.customerId)} AND s.id=${literal(f.siteId)}`)).toEqual({
      pointStatus:'active',siteStatus:'active',companyId:f.companyId,customerId:f.customerId,
      siteId:f.siteId,customerSiteId:f.siteId,external:f.external})
  const installationWire=tokenizeEdifact(wire)
  const firstLineIndex=installationWire.segments.findIndex(s=>s.tag==='LIN')
  expect(firstLineIndex).toBeGreaterThanOrEqual(0)
  const firstLine=installationWire.segments[firstLineIndex]
  expect(segmentComposite(firstLine,3,installationWire.una)[0]).toBe(f.external)
  expect(segmentComposite(firstLine,3,installationWire.una)[3]).toBe('9')
  const boundary=installationWire.segments.slice(firstLineIndex+1).findIndex(s=>s.tag==='LIN'||s.tag==='UNT')
  expect(boundary).toBeGreaterThanOrEqual(0)
  const firstObject=installationWire.segments.slice(firstLineIndex,firstLineIndex+1+boundary)
  const installationCharacteristics=firstObject.filter(s=>s.tag==='CCI'&&segmentComposite(s,2,installationWire.una)[0]==='Z07')
  expect(installationCharacteristics).toHaveLength(1)
  const installationValue=firstObject[firstObject.indexOf(installationCharacteristics[0])+1]
  expect(installationValue?.tag).toBe('CAV')
  expect(segmentComposite(installationValue,1,installationWire.una)).toEqual(['Z12'])
 const mail=await seedOriginalMailboxNative(sql,literal,{companyId:f.companyId,environment:'test',raw:wire,smtpFrom:smtp.from}),parsed=mail.parsed
 const [outboundMatch,meteringPointMatch]=await Promise.all([
  matchOutboundRequestForInbound({companyId:f.companyId,parsed,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId}),
  matchMeteringPointForInbound({companyId:f.companyId,parsed,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})])
 const tenant=await resolveInboundTenantFromIdentifiers({mailboxCompanyId:f.companyId,mailboxId:mail.mailboxId,environment:'test',
  senderEdielId:parsed.senderEdielId,senderSubaddress:parsed.senderSubAddress,receiverEdielId:parsed.receiverEdielId,receiverSubaddress:parsed.receiverSubAddress,
  marketActorEdielId:inboundLegalReceiverEdielId(wire,parsed.receiverEdielId),applicationReference:parsed.applicationReference,
  messageFamily:parsed.messageFamily,messageCode:parsed.messageCode,referenceCandidates:Object.values(parsed.references).flat()})
 expect(tenant).toMatchObject({status:'resolved',companyId:f.companyId})
 const sourceId=await createInboundEdielMessage({companyId:f.companyId,actorUserId:f.actorUserId,environment:'test',
  inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed,outboundMatch,meteringPointMatch,tenantResolution:tenant})
 expect(sourceId).not.toBeNull();if(!sourceId)throw Error('native_shared_h_public_birth_required')
 const source=(await getEdielMessageById(sourceId))!
 expect(source).toMatchObject({id:sourceId,company_id:f.companyId,environment:'test',direction:'inbound',message_family:'PRODAT',
  message_code:'Z04',rule_profile_key:'PRODAT:Z04:H:26.A:r3',raw_payload:wire,immutable_payload_hash:mail.sourcePayloadHash,
  inbound_email_message_id:mail.inboundEmailMessageId})
 expect(mail.sourcePayloadHash).toBe(createHash('sha256').update(wire).digest('hex'))
 const tokens=tokenizeEdifact(wire),groups=prodatRegisterGroups(tokens.segments,tokens.una).groups
 expect(groups).toHaveLength(1);expect(groups[0]).toMatchObject({itemId:f.external,identityAgency:'9',validRegisterChain:true})
 expect(['214','218','259'].map(field=>prodatRegisterReadingState(field,groups[0].segments,tokens.una)))
  .toEqual([{present:true,value:'1',malformed:false},{present:true,value:'6',malformed:false},{present:true,value:'111',malformed:false}])
 expect(await readSourceQualifiedProdatBilateralCapability(source)).toMatchObject({sourceMessageId:sourceId,companyId:f.companyId,
  environment:'test',sourcePayloadHash:mail.sourcePayloadHash,subtype:'H',owner:'immutable-bilateral-prodat-profile-v1',
  objects:[expect.objectContaining({profileVersionId:f.profileVersionId,process:'normal_start_h',objectId:f.external,lineItemReference:physical.li,sourceHash:f.sourceHash})]})
 const lineage=sql<{source:Record<string,unknown>;mail:Record<string,unknown>;parse:Record<string,unknown>;context:Record<string,unknown>}>(`SELECT jsonb_build_object(
  'source',to_jsonb(s),'mail',to_jsonb(m),'parse',to_jsonb(p),'context',c.context)
  FROM gridex_received_sources.sources s JOIN public.ediel_messages e ON e.id=s.source_message_id AND e.company_id=s.company_id
  JOIN public.inbound_email_messages m ON m.id=e.inbound_email_message_id AND m.company_id=e.company_id
  JOIN public.inbound_ediel_parse_results p ON p.id=${literal(mail.parseResultId)} AND p.inbound_email_message_id=m.id AND p.company_id=m.company_id
  JOIN gridex_ediel_inbound_context.receipts c ON c.source_message_id=e.id AND c.company_id=e.company_id AND c.status='ready'
  WHERE e.id=${literal(sourceId)} AND e.company_id=${literal(f.companyId)}`)
 expect(lineage.source).toMatchObject({source_message_id:sourceId,company_id:f.companyId,environment:'test',raw_payload:wire,payload_hash:mail.sourcePayloadHash})
 expect(lineage.mail).toMatchObject({id:mail.inboundEmailMessageId,mailbox_id:mail.mailboxId,company_id:f.companyId,environment:'test',raw_edifact_payload:wire})
 expect(lineage.parse).toMatchObject({id:mail.parseResultId,inbound_email_message_id:mail.inboundEmailMessageId,company_id:f.companyId,
  message_family:'PRODAT',message_code:'Z04',raw_payload:wire})
 expect(lineage.context).toMatchObject({basisKind:'observed_source_persistence',companyId:f.companyId,environment:'test',direction:'inbound',
  family:'PRODAT',code:'Z04',actorRole:'electricity_supplier',legalEdielId:f.sender,applicationReference:envelope.applicationReference})
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source)
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(sourceId)}`)).toBe(0)
 // Caller owns the first actual processor/effect, national basis and full replay.
 return {...f,sourceId,source,wire}
}
async function actualNationalSourceSession(actor:string){
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('native_source_session_owned_local_only')
 const password='H-intake-'+randomUUID()+'-aA1!',updated=await supabaseService.auth.admin.updateUserById(actor,{password,email_confirm:true})
 expect(updated.error).toBeNull();const email=updated.data.user?.email;if(!email)throw Error('native_source_actor_email_required')
 const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;if(!anon)throw Error('native_source_anon_key_required')
 const client=createClient('http://127.0.0.1:54321',anon,{auth:{persistSession:false,autoRefreshToken:false}}),signed=await client.auth.signInWithPassword({email,password})
 expect(signed.error).toBeNull();expect(signed.data.user?.id).toBe(actor);const current=await client.auth.getUser();expect(current.error).toBeNull();expect(current.data.user?.id).toBe(actor)
 return client
}
async function nationalRescissionArtifact(){
 const f=await receivedHStart();await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 const archiverSession=await actualNationalSourceSession(f.actorUserId),reviewerSession=await actualNationalSourceSession(f.reviewer);sourceSession.client=archiverSession
 const periodId=sql<string>(`SELECT to_jsonb(id) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(f.sourceId)}`),rulePackId=sql<string>(`SELECT to_jsonb(pack.id) FROM public.ediel_rule_packs pack WHERE pack.family='PRODAT' AND pack.guide_version='26.A' AND pack.guide_revision='3' AND pack.status='active' AND(SELECT count(*) FROM public.ediel_message_profiles profile WHERE profile.rule_pack_id=pack.id AND profile.is_enabled AND(profile.profile_key='PRODAT:Z08:H:26.A:r3' OR profile.profile_key='PRODAT:Z05:L:26.A:r3'))=2`),selector={environment:'test' as const,supplyPeriodId:periodId,effectiveAt:'2026-10-16T12:30:00Z',rulePackId},scope=await readSupplyRescissionScope({companyId:f.companyId,actorUserId:f.actorUserId,...selector})
 expect(scope.status,JSON.stringify(scope)).toBe('scoped')
 const bytes=Buffer.from('SYNTHETIC LEGAL ORIGINAL: actual prerequisites completed; requested own contract rescission. NOT REAL LEGAL CLAIM.'),source={bytesBase64:bytes.toString('base64'),mimeType:'text/plain' as const,reference:'SYNTHETIC NATIONAL RESCISSION ORIGINAL',version:'1'},keyId=randomUUID(),representationId=randomUUID(),key=Buffer.from('SYNTHETIC national rescission issuer configured native fixture only'),dso=sql<string>(`SELECT to_jsonb(actor_id) FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=${literal(f.receiver)} AND is_verified`)
 sql(`INSERT INTO gridex_supply_rescission.issuer_keys VALUES(${literal(keyId)},${literal(f.companyId)},'test','SYNTHETIC','DECLARED MECHANISM BOUNDARY NOT REAL LEGAL CLAIM',${literal('a'.repeat(64))},decode(${literal(key.toString('hex'))},'hex'),'2000-01-01','2100-01-01');INSERT INTO gridex_supply_rescission.issuer_representations VALUES(${literal(representationId)},${literal(f.companyId)},'test',${literal(keyId)},${literal(f.actorUserId)},${literal(dso)},${literal(f.gridAreaCode)},'SYNTHETIC REPRESENTATION',${literal('b'.repeat(64))},'2000-01-01','2100-01-01');INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,is_active,status) SELECT ${literal(f.reviewer)},${literal(f.companyId)},id,key,'allow',true,'active' FROM public.permissions WHERE key='ediel.supply_rescission.review';`)
 const issued=new Date(Date.now()-1000).toISOString(),payload=Buffer.from(JSON.stringify({format:'ediel_national_supply_rescission_receipt_v1',purpose:'national_prodat_z08h_legal_rescission',issuerCode:'SYNTHETIC',receiptId:randomUUID(),companyId:f.companyId,environment:'test',scope:scope.scope,sourceHash:createHash('sha256').update(bytes).digest('hex'),sourceReference:source.reference,sourceVersion:'1',legalCaseReference:'SYNTHETIC CASE',legalDecisionReference:'SYNTHETIC DECISION',legalPrerequisitesReference:'SYNTHETIC PREREQUISITES',legalPrerequisitesCompletedAt:issued,issuedAt:issued,expiresAt:'2099-01-01T00:00:00Z'})),submission={...selector,source,issuerReceipt:{keyId,representationId,payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',key).update(payload).digest('hex')}},artifact=await archiveSupplyRescission({companyId:f.companyId,actorUserId:f.actorUserId,...submission}),review={sourceHash:String(artifact.sourceHash),scopeHash:String(artifact.scopeHash),decision:'approve' as const,reason:'Independent review of actual synthetic original and completed legal prerequisites; no real legal approval',sourceClauseLocator:'Original sentence 1',sourceClauseQuote:'actual prerequisites completed; requested own contract rescission.'}
 expect(artifact.status,JSON.stringify(artifact)).toBe('archived');sourceSession.client=reviewerSession;return{...f,periodId,bytes,artifactId:String(artifact.artifactId),review}
}
function nationalNativeOperator(companyId:string,permissions:string[]){
 const actor=randomUUID(),email=`h-operator-${actor}@example.invalid`
 sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES(${literal(actor)},'authenticated','authenticated',${literal(email)},now(),'{}','{}',now(),now(),false,false);INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(actor)},${literal(email)},'Synthetic native H phase operator','active');INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${literal(companyId)},${literal(actor)},'operations','active',now(),'{}','member',true,now(),'operations');INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,is_active,status) SELECT ${literal(actor)},${literal(companyId)},id,key,'allow',true,'active' FROM public.permissions WHERE key IN(${permissions.map(literal).join(',')});`)
 return actor
}
async function nationalRescissionOperation(separatePrincipals=false){
 const f=await nationalRescissionArtifact(),approved=await reviewSupplyRescission({companyId:f.companyId,actorUserId:f.reviewer,artifactId:f.artifactId,...f.review})
 expect(approved.status,JSON.stringify(approved)).toBe('authorized')
 const creator=separatePrincipals?nationalNativeOperator(f.companyId,['communication.write','metering.write','contracts.read']):f.actorUserId,currentExecutor=separatePrincipals?nationalNativeOperator(f.companyId,['communication.send','communication.write','metering.write','contracts.read']):f.actorUserId,mandateId=String(approved.mandateId),result=await prepareAndQueueSupplyRescissionZ08({companyId:f.companyId,actorUserId:creator,mandateId,preferredRouteId:f.routeId})
 expect(result.status,JSON.stringify(result)).toBe('queued');if(!('message'in result))throw Error('native national H original held')
 const own=sql<{objects:{li:string;reason:string}[]}>(`SELECT gridex_bilateral_prodat.draft_wire_v1(${literal(result.message.raw_payload)})`).objects[0]
 expect(own).toMatchObject({li:'H'+mandateId.replaceAll('-',''),reason:'Z25'})
 expect(sql(`SELECT to_jsonb(source_end_message_id IS NULL) FROM public.customer_supply_periods WHERE id=${literal(f.periodId)}`)).toBe(true)
 if(separatePrincipals)sql(`UPDATE public.company_memberships SET is_active=false WHERE company_id=${literal(f.companyId)} AND user_id=${literal(creator)};UPDATE public.user_permissions SET effect='deny' WHERE company_id=${literal(f.companyId)} AND user_id=${literal(creator)};`)
 return{...f,creator,currentExecutor,mandateId,original:result.message,li:own.li}
}
 return {stage,authorized,originate,receivedHStart,actualNationalSourceSession,nationalRescissionArtifact,nationalNativeOperator,nationalRescissionOperation}
}
