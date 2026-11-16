import CompanySettingsActionForm from '@/components/admin/companies/CompanySettingsActionForm'
import {localSimulationIssueAction,localSimulationReceiveAction,localSimulationPrepareAction,localSimulationAttestAction,localSimulationImportAction,localSimulationRevokeAction} from '@/app/admin/ediel/test-center/actions'
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { loadTestCenterRuntimeOptions, loadLocalSimulationCompanyOptions } from '@/lib/ediel/testing/testCenterRuntimeReadModel'
import {
  importRawEdifactAndRunTestCenterAction,
  runTestCenterMeteringToInvoiceAction,
} from '@/app/admin/ediel/test-center/actions'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams?: Promise<{ runStatus?: string; runMessage?: string }>
}

function CompanyAndCustomerFields({
  companies,
  customers,
  disabled,
}: {
  companies: Array<{ id: string; name?: string | null }>
  customers: Array<{ id: string; company_id?: string | null; customer_number?: string | null }>
  disabled: boolean
}) {
  return (
    <>
      <label className="space-y-2 text-sm font-bold text-slate-800">
        <span>Bolag / tenant</span>
        <select name="runtimeCompanyId" required disabled={disabled} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-medium disabled:bg-slate-100">
          <option value="">Välj bolag</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>{company.name ?? company.id}</option>
          ))}
        </select>
      </label>

      <label className="space-y-2 text-sm font-bold text-slate-800">
        <span>Testkund</span>
        <select name="runtimeCustomerId" required disabled={disabled} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-medium disabled:bg-slate-100">
          <option value="">Välj kund</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.customer_number ?? customer.id} · tenant {customer.company_id ?? '—'}
            </option>
          ))}
        </select>
      </label>
    </>
  )
}

