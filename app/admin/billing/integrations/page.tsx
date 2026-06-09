import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { fmt, safeListRows, statusBadge } from '@/lib/pricing/adminData'

export const dynamic = 'force-dynamic'

function envStatus(name: string) {
  return process.env[name] ? 'Konfigurerad' : 'Saknas'
}

export default async function BillingIntegrationsPage() {
  const admin = await requireAdminPageKeyAccess('billing.workspace')
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const connections = await safeListRows('billing_provider_connections', scope?.companyId ?? null, '*', 80)
  const runs = await safeListRows('invoice_export_runs', scope?.companyId ?? null, '*', 40)
  const deadLetters = await safeListRows('invoice_dead_letters', scope?.companyId ?? null, '*', 20)

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader title="Fakturaintegrationer" subtitle="Styr fakturaexport, Capway/Aptic, fakturaköp och providerstatus per elhandelsbolag." userEmail={admin.email} workspaceName={scope?.companyName} />
      <main className="space-y-6 p-8">
        <section className="grid gap-4 lg:grid-cols-4">
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="text-sm text-slate-600">Providerkopplingar</div><div className="mt-2 text-3xl font-semibold">{connections.length}</div></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="text-sm text-slate-600">Exportkörningar</div><div className="mt-2 text-3xl font-semibold">{runs.length}</div></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="text-sm text-slate-600">Misslyckade poster</div><div className="mt-2 text-3xl font-semibold">{deadLetters.filter((row) => row.status === 'open').length}</div></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="text-sm text-slate-600">Capway test-env</div><div className="mt-2 text-sm font-semibold text-slate-950">{envStatus('CAPWAY_APTIC_TEST_BASE_URL')} / {envStatus('CAPWAY_APTIC_TEST_CLIENT_ID')}</div></div>
        </section>

        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Capway/Aptic readiness</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-amber-950">Export är blockerad tills token-url, base-url, client_id och client_secret finns i Vercel env eller i providerkopplingens secret references. Provider-koder som service, paymentCode, printCode, formCode och paymentProductCode ska bekräftas av Capway innan produktion.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {['CAPWAY_APTIC_TEST_TOKEN_URL','CAPWAY_APTIC_TEST_BASE_URL','CAPWAY_APTIC_TEST_CLIENT_ID','CAPWAY_APTIC_TEST_CLIENT_SECRET'].map((name) => (
              <div key={name} className="rounded-2xl border border-amber-200 bg-white p-4 text-sm"><div className="font-mono text-xs text-slate-600">{name}</div><div className="mt-1 font-semibold text-slate-950">{envStatus(name)}</div></div>
            ))}
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-3xl border bg-white shadow-sm">
            <div className="border-b px-6 py-5"><h2 className="text-lg font-semibold">Providerkopplingar</h2><p className="mt-1 text-sm text-slate-700">Tekniska credentials ligger i env/secret manager. Databasen sparar bara koppling, readiness och provider-koder.</p></div>
            <div className="divide-y">
              {connections.length === 0 ? <div className="p-6 text-sm text-slate-600">Ingen Capway-koppling finns ännu.</div> : null}
              {connections.map((row) => <div key={String(row.id)} className="p-6 text-sm"><div className="flex items-center justify-between gap-3"><div className="font-semibold">{fmt(row.display_name) || fmt(row.provider)}</div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(row.status)}`}>{fmt(row.status)}</span></div><div className="mt-2 text-slate-600">{fmt(row.provider)} · {fmt(row.environment)}</div></div>)}
            </div>
          </div>

          <div className="rounded-3xl border bg-white shadow-sm">
            <div className="border-b px-6 py-5"><h2 className="text-lg font-semibold">Senaste fakturaexporter</h2><p className="mt-1 text-sm text-slate-700">Här visas exportkörningar mot Capway/Aptic och andra fakturapartners.</p></div>
            <div className="divide-y">
              {runs.length === 0 ? <div className="p-6 text-sm text-slate-600">Inga exportkörningar finns ännu.</div> : null}
              {runs.map((row) => <div key={String(row.id)} className="p-6 text-sm"><div className="flex items-center justify-between gap-3"><div className="font-semibold">{fmt(row.billing_month)} · {fmt(row.provider)}</div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(row.status)}`}>{fmt(row.status)}</span></div><div className="mt-2 text-slate-600">Poster: {fmt(row.total_items)} · skickade: {fmt(row.sent_items)} · fel: {fmt(row.failed_items)}</div><Link className="mt-3 inline-flex font-semibold text-emerald-700" href={`/api/internal/invoice-exports/${row.id}`}>API-status</Link></div>)}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
