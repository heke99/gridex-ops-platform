// masterplan: AT-Z05L-SUPPLIER, AT-Z05LK-SUPPLIER
import {type SupabaseClient} from '@supabase/supabase-js'
import {createHash} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const provider=vi.hoisted(()=>vi.fn())
const sourceSession=vi.hoisted(()=>({client:null as SupabaseClient|null}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>{
 if(!sourceSession.client)throw Error('native_actual_source_session_required')
 return sourceSession.client
}}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:provider})}}))
vi.mock('@/lib/ediel/core/messageBuilder',async importOriginal=>
 (await import('../__tests__/helpers/p16bHold')).captureP16bPreflight(importOriginal))
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import * as c1NativeBase from './helpers/ediel-normal-switch-native-fixture'
import {nationalRescissionNativeChain} from './helpers/nationalRescissionNative'
import {nationalEndNativeChain,type ReceivedEndCandidate} from './helpers/ediel-national-end-native-fixture'
import {prepareIndependentNationalEndTarget} from './helpers/ediel-z05-independent-end-native-fixture'
import {bilateralClosureNativeChain} from './helpers/ediel-bilateral-lk-native-fixture'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {getEdielMessageById} from '@/lib/ediel/db'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {validateUnsmGrammar} from '@/lib/ediel/core/unsmGrammar'
import {validateAckPreflight} from '@/lib/ediel/core/ackPreflight'
import {resolveInboundTenantFromIdentifiers} from '@/lib/ediel/tenant/resolveInboundTenant'
import {parseRulebookMessage} from '@/lib/ediel/rulebook/messageParser'
import {type EdielMessageRow} from '@/lib/ediel/types'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'
import {supabaseService} from '@/lib/supabase/service'
import {type Parts} from '../__tests__/fixtures/prodat-register'
const {receivedHStart,nationalRescissionOperation}=nationalRescissionNativeChain({provider,sourceSession})
const {receivedNationalRescissionEnd,nationalEndEffects}=nationalEndNativeChain({nationalRescissionOperation,provider})
const {receivedLkEnd,lkEffects}=bilateralClosureNativeChain({receivedHStart,provider})
const variants=['L','LK'] as const
async function configureAckProfile(companyId:string,raw:string){
 // Configure this suite's existing disposable transport route, before its
 // first ACK. This supplies no syntax/business decision or private witness.
 const {from,host,port}=edielSmtpConfig()
 expect(sql(`WITH configured AS(UPDATE public.ediel_route_profiles p
  SET is_active=true,mailbox=${literal(from)},smtp_host=${literal(host)},smtp_port=${literal(port)}
  FROM public.communication_routes r WHERE r.id=p.communication_route_id AND r.company_id=p.company_id
  AND r.company_id=${literal(companyId)} AND r.route_scope='ediel_ack' AND p.environment='test'
  RETURNING p.id) SELECT to_jsonb(count(*)) FROM configured`)).toBe(1)
 const wire=tokenizeEdifact(raw),unb=wire.segments.find(s=>s.tag==='UNB')
 const sender=segmentComposite(unb,3,wire.una),receiver=segmentComposite(unb,2,wire.una)
 expect(sql(`SELECT jsonb_agg(jsonb_build_object('company',p.company_id,'environment',p.environment,
  'active',p.is_active,'enabled',p.is_enabled,'standard',p.message_standard,'format',p.payload_format,
  'sender',p.sender_ediel_id,'receiver',p.receiver_ediel_id,
  'senderSubaddress',coalesce(p.sender_subaddress,p.sender_sub_address,''),
  'receiverSubaddress',coalesce(p.receiver_subaddress,p.receiver_sub_address,''),
  'app',p.application_reference,'family',p.message_family,'code',p.business_code,
  'mailbox',p.mailbox,'host',p.smtp_host,'port',p.smtp_port,'transport',p.transport_profile_id,
  'routeActive',r.is_active,'routeScope',r.route_scope,'routeEnvironment',r.environment_type,'target',r.target_email))
  FROM public.ediel_route_profiles p JOIN public.communication_routes r ON r.id=p.communication_route_id AND r.company_id=p.company_id
  WHERE r.company_id=${literal(companyId)} AND r.route_scope='ediel_ack' AND p.environment='test'`)).toEqual([{
  company:companyId,environment:'test',active:true,enabled:true,standard:'edifact',format:'edifact',
  sender:sender[0],receiver:receiver[0],senderSubaddress:sender[2]||'',receiverSubaddress:receiver[2]||'',
  app:segmentComposite(unb,7,wire.una)[0],family:null,code:null,mailbox:from,host,port,transport:null,
  routeActive:true,routeScope:'ediel_ack',routeEnvironment:'bilateral_test',target:'recipient@example.invalid',
 }])
}
async function receivedEnd(variant:typeof variants[number],candidate:ReceivedEndCandidate={},independent=false){
 candidate={...candidate,retainOriginalMailbox:true}
 if(variant==='L'){
  const f=await receivedNationalRescissionEnd(true,false,candidate,
   independent?sibling=>prepareIndependentNationalEndTarget(sibling,provider):undefined)
  await configureAckProfile(f.companyId,f.endWire)
  return{...f,sourceId:f.endSourceId,wire:f.endWire,startSourceId:f.sourceId,effects:()=>nationalEndEffects(f)}
 }
 const f=await receivedLkEnd(true,candidate)
 await configureAckProfile(f.companyId,f.wire)
 return{...f,effects:()=>lkEffects(f)}
}
const immutable=(id:string)=>sql(`SELECT jsonb_build_object('raw',raw_payload,
 'direction',direction,'company',company_id,'hash',immutable_payload_hash,'renderedAt',immutable_rendered_at,'receivedAt',message_received_at,
 'context',execution_context_snapshot,'captured',(SELECT to_jsonb(s)
 FROM gridex_received_sources.sources s WHERE s.source_message_id=m.id),
 'originalMail',(SELECT jsonb_build_object('id',mail.id,'mailbox',mail.mailbox_id,'raw',mail.raw_edifact_payload,
 'mime',mail.raw_email,'receivedAt',mail.received_at,'from',mail.from_address,'to',mail.to_address)
 FROM public.inbound_email_messages mail WHERE mail.id=m.inbound_email_message_id),
 'reception',(SELECT to_jsonb(r) FROM gridex_ediel_inbound_receptions.receptions r WHERE r.source_message_id=m.id))
 FROM public.ediel_messages m WHERE id=${literal(id)}`)
