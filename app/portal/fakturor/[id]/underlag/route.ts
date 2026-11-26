import { getCustomerPortalContext } from '@/lib/customer-portal/db'
import { readIssuedInvoiceUnderlay } from '@/lib/customer-portal/consolidatedInvoiceDocument'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getCustomerPortalContext()
  const { id } = await params
  const result = await readIssuedInvoiceUnderlay(context, id)
  if (result.kind !== 'ready') {
    const status = result.kind === 'retired' ? 410 : result.kind === 'unavailable' ? 503 : 404
    return new Response(status === 410 ? 'Fakturaunderlaget är inte längre tillgängligt.' :
      status === 503 ? 'Fakturaunderlaget kan inte läsas just nu.' : 'Fakturaunderlaget hittades inte.',
    { status, headers: noStore })
  }
  const fileName = result.document.format === 'gridex_customer_price_series_invoice_test_v1'
    ? 'fakturaunderlag-prisperioder-test.json'
    : 'samlingsfaktura.json'
  return new Response(result.bytes, {
    headers: { ...noStore, 'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"` },
  })
}
