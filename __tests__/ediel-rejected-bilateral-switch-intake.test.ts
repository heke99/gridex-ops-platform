// masterplan: AT-Z03H-SUPPLIER, AT-Z04H-SUPPLIER
// Component-only first-reception proof. External catalog/DB ports are declared
// finite IO; native SQL/private negative ACK and whole H require separate proof.
import {beforeEach,expect,it,vi} from 'vitest'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {parseInboundEmailContent} from '@/lib/inbound-mail/edielEmailParser'
import {resolveBilateralSwitchBirthProfile} from '@/lib/inbound-mail/bilateralSwitchBirthProfile'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {ownerRulePack} from './helpers/sourceOwnerFixtures'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {line,characteristic} from './fixtures/prodat-register'
import {company,actor,mailId,parseId,newId,receivedAt,inboundReceptionBoundary} from './fixtures/inbound-reception-db'

const io=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from,rpc:io.rpc}}))
const point='735999000000001',key='PRODAT:Z04:H:26.A:r3'
const witnessColumns=['canonical_rule_pack_id','rule_profile_key','rule_profile_version_id','rule_profile_version','rule_pack_checksum','rule_pack_snapshot']
const payload=()=>guideOrderedFixtureRaw([line('1',point,'1','9'),...characteristic('Z13','Z25'),['RFF',['LI','OWN']],line('2',point,'','9')],'Z04')
function registry(){
 const row=ownerRulePack();Object.assign(row,{profile_key:key,profile:{...row.profile,transactionSubtype:'H',reasonForTransaction:'Z25'}})
 Object.assign(row.original_snapshot.messageProfile,{profile_key:key,profile:row.profile});return row
}
function parse(rawPayload:string){const p=parseInboundEmailContent({attachmentText:rawPayload});if(!p)throw Error('actual_parser_required');return p}
let db:ReturnType<typeof inboundReceptionBoundary>
function setup(rawPayload:string){
 db=inboundReceptionBoundary(parse(rawPayload));db.state.existing=false
 io.from.mockImplementation((table:string)=>{
  const q=db.from(table)
  if(table==='ediel_messages'){
   const insert=q.insert
   q.insert=(row:Record<string,unknown>)=>{
    // Declared model of the existing SQL trigger's code-only catalog ambiguity.
    // This is not a claim of executing PostgreSQL or admitting business facts.
    db.state.error=witnessColumns.every(k=>row[k]!==undefined)?null:{code:'23514',message:'canonical_rule_pack_evidence_count:6:PRODAT:Z04'}
    return insert(row)
   }
  }
  return q
 })
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='resolve_canonical_ediel_rule_pack_with_witness_v1'?{data:[registry()],error:null}:db.rpc(name,args))
}
const input=(rawPayload:string)=>({companyId:company,actorUserId:actor,environment:'test',inboundEmailMessageId:mailId,parseResultId:parseId,parsed:parse(rawPayload)})
beforeEach(()=>{vi.clearAllMocks();setup(payload())})
it('binds a recognizable rejected second258 source before its first INSERT without validating the register chain',async()=>{
 const rawPayload=payload(), t=tokenizeEdifact(rawPayload),grouping=prodatRegisterGroups(t.segments,t.una,'Z04')
 expect(grouping.problems.map(p=>[p.fieldNumber,p.lineIndex,p.reason])).toEqual([
  ['258',1,'invalid_C829_indicator_or_index'],['258',1,'per_object_register_sequence_invalid'],
 ])
 expect(grouping.groups.map(g=>[g.validRegisterChain,g.firstLineIndex])).toEqual([[false,null],[false,null]])
 expect(await resolveBilateralSwitchBirthProfile({rawPayload,receivedAt})).toBeNull()
 expect(await createInboundEdielMessage(input(rawPayload))).toBe(newId)
 const writes=db.writes('ediel_messages');expect(writes).toHaveLength(1)
 expect(writes[0].payload).toMatchObject({raw_payload:rawPayload,message_received_at:receivedAt,
  canonical_rule_pack_id:'00000000-0000-4000-8000-000000000012',rule_profile_key:key,
  rule_profile_version_id:'00000000-0000-4000-8000-000000000011',rule_profile_version:'26.A:r3',rule_pack_checksum:'a'.repeat(64),
  rule_pack_snapshot:{...registry().original_snapshot,profileKey:key,profileVersionId:'00000000-0000-4000-8000-000000000011',version:'26.A:r3',checksum:'a'.repeat(64)}})
 for(const k of ['execution_context_snapshot','bilateral_capability_verified','business_effect_authorized'])expect(writes[0].payload).not.toHaveProperty(k)
 expect(db.state.rpcCalls.map(c=>c.name)).toEqual(['gridex_actor_has_company_permission','ediel_record_inbound_reception_v1'])
 expect(db.writes('outbound_requests')).toEqual([])
})
