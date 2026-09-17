import { buildProdatDateSegments, resolveProdatDateInputs } from '@/lib/ediel/prodat/render/dateSegments'
import { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { canonicalMessageFacts } from '@/lib/ediel/core/canonicalEdifactAst'
import { prodatDateState } from '@/lib/ediel/prodat/prodatDateFields'
import { validateFieldMatrixPayload } from '@/lib/ediel/rulebook/fieldMatrix'
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer'
import { validateProdatContext } from '@/lib/ediel/prodat/render/validate'
import type { ProdatEngineProductionContext } from '@/lib/ediel/prodat/types'
import { buildProdatLineSegments } from '@/lib/ediel/testing/tgtEdifact.part-3'
import { getPortalData, date203FromPortalDate, buildZ09DLineDateSegments } from '@/lib/ediel/testing/tgtEdifact.part-2'
import { nowRefs, resolvePortalDateTime, type TgtPortalCustomerData, type EdielTgtDraftBuildParams } from '@/lib/ediel/testing/tgtEdifact.part-1'
import type { EdielTgtExpectedStep } from '@/lib/ediel/testing/tgtRegistry'

const message = (body: string[]) => ["UNA:+.? 'UNB+UNOC:3+12345:14+54321:14+260917:1200+I++23-DGI-PRODAT",'UNH+M+PRODAT:D:97A:UN:E2SE6A','BGM+Z04+DOC+9+AB','DTM+137:202609171200:203','DTM+ZZZ:1:805','LIN+1',...body,'UNT+1+M','UNZ+1+I'].join("'")+"'"
const context: ProdatEngineProductionContext = {code:'Z13',bgmReference:'DOC',transactionReference:'CASE',senderEdielId:'12345',receiverEdielId:'54321',meterPointId:'735999999999999999',customerId:'USR',customerName:'Synthetic User',customerIdAgency:'89',customerCountry:'SE',reasonForTransaction:'S18',permissionId:'PERMIT',permissionEndReason:'1'}
const params = {actorUserId:'user',testSuite:'PRODAT',roleCode:'supplier',testCaseCode:'SYNTHETIC-DTM',stepNo:1,systemTestContext:{companyId:'tenant-A',actorEdielId:'12345',testPortalEdielId:'54321'}} as EdielTgtDraftBuildParams
const portal = {source:'missing_test_data',testCustomerLabel:'synthetic',meteringPointId:'735999999999999999',agreementStartDateTime:'202610011230',agreementEndDateTime:'202612011245',annualEnergyUnit:'KWH',meteringMethod:'Z12',customerId:'USR',customerName:'Synthetic User',gridAreaId:'TES',registers:[]} as TgtPortalCustomerData
const step = (code:string) => ({code,family:'PRODAT',stepNo:1,actor:'gridex',direction:'outbound',outcome:'positive',title:'Synthetic'}) as EdielTgtExpectedStep
const build = (code: string, fields: Record<string,unknown>, variant='V') => buildProdatLineSegments({portalData:{...portal,...fields},step:step(code),refs:nowRefs('SYNTHETIC',1),transactionType:code+variant,mutation:{},lineNo:1,testSuite:'PRODAT',roleCode:'supplier',testCaseCode:'SYNTHETIC-DTM',systemTestContext:params.systemTestContext})
afterEach(()=>vi.useRealTimers())

describe('DTM final consumer boundaries use the same source identities', () => {
  for(const tail of ['++EXTRA','+','++']) it(`DTM cannot hide extra elements behind empty slots ${tail}`,()=>{
    expect(prodatDateState('210',[`LIN+1`,`DTM+92:202610011230:203${tail}`]).malformed).toBe(true)
  })
  for(const body of [ ['DTM+92:202602301230:203'],['DTM+92:20261001:102'],['DTM+92:202610011230:203','DTM+92:202610011231:203'] ]) it(`canonical facts exclude invalid or ambiguous DTM ${JSON.stringify(body)}`,()=>{
    expect(canonicalMessageFacts(message(body)).dtmValues['92']).toBeUndefined()
  })
  it('canonical facts do not promote an object-local message timestamp to header authority',()=>{
    expect(canonicalMessageFacts(message(['DTM+137:200001011200:203'])).dtmValues['137']).toEqual(['202609171200'])
  })
  it('matrix alone rejects a supplied optional date in the header scope',()=>{
    const rules=canonicalProdat26AFieldRules('Z04').filter(row=>row.fieldNumber==='212')
    const issues=validateFieldMatrixPayload({family:'PRODAT',code:'Z04',mode:'parse',rawSegments:['BGM+Z04+DOC+9+AB','DTM+51:202610011230:203','LIN+1']},rules)
    expect(issues.some(i=>i.severity==='error')).toBe(true)
  })
  it('historical context accepts explicit report fields instead of demanding legacy aliases',()=>{
    expect(validateProdatContext({...context,reportStartDate:'2026-08-01T12:30',reportEndDate:'2026-08-02T12:30'}).filter(i=>i.code.startsWith('prodat_z13vh_report_'))).toEqual([])
  })
  it('Z18 cannot treat startDate as permission end164',()=>{
    expect(validateProdatContext({...context,code:'Z18',startDate:'2026-10-01'}).some(i=>i.code==='prodat_z18_end_date_missing')).toBe(true)
  })
  it('profile validates the actual snapshot report dates instead of stale context aliases',()=>{
    const result=buildProfiledProdatSegments({context:{...context,startDate:'invalid',permissionEndDate:'invalid'},portalSnapshot:{reportStartDate:'202608011230',reportEndDate:'202608021230'},variant:'VH'})
    expect(result.segments).toContain('DTM+90:202608011230:203')
    expect(result.issues.filter(i=>i.code.startsWith('prodat_z13vh_report_'))).toEqual([])
  })
})

describe('legacy TGT renderer does not reintroduce discarded DTM aliases', () => {
  it('preserves contract clock in the actual TGT line builder',()=>expect(build('Z03',{})).toContain('DTM+92:202610011230:203'))
  it('uses validity157 for Z06 instead of contract92 and preserves a distinct supplied contract date',()=>{
    const result=build('Z06',{validityDateTime:'202609301245'},'F')
    expect(result).toContain('DTM+157:202609301245:203')
    expect(result).toContain('DTM+92:202610011230:203')
  })
  it('Z15 emits permission end164 and creation693, never contract93 or invented265',()=>{
    const result=build('Z15',{permissionEndDate:'202611151330',permissionTimestamp:'202609171230'})
    expect(result).toEqual(expect.arrayContaining(['DTM+164:202611151330:203','DTM+693:202609171230:203']))
    expect(result.some(s=>/^DTM\+(93|265):/.test(s))).toBe(false)
  })
  it('Z18 does not invent optional creation693 or copy contract dates to permission end164',()=>{
    const result=build('Z18',{permissionTimestamp:null,permissionEndDate:'202611151330'})
    expect(result).toContain('DTM+164:202611151330:203')
    expect(result.some(s=>s.startsWith('DTM+693:'))).toBe(false)
  })
  it('TGT negative Z14N carries no positive report or permission dates',()=>{
    const result=build('Z14',{reportStartDate:'202609171230',reportEndDate:'202609181230',permissionTimestamp:'202609171245'},'N')
    expect(result.some(s=>/^DTM\+(90|91|693|265):/.test(s))).toBe(false)
  })
  it('TGT historical values provided by source are not overwritten by generated dates',()=>{
    const result=build('Z13',{reportStartDate:'202508011245',reportEndDate:'202509011330'},'VH')
    expect(result).toEqual(expect.arrayContaining(['DTM+90:202508011245:203','DTM+91:202509011330:203']))
  })
  it('Z09D rejects simultaneous contract start and stop',()=>{
    expect(()=>buildZ09DLineDateSegments({...portal,prodatTransactionType:'Z09D'},nowRefs('SYNTHETIC',1))).toThrow()
  })
  it('TGT header205 uses fixed standard time, including summer day rollover',()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-07-01T23:30Z'))
    expect(nowRefs('SYNTHETIC',1,true)).toMatchObject({createdLongDate:'20260702',createdTime:'0030'})
  })
  for(const invalid of ['202602301230','2026010112','x20260101','2026-01-01junk','202601012499']) it(`invalid provided TGT date is never replaced by a default: ${invalid}`,()=>{
    expect(()=>date203FromPortalDate(invalid,'20261001')).toThrow()
    expect(()=>resolvePortalDateTime(invalid)).toThrow()
  })
  it('TGT lookup keeps report302/321, contract210/211 and permission327 distinct',()=>{
    const dates = [['210','avtal, startdatum','202610011230'],['211','avtal, slutdatum','202612011230'],['302','rapportstartdatum','202610021245'],['321','rapportslutdatum','202611151230'],['327','tjänsten/rapporteringen upphör','202611161245']]
    const columns=[{name:'object',index:0,sourceOrder:0,testCase:'SYNTHETIC-DTM'}]
    const fields=dates.map(([fieldCode,fieldName,value])=>({fieldCode,fieldName,values:{object:value}}))
    const block={kind:'PRODAT' as const,sourceWorkbook:'synthetic',sourceSheet:'synthetic',entityLabel:'Synthetic object',entityNumbers:['1'],columns,fields}
    const importedTestData={suite:'PRODAT' as const,roleCode:'supplier' as const,testCaseCode:'SYNTHETIC-DTM',title:'Synthetic DTM',sourceNote:'Synthetic data, not portal certification',groups:[{block,columns,fields}]}
    const data=getPortalData({...params,importedTestData},step('Z13'),'object')
    expect(data).toMatchObject({agreementStartDateTime:'202610011230',agreementEndDateTime:'202612011230',reportStartDate:'202610021245',reportEndDate:'202611151230',permissionEndDate:'202611161245'})
  })
})

