import {randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const provider=vi.hoisted(()=>vi.fn())
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:provider})}}))
import {seedNormalSwitchNativeFixture,nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {mixedProdatNativeWire} from './helpers/ediel-mixed-prodat-native-wire'
import {supabaseService} from '@/lib/supabase/service'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {projectReceivedProdatObjectValidation} from '@/lib/ediel/core/receivedProdatObjectValidation'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {createCanonicalAckMessage} from '@/lib/ediel/core/kernel'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import type {EdielMessageRow} from '@/lib/ediel/types'
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string}|null}>
const rpc=(name:string,args:Record<string,unknown>)=>(supabaseService.rpc.bind(supabaseService) as unknown as Rpc)(name,args)
function smtpFixture(email:string){
 vi.stubEnv('EDIEL_SHARED_MAILBOX_ADDRESS','synthetic@example.invalid');vi.stubEnv('EDIEL_APP_DKIM_ENABLED','false');vi.stubEnv('EMAIL_PROVIDER','resend')
 vi.stubEnv('EDIEL_SMTP_FROM','synthetic@example.invalid');vi.stubEnv('EDIEL_SMTP_USER','synthetic@example.invalid');vi.stubEnv('EDIEL_SMTP_PASS','synthetic-only');vi.stubEnv('EDIEL_EMAIL_PROVIDER','strato')
 provider.mockReset();provider.mockResolvedValue({accepted:[email],rejected:[],messageId:'synthetic-local-mixed-original',response:'250 synthetic accepted'})
}
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})
async function seed(completeOriginal=true){
 const f=await seedNormalSwitchNativeFixture({provider:completeOriginal?smtpFixture:undefined}),sourceId=randomUUID(),routeId=randomUUID(),profileId=randomUUID()
 const nativeWire=sql<{objects:{start:string}[]}>(`SELECT gridex_received_sources.normal_switch_wire_v1(${literal(f.originalZ03.raw_payload)})`)
 const wire=mixedProdatNativeWire({...f,startMinute:nativeWire.objects[0].start,negativePoint:'735123456789012345'})
 // Public synthetic originals are inserted; their private original/context,
 // inbound legal owner and source-rule admission come from database producers.
 sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email) VALUES(${literal(routeId)},${literal(f.companyId)},'Synthetic mixed ACK route','ediel_ack',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,transport_security_mode,smtp_to,receiver_email) VALUES(${literal(profileId)},${literal(f.companyId)},${literal(routeId)},'Synthetic mixed ACK profile','test','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,'unencrypted','recipient@example.invalid','recipient@example.invalid');
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 SELECT ${literal(sourceId)},${literal(f.companyId)},'test','inbound','edifact','PRODAT','Z04','received',${literal(wire)},'{"subtype":"L","prodatDependentFacts":{"market":"electricity","meterReadingsSentInUtilts":false}}',clock_timestamp(),'23-DDQ-PRODAT',${literal(f.receiver)},${literal(f.sender)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z04:L:26.A:r3' AND profile.is_enabled;`)
 const {data,error}=await supabaseService.from('ediel_messages').select('*').eq('id',sourceId).single();expect(error).toBeNull()
 const source=data as EdielMessageRow,decision=await resolveCanonicalRuntimeDecisionWithRegistry(source)
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','rejected','accepted'])
 expect(projectReceivedProdatObjectValidation(wire,decision)?.objects.map(o=>o.disposition),JSON.stringify(decision.issues)).toEqual(['rejected','accepted'])
 expect(sql(`SELECT to_jsonb(received_context->>'contextOrigin'='database_insert' AND payload_hash=encode(sha256(convert_to(raw_payload,'UTF8')),'hex')) FROM gridex_received_sources.sources WHERE source_message_id=${literal(sourceId)}`)).toBe(true)
 return {...f,sourceId,source,decision,wire,ackRouteId:routeId,ackProfileId:profileId}
}
function persisted(f:Awaited<ReturnType<typeof seed>>){
 return sql<{raw:string;switch:string;periods:number;positiveObjects:number;outcomes:{disposition:string}[];replyIntents:number;consumptions:number;acks:{id:string;family:string;wire:string;company:string;route:string}[];outbox:{company:string;source:string;status:string}[]}>(`SELECT jsonb_build_object(
 'raw',(SELECT raw_payload FROM public.ediel_messages WHERE id=${literal(f.sourceId)}),
 'switch',(SELECT status FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)}),
 'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE source_message_id=${literal(f.sourceId)}),
 'positiveObjects',(SELECT count(*) FROM gridex_received_sources.normal_switch_confirmations WHERE source_message_id=${literal(f.sourceId)}),
 'outcomes',(SELECT processed_objects FROM gridex_received_sources.prodat_mixed_object_receipts WHERE source_message_id=${literal(f.sourceId)}),
 'replyIntents',(SELECT count(*) FROM gridex_received_sources.prodat_mixed_reply_outbox WHERE source_message_id=${literal(f.sourceId)}),
 'consumptions',(SELECT count(*) FROM gridex_received_sources.prodat_mixed_reply_consumptions WHERE source_message_id=${literal(f.sourceId)}),
 'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'family',message_family,'wire',raw_payload,'company',company_id,'route',communication_route_id) ORDER BY message_family),'[]') FROM public.ediel_messages WHERE related_message_id=${literal(f.sourceId)}),
 'outbox',(SELECT coalesce(jsonb_agg(jsonb_build_object('company',company_id,'source',source_message_id,'status',status) ORDER BY ediel_message_id),'[]') FROM public.ediel_outbox WHERE source_message_id=${literal(f.sourceId)}))`)
}
it('authentic replay owners commit only the full-guide own object and consume its genuine routed mixed ACK/outbox',async()=>{
 const f=await seed(),input={actorUserId:f.actorUserId,edielMessageId:f.sourceId}
 await processInboundEdielMessage(input)
 const first=persisted(f)
 expect(first).toMatchObject({raw:f.wire,switch:'accepted',periods:1,positiveObjects:1,replyIntents:1,consumptions:1,outcomes:[{disposition:'rejected'},{disposition:'accepted'}]})
 expect(first.acks.map(a=>a.family)).toEqual(['APERAK','CONTRL'])
 const ack=first.acks[0];expect(ack.company).toBe(f.companyId);expect(ack.route).toBe(f.ackRouteId)
 expect(ack.wire).toContain('BGM+++34');expect(ack.wire).toContain('ERC+41::260');expect(ack.wire).toContain('FTX+AAO++213::260');expect(ack.wire).toContain('RFF+LI:NEGATIVE-OWN');expect(ack.wire).toContain(`ERC+100::260'RFF+LI:${f.caseReference}`);expect(ack.wire).toContain(`RFF+Z07:${f.external}`)
 expect(first.outbox).toHaveLength(2);expect(first.outbox.every(o=>o.company===f.companyId&&o.source===f.sourceId&&o.status==='queued')).toBe(true)
 const read=await rpc('ediel_read_prodat_mixed_reply_v1',{p_company_id:f.companyId,p_source_message_id:f.sourceId,p_actor_user_id:f.actorUserId});expect(read.error).toBeNull();expect(read.data).toMatchObject({applied:true,idempotent:true,processedObjects:first.outcomes})
 // A full-source positive statement would answer the rejected object falsely.
 // The genuine shared/native gateway must reject it even with a trusted actor.
 const draft=buildAperakDraft({sourceMessage:f.source,outcome:'positive'})
 await expect(createCanonicalAckMessage({actorUserId:f.actorUserId,sourceMessage:f.source,ackFamily:'APERAK',outcome:'positive',draft})).rejects.toThrow()
 const replay=await processInboundEdielMessage(input);expect(replay.id).toBe(f.sourceId);expect(persisted(f)).toEqual(first)
 await Promise.all([processInboundEdielMessage(input),processInboundEdielMessage(input)]);expect(persisted(f)).toEqual(first)
 sql(`UPDATE public.company_memberships SET is_active=false WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.actorUserId)}`)
 const revoked=await rpc('ediel_read_prodat_mixed_reply_v1',{p_company_id:f.companyId,p_source_message_id:f.sourceId,p_actor_user_id:f.actorUserId});expect(revoked.data).toBeNull();expect(persisted(f)).toEqual(first)
},120000)
it('an unsent original or missing fresh own-guide receipt holds the sibling and creates no positive own market effect',async()=>{
 const f=await seed(false)
 expect(await recordReceivedSourceValidation({original:f.source,validated:f.source,resolvedCompanyId:f.companyId,decision:f.decision})).toMatchObject({status:'recorded'})
 const read=await rpc('ediel_read_prodat_mixed_reply_v1',{p_company_id:f.companyId,p_source_message_id:f.sourceId,p_actor_user_id:f.actorUserId});expect(read.error).toBeNull();expect(read.data).toBeNull()
 const state=persisted(f);expect(state).toMatchObject({raw:f.wire,periods:0,positiveObjects:0,replyIntents:0,consumptions:0,acks:[],outbox:[]})
},120000)

it('last native own reply-outbox failure rolls back all own effects and audit before any ERC100 can escape',async()=>{
 const f=await seed(),suffix=randomUUID().replaceAll('-',''),fn=`synthetic_mixed_failure_${suffix}`,trigger=`synthetic_mixed_outbox_${suffix}`
 sql(`CREATE FUNCTION gridex_received_sources.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.source_message_id=${literal(f.sourceId)}::uuid THEN RAISE EXCEPTION 'synthetic_native_own_outbox_failure';END IF;RETURN NEW;END$$;CREATE TRIGGER ${trigger} BEFORE INSERT ON gridex_received_sources.prodat_mixed_reply_outbox FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.${fn}();`)
 try{
  await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
  const state=persisted(f)
  expect(state).toMatchObject({raw:f.wire,periods:0,positiveObjects:0,replyIntents:0,consumptions:0})
  expect(state.acks.some(a=>a.family==='APERAK'||a.wire.includes('ERC+100'))).toBe(false)
  expect(sql(`SELECT jsonb_build_object('receipts',(SELECT count(*) FROM gridex_received_sources.prodat_mixed_object_receipts WHERE source_message_id=${literal(f.sourceId)}),'transitions',(SELECT count(*) FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=${literal(f.sourceId)}))`)).toEqual({receipts:0,transitions:0})
  expect(sql(`SELECT to_jsonb(inbound_z04_message_id IS NULL AND status IN('prepared','queued','submitted','sent','waiting','waiting_response','waiting_for_z04','awaiting_confirmation')) FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)}`)).toBe(true)
 }finally{sql(`DROP TRIGGER ${trigger} ON gridex_received_sources.prodat_mixed_reply_outbox;DROP FUNCTION gridex_received_sources.${fn}();`)}
},120000)
