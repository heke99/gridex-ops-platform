import { createHash, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { utiltsErrGatewayFixture } from './helpers/utiltsErrGatewayFixture'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { createAckIfMissing,createUtiltsRuntimeAcks } from '@/lib/ediel/flows/utiltsDataRequest.part-1'
import {readSourceBoundOutboundAckRulePackEvidence} from '@/lib/ediel/core/ackSourceRulePackEvidence'
import { createCanonicalAckMessage } from '@/lib/ediel/core/kernel'
import { buildAperakDraft, buildUtiltsErrDraft } from '@/lib/ediel/ack'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import type { EdielMessageRow } from '@/lib/ediel/types'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite} from '@/lib/ediel/core/edifactTokenizer'

// Modeled transport configuration only; no outbox/provider/send is exercised.
vi.mock('@/lib/ediel/mailReadiness',()=>({assertEdielSmtpReadiness:()=>({from:'gridex@example.invalid',host:'smtp.example.invalid',port:587})}))

type Row = Record<string, unknown>
const database = vi.hoisted(() => ({ tables: new Map<string, Row[]>(), failErrReference: null as string | null,
  raceErrReference: null as string | null, raceCommitted: false,sourceBases:new Map<string,Row>(),bornOriginals:new Map<string,Row>() }))
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
    not(key: string, operation: string, expected: string|null) {
      if(operation==='is')this.filters.push(row=>value(row,key)!==expected)
      else if(operation==='in') {
        const excluded = expected!.replace(/^\(|\)$/g, '').split(',')
        this.filters.push(row => !excluded.includes(String(value(row, key))))
      } else throw Error(`unexpected_filter:${operation}`)
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
        return { data: this.one ? data[0] ?? null : data, error: null, count: data.length }
      }).then(resolve, reject)
    }
  }
  return { supabaseService: { from: (table: string) => new Query(table), rpc: async (name: string, args: Row) => {
      if(name==='gridex_actor_has_company_permission')return{error:null,data:database.tables.get('company_memberships')!.some(row=>row.company_id===args.p_company_id&&row.user_id===args.p_actor_user_id&&row.status==='active')}
      if(name==='ediel_read_source_rule_pack_basis_v1') {
        const basis=database.sourceBases.get(String(args.p_message_id))
        if((basis?.sourceMessage as Row)?.company_id!==args.p_company_id)throw Error('synthetic_source_basis_scope_unavailable')
        return{error:null,data:structuredClone(basis)}
      }
      if(name==='ediel_require_technical_syntax_ack_basis_v1') {
        const basis=database.sourceBases.get(String(args.p_message_id)),source=basis?.sourceMessage as EdielMessageRow|undefined
        if(!source||source.company_id!==args.p_company_id)throw Error('synthetic_technical_original_scope_unavailable')
        const wire=EdifactEnvelopeCodec.decode(source.raw_payload!)
        const unb=wire.segments.find(segment=>segment.tag==='UNB')
        return{error:null,data:{kind:'technical_syntax_ack',version:1,companyId:source.company_id,environment:source.environment,sourceMessageId:source.id,
          sourceHash:createHash('sha256').update(source.raw_payload!).digest('hex'),observedAt:source.message_received_at,syntaxAssessmentId:randomUUID(),syntaxDecision:'accepted',
          transportActorId:String(database.tables.get('ediel_actor_settings')![0].id),transportEdielId:wire.receiver,
          originalUNB:{sender:segmentComposite(unb,2,wire.una),receiver:segmentComposite(unb,3,wire.una),interchangeReference:wire.interchangeReference,uciReference:wire.interchangeReference!.slice(0,14),applicationReference:wire.applicationReference,testIndicator:wire.testIndicator}}}
      }
      if(name==='ediel_read_technical_syntax_ack_route_v1') {
        const source=database.sourceBases.get(String(args.p_source_message_id))?.sourceMessage as EdielMessageRow
        const wire=EdifactEnvelopeCodec.decode(source.raw_payload!)
        return{error:null,data:{kind:'technical_syntax_ack_route',companyId:source.company_id,environment:source.environment,sourceMessageId:source.id,
          sourceHash:createHash('sha256').update(source.raw_payload!).digest('hex'),authorizesBusinessEffect:false,
          route:database.tables.get('communication_routes')![0],routeRuntime:database.tables.get('ediel_route_runtime_v')![0],
          senderEdielId:wire.receiver,senderQualifier:wire.receiverQualifier,senderSubAddress:wire.receiverSubAddress,
          receiverEdielId:wire.sender,receiverQualifier:wire.senderQualifier,receiverSubAddress:wire.senderSubAddress,
          receiverMessageSubAddress:wire.senderSubAddress,applicationReference:wire.applicationReference,
          senderEmail:args.p_smtp_from,mailbox:args.p_smtp_from,receiverEmail:'counterparty@example.invalid',routeKey:'modeled-local-only'}}
      }
      if(name==='ediel_prepare_outbound_owner_witness_v1') {
        const input=args.p_input as Row,basis=database.sourceBases.get(String(input.relatedMessageId))
        if(!basis || JSON.stringify(input.rulePackEvidence)!==JSON.stringify(basis.sourceRulePackEvidence))throw Error('synthetic_original_named_basis_mismatch')
        return{error:null,data:{version:1,witnessId:randomUUID(),evidence:structuredClone(input.rulePackEvidence)}}
      }
      if(name==='gridex_read_outbound_acks_for_source_v1') {
        const source=database.tables.get('ediel_messages')!.find(row=>row.id===args.p_source_message_id)!
        return{error:null,data:{version:1,sourceMessageId:source.id,companyId:source.company_id,environment:source.environment,
          sourcePayloadHash:createHash('sha256').update(String(source.raw_payload)).digest('hex'),
          originals:[...database.bornOriginals.values()].filter(row=>row.related_message_id===source.id&&row.message_family===args.p_ack_family&&row.direction==='outbound')
          .map(row=>({status:'qualified',message:structuredClone(row),payloadHash:createHash('sha256').update(String(row.raw_payload)).digest('hex')}))}}
      }
      if (name !== 'gridex_require_utilts_positive_ack_authority_v1') throw Error(`unexpected_rpc:${name}`)
      // ACK-only harness: model an already committed consumer reservation.
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
    rule_profile_version_id: randomUUID(), rule_profile_version: 'E5SE5A-r3', rule_pack_checksum: 'a'.repeat(64),
  } as EdielMessageRow
  if (transform) source.raw_payload = transform(source.raw_payload!)
  const selected=resolveCanonicalEdielPolicy({family:'UTILTS',messageCode:'E66',direction:'inbound',referenceDate:date,applicationReference:source.application_reference,mode:'parse'})
  const runtime = runUtiltsRuntimeForMessage(source,{canonicalPolicy:selected})
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
    ediel_messages: [source], ediel_message_events: [], ediel_ack_transaction_results: reservations,
    company_memberships:[{company_id:company,user_id:actor,status:'active',is_active:true,accepted_at:`${date}T00:00:00Z`}],
    user_profiles:[{id:actor,user_status:'active'}],
    ediel_actor_settings: [{ id: actor, company_id: company, environment: 'test', is_active: true, ediel_id: '21660', sender_subaddress: 'DDQ' }],
    tenant_ediel_profiles: [{ id: randomUUID(), company_id: company, environment: 'test', market: 'electricity', is_enabled: true }],
    tenant_actor_identifiers: [{ id: randomUUID(), company_id: company, environment: 'test', actor_id: actor, identifier_type: 'EdielId', identifier_value: '21660' }],
    tenant_actor_roles: [{ id: randomUUID(), company_id: company, environment: 'test', actor_id: actor, role_code: 'DDQ' }],
    tenant_counterparty_relations: [],
    communication_routes: [{ id: route, company_id: company, route_name: 'Synthetic local route', is_active: true, route_scope: 'ediel_ack', environment_type: 'bilateral_test', grid_owner_id: null, target_system: 'synthetic-local-only' }],
    ediel_route_runtime_v: [{ communication_route_id: route, company_id: company, route_profile_id: profile, environment: 'test',is_enabled:true }],
  })) database.tables.set(table, rows as Row[])
  const finalize = () => createUtiltsRuntimeAcks({ actorUserId: actor, sourceMessage: source,
    ackPlan: runtime.ackPlan, transactionDispositions: runtime.transactionDispositions })
  const acks = () => database.tables.get('ediel_messages')!.filter(row => row.direction === 'outbound')
  return { source, runtime, actor, finalize, acks, reservations }
}

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

it('preserves actual NAD header faults while holding an unaddressable legal actor response', async () => {
  const f = seed([{ reference: 'HEADER-NAD-FAULT', outcome: 'accepted' }], '2026-10-01',
    raw => raw.replace('NAD+MS+91100:SVK:260', 'NAD+MS+ABC:SVK:XXX'))
  const errors=f.runtime.ackPlan.utiltsHeaderRejection!.applicationErrors
  expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ ercCode: '42', fieldCode: '207',text:'INCORRECT DATA ABC' }),expect.objectContaining({ ercCode: '42', fieldCode: '207',text:'INCORRECT DATA XXX' })]))
  expect(errors).toHaveLength(2)
  await expect(f.finalize()).rejects.toThrow(/ACK_APERAK_LEGAL_PARTY_INVALID/)
  const aperaks = f.acks().filter(row => row.message_family === 'APERAK')
  expect(aperaks).toEqual([])
  expect(f.reservations.every(row=>!row.final_response_type)).toBe(true)
})

it.each([
  ['2026-09-30', 'E19'], ['2026-10-01', 'E87'],
] as const)('real %s functional rejection reaches the canonical ERR gateway and finalizes its own IDE', async (date, code) => {
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
