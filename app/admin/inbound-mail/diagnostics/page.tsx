import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { runInboundMailSmokeTests } from '@/lib/inbound-mail/smokeTests'

export const dynamic = 'force-dynamic'

function tone(status: string) {
  if (status === 'pass') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800'
  return 'border-red-200 bg-red-50 text-red-800'
}

export default async function InboundMailDiagnosticsPage() {
  const admin = await requirePlatformAdminAccess()
  const results = await runInboundMailSmokeTests()
  const failed = results.filter((result) => result.status === 'fail').length
  const warnings = results.filter((result) => result.status === 'warning').length

  return (
    <div>
      <AdminHeader
        title="Inbound Mail diagnostics"
        subtitle="Platform-only smoke tests för Batch 7A.1: parser, tabeller, cron-secret och driftberedskap."
        userEmail={admin.email}
        workspaceMode="platform"
      />
      <main className="space-y-6 px-6 py-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/admin/inbound-mail" className="rounded-2xl border border-emerald-100 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">
            Tillbaka till Inbound Mail Engine
          </Link>
          <div className="text-sm font-semibold text-slate-700">{failed} fel · {warnings} varningar · {results.length} kontroller</div>
        </div>

        <section className="overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-sm shadow-emerald-950/5">
          <div className="border-b border-slate-100 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Smoke test</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">Batch 7A.1-kontroller</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {results.map((result) => (
              <div key={result.name} className="grid gap-3 p-4 md:grid-cols-[220px_120px_1fr] md:items-start">
                <div className="font-semibold text-slate-950">{result.name}</div>
                <span className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${tone(result.status)}`}>{result.status}</span>
                <div className="text-sm text-slate-700">
                  {result.message}
                  {result.details ? <pre className="mt-2 max-h-40 overflow-auto rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">{JSON.stringify(result.details, null, 2)}</pre> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
