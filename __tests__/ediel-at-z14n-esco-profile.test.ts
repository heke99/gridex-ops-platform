// masterplan: AT-Z14N-ESCO
// Independent handwritten national fixtures complement the genuine source,
// physical ACK and durable-effects proof in the N native suite.
import {beforeEach,expect,it,vi} from 'vitest'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {applyPermissionMarketSource} from '@/lib/ediel/permissions/permissionMarketTransition'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact,segmentComposite,segmentElementCount} from '@/lib/ediel/core/edifactTokenizer'
import {omitPermissionField} from '../scripts/helpers/ediel-permission-field-omissions'
import {alphabets,msg} from './fixtures/prodat-prior-flow'

const io=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:io}))
beforeEach(()=>{
 vi.clearAllMocks()
 io.rpc.mockImplementation(()=>{throw Error('UNEXPECTED_PERMISSION_WRITE')})
 io.from.mockImplementation(()=>{throw Error('NO_LIVE_DATABASE')})
})
const required=['311','312','202','203','313','205','206','207','208','314','223','322','226'] as const
const statuses=['A13','A76'] as const
function negative(status:typeof statuses[number],alphabet:readonly string[]=alphabets[0]){
 const source=msg('Z14','Z96','N-CASE',undefined,alphabet)
 source.raw_payload=source.raw_payload!.replace(alphabet[1]+'A76'+alphabet[3],alphabet[1]+status+alphabet[3])
 return source
}

for(const status of statuses)for(const alphabet of alphabets)it(`independent ${status} N wire admits identityless denial without positive-Z14 data (${alphabet.join('')})`,()=>{
 const source=negative(status,alphabet),wire=tokenizeEdifact(source.raw_payload!),decision=resolveCanonicalRuntimeDecision(source)
 expect(EdifactEnvelopeCodec.decode(source.raw_payload!)).toMatchObject({sender:'12345',receiver:'54321',applicationReference:'23-DGI-PRODAT'})
 expect([decision.syntaxDecision,decision.applicationDecision]).toEqual(['accepted','accepted'])
 expect(decision.policy).toMatchObject({code:'Z14',subtype:'N',transactionReasonCode:'Z96',direction:'inbound',applicationReference:'23-DGI-PRODAT'})
 const line=wire.segments.find(s=>s.tag==='LIN')!
 expect(segmentElementCount(line,wire.una)).toBe(1)
 expect(segmentComposite(line,3,wire.una)).toEqual([''])
 expect(wire.segments.some(s=>s.tag==='NAD'&&['UD','IT'].includes(segmentComposite(s,1,wire.una)[0]))).toBe(false)
 expect(wire.segments.some(s=>s.tag==='RFF'&&['Z05','Z09'].includes(segmentComposite(s,1,wire.una)[0]))).toBe(false)
 expect(wire.segments.some(s=>s.tag==='CAV'&&segmentComposite(s,1,wire.una)[0]===status)).toBe(true)
 expect(io.rpc).not.toHaveBeenCalled();expect(io.from).not.toHaveBeenCalled()
})

for(const status of statuses)for(const field of required)it(`${status} N required ${field} omission reaches its canonical barrier without positive business ACK`,()=>{
 const source=negative(status),control=resolveCanonicalRuntimeDecision(source)
 expect([control.syntaxDecision,control.applicationDecision]).toEqual(['accepted','accepted'])
 source.raw_payload=omitPermissionField(source.raw_payload!,field)
 const decision=resolveCanonicalRuntimeDecision(source)
 if(['207','208'].includes(field)){
  expect(decision.syntaxDecision).toBe('rejected')
  expect(decision.applicationDecision).toBe('not_applicable')
  expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'UNSM_MANDATORY_ELEMENT_MISSING'})]))
 }else if(field==='311'){
  expect(decision.applicationDecision).toBe('manual_review')
  expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'CANONICAL_POLICY_RESOLUTION_FAILED'})]))
 }else{
  expect(decision.applicationDecision).toBe('rejected')
  expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({prodatDiagnostic:expect.objectContaining({fieldNumber:field,errorKind:'missing'})})]))
 }
 expect(decision.responsePlan.some(plan=>plan.family==='APERAK'&&plan.outcome==='positive')).toBe(false)
 expect(io.rpc).not.toHaveBeenCalled();expect(io.from).not.toHaveBeenCalled()
})

it('the actual permission adapter refuses an outbound N before any native write',async()=>{
 expect(await applyPermissionMarketSource({actorUserId:'00000000-0000-4000-8000-000000000011',message:{...negative('A13'),direction:'outbound'}})).toMatchObject({applied:false,reason:'not_inbound_permission_source'})
 expect(io.rpc).not.toHaveBeenCalled();expect(io.from).not.toHaveBeenCalled()
})
