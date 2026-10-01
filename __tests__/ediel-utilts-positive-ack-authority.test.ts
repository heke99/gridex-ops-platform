import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertUtiltsPositiveAckAuthorityForSend } from '@/lib/ediel/utilts/positiveAckAuthority'
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { createCanonicalAckMessage } from '@/lib/ediel/core/kernel'
import { buildAperakDraft } from '@/lib/ediel/ack'
import { utiltsErrGatewayFixture } from './helpers/utiltsErrGatewayFixture'
import type { EdielMessageRow } from '@/lib/ediel/types'

const state = vi.hoisted(() => ({ rpc: vi.fn(), create: vi.fn(),
  sources:new Map<string,EdielMessageRow>(),actors:new Map<string,string>(),protectedCalls:[] as string[] }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from:(table:string)=>{
    const filters:Record<string,unknown>={}
    const query={select(){return query},eq(key:string,value:unknown){filters[key]=value;return query},not(key:string,operator:string,value:unknown){expect([key,operator,value]).toEqual(['accepted_at','is',null]);return query},
      async maybeSingle(){
        if(table==='company_memberships'){
          const company=state.actors.get(String(filters.user_id))
          return {data:company===filters.company_id&&filters.status==='active'&&filters.is_active===true?{company_id:company,user_id:filters.user_id,status:'active',is_active:true,accepted_at:'2026-09-01T00:00:00Z'}:null,error:null}
        }
        expect(table).toBe('user_profiles');expect(filters.user_status).toBe('active')
        return {data:state.actors.has(String(filters.id))?{id:filters.id,user_status:'active'}:null,error:null}
      }};return query
  },
  rpc:async(name:string,args:Record<string,unknown>)=>{
    state.protectedCalls.push(name)
    if(name==='ediel_read_outbound_ack_replay_v1') {
      const source=state.sources.get(String(args.p_source_message_id))
      expect(source).toBeDefined();expect(args).toMatchObject({p_company_id:source!.company_id,p_environment:source!.environment,p_ack_family:'APERAK',p_sequence_field:'relatedTransactionReference',p_sequence_value:'OWN-IDE'})
      // No prior own ACK exists in this fresh-only gateway harness.
      return {data:null,error:null}
    }
    if(name==='ediel_require_source_bytes_available_v1'){
      const source=state.sources.get(String(args.p_source_message_id))
      return {data:null,error:source&&source.company_id===args.p_company_id&&source.raw_payload?null:{message:'finite_actual_source_bytes_unavailable'}}
    }
    if(name==='ediel_create_outbound_ack_atomic_v1'){
      const source=state.sources.get(String(args.p_source_message_id)),draft=args.p_draft as Record<string,unknown>
      if(!source||source.company_id!==args.p_company_id||state.actors.get(String(args.p_actor_user_id))!==args.p_company_id)return {data:null,error:{message:'finite_current_source_actor_unavailable'}}
      expect(args.p_source_payload_hash).toBe(createHash('sha256').update(source.raw_payload!).digest('hex'))
      expect(args).toMatchObject({p_ack_family:'APERAK',p_sequence_field:'relatedTransactionReference',p_sequence_value:'OWN-IDE',p_outcome:'positive'})
      // Declared stateful RPC boundary only. Real native source/ACK witness,
      // accepted series, grant and finalization remain independently native.
      await state.create({companyId:source.company_id,canonicalRulePackId:source.canonical_rule_pack_id,relatedMessageId:source.id,rawPayload:draft.rawPayload})
      return {data:{version:1,sourceMessage:source,ackMessage:{...source,id:'created',direction:'outbound',message_family:'APERAK',message_code:'312',related_message_id:source.id,
        raw_payload:draft.rawPayload,ack_outcome:'positive',parsed_payload:{...(draft.parsedPayload as Record<string,unknown>),ackScope:'transaction',relatedTransactionReference:'OWN-IDE'}}},error:null}
    }
    if(name==='gridex_actor_has_company_permission')return {data:args.p_permission==='communication.write'&&state.actors.get(String(args.p_actor_user_id))===args.p_company_id,error:null}
    if(name==='ediel_read_source_rule_pack_basis_v1') {
      const source=state.sources.get(String(args.p_message_id))
      if(!source||source.company_id!==args.p_company_id)return {data:null,error:{message:'ack_actual_original_unavailable'}}
      return {data:{version:1,sourceMessage:source,sourceRulePackEvidence:sourceEvidence(source)},error:null}
    }
    if(name==='ediel_prepare_outbound_owner_witness_v1') {
      const input=args.p_input as Record<string,unknown>,source=state.sources.get(String(input.relatedMessageId))
      expect(source).toBeDefined();expect(input).toMatchObject({companyId:source!.company_id,environment:source!.environment})
      expect(state.actors.get(String(input.actorUserId))).toBe(input.companyId)
      expect(input.rulePackEvidence).toEqual(sourceEvidence(source!));expect(String(input.rawPayload)).toContain("RFF+ACW:OWN-IDE'")
      return {data:{version:1,witnessId:randomUUID(),evidence:input.rulePackEvidence},error:null}
    }
    expect(name).toBe('gridex_require_utilts_positive_ack_authority_v1')
    return state.rpc(name,args)
  }
} }))
function sourceEvidence(source:EdielMessageRow){return {
  rulePackId:source.canonical_rule_pack_id,messageProfileId:source.rule_profile_version_id,profileKey:source.rule_profile_key,
  version:source.rule_profile_version,sourceHash:source.rule_pack_checksum,snapshot:{profileKey:source.rule_profile_key,
    profileVersionId:source.rule_profile_version_id,version:source.rule_profile_version,checksum:source.rule_pack_checksum,
    rulePack:{id:source.canonical_rule_pack_id,family:'UTILTS',guide_version:'25-A-4',guide_revision:'4',source_hash:source.rule_pack_checksum},
    messageProfile:{id:source.rule_profile_version_id,rule_pack_id:source.canonical_rule_pack_id},guideSources:[]},
}}
vi.mock('@/lib/ediel/core/kernelLegacy', () => ({
  resolveCanonicalOutboundContext: async () => ({ route: { id: 'route' }, routeRuntime: { route_profile_id: 'profile' } }),
}))
vi.mock('@/lib/ediel/core/dedupe', () => ({ hasCanonicalAckDuplicate: async () => null }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessage: state.create, findSequencedAckForSource: async () => null,
  createCanonicalAckConflictEvent: async () => undefined }))

