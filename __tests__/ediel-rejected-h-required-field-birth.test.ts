import {beforeEach,expect,it,vi} from 'vitest'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {company,actor,mailId,parseId,newId,inboundReceptionBoundary} from '@/__tests__/fixtures/inbound-reception-db'
import {resolveBilateralSwitchBirthProfile} from '@/lib/inbound-mail/bilateralSwitchBirthProfile'
import {resolveRejectedZ04HRequiredFieldBirthProfile} from '@/lib/inbound-mail/rejectedZ04HRequiredFieldBirthProfile'
import {parseEdifactPayload,parseInboundEmailContent} from '@/lib/inbound-mail/edielEmailParser'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatRegisterFieldState} from '@/lib/ediel/prodat/prodatRegisterFields'
import {ownerRulePack} from '@/__tests__/helpers/sourceOwnerFixtures'
import {guideOrderedFixtureRaw} from '@/__tests__/helpers/prodatGuideOrderedFixture'
import {line,characteristic,validate} from '@/__tests__/fixtures/prodat-register'
const io=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from,rpc:io.rpc}}))
const point='735999000000001',receivedAt='2026-10-09T07:00:00Z'
function registry(){const r=ownerRulePack();Object.assign(r,{profile_key:'PRODAT:Z04:H:26.A:r3',profile:{...r.profile,transactionSubtype:'H',reasonForTransaction:'Z25'}});Object.assign(r.original_snapshot.messageProfile,{profile_key:r.profile_key,profile:r.profile});return r}
const payload=(field?:string)=>guideOrderedFixtureRaw([
 line(field==='314'?'':'1',field==='209'?'':point,undefined,'9'),
 ...characteristic('Z13','Z25'),['RFF',['LI','OWN']],['NAD','UD',['5561234567','SE1','260'],'','Synthetic Customer','Street','Town','','12345','SE']
],'Z04')
beforeEach(()=>{io.from.mockReset();io.rpc.mockReset();io.rpc.mockImplementation(async(name:string)=>{
 if(name!=='resolve_canonical_ediel_rule_pack_with_witness_v1')throw Error('undeclared_catalog_io:'+name)
 return {data:[registry()],error:null}
})})
it('actual positive selector establishes the same real catalog baseline',async()=>{
 expect(await resolveBilateralSwitchBirthProfile({rawPayload:payload(),receivedAt})).toMatchObject({rule_profile_key:'PRODAT:Z04:H:26.A:r3'})
})
it.each(['314','209'])('preserves actual missing%s diagnostic before the positive selector refuses malformed birth',async field=>{
 const rawPayload=payload(field),t=tokenizeEdifact(rawPayload),g=prodatRegisterGroups(t.segments,t.una,'Z04')
 expect(g.groups).toHaveLength(1)
 expect(prodatRegisterFieldState(field,g.groups[0].segments,t.una)).toMatchObject(field==='314'
  ?{present:false,value:null,malformed:false}:{present:true,value:null,malformed:true})
 expect(g.groups[0].itemId).toBe(field==='209'?null:point)
 expect(parseEdifactPayload(rawPayload)).toMatchObject({messageFamily:'PRODAT',messageCode:'Z04',applicationReference:'23-DDQ-PRODAT',rawPayload})
 expect(validate(rawPayload,[field]).some(i=>i.blocking&&i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber===field)).toBe(true)
 expect(await resolveBilateralSwitchBirthProfile({rawPayload,receivedAt})).toBeNull()
 expect(io.rpc).not.toHaveBeenCalled()
})
it.each(['314','209'])('binds catalog evidence for the recognizable missing%s original without inventing its field',async field=>{
 const rawPayload=payload(field),before=parseEdifactPayload(rawPayload)
 const witness=await resolveRejectedZ04HRequiredFieldBirthProfile({rawPayload,receivedAt})
 expect(witness).toMatchObject({rule_profile_key:'PRODAT:Z04:H:26.A:r3',canonical_rule_pack_id:'00000000-0000-4000-8000-000000000012'})
 expect(Object.keys(witness!).sort()).toEqual(['canonical_rule_pack_id','rule_profile_key','rule_profile_version_id','rule_profile_version','rule_pack_checksum','rule_pack_snapshot'].sort())
 expect(parseEdifactPayload(rawPayload)).toEqual(before)
 expect(validate(rawPayload,[field]).some(i=>i.blocking&&i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber===field)).toBe(true)
})
it.each([
 ['healthy single register',()=>payload()],
 ['missing both fields',()=>payload('314').replace(point,'')],
 ['different first sequence',()=>payload('209').replace('LIN+1++','LIN+2++')],
 ['padded sequence',()=>payload('209').replace('LIN+1++','LIN+ 1 ++')],
 ['different identity agency',()=>payload('209').replace(':::9',':::XX')],
 ['extra identity component',()=>payload('209').replace(':::9',':::9:EXTRA')],
 ['forbidden identity component',()=>payload('209').replace(':::9',':BAD::9')],
 ['register metadata on null identity',()=>payload('209').replace(":::9'",":::9+1:1'")],
 ['positive reason L',()=>payload('314').replace('CAV+Z25','CAV+Z22')],
 ['missing reason',()=>payload('314').replace("CCI++Z13'CAV+Z25'",'')],
 ['missing application',()=>payload('314').replace('23-DDQ-PRODAT','')],
 ['missing code',()=>payload('314').replace('BGM+Z04','BGM+')],
 ['wrong code',()=>payload('314').replace('BGM+Z04','BGM+Z05')],
 ['invalid envelope',()=>payload('314').replace(/UNT\+\d+\+M/,'UNT+999+M')],
] as const)('does not invent negative H catalog authority for %s',async(_name,make)=>{
 expect(await resolveRejectedZ04HRequiredFieldBirthProfile({rawPayload:make(),receivedAt})).toBeNull()
 expect(io.rpc).not.toHaveBeenCalled()
})

