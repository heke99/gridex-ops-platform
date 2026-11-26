import Link from 'next/link'
import { isPlatformAdminContext } from '@/lib/admin/guards'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'
import { getInvoiceReviewDetail } from '@/lib/billing/invoiceReviewData'
import { hasInvoiceFileDownloadPermission } from '@/lib/billing/invoiceFileAccess'
import { isFileProvider } from '@/lib/billing/providers/registry'

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

function reservationRunStatusLabel(status: string | null) {
  switch (status) {
    case 'draft': return 'Utkast'
    case 'processing': return 'Bearbetas'
    case 'sent': return 'Skickad'
    case 'partial_failed': return 'Delvis misslyckad'
    case 'failed': return 'Misslyckad'
    case 'cancelled': return 'Avbruten'
    default: return 'Okänd'
  }
}

function invoicePathLabel(path: { provider: string | null; environment: string | null } | null) {
  if (!path) return 'Saknas för bolaget'
  const provider = path.provider === 'capway_aptic' ? 'Capway' : path.provider === 'nordfin' ? 'Nordfin'
    : path.provider === 'file_export' ? 'Filexport' : 'Okänd leverantör'
  const environment = path.environment === 'production' ? 'Produktion' : path.environment === 'test' ? 'Test' : 'Okänd miljö'
  return `${provider} · ${environment}`
}

