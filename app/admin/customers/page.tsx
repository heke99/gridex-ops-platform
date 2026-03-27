import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { createCustomerAction } from './actions'
import { getCustomers } from '@/lib/customers/getCustomers'

export const dynamic = 'force-dynamic'

type CustomersPageProps = {
  searchParams: Promise<{
    q?: string
  }>
}

function StatusBadge({ status }: { status: string | null }) {
  const styles: Record<string, string> = {
    active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    draft: 'border-amber-200 bg-amber-50 text-amber-700',
    pending_verification: 'border-blue-200 bg-blue-50 text-blue-700',
    inactive: 'border-slate-200 bg-slate-50 text-slate-700',
    moved: 'border-purple-200 bg-purple-50 text-purple-700',
    terminated: 'border-rose-200 bg-rose-50 text-rose-700',
    blocked: 'border-rose-200 bg-rose-50 text-rose-700',
  }

  const safeStatus = status ?? 'unknown'

  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
        styles[safeStatus] ?? 'border-slate-200 bg-slate-50 text-slate-700'
      }`}
    >
      {status ?? 'okänd'}
    </span>
  )
}

export default async function AdminCustomersPage({
  searchParams,
}: CustomersPageProps) {
  await requirePermissionServer('masterdata.read')

  const resolvedSearchParams = await searchParams
  const query = (resolvedSearchParams.q ?? '').trim()
  const customers = await getCustomers({ query })

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Kunder"
        subtitle="Grundregister för privat- och företagskunder."
        userEmail={user?.email ?? null}
      />

      <div className="grid gap-6 p-8 xl:grid-cols-[420px_1fr]">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Ny kund</h2>
          <p className="mt-1 text-sm text-slate-500">
            Skapa kundpost innan avtal, fullmakt och anläggning kopplas.
          </p>

          <form action={createCustomerAction} className="mt-6 space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Kundtyp
              </label>
              <select
                name="customerType"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3"
                defaultValue="private"
              >
                <option value="private">Privat</option>
                <option value="business">Företag</option>
              </select>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Förnamn
                </label>
                <input
                  name="firstName"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Efternamn
                </label>
                <input
                  name="lastName"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Företagsnamn
              </label>
              <input
                name="companyName"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Personnummer
                </label>
                <input
                  name="personalNumber"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Org.nr
                </label>
                <input
                  name="orgNumber"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                E-post
              </label>
              <input
                name="email"
                type="email"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Telefon
              </label>
              <input
                name="phone"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3"
              />
            </div>

            <button className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-black">
              Skapa kund
            </button>
          </form>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Kundregister</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Totalt {customers.length} kunder
                  {query ? ` för sökning "${query}"` : ''}.
                </p>
              </div>

              <form method="get" className="flex w-full gap-3 lg:max-w-xl">
                <input
                  name="q"
                  defaultValue={query}
                  placeholder="Sök på namn, företag, e-post eller telefon"
                  className="h-11 flex-1 rounded-2xl border border-slate-300 px-4 text-sm outline-none transition focus:border-slate-500"
                />
                <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black">
                  Sök
                </button>
                {query ? (
                  <Link
                    href="/admin/customers"
                    className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Rensa
                  </Link>
                ) : null}
              </form>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">
                    Kund
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">
                    Typ
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">
                    Status
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">
                    Kontakt
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">
                    Anläggningar
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">
                    Aktiva anl.
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">
                    Mätpunkter
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">
                    Aktiva mätpkt
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">
                    Åtgärd
                  </th>
                </tr>
              </thead>

              <tbody>
                {customers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-6 py-12 text-center text-sm text-slate-500"
                    >
                      Inga kunder matchade sökningen.
                    </td>
                  </tr>
                ) : (
                  customers.map((customer) => (
                    <tr
                      key={customer.id}
                      className="border-b border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium text-slate-900">
                            {customer.full_name ||
                              customer.company_name ||
                              'Namnlös kund'}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">{customer.id}</p>
                        </div>
                      </td>

                      <td className="px-6 py-4 text-slate-600">
                        {customer.customer_type === 'business'
                          ? 'Företag'
                          : 'Privat'}
                      </td>

                      <td className="px-6 py-4">
                        <StatusBadge status={customer.status} />
                      </td>

                      <td className="px-6 py-4 text-slate-600">
                        <div>{customer.email || '-'}</div>
                        <div className="text-xs text-slate-500">
                          {customer.phone || '-'}
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <span className="inline-flex min-w-10 justify-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                          {customer.site_count}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <span className="inline-flex min-w-10 justify-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                          {customer.active_site_count}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <span className="inline-flex min-w-10 justify-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                          {customer.metering_point_count}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <span className="inline-flex min-w-10 justify-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                          {customer.active_metering_point_count}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <Link
                          href={`/admin/customers/${customer.id}`}
                          className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Öppna kundkort
                        </Link>
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