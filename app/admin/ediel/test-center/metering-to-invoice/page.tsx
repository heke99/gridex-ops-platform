import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { runTestCenterMeteringToInvoiceAction } from '@/app/admin/ediel/test-center/actions'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams?: Promise<{ runStatus?: string; runMessage?: string }>
}

type CompanyRow = { id: string; name?: string | null }
type CustomerRow = { id: string; company_id?: string | null; customer_number?: string | null }
type MessageRow = {
  id: string
  company_id?: string | null
  customer_id?: string | null
  message_code?: string | null
  status?: string | null
  created_at?: string | null
}

export default async function MeteringToInvoiceTestCenterPage({ searchParams }: PageProps) {
  const context = await requirePlatformAdminAccess()
  const params = await searchParams
  const runStatus = params?.runStatus === 'success' ? 'success' : params?.runStatus === 'error' ? 'error' : null

  const [companiesResult, customersResult, messagesResult] = await Promise.all([
    supabaseService.from('companies').select('id,name').order('name', { ascending: true }).limit(100),
    supabaseService
      .from('customers')
      .select('id,company_id,customer_number')
      .order('created_at', { ascending: false })
      .limit(300),
    supabaseService
      .from('ediel_messages')
      .select('id,company_id,customer_id,message_code,status,created_at')
      .eq('environment', 'test')
      .eq('direction', 'inbound')
      .eq('message_family', 'UTILTS')
      .not('customer_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(300),
  ])

  const companies = (companiesResult.data ?? []) as CompanyRow[]
  const customers = (customersResult.data ?? []) as CustomerRow[]
  const messages = (messagesResult.data ?? []) as MessageRow[]

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Mätvärde → faktura"
        subtitle="Superadmin-test av samma canonical UTILTS-, mätvärdes-, pricing- och fakturakedja som produktion, låst till testmiljö."
        userEmail={context.email}
        workspaceName="Platform"
        workspaceMode="platform"
      />

      <main className="space-y-6 p-8">
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

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">Canonical runtime</p>
          <h1 className="mt-2 text-2xl font-black text-slate-950">Kör riktig testkedja</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
            Endast redan test-scopade, inkommande UTILTS-meddelanden som är explicit kopplade till vald kund får köras.
            Backend verifierar tenant, kund, riktning, meddelandefamilj och miljö innan mätvärdesingest. Fakturautkast skapas alltid med billing environment=test och skickas aldrig härifrån.
          </p>

          {(companiesResult.error || customersResult.error || messagesResult.error) ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900">
              Testdata kunde inte laddas komplett. Kör inte kedjan förrän listorna kan läsas utan databasfel.
            </div>
          ) : null}

          <form action={runTestCenterMeteringToInvoiceAction} className="mt-6 grid gap-4 lg:grid-cols-2">
            <label className="space-y-2 text-sm font-bold text-slate-800">
              <span>Bolag / tenant</span>
              <select name="runtimeCompanyId" required className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-medium">
                <option value="">Välj bolag</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>{company.name ?? company.id}</option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm font-bold text-slate-800">
              <span>Testkund</span>
              <select name="runtimeCustomerId" required className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-medium">
                <option value="">Välj kund</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.customer_number ?? customer.id} · tenant {customer.company_id ?? '—'}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm font-bold text-slate-800 lg:col-span-2">
              <span>Inkommande test-UTILTS</span>
              <select name="runtimeEdielMessageId" required className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-medium">
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
              <input
                type="month"
                name="runtimeBillingMonth"
                required
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-medium"
              />
            </label>

            <div className="flex items-end">
              <button className="w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">
                Kör mätvärde → faktura
              </button>
            </div>
          </form>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          {[
            ['1', 'Canonical UTILTS', 'Samma validator, policy och ACK-beslut som ordinarie inbound.'],
            ['2', 'Mätvärden', 'Samma matchning och persistence som ordinarie mätvärdesflöde.'],
            ['3', 'Pricing', 'Samma pricing core, snapshot och låsning som faktureringen.'],
            ['4', 'Fakturautkast', 'Samma invoice-review builder men alltid environment=test och utan dispatch.'],
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
