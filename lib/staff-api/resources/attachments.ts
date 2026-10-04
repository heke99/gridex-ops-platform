import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { requireIdempotencyKey } from '@/lib/api/strictRequest'
import { supabaseService } from '@/lib/supabase/service'
import { StaffApiError } from '@/lib/staff-api/errors'
import { detectAttachmentMime, downloadSupportAttachment, inspectAttachment, sanitizeFileName, SupportAttachmentError, SUPPORT_ATTACHMENT_BUCKET, SUPPORT_ATTACHMENT_OPS_MAX_BYTES, SUPPORT_ATTACHMENT_MIME_TYPES, type AttachmentInspection } from '@/lib/customer-service/supportAttachments'
import { commandArgs, commandDatabase, databaseError, invalid, pageRows, readRows, reference, requestFingerprint, resourceQuery, type ResourceContext, type Row } from './common'
import { staffAttachment } from './dto'

// Multipart framing is bounded separately from the 4 MiB file. Never call formData on an unbounded request.
const MAX_MULTIPART_BYTES = SUPPORT_ATTACHMENT_OPS_MAX_BYTES + 32 * 1024
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const unavailable = (status = 503): never => { throw new StaffApiError(status, 'attachment_unavailable', 'Bilagan kunde inte behandlas säkert just nu.', status === 503) }

/** The new staff transport does not accept encoded/encrypted PDF content that the native token check cannot inspect. */
export function inspectStaffAttachment(bytes: Buffer): AttachmentInspection {
  const inspected = inspectAttachment(bytes)
  if (!inspected.ok || inspected.mime !== 'application/pdf') return inspected
  const names = bytes.toString('latin1').replace(/\/[^\s/<>[\]()]+/g, name => name.replace(/#([0-9a-fA-F]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16))))
  if (/\/(Filter|FFilter|DecodeParms|FDecodeParms|ObjStm|Encrypt|Crypt|XRef)\b/.test(names)) return { ok: false, reason: 'pdf_encoded_content' }
  return inspected
}

async function readMultipart(request: NextRequest) {
  if (request.nextUrl.searchParams.size) invalid('query', 'Query-parametrar stöds inte.', 400)
  const type = request.headers.get('content-type') ?? ''
  if (!/^multipart\/form-data\s*;/i.test(type)) invalid('content_type', 'multipart/form-data krävs.', 415, 'unsupported_media_type')
  const declared = request.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) invalid('content_length', 'Content-Length är ogiltig.', 400)
  const tooLarge = () => invalid('file', 'Filen eller multipart-innehållet är för stort.', 413, 'attachment_too_large')
  if (declared !== null && Number(declared) > MAX_MULTIPART_BYTES) tooLarge()
  if (!request.body) invalid('file', 'Välj en fil att bifoga.', 422, 'attachment_empty')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_MULTIPART_BYTES) { await reader.cancel().catch(() => undefined); tooLarge() }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  let form: FormData
  try { form = await new Response(new Uint8Array(Buffer.concat(chunks)), { headers: { 'content-type': type } }).formData() }
  catch { return invalid('file', 'Multipart-innehållet är ogiltigt.') }
  for (const key of form.keys()) if (!['file', 'visibility'].includes(key) || form.getAll(key).length !== 1) invalid(key, 'Fältet stöds inte eller förekommer flera gånger.')
  const file = form.get('file')
  if (!(file instanceof File)) invalid('file', 'Exakt en fil krävs.')
  if (file.size === 0) invalid('file', 'Filen är tom.', 422, 'attachment_empty')
  if (file.size > SUPPORT_ATTACHMENT_OPS_MAX_BYTES) tooLarge()
  const mime = file.type.split(';')[0].trim().toLowerCase()
  if (!(SUPPORT_ATTACHMENT_MIME_TYPES as readonly string[]).includes(mime)) invalid('file', 'PDF, PNG eller JPEG krävs.', 415, 'unsupported_media_type')
  const visibility = form.get('visibility') ?? 'internal'
  if (visibility !== 'internal' && visibility !== 'customer') invalid('visibility')
  const bytes = Buffer.from(await file.arrayBuffer())
  return { bytes, mime, fileName: file.name, visibility, sha256: hash(bytes) }
}

export async function listStaffAttachments(context: ResourceContext, caseReference: string, params: URLSearchParams) {
  reference(caseReference, 'support_case')
  const query = resourceQuery(params, 'attachments')
  return pageRows(context, 'attachments', caseReference, query, await readRows(context, 'attachments', caseReference, query), row => staffAttachment(row, caseReference))
}

function reservationRow(value: unknown, context: ResourceContext, expected: { sha256: string; bytes: Buffer }): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid staff attachment reservation')
  const row = value as Row
  if (row.company_id !== context.companyId || row.sha256 !== expected.sha256 || Number(row.byte_size) !== expected.bytes.length
    || typeof row.customer_case_id !== 'string' || !/^[0-9a-f-]{36}$/.test(row.customer_case_id)
    || typeof row.public_reference !== 'string' || !/^support_attachment_[A-Za-z0-9_-]{20,64}$/.test(row.public_reference)
    || row.storage_path !== `${context.companyId}/${row.customer_case_id}/${row.public_reference}`) throw new Error('Invalid staff attachment reservation binding')
  return row
}

