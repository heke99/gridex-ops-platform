import {edielDraftWire} from './helpers/edielDraftWire'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {buildUtiltsErrDraft} from '@/lib/ediel/ack'
import {renderAperakEdiel} from '@/lib/ediel/aperakEngine'
import {validateAckPreflight} from '@/lib/ediel/core/ackPreflight'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import type {EdielMessageRow} from '@/lib/ediel/types'

// These physical renderer fixtures prove the format and offset, not genuine
// source acceptance, billing authority or a native CREATE/SEND capability.
afterEach(()=>vi.useRealTimers())
describe('U message205 and A205 use standard UTC+1 throughout the year',()=>{
 it.each([
  ['2026-07-01T10:15:59Z','202607011115'],
  ['2026-01-01T10:15:00Z','202601011115'],
  ['2026-09-30T21:30:00Z','202609302230'],
  ['2026-09-30T23:00:00Z','202610010000'],
 ])('renders the creation instant %s without summer-time shift', (instant,expected)=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(instant))
  const source=energyHandoffMessage()
  const err=buildUtiltsErrDraft({sourceMessage:source,messageText:'E51',relatedTransactionReference:'GRIDEX2607E66001'})
  const wire=tokenizeEdifact(err.rawPayload),dtm=wire.segments.filter(t=>t.tag==='DTM').map(t=>segmentComposite(t,1,wire.una))
  expect(dtm).toContainEqual(['137',expected,'203'])
  expect(dtm).toContainEqual(['735','+0100','406'])
  expect(segmentComposite(wire.segments.find(t=>t.tag==='BGM'),1,wire.una)).toEqual(['ERR','','260'])
  const aperak=renderAperakEdiel({source:{id:source.id,messageFamily:'UTILTS',messageCode:'E66',rawPayload:source.raw_payload},refs:{documentReference:'GRIDEX2607E66MSG001'},externalReference:'AP',transactionReference:'DM',outcome:'positive',utiltsAcknowledgementReference:'GRIDEX2607E66001'})
  expect(aperak.segments).toContain(`DTM+137:${expected}:203`)
  expect(aperak.segments).toContain('DTM+735:?+0100:406')
 })
 it('accepts the original ERR::260 example and a present valid optional code-list',()=>{
  const source=energyHandoffMessage(),draft=buildUtiltsErrDraft({sourceMessage:source,messageText:'E51',relatedTransactionReference:'GRIDEX2607E66001'})
  const ack={...source,id:'ACK',direction:'outbound',message_family:'UTILTS_ERR',related_message_id:source.id,raw_payload:edielDraftWire(draft)} as EdielMessageRow
  for(const raw of [edielDraftWire(draft),edielDraftWire(draft).replace('BGM+ERR::260','BGM+ERR:SVK:260')])
   expect(validateAckPreflight({sourceMessage:source,ackMessage:{...ack,raw_payload:raw}}).issues.some(t=>t.code==='utilts_err_wrong_bgm')).toBe(false)
  expect(validateAckPreflight({sourceMessage:source,ackMessage:{...ack,raw_payload:edielDraftWire(draft).replace('BGM+ERR::260','BGM+ERR::999')}}).issues.some(t=>t.code==='utilts_err_wrong_bgm')).toBe(true)
 })
})
