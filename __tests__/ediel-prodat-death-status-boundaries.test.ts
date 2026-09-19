import {it,expect} from 'vitest'
import {preflightEdielMessageRow,preflightEdielPayload} from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import {validateRulebookMessageWithRegistry,validateEdielMessageRowWithRulebook} from '@/lib/ediel/rulebook/validator'
import {assertRulebookAllowsSend} from '@/lib/ediel/rulebook/sendGuards'
import {assertEdielSendLock} from '@/lib/ediel/transport/sendLock'
import {deathStatusSendIssue} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {deathRaw,deathBody} from './fixtures/prodat-death-status'
import {alphabets,characteristic} from './fixtures/prodat-register'
const row=(payload:string,code='Z06',parsed:Record<string,unknown>={})=>({id:'00000000-0000-4000-8000-000000000001',company_id:'00000000-0000-4000-8000-000000000002',direction:'outbound',environment:'test',message_family:'PRODAT',message_code:code,message_standard:'edifact',raw_payload:payload,parsed_payload:{rulebookAllowInvalidSend:true,...parsed}} as unknown as EdielMessageRow)
for(const alphabet of alphabets)for(const code of ['Z05','Z06','Z09'])it(`actual raw/row/sync/registry/guards protect eligible ${code} ${alphabet.join('')}`,async()=>{
 const payload=deathRaw(code,deathBody(code==='Z05'?'Z23':'E34'),alphabet)
 for(const message of [row(payload,code),row(payload,'Z04'),row(deathRaw('Z04',deathBody('Z22'),alphabet),code,{transactionSubtype:code==='Z05'?'LK':'E'})]){
  expect(validateEdielMessageRowWithRulebook(message,'send').issues.map(i=>i.code)).toContain('PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
  expect((await validateRulebookMessageWithRegistry({code:message.message_code,family:'PRODAT',rawPayload:message.raw_payload,parsedPayload:message.parsed_payload,mode:'send'})).issues.map(i=>i.code)).toContain('PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
  expect(preflightEdielMessageRow(message).issues.map(i=>i.code)).toContain('PRODAT_DEPENDENT_PREFLIGHT_PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
  expect(()=>assertRulebookAllowsSend(message)).toThrow('PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
  expect(()=>assertEdielSendLock(message)).toThrow('PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
 }
 expect(preflightEdielPayload({rawPayload:payload,mode:'send',messageStandard:'xml'}).issues.map(i=>i.code)).toContain('PRODAT_DEPENDENT_PREFLIGHT_PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
})
it('excluded own subtype is not source-held, but explicit extra310 stays protected',()=>{
 for(const [code,reason] of [['Z05','Z22'],['Z06','E64'],['Z06','E32'],['Z09','E64'],['Z09','E32'],['Z09','Z70']]){
  expect(deathStatusSendIssue(row(deathRaw(code,deathBody(reason)),code))).toBeNull()
  expect(deathStatusSendIssue(row(deathRaw(code,deathBody(reason,characteristic('Z17','Z41'))),code))?.code).toBe('PRODAT_DEATH_STATUS_FORBIDDEN')
 }
})
it('preserves XML/list routing with literal question marks and UNH-semicolon data',()=>{
 for(const [standard,raw] of [['xml','<Document><Text>literal?</Text></Document>'],['ai_list','UNH;A;B\n1;2;3?'],['ai_list',"Ver20140401;A;B\n1;?'UNH+literal;3?"]] as const){
  const message={...row(raw,''),message_standard:standard,message_family:standard==='xml'?'NBS_XML':'AI_LIST'} as EdielMessageRow
  expect(deathStatusSendIssue(message)).toBeNull()
  expect(preflightEdielPayload({rawPayload:raw,messageStandard:standard,mode:'send'})).toEqual(preflightEdielPayload({rawPayload:raw,messageStandard:standard,mode:'parse'}))
  if(standard==='xml'){expect(()=>assertRulebookAllowsSend(message)).not.toThrow();expect(()=>assertEdielSendLock(message)).not.toThrow()}
 }
})
