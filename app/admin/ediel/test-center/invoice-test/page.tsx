import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { loadInvoiceTestCenterWorkspace } from '@/lib/ediel/testing/invoiceTestCenterWorkspace'
import { loadInvoiceTestEdifactSummary } from '@/lib/ediel/testing/invoiceTestEdifactMaterialization'
import InvoiceTestCustomerForm from '@/app/admin/ediel/test-center/invoice-test/InvoiceTestCustomerForm'
import {
  archiveInvoiceTestCustomerAction,
  importInvoiceTestEdifactAction,
  rerunInvoiceTestMessageAction,
  resetInvoiceTestCustomerAction,
  sendInvoiceTestToProviderAction,
} from '@/app/admin/ediel/test-center/invoice-test/actions'

export const dynamic = 'force-dynamic'

type Row = Record<string, unknown>

type PageProps = {
  searchParams?: Promise<{
    runStatus?: string
    runMessage?: string
    companyId?: string
    customerId?: string
    traceHref?: string
  }>
}

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

function objectValue(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}

function money(value: unknown) {
  const amount = num(value)
  return amount === null ? '—' : `${amount.toFixed(2)} kr`
}

function json(value: unknown) {
  if (!value || (typeof value === 'object' && Object.keys(value as Row).length === 0)) return '—'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default async function InvoiceTestCenterPage({ searchParams }: PageProps) {
  const context = await requirePlatformAdminAccess()
  const params = await searchParams
  const workspace = await loadInvoiceTestCenterWorkspace()
  const companies = workspace.companies as Row[]
  const offers = workspace.offers as Row[]
  const customers = workspace.customers as Row[]
  const meteringPoints = workspace.meteringPoints as Row[]
  const messages = workspace.messages as Row[]
  const invoiceItems = workspace.invoiceItems as Row[]
  const invoices = workspace.invoices as Row[]
  const pricingLines = workspace.pricingLines as Row[]
  const providerConnections = workspace.providerConnections as Row[]

  const companyNames = new Map(companies.map((row) => [String(row.id), text(row.name) ?? String(row.id)]))
  const invoiceByItem = new Map(invoices.map((row) => [text(row.invoice_export_item_id), row]))
  const linesByPricingRun = new Map<string, Row[]>()
  for (const line of pricingLines) {
    const pricingRunId = text(line.pricing_run_id)
    if (!pricingRunId) continue
    const list = linesByPricingRun.get(pricingRunId) ?? []
    list.push(line)
    linesByPricingRun.set(pricingRunId, list)
  }

  const selectedCompanyId = params?.companyId && companies.some((row) => String(row.id) === params.companyId)
    ? params.companyId
    : text(customers[0]?.company_id) ?? text(companies[0]?.id) ?? ''
  const companyCustomers = customers.filter((row) => text(row.company_id) === selectedCompanyId)
  const selectedCustomerId = params?.customerId && companyCustomers.some((row) => String(row.id) === params.customerId)
    ? params.customerId
    : text(companyCustomers[0]?.id) ?? ''
  const selectedCustomer = companyCustomers.find((row) => String(row.id) === selectedCustomerId)
  const safeTraceHref = params?.traceHref?.startsWith('/admin/ediel/test-center/metering-to-invoice/trace/') ? params.traceHref : null
  const selectedMeteringPoints = meteringPoints.filter((row) => text(row.customer_id) === selectedCustomerId)
  const selectedMessages = messages.filter((row) => text(row.customer_id) === selectedCustomerId)
  const selectedItems = invoiceItems.filter((row) => text(row.customer_id) === selectedCustomerId)
  const selectedProvider = providerConnections.find((row) => text(row.company_id) === selectedCompanyId)
  const providerReady = Boolean(selectedProvider && text(selectedProvider.status) === 'active')

  let edifactSummary: Row | null = null
  if (selectedCompanyId && selectedCustomerId) {
    try {
      edifactSummary = await loadInvoiceTestEdifactSummary({ companyId: selectedCompanyId, customerId: selectedCustomerId })
    } catch {
      edifactSummary = null
    }
  }
  const imported = objectValue(edifactSummary?.imported)
  const importedQuantities = Array.isArray(imported.quantities) ? imported.quantities as Row[] : []

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Fakturatest"
        subtitle="Isolerad superadmin-kedja som använder samma kundmodell, canonical UTILTS-parser, billing, pricing och Capway/Aptic-integration som produktion — men provider-miljön är hårdlåst till TEST."
        userEmail={context.email}
        workspaceName="Platform"
        workspaceMode="platform"
      />

      <main className="space-y-6 p-8">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">Isolerad testmiljö</div>
            <div className="mt-1 text-sm font-semibold text-emerald-950">Testkunden innehåller kund/avtal/prisområde. Anläggnings- och mätpunktsidentiteter hämtas först när EDIFACT-filen importeras.</div>
          </div>
          <div className="rounded-full bg-emerald-800 px-3 py-1.5 text-xs font-black uppercase tracking-[0.14em] text-white">Capway/Aptic TEST only</div>
        </section>

        {params?.runStatus && params.runMessage ? (
          <section className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${params.runStatus === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : 'border-red-200 bg-red-50 text-red-950'}`}>
            {params.runMessage}
            {safeTraceHref ? <Link href={safeTraceHref} className="ml-3 font-black underline">Öppna komplett trace</Link> : null}
            {selectedItems.length > 0 ? <Link href="#invoice-test-invoices" className="ml-3 font-black underline">Visa faktura</Link> : null}
          </section>
        ) : null}

        {workspace.error ? (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900">
            Fakturatest kunde inte läsa hela arbetsytan: {workspace.error}
          </section>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">1 · Testkund</p>
          <h1 className="mt-2 text-2xl font-black text-slate-950">Skapa testkund och välj riktigt internt avtal</h1>
          <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-700">
            Kund, avtal, fakturauppgifter och prisområde skapas via canonical kundintag. Inga EDIFACT-identiteter matas in manuellt. De materialiseras från parserresultatet när filen importeras i steg 2.
          </p>
          <InvoiceTestCustomerForm
            initialCompanyId={selectedCompanyId}
            companies={companies.map((row) => ({ id: String(row.id), name: text(row.name) ?? String(row.id) }))}
            offers={offers.map((row) => ({
              id: String(row.id),
              company_id: String(row.company_id),
              name: text(row.name) ?? String(row.id),
              contract_type: text(row.contract_type),
            }))}
          />
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">Aktiva Fakturatest-kunder</p>
          {customers.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">Ingen Fakturatest-kund finns ännu. Skapa en ovan.</p>
          ) : (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {customers.map((customer) => {
                const id = String(customer.id)
                const points = meteringPoints.filter((point) => text(point.customer_id) === id)
                const customerInvoiceItems = invoiceItems.filter((item) => text(item.customer_id) === id)
                return (
                  <article key={id} className={`rounded-2xl border p-4 ${id === selectedCustomerId ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-black text-slate-950">{text(customer.full_name) ?? 'Testkund'} · {text(customer.customer_number) ?? id}</div>
                        <div className="mt-1 text-xs text-slate-600">{companyNames.get(String(customer.company_id)) ?? String(customer.company_id)} · {text(customer.email) ?? '—'}</div>
                        <div className="mt-2 font-mono text-xs text-slate-700">EDIFACT-identitet: {points.map((point) => text(point.metering_point_id) ?? text(point.meter_point_id)).filter(Boolean).join(', ') || 'väntar på filimport'}</div>
                      </div>
                      <Link href={`${WORKSPACE_LINK}?companyId=${encodeURIComponent(String(customer.company_id))}&customerId=${encodeURIComponent(id)}`} className="rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs font-black text-emerald-800">Använd kunden</Link>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <form action={resetInvoiceTestCustomerAction}>
                        <input type="hidden" name="companyId" value={String(customer.company_id)} />
                        <input type="hidden" name="customerId" value={id} />
                        <button className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black text-amber-900">Återställ fakturakörning</button>
                      </form>
                      {customerInvoiceItems.length > 0 ? (
                        <Link href={`${WORKSPACE_LINK}?companyId=${encodeURIComponent(String(customer.company_id))}&customerId=${encodeURIComponent(id)}#invoice-test-invoices`} className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-900">Visa faktura</Link>
                      ) : null}
                      <form action={archiveInvoiceTestCustomerAction}>
                        <input type="hidden" name="companyId" value={String(customer.company_id)} />
                        <input type="hidden" name="customerId" value={id} />
                        <button className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-black text-red-900">Radera testkund · säker arkivering</button>
                      </form>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">2 · EDIFACT → masterdata → fakturautkast</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">Importera UTILTS och låt filen definiera identiteterna</h2>
          <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-700">Canonical parser läser först filen. Parserresultatet materialiserar endast testkundens test-site/mätpunkt. Därefter går samma payload genom ordinarie inbound-matchning, normaliserade mätvärden, billing-underlag, låst pricing och fakturautkast.</p>

          {selectedCustomerId ? (
            <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-sky-800">{edifactSummary ? 'Inläst från EDIFACT' : 'Väntar på EDIFACT'}</div>
              {edifactSummary ? (
                <div className="mt-3 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                  <div><div className="text-xs font-bold text-slate-500">Anläggnings-/mätpunkts-ID</div><div className="mt-1 break-all font-mono font-black">{text(imported.primary_metering_reference) ?? text(edifactSummary.metering_point_id) ?? '—'}</div><div className="text-xs text-slate-500">Källa: {text(imported.primary_reference_source) ?? 'canonical parser'}</div></div>
                  <div><div className="text-xs font-bold text-slate-500">LOC+172 / facility</div><div className="mt-1 break-all font-mono font-black">{text(imported.facility_id) ?? text(edifactSummary.facility_id) ?? '—'}</div></div>
                  <div><div className="text-xs font-bold text-slate-500">Nätområde · LOC+239</div><div className="mt-1 font-mono font-black">{text(imported.grid_area_code) ?? text(edifactSummary.grid_area_code) ?? '—'}</div></div>
                  <div><div className="text-xs font-bold text-slate-500">Mätarnummer · RFF+MG</div><div className="mt-1 break-all font-mono font-black">{text(imported.meter_number) ?? text(edifactSummary.meter_number) ?? '—'}</div></div>
                  <div><div className="text-xs font-bold text-slate-500">Avsändare → mottagare</div><div className="mt-1 font-mono font-black">{text(imported.sender_ediel_id) ?? '—'} → {text(imported.receiver_ediel_id) ?? '—'}</div></div>
                  <div><div className="text-xs font-bold text-slate-500">Meddelande</div><div className="mt-1 font-mono font-black">{text(imported.message_code) ?? 'UTILTS'}</div></div>
                  <div><div className="text-xs font-bold text-slate-500">Period · DTM+324</div><div className="mt-1 break-all font-mono font-black">{text(imported.period) ?? '—'}</div></div>
                  <div><div className="text-xs font-bold text-slate-500">Transaktionsreferens</div><div className="mt-1 break-all font-mono font-black">{text(imported.transaction_reference) ?? '—'}</div></div>
                  <div className="md:col-span-2 xl:col-span-4"><div className="text-xs font-bold text-slate-500">Kvantiteter från QTY</div><div className="mt-2 flex flex-wrap gap-2">{importedQuantities.length === 0 ? <span>—</span> : importedQuantities.map((quantity, index) => <span key={index} className="rounded-lg bg-white px-2.5 py-1 font-mono text-xs shadow-sm">{text(quantity.qualifier) ?? '?'}: {num(quantity.value) ?? text(quantity.rawValue) ?? '—'} {text(quantity.unit) ?? ''}</span>)}</div></div>
                </div>
              ) : (
                <p className="mt-2 text-sm text-sky-950">Ingen anläggnings- eller mätpunktsidentitet är skapad ännu. Den kommer från nästa importerade UTILTS-fil.</p>
              )}
            </div>
          ) : null}

          <form action={importInvoiceTestEdifactAction} className="mt-6 grid gap-4 lg:grid-cols-2">
            <input type="hidden" name="companyId" value={selectedCompanyId} />
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"><span className="font-bold">Bolag:</span> {companyNames.get(selectedCompanyId) ?? 'Välj testkund'}</div>
            <label className="space-y-2 text-sm font-bold text-slate-800"><span>Testkund</span><select name="customerId" required defaultValue={selectedCustomerId} className="w-full rounded-xl border border-slate-300 px-3 py-2"><option value="">Välj</option>{companyCustomers.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.customer_number) ?? String(row.id)} · {text(row.full_name) ?? 'Testkund'}</option>)}</select></label>
            <label className="space-y-2 text-sm font-bold text-slate-800"><span>Fakturamånad</span><input type="month" name="billingMonth" required defaultValue="2026-07" className="w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
            <label className="space-y-2 text-sm font-bold text-slate-800"><span>Scenario</span><select name="testScenario" defaultValue="baseline" className="w-full rounded-xl border border-slate-300 px-3 py-2"><option value="baseline">Baseline</option><option value="duplicate">Duplicate</option><option value="missing_values">Missing values</option><option value="correction">Correction</option><option value="rebilling">Rebilling</option></select></label>
            <label className="space-y-2 text-sm font-bold text-slate-800 lg:col-span-2"><span>EDIFACT-fil · max 2 MB</span><input type="file" name="edifactFile" accept=".edi,.edifact,.txt,text/plain" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>
            <label className="space-y-2 text-sm font-bold text-slate-800 lg:col-span-2"><span>Eller klistra in rå EDIFACT</span><textarea name="rawEdifact" rows={8} placeholder="UNA:+.? 'UNB+UNOC:3+..." className="w-full rounded-xl border border-slate-300 bg-slate-950 px-3 py-3 font-mono text-xs leading-5 text-slate-100" /></label>
            <div className="flex justify-end lg:col-span-2"><button disabled={!selectedCustomerId} className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-black text-white disabled:bg-slate-400">Importera → läs masterdata → skapa fakturautkast</button></div>
          </form>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-600">Omkörning</p>
          <h2 className="mt-2 text-xl font-black text-slate-950">Kör en redan importerad test-UTILTS igen</h2>
          <form action={rerunInvoiceTestMessageAction} className="mt-4 grid gap-3 md:grid-cols-4">
            <input type="hidden" name="companyId" value={selectedCompanyId} />
            <input type="hidden" name="customerId" value={selectedCustomerId} />
            <select name="edielMessageId" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2"><option value="">Välj testmeddelande</option>{selectedMessages.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.message_code) ?? 'UTILTS'} · {text(row.status) ?? '—'} · {text(row.file_name) ?? String(row.id)}</option>)}</select>
            <input type="month" name="billingMonth" required defaultValue="2026-07" className="rounded-xl border border-slate-300 px-3 py-2" />
            <button disabled={!selectedCustomerId || selectedMessages.length === 0} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:bg-slate-400">Kör om</button>
          </form>
        </section>

        <section id="invoice-test-invoices" className="scroll-mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">3 · Faktura & leverantör</p>
              <h2 className="mt-2 text-2xl font-black text-slate-950">Granska fakturan och skapa den hos Capway/Aptic TEST</h2>
            </div>
            <div className={`rounded-full px-3 py-1.5 text-xs font-black ${providerReady ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>
              Testanslutning: {selectedProvider ? text(selectedProvider.status) ?? 'konfigurerad' : 'saknas'}
            </div>
          </div>
          {!providerReady && selectedCustomerId ? <p className="mt-3 text-sm font-semibold text-amber-800">Intern fakturaberäkning kan testas, men provider-skick är blockerat tills Capway/Aptic TEST är active/ready.</p> : null}
          {!selectedCustomerId ? <p className="mt-4 text-sm text-slate-600">Välj en testkund för att se fakturor.</p> : selectedItems.length === 0 ? <p className="mt-4 text-sm text-slate-600">Ingen testfaktura finns ännu. Importera UTILTS ovan.</p> : (
            <div className="mt-5 space-y-5">
              {selectedItems.map((item) => {
                const itemId = String(item.id)
                const invoice = invoiceByItem.get(itemId)
                const lines = linesByPricingRun.get(text(item.pricing_run_id) ?? '') ?? []
                const status = text(item.status) ?? '—'
                const canSend = providerReady && status === 'pending' && text(item.environment) === 'test' && text(item.provider) === 'capway_aptic'
                return (
                  <article key={itemId} className="overflow-hidden rounded-2xl border border-slate-200">
                    <div className="flex flex-wrap items-start justify-between gap-4 bg-slate-50 p-4">
                      <div>
                        <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{text(invoice?.invoice_reference) ?? itemId}</div>
                        <div className="mt-1 text-lg font-black text-slate-950">{money(item.amount_inc_vat)} inkl. moms · {num(item.total_kwh)?.toFixed(3) ?? '—'} kWh</div>
                        <div className="mt-1 text-xs text-slate-600">Status: <b>{status}</b> · environment: <b>{text(item.environment) ?? '—'}</b> · provider: <b>{text(item.provider) ?? '—'}</b></div>
                      </div>
                      {canSend ? (
                        <form action={sendInvoiceTestToProviderAction}>
                          <input type="hidden" name="companyId" value={selectedCompanyId} />
                          <input type="hidden" name="customerId" value={selectedCustomerId} />
                          <input type="hidden" name="invoiceExportItemId" value={itemId} />
                          <button className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">Skapa testfaktura hos Capway/Aptic</button>
                        </form>
                      ) : null}
                    </div>
                    <div className="grid gap-4 p-4 lg:grid-cols-3">
                      <div className="rounded-xl border border-slate-200 p-3"><div className="text-xs font-black uppercase text-slate-500">Belopp</div><dl className="mt-2 space-y-1 text-sm"><div className="flex justify-between"><dt>Exkl. moms</dt><dd className="font-bold">{money(item.amount_ex_vat)}</dd></div><div className="flex justify-between"><dt>Moms</dt><dd className="font-bold">{money(item.vat_amount)}</dd></div><div className="flex justify-between"><dt>Inkl. moms</dt><dd className="font-black">{money(item.amount_inc_vat)}</dd></div></dl></div>
                      <div className="rounded-xl border border-slate-200 p-3"><div className="text-xs font-black uppercase text-slate-500">Fakturaspegel</div><div className="mt-2 text-sm leading-6">Period: {text(invoice?.period_start) ?? '—'} → {text(invoice?.period_end) ?? '—'}<br />Elområde: {text(invoice?.price_area_code) ?? '—'}<br />Provider-ID: <span className="font-mono">{text(item.provider_invoice_guid) ?? text(invoice?.partner_invoice_reference) ?? '—'}</span><br />Förfallodatum: {text(invoice?.due_date) ?? '—'}</div></div>
                      <div className="rounded-xl border border-slate-200 p-3"><div className="text-xs font-black uppercase text-slate-500">Integritet</div><div className="mt-2 text-sm leading-6">Calculation SHA256:<br /><span className="break-all font-mono text-xs">{text(invoice?.calculation_snapshot_sha256) ?? '—'}</span><br />Senast uppdaterad: {text(item.updated_at) ?? '—'}</div></div>
                    </div>
                    <div className="border-t border-slate-200 p-4">
                      <div className="font-black text-slate-950">Fakturarader</div>
                      {lines.length === 0 ? <p className="mt-2 text-sm text-slate-500">Inga pricing-rader kunde läsas.</p> : (
                        <div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="py-2 pr-4">Rad</th><th className="py-2 pr-4">Mängd</th><th className="py-2 pr-4">Enhetspris</th><th className="py-2 pr-4">Exkl.</th><th className="py-2">Inkl.</th></tr></thead><tbody>{lines.map((line) => <tr key={String(line.id)} className="border-b border-slate-100"><td className="py-2 pr-4 font-medium">{text(line.description) ?? text(line.line_type) ?? 'Rad'}</td><td className="py-2 pr-4">{num(line.quantity)?.toFixed(3) ?? '—'} {text(line.unit) ?? ''}</td><td className="py-2 pr-4">{num(line.unit_price_ex_vat)?.toFixed(4) ?? '—'}</td><td className="py-2 pr-4">{money(line.amount_ex_vat)}</td><td className="py-2 font-bold">{money(line.amount_inc_vat)}</td></tr>)}</tbody></table></div>
                      )}
                    </div>
                    {(text(item.provider_invoice_guid) || text(item.error_code) || Object.keys((item.response_payload as Row) ?? {}).length > 0) ? (
                      <details className="border-t border-slate-200 bg-slate-950 p-4 text-xs text-slate-100">
                        <summary className="cursor-pointer font-black">Provider request/response & fel</summary>
                        <div className="mt-4 grid gap-4 lg:grid-cols-3"><pre className="overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3">REQUEST\n{json(item.request_payload)}</pre><pre className="overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3">RESPONSE\n{json(item.response_payload)}</pre><pre className="overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3">ERROR {text(item.error_code) ?? ''}\n{json(item.error_payload)}</pre></div>
                      </details>
                    ) : null}
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <section className="grid gap-3 md:grid-cols-7">
          {[
            ['1', 'Testkund'], ['2', 'EDIFACT'], ['3', 'Canonical'], ['4', 'Mätvärden'], ['5', 'Billing + pricing'], ['6', 'Faktura'], ['7', 'Capway/Aptic TEST'],
          ].map(([step, label]) => <div key={step} className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm"><div className="text-xs font-black text-emerald-700">STEG {step}</div><div className="mt-1 text-sm font-black text-slate-950">{label}</div></div>)}
        </section>
      </main>
    </div>
  )
}

const WORKSPACE_LINK = '/admin/ediel/test-center/invoice-test'
