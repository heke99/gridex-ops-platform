import Link from 'next/link'
import AdminHeader from '@/components/admin/adminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { getCustomers } from '@/lib/customers/getCustomers'
import { createCustomerAction } from './actions'

export const dynamic = 'force-dynamic'

export default async function AdminCustomersPage() {
  await requirePermissionServer('masterdata.read')
  const customers = await getCustomers()

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
            <h2 className="text-lg font-semibold text-slate-950">Kundregister</h2>
            <p className="mt-1 text-sm text-slate-500">
              Totalt {customers.length} kunder.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">Namn</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">Typ</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">Status</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">Kontakt</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">Åtgärd</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-slate-900">
                          {customer.full_name || customer.company_name || 'Namnlös kund'}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{customer.id}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{customer.customer_type}</td>
                    <td className="px-6 py-4">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                        {customer.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      <div>{customer.email || '-'}</div>
                      <div className="text-xs text-slate-500">{customer.phone || '-'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        href={`/admin/customers/${customer.id}`}
                        className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Öppna
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}