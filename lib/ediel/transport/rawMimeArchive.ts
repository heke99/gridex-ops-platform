import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { archiveSmimeRawMime, isSmimeRawMime } from './smimeTransportArchive'

export type TransportMimeArchiveContext = { companyId: string; messageId: string }
export type TransportMimeArchive = {
  mimeArchiveRef: string
  mimeSha256: string
  mimeLength: number
  rfcMessageId: string
  mimePayloadSnapshotId: string
}
const bucketName = 'ediel-files'
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

export function exactRfcMessageId(raw: Buffer): string {
  const end = raw.indexOf('\r\n\r\n')
  const alternate = raw.indexOf('\n\n')
  const headerEnd = end >= 0 ? end : alternate
  if (headerEnd < 0 || headerEnd > 65536) throw new Error('ediel_mime_header_invalid')
  const headers = raw.subarray(0, headerEnd).toString('latin1').replace(/\r?\n[ \t]+/g, ' ')
  const ids = [...headers.matchAll(/^message-id:[ \t]*(.*)$/gim)].map(match => match[1].trim())
  if (ids.length !== 1 || !/^<[^<>\s]+@[^<>\s]+>$/.test(ids[0])) throw new Error('ediel_mime_message_id_invalid')
  return ids[0]
}

/** Exact archived bytes and provider bytes are the same Buffer. A durable
 * readback precedes the attempt reservation; previews cannot satisfy it. */
export async function archiveTransportRawMime(raw: Buffer, context: TransportMimeArchiveContext): Promise<TransportMimeArchive> {
  if (!/^[0-9a-f-]{36}$/i.test(context.companyId) || !/^[0-9a-f-]{36}$/i.test(context.messageId)) throw new Error('ediel_mime_archive_scope_invalid')
  const rfcMessageId = exactRfcMessageId(raw)
  const mimeSha256 = hash(raw)
  if (isSmimeRawMime(raw)) {
    const archived = await archiveSmimeRawMime(raw, context)
    if (archived.archivedMimeSha256 !== mimeSha256 || archived.rfcMessageId !== rfcMessageId) throw new Error('ediel_mime_archive_binding_invalid')
    return { mimeArchiveRef: archived.storageRef, mimeSha256, mimeLength: raw.length, rfcMessageId, mimePayloadSnapshotId: archived.snapshotId }
  }
  const { data: source, error: sourceError } = await supabaseService.from('ediel_messages').select('id,company_id,direction')
    .eq('id', context.messageId).eq('company_id', context.companyId).maybeSingle()
  if (sourceError) throw sourceError
  if (!source || source.id !== context.messageId || source.company_id !== context.companyId || source.direction !== 'outbound') throw new Error('ediel_mime_archive_source_mismatch')
  const path = `transport/${context.companyId}/${context.messageId}/${mimeSha256}.eml`
  const mimeArchiveRef = `storage://${bucketName}/${path}`
  const bucket = supabaseService.storage.from(bucketName)
  const { error: uploadError } = await bucket.upload(path, raw, { contentType: 'message/rfc822', cacheControl: '0', upsert: false })
  // A retry can find the same immutable object. Its existence and exact bytes
  // must be proved by readback, even when upload reports an existing object.
  const { data: downloaded, error: downloadError } = await bucket.download(path)
  if (downloadError || !downloaded) throw downloadError ?? uploadError ?? new Error('ediel_mime_archive_readback_missing')
  const readback = Buffer.from(await downloaded.arrayBuffer())
  if (!readback.equals(raw) || hash(readback) !== mimeSha256) throw new Error('ediel_mime_archive_readback_mismatch')
  const { data: snapshot, error: snapshotError } = await supabaseService.from('ediel_message_payloads').insert({
    company_id: context.companyId, ediel_message_id: context.messageId, payload_kind: 'raw_mime',
    encrypted_payload_ref: mimeArchiveRef, raw_payload_hash: mimeSha256, encryption_mode: 'none', status: 'stored',
    metadata: { archive_bucket: bucketName, archive_path: path, archive_verified: true,
      archived_mime_sha256: mimeSha256, archived_mime_bytes: raw.length, archived_rfc_message_id: rfcMessageId },
  }).select('id').single()
  if (snapshotError) throw snapshotError
  if (!snapshot?.id) throw new Error('ediel_mime_archive_snapshot_missing')
  return { mimeArchiveRef, mimeSha256, mimeLength: raw.length, rfcMessageId, mimePayloadSnapshotId: snapshot.id }
}
