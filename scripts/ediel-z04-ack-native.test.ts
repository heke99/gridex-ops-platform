import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {expect,it} from 'vitest'
import {raw} from '../__tests__/fixtures/prodat-register'
import {mixedZ04Parts} from '../__tests__/helpers/mixedZ04Fixture'
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

it('real inbound mixed Z04 persists routed CONTRL and only negative APERAK with retry-stable outbox, never business state',async()=>{
  const ids={company:randomUUID(),source:randomUUID(),actor:randomUUID(),route:randomUUID(),profile:randomUUID()}
  const wire=raw(mixedZ04Parts(),'Z04').replace('+S+R+','+12345:14+54321:14+')
  const receivedAt=new Date().toISOString()
  const sourceContext={receivedProdatContext:{version:1,contextOrigin:'database_insert',sourceMessageId:ids.source,
    companyId:ids.company,environment:'test',messageCode:'Z04',payloadHash:evidenceHash(wire),sourceReceivedAt:receivedAt,capturedAt:receivedAt}}
  // Isolated test tenant, legal actor, route and canonical source. No transport
  // worker runs in this suite; only the real inbound processor queues ACKs.
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(ids.company)},'Native Z04 ACK owner','active');
    INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from)
      VALUES(${literal(ids.company)},'test','electricity',true,clock_timestamp()-interval '1 day');
    INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from)
      VALUES(${literal(ids.company)},'test',${literal(ids.actor)},'EdielId','54321',clock_timestamp()-interval '1 day');
    INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from)
      VALUES(${literal(ids.company)},'test',${literal(ids.actor)},'electricity_supplier',clock_timestamp()-interval '1 day');
    INSERT INTO public.ediel_actor_settings(company_id,environment,actor_name,actor_ediel_id,ediel_id)
      VALUES(${literal(ids.company)},'test','Synthetic native legal supplier','54321','54321');
    INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active)
      VALUES(${literal(ids.route)},${literal(ids.company)},'Native ACK route','ediel_ack','bilateral_test',true);
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled)
      VALUES(${literal(ids.profile)},${literal(ids.company)},${literal(ids.route)},'Native ACK profile','test','edifact','54321','12345','23-DDQ-PRODAT',true);
    INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,validation_report,
      message_received_at,execution_context_snapshot,application_reference,sender_ediel_id,receiver_ediel_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
    SELECT ${literal(ids.source)},${literal(ids.company)},'test','inbound','edifact','PRODAT','Z04','received',${literal(wire)},
      '{"subtype":"L","prodatDependentFacts":{"market":"electricity","meterReadingsSentInUtilts":false}}'::jsonb,'{}'::jsonb,
      ${literal(receivedAt)}::timestamptz,${literal(sourceContext)}::jsonb,'23-DDQ-PRODAT','12345','54321',pack.id,profile.profile_key,profile.id,
      pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
    FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id
    WHERE profile.profile_key='PRODAT:Z04:L:26.A:r3' AND profile.is_enabled;`)
  const {data,error}=await supabaseService.from('ediel_messages').select('*').eq('id',ids.source).single()
  expect(error).toBeNull()
  const source=data as EdielMessageRow
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
  expect(first.messages.map(row=>[row.family,row.outcome]),JSON.stringify(blocked)).toEqual([['APERAK','negative'],['CONTRL','positive']])
  expect(first.messages.every(row=>row.company===ids.company&&row.route===ids.route&&row.profile===ids.profile)).toBe(true)
  const aperak=first.messages[0].wire
  expect(aperak).toContain('FTX+AAO++213::260')
  expect(aperak).toContain('RFF+Z07:735123456789012345')
  expect(aperak).not.toContain('RFF+Z07:735123456789012352')
  expect(first.outbox).toHaveLength(2)
  expect(first.outbox.every(row=>row.company===ids.company&&row.source===ids.source&&row.profile===ids.profile&&row.status==='queued'&&row.hash?.length===64)).toBe(true)
  expect([first.cases,first.switches,first.supply]).toEqual([0,0,0])
  await processInboundEdielMessage(input)
  expect(persisted()).toEqual(first)
})
