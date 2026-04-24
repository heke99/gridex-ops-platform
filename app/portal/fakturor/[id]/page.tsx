import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCustomerPortalContext, getPortalInvoiceDetail } from '@/lib/customer-portal/db'
import {
  formatDate,
  formatKwh,
  formatPeriod,
  formatSek,
  invoiceStatusLabel,
  invoiceStatusTone,
} from '@/lib/customer-portal/format'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

function documentHref(value: string | null | undefined): string | null {
  if (!value) return null
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  return null
}

export default async function PortalInvoiceDetailPage({ params }: PageProps) {
  const { id } = await params
  const context = await getCustomerPortalContext()
  const { invoice, lines, documents } = await getPortalInvoiceDetail(context, id)

  if (!invoice) notFound()

  const pdfHref = documentHref(invoice.pdf_url)
  const documentPdf = documents.find((document) => document.public_url || document.file_path)
  const documentPdfHref = documentHref(documentPdf?.public_url)

  return (
    <div className="space-y-6">
      <Link href="/portal/fakturor" className="inline-flex rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
        Tillbaka till fakturor
      </Link>

      <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${invoiceStatusTone(invoice.status)}`}>
              {invoiceStatusLabel(invoice.status)}
            </span>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-950">
              Faktura {invoice.invoice_number ?? invoice.partner_invoice_reference ?? invoice.id}
            </h1>
            <p className="mt-3 text-sm text-slate-500">
              Period {formatPeriod(invoice.period_start, invoice.period_end)} · Förfallodatum {formatDate(invoice.due_date)}
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-right">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Att betala</p>
            <p className="mt-2 text-3xl font-bold text-slate-950">{formatSek(invoice.amount_inc_vat)}</p>
            <p className="mt-1 text-sm text-slate-500">inkl. moms</p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Fakturarader</h2>

          <div className="mt-5 divide-y divide-slate-100">
            {lines.map((line) => (
              <div key={line.id} className="grid gap-3 py-4 md:grid-cols-[1fr_140px_140px] md:items-center">
                <div>
                  <div className="font-medium text-slate-950">{line.description}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {line.quantity ?? '—'} {line.unit ?? ''} · {line.line_type}
                  </div>
                </div>
                <div className="text-sm text-slate-600">Á-pris {formatSek(line.unit_price)}</div>
                <div className="text-right text-sm font-semibold text-slate-950">{formatSek(line.amount_ex_vat)}</div>
              </div>
            ))}

            {lines.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                Partnern har inte skickat fakturarader ännu.
              </div>
            ) : null}
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Sammanfattning</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <div className="flex justify-between gap-4"><span>Förbrukning</span><strong>{formatKwh(invoice.total_kwh)}</strong></div>
              <div className="flex justify-between gap-4"><span>Exkl. moms</span><strong>{formatSek(invoice.amount_ex_vat)}</strong></div>
              <div className="flex justify-between gap-4"><span>Moms</span><strong>{formatSek(invoice.vat_amount)}</strong></div>
              <div className="flex justify-between gap-4 border-t border-slate-200 pt-3"><span>Totalt</span><strong>{formatSek(invoice.amount_inc_vat)}</strong></div>
              <div className="flex justify-between gap-4"><span>Utfärdad</span><strong>{formatDate(invoice.issued_at)}</strong></div>
              <div className="flex justify-between gap-4"><span>Betald</span><strong>{formatDate(invoice.paid_at)}</strong></div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">PDF från partner</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              PDF:en visas när fakturapartnern skickat tillbaka en publik/signerad länk.
            </p>

            {pdfHref || documentPdfHref ? (
              <a href={pdfHref ?? documentPdfHref ?? '#'} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">
                Öppna faktura-PDF
              </a>
            ) : invoice.pdf_path || documentPdf?.file_path ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                PDF finns lagrad, men ingen publik/signerad länk är skapad ännu.
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                Ingen PDF har importerats ännu.
              </div>
            )}
          </div>
        </aside>
      </section>
    </div>
  )
}
