// masterplan: U-13, AT-U-13, SC-045, SC-047, SC-048
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { utiltsErrGatewayFixture } from './helpers/utiltsErrGatewayFixture'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { createAckIfMissing,createUtiltsRuntimeAcks,matchUtiltsTransactionsForTenant } from '@/lib/ediel/flows/utiltsDataRequest.part-1'
import {readSourceBoundOutboundAckRulePackEvidence} from '@/lib/ediel/core/ackSourceRulePackEvidence'
import { createCanonicalAckMessage } from '@/lib/ediel/core/kernel'
import { buildAperakDraft, buildUtiltsErrDraft } from '@/lib/ediel/ack'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import type { EdielMessageRow } from '@/lib/ediel/types'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'

// Modeled transport configuration only; no outbox/provider/send is exercised.
vi.mock('@/lib/ediel/mailReadiness',()=>({assertEdielSmtpReadiness:()=>({from:'gridex@example.invalid',host:'smtp.example.invalid',port:587})}))

type Row = Record<string, unknown>
const database = vi.hoisted(() => ({ tables: new Map<string, Row[]>(), failErrReference: null as string | null,
  raceErrReference: null as string | null, raceCommitted: false, sourceBases:new Map<string,Row>(),bornOriginals:new Map<string,Row>(),
  sourceBasisMode:'valid' as 'valid'|'missing'|'changed_raw', sourceBasisReads:[] as Row[] }))
