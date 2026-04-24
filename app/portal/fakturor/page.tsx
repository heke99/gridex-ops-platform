import Link from 'next/link'
import { getCustomerPortalContext, listPortalInvoices } from '@/lib/customer-portal/db'
import {
  formatDate,
  formatKwh,
  formatPeriod,
  formatSek,
  invoiceStatusLabel,
  invoiceStatusTone,
} from '@/lib/customer-portal/format'

export const dynamic = 'force-dynamic'

export default async function PortalInvoicesPage() {
  const context = await getCustomerPortalContext()
  const invoices = await listPortalInvoices(context)

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">Mina fakturor</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Här visas fakturor som fakturapartnern har skapat och skickat tillbaka till Gridex.
          Fakturaunderlag som ännu inte blivit faktura visas inte här.
        </p>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <h2 className="text-lg font-semibold text-slate-950">Fakturor</h2>
          <p className="mt-1 text-sm text-slate-500">{invoices.length} fakturor.</p>
        </div>

        <div className="divide-y divide-slate-100">
          {invoices.map((invoice) => (
            <Link key={invoice.id} href={`/portal/fakturor/${invoice.id}`} className="block px-6 py-5 hover:bg-slate-50">
              <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto] lg:items-center">
                <div>
                  <div className="font-semibold text-slate-950">
                    {invoice.invoice_number ?? invoice.partner_invoice_reference ?? invoice.id}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Partnerref: {invoice.partner_invoice_reference ?? '—'}
                  </div>
                </div>

                <div className="text-sm text-slate-600">{formatPeriod(invoice.period_start, invoice.period_end)}</div>
                <div className="text-sm text-slate-600">Förfallodatum {formatDate(invoice.due_date)}</div>
                <div className="text-sm font-semibold text-slate-950">{formatSek(invoice.amount_inc_vat)}</div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${invoiceStatusTone(invoice.status)}`}>
                    {invoiceStatusLabel(invoice.status)}
                  </span>
                  <span className="text-xs text-slate-500">{formatKwh(invoice.total_kwh)}</span>
                </div>
              </div>
            </Link>
          ))}

          {invoices.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              Inga fakturor har importerats från fakturapartnern ännu.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
