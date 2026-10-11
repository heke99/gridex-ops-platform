// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO
// No hooks or registered tests. Inputs are prospective customer records;
// archive/review, permission coordination and the public producer all run.
import {randomUUID} from 'node:crypto'
import {expect} from 'vitest'
import {reviewNativeEscoAssignmentEvidence as review,nativeEscoSql as sql,nativeEscoLiteral as lit,
 nativeEscoExternal,seedNativeEscoFixture} from '../fixtures/ediel-service-evidence-native'
import {coordinateEdielServicePermission,resolveEdielServicePermissionCommand} from '@/lib/ediel/services/commands'
import {readServicePermissionOrigin} from '@/lib/ediel/services/permissionOrigin'
import {getCustomerExportContext,buildCustomerIdentityPayload,buildSitePayload,buildMeteringPointPayload,
 buildContractPayload,buildRoutePayload} from '@/lib/cis/db-shared'
import type {CommunicationRouteRow} from '@/lib/cis/types'

type Fixture=Awaited<ReturnType<typeof seedNativeEscoFixture>>
type Row=Record<string,unknown>
type State={business:Row;foreign:Row;commands:Row[];effects:Record<string,number>}
type Column={name:string;nullable:boolean;default:string|null}
type Window=readonly[number,number]
type Wiring={prospective:(mode:'V'|'VH',objectReply:boolean,field:'227'|'228'|'316')=>Promise<{f:Fixture;checkSentinel:()=>void}>;
 state:(f:Fixture)=>State;ledger:(f:Fixture)=>unknown;reviews:(f:Fixture,e:Awaited<ReturnType<typeof review>>)=>unknown}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const text=(v:unknown)=>typeof v==='string'?v.trim():''
