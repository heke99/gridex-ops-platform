// Real public kernel, parser, national field validator and canonical policy.
// Only tenant database actor/authorization and persistence ports are declared
// unit boundaries. No native custody, independent inventory or market proof.
import {beforeEach,expect,it,vi} from 'vitest'
import type {CreateEdielMessageInput} from '@/lib/ediel/types'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {characteristic,line,qty,type Parts} from './fixtures/prodat-register'
import {bilateralCustomerNativeWire} from '../scripts/helpers/ediel-bilateral-customer-native-wire'

const io=vi.hoisted(()=>({actor:vi.fn(),authorize:vi.fn(),rpc:vi.fn(),from:vi.fn(),witness:vi.fn(),persist:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:io.from}}))
vi.mock('@/lib/ediel/core/actorRegistry',()=>({resolveCanonicalActorContext:io.actor}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.authorize}))
vi.mock('@/lib/ediel/core/outboundOwnerWitness',()=>({prepareEdielOutboundOwnerWitness:io.witness}))
vi.mock('@/lib/ediel/core/kernelLegacy',()=>({createCanonicalOutboundMessage:io.persist,
 resolveCanonicalOutboundContext:vi.fn(),resolveCanonicalInboundActor:vi.fn(),resolveOutboundMessageVersion:vi.fn(),
 resolveInboundAcceptedVersions:vi.fn(),registerInboundCanonicalMessage:vi.fn(),buildCanonicalReferencesForOutbound:vi.fn()}))
import {createCanonicalOutboundMessage} from '@/lib/ediel/core/kernel'
import {validateRulebookMessageWithRegistry} from '@/lib/ediel/rulebook/validator'

const company='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002'
const point='735123456789012344',sender='54321',receiver='12345'
function draft(code:string,reason:string,omitStart=false):CreateEdielMessageInput{
 const body:Parts[]=[['NAD','FR',[sender,'160','SVK'],'','','','','','','SE'],['NAD','DO',[receiver,'160','SVK'],'','','','','','','SE'],
  line('1',point,undefined,'9'),...(omitStart?[]:[['DTM',['92','202610150000','203']]] as Parts[]),
  ['DTM',['354','15','806']],qty('1000'),...characteristic('Z13',reason),...characteristic('Z04','Z04'),
  ...characteristic('Z07','Z12'),...characteristic('Z12','D',3),...characteristic('Z15','Z32'),
  ...characteristic('Z14',reason==='Z70'?'L641Q':'L639Q',3),...characteristic('Z02','1',3),
  ...characteristic('Z05','6',3),...characteristic('Z16','111',3),
  ['RFF',['MG','METER-A']],['RFF',['Z05','TES']],['RFF',['LI','OWN-A']],
  ...(reason==='Z70'?[['RFF',['Z07','735123456789012351']]] as Parts[]:[]),
  ['NAD','UD',['199001011234','SE2','260'],'','Synthetic Customer','Street','City','','12345','SE'],
  ['NAD','IT',[point,'','9'],'','','Street','City','','12345','SE'],['NAD','Z02',['99876','160','SVK']]]
 const rawPayload=guideOrderedFixtureRaw(body,code).replace('+S+R+',`+${sender}:14+${receiver}:14+`)
  .replace("+23-DDQ-PRODAT'","+23-DDQ-PRODAT++1++1'")
 return {actorUserId:actor,companyId:company,environment:'test',direction:'outbound',messageStandard:'edifact',
  messageFamily:'PRODAT',messageCode:code,messageVersion:'E2SE6A',applicationReference:'23-DDQ-PRODAT',
  senderEdielId:sender,receiverEdielId:receiver,rawPayload}
}
function validate(input:CreateEdielMessageInput){
 return validateRulebookMessageWithRegistry({family:input.messageFamily,code:String(input.messageCode),
  rawPayload:input.rawPayload,version:input.messageVersion,applicationReference:input.applicationReference,
  direction:'outbound',mode:'send',environment:'test',companyId:company})
}
function noOriginal(){
 expect(io.authorize).toHaveBeenCalledOnce()
 expect(io.actor).toHaveBeenCalledOnce()
 expect(io.witness).not.toHaveBeenCalled()
 expect(io.persist).not.toHaveBeenCalled()
 expect(io.from).not.toHaveBeenCalled()
 expect(io.rpc).not.toHaveBeenCalled()
}
async function refusal(input:CreateEdielMessageInput){
 let failure:unknown
 try{await createCanonicalOutboundMessage({actorUserId:actor,requestType:'supplier_switch',baseInput:input})}
 catch(error){failure=error}
 noOriginal()
 expect(failure).toBeInstanceOf(Error)
 return (failure as Error).message
}
beforeEach(()=>{
 vi.resetAllMocks()
 io.authorize.mockResolvedValue(undefined)
 io.actor.mockResolvedValue({actor:{id:actor},actorRole:'supplier',senderEdielId:sender,
  legalActorEdielId:sender,transportActorEdielId:sender,marketRoles:['electricity_supplier']})
 io.rpc.mockImplementation(()=>{throw Error('unexpected unit database RPC')})
 io.from.mockImplementation(()=>{throw Error('unexpected unit database table access')})
})

