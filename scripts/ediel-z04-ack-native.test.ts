// SC-034 (complete-first-lin-two, complete-global-order-132): whole-message P-17 rejection with no partial effect.
import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {expect,it,vi} from 'vitest'
import {qty,raw} from '../__tests__/fixtures/prodat-register'
import {mixedZ04Parts} from '../__tests__/helpers/mixedZ04Fixture'
import {assertEdielSmtpReadiness} from '@/lib/ediel/mailReadiness'
import {recordUtiltsTechnicalReception} from './helpers/utiltsConsumptionParties'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'

const DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const literal=(value:unknown)=>`'${String(typeof value==='object'?JSON.stringify(value):value).replaceAll("'","''")}'`
function sql<T>(statement:string):T {
  if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('local_only')
  const output=execFileSync('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8',timeout:10000,maxBuffer:2_000_000}).trim()
  return output?JSON.parse(output) as T:undefined as T
}

for (const variant of ['missing-own-quantity','gas-unit-on-electric-register','whole-message-lin-sequence','complete-first-lin-two','complete-global-order-132','missing-header-date','invalid-header-date','missing-header-offset','invalid-header-offset','missing-header-ack-request','invalid-header-ack-request','lowercase-header-ack-request','invalid-header-function','invalid-header-code-metadata','missing-header-code','unlisted-header-code'] as const) it(`real inbound Z04 ${variant} holds unowned physical codes and persists only qualified ACK intent, retry-stable without business state`,async()=>{
  const ids={company:randomUUID(),source:randomUUID(),actor:randomUUID(),route:randomUUID(),profile:randomUUID()}
  // Synthetic local mail settings: the ACK owner checks SMTP readiness before queueing.
  vi.stubEnv('EDIEL_SMTP_FROM','synthetic@example.invalid');vi.stubEnv('EDIEL_SMTP_USER','synthetic@example.invalid')
  vi.stubEnv('EDIEL_SMTP_PASS','synthetic-only');vi.stubEnv('EDIEL_EMAIL_PROVIDER','strato');vi.stubEnv('EDIEL_SHARED_MAILBOX_ADDRESS','synthetic@example.invalid')
  const policyOnly=variant==='missing-header-code'||variant==='unlisted-header-code'
  // The active legal actor identifier is unique across tenants in the native database.
  const actorEdielId=sql<string>(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('native_z04_ack_receiver',0));
   SELECT to_jsonb(min(n)::text) FROM generate_series(55000,59999) n WHERE NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.identifier_type='EdielId' AND i.identifier_value=n::text)
    AND NOT EXISTS(SELECT FROM public.ediel_actor_settings s WHERE s.ediel_id=n::text); COMMIT;`)
  const parts=mixedZ04Parts()
  if (variant === 'gas-unit-on-electric-register') {
    const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
    parts.splice(second+1,0,['QTY',['31','20','MTQ']])
  }
  if (variant === 'whole-message-lin-sequence') {
    const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
    parts[second]=[...parts[second].slice(0,1),'4',...parts[second].slice(2)]
  }
  // SC-034: every object is otherwise complete and actionable; only the national
  // LIN sequence is wrong (first LIN 2, or global order 1,3,2).
  if (variant === 'complete-first-lin-two' || variant === 'complete-global-order-132') {
    const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
    parts.splice(second+1,0,qty('20'))
    const numbers=variant==='complete-first-lin-two'?['2','3','4']:['1','3','2']
    parts.map((part,i)=>part[0]==='LIN'?i:-1).filter(i=>i>=0).forEach((at,n)=>{parts[at]=[...parts[at].slice(0,1),numbers[n],...parts[at].slice(2)]})
  }
  if (variant === 'missing-header-date' || variant === 'invalid-header-date' || variant === 'missing-header-offset' || variant === 'invalid-header-offset' || variant === 'missing-header-ack-request' || variant === 'invalid-header-ack-request' || variant === 'lowercase-header-ack-request' || variant === 'invalid-header-function' || variant === 'invalid-header-code-metadata' || policyOnly) {
    const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
    parts.splice(second+1,0,qty('20'))
  }
  let wire=raw(parts,'Z04').replaceAll('54321',actorEdielId).replace('+S+R+',`+12345:14+${actorEdielId}:14+`)
    .replace("+23-DDQ-PRODAT'","+23-DDQ-PRODAT++++1'") // UNB 0035: test interchange
    .replace('+I++23-DDQ-PRODAT',`+${ids.source.replaceAll('-','').slice(0,14).toUpperCase()}++23-DDQ-PRODAT`).replace("UNZ+1+I'",`UNZ+1+${ids.source.replaceAll('-','').slice(0,14).toUpperCase()}'`) // own UNB 0020
  if (variant === 'missing-header-date') wire=wire.replace('DTM+137:202609171200:203\'','')
    .replace(/UNT\+(\d+)\+M/,(_,count:string)=>`UNT+${Number(count)-1}+M`)
  if (variant === 'invalid-header-date') wire=wire.replace('DTM+137:202609171200:203','DTM+137:202613171200:203')
  if (variant === 'missing-header-offset') wire=wire.replace('DTM+ZZZ:1:805\'','')
    .replace(/UNT\+(\d+)\+M/,(_,count:string)=>`UNT+${Number(count)-1}+M`)
  if (variant === 'invalid-header-offset') wire=wire.replace('DTM+ZZZ:1:805','DTM+ZZZ:2:805')
  if (variant === 'missing-header-ack-request') wire=wire.replace('BGM+Z04+D+9+AB','BGM+Z04+D+9')
  if (variant === 'invalid-header-ack-request') wire=wire.replace('BGM+Z04+D+9+AB','BGM+Z04+D+9+ZZ')
  if (variant === 'lowercase-header-ack-request') wire=wire.replace('BGM+Z04+D+9+AB','BGM+Z04+D+9+ab')
  if (variant === 'invalid-header-function') wire=wire.replace('BGM+Z04+D+9+AB','BGM+Z04+D+7+AB')
  // Syntactically valid C002/1131 (an..3) that the national field 202 forbids.
  if (variant === 'invalid-header-code-metadata') wire=wire.replace('BGM+Z04+D+9+AB','BGM+Z04:ZZZ+D+9+AB')
  if (variant === 'missing-header-code') wire=wire.replace('BGM+Z04+D+9+AB','BGM++D+9+AB')
  if (variant === 'unlisted-header-code') wire=wire.replace('BGM+Z04+D+9+AB','BGM+Z99+D+9+AB')
  const receivedAt=new Date().toISOString()
  const smtp=assertEdielSmtpReadiness()
  const sourceContext={receivedProdatContext:{version:1,contextOrigin:'database_insert',sourceMessageId:ids.source,
    companyId:ids.company,environment:'test',messageCode:'Z04',payloadHash:evidenceHash(wire),sourceReceivedAt:receivedAt,capturedAt:receivedAt}}
  // Isolated test tenant, legal actor, route and canonical source. No transport
  // worker runs in this suite; only the real inbound processor queues ACKs.
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(ids.company)},'Native Z04 ACK owner','active');
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      VALUES(${literal(ids.actor)},'authenticated','authenticated',${literal(`z04-${ids.actor}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(ids.actor)},${literal(`z04-${ids.actor}@example.invalid`)},'Synthetic Z04 operator','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
      VALUES(${literal(ids.company)},${literal(ids.actor)},'operations','active',now(),'{}','member',true,now(),'operations');
    INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
      SELECT ${literal(ids.actor)},${literal(ids.company)},id,key FROM public.permissions WHERE key IN('communication.read','communication.write','communication.send','metering.write','customers.write');
    INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from)
      VALUES(${literal(ids.company)},'test','electricity',true,clock_timestamp()-interval '1 day');
    INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from)
      VALUES(${literal(ids.company)},'test',${literal(ids.actor)},'EdielId',${literal(actorEdielId)},clock_timestamp()-interval '1 day');
    INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from)
      VALUES(${literal(ids.company)},'test',${literal(ids.actor)},'electricity_supplier',clock_timestamp()-interval '1 day');
    INSERT INTO public.ediel_actor_settings(company_id,environment,actor_name,actor_ediel_id,ediel_id)
      VALUES(${literal(ids.company)},'test','Synthetic native legal supplier',${literal(actorEdielId)},${literal(actorEdielId)});
    INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active,target_email)
      VALUES(${literal(ids.route)},${literal(ids.company)},'Native ACK route','ediel_ack','bilateral_test',true,'recipient@example.invalid');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,mailbox,smtp_host,smtp_port,smtp_to,receiver_email)
      VALUES(${literal(ids.profile)},${literal(ids.company)},${literal(ids.route)},'Native ACK profile','test','edifact','edifact',${literal(actorEdielId)},'12345','23-DDQ-PRODAT',true,true,${literal(smtp.from)},${literal(smtp.host)},${literal(smtp.port)},'recipient@example.invalid','recipient@example.invalid');
    INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,validation_report,
      message_received_at,execution_context_snapshot,application_reference,sender_ediel_id,receiver_ediel_id,sender_email,receiver_email,mailbox,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
    SELECT ${literal(ids.source)},${literal(ids.company)},'test','inbound','edifact','PRODAT','Z04','received',${literal(wire)},
      '{"subtype":"L","prodatDependentFacts":{"market":"electricity","meterReadingsSentInUtilts":false}}'::jsonb,'{}'::jsonb,
      ${literal(receivedAt)}::timestamptz,${literal(sourceContext)}::jsonb,'23-DDQ-PRODAT','12345',${literal(actorEdielId)},'recipient@example.invalid',${literal(smtp.from)},${literal(smtp.from)},pack.id,profile.profile_key,profile.id,
      pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
    FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id
    WHERE profile.profile_key='PRODAT:Z04:L:26.A:r3' AND profile.is_enabled;`)
  const {data,error}=await supabaseService.from('ediel_messages').select('*').eq('id',ids.source).single()
  expect(error).toBeNull()
  const source=data as EdielMessageRow
  // Production reception records the interchange's technical syntax decision first.
  await recordUtiltsTechnicalReception(source,ids.actor)
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source)
  expect([decision.syntaxDecision,decision.applicationDecision],JSON.stringify(decision.issues)).toEqual(['accepted','rejected'])
  const input={actorUserId:ids.actor,edielMessageId:ids.source}
  await processInboundEdielMessage(input)
  const persisted=()=>sql<{messages:{id:string;family:string;outcome:string;wire:string;company:string;route:string;profile:string}[];outbox:{message:string;status:string;company:string;source:string;profile:string;hash:string}[];cases:number;switches:number;supply:number}>(`SELECT jsonb_build_object(
    'messages',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'family',message_family,'outcome',ack_outcome,'wire',raw_payload,'company',company_id,'route',communication_route_id,'profile',route_profile_id) ORDER BY message_family),'[]') FROM public.ediel_messages WHERE related_message_id=${literal(ids.source)}),
    'outbox',(SELECT coalesce(jsonb_agg(jsonb_build_object('message',ediel_message_id,'status',status,'company',company_id,'source',source_message_id,'profile',route_profile_id,'hash',immutable_payload_hash) ORDER BY ediel_message_id),'[]') FROM public.ediel_outbox WHERE source_message_id=${literal(ids.source)}),
    'cases',(SELECT count(*) FROM public.ediel_inbound_cases WHERE ediel_message_id=${literal(ids.source)}),
    'switches',(SELECT count(*) FROM public.supplier_switch_requests WHERE inbound_z04_message_id=${literal(ids.source)}),
    'supply',(SELECT count(*) FROM public.customer_supply_periods WHERE source_message_id=${literal(ids.source)}))`)
  const first=persisted()
  const blocked=sql<{message:string;payload:unknown}[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('message',message,'payload',payload) ORDER BY created_at),'[]') FROM public.ediel_message_events WHERE ediel_message_id=${literal(ids.source)} AND event_status='warning'`)
  if (policyOnly) {
    // Syntax is accepted, so the technical CONTRL is queued (5595c695); the
    // policy-only business rejection has no frozen owner and stays held.
    expect(first.messages.map(row=>[row.family,row.outcome])).toEqual([['CONTRL','positive']])
    expect(first.outbox).toHaveLength(1)
    const ackWarnings=blocked.filter(row=>typeof (row.payload as {ackFamily?:unknown}).ackFamily==='string')
    expect(ackWarnings.map(row=>(row.payload as {ackFamily:string}).ackFamily).sort()).toEqual(['APERAK'])
    expect(ackWarnings.every(row=>(row.payload as {blockedBy?:string}).blockedBy==='canonical_inbound_ack_guard')).toBe(true)
    expect([first.cases,first.switches,first.supply]).toEqual([0,0,0])
    await processInboundEdielMessage(input)
    expect(persisted()).toEqual(first)
    return
  }
  if (variant === 'missing-own-quantity' || variant === 'gas-unit-on-electric-register') {
    // The sibling object has no committed own outcome: a BGM34 must answer every
    // physical object, so the own negative is held until the sibling is resolved
    // and no outcome is invented for it. The technical CONTRL is still queued.
    expect(first.messages.map(row=>[row.family,row.outcome]),JSON.stringify(blocked)).toEqual([['CONTRL','positive']])
    expect(blocked.some(row=>row.message.includes('APERAK_PRODAT_OBJECT_OUTCOME_MISSING'))).toBe(true)
    expect(first.outbox).toHaveLength(1)
    // A held structurally valid source gets one review case; an invalid own
    // register structure has no reviewable case. No switch or supply effect.
    expect([first.cases,first.switches,first.supply]).toEqual([variant==='gas-unit-on-electric-register'?1:0,0,0])
    await processInboundEdielMessage(input)
    expect(persisted()).toEqual(first)
    return
  }
  expect(first.messages.map(row=>[row.family,row.outcome]),JSON.stringify(blocked)).toEqual([['APERAK','negative'],['CONTRL','positive']])
  expect(first.messages.every(row=>row.company===ids.company&&row.route===ids.route&&row.profile===ids.profile)).toBe(true)
  const aperak=first.messages[0].wire
  if (variant === 'whole-message-lin-sequence' || variant === 'complete-first-lin-two' || variant === 'complete-global-order-132') {
    expect(aperak).toContain('BGM+++27')
    expect(aperak).toContain('FTX+AAO++314::260')
    expect(aperak).toContain('RFF+ACW:D')
    expect(aperak).not.toContain('BGM+++34')
  } else if (variant === 'missing-header-date' || variant === 'invalid-header-date' || variant === 'missing-header-offset' || variant === 'invalid-header-offset' || variant === 'missing-header-ack-request' || variant === 'invalid-header-ack-request' || variant === 'lowercase-header-ack-request' || variant === 'invalid-header-function' || variant === 'invalid-header-code-metadata' || policyOnly) {
    expect(aperak).toContain('BGM+++27')
    expect(aperak).toContain(variant.startsWith('missing-') ? 'ERC+41::260' : 'ERC+42::260')
    expect(aperak).toContain(variant.endsWith('ack-request') ? 'FTX+AAO++313::260' : variant.endsWith('offset') ? 'FTX+AAO++206::260' : variant === 'invalid-header-function' ? 'FTX+AAO++204::260' : variant === 'invalid-header-code-metadata' || policyOnly ? 'FTX+AAO++202::260' : 'FTX+AAO++205::260')
    expect(aperak).toContain('RFF+ACW:D')
    expect(aperak).not.toContain('BGM+++34')
    expect(aperak).not.toContain('RFF+Z07:')
  } else {
    expect(aperak).toContain('BGM+++34')
    expect(aperak).toContain('FTX+AAO++213::260')
  }
  if (!variant.includes('header-')) expect(aperak).toContain('RFF+Z07:735123456789012345')
  expect(aperak).not.toContain('RFF+Z07:735123456789012352')
  expect(first.outbox).toHaveLength(2)
  expect(first.outbox.every(row=>row.company===ids.company&&row.source===ids.source&&row.profile===ids.profile&&row.status==='queued'&&row.hash?.length===64)).toBe(true)
  expect([first.cases,first.switches,first.supply]).toEqual([0,0,0])
  await processInboundEdielMessage(input)
  expect(persisted()).toEqual(first)
})

for (const [physicalCode,storedCode] of [['missing','PRODAT_UNKNOWN'],['unlisted','Z99']] as const) it(`real ingress cannot persist ${physicalCode} field 202 without a code-specific source profile`,()=>{
  const company=randomUUID(),source=randomUUID()
  const wire=raw(mixedZ04Parts(),'Z04').replace('BGM+Z04+D+9+AB',physicalCode==='missing'?'BGM++D+9+AB':'BGM+Z99+D+9+AB')
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(company)},'Native missing 202 owner','active');
    DO $do$
    DECLARE error_text text;
    BEGIN
      BEGIN
        INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,validation_report,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id)
        VALUES(${literal(source)},${literal(company)},'test','inbound','edifact','PRODAT',${literal(storedCode)},'received',${literal(wire)},'{}'::jsonb,'{}'::jsonb,clock_timestamp(),'23-DDQ-PRODAT','12345','54321');
        RAISE EXCEPTION 'unexpected_inbound_source_owner_insert';
      EXCEPTION WHEN check_violation THEN
        GET STACKED DIAGNOSTICS error_text=MESSAGE_TEXT;
        IF error_text NOT LIKE ${literal(`canonical_inbound_rule_profile_resolution_failed:PRODAT:${storedCode}:%:0`)} THEN
          RAISE EXCEPTION 'unexpected_inbound_rule_profile_error: %',error_text;
        END IF;
      END;
    END $do$;
    SELECT jsonb_build_object('source_count',(SELECT count(*) FROM public.ediel_messages WHERE id=${literal(source)}));`)
  const result=sql<{source_count:number}>(`SELECT jsonb_build_object('source_count',(SELECT count(*) FROM public.ediel_messages WHERE id=${literal(source)}))`)
  expect(result.source_count).toBe(0)
})