function fixture() {
  const source = { ...utiltsErrGatewayFixture({ company: randomUUID(), transactions: [{ reference: 'OWN-IDE', outcome: 'accepted' }] }),
    id: randomUUID(), canonical_rule_pack_id: randomUUID(), rule_profile_key: 'source',
    rule_profile_version_id: randomUUID(), rule_profile_version: '25-A-4:r4', rule_pack_checksum: 'a'.repeat(64),
  } as EdielMessageRow
  const actor=randomUUID();state.actors.set(actor,source.company_id!);state.sources.set(source.id,source)
  const draft = buildAperakDraft({ actorUserId:actor,sourceMessage: source, outcome: 'positive', ackScope: 'transaction', relatedTransactionReference: 'OWN-IDE' })
  return { source, draft, actor,create: () => createCanonicalAckMessage({ actorUserId:actor,sourceMessage: source, ackFamily: 'APERAK', outcome: 'positive', draft }) }
}
beforeEach(() => { state.rpc.mockReset(); state.create.mockReset(); state.create.mockResolvedValue({ id: 'created' });state.sources.clear();state.actors.clear();state.protectedCalls=[] })

describe('positive UTILTS ACK durable authority gateway', () => {
  it('refuses a syntactically accepted manual positive ACK when no committed storage authority exists', async () => {
    const f = fixture()
    state.rpc.mockResolvedValue({ data: null, error: { message: 'utilts_positive_ack_storage_unavailable' } })
    await expect(f.create()).rejects.toThrow('utilts_positive_ack_storage_unavailable')
    expect(state.create).not.toHaveBeenCalled()
  })
})

