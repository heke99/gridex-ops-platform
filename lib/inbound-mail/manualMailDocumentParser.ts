import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { z } from 'zod'

export const MANUAL_MAIL_DOCUMENT_EXTRACTOR_VERSION = 'manual-mail-documents-v1'
export const MANUAL_MAIL_DOCUMENT_LIMITS = Object.freeze({ documents: 5, fileBytes: 4 * 1024 * 1024, totalBytes: 6 * 1024 * 1024,
  pdfPages: 12, cells: 20_000, sheets: 16, archiveBytes: 16 * 1024 * 1024, characters: 24_000, units: 160, unitCharacters: 2000,
  workerMilliseconds: 8000, imagePixels: 20_000_000, imageDimension: 10_000 })

export type ManualDocumentUnit = { attachmentId: string; sha256: string; origin: 'pdf_ocr' | 'image_ocr' | 'spreadsheet' | 'text'; locator: string; text: string }
export type VisualDocument = { attachmentId: string; sha256: string; mimeType: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp';
  filename: string; contentBase64: string; pageCount: number; kind: 'pdf' | 'image' }
export type ManualDocumentManifestEntry = { attachmentId: string; mimePart: number; sha256: string; mimeType: string; filename: string;
  sizeBytes: number; sourceRole: 'forwarded' | 'attachment' | 'inline'; pageCount?: number }
export type ManualMailDocuments = { status: 'completed' | 'needs_review'; extractorVersion: string; manifest: ManualDocumentManifestEntry[];
  units: ManualDocumentUnit[]; visuals: VisualDocument[]; reasons: string[] }

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const manifestSchema = z.object({ attachmentId: z.string().min(1).max(100), mimePart: z.number().int().min(0).max(255), sha256: hash,
  mimeType: z.string().min(1).max(200), filename: z.string().min(1).max(255), sizeBytes: z.number().int().min(1).max(MANUAL_MAIL_DOCUMENT_LIMITS.fileBytes),
  sourceRole: z.enum(['forwarded', 'attachment', 'inline']), pageCount: z.number().int().min(1).max(12).optional() }).strict()
const unitSchema = z.object({ attachmentId: z.string(), sha256: hash, origin: z.enum(['pdf_ocr', 'image_ocr', 'spreadsheet', 'text']),
  locator: z.string().min(1).max(300), text: z.string().min(1).max(2000) }).strict()
const visualSchema = z.object({ attachmentId: z.string(), sha256: hash, mimeType: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
  filename: z.string(), contentBase64: z.string().max(Math.ceil(MANUAL_MAIL_DOCUMENT_LIMITS.fileBytes / 3) * 4), pageCount: z.number().int().min(1).max(12), kind: z.enum(['pdf', 'image']) }).strict()
const resultSchema = z.object({ status: z.enum(['completed', 'needs_review']), manifest: z.array(manifestSchema).max(5),
  units: z.array(unitSchema).max(160), visuals: z.array(visualSchema).max(5), reasons: z.array(z.string().regex(/^document_[a-z_]+$/)).max(20) }).strict()

function base64Alphabet(value: string): boolean {
  if (!value.length || value.length % 4) return false
  let end = value.length
  if (value[end - 1] === '=') end--
  if (value[end - 1] === '=') end--
  for (let i = 0; i < end; i++) {
    const code = value.charCodeAt(i)
    if (!(code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || code === 43 || code === 47)) return false
  }
  return true
}

/** Parses only immutable bytes supplied by the authenticated MIME capture.
 * Each row/page remains a separate source; this function never selects a customer. */
