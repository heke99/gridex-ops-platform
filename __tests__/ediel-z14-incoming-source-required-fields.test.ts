// masterplan: AT-Z14V-ESCO
// Actual canonical and field-matrix consumers; synthetic wire is no admitted
// native permission, original-request authority, durable effect or physical ACK.
import {describe,expect,it} from 'vitest'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {validateFieldMatrixPayload} from '@/lib/ediel/rulebook/fieldMatrix'
import {canonicalProdat26AFieldRules} from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import {permissionAckMessage,permissionAckObject} from './fixtures/prodat-permission-ack'
import {alphabets,characteristic,input,line,raw,type Parts} from './fixtures/prodat-register'

// Independent P26.A r3 §2.2 positive Z14 R cells. Do not derive this oracle
// from the source-subtype map or a caller's dependent-condition flags.
const promoted=['508','326','217','222','513','260','228'] as const
const mapped=['209','302',...promoted,'506','325','227'] as const
type Field=typeof mapped[number]
function positive(reason='S17',sequence='1'){
 return permissionAckObject('Z14',reason,'A74',null,sequence)
}
function omit(body:Parts[],field:Field):Parts[]{
 const dates:Partial<Record<Field,string>>={'302':'90','508':'354','326':'693'}
 const characteristics:Partial<Record<Field,string>>={'217':'Z04','222':'Z12','506':'Z14','513':'Z22'}
 const refs:Partial<Record<Field,string>>={'260':'Z05','325':'Z09'}
 return body.flatMap((part,index)=>{
  if(part[0]==='DTM'&&Array.isArray(part[1])&&part[1][0]===dates[field])return []
  if(part[0]==='RFF'&&Array.isArray(part[1])&&part[1][0]===refs[field])return []
  if(characteristics[field]&&(part[0]==='CCI'&&part[2]===characteristics[field]
   ||part[0]==='CAV'&&body[index-1]?.[0]==='CCI'&&body[index-1]?.[2]===characteristics[field]))return []
  if(field==='209'&&part[0]==='LIN')return [[...part.slice(0,3),['','','','9'],...part.slice(4)]]
  if(part[0]==='NAD'&&part[1]==='UD'){
   if(field==='227')return [part.map((v,i)=>i===2?['','','89']:v)]
   if(field==='228')return [part.map((v,i)=>i===4?'':v)]
  }
  return [part]
 })
}
function message(body:Parts[],alphabet:readonly string[]=alphabets[0]){
 return permissionAckMessage('Z14','S17','A74',null,alphabet,body)
}
function direct(body:Parts[],field:Field,alphabet:readonly string[]=alphabets[0]){
 const wire=input(message(body,alphabet).raw_payload!,'Z14')
 return validateFieldMatrixPayload({...wire,direction:'inbound'},canonicalProdat26AFieldRules('Z14').filter(r=>r.fieldNumber===field))
}
function missing(issues:ReturnType<typeof direct>,field:string){
 return issues.filter(i=>i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber===field&&i.prodatDiagnostic.errorKind==='missing')
}
function negative(sequence='1'){
 // P26.A Z14N carries neither positive object fields nor UD/IT parents.
 return omit(permissionAckObject('Z14','Z96','A76',null,sequence),'506')
}

