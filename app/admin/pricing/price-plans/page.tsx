import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { fmt, safeListRows, statusBadge } from '@/lib/pricing/adminData'
import { formatAdminDate, formatStatusLabel } from '@/lib/ui/format'

export const dynamic = 'force-dynamic'

const VERSION_PAGE_SIZE = 25

type PricePlanVersion = {
  id: string
  version_label: string
  status: string
  valid_from: string | null
  valid_to: string | null
  price_plans: { name: string } | null
}

function parsePage(value: string | string[] | undefined) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return 1
  const page = Number(value)
  return Number.isSafeInteger(page * VERSION_PAGE_SIZE) ? page : 1
}

async function readVersionPage(companyId: string | null, page: number): Promise<{
  rows: PricePlanVersion[]
  total: number
  page: number
} | null> {
  const offset = (page - 1) * VERSION_PAGE_SIZE
  try {
    let query = supabaseService.from('price_plan_versions').select(
      'id,version_label,status,valid_from,valid_to,price_plans!price_plan_versions_company_price_plan_fk(name)',
      { count: 'exact' },
    )
    if (companyId) query = query.eq('company_id', companyId)
    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + VERSION_PAGE_SIZE - 1)
      .overrideTypes<PricePlanVersion[], { merge: false }>()

    if (page > 1 && error?.code === 'PGRST103') return readVersionPage(companyId, 1)
    if (error || count === null || !Number.isSafeInteger(count) || count < 0 || !Array.isArray(data)) return null
    if (page > 1 && offset >= count) return readVersionPage(companyId, 1)
    if (data.length !== Math.min(VERSION_PAGE_SIZE, count - offset)) return null
    return { rows: data, total: count, page }
  } catch {
    return null
  }
}

export default async function PricePlansPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>
}) {
  const admin = await requirePlatformAdminAccess()
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const companyId = scope?.companyId ?? null
  const page = parsePage((await searchParams).page)
  const [plans, versions] = await Promise.all([
    safeListRows('price_plans', companyId, '*', 80),
    readVersionPage(companyId, page),
  ])
  const lastVersionPage = versions ? Math.ceil(versions.total / VERSION_PAGE_SIZE) : 0

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader title="Prisplaner" subtitle="Endast platform admin får skapa, ändra och publicera pris- och avtalslogik. Prisplaner är versionsstyrda så äldre kunder inte påverkas av nya ändringar." userEmail={admin.email} workspaceName={scope?.companyName} />
      <main className="space-y-6 p-8">
        <section className="rounded-3xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Prisplaner</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {plans.map((plan) => (
              <article key={String(plan.id)} className="rounded-2xl border p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{fmt(plan.name)}</h3>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(plan.status)}`}>{fmt(plan.status)}</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">{fmt(plan.pricing_model)}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="rounded-3xl border bg-white p-6 shadow-sm" aria-labelledby="price-plan-versions">
          <h2 id="price-plan-versions" className="text-lg font-semibold">Versioner</h2>
          {versions ? (
            <>
              <p className="mt-4 text-sm text-slate-700">{versions.total} versioner registrerade.</p>
              {versions.rows.length > 0 ? (
                <ul className="mt-3 divide-y text-sm">
                  {versions.rows.map((version) => (
                    <li key={version.id} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,2fr)_1fr_1fr]">
                      <span className="break-words font-medium">{version.price_plans?.name ?? 'Prisplan saknas'} · {version.version_label}</span>
                      <span>{formatStatusLabel(version.status, 'Status saknas', 'Okänd status')}</span>
                      <span className="text-slate-600">{formatAdminDate(version.valid_from, 'Startdatum saknas')} – {formatAdminDate(version.valid_to, 'tills vidare')}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {lastVersionPage > 1 ? (
                <nav aria-label="Sidor med prisplanversioner" className="mt-3 flex flex-wrap items-center gap-4 border-t pt-4 text-sm">
                  <span>Sida {versions.page} av {lastVersionPage}</span>
                  {versions.page > 1 ? <Link href={`?page=${versions.page - 1}`} prefetch={false} className="underline">Föregående sida</Link> : null}
                  {versions.page < lastVersionPage ? <Link href={`?page=${versions.page + 1}`} prefetch={false} className="underline">Nästa sida</Link> : null}
                </nav>
              ) : null}
            </>
          ) : (
            <p role="alert" className="mt-4 text-sm text-amber-950">Versionerna kunde inte läsas. Försök igen.</p>
          )}
        </section>
      </main>
    </div>
  )
}
