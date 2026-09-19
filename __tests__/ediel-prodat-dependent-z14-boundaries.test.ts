import { describe, expect, it } from 'vitest'
import { validateEdielMessageRowWithRulebook, validateRulebookMessage } from '@/lib/ediel/rulebook/validator'
import { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { assertEdielSendLock } from '@/lib/ediel/transport/sendLock'
import { buildZ14Segments } from '@/lib/ediel/prodat/builders/z14'
import { buildProdatMessage, type BuildProdatMessageInput } from '@/lib/ediel/prodat/buildProdat'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import type { ProdatEngineProductionContext } from '@/lib/ediel/prodat/types'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { alphabets, characteristic, raw, type Parts } from './fixtures/prodat-register'
const target=(i:{scope?:string;description:string;code:string})=>(i.scope==='prodat_dependent'||i.code.startsWith('PRODAT_DEPENDENT_PREFLIGHT_'))&&i.description.includes('Z14:')
function row(body:Parts[],environment:'test'|'production',alphabet:readonly string[]):EdielMessageRow {
  return {message_family:'PRODAT',message_code:'Z14',direction:'outbound',environment,message_standard:'edifact',company_id:'synthetic',
    raw_payload:raw(body,'Z14',alphabet),application_reference:'23-DDQ-PRODAT',mime_type:'application/EDIFACT',
    validation_report:{systemTestAckSend:{enabled:true,source:'system_test_ack_action'}},
    parsed_payload:{rulebookAllowInvalidSend:true,prodatEngine:{dependentConditionStatuses:[]}}} as unknown as EdielMessageRow
}
for (const alphabet of alphabets) for (const environment of ['test','production'] as const) describe(`Z14 boundaries ${alphabet.join('')} ${environment}`,()=>{
  it('all real send paths protect missing and forbidden Z14 cells against override flags',()=>{
    for(const body of [[['LIN','1'],...characteristic('Z13','S17')],[['LIN','1'],...characteristic('Z13','Z96'),...characteristic('Z04','Z04')]] as Parts[][]){
      const message=row(body,environment,alphabet)
      expect(validateEdielMessageRowWithRulebook(message,'send').issues.some(i=>target(i)&&i.blocking)).toBe(true)
      expect(()=>assertRulebookAllowsSend(message)).toThrow(/Z14:/)
      expect(preflightEdielMessageRow(message,'send').issues.some(target)).toBe(true)
      expect(()=>assertEdielSendLock(message)).toThrow(/Z14:/)
      message.message_family='UTILTS';message.message_code='Z04'
      expect(()=>assertRulebookAllowsSend(message)).toThrow(/Z14:/)
    }
  })
  it('minimal valid N passes this bounded gate and preserves production readiness',()=>{
    const message=row([['LIN','1'],...characteristic('Z13','Z96')],environment,alphabet)
    expect(validateEdielMessageRowWithRulebook(message,'send').issues.filter(target)).toEqual([])
    expect(preflightEdielMessageRow(message,'send').issues.filter(target)).toEqual([])
    expect(()=>assertRulebookAllowsSend(message)).not.toThrow()
    if(environment==='test')expect(()=>assertEdielSendLock(message)).not.toThrow()
    else expect(()=>assertEdielSendLock(message)).toThrow(/Produktionsmeddelande saknar/)
  })
  it('inbound parse does not turn local unknown into this outbound rejection',()=>{
    const message={...row([['LIN','1']],environment,alphabet),direction:'inbound' as const}
    expect(preflightEdielMessageRow(message,'parse').issues.filter(target)).toEqual([])
    expect(validateRulebookMessage({rawPayload:message.raw_payload!,family:'PRODAT',code:'Z14',direction:'inbound',mode:'parse',environment}).issues.filter(target)).toEqual([])
  })
})
const context:ProdatEngineProductionContext={code:'Z14',bgmReference:'DOC',transactionReference:'CASE',senderEdielId:'12345',receiverEdielId:'54321',
  meterPointId:'A',gridAreaId:'ABC',customerId:'ID',customerIdAgency:'89',customerName:'User',customerCountry:'SE',siteAddress:'Site',siteCountry:'SE',reasonForTransaction:'S17',
  reportStartDate:'202610010000',permissionTimestamp:'202609191200',observationLength:'15',observationLengthFormat:'806',
  meteringMethod:'Z04',reportingFrequency:'D',energyProductId:'8716867000030',installationDirection:'E17',permissionId:'PERMISSION'}
describe('Z14 builder and parser integration',()=>{
  it('profiled positive builder returns protected issues for missing fields, retaining parsed positive source data',()=>{
    const built=buildZ14Segments({context,generatedAt:new Date('2026-09-19T12:00Z')})
    expect(built.issues.filter(i=>i.description.includes('Z14:'))).toEqual([])
    expect(parseProdatMessage(built.segments.join("'")+"'").lineItems[0]).toMatchObject({customerId:'ID',permissionId:'PERMISSION'})
    expect(buildZ14Segments({context:{...context,permissionId:null}}).issues.some(i=>i.description.includes('Z14:325'))).toBe(true)
  })
  it('generic builder rejects a positive message lacking the bounded fields',()=>{
    const base:BuildProdatMessageInput={companyId:'synthetic',role:'energy_service_company',businessCode:'Z14',transactionSubtype:'V',
      sender:{edielId:'12345'},receiver:{edielId:'54321'},meteringPoint:{id:'A'},environment:'test',codedAttributes:{Z13:'S17'},references:{LI:'CASE'}}
    expect(()=>buildProdatMessage(base)).toThrow(/Z14:/)
  })
})

it('generic positive Z14 can represent and validate its installation parent',()=>{
  const base = {companyId:'synthetic',role:'energy_service_company',businessCode:'Z14',transactionSubtype:'V',
    sender:{edielId:'12345'},receiver:{edielId:'54321'},meteringPoint:{id:'A',gridArea:'ABC'},environment:'test',
    codedAttributes:{Z13:'S17',Z04:'Z04',Z12:'D',Z14:'8716867000030',Z22:'E17'},
    references:{LI:'CASE',Z09:'PERMISSION'},customer:{id:'ID',name:'User',idAgency:'89' as const,country:'SE'},
    installation:{address:'Site',idAgency:'89' as const},
    dates:{reportStartDate:'202610010000',observationLength:'15',observationLengthFormat:'806',permissionTimestamp:'202609191200'}}
  const built=buildProdatMessage(base)
  expect(built.rawEdifact).toContain('NAD+IT+A::89')
  expect(built.validation.ok).toBe(true)
  expect(()=>buildProdatMessage({...base,transactionSubtype:'N',codedAttributes:{...base.codedAttributes,Z13:'Z96'}})).toThrow(/Z14:/)
})
