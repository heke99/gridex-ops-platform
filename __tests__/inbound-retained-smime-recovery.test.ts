import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recoverRetainedSmimeAck } from '@/lib/inbound-mail/retainedSmimeRecovery'

const mocks = vi.hoisted(() => ({ readFailedPayload: vi.fn(), rpc: vi.fn(), unpack: vi.fn() }))

vi.mock('@/lib/ediel/transport/smime', () => ({
  looksLikeSmimeMessage: () => true,
  unpackInboundSmimeIfNeeded: mocks.unpack,
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    rpc: mocks.rpc,
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        limit: mocks.readFailedPayload,
      }
      return query
    },
  },
}))

const raw = 'synthetic time-bound MIME original'
const clear = "UNA:+.? 'UNB+UNOC:3+7300000000002:14+7300000000001:14+261004:1200+A-1++23-DDQ-PRODAT'"
  + "UNH+1+CONTRL:2:2:UN:EDIEL2'UCI+ORIG-I+7300000000001:14+7300000000002:14+1'UNT+3+1'UNZ+1+A-1'"
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const row = {
  id: 'mail',
  company_id: 'company',
  environment: 'test',
  processing_status: 'manual_review',
  match_status: 'missing_payload',
  received_at_source: 'imap_internal_date',
  raw_email: raw,
  raw_message_sha256: sha(raw),
  raw_mailbox_bytes_sha256: sha(raw),
}
const protectedProjection = {
  status: 'recovered',
  sourceMailId: 'mail',
  companyId: 'company',
  environment: 'test',
  cipherHash: sha(raw),
  clearHash: sha(clear),
  cleartext: clear,
  actorUserId: 'authorized-operator',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.readFailedPayload.mockResolvedValue({
    error: null,
    data: [{ id: 'failure', encrypted_payload_ref: 'bound-ciphertext' }],
  })
  mocks.rpc.mockResolvedValue({ error: null, data: protectedProjection })
})

describe('Retained S/MIME acknowledgement recovery', () => {
  it('holds originals without an operator or the immutable physical digest', async () => {
    await expect(recoverRetainedSmimeAck({ row, hasProtectedProjection: false })).resolves.toBeNull()
    await expect(recoverRetainedSmimeAck({
      row: { ...row, raw_mailbox_bytes_sha256: 'wrong' },
      actorUserId: 'authorized-operator',
      hasProtectedProjection: false,
    })).resolves.toBeNull()
    expect(mocks.readFailedPayload).not.toHaveBeenCalled()
    expect(mocks.unpack).not.toHaveBeenCalled()
  })

  it('uses the current native claim and protected original on queue retry', async () => {
    const receipt = await recoverRetainedSmimeAck({
      row, actorUserId: 'unrelated-background-actor', hasProtectedProjection: true,
      lease: { id: 'job', locked_by: 'worker', locked_at: '2026-10-04T12:32:30Z' },
    })
    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(mocks.rpc).toHaveBeenCalledWith('gridex_resolve_retained_smime_ack_v1', expect.objectContaining({
      p_actor_user_id: null, p_job_id: 'job', p_claim_owner: 'worker', p_claimed_at: '2026-10-04T12:32:30Z',
      p_cleartext: null, p_cipher_sha256: sha(raw),
    }))
    expect(receipt).toMatchObject({ actorUserId: 'authorized-operator', parsed: { rawPayload: clear, messageFamily: 'CONTRL' } })
    expect(mocks.unpack).not.toHaveBeenCalled()
  })

  it('holds decryption when the encrypted payload reference belongs to a different source', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: null, data: { status: 'needs_recovery' } })
    mocks.unpack.mockResolvedValueOnce({
      securityStatus: 'decrypted', decryptedText: clear, matchedCompanyId: 'company',
      matchedCertificateId: 'certificate', encryptedPayloadRef: 'foreign-ciphertext',
    })
    await expect(recoverRetainedSmimeAck({
      row, actorUserId: 'authorized-operator', hasProtectedProjection: false,
    })).resolves.toBeNull()
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })

  it('rejects a receipt with a different source identity', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: null, data: { ...protectedProjection, sourceMailId: 'foreign-mail' } })
    await expect(recoverRetainedSmimeAck({
      row, actorUserId: 'authorized-operator', hasProtectedProjection: true,
    })).rejects.toThrow('retained_smime_projection_receipt_invalid')
  })
})