export default async function InvoiceReviewDetailPage({ params }: Props) {
  const admin = await requirePermissionServer('billing_underlay.read')
  const isPlatformAdmin = isPlatformAdminContext(admin)
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const scope = await resolveAdminSelectedCompanyReadScope(admin, { allowMissing: true })
  const companyId = scope.companyId
  if (!companyId) throw new Error('Välj ett bolag innan fakturan granskas.')
  const detail = await getInvoiceReviewDetail({ companyId, invoiceExportItemId: id })
  const invoice: Row = detail.invoice ?? {}
  const calculation = invoice.calculation_snapshot && typeof invoice.calculation_snapshot === 'object' && !Array.isArray(invoice.calculation_snapshot)
    ? invoice.calculation_snapshot as Row
    : {}
  const approvalStatus = text(detail.approval.status) ?? 'pending_review'
  const billingMonth = text(calculation.billing_month) ?? text(detail.item.period_start)?.slice(0, 7) ?? ''
  const priceArea = text(invoice.price_area_code) ?? text(detail.underlay.price_area) ?? text(detail.contract.price_area_used)
  const awaitingProjection = detail.lifecycleStage === 'awaiting_invoice_projection'
  const reservation = detail.reservation
  const fileExport = detail.fileExport
  const pendingFilePath = !fileExport && !reservation && invoice.status === 'draft' &&
    detail.lifecycleStage === 'approved' && detail.item.status === 'pending' && isFileProvider(detail.item.provider)
  const pendingFileLabel = detail.reservationReadFailed ? 'Fakturavägen behöver kontrolleras' : 'Väntar på fakturafil'
  const fileReceipt = detail.lifecycleStage === 'file_created' && fileExport?.id &&
    hasInvoiceFileDownloadPermission(admin.permissions)
    ? new URLSearchParams({ ...(billingMonth ? { month: billingMonth } : {}), file: fileExport.id })
    : null

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
            {reservation ? 'Tidigare reservation' : awaitingProjection ? 'Faktura förbereds' : fileExport ? fileExport.label : detail.lifecycleStage === 'dispatched' ? 'Skickad' : approvalStatus === 'approved' ? 'Godkänd' : 'Väntar på granskning'}
          </span>
        </div>

        {detail.reservationReadFailed ? (
          <p id="reservation" role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            Avstämningen kunde inte läsas. Läs om sidan för att kontrollera fakturavägen.
          </p>
        ) : null}

        {reservation ? (
          <section id="reservation" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950 shadow-sm">
            <h2 className="font-semibold">Stäm av tidigare reservation</h2>
            <p className="mt-2">Underlaget är reserverat på en annan leveransväg. Kontrollera den tidigare körningen och jämför eventuellt filarkiv och partnerkvitto innan underlaget bereds på nytt.</p>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              {[
                ['Reserverad exportpost', invoicePathLabel(reservation.itemPath)],
                ['Sparad körning', invoicePathLabel(reservation.runPath)],
                ['Körningsstatus', reservationRunStatusLabel(reservation.runStatus)],
                ['Körnings-ID', reservation.runId ?? 'Saknas för bolaget'],
                ['Aktuell leveransväg', invoicePathLabel(reservation.activePath)],
                ['Registrerade försök', reservation.attemptCount ?? 'Okänt'],
                ['Partnerkvitto', reservation.providerConfirmedAt ? 'Bekräftelsetid finns' : reservation.hasPartnerReference ? 'Referens finns' : 'Inget kvitto på exportposten'],
                ['Fakturanummer', reservation.hasInvoiceNumber ? 'Sparat på fakturan' : 'Saknas på fakturan'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="font-medium">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {reservation.deliveryUncertain ? <p className="mt-3 font-medium">Leveransen är osäker. Stäm av med den tidigare mottagaren.</p> : null}
          </section>
        ) : null}

        {awaitingProjection ? (
          <section className="rounded-2xl border border-sky-200 bg-sky-50 p-5 text-sm text-sky-950 shadow-sm">
            <h2 className="font-semibold">Fakturan förbereds</h2>
            <p className="mt-1 text-sky-800">
              Faktureringsunderlaget finns, men fakturan är ännu inte färdig. Du kan granska underlaget nedan. Fakturans uppgifter visas när den har skapats.
            </p>
          </section>
        ) : null}

        <section className={`rounded-2xl border p-5 text-sm ${detail.exportStatus.needsAction ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
          <h2 className="font-semibold">{fileExport || pendingFilePath ? 'Fakturafil' : 'Överföring till fakturapartner'}</h2>
          <p className="mt-1">{pendingFilePath ? pendingFileLabel : detail.exportStatus.label}</p>
          {fileExport?.id ? <p className="mt-1">Följ upp överlämningen till mottagaren separat.</p> : null}
          {fileReceipt ? (
            <Link href={`/admin/billing?${fileReceipt}`} prefetch={false} className="mt-2 inline-block font-semibold underline">
              Visa fakturafilens kvitto
            </Link>
          ) : null}
          {detail.exportStatus.needsAction ? (
            <p className="mt-1">{fileExport
              ? 'Kontrollera den sparade fakturafilen.'
              : 'Kontrollera överföringen innan fakturan skickas vidare. Ett registrerat godkännande gäller fortfarande själva fakturaunderlaget.'}</p>
          ) : null}
          {isPlatformAdmin ? <details className="mt-3"><summary>Tekniska uppgifter</summary><pre className="overflow-auto whitespace-pre-wrap">{JSON.stringify({ status: detail.item.status, error: detail.item.error_payload }, null, 2)}</pre></details> : null}
        </section>
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
            <p className="mt-1 text-xs text-slate-500">Raderna kommer från den låsta prisberäkningen för den här fakturan.</p>
          </div>
          <div role="region" tabIndex={0} aria-label="Fakturans prisrader" className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
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
                      <p className="font-medium text-slate-950">{text(line.description) ?? (isPlatformAdmin ? text(line.line_type) : null) ?? 'Prisrad'}</p>
                      {isPlatformAdmin ? <p className="mt-1 text-xs text-slate-500">{text(line.line_type) ?? '—'} · {text(line.unit) ?? '—'}</p> : null}
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
                  <td className="px-4 py-4 text-right tabular-nums">{money(invoice.amount_ex_vat)}</td>
                  <td className="px-4 py-4 text-right tabular-nums">{money(invoice.vat_amount)}</td>
                  <td className="px-5 py-4 text-right tabular-nums">{money(invoice.amount_inc_vat ?? detail.item.amount_inc_vat)}</td>
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
                ...(isPlatformAdmin ? [
                ['Pricing run', text(detail.pricingRun.id) ?? '—'],
                ['Prissnapshot', text(calculation.contract_price_snapshot_id) ?? text(detail.priceSnapshot?.id) ?? '—'],
                ['Snapshot-hash', text(calculation.contract_price_snapshot_hash) ?? '—'],
                ['Beräkningshash', text(invoice.calculation_snapshot_sha256) ?? (awaitingProjection ? 'Skapas vid projektion' : '—')],
                ['Status pricing', text(detail.pricingRun.status) ?? '—'],
                ] : []),
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
            {awaitingProjection ? (
              <p className="mt-3 text-sm text-slate-600">Fakturans uppgifter visas när fakturan har skapats.</p>
            ) : null}
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              {[
                ['Fakturareferens', text(invoice.invoice_reference) ?? (awaitingProjection ? 'Inväntar faktura' : '—')],
                ...(isPlatformAdmin ? [fileExport
                  ? ['Fil-ID', fileExport.id ?? '—']
                  : ['Partner-ID', text(detail.item.provider_invoice_guid) ?? text(invoice.partner_invoice_reference) ?? 'Ej skickad']] : []),
                ['Förfallodatum', text(invoice.due_date) ?? 'Skapas vid utskick'],
                ['Godkänd av', isPlatformAdmin ? text(detail.approval.approved_by) ?? 'Ej godkänd' : approvalStatus === 'approved' ? 'Registrerad handläggare' : 'Ej godkänd'],
                ['Godkänd', text(detail.approval.approved_at) ?? '—'],
                ...(isPlatformAdmin ? [['Review-hash', text(detail.approval.review_hash) ?? '—']] : []),
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
