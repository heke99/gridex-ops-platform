import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { listContractOffers } from '@/lib/customer-contracts/db'
import { saveContractOfferAction } from './actions'

export const dynamic = 'force-dynamic'

function formatNumber(value: number | null): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value)
}

function typeLabel(value: string): string {
  switch (value) {
    case 'fixed':
      return 'Fast'
    case 'variable_monthly':
      return 'Rörlig månad'
    case 'variable_hourly':
      return 'Rörlig tim'
    case 'portfolio':
      return 'Portfölj'
    default:
      return value
  }
}

function statusTone(status: string, isActive: boolean): string {
  if (!isActive) {
    return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }

  if (status === 'active') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300'
  }

  if (status === 'draft') {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300'
  }

  return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
}

export default async function AdminContractsPage() {
  await requireAdminPageAccess(['pricing.read'])

  const supabase = await createSupabaseServerClient()
  const [
    {
      data: { user },
    },
    offers,
  ] = await Promise.all([supabase.auth.getUser(), listContractOffers()])

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Avtalskatalog"
        subtitle="Adminstyrda elavtal och kampanjer som kan väljas i kundintaget eller overridas per kund."
        userEmail={user?.email ?? null}
      />

      <div className="grid gap-6 p-8 xl:grid-cols-[460px_minmax(0,1fr)]">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
            Skapa eller uppdatera avtalsmall
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Dessa värden används som standard i kundintaget men kan overridas per kund vid behov.
          </p>

          <form action={saveContractOfferAction} className="mt-6 space-y-4">
            <input type="hidden" name="id" />

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                Avtalsnamn
              </label>
              <input
                name="name"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                placeholder="t.ex. Rörlig Timkampanj SE3"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Slug
                </label>
                <input
                  name="slug"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  placeholder="auto om tom"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Status
                </label>
                <select
                  name="status"
                  defaultValue="draft"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Avtalstyp
                </label>
                <select
                  name="contract_type"
                  defaultValue="variable_hourly"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                >
                  <option value="fixed">Fast</option>
                  <option value="variable_monthly">Rörlig månad</option>
                  <option value="variable_hourly">Rörlig tim</option>
                  <option value="portfolio">Portfölj</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Kampanjnamn
                </label>
                <input
                  name="campaign_name"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                Beskrivning
              </label>
              <textarea
                name="description"
                rows={3}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <input
                name="fixed_price_ore_per_kwh"
                placeholder="Fast pris öre/kWh"
                className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              <input
                name="spot_markup_ore_per_kwh"
                placeholder="Fast påslag öre/kWh"
                className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              <input
                name="variable_fee_ore_per_kwh"
                placeholder="Rörlig avgift öre/kWh"
                className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              <input
                name="monthly_fee_sek"
                placeholder="Fast månadsavgift kr"
                className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <select
                name="green_fee_mode"
                defaultValue="none"
                className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              >
                <option value="none">Ingen grön el-avgift</option>
                <option value="sek_month">Grön el i kr/mån</option>
                <option value="ore_per_kwh">Grön el i öre/kWh</option>
              </select>

              <input
                name="green_fee_value"
                placeholder="Grön el-värde"
                className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />

              <label className="flex items-center gap-3 rounded-2xl border border-slate-300 px-4 py-3 text-sm dark:border-slate-700 dark:text-slate-200">
                <input type="checkbox" name="is_active" defaultChecked />
                Aktiv i kundintag
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <input
                name="default_binding_months"
                placeholder="Bindningstid månader"
                className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              <input
                name="default_notice_months"
                placeholder="Uppsägningstid månader"
                className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <input
                type="date"
                name="valid_from"
                className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              <input
                type="date"
                name="valid_to"
                className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                Övriga avgifter
              </label>
              <textarea
                name="optional_fee_lines"
                rows={4}
                placeholder={'Etablering | 395 | sek\nGrön kampanjjustering | 1.2 | ore_per_kwh'}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>

            <button className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
              Spara avtalsmall
            </button>
          </form>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
              Befintliga avtalsmallar
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Dessa används som valbara avtal i kundintaget.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-950/50">
                <tr>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                    Avtal
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                    Typ
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                    Prisstruktur
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                    Bind / uppsägning
                  </th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {offers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-6 py-10 text-center text-slate-500 dark:text-slate-400"
                    >
                      Inga avtalsmallar skapade ännu.
                    </td>
                  </tr>
                ) : (
                  offers.map((offer) => (
                    <tr
                      key={offer.id}
                      className="border-t border-slate-100 align-top dark:border-slate-800"
                    >
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-900 dark:text-white">
                          {offer.name}
                        </div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {offer.campaign_name || offer.slug}
                        </div>
                      </td>

                      <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                        {typeLabel(offer.contract_type)}
                      </td>

                      <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                        <div>Fast: {formatNumber(offer.fixed_price_ore_per_kwh)}</div>
                        <div>Påslag: {formatNumber(offer.spot_markup_ore_per_kwh)}</div>
                        <div>Rörlig: {formatNumber(offer.variable_fee_ore_per_kwh)}</div>
                        <div>Mån: {formatNumber(offer.monthly_fee_sek)}</div>
                      </td>

                      <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                        {offer.default_binding_months ?? '—'} / {offer.default_notice_months ?? '—'} mån
                      </td>

                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(
                            offer.status,
                            offer.is_active
                          )}`}
                        >
                          {offer.status}
                          {offer.is_active ? ' • aktiv' : ' • dold'}
                        </span>
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