import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { getContractOfferUsageCounts, listContractOffers } from '@/lib/customer-contracts/db'
import { saveContractOfferAction } from './actions'
import { resolveTenantScope } from '@/lib/tenant/scope'

export const dynamic = 'force-dynamic'

type AdminContractsPageProps = {
  searchParams: Promise<{ company?: string }>
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value)
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(new Date(value))
}

function typeLabel(value: string): string {
  switch (value) {
    case 'fixed':
      return 'Fast pris'
    case 'variable_monthly':
      return 'Rörligt månadspris'
    case 'variable_hourly':
      return 'Rörligt timpris'
    case 'portfolio':
      return 'Portföljförvaltning'
    default:
      return value
  }
}

function statusLabel(value: string): string {
  switch (value) {
    case 'active':
      return 'Aktiv'
    case 'inactive':
      return 'Inaktiv'
    case 'draft':
      return 'Utkast'
    default:
      return value
  }
}

function statusTone(status: string, isActive: boolean): string {
  if (!isActive || status === 'inactive') {
    return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }

  if (status === 'active') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300'
  }

  return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300'
}

function selectedCompanyLabel(
  companies: Array<{ id: string; name: string }>,
  companyId: string | null
): string {
  if (!companyId) return 'Alla företag'
  return companies.find((company) => company.id === companyId)?.name ?? 'Valt företag'
}

