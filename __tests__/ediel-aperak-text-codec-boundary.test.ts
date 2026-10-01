import {it,expect} from 'vitest'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
// Business segments are serialized in the default alphabet. The codec
// transcodes framing and data into the requested output service alphabet.
for(const [suffix,decoded] of [['plain','plain'],["plain'",'plain'],["plain'''",'plain'],["tail?'","tail'"],["tail?''","tail'"],["tail?'''","tail'"],["tail??'",'tail?'],["tail???'","tail?'"],["tail????'",'tail??']] as const){
 it(`actual codec preserves escaped content and removes only terminators: ${suffix}`,()=>{
  const raw=EdifactEnvelopeCodec.encode({ acknowledgementRequest: true,sender:'12345',receiver:'54321',interchangeReference:'I',environment:'test',messages:[{messageReference:'M',messageTypeToken:'APERAK:D:96A:UN:E2SE2B',businessSegments:[`FTX+AAO+++${suffix}`]}]})
  const wire=tokenizeEdifact(raw),ftx=wire.segments.find(s=>s.tag==='FTX')!,unt=wire.segments.find(s=>s.tag==='UNT')
  expect(segmentComposite(ftx,4,wire.una)).toEqual([decoded]);expect(unt).toBeDefined();expect(segmentComposite(unt!,1,wire.una)[0]).toBe('3')
 })
}
const encode=(businessSegments:string[],una?:Parameters<typeof EdifactEnvelopeCodec.encode>[0]['una'])=>EdifactEnvelopeCodec.encode({ acknowledgementRequest: true,sender:'12345',receiver:'54321',interchangeReference:'I',environment:'test',una,messages:[{messageReference:'M',messageTypeToken:'APERAK:D:96A:UN:E2SE2B',businessSegments}]})
for(const empty of ['',"'''",' \r\n '])it(`retains empty segment rejection ${JSON.stringify(empty)}`,()=>expect(()=>encode([empty])).toThrow('edifact_empty_business_segment'))
for(const tag of ['UNA','UNB','UNH','UNT','UNZ'])it(`retains envelope tag rejection ${tag}`,()=>expect(()=>encode([`${tag}+BAD`])).toThrow('edifact_business_segment_contains_envelope_tag'))
for(const [body,value] of [["  FTX+AAO+++MID?'END'\r\n  ","MID'END"],["FTX+AAO+++END?'?''","END''"],["FTX+AAO+++END???''","END?'"],["FTX+AAO+++END??",'END?']] as const)it(`released middle/repeated data and whitespace ${body}`,()=>{
 const t=tokenizeEdifact(encode([body]));expect(segmentComposite(t.segments.find(s=>s.tag==='FTX')!,4,t.una)).toEqual([value]);expect(t.segments.filter(s=>s.tag==='UNT')).toHaveLength(1)
})
it('transcodes default-serialized data into compatible partial UNA framing',()=>{
 const raw=encode(['FTX+AAO+++END?~'],{releaseCharacter:'!',segmentTerminator:'~'}),t=tokenizeEdifact(raw)
 expect(segmentComposite(t.segments.find(s=>s.tag==='FTX')!,4,t.una)).toEqual(['END~']);expect(t.segments.filter(s=>s.tag==='UNT')).toHaveLength(1)
 const literal=tokenizeEdifact(encode(['FTX+AAO+++END!~'],{releaseCharacter:'!',segmentTerminator:'~'}))
 expect(segmentComposite(literal.segments.find(s=>s.tag==='FTX')!,4,literal.una)).toEqual(['END!~'])
 const general=tokenizeEdifact(encode(['FTX+AAO+++END'],{componentDataElementSeparator:'*',dataElementSeparator:';'}))
 expect(segmentComposite(general.segments.find(s=>s.tag==='UNH')!,2,general.una)).toEqual(['APERAK','D','96A','UN','E2SE2B'])
 expect(segmentComposite(general.segments.find(s=>s.tag==='FTX')!,4,general.una)).toEqual(['END'])
})