// Full durable business rows across all tenants. The sole permitted end period
// and this received source's review/final-value cases are inspected separately.
type DurableRow=Record<string,unknown>&{id:string}
type DurableGraph=Record<string,unknown>&{contracts:DurableRow[];contractEvents:DurableRow[];contractDomainEvents:DurableRow[];operationTasks:DurableRow[]}
const unrelated=(periodId:string,sourceId:string)=>sql<DurableGraph>(`SELECT jsonb_build_object(
 'periods',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.customer_supply_periods p WHERE id<>${literal(periodId)}::uuid),
 'customers',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM public.customers c),
 'contracts',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM public.customer_contracts c),
 'contractEvents',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM public.customer_contract_events e),
 'contractDomainEvents',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM public.domain_events e WHERE event_type='contract.event.recorded'),
 'operationTasks',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.customer_operation_tasks t),
 'invoices',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY id),'[]') FROM public.customer_invoices i),
 'billingUnderlays',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY id),'[]') FROM public.billing_underlays b),
 'billingItems',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY id),'[]') FROM public.billing_underlay_items b),
 'sites',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.customer_sites s),
 'points',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.metering_points p),
 'tasks',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM public.customer_cases c WHERE metadata->>'source_ediel_message_id' IS DISTINCT FROM ${literal(sourceId)}))`)
const processingClock=()=>sql<string>('SELECT to_jsonb(clock_timestamp())')
const newRows=(before:DurableRow[],after:DurableRow[])=>after.filter(row=>!before.some(prior=>prior.id===row.id))
const ordered=(rows:DurableRow[])=>[...rows].sort((a,b)=>a.id.localeCompare(b.id))
function expectedContractFollowup(input:{before:DurableGraph;after:DurableGraph;period:Record<string,unknown>;
 f:Awaited<ReturnType<typeof receivedEnd>>;startedAt:string;finishedAt:string}):DurableGraph{
 const {before,after,period,f,startedAt,finishedAt}=input
 const contractId=period.customer_contract_id??period.contract_id
 expect(contractId).toBe(f.contractId)
 const contract=before.contracts.find(row=>row.id===contractId)!
 expect(contract).toMatchObject({id:f.contractId,company_id:f.companyId,customer_id:f.customerId,metering_point_id:f.pointId,status:'signed'})
 // This declared variable-price fixture has no binding-fee obligation.
 expect(Number(contract.binding_months??0)).toBe(0)
 const events=newRows(before.contractEvents,after.contractEvents)
 expect(events).toHaveLength(1)
 const event=events[0],endKey=`source-end:${f.periodId}:2026-10-16`
 const eventKey=`supply-end:${f.contractId}:${endKey}`,happenedAt=String(event.happened_at)
 expect(Number.isFinite(Date.parse(happenedAt))).toBe(true)
 expect(Date.parse(happenedAt)).toBeGreaterThanOrEqual(Date.parse(startedAt))
 expect(Date.parse(happenedAt)).toBeLessThanOrEqual(Date.parse(finishedAt))
 expect(event).toMatchObject({company_id:f.companyId,customer_id:f.customerId,customer_contract_id:f.contractId,
  event_type:'terminated',actor_user_id:null})
 // The delivered trigger records the retained period basis here. The received
 // end's exact source link is separately asserted on the period and receipts.
 expect(event.metadata).toEqual({ends_at:'2026-10-16',termination_notice_date:happenedAt,
  termination_reason:'supply_end',reason_code:'supply_end',source_message_id:f.startSourceId,idempotency_key:eventKey})
 const expectedContract={...contract,status:'terminated',ended_at:'2026-10-16T00:00:00+00:00',
  termination_notice_date:happenedAt.slice(0,10),termination_reason:'supply_end',status_reason_code:'supply_end',
  metadata:{...(contract.metadata as Record<string,unknown>),status_reason_code:'supply_end'},updated_at:happenedAt,updated_by:null}
 expect(after.contracts.find(row=>row.id===contractId)).toEqual(expectedContract)
 const domainEvents=newRows(before.contractDomainEvents,after.contractDomainEvents)
 expect(domainEvents).toHaveLength(1)
 expect(domainEvents[0]).toMatchObject({company_id:f.companyId,event_type:'contract.event.recorded',aggregate_type:'customer_contract',
  aggregate_id:f.contractId,actor_user_id:null,source:'gridex_record_customer_contract_event_v1',idempotency_key:`customer-contract-event:${eventKey}`})
 expect(domainEvents[0].payload).toEqual({customer_contract_event_id:event.id,customer_id:f.customerId,
  event_type:'terminated',previous_status:'signed',new_status:'terminated'})
 const tasks=newRows(before.operationTasks,after.operationTasks)
 expect(tasks).toHaveLength(1)
 expect(tasks[0]).toMatchObject({company_id:f.companyId,customer_id:f.customerId,metering_point_id:f.pointId,
  task_type:'final_invoice_pending',status:'open',priority:'high',resolved_at:null})
 expect(tasks[0].metadata).toEqual({supply_end_date:'2026-10-16',end_reason:'supply_end',end_key:endKey,supply_period_id:f.periodId})
 // Preserve every other contract field, old event/task row, tenant and billing
 // row. Only these exact, independently scoped committed effects may differ.
 return{...before,contracts:before.contracts.map(row=>row.id===contractId?expectedContract:row),
  contractEvents:ordered([...before.contractEvents,event]),contractDomainEvents:ordered([...before.contractDomainEvents,...domainEvents]),
  operationTasks:ordered([...before.operationTasks,...tasks])}
}
const acknowledgements=(sourceId:string)=>sql<EdielMessageRow[]>(`SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY message_family),'[]')
 FROM public.ediel_messages m WHERE related_message_id=${literal(sourceId)} AND direction='outbound'`)
