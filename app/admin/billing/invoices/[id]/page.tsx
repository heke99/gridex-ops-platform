import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { getInvoiceReviewDetail } from '@/lib/billing/invoiceReviewData'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }
type Row = Record<string, unknown>

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function money(value: unknown) {
  const n = num(value)
  if (n === null) return '—'
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' }).format(n)
}

function quantity(value: unknown, unit?: unknown) {
  const n = num(value)
  if (n === null) return '—'
  return `${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 4 }).format(n)} ${text(unit) ?? ''}`.trim()
}

function customerName(row: Row) {
  const company = text(row.company_name)
  if (company) return company
  return [text(row.first_name), text(row.last_name)].filter(Boolean).join(' ') || text(row.customer_number) || 'Kund'
}

export default async function InvoiceReviewDetailPage({ params }: Props) {
  await requirePermissionServer('billing_underlay.read')
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const companyId = scope?.companyId ?? null
  if (!companyId) throw new Error('Välj en tenant innan fakturan granskas.')
  const detail = await getInvoiceReviewDetail({ companyId, invoiceExportItemId: id })
  const calculation = detail.invoice.calculation_snapshot && typeof detail.invoice.calculation_snapshot === 'object' && !Array.isArray(detail.invoice.calculation_snapshot)
    ? detail.invoice.calculation_snapshot as Row
    : {}
  const approvalStatus = text(detail.approval.status) ?? 'pending_review'
  const billingMonth = text(calculation.billing_month) ?? text(detail.item.period_start)?.slice(0, 7) ?? ''
  const priceArea = text(detail.invoice.price_area_code) ?? text(detail.underlay.price_area) ?? text(detail.contract.price_area_used)

  return (
    <div className="min-h-screen bg-slate-50/60">
      <AdminHeader
        title="Fakturagranskning"
        subtitle={`${customerName(detail.customer)} · ${billingMonth || 'fakturaperiod'}`}
        userEmail={user?.email ?? null}
      />
      <main className="space-y-6 p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={`/admin/billing${billingMonth ? `?month=${billingMonth}` : ''}`} className="text-sm font-semibold text-slate-600 hover:text-slate-950">
            ← Till fakturor
          </Link>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
            {detail.item.status === 'sent' ? 'Skickad' : approvalStatus === 'approved' ? 'Godkänd' : 'Väntar på granskning'}
          </span>
        </div>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            ['Kund', customerName(detail.customer)],
            ['Avtal', text(detail.contract.contract_name) ?? text(detail.contract.contract_type) ?? '—'],
            ['Elområde', priceArea ?? '—'],
            ['Förbrukning', quantity(detail.underlay.total_kwh, 'kWh')],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{value}</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="font-semibold text-slate-950">Prisberäkning</h2>
            <p className="mt-1 text-xs text-slate-500">Raderna kommer från den låsta pricing run som fakturan är bunden till.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Rad</th>
                  <th className="px-4 py-3 text-right font-semibold">Mängd</th>
                  <th className="px-4 py-3 text-right font-semibold">Á-pris ex moms</th>
                  <th className="px-4 py-3 text-right font-semibold">Belopp ex moms</th>
                  <th className="px-4 py-3 text-right font-semibold">Moms</th>
                  <th className="px-5 py-3 text-right font-semibold">Inkl. moms</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.pricingLines.map((line, index) => (
                  <tr key={text(line.id) ?? String(index)}>
                    <td className="px-5 py-4">
                      <p className="font-medium text-slate-950">{text(line.description) ?? text(line.line_type) ?? 'Prisrad'}</p>
                      <p className="mt-1 text-xs text-slate-500">{text(line.line_type) ?? '—'} · {text(line.unit) ?? '—'}</p>
                    </td>
                    <td className="px-4 py-4 text-right tabular-nums">{quantity(line.quantity, line.unit)}</td>
                    <td className="px-4 py-4 text-right tabular-nums">{money(line.unit_price_ex_vat)}</td>
                    <td className="px-4 py-4 text-right tabular-nums">{money(line.amount_ex_vat)}</td>
                    <td className="px-4 py-4 text-right tabular-nums">{money(line.vat_amount)}</td>
                    <td className="px-5 py-4 text-right font-semibold tabular-nums">{money(line.amount_inc_vat)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-950">
                <tr>
                  <td className="px-5 py-4" colSpan={3}>Totalt</td>
                  <td className="px-4 py-4 text-right tabular-nums">{money(detail.invoice.amount_ex_vat)}</td>
                  <td className="px-4 py-4 text-right tabular-nums">{money(detail.invoice.vat_amount)}</td>
                  <td className="px-5 py-4 text-right tabular-nums">{money(detail.invoice.amount_inc_vat)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-950">Låst fakturagrund</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              {[
                ['Period', `${text(detail.underlay.billing_period_start) ?? '—'} – ${text(detail.underlay.billing_period_end) ?? '—'}`],
                ['Avtalstyp', text(calculation.contract_type) ?? text(detail.contract.contract_type) ?? '—'],
                ['Elområde', priceArea ?? '—'],
                ['Pricing run', text(detail.pricingRun.id) ?? '—'],
                ['Prissnapshot', text(calculation.contract_price_snapshot_id) ?? text(detail.priceSnapshot?.id) ?? '—'],
                ['Snapshot-hash', text(calculation.contract_price_snapshot_hash) ?? '—'],
                ['Beräkningshash', text(detail.invoice.calculation_snapshot_sha256) ?? '—'],
                ['Status pricing', text(detail.pricingRun.status) ?? '—'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium text-slate-500">{label}</dt>
                  <dd className="mt-1 break-all font-medium text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-950">Utskick</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              {[
                ['Fakturareferens', text(detail.invoice.invoice_reference) ?? '—'],
                ['Partner-ID', text(detail.item.provider_invoice_guid) ?? text(detail.invoice.partner_invoice_reference) ?? 'Ej skickad'],
                ['Förfallodatum', text(detail.invoice.due_date) ?? 'Skapas vid utskick'],
                ['Godkänd av', text(detail.approval.approved_by) ?? 'Ej godkänd'],
                ['Godkänd', text(detail.approval.approved_at) ?? '—'],
                ['Review-hash', text(detail.approval.review_hash) ?? '—'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium text-slate-500">{label}</dt>
                  <dd className="mt-1 break-all font-medium text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>
    </div>
  )
}
