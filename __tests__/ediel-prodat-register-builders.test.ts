import { selectedAddressFact, selectedInvoiceeFact } from './fixtures/prodat-ud'
import { describe, expect, it } from 'vitest'
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer'
import { buildProdatMessage, type BuildProdatMessageInput } from '@/lib/ediel/prodat/buildProdat'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import type { ProdatEngineProductionContext } from '@/lib/ediel/prodat/types'

const registers = [{annualConsumption:'10',meterConstant:'1',meterDigitCount:'6',meterTimeFrame:'111'}, {annualConsumption:'20',meterConstant:'3',meterDigitCount:'7',meterTimeFrame:'112'}]
const facts = {endUserAddressObjects:[selectedAddressFact('735999999999999999','tenant','9','USR')],invoiceeObjects:[selectedInvoiceeFact('735999999999999999','tenant','9','USR')],market:'electricity' as const,meterReadingsSentInUtilts:true,multipleMeterRegisters:true,
  registerObjects:[{meteringPointId:'735999999999999999',identityAgency:'9' as const,expectedRegisterCount:2,meterReadingsSentInUtilts:true}]}
const context: ProdatEngineProductionContext = {code:'Z04',bgmReference:'D',transactionReference:'CASE',senderEdielId:'12345',receiverEdielId:'54321',meterPointId:'735999999999999999',customerId:'USR',customerName:'Synthetic',customerIdAgency:'89',gridAreaId:'TES',startDate:'202610010000',observationLength:'15',observationLengthFormat:'806',reasonForTransaction:'Z22',dependentConditionFacts:facts}
const request: BuildProdatMessageInput = {companyId:'tenant',role:'supplier',businessCode:'Z04',transactionSubtype:'L',sender:{edielId:'12345'},receiver:{edielId:'54321'},meteringPoint:{id:'735999999999999999',gridArea:'TES'},customer:{id:'USR',name:'Synthetic',idAgency:'89'},dates:{contractStartDate:'202610010000',observationLength:'15',observationLengthFormat:'806'},references:{LI:'CASE'},codedAttributes:{Z13:'Z22'},environment:'test',dependentConditionFacts:facts}
const parsedSegments = (segments: string[]) => parseProdatMessage("UNH+M+PRODAT:D:97A:UN:E2SE6A'"+segments.join("'")+"'UNT+1+M'")

