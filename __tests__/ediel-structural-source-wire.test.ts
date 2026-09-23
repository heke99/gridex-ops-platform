import {describe,it,expect} from 'vitest'
import {readStructuralSourceWire} from '@/lib/ediel/sources/structuralSourceWire'
import {timelineFacts} from './helpers/sourceDecisionTimelineFixtures'
import {raw, line, common, characteristic, type Parts} from './fixtures/prodat-register'
import type {SourceObjectScope} from '@/lib/ediel/sources/sourceOwnerWire'

// Wire-only fixtures; expected national business cases come from P26.A
// pp110-112, dates p50 and register ownership pp115-116, not parser output.
const objectId='735123456789012345'
function fixture(code='Z04',reason='E03',minute='202610010000',registerIds:(string|null)[]=['HT','LT']) {
  const body:Parts[]=[['NAD','FR',['12345','160','SVK']],['NAD','DO',['54321','160','SVK']]]
  registerIds.forEach((id,index)=>{
    body.push(line(String(index+1),objectId,registerIds.length>1?String(index+1):undefined,'9'))
    if(index===0)body.push(...common('1','Synthetic').filter(segment => !(segment[0]==='CCI' && segment[2]==='Z13') && !(segment[0]==='CAV' && Array.isArray(segment[1]) && segment[1][0]==='Z22')),...characteristic('Z13',reason),...(code==='Z04'?[]:[['DTM',['157',minute,'203']] as Parts]))
    if(id!==null)body.push(...characteristic('Z16',id,3))
  })
  const wire=raw(body,code).replace('+S+R+','+12345:14+54321:14+')
  const scope=timelineFacts(wire).objects[0].object as SourceObjectScope
  return {wire,scope}
}
describe('original-wire structural source scope',()=>{
  it.each([
    ['Z04','E03','supply_baseline','210'],['Z06','E34','customer_only','216'],
    ['Z06','E64','change_with_reading','216'],['Z06','E32','change_without_reading','216'],['Z10','E58','meter_exchange','216'],
  ])('distinguishes %s %s without using mutable subtype JSON',(code,reason,businessCase,field)=>{
    const {wire,scope}=fixture(code,reason,'202610020000')
    expect(readStructuralSourceWire(wire,scope)).toMatchObject({messageCode:code,businessCase,effectiveFrom:{fieldNumber:field,utc:code==='Z04'?'2026-09-30T23:00:00.000Z':'2026-10-01T23:00:00.000Z'},registers:[{position:1,registerId:'HT'},{position:2,registerId:'LT'}]})
  })
  it('keeps an absent later-register identity absent instead of copying register one',()=>{
    const {wire,scope}=fixture('Z06','E64','202610020000',['HT',null])
    expect(readStructuralSourceWire(wire,scope)?.registers).toEqual([{position:1,registerId:'HT'},{position:2,registerId:null}])
  })
  it('keeps correction function distinct from document and case identity',()=>{
    const {wire,scope}=fixture();const corrected=wire.replace('BGM+Z04+D+9','BGM+Z04+D+5')
    expect(readStructuralSourceWire(corrected,scope)).toMatchObject({functionCode:'5',documentReference:'D',caseReference:'CASE-1'})
  })
  it('binds the exact physical object, agency, message and register membership',()=>{
    const {wire,scope}=fixture()
    for(const changed of [{...scope,objectId:'foreign'},{...scope,identityAgency:'89'},{...scope,messageIndex:1},{...scope,messageReference:'other'},{...scope,registers:scope.registers.slice(0,1)}])expect(readStructuralSourceWire(wire,changed)).toBeNull()
  })
  it('does not use a Z06 future contract start as its effective change date',()=>{
    const {wire,scope}=fixture('Z06','E64','202610020000')
    const source=readStructuralSourceWire(wire.replace('92:202610010000','92:202701010000'),scope)
    expect(source).toMatchObject({contractStartMinute:'202701010000',effectiveFrom:{marketMinute:'202610020000'}})
  })
  it.each(['E34','E32','E64','E03'])('does not reinterpret a Z10 with a wrong business case %s',reason=>{
    const {wire,scope}=fixture('Z10',reason);expect(readStructuralSourceWire(wire,scope)).toBeNull()
  })
  it('does not infer an effective date from receipt, message date or another object',()=>{
    const {wire,scope}=fixture('Z06','E64');expect(readStructuralSourceWire(wire.replace('157:202610010000:203','157:202602300000:203'),scope)).toBeNull()
  })
})