async function ackDiagnostics(f:{sourceId:string;companyId:string;actorUserId:string}){
 const {sourceId}=f
 const observed=sql(`SELECT jsonb_build_object(
 'technical',(SELECT jsonb_build_object('status',status,'reason',reason) FROM gridex_ediel_technical_ack.sources WHERE source_message_id=${literal(sourceId)}),
 'blocked',(SELECT jsonb_agg(jsonb_build_object('family',payload->>'ackFamily','message',message) ORDER BY id)
 FROM public.ediel_message_events WHERE ediel_message_id=${literal(sourceId)} AND payload->>'blockedBy'='canonical_inbound_ack_guard'))`)
 if(acknowledgements(f.sourceId).some(m=>m.message_family==='CONTRL'))return observed
 const {from,host,port}=edielSmtpConfig()
 // Observe the real read-only public refusal; never manufacture a route,
 // disclose its DTO or convert a refusal into accepted transport authority.
 const {error}=await supabaseService.rpc('ediel_read_technical_syntax_ack_route_v1',{
  p_company_id:f.companyId,p_actor_user_id:f.actorUserId,p_source_message_id:f.sourceId,
  p_smtp_from:from,p_smtp_host:host,p_smtp_port:port,
 })
 return{observed,routeReadError:error?{code:error.code,message:error.message}:null}
}
const invoicee=(name:string):Parts=>['NAD','IV',['SYNTHETIC-BILL','','89'],'',name,'Invoice Street','Town','','12345','SE']
const withInvoicee=(name:string)=>(parts:Parts[]):Parts[]=>[...parts,invoicee(name)]
async function missingFieldAcknowledgements(f:Awaited<ReturnType<typeof receivedEnd>>,field:'211'|'251'){
 const source=(await getEdielMessageById(f.sourceId))!,acks=acknowledgements(f.sourceId)
 expect(acks.map(m=>[m.message_family,m.ack_outcome]),JSON.stringify(await ackDiagnostics(f))).toEqual([['APERAK','negative'],['CONTRL','positive']])
 const original=tokenizeEdifact(f.wire),unb=original.segments.find(s=>s.tag==='UNB')
 const li=segmentComposite(original.segments.find(s=>s.tag==='RFF'&&segmentComposite(s,1,original.una)[0]==='LI'),1,original.una)[1]
 for(const ack of acks){
  expect(ack).toMatchObject({company_id:f.companyId,environment:'test',related_message_id:f.sourceId,direction:'outbound'})
  expect(validateUnsmGrammar(ack.raw_payload!).issues.filter(i=>i.severity==='error')).toEqual([])
  expect(validateAckPreflight({ackMessage:ack,sourceMessage:source})).toMatchObject({ok:true})
  const parties=parseRulebookMessage(ack.raw_payload!)
  expect([parties.sender,parties.receiver]).toEqual([f.sender,f.receiver])
  const wire=tokenizeEdifact(ack.raw_payload!)
  if(ack.message_family==='CONTRL'){
   const uci=wire.segments.find(s=>s.tag==='UCI')
   expect(segmentComposite(uci,1,wire.una)[0]).toBe(segmentComposite(unb,5,original.una)[0])
   expect(segmentComposite(uci,2,wire.una)).toEqual(segmentComposite(unb,2,original.una))
   expect(segmentComposite(uci,3,wire.una)).toEqual(segmentComposite(unb,3,original.una))
   expect(segmentComposite(uci,4,wire.una)).toEqual(['1'])
  }else{
   expect(wire.segments.filter(s=>s.tag==='ERC').map(s=>segmentComposite(s,1,wire.una))).toEqual([['41','','260']])
   expect(wire.segments.filter(s=>s.tag==='FTX').map(s=>segmentComposite(s,3,wire.una))).toEqual([[field,'','260']])
   const refs=wire.segments.filter(s=>s.tag==='RFF').map(s=>segmentComposite(s,1,wire.una))
   expect(refs).toContainEqual(['Z07',f.external]);expect(refs).toContainEqual(['LI',li])
   expect(refs).toContainEqual(['ACW',segmentComposite(original.segments.find(s=>s.tag==='BGM'),2,original.una)[0]])
  }
 }
 return acks
}
afterEach(()=>{sourceSession.client=null;vi.unstubAllEnvs();vi.restoreAllMocks()})

