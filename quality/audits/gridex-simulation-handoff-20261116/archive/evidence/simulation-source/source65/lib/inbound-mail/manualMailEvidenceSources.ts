import { createHash } from 'node:crypto'
import { z } from 'zod'
import { MANUAL_MAIL_DOCUMENT_EXTRACTOR_VERSION, MANUAL_MAIL_DOCUMENT_LIMITS,
  type ManualDocumentManifestEntry, type ManualDocumentUnit } from '@/lib/inbound-mail/manualMailDocumentParser'

export type ManualMailSourceCatalogEntry = Readonly<{
  source: number
  origin: 'body' | ManualDocumentUnit['origin']
  attachmentId?: string
  sha256?: string
  locator?: string
  text: string
  part: number
}>

export type ManualMailSourceCorpus = Readonly<{
  ok: true
  text: string
  sourceHash: string
  sourceVersion: 2
  manifestHash: string
  catalog: readonly ManualMailSourceCatalogEntry[]
  documentSources: true
}>

type ManualMailSourceCorpusResult = ManualMailSourceCorpus | { ok: false; reasons: string[] }
const producedCorpora = new WeakSet<object>()

/** Accepts only an immutable success result produced in this server process. */
export function isManualMailSourceCorpus(value: unknown): value is ManualMailSourceCorpus {
  return value !== null && typeof value === 'object' && producedCorpora.has(value)
}

const limits = MANUAL_MAIL_DOCUMENT_LIMITS
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const manifestSchema = z.array(z.object({
  attachmentId: z.string().min(1).max(100), mimePart: z.number().int().min(0).max(255), sha256: hash,
  mimeType: z.string().min(1).max(200), filename: z.string().min(1).max(255),
  sizeBytes: z.number().int().min(1).max(limits.fileBytes), sourceRole: z.enum(['forwarded', 'attachment', 'inline']),
  pageCount: z.number().int().min(1).max(limits.pdfPages).optional(),
}).strict()).max(limits.documents)
const unitsSchema = z.array(z.object({
  attachmentId: z.string().min(1).max(100), sha256: hash, origin: z.enum(['pdf_ocr', 'image_ocr', 'spreadsheet', 'text']),
  locator: z.string().min(1).max(300), text: z.string().min(1).max(limits.characters),
}).strict()).max(limits.units)

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>
    return `{${Object.keys(row).filter(key => row[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

/** Binds server-extracted text to its original attachment bytes and exact source
 * locations. The caller supplies only the authored reply body; document text is
 * never passed through reply-history stripping. No customer is selected here. */
export function createManualMailSourceCorpus(
  authoredBody: string,
  units: readonly ManualDocumentUnit[],
  manifest: readonly ManualDocumentManifestEntry[],
  extractorVersion = MANUAL_MAIL_DOCUMENT_EXTRACTOR_VERSION,
): ManualMailSourceCorpusResult {
  const failed = (reason: string): ManualMailSourceCorpusResult => ({ ok: false, reasons: [reason] })
  if (typeof authoredBody !== 'string'
    || typeof extractorVersion !== 'string' || !extractorVersion.trim() || extractorVersion.length > 100) return failed('document_source_invalid')
  if (authoredBody.length > limits.characters) return failed('document_source_character_limit')
  const parsedManifest = manifestSchema.safeParse(manifest), parsedUnits = unitsSchema.safeParse(units)
  if (!parsedUnits.success && parsedUnits.error.issues.some(issue => issue.code === 'too_big' && issue.path.at(-1) === 'text')) return failed('document_source_character_limit')
  if (!parsedManifest.success || !parsedUnits.success) return failed('document_source_invalid')
  const manifestSnapshot = parsedManifest.data, unitsSnapshot = parsedUnits.data
  if (new Set(manifestSnapshot.map(entry => entry.attachmentId)).size !== manifestSnapshot.length
    || new Set(manifestSnapshot.map(entry => entry.mimePart)).size !== manifestSnapshot.length
    || manifestSnapshot.reduce((sum, entry) => sum + entry.sizeBytes, 0) > limits.totalBytes) return failed('document_source_manifest_invalid')
  const locators = new Set<string>()
  for (const unit of unitsSnapshot) {
    const original = manifestSnapshot.find(entry => entry.attachmentId === unit.attachmentId && entry.sha256 === unit.sha256)
    if (!original || original.sourceRole === 'forwarded') return failed('document_source_unbound')
    const locatorKey = JSON.stringify([unit.attachmentId, unit.locator])
    if (locators.has(locatorKey)) return failed('document_source_locator_duplicate')
    locators.add(locatorKey)
    if (!unit.text.trim()) return failed('document_source_empty')
  }
  const catalog: ManualMailSourceCatalogEntry[] = []
  const append = (text: string, provenance: Omit<ManualMailSourceCatalogEntry, 'source' | 'text' | 'part'>): string | null => {
    const paragraphs = text.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean)
    for (const [part, paragraph] of paragraphs.entries()) {
      if (paragraph.length > limits.unitCharacters) return 'document_source_paragraph_limit'
      if (catalog.length >= limits.units) return 'document_source_count_limit'
      catalog.push(Object.freeze({ ...provenance, source: catalog.length, text: paragraph, part }))
    }
    return null
  }
  const bodyIssue = append(authoredBody, { origin: 'body' })
  if (bodyIssue) return failed(bodyIssue)
  for (const unit of unitsSnapshot) {
    const issue = append(unit.text, { origin: unit.origin, attachmentId: unit.attachmentId, sha256: unit.sha256, locator: unit.locator })
    if (issue) return failed(issue)
  }
  if (!catalog.length) return failed('document_source_empty')
  const text = catalog.map(entry => entry.text).join('\n\n')
  if (text.length > limits.characters) return failed('document_source_character_limit')
  const manifestHash = sha256(manifestSnapshot)
  const sourceHash = sha256({ sourceVersion: 2, authoredBody, units: unitsSnapshot, manifest: manifestSnapshot,
    extractorVersion, manifestHash, catalog })
  const result: ManualMailSourceCorpus = Object.freeze({ ok: true, text, sourceHash, sourceVersion: 2, manifestHash,
    catalog: Object.freeze(catalog), documentSources: true })
  producedCorpora.add(result)
  return result
}
