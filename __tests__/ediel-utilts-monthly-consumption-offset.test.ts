// masterplan: U-10, AT-U-10
// Actual runtime -> consumption preparation for a monthly (P1M) E66 that starts
// on the 1st at local midnight in +01:00. The prepared observation must cover
// exactly that calendar month; UTC month arithmetic on the normalized start
// (previous day 23:00Z) overshot after 31-day months and fell short otherwise.
import {expect,it} from 'vitest'
import {z06fNativeReadingWire} from '../scripts/helpers/ediel-z06f-reading-followup-native-wire'
import {observationHandoffMessage} from './helpers/utiltsObservationHandoff'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {prepareUtiltsConsumptionContracts} from '@/lib/ediel/utilts/consumptionPreparation'

const scope={external:'735123456789012345',sender:'54321',receiver:'12345',brpEdielId:'99876',caseReference:'C',gridAreaCode:'TES'}
const ymd=(d:Date)=>d.toISOString().slice(0,10).replaceAll('-','')
it.each([
 {month:10,start:'2026-10-31T23:00:00.000Z',end:'2026-11-30T23:00:00.000Z'},
 {month:6,start:'2026-06-30T23:00:00.000Z',end:'2026-07-31T23:00:00.000Z'},
 {month:11,start:'2026-11-30T23:00:00.000Z',end:'2026-12-31T23:00:00.000Z'},
 {month:1,start:'2026-01-31T23:00:00.000Z',end:'2026-02-28T23:00:00.000Z'},
])('a monthly +01:00 period from the 1st (month index $month) prepares exactly that month',async({month,start,end})=>{
 const from=ymd(new Date(Date.UTC(2026,month,1))),to=ymd(new Date(Date.UTC(2026,month+1,1)))
 const message=observationHandoffMessage('2026-09-30')
 message.application_reference='23-DDQ-E66-T'
 message.raw_payload=z06fNativeReadingWire({...scope,requestedStartDate:'2026-10-20'})
  .replace('DTM+324:202611010000202611020000:719',`DTM+324:${from}0000${to}0000:719`)
  .replaceAll('DTM+597:202611020000:203',`DTM+597:${to}0000:203`).replace('DTM+597:202611010000:203',`DTM+597:${from}0000:203`)
  .replace('DTM+354:1:804','DTM+354:1:802').replace("QTY+136:500'","QTY+136:1000'")
 const runtime=runUtiltsRuntimeForMessage(message),policy=resolveCanonicalMessagePolicy(message)!
 expect(runtime.transactionDispositions,JSON.stringify(runtime.validation.issues)).toMatchObject([{disposition:'accepted'}])
 const contracts=await prepareUtiltsConsumptionContracts({message,runtime,policy,dataRequest:null,
  matches:[{transactionReference:runtime.facts.transactions[0].transactionId,externalMeteringPointId:scope.external,externalGridAreaId:scope.gridAreaCode,
   meteringPointId:'point',customerId:'customer',siteId:'site',gridOwnerId:'owner',matchStatus:'matched'}],
  fallback:{customerId:'customer',siteId:'site',meteringPointId:'point',gridOwnerId:'owner'},allowConsumption:true})
 expect(contracts[0].observations).toMatchObject([{quantity:'1000',periodStart:start,periodEnd:end,resolution:'P1M'}])
})
