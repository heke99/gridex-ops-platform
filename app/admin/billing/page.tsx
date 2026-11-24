import { randomUUID } from 'node:crypto'
import { canPresentOperationalAction } from '@/lib/admin/actionPresentation'
import { hasInvoiceFileDownloadPermission } from '@/lib/billing/invoiceFileAccess'
import Link from 'next/link'
import ConsolidatedInvoiceReview from './ConsolidatedInvoiceReview'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'
import { invoiceReviewActivePath, listInvoiceReviewRows, type InvoiceReviewStatus } from '@/lib/billing/invoiceReviewData'
import { readInvoiceEdielReviewSources } from '@/lib/billing/readInvoiceEdielReview'
import { parseBillingMonth, previousStockholmBillingMonth } from '@/lib/time/stockholm'
import { approveAndSendReadyInvoicesAction } from './actions'
import { listInvoiceFiles, loadInvoiceFilePeriodReconciliation, loadInvoiceFileReceipt, previewInvoiceFileGroups, previewInvoiceFileSelection, type InvoiceFileRecord } from '@/lib/billing/invoiceFileExport'
import { InvoiceProviderConfigError, isFileProvider, loadTenantInvoiceProviderSelection } from '@/lib/billing/providers/registry'
import { loadInvoiceFileEffects } from '@/lib/billing/invoiceFileReconciliation'
import { readInvoiceFileMonthLockNotice, signInvoiceFileIntent } from '@/lib/billing/invoiceFileIntentToken'
import AdminActionsMenu from '@/components/admin/ui/AdminActionsMenu'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{
    month?: string
    customer?: string
    group_after?: string
    sent?: string
    failed?: string
    approved?: string
    mode?: string
    file?: string | string[]
    file_error?: string
    file_month_lock_notice?: string | string[]
  }>
}

const statusStyle: Record<InvoiceReviewStatus, string> = {
  missing_meter_values: 'bg-amber-50 text-amber-800 ring-amber-200',
  blocked: 'bg-rose-50 text-rose-800 ring-rose-200',
  preparing: 'bg-slate-50 text-slate-700 ring-slate-200',
  ready_for_review: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  approved: 'bg-blue-50 text-blue-800 ring-blue-200',
  file_created: 'bg-slate-50 text-slate-800 ring-slate-300',
  sent: 'bg-slate-900 text-white ring-slate-900',
  failed: 'bg-rose-50 text-rose-800 ring-rose-200',
}

const FILE_ERRORS: Record<string, string> = {
  invoice_distribution_paper_address_missing: 'Pappersfaktura har valts men den frysta fakturaadressen är ofullständig. Ingen fil skapades.',
  invoice_distribution_email_missing: 'Faktura via e-post har valts men en bekräftad fryst faktura-e-post saknas. Ingen fil skapades.',
  invoice_file_delivery_unverified: 'Det valda leveranssättet kan inte verifieras i det godkända fakturaunderlaget. Ingen fil skapades.',
  invoice_file_delivery_unsupported: 'Filexporten stöder inte fakturans valda leveranssätt. Ingen fil skapades.',
  invoice_distribution_missing: 'Fakturan saknar bekräftad faktura-e-post eller komplett fryst fakturaadress. Ingen fil skapades.',
  invoice_file_intent_scope_mismatch: 'Begäran hör till en annan fakturaperiod, leverantör eller miljö. Ladda om sidan för att skapa en ny fil.',
  invoice_file_intent_invalid: 'Begäran att skapa fakturafil är ogiltig. Ladda om sidan och försök igen.',
  invoice_file_recovery_unavailable: 'Det sparade exportkvittot kunde inte läsas. Försök igen.',
  invoice_file_empty: 'Det finns inga godkända fakturor att lägga i en fil. Godkänn fakturorna först.',
  invoice_file_items_changed: 'Någon faktura ändrades medan filen skapades. Ingen fil skapades; försök igen.',
  invoice_file_contract_case_hold: 'En faktura i urvalet omfattas av ett aktivt avtalsstopp. Ingen fil skapades.',
  invoice_file_selection_changed: 'Urvalet innehåller ett ändrat godkännande eller saknar granskningsbevis. Granska fakturorna på nytt.',
  invoice_file_selection_too_large: 'Urvalet är större än vad en fakturafil får innehålla.',
  invoice_file_artifacts_too_large: 'Fakturafilen överskrider storleksgränsen.',
  invoice_file_finance_lock_busy: 'Fakturaarkivet är tillfälligt upptaget. Försök igen om en stund.',
  invoice_file_provider_not_active: 'Filexport är inte vald och aktiverad under Fakturering → Integrationer.',
  nordfin_client_id_missing: 'Nordfins ClientId saknas. Ange det under Fakturering → Integrationer.',
}

