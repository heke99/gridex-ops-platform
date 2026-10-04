// masterplan: OPS-05, AT-OPS-05
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { EdielExecutionFailure } from '@/lib/ediel/core/failureDisposition'
import { getCanonicalEdielError, type CanonicalEdielErrorKey } from '@/lib/ediel/rulebook/mapEdielError'
const mocks = vi.hoisted(() => ({ process: vi.fn(), journal: vi.fn(), log: vi.fn() }))
vi.mock('@/lib/ediel/flows/inboundProcessing', () => ({ processInboundEdielMessage: mocks.process }))
vi.mock('@/lib/ediel/transport/deadLetter', () => ({ createEdielDeadLetterItem: mocks.journal }))
vi.mock('@/lib/ediel/operations/exchangeLog', () => ({ recordEdielExchangeLog: mocks.log }))
import { processInboundEdifactMessage } from '@/lib/ediel/transport/inboundProcessor'
const message = { id: 'message', company_id: 'company', environment: 'test', raw_payload: "UNB+UNOC:3+A:ZZ+B:ZZ+260930:1200+REF'UNH+1+PRODAT:D:96A:UN:E2SE6A'BGM+Z01+DOC+9'UNT+3+1'UNZ+1+REF'" } as EdielMessageRow
describe('actual inbound failure journal', () => {
  it('does not turn an unmapped diagnostic into a positive acknowledgement', () => {
    expect(() => getCanonicalEdielError('UNMAPPED' as CanonicalEdielErrorKey)).toThrow('ediel_source_diagnostic_unmapped')
  })
  beforeEach(() => { vi.clearAllMocks(); mocks.log.mockResolvedValue(undefined); mocks.journal.mockResolvedValue({ id: 'journal' }) })
  it.each(['internal_failure', 'security_quarantine', 'unsupported_capability'] as const)('persists %s without converting the exception into an external rejection', async kind => {
    const failure = new EdielExecutionFailure({ kind, code: 'LOCAL_FAILURE' }, 'local failure')
    mocks.process.mockRejectedValue(failure)
    await expect(processInboundEdifactMessage({ actorUserId: 'actor', message })).rejects.toBe(failure)
    expect(mocks.journal).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'company', edielMessageId: 'message',
      retryable: kind === 'internal_failure', replayRequiresApproval: kind !== 'internal_failure', metadata: expect.objectContaining({ failureDisposition: { kind, code: 'LOCAL_FAILURE' } }) }))
  })
  it('keeps unknown failures internal and makes a failed mandatory journal observable', async () => {
    mocks.process.mockRejectedValue(new Error('unknown'))
    mocks.journal.mockRejectedValue(new Error('missing schema'))
    await expect(processInboundEdifactMessage({ actorUserId: 'actor', message })).rejects.toThrow('ediel_processing_failure_journal_unavailable')
    expect(mocks.journal.mock.calls[0][0].metadata.failureDisposition.kind).toBe('internal_failure')
    expect(message.raw_payload).toContain('BGM+Z01+DOC+9')
  })
})