// This supplement runs before this file's retained cases. It observes real C1
// preparation/importer calls without replacing any input, query, result or
// error. It does not reconstruct the unrecorded historical113 owner domain.
it('C1 grid-owner name relationship preserves complete actual L/LK candidate and importer choices and detects divergent aliases',async()=>{
 const {createZ01SupplierNativeFixture,ensureZ01SupplierKnownWrongGridArea}=await import('./helpers/ediel-z02-supplier-native-fixture')
 for(const [key,value]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_EMAIL_PROVIDER:'strato',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',GRIDEX_CUSTOMER_DATA_EDIEL_ENVIRONMENT:'test'}))vi.stubEnv(key,value)
 const actualSql=c1NativeBase.nativeSql,actualRpc=supabaseService.rpc.bind(supabaseService)
 // Exact old prosrc from frozen2e/b5429f0d, evaluated only as a scalar SELECT.
 // String.raw retains TWO backslashes in each old SQL string literal.
 const oldBody=String.raw`
  select regexp_replace(
    regexp_replace(
      regexp_replace(lower(btrim(coalesce(p_name, ''))), '[^a-z0-9åäö]+', ' ', 'g'),
      '\\s+(ab|aktiebolag)$',
      '',
      'g'
    ),
    '\\s+',
    '',
    'g'
  );
`
 expect(createHash('sha256').update(oldBody).digest('hex')).toBe('b5429f0ddf476ecc1a1f079ecd32fa468d89b576888ef41bd65a143314f309cf')
 const oldKey=(operand:string)=>oldBody.trim().replace(/^select\s+/,'').replace(/;$/,'').replace(/\bp_name\b/g,operand)
 type Owner={id:string;name:string;is_active:boolean|null;ediel_id:string|null;ops_grid_owner_id:string|null;market_actor_id:string|null;source:string|null;old_key:string;current_key:string;old_match:boolean;current_match:boolean;canonical:boolean;lower_exact:boolean}
 type Domain={target:{name:string;oldKey:string;currentKey:string};universeCount:number;universeHash:string;owners:Owner[];oldIds:string[];currentIds:string[];oldCanonicalIds:string[];currentCanonicalIds:string[];lowerExactIds:string[]}
 const readDomain=(name:string,values=false):Domain=>actualSql<Domain>(`WITH target AS(SELECT ${literal(name)}::text name),
 owners AS(${values?`SELECT * FROM(VALUES
  ('COUNTER-EXACT','Synthetic normal grid',true,'60000','DECLARED-OPS',NULL::text,'VALUES_ONLY'),
  ('COUNTER-COMPACT','Syntheticnormalgrid',true,'60001','DECLARED-OPS',NULL::text,'VALUES_ONLY'),
  ('COUNTER-SUFFIX','Synthetic normal grid AB',true,'60002','DECLARED-OPS',NULL::text,'VALUES_ONLY')) v(id,name,is_active,ediel_id,ops_grid_owner_id,market_actor_id,source)`:
  'SELECT id::text,name,is_active,ediel_id,ops_grid_owner_id::text,market_actor_id::text,source FROM public.platform_grid_owners'}),
 evaluated AS(SELECT pgo.*,${oldKey('pgo.name')} old_key,public.gridex_grid_owner_name_key(pgo.name) current_key,
  ${oldKey('pgo.name')}=${oldKey('target.name')} old_match,
  public.gridex_grid_owner_name_key(pgo.name)=public.gridex_grid_owner_name_key(target.name) current_match,
  coalesce(pgo.is_active,true)=true AND nullif(btrim(pgo.ediel_id),'') IS NOT NULL AND pgo.ops_grid_owner_id IS NOT NULL canonical,
  lower(pgo.name)=lower(btrim(target.name)) lower_exact FROM owners pgo CROSS JOIN target)
 SELECT jsonb_build_object('target',(SELECT jsonb_build_object('name',name,'oldKey',${oldKey('target.name')},'currentKey',public.gridex_grid_owner_name_key(name)) FROM target),
 'universeCount',(SELECT count(*) FROM evaluated),'universeHash',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(e) ORDER BY id)::text,'[]'),'UTF8')),'hex') FROM evaluated e),
 'owners',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM evaluated e WHERE old_match OR current_match OR lower_exact),
 'oldIds',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') FROM evaluated WHERE old_match),
 'currentIds',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') FROM evaluated WHERE current_match),
 'oldCanonicalIds',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') FROM evaluated WHERE old_match AND canonical),
 'currentCanonicalIds',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') FROM evaluated WHERE current_match AND canonical),
 'lowerExactIds',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') FROM evaluated WHERE lower_exact))`)
 const choice=(d:Domain,old:boolean)=>{
  const ids=old?d.oldIds:d.currentIds,canonical=old?d.oldCanonicalIds:d.currentCanonicalIds
  // Helpers use JS trim; the importer uses SQL btrim. Keep each real filter,
  // rather than assuming unrestricted public Ediel strings normalize alike.
  const helperCanonical=d.owners.filter(r=>(old?r.old_match:r.current_match)&&r.is_active!==false
   && typeof r.ediel_id==='string'&&Boolean(r.ediel_id.trim())&&r.ops_grid_owner_id!==null).map(r=>r.id)
  return{helperCandidateCount:ids.length,helperCanonicalIds:helperCanonical,helperCanonicalCount:helperCanonical.length,
   helper343HoldIfImportRequired:ids.length>0&&helperCanonical.length!==1,helper424HoldIfImportRequired:ids.length>0&&helperCanonical.length!==1,
   importerCanonicalCount:canonical.length,lowerExactCount:d.lowerExactIds.length,
   importerBranch:canonical.length===1?'reuse_canonical':d.lowerExactIds.length?'lower_name_update':'insert_owner',
   selectedOwnerId:canonical.length===1?canonical[0]:d.lowerExactIds[0]??null}
 }
 const sameRelation=(d:Domain)=>{
  expect(d.currentIds,'Complete unrestricted helper343/424 match domain').toEqual(d.oldIds)
  expect(d.currentCanonicalIds,'Complete active+Ediel+OPS importer canonical domain').toEqual(d.oldCanonicalIds)
  expect(choice(d,false),'Canonical count/min-ID and lowercase fallback branch').toEqual(choice(d,true))
 }
 const emit=(phase:string,value:unknown)=>console.info('C1_NAME_RELATION',JSON.stringify({phase,...value as Record<string,unknown>}))
 const catalog=actualSql<Record<string,unknown>>(`SELECT jsonb_build_object('standardConformingStrings',current_setting('standard_conforming_strings'),
  'serverEncoding',current_setting('server_encoding'),'collation',(SELECT datcollate FROM pg_catalog.pg_database WHERE datname=current_database()),
  'function',(SELECT jsonb_build_object('oid',p.oid,'definition',pg_get_functiondef(p.oid),'prosrcHash',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),'config',p.proconfig,'volatility',p.provolatile,'parallel',p.proparallel,'securityDefiner',p.prosecdef)
   FROM pg_proc p WHERE p.oid='public.gridex_grid_owner_name_key(text)'::regprocedure),
  'indexes',(SELECT jsonb_agg(jsonb_build_object('name',indexname,'definition',indexdef) ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND tablename='platform_grid_owners'))`)
 emit('runtime-catalog',{catalog,oldProsrcHash:createHash('sha256').update(oldBody).digest('hex')})
 expect(catalog).toMatchObject({standardConformingStrings:'on',serverEncoding:'UTF8',function:{prosrcHash:'b4597732d33dd066a4c6883db44b62948e56769c894a4ea9b2cf99c23c9118ef',config:['search_path=public, pg_temp'],volatility:'i',parallel:'s',securityDefiner:false}})
 const counters=readDomain('Synthetic normal grid',true)
 emit('VALUES-countermodels',{domain:counters,oldChoice:choice(counters,true),currentChoice:choice(counters,false),acceptedRowsInserted:false})
 expect(counters.target).toEqual({name:'Synthetic normal grid',oldKey:'synthetic normal grid',currentKey:'syntheticnormalgrid'})
 expect(counters.oldIds).toEqual(['COUNTER-EXACT'])
 expect(counters.currentIds).toEqual(['COUNTER-COMPACT','COUNTER-EXACT','COUNTER-SUFFIX'])
 expect(counters.oldCanonicalIds).toEqual(['COUNTER-EXACT']);expect(counters.currentCanonicalIds).toHaveLength(3)
 expect(()=>sameRelation(counters)).toThrow()
 let phase='',provenance:Record<string,unknown>|null=null
 const reached:Array<{phase:string;site:string;target:string}>=[]
 const sqlObserver=vi.spyOn(c1NativeBase,'nativeSql').mockImplementation(<T>(input:string):T=>{
  const comparison=/public\.gridex_grid_owner_name_key\(name\)\s*=\s*public\.gridex_grid_owner_name_key\(('(?:[^']|'')*')\)\s*;?\s*$/.exec(input)
  if(!comparison){
   const result=actualSql<T>(input),row=result as {source?:{grid?:Record<string,unknown>};grid?:Record<string,unknown>}
   const grid=row?.source?.grid??row?.grid
   if(grid&&typeof grid.name==='string'&&typeof grid.id==='string')provenance={gridId:grid.id,companyId:grid.company_id,name:grid.name,edielId:grid.ediel_id}
   return result
  }
  const name=comparison[1].slice(1,-1).replaceAll("''","'"),before=readDomain(name)
  emit(phase+'.query-entry',{site:phase.endsWith('setup')?'helper343':'helper424',provenance,domain:before,oldChoice:choice(before,true),currentChoice:choice(before,false)})
  expect(provenance?.name,'Reached right operand from actual source-grid snapshot').toBe(name)
  const result=actualSql<T>(input),after=readDomain(name)
  emit(phase+'.query-exit',{domain:after,returnedIds:(result as Owner[]).map(r=>r.id)})
  sameRelation(before);expect(after).toEqual(before)
  expect((result as Owner[]).map(r=>r.id)).toEqual(before.currentIds)
  reached.push({phase,site:phase.endsWith('setup')?'helper343':'helper424',target:name})
  return result
 })
 // This selected public importer awaits RPC directly. Its original argument
 // references and exact response/error are passed through; no other RPC wraps.
 const rpcObserver=vi.spyOn(supabaseService,'rpc').mockImplementation(((...args:Parameters<typeof actualRpc>)=>{
  if(args[0]!=='gridex_import_grid_area_master_row')return actualRpc(...args)
  const input=args[1] as Record<string,unknown>,name=String(input.p_grid_owner_name),before=readDomain(name)
  emit(phase+'.importer-entry',{site:'importer73329',provenance,input:{name,areaCode:input.p_grid_area_code,priceArea:input.p_price_area,source:input.p_source},domain:before,oldChoice:choice(before,true),currentChoice:choice(before,false)})
  expect(provenance?.name).toBe(name);sameRelation(before)
  return Promise.resolve(actualRpc(...args)).then(response=>{
   const after=readDomain(name),area=response.data?actualSql<{ownerId:string;ownerName:string;code:string}>(`SELECT jsonb_build_object('ownerId',grid_owner_id,'ownerName',grid_owner_name,'code',grid_area_code) FROM public.platform_grid_areas WHERE id=${literal(response.data)}`):null
   emit(phase+'.importer-exit',{domain:after,result:{area,errorCode:response.error?.code??null}})
   sameRelation(after)
   if(!response.error){expect(area?.ownerName).toBe(name);if(choice(before,false).selectedOwnerId)expect(area?.ownerId).toBe(choice(before,false).selectedOwnerId);else expect(after.lowerExactIds).toEqual([area!.ownerId])}
   reached.push({phase,site:'importer73329',target:name})
   return response
  })
 }) as typeof supabaseService.rpc)
 try{
  for(const variant of variants){
   phase=variant+'.setup';provenance=null
   const f=await createZ01SupplierNativeFixture(variant,email=>provider.mockResolvedValue({accepted:[email],rejected:[],messageId:'synthetic-C1-name-relationship',response:'250 synthetic accepted'}))
   const source=actualSql<{gridId:string;companyId:string;name:string;edielId:string;actorId:string;actorName:string}>(`SELECT jsonb_build_object('gridId',g.id,'companyId',g.company_id,'name',g.name,'edielId',g.ediel_id,'actorId',a.id,'actorName',a.name) FROM public.grid_owners g JOIN public.platform_market_actors a ON a.id=${literal(f.marketActorId)} WHERE g.id=${literal(f.gridId)} AND g.company_id=${literal(f.companyId)}`)
   expect(source).toMatchObject({gridId:f.gridId,companyId:f.companyId,name:'Synthetic normal grid',edielId:f.receiver,actorId:f.marketActorId,actorName:`Synthetic normal grid ${f.marketActorId}`})
   expect(provenance).toEqual({gridId:source.gridId,companyId:source.companyId,name:source.name,edielId:source.edielId})
   expect(reached.filter(r=>r.phase===phase&&r.site==='helper343')).toHaveLength(1)
   const before=readDomain(source.name);emit(variant+'.known-area-before',{source,domain:before,oldChoice:choice(before,true),currentChoice:choice(before,false)});sameRelation(before)
   expect(before.target.oldKey).not.toBe(before.target.currentKey)
   phase=variant+'.known-area'
   const known=await ensureZ01SupplierKnownWrongGridArea(f),after=readDomain(source.name)
   emit(variant+'.known-area-after',{domain:after,branch:known.importResult===null?'existing_valid_reference_reused':'public_reference_import',
    area:{id:known.row.id,ownerId:known.row.grid_owner_id,ownerName:known.row.grid_owner_name,code:known.gridAreaCode,priceArea:known.priceArea,isActive:known.row.is_active,validFrom:known.row.valid_from,validTo:known.row.valid_to},
    mapping:known.mapping,reached:reached.filter(r=>r.phase===phase)})
   sameRelation(after);expect(known.gridOwnerName).toBe(source.name)
   if(known.importResult===null){expect(after).toEqual(before);expect(reached.filter(r=>r.phase===phase)).toEqual([])}
   else expect(reached.filter(r=>r.phase===phase&&r.site==='importer73329')).toHaveLength(1)
  }
  expect(reached.some(r=>r.site==='importer73329'),'At least one actual setup/reference importer must reach the real function').toBe(true)
  emit('qualification-boundary',{scope:'THIS_L_LK_SETUP_AND_KNOWN_AREA_SUPPLEMENT_ONLY',reached,completeCurrentMatchedDomains:true,
   historical113OwnerDomain:'NOT_RETAINED_OR_RECONSTRUCTED',current113Execution:'NOT_RUN',universalAliasEquivalence:false})
 }finally{sqlObserver.mockRestore();rpcObserver.mockRestore()}
},120000)

it.each([{variant:'L',linked:true},{variant:'LK',linked:true},{variant:'L',linked:false}] as const)(
 'actual Z05$variant (request linkage $linked) commits its own end, physical acknowledgements and scoped final-value task while preserving history and every unrelated graph',async({variant,linked})=>{
 const f=await receivedEnd(variant,linked?{}:{lineItemReference:'L-INDEPENDENT-OWN-NOTICE'},!linked),before=f.effects() as {period:Record<string,unknown>;watches?:unknown}
 const preserveSibling=()=>{
  if(linked)return
  if(!('assertSiblingPreserved' in f)||!f.assertSiblingPreserved)throw Error('independent_end_sibling_preservation_required')
  f.assertSiblingPreserved()
 }
 const sourceBefore=immutable(f.sourceId),originalBefore=immutable(f.original.id),startBefore=immutable(f.startSourceId),unrelatedBefore=unrelated(f.periodId,f.sourceId)
 const businessBefore=sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND direction='outbound' AND message_family='PRODAT'`)
 expect(before.period).toMatchObject({id:f.periodId,source_end_message_id:null})
 preserveSibling()
 const startedAt=processingClock()
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 const finishedAt=processingClock()
 const after=f.effects()
 preserveSibling()
 expect(after).toMatchObject({period:{id:f.periodId,company_id:f.companyId,customer_id:f.customerId,
  metering_point_id:f.pointId,source_message_id:f.startSourceId,start_date:before.period.start_date,
  market_start_at:before.period.market_start_at,market_state_version:Number(before.period.market_state_version)+1,
  end_date:'2026-10-16',market_end_at:'2026-10-16T12:30:00+00:00',source_end_message_id:f.sourceId,status:'ending'},
  ends:linked?1:0,transitions:1,positive:1,followups:1,audits:linked?1:0})
 const ordinaryReceiptState=()=>sql(`SELECT jsonb_build_object(
  'effects',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM gridex_received_sources.supply_object_effect_receipts r WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(f.sourceId)}),
  'followups',(SELECT jsonb_agg(to_jsonb(r) ORDER BY effect_receipt_id) FROM gridex_received_sources.supply_end_followups r WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(f.sourceId)}))`)
 const ordinaryAfter=linked?null:ordinaryReceiptState()
 if(!linked){
  expect(before.watches).toMatchObject([{source:f.original.id,code:'Z05',subtype:'L',status:'pending',fulfilledBy:null,dueAt:null}])
  expect(after).toMatchObject({watches:before.watches})
  const receipts=sql<Record<string,unknown>[]>(`SELECT jsonb_agg(jsonb_build_object('id',r.id,'company',r.company_id,'environment',r.environment,'source',r.source_message_id,
   'hashesValid',r.payload_hash=encode(sha256(convert_to(${literal(f.wire)},'UTF8')),'hex') AND r.effect_hash=encode(sha256(convert_to(r.effect_text,'UTF8')),'hex'),
   'effect',r.effect_text::jsonb)) FROM gridex_received_sources.supply_object_effect_receipts r WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(f.sourceId)}`)
  expect(receipts).toHaveLength(1);expect(receipts[0]).toMatchObject({company:f.companyId,environment:'test',source:f.sourceId,hashesValid:true,
   effect:{owner:'inbound-supply-object-v1',sourceMessageId:f.sourceId,companyId:f.companyId,environment:'test',
    wire:{reason:'Z22',li:'L-INDEPENDENT-OWN-NOTICE',point:f.external,customerIdentity:f.customerIdentity.id,end:'202610161330'},
    plan:{kind:'end',periodId:f.periodId},resultingStates:[{id:f.periodId,source_end_message_id:f.sourceId}]}})
 }
 const source=(await getEdielMessageById(f.sourceId))!,acks=acknowledgements(f.sourceId)
 expect(acks.map(m=>[m.message_family,m.ack_outcome]),JSON.stringify(await ackDiagnostics(f))).toEqual([['APERAK','positive'],['CONTRL','positive']])
 const sourceWire=tokenizeEdifact(f.wire),sourceUnb=sourceWire.segments.find(s=>s.tag==='UNB')
 const li=segmentComposite(sourceWire.segments.find(s=>s.tag==='RFF'&&segmentComposite(s,1,sourceWire.una)[0]==='LI'),1,sourceWire.una)[1]
 for(const ack of acks){
  expect(ack).toMatchObject({company_id:f.companyId,environment:'test',related_message_id:f.sourceId,direction:'outbound'})
  expect(validateUnsmGrammar(ack.raw_payload!).issues.filter(i=>i.severity==='error')).toEqual([])
  expect(validateAckPreflight({ackMessage:ack,sourceMessage:source})).toMatchObject({ok:true})
  const parsed=parseRulebookMessage(ack.raw_payload!)
  expect([parsed.sender,parsed.receiver]).toEqual([f.sender,f.receiver])
  const wire=tokenizeEdifact(ack.raw_payload!)
  if(ack.message_family==='CONTRL'){
   const uci=wire.segments.find(s=>s.tag==='UCI')
   expect(segmentComposite(uci,1,wire.una)[0]).toBe(segmentComposite(sourceUnb,5,sourceWire.una)[0])
   expect(segmentComposite(uci,2,wire.una)).toEqual(segmentComposite(sourceUnb,2,sourceWire.una))
   expect(segmentComposite(uci,3,wire.una)).toEqual(segmentComposite(sourceUnb,3,sourceWire.una))
   expect(segmentComposite(uci,4,wire.una)).toEqual(['1'])
  }else{
   expect(wire.segments.filter(s=>s.tag==='ERC').map(s=>segmentComposite(s,1,wire.una)[0])).toEqual(['100'])
   const refs=wire.segments.filter(s=>s.tag==='RFF').map(s=>segmentComposite(s,1,wire.una))
   expect(refs).toContainEqual(['Z07',f.external]);expect(refs).toContainEqual(['LI',li])
   expect(refs).toContainEqual(['ACW',segmentComposite(sourceWire.segments.find(s=>s.tag==='BGM'),2,sourceWire.una)[0]])
  }
 }
 const tasks=sql<Record<string,unknown>[]>(`SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.customer_cases c
  WHERE company_id=${literal(f.companyId)} AND reason_category='final_metering_and_billing' AND metadata->>'source_ediel_message_id'=${literal(f.sourceId)}`)
 expect(tasks).toHaveLength(1);expect(tasks[0]).toMatchObject({company_id:f.companyId,customer_id:f.customerId,
  metering_point_id:f.pointId,reason_category:'final_metering_and_billing',status:'open',metadata:{source_ediel_message_id:f.sourceId,review_intent:'final_metering_and_billing'}})
 if(!linked){
  expect(tasks[0]).toMatchObject({source:'ediel_supply_end_effect',source_ediel_message_id:f.sourceId,
   metadata:{supply_period_id:f.periodId}})
  const projected=sql<Record<string,unknown>[]>(`SELECT jsonb_agg(to_jsonb(r)) FROM gridex_received_sources.supply_end_followups r WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(f.sourceId)}`)
  expect(projected).toHaveLength(1);expect(projected[0]).toMatchObject({company_id:f.companyId,source_message_id:f.sourceId,
   case_id:tasks[0].id,customer_id:f.customerId,metering_point_id:f.pointId,supply_period_id:f.periodId})
 }
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND direction='outbound' AND message_family='PRODAT'`)).toBe(businessBefore)
 const expectedGraph=expectedContractFollowup({before:unrelatedBefore,after:unrelated(f.periodId,f.sourceId),period:before.period,f,startedAt,finishedAt})
 expect(unrelated(f.periodId,f.sourceId)).toEqual(expectedGraph)
 expect(immutable(f.original.id)).toEqual(originalBefore);expect(immutable(f.startSourceId)).toEqual(startBefore);expect(immutable(f.sourceId)).toEqual(sourceBefore)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 expect(f.effects()).toEqual(after);expect(acknowledgements(f.sourceId)).toEqual(acks)
 expect(sql(`SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.customer_cases c WHERE company_id=${literal(f.companyId)} AND reason_category='final_metering_and_billing' AND metadata->>'source_ediel_message_id'=${literal(f.sourceId)}`)).toEqual(tasks)
 expect(unrelated(f.periodId,f.sourceId)).toEqual(expectedGraph)
 expect(immutable(f.original.id)).toEqual(originalBefore);expect(immutable(f.startSourceId)).toEqual(startBefore);expect(immutable(f.sourceId)).toEqual(sourceBefore)
 if(!linked)expect(ordinaryReceiptState()).toEqual(ordinaryAfter)
 preserveSibling()
},120000)