describe('fresh physical positive Z14 incoming source-required fields',()=>{
 it('admits the unchanged complete wire at the actual canonical consumer',()=>{
  const decision=resolveCanonicalRuntimeDecision(message(positive()))
  expect(decision.syntaxDecision).toBe('accepted')
  expect(decision.applicationDecision).toBe('accepted')
 })
 it.each(promoted)('canonical admission rejects missing own required %s',field=>{
  const complete=positive(),body=omit(complete,field)
  expect(body).not.toEqual(complete)
  const decision=resolveCanonicalRuntimeDecision(message(body))
  expect(decision.syntaxDecision).toBe('accepted')
  expect(decision.issues).toContainEqual(expect.objectContaining({blocking:true,prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:field,errorKind:'missing',occurrence:expect.objectContaining({lineIndex:0,objectId:'735123456789012345',lineItemReference:'CASE:A+B?C'})})}))
  expect(decision.applicationDecision).toBe('rejected')
  expect(decision.responsePlan.some(p=>p.family==='APERAK'&&p.outcome==='positive')).toBe(false)
 })
 it.each(['209','302','506','325','227'] as const)('preserves the actual canonical owner for missing %s',field=>{
  // 506 has its own incoming energy owner; direct matrix coverage below is
  // not evidence that the canonical owner/filter was replaced. Missing party
  // identity may instead be refused by the prior UNSM grammar gate.
  const decision=resolveCanonicalRuntimeDecision(message(omit(positive(),field)))
  expect(decision.applicationDecision).not.toBe('accepted')
  expect(decision.responsePlan.some(p=>p.family==='APERAK'&&p.outcome==='positive')).toBe(false)
 })
})