const allRows=(table:string)=>sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM ${table} r`)
const columns=(table:string)=>sql<Column[]>(`SELECT jsonb_agg(jsonb_build_object('name',a.attname,'nullable',NOT a.attnotnull,
 'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d
 ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=${lit(table)}::regclass AND a.attnum>0 AND NOT a.attisdropped`)
function time(value:unknown,window:Window){
 expect(typeof value).toBe('string');const t=Date.parse(String(value));expect(Number.isFinite(t)).toBe(true)
 expect(t).toBeGreaterThanOrEqual(window[0]);expect(t).toBeLessThanOrEqual(window[1]);return value
}
// Freeze the real schema before the call. Check every column against explicit
// producer inputs or its independently read, restricted INSERT default.
function newRow(row:Row,writers:Row,schema:Column[],window:Window,oldIds:unknown[]){
 expect(Object.keys(row).sort()).toEqual(schema.map(c=>c.name).sort())
 expect(Object.keys(writers).every(k=>schema.some(c=>c.name===k))).toBe(true)
 const expected:Row={}
 for(const c of schema){
  if(Object.hasOwn(writers,c.name)){expected[c.name]=writers[c.name];continue}
  const d=c.default
  if(d==='gen_random_uuid()'){
   expect(c.name).toBe('id');expect(row.id).toMatch(uuid);expect(oldIds).not.toContain(row.id);expected.id=row.id
  }else if(d==='now()'||d==='clock_timestamp()')expected[c.name]=time(row[c.name],window)
  else if(d==="'{}'::jsonb")expected[c.name]={}
  else if(d==="'[]'::jsonb")expected[c.name]=[]
  else if(d==='0')expected[c.name]=0
  else if(d==='false')expected[c.name]=false
  else if(d===null&&c.nullable)expected[c.name]=null
  else throw Error(`native_customer_source_unreviewed_default:${c.name}:${d}`)
 }
 expect(row).toEqual(expected)
}
function added(before:Row[],after:Row[],key='id'){
 for(const row of before)expect(after.find(r=>r[key]===row[key])).toEqual(row)
 return after.filter(row=>!before.some(old=>old[key]===row[key]))
}
function omission(customer:Row,field:'227'|'228'|'316'){
 expect(customer).toMatchObject({customer_type:'private',name:'Synthetic Customer'})
 const legal=text(customer.org_number)||text(customer.personal_number)
 const name=text(customer.company_name)||text(customer.full_name)||[text(customer.first_name),text(customer.last_name)].filter(Boolean).join(' ')
 const country=text(customer.country)||text(customer.country_code)||text(customer.billing_country)
 expect(legal).toBe(field==='227'?'':'199001011234')
 expect(name).toBe(field==='228'?'':'Synthetic Customer')
 expect(country).toBe(field==='316'?'':'SE')
 expect(text(customer.org_number)).toBe('')
 expect(text(customer.company_name)).toBe('');expect(text(customer.full_name)).toBe('')
 expect(text(customer.country)).toBe('');expect(text(customer.country_code)).toBe('')
}

export async function refuseEscoCustomerSource(mode:'V'|'VH',field:'227'|'228'|'316',w:Wiring){
 const{f,checkSentinel}=await w.prospective(mode,false,field)
 const customer=sql<Row>(`SELECT to_jsonb(c) FROM public.customers c WHERE id=${lit(f.ids.customer)} AND company_id=${lit(f.ids.company)}`)
 omission(customer,field);expect(customer.customer_number).toBe(f.ids.customer)
 const billing=allRows('public.customer_billing_profile_revisions')
 const ownBilling=billing.filter(r=>r.company_id===f.ids.company&&r.customer_id===f.ids.customer)
 expect(ownBilling).toHaveLength(1);expect(customer.billing_profile_revision).toBe(1)
 expect(ownBilling[0]).toEqual({id:ownBilling[0].id,company_id:f.ids.company,customer_id:f.ids.customer,revision:1,
  invoice_email:customer.invoice_email,billing_street:customer.billing_street,billing_postal_code:customer.billing_postal_code,
  billing_city:customer.billing_city,billing_country:customer.billing_country,changed_fields:['created'],recorded_at:ownBilling[0].recorded_at})
 expect(ownBilling[0].id).toMatch(uuid);expect(Number.isFinite(Date.parse(String(ownBilling[0].recorded_at)))).toBe(true)
 expect(sql(`SELECT to_jsonb(country) FROM public.customer_sites WHERE id=${lit(f.ids.site)}`)).toBe('SE')
 const evidence=await review(f),reviews=w.reviews(f,evidence)
 expect(await f.command({action:'approve_assignment',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version}))
  .toMatchObject({status:'approved_waiting_permission'})
 expect(sql(`SELECT public.ediel_service_assignment_assessment_v1(${lit(f.ids.company)},${lit(f.assignment)})`))
  .toEqual({status:'authorized',providerCompanyId:f.ids.company,providerActorId:f.ids.legal,beneficiaryCompanyId:f.ids.beneficiary,
   assignmentId:f.assignment,assignmentVersion:f.current().version,environment:'test',customerId:f.ids.customer,dsoActorId:f.ids.dso,mode,purpose:f.fields.purpose})
 const originInput={providerCompanyId:f.ids.company,assignmentId:f.assignment,actorUserId:f.ids.actor,expectedVersion:f.current().version}
 const coordinated=await coordinateEdielServicePermission({...originInput,command:'request_access'})
 expect(coordinated).toMatchObject({status:'permission_required'});const permissionId=coordinated.permissionId
 expect(permissionId).toMatch(uuid);if(!permissionId)throw Error('native_customer_source_permission_required')
 const before=w.state(f),ledger=w.ledger(f),dispatch=allRows('public.outbound_dispatch_events')
 const auditTables=['public.route_decision_logs','public.ediel_routing_decisions','public.customer_operation_tasks']
 const auditBefore=Object.fromEntries(auditTables.map(t=>[t,allRows(t)]))
 const snapshots={billing,dispatch};const tableNames=['public.ediel_message_intents','public.outbound_requests','gridex_service_permission.origins','public.outbound_dispatch_events',...auditTables]
 const schemas=Object.fromEntries(tableNames.map(t=>[t,columns(t)]))
 const context=await getCustomerExportContext({actorUserId:f.ids.actor,customerId:f.ids.customer})
 expect(context.companyId).toBe(f.ids.company);expect(context.tenantIssues).toEqual([])
 expect(context.customer).toEqual(customer);expect(context.site).toBeNull();expect(context.meteringPoint).toBeNull()
 const route=sql<CommunicationRouteRow>(`SELECT to_jsonb(r) FROM public.communication_routes r WHERE id=${lit(f.ids.route)} AND company_id=${lit(f.ids.company)}`)
 const basis=await readServicePermissionOrigin({...originInput,permissionId,code:'Z13'})
 expect(basis.status).toBe('authorized');if(basis.status!=='authorized')throw Error('native_customer_source_origin_required')
 expect(basis).toMatchObject({companyId:f.ids.company,assignmentId:f.assignment,customerId:f.ids.customer,permissionId,
  code:'Z13',environment:'test',providerActorId:f.ids.legal,dsoActorId:f.ids.dso,legalSenderId:f.sender,legalReceiverId:f.receiver,
  mode,customer,agreementReference:'SYN-'+f.ids.customer.slice(0,20),requestedMethod:'Z04',evidenceSha256:evidence.hash,
  scopeBasisVersion:f.current().basis,customerClassification:'private',reportingTerm:mode==='V'?'indefinite':'bounded',purposeCode:'B72',frequency:'D'})
 expect(await resolveEdielServicePermissionCommand({...originInput,permissionId})).toEqual({status:'permission_required',permissionId})
 expect(w.state(f)).toEqual(before);expect(w.ledger(f)).toEqual(ledger)
 expect(allRows('public.customer_billing_profile_revisions')).toEqual(billing)
 const command={action:'request_access',assignmentId:f.assignment,expectedVersion:f.current().version,permissionId,preferredRouteId:f.ids.route}
 const start=Date.now(),result=await f.command(command),window:Window=[start,Date.now()]
 const after=w.state(f),ints=after.business.ediel_message_intents as Row[]
 const intents=added(before.business.ediel_message_intents as Row[],ints);expect(intents).toHaveLength(1);const intent=intents[0]
 const blocking=[{code:'render_failed',message:'ediel_permission_actual_customer_identity_required',severity:'block',details:{source:'render_gateway'}}]
 expect(result).toEqual({status:'blocked',intentId:intent.id,message:null,blockingReasons:blocking})
 expect(intent.interchange_reference).toMatch(/^[0-9A-F]{14}$/)
 expect(intent.transaction_reference).toMatch(/^Z13[0-9A-F]{32}$/)
 const validation=intent.validation_result as Row
 expect(validation).toEqual({ok:true,status:'validated',blockingReasons:[],checks:{required_metadata:true,no_placeholder_identifiers:true,
  application_reference_policy:true,message_code_supported:true,prodat_outbound_direction:true,prodat_actor_role:true,tenant_scope:true},checkedAt:time(validation.checkedAt,window)})
 newRow(intent,{company_id:f.ids.company,environment:'test',market:'electricity',message_family:'PRODAT',message_code:'Z13',
  business_process:'metering_permission',direction:'outbound',sender_ediel_id:f.sender,receiver_ediel_id:f.receiver,
  sender_subaddress:null,receiver_subaddress:null,application_reference:f.app,route_profile_id:f.ids.routeProfile,communication_route_id:f.ids.route,
  customer_id:f.ids.customer,operation_id:permissionId,interchange_reference:intent.interchange_reference,message_reference:'1',
  transaction_reference:intent.transaction_reference,idempotency_key:`service-permission:${permissionId}:Z13`,
  payload:{sourcePermissionBasis:basis,actorRole:'esco',externalReference:intent.interchange_reference,authorizationReference:basis.agreementReference},
  validation_result:validation,blocking_reasons:blocking,validation_status:'validated',render_status:'failed',outbox_status:'not_queued',
  created_by:f.ids.actor,updated_by:f.ids.actor},schemas['public.ediel_message_intents'],window,ints.filter(r=>r.id!==intent.id).map(r=>r.id))
 const origins=added(before.business['gridex_service_permission.origins'] as Row[],after.business['gridex_service_permission.origins'] as Row[],'intent_id')
 expect(origins).toHaveLength(1)
 newRow(origins[0],{intent_id:intent.id,company_id:f.ids.company,assignment_id:f.assignment,permission_id:permissionId,
  actor_user_id:f.ids.actor,message_code:'Z13',command_key:'original',basis},schemas['gridex_service_permission.origins'],window,[])
 const requests=added(before.business.outbound_requests as Row[],after.business.outbound_requests as Row[])
 expect(requests).toHaveLength(1);const request=requests[0],decision=request.route_decision_payload as Row
 const reasons=[
  {code:'missing_selected_grid_owner',message:'Nätägare är inte vald. Välj nätägare på kund/anläggning/mätpunkt innan Ediel skickas.',severity:'blocking',source:'dynamic_receiver_resolver'},
  {code:'missing_grid_owner_id',message:'grid_owner_id saknas. Systemet kan inte välja mottagande nätägare.',severity:'blocking',source:'preflight'},
  {code:'missing_grid_owner_agreement',message:'company_id och grid_owner_id krävs för att hitta aktivt nätägaravtal.',severity:'blocking',source:'agreement_resolver'},
  {code:'missing_agreement_reference',message:'Z13 kräver agreement_reference/kundfullmaktsreferens.',severity:'blocking',source:'agreement_resolver'}]
 const setting=(before.business.ediel_actor_settings as Row[]).filter(r=>r.company_id===f.ids.company&&r.environment==='test')
 expect(setting).toHaveLength(1);expect(route).toMatchObject({route_name:'Synthetic ESCO permission route',route_type:'ediel_partner'})
 const expectedDecision={decision_status:'blocked',route_scope:'metering_access',communication_route_id:f.ids.route,
  ediel_route_profile_id:f.ids.routeProfile,grid_owner_access_agreement_id:null,business_process:'metering_access',message_family:'PRODAT',
  message_code:'Z13',message_intent:'metering_access_request',application_reference:f.app,message_version:null,
  sender_ediel_id:f.sender,sender_sub_address:null,receiver_ediel_id:f.receiver,receiver_sub_address:null,
  receiver_source:'selected_grid_owner_missing',dynamic_receiver_strategy:'selected_grid_owner_missing',
  ack_policy:{requiresContrl:true,requiresAperak:true,negativeAperakAlwaysOnErrors:true,utiltsErrForFunctionalUtiltsErrors:false,ackDeadlineMinutes:30,messageCode:'Z13'},
  blocking_reasons:reasons,warnings:[],required_admin_actions:[
   'Välj/komplettera nätägare på kundens anläggning, mätpunkt eller ärende innan Ediel skickas.',
   'Koppla nätägare på anläggning/mätpunkt.','Lägg in aktivt nätägaravtal.','Lägg in avtalsreferens/fullmaktsreferens.'],
  decision_trace:[{step:'classify_process',status:'success',message:'metering_access klassades som metering_access.',
   metadata:{messageFamily:'PRODAT',messageCode:'Z13',environment:'test',environmentExplicit:true}},
   {step:'dynamic_receiver_resolver',status:'blocked',message:'Ingen vald nätägare kunde hämtas från ärendets kontext.'},
   {step:'actor_setting_resolver',status:'success',message:'Bolagets Ediel-ID hämtades från ediel_actor_settings för test.',
    metadata:{actorSettingId:setting[0].id,edielId:f.sender,selectedVia:'resolver'}},
   {step:'route_resolver',status:'success',message:'Route Synthetic ESCO permission route valdes för metering_access.',
    metadata:{routeId:f.ids.route,routeType:'ediel_partner'}}]}
 expect(decision).toEqual(expectedDecision)
 const routeFields={agreement_id:decision.grid_owner_access_agreement_id,grid_owner_access_agreement_id:decision.grid_owner_access_agreement_id,
  ediel_route_profile_id:f.ids.routeProfile,business_process:'metering_access',message_intent:decision.message_intent,message_family:'PRODAT',
  message_code:'Z13',message_version:decision.message_version,application_reference:f.app,sender_ediel_id:f.sender,sender_sub_address:decision.sender_sub_address,
  receiver_ediel_id:f.receiver,receiver_sub_address:decision.receiver_sub_address,ack_policy:decision.ack_policy,blocking_reasons:decision.blocking_reasons,required_admin_actions:decision.required_admin_actions,route_decision_payload:decision}
 const payload={serviceAssignmentId:f.assignment,permissionId,servicePermissionCommandKey:intent.id,messageCode:'Z13',sourceEvidenceId:basis.evidenceId,
  company_id:f.ids.company,request_type:'metering_access',source_type:'manual',source_id:intent.id,period_start:null,period_end:null,
  external_reference:null,operation_id:permissionId,authorization_document_id:null,environment:'test',...buildCustomerIdentityPayload(context),
  ...buildSitePayload(null),...buildMeteringPointPayload(null),...buildContractPayload(context.contract),...buildRoutePayload(route),route_decision:decision}
 expect(request.dispatch_batch_key).toMatch(/^metering_access_\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/)
 const batchTime=String(request.dispatch_batch_key).slice('metering_access_'.length).replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/,'T$1:$2:$3.$4Z')
 time(batchTime,window)
 newRow(request,{company_id:f.ids.company,customer_id:f.ids.customer,grid_owner_id:null,communication_route_id:f.ids.route,
  authorization_document_id:null,request_type:'metering_access',source_type:'manual',source_id:intent.id,status:'failed',channel_type:'unresolved',failure_reason:reasons.map(r=>r.message).join(' | '),
  ...routeFields,payload,operation_id:permissionId,dispatch_batch_key:request.dispatch_batch_key,created_by:f.ids.actor,updated_by:f.ids.actor},
  schemas['public.outbound_requests'],window,(before.business.outbound_requests as Row[]).map(r=>r.id))
 const dispatchAfter=allRows('public.outbound_dispatch_events'),events=added(dispatch,dispatchAfter);expect(events).toHaveLength(1)
 newRow(events[0],{company_id:f.ids.company,outbound_request_id:request.id,event_type:'failed',event_status:'failed',
  message:'Outbound request blockerad av route-beslut. Kräver åtgärd innan utskick.',created_by:f.ids.actor,payload:{routeId:f.ids.route,routeSelectedExplicitly:true,
   channelType:'unresolved',targetSystem:route.target_system??null,targetEmail:route.target_email??null,routeDecision:decision,operationId:permissionId}},
  schemas['public.outbound_dispatch_events'],window,dispatch.map(r=>r.id))
 const auditAfter=Object.fromEntries(auditTables.map(t=>[t,allRows(t)]))
 const logs=added(auditBefore[auditTables[0]],auditAfter[auditTables[0]]),routing=added(auditBefore[auditTables[1]],auditAfter[auditTables[1]])
 const tasks=added(auditBefore[auditTables[2]],auditAfter[auditTables[2]])
 expect(logs).toHaveLength(1);expect(routing).toHaveLength(1);expect(tasks).toHaveLength(4)
 const logFields=Object.fromEntries(Object.entries(decision).filter(([k])=>k!=='message_intent'))
 newRow(logs[0],{...logFields,company_id:f.ids.company,customer_id:f.ids.customer,environment:'test',business_process:'metering_access',
  requested_action:'metering_access',source_payload:{serviceAssignmentId:f.assignment,permissionId,servicePermissionCommandKey:intent.id,
   messageCode:'Z13',sourceEvidenceId:basis.evidenceId},created_by:f.ids.actor},schemas[auditTables[0]],window,auditBefore[auditTables[0]].map(r=>r.id))
 newRow(routing[0],{company_id:f.ids.company,environment:'test',message_family:'PRODAT',message_code:'Z13',direction:'outbound',
  sender_ediel_id:f.sender,sender_subaddress:null,receiver_ediel_id:f.receiver,receiver_subaddress:null,receiver_source:'selected_grid_owner_missing',
  dynamic_receiver_strategy:'selected_grid_owner_missing',route_profile_id:f.ids.routeProfile,route_version:1,transport_profile_id:null,
  route_decision_log_id:logs[0].id,validation_status:'blocked',validation_errors:reasons,validation_warnings:[],decision_trace:decision.decision_trace,
  is_dry_run:false,created_by:f.ids.actor},schemas[auditTables[1]],window,auditBefore[auditTables[1]].map(r=>r.id))
 for(const reason of reasons){
  const own=tasks.filter(t=>t.task_type==='route_'+reason.code);expect(own).toHaveLength(1)
  newRow(own[0],{company_id:f.ids.company,customer_id:f.ids.customer,task_type:'route_'+reason.code,status:'open',priority:'high',
   title:reason.message.slice(0,140),description:reason.message,created_by:f.ids.actor,updated_by:f.ids.actor,
   metadata:{source:'routeDecisionEngine',businessProcess:'metering_access',routeScope:'metering_access',messageFamily:'PRODAT',
    messageCode:'Z13',decision,reason}},schemas[auditTables[2]],window,auditBefore[auditTables[2]].map(r=>r.id))
 }
 const protectedState=(s:State)=>({...s,effects:{...s.effects,intents:before.effects.intents},business:{...s.business,
  ediel_message_intents:(s.business.ediel_message_intents as Row[]).filter(r=>r.id!==intent.id),
  outbound_requests:(s.business.outbound_requests as Row[]).filter(r=>r.id!==request.id),
  'gridex_service_permission.origins':(s.business['gridex_service_permission.origins'] as Row[]).filter(r=>r.intent_id!==intent.id)}})
 expect(after.effects).toEqual({...before.effects,intents:before.effects.intents+1});expect(protectedState(after)).toEqual(before)
 expect(w.ledger(f)).toEqual(ledger);expect(allRows('public.customer_billing_profile_revisions')).toEqual(snapshots.billing)
 expect(w.reviews(f,evidence)).toEqual(reviews);checkSentinel();expect(nativeEscoExternal.send).not.toHaveBeenCalled()
 const retryStart=Date.now();expect(await f.command(command)).toEqual(result);const retryWindow:Window=[retryStart,Date.now()]
 const retried=w.state(f),retriedIntent=(retried.business.ediel_message_intents as Row[]).find(r=>r.id===intent.id)!
 time(retriedIntent.updated_at,retryWindow);expect(Date.parse(String(retriedIntent.updated_at))).toBeGreaterThanOrEqual(Date.parse(String(intent.updated_at)))
 expect(retriedIntent).toEqual({...intent,updated_at:retriedIntent.updated_at})
 expect({...retried,business:{...retried.business,ediel_message_intents:(retried.business.ediel_message_intents as Row[]).map(r=>r.id===intent.id?intent:r)}}).toEqual(after)
 expect(w.ledger(f)).toEqual(ledger);expect(allRows('public.outbound_dispatch_events')).toEqual(dispatchAfter)
 for(const table of auditTables)expect(allRows(table)).toEqual(auditAfter[table])
 expect(allRows('public.customer_billing_profile_revisions')).toEqual(snapshots.billing);expect(w.reviews(f,evidence)).toEqual(reviews)
 for(const table of tableNames)expect(columns(table)).toEqual(schemas[table])
 checkSentinel();expect(nativeEscoExternal.send).not.toHaveBeenCalled()
}
