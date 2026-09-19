import { ud, udInvoiceeFact, udAddressFact } from './fixtures/prodat-ud'
import { describe, expect, it } from 'vitest'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { resolveProdatDependentCondition, type ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer'
import { buildProdatMessage, type BuildProdatMessageInput } from '@/lib/ediel/prodat/buildProdat'
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards'
import { assertEdielSendLock } from '@/lib/ediel/transport/sendLock'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { ProdatEngineProductionContext } from '@/lib/ediel/prodat/types'
import { alphabets, characteristic, input, line, qty, raw, type Parts } from './fixtures/prodat-register'

const fields = ['214','218','259']
// Keep trailing padding inside the composite; segment-boundary whitespace is
// discarded by the unchanged tokenizer and is outside this qualification.
const reason = (value: string): Parts[] => value.endsWith(' ') ? [['CCI','','Z13'],['CAV',[value,'']]] : characteristic('Z13', value)
const measurement = (field: string, value = '1') => characteristic(({214:'Z02',218:'Z05',259:'Z16'} as Record<string,string>)[field], value, 3)
const fact = (id = 'A', readings?: boolean | null, count = 1, agency: '9'|'89' = '89') => ({meteringPointId:id,identityAgency:agency,expectedRegisterCount:count,meterReadingsSentInUtilts:readings})
function check(code:string, body:Parts[], facts:ProdatDependentConditionFacts, selected=fields, alphabet:readonly string[]=alphabets[0], direction:'outbound'|'inbound'='outbound') {
  const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:code,subtypeOrReasonCode:code==='Z04'?'L':code==='Z10'?'M':'F',direction,referenceDate:'2026-09-19',applicationReference:'23-DDQ-PRODAT',bilateralCapabilityVerified:true,prodatDependentFacts:facts,mode:'catalog_evidence'})
  const wire=input(raw(body,code,alphabet),code)
  return validateCanonicalPolicyFields({policy:{...policy,fieldRules:policy.fieldRules.filter(r=>'fieldNumber' in r && selected.includes(String(r.fieldNumber)))},rawSegments:wire.rawSegments,una:wire.una})
}
const facts = (readings?:boolean|null,count=1):ProdatDependentConditionFacts => ({market:'electricity',registerObjects:[fact('A',readings,count)]})

