import {describe,expect,it} from 'vitest'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {parseRulebookMessage} from '@/lib/ediel/rulebook/messageParser'
import {escapeEdifactData} from '@/lib/ediel/core/una'
const una={componentDataElementSeparator:'*',dataElementSeparator:';',releaseCharacter:'!',segmentTerminator:'~'}
function wire(type:string,body:string[],alternate:boolean){return EdifactEnvelopeCodec.encode({sender:'S+1',receiver:'R:2',interchangeReference:'I+1',senderSubAddress:'SUB:+',receiverSubAddress:'DEST:?',environment:'test',acknowledgementRequest:true,applicationReference:'23-DDQ-UTILTS',...(alternate?{una}:{}),messages:[{messageReference:'M:1',messageTypeToken:type,businessSegments:body}]})}
describe('existing rulebook parser shared EDIFACT alphabet across actual families',()=>{
 it.each([false,true])('parses APERAK own ERC and exact related refs with alternative UNA=%s',alternate=>{
  const parsed=parseRulebookMessage(wire('APERAK:D:04A:UN:E5SE5A',['BGM+12+ACK-DOC',`RFF+ACW:${escapeEdifactData("ORIG:+?'1")}`,'ERC+41','FTX+AAO+++MANDATORY FIELD MISSING+512'],alternate))
  expect(parsed).toMatchObject({family:'APERAK',outcome:'negative',sender:'S+1',receiver:'R:2',senderSubAddress:'SUB:+',receiverSubAddress:'DEST:?',interchangeReference:'I+1',transactionReference:"ORIG:+?'1",relatedReference:"ORIG:+?'1"})
  expect(parsed.facts.errors).toEqual([{erc:'41',ftx:expect.any(String)}]);expect(parsed.errors).toEqual([])
 })
 it.each([false,true])('does not turn literal released ERC text into a negative APERAK with alternative UNA=%s',alternate=>{
  const parsed=parseRulebookMessage(wire('APERAK:D:04A:UN:E5SE5A',['BGM+12+ACK-DOC',`FTX+AAO+++${escapeEdifactData("literal 'ERC+42:bad' text")}`],alternate))
  expect(parsed.family).toBe('APERAK');expect(parsed.outcome).toBe('positive');expect(parsed.facts.erc).toEqual([])
 })
 it.each([false,true])('parses UTILTS facts from physical tags with alternative UNA=%s',alternate=>{
  const parsed=parseRulebookMessage(wire('UTILTS:D:02B:UN:E5SE5A',['BGM+E66+DOC','DTM+137:202609301200:203','DTM+735:?+0100:406','IDE+24+OWN','LOC+172+POINT','QTY+136:1.25'],alternate))
  expect(parsed).toMatchObject({family:'UTILTS',code:'E66',sender:'S+1',receiver:'R:2',interchangeReference:'I+1'})
  expect(parsed.facts.ide).toHaveLength(1);expect(parsed.facts.qty).toHaveLength(1);expect(parsed.facts.dtm137).toBe('202609301200');expect(parsed.facts.dtm735).toBe('+0100')
 })
})
