import {expect,it} from 'vitest'
import {observationHandoffMessage} from './helpers/utiltsObservationHandoff'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
it('the native closure UTILTS fixture reaches genuine accepted runtime before source qualification',()=>{
 const message=observationHandoffMessage('2026-10-16','00000000-0000-4000-8000-000000000002')
 message.sender_ediel_id='12345';message.receiver_ediel_id='54321'
 message.raw_payload=message.raw_payload!.replaceAll('735999260731000007','735123456789012345')
  .replaceAll('91100','12345').replaceAll('21660','54321').replaceAll('202607010000','202610010000')
  .replaceAll('202608010000','202610150000').replace('?+0200','?+0100').replace('M-GRIDEX-2607-01','METER-1')
 const canonicalPolicy=resolveCanonicalEdielPolicy({family:'UTILTS',messageCode:'E66',direction:'inbound',referenceDate:message.message_received_at!,applicationReference:message.application_reference,mode:'parse'})
 const result=runUtiltsRuntimeForMessage(message,{canonicalPolicy})
 expect(result.transactionDispositions,JSON.stringify(result.validation.issues)).toMatchObject([{disposition:'accepted'}])
})