export default async function MeteringToInvoiceTestCenterPage({ searchParams }: PageProps) {
  const context = await requirePlatformAdminAccess()
  const params = await searchParams
  const runStatus = params?.runStatus === 'success' ? 'success' : params?.runStatus === 'error' ? 'error' : null
  const { companies, customers, messages, error } = await loadTestCenterRuntimeOptions()
  const disabled = Boolean(error)
  const localOptions = await loadLocalSimulationCompanyOptions().then(companies=>({companies,error:null as string|null})).catch(()=>({companies:[],error:'Lokala bolagsalternativ kunde inte läsas. Ingen simulering har startats.'}))

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Mätvärde → faktura"
        subtitle="Superadmin-test av samma canonical inbound-, UTILTS-, mätvärdes-, pricing- och fakturakedja som produktion, låst till testmiljö."
        userEmail={context.email}
        workspaceName="Platform"
        workspaceMode="platform"
      />

      <main className="space-y-6 p-8">
        <section className="rounded-2xl bg-white p-6 space-y-4">
          <h2 className="text-xl font-bold">Lokal simulering — utan extern leverans</h2>
          <p>Skapa en tidsbegränsad lokal testgrund med ett kontrollerat TEST-mottagarbevis och en befintlig prisversion. Detta aktiverar inte bolaget eller någon marknadsleverans. Läs det returnerade avtalet före lokal attestering.</p>
          {localOptions.error ? <p role="alert">{localOptions.error}</p> : null}
          <details><summary>1. Reservera lokal körning</summary>
            <CompanySettingsActionForm action={localSimulationIssueAction} canWrite={!localOptions.error} className="grid gap-3 whitespace-pre-wrap">
              <label>Bolag<select name="companyId" required>{localOptions.companies.map(c=><option key={c.id} value={c.id}>{c.name ?? c.id}</option>)}</select></label>
              <LocalDeclarationFields names={[
                ['edielTestRunId','Befintlig DRAFT-körning (tomt skapar en ny)',false],['receiverRegistrationId','TEST-mottagarregistrering'],['expiresAt','Giltig till (UTC ISO-tid)'],['idempotencyKey','Unik körningsnyckel'],
                ['customerLabel','Testkundens namn'],['siteLabel','Anläggningens namn'],['externalMeteringPointId','Mätpunktsidentitet'],['gridAreaCode','Nätområde'],['priceArea','Elområde (SE1–SE4)'],['startsOn','Periodens första datum'],['endsOn','Periodens sista datum'],
                ['realPricePlanVersionId','Befintlig prisversion'],['expectedStoredPvContentSha256','Prisversionens innehålls-SHA256'],['realContractProductVersionId','Produktversion (valfritt)',false],
                ['fixedPriceOrePerKwh','Fast pris, öre/kWh'],['monthlyFeeSek','Månadsavgift, SEK'],['invoiceFeeSek','Fakturaavgift, SEK'],['markupOrePerKwh','Påslag, öre/kWh'],['variableFeeOrePerKwh','Rörlig avgift, öre/kWh'],['greenFeeSek','Grön avgift, SEK'],['discountSek','Rabatt, SEK'],['startFeeSek','Startavgift, SEK'],['adminFeeSek','Administrationsavgift, SEK'],['breakFeeSek','Brytavgift, SEK'],['vatRate','Momssats'],
                ['startInclusive','Affärsperiod från (UTC ISO)'],['endExclusive','Affärsperiod till, exklusivt (UTC ISO)'],['businessAsOf','Simulerad affärstid (UTC ISO)'],
                ['legalSenderEdielId','Deklarerad juridisk TEST-avsändare'],['transportSenderEdielId','Deklarerad transportavsändare'],['applicationReference','Applikationsreferens'],['sourceSlotKey','Källplatsens namn'],['rawSha256','Exakt originalfils SHA256'],['documentReference','Dokumentreferens'],['transactionReference','Transaktionsreferens'],
              ]}/>
              <label><input type="checkbox" name="acknowledgement" value="LOCAL_SIMULATION_ONLY" required/> Endast lokal simulering; ingen extern auktoritet eller leverans.</label>
              <button type="submit">Reservera lokal körning</button>
            </CompanySettingsActionForm>
          </details>
          <details><summary>2. Deklarera och kontrollera originalfilen</summary>
            <CompanySettingsActionForm action={localSimulationReceiveAction} canWrite preserveRawEdifactBytes className="grid gap-3 whitespace-pre-wrap">
              <LocalDeclarationFields names={[["companyId","Bolags-ID"],["admissionId","Lokalt körnings-ID"],["manifestSha256","Manifest-SHA256"],["sourceSlotKey","Källplats"],["idempotencyKey","Deklarationens unika nyckel"],["billingMonth","Fakturamånad YYYY-MM"]]}/>
              <label>Exakt EDIFACT-original<input type="file" name="rawEdifact" required/></label><button type="submit">Deklarera och kontrollera original</button>
            </CompanySettingsActionForm>
          </details>
          <details><summary>3. Förbered och läs lokalt avtal</summary>
            <CompanySettingsActionForm action={localSimulationPrepareAction} canWrite preserveRawEdifactBytes className="grid gap-3 whitespace-pre-wrap">
              <LocalDeclarationFields names={[["companyId","Bolags-ID"],["admissionId","Returnerat lokalt körnings-ID"],["manifestSha256","Returnerad manifest-SHA256"],["idempotencyKey","Förberedelsens unika nyckel"]]}/>
              <LocalDeclarationFields names={[["billingMonth","Fakturamånad YYYY-MM"]]}/><label>Samma deklarerade EDIFACT-original<input type="file" name="rawEdifact" required/></label><button type="submit">Förbered och visa avtalet</button>
            </CompanySettingsActionForm>
          </details>
          <details><summary>4. Attestera exakt visat dokument lokalt</summary>
            <CompanySettingsActionForm action={localSimulationAttestAction} canWrite className="grid gap-3 whitespace-pre-wrap">
              <LocalDeclarationFields names={[["admissionId","Lokalt körnings-ID"],["contractId","Returnerat avtals-ID"],["documentSha256","Det visade dokumentets SHA256"]]}/>
              <label><input type="checkbox" name="acknowledgement" value="LOCAL_SIMULATION_ONLY" required/> Jag har läst det visade lokala avtalet. Detta är ingen produktionssignering.</label>
              <button type="submit">Attestera lokalt</button>
            </CompanySettingsActionForm>
          </details>
          <details><summary>5. Kör originalfil genom lokal kedja</summary>
            <CompanySettingsActionForm action={localSimulationImportAction} canWrite preserveRawEdifactBytes className="grid gap-3 whitespace-pre-wrap">
              <LocalDeclarationFields names={[["companyId","Bolags-ID"],["admissionId","Lokalt körnings-ID"],["customerId","Returnerat kund-ID"],["contractId","Returnerat avtals-ID"],["manifestSha256","Manifest-SHA256"],["sourceSlotKey","Källplats"],["idempotencyKey","Importens unika nyckel"],["billingMonth","Fakturamånad YYYY-MM"]]}/>
              <label>Exakt EDIFACT-original<input type="file" name="rawEdifact" required/></label>
              <button type="submit">Kör lokal kedja utan extern leverans</button>
            </CompanySettingsActionForm>
          </details>
          <details><summary>Återkalla lokal körning</summary>
            <CompanySettingsActionForm action={localSimulationRevokeAction} canWrite className="grid gap-3 whitespace-pre-wrap">
              <LocalDeclarationFields names={[["admissionId","Lokalt körnings-ID"],["reason","Orsak"]]}/><button type="submit">Återkalla</button>
            </CompanySettingsActionForm>
          </details>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/admin/ediel/test-center" className="text-sm font-bold text-emerald-800 hover:underline">
            ← Tillbaka till Ediel Test Center
          </Link>
          <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-emerald-800">
            External side effects: blockerade
          </div>
        </div>

        {runStatus && params?.runMessage ? (
          <section className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
            runStatus === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}>
            {params.runMessage}
          </section>
        ) : null}

        {error ? (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900">
            Testdata kunde inte laddas komplett. Testkörning är blockerad tills read-modellen kan läsas utan databasfel.
          </section>
        ) : null}

        <section className="rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">Ny råfilskedja</p>
          <h1 className="mt-2 text-2xl font-black text-slate-950">Ladda upp UTILTS / klistra in EDIFACT</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
            Filen går först genom samma canonical EDIFACT-parser som ordinarie inbound. Innan något behandlas verifieras att det är UTILTS,
            att mätpunktsreferensen tillhör vald testkund och tenant, och att importen kan hållas i testmiljö. Därefter skapas ett test-inbound-envelope,
            samma inbound-processor körs, och resultatet fortsätter genom canonical mätvärde → billing → fakturautkast. Efter en lyckad körning öppnas en komplett trace-vy.
          </p>

          <form action={importRawEdifactAndRunTestCenterAction} className="mt-6 grid gap-4 lg:grid-cols-2">
            <CompanyAndCustomerFields companies={companies} customers={customers} disabled={disabled} />

            <label className="space-y-2 text-sm font-bold text-slate-800">
              <span>Fakturamånad</span>
              <input type="month" name="runtimeBillingMonth" required disabled={disabled} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-medium disabled:bg-slate-100" />
            </label>

            <label className="space-y-2 text-sm font-bold text-slate-800">
              <span>Deterministiskt scenario</span>
              <select name="testScenario" defaultValue="baseline" disabled={disabled} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-medium disabled:bg-slate-100">
                <option value="baseline">Baseline · normal körning</option>
                <option value="duplicate">Duplicate · exakt replay två gånger</option>
                <option value="missing_values">Missing values · första QTY tas bort</option>
                <option value="correction">Correction · baseline + deterministisk QTY-rättning</option>
                <option value="rebilling">Rebilling · baseline + rättning + omkörning</option>
              </select>
              <span className="block text-xs font-medium leading-5 text-slate-500">Scenarierna muterar/replayar samma uppladdade UTILTS. De använder fortfarande samma canonical parser och runtime.</span>
            </label>

            <label className="space-y-2 text-sm font-bold text-slate-800">
              <span>EDIFACT-fil · max 2 MB</span>
              <input type="file" name="edifactFile" accept=".edi,.edifact,.txt,text/plain" disabled={disabled} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100" />
            </label>

            <label className="space-y-2 text-sm font-bold text-slate-800 lg:col-span-2">
              <span>Eller klistra in rå EDIFACT</span>
              <textarea
                name="rawEdifact"
                rows={10}
                disabled={disabled}
                placeholder="UNA:+.? 'UNB+UNOC:3+..."
                className="w-full rounded-xl border border-slate-300 bg-slate-950 px-3 py-3 font-mono text-xs leading-5 text-slate-100 disabled:bg-slate-200"
              />
            </label>

            <div className="lg:col-span-2 flex justify-end">
              <button disabled={disabled} className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400">
                Importera, kör och öppna trace
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-600">Befintligt testmeddelande</p>
          <h2 className="mt-2 text-xl font-black text-slate-950">Kör redan importerad test-UTILTS</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
            Den här vägen finns kvar för omkörning och regression. Endast redan test-scopade inkommande UTILTS-poster med explicit kundbindning accepteras.
          </p>

          <form action={runTestCenterMeteringToInvoiceAction} className="mt-6 grid gap-4 lg:grid-cols-2">
            <CompanyAndCustomerFields companies={companies} customers={customers} disabled={disabled} />

            <label className="space-y-2 text-sm font-bold text-slate-800 lg:col-span-2">
              <span>Inkommande test-UTILTS</span>
              <select name="runtimeEdielMessageId" required disabled={disabled} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-medium disabled:bg-slate-100">
                <option value="">Välj testmeddelande</option>
                {messages.map((message) => (
                  <option key={message.id} value={message.id}>
                    {message.message_code ?? 'UTILTS'} · {message.status ?? '—'} · kund {message.customer_id ?? '—'} · tenant {message.company_id ?? '—'} · {message.created_at ?? '—'}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm font-bold text-slate-800">
              <span>Fakturamånad</span>
              <input type="month" name="runtimeBillingMonth" required disabled={disabled} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-medium disabled:bg-slate-100" />
            </label>

            <div className="flex items-end">
              <button disabled={disabled} className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400">
                Kör och öppna trace
              </button>
            </div>
          </form>
        </section>

        <section className="grid gap-4 md:grid-cols-7">
          {[
            ['1', 'Originalfil', 'Råfil, SHA256 och segmentindex.'],
            ['2', 'Canonical', 'Parsed payload och validation report.'],
            ['3', 'Mätvärden', 'Normaliserade rader för vald månad.'],
            ['4', 'Billing', 'Underlag, readiness och blockerare.'],
            ['5', 'Pricing', 'Snapshot, run och pricing-rader.'],
            ['6', 'Faktura', 'Export item och fakturautkast.'],
            ['7', 'Provenance', 'ID-kedja tillbaka till originalfilen.'],
          ].map(([step, title, text]) => (
            <div key={step} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-black text-emerald-700">STEG {step}</div>
              <div className="mt-1 font-black text-slate-950">{title}</div>
              <div className="mt-2 text-sm leading-5 text-slate-600">{text}</div>
            </div>
          ))}
        </section>
      </main>
    </div>
  )
}

function LocalDeclarationFields({names}:{names:Array<[string,string,boolean?]>}) {
  return names.map(([name,label,required=true])=><label key={name}>{label}<input name={name} required={required} className="block w-full rounded border p-2"/></label>)
}
