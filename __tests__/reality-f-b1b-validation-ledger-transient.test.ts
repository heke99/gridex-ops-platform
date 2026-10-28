// reality-defects: F-B1b
// F-B1b (reality F6c, batch 14): after F-B1 the retry still never saw the deadlock. gridex_record_utilts_source_validation_v4
// deadlocked (40P01) and recordReceivedSourceValidation turned the error into an 'unconfirmed' receipt, which
// recordFinalCanonicalUtiltsDecision throws as utilts_final_canonical_transaction_evidence_unconfirmed (not transient).
// The E66 was then aborted after validation and never processed again. A transient conflict now reaches the caller,
// where runWithTransientRetry repeats the processing; every other failure stays an 'unconfirmed' diagnostic.
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ reply: null as unknown, thrown: null as unknown }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: () => ({
  abortSignal: async () => { if (io.thrown) throw io.thrown; return io.reply },
}) } }))
vi.mock('@/lib/ediel/core/receivedSourceValidationEvidence', () => ({
  buildReceivedSourceValidationEvidence: () => ({ companyId: '11111111-1111-4111-8111-111111111111', environment: 'production',
    sourceMessageId: '22222222-2222-4222-8222-222222222222', sourcePayloadHash: 'a'.repeat(64), factsText: '{}' }),
}))

import { recordReceivedSourceValidation } from '@/lib/ediel/core/receivedSourceValidationLedger'
import { runWithTransientRetry } from '@/lib/inbound-mail/strandedInboundEdielResume'

const message = { id: '22222222-2222-4222-8222-222222222222', company_id: '11111111-1111-4111-8111-111111111111', message_family: 'UTILTS',
  environment: 'production', raw_payload: 'x' } as never
const record = () => recordReceivedSourceValidation({ original: message, validated: message, resolvedCompanyId: '11111111-1111-4111-8111-111111111111', decision: {} as never })

beforeEach(() => { io.reply = null; io.thrown = null })

it('a deadlock returned by the validation RPC reaches the caller as a transient conflict', async () => {
  io.reply = { data: null, error: { code: '40P01', message: 'deadlock detected' } }
  await expect(record()).rejects.toMatchObject({ code: '40P01' })
})

it('a thrown serialization failure reaches the caller too', async () => {
  io.thrown = Object.assign(new Error('could not serialize access due to concurrent update'), { code: '40001' })
  await expect(record()).rejects.toMatchObject({ code: '40001' })
})

it('any other failure stays an unconfirmed diagnostic, as before', async () => {
  io.reply = { data: null, error: { code: 'P0U01', message: 'utilts_source_validation_scope_invalid' } }
  await expect(record()).resolves.toMatchObject({ status: 'unconfirmed' })
  io.reply = null; io.thrown = new Error('network')
  await expect(record()).resolves.toMatchObject({ status: 'unconfirmed' })
})

it('so the in-place retry recovers from the deadlock', async () => {
  let calls = 0
  const run = vi.fn(async () => { calls += 1; io.reply = calls === 1 ? { data: null, error: { code: '40P01', message: 'deadlock detected' } } : { data: null, error: { code: 'P0U01' } }; return record() })
  await expect(runWithTransientRetry(run, { delayMs: 0 })).resolves.toMatchObject({ status: 'unconfirmed' })
  expect(run).toHaveBeenCalledTimes(2)
})

// F-B1c: the ledger's own 2 s client time limit (AbortSignal.timeout) and a statement timeout are transient as well.
it('a client time-out of the validation RPC and a statement timeout reach the caller', async () => {
  io.thrown = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
  await expect(record()).rejects.toMatchObject({ name: 'TimeoutError' })
  io.thrown = null; io.reply = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
  await expect(record()).rejects.toMatchObject({ code: '57014' })
})