vi.mock('@/lib/supabase/service', () => {
  const value = (row: Row, key: string) => {
    const [base, member] = key.split('->>')
    return member ? (row[base] as Row | undefined)?.[member] : row[base]
  }
  class Query {
    private filters: ((row: Row) => boolean)[] = []
    private mode: 'read' | 'insert' | 'update' = 'read'
    private payload: Row | Row[] = {}
    private cap = Infinity
    private one = false
    constructor(private table: string) {}
    select() { return this }
    eq(key: string, expected: unknown) { this.filters.push(row => value(row, key) === expected); return this }
    is(key: string, expected: unknown) { this.filters.push(row => (value(row, key) ?? null) === expected); return this }
    in(key: string, expected: unknown[]) { this.filters.push(row => expected.includes(value(row, key))); return this }
    not(key: string, operation: string, expected: string | null) {
      if(operation==='is' && expected===null){this.filters.push(row=>value(row,key)!==null&&value(row,key)!==undefined);return this}
      if (operation !== 'in') throw Error(`unexpected_filter:${operation}`)
      const excluded = String(expected).replace(/^\(|\)$/g, '').split(',')
      this.filters.push(row => !excluded.includes(String(value(row, key))))
      return this
    }
    or(expression: string) {
      const options = expression.split(',').map(part => {
        const match = /^([^.]+)\.(eq|is)\.(.*)$/.exec(part)
        if (!match || match[2] === 'is' && match[3] !== 'null') throw Error(`unexpected_or:${expression}`)
        const [, key, operation, expected] = match
        return (row: Row) => operation === 'is' ? value(row, key) == null : String(value(row, key) ?? '') === expected
      })
      this.filters.push(row => options.some(filter => filter(row)))
      return this
    }
    order() { return this }
    limit(cap: number) { this.cap = cap; return this }
    abortSignal() { return this }
    insert(payload: Row | Row[]) { this.mode = 'insert'; this.payload = payload; return this }
    update(payload: Row) { this.mode = 'update'; this.payload = payload; return this }
    upsert(payload: Row | Row[]) { return this.insert(payload) }
    single() { this.one = true; return this }
    maybeSingle() { this.one = true; return this }
    then(resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) {
      return Promise.resolve().then(() => {
        const rows = database.tables.get(this.table)
        if (!rows) throw Error(`unexpected_table:${this.table}`)
        let data: Row[]
        if (this.mode === 'insert') {
          const payloads = Array.isArray(this.payload) ? this.payload : [this.payload]
          if (this.table === 'ediel_messages' && payloads.some(row =>
            row.message_family === 'UTILTS_ERR' && database.failErrReference !== null &&
            (row.parsed_payload as Row)?.relatedTransactionReference === database.failErrReference)) {
            throw Error('synthetic_interruption_after_first_err')
          }
          data = payloads.map(row => ({ id: randomUUID(), created_at: new Date().toISOString(), ...row }))
          if (this.table === 'ediel_messages' && payloads.some(row => row.message_family === 'UTILTS_ERR' &&
            database.raceErrReference !== null && (row.parsed_payload as Row)?.relatedTransactionReference === database.raceErrReference)) {
            if (database.raceCommitted) {
              rows.push(...data)
              for(const row of data)database.bornOriginals.set(String(row.id),structuredClone(row))
            }
            return { data: null, error: { code: '23505', message: 'synthetic_unique_ack_insert' }, count: 0 }
          }
          rows.push(...data)
          if(this.table==='ediel_messages')for(const row of data)database.bornOriginals.set(String(row.id),structuredClone(row))
        } else {
          data = rows.filter(row => this.filters.every(filter => filter(row))).slice(0, this.cap)
          if (this.mode === 'update') data.forEach(row => Object.assign(row, this.payload))
        }
        if (this.one && this.mode === 'read' && data.length > 1) {
          return { data: null, error: { code: 'PGRST116', message: 'Multiple rows cannot be returned as one JSON object' }, count: data.length }
        }
        return { data: this.one ? data[0] ?? null : data, error: null, count: data.length }
      }).then(resolve, reject)
    }
  }
  return { supabaseService: { from: (table: string) => new Query(table), rpc: async (name: string, args: Row) => {
      if(name==='ediel_require_source_bytes_available_v1'){
        const source=database.tables.get('ediel_messages')!.find(row=>row.id===args.p_source_message_id&&row.company_id===args.p_company_id&&row.direction==='inbound')
        return {data:null,error:source&&typeof source.raw_payload==='string'&&source.raw_payload?null:{message:'finite_actual_source_bytes_unavailable'}}
      }
      if(name==='ediel_create_outbound_ack_atomic_v1'){
        // Stateful mechanical native-port model. It is not a private source or
        // native witness qualification; independent native tests own that proof.
        const source=database.tables.get('ediel_messages')!.find(row=>row.id===args.p_source_message_id&&row.company_id===args.p_company_id&&row.environment===args.p_environment&&row.direction==='inbound')
        const member=database.tables.get('company_memberships')!.find(row=>row.company_id===args.p_company_id&&row.user_id===args.p_actor_user_id&&row.status==='active'&&row.is_active&&row.accepted_at)
        if(!source||!member)return {data:null,error:{message:'finite_current_source_actor_unavailable'}}
        expect(args.p_source_payload_hash).toBe(createHash('sha256').update(String(source.raw_payload)).digest('hex'))
        const d=args.p_draft as Row,parsed:Row={...(d.parsedPayload as Row),ackFamily:args.p_ack_family,ackSourceId:source.id}
        if(args.p_sequence_field)parsed[String(args.p_sequence_field)]=args.p_sequence_value
        if(args.p_sequence_field==='relatedTransactionReference')parsed.ackScope='transaction'
        if(args.p_ack_family==='UTILTS_ERR'&&database.failErrReference===args.p_sequence_value)throw Error('synthetic_interruption_after_first_err')
        const message={...source,id:randomUUID(),direction:'outbound',message_family:args.p_ack_family,message_code:args.p_ack_family==='UTILTS_ERR'?'ERR':args.p_ack_family,
          related_message_id:source.id,raw_payload:d.rawPayload,parsed_payload:parsed,status:'draft',ack_outcome:args.p_outcome,process_type:d.processType,
          company_id:args.p_company_id,environment:args.p_environment,communication_route_id:d.communicationRouteId,route_profile_id:d.routeProfileId,source_operation_id:`ediel_ack:${source.id}:${args.p_ack_family}:${args.p_sequence_value??'message'}`}
        if(args.p_ack_family==='UTILTS_ERR'&&database.raceErrReference===args.p_sequence_value){
          if(database.raceCommitted){database.tables.get('ediel_messages')!.push(message);database.bornOriginals.set(message.id,structuredClone(message))}
          return {data:null,error:{code:'23505',message:'synthetic_unique_ack_insert'}}
        }
        database.tables.get('ediel_messages')!.push(message)
        database.bornOriginals.set(message.id,structuredClone(message))
        return {data:{version:1,sourceMessage:source,ackMessage:message},error:null}
      }
      if(name==='ediel_read_outbound_ack_replay_v1') {
        const source=database.tables.get('ediel_messages')!.find(row=>row.id===args.p_source_message_id&&row.company_id===args.p_company_id&&row.environment===args.p_environment&&row.direction==='inbound')
        expect(source).toBeDefined()
        expect(database.tables.get('company_memberships')!.some(row=>row.company_id===args.p_company_id&&row.user_id===args.p_actor_user_id)).toBe(true)
        const ack=database.tables.get('ediel_messages')!.find(row=>row.company_id===args.p_company_id&&row.environment===args.p_environment&&row.direction==='outbound'&&row.related_message_id===source!.id&&row.message_family===args.p_ack_family&&(!args.p_sequence_field||(row.parsed_payload as Row)?.[String(args.p_sequence_field)]===args.p_sequence_value))
        // Model the protected read of the own immutable ACK only. Native
        // owner receipts, coverage and concurrent journals remain native proof.
        return {data:ack?{version:1,sourceMessage:source,ackMessage:ack}:null,error:null}
      }
      if(name==='gridex_actor_has_company_permission') {
        const membership=database.tables.get('company_memberships')!.find(row=>row.company_id===args.p_company_id&&row.user_id===args.p_actor_user_id&&row.status==='active'&&row.is_active===true&&row.accepted_at)
        return {data:Boolean(membership && ['communication.write','ediel_testing.write'].includes(String(args.p_permission))),error:null}
      }
      if(name==='ediel_prepare_outbound_owner_witness_v1') {
        const input=args.p_input as Row
        const source=database.tables.get('ediel_messages')!.find(row=>row.id===input.relatedMessageId&&row.company_id===input.companyId&&row.environment===input.environment&&row.direction==='inbound')
        const membership=database.tables.get('company_memberships')!.find(row=>row.company_id===input.companyId&&row.user_id===input.actorUserId&&row.status==='active')
        const evidence=input.rulePackEvidence as Row
        expect(source).toBeDefined();expect(membership).toBeDefined()
        expect(evidence).toMatchObject({rulePackId:source!.canonical_rule_pack_id,messageProfileId:source!.rule_profile_version_id,sourceHash:source!.rule_pack_checksum})
        expect(typeof input.rawPayload).toBe('string')
        return {data:{version:1,witnessId:randomUUID(),evidence},error:null}
      }
      if(name==='ediel_require_technical_syntax_ack_basis_v2'||name==='ediel_read_technical_syntax_ack_route_v1') {
        const source=database.tables.get('ediel_messages')!.find(row=>row.id===args.p_message_id || row.id===args.p_source_message_id)
        expect(source?.company_id).toBe(args.p_company_id)
        const parsed=tokenizeEdifact(String(source!.raw_payload)),unb=parsed.segments.find(row=>row.tag==='UNB')!
        const originalUNB={sender:segmentComposite(unb,2,parsed.una),receiver:segmentComposite(unb,3,parsed.una),interchangeReference:unb.elements[5],uciReference:unb.elements[5].slice(0,14),applicationReference:unb.elements[7]??'',testIndicator:unb.elements[11]??''}
        const sourceHash=createHash('sha256').update(String(source!.raw_payload)).digest('hex')
        // Synthetic syntax facet/route DTO model only; this is not native evidence.
        if(name==='ediel_require_technical_syntax_ack_basis_v2')return {data:{kind:'technical_syntax_ack',version:1,companyId:source!.company_id,environment:source!.environment,sourceMessageId:source!.id,sourceHash,observedAt:source!.message_received_at,syntaxAssessmentId:`synthetic-syntax-${source!.id}`,syntaxDecision:runUtiltsRuntimeForMessage(source as unknown as EdielMessageRow).validation.issues.some(issue=>issue.kind==='syntax'&&issue.severity==='error')?'rejected':'accepted',transportActorId:database.tables.get('ediel_actor_settings')![0].id,transportEdielId:originalUNB.receiver[0],originalUNB},error:null}
        const route=database.tables.get('communication_routes')![0],routeRuntime=database.tables.get('ediel_route_runtime_v')![0]
        expect(args).toMatchObject({p_smtp_from:'gridex@example.invalid',p_smtp_host:'smtp.example.invalid',p_smtp_port:587})
        expect(database.tables.get('company_memberships')!.some(row=>row.user_id===args.p_actor_user_id&&row.company_id===args.p_company_id)).toBe(true)
        return {data:{kind:'technical_syntax_ack_route',companyId:source!.company_id,environment:source!.environment,sourceMessageId:source!.id,sourceHash,route,routeRuntime,
          senderEdielId:originalUNB.receiver[0],senderQualifier:originalUNB.receiver[1]||null,senderSubAddress:originalUNB.receiver[2]||null,
          receiverEdielId:originalUNB.sender[0],receiverQualifier:originalUNB.sender[1]||null,receiverSubAddress:originalUNB.sender[2]||null,receiverMessageSubAddress:originalUNB.sender[2]||null,
          applicationReference:originalUNB.applicationReference,smtpHost:'smtp.example.invalid',smtpPort:587,senderEmail:'gridex@example.invalid',mailbox:'gridex@example.invalid',receiverEmail:'source@synthetic.example',routeKey:'synthetic-own-route',authorizesBusinessEffect:false},error:null}
      }
      if (name === 'ediel_read_source_rule_pack_basis_v1') {
        database.sourceBasisReads.push({...args,outboundCount:database.tables.get('ediel_messages')!.filter(row=>row.direction==='outbound').length})
        if(database.sourceBasisMode==='missing')return {data:null,error:{message:'synthetic_frozen_basis_unavailable'}}
        const basis=database.sourceBases.get(String(args.p_message_id))
        if((basis?.sourceMessage as Row)?.company_id!==args.p_company_id)throw Error('synthetic_source_basis_scope_unavailable')
        const result=structuredClone(basis!)
        if(database.sourceBasisMode==='changed_raw')result.sourceMessage={...(result.sourceMessage as Row),raw_payload:String((result.sourceMessage as Row).raw_payload)+'\n'}
        return {data:result,error:null}
      }
      if(name==='gridex_read_outbound_acks_for_source_v2') {
        const source=database.tables.get('ediel_messages')!.find(row=>row.id===args.p_source_message_id)!
        return{error:null,data:{version:2,executionActorUserId:args.p_actor_user_id,executionPhase:args.p_phase,sourceMessageId:source.id,companyId:source.company_id,environment:source.environment,
          sourcePayloadHash:createHash('sha256').update(String(source.raw_payload)).digest('hex'),
          originals:[...database.bornOriginals.values()].filter(row=>row.related_message_id===source.id&&row.message_family===args.p_ack_family&&row.direction==='outbound')
          .map(row=>({status:'qualified',message:structuredClone(row),payloadHash:createHash('sha256').update(String(row.raw_payload)).digest('hex')}))}}
      }
      if (name !== 'gridex_require_utilts_positive_ack_authority_v1') throw Error(`unexpected_rpc:${name}`)
      // Adapter-only harness: model an already committed consumer reservation.
      // Actual receipt/series/contract proof stays in the native suite.
      const source = database.tables.get('ediel_messages')!.find(row => row.id === args.p_source_message_id &&
        row.company_id === args.p_company_id && row.environment === args.p_environment)
      const reservation = database.tables.get('ediel_ack_transaction_results')!.find(row =>
        row.source_message_id === args.p_source_message_id && row.source_transaction_id === args.p_transaction_id &&
        row.company_id === args.p_company_id && row.environment === args.p_environment && row.planned_response_type === 'positive_aperak')
      if (!source || !reservation || args.p_ack_message_id !== null) return { data: null, error: { message: 'utilts_positive_ack_storage_unavailable' } }
      return { data: { authorityVersion: 1, companyId: source.company_id, environment: source.environment,
        sourceMessageId: source.id, transactionId: reservation.source_transaction_id,
        sourceRawHash: createHash('sha256').update(String(source.raw_payload)).digest('hex'), ackMessageId: null, ackRawHash: null }, error: null }
    } } }
})

