import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { listInvoiceReviewRows, type InvoiceReviewStatus } from '@/lib/billing/invoiceReviewData'
import { parseBillingMonth, previousStockholmBillingMonth } from '@/lib/time/stockholm'
import { approveAndSendReadyInvoicesAction } from './actions'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{
    month?: string
    sent?: string
    failed?: string
    approved?: string
  }>
}

const statusStyle: Record<InvoiceReviewStatus, string> = {
  missing_meter_values: 'bg-amber-50 text-amber-800 ring-amber-200',
  blocked: 'bg-rose-50 text-rose-800 ring-rose-200',
  preparing: 'bg-slate-50 text-slate-700 ring-slate-200',
  ready_for_review: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  approved: 'bg-blue-50 text-blue-800 ring-blue-200',
  sent: 'bg-slate-900 text-white ring-slate-900',
  failed: 'bg-rose-50 text-rose-800 ring-rose-200',
}

function money(value: number | null) {
  if (value === null) return '—'
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' }).format(value)
}

function quantity(value: number | null) {
  if (value === null) return '—'
  return `${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 3 }).format(value)} kWh`
}

function productLabel(contractType: string | null, contractName: string | null) {
  if (contractName) return contractName
  switch (contractType) {
    case 'fixed': return 'Fastpris'
    case 'variable_hourly': return 'Timpris'
    case 'variable_quarterly': return 'Kvartspris'
    case 'portfolio': return 'Portfölj'
    case 'variable_monthly': return 'Månadspris'
    default: return contractType ?? '—'
  }
}

export default async function AdminBillingPage({ searchParams }: PageProps) {
  await requirePermissionServer('billing_underlay.read')
  const params = await searchParams
  let selectedMonth = previousStockholmBillingMonth()
  if (params.month) {
    try { selectedMonth = parseBillingMonth(params.month).value } catch { selectedMonth = previousStockholmBillingMonth() }
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const companyId = scope?.companyId ?? null

  const rows = companyId ? await listInvoiceReviewRows({ companyId, billingMonth: selectedMonth }) : []
  const readyCount = rows.filter((row) => row.status === 'ready_for_review').length
  const approvedCount = rows.filter((row) => row.status === 'approved').length
  const sentCount = rows.filter((row) => row.status === 'sent').length
  const flaggedCount = rows.filter((row) => ['missing_meter_values', 'blocked', 'failed'].includes(row.status)).length
  const sendableCount = readyCount + approvedCount
  const missingMeterCount = rows.filter((row) => row.status === 'missing_meter_values').length

  return (
    <div className="min-h-screen bg-slate-50/60">
      <AdminHeader
        title="Fakturor"
        subtitle="Mätvärden och priser förbereds automatiskt. Granska klara fakturor och skicka endast de kunder som passerar alla kontroller."
        userEmail={user?.email ?? null}
      />

      <main className="space-y-6 p-6 lg:p-8">
        {!companyId ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            Välj en tenant innan fakturor granskas eller skickas. Fakturering får aldrig köras över flera tenants samtidigt.
          </section>
        ) : null}

        {companyId && (params.sent || params.failed) ? (
          <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm shadow-sm">
            Batch klar: <strong>{params.sent ?? '0'} skickade</strong>, {params.failed ?? '0'} misslyckade och {params.approved ?? '0'} nygodkända.
          </section>
        ) : null}

        <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-end lg:justify-between">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Fakturamånad
              <input
                type="month"
                name="month"
                defaultValue={selectedMonth}
                className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-500"
              />
            </label>
            <button className="h-10 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">
              Visa
            </button>
          </form>

          {companyId && sendableCount > 0 ? (
            <form action={approveAndSendReadyInvoicesAction}>
              <input type="hidden" name="billing_month" value={selectedMonth} />
              <button className="h-11 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800">
                Godkänn och skicka {sendableCount} klara fakturor
              </button>
            </form>
          ) : null}
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['Klara för granskning', readyCount, 'Kan öppnas och kontrolleras innan utskick.'],
            ['Flaggade', flaggedCount, missingMeterCount ? `${missingMeterCount} saknar kompletta mätvärden.` : 'Kräver åtgärd före fakturering.'],
            ['Godkända', approvedCount, 'Godkända men ännu inte bekräftat skickade.'],
            ['Skickade', sentCount, 'Bekräftade av fakturapartnern.'],
          ].map(([label, count, help]) => (
            <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-slate-500">{label}</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">{count}</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">{help}</p>
            </div>
          ))}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="font-semibold text-slate-950">Kunder · {selectedMonth}</h2>
              <p className="mt-1 text-xs text-slate-500">Flaggade kunder skickas aldrig med i batchen.</p>
            </div>
            <div className="flex gap-3 text-xs font-medium text-slate-500">
              <Link href="/admin/pricing" className="hover:text-slate-950">Prismotor</Link>
              <Link href="/admin/billing/integrations" className="hover:text-slate-950">Teknisk integration</Link>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-slate-500">
              Inga faktureringsunderlag finns för vald månad ännu.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Kund</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Avtal</th>
                    <th className="px-4 py-3 font-semibold">Elområde</th>
                    <th className="px-4 py-3 text-right font-semibold">Förbrukning</th>
                    <th className="px-4 py-3 text-right font-semibold">Att fakturera</th>
                    <th className="px-5 py-3 text-right font-semibold">Granska</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.underlayId} className="align-top hover:bg-slate-50/60">
                      <td className="px-5 py-4">
                        <Link href={`/admin/customers/${row.customerId}?tab=billing-metering`} className="font-semibold text-slate-950 hover:underline">
                          {row.customerName}
                        </Link>
                        <div className="mt-1 text-xs text-slate-500">{row.customerNumber ?? 'Kundnummer saknas'}</div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusStyle[row.status]}`}>
                          {row.statusLabel}
                        </span>
                        {row.blocker ? <p className="mt-2 max-w-xs text-xs leading-5 text-slate-500">{row.blocker}</p> : null}
                      </td>
                      <td className="px-4 py-4 text-slate-700">{productLabel(row.contractType, row.contractName)}</td>
                      <td className="px-4 py-4 font-medium text-slate-700">{row.priceArea ?? '—'}</td>
                      <td className="px-4 py-4 text-right tabular-nums text-slate-700">{quantity(row.totalKwh)}</td>
                      <td className="px-4 py-4 text-right font-semibold tabular-nums text-slate-950">{money(row.amountIncVat)}</td>
                      <td className="px-5 py-4 text-right">
                        {row.invoiceExportItemId ? (
                          <Link href={`/admin/billing/invoices/${row.invoiceExportItemId}`} className="inline-flex rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50">
                            Visa faktura
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-400">Ej klar</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
