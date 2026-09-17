import { validateProdatDateFields } from '@/lib/ediel/prodat/prodatDateValidation'
import { validateProdat } from '@/lib/ediel/prodat/validateProdat'
import { validateEdielTgtDraft } from '@/lib/ediel/testing/tgtEdifact.part-4'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
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


// Review reproductions use source-defined field/subtype exclusions, independent
// of the implementation. Database/network calls are not used by these tests.
const dateReviewAlphabets = [[":", "+", "?", "'"], ['*', ';', '!', '~'], ['^', '|', '!', '%']] as const
const dateExclusions = [
  ['Z14', 'Z96', 'S17', '302', '90', '202610011230', '203'],
  ['Z14', 'Z96', 'S17', '321', '91', '202611011230', '203'],
  ['Z14', 'Z96', 'S17', '326', '693', '202609171230', '203'],
  ['Z14', 'Z96', 'S17', '508', '354', '15', '806'],
  ['Z09', 'Z70', 'E34', '216', '157', '202610011230', '203'],
  ['Z09', 'E34', 'Z70', '210', '92', '202610011230', '203'],
  ['Z09', 'E34', 'Z70', '211', '93', '202611011230', '203'],
] as const

function dateReviewWire(code: string, objects: readonly (readonly string[])[], alphabet: readonly string[] = dateReviewAlphabets[0]): string {
  const segments = ['UNH+M+PRODAT:D:97A:UN:E2SE6A', `BGM+${code}+DOCUMENT+9+AB`,
    'DTM+137:202609171200:203', 'DTM+ZZZ:1:805',
    'NAD+FR+12345:160:SVK+++++++SE', 'NAD+DO+54321:160:SVK+++++++SE',
    ...objects.flatMap((body, index) => [`LIN+${index + 1}++POINT${index + 1}:::9`, `RFF+LI:CASE${index + 1}`, ...body])]
  const raw = ['UNB+UNOC:3+12345:14+54321:14+260917:1200+I++23-DGI-PRODAT',
    ...segments, `UNT+${segments.length + 1}+M`, 'UNZ+1+I'].join("'") + "'"
  const replace: Record<string, string> = { ':': alphabet[0], '+': alphabet[1], '?': alphabet[2], "'": alphabet[3] }
  return `UNA${alphabet[0]}${alphabet[1]}.${alphabet[2]} ${alphabet[3]}` + raw.replace(/[:+?']/g, value => replace[value])
}
const dateReason = (reason: string): string[] => ['CCI++Z13', `CAV+${reason}`]
function dateReviewIssues(code: string, raw: string) {
  const wire = tokenizeEdifact(raw)
  return validateProdatDateFields(code, wire.segments, wire.una)
}
const isDateExclusion = (issue: { code: string; fieldPath?: string | null }, qualifier: string) =>
  issue.code === 'FIELD_MATRIX_FORBIDDEN_FIELD_PRESENT' && issue.fieldPath === `DTM+${qualifier}`

describe('DTM review: subtype exclusions apply to actual validators, not just renderers', () => {
  for (const [code, forbiddenReason, allowedReason, field, qualifier, value, format] of dateExclusions) {
    for (const alphabet of dateReviewAlphabets) {
      const label = `${code}/${forbiddenReason}/${field}/${alphabet.join('')}`
      const date = `DTM+${qualifier}:${value}:${format}`
      it(`rejects present forbidden field ${label}`, () => {
        const issues = dateReviewIssues(code, dateReviewWire(code, [[...dateReason(forbiddenReason), date]], alphabet))
        expect(issues.some(issue => isDateExclusion(issue, qualifier) && issue.blocking)).toBe(true)
      })
      it(`preserves allowed date as a positive control ${label}`, () => {
        expect(dateReviewIssues(code, dateReviewWire(code, [[...dateReason(allowedReason), date]], alphabet))).toEqual([])
      })
      it(`canonical matrix also enforces the subtype ${label}`, () => {
        const wire = tokenizeEdifact(dateReviewWire(code, [[...dateReason(forbiddenReason), date]], alphabet))
        const rules = canonicalProdat26AFieldRules(code).filter(rule => rule.fieldNumber === field)
        const issues = validateFieldMatrixPayload({ family: 'PRODAT', code, rawSegments: wire.segments.map(row => row.raw), una: wire.una, mode: 'parse' }, rules)
        expect(issues.some(issue => isDateExclusion(issue, qualifier))).toBe(true)
      })
    }
    it(`legacy validator, TGT and preflight all block ${code}/${field}`, () => {
      const raw = dateReviewWire(code, [[...dateReason(forbiddenReason), `DTM+${qualifier}:${value}:${format}`]])
      expect(validateProdat(raw).issues.some(issue => issue.code === 'prodat_date_structure_invalid' && issue.message.includes(`DTM+${qualifier}`))).toBe(true)
      expect(validateEdielTgtDraft(raw, step(code)).some(issue => issue.code === 'prodat_date_invalid' && issue.description?.includes(`DTM+${qualifier}`))).toBe(true)
      expect(preflightEdielPayload({ rawPayload: raw, messageStandard: 'edifact', mode: 'send' }).issues.some(issue => issue.code === 'FIELD_MATRIX_FORBIDDEN_FIELD_PRESENT' && issue.description.includes(`DTM+${qualifier}`))).toBe(true)
    })
  }
  for (const alphabet of dateReviewAlphabets) {
    it(`later negative object does not escape exclusion ${alphabet.join('')}`, () => {
      const raw = dateReviewWire('Z14', [[...dateReason('S17'), 'DTM+90:202610011230:203'], [...dateReason('Z96'), 'DTM+90:202610011230:203']], alphabet)
      expect(dateReviewIssues('Z14', raw).filter(issue => isDateExclusion(issue, '90'))).toHaveLength(1)
    })
    it(`a negative first object cannot forbid a positive second object's date ${alphabet.join('')}`, () => {
      expect(dateReviewIssues('Z14', dateReviewWire('Z14', [dateReason('Z96'), [...dateReason('S17'), 'DTM+90:202610011230:203']], alphabet))).toEqual([])
    })
    it(`a later message cannot supply subtype authority ${alphabet.join('')}`, () => {
      const first = dateReviewWire('Z14', [[...dateReason('S17'), 'DTM+90:202610011230:203']], alphabet)
      const second = dateReviewWire('Z14', [[...dateReason('Z96'), 'DTM+90:202610011230:203']], alphabet)
      expect(dateReviewIssues('Z14', first + second.slice(9))).toEqual([])
    })
    it(`date-only validation does not invent a missing subtype or require every national D field ${alphabet.join('')}`, () => {
      expect(dateReviewIssues('Z09', dateReviewWire('Z09', [['DTM+92:202610011230:203']], alphabet))).toEqual([])
      expect(dateReviewIssues('Z14', dateReviewWire('Z14', [dateReason('S17')], alphabet))).toEqual([])
    })
  }
})

describe('DTM review: explicit snapshot null is authoritative, not an absent alias', () => {
  const values = ['contractStartDate', 'contractEndDate', 'validityStartDate', 'firstMeterReadingDate',
    'birthDate', 'reportStartDate', 'reportEndDate', 'permissionTimestamp', 'permissionEndDate', 'observationLength'] as const
  for (const key of values) {
    it(`does not restore cleared snapshot ${key} from context`, () => {
      const source = { [key]: key === 'observationLength' ? '15' : '202610011230' }
      expect(resolveProdatDateInputs('Z14', 'S17', source, { [key]: null })[key]).toBeNull()
    })
    it(`retains source compatibility only when snapshot ${key} is undefined`, () => {
      const source = { [key]: key === 'observationLength' ? '15' : '202610011230' }
      expect(resolveProdatDateInputs('Z14', 'S17', source, { [key]: undefined })[key]).toBe(source[key])
    })
  }
  it('a primary cleared snapshot value cannot fall through to a stale legacy alias in the same snapshot', () => {
    expect(resolveProdatDateInputs('Z13', 'VH', { startDate: '202610011230' }, { reportStartDate: null, startDate: '202610021230' }).reportStartDate).toBeNull()
  })
  it('a cleared primary context value cannot fall through to a legacy alias either', () => {
    expect(resolveProdatDateInputs('Z13', 'VH', { reportStartDate: null, startDate: '202610011230' }).reportStartDate).toBeNull()
  })
  it('a primary valid snapshot date retains priority over a lower-priority null alias', () => {
    expect(resolveProdatDateInputs('Z13', 'VH', {}, { reportStartDate: '202610011230', startDate: null }).reportStartDate).toBe('202610011230')
  })
  it('only own snapshot fields supply date authority', () => {
    const inherited = Object.create({ reportStartDate: '202610021230' }) as Record<string, unknown>
    expect(resolveProdatDateInputs('Z13', 'VH', { reportStartDate: '202610011230' }, inherited).reportStartDate).toBe('202610011230')
  })
  for (const value of [false, 0, {}, []]) {
    it(`does not silently replace invalid snapshot types: ${JSON.stringify(value)}`, () => {
      expect(() => resolveProdatDateInputs('Z13', 'VH', { startDate: '202610011230' }, { reportStartDate: value })).toThrow('prodat_date_input_invalid:reportStartDate')
    })
  }
  it('the actual historical builder cannot restore cleared report90/91 from stale context aliases', () => {
    const result = buildProfiledProdatSegments({ context: { ...context, startDate: '202608011230', permissionEndDate: '202608021230' },
      portalSnapshot: { reportStartDate: null, reportEndDate: null }, variant: 'VH' })
    expect(result.segments.some(segment => /^DTM\+(90|91):/.test(segment))).toBe(false)
    expect(result.issues.some(issue => issue.code === 'prodat_z13vh_report_start_missing')).toBe(true)
    expect(result.issues.some(issue => issue.code === 'prodat_z13vh_report_end_missing')).toBe(true)
  })
  it('the actual Z18 builder keeps cleared required termination164 missing', () => {
    const result = buildProfiledProdatSegments({ context: { ...context, code: 'Z18', reasonForTransaction: 'S17', permissionEndDate: '202610011230' },
      portalSnapshot: { permissionEndDate: null }, variant: 'V' })
    expect(result.segments.some(segment => segment.startsWith('DTM+164:'))).toBe(false)
    expect(result.issues.some(issue => issue.code === 'prodat_z18_end_date_missing')).toBe(true)
  })
  it('the actual Z04 builder keeps cleared required observation354 missing', () => {
    const result = buildProfiledProdatSegments({ context: { ...context, code: 'Z04', reasonForTransaction: 'Z22', contractStartDate: '202610011230', observationLength: '15', observationLengthFormat: '806' },
      portalSnapshot: { observationLength: null }, variant: 'L' })
    expect(result.segments.some(segment => segment.startsWith('DTM+354:'))).toBe(false)
    expect(result.issues.some(issue => issue.severity === 'error' && issue.description?.includes('354'))).toBe(true)
  })
})
