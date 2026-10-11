import { createHash, randomBytes } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { tenantInsert, tenantSelect, tenantUpdate } from '@/lib/supabase/tenantQuery'
import { buildPortalDatabasePage, decodePortalCursor, portalPageLimit } from '@/lib/customer-portal/keysetPagination'

/**
 * Private support-case attachments with quarantine.
 *
 * Flow: validate size → store bytes in the private bucket under a quarantine path → record the
 * row as 'quarantined' → inspect the content → mark 'released' or 'rejected'. Only released
 * files are ever served, and every download re-checks the stored SHA-256.
 *
 * The inspection is a content check (real type from magic bytes, allow-listed types, no active
 * PDF content). It is not an antivirus scan; `inspectAttachment` is the single seam where an
 * external scanner can be added later without changing callers.
 */

export const SUPPORT_ATTACHMENT_BUCKET = 'support-case-attachments'
export const SUPPORT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
/** OPS uploads go through a server action, whose request body limit is 5 MB (next.config.ts). */
export const SUPPORT_ATTACHMENT_OPS_MAX_BYTES = 4 * 1024 * 1024
/** Customer API uploads are raw request bodies; the hosting platform caps a request body at 4.5 MB. */
export const SUPPORT_ATTACHMENT_API_MAX_BYTES = 4 * 1024 * 1024
export const SUPPORT_ATTACHMENT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const
export const SUPPORT_ATTACHMENT_QUOTA_PER_DAY = 20

export type AttachmentMime = 'application/pdf' | 'image/png' | 'image/jpeg'
export type AttachmentInspection = { ok: true; mime: AttachmentMime } | { ok: false; reason: string }

export class SupportAttachmentError extends Error {
  constructor(
    readonly code: 'attachment_too_large' | 'attachment_empty' | 'attachment_rejected' | 'attachment_not_found' | 'attachment_quota_exceeded' | 'attachment_unavailable',
    message: string,
    readonly status = 422,
  ) {
    super(message)
    this.name = 'SupportAttachmentError'
  }
}

/** Real file type from the first bytes; the declared type and file name are never trusted. */
export function detectAttachmentMime(bytes: Buffer): AttachmentMime | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  return null
}

// PDF features that execute or embed content. Name objects may be hex-escaped (#4A = J).
const ACTIVE_PDF = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|OpenAction|AA|XFA|SubmitForm|ImportData)\b/

