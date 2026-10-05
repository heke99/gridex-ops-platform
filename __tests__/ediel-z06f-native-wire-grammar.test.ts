import {expect,it} from 'vitest'
import {validateUnsmGrammar} from '@/lib/ediel/core/unsmGrammar'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {z06fNativeStructureWire,z06fNativeReadingWire} from '../scripts/helpers/ediel-z06f-reading-followup-native-wire'
import {observationHandoffMessage} from './helpers/utiltsObservationHandoff'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {prepareUtiltsConsumptionContracts} from '@/lib/ediel/utilts/consumptionPreparation'
const scope={external:'735123456789012345',sender:'54321',receiver:'12345',brpEdielId:'99876',caseReference:'ACTUAL-SOURCE-CASE',gridAreaCode:'TES',requestedStartDate:'2026-10-03'}
it.each(['F','G'] as const)('native synthetic complete Z06%s input uses qualified full97A before any source owner',kind=>{
 const raw=z06fNativeStructureWire(scope,kind,'SOURCE-DOCUMENT')
 expect(validateEdifactEnvelope(raw).syntaxOk).toBe(true)
 const grammar=validateUnsmGrammar(raw);expect(grammar.qualification).toBe('qualified');expect(grammar.sources[0].key).toBe('PRODAT:D:97A:UN');expect(grammar.syntaxOk,JSON.stringify(grammar.issues)).toBe(true)
 expect(raw).not.toContain('NAD+UD');expect(raw).toContain('RFF+LI:ACTUAL-SOURCE-CASE')
})
it.each([{}, {register:'901'}, {meter:'FOREIGN-METER'}, {agency:'89'}, {date:'next-day' as const}, {quantity:'NULL'}])('native MDR reading input %j has qualified full02B; source acceptance is a separate native owner',options=>{
 const raw=z06fNativeReadingWire(scope,options),grammar=validateUnsmGrammar(raw)
 expect(validateEdifactEnvelope(raw).syntaxOk).toBe(true);expect(grammar.qualification).toBe('qualified');expect(grammar.sources[0].key).toBe('UTILTS:D:02B:UN');expect(grammar.syntaxOk,JSON.stringify(grammar.issues)).toBe(true)
 expect(raw).toContain('NAD+MS+12345:SVK:260');expect(raw).toContain('NAD+MR+54321:SVK:260');expect(raw).toContain('STS+7++E64::260')
})

// This pure boundary check does not mint native source/issuer/structural authority.
// The native producer suite still owns those admissions and no-borrow assertions.
it.each([
 {requestedStartDate:'2026-10-20',nextDay:false,offset:'0100',start:'2026-10-31T23:00:00.000Z',end:'2026-11-01T23:00:00.000Z'},
 {requestedStartDate:'2026-10-19',nextDay:true,offset:'0100',start:'2026-10-31T23:00:00.000Z',end:'2026-11-01T23:00:00.000Z'},
 {requestedStartDate:'2026-05-19',nextDay:true,offset:'0200',start:'2026-05-31T22:00:00.000Z',end:'2026-06-01T22:00:00.000Z'},
 {requestedStartDate:'2026-01-19',nextDay:true,offset:'0100',start:'2026-01-31T23:00:00.000Z',end:'2026-02-01T23:00:00.000Z'},
 {requestedStartDate:'2026-03-17',nextDay:false,offset:'0100',start:'2026-03-28T23:00:00.000Z',end:'2026-03-29T23:00:00.000Z'},
 {requestedStartDate:'2026-03-17',nextDay:false,offset:'0200',start:'2026-03-28T22:00:00.000Z',end:'2026-03-29T22:00:00.000Z'},
 {requestedStartDate:'2026-10-13',nextDay:false,offset:'0200',start:'2026-10-24T22:00:00.000Z',end:'2026-10-25T22:00:00.000Z'},
 {requestedStartDate:'2026-10-13',nextDay:false,offset:'0100',start:'2026-10-24T23:00:00.000Z',end:'2026-10-25T23:00:00.000Z'},
 {requestedStartDate:'2028-02-17',nextDay:false,offset:'0100',start:'2028-02-28T23:00:00.000Z',end:'2028-02-29T23:00:00.000Z'},
])('physical native reading interval survives actual preparation at $requestedStartDate/$nextDay/+$offset',async fixture=>{
 const message=observationHandoffMessage('2026-09-30')
 message.application_reference='23-DDQ-E66-T'
 // Without the native meter's separate multiplier, these own physical readings
 // differ by 1000kWh. Keep the pure parser input internally consistent.
 message.raw_payload=z06fNativeReadingWire({...scope,requestedStartDate:fixture.requestedStartDate},fixture.nextDay?{date:'next-day'}:{})
  .replace('?+0100:406',`?+${fixture.offset}:406`).replace("QTY+136:500'","QTY+136:1000'")
 const runtime=runUtiltsRuntimeForMessage(message),policy=resolveCanonicalMessagePolicy(message)!
 expect(runtime.transactionDispositions).toMatchObject([{disposition:'accepted',responseType:'positive_aperak'}])
 const contracts=await prepareUtiltsConsumptionContracts({message,runtime,policy,dataRequest:null,
  matches:[{transactionReference:runtime.facts.transactions[0].transactionId,externalMeteringPointId:scope.external,externalGridAreaId:scope.gridAreaCode,
   meteringPointId:'point',customerId:'customer',siteId:'site',gridOwnerId:'owner',matchStatus:'matched'}],
  fallback:{customerId:'customer',siteId:'site',meteringPointId:'point',gridOwnerId:'owner'},allowConsumption:true})
 expect(contracts).toHaveLength(1)
 expect(contracts[0].observations).toMatchObject([{quantity:'1000',periodStart:fixture.start,periodEnd:fixture.end,resolution:'P1D'}])
 expect(contracts[0].interpretation.offsetMinutes).toBe(fixture.offset==='0100'?60:120)
})
