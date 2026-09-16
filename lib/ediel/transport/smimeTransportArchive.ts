import { createHash } from 'crypto'
import { supabaseService } from '@/lib/supabase/service'

const ARCHIVE_BUCKET = 'ediel-files'

type SnapshotRow = {
  id: string
  company_id?: string | null
  ediel_message_id?: string | null
  encrypted_payload_ref?: string | null
  metadata?: Record<string, unknown> | null
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function headerValue(rawMime: Buffer, name: string): string | null {
  const prefix = `${name.toLowerCase()}:`
  const headerBlock = rawMime.toString('ascii').split(/\r?\n\r?\n/, 1)[0] ?? ''
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, ' ')
  for (const line of unfolded.split(/\r?\n/)) {
    if (line.toLowerCase().startsWith(prefix)) return line.slice(prefix.length).trim() || null
  }
  return null
}

export function isSmimeRawMime(rawMime: Buffer): boolean {
  return /content-type:\s*application\/(?:x-)?pkcs7-mime\b/i.test(rawMime.toString('ascii', 0, Math.min(rawMime.length, 8192)))
}

export function extractSmimeDer(rawMime: Buffer): Buffer {
  if (!isSmimeRawMime(rawMime)) throw new Error('smime_archive_not_pkcs7_mime')
  const text = rawMime.toString('ascii').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const separator = text.indexOf('\n\n')
  if (separator < 0) throw new Error('smime_archive_body_missing')
  const body = text.slice(separator + 2)
  const encoded = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('')
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('smime_archive_body_not_base64')
  const der = Buffer.from(encoded, 'base64')
  if (der.length === 0) throw new Error('smime_archive_der_empty')
  return der
}

export function smimeArchiveStoragePathFromReference(reference: string | null | undefined): string | null {
  const value = clean(reference)
  if (!value?.startsWith(`storage://${ARCHIVE_BUCKET}/`)) return null
  const path = value.slice(`storage://${ARCHIVE_BUCKET}/`.length)
  return path || null
}

export async function archiveSmimeRawMime(rawMime: Buffer): Promise<{
  storageRef: string
  storagePath: string
  archivedMimeSha256: string
  encryptedPayloadSha256: string
  rfcMessageId: string | null
  snapshotId: string
}> {
  const der = extractSmimeDer(rawMime)
  const encryptedPayloadSha256 = sha256(der)
  const legacyToken = encryptedPayloadSha256.slice(0, 24)

  const { data, error } = await supabaseService
    .from('ediel_message_payloads')
    .select('id,company_id,ediel_message_id,encrypted_payload_ref,metadata')
    .eq('payload_kind', 'smime_enveloped')
    .like('encrypted_payload_ref', `%/${legacyToken}`)
    .order('created_at', { ascending: false })
    .limit(2)

  if (error) throw error
  const rows = Array.isArray(data) ? (data as SnapshotRow[]) : []
  if (rows.length === 0) throw new Error('smime_archive_snapshot_missing')
  if (rows.length > 1) throw new Error('smime_archive_snapshot_ambiguous')

  const snapshot = rows[0]
  const legacyRef = clean(snapshot.encrypted_payload_ref)
  const match = legacyRef?.match(/^smtp-smime:\/\/([^/]+)\/([a-f0-9]{24})$/i)
  if (!match || match[2].toLowerCase() !== legacyToken.toLowerCase()) {
    throw new Error('smime_archive_snapshot_reference_mismatch')
  }

  const referenceMessageId = match[1]
  const messageId = clean(snapshot.ediel_message_id) ?? referenceMessageId
  if (messageId !== referenceMessageId) throw new Error('smime_archive_snapshot_message_mismatch')
  const companyId = clean(snapshot.company_id) ?? 'platform'
  const archivedMimeSha256 = sha256(rawMime)
  const rfcMessageId = headerValue(rawMime, 'Message-ID')
  if (!rfcMessageId) throw new Error('smime_archive_rfc_message_id_missing')

  const storagePath = `transport/${companyId}/${messageId}/${archivedMimeSha256}.eml`
  const bucket = supabaseService.storage.from(ARCHIVE_BUCKET)
  const { error: uploadError } = await bucket.upload(storagePath, rawMime, {
    contentType: 'message/rfc822',
    cacheControl: '0',
    upsert: false,
  })
  if (uploadError) throw uploadError

  try {
    const { data: downloaded, error: downloadError } = await bucket.download(storagePath)
    if (downloadError) throw downloadError
    if (!downloaded) throw new Error('smime_archive_readback_missing')
    const readback = Buffer.from(await downloaded.arrayBuffer())
    if (!readback.equals(rawMime) || sha256(readback) !== archivedMimeSha256) {
      throw new Error('smime_archive_readback_mismatch')
    }

    const storageRef = `storage://${ARCHIVE_BUCKET}/${storagePath}`
    const metadata = snapshot.metadata && typeof snapshot.metadata === 'object' && !Array.isArray(snapshot.metadata)
      ? snapshot.metadata
      : {}
    const { data: updated, error: updateError } = await supabaseService
      .from('ediel_message_payloads')
      .update({
        encrypted_payload_ref: storageRef,
        metadata: {
          ...metadata,
          legacy_encrypted_payload_ref: legacyRef,
          archive_bucket: ARCHIVE_BUCKET,
          archive_path: storagePath,
          archive_verified: true,
          archived_mime_sha256: archivedMimeSha256,
          archived_mime_bytes: rawMime.length,
          archived_rfc_message_id: rfcMessageId,
          archived_encrypted_payload_sha256: encryptedPayloadSha256,
        },
      })
      .eq('id', snapshot.id)
      .eq('encrypted_payload_ref', legacyRef)
      .select('id')
      .maybeSingle()

    if (updateError) throw updateError
    if (!updated) throw new Error('smime_archive_snapshot_update_lost')

    return {
      storageRef,
      storagePath,
      archivedMimeSha256,
      encryptedPayloadSha256,
      rfcMessageId,
      snapshotId: snapshot.id,
    }
  } catch (archiveError) {
    await bucket.remove([storagePath]).catch(() => undefined)
    throw archiveError
  }
}
