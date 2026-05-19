import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import CustomerIntakeForm from '@/components/admin/customers/CustomerIntakeForm'
import CustomerBulkImportPanel from '@/components/admin/customers/CustomerBulkImportPanel'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { listGridOwners, listPriceAreas } from '@/lib/masterdata/db'
import { listContractOffers } from '@/lib/customer-contracts/db'
import { resolveTenantScope } from '@/lib/tenant/scope'

export const dynamic = 'force-dynamic'

const bulkExample = `customer_type;intake_flow_type;first_name;last_name;contact_title;company_name;email;phone;personal_number;org_number;apartment_number;site_name;facility_id;meter_point_id;grid_owner_id;price_area_code;move_in_date;annual_consumption_kwh;street;postal_code;city;care_of;country;current_supplier_name;current_supplier_org_number;moved_from_street;moved_from_postal_code;moved_from_city;moved_from_supplier_name;contract_offer_id;contract_status;binding_months;notice_months
private;switch;Anna;Svensson;;;anna@example.se;0700000000;199001011234;;1201;Anna Svensson - Lägenhet;735999111111111111;735999000000000001;REPLACE_GRID_OWNER_UUID;SE3;2026-06-01;12000;Storgatan 1;11122;Stockholm;;SE;Fortum;5560000000;;;;;REPLACE_CONTRACT_OFFER_UUID;pending_signature;12;1
association;move_in;Sara;Ek;Ordförande;Brf Solrosen;sara@solrosen.se;0701111111;;769600-1234;;Brf Solrosen Huvudanläggning;735999111111111112;735999000000000002;REPLACE_GRID_OWNER_UUID;SE3;2026-08-01;54000;Föreningsgatan 4;11123;Stockholm;c/o Styrelsen;SE;E.ON;5561000000;Gamla vägen 9;11121;Stockholm;Vattenfall;REPLACE_CONTRACT_OFFER_UUID;pending_signature;12;3`

type CustomerIntakePageProps = {
  searchParams: Promise<{ company?: string }>
}

export default async function CustomerIntakePage({
  searchParams,
}: CustomerIntakePageProps) {
  const admin = await requireAdminPageAccess({ anyOf: ['customers.write', 'masterdata.read'] })
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
    gridOwners,
    priceAreas,
    contractOffers,
  ] = await Promise.all([
    supabase.auth.getUser(),
    listGridOwners(supabase),
    listPriceAreas(supabase),
    selectedCompanyId
      ? listContractOffers({ activeOnly: true, companyId: selectedCompanyId })
      : Promise.resolve([]),
  ])

  const serializedOffers = contractOffers.map((offer) => ({
    id: offer.id,
    name: offer.name,
    contract_type: offer.contract_type,
    fixed_price_ore_per_kwh: offer.fixed_price_ore_per_kwh,
    spot_markup_ore_per_kwh: offer.spot_markup_ore_per_kwh,
    variable_fee_ore_per_kwh: offer.variable_fee_ore_per_kwh,
    monthly_fee_sek: offer.monthly_fee_sek,
    green_fee_mode: offer.green_fee_mode,
    green_fee_value: offer.green_fee_value,
    default_binding_months: offer.default_binding_months,
    default_notice_months: offer.default_notice_months,
    optional_fee_lines: offer.optional_fee_lines,
  }))

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/80 via-white to-slate-50">
      <AdminHeader
        title="Kundintag"
        subtitle="Skapa kund, anläggning, mätpunkt och avtal i ett kontrollerat flöde med validering, dubblettskydd och bolagstillhörighet."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 px-6 py-8 lg:px-8">
        <div className="flex flex-col gap-4 rounded-[2rem] border border-emerald-100 bg-white/85 p-5 shadow-sm shadow-emerald-950/5 backdrop-blur lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-950">Kundintag för elhandelsbolag</p>
            <p className="mt-1 text-sm text-slate-500">
              Här skapas kunder under ett befintligt företag. Nya företag och bolagsadministratörer hanteras separat under Företag.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/customers"
              className="inline-flex items-center rounded-2xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
            >
              Till kundregister
            </Link>

            <Link
              href="/admin/contracts"
              className="inline-flex items-center rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"
            >
              Avtal och kampanjer
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
                  Kunden sparas i ditt aktiva elhandelsbolag
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Listan visar bara elhandelsbolag där ditt konto har aktiv bolagskoppling. Kundintag ska inte användas för att registrera kunder i andra bolag.
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

            {!selectedCompanyId ? (
              <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Välj ett av de elhandelsbolag där ditt konto är aktivt kopplat innan du registrerar kund eller importerar kundunderlag.
              </div>
            ) : null}
          </section>
        ) : null}

        {selectedCompanyId ? (
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <CustomerIntakeForm
            gridOwners={gridOwners.map((owner) => ({ id: owner.id, name: owner.name }))}
            priceAreas={priceAreas.map((area) => ({ code: area.code, name: area.name }))}
            contractOffers={serializedOffers}
            companies={companyOptions}
            selectedCompanyId={selectedCompanyId}
            isPlatformAdmin={false}
          />

          <div className="space-y-6">
            <CustomerBulkImportPanel
              bulkExample={bulkExample}
              companies={companyOptions}
              selectedCompanyId={selectedCompanyId}
              isPlatformAdmin={false}
            />

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Kontroller innan sparande
              </h2>
              <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <p>Alla nya kunder kopplas till valt företag innan kund, kontakt, anläggning, mätpunkt, avtal och switchärende sparas.</p>
                <p>Importen visar förhandsgranskning, saknade fält och möjliga dubbletter innan data förs in i kundregistret.</p>
                <p>Om ett senare steg inte kan slutföras rensas den aktuella raden tillbaka i omvänd ordning så kundregistret inte lämnas halvfärdigt.</p>
                <p>Avtalsförslag hämtas per företag för att undvika att villkor från ett bolag används på ett annat bolags kund.</p>
              </div>
            </section>
          </div>
        </section>
        ) : (
          <section className="rounded-[2rem] border border-slate-200 bg-white p-8 text-center shadow-sm">
            <h2 className="text-xl font-semibold text-slate-950">Inget operativt företag valt</h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Kundintag kräver en aktiv bolagskoppling. Lägg till dig själv som användare i rätt elhandelsbolag under Företag innan du skapar kunddata.
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <Link
                href="/admin/companies"
                className="inline-flex items-center rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
              >
                Hantera företag
              </Link>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
