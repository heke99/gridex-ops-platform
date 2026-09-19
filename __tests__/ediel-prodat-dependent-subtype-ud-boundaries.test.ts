import {deathSelection} from './fixtures/prodat-death-status'
import {qualifyDateEventTestRow,changeDateFact} from './fixtures/prodat-date-events'
import {evaluateEdielProductionSendLock} from '@/lib/ediel/core/productionGuards'
import { describe, expect, it } from 'vitest'
import { validateEdielMessageRowWithRulebook, validateRulebookMessage } from '@/lib/ediel/rulebook/validator'
import { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { assertEdielSendLock } from '@/lib/ediel/transport/sendLock'
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import { evaluateProdatDependentConditions } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { validateProdatSubtypePayload } from '@/lib/ediel/rulebook/prodatSubtypePolicy'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import { buildProdatMessage, type BuildProdatMessageInput } from '@/lib/ediel/prodat/buildProdat'
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer'
import type { ProdatEngineProductionContext } from '@/lib/ediel/prodat/types'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { alphabets, characteristic, input, line, qty, raw, type Parts } from './fixtures/prodat-register'
import { ud, udInvoiceeFact, udAddressFact, selectedAddressFact, selectedInvoiceeFact } from './fixtures/prodat-ud'
const reason = (code = 'E34') => characteristic('Z13',code)
const target = (i: {scope?:string;description:string;code:string}) =>
  (i.scope === 'prodat_dependent' || i.code.startsWith('PRODAT_DEPENDENT_PREFLIGHT_')) && /Z0[69]:(END_USER_GROUP|227|228|231|232|316)\b/.test(i.description)
function message(body: Parts[], code: 'Z06'|'Z09', environment: 'test'|'production', alphabet: readonly string[]): EdielMessageRow {
  // Real, independently required previous register/D data: tests may not pass
  // by failing an earlier unrelated guard instead of the new UD requirement.
  const wireBody = body.flatMap((part): Parts[] => part[0] === 'LIN' ? [part,
    ...(code === 'Z06' ? [qty('1'), ['DTM',['354','15','806']],...characteristic('Z04','Z04'),...characteristic('Z07','E22'),
      ...characteristic('Z15','Z32'),...characteristic('Z14','L639Q',3)] as Parts[] : [['DTM',['157','202610010000','203']]] as Parts[])] : [part])
  const payload = raw(wireBody,code,alphabet), wire = input(payload,code)
  const registerEvidence = createProdatRegisterEvidence({code,rawSegments:wire.rawSegments,una:wire.una,facts:{market:'electricity',endUserAddressObjects:[udAddressFact()],invoiceeObjects:[udInvoiceeFact()],
    registerObjects:[{meteringPointId:'A',identityAgency:'89',expectedRegisterCount:1,meterReadingsSentInUtilts:false}]}})
  const partial: Partial<EdielMessageRow> = {message_family:'PRODAT',message_code:code,message_version:'26A',direction:'outbound',environment,message_standard:'edifact',
    company_id:'synthetic-company',application_reference:'23-DDQ-PRODAT',raw_payload:payload,mime_type:'application/EDIFACT',
    validation_report:{systemTestAckSend:{enabled:true,source:'system_test_ack_action'}},
    parsed_payload:{rulebookAllowInvalidSend:true,prodatEngine:{registerEvidence,dependentConditionStatuses:
      evaluateProdatDependentConditions({messageCode:code,facts:{canonicalSubtype:'F',market:'electricity'}}).map(c=>({...c,status:'not_required'}))}}}
  return partial as EdielMessageRow // synthetic persistence fixture; not production authority
}
for (const code of ['Z06','Z09'] as const) for (const environment of ['test','production'] as const) for (const alphabet of alphabets) {
  describe(`${code}/${environment}/${alphabet.join('')}: real send boundaries`, () => {
    for (const [name,body] of [
      ['missing E group',[line('1','A'),...reason()]],
      ['missing city',[line('1','A'),...reason(),ud({6:''})]],
      ['wrong agency',[line('1','A'),...reason(),ud({2:['ID','SE2','89']})]],
      ['empty forbidden F group',[line('1','A'),...reason('E64'),['NAD','UD']]],
      ['header group beside valid object',[ud(),line('1','A'),...reason(),ud()]],
      ['duplicate group',[line('1','A'),...reason(),ud(),ud()]],
    ] as [string,Parts[]][]) it(name, () => {
      const row = message(body,code,environment,alphabet)
      for (const override of [false,true]) {
        row.parsed_payload = {...row.parsed_payload,rulebookAllowInvalidSend:override}
        const result = validateEdielMessageRowWithRulebook(row,'send')
        expect(result.issues.filter(i=>i.scope==='prodat_register'&&(i.blocking||i.severity==='error'))).toEqual([])
        expect(result.issues.some(i=>target(i)&&i.blocking&&i.severity==='error')).toBe(true)
        expect(()=>assertRulebookAllowsSend(row)).toThrow(/Z0[69]:(END_USER_GROUP|227|228|231|232|316)/)
        expect(preflightEdielMessageRow(row,'send').issues.some(i=>target(i)&&i.severity==='error')).toBe(true)
        expect(()=>assertEdielSendLock(row)).toThrow(/Z0[69]:(END_USER_GROUP|227|228|231|232|316)/)
      }
    })
    it('accepts the bounded E data while retaining independent production-readiness checks', () => {
      const row = message([line('1','A'),...reason(),ud()],code,environment,alphabet)
      const dateContext=code==='Z06'&&environment==='test'?qualifyDateEventTestRow(row):undefined
      const result=validateEdielMessageRowWithRulebook(row,'send',dateContext),preflight=preflightEdielMessageRow(row,'send',dateContext)
      expect(result.issues.filter(target)).toEqual([])
      expect(validateProdatSubtypePayload(input(row.raw_payload!,code))).toEqual([])
      expect(preflight.issues.filter(target)).toEqual([])
      if(code==='Z06'&&environment==='production'){
        expect(result.issues).toContainEqual(expect.objectContaining({scope:'prodat_dependent',code:'PRODAT_DATE_EVENT_SOURCE_UNQUALIFIED',blocking:true}))
        expect(()=>assertRulebookAllowsSend(row)).toThrow('PRODAT_DATE_EVENT_SOURCE_UNQUALIFIED')
        expect(()=>assertEdielSendLock(row)).toThrow('PRODAT_DATE_EVENT_SOURCE_UNQUALIFIED')
        expect(evaluateEdielProductionSendLock(row,preflight).issues.some(i=>i.message.includes('Produktionsmeddelande saknar'))).toBe(true)
      }else{
        // UD validity is independent of the approved persisted E34 producer hold.
        expect(result.issues).toContainEqual(expect.objectContaining({code:'PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED',blocking:true}))
        expect(()=>assertRulebookAllowsSend(row,dateContext)).toThrow('PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
        expect(()=>assertEdielSendLock(row,dateContext)).toThrow('PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
      }
    })
    it('persisted wrong code/family/old cache does not disable wire-selected UD', () => {
      const row = message([line('1','A'),...reason()],code,environment,alphabet)
      row.message_family='UTILTS'; row.message_code='Z04'
      expect(validateEdielMessageRowWithRulebook(row,'send').issues.some(target)).toBe(true)
      expect(()=>assertRulebookAllowsSend(row)).toThrow(/END_USER_GROUP/)
      expect(()=>assertEdielSendLock(row)).toThrow(/END_USER_GROUP/)
    })
  })
}

describe('UD message, inbound and unresolved-address boundaries', () => {
  for (const code of ['Z06','Z09'] as const) for (const alphabet of alphabets) {
    it(`${code}/${alphabet.join('')}: a later message cannot fill the first UD`, () => {
      const first = message([line('1','A'),...reason()],code,'test',alphabet)
      const second = message([line('1','A'),...reason(),ud()],code,'test',alphabet)
      const joined = first.raw_payload!.slice(0,9) + [...input(first.raw_payload!,code).rawSegments.slice(0,-1),
        ...input(second.raw_payload!,code).rawSegments.slice(1,-1), 'UNZ' + alphabet[1] + '2' + alphabet[1] + 'I'].join(alphabet[3]) + alphabet[3]
      expect(validateProdatSubtypePayload(input(joined,code)).some(target)).toBe(true)
      expect(()=>assertRulebookAllowsSend({...first,raw_payload:joined})).toThrow(/MESSAGE_SCOPE|message|meddelande/i)
    })
    it(`${code}/${alphabet.join('')}: inbound parse is not outbound unknown rejection`, () => {
      const row = {...message([line('1','A')],code,'test',alphabet),direction:'inbound' as const}
      expect(preflightEdielMessageRow(row,'parse').issues.filter(target)).toEqual([])
      expect(()=>assertRulebookAllowsSend(row)).not.toThrow()
      // Call the real parser/rulebook, not only the row preflight shortcut.
      expect(validateRulebookMessage({rawPayload:row.raw_payload!,family:'PRODAT',code,direction:'inbound',mode:'parse',environment:'test'}).issues.filter(target)).toEqual([])
    })
  }
  for (const code of ['Z06','Z09'] as const) it(`${code}: field229 stays separate and cannot borrow root facts across objects`, () => {
    const policy = resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:code,subtypeOrReasonCode:'E34',direction:'outbound',referenceDate:'2026-09-19',mode:'catalog_evidence',
      prodatDependentFacts:{canonicalSubtype:'E',endUserAddressAvailable:true,byCell:{[`${code}:229`]:true}}})
    const validate = (body: Parts[]) => { const wire = input(raw(body,code),code); return validateCanonicalPolicyFields({policy,rawSegments:wire.rawSegments,una:wire.una}) }
    expect(validate([line('1','A'),...reason('E64')]).filter(i=>i.description.includes(`${code}:229`))).toEqual([])
    const issues = validate([line('1','A'),...reason(),ud(),line('2','B'),...reason(),ud()])
    expect(issues.some(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED'&&i.description.includes(`${code}:229`))).toBe(true)
    expect(issues.filter(target)).toEqual([])
  })
})

describe('UD builder and read-consumer effects', () => {
  // Fixed independent pure nondeath selection; never reconstructed from emitted UD or status.
  const nonDeath = (li:string) => {const selection=deathSelection('not_death'),own=selection.objects[0];
    own.installation.agency='9';own.customer.id='00-CUSTOMER';own.lineItemReference=li;
    own.legalGridOwner={id:'12345',qualifier:'160',agency:'SVK'};own.legalSupplier={id:'54321',qualifier:'160',agency:'SVK'};return selection}

  const base: BuildProdatMessageInput = {companyId:'synthetic-company',role:'supplier',businessCode:'Z06',transactionSubtype:'E',
    sender:{edielId:'12345'},receiver:{edielId:'54321'},meteringPoint:{id:'A'},environment:'test',
    customer:{identity:'00-CUSTOMER',idAgency:'89',name:'User',country:'SE'},codedAttributes:{Z13:'E34'},
    dates:{validityStartDate:'2026-10-01'},references:{LI:'CASE'},dependentConditionFacts:{deathStatus:nonDeath('CASE'),dateEventObjects:[changeDateFact('A','9')],dateEventSource:{kind:'caller_selection',reference:'independent-change'},market:'electricity',endUserAddressObjects:[selectedAddressFact('A','synthetic-company','9','00-CUSTOMER')],invoiceeObjects:[selectedInvoiceeFact('A','synthetic-company','9','00-CUSTOMER',[],'','001 23','Town')],meterReadingsSentInUtilts:false,
      registerObjects:[{meteringPointId:'A',identityAgency:'9',expectedRegisterCount:1,meterReadingsSentInUtilts:false}]}}
  for (const code of ['Z06','Z09'] as const) for (const subtype of ['E','F','G']) it(`${code}/${subtype}: profiled renderer follows actual emitted reason and retains source text`, () => {
    const context: ProdatEngineProductionContext = {code,bgmReference:'DOCUMENT',transactionReference:'CASE',senderEdielId:'12345',receiverEdielId:'54321',meterPointId:'A',
      customerId:'000-CUSTOMER',customerIdAgency:'89',customerName:'User',customerNameLines:['User','Second'],customerPostalCode:'001 23',customerCity:'Town',customerCountry:'SE',
      siteAddress:'Site',reasonForTransaction:subtype==='E'?'E34':subtype==='F'?'E64':'E32'}
    const built = buildProfiledProdatSegments({context,generatedAt:new Date('2026-09-19T12:00:00Z')})
    expect(built.segments.some(s=>s.startsWith('NAD+UD+'))).toBe(subtype==='E')
    const data = parseProdatMessage(built.segments.join("'")+"'").lineItems[0]
    expect(data.customerId).toBe(subtype==='E'?'000-CUSTOMER':null)
    expect(validateProdatSubtypePayload({family:'PRODAT',code,rawSegments:built.segments}).filter(target)).toEqual([])
  })
  it('generic builder accepts full E data and rejects missing postcode/city at its own validation boundary', () => {
    // Extra properties are supplied through a variable to exercise old/new input
    // versions without a TS suppression. Before the patch they are lost.
    const customer = {...base.customer!,postalCode:'001 23',city:'Town',nameLines:['User','Second']}
    const built = buildProdatMessage({...base,customer})
    expect(validateProdatSubtypePayload(input(built.rawEdifact,'Z06')).filter(target)).toEqual([])
    expect(parseProdatMessage(built.rawEdifact).lineItems[0]).toMatchObject({endUserPostcode:'001 23',endUserCity:'Town'})
    expect(()=>buildProdatMessage(base)).toThrow(/Z06:(231|232)/)
  })
  it('generic multi-object builder must not use a root F subtype to omit one object E customer', () => {
    const customer = {...base.customer!,postalCode:'001 23',city:'Town'}
    const built = buildProdatMessage({...base,transactionSubtype:'F',dependentConditionFacts:{...base.dependentConditionFacts,deathStatus:nonDeath('CASE-A'),dateEventObjects:[changeDateFact('A','9'),changeDateFact('B','9')],invoiceeObjects:[selectedInvoiceeFact('A','synthetic-company','9','00-CUSTOMER',[],'','001 23','Town'),selectedInvoiceeFact('B','synthetic-company','9','00-CUSTOMER',[],'','001 23','Town')],registerObjects:[
      {meteringPointId:'A',identityAgency:'9',expectedRegisterCount:1,meterReadingsSentInUtilts:false},
      {meteringPointId:'B',identityAgency:'9',expectedRegisterCount:1,meterReadingsSentInUtilts:false},
    ]},objects:[
      {meteringPoint:{id:'A'},codedAttributes:{Z13:'E34'},customer,dates:base.dates,references:{LI:'CASE-A'}},
      {meteringPoint:{id:'B'},codedAttributes:{Z13:'E64'},customer,dates:base.dates,references:{LI:'CASE-B'},registers:[{annualConsumption:'1'}]},
    ]})
    expect(validateProdatSubtypePayload(input(built.rawEdifact,'Z06')).filter(target)).toEqual([])
    const lines = parseProdatMessage(built.rawEdifact).lineItems
    expect(lines[0].customerId).toBe('00-CUSTOMER'); expect(lines[1].customerId).toBeNull()
  })
})
