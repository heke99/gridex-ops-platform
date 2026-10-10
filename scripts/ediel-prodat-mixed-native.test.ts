import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {randomUUID} from 'node:crypto'
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
 // The configured technical/national reply route uses the current shared SMTP account.
 smtpFixture('recipient@example.invalid');const smtp=assertEdielSmtpReadiness()
 const nativeWire=sql<{objects:{start:string}[]}>(`SELECT gridex_received_sources.normal_switch_wire_v1(${literal(f.originalZ03.raw_payload)})`)
 const wire=mixedProdatNativeWire({...f,startMinute:nativeWire.objects[0].start,negativePoint:'735123456789012345',ownReadingDeclarations:true})
 const receivedAt=new Date().toISOString()
 const mail=await seedOriginalMailboxNative(sql,literal,{companyId:f.companyId,environment:'test',raw:wire,receivedAt,smtpFrom:smtp.from})
 // Public synthetic originals are inserted; their private original/context,
 // inbound legal owner and source-rule admission come from database producers.
 sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email) VALUES(${literal(routeId)},${literal(f.companyId)},'Synthetic mixed ACK route','ediel_ack',${literal(f.gridId)},'bilateral_test',true,'recipient@example.invalid');
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,transport_security_mode,smtp_to,receiver_email) VALUES(${literal(profileId)},${literal(f.companyId)},${literal(routeId)},'Synthetic mixed ACK profile','test','edifact',${literal(f.sender)},${literal(f.receiver)},'23-DDQ-PRODAT',true,'unencrypted','recipient@example.invalid','recipient@example.invalid');
 UPDATE public.ediel_route_profiles SET payload_format='edifact',is_active=true,mailbox=${literal(smtp.from)},smtp_host=${literal(smtp.host)},smtp_port=${smtp.port} WHERE id=${literal(profileId)};
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
function persisted(f:Awaited<ReturnType<typeof seed>>){
 return sql<{raw:string;switch:string;periods:number;positiveObjects:number;outcomes:{disposition:string}[];replyIntents:number;consumptions:number;partitions:number;acks:{id:string;family:string;wire:string;company:string;route:string}[];outbox:{company:string;source:string;status:string}[]}>(`SELECT jsonb_build_object(
 'raw',(SELECT raw_payload FROM public.ediel_messages WHERE id=${literal(f.sourceId)}),
 'switch',(SELECT status FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)}),
 'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE source_message_id=${literal(f.sourceId)}),
 'positiveObjects',(SELECT count(*) FROM gridex_received_sources.normal_switch_confirmations WHERE source_message_id=${literal(f.sourceId)}),
 'outcomes',(SELECT processed_objects FROM gridex_received_sources.prodat_mixed_object_receipts WHERE source_message_id=${literal(f.sourceId)}),
 'replyIntents',(SELECT count(*) FROM gridex_received_sources.prodat_mixed_reply_outbox WHERE source_message_id=${literal(f.sourceId)}),
 'partitions',(SELECT count(*) FROM gridex_received_sources.supply_object_partitions WHERE source_message_id=${literal(f.sourceId)}),
 'consumptions',(SELECT count(*) FROM gridex_received_sources.prodat_mixed_reply_consumptions WHERE source_message_id=${literal(f.sourceId)}),
 'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'family',message_family,'wire',raw_payload,'company',company_id,'route',communication_route_id) ORDER BY message_family),'[]') FROM public.ediel_messages WHERE related_message_id=${literal(f.sourceId)}),
 'outbox',(SELECT coalesce(jsonb_agg(jsonb_build_object('company',company_id,'source',source_message_id,'status',status) ORDER BY ediel_message_id),'[]') FROM public.ediel_outbox WHERE source_message_id=${literal(f.sourceId)}))`)
}
it('the partition owner commits only the full-guide own object and its one complete mixed BGM34 reply is routed and queued',async()=>{
 // Design A (20261001043234/043602 + 20261003100100): the supply partition owner
 // commits the accepted own object; the superseded mixed-owner tables stay unused.
 const f=await seed(),input={actorUserId:f.actorUserId,edielMessageId:f.sourceId}
 await processInboundEdielMessage(input)
 const first=persisted(f)
 expect(first).toMatchObject({raw:f.wire,switch:'accepted',periods:1,positiveObjects:1,partitions:1,replyIntents:0,consumptions:0})
 expect(first.acks.map(a=>a.family)).toEqual(['APERAK','CONTRL'])
 const ack=first.acks[0];expect(ack.company).toBe(f.companyId);expect(ack.route).toBe(f.ackRouteId)
 // One complete reply: the rejected own object's negative and ERC 100 only for the committed sibling.
 expect(ack.wire).toContain('BGM+++34');expect(ack.wire).toContain('ERC+41::260');expect(ack.wire).toContain('FTX+AAO++213::260');expect(ack.wire).toContain('RFF+LI:NEGATIVE-OWN')
 expect(ack.wire.match(/ERC\+100::260/g)).toHaveLength(1);expect(ack.wire).toContain(`RFF+LI:${f.caseReference}`);expect(ack.wire).toContain(`RFF+Z07:${f.external}`)
 expect(first.outbox).toHaveLength(2);expect(first.outbox.every(o=>o.company===f.companyId&&o.source===f.sourceId&&o.status==='queued')).toBe(true)
 // The superseded mixed owner never answers a partition-owned source.
 const read=await rpc('ediel_read_prodat_mixed_reply_v1',{p_company_id:f.companyId,p_source_message_id:f.sourceId,p_actor_user_id:f.actorUserId});expect(read.data).toBeNull()
 // A full-source positive statement would answer the rejected object falsely.
 // The genuine shared/native gateway must reject it even with a trusted actor.
 const draft=buildAperakDraft({sourceMessage:f.source,outcome:'positive'})
 await expect(createCanonicalAckMessage({actorUserId:f.actorUserId,sourceMessage:f.source,ackFamily:'APERAK',outcome:'positive',draft})).rejects.toThrow()
 const replay=await processInboundEdielMessage(input);expect(replay.id).toBe(f.sourceId);expect(persisted(f)).toEqual(first)
 await Promise.all([processInboundEdielMessage(input),processInboundEdielMessage(input)]);expect(persisted(f)).toEqual(first)
 // A non-member actor can neither re-run nor extend the committed source.
 await processInboundEdielMessage({...input,actorUserId:randomUUID()}).catch(()=>null);expect(persisted(f)).toEqual(first)
},120000)
it('an unsent original holds the sibling: no positive own market effect and no ERC 100 can be answered',async()=>{
 const f=await seed(false)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId}).catch(()=>null)
 const state=persisted(f);expect(state).toMatchObject({raw:f.wire,periods:0,positiveObjects:0,replyIntents:0,consumptions:0})
 expect(state.acks.some(a=>a.wire.includes('ERC+100'))).toBe(false)
},120000)