// Component-only actual public creator; the external SDK boundary models the
// six-column binder and first reception. This does not execute PostgreSQL.
it.each(['314','209'])('creates the recognizable missing%s original through the first public intake without business authority',async field=>{
 const rawPayload=payload(field),parsed=parseInboundEmailContent({attachmentText:rawPayload})
 if(!parsed)throw Error('actual_parser_required')
 const db=inboundReceptionBoundary(parsed);db.state.existing=false
 const columns=['canonical_rule_pack_id','rule_profile_key','rule_profile_version_id','rule_profile_version','rule_pack_checksum','rule_pack_snapshot']
 io.from.mockImplementation((table:string)=>{
  const q=db.from(table)
  if(table==='ediel_messages'){const insert=q.insert;q.insert=(row:Record<string,unknown>)=>{
   db.state.error=columns.every(key=>row[key]!==undefined)?null:{code:'23514',message:'canonical_rule_pack_evidence_count:6:PRODAT:Z04'}
   return insert(row)
  }}
  return q
 })
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='resolve_canonical_ediel_rule_pack_with_witness_v1'
  ?{data:[registry()],error:null}:db.rpc(name,args))
 expect(await createInboundEdielMessage({companyId:company,actorUserId:actor,environment:'test',
  inboundEmailMessageId:mailId,parseResultId:parseId,parsed})).toBe(newId)
 const writes=db.writes('ediel_messages');expect(writes).toHaveLength(1)
 expect(writes[0].payload).toMatchObject({raw_payload:rawPayload,company_id:company,
  inbound_email_message_id:mailId,mailbox_message_id:mailId,message_received_at:db.state.original.message_received_at,
  rule_profile_key:'PRODAT:Z04:H:26.A:r3',metering_point_id:null,processing_status:'manual_review'})
 for(const key of ['execution_context_snapshot','bilateral_capability_verified','business_effect_authorized'])expect(writes[0].payload).not.toHaveProperty(key)
 expect(db.state.rpcCalls.map(call=>call.name)).toEqual(['gridex_actor_has_company_permission','ediel_record_inbound_reception_v1'])
 expect(db.writes('outbound_requests')).toEqual([])
 expect(validate(rawPayload,[field]).some(issue=>issue.blocking&&issue.prodatDiagnostic?.kind==='field'&&issue.prodatDiagnostic.fieldNumber===field)).toBe(true)
})
