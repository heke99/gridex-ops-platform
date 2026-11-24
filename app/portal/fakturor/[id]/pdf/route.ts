import { createHash } from 'node:crypto'
import { getCustomerPortalContext, getPortalInvoiceDetail } from '@/lib/customer-portal/db'
import { readPortalInvoicePdfBytes, resolvePortalInvoicePdfSource, samePortalInvoicePdfCopy } from '@/lib/customer-portal/portalInvoicePdf'
import { supabaseService } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

function unavailable(status = 404) {
  return new Response('Ingen PDF-kopia kan visas här just nu. Kontakta kundservice om du behöver en kopia.', {
    status,
    headers: { ...privateHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const readSource = async () => {
    const context = await getCustomerPortalContext()
    const { invoice, documents } = await getPortalInvoiceDetail(context, id, { loadLines: false })
    return invoice ? resolvePortalInvoicePdfSource(context.companyId, invoice, documents) : null
  }

  const source = await readSource()
  if (!source) return unavailable()
  if (source.kind === 'partner') {
    return new Response(null, { status: 303, headers: { ...privateHeaders, Location: source.url } })
  }

  const signal = AbortSignal.timeout(10_000)
  const { data, error } = await supabaseService.storage.from(source.bucket)
    .download(source.path, {}, { cache: 'no-store', signal }).asStream()
  if (error || !data) return unavailable(error && 'statusCode' in error && String(error.statusCode) === '404' ? 404 : 503)

  const pdf = await readPortalInvoicePdfBytes(data, signal).catch(() => null)
  if (!pdf) return unavailable(signal.aborted ? 503 : 404)
  if (source.capture && (pdf.length !== source.capture.byteLength
    || createHash('sha256').update(pdf).digest('hex') !== source.capture.hash)) return unavailable()

  const current = await readSource()
  if (!samePortalInvoicePdfCopy(source, current)) return unavailable()

  return new Response(new Uint8Array(pdf), {
    headers: {
      ...privateHeaders,
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="faktura.pdf"',
      'Content-Length': String(pdf.length),
    },
  })
}