it('a failing last partition write rolls back all own effects and audit before any ERC100 can escape',async()=>{
 const f=await seed(),suffix=randomUUID().replaceAll('-',''),fn=`synthetic_partition_failure_${suffix}`,trigger=`synthetic_partition_${suffix}`
 sql(`CREATE FUNCTION gridex_received_sources.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.source_message_id=${literal(f.sourceId)}::uuid THEN RAISE EXCEPTION 'synthetic_native_partition_failure';END IF;RETURN NEW;END$$;CREATE TRIGGER ${trigger} BEFORE INSERT ON gridex_received_sources.supply_object_partitions FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.${fn}();`)
 try{
  await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId}).catch(()=>null)
  const state=persisted(f)
  expect(state).toMatchObject({raw:f.wire,periods:0,positiveObjects:0,partitions:0,replyIntents:0,consumptions:0})
  expect(state.acks.some(a=>a.wire.includes('ERC+100'))).toBe(false)
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=${literal(f.sourceId)}`)).toBe(0)
  expect(sql(`SELECT to_jsonb(inbound_z04_message_id IS NULL AND status IN('prepared','queued','submitted','sent','waiting','waiting_response','waiting_for_z04','awaiting_confirmation')) FROM public.supplier_switch_requests WHERE id=${literal(f.switchId)}`)).toBe(true)
 }finally{sql(`DROP TRIGGER ${trigger} ON gridex_received_sources.supply_object_partitions;DROP FUNCTION gridex_received_sources.${fn}();`)}
},120000)

it('the primary full-guide receipt is immutable and a service caller cannot promote its rejected own object afterwards',async()=>{
 const f=await seed()
 const receipt=await recordReceivedSourceValidation({original:f.source,validated:f.source,resolvedCompanyId:f.companyId,decision:f.decision});expect(receipt.status).toBe('recorded')
 if(receipt.status!=='recorded')throw Error('primary receipt required')
 const full=projectReceivedProdatObjectValidation(f.wire,f.decision)!
 const promoted={...full,objects:full.objects.map((o,index)=>index===0?{...o,disposition:'accepted',reasons:[],negativeFields:[]}:o)}
 const forbidden=await rpc('gridex_record_prodat_object_validation_v1',{p_company_id:f.companyId,p_environment:'test',p_source_message_id:f.sourceId,p_source_payload_hash:sql<string>(`SELECT to_jsonb(payload_hash) FROM gridex_received_sources.sources WHERE source_message_id=${literal(f.sourceId)}`),p_assessment_id:receipt.assessmentId,p_facts_text:JSON.stringify(promoted)})
 expect(forbidden.error?.message).toMatch(/permission|denied|schema cache/i)
 expect(sql(`SELECT jsonb_build_object('canonical',(SELECT count(*) FROM gridex_received_sources.validation_assessments WHERE source_message_id=${literal(f.sourceId)}),'full',(SELECT count(*) FROM gridex_received_sources.prodat_object_validation_facets WHERE source_message_id=${literal(f.sourceId)}),'dispositions',(SELECT jsonb_path_query_array(facts_text::jsonb,'$.objects[*].disposition') FROM gridex_received_sources.prodat_object_validation_facets WHERE assessment_id=${literal(receipt.assessmentId)}))`)).toEqual({canonical:1,full:1,dispositions:['rejected','accepted']})
 expect(persisted(f)).toMatchObject({periods:0,positiveObjects:0,replyIntents:0,consumptions:0,acks:[],outbox:[]})
},120000)

it('actual current permission revocation holds a qualified source even while user and company membership remain active',async()=>{
 const f=await seed()
 expect(await recordReceivedSourceValidation({original:f.source,validated:f.source,resolvedCompanyId:f.companyId,decision:f.decision})).toMatchObject({status:'recorded'})
 // Isolate the genuine direct-grant branch, then revoke only its allow rows.
 sql(`DELETE FROM public.user_roles WHERE user_id=${literal(f.actorUserId)};UPDATE public.user_permissions SET effect='deny' WHERE user_id=${literal(f.actorUserId)} AND (company_id=${literal(f.companyId)} OR company_id IS NULL);`)
 expect(sql(`SELECT jsonb_build_object('user',(SELECT user_status FROM public.user_profiles WHERE id=${literal(f.actorUserId)}),'member',(SELECT is_active AND status='active' FROM public.company_memberships WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.actorUserId)}),'permission',public.gridex_actor_has_company_permission(${literal(f.actorUserId)},${literal(f.companyId)},'metering.write'))`)).toEqual({user:'active',member:true,permission:false})
 const held=await rpc('ediel_process_prodat_mixed_z04_v1',{p_company_id:f.companyId,p_source_message_id:f.sourceId,p_actor_user_id:f.actorUserId});expect(held.error).toBeNull();expect(held.data).toMatchObject({applied:false,reason:'normal_z04_execution_actor_required'})
 expect(persisted(f)).toMatchObject({raw:f.wire,periods:0,positiveObjects:0,replyIntents:0,consumptions:0,acks:[],outbox:[]})
},120000)

it('concurrent actual grant revocation locks before the source and rolls back no sibling, audit, receipt or reply intent',async()=>{
 const f=await seed(),application=`mixed_grant_race_${randomUUID()}`
 expect(await recordReceivedSourceValidation({original:f.source,validated:f.source,resolvedCompanyId:f.companyId,decision:f.decision})).toMatchObject({status:'recorded'})
 sql(`DELETE FROM public.user_roles WHERE user_id=${literal(f.actorUserId)}`)
 expect(sql(`SELECT to_jsonb(public.gridex_actor_has_company_permission(${literal(f.actorUserId)},${literal(f.companyId)},'metering.write'))`)).toBe(true)
 const DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
 const writer=spawn('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']})
 let output='',errors='';writer.stdout.on('data',value=>{output+=String(value)});writer.stderr.on('data',value=>{errors+=String(value)})
 const writerDone=new Promise<void>((resolve,reject)=>{writer.on('error',reject);writer.on('close',code=>code===0?resolve():reject(Error(errors||`writer exited ${code}`)))})
 let worker:Promise<{stdout:string;stderr:string}>|undefined
 try{
  writer.stdin.write(`BEGIN;UPDATE public.user_permissions SET effect='deny' WHERE user_id=${literal(f.actorUserId)} AND (company_id=${literal(f.companyId)} OR company_id IS NULL);SELECT 'GRANT_LOCKED';\n`)
  for(let i=0;i<250&&!output.includes('GRANT_LOCKED');i++)await new Promise(resolve=>setTimeout(resolve,20))
  expect(output,errors).toContain('GRANT_LOCKED')
  worker=promisify(execFile)('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1','-c',`SET ROLE service_role;SELECT public.ediel_process_prodat_mixed_z04_v1(${literal(f.companyId)},${literal(f.sourceId)},${literal(f.actorUserId)});`],{encoding:'utf8',env:{...process.env,PGAPPNAME:application},timeout:15000})
  let blocked=false
  for(let i=0;i<250&&!blocked;i++){
   blocked=sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name=${literal(application)} AND l.relation='public.user_permissions'::regclass AND l.mode='ShareLock' AND NOT l.granted))`)
   if(!blocked)await new Promise(resolve=>setTimeout(resolve,20))
  }
  expect(blocked).toBe(true)
  expect(sql(`SELECT to_jsonb(NOT EXISTS(SELECT FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name=${literal(application)} AND l.relation='public.ediel_messages'::regclass))`)).toBe(true)
  expect(persisted(f)).toMatchObject({periods:0,positiveObjects:0,replyIntents:0,consumptions:0})
  writer.stdin.end('COMMIT;\n');await writerDone
  const result=JSON.parse((await worker).stdout.trim());expect(result).toMatchObject({applied:false,reason:'normal_z04_execution_actor_required'})
  expect(persisted(f)).toMatchObject({raw:f.wire,periods:0,positiveObjects:0,replyIntents:0,consumptions:0,acks:[],outbox:[]})
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=${literal(f.sourceId)}`)).toBe(0)
 }finally{
  if(!writer.stdin.destroyed)writer.stdin.end('ROLLBACK;\n')
  await writerDone.catch(()=>undefined);if(worker)await worker.catch(()=>undefined)
 }
},120000)