export async function prepareManualMailDocuments(attachments: unknown[]): Promise<ManualMailDocuments> {
  const manifest: ManualDocumentManifestEntry[] = []
  const failed = (reason: string): ManualMailDocuments => ({ status: 'needs_review', extractorVersion: MANUAL_MAIL_DOCUMENT_EXTRACTOR_VERSION,
    manifest, units: [], visuals: [], reasons: [reason] })
  if (!Array.isArray(attachments)) return failed('document_attachment_invalid')
  if (attachments.length > MANUAL_MAIL_DOCUMENT_LIMITS.documents) return failed('document_count_limit')
  const documents: Array<{ entry: ManualDocumentManifestEntry; bytes: Uint8Array }> = []
  let totalBytes = 0
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) return failed('document_attachment_invalid')
    const row = attachment as Record<string, unknown>
    if (row.capturedIssue) return failed('document_capture_incomplete')
    if (typeof row.contentType !== 'string' || row.contentType.length > 200 || !Number.isInteger(row.mimePart)
      || Number(row.mimePart) < 0 || Number(row.mimePart) > 255 || !['forwarded', 'attachment', 'inline'].includes(String(row.sourceRole))
      || !hash.safeParse(row.sha256).success || !Number.isInteger(row.sizeBytes) || Number(row.sizeBytes) <= 0) return failed('document_attachment_invalid')
    if (Number(row.sizeBytes) > MANUAL_MAIL_DOCUMENT_LIMITS.fileBytes) return failed('document_file_bytes_limit')
    totalBytes += Number(row.sizeBytes)
    if (totalBytes > MANUAL_MAIL_DOCUMENT_LIMITS.totalBytes) return failed('document_total_bytes_limit')
    const mimeType = row.contentType.split(';')[0].trim().toLowerCase()
    if (row.filename != null && (typeof row.filename !== 'string' || row.filename.length > 255 || /[\x00-\x1f\x7f]/.test(row.filename))) return failed('document_attachment_invalid')
    const filename = typeof row.filename === 'string' && row.filename.trim() ? row.filename.trim() : `document-part-${row.mimePart}.${mimeType === 'application/pdf' ? 'pdf' : 'bin'}`
    const entry: ManualDocumentManifestEntry = { attachmentId: `part:${row.mimePart}:${row.sha256}`, mimePart: Number(row.mimePart), sha256: String(row.sha256),
      mimeType, filename, sizeBytes: Number(row.sizeBytes), sourceRole: row.sourceRole as ManualDocumentManifestEntry['sourceRole'] }
    if (manifest.some(previous => previous.mimePart === entry.mimePart)) return failed('document_attachment_invalid')
    manifest.push(entry)
    // An attached forwarded message remains history, even when its filename or
    // body resembles a current reply document. It is never sent for OCR.
    if (entry.sourceRole === 'forwarded') continue
    if (typeof row.contentBase64 !== 'string' || row.contentBase64.length > Math.ceil(MANUAL_MAIL_DOCUMENT_LIMITS.fileBytes / 3) * 4
      || !base64Alphabet(row.contentBase64)) return failed('document_base64_invalid')
    const bytes = Buffer.from(row.contentBase64, 'base64')
    if (bytes.length !== entry.sizeBytes || bytes.toString('base64') !== row.contentBase64
      || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) return failed('document_bytes_mismatch')
    documents.push({ entry, bytes: Uint8Array.from(bytes) })
  }
  if (!documents.length) return { status: 'completed', extractorVersion: MANUAL_MAIL_DOCUMENT_EXTRACTOR_VERSION, manifest, units: [], visuals: [], reasons: [] }
  return new Promise(resolve => {
    let settled = false
    let worker: Worker | undefined
    const finish = (result: ManualMailDocuments) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      void worker?.terminate().catch(() => undefined)
      resolve(result)
    }
    const timer = setTimeout(() => finish(failed('document_worker_timeout')), MANUAL_MAIL_DOCUMENT_LIMITS.workerMilliseconds)
    try {
      worker = new Worker(join(process.cwd(), 'lib/inbound-mail/manualMailDocumentParserWorker.cjs'), {
        workerData: { documents, manifest, limits: MANUAL_MAIL_DOCUMENT_LIMITS },
        transferList: documents.map(document => document.bytes.buffer as ArrayBuffer),
        resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      })
      worker.once('message', (value: unknown) => {
        const parsed = resultSchema.safeParse(value)
        if (!parsed.success) return finish(failed('document_worker_invalid_result'))
        const result = parsed.data
        if (result.status === 'needs_review') return finish({ ...result, units: [], visuals: [], extractorVersion: MANUAL_MAIL_DOCUMENT_EXTRACTOR_VERSION })
        if (result.reasons.length || result.units.reduce((sum, unit) => sum + unit.text.length, 0) > MANUAL_MAIL_DOCUMENT_LIMITS.characters
          || result.units.some(unit => !manifest.some(entry => entry.attachmentId === unit.attachmentId && entry.sha256 === unit.sha256))
          || result.visuals.some(visual => !manifest.some(entry => entry.attachmentId === visual.attachmentId && entry.sha256 === visual.sha256))) return finish(failed('document_worker_invalid_result'))
        finish({ ...result, extractorVersion: MANUAL_MAIL_DOCUMENT_EXTRACTOR_VERSION })
      })
      worker.once('error', () => finish(failed('document_worker_failed')))
      worker.once('exit', () => { if (!settled) finish(failed('document_worker_failed')) })
    } catch { finish(failed('document_worker_failed')) }
  })
}