function decodePdfNames(text: string): string {
  return text.replace(/\/[^\s/<>[\]()]+/g, (name) => name.replace(/#([0-9a-fA-F]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16))))
}

export function inspectAttachment(bytes: Buffer): AttachmentInspection {
  if (bytes.length === 0) return { ok: false, reason: 'empty' }
  if (bytes.length > SUPPORT_ATTACHMENT_MAX_BYTES) return { ok: false, reason: 'too_large' }
  const mime = detectAttachmentMime(bytes)
  if (!mime) return { ok: false, reason: 'type_not_allowed' }
  if (mime === 'application/pdf') {
    const text = decodePdfNames(bytes.toString('latin1'))
    if (ACTIVE_PDF.test(text)) return { ok: false, reason: 'pdf_active_content' }
    if (!/%%EOF\s*$/.test(text.slice(-2048))) return { ok: false, reason: 'pdf_truncated' }
  }
  return { ok: true, mime }
}

/** Keeps a readable name but strips paths, control characters and anything risky in headers. */
export function sanitizeFileName(name: string | null | undefined, mime: AttachmentMime | null): string {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? ''
  const cleaned = base.normalize('NFC').replace(/[^\p{L}\p{N} ._()-]/gu, '_').replace(/\s+/g, ' ').trim().slice(0, 120)
  const ext = mime === 'application/pdf' ? '.pdf' : mime === 'image/png' ? '.png' : mime === 'image/jpeg' ? '.jpg' : ''
  const stem = cleaned.replace(/\.[A-Za-z0-9]{1,8}$/, '') || 'bilaga'
  return `${stem}${ext}`
}

export type SupportAttachmentRow = {
  id: string
  public_reference: string
  file_name: string
  detected_mime_type: AttachmentMime | null
  byte_size: number
  sha256: string
  storage_path: string
  visibility: 'customer' | 'internal'
  uploaded_by_kind: 'customer' | 'staff'
  scan_status: 'quarantined' | 'released' | 'rejected'
  scan_reason: string | null
  created_at: string
}

const COLUMNS = 'id,public_reference,file_name,detected_mime_type,byte_size,sha256,storage_path,visibility,uploaded_by_kind,scan_status,scan_reason,created_at'

type CaseScope = { companyId: string; customerId: string; caseId: string }

async function assertDailyQuota(scope: CaseScope) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await tenantSelect(scope.companyId, 'customer_case_attachments', 'id', { count: 'exact', head: true })
    .eq('customer_id', scope.customerId)
    .gte('created_at', since)
  if (error) throw error
  if ((count ?? 0) >= SUPPORT_ATTACHMENT_QUOTA_PER_DAY) {
    throw new SupportAttachmentError('attachment_quota_exceeded', 'För många bilagor för kunden det senaste dygnet. Försök igen senare.', 429)
  }
}

/** Stores, records, inspects and releases or rejects one attachment. */
export async function addSupportAttachment(input: CaseScope & {
  bytes: Buffer
  fileName: string | null
  declaredMime: string | null
  visibility: 'customer' | 'internal'
  uploadedBy: { kind: 'staff'; userId: string; apiClientId?: string } | { kind: 'customer'; apiClientId: string | null }
}): Promise<SupportAttachmentRow> {
  if (input.bytes.length === 0) throw new SupportAttachmentError('attachment_empty', 'Filen är tom.')
  if (input.bytes.length > SUPPORT_ATTACHMENT_MAX_BYTES) {
    throw new SupportAttachmentError('attachment_too_large', 'Filen är större än 10 MB.', 413)
  }
  if (input.uploadedBy.kind === 'customer' && input.visibility !== 'customer') {
    throw new SupportAttachmentError('attachment_rejected', 'Kundens bilagor är alltid synliga för kunden.')
  }
  await assertDailyQuota(input)

  const reference = `support_attachment_${randomBytes(18).toString('base64url')}`
  const sha256 = createHash('sha256').update(input.bytes).digest('hex')
  const storagePath = `${input.companyId}/${input.caseId}/${reference}`
  const upload = await supabaseService.storage.from(SUPPORT_ATTACHMENT_BUCKET).upload(storagePath, input.bytes, {
    contentType: 'application/octet-stream',
    upsert: false,
  })
  if (upload.error) throw new SupportAttachmentError('attachment_unavailable', 'Filen kunde inte sparas just nu.', 503)

  const insert = await tenantInsert(input.companyId, 'customer_case_attachments', {
    customer_id: input.customerId,
    customer_case_id: input.caseId,
    public_reference: reference,
    file_name: sanitizeFileName(input.fileName, null),
    declared_mime_type: input.declaredMime?.slice(0, 120) ?? null,
    byte_size: input.bytes.length,
    sha256,
    storage_path: storagePath,
    visibility: input.visibility,
    uploaded_by_kind: input.uploadedBy.kind,
    uploaded_by_user_id: input.uploadedBy.kind === 'staff' ? input.uploadedBy.userId : null,
    api_client_id: input.uploadedBy.apiClientId ?? null,
    scan_status: 'quarantined',
  }).select(COLUMNS).single()
  if (insert.error) {
    await supabaseService.storage.from(SUPPORT_ATTACHMENT_BUCKET).remove([storagePath]).catch(() => undefined)
    throw insert.error
  }

  const inspection = inspectAttachment(input.bytes)
  const patch = inspection.ok
    ? { scan_status: 'released', detected_mime_type: inspection.mime, file_name: sanitizeFileName(input.fileName, inspection.mime), scan_reason: null, scanned_at: new Date().toISOString() }
    : { scan_status: 'rejected', scan_reason: inspection.reason, scanned_at: new Date().toISOString() }
  const updated = await tenantUpdate(input.companyId, 'customer_case_attachments', patch)
    .eq('id', (insert.data as unknown as SupportAttachmentRow).id)
    .eq('customer_case_id', input.caseId)
    .select(COLUMNS)
    .single()
  if (updated.error) throw updated.error
  return updated.data as unknown as SupportAttachmentRow
}

export async function listSupportAttachments(scope: CaseScope & { audience: 'staff' | 'customer' }): Promise<SupportAttachmentRow[]> {
  let query = tenantSelect(scope.companyId, 'customer_case_attachments', COLUMNS)
    .eq('customer_id', scope.customerId)
    .eq('customer_case_id', scope.caseId)
  if (scope.audience === 'customer') query = query.eq('visibility', 'customer').eq('scan_status', 'released')
  const { data, error } = await query.order('created_at', { ascending: true }).limit(100)
  if (error) throw error
  return (data ?? []) as unknown as SupportAttachmentRow[]
}

/** Historical V1 page size of the customer attachment list (oldest first). */
export const SUPPORT_ATTACHMENT_LIST_PAGE_SIZE = 100

/**
 * Oldest-first attachment list with an optional continuation cursor. Without a cursor the first page
 * equals the historical V1 response (oldest 100). The cursor is bound to tenant, customer, case and
 * audience; filters (released + customer visibility for customers) are applied before the limit.
 */
export async function listSupportAttachmentsContinuation(scope: CaseScope & { audience: 'staff' | 'customer' }, input: { cursor?: string | null } = {}) {
  const resource = `support_attachments_asc:${scope.caseId}:${scope.audience}`
  const cursor = decodePortalCursor({ cursor: input.cursor, companyId: scope.companyId, customerId: scope.customerId, resource })
  let query = tenantSelect(scope.companyId, 'customer_case_attachments', COLUMNS)
    .eq('customer_id', scope.customerId).eq('customer_case_id', scope.caseId)
  if (scope.audience === 'customer') query = query.eq('visibility', 'customer').eq('scan_status', 'released')
  if (cursor) query = query.or(`created_at.gt.${cursor.orderValue},and(created_at.eq.${cursor.orderValue},id.gt.${cursor.id})`)
  const { data, error } = await query.order('created_at', { ascending: true }).order('id', { ascending: true }).limit(SUPPORT_ATTACHMENT_LIST_PAGE_SIZE + 1)
  if (error) throw error
  const page = buildPortalDatabasePage((data ?? []) as unknown as Array<SupportAttachmentRow & Record<string, unknown>>, {
    limit: SUPPORT_ATTACHMENT_LIST_PAGE_SIZE, companyId: scope.companyId, customerId: scope.customerId, resource, orderColumn: 'created_at',
  })
  return { items: page.items as SupportAttachmentRow[], nextCursor: page.page.next_cursor }
}

/** Addressable history for staff API clients; no silent fixed-size truncation. */
export async function listSupportAttachmentsPage(scope: CaseScope & { audience: 'staff' | 'customer' }, input: { limit?: number | null; cursor?: string | null } = {}) {
  const limit = portalPageLimit(input.limit)
  const resource = `support_attachments:${scope.caseId}:${scope.audience}`
  const cursor = decodePortalCursor({ cursor: input.cursor, companyId: scope.companyId, customerId: scope.customerId, resource })
  let query = tenantSelect(scope.companyId, 'customer_case_attachments', COLUMNS)
    .eq('customer_id', scope.customerId).eq('customer_case_id', scope.caseId)
  if (scope.audience === 'customer') query = query.eq('visibility', 'customer').eq('scan_status', 'released')
  if (cursor) query = query.or(`created_at.lt.${cursor.orderValue},and(created_at.eq.${cursor.orderValue},id.lt.${cursor.id})`)
  const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1)
  if (error) throw error
  const page = buildPortalDatabasePage((data ?? []) as unknown as Array<SupportAttachmentRow & Record<string, unknown>>, {
    limit, companyId: scope.companyId, customerId: scope.customerId, resource, orderColumn: 'created_at',
  })
  return { items: page.items, page: page.page }
}

