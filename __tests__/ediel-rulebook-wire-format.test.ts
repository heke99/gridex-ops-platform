import {expect,it} from 'vitest'
import {buildAiListCsv} from '@/lib/ediel/aiList'
import {parseRulebookWirePayload} from '@/lib/ediel/rulebook/messageFormatParser'
import {validateRulebookMessage as validateLegacy} from '@/lib/ediel/rulebook/validatorLegacy'
import {raw} from './fixtures/prodat-register'
import {z10} from './fixtures/prodat-identity'

const csv = () => buildAiListCsv({listType:'AI',senderEdielId:'12345',senderName:'Supplier',receiverEdielId:'54321',receiverName:'Network',
  createdAt:'2026-09-30T12:00:00Z',fromDate:'2026-10-01',toDate:'2026-11-01',details:[{anlaggningsId:'735123456789012345',kodlista:'9',
    natavrakningsomrade:'NET',balansansvarsId:'BRP',elanvandarId:'199001011234',elanvandarNamn:"Literal?'UNH+name"}]})

it('uses the actual XML parser for nested XML and literal EDIFACT service characters',()=>{
  const payload="<?xml version='1.0'?><Document><Text>Literal?'UNH+data;</Text></Document>"
  expect(parseRulebookWirePayload({rawPayload:payload,family:'NBS_XML'})).toMatchObject({family:'NBS_XML',code:'Document',errors:[],facts:{xmlParserScope:'syntax_only'}})
  expect(validateLegacy({rawPayload:payload,family:'NBS_XML',mode:'send'}).issues.map(issue=>issue.code)).not.toContain('PARSER_ERROR')
})
it('holds malformed XML and custom/external declarations without trying CSV or EDIFACT',()=>{
  for(const rawPayload of ['<Document><Text></Document>', '<!DOCTYPE Document [<!ENTITY secret SYSTEM "file:///secret">]><Document>&secret;</Document>'])
    expect(parseRulebookWirePayload({rawPayload,family:'NBS_XML'})).toMatchObject({family:'NBS_XML',errors:['ediel_xml_syntax_invalid']})
})
it('uses the shared positional AI parser despite literal apostrophes and release characters in customer data',()=>{
  const parsed=parseRulebookWirePayload({rawPayload:csv(),family:'AI_LIST'})
  expect(parsed).toMatchObject({family:'AI_LIST',code:'AI',errors:[],facts:{rowCount:1}})
  expect(validateLegacy({rawPayload:csv(),family:'AI_LIST',mode:'parse'}).issues.map(issue=>issue.code)).not.toContain('PARSER_ERROR')
})
it('keeps malformed AI in its own parser and does not try an alternate engine',()=>{
  expect(parseRulebookWirePayload({rawPayload:'AI;invalid',family:'AI_LIST'})).toMatchObject({family:'UNKNOWN',errors:['ai_list_header_invalid']})
})
it('keeps physical EDIFACT identity under alternate family metadata and retains lexical failures',()=>{
  const payload=raw(z10(),'Z10')
  expect(parseRulebookWirePayload({rawPayload:payload,family:'NBS_XML'})).toMatchObject({family:'PRODAT',code:'Z10',errors:['EDIEL_WIRE_FORMAT_IDENTITY_MISMATCH']})
  expect(()=>parseRulebookWirePayload({rawPayload:payload+'?',family:'AI_LIST'})).toThrow('edifact_dangling_release_character')
})
it('does not grant format or reuse supplied parsed data for an unrecognized physical source',()=>{
  expect(parseRulebookWirePayload({rawPayload:'UNH;A;B\n1;2;3?'})).toMatchObject({family:'UNKNOWN',errors:['ediel_wire_format_unrecognized']})
  const trusted=parseRulebookWirePayload({rawPayload:csv(),family:'AI_LIST'})
  expect(validateLegacy({rawPayload:'AI;invalid',family:'AI_LIST',parsed:trusted}).issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'PARSER_ERROR'})]))
})