function storageStatus(error: unknown): string { return String((error as { statusCode?: unknown; status?: unknown } | null)?.statusCode ?? (error as { status?: unknown } | null)?.status ?? '') }
async function verifiedObject(row: Row, input: { bytes: Buffer; mime: string }, allowCreate: boolean) {
  const bucket = supabaseService.storage.from(SUPPORT_ATTACHMENT_BUCKET)
  let downloaded = await bucket.download(String(row.storage_path))
  if (downloaded.error || !downloaded.data) {
    if (!allowCreate || storageStatus(downloaded.error) !== '404') unavailable()
    // Native bucket allowlist excludes octet-stream. The detected MIME is informational until release.
    await bucket.upload(String(row.storage_path), input.bytes, { contentType: detectAttachmentMime(input.bytes) ?? input.mime, upsert: false })
    // An existing-object error (including Storage HTTP 400) or lost response grants no trust; verify the object itself.
    downloaded = await bucket.download(String(row.storage_path))
  }
  if (downloaded.error || !downloaded.data) unavailable()
  const body = downloaded.data
  if (!body) return unavailable()
  const bytes = Buffer.from(await body.arrayBuffer())
  if (bytes.length !== Number(row.byte_size) || hash(bytes) !== row.sha256) unavailable(409)
  return bytes
}

export async function uploadStaffAttachment(context: ResourceContext, request: NextRequest, caseReference: string) {
  reference(caseReference, 'support_case')
  const key = requireIdempotencyKey(request)
  const input = await readMultipart(request)
  const fingerprint = requestFingerprint({ case_reference: caseReference, visibility: input.visibility, file_name: input.fileName, declared_mime: input.mime, byte_size: input.bytes.length, sha256: input.sha256 })
  const database = commandDatabase(context)
  const scope = { ...commandArgs(context), p_case_reference: caseReference, p_idempotency_key: key, p_request_hash: fingerprint }
  const reserved = await database.rpc('staff_api_attachment_reserve', { ...scope, p_file_name: sanitizeFileName(input.fileName, null), p_declared_mime: input.mime, p_byte_size: input.bytes.length, p_sha256: input.sha256, p_visibility: input.visibility })
  if (reserved.error) databaseError(reserved.error)
  if (!reserved.data || !['acquired', 'replay'].includes(reserved.data.state)) throw new Error('Invalid staff attachment reservation result')
  const row = reservationRow(reserved.data.row, context, input)
  const replayed = reserved.data.state === 'replay'
  const lease = reserved.data.lease_id
  if (!replayed && typeof lease !== 'string') throw new Error('Missing staff attachment lease')
  try {
    const bytes = await verifiedObject(row, input, !replayed)
    if (replayed) return { data: staffAttachment(row, caseReference), replayed: true }
    const inspection = inspectStaffAttachment(bytes)
    const finished = await database.rpc('staff_api_attachment_finalize', {
      ...scope, p_attachment_reference: row.public_reference, p_lease_id: lease,
      p_verified_sha256: hash(bytes), p_verified_byte_size: bytes.length,
      p_scan_status: inspection.ok ? 'released' : 'rejected', p_detected_mime: inspection.ok ? inspection.mime : null,
      p_scan_reason: inspection.ok ? null : inspection.reason, p_file_name: sanitizeFileName(input.fileName, inspection.ok ? inspection.mime : null),
    })
    if (finished.error) databaseError(finished.error)
    if (!finished.data?.row || typeof finished.data.replayed !== 'boolean') throw new Error('Invalid staff attachment finalization result')
    const completed = reservationRow(finished.data.row, context, input)
    if (completed.scan_status !== (inspection.ok ? 'released' : 'rejected')) throw new Error('Invalid staff attachment inspection outcome')
    return { data: staffAttachment(completed, caseReference), replayed: finished.data.replayed }
  } catch (error) {
    // A failed storage/audit response never abandons its object/ref. The original key can recover immediately.
    if (!replayed) {
      try { await database.rpc('staff_api_attachment_release', { ...scope, p_attachment_reference: row.public_reference, p_lease_id: lease }) }
      catch { /* The bounded lease remains recoverable if the release request itself failed. */ }
    }
    throw error
  }
}

export async function downloadStaffAttachment(context: ResourceContext, caseReference: string, attachmentReference: string) {
  reference(caseReference, 'support_case'); reference(attachmentReference, 'support_attachment', 'attachment_reference')
  const cases = await readRows(context, 'case', caseReference, { limit: 1, cursor: null, filters: {} })
  if (cases.length !== 1) invalid('reference', 'Ärendet hittades inte.', 404, 'support_case_not_found')
  let result: Awaited<ReturnType<typeof downloadSupportAttachment>>
  try {
    result = await downloadSupportAttachment({ companyId: context.companyId, customerId: String(cases[0].customer_id), caseId: String(cases[0].id), reference: attachmentReference, audience: 'staff' })
  } catch (error) {
    if (error instanceof SupportAttachmentError) throw new StaffApiError(error.status, error.code, error.message, error.status === 503)
    throw error
  }
  const inspection = inspectStaffAttachment(result.bytes)
  if (result.bytes.length !== result.row.byte_size || !inspection.ok || inspection.mime !== result.row.detected_mime_type) unavailable(409)
  return result
}