describe('frozen outbound first-register reading outcomes compose with appendix2',()=>{
  for(const [code,token] of [['Z04','Z22'],['Z06','E64'],['Z10','E58']])for(const field of fields)for(const alphabet of alphabets) {
    it(`${code}/${field}/${alphabet[0]}: false forbids first value, true requires it, unknown is not inferred from it`,()=>{
      const body=[line('1','A'),...reason(token)]
      expect(check(code,[...body,...measurement(field)],facts(false),[field],alphabet).some(i=>i.blocking)).toBe(true)
      expect(check(code,body,facts(false),[field],alphabet)).toEqual([])
      expect(check(code,body,facts(true),[field],alphabet).some(i=>i.blocking)).toBe(true)
      expect(check(code,[...body,...measurement(field)],facts(true),[field],alphabet)).toEqual([])
      expect(check(code,[...body,...measurement(field)],facts(),[field],alphabet)).toContainEqual(expect.objectContaining({code:'PRODAT_DEPENDENT_CONDITION_UNDETERMINED'}))
    })
  }
  for(const token of ['E34','E32'])it(`${token}: optional constants/digits do not resolve unknown259 when absent`,()=>{
    const body=[line('1','A'),...reason(token)]
    expect(check('Z06',body,facts(),['214','218'])).toEqual([])
    expect(check('Z06',body,facts(),['259'])).toContainEqual(expect.objectContaining({code:'PRODAT_DEPENDENT_CONDITION_UNDETERMINED'}))
    expect(check('Z06',[...body,...measurement('214'),...measurement('218')],facts(false),['214','218'])).toEqual([])
    expect(check('Z06',body,facts(true),['259'])).toEqual([])
    expect(check('Z06',[...body,...measurement('259')],facts(false),['259']).some(i=>i.blocking)).toBe(true)
  })
  for(const [code,token] of [['Z04','Z22'],['Z06','E64'],['Z10','E58']])it(`${code}: later constants remain optional while EL259 stays forbidden`,()=>{
    const body=[line('1','A','1'),...reason(token),line('2','A','2'),...measurement('214'),...measurement('218')]
    expect(check(code,body,facts(false,2))).toEqual([])
    expect(check(code,[...body,...measurement('259')],facts(false,2),['259']).some(i=>i.blocking)).toBe(true)
    expect(check(code,[line('1','A'),...reason(token),...measurement('214')],{market:'electricity',meterReadingsSentInUtilts:false},['214'],alphabets[0],'inbound')).toEqual([])
  })
  it('E/G repetition is field-specific and follows only the same object first register',()=>{
    const body=[line('1','A','1'),...reason('E34'),...measurement('214'),line('2','B','1'),...reason('E32'),line('3','A','2'),line('4','B','2'),...measurement('218')]
    const f={market:'electricity' as const,registerObjects:[fact('A',false,2),fact('B',false,2)]}
    expect(check('Z06',body,f,['214']).some(i=>i.blocking)).toBe(true)
    body.splice(body.length-3,0,...measurement('214','2'))
    expect(check('Z06',body,f,['214','218'])).toEqual([])
  })
  it('one object cannot borrow missing readings from a root, byCell, sibling, or other agency',()=>{
    const body=[line('1','A'),...reason('E64'),...measurement('214'),line('2','B'),...reason('E64'),...measurement('214')]
    for(const b of [fact('B',null),fact('B',undefined),fact('B',true,1,'9')]) {
      const result=check('Z06',body,{market:'electricity',meterReadingsSentInUtilts:true,byCell:{'Z06:214':true},registerObjects:[fact('A',true),b]},['214'])
      expect(result).toContainEqual(expect.objectContaining({code:'PRODAT_DEPENDENT_CONDITION_UNDETERMINED'}))
    }
  })
  it('caller GAS label cannot bypass actual EL259 exclusion',()=>{
    expect(check('Z06',[line('1','A'),...reason('E34'),...measurement('259')],{market:'gas',registerObjects:[fact('A',false)]},['259']).some(i=>i.blocking)).toBe(true)
  })
})

describe('only exact own-first wire reasons and fields can establish reading conditions',()=>{
  for(const token of ['F','Z06F',' E64','E64 ','e64','E58'])it(`rejects reason ${JSON.stringify(token)} instead of normalizing into authority`,()=>{
    expect(check('Z06',[line('1','A'),...reason(token),...measurement('214')],facts(true),['214'])).toContainEqual(expect.objectContaining({code:'PRODAT_DEPENDENT_CONDITION_UNDETERMINED'}))
  })
  for(const bad of [reason('E64').concat(reason('E64')),characteristic(' Z13','E64'),[['RFF',['LI','X']] as Parts,...reason('E64')],[]])it(`rejects duplicate/padded/misplaced/missing first reason ${JSON.stringify(bad)}`,()=>{
    expect(check('Z06',[line('1','A','1'),...bad,...measurement('214'),line('2','A','2'),...reason('E64'),...measurement('214')],facts(true,2),['214'])).toContainEqual(expect.objectContaining({code:'PRODAT_DEPENDENT_CONDITION_UNDETERMINED'}))
  })
  for(const supplied of [characteristic(' Z02','1',3),[['CCI','','Z02'] as Parts],characteristic('Z02','',3),[['RFF',['LI','X']] as Parts,...measurement('214')]])it(`supplied forbidden/malformed constant cannot evade by scope or padding ${JSON.stringify(supplied)}`,()=>{
    expect(check('Z04',[line('1','A'),...reason('Z22'),...supplied],facts(false),['214']).some(i=>i.blocking)).toBe(true)
  })
  it('a header measurement cannot supply the object, and later messages cannot supply its reason',()=>{
    expect(check('Z04',[...measurement('214'),line('1','A'),...reason('Z22')],facts(false),['214']).some(i=>i.blocking)).toBe(true)
    const body=[line('1','A'),...measurement('214'),['UNT','5','M'] as Parts,['UNH','N',['PRODAT','D','97A','UN','E2SE6A']] as Parts,line('1','A'),...reason('E64')]
    expect(check('Z06',body,facts(true),['214'])).toContainEqual(expect.objectContaining({code:'PRODAT_DEPENDENT_CONDITION_UNDETERMINED'}))
  })
})

