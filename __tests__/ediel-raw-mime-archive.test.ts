import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ from: vi.fn(), upload: vi.fn(), download: vi.fn(), insert: vi.fn(), source: {} as Record<string, unknown> }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: io.from, storage: { from: () => ({ upload: io.upload, download: io.download }) },
} }))
vi.mock('@/lib/ediel/transport/smimeTransportArchive', () => ({ isSmimeRawMime: () => false, archiveSmimeRawMime: vi.fn() }))
import { archiveTransportRawMime } from '@/lib/ediel/transport/rawMimeArchive'

const context = { companyId: '11111111-1111-4111-8111-111111111111', messageId: '22222222-2222-4222-8222-222222222222' }
const raw = Buffer.from("Message-ID: <original@example.test>\r\nContent-Type: application/EDIFACT\r\n\r\nUNB+original'", 'latin1')
describe('raw MIME exact storage authority', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    io.source = { id: context.messageId, company_id: context.companyId, direction: 'outbound' }
    io.upload.mockResolvedValue({ error: null })
    io.download.mockResolvedValue({ data: { arrayBuffer: async () => Uint8Array.from(raw).buffer }, error: null })
    io.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: 'snapshot-id' }, error: null }) }) })
    io.from.mockImplementation((table: string) => {
      if (table === 'ediel_message_payloads') return { insert: io.insert }
      if (table !== 'ediel_messages') throw new Error('unexpected table')
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: async () => ({ data: io.source, error: null }) }
    })
  })
  it('binds verified storage bytes and RFC ID to the actual tenant-owned message snapshot', async () => {
    const result = await archiveTransportRawMime(raw, context)
    const sha = createHash('sha256').update(raw).digest('hex')
    expect(result).toMatchObject({ mimeSha256: sha, mimeLength: raw.length, rfcMessageId: '<original@example.test>', mimePayloadSnapshotId: 'snapshot-id' })
    expect(io.insert).toHaveBeenCalledWith(expect.objectContaining({ company_id: context.companyId, ediel_message_id: context.messageId,
      payload_kind: 'raw_mime', encrypted_payload_ref: result.mimeArchiveRef, metadata: expect.objectContaining({ archive_verified: true, archived_mime_sha256: sha }) }))
    expect(io.download.mock.invocationCallOrder[0]).toBeLessThan(io.insert.mock.invocationCallOrder[0])
  })
  it('blocks archive binding when the loaded source belongs to another tenant', async () => {
    io.source.company_id = 'other-tenant'
    await expect(archiveTransportRawMime(raw, context)).rejects.toThrow('ediel_mime_archive_source_mismatch')
    expect(io.upload).not.toHaveBeenCalled()
    expect(io.insert).not.toHaveBeenCalled()
  })
  it('refuses a preview or altered byte readback', async () => {
    io.download.mockResolvedValue({ data: { arrayBuffer: async () => Uint8Array.from(Buffer.from('different')).buffer }, error: null })
    await expect(archiveTransportRawMime(raw, context)).rejects.toThrow('ediel_mime_archive_readback_mismatch')
    expect(io.insert).not.toHaveBeenCalled()
  })
  it('can use an existing immutable object only after proving the same complete bytes', async () => {
    io.upload.mockResolvedValue({ error: new Error('duplicate object') })
    expect(await archiveTransportRawMime(raw, context)).toMatchObject({ mimePayloadSnapshotId: 'snapshot-id' })
    expect(io.download).toHaveBeenCalledTimes(1)
  })
  it('requires a persisted scope-bound snapshot after readback', async () => {
    io.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: null, error: new Error('snapshot unavailable') }) }) })
    await expect(archiveTransportRawMime(raw, context)).rejects.toThrow('snapshot unavailable')
  })
  it('does not archive a missing or ambiguous RFC Message-ID', async () => {
    const ambiguous = Buffer.from(raw.toString().replace('Content-Type:', 'Message-ID: <other@example.test>\r\nContent-Type:'))
    await expect(archiveTransportRawMime(ambiguous, context)).rejects.toThrow('ediel_mime_message_id_invalid')
    expect(io.upload).not.toHaveBeenCalled()
  })
})