// Subtype aliases must retain the same DTM applicability as canonical tokens.
describe('DTM subtype aliases use existing canonical subtype authority',()=>{
  for(const alias of ['N','Z14N']) it(`negative ${alias} does not emit positive reporting/permission dates`,()=>{
    const rendered=buildProdatDateSegments('Z14',alias,{reportStartDate:'202610011230',reportEndDate:'202611011230',permissionTimestamp:'202609171230',observationLength:'15',observationLengthFormat:'806'})
    expect(rendered.line).toEqual([])
  })
  for(const alias of ['D','Z09D']) it(`production-contract ${alias} uses92 not157 and preserves XOR`,()=>{
    const fields=resolveProdatDateInputs('Z09',alias,{startDate:'202610011230'})
    expect(buildProdatDateSegments('Z09',alias,fields).line).toEqual(['DTM+92:202610011230:203'])
    expect(()=>buildProdatDateSegments('Z09',alias,{contractStartDate:'202610011230',contractEndDate:'202611011230'})).toThrow()
  })
  it('Z04 requires its own observation length354 in addition to contract92',()=>{
    const result=buildProfiledProdatSegments({context:{...context,code:'Z04',reasonForTransaction:'Z22',contractStartDate:'202610011230'},variant:'L'})
    expect(result.issues.some(i=>i.severity==='error'&&i.description?.includes('354'))).toBe(true)
  })
})
