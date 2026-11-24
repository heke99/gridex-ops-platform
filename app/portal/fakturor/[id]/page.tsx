import { portalInvoiceLineTypeLabel, portalInvoiceTitle } from '@/lib/customer-portal/labels'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCustomerPortalContext, getPortalInvoiceDetail } from '@/lib/customer-portal/db'
import { resolvePortalInvoicePdfSource } from '@/lib/customer-portal/portalInvoicePdf'
import { readConsolidatedInvoiceDocument } from '@/lib/customer-portal/consolidatedInvoiceDocument'
import {
  formatDate,
  formatKwh,
  formatPeriod,
  formatSek,
  invoiceStatusLabel,
  invoiceStatusTone,
  isCancelledOrCreditedInvoice,
} from '@/lib/customer-portal/format'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function PortalInvoiceDetailPage({ params }: PageProps) {
  const { id } = await params
  const context = await getCustomerPortalContext()
  const { invoice, lines, documents, invoiceFileAvailability } = await getPortalInvoiceDetail(context, id)

  if (!invoice) notFound()

  const pdfSource = await resolvePortalInvoicePdfSource(context.companyId, invoice, documents)
  const groupedDocument = invoice.source_system === 'invoice_group_v1'
    ? await readConsolidatedInvoiceDocument(context, invoice.id)
    : null
  const groupedMoney = groupedDocument && /^[A-Z]{3}$/.test(invoice.currency)
    ? new Intl.NumberFormat('sv-SE', { style: 'currency', currency: invoice.currency })
    : null
  const invoiceMoney = (value: number | null) => groupedMoney && typeof value === 'number' && Number.isFinite(value)
    ? groupedMoney.format(value)
    : formatSek(value)

  const paymentClosed = isCancelledOrCreditedInvoice(invoice.status)
  const amountLabel = paymentClosed || invoice.status === 'paid' ? 'Fakturabelopp' : 'Att betala'
  const hasRetiredCopy = invoiceFileAvailability === 'retired'
    || documents.some((document) => document.fileAvailability === 'retired')

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
              {portalInvoiceTitle(invoice)}
            </h1>
            {invoice.invoice_reference ? (
              <p className="mt-2 text-sm text-slate-500">Fakturareferens {invoice.invoice_reference}</p>
            ) : null}
            <p className="mt-3 text-sm text-slate-500">
              Period {formatPeriod(invoice.period_start, invoice.period_end)}
              {paymentClosed ? null : <> · Förfallodatum {formatDate(invoice.due_date)}</>}
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-right">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{amountLabel}</p>
            <p className="mt-2 text-3xl font-bold text-slate-950">{invoiceMoney(invoice.amount_inc_vat)}</p>
            <p className="mt-1 text-sm text-slate-500">inkl. moms</p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Fakturarader</h2>

          <div className="mt-5 divide-y divide-slate-100">
            {groupedDocument?.kind === 'ready' ? (
              <>
                {groupedDocument.document.sites.map(site => (
                  <article key={site.sourceReference} className="space-y-2 py-4">
                    <h3 className="font-semibold">Anläggning {site.facilityReference}</h3>
                    <p className="text-sm text-slate-600">{formatPeriod(site.periodStart, site.periodEnd)} · {site.priceArea} · {site.quantityKwh} kWh</p>
                    <ul className="text-sm text-slate-700">
                      {site.pricing.map((price, index) => (
                        <li key={index}>{price.description}{price.unitPriceExVat === null ? '' :
                          ` · ${price.unitPriceExVat.replace(".", ",") + " " + groupedDocument.document.currency}${price.unit ? `/${price.unit}` : ''}`}</li>
                      ))}
                    </ul>
                    <p className="text-sm font-semibold">Belopp inkl. moms {groupedMoney?.format(Number(site.amountIncVat))}</p>
                    <p className="break-words text-xs text-slate-500">Källreferens {site.sourceReference}</p>
                  </article>
                ))}
                <Link href={`/portal/fakturor/${invoice.id}/underlag`} className="mt-4 inline-flex rounded-xl border px-4 py-2 text-sm font-semibold">
                  Ladda ner fakturaunderlag (JSON)
                </Link>
              </>
            ) : groupedDocument ? (
              <p className="py-4 text-sm text-slate-600">{groupedDocument.kind === 'retired'
                ? 'Fakturaunderlaget är inte längre tillgängligt.'
                : 'Samlingsfakturans underlag kan inte visas här just nu.'}</p>
            ) : null}
            {!groupedDocument && lines.map((line) => (
              <div key={line.id} className="grid gap-3 py-4 md:grid-cols-[1fr_140px_140px] md:items-center">
                <div>
                  <div className="font-medium text-slate-950">{line.description}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {line.quantity ?? '—'} {line.unit ?? ''} · {portalInvoiceLineTypeLabel(line.line_type)}
                  </div>
                </div>
                <div className="text-sm text-slate-600">Á-pris {formatSek(line.unit_price)}</div>
                <div className="text-right text-sm font-semibold text-slate-950">{formatSek(line.amount_ex_vat)}</div>
              </div>
            ))}

            {!groupedDocument && lines.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                Fakturaraderna är inte tillgängliga ännu.
              </div>
            ) : null}
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Sammanfattning</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <div className="flex justify-between gap-4"><span>Förbrukning</span><strong>{formatKwh(invoice.total_kwh)}</strong></div>
              <div className="flex justify-between gap-4"><span>Exkl. moms</span><strong>{invoiceMoney(invoice.amount_ex_vat)}</strong></div>
              <div className="flex justify-between gap-4"><span>Moms</span><strong>{invoiceMoney(invoice.vat_amount)}</strong></div>
              <div className="flex justify-between gap-4 border-t border-slate-200 pt-3"><span>Totalt</span><strong>{invoiceMoney(invoice.amount_inc_vat)}</strong></div>
              <div className="flex justify-between gap-4"><span>Utfärdad</span><strong>{formatDate(invoice.issued_at)}</strong></div>
              <div className="flex justify-between gap-4"><span>Betald</span><strong>{formatDate(invoice.paid_at)}</strong></div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Faktura-PDF</h2>

            {hasRetiredCopy ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                En PDF-kopia är inte längre tillgänglig. Fakturans uppgifter och rader finns kvar.
              </div>
            ) : null}

            {pdfSource ? (
              <a href={`/portal/fakturor/${encodeURIComponent(invoice.id)}/pdf`} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">
                Öppna faktura-PDF
              </a>
            ) : hasRetiredCopy ? null : (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                Ingen PDF-kopia kan visas här just nu. Kontakta kundservice om du behöver en kopia.
              </div>
            )}
          </div>
        </aside>
      </section>
    </div>
  )
}