beforeEach(() => {
  database.tables.clear()
  database.sourceBases.clear();database.bornOriginals.clear()
  database.failErrReference = null
  database.raceErrReference = null
  database.raceCommitted = false
  database.sourceBasisMode = 'valid'
  database.sourceBasisReads = []
  vi.stubGlobal('fetch', () => { throw Error('external_network_forbidden') })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function seed(transactions: Parameters<typeof utiltsErrGatewayFixture>[0]['transactions'], date: '2026-09-30' | '2026-10-01' = '2026-10-01', transform?: (raw: string) => string) {
  const company = randomUUID(), actor = randomUUID(), route = randomUUID(), profile = randomUUID()
  const source = {
    ...utiltsErrGatewayFixture({ company, transactions, date }), id: randomUUID(),
    canonical_rule_pack_id: randomUUID(), rule_profile_key: 'synthetic-utilts-e66',
    rule_profile_version_id: randomUUID(), rule_profile_version: '25-A-4:r4', rule_pack_checksum: 'a'.repeat(64),
  } as EdielMessageRow
  if (transform) source.raw_payload = transform(source.raw_payload!)
  // Finite source-basis model declares the actual original packet; both editions are accepted during the grace interval.
  const selected=resolveCanonicalEdielPolicy({family:'UTILTS',messageCode:source.message_code!,direction:'inbound',referenceDate:date,selectedGuideRevision:date==='2026-09-30'?'25-A-3':'25-A-4',applicationReference:source.application_reference,mode:'parse'})
  source.rule_profile_version=`${selected.guide.guideRevision}:r${selected.guide.guideRevision.split('-').at(-1)}`
  const runtime = runUtiltsRuntimeForMessage(source,{referenceDate:date,canonicalPolicy:selected})
  const reservations: Row[] = runtime.transactionDispositions.map(row => ({
    id: randomUUID(), company_id: company, environment: 'test', source_message_id: source.id,
    source_transaction_id: row.transactionId, planned_response_type: row.responseType, finalized_at: null,
  }))
  // External source/insert/preparation IO only. The real gateway, protected
  // capability ports, renderer and guide run; native receipt/actor/SQL proof
  // remains a separate phase and is not established by these modeled rows.
  const revision=selected.guide.guideRevision.split('-').at(-1)!,profileKey=`UTILTS:E66:E5SE5A:${revision}`,version=`${selected.guide.guideRevision}:r${revision}`
  const sourceRulePackEvidence={rulePackId:source.canonical_rule_pack_id,messageProfileId:source.rule_profile_version_id,profileKey,version,sourceHash:source.rule_pack_checksum,
    snapshot:{profileKey,profileVersionId:source.rule_profile_version_id,version,checksum:source.rule_pack_checksum,
      rulePack:{id:source.canonical_rule_pack_id,family:'UTILTS',guide_version:selected.guide.guideRevision,guide_revision:revision,source_hash:source.rule_pack_checksum},
      messageProfile:{id:source.rule_profile_version_id,rule_pack_id:source.canonical_rule_pack_id,profile_key:profileKey},guideSources:[]}}
  database.sourceBases.set(source.id,{version:1,sourceMessage:structuredClone(source),sourceRulePackEvidence})
  for (const [table, rows] of Object.entries({
    ediel_messages: [source], ediel_message_events: [], ediel_ack_transaction_results: reservations, grid_owners: [],
    company_memberships:[{company_id:company,user_id:actor,status:'active',is_active:true,accepted_at:`${date}T00:00:00Z`}],
    user_profiles:[{id:actor,user_status:'active'}],
    ediel_actor_settings: [{ id: actor, company_id: company, environment: 'test', is_active: true, ediel_id: '21660', sender_subaddress: 'DDQ' }],
    tenant_ediel_profiles: [{ id: randomUUID(), company_id: company, environment: 'test', market: 'electricity', is_enabled: true }],
    tenant_actor_identifiers: [{ id: randomUUID(), company_id: company, environment: 'test', actor_id: actor, identifier_type: 'EdielId', identifier_value: '21660' }],
    tenant_actor_roles: [{ id: randomUUID(), company_id: company, environment: 'test', actor_id: actor, role_code: 'DDQ' }],
    tenant_counterparty_relations: [],
    communication_routes: [{ id: route, company_id: company, route_name: 'Synthetic local route', is_active: true, route_scope: 'ediel_ack', environment_type: 'bilateral_test', grid_owner_id: null, target_system: 'synthetic-local-only' }],
    // Prospective external configuration, not source/ACK authority. One
    // explicitly generic profile can carry all reply families for this APP.
    ediel_route_profiles: [{ id: profile, communication_route_id: route, company_id: company, environment: 'test',
      is_enabled: true, is_active: true, application_reference: source.application_reference, message_family: null, business_code: null }],
    ediel_route_runtime_v: [{ communication_route_id: route, company_id: company, route_profile_id: profile, environment: 'test',
      is_enabled: true, application_reference: source.application_reference, message_family: null, business_code: null }],
  })) database.tables.set(table, rows as Row[])
  const finalize = () => createUtiltsRuntimeAcks({ actorUserId: actor, sourceMessage: source,
    ackPlan: runtime.ackPlan, transactionDispositions: runtime.transactionDispositions })
  const acks = () => database.tables.get('ediel_messages')!.filter(row => row.direction === 'outbound')
  return { source, runtime, actor, finalize, acks, reservations }
}

it.each([
  ['tenant', { company_id: 'foreign' }],
  ['route', { communication_route_id: 'foreign' }],
  ['environment', { environment: 'production' }],
  ['APP', { application_reference: '23-DGI-PRODAT' }],
  ['family', { message_family: 'APERAK' }],
  ['code', { business_code: 'APERAK' }],
  ['inactive', { is_active: false }],
  ['disabled', { is_enabled: false }],
] as const)('actual ERR gateway refuses a %s-incompatible configured profile without ACK effects', async (_label, delta) => {
  const f = seed([{ reference: 'PROFILE-REFUSAL', outcome: 'processability_rejected' }])
  Object.assign(database.tables.get('ediel_route_profiles')![0], delta)
  const before = structuredClone([...database.tables]), originals = structuredClone([...database.bornOriginals])
  const draft = buildUtiltsErrDraft({ actorUserId: f.actor, sourceMessage: f.source, messageText: 'E87', relatedTransactionReference: 'PROFILE-REFUSAL' })
  await expect(createCanonicalAckMessage({ actorUserId: f.actor, sourceMessage: f.source, ackFamily: 'UTILTS_ERR', outcome: 'negative', draft }))
    .rejects.toThrow('ediel_ack_route_profile_required')
  expect([...database.tables]).toEqual(before)
  expect([...database.bornOriginals]).toEqual(originals)
  expect(f.acks()).toEqual([])
})

it.each(['generic', 'specific', 'missing-profile', 'missing-view', 'wrong-view-APP'] as const)(
  'actual ERR gateway refuses %s configuration before creating any ACK', async fault => {
    const f = seed([{ reference: 'PROFILE-UNIQUE', outcome: 'processability_rejected' }])
    const profiles = database.tables.get('ediel_route_profiles')!, views = database.tables.get('ediel_route_runtime_v')!
    const draft = buildUtiltsErrDraft({ actorUserId: f.actor, sourceMessage: f.source, messageText: 'E87', relatedTransactionReference: 'PROFILE-UNIQUE' })
    if (fault === 'generic' || fault === 'specific') {
      profiles.push({ ...profiles[0], id: randomUUID(),
        ...(fault === 'specific' ? { message_family: 'UTILTS_ERR', business_code: draft.messageCode } : {}) })
      expect(profiles[1]).toMatchObject({ message_family: fault === 'specific' ? 'UTILTS_ERR' : null,
        business_code: fault === 'specific' ? 'UTILTS_ERR' : null })
    }
    else if (fault === 'missing-profile') profiles.length = 0
    else if (fault === 'missing-view') views.length = 0
    else views[0].application_reference = '23-DGI-PRODAT'
    const before = structuredClone([...database.tables]), originals = structuredClone([...database.bornOriginals])
    const result = createCanonicalAckMessage({ actorUserId: f.actor, sourceMessage: f.source, ackFamily: 'UTILTS_ERR', outcome: 'negative', draft })
    if (fault === 'generic' || fault === 'specific') await expect(result).rejects.toMatchObject({ code: 'PGRST116' })
    else await expect(result).rejects.toThrow(fault === 'missing-profile' ? 'ediel_ack_route_profile_required' : 'ediel_ack_route_profile_scope_mismatch')
    expect([...database.tables]).toEqual(before)
    expect([...database.bornOriginals]).toEqual(originals)
    expect(f.acks()).toEqual([])
  },
)

it('keeps a leading own-ID functional ERR separate from its trimmed positive sibling through the actual ACK gateway',async()=>{
 const f=seed([{reference:' OWN A',outcome:'processability_rejected'},{reference:'OWN A',outcome:'accepted'}])
 expect(f.runtime.transactionDispositions.map(d=>[d.transactionId,d.disposition])).toEqual([[' OWN A','processability_rejected'],['OWN A','accepted']])
 await f.finalize()
 const err=f.acks().find(row=>row.message_family==='UTILTS_ERR')!,ap=f.acks().find(row=>row.message_family==='APERAK')!
 const refs=(row:Row,qualifier:string)=>{
  const wire=EdifactEnvelopeCodec.decode(String(row.raw_payload))
  return wire.segments.filter(s=>s.tag==='RFF').map(s=>segmentComposite(s,1,wire.una)).filter(c=>c[0]===qualifier).map(c=>c[1])
 }
 expect(refs(err,'TN')).toEqual([' OWN A'])
 expect(err.raw_payload).toContain('E87')
 expect(refs(ap,'ACW')).toEqual(['OWN A'])
 expect(f.acks().filter(row=>row.message_family==='UTILTS_ERR')).toHaveLength(1)
 expect(f.acks().filter(row=>row.message_family==='APERAK')).toHaveLength(1)
 expect(f.acks().filter(row=>row.message_family==='CONTRL')).toHaveLength(1)
})

it('U-13 an outgoing UTILTS ERR always uses message function 9 and acknowledgement request AB',async()=>{
 const f=seed([{reference:'OWN B',outcome:'processability_rejected'}])
 await f.finalize()
 const err=f.acks().find(row=>row.message_family==='UTILTS_ERR')!
 const wire=EdifactEnvelopeCodec.decode(String(err.raw_payload)),bgm=wire.segments.find(s=>s.tag==='BGM')!
 expect(segmentComposite(bgm,1,wire.una)[0]).toBe('ERR')
 expect([segmentComposite(bgm,3,wire.una)[0],segmentComposite(bgm,4,wire.una)[0]]).toEqual(['9','AB'])
})
it('SC-045 finalizes one header-negative APERAK without inventing an original IDE reference', async () => {
  const f = seed([
    { reference: 'HEADER-OK', outcome: 'accepted' },
    { reference: 'HEADER-LOWER-E87', outcome: 'processability_rejected' },
  ], '2026-10-01', raw => {
    const lines = raw.split('\n').filter(line => !line.startsWith('DTM+735:'))
    const unt = lines.findIndex(line => line.startsWith('UNT+'))
    const unh = lines.findIndex(line => line.startsWith('UNH+'))
    lines[unt] = `UNT+${unt - unh + 1}+1'`
    return lines.join('\n')
  })
  expect(f.runtime.transactionDispositions.map(row => row.disposition)).toEqual(['guide_rejected', 'guide_rejected'])
  expect(f.runtime.validation.issues.filter(issue => issue.kind === 'functional')).toEqual([])
  await f.finalize()
  const aperaks = f.acks().filter(row => row.message_family === 'APERAK')
  expect(aperaks).toHaveLength(1)
  expect(aperaks[0].parsed_payload).toMatchObject({ ackScope: 'message', relatedTransactionReference: null })
  expect(aperaks[0].raw_payload).toContain('BGM+313+')
  expect(aperaks[0].raw_payload).toContain('ERC+41::260')
  expect(aperaks[0].raw_payload).toContain('206')
  expect(aperaks[0].raw_payload).not.toContain('RFF+ACW:')
  expect(aperaks[0].raw_payload).toContain('RFF+DM:')
  expect(f.acks().filter(row => row.message_family === 'UTILTS_ERR')).toEqual([])
  expect(f.reservations).toEqual(expect.arrayContaining(f.reservations.map(row => expect.objectContaining({
    source_transaction_id: row.source_transaction_id, final_response_type: 'negative_aperak', response_message_id: aperaks[0].id,
  }))))
  const before = structuredClone({ acks: f.acks(), reservations: f.reservations })
  await f.finalize()
  expect({ acks: f.acks(), reservations: f.reservations }).toEqual(before)
})

it('does not infer header serialization from generic message scope', () => {
  const f = seed([{ reference: 'TRANSACTION-GUIDE', outcome: 'guide_rejected' }])
  expect(f.runtime.ackPlan.utiltsHeaderRejection).toBeUndefined()
  const draft = buildAperakDraft({ sourceMessage: f.source, outcome: 'negative', ackScope: 'message',
    applicationErrors: f.runtime.ackPlan.aperakApplicationErrors })
  expect(draft.rawPayload).toContain('RFF+ACW:TRANSACTION-GUIDE')
})

it.each(['positive', 'transaction'] as const)('refuses inconsistent %s header provenance', kind => {
  const f = seed([{ reference: 'HEADER-SCOPE', outcome: 'accepted' }])
  expect(() => buildAperakDraft({ sourceMessage: f.source,
    outcome: kind === 'positive' ? 'positive' : 'negative', utiltsHeaderRejected: true,
    relatedTransactionReference: kind === 'transaction' ? 'HEADER-SCOPE' : null,
    applicationErrors: [{ ercCode: '41', fieldCode: '206', text: 'MANDATORY FIELD MISSING' }] }))
    .toThrow('utilts_header_aperak_scope_invalid')
})

it('cannot forge header scope from an unreferenced transaction error on a valid wire', () => {
  const f = seed([{ reference: 'NO-HEADER-FAULT', outcome: 'accepted' }])
  expect(() => buildAperakDraft({ sourceMessage: f.source, outcome: 'negative', utiltsHeaderRejected: true,
    applicationErrors: [{ ercCode: '41', fieldCode: '512', text: 'MANDATORY FIELD MISSING' }] }))
    .toThrow('utilts_header_aperak_scope_invalid')
})

it('retains distinct own NAD component faults while holding an invalid legal ACK party', async () => {
  const f = seed([{ reference: 'HEADER-NAD-FAULT', outcome: 'accepted' }], '2026-10-01',
    raw => raw.replace('NAD+MS+91100:SVK:260', 'NAD+MS+ABC:SVK:XXX'))
  expect(f.runtime.ackPlan.utiltsHeaderRejection?.applicationErrors).toEqual([
    expect.objectContaining({ ercCode:'42',fieldCode:'207',text:'INCORRECT DATA XXX',referenceNumber:null,lineItemReference:null }),
    expect.objectContaining({ ercCode:'42',fieldCode:'207',text:'INCORRECT DATA ABC',referenceNumber:null,lineItemReference:null }),
  ])
  const before = structuredClone(f.reservations)
  await expect(f.finalize()).rejects.toThrow('ACK_APERAK_LEGAL_PARTY_INVALID')
  expect(f.acks().filter(row => row.message_family !== 'CONTRL')).toEqual([])
  const controls = f.acks().filter(row => row.message_family === 'CONTRL')
  expect(controls).toHaveLength(1)
  expect(controls[0]).toMatchObject({company_id:f.source.company_id,environment:'test',related_message_id:f.source.id,
    source_operation_id:`ediel_ack:${f.source.id}:CONTRL:message`})
  expect(controls[0].raw_payload).toContain('UCI+260831181101+91100:ZZ+21660:ZZ+1')
  expect(f.reservations).toEqual(before)
})

it('deduplicates one own NAD component fault and renders its exact rejected content', async () => {
  const f = seed([{ reference:'HEADER-NAD-ID-FAULT',outcome:'accepted' }], '2026-10-01',
    raw => raw.replace('NAD+MS+91100:SVK:260', 'NAD+MS+ABC:SVK:260'))
  expect(f.runtime.ackPlan.utiltsHeaderRejection?.applicationErrors).toMatchObject([
    {ercCode:'42',fieldCode:'207',text:'INCORRECT DATA ABC',referenceNumber:null,lineItemReference:null},
  ])
  expect(f.runtime.ackPlan.utiltsHeaderRejection?.applicationErrors).toHaveLength(1)
  await f.finalize()
  const aperaks = f.acks().filter(row => row.message_family === 'APERAK')
  expect(aperaks).toHaveLength(1)
  expect(aperaks[0].raw_payload).toContain('FTX+AAO++207::260+INCORRECT DATA ABC')
  expect(aperaks[0].raw_payload).not.toContain('RFF+ACW:')
})

it.each([
  ['2026-09-30', 'E19'], ['2026-10-01', 'E87'],
] as const)('real %s functional rejection obeys the canonical ERR gateway for its own IDE', async (date, code) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${date}T12:00:00Z`))
  const reference = 'ERR-OWN-IDE-1'
  const f = seed([{ reference, outcome: 'processability_rejected' }], date)
  expect(f.runtime.transactionDispositions.map(row => row.disposition)).toEqual(['processability_rejected'])
  expect(f.runtime.ackPlan.utiltsErrDetails.map(row => row.code)).toEqual([code])
  await f.finalize()
  const errs = f.acks().filter(row => row.message_family === 'UTILTS_ERR')
  expect(errs).toHaveLength(1)
  expect(errs[0].process_type).toBe('functional_rejection')
  expect(errs[0].raw_payload).toContain(`DTM+137:${date.replaceAll('-', '')}`)
  expect(errs[0].raw_payload).toContain(`RFF+TN:${reference}'`)
  expect(f.reservations[0]).toMatchObject({ final_response_type: 'utilts_err', response_message_id: errs[0].id })
  const before = structuredClone({ errs, reservation: f.reservations[0] })
  await f.finalize()
  expect({ errs: f.acks().filter(row => row.message_family === 'UTILTS_ERR'), reservation: f.reservations[0] }).toEqual(before)
})

it('canonically qualified same-code ERR drafts keep full IDE identity and immutable retry', async () => {
  const references = ['ERR-SHARED-PREFIX-LONG-IDE-A', 'ERR-SHARED-PREFIX-LONG-IDE-B']
  const f = seed(references.map(reference => ({ reference, outcome: 'processability_rejected' })))
  const policy = resolveCanonicalEdielPolicy({ family: 'UTILTS_ERR', messageCode: 'ERR', direction: 'outbound',
    referenceDate: '2026-10-01', associationAssignedCode: 'E5SE5A', mode: 'catalog_evidence' })
  const create = async (reference: string, code = 'E87') => {
    const draft = buildUtiltsErrDraft({ actorUserId: f.actor, sourceMessage: f.source, messageText: code, relatedTransactionReference: reference })
    // Isolate duplicate identity while retaining real policy qualification.
    // The ordinary finalizer tests above separately require the builder fix.
    draft.processType = policy.processGroup
    return createCanonicalAckMessage({ actorUserId: f.actor, sourceMessage: f.source, ackFamily: 'UTILTS_ERR', outcome: 'negative', draft })
  }
  const first = await create(references[0]), second = await create(references[1])
  expect(second.id).not.toBe(first.id)
  expect([first, second].map(row => row.parsed_payload?.relatedTransactionReference)).toEqual(references)
  for (const [index, row] of [first, second].entries()) {
    expect(row.source_operation_id).toBe(`ediel_ack:${f.source.id}:UTILTS_ERR:${references[index]}`)
    expect(row.raw_payload).toContain(`RFF+TN:${references[index]}'`)
  }
  expect(await create(references[0], 'E10')).toEqual(first)
  expect(await create(references[1])).toEqual(second)
  expect(f.acks()).toHaveLength(2)
})

it('real mixed accepted, guide-negative and two same-code functional-negative IDEs finalize separately after interruption', async () => {
  const transactions = [
    { reference: 'ACK-OK', outcome: 'accepted' as const },
    { reference: 'ACK-GUIDE', outcome: 'guide_rejected' as const },
    { reference: 'ACK-ERR-A', outcome: 'processability_rejected' as const },
    { reference: 'ACK-ERR-B', outcome: 'processability_rejected' as const },
  ]
  const f = seed(transactions)
  expect(f.runtime.transactionDispositions.map(row => row.disposition)).toEqual(transactions.map(row => row.outcome))
  database.failErrReference = 'ACK-ERR-B'
  await expect(f.finalize()).rejects.toThrow('synthetic_interruption_after_first_err')
  expect(f.reservations.map(row => row.final_response_type ?? null)).toEqual(['positive_aperak', 'negative_aperak', 'utilts_err', null])
  const firstErr = structuredClone(f.acks().find(row => row.message_family === 'UTILTS_ERR'))
  database.failErrReference = null
  await f.finalize()
  expect(f.reservations.map(row => row.final_response_type)).toEqual(['positive_aperak', 'negative_aperak', 'utilts_err', 'utilts_err'])
  expect(f.acks().filter(row => row.message_family === 'UTILTS_ERR')).toHaveLength(2)
  expect(f.acks().find(row => row.id === firstErr?.id)).toEqual(firstErr)
  const before = structuredClone({ acks: f.acks(), reservations: f.reservations })
  await f.finalize()
  expect({ acks: f.acks(), reservations: f.reservations }).toEqual(before)
})

it('legacy caller code metadata cannot split an immutable physical own-IDE ERR', async () => {
  const f = seed([{ reference: 'LEGACY-ERR-IDE', outcome: 'processability_rejected' }])
  const create = async (code: string) => {
    const draft = buildUtiltsErrDraft({ actorUserId: f.actor, sourceMessage: f.source, messageText: code })
    const policy = resolveCanonicalEdielPolicy({ family: 'UTILTS_ERR', messageCode: 'ERR', direction: 'outbound',
      referenceDate: '2026-10-01', associationAssignedCode: 'E5SE5A', mode: 'catalog_evidence' })
    draft.processType = policy.processGroup
    return createCanonicalAckMessage({ actorUserId: f.actor, sourceMessage: f.source, ackFamily: 'UTILTS_ERR', outcome: 'negative', draft })
  }
  const first = await create('E87'), second = await create('E10')
  expect(second).toEqual(first)
  expect(first.source_operation_id).toBe(`ediel_ack:${f.source.id}:UTILTS_ERR:LEGACY-ERR-IDE`)
  expect(await create('E87')).toEqual(first)
  expect(await create('E10')).toEqual(second)
  expect(f.acks()).toHaveLength(1)
})

it.each([true, false])('a unique insert failure recovers only the same IDE ERR when committed=%s', async committed => {
  const references = ['UNIQUE-ERR-IDE-A', 'UNIQUE-ERR-IDE-B']
  const f = seed(references.map(reference => ({ reference, outcome: 'processability_rejected' })))
  const create = (reference: string) => createCanonicalAckMessage({ actorUserId: f.actor, sourceMessage: f.source,
    ackFamily: 'UTILTS_ERR', outcome: 'negative', draft: buildUtiltsErrDraft({ actorUserId: f.actor,
      sourceMessage: f.source, messageText: 'E87', relatedTransactionReference: reference }) })
  const first = await create(references[0])
  database.raceErrReference = references[1]
  database.raceCommitted = committed
  if (committed) {
    const own = await create(references[1])
    expect(own.id).not.toBe(first.id)
    expect(own.parsed_payload?.relatedTransactionReference).toBe(references[1])
    expect(own.raw_payload).toContain(`RFF+TN:${references[1]}'`)
    expect(f.acks()).toHaveLength(2)
  } else {
    await expect(create(references[1])).rejects.toMatchObject({ code: '23505' })
    expect(f.acks()).toEqual([first])
  }
})

it.each(['missing','changed_raw'] as const)('the actual canonical gateway refuses %s protected source despite parsed snapshot JSON',async mode=>{
 const f=seed([{reference:'PROTECTED-ERR-IDE',outcome:'processability_rejected'}])
 const draft=buildUtiltsErrDraft({actorUserId:f.actor,sourceMessage:f.source,messageText:'E87',relatedTransactionReference:'PROTECTED-ERR-IDE'})
 draft.parsedPayload={...draft.parsedPayload,canonicalSourceRulePackSnapshot:{profileKey:f.source.rule_profile_key,
  profileVersionId:f.source.rule_profile_version_id,version:f.source.rule_profile_version,checksum:f.source.rule_pack_checksum,
  inheritedFromSourceMessage:true,sourceMessageId:f.source.id}}
 database.sourceBasisMode=mode
 const reservations=structuredClone(f.reservations)
 const result=createCanonicalAckMessage({actorUserId:f.actor,sourceMessage:f.source,ackFamily:'UTILTS_ERR',outcome:'negative',draft})
 if(mode==='missing')await expect(result).rejects.toMatchObject({message:'synthetic_frozen_basis_unavailable'})
 else await expect(result).rejects.toThrow('canonical_ack_actual_original_mismatch')
 expect(database.sourceBasisReads).toEqual([{p_company_id:f.source.company_id,p_message_id:f.source.id,outboundCount:0}])
 expect(f.acks()).toEqual([])
 expect(f.reservations).toEqual(reservations)
})

it('reuses a protected prior-edition ERR before current rendering despite failed mutable projection',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-30T12:00:00Z'))
  const f=seed([{reference:'RETAINED-E19',outcome:'processability_rejected'}],'2026-09-30')
  await f.finalize()
  const err=f.acks().find(row=>row.message_family==='UTILTS_ERR')!
  const immutable={id:err.id,raw:err.raw_payload,reservation:structuredClone(f.reservations)}
  err.status='failed';err.ack_outcome='positive';err.parsed_payload={...(err.parsed_payload as Row),ackOutcome:'positive'}
  database.sourceBases.clear() // Fresh original reads would now fail, never select today's guide.
  vi.setSystemTime(new Date('2026-10-15T12:00:00Z'))
  const replay=await createAckIfMissing({actorUserId:f.actor,sourceMessage:f.source,ackFamily:'UTILTS_ERR',messageText:'E87',relatedTransactionReference:'RETAINED-E19'})
  expect(replay).toMatchObject({id:immutable.id,ack_outcome:'negative',raw_payload:immutable.raw})
  expect(f.acks().filter(row=>row.message_family==='UTILTS_ERR')).toHaveLength(1)
  expect(f.reservations).toEqual(immutable.reservation)
})

