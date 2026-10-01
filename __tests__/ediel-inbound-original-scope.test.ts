// Declared in-memory database/auth ports prove consumer isolation and replay;
// they do not qualify native persistence or authentic market evidence.
import {beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rows:[] as Record<string,unknown>[],forced:null as Record<string,unknown>[]|null,
  queries:[] as [string,unknown][][],create:vi.fn(),event:vi.fn(),actor:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>{
  const filters:[string,unknown][]=[];io.queries.push(filters)
  const q={select:()=>q,eq:(key:string,value:unknown)=>{filters.push([key,value]);return q},
    is:(key:string,value:unknown)=>{filters.push([key,value]);return q},
    limit:async(n:number)=>({data:(io.forced??io.rows.filter(row=>filters.every(([key,value])=>(row[key]??null)===value))).slice(0,n),error:null})}
  return q
}}}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessage:io.create,createCanonicalDuplicateBlockEvent:io.event,
  createCanonicalAckConflictEvent:vi.fn(),findSequencedAckForSource:vi.fn(),listAckMessagesForSource:vi.fn()}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
vi.mock('@/lib/ediel/rulebook/validator',()=>({validateRulebookMessageWithRegistry:vi.fn()}))
vi.mock('@/lib/ediel/core/actorRegistry',()=>({resolveCanonicalActorContext:vi.fn()}))
vi.mock('@/lib/ediel/core/routeRegistry',()=>({resolveCanonicalRouteContext:vi.fn()}))
vi.mock('@/lib/ediel/core/versionRegistry',()=>({resolveCanonicalInboundAcceptedVersions:vi.fn(),resolveCanonicalOutboundVersion:vi.fn()}))
vi.mock('@/lib/ediel/aiBiInboundReconciliation',()=>({prepareAiBiInboundReconciliation:vi.fn(),processAiBiInboundReconciliation:vi.fn()}))
import {buildInboundCanonicalIdentity,findInboundDuplicateByCanonicalIdentity} from '@/lib/ediel/core/dedupe'
import {registerInboundCanonicalMessage} from '@/lib/ediel/core/kernelLegacy'
import type {CreateEdielMessageInput} from '@/lib/ediel/types'
const input:CreateEdielMessageInput={companyId:'company',environment:'test',direction:'inbound',messageStandard:'edifact',
  messageFamily:'UTILTS',messageCode:'E66',receiverEdielId:'LOCAL',senderEdielId:'REMOTE',applicationReference:'APP',
  interchangeReference:'SAME-UNB',rawPayload:"UNB+UNOC:3+REMOTE:ZZ+LOCAL:ZZ+260930:1200+SAME-UNB++APP+++1'"}
const row=(patch:Record<string,unknown>={})=>({id:'own-source',company_id:'company',environment:'test',direction:'inbound',
  message_standard:'edifact',message_family:'UTILTS',message_code:'E66',receiver_ediel_id:'LOCAL',sender_ediel_id:'REMOTE',
  application_reference:'APP',interchange_reference:'SAME-UNB',raw_payload:input.rawPayload,...patch})
beforeEach(()=>{vi.clearAllMocks();io.rows=[];io.forced=null;io.queries=[];io.actor.mockResolvedValue(undefined);
  io.create.mockResolvedValue(row({id:'new-source'}));io.event.mockResolvedValue(undefined)})
describe('inbound actual original duplicate scope',()=>{
  it('does not choose another tenant, environment, receiver or application by shared sender/UNB',async()=>{
    io.rows=[row({company_id:'foreign'}),row({environment:'production'}),row({receiver_ediel_id:'OTHER'}),row({application_reference:'OTHER'})]
    expect(await findInboundDuplicateByCanonicalIdentity(buildInboundCanonicalIdentity(input))).toBeNull()
    expect(io.queries.every(filters=>filters.some(([key,value])=>key==='company_id'&&value==='company'))).toBe(true)
    expect(io.queries.every(filters=>filters.some(([key,value])=>key==='environment'&&value==='test'))).toBe(true)
  })
  it('replays the same own whole original after current actor authorization',async()=>{
    io.rows=[row()]
    expect(await registerInboundCanonicalMessage({actorUserId:'actor',input})).toEqual(row())
    expect(io.actor).toHaveBeenCalledWith({companyId:'company',actorUserId:'actor',permission:'communication.write'})
    expect(io.create).not.toHaveBeenCalled();expect(io.event).toHaveBeenCalledOnce()
  })
  it('rejects altered original bytes and an inconsistent upstream scope before any write or event',async()=>{
    for(const patch of [{raw_payload:input.rawPayload+'changed'},{company_id:'foreign'},{environment:'production'},
      {direction:'outbound'},{message_family:'APERAK'},{message_code:'E73'}]){
      io.forced=[row(patch)]
      await expect(registerInboundCanonicalMessage({actorUserId:'actor',input})).rejects.toThrow('canonical_inbound_duplicate_scope_or_original_conflict')
    }
    expect(io.create).not.toHaveBeenCalled();expect(io.event).not.toHaveBeenCalled()
  })
  it('holds ambiguous own originals rather than selecting the newest row',async()=>{
    io.rows=[row(),row({id:'second'})]
    await expect(findInboundDuplicateByCanonicalIdentity(buildInboundCanonicalIdentity(input))).rejects.toThrow('ediel_inbound_duplicate_identity_ambiguous')
  })
  it('cannot use global sender/UNB fallback for an unattributed source or an unknown environment',async()=>{
    io.rows=[row({company_id:null})]
    expect(await findInboundDuplicateByCanonicalIdentity(buildInboundCanonicalIdentity({...input,companyId:null}))).toBeNull()
    expect(io.queries).toHaveLength(0)
    await expect(findInboundDuplicateByCanonicalIdentity(buildInboundCanonicalIdentity({...input,environment:null}))).rejects.toThrow('ediel_inbound_duplicate_scope_required')
  })
  it('stores distinct inbound responses instead of coalescing them by ACK family/source alone',async()=>{
    await registerInboundCanonicalMessage({actorUserId:'actor',input:{...input,messageFamily:'UTILTS_ERR',messageCode:'ERR',relatedMessageId:'same-outbound-source'}})
    expect(io.create).toHaveBeenCalledOnce();expect(io.event).not.toHaveBeenCalled()
  })
})