it.each([['A','Z26'],['D','Z70']])('public outbound %s refuses its canonical direction before missing independent inventory',async(subtype,reason)=>{
 const input=draft('Z04',reason),result=await validate(input)
 expect(result.canonicalPolicy).toMatchObject({family:'PRODAT',code:'Z04',subtype,semantics:{direction:'inbound'}})
 expect(result.issues).toContainEqual(expect.objectContaining({code:'PRODAT_REGISTER_EVIDENCE_UNDETERMINED',fieldPath:'LIN/C829/1082'}))
 expect(result.issues.find(issue=>issue.blocking||issue.severity==='error')?.code).toBe('PRODAT_REGISTER_EVIDENCE_UNDETERMINED')
 expect(await refusal(input)).toBe('canonical_source_direction_not_allowed:Z04:outbound:inbound')
})

it('allowed outbound Z03L still refuses missing national start210 before any original',async()=>{
 const input=draft('Z03','Z22',true),result=await validate(input)
 expect(result.canonicalPolicy).toMatchObject({family:'PRODAT',code:'Z03',subtype:'L',semantics:{direction:'outbound'}})
 const missing=result.issues.find(issue=>issue.prodatDiagnostic?.kind==='field'&&issue.prodatDiagnostic.fieldNumber==='210')
 expect(missing).toMatchObject({blocking:true})
 expect(result.issues.find(issue=>issue.blocking||issue.severity==='error')?.prodatDiagnostic).toMatchObject({kind:'field',fieldNumber:'210'})
 expect(await refusal(input)).toContain('FIELD_MATRIX_REQUIRED_FIELD_MISSING')
})

it('an unknown physical reason still has no canonical policy and cannot mint an original',async()=>{
 const input=draft('Z04','Z99'),result=await validate(input)
 expect(result.canonicalPolicy).toBeUndefined()
 expect(result.blocking).toBe(true)
 expect(result.issues).toContainEqual(expect.objectContaining({code:'CANONICAL_POLICY_VALIDATION_FAILED',description:expect.stringContaining('prodat_subtype_unknown')}))
 expect(await refusal(input)).toContain('PRODAT_TRANSACTION_REASON_INVALID')
})

it('unqualified outbound Z06E retains its real first field diagnostic before any original',async()=>{
 const input=draft('Z06','E34')
 input.rawPayload=bilateralCustomerNativeWire({sender,receiver,point,customerIdentity:'199001011234',reference:'OWN-E',
  marketMinute:'202610190000',repeatRegister:true,invoicee:true})
 const result=await validate(input)
 expect(result.canonicalPolicy).toMatchObject({family:'PRODAT',code:'Z06',subtype:'E',semantics:{direction:'inbound'}})
 expect(result.issues).toContainEqual(expect.objectContaining({code:'PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED'}))
 const first=result.issues.find(issue=>issue.blocking||issue.severity==='error')
 expect(first).toMatchObject({code:'PRODAT_REGISTER_EVIDENCE_UNDETERMINED'})
 expect(await refusal(input)).toContain(`${first!.code} - ${first!.description}`)
})