export default async function AdminContractsPage({ searchParams }: AdminContractsPageProps) {
  const admin = await requireAdminPageAccess(['pricing.read'])
  const resolvedSearchParams = await searchParams
  const scope = await resolveTenantScope({
    userId: admin.userId,
    roles: admin.roles,
    permissions: admin.permissions,
    requestedCompanyId: resolvedSearchParams.company ?? null,
    requireCompany: false,
  })
  const selectedCompanyId =
    scope.companyId ??
    (!scope.isPlatformAdmin
      ? scope.companyIds[0] ?? null
      : scope.companies.length === 1
        ? scope.companies[0]?.id ?? null
        : null)
  const companyOptions = scope.companies.map((company) => ({
    id: company.id,
    name: company.name,
  }))

  const supabase = await createSupabaseServerClient()
  const [
    {
      data: { user },
    },
    offers,
    usageCounts,
  ] = await Promise.all([
    supabase.auth.getUser(),
    selectedCompanyId || !scope.isPlatformAdmin
      ? listContractOffers({ companyId: selectedCompanyId })
      : Promise.resolve([]),
    selectedCompanyId || !scope.isPlatformAdmin
      ? getContractOfferUsageCounts({ companyId: selectedCompanyId })
      : Promise.resolve(new Map<string, number>()),
  ])

  const activeOffers = offers.filter((offer) => offer.status === 'active' && offer.is_active).length
  const inactiveOffers = offers.filter((offer) => offer.status === 'inactive' || !offer.is_active).length
  const draftOffers = offers.filter((offer) => offer.status === 'draft').length

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Avtal och kampanjer"
        subtitle="Hantera avtalsmallar, kampanjvillkor och prisstrukturer per företag utan att ändra historiska kundavtal retroaktivt."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/customers/intake"
              className="inline-flex items-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950"
            >
              Öppna kundintag
            </Link>
            <Link
              href="/admin/customers"
              className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Till kundregister
            </Link>
          </div>

          {scope.isPlatformAdmin ? (
            <form method="get" className="flex items-center gap-2">
              <select
                name="company"
                defaultValue={selectedCompanyId ?? ''}
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              >
                <option value="">Välj företag</option>
                {companyOptions.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
              <button className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                Visa
              </button>
            </form>
          ) : null}
        </div>

        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm text-slate-500 dark:text-slate-400">Företag</div>
            <div className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              {selectedCompanyLabel(companyOptions, selectedCompanyId)}
            </div>
          </div>
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm dark:border-emerald-900/50 dark:bg-emerald-950/10">
            <div className="text-sm text-slate-500 dark:text-slate-400">Aktiva avtalsmallar</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">{activeOffers}</div>
          </div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50/60 p-6 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/10">
            <div className="text-sm text-slate-500 dark:text-slate-400">Utkast</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">{draftOffers}</div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm text-slate-500 dark:text-slate-400">Inaktiva</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">{inactiveOffers}</div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[460px_minmax(0,1fr)]">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
              Skapa avtalsmall
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Värdena används som standard i kundintaget. När ett kundavtal skapas sparas en egen avtalsbild för kunden så historiken skyddas.
            </p>

            <form action={saveContractOfferAction} className="mt-6 space-y-4">
              <input type="hidden" name="id" />

              {scope.isPlatformAdmin ? (
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                    Företag
                  </label>
                  <select
                    name="companyId"
                    defaultValue={selectedCompanyId ?? ''}
                    required
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="">Välj företag</option>
                    {companyOptions.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <input type="hidden" name="companyId" value={selectedCompanyId ?? ''} />
              )}

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Avtalsnamn
                </label>
                <input
                  name="name"
                  required
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  placeholder="t.ex. Rörligt timpris SE3"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                    Intern nyckel
                  </label>
                  <input
                    name="slug"
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    placeholder="Skapas automatiskt om tom"
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
                    <option value="draft">Utkast</option>
                    <option value="active">Aktiv</option>
                    <option value="inactive">Inaktiv</option>
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
                    <option value="fixed">Fast pris</option>
                    <option value="variable_monthly">Rörligt månadspris</option>
                    <option value="variable_hourly">Rörligt timpris</option>
                    <option value="portfolio">Portföljförvaltning</option>
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
                <input name="fixed_price_ore_per_kwh" placeholder="Fast pris öre/kWh" className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                <input name="spot_markup_ore_per_kwh" placeholder="Påslag öre/kWh" className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                <input name="variable_fee_ore_per_kwh" placeholder="Rörlig avgift öre/kWh" className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                <input name="monthly_fee_sek" placeholder="Fast månadsavgift kr" className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <select name="green_fee_mode" defaultValue="none" className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                  <option value="none">Ingen grön el-avgift</option>
                  <option value="sek_month">Grön el i kr/mån</option>
                  <option value="ore_per_kwh">Grön el i öre/kWh</option>
                </select>
                <input name="green_fee_value" placeholder="Grön el-värde" className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                <label className="flex items-center gap-3 rounded-2xl border border-slate-300 px-4 py-3 text-sm dark:border-slate-700 dark:text-slate-200">
                  <input type="checkbox" name="is_active" defaultChecked />
                  Tillgänglig i kundintag
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <input name="default_binding_months" placeholder="Bindningstid månader" className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                <input name="default_notice_months" placeholder="Uppsägningstid månader" className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <input type="date" name="valid_from" className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                <input type="date" name="valid_to" className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Övriga avgifter
                </label>
                <textarea
                  name="optional_fee_lines"
                  rows={4}
                  placeholder={'Etablering | 395 | sek\nGrön tilläggsavgift | 1.2 | ore_per_kwh'}
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
                Varje mall tillhör ett företag. Kundavtal sparar egna prisvärden så ändringar här inte skriver över historiska villkor.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950/50">
                  <tr>
                    <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">Avtal</th>
                    <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">Typ</th>
                    <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">Prisstruktur</th>
                    <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">Period</th>
                    <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">Användning</th>
                    <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {offers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-slate-500 dark:text-slate-400">
                        {scope.isPlatformAdmin && !selectedCompanyId
                          ? 'Välj företag för att visa avtalsmallar.'
                          : 'Inga avtalsmallar är registrerade för valt företag.'}
                      </td>
                    </tr>
                  ) : (
                    offers.map((offer) => (
                      <tr key={offer.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                        <td className="px-6 py-4">
                          <div className="font-medium text-slate-900 dark:text-white">{offer.name}</div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{offer.campaign_name || offer.slug}</div>
                        </td>
                        <td className="px-6 py-4 text-slate-700 dark:text-slate-300">{typeLabel(offer.contract_type)}</td>
                        <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                          <div>Fast pris: {formatNumber(offer.fixed_price_ore_per_kwh)} öre/kWh</div>
                          <div>Påslag: {formatNumber(offer.spot_markup_ore_per_kwh)} öre/kWh</div>
                          <div>Rörlig avgift: {formatNumber(offer.variable_fee_ore_per_kwh)} öre/kWh</div>
                          <div>Månadsavgift: {formatNumber(offer.monthly_fee_sek)} kr</div>
                        </td>
                        <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                          <div>{formatDate(offer.valid_from)} – {formatDate(offer.valid_to)}</div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Bindning {offer.default_binding_months ?? '—'} mån · Uppsägning {offer.default_notice_months ?? '—'} mån
                          </div>
                        </td>
                        <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                          {usageCounts.get(offer.id) ?? 0} kundavtal
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(offer.status, offer.is_active)}`}>
                            {statusLabel(offer.status)} · {offer.is_active ? 'valbar' : 'ej valbar'}
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
    </div>
  )
}
