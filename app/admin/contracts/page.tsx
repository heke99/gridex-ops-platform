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
  if (!value) return 'Ej begränsad'
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

function statusLabel(value: string, isActive: boolean): string {
  if (!isActive) return 'Ej valbar i kundintag'

  switch (value) {
    case 'active':
      return 'Aktiv och valbar'
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
    return 'border-slate-200 bg-slate-50 text-slate-700'
  }

  if (status === 'active') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }

  return 'border-amber-200 bg-amber-50 text-amber-700'
}

function selectedCompanyLabel(
  companies: Array<{ id: string; name: string }>,
  companyId: string | null
): string {
  if (!companyId) return 'Inget företag valt'
  return companies.find((company) => company.id === companyId)?.name ?? 'Valt företag'
}

function inputClassName() {
  return 'w-full rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'
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
  const selectedCompanyId = scope.companyId
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
    selectedCompanyId
      ? listContractOffers({ companyId: selectedCompanyId })
      : Promise.resolve([]),
    selectedCompanyId
      ? getContractOfferUsageCounts({ companyId: selectedCompanyId })
      : Promise.resolve(new Map<string, number>()),
  ])

  const activeOffers = offers.filter((offer) => offer.status === 'active' && offer.is_active).length
  const inactiveOffers = offers.filter((offer) => offer.status === 'inactive' || !offer.is_active).length
  const draftOffers = offers.filter((offer) => offer.status === 'draft').length

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/80 via-white to-slate-50">
      <AdminHeader
        title="Avtal och kampanjer"
        subtitle="Skapa prisplaner och kampanjer per elhandelsbolag. Kundavtal sparar egna prisvärden så historiska villkor inte skrivs över."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 px-6 py-8 lg:px-8">
        <div className="flex flex-col gap-4 rounded-[2rem] border border-emerald-100 bg-white/85 p-5 shadow-sm shadow-emerald-950/5 backdrop-blur lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-950">Avtal, prisplaner och kampanjer</p>
            <p className="mt-1 text-sm text-slate-500">
              Avtalsmallar tillhör ett specifikt företag. Nya företag hanteras separat under Företag.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/customers/intake"
              className="inline-flex items-center rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"
            >
              Öppna kundintag
            </Link>
            <Link
              href="/admin/customers"
              className="inline-flex items-center rounded-2xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
            >
              Kundregister
            </Link>
          </div>
        </div>

        {scope.isPlatformAdmin ? (
          <section className="rounded-[2rem] border border-emerald-100 bg-white p-6 shadow-sm shadow-emerald-950/5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                  Operativ bolagskoppling
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
                  Prisplanerna sparas i ditt aktiva elhandelsbolag
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Listan visar bara elhandelsbolag där ditt konto har aktiv bolagskoppling. Plattformens företag hanteras separat under Företag.
                </p>
              </div>

              <form method="get" className="flex flex-col gap-2 sm:min-w-[320px]">
                <label className="text-sm font-medium text-slate-700" htmlFor="company">
                  Ditt elhandelsbolag
                </label>
                <div className="flex gap-2">
                  <select
                    id="company"
                    name="company"
                    defaultValue={selectedCompanyId ?? ''}
                    className="h-11 flex-1 rounded-2xl border border-emerald-200 bg-white px-4 text-sm text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  >
                    <option value="">Välj ditt bolag</option>
                    {companyOptions.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                  <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800">
                    Visa
                  </button>
                </div>
              </form>
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-[2rem] border border-emerald-100 bg-white p-6 shadow-sm shadow-emerald-950/5">
            <div className="text-sm text-slate-500">Företag</div>
            <div className="mt-2 text-xl font-semibold text-slate-950">
              {selectedCompanyLabel(companyOptions, selectedCompanyId)}
            </div>
          </div>
          <div className="rounded-[2rem] border border-emerald-200 bg-emerald-50/70 p-6 shadow-sm shadow-emerald-950/5">
            <div className="text-sm text-slate-600">Aktiva och valbara</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{activeOffers}</div>
          </div>
          <div className="rounded-[2rem] border border-amber-200 bg-amber-50/70 p-6 shadow-sm shadow-amber-950/5">
            <div className="text-sm text-slate-600">Utkast</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{draftOffers}</div>
          </div>
          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm shadow-slate-950/5">
            <div className="text-sm text-slate-500">Inaktiva</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{inactiveOffers}</div>
          </div>
        </section>

        {!selectedCompanyId ? (
          <section className="rounded-[2rem] border border-amber-200 bg-amber-50 p-8 text-center text-amber-900 shadow-sm">
            <h2 className="text-xl font-semibold">Välj ett elhandelsbolag</h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6">
              Avtalsmallar och kampanjer skapas i ett aktivt elhandelsbolag. Lägg till dig själv som användare i rätt bolag innan du skapar prisplaner.
            </p>
            <Link
              href="/admin/companies"
              className="mt-5 inline-flex rounded-2xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
            >
              Hantera företag
            </Link>
          </section>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[440px_minmax(0,1fr)]">
            <section className="overflow-hidden rounded-[2rem] border border-emerald-100 bg-white shadow-sm shadow-emerald-950/5">
              <div className="border-b border-emerald-100 bg-gradient-to-r from-emerald-50/80 to-white p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                  Ny avtalsmall
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
                  Skapa prisplan eller kampanj
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Värdena används som standard i kundintaget. När kunden får avtal sparas en separat avtalsbild på kunden.
                </p>
              </div>

              <form action={saveContractOfferAction} className="space-y-5 p-6">
                <input type="hidden" name="id" />
                <input type="hidden" name="companyId" value={selectedCompanyId} />

                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Avtalsnamn</span>
                  <input
                    name="name"
                    required
                    className={inputClassName()}
                    placeholder="Exempel: Rörligt timpris SE3"
                  />
                </label>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium text-slate-700">Intern nyckel</span>
                    <input name="slug" className={inputClassName()} placeholder="Skapas automatiskt om tom" />
                  </label>
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium text-slate-700">Status</span>
                    <select name="status" defaultValue="draft" className={inputClassName()}>
                      <option value="draft">Utkast</option>
                      <option value="active">Aktiv</option>
                      <option value="inactive">Inaktiv</option>
                    </select>
                  </label>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium text-slate-700">Avtalstyp</span>
                    <select name="contract_type" defaultValue="variable_hourly" className={inputClassName()}>
                      <option value="fixed">Fast pris</option>
                      <option value="variable_monthly">Rörligt månadspris</option>
                      <option value="variable_hourly">Rörligt timpris</option>
                      <option value="portfolio">Portföljförvaltning</option>
                    </select>
                  </label>
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium text-slate-700">Kampanjnamn</span>
                    <input name="campaign_name" className={inputClassName()} placeholder="Valfritt" />
                  </label>
                </div>

                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Beskrivning</span>
                  <textarea name="description" rows={3} className={inputClassName()} />
                </label>

                <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
                  <p className="text-sm font-semibold text-slate-900">Prisstruktur</p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <input name="fixed_price_ore_per_kwh" placeholder="Fast pris öre/kWh" className={inputClassName()} />
                    <input name="spot_markup_ore_per_kwh" placeholder="Påslag öre/kWh" className={inputClassName()} />
                    <input name="variable_fee_ore_per_kwh" placeholder="Rörlig avgift öre/kWh" className={inputClassName()} />
                    <input name="monthly_fee_sek" placeholder="Fast månadsavgift kr" className={inputClassName()} />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <select name="green_fee_mode" defaultValue="none" className={inputClassName()}>
                    <option value="none">Ingen grön el-avgift</option>
                    <option value="sek_month">Grön el i kr/mån</option>
                    <option value="ore_per_kwh">Grön el i öre/kWh</option>
                  </select>
                  <input name="green_fee_value" placeholder="Grön el-värde" className={inputClassName()} />
                  <label className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-slate-700">
                    <input type="checkbox" name="is_active" defaultChecked />
                    Valbar i kundintag
                  </label>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <input name="default_binding_months" placeholder="Bindningstid månader" className={inputClassName()} />
                  <input name="default_notice_months" placeholder="Uppsägningstid månader" className={inputClassName()} />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium text-slate-700">Gäller från</span>
                    <input type="date" name="valid_from" className={inputClassName()} />
                  </label>
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium text-slate-700">Gäller till</span>
                    <input type="date" name="valid_to" className={inputClassName()} />
                  </label>
                </div>

                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Övriga avgifter</span>
                  <textarea
                    name="optional_fee_lines"
                    rows={4}
                    placeholder={'Etablering | 395 | sek\nGrön tilläggsavgift | 1.2 | ore_per_kwh'}
                    className="w-full rounded-2xl border border-emerald-200 bg-white px-4 py-3 font-mono text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  />
                </label>

                <button className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800">
                  Spara avtalsmall
                </button>
              </form>
            </section>

            <section className="overflow-hidden rounded-[2rem] border border-emerald-100 bg-white shadow-sm shadow-emerald-950/5">
              <div className="border-b border-emerald-100 bg-gradient-to-r from-emerald-50/80 to-white px-6 py-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                  Befintliga villkor
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
                  Avtalsmallar för {selectedCompanyLabel(companyOptions, selectedCompanyId)}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Mallarna styr nya kundavtal. Kundens sparade avtalsbild ändras inte retroaktivt när en mall uppdateras.
                </p>
              </div>

              <div className="grid gap-4 p-6">
                {offers.length === 0 ? (
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-600">
                    Inga avtalsmallar är registrerade för valt företag.
                  </div>
                ) : (
                  offers.map((offer) => (
                    <article key={offer.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold text-slate-950">{offer.name}</h3>
                            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(offer.status, offer.is_active)}`}>
                              {statusLabel(offer.status, offer.is_active)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-slate-500">
                            {offer.campaign_name || offer.slug || 'Ingen kampanjnyckel angiven'}
                          </p>
                        </div>

                        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-sm font-semibold text-emerald-800">
                          {usageCounts.get(offer.id) ?? 0} kundavtal
                        </div>
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Typ</p>
                          <p className="mt-1 font-semibold text-slate-900">{typeLabel(offer.contract_type)}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Pris</p>
                          <p className="mt-1 text-sm text-slate-700">Fast: {formatNumber(offer.fixed_price_ore_per_kwh)} öre/kWh</p>
                          <p className="text-sm text-slate-700">Påslag: {formatNumber(offer.spot_markup_ore_per_kwh)} öre/kWh</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Avgifter</p>
                          <p className="mt-1 text-sm text-slate-700">Rörlig: {formatNumber(offer.variable_fee_ore_per_kwh)} öre/kWh</p>
                          <p className="text-sm text-slate-700">Månadsavgift: {formatNumber(offer.monthly_fee_sek)} kr</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Period</p>
                          <p className="mt-1 text-sm text-slate-700">Från: {formatDate(offer.valid_from)}</p>
                          <p className="text-sm text-slate-700">Till: {formatDate(offer.valid_to)}</p>
                        </div>
                      </div>

                      <p className="mt-4 text-xs leading-5 text-slate-500">
                        Bindning {offer.default_binding_months ?? '—'} mån · Uppsägning {offer.default_notice_months ?? '—'} mån
                      </p>
                    </article>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