/** Returns verified bytes of a released attachment, or refuses. */
export async function downloadSupportAttachment(scope: CaseScope & { reference: string; audience: 'staff' | 'customer' }): Promise<{ row: SupportAttachmentRow; bytes: Buffer }> {
  let query = tenantSelect(scope.companyId, 'customer_case_attachments', COLUMNS)
    .eq('customer_id', scope.customerId)
    .eq('customer_case_id', scope.caseId)
    .eq('public_reference', scope.reference)
  if (scope.audience === 'customer') query = query.eq('visibility', 'customer')
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  const row = data as unknown as SupportAttachmentRow | null
  if (!row) throw new SupportAttachmentError('attachment_not_found', 'Bilagan hittades inte.', 404)
  if (row.scan_status !== 'released') {
    throw new SupportAttachmentError('attachment_unavailable', row.scan_status === 'rejected' ? 'Bilagan godkändes inte i innehållskontrollen.' : 'Bilagan kontrolleras fortfarande.', 409)
  }
  const download = await supabaseService.storage.from(SUPPORT_ATTACHMENT_BUCKET).download(row.storage_path)
  if (download.error || !download.data) throw new SupportAttachmentError('attachment_unavailable', 'Bilagan kunde inte hämtas just nu.', 503)
  const bytes = Buffer.from(await download.data.arrayBuffer())
  if (bytes.length > SUPPORT_ATTACHMENT_MAX_BYTES || createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
    throw new SupportAttachmentError('attachment_unavailable', 'Bilagans innehåll stämmer inte med det som laddades upp.', 409)
  }
  return { row, bytes }
}

/** Public customer view of a released attachment: opaque reference only, no internal ids or paths. */
export type PublicSupportAttachment = {
  attachment_reference: string
  file_name: string
  mime_type: AttachmentMime
  byte_size: number
  sha256: string
  uploaded_by: 'customer' | 'staff'
  created_at: string
}

export function publicSupportAttachment(row: SupportAttachmentRow): PublicSupportAttachment {
  return {
    attachment_reference: row.public_reference,
    file_name: row.file_name,
    mime_type: row.detected_mime_type as AttachmentMime,
    byte_size: row.byte_size,
    sha256: row.sha256,
    uploaded_by: row.uploaded_by_kind,
    created_at: row.created_at,
  }
}