describe('one register emission path for generic and profiled PRODAT builders', () => {
  it.each(['', 'bad', 9, "9'LIN+999++OTHER:::89", '9:89'])('rejects invalid runtime object agency %s before interpolation', agency => {
    expect(() => buildProfiledProdatSegments({context:{...context,meterPointIdAgency:agency as never},variant:'L'})).toThrow(/agency/)
    expect(() => buildProdatMessage({...request,registers,meteringPoint:{...request.meteringPoint,identityAgency:agency as never}})).toThrow(/agency/)
  })
  it.each(['9','89',null,undefined])('retains supported/default object agency %s', agency => {
    const result=buildProfiledProdatSegments({context:{...context,meterPointIdAgency:agency as never},variant:'L'})
    expect(parsedSegments(result.segments).lineItems[0].identityAgency).toBe(agency ?? '9')
  })
  it.each(['UNMAPPED', 'Z25'])('rejects non-empty unknown or inapplicable coded attribute %s', code => {
    expect(() => buildProdatMessage({...request, registers, codedAttributes:{...request.codedAttributes,[code]:'BAD'}})).toThrow('prodat_coded_attribute_not_allowed')
  })
  it('ignores an empty unsupported attribute without emitting CCI/CAV', () => {
    const result=buildProdatMessage({...request,registers,codedAttributes:{...request.codedAttributes,UNMAPPED:''}})
    expect(result.rawEdifact).not.toContain('UNMAPPED')
  })

  it('profile emits every register, not only the first line', () => {
    const result = buildProfiledProdatSegments({context:{...context,registers},variant:'L'})
    expect(parsedSegments(result.segments).lineItems).toMatchObject([
      {lineSequenceNumber:'1',registerIndex:'1',annualConsumption:'10',meterConstant:'1',meterDigitCount:'6',meterTimeFrame:'111'},
      {lineSequenceNumber:'2',registerIndex:'2',annualConsumption:'20',meterConstant:'3',meterDigitCount:'7',meterTimeFrame:'112'},
    ])
    expect(result.segments.filter(s => s.startsWith('NAD+UD'))).toHaveLength(1)
    expect(result.segments.filter(s => s.startsWith('DTM+92'))).toHaveLength(1)
  })
  it('generic builder round trips the exact same register-local quantities', () => {
    const result = buildProdatMessage({...request,registers})
    expect(parseProdatMessage(result.rawEdifact).lineItems).toMatchObject([
      {registerIndex:'1',annualConsumption:'10',meterTimeFrame:'111'}, {registerIndex:'2',annualConsumption:'20',meterTimeFrame:'112'},
    ])
    expect(result.validation.ok).toBe(true)
  })
  it('generic multi-object builder increments 314 globally and restarts 258 locally', () => {
    const result = buildProdatMessage({...request,dependentConditionFacts:{...facts,endUserAddressObjects:[selectedAddressFact('A:+?','tenant','89','USR'),selectedAddressFact('B','tenant','89','USR')],invoiceeObjects:[selectedInvoiceeFact('A:+?','tenant','89','USR'),selectedInvoiceeFact('B','tenant','89','USR')],registerObjects:[
      {meteringPointId:'A:+?',identityAgency:'89',expectedRegisterCount:1,meterReadingsSentInUtilts:true},
      {meteringPointId:'B',identityAgency:'89',expectedRegisterCount:2,meterReadingsSentInUtilts:true},
    ]},objects:[
      {meteringPoint:{id:'A:+?',identityAgency:'89',gridArea:'TES'},dates:request.dates,references:{LI:'A'},codedAttributes:{Z13:'Z22'},customer:request.customer,registers:[registers[0]]},
      {meteringPoint:{id:'B',identityAgency:'89',gridArea:'TES'},dates:request.dates,references:{LI:'B'},codedAttributes:{Z13:'Z22'},customer:request.customer,registers},
    ]})
    expect(parseProdatMessage(result.rawEdifact).lineItems).toMatchObject([
      {meteringPointId:'A:+?',lineSequenceNumber:'1',registerIndex:null,annualConsumption:'10'},
      {meteringPointId:'B',lineSequenceNumber:'2',registerIndex:'1',annualConsumption:'10'},
      {meteringPointId:'B',lineSequenceNumber:'3',registerIndex:'2',annualConsumption:'20'},
    ])
  })
  for (const bad of [[],[registers[0],null],[{...registers[0],registerIndex:'1'},{...registers[1],registerIndex:'1'}],[{...registers[0],registerIndex:'1'},registers[1]],[{...registers[0],registerIndex:'1'}],[{...registers[0],annualConsumption:true}]]) {
    it(`rejects malformed inventory rather than filtering/repairing it ${JSON.stringify(bad)}`, () => {
      expect(() => buildProfiledProdatSegments({context,portalSnapshot:{registers:bad},variant:'L'})).toThrow()
    })
  }
  it('an explicit null snapshot inventory cannot fall through to stale context registers', () => {
    expect(() => buildProfiledProdatSegments({context:{...context,registers},portalSnapshot:{registers:null},variant:'L'})).toThrow()
  })
  it('a single register omits C829 even when register values are present', () => {
    const result = buildProfiledProdatSegments({context:{...context,registers:[registers[0]],dependentConditionFacts:{...facts,
      registerObjects:[{meteringPointId:'735999999999999999',identityAgency:'9',expectedRegisterCount:1,meterReadingsSentInUtilts:true}]}},variant:'L'})
    expect(parsedSegments(result.segments).lineItems).toMatchObject([{registerIndex:null,registerCount:1,annualConsumption:'10'}])
  })
  it('does not inherit missing annual energy from root context or register one', () => {
    const result = buildProfiledProdatSegments({context:{...context,annualConsumption:'999',registers:[registers[0],{meterConstant:'2',meterDigitCount:'6',meterTimeFrame:'112'}]},variant:'L'})
    expect(parsedSegments(result.segments).lineItems[1].annualConsumption).toBeNull()
    expect(result.issues.some(issue => issue.code.includes('213') || issue.code === 'PRODAT_DEPENDENT_FIELD_MISSING')).toBe(true)
  })
  it('does not serialize multiple registers for an unsupported PRODAT function', () => {
    expect(() => buildProfiledProdatSegments({context:{...context,code:'Z03',registers},variant:'L'})).toThrow(/register/)
  })
  it('compatibility snapshot aliases are read per row without losing zero values', () => {
    const result = buildProfiledProdatSegments({context,portalSnapshot:{registers:[
      {annualEnergyKwh:0,meterConstant:1,meterDigits:6,meterTimeInterval:'111'},
      {annualEnergyKwh:'20',meterConstant:'2',meterDigits:'7',meterTimeInterval:'112'},
    ]},variant:'L'})
    expect(parsedSegments(result.segments).lineItems).toMatchObject([{annualConsumption:'0',meterDigitCount:'6'},{annualConsumption:'20',meterDigitCount:'7'}])
  })
})
