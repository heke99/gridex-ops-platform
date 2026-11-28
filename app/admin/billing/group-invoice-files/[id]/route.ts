import { createHash } from 'node:crypto'
import { readConsolidatedInvoiceNeutralFileForAdmin } from '@/lib/billing/consolidatedInvoiceFileAdmin'
import { GROUP_FILE_HASH } from '../keys'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function withheld(status: number, message: string) {
  return new Response(message, { status, headers: { 'cache-control': 'no-store' } })
}

function neutralFileName(id: string, bytes: Buffer) {
  const legacyName = `samlingsfaktura-${id}.json`
  try {
    const document = JSON.parse(bytes.toString('utf8')) as { format?: unknown; environment?: unknown } | null
    if (document?.format === 'gridex_customer_price_series_invoice_test_v1' && document.environment === 'test') {
      return `fakturaunderlag-prisperioder-test-${id}.json`
    }
  } catch {
    // Preserve downloads of previously archived files with the legacy name.
  }
  return legacyName
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const file = await readConsolidatedInvoiceNeutralFileForAdmin(id)
  if (file.kind === 'denied') return withheld(403, 'Saknar filbehörighet.')
  if (file.kind === 'company_required') return withheld(403, 'Välj ett bolag.')
  if (file.kind === 'tombstoned') return withheld(410, 'Fakturafilen får inte längre lämnas ut.')
  if (file.kind === 'unavailable') return withheld(503, 'Fakturafilen kan inte hämtas just nu.')
  if (file.kind === 'missing') return withheld(404, 'Fakturafilen hittades inte.')
  if (file.kind !== 'ready' || !GROUP_FILE_HASH.test(file.sha256)) {
    return withheld(409, 'Fakturafilens kontrollsumma kunde inte verifieras.')
  }
  const bytes = Buffer.from(file.bodyBase64, 'base64')
  if (bytes.length === 0 || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    return withheld(409, 'Fakturafilens kontrollsumma kunde inte verifieras.')
  }
  return new Response(new Uint8Array(bytes), { headers: {
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': `attachment; filename="${neutralFileName(id, bytes)}"`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  } })
}
