import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type WhiteLabelRow = {
  id: string
  name: string
  slug: string | null
  status: string | null
  support_email: string | null
  created_at: string | null
}

type CompanyRow = {
  id: string
  name: string
  white_label_platform_id: string | null
  status: string | null
}

function formatDate(value: string | null | undefined) {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

export default async function PlatformWhiteLabelsPage() {
  const admin = await requirePlatformAdminAccess()
  const supabase = await createSupabaseServerClient()

  const [{ data: whiteLabels, error: whiteLabelError }, { data: companies, error: companiesError }] = await Promise.all([
    supabase.from('white_label_platforms').select('id,name,slug,status,support_email,created_at').order('created_at', { ascending: false }),
    supabase.from('companies').select('id,name,white_label_platform_id,status').neq('status', 'deleted_test_only'),
  ])

  if (whiteLabelError) throw whiteLabelError
  if (companiesError) throw companiesError

  const rows = (whiteLabels ?? []) as WhiteLabelRow[]
  const companyRows = (companies ?? []) as CompanyRow[]

  return (
    <div className="min-h-screen">
      <AdminHeader title="White-label plattformar" subtitle="Platform-only översikt. White-label admin ska bara se sina egna bolag och användare." userEmail={admin.email} workspaceMode="platform" />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <section className="grid gap-4 sm:grid-cols-3">
          <Stat label="White-label plattformar" value={rows.length} />
          <Stat label="Kopplade bolag" value={companyRows.filter((company) => company.white_label_platform_id).length} />
          <Stat label="Okopplade bolag" value={companyRows.filter((company) => !company.white_label_platform_id).length} />
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          {rows.map((row) => {
            const tenantCount = companyRows.filter((company) => company.white_label_platform_id === row.id).length
            return (
              <article key={row.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">White-label</div>
                    <h2 className="mt-2 text-xl font-black text-slate-950">{row.name}</h2>
                    <p className="mt-1 text-sm text-slate-600">{row.slug ?? 'slug saknas'} · skapad {formatDate(row.created_at)}</p>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">{row.status ?? 'active'}</span>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  <Info label="Supportmail" value={row.support_email} />
                  <Info label="Bolag" value={String(tenantCount)} />
                </div>
              </article>
            )
          })}
          {rows.length === 0 ? <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900">Inga white-label plattformar finns ännu. Migrationen skapar tabellerna; skapa första plattformen via SQL/adminflöde när du kopplar externa operatörer.</div> : null}
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-600">{label}</p><p className="mt-2 text-3xl font-black text-slate-950">{value}</p></div>
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</div><div className="mt-1 break-all text-sm font-semibold text-slate-950">{value?.trim() || '–'}</div></div>
}
