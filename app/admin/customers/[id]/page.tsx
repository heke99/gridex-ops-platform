import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'
import {
  listCustomerSitesByCustomerId,
  listGridOwners,
  listMeteringPointsBySiteIds,
  listPriceAreas,
} from '@/lib/masterdata/db'
import CustomerSiteForm from '@/components/admin/masterdata/CustomerSiteForm'
import CustomerSitesTable from '@/components/admin/masterdata/CustomerSitesTable'
import MeteringPointForm from '@/components/admin/masterdata/MeteringPointForm'
import MeteringPointsTable from '@/components/admin/masterdata/MeteringPointsTable'

export const dynamic = 'force-dynamic'

type CustomerProfileRow = {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  company_name: string | null
}

type CustomerPageProps = {
  params: Promise<{ id: string }>
}

async function getCustomerProfile(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  id: string
): Promise<CustomerProfileRow | null> {
  const candidates = ['user_profiles', 'customer_profiles']

  for (const tableName of candidates) {
    const { data, error } = await supabase
      .from(tableName)
      .select('id, email, first_name, last_name, phone, company_name')
      .eq('id', id)
      .maybeSingle()

    if (!error && data) {
      return data as CustomerProfileRow
    }
  }

  return null
}

function formatCustomerName(customer: CustomerProfileRow): string {
  const fullName = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()

  if (fullName) return fullName
  if (customer.company_name) return customer.company_name
  return 'Kund'
}

export default async function CustomerAdminDetailPage({
  params,
}: CustomerPageProps) {
  await requireAdminPageAccess([MASTERDATA_PERMISSIONS.READ])

  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const [customer, gridOwners, priceAreas, sites] = await Promise.all([
    getCustomerProfile(supabase, id),
    listGridOwners(supabase),
    listPriceAreas(supabase),
    listCustomerSitesByCustomerId(supabase, id),
  ])

  if (!customer) {
    notFound()
  }

  const meteringPoints = await listMeteringPointsBySiteIds(
    supabase,
    sites.map((site) => site.id)
  )

  const customerName = formatCustomerName(customer)

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Kundkort v2
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
              {customerName}
            </h1>
            <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-600 dark:text-slate-400">
              <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
                {customer.email ?? 'Ingen e-post'}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
                {customer.phone ?? 'Ingen telefon'}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
                Kund-ID: {customer.id}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
              <div className="text-slate-500 dark:text-slate-400">Anläggningar</div>
              <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
                {sites.length}
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
              <div className="text-slate-500 dark:text-slate-400">Mätpunkter</div>
              <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
                {meteringPoints.length}
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
              <div className="text-slate-500 dark:text-slate-400">Nätägare</div>
              <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
                {gridOwners.length}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[460px_minmax(0,1fr)]">
        <CustomerSiteForm
          customerId={id}
          gridOwners={gridOwners}
          priceAreas={priceAreas}
        />
        <CustomerSitesTable
          sites={sites}
          gridOwners={gridOwners}
          meteringPoints={meteringPoints}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[460px_minmax(0,1fr)]">
        <MeteringPointForm
          customerId={id}
          sites={sites}
          gridOwners={gridOwners}
          priceAreas={priceAreas}
        />
        <MeteringPointsTable
          meteringPoints={meteringPoints}
          sites={sites}
          gridOwners={gridOwners}
        />
      </section>
    </div>
  )
}