function authority(f: ReturnType<typeof fixture>, ack?: EdielMessageRow) {
  return { data: { authorityVersion: 1, companyId: f.source.company_id, environment: f.source.environment,
    sourceMessageId: f.source.id, transactionId: 'OWN-IDE', sourceRawHash: createHash('sha256').update(f.source.raw_payload!).digest('hex'),
    ackMessageId: ack?.id ?? null, ackRawHash: ack ? createHash('sha256').update(ack.raw_payload!).digest('hex') : null }, error: null }
}
function outbound(f: ReturnType<typeof fixture>): EdielMessageRow {
  return { id: randomUUID(), direction: 'outbound', message_family: 'APERAK', message_code: '312',
    environment: f.source.environment, company_id: f.source.company_id, related_message_id: f.source.id,
    raw_payload: f.draft.rawPayload } as EdielMessageRow
}
it('creates from committed storage while ACK finalization is still pending', async () => {
  const f = fixture(); state.rpc.mockResolvedValue(authority(f))
  await expect(f.create()).resolves.toMatchObject({id:'created',company_id:f.source.company_id,related_message_id:f.source.id,raw_payload:f.draft.rawPayload,ack_outcome:'positive'})
  expect(state.rpc.mock.calls).toHaveLength(1)
  expect(state.rpc.mock.calls[0][0]).toBe('gridex_require_utilts_positive_ack_authority_v1')
  expect(state.rpc.mock.calls[0][1]).toMatchObject({p_company_id:f.source.company_id,p_environment:'test',p_source_message_id:f.source.id,p_transaction_id:'OWN-IDE',p_ack_message_id:null})
  expect(state.protectedCalls.filter(name=>name!=='ediel_read_outbound_ack_replay_v1')).toEqual(['gridex_actor_has_company_permission','ediel_require_source_bytes_available_v1','ediel_read_source_rule_pack_basis_v1','gridex_require_utilts_positive_ack_authority_v1','ediel_create_outbound_ack_atomic_v1'])
  expect(state.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({companyId:f.source.company_id,canonicalRulePackId:f.source.canonical_rule_pack_id,relatedMessageId:f.source.id}))
})
it('holds transmission when accepted storage has no final binding to this ACK', async () => {
  const f = fixture(), ack = outbound(f)
  state.rpc.mockResolvedValue({ data: null, error: { message: 'utilts_positive_ack_storage_unavailable' } })
  await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).rejects.toThrow('utilts_positive_ack_storage_unavailable')
})
it('requires the saved exact ACK, source and wire scope on transmission', async () => {
  const f = fixture(), ack = outbound(f); state.rpc.mockResolvedValue(authority(f, ack))
  await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).resolves.toBeUndefined()
  expect(state.rpc.mock.calls[0][1]).toMatchObject({ p_company_id: f.source.company_id, p_source_message_id: f.source.id,
    p_transaction_id: 'OWN-IDE', p_ack_message_id: ack.id, p_ack_raw_payload: ack.raw_payload })
})
it('refuses a stale caller source or forged authority projection', async () => {
  const f = fixture(); const result = authority(f); result.data.sourceRawHash = '0'.repeat(64); state.rpc.mockResolvedValue(result)
  await expect(f.create()).rejects.toThrow('utilts_positive_ack_storage_unavailable')
  expect(state.create).not.toHaveBeenCalled()
})
it('refuses a forged cross-tenant ACK draft before any persistence query', async () => {
  const f = fixture(); f.draft.companyId = randomUUID()
  await expect(f.create()).rejects.toThrow('canonical_ack_source_scope_mismatch')
  expect(state.protectedCalls).toEqual([]);expect(state.rpc).not.toHaveBeenCalled(); expect(state.create).not.toHaveBeenCalled()
})
it('refuses missing or duplicate positive ACW rather than substituting BGM identity', async () => {
  const f = fixture(), ack = outbound(f); ack.raw_payload = ack.raw_payload!.replace("RFF+ACW:OWN-IDE'", '')
  await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).rejects.toThrow('utilts_positive_ack_storage_unavailable')
  ack.raw_payload = f.draft.rawPayload!.replace("RFF+ACW:OWN-IDE'", "RFF+ACW:OWN-IDE'RFF+ACW:OWN-IDE'")
  await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).rejects.toThrow('utilts_positive_ack_storage_unavailable')
  expect(state.rpc).not.toHaveBeenCalled()
})
it('preserves negative UTILTS APERAK and technical ACK routes without a positive storage grant', async () => {
  const f = fixture(), ack = outbound(f); ack.raw_payload = ack.raw_payload!.replace('BGM+312+', 'BGM+313+')
  await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).resolves.toBeUndefined()
  await expect(assertUtiltsPositiveAckAuthorityForSend({ ...ack, message_family: 'CONTRL', raw_payload: "UNH+1+CONTRL:D:96A:UN'E" } as EdielMessageRow)).resolves.toBeUndefined()
  expect(state.rpc).not.toHaveBeenCalled()
})

it.each(['APERAK:D:96A:UN:E5SE5A', 'APERAK:D:04A:UN:E2SE6A', 'APERAK:D:04A:UN', 'PRODAT:D:04A:UN:E5SE5A'])(
  'holds a physical positive BGM312 with malformed/mismatched profile %s', async profile => {
    const f = fixture(), ack = outbound(f); ack.raw_payload = ack.raw_payload!.replace('APERAK:D:04A:UN:E5SE5A', profile)
    await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).rejects.toThrow('utilts_positive_ack_storage_unavailable')
    expect(state.rpc).not.toHaveBeenCalled()
  })
it('checks every physical ACW in a multi-group positive ACK before allowing transmission', async () => {
  const f = fixture(), ack = outbound(f); ack.raw_payload = ack.raw_payload!.replace("RFF+ACW:OWN-IDE'", "RFF+ACW:OWN-IDE'RFF+DM:DOCUMENT'RFF+ACW:OTHER-IDE'")
  state.rpc.mockImplementation(async (_name, args) => {
    const result = authority(f, ack); result.data.transactionId = args.p_transaction_id; return result
  })
  await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).resolves.toBeUndefined()
  expect(state.rpc.mock.calls.map(call => call[1].p_transaction_id)).toEqual(['OWN-IDE', 'OTHER-IDE'])
  state.rpc.mockReset(); state.rpc.mockImplementation(async (_name, args) => args.p_transaction_id === 'OWN-IDE'
    ? authority(f, ack) : { data: null, error: { message: 'utilts_positive_ack_storage_unavailable' } })
  await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).rejects.toThrow('utilts_positive_ack_storage_unavailable')
})

it('refuses a revoked current tenant actor before reading storage authority or persisting',async()=>{
  const f=fixture();state.actors.delete(f.actor);state.rpc.mockResolvedValue(authority(f))
  await expect(f.create()).rejects.toThrow('ediel_tenant_actor_forbidden')
  expect(state.protectedCalls.filter(name=>name!=='ediel_read_outbound_ack_replay_v1')).toEqual(['gridex_actor_has_company_permission'])
  expect(state.rpc).not.toHaveBeenCalled();expect(state.create).not.toHaveBeenCalled()
})