const context:ProdatEngineProductionContext={code:'Z04',bgmReference:'DOC',transactionReference:'CASE',senderEdielId:'12345',receiverEdielId:'54321',meterPointId:'A',meterPointIdAgency:'89',customerId:'USR',customerName:'Synthetic',customerIdAgency:'89',gridAreaId:'TES',startDate:'202610010000',observationLength:'15',observationLengthFormat:'806',reasonForTransaction:'Z22'}
const generic:BuildProdatMessageInput={companyId:'tenant',role:'supplier',businessCode:'Z04',transactionSubtype:'L',sender:{edielId:'12345'},receiver:{edielId:'54321'},meteringPoint:{id:'A',identityAgency:'89',gridArea:'TES'},customer:{id:'USR',name:'Synthetic',idAgency:'89'},dates:{contractStartDate:'202610010000',observationLength:'15',observationLengthFormat:'806'},references:{LI:'CASE'},codedAttributes:{Z13:'Z22'},environment:'test'}
function row(body:Parts[],f:ProdatDependentConditionFacts):EdielMessageRow {
  const payload=raw([...body,ud()]),wire=input(payload)
  return {message_family:'PRODAT',message_code:'Z04',message_version:'26A',direction:'outbound',environment:'test',message_standard:'edifact',application_reference:'23-DDQ-PRODAT',company_id:'tenant',raw_payload:payload,mime_type:'application/EDIFACT',parsed_payload:{rulebookAllowInvalidSend:true,prodatEngine:{registerEvidence:createProdatRegisterEvidence({...wire,code:'Z04',facts:{...f,endUserAddressObjects:[udAddressFact('A','tenant')],invoiceeObjects:[udInvoiceeFact('A','tenant')]}})}}} as unknown as EdielMessageRow
}
describe('reading facts and decisions reach renderers and protected send boundaries',()=>{
  it('prewire diagnostics use independent readings, never root/byCell',()=>{
    expect(resolveProdatDependentCondition({messageCode:'Z04',fieldNumber:'214',facts:{...facts(true),meterReadingsSentInUtilts:false}})).toMatchObject({status:'required',decisionPhase:'pre_wire_readings_aggregate'})
    expect(resolveProdatDependentCondition({messageCode:'Z04',fieldNumber:'214',facts:{meterReadingsSentInUtilts:true,byCell:{'Z04:214':true}}})).toMatchObject({status:'undetermined',decisionPhase:'pre_wire_readings_aggregate'})
  })
  it('rendered diagnostic resolves actual wire and rejects missing rendered object facts',()=>{
    const rendered=buildProfiledProdatSegments({context:{...context,dependentConditionFacts:facts(true),registers:[{annualConsumption:'1',meterConstant:'1',meterDigitCount:'6',meterTimeFrame:'111'}]},variant:'L'})
    expect(rendered.diagnostics.dependentConditionStatuses).toContainEqual(expect.objectContaining({fieldNumber:'214',status:'required',decisionPhase:'rendered_wire_readings'}))
    const missing=buildProfiledProdatSegments({context:{...context,meterPointId:'B',dependentConditionFacts:facts(true),registers:[{annualConsumption:'1',meterConstant:'1',meterDigitCount:'6',meterTimeFrame:'111'}]},variant:'L'})
    expect(missing.diagnostics.dependentConditionStatuses).toContainEqual(expect.objectContaining({fieldNumber:'214',status:'undetermined',decisionPhase:'rendered_wire_readings'}))
  })
  it('both builders report prohibited first values with independent false readings',()=>{
    const registers=[{annualConsumption:'1',meterConstant:'1'}]
    expect(buildProfiledProdatSegments({context:{...context,registers,dependentConditionFacts:facts(false)},variant:'L'}).issues.some(i=>i.severity==='error')).toBe(true)
    expect(()=>buildProdatMessage({...generic,registers,dependentConditionFacts:facts(false)})).toThrow(/fält 214/)
  })
  for(const alphabet of alphabets)for(const boundary of ['preflight','rulebook','transport'] as const)it(`${alphabet[0]}: ${boundary} protects false first readings before test override`,()=>{
    const body=[line('1','A'),qty('1'),...reason('Z22'),...measurement('214')]
    const m=row(body,facts(false));m.raw_payload=raw(body,'Z04',alphabet)
    const wire=input(m.raw_payload);m.parsed_payload={rulebookAllowInvalidSend:true,prodatEngine:{registerEvidence:createProdatRegisterEvidence({...wire,code:'Z04',facts:facts(false)})}}
    if(boundary==='preflight') expect(preflightEdielMessageRow(m,'send').issues.some(i=>i.code.startsWith('PRODAT_REGISTER_')&&i.severity==='error')).toBe(true)
    if(boundary==='rulebook') expect(()=>assertRulebookAllowsSend(m)).toThrow(/register/i)
    if(boundary==='transport') expect(()=>assertEdielSendLock(m)).toThrow(/register/i)
    expect(preflightEdielMessageRow({...m,direction:'inbound'},'parse').issues.some(i=>i.code.includes('UNDETERMINED'))).toBe(false)
  })
})

