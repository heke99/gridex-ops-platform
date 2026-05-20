import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { loadPlatformEdielRuleOverview } from '@/lib/ediel/platformRules'

export const dynamic = 'force-dynamic'

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  const display = value === null || value === undefined || String(value).trim().length === 0 ? '—' : String(value)
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-700">{label}</p>
      <p className="mt-1 break-all text-sm font-semibold text-slate-950">{display}</p>
    </div>
  )
}

function Pill({ text, tone }: { text: string; tone: 'emerald' | 'amber' | 'slate' }) {
  const className =
    tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-slate-200 bg-slate-50 text-slate-700'
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}>{text}</span>
}

export default async function PlatformEdielVersionsPage() {
  const admin = await requirePlatformAdminAccess()
  const overview = await loadPlatformEdielRuleOverview()

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Ediel-versioner"
        subtitle="Runtime-vy över current, previous och accepterade inbound-versioner per family/code."
        userEmail={admin.email}
      />

      <div className="space-y-6 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Versionsstatus</h2>
          <p className="mt-1 text-sm leading-6 text-slate-700">
            Den här sidan visar vad versionsmotorn faktiskt kommer välja i runtime. Den används av superadmin för att kontrollera övergångsperioder och undvika att bolagsadmins ser globala regelbeslut.
          </p>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          {overview.runtimeSnapshots.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-700">
              Inga Ediel-versioner finns registrerade ännu.
            </div>
          ) : (
            overview.runtimeSnapshots.map((row) => (
              <article key={row.key} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-950">{row.family} {row.code}</h3>
                    <p className="mt-1 text-sm text-slate-700">{row.standard}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Pill text={`aktiva ${row.activeCount}`} tone={row.activeCount > 1 ? 'amber' : 'emerald'} />
                    {row.inbound.previousVersion ? <Pill text="previous-valid" tone="emerald" /> : <Pill text="ingen previous" tone="slate" />}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <Field label="Outbound selected" value={row.outbound.selectedVersion} />
                  <Field label="Outbound current" value={row.outbound.currentVersion} />
                  <Field label="Outbound previous" value={row.outbound.previousVersion} />
                  <Field label="Inbound current" value={row.inbound.currentVersion} />
                  <Field label="Inbound previous" value={row.inbound.previousVersion} />
                  <Field label="Accepted versions" value={row.inbound.acceptedVersions.join(', ')} />
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </div>
  )
}
