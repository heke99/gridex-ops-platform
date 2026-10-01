import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { readEdielTransportCopies } from './copy'
import { exactRfcMessageId } from './rawMimeArchive'

export class EdielTransportCopyUnavailableError extends Error {}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
      || !/^[a-f0-9]{64}$/.test(copy.mimeSha256) || !Number.isSafeInteger(copy.mimeLength) || copy.mimeLength < 1 || copy.mimeLength > 32 * 1024 * 1024
      || copy.mimeArchiveRef !== `storage://ediel-files/${path}` || copy.archiveReadbackRequired !== true || !copy.enteredAt
      || !uuid.test(copy.mimePayloadSnapshotId)) throw new EdielTransportCopyUnavailableError('ediel_transport_copy_binding_invalid')
  const available = await supabaseService.rpc('ediel_require_source_bytes_available_v1', {p_company_id:input.companyId,p_source_message_id:input.messageId})
  if (available.error) throw new EdielTransportCopyUnavailableError('ediel_transport_copy_retention_tombstoned')
  const { data, error } = await supabaseService.storage.from('ediel-files').download(path)
  if (error || !data || data.size !== copy.mimeLength) throw new EdielTransportCopyUnavailableError('ediel_transport_copy_archive_unavailable')
  const bytes = Buffer.from(await data.arrayBuffer())
  if (bytes.length !== copy.mimeLength || createHash('sha256').update(bytes).digest('hex') !== copy.mimeSha256
      || exactRfcMessageId(bytes) !== copy.rfcMessageId) throw new EdielTransportCopyUnavailableError('ediel_transport_copy_archive_changed')
  return bytes
}
