import { describe, expect, it } from 'vitest'
import { inboundAckTimerCompletion } from '@/lib/ediel/sla/ackTimerCompletion'

const source = { id:'source', company_id:'tenant-a', environment:'test', message_family:'UTILTS',
  raw_payload:"UNH+M+UTILTS:D:02B:UN:E5SE5A'BGM+E66+DOC+9'IDE+24+IDE-A'LOC+172+POINT-A:::9'IDE+24+IDE-B'LOC+172+POINT-B:::9'UNT+8+M'" } as const
const ack = (id:string, transaction:string, extra:Record<string,unknown>={}) => ({
  id,company_id:'tenant-a',environment:'test',related_message_id:'source',direction:'outbound',status:'sent',
  message_sent_at:'2026-09-30T12:05:00Z', message_family:'APERAK', validation_report:{ relatedTransactionReference:transaction },...extra,
})
const result = (id:string, response:string) => ({ company_id:'tenant-a',environment:'test',source_message_id:'source',
  source_transaction_id:id,finalized_at:'2026-09-30T12:04:00Z',response_message_id:response })
describe('durable sent response scope resolves ACK timers', () => {
  it('holds malformed source grammar without interrupting other timer rows', () => {
    expect(inboundAckTimerCompletion({ source: { ...source, raw_payload: "UNA:+.? 'UNH+M+UTILTS:D:02B:UN:E5SE5A'IDE+24+X?" }, timerType: 'aperak_due', acknowledgements: [] })).toBeNull()
  })
  it('does not let one finalized and sent IDE satisfy its sibling', () => {
    expect(inboundAckTimerCompletion({source,timerType:'aperak_due',acknowledgements:[ack('a','IDE-A')],transactionResults:[result('IDE-A','a')]})).toBeNull()
  })
  it('requires every own final response to be sent and tenant matched', () => {
    const transactionResults=[result('IDE-A','a'),result('IDE-B','b')]
    expect(inboundAckTimerCompletion({source,timerType:'aperak_due',transactionResults,acknowledgements:[ack('a','IDE-A'),ack('b','IDE-B',{status:'queued'})]})).toBeNull()
    expect(inboundAckTimerCompletion({source,timerType:'aperak_due',transactionResults,acknowledgements:[ack('a','IDE-A'),ack('b','IDE-B',{company_id:'tenant-b'})]})).toBeNull()
    expect(inboundAckTimerCompletion({source,timerType:'aperak_due',transactionResults,acknowledgements:[ack('a','IDE-A'),ack('b','IDE-B')]})).toBe('resolved')
  })
  it('cancels application wait only after an actual sent syntax rejection', () => {
    expect(inboundAckTimerCompletion({source,timerType:'aperak_due',acknowledgements:[ack('c','',{message_family:'CONTRL',ack_outcome:'negative'})]})).toBe('cancelled')
  })
  it('resolves a persisted source-qualified whole-message negative APERAK', () => {
    expect(inboundAckTimerCompletion({source,timerType:'aperak_due',acknowledgements:[ack('h','',{ack_outcome:'negative',validation_report:{sourceMessageId:'source',ackScope:'message',relatedTransactionReference:null}})]})).toBe('resolved')
  })
})