it('refuses a changed caller source before reusing a protected ACK original',async()=>{
  const f=seed([{reference:'HASH-BOUND-ERR',outcome:'processability_rejected'}])
  await f.finalize()
  await expect(createAckIfMissing({actorUserId:f.actor,sourceMessage:{...f.source,raw_payload:f.source.raw_payload!.replace('HASH-BOUND-ERR','OTHER-SOURCE-IDE')},ackFamily:'UTILTS_ERR',relatedTransactionReference:'HASH-BOUND-ERR'})).rejects.toThrow('ediel_existing_ack_original_source_mismatch')
  expect(f.acks().filter(row=>row.message_family==='UTILTS_ERR')).toHaveLength(1)
})

it('accepts only the actual immutable source capability in ERR preflight, never its JSON copy',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-01T12:00:00Z'))
  const f=seed([{reference:'ORIGINAL-GUIDE-E19',outcome:'processability_rejected'}],'2026-09-30')
  const q=await readSourceBoundOutboundAckRulePackEvidence({companyId:f.source.company_id!,environment:f.source.environment,sourceMessageId:f.source.id})
  const draft=buildUtiltsErrDraft({actorUserId:f.actor,sourceMessage:f.source,messageText:'E19',relatedTransactionReference:'ORIGINAL-GUIDE-E19',ackSourceQualification:q})
  expect(draft.rawPayload).toContain('STS+E01::260+41+E19::260')
  expect(()=>buildUtiltsErrDraft({actorUserId:f.actor,sourceMessage:f.source,messageText:'E19',ackSourceQualification:{...q}})).toThrow('ack_source_qualification_scope_mismatch')
  expect(()=>buildUtiltsErrDraft({actorUserId:f.actor,sourceMessage:f.source,messageText:'E19'})).toThrow('ACK_UTILTS_ERR_ORIGINAL_REASON_SCOPE_REQUIRED')
})

