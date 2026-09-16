import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    storage: {
      from: () => ({
        upload: mocks.upload,
        download: mocks.download,
        remove: mocks.remove,
      }),
    },
    from: () => ({ insert: mocks.insert }),
  },
}))

import { sha256, storeTransportPayloadSnapshot } from '@/lib/ediel/transport/index.part-1'

const message = {
  id: '11111111-1111-4111-8111-111111111111',
  company_id: '22222222-2222-4222-8222-222222222222',
} as EdielMessageRow

const rawMime = Buffer.from(
  'From: sender@example.test\r\nTo: receiver@example.test\r\nMessage-ID: <archive-1@example.test>\r\nContent-Type: application/pkcs7-mime\r\n\r\nENCRYPTED\r\n',
  'ascii',
)

describe('S/MIME transport byte archive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.upload.mockResolvedValue({ data: { path: 'stored' }, error: null })
    mocks.download.mockResolvedValue({ data: new Blob([rawMime]), error: null })
    mocks.remove.mockResolvedValue({ data: [], error: null })
    mocks.insert.mockResolvedValue({ data: null, error: null })
  })

  it('stores, reads back and references the exact RFC822 bytes before the snapshot is accepted', async () => {
    await expect(storeTransportPayloadSnapshot({
      message,
      payloadKind: 'smime_enveloped',
      rawPayload: null,
      encryptedPayloadRef: `smtp-smime://${message.id}/legacy-ref`,
      archivePayload: rawMime,
      encryptionMode: 'smime',
      certificateFingerprint: 'ab'.repeat(32),
      metadata: { routeProfileId: 'route-1' },
    })).resolves.toMatchObject({
      encryptedPayloadRef: expect.stringMatching(/^storage:\/\/ediel-files\/transport\//),
      archivedMimeSha256: sha256(rawMime),
      rfcMessageId: '<archive-1@example.test>',
    })

    expect(mocks.upload).toHaveBeenCalledTimes(1)
    const [path, bytes, options] = mocks.upload.mock.calls[0]
    expect(path).toBe(`transport/${message.company_id}/${message.id}/${sha256(rawMime)}.eml`)
    expect(Buffer.isBuffer(bytes)).toBe(true)
    expect(Buffer.from(bytes).equals(rawMime)).toBe(true)
    expect(options).toMatchObject({ contentType: 'message/rfc822', upsert: true })
    expect(mocks.download).toHaveBeenCalledWith(path)
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      ediel_message_id: message.id,
      payload_kind: 'smime_enveloped',
      raw_payload: null,
      encrypted_payload_ref: `storage://ediel-files/${path}`,
      metadata: expect.objectContaining({
        routeProfileId: 'route-1',
        archived_mime_sha256: sha256(rawMime),
        archived_mime_bytes: rawMime.length,
        archived_rfc_message_id: '<archive-1@example.test>',
        legacy_encrypted_payload_ref: `smtp-smime://${message.id}/legacy-ref`,
        archive_verified: true,
      }),
    }))
  })

  it('fails closed when storage upload fails', async () => {
    mocks.upload.mockResolvedValue({ data: null, error: new Error('storage unavailable') })
    await expect(storeTransportPayloadSnapshot({
      message,
      payloadKind: 'smime_enveloped',
      archivePayload: rawMime,
      encryptionMode: 'smime',
    })).rejects.toThrow(/storage unavailable/)
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('fails closed and removes the object when read-back bytes differ', async () => {
    mocks.download.mockResolvedValue({ data: new Blob([Buffer.from('different')]), error: null })
    await expect(storeTransportPayloadSnapshot({
      message,
      payloadKind: 'smime_enveloped',
      archivePayload: rawMime,
      encryptionMode: 'smime',
    })).rejects.toThrow(/archive_readback_mismatch/)
    expect(mocks.remove).toHaveBeenCalledTimes(1)
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('removes a verified object if the database snapshot cannot be persisted', async () => {
    mocks.insert.mockResolvedValue({ data: null, error: new Error('snapshot insert rejected') })
    await expect(storeTransportPayloadSnapshot({
      message,
      payloadKind: 'smime_enveloped',
      archivePayload: rawMime,
      encryptionMode: 'smime',
    })).rejects.toThrow(/snapshot insert rejected/)
    expect(mocks.remove).toHaveBeenCalledTimes(1)
  })
})
