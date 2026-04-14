//app/admin/customers/intake/page.tsx
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import CustomerIntakeEnhancer from '@/components/admin/customers/CustomerIntakeEnhancer'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { listGridOwners, listPriceAreas } from '@/lib/masterdata/db'
import { listContractOffers } from '@/lib/customer-contracts/db'
import {
  bulkCreateCustomersAction,
  createCustomerAction,
} from '@/app/admin/customers/actions'

export const dynamic = 'force-dynamic'

const bulkExample = `customer_type;intake_flow_type;first_name;last_name;company_name;email;phone;personal_number;org_number;apartment_number;site_name;facility_id;meter_point_id;grid_owner_id;price_area_code;move_in_date;annual_consumption_kwh;street;postal_code;city;current_supplier_name;current_supplier_org_number;moved_from_street;moved_from_postal_code;moved_from_city;moved_from_supplier_name;contract_offer_id;contract_status;binding_months;notice_months
private;switch;Anna;Svensson;;anna@example.se;0700000000;199001011234;;1201;Anna Svensson - Lägenhet;735999111111111111;735999000000000001;REPLACE_GRID_OWNER_UUID;SE3;2026-06-01;12000;Storgatan 1;11122;Stockholm;Fortum;5560000000;;;;;REPLACE_CONTRACT_OFFER_UUID;pending_signature;12;1
association;move_in;Sara;Ek;Brf Solrosen;sara@solrosen.se;0701111111;;769600-1234;;Brf Solrosen Huvudanläggning;735999111111111112;735999000000000002;REPLACE_GRID_OWNER_UUID;SE3;2026-08-01;54000;Föreningsgatan 4;11123;Stockholm;E.ON;5561000000;Gamla vägen 9;11121;Stockholm;Vattenfall;REPLACE_CONTRACT_OFFER_UUID;pending_signature;12;3`

