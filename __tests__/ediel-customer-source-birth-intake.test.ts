// Real parser/intake and declared catalog/database ports. This finite test
// proves prospective caller chronology; native proves physical admission.
import {beforeEach,expect,it,vi} from 'vitest'
import {parseInboundEmailContent} from '@/lib/inbound-mail/edielEmailParser'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {characteristic,line} from './fixtures/prodat-register'
import {company,actor,mailId,parseId,oldId,newId,receivedAt,inboundReceptionBoundary} from './fixtures/inbound-reception-db'

const io=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),catalog:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from,rpc:io.rpc}}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:io.catalog}))
const raw=guideOrderedFixtureRaw([line('1','735999000000001',undefined,'9'),...characteristic('Z13','E34'),['RFF',['LI','OWN-E']]],'Z06')
const parse=()=>{const p=parseInboundEmailContent({attachmentText:raw});if(!p)throw Error('actual_parser_required');return p}
const evidence={rulePackId:'declared-pack',messageProfileId:'declared-profile',databaseProfileKey:'PRODAT:Z06:E:26.A:r3',profileKey:'semantic-alias',originalVersion:'26.A:r3',sourceHash:'a'.repeat(64),unhAssociationCode:'E2SE6A',originalSnapshot:{rulePack:{id:'declared-pack'},messageProfile:{id:'declared-profile'},guideSources:[]}}
let db:ReturnType<typeof inboundReceptionBoundary>
const input=()=>({companyId:company,actorUserId:actor,environment:'test',inboundEmailMessageId:mailId,parseResultId:parseId,parsed:parse()})
beforeEach(()=>{vi.clearAllMocks();db=inboundReceptionBoundary(parse());io.from.mockImplementation(db.from);io.rpc.mockImplementation(db.rpc);io.catalog.mockReset().mockImplementation(async()=>{expect(db.writes('ediel_messages')).toEqual([]);return evidence})})

it('binds only the returned original witness before first INSERT at the actual retained mail receipt',async()=>{
 db.state.existing=false
 expect(await createInboundEdielMessage(input())).toBe(newId)
 expect(io.catalog).toHaveBeenCalledExactlyOnceWith({family:'PRODAT',messageCode:'Z06',transactionSubtype:'E34',applicationReference:'23-DDQ-PRODAT',direction:'inbound',businessDate:'2026-09-21'})
 const writes=db.writes('ediel_messages');expect(writes).toHaveLength(1)
 expect(writes[0]).toMatchObject({operation:'insert',payload:{raw_payload:raw,message_received_at:receivedAt,canonical_rule_pack_id:evidence.rulePackId,rule_profile_key:evidence.databaseProfileKey,rule_profile_version_id:evidence.messageProfileId,rule_profile_version:evidence.originalVersion,rule_pack_checksum:evidence.sourceHash,rule_pack_snapshot:{...evidence.originalSnapshot,profileKey:evidence.databaseProfileKey,profileVersionId:evidence.messageProfileId,version:evidence.originalVersion,checksum:evidence.sourceHash}}})
 expect(writes[0].payload).not.toHaveProperty('execution_context_snapshot');expect(writes[0].payload).not.toHaveProperty('bilateral_capability_verified')
 expect(db.state.rpcCalls.map(c=>c.name)).toEqual(['gridex_actor_has_company_permission','ediel_record_inbound_reception_v1'])
 expect(db.writes('outbound_requests')).toEqual([])
})

it('does not reselect or patch catalog evidence for an existing immutable original',async()=>{
 const before=structuredClone(db.state.original)
 expect(await createInboundEdielMessage(input())).toBe(oldId)
 expect(io.catalog).not.toHaveBeenCalled();expect(db.writes('ediel_messages')).toEqual([]);expect(db.state.original).toEqual(before)
})

it('propagates actual catalog failure before any source INSERT or reception record',async()=>{
 db.state.existing=false;io.catalog.mockRejectedValue(Error('canonical_rule_pack_evidence_count:0'))
 await expect(createInboundEdielMessage(input())).rejects.toThrow('canonical_rule_pack_evidence_count:0')
 expect(db.writes('ediel_messages')).toEqual([]);expect(db.writes('ediel_message_events')).toEqual([])
 expect(db.state.rpcCalls.map(c=>c.name)).toEqual(['gridex_actor_has_company_permission'])
})
