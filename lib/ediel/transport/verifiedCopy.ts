import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { readEdielTransportCopies } from './copy'
import { exactRfcMessageId } from './rawMimeArchive'

export class EdielTransportCopyUnavailableError extends Error {
  constructor(message: string, readonly reason: 'archive' | 'retained' | 'source_read' = 'archive') {
    super(message)
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ARCHIVED_MIME_BYTES = 32 * 1024 * 1024
const ARCHIVE_READ_TIMEOUT_MS = 10_000

function retentionTombstoned(error: unknown) {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'P0001'
    && 'message' in error && error.message === 'ediel_original_bytes_retention_tombstoned'
}

function archiveMissing(error: unknown) {
  if (error === null || typeof error !== 'object' || !('status' in error)) return false
  // The legacy Storage GET endpoint wraps a missing-object 404 as HTTP 400.
  return error.status === 404 || (error.status === 400 && 'statusCode' in error && String(error.statusCode) === '404')
}

async function readArchivedMime(path: string, expectedLength: number): Promise<Buffer> {
  const controller = new AbortController()
  const signal = controller.signal
  const deadlineAt = performance.now() + ARCHIVE_READ_TIMEOUT_MS
  const timeout = new EdielTransportCopyUnavailableError('ediel_transport_copy_archive_read_timeout', 'source_read')
  const archiveUnavailable = () => new EdielTransportCopyUnavailableError('ediel_transport_copy_archive_unavailable')
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = (stream: { cancel(): Promise<void> }) => { void stream.cancel().catch(() => undefined) }
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeout)
      if (reader) cancel(reader)
      reject(timeout)
    }, ARCHIVE_READ_TIMEOUT_MS)
  })

  async function read(): Promise<Buffer> {
    const { data, error } = await supabaseService.storage.from('ediel-files').download(path, {}, { signal }).asStream()
    if (signal.aborted || performance.now() >= deadlineAt) {
      if (data) cancel(data)
      throw timeout
    }
    if (error && !archiveMissing(error)) throw error
    if (error || !data) throw archiveUnavailable()

    const bytes = Buffer.alloc(expectedLength)
    reader = data.getReader()
    let length = 0
    let ended = false
    try {
      for (;;) {
        const chunk = await reader.read()
        if (signal.aborted || performance.now() >= deadlineAt) throw timeout
        if (chunk.done) {
          ended = true
          break
        }
        if (chunk.value.byteLength > expectedLength - length) throw archiveUnavailable()
        bytes.set(chunk.value, length)
        length += chunk.value.byteLength
      }
    } finally {
      if (!ended && !signal.aborted) cancel(reader)
      reader.releaseLock()
    }
    if (length !== expectedLength) throw archiveUnavailable()
    return bytes
  }

  try {
    return await Promise.race([read(), deadline])
  } catch (error) {
    if (error instanceof EdielTransportCopyUnavailableError) throw error
    throw new EdielTransportCopyUnavailableError('ediel_transport_copy_archive_read_failed', 'source_read')
  } finally {
    clearTimeout(timer)
  }
}

/** Every download reauthorizes the selected tenant and reads the immutable
 * attempt. The private object must still contain exactly those archived bytes. */
export async function readVerifiedEdielTransportCopy(input: { companyId: string; actorUserId: string; messageId: string; attemptId: string }): Promise<Buffer> {
  if (![input.companyId, input.actorUserId, input.messageId, input.attemptId].every(value => uuid.test(value))) throw new EdielTransportCopyUnavailableError('ediel_transport_copy_scope_invalid')
  const result = await readEdielTransportCopies(input)
  const copies = result.copies.filter(copy => copy.attemptId === input.attemptId)
  if (result.status !== 'available' || copies.length !== 1) throw new EdielTransportCopyUnavailableError('ediel_transport_copy_unavailable')
  const copy = copies[0]
  const path = `transport/${input.companyId}/${input.messageId}/${copy.mimeSha256}.eml`
  if (copy.companyId !== input.companyId || copy.messageId !== input.messageId || !['test', 'production'].includes(copy.environment)
      || !/^[a-f0-9]{64}$/.test(copy.mimeSha256) || !Number.isSafeInteger(copy.mimeLength) || copy.mimeLength < 1 || copy.mimeLength > MAX_ARCHIVED_MIME_BYTES
      || copy.mimeArchiveRef !== `storage://ediel-files/${path}` || copy.archiveReadbackRequired !== true || !copy.enteredAt
      || !uuid.test(copy.mimePayloadSnapshotId)) throw new EdielTransportCopyUnavailableError('ediel_transport_copy_binding_invalid')
  try {
    const { error } = await supabaseService.rpc('ediel_require_source_bytes_available_v1', {
      p_company_id: input.companyId,
      p_source_message_id: input.messageId,
    })
    if (error) throw error
  } catch (error) {
    if (retentionTombstoned(error)) throw new EdielTransportCopyUnavailableError('ediel_transport_copy_retention_tombstoned', 'retained')
    throw new EdielTransportCopyUnavailableError('ediel_transport_copy_retention_read_failed', 'source_read')
  }

  const bytes = await readArchivedMime(path, copy.mimeLength)
  if (createHash('sha256').update(bytes).digest('hex') !== copy.mimeSha256) {
    throw new EdielTransportCopyUnavailableError('ediel_transport_copy_archive_changed')
  }
  let rfcMessageId: string
  try {
    rfcMessageId = exactRfcMessageId(bytes)
  } catch {
    throw new EdielTransportCopyUnavailableError('ediel_transport_copy_archive_changed')
  }
  if (rfcMessageId !== copy.rfcMessageId) throw new EdielTransportCopyUnavailableError('ediel_transport_copy_archive_changed')
  return bytes
}
