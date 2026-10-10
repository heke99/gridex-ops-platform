import {spawn} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const provider=vi.hoisted(()=>vi.fn())
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:provider})}}))
import {seedNormalSwitchNativeFixture,nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {mixedProdatNativeWire} from './helpers/ediel-mixed-prodat-native-wire'
import {seedOriginalMailboxNative,recordOriginalMailboxNativeReception} from './helpers/originalMailboxNative'
import {supabaseService} from '@/lib/supabase/service'
import {assertEdielSmtpReadiness} from '@/lib/ediel/mailReadiness'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {projectReceivedProdatObjectValidation} from '@/lib/ediel/core/receivedProdatObjectValidation'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {createCanonicalAckMessage} from '@/lib/ediel/core/kernel'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {readPhysicalAckSourceCorrelation} from '@/lib/ediel/ack/sourceCorrelation'
import type {CreateEdielMessageInput,EdielMessageRow} from '@/lib/ediel/types'
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:{ackMessage:EdielMessageRow}|null;error:{message:string}|null}>
const rpc=(name:string,args:Record<string,unknown>)=>(supabaseService.rpc.bind(supabaseService) as unknown as Rpc)(name,args)
function smtpFixture(email:string){
 vi.stubEnv('EDIEL_SHARED_MAILBOX_ADDRESS','synthetic@example.invalid');vi.stubEnv('EDIEL_APP_DKIM_ENABLED','false');vi.stubEnv('EMAIL_PROVIDER','resend')
 vi.stubEnv('EDIEL_SMTP_FROM','synthetic@example.invalid');vi.stubEnv('EDIEL_SMTP_USER','synthetic@example.invalid');vi.stubEnv('EDIEL_SMTP_PASS','synthetic-only');vi.stubEnv('EDIEL_EMAIL_PROVIDER','strato')
 provider.mockReset();provider.mockResolvedValue({accepted:[email],rejected:[],messageId:'synthetic-local-rawscope-original',response:'250 synthetic accepted'})
}
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})
// Copies only public synthetic setup from the independent genuine mixed suite.
// Actual signed archive/Z03/normal confirmation/primary full facets and ACK
// private seals are produced by their real owners. Only external SMTP is fake.
async function seed(completeOriginal=true){
 const f=await seedNormalSwitchNativeFixture({provider:completeOriginal?smtpFixture:undefined}),sourceId=randomUUID(),routeId=randomUUID(),profileId=randomUUID()
 smtpFixture('recipient@example.invalid');const smtp=assertEdielSmtpReadiness()
 const nativeWire=sql<{objects:{start:string}[]}>(`SELECT gridex_received_sources.normal_switch_wire_v1(${literal(f.originalZ03.raw_payload)})`)
 const wire=mixedProdatNativeWire({...f,startMinute:nativeWire.objects[0].start,negativePoint:'735123456789012345',ownReadingDeclarations:true})
 const receivedAt=new Date().toISOString()
 const mail=await seedOriginalMailboxNative(sql,literal,{companyId:f.companyId,environment:'test',raw:wire,receivedAt,smtpFrom:smtp.from})
 // Public synthetic originals are inserted; their private original/context,
 // inbound legal owner and source-rule admission come from database producers.
 sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email) VALUES(${literal(routeId)},${literal(f.companyId)},'Synthetic mixed ACK route','ediel_ack',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,transport_security_mode,smtp_to,receiver_email) VALUES(${literal(profileId)},${literal(f.companyId)},${literal(routeId)},'Synthetic mixed ACK profile','test','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,'unencrypted','recipient@example.invalid','recipient@example.invalid');
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference,inbound_email_message_id,mailbox_message_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 SELECT ${literal(sourceId)},${literal(f.companyId)},'test','inbound','edifact','PRODAT','Z04','received',${literal(wire)},'{"subtype":"L","prodatDependentFacts":{"market":"electricity","meterReadingsSentInUtilts":false}}',${literal(receivedAt)}::timestamptz,'23-DDQ-PRODAT',${literal(f.receiver)},${literal(f.sender)},${literal(mail.parsed.interchangeReference)},${literal(mail.inboundEmailMessageId)},${literal(mail.inboundEmailMessageId)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z04:L:26.A:r3' AND profile.is_enabled;`)
 await recordOriginalMailboxNativeReception({...mail,companyId:f.companyId,sourceMessageId:sourceId,actorUserId:f.actorUserId})
 const {data,error}=await supabaseService.from('ediel_messages').select('*').eq('id',sourceId).single();expect(error).toBeNull()
 const source=data as EdielMessageRow,decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:f.actorUserId})
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','rejected','accepted'])
 expect(projectReceivedProdatObjectValidation(wire,decision)?.objects.map(o=>o.disposition),JSON.stringify(decision.issues)).toEqual(['rejected','accepted'])
 expect(sql(`SELECT to_jsonb(received_context->>'contextOrigin'='database_insert' AND payload_hash=encode(sha256(convert_to(raw_payload,'UTF8')),'hex')) FROM gridex_received_sources.sources WHERE source_message_id=${literal(sourceId)}`)).toBe(true)
 return {...f,sourceId,source,decision,wire,ackRouteId:routeId,ackProfileId:profileId}
}
function effects(f:Awaited<ReturnType<typeof seed>>){return sql(`SELECT jsonb_build_object(
 'messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}),
 'events',(SELECT count(*) FROM public.ediel_message_events WHERE company_id=${literal(f.companyId)}),
 'witnesses',(SELECT count(*) FROM gridex_ediel_outbound_owner.witnesses WHERE company_id=${literal(f.companyId)}),
 'consumptions',(SELECT count(*) FROM gridex_ediel_outbound_owner.consumptions WHERE company_id=${literal(f.companyId)}),
 'namespace',(SELECT count(*) FROM gridex_ediel_wire_namespace.coverage WHERE company_id=${literal(f.companyId)}),
 'scopeLedger',(SELECT count(*) FROM gridex_ediel_ack_guide.outbound_prodat_scopes WHERE company_id=${literal(f.companyId)}),
 'creationReceipts',(SELECT count(*) FROM gridex_ediel_ack_replay.creation_receipts WHERE company_id=${literal(f.companyId)}),
 'replyIntents',(SELECT count(*) FROM gridex_received_sources.prodat_mixed_reply_outbox WHERE company_id=${literal(f.companyId)}),
 'supply',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}),
 'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)}),
 'attempts',(SELECT count(*) FROM gridex_ediel_transport.attempts WHERE company_id=${literal(f.companyId)}))`)}
