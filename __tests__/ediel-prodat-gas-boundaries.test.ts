import {it,expect} from 'vitest'
import {gasApplicabilitySendIssue} from '@/lib/ediel/prodat/prodatGasAuthority'
import {preflightEdielMessageRow,preflightEdielPayload} from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import {validateRulebookMessageWithRegistry,validateEdielMessageRowWithRulebook} from '@/lib/ediel/rulebook/validator'
import {assertRulebookAllowsSend} from '@/lib/ediel/rulebook/sendGuards'
import {assertEdielSendLock} from '@/lib/ediel/transport/sendLock'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {payload} from './fixtures/prodat-gas'
import {alphabets} from './fixtures/prodat-register'
const row=(raw_payload:string,code='Z04')=>({id:'00000000-0000-4000-8000-000000000001',company_id:'00000000-0000-4000-8000-000000000002',direction:'outbound',environment:'test',message_family:'PRODAT',message_code:code,message_standard:'edifact',raw_payload,parsed_payload:{rulebookAllowInvalidSend:true}} as unknown as EdielMessageRow)
for(const alphabet of alphabets)for(const [code,reason] of [['Z04','Z70'],['Z06','E64'],['Z10','E58']])it(`selected GAS ${code} reaches every protected consumer ${alphabet}`,async()=>{
 const raw=payload(code,reason,[],'gas',alphabet),message=row(raw,code)
 const key='PRODAT_GAS_SOURCE_UNQUALIFIED'
 expect(validateEdielMessageRowWithRulebook(message,'send').issues.map(i=>i.code)).toContain(key)
 expect((await validateRulebookMessageWithRegistry({family:'PRODAT',code,rawPayload:raw,mode:'send',parsedPayload:message.parsed_payload})).issues.map(i=>i.code)).toContain(key)
 expect(preflightEdielMessageRow(message).issues.map(i=>i.code)).toContain('PRODAT_DEPENDENT_PREFLIGHT_'+key)
 expect(()=>assertRulebookAllowsSend(message)).toThrow(key)
 expect(()=>assertEdielSendLock(message)).toThrow(key)
 expect(preflightEdielPayload({rawPayload:raw,mode:'send',messageStandard:'xml'}).issues.map(i=>i.code)).toContain('PRODAT_DEPENDENT_PREFLIGHT_'+key)
})
it('narrow scope holds selected wire OR claimed row and rejects contradictory row/route references',()=>{
 const gas=payload('Z04','Z22',[],'gas'),el=payload()
 for(const message of [row(gas),{...row(gas),message_family:'NBS_XML',message_standard:'xml',message_code:'OTHER'},row(payload('Z03','Z22'),'Z04'),row(''),'x'] as const){if(typeof message!=='string')expect(gasApplicabilitySendIssue(message)).not.toBeNull()}
 expect(gasApplicabilitySendIssue(row(el))).toBeNull()
 expect(gasApplicabilitySendIssue({...row(el),application_reference:'27-DDQ-PRODAT'})).not.toBeNull()
 expect(gasApplicabilitySendIssue({...row(el),parsed_payload:{routing:{applicationReference:'27-DDQ-PRODAT'}}})).not.toBeNull()
 for(const raw of [el.replace('23-DDQ-PRODAT','UNKNOWN'),el.replace('E2SE6A','E2SE6B'),el.slice(el.indexOf('UNH+'))])expect(gasApplicabilitySendIssue(row(raw))).not.toBeNull()
 expect(gasApplicabilitySendIssue({...row(gas),direction:'inbound'})).toBeNull()
 expect(gasApplicabilitySendIssue(row(payload('Z03','Z22',[],'gas'),'Z03'))).toBeNull()
 for(const raw of ['<Document>literal?</Document>','UNH;A;B\n1;2;3?',"Ver20140401;A\n1;?'UNH+literal"]){expect(gasApplicabilitySendIssue({...row(raw,''),message_family:'AI_LIST'})).toBeNull()}
 const escaped=payload('Z03','Z22',[['FTX','AAI','','',"'UNH+M+PRODAT:D:97A:UN:E2SE6B'BGM+Z04"]])
 expect(gasApplicabilitySendIssue(row(escaped,'Z03'))).toBeNull()
})
it('coherent EL wire cannot be mislabeled as another code/family or hide an ambiguous selected BGM',()=>{
 const el=payload()
 for(const message of [row(el,'Z03'),{...row(el),message_family:'APERAK'},row(el.replace('BGM+Z04+D+9+AB',"BGM+Z03+D+9+AB'BGM+Z04+OTHER+9+AB"),'Z03')])expect(gasApplicabilitySendIssue(message)).not.toBeNull()
})
it('malformed selected raw wire still holds under a false format/family label',()=>{
 const message={...row(payload('Z04','Z70',[],'gas')+'?','Z03'),message_family:'NBS_XML',message_standard:'xml'}
 expect(gasApplicabilitySendIssue(message)?.code).toBe('PRODAT_GAS_SOURCE_UNQUALIFIED')
})
it('known EL field exclusion survives intentional-invalid and canonical catch paths',()=>{
 const raw=payload('Z04','Z70',[['RFF',['Z08','']],['RFF',['Z06','bad','unused']]])
 for(const message of [row(raw),{...row(raw),application_reference:'BAD'}]){
  expect(validateEdielMessageRowWithRulebook(message,'send').issues).toContainEqual(expect.objectContaining({code:'PRODAT_GAS_320_FORBIDDEN',blocking:true}))
  expect(()=>assertRulebookAllowsSend(message)).toThrow('PRODAT_GAS_320_FORBIDDEN')
  expect(()=>assertEdielSendLock(message)).toThrow('PRODAT_GAS_320_FORBIDDEN')
 }
})

it('selected multi-message wire cannot be certified by its first EL envelope or an empty row code',()=>{
 const el=payload()
 const joined=el.slice(0,el.indexOf('UNZ+'))+el.slice(el.indexOf('UNH+'))
 expect(gasApplicabilitySendIssue(row(joined,''))?.code).toBe('PRODAT_GAS_SOURCE_UNQUALIFIED')
})
