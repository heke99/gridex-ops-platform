import 'server-only'
import { supabaseService } from '@/lib/supabase/service'
import { PRICE_SERIES_TEST_INVOICE_SOURCE, type CustomerInvoiceDocumentRow, type CustomerInvoiceRow } from './types'

const PDF_BUCKET = 'billing-exports'

type PortalInvoicePdfSource =
  | { kind: 'partner'; url: string }
  | {
      kind: 'storage'
      bucket: typeof PDF_BUCKET | 'customer-documents'
      path: string
      rowId: string
      capture?: { copyId: string; objectId: string; hash: string; byteLength: number }
    }

function partnerPdfUrl(raw: string | null | undefined) {
  if (!raw || !/^https?:\/\//.test(raw)) return null
  try {
    const url = new URL(raw)
    return url.username || url.password ? null : url.toString()
  } catch {
    return null
  }
}

export function portalInvoicePdfSource(
  companyId: string | null,
  invoice: CustomerInvoiceRow,
  documents: CustomerInvoiceDocumentRow[],
): PortalInvoicePdfSource | null {
  if (!companyId) return null
  const expectedPath = `companies/${companyId}/invoices/${invoice.id}.pdf`
  const sources = [
    { rowId: invoice.id, url: invoice.pdf_url, path: invoice.pdf_path, bucket: invoice.metadata?.bucket },
    ...documents.map(document => ({
      rowId: document.id,
      url: document.public_url,
      path: document.file_path,
      bucket: document.storage_bucket || document.metadata?.bucket,
    })),
  ]

  for (const source of sources) {
    const url = partnerPdfUrl(source.url)
    if (url) return { kind: 'partner', url }
  }

  // Existing partner paths are not authoritative Storage locators. The known
  // private export path names the exact invoice, so a sibling invoice cannot
  // be selected through this route even if its path appears on a document row.
  for (const source of sources) {
    if (source.bucket && source.bucket !== PDF_BUCKET) continue
    if (source.path === `${PDF_BUCKET}/${expectedPath}`
      || (source.path === expectedPath && source.bucket === PDF_BUCKET)) {
      return { kind: 'storage', bucket: PDF_BUCKET, path: expectedPath, rowId: source.rowId }
    }
  }
  return null
}

const MAX_PDF_BYTES = 20 * 1024 * 1024
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/

export async function resolvePortalInvoicePdfSource(
  companyId: string | null,
  invoice: CustomerInvoiceRow,
  documents: CustomerInvoiceDocumentRow[],
): Promise<PortalInvoicePdfSource | null> {
  // TEST price-series issuance owns only the neutral document. Legacy locators do not bind a PDF to that issue.
  if (invoice.source_system === PRICE_SERIES_TEST_INVOICE_SOURCE) return null
  const direct = portalInvoicePdfSource(companyId, invoice, documents)
  if (direct) return direct
  if (!companyId) return null
  const documentIds = documents.filter(document => document.file_path).map(document => document.id)
  if (!invoice.pdf_path && !documentIds.length) return null

  // Until the local migration is installed, older paths still use the
  // normal unavailable screen. The response port exposes no public locator.
  const { error, data } = await supabaseService.rpc('gridex_read_portal_captured_invoice_pdf_v1', {
    p_company_id: companyId, p_customer_id: invoice.customer_id, p_invoice_id: invoice.id,
    p_document_ids: documentIds, p_include_invoice_pdf: Boolean(invoice.pdf_path),
  })
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) return null

  const { copyId, targetId, retentionClass, objectId, bucket, path, sha256, byteLength } = data as Record<string, unknown>
  if (bucket !== 'customer-documents'
    || typeof path !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(path)
    || path.includes('//') || /(?:^|\/)\.\.?(?:\/|$)/.test(path)
    || !path.startsWith(`companies/${companyId}/customers/${invoice.customer_id}/`)
    || typeof copyId !== 'string' || !UUID.test(copyId)
    || typeof targetId !== 'string' || !UUID.test(targetId)
    || typeof objectId !== 'string' || !UUID.test(objectId)
    || typeof sha256 !== 'string' || !SHA256.test(sha256)
    || typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength)
    || byteLength < 1 || byteLength > MAX_PDF_BYTES) return null

  const declaredPath = `${bucket}/${path}`
  const matchesCurrentSource = retentionClass === 'customer_invoice_pdf_bytes'
    ? targetId === invoice.id && (invoice.pdf_path === path || invoice.pdf_path === declaredPath)
    : retentionClass === 'customer_invoice_document_pdf_bytes'
      && documents.some(document => document.id === targetId
        && (document.file_path === path || document.file_path === declaredPath))
  if (!matchesCurrentSource) return null

  return { kind: 'storage', bucket, path, rowId: targetId, capture: { copyId, objectId, hash: sha256, byteLength } }
}

export function samePortalInvoicePdfCopy(
  source: Extract<PortalInvoicePdfSource, { kind: 'storage' }>,
  reread: PortalInvoicePdfSource | null,
): boolean {
  return reread?.kind === 'storage'
    && reread.rowId === source.rowId && reread.bucket === source.bucket && reread.path === source.path
    && reread.capture?.copyId === source.capture?.copyId
    && reread.capture?.objectId === source.capture?.objectId
    && reread.capture?.hash === source.capture?.hash
    && reread.capture?.byteLength === source.capture?.byteLength
}

export async function readPortalInvoicePdfBytes(stream: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    signal.throwIfAborted()
    for (;;) {
      const chunk = await reader.read()
      signal.throwIfAborted()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > MAX_PDF_BYTES) return null
      chunks.push(chunk.value)
    }
    const pdf = Buffer.concat(chunks, length)
    return pdf.subarray(0, 5).equals(Buffer.from('%PDF-')) ? pdf : null
  } finally {
    signal.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}
