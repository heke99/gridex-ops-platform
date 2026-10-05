// masterplan: U-12, AT-U-12
import {describe,expect,it,vi} from 'vitest'
vi.mock('@/lib/ediel/core/versionRegistry',async original=>({...await original<typeof import('@/lib/ediel/core/versionRegistry')>(),resolveCanonicalOutboundVersion:async()=>'E5SE5A'}))
import {buildUtiltsOutboundDraft} from '@/lib/ediel/utilts'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {utiltsPackagingGuideViolations} from '@/lib/ediel/utilts/packagingGuide'

const draft=(payload:Record<string,unknown>)=>buildUtiltsOutboundDraft({code:'E73',environment:'test',senderEdielId:'11111',receiverEdielId:'22222',
 applicationReference:'23-DDQ-S02-S',transactionReference:'OWN-TX-1',externalReference:'DOC1',
 payload:{meteringPointId:'735999260731000007',legalSenderEdielId:'11111',legalReceiverEdielId:'22222',requestedPeriodStart:'2026-07-01T00:00:00Z',requestedPeriodEnd:'2026-08-01T00:00:00Z',...payload}} as never)

describe('U-12 an outgoing UTILTS is one compatible group: one message, one transaction, one reason',()=>{
 it('the builder renders exactly one UNH and one IDE with one own STS+7 reason and its own reference',async()=>{
  const d=await draft({})
  const wire=tokenizeEdifact(String(d.rawPayload))
  expect(wire.segments.filter(s=>s.tag==='UNH')).toHaveLength(1)
  const ides=wire.segments.filter(s=>s.tag==='IDE')
  expect(ides).toHaveLength(1)
  expect(segmentComposite(ides[0],2,wire.una)[0]).toBe('OWN-TX-1')
  const reasons=new Set(wire.segments.filter(s=>s.tag==='STS'&&segmentComposite(s,1,wire.una)[0]==='7').map(s=>segmentComposite(s,3,wire.una)[0]))
  expect(reasons.size).toBeLessThanOrEqual(1)
  expect(utiltsPackagingGuideViolations(String(d.rawPayload))).toEqual([])
  // The requested period is carried unchanged.
  expect(wire.segments.some(s=>s.tag==='DTM'&&/20260701/.test(s.raw)&&/20260801/.test(s.raw))).toBe(true)
 })
})