// IV is physically present in both candidates. Absence of the ordinary optional
// IV group, or field310 without independently known death, is never a defect.
it.each(variants)('actual Z05%s complete IV is favorable and a missing present-group name has its own field251 diagnostic and no business effect',async variant=>{
 const valid=await receivedEnd(variant,{transformParts:withInvoicee('Synthetic Invoicee')})
 expect([valid.decision.syntaxDecision,valid.decision.applicationDecision,valid.decision.functionalDecision]).toEqual(['accepted','accepted','accepted'])
 await processInboundEdielMessage({actorUserId:valid.actorUserId,edielMessageId:valid.sourceId});expect(valid.effects()).toMatchObject({ends:1,positive:1,followups:1})
 const f=await receivedEnd(variant,{transformParts:withInvoicee(''),qualification:'observe'}),before=f.effects(),graph=unrelated(f.periodId,f.sourceId),raw=immutable(f.sourceId)
 expect(f.decision.applicationDecision,JSON.stringify(f.decision.issues)).toBe('rejected')
 expect(f.decision.issues.some(i=>i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber==='251'&&i.prodatDiagnostic.errorKind==='missing'),JSON.stringify(f.decision.issues)).toBe(true)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 const acks=await missingFieldAcknowledgements(f,'251')
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 expect(acknowledgements(f.sourceId)).toEqual(acks)
 expect(f.effects()).toEqual(before);expect(unrelated(f.periodId,f.sourceId)).toEqual(graph);expect(immutable(f.sourceId)).toEqual(raw)
},120000)

