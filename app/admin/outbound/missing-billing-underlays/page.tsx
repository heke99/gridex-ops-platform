import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { bulkQueueMissingBillingUnderlaysAction } from '@/app/admin/cis/actions'
import { listMeteringPointsBySiteIds } from '@/lib/masterdata/db'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{
    period?: string
  }>
}

function defaultPeriod(): string {
  const now = new Date()
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`
}

function normalizePeriod(value: string | undefined): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return defaultPeriod()

  const match = /^(\d{4})-(\d{2})$/.exec(trimmed)
  if (!match) return defaultPeriod()

  const year = Number(match[1])
  const month = Number(match[2])

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return defaultPeriod()
  }

  if (month < 1 || month > 12) {
    return defaultPeriod()
  }

  return `${year}-${String(month).padStart(2, '0')}`
}

async function queueMissingBillingUnderlaysFormAction(
  formData: FormData
): Promise<void> {
  'use server'
  await bulkQueueMissingBillingUnderlaysAction(formData)
}

export default async function MissingBillingUnderlaysPage({
  searchParams,
}: PageProps) {
  await requirePermissionServer('billing_underlay.read')

  const params = await searchParams
  const selectedPeriod = normalizePeriod(params.period)
  const [yearText, monthText] = selectedPeriod.split('-')
  const year = Number(yearText)
  const month = Number(monthText)

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: sites, error: sitesError } = await supabase
    .from('customer_sites')
    .select('*')
    .order('created_at', { ascending: false })

  if (sitesError) throw sitesError

  const safeSites = ((sites ?? []) as { id: string }[]).filter(
    (site): site is { id: string } => Boolean(site?.id)
  )

  const meteringPoints = await listMeteringPointsBySiteIds(
    supabase,
    safeSites.map((site) => site.id)
  )

  const { data: underlays, error: underlaysError } = await supabase
    .from('billing_underlays')
    .select('metering_point_id')
    .eq('underlay_year', year)
    .eq('underlay_month', month)

  if (underlaysError) throw underlaysError

  const existingPointIds = new Set(
    ((underlays ?? []) as Array<{ metering_point_id: string | null }>)
      .map((row) => row.metering_point_id)
      .filter((value): value is string => Boolean(value))
  )

  const missingPoints = meteringPoints.filter(
    (point) => !existingPointIds.has(point.id)
  )

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Bulk: saknade billing-underlag"
        subtitle="Identifiera mätpunkter som saknar billing-underlag för vald månad och köa outbound utan dubbletter."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <form className="grid gap-4 xl:grid-cols-[260px_auto]">
            <input
              type="month"
              name="period"
              defaultValue={selectedPeriod}
              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
            <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">
              Visa period
            </button>
          </form>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-950">
              <div className="text-sm text-slate-500 dark:text-slate-400">
                Totala mätpunkter
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {meteringPoints.length}
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 px-4 py-4 dark:bg-slate-950">
              <div className="text-sm text-slate-500 dark:text-slate-400">
                Har underlag i perioden
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {meteringPoints.length - missingPoints.length}
              </div>
            </div>

            <div className="rounded-2xl bg-amber-50 px-4 py-4 dark:bg-amber-950/20">
              <div className="text-sm text-amber-700 dark:text-amber-300">
                Saknar underlag
              </div>
              <div className="mt-2 text-2xl font-semibold text-amber-900 dark:text-amber-200">
                {missingPoints.length}
              </div>
            </div>
          </div>

          <form action={queueMissingBillingUnderlaysFormAction} className="mt-6">
            <input type="hidden" name="period_month" value={selectedPeriod} />
            <button className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">
              Köa saknade billing-underlag för {selectedPeriod}
            </button>
          </form>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
              Förhandsvisning
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Mätpunkter som saknar billing-underlag för vald månad.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-950/50">
                <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                  <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                    Mätpunkt
                  </th>
                  <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                    Site
                  </th>
                  <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                    Nätägare
                  </th>
                  <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {missingPoints.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
                    >
                      Alla mätpunkter har billing-underlag för vald period.
                    </td>
                  </tr>
                ) : (
                  missingPoints.map((point) => (
                    <tr
                      key={point.id}
                      className="border-b border-slate-100 dark:border-slate-800"
                    >
                      <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                        {point.meter_point_id}
                      </td>
                      <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                        {point.site_id}
                      </td>
                      <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                        {point.grid_owner_id ?? '—'}
                      </td>
                      <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                        {point.status}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}