export default async function CustomerIntakePage() {
  await requireAdminPageAccess(['masterdata.read'])

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
    listContractOffers({ activeOnly: true }),
  ])

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Kundintag"
        subtitle="Skapa kund med anläggning, nätägare, mätpunkt och avtal. Stöd för både enstaka registrering och bulkimport."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/customers"
            className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Till kundlistan
          </Link>

          <Link
            href="/admin/contracts"
            className="inline-flex items-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950"
          >
            Hantera avtalskatalog
          </Link>
        </div>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
              Registrera kund
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Skapar kundpost, anläggning, eventuell mätpunkt och kundavtal i ett och samma flöde.
            </p>

            <form action={createCustomerAction} className="mt-6 space-y-6" data-customer-intake-form>
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  Kunddata
                </h3>

                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <select
                    name="customerType"
                    defaultValue="private"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="private">Privatkund</option>
                    <option value="business">Företagskund</option>
                    <option value="association">Förening</option>
                  </select>

                  <select
                    name="intakeFlowType"
                    defaultValue="switch"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="switch">Byte av leverantör</option>
                    <option value="move_in">Inflytt / flytt</option>
                    <option value="move_out_takeover">Övertag vid utflytt</option>
                  </select>

                  <input
                    name="apartmentNumber"
                    placeholder="Lägenhetsnummer"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    name="firstName"
                    placeholder="Förnamn / kontaktperson förnamn"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    name="lastName"
                    placeholder="Efternamn / kontaktperson efternamn"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    name="companyName"
                    placeholder="Företags- eller föreningsnamn"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white md:col-span-2"
                  />

                  <input
                    name="personalNumber"
                    placeholder="Personnummer"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    name="orgNumber"
                    placeholder="Organisationsnummer"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    name="email"
                    type="email"
                    placeholder="E-post"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    name="phone"
                    placeholder="Mobilnummer"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  Anläggning och flytt
                </h3>

                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <input
                    name="siteName"
                    placeholder="Anläggningsnamn / etikett"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    name="facilityId"
                    placeholder="Anläggnings-id"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    name="meterPointId"
                    placeholder="Mätpunkts-id"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    type="date"
                    name="moveInDate"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <select
                    name="gridOwnerId"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="">Välj nätägare</option>
                    {gridOwners.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.name}
                      </option>
                    ))}
                  </select>

                  <select
                    name="priceAreaCode"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="">Välj elområde</option>
                    {priceAreas.map((area) => (
                      <option key={area.code} value={area.code}>
                        {area.code} • {area.name}
                      </option>
                    ))}
                  </select>

                  <input
                    name="annualConsumptionKwh"
                    placeholder="Årsförbrukning kWh"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <select
                    name="siteType"
                    defaultValue="consumption"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="consumption">Förbrukning</option>
                    <option value="production">Produktion</option>
                    <option value="mixed">Mixed</option>
                  </select>

                  <input
                    name="street"
                    placeholder="Ny adress"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white md:col-span-2"
                  />

                  <input
                    name="postalCode"
                    placeholder="Postnummer"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    name="city"
                    placeholder="Stad"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    name="careOf"
                    placeholder="c/o"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white md:col-span-2"
                  />

                  <input
                    name="currentSupplierName"
                    placeholder="Nuvarande elleverantör"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    name="currentSupplierOrgNumber"
                    placeholder="Nuvarande leverantör org.nr"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    name="movedFromStreet"
                    placeholder="Flyttar från adress"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white md:col-span-2"
                  />

                  <input
                    name="movedFromPostalCode"
                    placeholder="Flyttar från postnummer"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    name="movedFromCity"
                    placeholder="Flyttar från stad"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    name="movedFromSupplierName"
                    placeholder="Flyttar från leverantör"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white md:col-span-2"
                  />
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  Avtal
                </h3>

                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <select
                    name="contractOfferId"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white md:col-span-2"
                  >
                    <option value="">Välj avtal från avtalskatalog</option>
                    {contractOffers.map((offer) => (
                      <option key={offer.id} value={offer.id}>
                        {offer.name} • {offer.contract_type}
                      </option>
                    ))}
                  </select>

                  <input
                    type="date"
                    name="contractStartDate"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <select
                    name="contractStatus"
                    defaultValue="pending_signature"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="draft">Draft</option>
                    <option value="pending_signature">Väntar signering</option>
                    <option value="signed">Signerat</option>
                    <option value="active">Aktivt</option>
                  </select>

                  <input
                    name="overrideReason"
                    placeholder="Override-orsak"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white md:col-span-2"
                  />

                  <select
                    name="contractTypeOverride"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="">Behåll katalogens avtalstyp</option>
                    <option value="fixed">Fast</option>
                    <option value="variable_monthly">Rörlig månad</option>
                    <option value="variable_hourly">Rörlig tim</option>
                    <option value="portfolio">Portfölj</option>
                  </select>

                  <select
                    name="greenFeeMode"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="">Behåll katalogens grön el-avgift</option>
                    <option value="none">Ingen</option>
                    <option value="sek_month">kr/mån</option>
                    <option value="ore_per_kwh">öre/kWh</option>
                  </select>

                  <input
                    name="fixedPriceOrePerKwh"
                    placeholder="Override fast pris öre/kWh"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    name="spotMarkupOrePerKwh"
                    placeholder="Override påslag öre/kWh"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    name="variableFeeOrePerKwh"
                    placeholder="Override rörlig avgift öre/kWh"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    name="monthlyFeeSek"
                    placeholder="Override månadsavgift kr"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    name="greenFeeValue"
                    placeholder="Override grön el-värde"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    name="bindingMonths"
                    placeholder="Bindningstid månader"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <input
                    name="noticeMonths"
                    placeholder="Uppsägningstid månader"
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />

                  <textarea
                    name="optionalFeeLines"
                    rows={4}
                    placeholder={'Extra avgifter\nEtablering | 395 | sek\nNattillägg | 1.2 | ore_per_kwh'}
                    className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white md:col-span-2"
                  />
                </div>
              </div>

              <CustomerIntakeEnhancer
                offers={contractOffers.map((offer) => ({
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
                }))}
              />

              <button className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
                Skapa kund med avtal
              </button>
            </form>
          </div>

          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Bulkimport
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Klistra in semikolon- eller tab-separerad data. Ett kundkort skapas per rad.
              </p>

              <form action={bulkCreateCustomersAction} className="mt-4 space-y-4">
                <textarea
                  name="bulkPayload"
                  rows={18}
                  defaultValue={bulkExample}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />

                <button className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  Kör bulkimport
                </button>
              </form>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Vad detta flöde täcker
              </h2>
              <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <p>Skapar kundnummer i databasen och gör kunden sökbar i kundlistan.</p>
                <p>Registrerar nätägare, elområde, flyttar-från-data och anläggningsinfo.</p>
                <p>Knyter valbart avtal från admin-katalogen med möjlighet till override.</p>
                <p>Loggar första avtalshändelsen i kundens avtalshistorik.</p>
                <p>Kan skapa rätt switchtyp direkt från intake: leverantörsbyte, inflytt eller övertag.</p>
                <p>Stödjer nu privat, företag och förening i samma intake-flöde.</p>
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  )
}