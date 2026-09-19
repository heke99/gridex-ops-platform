import {qualifyDateEventTestRow,changeDateFact} from './fixtures/prodat-date-events'
import {evaluateEdielProductionSendLock} from '@/lib/ediel/core/productionGuards'
import { ud, udInvoiceeFact, udAddressFact } from './fixtures/prodat-ud'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveProdatDependentCondition } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { prodatProductMarket } from '@/lib/ediel/rulebook/prodatProductScope'
import { PRODAT_SOURCE_SUBTYPE_REQUIREMENTS } from '@/lib/ediel/prodat/prodatSubtypeRequirement'
import { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { validateProdatSubtypePayload } from '@/lib/ediel/rulebook/prodatSubtypePolicy'
import { validateEdielMessageRowWithRulebook } from '@/lib/ediel/rulebook/validator'
import { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { assertEdielSendLock } from '@/lib/ediel/transport/sendLock'
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { alphabets, characteristic, input, line, qty, raw, type Parts } from './fixtures/prodat-register'

// Independent oracle: retained P26.A r3 field242 note p20, C889 table p68,
// electricity product table p69, field311 p16. The literal conditional-cell
// expression alone omits the EL qualification and must not be the sole oracle.
const products = ['L639Q','L640Q','L654Q','L917','L633Q','L634Q','L635Q','L636Q','L637Q','L638Q','L641Q','L642Q','L651Q','L652Q','L653Q']
const product = (value = 'L639Q', position = 3) => characteristic('Z14', value, position)
const reason = (value = 'E64') => characteristic('Z13', value)
const target = (issue: {scope?: string; code: string; description: string; fieldPath?: string | null}) =>
  (issue.scope === 'prodat_dependent' && issue.description.includes('Z06:242')) ||
  (issue.code.startsWith('PRODAT_DEPENDENT_PREFLIGHT_') && issue.description.includes('Z06:242'))
const blockers = (issues: {scope?: string; code: string; description: string; fieldPath?: string | null; blocking?: boolean; severity: string}[]) =>
  issues.filter(issue => target(issue) && (issue.blocking || issue.severity === 'error'))
const policy = resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z06',subtypeOrReasonCode:'E',direction:'outbound',referenceDate:'2026-09-18',mode:'catalog_evidence'})
function check(body: Parts[], alphabet: readonly string[] = alphabets[0], scope: 'payload' | 'all' | 'dependent_only' = 'payload', reference = '23-DDQ-PRODAT') {
  const wire = input(raw(body, 'Z06', alphabet).replace('23-DDQ-PRODAT', reference), 'Z06')
  if (scope === 'payload') return blockers(validateProdatSubtypePayload({...wire, applicationReference:'23-DDQ-PRODAT'}))
  const forged = {...policy, fieldRules:canonicalProdat26AFieldRules('Z06').filter(rule => rule.fieldNumber === '242'),
    prodatDependentConditions:policy.prodatDependentConditions.map(condition => ({...condition,status:'not_required' as const})),
    prodatDependentFacts:{canonicalSubtype:'E',market:'electricity' as const,byCell:{'Z06:242':false}}}
  return blockers(validateCanonicalPolicyFields({policy:forged, rawSegments:wire.rawSegments, una:wire.una, scope}))
}

describe('PC-242-Z06 source and explicit-facts boundary', () => {
  it('preserves the full original note, locator, table and conditional expression', () => {
    const fields = JSON.parse(readFileSync('docs/ediel/masterplan-v2/registers/prodat_fields.json','utf8')) as {field:string;notes:string;locator:string;usage:Record<string,string>}[]
    const cells = JSON.parse(readFileSync('docs/ediel/masterplan-v2/registers/prodat_conditional_cells.json','utf8')) as {id:string;when:string;when_true:string;when_false:string}[]
    const tables = JSON.parse(readFileSync('docs/ediel/masterplan-v2/annex/source_tables.json','utf8')) as {source:string;page:number;table:number;rows:(string|null)[][]}[]
    const field = fields.find(row => row.field === '242')!
    expect(field.usage.Z06).toBe('D')
    expect(field.notes).toContain('Z06: Endast elmarknaden.')
    expect(field.notes).toContain('Frivillig i Z06E.')
    expect(field.locator).toBe('SG14/CCI[C502/6313=Z14] → CAV/C889/7110[1]')
    expect(cells.find(row => row.id === 'PC-242-Z06')).toMatchObject({when:'subtype IN (F,G)',when_true:'R',when_false:'O'})
    expect(tables.find(row => row.source === 'P' && row.page === 69 && row.table === 1)!.rows.slice(1).map(row => row[0])).toEqual(products)
    expect(tables.filter(row => row.source === 'P' && row.page === 16).some(row => JSON.stringify(row.rows).includes('27-DDQ-PRODAT'))).toBe(true)
  })
  for (const [subtype,expected] of [['F','required'],['G','required'],['E','optional']] as const) {
    it(`${subtype}: determines EL outcome without operator flags`, () => {
      for (const flag of [undefined,true,false,null]) {
        expect(resolveProdatDependentCondition({messageCode:'Z06',fieldNumber:'242',facts:{canonicalSubtype:subtype,market:'electricity',byCell:{'Z06:242':flag}}})?.requirement).toBe(expected)
      }
    })
  }
  it('does not activate an EL rule for gas, unknown market or invalid subtype', () => {
    for (const market of [undefined,null,'gas','EL',false,{}]) for (const flag of [true,false]) {
      expect(resolveProdatDependentCondition({messageCode:'Z06',fieldNumber:'242',facts:{canonicalSubtype:'F',market:market as 'gas',byCell:{'Z06:242':flag}}})?.requirement).toBe('undetermined')
    }
    for (const subtype of [null,'','Z70','D','E64','V',false,{}]) {
      expect(resolveProdatDependentCondition({messageCode:'Z06',fieldNumber:'242',facts:{canonicalSubtype:subtype as string,market:'electricity',byCell:{'Z06:242':true}}})?.requirement).toBe('undetermined')
    }
  })
  it('freezes the added source authority and leaves Z10 unresolved', () => {
    const row = PRODAT_SOURCE_SUBTYPE_REQUIREMENTS.find(row => row.messageCode === 'Z06' && row.fieldNumber === '242')
    expect(row).toBeDefined(); expect(Object.isFrozen(row)).toBe(true); expect(Object.isFrozen(row!.outcomes)).toBe(true)
    expect(resolveProdatDependentCondition({messageCode:'Z10',fieldNumber:'242',facts:{market:'electricity'}})?.status).toBe('undetermined')
  })
})

for (const alphabet of alphabets) for (const scope of ['payload','all','dependent_only'] as const) {
  describe(`${alphabet.join('')} / ${scope}: actual product scope`, () => {
    it('requires F/G, permits absent E, and accepts every source EL product', () => {
      for (const code of ['E64','E32']) {
        expect(check([line('1','A'),...reason(code)],alphabet,scope).length).toBeGreaterThan(0)
        for (const value of products) expect(check([line('1','A'),...reason(code),...product(value)],alphabet,scope)).toEqual([])
      }
      expect(check([line('1','A'),...reason('E34')],alphabet,scope)).toEqual([])
      expect(check([line('1','A'),...reason('E34'),...product()],alphabet,scope)).toEqual([])
    })
    it('rejects invalid, gas, generic energy, future and overlong product values even for E', () => {
      for (const code of ['E64','E32','E34']) for (const value of ['', '   ','6109','6113','8716867000030','L999Q','L639', 'x'.repeat(36)]) {
        expect(check([line('1','A'),...reason(code),...product(value)],alphabet,scope).length).toBeGreaterThan(0)
      }
    })
    it('cannot use coded7111 or second7110 as product, nor carry the forbidden energy sibling', () => {
      for (const code of ['E64','E34']) for (const parts of [
        ...[0,1,2,4].map(position => product('L639Q',position)),
        [['CCI','','Z14'],['CAV',['','','','L639Q','8716867000030']]] as Parts[],
        [['CCI','','Z14'],['CAV',['','','','L639Q','','EXTRA']]] as Parts[],
        [['CCI','','Z14']] as Parts[],
      ]) expect(check([line('1','A'),...reason(code),...parts],alphabet,scope).length).toBeGreaterThan(0)
    })
    it('rejects unused CCI/CAV data and extra CAVs even beside a valid product', () => {
      for (const pair of [
        [['CCI','EX','Z14'],['CAV',['','','','L639Q']]],
        [['CCI','',['Z14','EX']],['CAV',['','','','L639Q']]],
        [['CCI','','Z14','EX'],['CAV',['','','','L639Q']]],
        [['CCI','','Z14'],['CAV',['','','','L639Q'],'EX']],
        [...product(),['CAV',['','','','L640Q']]],
      ] as Parts[][]) expect(check([line('1','A'),...reason('E34'),...pair],alphabet,scope).length).toBeGreaterThan(0)
      // Empty trailing elements and a bounded agency are not populated X fields.
      expect(check([line('1','A'),...reason(),['CCI','',['Z14','',''],''],['CAV',['','','9','L639Q','',''],'']],alphabet,scope)).toEqual([])
    })
    it('validates supplied measuring/settlement compatibility from P69 without inventing missing G/E facts', () => {
      for (const value of products) {
        const methods = value === 'L917' ? ['Z01','Z04'] : ['Z04']
        const settlement = value === 'L917' ? 'Z31' : 'Z32'
        for (const method of methods) expect(check([line('1','A'),...reason(),...product(value),...characteristic('Z04',method),...characteristic('Z15',settlement)],alphabet,scope)).toEqual([])
        expect(check([line('1','A'),...reason(),...product(value),...characteristic('Z04','Z03')],alphabet,scope).length).toBeGreaterThan(0)
        expect(check([line('1','A'),...reason(),...product(value),...characteristic('Z15',settlement === 'Z31' ? 'Z32' : 'Z31')],alphabet,scope).length).toBeGreaterThan(0)
      }
      for (const details of [
        [...characteristic('Z04','Z04'),...characteristic('Z04','Z01')],
        [['CCI','','Z04']],
        [['NAD','UD','CUSTOMER'],...characteristic('Z04','Z04')],
        [...characteristic('Z15','Z32'),...characteristic('Z15','Z31')],
      ] as Parts[][]) expect(check([line('1','A'),...reason(),...product(),...details],alphabet,scope).length).toBeGreaterThan(0)
      // G/E do not acquire a requirement to supply independent optional context.
      for (const code of ['E32','E34']) expect(check([line('1','A'),...reason(code),...product('L917')],alphabet,scope)).toEqual([])
      expect(check([line('1','A'),...reason(),...product(),...characteristic('Z04','Z04'),...characteristic('Z15','Z32'),line('2','B'),...reason(),...product('L917'),...characteristic('Z15','Z31')],alphabet,scope)).toEqual([])
    })
    it('uses only a unique actual first-register reason, not snapshot E or misplaced reasons', () => {
      for (const parts of [[], reason('F'),reason('Z70'),reason('BAD'),[...reason(),...reason()],
        [['RFF',['LI','CASE']],...reason()] as Parts[], [['NAD','UD','CUSTOMER'],...reason()] as Parts[]]) {
        expect(check([line('1','A'),...parts,...product()],alphabet,scope).some(issue => issue.code === 'PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(true)
      }
    })
    it('rejects header, party, post-reference and later-register products rather than hiding them', () => {
      for (const body of [
        [...product(),line('1','A'),...reason('E34')],
        [...product(),line('1','A'),...reason(),...product()],
        [line('1','A'),...reason(),...product(),['NAD','UD','CUSTOMER'],...product()],
        [line('1','A'),...reason(),['RFF',['LI','CASE']],...product()],
        [line('1','A','1'),...reason('E34'),line('2','A','2'),...product()],
        [line('1','A','1'),...reason(),...product(),line('2','A','2'),...product()],
        [line('1','A'),...reason(),...product(),...product()],
      ] as Parts[][]) expect(check(body,alphabet,scope).length).toBeGreaterThan(0)
      expect(check([line('1','A','1'),...reason(),...product(),line('2','A','2')],alphabet,scope)).toEqual([])
    })
    it('does not borrow values or optionality across objects, agencies or invalid register chains', () => {
      for (const pair of [['A','B','89','89'],['A','A','9','89']]) {
        const errors = check([line('1',pair[0],undefined,pair[2]),...reason(),...product(),line('2',pair[1],undefined,pair[3]),...reason()],alphabet,scope)
        expect(errors.length).toBeGreaterThan(0); expect(errors.some(issue => issue.description.includes(`${pair[1]} / ${pair[3]}`))).toBe(true)
      }
      expect(check([line('1','A','1'),...reason(),line('2','A','2'),...reason('E34'),...product()],alphabet,scope).length).toBeGreaterThan(0)
      expect(check([line('1','A','1'),...reason(),...product(),line('2','A','3'),...reason()],alphabet,scope).length).toBeGreaterThan(0)
    })
    it('derives market from the actual UNB, never an EL snapshot or product presence', () => {
      for (const reference of ['27-DDQ-PRODAT','23-DDQ-UTILTS','','INVALID']) {
        expect(check([line('1','A'),...reason(),...product()],alphabet,scope,reference).some(issue => issue.code === 'PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(true)
      }
    })
  })
}

function row(body: Parts[], environment: 'test' | 'production', alphabet: readonly string[], reference = '23-DDQ-PRODAT'): EdielMessageRow {
  // Keep independent register/previous-D prerequisites real, not waived. All
  // three subtypes permit these common fields; only field242 is under test.
  const wireBody = body.flatMap((part): Parts[] => part[0] === 'LIN' ? [part,qty('1'),['DTM',['354','15','806']],
    ...characteristic('Z04','Z04'),...characteristic('Z07','E22'),...characteristic('Z15','Z32')] : [part])
  const payload = raw(wireBody,'Z06',alphabet).replace('23-DDQ-PRODAT',reference)
  const wire = input(payload,'Z06')
  const evidence = createProdatRegisterEvidence({code:'Z06',rawSegments:wire.rawSegments,una:wire.una,facts:{market:'electricity',endUserAddressObjects:[udAddressFact()],invoiceeObjects:[udInvoiceeFact()],
    registerObjects:[{meteringPointId:'A',identityAgency:'89',expectedRegisterCount:1,meterReadingsSentInUtilts:false}]}})
  const synthetic: Partial<EdielMessageRow> = {message_family:'PRODAT',message_code:'Z06',message_version:'26A',direction:'outbound',environment,message_standard:'edifact',
    application_reference:'23-DDQ-PRODAT',company_id:'synthetic-company',raw_payload:payload,mime_type:'application/EDIFACT',validation_report:{systemTestAckSend:{enabled:true,source:'system_test_ack_action'}},
    parsed_payload:{rulebookAllowInvalidSend:true,prodatEngine:{registerEvidence:evidence,dependentConditionStatuses:policy.prodatDependentConditions.map(c => ({...c,status:'not_required'}))}}}
  // Explicit partial persistence boundary: live-readiness fields are deliberately
  // absent, and the production positive control must remain blocked by that guard.
  return synthetic as EdielMessageRow
}
for (const environment of ['test','production'] as const) for (const alphabet of alphabets) {
  describe(`${environment}/${alphabet.join('')}: protected real outbound boundaries`, () => {
    for (const [name,body,reference] of [
      ['missing F product',[line('1','A'),...reason()]],
      ['missing G product',[line('1','A'),...reason('E32')]],
      ['gas value on E',[line('1','A'),...reason('E34'),...product('6109')]],
      ['energy in product slot',[line('1','A'),...reason(),...product('8716867000030')]],
      ['energy sibling despite valid product',[line('1','A'),...reason(),['CCI','','Z14'],['CAV',['','','','L639Q','8716867000030']]]],
      ['header product',[...product(),line('1','A'),...reason('E34')]],
      ['party product',[line('1','A'),...reason('E34'),['NAD','UD','C'],...product()]],
      ['gas envelope',[line('1','A'),...reason(),...product()],'27-DDQ-PRODAT'],
      ['missing market',[line('1','A'),...reason(),...product()],''],
    ] as [string,Parts[],string?][]) it(name, () => {
      const message = row(body,environment,alphabet,reference)
      for (const override of [false,true]) {
        message.parsed_payload = {...message.parsed_payload,rulebookAllowInvalidSend:override}
        const result = validateEdielMessageRowWithRulebook(message,'send')
        const registerIssues = result.issues.filter(issue => issue.scope === 'prodat_register' && (issue.blocking || issue.severity === 'error'))
        // Source259 also needs actual market context now. The missing-market
        // control still independently proves242 below; no register fact may
        // invent the absent UNB market or suppress either protected diagnostic.
        if (name === 'missing market') expect(registerIssues).toEqual([
          expect.objectContaining({code:'PRODAT_DEPENDENT_CONDITION_UNDETERMINED',fieldPath:'CCI++Z16/CAV',blocking:true}),
        ])
        else expect(registerIssues).toEqual([])
        expect(blockers(result.issues).length).toBeGreaterThan(0)
        expect(() => assertRulebookAllowsSend(message)).toThrow(/Z06:242/)
        expect(blockers(preflightEdielMessageRow(message,'send').issues).length).toBeGreaterThan(0)
        expect(() => assertEdielSendLock(message)).toThrow(/Z06:242/)
      }
    })
    it('stale persisted code/family cannot hide a missing product', () => {
      const message = row([line('1','A'),...reason()],environment,alphabet)
      message.message_family = 'UTILTS'; message.message_code = 'Z04'
      expect(blockers(validateEdielMessageRowWithRulebook(message,'send').issues).length).toBeGreaterThan(0)
      expect(() => assertRulebookAllowsSend(message)).toThrow(/Z06:242/)
      expect(() => assertEdielSendLock(message)).toThrow(/Z06:242/)
    })
    for (const code of ['E64','E32','E34']) it(`bounded positive ${code}`, () => {
      const message = row([line('1','A'),...reason(code),...(code === 'E34' ? [ud()] : product())],environment,alphabet)
      const dateContext=environment==='test'?qualifyDateEventTestRow(message):undefined
      const result=validateEdielMessageRowWithRulebook(message,'send',dateContext)
      const preflight=preflightEdielMessageRow(message,'send',dateContext)
      expect(blockers(result.issues)).toEqual([])
      expect(blockers(preflight.issues)).toEqual([])
      if(environment==='test'){
        expect(result.issues.filter(issue=>issue.scope==='prodat_dependent')).toEqual([])
        expect(()=>assertRulebookAllowsSend(message,dateContext)).not.toThrow()
        expect(()=>assertEdielSendLock(message,dateContext)).not.toThrow()
      }else{
        expect(result.issues).toContainEqual(expect.objectContaining({scope:'prodat_dependent',code:'PRODAT_DATE_EVENT_SOURCE_UNQUALIFIED',blocking:true}))
        expect(()=>assertRulebookAllowsSend(message)).toThrow('PRODAT_DATE_EVENT_SOURCE_UNQUALIFIED')
        expect(()=>assertEdielSendLock(message)).toThrow('PRODAT_DATE_EVENT_SOURCE_UNQUALIFIED')
        expect(evaluateEdielProductionSendLock(message,preflight).issues.some(i=>i.message.includes('Produktionsmeddelande saknar'))).toBe(true)
      }
    })
  })
}
it('retains inbound syntax-only preflight and does not turn a local unknown into an outbound error', () => {
  const message = {...row([line('1','A'),...reason()],'test',alphabets[0]),direction:'inbound' as const}
  expect(blockers(preflightEdielMessageRow(message,'parse').issues)).toEqual([])
  expect(() => assertRulebookAllowsSend(message)).not.toThrow()
})

describe('Z06 product market authority and detached-builder boundary', () => {
  for (const alphabet of alphabets) it(`${alphabet.join('')}: scopes the original UNB and refuses missing/ambiguous evidence`, () => {
    const wire = input(raw([line('1','A'),...reason('E34')],'Z06',alphabet),'Z06')
    const ref = {applicationReference:'23-DDQ-PRODAT'}
    const unb = wire.rawSegments[0]
    const unhIndex = wire.rawSegments.findIndex(segment => segment.startsWith('UNH'))
    for (const segments of [
      wire.rawSegments.slice(1),
      [unb,...wire.rawSegments],
      [...wire.rawSegments.slice(1),unb],
      [...wire.rawSegments.slice(1,unhIndex+1),unb,...wire.rawSegments.slice(unhIndex+1)],
      [unb.replace('23-DDQ-PRODAT','27-DDQ-PRODAT'),...wire.rawSegments.slice(1),...wire.rawSegments],
    ]) {
      const candidate = {...wire,...ref,rawSegments:segments}
      expect(prodatProductMarket(candidate)).toBeNull()
      expect(blockers(validateProdatSubtypePayload(candidate)).some(issue => issue.code === 'PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(true)
    }
    const detached = {...wire,rawSegments:wire.rawSegments.filter(segment => ['LIN','CCI','CAV'].some(tag => segment.startsWith(tag)))}
    expect(prodatProductMarket(detached)).toBeNull()
    expect(prodatProductMarket({...detached,...ref})).toBe('electricity')
    expect(blockers(validateProdatSubtypePayload({...detached,...ref}))).toEqual([])
    expect(prodatProductMarket({...detached,applicationReference:'27-DDQ-PRODAT'})).toBeNull()
    expect(prodatProductMarket({...detached,...ref,rawSegments:['BGM'+alphabet[1]+'Z06',...detached.rawSegments]})).toBeNull()
    // A later gas message cannot change the first message's EL interpretation;
    // the independent outbound one-message gate remains responsible for rejection.
    expect(prodatProductMarket({...wire,rawSegments:[...wire.rawSegments,...wire.rawSegments.map(segment => segment.replace('23-DDQ-PRODAT','27-DDQ-PRODAT'))]})).toBe('electricity')
  })
})
