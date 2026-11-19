import {expect,it} from 'vitest'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {buildUtiltsTransactionPersistencePayload} from '@/lib/ediel/utilts/transactionPersistence'
import {edifactInstantInDeclaredOffset,localEdifactDateTimeToUtc} from '@/lib/ediel/utilts/timezone'
function payload(raw:(s:string)=>string=s=>s,registrationTime?:string){
 const source=energyHandoffMessage('2026-10-01'),message={...source,raw_payload:raw(source.raw_payload!)},runtime=runUtiltsRuntimeForMessage(message)
 const transactions=registrationTime===undefined ? runtime.facts.transactions : runtime.facts.transactions.map(transaction=>({...transaction,registrationTime}))
 return buildUtiltsTransactionPersistencePayload({messageCode:'E66',transactions,dispositions:runtime.transactionDispositions,matches:[],rawSegments:runtime.facts.rawSegments})[0]
}
it('carries actual own LIN product and exact physical UTC-offset period into durable storage',()=>{
 expect(payload()).toMatchObject({productId:'8716867000030',periodStart:'2026-06-30T22:00:00.000Z',periodEnd:'2026-06-30T22:15:00.000Z'})
})
it.each([['+0100','2026-10-24T23:00:00.000Z'],['+0200','2026-10-24T22:00:00.000Z'],['-0300','2026-10-25T03:00:00.000Z']] as const)('keeps declared %s over the DST boundary without local-zone guessing', (offset,start)=>{
 const item=payload(s=>s.replace('202607010000202607010015','202610250000202610250015').replace('DTM+735:?+0200:406',`DTM+735:${offset.startsWith('+')?'?':''}${offset}:406`))
 expect(item.periodStart).toBe(start);expect(item.productId).toBe('8716867000030')
})
it('does not let a plain runtime reference or another IDE supply product authority',()=>{
 const item=payload(s=>s.replace('LIN+++8716867000030:::9','LIN+++FORGED:::89'))
 expect(item.productId).toBeNull()
})
it('keeps an explicit offset literal absolute instead of applying DTM735 twice',()=>{
 expect(localEdifactDateTimeToUtc('2026-10-25T00:00:00+03:03',{raw:'+0100',offsetMinutes:60,format:'406'})).toBe('2026-10-24T20:57:00.000Z')
})

const standardOffset={raw:'+0100',offsetMinutes:60,format:'406'} as const

it.each([
 '2026-02-30T00:00:00+01:00',
 '2026-02-30T00:00:00Z',
 '2026-02-29T00:00:00-0300',
 '2026-04-31T00:00:00+0100',
 '2026-02-28T24:00:00Z',
])('rejects impossible explicit clock %s before UTC projection or durable serialization', value=>{
 expect(payload(undefined,value).registrationDate).toBeNull()
 expect(localEdifactDateTimeToUtc(value,standardOffset)).toBeNull()
 expect(localEdifactDateTimeToUtc(value,null)).toBeNull()
 expect(edifactInstantInDeclaredOffset(value,standardOffset)).toBeNull()
})

it.each([
 ['2024-02-29T00:15:25.1234+01:00','2024-02-28T23:15:25.123Z','2024-02-29T00:15:25.123+01:00'],
 ['2024-02-29T00:15-0330','2024-02-29T03:45:00.000Z','2024-02-29T04:45:00.000+01:00'],
 ['2024-02-29t00:15z','2024-02-29T00:15:00.000Z','2024-02-29T01:15:00.000+01:00'],
 ['2024-02-29 00:15:00+0100','2024-02-28T23:15:00.000Z','2024-02-29T00:15:00.000+01:00'],
])('keeps valid explicit leap-day instant %s through both clock projections', (value,utc,wallTime)=>{
 expect(localEdifactDateTimeToUtc(value,standardOffset)).toBe(utc)
 expect(edifactInstantInDeclaredOffset(value,standardOffset)).toBe(wallTime)
 expect(payload(undefined,value).registrationDate).toBe(utc)
})

it('keeps floating values and normal local conversion on their existing time basis',()=>{
 const value='2024-02-29T00:15:00'
 expect(localEdifactDateTimeToUtc(value,null)).toBe(value)
 expect(edifactInstantInDeclaredOffset(value,standardOffset)).toBe(value)
 expect(localEdifactDateTimeToUtc(value,standardOffset)).toBe('2024-02-28T23:15:00.000Z')
})