it('a missing production snapshot cannot hide a first-register reading violation from the protected rulebook gate',()=>{
  const m={...row([line('1','A'),qty('1'),...reason('Z22'),...measurement('214')],facts(false)),environment:'production' as const}
  expect(()=>assertRulebookAllowsSend(m)).toThrow(/register/i)
})

it('mixed E/F/G objects use their own reason and readings even under root F',()=>{
  const body=[line('1','A'),...reason('E34'),...measurement('214'),line('2','B'),...reason('E64'),...measurement('214','2'),...measurement('218','6'),...measurement('259','111'),line('3','C'),...reason('E32')]
  const f:ProdatDependentConditionFacts={market:'electricity',meterReadingsSentInUtilts:false,registerObjects:[fact('A',false),fact('B',true),fact('C',true)]}
  expect(check('Z06',body,f)).toEqual([])
  expect(check('Z06',body,{...f,registerObjects:[fact('A',false),fact('B',true),fact('C',null)]})).toContainEqual(expect.objectContaining({code:'PRODAT_DEPENDENT_CONDITION_UNDETERMINED',fieldPath:'CCI++Z16/CAV'}))
})

it.each(['E','G'])('rendered %s optional readings are not mislabeled required by the prewire readings aggregate',variant=>{
  const result=buildProfiledProdatSegments({context:{...context,code:'Z06',bilateralCapabilityVerified:true,dependentConditionFacts:facts(true),registers:[{}]},variant})
  for(const field of fields) expect(result.diagnostics.dependentConditionStatuses).toContainEqual(expect.objectContaining({fieldNumber:field,status:'not_required',decisionPhase:'rendered_wire_readings'}))
})

it('complete true reading evidence and own values pass the register part of both send guards',()=>{
  const m=row([line('1','A'),qty('1'),...reason('Z22'),...measurement('214'),...measurement('218','6'),...measurement('259','111')],facts(true))
  expect(preflightEdielMessageRow(m,'send').issues.filter(i=>i.code.startsWith('PRODAT_REGISTER_'))).toEqual([])
  expect(()=>assertRulebookAllowsSend(m)).not.toThrow()
  expect(()=>assertEdielSendLock(m)).not.toThrow()
})

it.each([undefined,null,2])('production fallback preserves independent258 count %s with complete reading fields',count=>{
  const m={...row([line('1','A'),qty('1'),...reason('Z22'),...measurement('214'),...measurement('218','6'),...measurement('259','111')],{market:'electricity',registerObjects:[{...fact('A',true),expectedRegisterCount:count}]}),environment:'production' as const}
  expect(()=>assertRulebookAllowsSend(m)).toThrow(/register/i)
})
