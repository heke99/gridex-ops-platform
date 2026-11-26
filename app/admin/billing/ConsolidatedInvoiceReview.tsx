import Link from 'next/link'
import { consolidatedInvoiceStatuses, readConsolidatedInvoiceReviewsForAdmin } from '@/lib/billing/consolidatedInvoiceAdmin'
import { approveConsolidatedInvoiceDraftAction, issueConsolidatedInvoiceAction } from './actions'
import { createConsolidatedInvoiceNeutralFileAction } from './group-invoice-files/actions'

type Props = { companyId: string; billingMonth: string; customerId: string | null; afterInvoiceId?: string; canApprove: boolean }

async function approveReview(formData: FormData) {
  'use server'
  await approveConsolidatedInvoiceDraftAction(formData)
}

export default async function ConsolidatedInvoiceReview(props: Props) {
  const { companyId, billingMonth, customerId, afterInvoiceId, canApprove } = props
  const rows = await readConsolidatedInvoiceReviewsForAdmin({ companyId, billingMonth, customerId, afterInvoiceId })
  if (rows === null) {
    return <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Samlingsfakturorna kunde inte läsas. Försök igen.</p>
  }
  if (rows.length === 0) return null
  const visible = rows.slice(0, 20)
  const next = rows.length > visible.length ? new URLSearchParams({
    month: billingMonth, ...(customerId ? { customer: customerId } : {}), group_after: visible[visible.length - 1].invoiceId,
  }).toString() : null

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5" aria-labelledby="invoice-group-heading">
      <h2 id="invoice-group-heading" className="font-semibold text-slate-950">{visible.some(row => row.reviewType) ? 'Samlingsfakturor och prisperioder' : 'Samlingsfakturor'}</h2>
      {visible.map(row => {
        const priceSeries = row.reviewType === 'test_price_series'
        const money = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: row.currency })
        const quantity = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 4 })
        return (
          <article key={row.invoiceId} className="space-y-3 rounded-xl border border-slate-200 p-4 text-sm">
            <header className="flex flex-wrap justify-between gap-2">
              <h3 className="font-semibold">{row.customerName ?? 'Kund'} · {money.format(row.totalAmount)}</h3>
              <span>{consolidatedInvoiceStatuses[row.status]}</span>
            </header>
            {priceSeries ? <p>Två eller flera prisperioder på samma anläggning (TEST)</p> : null}
            {row.invoiceNumber ? <p>Fakturanummer {row.invoiceNumber}</p> : null}
            <div className="overflow-auto">
              <table className="min-w-full text-left">
                <thead><tr><th scope="col">Anläggning</th><th scope="col">Period</th><th scope="col">Elområde</th><th scope="col">Mängd</th><th scope="col">Belopp inkl. moms</th></tr></thead>
                <tbody>{row.sources.map(source => (
                  <tr key={source.underlayId}>
                    <td><span>{source.facilityReference ?? source.siteId}</span><small className="block text-slate-500">Underlag {source.underlayId}</small></td>
                    <td>{source.periodStart} – {source.periodEnd}{priceSeries ? ' (exklusiv)' : null}</td>
                    <td>{source.priceArea}</td>
                    <td>{quantity.format(source.quantityKwh)} kWh</td>
                    <td>{money.format(source.totalAmount)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {row.status === 'pending_review' && canApprove ? (
              <form action={approveReview}>
                <input type="hidden" name="billing_month" value={row.billingMonth} />
                <input type="hidden" name="invoice_id" value={row.invoiceId} />
                <input type="hidden" name="review_hash" value={row.reviewHash} />
                <button className="rounded-lg bg-slate-950 px-3 py-2 font-semibold text-white">{priceSeries ? 'Attestera prisperioderna (TEST)' : 'Attestera samlingsfaktura'}</button>
              </form>
            ) : null}
            {row.status === 'approved' && row.canIssue && canApprove ? (
              <form action={issueConsolidatedInvoiceAction}>
                <input type="hidden" name="billing_month" value={row.billingMonth} />
                <input type="hidden" name="invoice_id" value={row.invoiceId} />
                <input type="hidden" name="review_hash" value={row.reviewHash} />
                <button className="rounded-lg bg-slate-950 px-3 py-2 font-semibold text-white">{priceSeries ? 'Utfärda faktura för prisperioderna (TEST)' : 'Utfärda samlingsfaktura'}</button>
              </form>
            ) : null}
            {row.status === 'issued' && canApprove ? (
              <form action={createConsolidatedInvoiceNeutralFileAction}>
                <input type="hidden" name="invoice_id" value={row.invoiceId} />
                <input type="hidden" name="group_review_hash" value={row.reviewHash} />
                <button className="rounded-lg border border-slate-300 px-3 py-2 font-semibold">Skapa neutral fakturafil</button>
              </form>
            ) : null}
          </article>
        )
      })}
      {next ? <Link href={`/admin/billing?${next}`} className="text-sm font-semibold underline">Nästa samlingsfakturor</Link> : null}
    </section>
  )
}