const CURRENT_PERIOD_LABELS = {
  open: 'Fakturaperioden är öppen.',
  locked: 'Fakturaperioden är låst.',
  exported: 'Fakturaperioden är markerad som exporterad.',
  closed: 'Fakturaperioden är stängd.',
  reopened: 'Fakturaperioden är återöppnad.',
}

const RECONCILIATION_LABELS = {
  pending: 'Månadslåsningen väntar på avstämning.',
  locked: 'Avstämningen låste perioden vid körningen.',
  incomplete: 'Underlagen var ofullständiga när avstämningen kördes.',
  superseded: 'En senare periodändring hade företräde vid avstämningen.',
  already_locked: 'Fakturaperioden var redan låst vid avstämningen.',
}

const EXPORT_EFFECTS_LABELS = {
  pending: 'Äldre exportstatus väntar på uppdatering.',
  applied: 'Äldre exportstatus har uppdaterats.',
  held: 'Äldre exportstatus kräver granskning.',
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
  const admin = await requirePermissionServer('billing_underlay.read')
  const params = await searchParams
  let selectedMonth = previousStockholmBillingMonth()
  if (params.month) {
    try { selectedMonth = parseBillingMonth(params.month).value } catch { selectedMonth = previousStockholmBillingMonth() }
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const scope = await resolveAdminSelectedCompanyReadScope(admin, { allowMissing: true })
  const companyId = scope.companyId
  const canDownloadFiles = hasInvoiceFileDownloadPermission(admin.permissions)
  const canExport = await canPresentOperationalAction(['billing_underlay.export'], companyId)
  const receiptLookup = companyId && params.file !== undefined && canDownloadFiles
    ? loadInvoiceFileReceipt(companyId, params.file).then(
        (file) => ({ file, unavailable: false }),
        () => ({ file: null, unavailable: true }),
      )
    : null

  const providerSelection = companyId ? await loadTenantInvoiceProviderSelection(companyId).catch(() => null) : null
  const dispatchPeriod = companyId && providerSelection?.invoice_export_target_system === 'capway_aptic'
    && providerSelection.billing_provider_environment === 'production'
    ? await import('@/lib/billing/invoiceDispatchPeriodReconciliation')
      .then(async ({ readInvoiceDispatchPeriodStatus }) => ({ receipt: await readInvoiceDispatchPeriodStatus(companyId, selectedMonth), unavailable: false }))
      .catch(() => ({ receipt: null, unavailable: true }))
    : null
  const activePath = invoiceReviewActivePath(providerSelection)
  const allRows = companyId ? await listInvoiceReviewRows({ companyId, billingMonth: selectedMonth, activePath }) : []
  const customerFilter = params.customer?.trim() || null
  const rows = customerFilter ? allRows.filter((row) => row.customerId === customerFilter) : allRows
  const edielSourceReviews = companyId
    ? await readInvoiceEdielReviewSources(companyId, admin.userId, rows.filter(row =>
      row.edielSourceNeedsReview || row.status === 'missing_meter_values',
    ).map(row => row.underlayId))
    : null
  const readyCount = allRows.filter((row) => row.status === 'ready_for_review').length
  const approvedCount = allRows.filter((row) => row.hasApprovedCalculation).length
  const fileCreatedCount = allRows.filter((row) => row.status === 'file_created').length
  const sentCount = allRows.filter((row) => row.status === 'sent').length
  const flaggedCount = allRows.filter((row) => ['missing_meter_values', 'blocked', 'failed'].includes(row.status)).length
  const sendableCount = readyCount + allRows.filter((row) => row.status === 'approved').length
  const missingMeterCount = allRows.filter((row) => row.status === 'missing_meter_values').length
  const fileProvider = isFileProvider(providerSelection?.invoice_export_target_system) ? providerSelection.invoice_export_target_system : null
  const fileMode = fileProvider !== null
  const fileEnvironment = providerSelection?.billing_provider_environment ?? null
  const invoiceFilesLookup = companyId && fileMode && fileEnvironment
    ? listInvoiceFiles(companyId).catch((): InvoiceFileRecord[] => [])
    : []
  let fileIntent: { intentId: string; token: string; count: number; includesGroups: boolean } | null = null
  let filePreviewError: string | null = null
  if (companyId && user && canExport && admin.permissions.includes('billing_underlay.export') && fileProvider &&
      (fileEnvironment === 'test' || fileEnvironment === 'production') && providerSelection?.invoice_export_enabled === true) {
    try {
      const [selection, groups] = await Promise.all([
        previewInvoiceFileSelection({ companyId, billingMonth: selectedMonth, provider: fileProvider, environment: fileEnvironment }),
        fileProvider === 'file_export'
          ? previewInvoiceFileGroups({ companyId, billingMonth: selectedMonth, environment: fileEnvironment, actorUserId: user.id })
          : Promise.resolve([]),
      ])
      if (selection.length + groups.length > 1000) throw new Error('invoice_file_selection_too_large')
      const intentId = randomUUID()
      fileIntent = {
        intentId,
        token: signInvoiceFileIntent({ intentId, companyId, actorUserId: user.id, billingMonth: selectedMonth,
          scope: { provider: fileProvider, environment: fileEnvironment, selection, ...(groups.length ? { groups } : {}) } }),
        count: selection.length + groups.length, includesGroups:groups.length>0,
      }
    } catch (error) {
      filePreviewError = (error instanceof InvoiceProviderConfigError ? FILE_ERRORS[error.code] : undefined) ??
        'Godkända fakturor kunde inte hämtas just nu. Ladda om sidan för att försöka igen.'
    }
  }
  const invoiceFiles = await invoiceFilesLookup
  const receipt = await receiptLookup
  const archivedFile = receipt?.file
  const archiveVersion = archivedFile?.artifact_archive_version
  const isVersionedExport = archiveVersion === 2 && archivedFile?.preparation_kind !== 'mixed_neutral_v1'
  const handoffPending = archivedFile?.handoff_phase === 'created'
  const [period, effects] = companyId && archivedFile && isVersionedExport
    ? await Promise.all([
        loadInvoiceFilePeriodReconciliation(companyId, archivedFile).catch(() => null),
        handoffPending ? Promise.resolve(null) : loadInvoiceFileEffects(companyId, archivedFile.id, archivedFile.row_count).catch(() => null),
      ])
    : [null, null]
  const legacyLockNotice = companyId && user && archivedFile && archiveVersion === null && archivedFile.billing_month === selectedMonth
    ? readInvoiceFileMonthLockNotice({ companyId, actorUserId: user.id, billingMonth: selectedMonth, fileId: archivedFile.id }, params.file_month_lock_notice)
    : false

  return (
    <div className="min-h-screen bg-slate-50/60">
      <AdminHeader
        title="Fakturor"
        subtitle="Mätvärden och priser förbereds automatiskt. Granska klara fakturor och skicka endast de kunder som passerar alla kontroller."
        userEmail={user?.email ?? null}
      />

      <main className="space-y-4 p-4 lg:p-6">
        {!companyId ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            Välj ett bolag innan du granskar eller skickar fakturor.
          </section>
        ) : null}

        {companyId && (params.sent || params.failed) ? (
          <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm shadow-sm">
            {params.mode === 'file'
              ? <>Batch klar: <strong>{params.approved ?? '0'} nygodkända</strong> och {params.failed ?? '0'} misslyckade. Skapa fakturafilen nedan för att skicka dem till fakturaleverantören.</>
              : <>Batch klar: <strong>{params.sent ?? '0'} skickade</strong>, {params.failed ?? '0'} misslyckade och {params.approved ?? '0'} nygodkända.</>}
          </section>
        ) : null}

        {dispatchPeriod?.receipt || dispatchPeriod?.unavailable ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm" aria-labelledby="invoice-dispatch-period-heading">
            <h2 id="invoice-dispatch-period-heading" className="font-semibold">Avstämning av skickade fakturor</h2>
            <p className="mt-1" role="status">
              {dispatchPeriod.unavailable ? 'Avstämningen kunde inte läsas. Försök igen.'
                : dispatchPeriod.receipt?.reopened ? 'Fakturaperioden har öppnats igen.'
                  : dispatchPeriod.receipt?.failed ? 'Senaste avstämningen kunde inte slutföras. Ett nytt försök är planerat.'
                  : dispatchPeriod.receipt?.companyInactive ? 'Avstämningen väntar tills bolaget är aktivt.'
                    : dispatchPeriod.receipt?.status === 'superseded' ? 'En senare periodändring har företräde.'
                    : dispatchPeriod.receipt?.status === 'pending' ? 'Perioden väntar på verifierade leveranskvitton.'
                      : 'Fakturaperioden låstes vid avstämningen.'}
            </p>
          </section>
        ) : null}

        {receipt?.file ? (
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900" aria-labelledby="invoice-file-receipt-heading">
            <h2 id="invoice-file-receipt-heading" className="font-semibold">Arkiverad fakturafil</h2>
            <p className="mt-1">
              {receipt.file.billing_month} · {receipt.file.row_count} fakturor{receipt.file.environment === 'test' ? ' · test' : ''}
            </p>
            <p className="mt-1 break-all">Fil-ID {receipt.file.id}</p>
            <p>{handoffPending ? 'Fil skapad. Leveranskvitto saknas.' : 'Överlämning ej styrkt.'}</p>
            {receipt.file.handoff_recipient ? <p>Fryst mottagarkonto {receipt.file.handoff_recipient}</p> : null}
            <p className="mt-1">Kontrollsumma för fakturaraderna <code className="break-all">{receipt.file.rows_sha256}</code></p>
            <a href={`/admin/billing/invoice-files/${receipt.file.id}`} className="mt-2 inline-block font-semibold underline">Ladda ner fakturafilen</a>
          </section>
        ) : receipt ? (
          <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            {receipt.unavailable ? 'Kvittot kunde inte hämtas just nu. Ladda om sidan för att försöka igen.' : 'Fakturafilen hittades inte.'}
          </p>
        ) : null}

        {period ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm" aria-labelledby="invoice-file-period-heading">
            <h2 id="invoice-file-period-heading" className="font-semibold">Månadslåsning</h2>
            <p className="mt-1">{CURRENT_PERIOD_LABELS[period.currentPeriodStatus]}</p>
            <p className="mt-1" role={period.retryingAfterFailure ? 'alert' : undefined}>
              {period.retryingAfterFailure
                ? 'Senaste avstämningen kunde inte slutföras. Den väntar på ett nytt försök.'
                : period.awaitingHandoff ? 'Månadslåsningen väntar på verifierad överlämning.' : RECONCILIATION_LABELS[period.status]}
            </p>
          </section>
        ) : isVersionedExport || legacyLockNotice ? (
          <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            {legacyLockNotice
              ? 'Månadslåsningen kunde inte bekräftas efter exporten. Kontrollera fakturaperiodens status innan du fortsätter.'
              : 'Månadslåsets status kunde inte hämtas. Fakturafilen ligger kvar i arkivet.'}
          </p>
        ) : null}

        {effects ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm" aria-labelledby="invoice-file-effects-heading">
            <h2 id="invoice-file-effects-heading" className="font-semibold">Fakturans efterarbete</h2>
            <p className="mt-1" role={effects.retryingAfterFailure || effects.status === 'held' ? 'alert' : undefined}>
              {effects.retryingAfterFailure
                ? 'Äldre exportstatus kunde inte uppdateras. Den väntar på ett nytt försök.'
                : EXPORT_EFFECTS_LABELS[effects.status]}
            </p>
            <p className="mt-1">Sparade fakturahändelser {effects.eventCount} av {effects.expectedEventCount}.</p>
            {effects.missingFanoutCount > 0 ? (
              <p role="alert" className="mt-1">
                Köpost saknas för {effects.missingFanoutCount} {effects.missingFanoutCount === 1 ? 'fakturahändelse' : 'fakturahändelser'}.
              </p>
            ) : null}
          </section>
        ) : isVersionedExport && !handoffPending ? (
          <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            Fakturans efterarbete kunde inte läsas.
          </p>
        ) : null}

        {companyId && fileMode ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="invoice-file-heading">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 id="invoice-file-heading" className="font-semibold text-slate-950">{fileProvider === 'nordfin' ? 'Fakturafil till Nordfin' : 'Fakturafil till fakturaleverantör'}</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                  {fileIntent?.includesGroups
                    ? 'Valda fakturor sparas i ett neutralt JSON-underlag. Överlämning och leveransstatus kräver ett separat kvitto.'
                    : 'Godkända fakturor läggs i en fil som du läser in hos fakturaleverantören. Varje fil kan laddas ner igen med samma innehåll.'}
                </p>
                {fileEnvironment === 'test' ? <p className="mt-2 text-xs font-semibold text-amber-700">Testmiljö: filen är märkt för test.</p> : null}
              </div>
              {fileIntent ? <form action="/admin/billing/invoice-files/create" method="post">
                <input type="hidden" name="billing_month" value={selectedMonth} />
                <input type="hidden" name="export_intent_v2" value={fileIntent.token} />
                <input type="hidden" name="export_receipt_v2" value={fileIntent.intentId} />
                <button
                  disabled={fileIntent.count === 0}
                  className="h-11 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {fileIntent.includesGroups ? 'Skapa neutral månadsfil' : 'Skapa fakturafil'} ({fileIntent.count} valda)
                </button>
              </form> : !canExport ? <p className="text-sm text-slate-600">Läsbehörighet. En behörig handläggare behöver skapa fakturafilen.</p> : null}
            </div>
            {providerSelection?.invoice_export_enabled !== true ? (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Aktivera utskick under <Link href="/admin/billing/integrations" className="underline">Fakturering → Integrationer</Link> innan filer kan skapas.</p>
            ) : null}
            {filePreviewError ? (
              <p role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{filePreviewError}</p>
            ) : null}
            {!receipt?.file && params.file_error ? (
              <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{FILE_ERRORS[params.file_error] ?? 'Fakturafilen kunde inte skapas.'}</p>
            ) : null}
            {invoiceFiles.length > 0 ? (
              <details open={Boolean(receipt?.file)} className="mt-4 text-sm">
                <summary className="cursor-pointer font-semibold text-slate-800">Tidigare fakturafiler ({invoiceFiles.length})</summary>
                {!canDownloadFiles ? (
                  <p className="mt-2 text-sm text-slate-600">Nedladdning kräver exportbehörighet.</p>
                ) : null}
              <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
                {invoiceFiles.map((file) => (
                  <li key={file.id} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${receipt?.file?.id === file.id ? 'bg-emerald-50/60' : ''}`}>
                    <span>
                      <span className="font-semibold text-slate-900">{file.billing_month}</span>
                      <span className="ml-2 text-slate-600">{file.row_count} fakturor · {money(Number(file.total_inc_vat))}</span>
                      <span className="ml-2 text-xs text-slate-500">{new Date(file.created_at).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}{file.environment === 'test' ? ' · test' : ''}</span>
                    </span>
                    {canDownloadFiles ? (
                      <AdminActionsMenu label="Ladda ner" ariaLabel={`Ladda ner fakturafil för ${file.billing_month}`}>
                        {(file.preparation_kind === 'mixed_neutral_v1' ? (['json'] as const) : file.provider === 'nordfin' ? (['nordfin_xml', 'xlsx', 'csv'] as const) : (['csv', 'xlsx', 'json'] as const)).map((format) => (
                          <a key={format} href={`/admin/billing/invoice-files/${file.id}?format=${format}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50">
                            {format === 'xlsx' ? 'Excel' : format === 'nordfin_xml' ? 'Nordfin XML' : format.toUpperCase()}
                          </a>
                        ))}
                      </AdminActionsMenu>
                    ) : null}
                  </li>
                ))}
              </ul>
              </details>
            ) : null}
          </section>
        ) : null}

        <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-3">
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
              {customerFilter ? <input type="hidden" name="customer" value={customerFilter} /> : null}
              <button className="h-10 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Visa</button>
            </form>
            {customerFilter ? (
              <Link href={`/admin/billing?month=${selectedMonth}`} className="h-10 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Visa alla kunder
              </Link>
            ) : null}
          </div>

          {canExport && companyId && !customerFilter && sendableCount > 0 ? (
            <form action={approveAndSendReadyInvoicesAction}>
              <input type="hidden" name="billing_month" value={selectedMonth} />
              <button className="h-11 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800">
                {fileMode ? `Godkänn ${sendableCount} klara fakturor` : `Godkänn och skicka ${sendableCount} klara fakturor`}
              </button>
            </form>
          ) : null}
        </section>

        {!customerFilter ? (
          <section className="grid grid-cols-2 gap-2 xl:grid-cols-5">
            {[
              ['Klara för granskning', readyCount, 'Kan öppnas och kontrolleras innan utskick.'],
              ['Flaggade', flaggedCount, missingMeterCount ? `${missingMeterCount} saknar kompletta mätvärden.` : 'Kräver åtgärd före fakturering.'],
              ['Godkända beräkningar', approvedCount, 'Räknas oavsett leveransstatus.'],
              ['Filskapade', fileCreatedCount, 'Sparade i fakturafil. Överlämning följs upp separat.'],
              ['Skickade', sentCount, 'Bekräftade av fakturapartnern.'],
            ].map(([label, count, help]) => (
              <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-slate-600">{label}</p><p className="text-2xl font-semibold text-slate-950">{count}</p></div>
                <p className="mt-1 text-xs leading-5 text-slate-600">{help}</p>
              </div>
            ))}
          </section>
        ) : null}

        {companyId ? <ConsolidatedInvoiceReview
          companyId={companyId} billingMonth={selectedMonth} customerId={customerFilter}
          afterInvoiceId={params.group_after} canApprove={canExport}
        /> : null}

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="font-semibold text-slate-950">{customerFilter ? 'Kundens fakturor' : `Kunder · ${selectedMonth}`}</h2>
              <p className="mt-1 text-xs text-slate-500">Flaggade kunder skickas aldrig med i batchen.</p>
            </div>
            <AdminActionsMenu label="Inställningar">
              <Link href="/admin/billing/integrations" className="hover:text-slate-950">Teknisk integration</Link>
            </AdminActionsMenu>
          </div>

          {rows.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-slate-500">Inga faktureringsunderlag finns för urvalet ännu.</div>
          ) : (
            <div className="min-w-0">
              <table className="w-full table-fixed text-left text-sm [&_td]:min-w-0 [&_td]:break-words max-xl:[&_tr]:grid max-xl:[&_tr]:grid-cols-2 max-xl:[&_td]:px-4 max-xl:[&_td]:py-2 max-xl:[&_tbody_tr]:p-2">
                <thead className="sr-only bg-slate-50 text-xs uppercase tracking-wide text-slate-600 xl:not-sr-only xl:table-header-group">
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
                        <Link href={`/admin/customers/${row.customerId}?tab=billing-metering`} className="font-semibold text-slate-950 hover:underline">{row.customerName}</Link>
                        <div className="mt-1 text-xs text-slate-500">{row.customerNumber ?? 'Kundnummer saknas'}</div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusStyle[row.status]}`}>{row.statusLabel}</span>
                        {row.hasApprovedCalculation && row.status !== 'approved' ? <p className="mt-1 text-xs text-slate-700">Granskning: Godkänd</p> : null}
                        {row.blocker ? <p className="mt-2 max-w-xs text-xs leading-5 text-amber-900">{row.blocker}</p> : null}
                        {row.edielSourceNeedsReview || edielSourceReviews?.has(row.underlayId) ? (
                          <p className="mt-2 max-w-xs text-xs leading-5 text-amber-900">
                            Mätvärdenas Ediel-källa behöver granskas innan underlaget kan faktureras.
                          </p>
                        ) : null}
                        {scope.isPlatformAdmin && edielSourceReviews?.get(row.underlayId) ? (
                          <Link href={`/admin/ediel/messages/${edielSourceReviews.get(row.underlayId)}`} className="mt-2 inline-block text-xs font-medium underline">
                            Granska Ediel-originalet
                          </Link>
                        ) : null}
                      </td>
                      <td className="px-4 py-4 text-slate-700"><span className="mb-1 block text-xs font-medium text-slate-600 xl:hidden">Avtal</span>{productLabel(row.contractType, row.contractName)}</td>
                      <td className="px-4 py-4 font-medium text-slate-700"><span className="mb-1 block text-xs font-medium text-slate-600 xl:hidden">Elområde</span>{row.priceArea ?? '—'}</td>
                      <td className="px-4 py-4 tabular-nums text-slate-700 xl:text-right"><span className="mb-1 block text-xs font-medium text-slate-600 xl:hidden">Förbrukning</span>{quantity(row.totalKwh)}</td>
                      <td className="px-4 py-4 font-semibold tabular-nums text-slate-950 xl:text-right"><span className="mb-1 block text-xs font-medium text-slate-600 xl:hidden">Att fakturera</span>{money(row.amountIncVat)}</td>
                      <td className="px-5 py-4 text-right">
                        {row.invoiceExportItemId ? (
                          <Link href={`/admin/billing/invoices/${row.invoiceExportItemId}${row.reservationReview ? '#reservation' : ''}`} className="inline-flex rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50">{row.reservationReview ? 'Stäm av reservation' : 'Visa faktura'}</Link>
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