it('SC-048 an own E50 period fault on a known object is finalized as a physical UTILTS ERR E50 on the current TN, without E10 or created objects',async()=>{
 // Registration (SG5 DTM+597) moved before the latest QTY+220 reading date.
 const f=seed([{reference:'OWN-E50',outcome:'accepted'}],'2026-09-30',raw=>raw.replace("DTM+597:202608010000:203'\nDTM+354","DTM+597:202607150000:203'\nDTM+354").replace("QTY+136:500'","QTY+136:1000'"))
 expect(f.runtime.ackPlan.utiltsErrCodes).toEqual(['E50'])
 // Contrast: the same object and sender with a valid registration time gives no ERR code.
 expect(runUtiltsRuntimeForMessage({...f.source,raw_payload:f.source.raw_payload!.replace("DTM+597:202607150000:203'\nDTM+354","DTM+597:202608010000:203'\nDTM+354")},{referenceDate:'2026-09-30'}).ackPlan.utiltsErrCodes).toEqual([])
 expect(f.runtime.validation.issues.filter(i=>i.severity==='error').map(i=>i.utiltsErrCode)).toEqual(['E50'])
 const tablesBefore=[...database.tables.keys()].filter(t=>t!=='ediel_messages'&&t!=='ediel_message_events'&&t!=='ediel_ack_transaction_results').map(t=>[t,database.tables.get(t)!.length])
 await f.finalize()
 const errs=f.acks().filter(row=>row.message_family==='UTILTS_ERR')
 expect(errs).toHaveLength(1)
 const wire=EdifactEnvelopeCodec.decode(String(errs[0].raw_payload))
 const codes=wire.segments.filter(s=>s.tag==='STS'||s.tag==='ERC').flatMap(s=>s.elements.flatMap((_,i)=>segmentComposite(s,i,wire.una)))
 expect(codes).toContain('E50');expect(codes).not.toContain('E10')
 expect(wire.segments.filter(s=>s.tag==='RFF').map(s=>segmentComposite(s,1,wire.una)).filter(c=>c[0]==='TN').map(c=>c[1])).toEqual(['OWN-E50'])
 // No master data was created to make the check pass.
 expect([...database.tables.keys()].filter(t=>t!=='ediel_messages'&&t!=='ediel_message_events'&&t!=='ediel_ack_transaction_results').map(t=>[t,database.tables.get(t)!.length])).toEqual(tablesBefore)
})

