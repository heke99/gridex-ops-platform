import 'server-only'

import { createHash } from 'node:crypto'
import type { InvoiceFileFormat, InvoiceFileRecord } from '@/lib/billing/invoiceFileExport'
import { supabaseService } from '@/lib/supabase/service'

const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024
const CONTENT_TYPE: Record<InvoiceFileFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json; charset=utf-8',
  nordfin_xml: 'application/xml; charset=utf-8',
}

export class InvalidInvoiceFileArtifactError extends Error {
  constructor() {
    super('invoice_file_frozen_artifact_invalid')
  }
}

type ArchiveIdentity = Pick<InvoiceFileRecord, 'id' | 'billing_month'>

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export async function loadInvoiceFileArtifact(companyId: string, file: ArchiveIdentity, format: InvoiceFileFormat) {
  // The additive RPC ships before its application consumer and canonical types.
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (
    name: 'gridex_read_invoice_file_artifact_v2',
    args: { p_company_id: string; p_file_id: string; p_format: InvoiceFileFormat },
  ) => PromiseLike<{ data: unknown; error: unknown }>
  const { data, error } = await rpc('gridex_read_invoice_file_artifact_v2', {
    p_company_id: companyId, p_file_id: file.id, p_format: format,
  })
  if (error) {
    const fault = record(error)
    if (fault?.code === '23514' && fault.message === 'invoice_file_frozen_artifact_invalid') {
      throw new InvalidInvoiceFileArtifactError()
    }
    throw error
  }

  const artifact = record(data)
  // PostgREST also sets data to null for a missing HTTP body. Only an
  // affirmative native classification proves that the old rows may be rendered.
  if (artifact?.kind === 'legacy' && Object.keys(artifact).length === 1) return null
  if (!artifact || 'kind' in artifact) throw new InvalidInvoiceFileArtifactError()

  const contentType = CONTENT_TYPE[format]
  const base = `fakturor-${file.billing_month}-${file.id.slice(0, 8)}`
  const fileName = format === 'nordfin_xml' ? `nordfin-${base}.xml` : `${base}.${format}`
  const { byteLength, bodyBase64, sha256, rendererVersion } = artifact
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(file.billing_month) || !/^[0-9a-f]{8}$/i.test(file.id.slice(0, 8)) ||
    artifact.format !== format || artifact.fileName !== fileName || artifact.contentType !== contentType ||
    typeof rendererVersion !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(rendererVersion) ||
    typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) ||
    typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_ARTIFACT_BYTES ||
    typeof bodyBase64 !== 'string' || bodyBase64.length !== 4 * Math.ceil(byteLength / 3)) {
    throw new InvalidInvoiceFileArtifactError()
  }

  const body = Buffer.from(bodyBase64, 'base64')
  if (body.length !== byteLength || body.toString('base64') !== bodyBase64 ||
    createHash('sha256').update(body).digest('hex') !== sha256) {
    throw new InvalidInvoiceFileArtifactError()
  }

  return { fileName, contentType, body }
}
