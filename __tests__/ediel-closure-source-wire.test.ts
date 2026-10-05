import {expect,it} from 'vitest'
import {closureFixture} from './helpers/closureWireFixtures'
import {readClosureSourceWire} from '@/lib/ediel/sources/closureSourceWire'

it.each([['Z22','L'],['Z23','LK']])('reads original %s/%s exact field211 without Z08', (reason,subtype)=>{
  const {wire,scope}=closureFixture({reason})
  expect(readClosureSourceWire(wire,scope)).toEqual({object:scope,messageCode:'Z05',subtype,reason,functionCode:'9',
    documentReference:'CLOSE-DOC',caseReference:'CLOSE-CASE',effectiveTo:{fieldNumber:'211',marketMinute:'202610151234',utc:'2026-10-15T11:34:00.000Z'},
    legalSender:'12345',legalReceiver:'54321',transportSender:'12345',transportReceiver:'54321',transportSenderQualifier:'14',transportReceiverQualifier:'14'})
})
it('preserves market midnight as prior UTC date',()=>{
  const {wire,scope}=closureFixture({minute:'202610150000'})
  expect(readClosureSourceWire(wire,scope)?.effectiveTo.utc).toBe('2026-10-14T23:00:00.000Z')
})
it.each([{alphabet:undefined},{alphabet:['*',';','!','~']},{alphabet:['^','|','!','%']}])('preserves escaped delimiters, release and apparent segments under %j',({alphabet})=>{
  const document="D?:+'!*;~^|%",li="CASE?:+'!*;~^|%UNH+FAKE'DTM+93:202610151235:203"
  const {wire,scope}=closureFixture({alphabet,document,li})
  expect(readClosureSourceWire(wire,scope)).toMatchObject({documentReference:document,caseReference:li,effectiveTo:{marketMinute:'202610151234'}})
})
it('keeps physical boundaries for multiple distinct objects and CRLF',()=>{
  const {wire,scope}=closureFixture({count:2})
  const second={...scope,objectId:'735123456789012341',registers:[{lineIndex:1,lineNumber:'2',registerIndex:null,registerPosition:1,segmentIndex:16}]}
  expect(readClosureSourceWire(wire.replaceAll("'","'\r\n"),second)?.object).toEqual(second)
  expect(readClosureSourceWire(wire,{...scope,registers:second.registers})).toBeNull()
})
it('supports default UNA and an absent original function',()=>{
  const {wire,scope}=closureFixture()
  expect(readClosureSourceWire(wire.slice(9).replace('+CLOSE-DOC+9+AB', '+CLOSE-DOC++AB'),scope)?.functionCode).toBeNull()
})
it.each(['202602291234','202610152400','202610151260','000010151234','20261015','20261015123400'])('rejects invalid original minute %s',minute=>{
  const {wire,scope}=closureFixture({minute});expect(readClosureSourceWire(wire,scope)).toBeNull()
})
it.each([
  ['cancellation',(s:string)=>s.replace('CAV+Z22','CAV+Z24')],
  ['bilateral',(s:string)=>s.replace('CAV+Z22','CAV+E03')],
  ['correction',(s:string)=>s.replace('+CLOSE-DOC+9+AB','+CLOSE-DOC+5+AB')],
  ['start fallback',(s:string)=>s.replace('DTM+93:','DTM+92:')],
  ['wrong format',(s:string)=>s.replace('93:202610151234:203','93:202610151234:102')],
  ['wrong timezone',(s:string)=>s.replace('ZZZ:1:805','ZZZ:2:805')],
  ['bad trailer',(s:string)=>s.replace('UNT+16+M','UNT+15+M')],
  ['subaddress',(s:string)=>s.replace('12345:14+','12345:14:SUB+')],
  ['delegated sender',(s:string)=>s.replace('12345:14+','99999:14+')],
  ['bare CR',(s:string)=>s.replace('BGM+','\rBGM+')],
  ['repetition advice',(s:string)=>s.replace("UNA:+.? '","UNA:+.?*'")],
  ['colliding advice',(s:string)=>s.replace('UNA:+','UNA::')],
  ['dangling release',(s:string)=>s+'?'],
  ['unclosed segment',(s:string)=>s.slice(0,-1)],
  ['noncanonical LIN ordinal',(s:string)=>s.replace('LIN+1++','LIN+01++')],
] as const)('holds %s',(_name,change)=>{
  const {wire,scope}=closureFixture();expect(readClosureSourceWire(change(wire),scope)).toBeNull()
})
it('rejects duplicate DTM93 and cross-object date borrowing',()=>{
  const {wire,scope}=closureFixture({count:2})
  expect(readClosureSourceWire(wire.replace('DTM+93:202610151234:203', 'DTM+92:202610151234:203'),scope)).toBeNull()
  const duplicate=wire.replace("CCI++Z13'", "DTM+93:202610151234:203'CCI++Z13'").replace('UNT+25+M','UNT+26+M')
  expect(readClosureSourceWire(duplicate,scope)).toBeNull()
})
it('bounds bytes, segments, decoded components and objects',()=>{
  const {wire,scope}=closureFixture()
  expect(readClosureSourceWire(wire+' '.repeat(262144),scope)).toBeNull()
  expect(readClosureSourceWire(wire.replace('CLOSE-CASE','A'.repeat(4097)),scope)).toBeNull()
  expect(readClosureSourceWire(closureFixture({count:17}).wire,scope)).toBeNull()
})
it('never takes caller geometry or register inventory as closure authority',()=>{
  const {wire,scope}=closureFixture()
  for(const forged of [{...scope,objectId:'735123456789012346'},{...scope,identityAgency:'89'},
    {...scope,messageIndex:1},{...scope,messageReference:'FOREIGN'},
    {...scope,registers:[{...scope.registers[0],segmentIndex:8}]},
    {...scope,registers:[{...scope.registers[0],registerIndex:'1'}]}])expect(readClosureSourceWire(wire,forged)).toBeNull()
  const parsed=readClosureSourceWire(wire,scope)
  expect(parsed).not.toHaveProperty('meterNumber');expect(parsed).not.toHaveProperty('registers')
})
it('holds leading-zero LIN ordinal even with matching canonical geometry',()=>{
  const {wire,scope}=closureFixture()
  expect(readClosureSourceWire(wire.replace('LIN+1++','LIN+01++'),{...scope,registers:[{...scope.registers[0],lineNumber:'01'}]})).toBeNull()
})
it('a released terminator cannot manufacture a physical message or date',()=>{
  const {wire,scope}=closureFixture({li:"CASE'UNH+X'DTM+93:202610151235:203"})
  expect(readClosureSourceWire(wire,scope)?.effectiveTo.marketMinute).toBe('202610151234')
  expect(readClosureSourceWire(wire.replace('DTM+93:202610151234:203','DTM+92:202610151234:203'),scope)).toBeNull()
})
