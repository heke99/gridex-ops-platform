import {expect,it} from 'vitest'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {buildUtiltsTransactionPersistencePayload} from '@/lib/ediel/utilts/transactionPersistence'
import {localEdifactDateTimeToUtc} from '@/lib/ediel/utilts/timezone'
function payload(raw:(s:string)=>string=s=>s){
 const source=energyHandoffMessage('2026-10-01'),message={...source,raw_payload:raw(source.raw_payload!)},runtime=runUtiltsRuntimeForMessage(message)
 return buildUtiltsTransactionPersistencePayload({messageCode:'E66',transactions:runtime.facts.transactions,dispositions:runtime.transactionDispositions,matches:[],rawSegments:runtime.facts.rawSegments})[0]
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