it('SC-047 an object known only in another tenant is unknown here: the real lookup, runtime and ACK gateway send one UTILTS ERR E10 on the original TN',async()=>{
 const f=seed([{reference:'OWN-E10',outcome:'accepted'}])
 const foreign={id:'foreign-point',company_id:'00000000-0000-4000-8000-0000000000ff',meter_point_id:'735999260731000007',metering_point_id:null,ediel_reference:null}
 database.tables.set('metering_points',[foreign]);database.tables.set('customer_sites',[]);database.tables.set('customers',[])
 const before=structuredClone({points:database.tables.get('metering_points'),sites:database.tables.get('customer_sites'),customers:database.tables.get('customers')})
 // Actual company-scoped lookup on the parsed transaction identity.
 const matches=await matchUtiltsTransactionsForTenant({message:f.source,facts:f.runtime.facts})
 expect(matches).toEqual([expect.objectContaining({transactionReference:'OWN-E10',externalMeteringPointId:'735999260731000007',meteringPointId:null,matchStatus:'unmatched'})])
 const source={...f.source,parsed_payload:{...(f.source.parsed_payload??{}),utiltsTransactionMatches:matches}} as EdielMessageRow
 const policy=resolveCanonicalEdielPolicy({family:'UTILTS',messageCode:'E66',direction:'inbound',referenceDate:'2026-10-01',selectedGuideRevision:'25-A-4',applicationReference:source.application_reference,mode:'parse'})
 const runtime=runUtiltsRuntimeForMessage(source,{referenceDate:'2026-10-01',canonicalPolicy:policy})
 // Syntax and guide pass; the object control is the prescribed functional outcome.
 expect(runtime.validation.issues.filter(i=>i.severity==='error').map(i=>[i.kind,i.utiltsErrCode])).toEqual([['functional','E10']])
 database.tables.set('ediel_ack_transaction_results',runtime.transactionDispositions.map(row=>({id:randomUUID(),company_id:source.company_id,environment:'test',source_message_id:source.id,
  source_transaction_id:row.transactionId,planned_response_type:row.responseType,finalized_at:null})))
 await createUtiltsRuntimeAcks({actorUserId:f.actor,sourceMessage:source,ackPlan:runtime.ackPlan,transactionDispositions:runtime.transactionDispositions})
 const errs=f.acks().filter(row=>row.message_family==='UTILTS_ERR')
 expect(errs).toHaveLength(1)
 const wire=EdifactEnvelopeCodec.decode(String(errs[0].raw_payload))
 expect(wire.segments.flatMap(s=>s.elements.flatMap((_,i)=>segmentComposite(s,i,wire.una)))).toContain('E10')
 expect(wire.segments.filter(s=>s.tag==='RFF').map(s=>segmentComposite(s,1,wire.una)).filter(c=>c[0]==='TN').map(c=>c[1])).toEqual(['OWN-E10'])
 // The foreign tenant's object and the own customer data stay untouched; nothing is created.
 expect({points:database.tables.get('metering_points'),sites:database.tables.get('customer_sites'),customers:database.tables.get('customers')}).toEqual(before)
 // Contrast: the same object registered in the own tenant matches and gives no E10.
 database.tables.set('metering_points',[foreign,{...foreign,id:'own-point',company_id:source.company_id}])
 const own=await matchUtiltsTransactionsForTenant({message:f.source,facts:f.runtime.facts})
 expect(own[0]).toMatchObject({meteringPointId:'own-point',matchStatus:'matched'})
 expect(runUtiltsRuntimeForMessage({...source,parsed_payload:{...(f.source.parsed_payload??{}),utiltsTransactionMatches:own}} as EdielMessageRow,{referenceDate:'2026-10-01',canonicalPolicy:policy}).ackPlan.utiltsErrCodes).toEqual([])
})
