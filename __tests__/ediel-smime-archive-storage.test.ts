import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  snapshots: [] as Array<Record<string, unknown>>,
  selectError: null as Error | null,
  updateError: null as Error | null,
  updateData: { id: 'payload-1' } as Record<string, unknown> | null,
  updatePayload: null as Record<string, unknown> | null,
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
    from: () => {
      const selectChain: Record<string, unknown> = {}
      selectChain.select = vi.fn(() => selectChain)
      selectChain.eq = vi.fn(() => selectChain)
      selectChain.like = vi.fn(() => selectChain)
      selectChain.order = vi.fn(() => selectChain)
      selectChain.limit = vi.fn(async () => ({ data: mocks.snapshots, error: mocks.selectError }))
      selectChain.update = vi.fn((payload: Record<string, unknown>) => {
        mocks.updatePayload = payload
        const updateChain: Record<string, unknown> = {}
        updateChain.eq = vi.fn(() => updateChain)
        updateChain.select = vi.fn(() => updateChain)
        updateChain.maybeSingle = vi.fn(async () => ({ data: mocks.updateData, error: mocks.updateError }))
        return updateChain
      })
      return selectChain
    },
  },
}))

import {
  archiveSmimeRawMime,
  extractSmimeDer,
  smimeArchiveStoragePathFromReference,
} from '@/lib/ediel/transport/smimeTransportArchive'

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const companyId = '22222222-2222-4222-8222-222222222222'
const messageId = '11111111-1111-4111-8111-111111111111'
const encryptedDer = Buffer.from('exact-encrypted-der-evidence')
const legacyToken = sha256(encryptedDer).slice(0, 24)
const legacyRef = `smtp-smime://${messageId}/${legacyToken}`
const rawMime = Buffer.from(
  [
    'From: sender@example.test',
    'To: receiver@example.test',
    'Message-ID: <archive-1@example.test>',
    'MIME-Version: 1.0',
    'Content-Type: application/pkcs7-mime; smime-type=enveloped-data; name=smime.p7m',
    'Content-Transfer-Encoding: base64',
    '',
    encryptedDer.toString('base64'),
    '',
  ].join('\r\n'),
  'ascii',
)

function snapshot() {
  return {
    id: 'payload-1',
    company_id: companyId,
    ediel_message_id: messageId,
    encrypted_payload_ref: legacyRef,
    metadata: {
      routeProfileId: 'route-1',
      expected_receiver_certificate_id: 'cert-1',
      encryptedPayloadSha256: sha256(encryptedDer),
    },
  }
}

describe('S/MIME transport byte archive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.snapshots = [snapshot()]
    mocks.selectError = null
    mocks.updateError = null
    mocks.updateData = { id: 'payload-1' }
    mocks.updatePayload = null
    mocks.upload.mockResolvedValue({ data: { path: 'stored' }, error: null })
    mocks.download.mockResolvedValue({ data: new Blob([rawMime]), error: null })
    mocks.remove.mockResolvedValue({ data: [], error: null })
  })

  it('archives and reads back the exact RFC822 bytes, then binds the existing route/certificate snapshot to private storage', async () => {
    const result = await archiveSmimeRawMime(rawMime)
    const rawHash = sha256(rawMime)
    const expectedPath = `transport/${companyId}/${messageId}/${rawHash}.eml`

    expect(extractSmimeDer(rawMime).equals(encryptedDer)).toBe(true)
    expect(result).toMatchObject({
      storageRef: `storage://ediel-files/${expectedPath}`,
      storagePath: expectedPath,
      archivedMimeSha256: rawHash,
      encryptedPayloadSha256: sha256(encryptedDer),
      rfcMessageId: '<archive-1@example.test>',
      snapshotId: 'payload-1',
    })
    expect(smimeArchiveStoragePathFromReference(result.storageRef)).toBe(expectedPath)

    expect(mocks.upload).toHaveBeenCalledTimes(1)
    const [path, bytes, options] = mocks.upload.mock.calls[0]
    expect(path).toBe(expectedPath)
    expect(Buffer.isBuffer(bytes)).toBe(true)
    expect(Buffer.from(bytes).equals(rawMime)).toBe(true)
    expect(options).toMatchObject({ contentType: 'message/rfc822', cacheControl: '0', upsert: false })
    expect(mocks.download).toHaveBeenCalledWith(expectedPath)
    expect(mocks.updatePayload).toEqual(expect.objectContaining({
      encrypted_payload_ref: `storage://ediel-files/${expectedPath}`,
      metadata: expect.objectContaining({
        routeProfileId: 'route-1',
        expected_receiver_certificate_id: 'cert-1',
        legacy_encrypted_payload_ref: legacyRef,
        archive_verified: true,
        archived_mime_sha256: rawHash,
        archived_mime_bytes: rawMime.length,
        archived_rfc_message_id: '<archive-1@example.test>',
        archived_encrypted_payload_sha256: sha256(encryptedDer),
      }),
    }))
  })

  it('fails closed if the pre-send transport snapshot is missing', async () => {
    mocks.snapshots = []
    await expect(archiveSmimeRawMime(rawMime)).rejects.toThrow('smime_archive_snapshot_missing')
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('fails closed when storage upload fails', async () => {
    mocks.upload.mockResolvedValue({ data: null, error: new Error('storage unavailable') })
    await expect(archiveSmimeRawMime(rawMime)).rejects.toThrow('storage unavailable')
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('fails closed and removes the object when read-back bytes differ', async () => {
    mocks.download.mockResolvedValue({ data: new Blob([Buffer.from('different')]), error: null })
    await expect(archiveSmimeRawMime(rawMime)).rejects.toThrow('smime_archive_readback_mismatch')
    expect(mocks.remove).toHaveBeenCalledTimes(1)
    expect(mocks.updatePayload).toBeNull()
  })

  it('removes verified bytes if binding the durable reference back to the snapshot fails', async () => {
    mocks.updateError = new Error('snapshot update rejected')
    await expect(archiveSmimeRawMime(rawMime)).rejects.toThrow('snapshot update rejected')
    expect(mocks.remove).toHaveBeenCalledTimes(1)
  })
})