function scopedDraft(f:Awaited<ReturnType<typeof seed>>,ack:EdielMessageRow,wantedLi:string,opposite=false):CreateEdielMessageInput{
 const wire=tokenizeEdifact(ack.raw_payload!),business=wire.segments.filter(s=>!['UNA','UNB','UNH','UNT','UNZ'].includes(s.tag)),first=business.findIndex(s=>s.tag==='ERC')
 let found=false;const groups:typeof business=[]
 for(let start=first;start<business.length;){let end=start+1;while(end<business.length&&business[end].tag!=='ERC')end++
  const own=business.slice(start,end)
  if(own.some(s=>s.tag==='RFF'&&segmentComposite(s,1,wire.una)[0]==='LI'&&segmentComposite(s,1,wire.una)[1]===wantedLi)){
   found=true;groups.push(...own.map(s=>opposite&&s.tag==='ERC'?{...s,raw:s.raw.replace(/^ERC\+[^+:']+/,segmentComposite(s,1,wire.una)[0]==='100'?'ERC+42':'ERC+100')}:s))
  }
  start=end
 }
 if(!found)throw Error('genuine_original_own_LI_required')
 const envelope=EdifactEnvelopeCodec.decode(ack.raw_payload!)
 const raw=EdifactEnvelopeCodec.encode({sender:envelope.sender!,receiver:envelope.receiver!,senderQualifier:envelope.senderQualifier,receiverQualifier:envelope.receiverQualifier,applicationReference:envelope.applicationReference,environment:'test',acknowledgementRequest:false,
  interchangeReference:'RAW-SCOPE-REQUEST',messages:[{messageReference:'RAW-SCOPE-UNH',messageTypeToken:'APERAK:D:96A:UN:E2SE6A',businessSegments:[...business.slice(0,first),...groups].map(s=>s.raw)}]})
 return {actorUserId:f.actorUserId,companyId:f.companyId,environment:'test',direction:'outbound',messageStandard:'edifact',messageFamily:'APERAK',messageCode:'APERAK',rawPayload:raw,
  // Deliberately stale cache must not choose an IDE/object alias.
  parsedPayload:{ackScope:'transaction',relatedTransactionReference:'foreign-caller-alias'}}
}
const nativeRead=(f:Awaited<ReturnType<typeof seed>>,raw:string)=>rpc('ediel_read_outbound_ack_scope_replay_v2',{p_company_id:f.companyId,p_environment:'test',p_source_message_id:f.sourceId,
 p_source_payload_hash:createHash('sha256').update(f.wire).digest('hex'),p_actor_user_id:f.actorUserId,p_ack_family:'APERAK',p_ack_raw_payload:raw})
it('actual full mixed own ACK replays exact positive/negative subsets, concurrent duplicates and stale caches without route reselection or any attempted effects',async()=>{
 const f=await seed();await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 const stored=await supabaseService.from('ediel_messages').select('*').eq('company_id',f.companyId).eq('related_message_id',f.sourceId).eq('message_family','APERAK').single()
 expect(stored.error).toBeNull();const ack=stored.data as EdielMessageRow
 expect(readPhysicalAckSourceCorrelation(ack).scopedOutcomes).toEqual(expect.arrayContaining([{reference:'NEGATIVE-OWN',outcome:'negative'},{reference:f.caseReference,outcome:'positive'}]))
 const positive=scopedDraft(f,ack,f.caseReference),negative=scopedDraft(f,ack,'NEGATIVE-OWN'),before=effects(f)
 sql(`UPDATE public.communication_routes SET is_active=false WHERE id=${literal(f.ackRouteId)};UPDATE public.ediel_route_profiles SET is_enabled=false WHERE id=${literal(f.ackProfileId)};`)
 const suffix=randomUUID().replaceAll('-',''),fn='rawscope_noeffects_'+suffix,trigger='rawscope_noeffects_'+suffix
 const tables=['public.ediel_messages','public.ediel_message_events','gridex_ediel_outbound_owner.witnesses','gridex_ediel_outbound_owner.consumptions','gridex_ediel_ack_guide.outbound_prodat_scopes','gridex_ediel_ack_replay.creation_receipts','public.ediel_outbox']
 sql(`CREATE FUNCTION public.${fn}()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF (CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END)=${literal(f.companyId)}::uuid THEN RAISE EXCEPTION 'attempted_rawscope_replay_effect';END IF;IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END$$;`)
 try{
  for(const table of tables)sql(`CREATE TRIGGER ${trigger} BEFORE INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION public.${fn}();`)
  const replay=async(draft:CreateEdielMessageInput)=>createCanonicalAckMessage({actorUserId:f.actorUserId,sourceMessage:f.source,ackFamily:'APERAK',outcome:draft===positive?'positive':'negative',draft})
  expect((await nativeRead(f,positive.rawPayload!)).error).toBeNull();expect((await replay(positive)).id).toBe(ack.id);expect((await replay(negative)).id).toBe(ack.id)
  const concurrent=await Promise.all([replay(positive),replay(negative),replay(positive)]);expect(concurrent.map(a=>a.id)).toEqual([ack.id,ack.id,ack.id]);expect(effects(f)).toEqual(before)
  const opposite=scopedDraft(f,ack,f.caseReference,true);expect((await nativeRead(f,opposite.rawPayload!)).error?.message).toContain('scope_conflicting_outcome');expect(effects(f)).toEqual(before)
  const altered=await rpc('ediel_read_outbound_ack_scope_replay_v2',{p_company_id:f.companyId,p_environment:'test',p_source_message_id:f.sourceId,p_source_payload_hash:'0'.repeat(64),p_actor_user_id:f.actorUserId,p_ack_family:'APERAK',p_ack_raw_payload:positive.rawPayload});expect(altered.error?.message).toContain('actual_original_mismatch');expect(effects(f)).toEqual(before)
  sql(`UPDATE public.company_memberships SET is_active=false WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.actorUserId)}`)
  expect((await nativeRead(f,positive.rawPayload!)).error?.message).toContain('actor_not_authorized');await expect(replay(positive)).rejects.toThrow();expect(effects(f)).toEqual(before)
  sql(`UPDATE public.company_memberships SET is_active=true WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.actorUserId)};UPDATE public.tenant_actor_roles SET valid_to=now() WHERE company_id=${literal(f.companyId)} AND environment='test'`)
  expect((await nativeRead(f,positive.rawPayload!)).error?.message).toContain('current_captured_role_unavailable');expect(effects(f)).toEqual(before)
 }finally{for(const table of tables)sql(`DROP TRIGGER ${trigger} ON ${table};`);sql(`DROP FUNCTION public.${fn}();`)}
},120000)
it('actual two-session pending current DENY waits before source locks and then refuses immutable own mixed ACK without attempted effects',async()=>{
 const f=await seed();await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 const stored=await supabaseService.from('ediel_messages').select('*').eq('company_id',f.companyId).eq('related_message_id',f.sourceId).eq('message_family','APERAK').single();expect(stored.error).toBeNull()
 const ack=stored.data as EdielMessageRow,draft=scopedDraft(f,ack,f.caseReference),before=effects(f)
 const DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres',writer=spawn('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']})
 let output='',errors='';writer.stdout.on('data',v=>{output+=String(v)});writer.stderr.on('data',v=>{errors+=String(v)})
 const done=new Promise<void>((resolve,reject)=>{writer.on('error',reject);writer.on('close',code=>code===0?resolve():reject(Error(errors||'native pendingdeny writer')))});let waiting:PromiseLike<Awaited<ReturnType<Rpc>>>|undefined
 try{
  writer.stdin.write(`BEGIN;INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active,valid_from) VALUES(${literal(f.actorUserId)},${literal(f.companyId)},'communication.write','deny',true,now()-interval '1 day');SELECT 'DENY_LOCKED';\n`)
  for(let step=0;step<250&&!output.includes('DENY_LOCKED');step++)await new Promise(resolve=>setTimeout(resolve,20));expect(output,errors).toContain('DENY_LOCKED')
  waiting=Promise.resolve(nativeRead(f,draft.rawPayload!));let blocked=false
  for(let step=0;step<250&&!blocked;step++){
   blocked=sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.query LIKE '%ediel_read_outbound_ack_scope_replay_v2%' AND l.relation='public.user_permission_overrides'::regclass AND l.mode='ShareLock' AND NOT l.granted))`)
   if(!blocked)await new Promise(resolve=>setTimeout(resolve,20))
  }
  expect(blocked).toBe(true);expect(effects(f)).toEqual(before);writer.stdin.end('COMMIT;\n');await done
  // The revoked grant is refused by the current business-ACK actor gate.
  expect((await waiting).error?.message).toMatch(/actor_not_authorized|ediel_business_ack_current_actor_required/);expect(effects(f)).toEqual(before)
 }finally{if(!writer.stdin.destroyed)writer.stdin.end('ROLLBACK;\n');await done.catch(()=>undefined);if(waiting)await waiting}
},120000)
