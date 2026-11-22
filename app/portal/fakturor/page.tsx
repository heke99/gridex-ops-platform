import { portalInvoiceTitle } from '@/lib/customer-portal/labels'
import Link from 'next/link'
import { getCustomerPortalContext } from '@/lib/customer-portal/db'
import {
  formatDate,
  formatKwh,
  formatPeriod,
  formatSek,
  invoiceStatusLabel,
  invoiceStatusTone,
  PORTAL_PUBLISHED_INVOICE_STATUSES,
} from '@/lib/customer-portal/format'
import type { CustomerInvoiceRow, CustomerPortalContext } from '@/lib/customer-portal/types'
import { supabaseService } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const INVOICES_PER_PAGE = 25

type HistoryInvoice = Pick<CustomerInvoiceRow,
  'id' | 'invoice_number' | 'partner_invoice_reference' | 'period_start' | 'period_end' | 'due_date'
  | 'amount_inc_vat' | 'total_kwh' | 'status' | 'issued_at' | 'created_at'
>

function parseInvoicePage(value: string | string[] | undefined) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return 1
  const page = Number(value)
  return Number.isSafeInteger(page * INVOICES_PER_PAGE) ? page : 1
}

async function readInvoiceHistory(context: CustomerPortalContext, page: number): Promise<{
  invoices: HistoryInvoice[]
  total: number
  page: number
} | null> {
  const { companyId, customerIds } = context
  if (!companyId || customerIds.length === 0) return { invoices: [], total: 0, page: 1 }

  // Preserve issue-date order. Newly published invoices can shift offsets between page reads.
  const offset = (page - 1) * INVOICES_PER_PAGE
  try {
    const { data, count, error } = await supabaseService
      .from('customer_invoices')
      .select('id,invoice_number,partner_invoice_reference,period_start,period_end,due_date,amount_inc_vat,total_kwh,status,issued_at,created_at', { count: 'exact' })
      .eq('company_id', companyId)
      .in('customer_id', customerIds)
      .in('status', PORTAL_PUBLISHED_INVOICE_STATUSES)
      .order('issued_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + INVOICES_PER_PAGE - 1)
      .overrideTypes<HistoryInvoice[], { merge: false }>()

    if (page > 1 && error?.code === 'PGRST103') return readInvoiceHistory(context, 1)
    if (error || count === null || !Number.isSafeInteger(count) || count < 0 || !Array.isArray(data)) return null
    if (page > 1 && offset >= count) return readInvoiceHistory(context, 1)
    if (data.length !== Math.min(INVOICES_PER_PAGE, count - offset)) return null
    return { invoices: data, total: count, page }
  } catch {
    return null
  }
}

export default async function PortalInvoicesPage({
  searchParams,
}: { searchParams?: Promise<{ page?: string | string[] }> } = {}) {
  const context = await getCustomerPortalContext()
  const history = await readInvoiceHistory(context, parseInvoicePage((await searchParams)?.page))
  const invoices = history?.invoices ?? []
  const lastPage = history ? Math.ceil(history.total / INVOICES_PER_PAGE) : 0

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">Mina fakturor</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Här visas fakturor som har skapats och bekräftats hos {context.branding.brandName}.
          Fakturaunderlag som ännu inte blivit faktura visas inte här.
        </p>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm" aria-labelledby="invoice-history">
        <div className="border-b border-slate-200 px-6 py-5">
          <h2 id="invoice-history" className="text-lg font-semibold text-slate-950">Fakturor</h2>
          {history ? <p className="mt-1 text-sm text-slate-500">Visar {invoices.length} av {history.total} fakturor.</p> : null}
        </div>

        <div className="divide-y divide-slate-100">
          {invoices.map((invoice) => (
            <Link key={invoice.id} href={`/portal/fakturor/${invoice.id}`} className="block px-6 py-5 hover:bg-slate-50">
              <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto] lg:items-center">
                <div>
                  <div className="font-semibold text-slate-950">
                    {portalInvoiceTitle(invoice)}
                  </div>
                  {invoice.partner_invoice_reference ? (
                    <div className="mt-1 text-xs text-slate-500">
                      Referens: {invoice.partner_invoice_reference}
                    </div>
                  ) : null}
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

          {!history ? (
            <div role="alert" className="px-6 py-12 text-center text-sm text-slate-700">
              Fakturahistoriken kunde inte läsas. Försök igen.
            </div>
          ) : invoices.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              Du har inga fakturor ännu. När din första faktura är klar visas den här, vanligtvis efter din första hela förbrukningsmånad.
            </div>
          ) : null}
        </div>
        {history && lastPage > 1 ? (
          <nav aria-label="Sidor i fakturahistoriken" className="flex flex-wrap items-center gap-4 border-t border-slate-200 px-6 py-4 text-sm">
            <span>Sida {history.page} av {lastPage}</span>
            {history.page > 1 ? <Link href={`?page=${history.page - 1}`} prefetch={false} className="underline">Föregående sida</Link> : null}
            {history.page < lastPage ? <Link href={`?page=${history.page + 1}`} prefetch={false} className="underline">Nästa sida</Link> : null}
          </nav>
        ) : null}
      </section>
    </div>
  )
}
