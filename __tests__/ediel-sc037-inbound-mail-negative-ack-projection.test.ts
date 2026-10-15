// masterplan: SC-037
/** Finite SOURCE-only integration. Actual mail caller, PUBLIC d02f canonical/flow
 * and immutable82d run; lower SDK/reception/classifier/ledger ports are declared
 * doubles. Neither backend/native authority nor full protocol PASS is claimed. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { applySafeInboundStatusUpdate, createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'

const h = vi.hoisted(() => ({
  trace: [] as string[], effects: [] as Array<{table:string; action:string; payload:unknown; filters:Record<string,unknown>}>,
  queries: [] as Array<{table:string; columns:string; filters:Record<string,unknown>}>,
  ack: {} as Record<string,unknown>, source: {} as Record<string,unknown>, request: {} as Record<string,unknown>, mail: {} as Record<string,unknown>,
  outbound: {} as Record<string,unknown>, receipt: null as unknown, args: null as Record<string,unknown>|null,
  outcome: 'negative' as 'positive'|'negative'|'invalid', disposition:'mutated_failure', malformed:'',
  rpcError:null as unknown, receptionError:null as unknown, authError:null as unknown, holdWriteError:null as unknown,
  classification:'first_reception', replay:false, existing:true, created:false, gate:true, reads:0,
  missingReadback:false, sourceUnavailable:false, decisionManual:false, unconfirmed:false,
  fullRowOverride:null as Record<string,unknown>|null, birth:null as Record<string,unknown>|null,
  receptionArgs:[] as unknown[], readerArgs:[] as unknown[], resolverArgs:[] as unknown[], ledgerArgs:[] as unknown[],
  sourceApplyArgs:[] as unknown[], authArgs:[] as unknown[], tasks:[] as unknown[], apiEvents:[] as unknown[],
}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{
  rpc:async(name:string,args:Record<string,unknown>)=>{
    h.trace.push(name)
    if(name==='gridex_read_inbound_ack_source_v1')return {data:h.sourceUnavailable?null:{version:1,sourceMessage:h.source},error:null}
    if(name==='gridex_apply_inbound_ack_source_v1'){
      h.sourceApplyArgs.push(args);h.receipt=exactReceipt()
      return {data:{version:1,sourceMessage:h.source,outcome:h.outcome,finalAckReached:true,wholeSourceRejected:h.gate,sourceAccepted:false},error:null}
    }
    if(name!=='gridex_apply_inbound_ack_switch_transition_v1')throw new Error(`unexpected_rpc:${name}`)
    h.args=args;if(h.rpcError)return {data:null,error:h.rpcError}
    const expected=JSON.parse(String(args.p_expected_request))
    const request=h.disposition==='not_applicable'?null:h.disposition==='mutated_failure'?{...expected,status:args.p_negative_status,updated_by:args.p_actor_user_id}:{...expected}
    const data:Record<string,unknown>={version:1,companyId:args.p_company_id,environment:args.p_environment,actorUserId:args.p_actor_user_id,ackMessageId:args.p_ack_message_id,ackPayloadHash:args.p_ack_payload_hash,sourceMessageId:args.p_source_message_id,sourcePayloadHash:args.p_source_payload_hash,switchRequestId:args.p_switch_request_id,negativeStatus:args.p_negative_status,expectedRequestHash:hash(String(args.p_expected_request)),disposition:h.disposition,changed:h.disposition==='mutated_failure',request}
    if(h.malformed==='version')data.version=2
    if(h.malformed==='pin')data.ackPayloadHash='f'.repeat(64)
    if(h.malformed==='changed')data.changed=!data.changed
    if(h.malformed==='status'&&request)request.status='accepted'
    if(h.malformed==='hash')data.expectedRequestHash='0'.repeat(64)
    return {data,error:null}
  },
  from:(table:string)=>{
    let action='select',columns='*',payload:unknown=null;const filters:Record<string,unknown>={}
    const answer=(single=false)=>{
      h.trace.push(`${table}:${action}`)
      if(action!=='select'){
        h.effects.push({table,action,payload,filters:{...filters}})
        if(table==='inbound_email_messages'&&h.holdWriteError)return {data:null,error:h.holdWriteError}
        if(table==='ediel_messages'&&action==='insert'){h.birth=payload as Record<string,unknown>;h.ack={...h.birth,id:ackId};h.created=true}
        if(table==='outbound_requests'&&action==='update'&&!filters.protectedBusinessStatus)Object.assign(h.outbound,payload)
        return {data:table==='ediel_messages'?{id:ackId}:table==='inbound_email_messages'?{id:mailId}:null,error:null}
      }
      h.queries.push({table,columns,filters:{...filters}})
      if(table==='inbound_email_messages')return {data:h.mail,error:null}
      if(table==='supplier_switch_requests'){h.trace.push('full-current-request');return {data:h.request,error:null}}
      if(table==='ediel_messages'){
        if(filters.direction==='outbound')return {data:[h.source],error:null}
        if(single)return {data:h.fullRowOverride??h.ack,error:null}
        return {data:h.existing||h.created?[h.ack]:[],error:null}
      }
      throw new Error(`unexpected_select:${table}`)
    }
    const q={select:(v='*')=>{columns=v;return q},eq:(k:string,v:unknown)=>{filters[k]=v;return q},is:(k:string,v:unknown)=>{filters[k]=v;return q},in:(k:string,v:unknown)=>{filters[k]=v;return q},not:()=>{filters.protectedBusinessStatus=true;return q},order:()=>q,limit:()=>q,
      update:(v:unknown)=>{action='update';payload=v;return q},insert:(v:unknown)=>{action='insert';payload=v;return q},
      maybeSingle:async()=>answer(true),single:async()=>answer(true),then:(yes:(v:unknown)=>unknown)=>Promise.resolve(answer()).then(yes)}
    return q
  },
}}))
vi.mock('@/lib/ediel/ack/committedInboundAck',()=>({readCommittedInboundAck:async(a:unknown)=>{h.trace.push('reader');h.readerArgs.push(a);h.reads++;return h.missingReadback&&h.reads>1?null:h.receipt}}))
vi.mock('@/lib/ediel/ack/sourceCorrelation',()=>({readInboundAckSourceCorrelation:()=>({classification:{outcome:h.outcome},lookupReferences:[]}),qualifyInboundAckSourceCandidates:({candidates}:{candidates:unknown[]})=>({status:'unique',sourceMessage:candidates[0]})}))
vi.mock('@/lib/ediel/core/runtimeDecision',()=>({resolveCanonicalRuntimeDecisionWithRegistry:async(...a:unknown[])=>{h.trace.push('resolver');h.resolverArgs.push(a);return {syntaxDecision:'accepted',applicationDecision:h.decisionManual?'manual_review':'accepted',functionalDecision:'not_applicable'}}}))
vi.mock('@/lib/ediel/core/receivedSourceValidationLedger',()=>({recordReceivedSourceValidation:async(a:unknown)=>{h.trace.push('ledger');h.ledgerArgs.push(a);return h.unconfirmed?{status:'unconfirmed',sourceDisposition:'not_established'}:{status:'recorded',sourceDisposition:'not_established',assessmentId:id(10),factsHash:'a'.repeat(64)}}}))
vi.mock('@/lib/ediel/inbound/receptions',()=>{
  class InboundReceptionHeldError extends Error{constructor(readonly reception:{classification:string;reason:string;responseRequestId:string}){super(reception.reason)}}
  return {InboundReceptionHeldError,admitUnattributedTechnicalSource:()=>{throw new Error('unexpected_unattributed_source')},recordInboundReception:async(a:unknown)=>{
    h.trace.push('reception');h.receptionArgs.push(a);if(h.receptionError)throw h.receptionError
    return {companyId:company,sourceMessageId:ackId,inboundEmailMessageId:mailId,parseResultId:parseId,receptionId:id(11),receivedAt:'2026-10-14T09:10:11.123Z',canonicalPayloadHash:hash(h.ack.raw_payload),receivedPayloadHash:hash(h.ack.raw_payload),businessEffectAuthorized:false,status:h.classification==='first_reception'?'observed':'held',classification:h.classification,isReplay:h.replay,responseRequestId:h.classification==='first_reception'?null:'native-response-held',reason:h.classification==='first_reception'?null:'actual-native-duplicate-reason'}
  },requireFirstReception:(r:{classification:string;reason:string;responseRequestId:string})=>{if(r.classification!=='first_reception')throw new InboundReceptionHeldError(r)}}
})
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:async(a:unknown)=>{h.trace.push('authorization');h.authArgs.push(a);if(h.authError)throw h.authError}}))
vi.mock('@/lib/ediel/core/dedupe',()=>({buildInboundCanonicalIdentity:(a:unknown)=>a,findInboundDuplicateByCanonicalIdentity:async()=>null}))
vi.mock('@/lib/ediel/ack/inboundAckOutcome',()=>({classifyCanonicalInboundAck:(p:{messageFamily:string})=>({family:p.messageFamily,profile:p.messageFamily,outcome:h.outcome,reason:h.outcome==='invalid'?'declared-invalid-ack':null})}))
vi.mock('@/lib/inbound-mail/edielEmailParser',()=>({normalizeEdifactMessageCode:(family:string,code?:string)=>code??family}))
vi.mock('@/lib/inbound-mail/inboundTaskFactory',()=>({createInboundMailTask:async(a:unknown)=>{h.tasks.push(a)}}))
vi.mock('@/lib/ediel/tenant/resolveInboundTenant',()=>({tenantResolutionForStorage:(a:unknown)=>a}))
vi.mock('@/lib/ediel/inbound/productionInboundDecisionEngine',()=>({classifyProductionInboundDecision:()=>({scenario:'declared-unrelated-control'})}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:async(a:unknown)=>{h.apiEvents.push(a)},linkEdielMessage:()=>{throw new Error('unexpected_fullprocessor_link')},updateEdielMessageStatus:()=>{throw new Error('unexpected_fullprocessor_status')}}))
vi.mock('@/lib/ediel/flows/shared',()=>({ensureActorUserId:(a:string)=>{if(!a)throw new Error('actor_required');return a},getGridOwnerDataRequestById:()=>{throw new Error('unexpected_datarequest_flow')}}))
vi.mock('@/lib/cis/db',()=>({getOutboundRequestById:async()=>h.outbound,updateGridOwnerDataRequestStatus:()=>{throw new Error('unexpected_datarequest_write')},updateOutboundRequestStatus:()=>{throw new Error('unexpected_fullprocessor_outbound')}}))
vi.mock('@/lib/operations/db',()=>({createSupplierSwitchEvent:()=>{throw new Error('unexpected_switch_event')},updateSupplierSwitchRequestStatus:()=>{throw new Error('unexpected_direct_switch_write')}}))
vi.mock('@/lib/errors',()=>({formatErrorMessage:(e:unknown)=>String(e)}))
vi.mock('@/lib/customer-cases/db',()=>({syncCustomerCaseCancellationAck:()=>{throw new Error('unexpected_cancellation_case')}}))
vi.mock('@/lib/ediel/actorTestingEngine',()=>({syncActorTestingForMessage:()=>{throw new Error('unexpected_actor_testing')}}))
vi.mock('@/lib/inbound-mail/prodatAssignedHeaderRejectionIntake',()=>({observeAssignedProdatHeaderNegativeField:()=>false,createAssignedProdatHeaderNegativeSource:()=>{throw new Error('unexpected_assigned_header_source')}}))
vi.mock('@/lib/inbound-mail/assignedSupplyBirthProfile',()=>({resolveAssignedSupplyBirthProfile:async()=>null}))
vi.mock('@/lib/inbound-mail/normalSwitchBirthProfile',()=>({resolveNormalSwitchBirthProfile:async()=>null}))
vi.mock('@/lib/inbound-mail/customerSourceBirthProfile',()=>({resolveCustomerSourceBirthProfile:async()=>null}))
vi.mock('@/lib/inbound-mail/meterChangeSourceBirthProfile',()=>({resolveMeterChangeSourceBirthProfile:async()=>null}))
vi.mock('@/lib/inbound-mail/supplierDataBirthProfile',()=>({resolveSupplierDataBirthProfile:async()=>null}))
vi.mock('@/lib/inbound-mail/bilateralSwitchBirthProfile',()=>({resolveBilateralSwitchBirthProfile:async()=>null}))
vi.mock('@/lib/inbound-mail/bilateralSwitchBirthResources',()=>({captureBilateralSwitchBirthResources:()=>null,resolveBilateralSwitchBirthResources:async()=>null}))
vi.mock('@/lib/inbound-mail/rejectedBilateralSwitchBirthProfile',()=>({resolveRejectedBilateralSwitchBirthProfile:async()=>null}))
vi.mock('@/lib/inbound-mail/rejectedZ04HRequiredFieldBirthProfile',()=>({resolveRejectedZ04HRequiredFieldBirthProfile:async()=>null}))
vi.mock('@/lib/inbound-mail/supplyEndBirthProfile',()=>({resolveSupplyEndBirthProfile:async()=>null}))
vi.mock('@/lib/inbound-mail/cancellationBirthProfile',()=>({resolveCancellationBirthProfile:async()=>null}))
vi.mock('@/lib/inbound-mail/permissionReportingBirthProfile',()=>({resolvePermissionReportingBirthProfile:async()=>null}))

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const actor=id(1),company=id(2),ackId=id(3),sourceId=id(4),switchId=id(5),mailId=id(6),parseId=id(7),outboundId=id(8)
const hash=(s:unknown)=>createHash('sha256').update(String(s),'utf8').digest('hex')
const exactReceipt=()=>({kind:'exact_receipt',sourceMessageId:sourceId,result:{version:1,sourceMessage:h.source,outcome:h.outcome,finalAckReached:true,wholeSourceRejected:h.gate,sourceAccepted:false,failureReason:'negative',idempotent:true}})
const parsed=(family='CONTRL')=>({messageFamily:family,messageCode:family,rawPayload:'ACK ORIGINAL',segments:['UCI+REF+7'],senderEdielId:'sender',receiverEdielId:'receiver',applicationReference:null,interchangeReference:'REF',references:{},dates:{},quantities:{},errorCodes:[],freeText:[],parties:{}})
const invoke=(extra:Record<string,unknown>={})=>applySafeInboundStatusUpdate({companyId:company,environment:'test',actorUserId:actor,inboundEmailMessageId:mailId,parseResultId:parseId,parsed:parsed(),outboundMatch:{status:'matched',entityType:'outbound_request',entityId:outboundId,candidates:[{source_type:'supplier_switch_request',source_id:switchId}]},meteringPointMatch:{status:'unmatched'},...extra} as never)
const fresh=(extra:Record<string,unknown>={})=>createInboundEdielMessage({companyId:company,environment:'test',actorUserId:actor,inboundEmailMessageId:mailId,parseResultId:parseId,parsed:parsed(),outboundMatch:{status:'matched',entityType:'outbound_request',entityId:outboundId,candidates:[{source_type:'supplier_switch_request',source_id:switchId}]},meteringPointMatch:{status:'unmatched'},...extra} as never)
const mutations=(table:string)=>h.effects.filter(e=>e.table===table)
const noLegacyEffects=()=>{expect(mutations('supplier_switch_requests')).toEqual([]);expect(mutations('outbound_requests')).toEqual([]);expect(h.tasks).toEqual([]);expect(h.apiEvents).toEqual([])}
beforeEach(()=>{
  vi.clearAllMocks();h.trace=[];h.effects=[];h.queries=[];h.tasks=[];h.apiEvents=[];h.args=null;h.outcome='negative';h.disposition='mutated_failure';h.malformed='';h.rpcError=null;h.receptionError=null;h.authError=null;h.holdWriteError=null;h.classification='first_reception';h.replay=false;h.existing=true;h.created=false;h.gate=true;h.reads=0;h.missingReadback=false;h.sourceUnavailable=false;h.decisionManual=false;h.unconfirmed=false;h.fullRowOverride=null;h.birth=null;h.receptionArgs=[];h.readerArgs=[];h.resolverArgs=[];h.ledgerArgs=[];h.sourceApplyArgs=[];h.authArgs=[]
  h.ack={id:ackId,company_id:company,environment:'test',direction:'inbound',message_standard:'edifact',message_family:'CONTRL',message_code:'CONTRL',receiver_ediel_id:'receiver',application_reference:null,raw_payload:'ACK ORIGINAL',inbound_email_message_id:mailId,mailbox_message_id:mailId,parse_result_id:parseId,message_received_at:'2026-10-14T09:10:11.123Z',parsed_payload:{},validation_report:{}}
  h.source={id:sourceId,company_id:company,environment:'test',direction:'outbound',raw_payload:'OUTBOUND ORIGINAL',switch_request_id:switchId,outbound_request_id:null,grid_owner_data_request_id:null}
  h.request={id:switchId,company_id:company,status:'submitted',outbound_z03_message_id:sourceId,inbound_z04_message_id:null,unknown_nested:{preserve:[1,{future:true}]}}
  h.mail={id:mailId,company_id:company,environment:'test',received_at:'2026-10-14T09:10:11.123Z'};h.outbound={id:outboundId,company_id:company,source_type:'supplier_switch_request',source_id:switchId,status:'submitted'};h.receipt=exactReceipt()
})
describe('SC037 actual third inbound-mail caller and protected PUBLIC B port',()=>{
  it.each(['CONTRL','APERAK','UTILTS_ERR'])('T01 %s reaches real protected rejected projection with full CAS and distinct originals',async family=>{
    h.ack.message_family=family;h.ack.message_code=family;await invoke({parsed:parsed(family)})
    expect(h.args).toMatchObject({p_actor_user_id:actor,p_environment:'test',p_negative_status:'rejected',p_ack_payload_hash:hash('ACK ORIGINAL'),p_source_payload_hash:hash('OUTBOUND ORIGINAL')});expect(JSON.parse(String(h.args?.p_expected_request))).toEqual(h.request);noLegacyEffects();expect(mutations('ediel_message_events')).toEqual([])
  })
  it('T02 first-reception precedes committed-reader and interrupted projection repair',async()=>{await invoke();expect(h.args).not.toBeNull();expect(h.trace.indexOf('reader')).toBeGreaterThan(h.trace.indexOf('reception'));expect(h.receptionArgs).toEqual([{companyId:company,messageId:ackId,actorUserId:actor,inboundEmailMessageId:mailId,parseResultId:parseId}]);expect(h.sourceApplyArgs).toEqual([]);expect(h.resolverArgs).toEqual([]);noLegacyEffects()})
  it('T03 same genuine first-mail replay does not duplicate diagnostics or business effects',async()=>{h.replay=true;h.disposition='already_terminal';h.request.status='rejected';await invoke();await invoke();expect(h.reads).toBe(2);expect(mutations('ediel_message_events')).toEqual([]);noLegacyEffects()})
  it.each(['accepted','completed'])('T04 preserves protected %s confirmation and never compensates',async status=>{h.request.status=status;h.request.inbound_z04_message_id=id(9);h.disposition='preserved_confirmation';await invoke();expect(h.args).not.toBeNull();expect(h.request.status).toBe(status);noLegacyEffects()})
  it.each(['already_terminal','stale_preimage','not_applicable'])('T05 consumes locked %s without direct fallback',async disposition=>{h.disposition=disposition;if(disposition==='already_terminal')h.request.status='failed';await invoke();expect(h.args).not.toBeNull();noLegacyEffects()})
  it.each(['version','pin','changed','status','hash'])('T06 malformed %s protected receipt remains an error',async field=>{h.malformed=field;await expect(invoke()).rejects.toThrow('ack_switch_transition_invalid');noLegacyEffects()})
  it.each(['refused','transport_unknown'])('T07 real %s error never triggers compensation',async message=>{h.rpcError=new Error(message);await expect(invoke()).rejects.toThrow(message);noLegacyEffects()})
  it('T08 readerNone uses resolver, same-call ledger, protected source apply and exact readback',async()=>{h.receipt=null;await invoke();expect(h.args).not.toBeNull();expect(h.trace.indexOf('resolver')).toBeGreaterThan(h.trace.indexOf('reader'));expect(h.trace.indexOf('ledger')).toBeGreaterThan(h.trace.indexOf('resolver'));expect(h.trace.indexOf('gridex_apply_inbound_ack_source_v1')).toBeGreaterThan(h.trace.indexOf('ledger'));expect(h.reads).toBe(2);expect(h.ledgerArgs).toEqual([expect.objectContaining({original:h.ack,validated:h.ack,resolvedCompanyId:company})]);noLegacyEffects()})
  it('T09 legacy receipt stays diagnostic and does not become readerNone',async()=>{h.receipt={kind:'legacy_diagnostic',outcome:'negative'};await invoke();expect(h.args).toBeNull();expect(h.reads).toBe(1);expect(h.resolverArgs).toEqual([]);expect(h.sourceApplyArgs).toEqual([]);noLegacyEffects()})
  it.each(['decision','ledger','readback','source'])('T10 refuses missing %s authority without fallback',async missing=>{h.receipt=null;if(missing==='decision')h.decisionManual=true;if(missing==='ledger')h.unconfirmed=true;if(missing==='readback')h.missingReadback=true;if(missing==='source')h.sourceUnavailable=true;await expect(invoke()).rejects.toThrow();expect(h.args).toBeNull();noLegacyEffects()})
  it.each(['protocol_duplicate','identity_conflict'])('T11 typed %s hold is local manual review preserving native response',async classification=>{h.classification=classification;await expect(invoke()).resolves.toBeUndefined();expect(h.reads).toBe(0);expect(h.args).toBeNull();const hold=mutations('inbound_email_messages').at(-1);expect(hold?.payload).toMatchObject({processing_status:'manual_review',match_payload:{reception:{classification,reason:'actual-native-duplicate-reason',responseRequestId:'native-response-held'}}});expect(hold?.filters).toMatchObject({id:mailId,company_id:company});noLegacyEffects()})
  it('T12 ordinary reception error is not swallowed as a native hold',async()=>{h.receptionError=new Error('actor_forbidden');await expect(invoke()).rejects.toThrow('actor_forbidden');expect(h.reads).toBe(0);expect(mutations('inbound_email_messages')).toEqual([]);noLegacyEffects()})
  it('T12 failed held-status persistence is still a real error',async()=>{h.classification='identity_conflict';h.holdWriteError=new Error('hold_write_refused');await expect(invoke()).rejects.toThrow('hold_write_refused');expect(h.reads).toBe(0);noLegacyEffects()})
  it('T13 fresh source requires actual WRITE authorization before persistence or gate',async()=>{h.existing=false;h.authError=new Error('ediel_tenant_permission_forbidden');await expect(invoke()).rejects.toThrow('ediel_tenant_permission_forbidden');expect(h.authArgs).toEqual([{companyId:company,actorUserId:actor,permission:'communication.write'}]);expect(h.birth).toBeNull();expect(h.receptionArgs).toEqual([]);expect(h.reads).toBe(0)})
  it.each(['receiver_ediel_id','application_reference','message_family','raw_payload'])('T14 existing original mismatch %s cannot reach protected projection',async key=>{h.ack[key]='FOREIGN';await expect(invoke()).rejects.toThrow('canonical_inbound_duplicate_scope_or_original_conflict');expect(h.args).toBeNull();expect(h.reads).toBe(0);noLegacyEffects()})
  it.each(['id','company_id','environment','direction','raw_payload','inbound_email_message_id'])('T15 full admitted-row %s substitution is refused before reader',async key=>{h.fullRowOverride={...h.ack,[key]:key==='environment'?'production':key==='direction'?'outbound':id(99)};await expect(invoke()).rejects.toThrow();expect(h.reads).toBe(0);expect(h.args).toBeNull();noLegacyEffects()})
  it('T16 actual full-row read is scoped and forwards actual source object',async()=>{await invoke();expect(h.queries).toContainEqual({table:'ediel_messages',columns:'*',filters:{id:ackId,company_id:company,environment:'test',direction:'inbound'}});expect(h.readerArgs).toEqual([expect.objectContaining({actorUserId:actor,message:h.ack})])})
  it('T17 fresh negative preserves qualified birth original clock and one birth event',async()=>{h.existing=false;await invoke();expect(h.birth).toMatchObject({message_received_at:'2026-10-14T09:10:11.123Z',inbound_email_message_id:mailId,mailbox_message_id:mailId,status:'failed',contrl_status:'rejected',syntax_check_status:'rejected',ack_outcome:'negative'});expect(mutations('ediel_message_events')).toHaveLength(1);expect(mutations('ediel_message_events')[0]?.payload).toMatchObject({event_type:'inbound_mail_processed',event_status:'warning'});expect(h.args).not.toBeNull();noLegacyEffects()})
  it.each(['positive','invalid'] as const)('T18 qualified fresh CONTRL %s birth remains canonical',async outcome=>{h.existing=false;h.outcome=outcome;await fresh();expect(h.birth).toMatchObject({status:outcome==='positive'?'received':'failed',contrl_status:outcome==='positive'?'accepted':'rejected',ack_outcome:outcome==='invalid'?null:'positive',message_received_at:'2026-10-14T09:10:11.123Z'});expect(mutations('ediel_message_events')).toHaveLength(1);expect(h.args).toBeNull()})
  it('T18 canonical positive supplier with misleading legacy UCI7 never rejects or creates negative diagnostics',async()=>{h.outcome='positive';h.outbound.status='confirmed';await invoke();expect(h.args).toBeNull();expect(mutations('supplier_switch_requests')).toEqual([]);expect(h.tasks).toEqual([]);expect(h.outbound.status).toBe('confirmed');expect(h.reads).toBe(0);expect(mutations('ediel_messages').at(-1)?.payload).toMatchObject({contrl_status:'accepted',syntax_check_status:'accepted',ack_outcome:'positive',failed_at:null,failure_reason:null})})
  it('T18 invalid canonical supplier CONTRL stops at manual review with no business or ACK effects',async()=>{h.outcome='invalid';h.existing=false;await invoke();expect(h.birth?.ack_outcome).toBeNull();expect(h.args).toBeNull();expect(mutations('outbound_requests')).toEqual([]);expect(mutations('supplier_switch_requests')).toEqual([]);expect(h.tasks).toEqual([])})
  it('T18 negative non-supplier datarequest retains old diagnostic flow',async()=>{await invoke({outboundMatch:{status:'matched',entityType:'outbound_request',entityId:outboundId,candidates:[{source_type:'grid_owner_data_request',source_id:id(12)}]}});expect(h.args).toBeNull();expect(h.reads).toBe(0);expect(mutations('grid_owner_data_requests')).toHaveLength(1);expect(h.tasks).toHaveLength(1)})
  it('T18 unrelated PRODAT Z04 supplier confirmation stays unchanged',async()=>{h.ack.message_family='PRODAT';h.ack.message_code='Z04';await invoke({parsed:{...parsed('PRODAT'),messageCode:'Z04'}});expect(h.args).toBeNull();expect(mutations('supplier_switch_requests').at(-1)?.payload).toMatchObject({status:'confirmed'});expect(h.reads).toBe(0)})
  it('T18 unrelated UTILTS datarequest keeps receipt and missing-point task',async()=>{h.ack.message_family='UTILTS';h.ack.message_code='UTILTS';await invoke({parsed:parsed('UTILTS'),outboundMatch:{status:'matched',entityType:'outbound_request',entityId:outboundId,candidates:[{source_type:'grid_owner_data_request',source_id:id(12)}]}});expect(h.args).toBeNull();expect(h.reads).toBe(0);expect(mutations('grid_owner_data_requests').at(-1)?.payload).toMatchObject({status:'received'});expect(h.tasks).toHaveLength(1)})
  it('T18 invalid APERAK retains actual refusal before any source or effects',async()=>{h.outcome='invalid';await expect(invoke({parsed:parsed('APERAK')})).rejects.toThrow('ediel_inbound_aperak_invalid:declared-invalid-ack');expect(h.effects).toEqual([]);expect(h.args).toBeNull()})
})