it.each(variants)('actual Z05%s missing mandatory end date is rejected with field211 and cannot end any period or create positive/final-value effects',async variant=>{
 const f=await receivedEnd(variant,{qualification:'observe',transformParts:parts=>parts.filter(p=>!(p[0]==='DTM'&&Array.isArray(p[1])&&p[1][0]==='93'))}),before=f.effects(),graph=unrelated(f.periodId,f.sourceId),raw=immutable(f.sourceId)
 expect(f.decision.applicationDecision,JSON.stringify(f.decision.issues)).toBe('rejected')
 expect(f.decision.issues.some(i=>i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber==='211'&&i.prodatDiagnostic.errorKind==='missing'),JSON.stringify(f.decision.issues)).toBe(true)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 const acks=await missingFieldAcknowledgements(f,'211')
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 expect(acknowledgements(f.sourceId)).toEqual(acks)
 expect(f.effects()).toEqual(before);expect(unrelated(f.periodId,f.sourceId)).toEqual(graph);expect(immutable(f.sourceId)).toEqual(raw)
},120000)

it.each(variants)('actual Z05%s current receiving supplier role withdrawal holds before runtime and preserves its sealed original and every business graph',async variant=>{
 const f=await receivedEnd(variant)
 // Wire/profile qualification is favorable; current tenant role resolution is
 // a separate real consumer. Preserve historical receive identity and clock.
 expect([f.decision.syntaxDecision,f.decision.applicationDecision,f.decision.functionalDecision]).toEqual(['accepted','accepted','accepted'])
 sql(`UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp()-interval '1 second'
  WHERE company_id=${literal(f.companyId)} AND environment='test' AND role_code='electricity_supplier'`)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.tenant_actor_roles WHERE company_id=${literal(f.companyId)} AND environment='test' AND role_code='electricity_supplier' AND(valid_to IS NULL OR valid_to>clock_timestamp())`)).toBe(0)
 const before=f.effects(),graph=unrelated(f.periodId,f.sourceId),raw=immutable(f.sourceId)
 const routing=await resolveInboundTenantFromIdentifiers({existingCompanyId:f.companyId,environment:'test',
  senderEdielId:f.receiver,receiverEdielId:f.sender,marketActorEdielId:f.sender,
  applicationReference:'23-DDQ-PRODAT',messageFamily:'PRODAT',messageCode:'Z05'})
 expect(routing).toMatchObject({status:'ambiguous',companyId:null})
 expect(routing.evidence.filter(e=>e.source==='verified_legal_identity')).toEqual([])
 const held=await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 expect(held).toMatchObject({company_id:f.companyId,tenant_resolution_status:'tenant_ambiguous',business_match_status:'business_blocked',processing_status:'routing_unresolved'})
 const diagnostics=sql<Record<string,unknown>[]>(`SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM public.ediel_unresolved_items u WHERE source_message_id=${literal(f.sourceId)}`)
 expect(diagnostics).toHaveLength(1)
 expect(diagnostics[0]).toMatchObject({company_id:f.companyId,environment:'test',source_message_id:f.sourceId,issue_type:'tenant_ambiguous'})
 expect(f.effects()).toEqual(before);expect(unrelated(f.periodId,f.sourceId)).toEqual(graph);expect(immutable(f.sourceId)).toEqual(raw)
},120000)

it.each([
 ['customer',{qualification:'observe',transformParts:(parts:Parts[])=>parts.map(p=>p[0]==='NAD'&&p[1]==='UD'
  ?['NAD','UD',['198001011234','SE2','260'],'','Synthetic Other','Street','City','','12345','SE']:p)}],
 ['end minute',{endDate:'202610161331'}],
] as const)('actual national L wrong %s cannot execute any end, positive ACK or final-value task',async(_label,candidate)=>{
 const f=await receivedEnd('L',candidate),before=f.effects(),graph=unrelated(f.periodId,f.sourceId),raw=immutable(f.sourceId),original=immutable(f.original.id)
 expect([f.decision.syntaxDecision,f.decision.applicationDecision,f.decision.functionalDecision],JSON.stringify(f.decision.issues)).toEqual(['accepted','accepted','accepted'])
 expect(sql(`SELECT to_jsonb(gridex_supply_rescission.has_end_selector_v1(m,w.wire->'objects'->0) AND gridex_supply_rescission.matched_end_v1(m,w.wire,w.wire->'objects'->0) IS NULL)
  FROM public.ediel_messages m CROSS JOIN LATERAL(SELECT gridex_received_sources.normal_switch_wire_v1(m.raw_payload) wire) w WHERE m.id=${literal(f.sourceId)}`)).toBe(true)
 await processInboundEdielMessage({actorUserId:f.actorUserId,edielMessageId:f.sourceId})
 expect(f.effects()).toEqual(before);expect(unrelated(f.periodId,f.sourceId)).toEqual(graph)
 // These candidates retain the actual H LI+point+agency selector. Independent
 // Z05L can use its own LI; only the corresponding H end owes that reference.
 expect(()=>sql(`SELECT public.ediel_apply_supply_source_v1(${literal(f.companyId)},${literal(f.sourceId)},${literal(f.actorUserId)})`)).toThrow('supply_rescission_exact_sent_original_required')
 expect(immutable(f.sourceId)).toEqual(raw);expect(immutable(f.original.id)).toEqual(original)
},120000)

it.each(['outbound H request','inbound L end'] as const)('actual sealed %s rejects byte mutation without losing immutable history or creating an end',async lane=>{
 const f=await receivedEnd('L'),id=lane==='outbound H request'?f.original.id:f.sourceId,before=f.effects(),graph=unrelated(f.periodId,f.sourceId),raw=immutable(f.sourceId),original=immutable(f.original.id)
 const wire=lane==='outbound H request'?f.original.raw_payload!:f.wire,mutated=wire.replace('202610161330','202610161331')
 expect(mutated).not.toBe(wire)
 expect(()=>sql(`UPDATE public.ediel_messages SET raw_payload=${literal(mutated)} WHERE id=${literal(id)}`)).toThrow('immutable_ediel_payload_cannot_change')
 expect(f.effects()).toEqual(before);expect(unrelated(f.periodId,f.sourceId)).toEqual(graph);expect(immutable(f.sourceId)).toEqual(raw);expect(immutable(f.original.id)).toEqual(original)
},120000)

// The retained finite facade cases also execute its outbound early return before
// any RPC. Here the actual native source guard independently seals direction.
it.each(variants)('actual received Z05%s direction cannot be changed into outbound to bypass the inbound consumer',async variant=>{
 const f=await receivedEnd(variant),before=f.effects(),graph=unrelated(f.periodId,f.sourceId),raw=immutable(f.sourceId)
 expect(()=>sql(`UPDATE public.ediel_messages SET direction='outbound' WHERE id=${literal(f.sourceId)}`))
  .toThrow('immutable_ediel_received_context_cannot_change')
 expect(f.effects()).toEqual(before);expect(unrelated(f.periodId,f.sourceId)).toEqual(graph);expect(immutable(f.sourceId)).toEqual(raw)
},120000)