describe('source requirement is local to the actual incoming Z14 scope',()=>{
 for(const alphabet of alphabets)for(const reason of ['S17','S18']){
  it.each(mapped)(`${reason} requires own %s (${alphabet.join('')})`,field=>{
   const body=positive(reason)
   expect(direct(body,field,alphabet)).toEqual([])
   const issues=direct(omit(body,field),field,alphabet)
   expect(missing(issues,field)).toHaveLength(1)
   expect(missing(issues,field)[0]).toMatchObject({blocking:true,prodatDiagnostic:{occurrence:{lineIndex:0,lineItemReference:'CASE:A+B?C'}}})
  })
 }
 it.each(mapped)('N does not acquire positive required child %s',field=>{
  expect(direct(negative(),field)).toEqual([])
  // P119 extras remain ignored before requiredness/content validation.
  expect(direct(positive('Z96'),field)).toEqual([])
 })
 it.each(promoted)('a complete sibling cannot supply the first V object %s',field=>{
  const body=[...omit(positive(),field),...positive('S18','2'),...negative('3')]
  const issues=missing(direct(body,field),field)
  expect(issues).toHaveLength(1)
  expect(issues[0].prodatDiagnostic).toMatchObject({occurrence:{lineIndex:0,objectId:'735123456789012345'}})
 })
 it.each(promoted)('a complete V neighbor cannot supply the second VH object %s',field=>{
  const issues=missing(direct([...positive(),...omit(positive('S18','2'),field),...negative('3')],field),field)
  expect(issues).toHaveLength(1)
  expect(issues[0].prodatDiagnostic).toMatchObject({occurrence:{lineIndex:1,objectId:'735123456789012352'}})
 })
 it('invalid Z14 repeated registers cannot lend a later reporting frequency',()=>{
  const first=omit(positive(),'222').map(p=>p[0]==='LIN'?[...p,['1','1']]:p)
  const later=positive('S17','2').map(p=>p[0]==='LIN'?line('2','735123456789012345','2','9'):p)
  const wire=input(message([...first,...later]).raw_payload!,'Z14')
  const issues=validateFieldMatrixPayload({...wire,direction:'inbound'},canonicalProdat26AFieldRules('Z14').filter(r=>['222','258'].includes(r.fieldNumber!)))
  expect(issues.some(i=>i.code==='PRODAT_REGISTER_STRUCTURE_INVALID')).toBe(true)
  expect(missing(issues,'222')).toHaveLength(1)
  expect(missing(issues,'222')[0].prodatDiagnostic).toMatchObject({occurrence:{lineIndex:0}})
 })
 it.each(['missing','unknown','duplicate','misplaced'] as const)('unqualified own field223 (%s) cannot supply positive subtype authority',kind=>{
  const complete=positive(),pair=characteristic('Z13','S17')
  const noReason=complete.filter((p,i)=>!(p[0]==='CCI'&&p[2]==='Z13'||p[0]==='CAV'&&complete[i-1]?.[2]==='Z13'))
  const body=kind==='missing'?noReason:kind==='unknown'?complete.map((p,i)=>p[0]==='CAV'&&complete[i-1]?.[2]==='Z13'?['CAV','XXX']:p)
   :kind==='duplicate'?complete.flatMap(p=>p[0]==='RFF'&&Array.isArray(p[1])&&p[1][0]==='LI'?[...pair,p]:[p]):[...noReason,...pair]
  expect(resolveCanonicalRuntimeDecision(message(body)).applicationDecision).not.toBe('accepted')
  expect(missing(direct(omit(body,'508'),'508'),'508')).toEqual([])
 })
 it.each(['gas','absent','duplicate','misplaced'] as const)('field217 cannot use cached EL metadata when physical UNB is %s',kind=>{
  const wire=input(message(omit(positive(),'217')).raw_payload!,'Z14'),unb=wire.rawSegments.find(s=>s.startsWith('UNB+'))!
  const rawSegments=kind==='gas'?wire.rawSegments.map(s=>s===unb?s.replace('23-DGI-PRODAT','23-GAS-PRODAT'):s)
   :kind==='absent'?wire.rawSegments.filter(s=>s!==unb):kind==='duplicate'?[unb,...wire.rawSegments]
   :[...wire.rawSegments.filter(s=>s!==unb),unb]
  const issues=validateFieldMatrixPayload({...wire,rawSegments,direction:'inbound',applicationReference:'23-DGI-PRODAT'},canonicalProdat26AFieldRules('Z14').filter(r=>r.fieldNumber==='217'))
  expect(missing(issues,'217')).toEqual([])
 })
 it('N gray-date exclusion preserves the separate invalid calendar diagnostic',()=>{
  const valid=[...negative().slice(0,1),['DTM',['90','202610010000','203']] as Parts,...negative().slice(1)]
  expect(direct(valid,'302')).toEqual([])
  const invalid=valid.map(p=>p[0]==='DTM'?['DTM',['90','202602300000','203']]:p)
  expect(direct(invalid,'302')).toContainEqual(expect.objectContaining({blocking:true,code:'FIELD_MATRIX_FIELD_FORMAT_INVALID'}))
  expect(missing(direct(invalid,'302'),'302')).toEqual([])
 })
 it('321 and323 retain independent origin conditions rather than subtype-only R promotion',()=>{
  const complete=positive('S18'),body=complete.filter((p,i)=>!(p[0]==='DTM'&&Array.isArray(p[1])&&p[1][0]==='91'
   ||p[0]==='CCI'&&p[2]==='Z24'||p[0]==='CAV'&&complete[i-1]?.[2]==='Z24'))
  const wire=input(message(body).raw_payload!,'Z14')
  const issues=validateFieldMatrixPayload({...wire,direction:'inbound'},canonicalProdat26AFieldRules('Z14').filter(r=>['321','323'].includes(r.fieldNumber!)))
  expect(missing(issues,'321')).toEqual([]);expect(missing(issues,'323')).toEqual([])
 })
 it('other incoming message functions retain their existing unresolved D cells',()=>{
  const wire=input(raw([line('1','735123456789012345'),...characteristic('Z13','E66')],'Z06'),'Z06')
  const issues=validateFieldMatrixPayload({...wire,direction:'inbound'},canonicalProdat26AFieldRules('Z06').filter(r=>r.fieldNumber==='508'))
  expect(missing(issues,'508')).toEqual([])
 })
 it('outgoing Z14 does not borrow the incoming physical source-required overlay',()=>{
  const wire=input(message(omit(positive(),'508')).raw_payload!,'Z14')
  const issues=validateFieldMatrixPayload({...wire,direction:'outbound'},canonicalProdat26AFieldRules('Z14').filter(r=>r.fieldNumber==='508'))
  expect(missing(issues,'508')).toEqual([])
 })
})
