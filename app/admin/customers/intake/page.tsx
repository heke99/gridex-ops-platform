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

const bulkExample = `customer_type;intake_flow_type;first_name;last_name;contact_title;company_name;email;phone;personal_number;org_number;apartment_number;site_name;facility_id;meter_point_id;grid_owner_id;price_area_code;move_in_date;annual_consumption_kwh;street;postal_code;city;current_supplier_name;current_supplier_org_number;moved_from_street;moved_from_postal_code;moved_from_city;moved_from_supplier_name;contract_offer_id;contract_status;binding_months;notice_months
private;switch;Anna;Svensson;;;anna@example.se;0700000000;199001011234;;1201;Anna Svensson - Lägenhet;735999111111111111;735999000000000001;REPLACE_GRID_OWNER_UUID;SE3;2026-06-01;12000;Storgatan 1;11122;Stockholm;Fortum;5560000000;;;;;REPLACE_CONTRACT_OFFER_UUID;pending_signature;12;1
association;move_in;Sara;Ek;Ordförande;Brf Solrosen;sara@solrosen.se;0701111111;;769600-1234;;Brf Solrosen Huvudanläggning;735999111111111112;735999000000000002;REPLACE_GRID_OWNER_UUID;SE3;2026-08-01;54000;Föreningsgatan 4;11123;Stockholm;E.ON;5561000000;Gamla vägen 9;11121;Stockholm;Vattenfall;REPLACE_CONTRACT_OFFER_UUID;pending_signature;12;3`

function inputClassName(span?: 'full') {
  return `rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white${
    span === 'full' ? ' md:col-span-2' : ''
  }`
}

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
        subtitle="Skapa kund med anläggning, nätägare, mätpunkt och avtal. Flödet växlar nu dynamiskt mellan privat, företag, förening och rätt flyttyp."
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
              Skapar kundpost, kontaktperson, anläggning, eventuell mätpunkt och kundavtal i ett och samma flöde.
            </p>

            <form action={createCustomerAction} className="mt-6 space-y-6" data-customer-intake-form>
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  Kunddata
                </h3>

                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">Kundtyp</span>
                    <select
                      name="customerType"
                      defaultValue="private"
                      className={inputClassName()}
                    >
                      <option value="private">Privatkund</option>
                      <option value="business">Företagskund</option>
                      <option value="association">Förening</option>
                    </select>
                  </label>

                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">Flöde</span>
                    <select
                      name="intakeFlowType"
                      defaultValue="switch"
                      className={inputClassName()}
                    >
                      <option value="switch">Byte av leverantör</option>
                      <option value="move_in">Inflytt / flytt</option>
                      <option value="move_out_takeover">Övertag vid utflytt</option>
                    </select>
                  </label>

                  <label className="grid gap-1 text-sm" data-customer-section="private">
                    <span className="text-slate-600 dark:text-slate-300">Lägenhetsnummer</span>
                    <input
                      name="apartmentNumber"
                      placeholder="Lägenhetsnummer"
                      className={inputClassName()}
                    />
                  </label>

                  <label className="grid gap-1 text-sm" data-customer-section="private business association">
                    <span
                      className="text-slate-600 dark:text-slate-300"
                      data-label-for-customer
                      data-label-private="Förnamn"
                      data-label-business="Kontaktperson förnamn"
                      data-label-association="Kontaktperson förnamn"
                    >
                      Förnamn
                    </span>
                    <input
                      name="firstName"
                      placeholder="Förnamn"
                      className={inputClassName()}
                      data-required-customer="private business association"
                    />
                  </label>

                  <label className="grid gap-1 text-sm" data-customer-section="private business association">
                    <span
                      className="text-slate-600 dark:text-slate-300"
                      data-label-for-customer
                      data-label-private="Efternamn"
                      data-label-business="Kontaktperson efternamn"
                      data-label-association="Kontaktperson efternamn"
                    >
                      Efternamn
                    </span>
                    <input
                      name="lastName"
                      placeholder="Efternamn"
                      className={inputClassName()}
                      data-required-customer="private business association"
                    />
                  </label>

                  <label className="grid gap-1 text-sm" data-customer-section="business association">
                    <span className="text-slate-600 dark:text-slate-300">Kontaktperson titel</span>
                    <input
                      name="contactTitle"
                      placeholder="Ex. VD, administratör, ordförande"
                      className={inputClassName()}
                    />
                  </label>

                  <label className="grid gap-1 text-sm md:col-span-2" data-customer-section="business association">
                    <span
                      className="text-slate-600 dark:text-slate-300"
                      data-label-for-customer
                      data-label-business="Företagsnamn"
                      data-label-association="Föreningsnamn"
                    >
                      Företags- / föreningsnamn
                    </span>
                    <input
                      name="companyName"
                      placeholder="Företags- eller föreningsnamn"
                      className={inputClassName('full')}
                      data-required-customer="business association"
                    />
                  </label>

                  <label className="grid gap-1 text-sm" data-customer-section="private">
                    <span className="text-slate-600 dark:text-slate-300">Personnummer</span>
                    <input
                      name="personalNumber"
                      placeholder="Personnummer"
                      className={inputClassName()}
                    />
                  </label>

                  <label className="grid gap-1 text-sm" data-customer-section="business association">
                    <span className="text-slate-600 dark:text-slate-300">Organisationsnummer</span>
                    <input
                      name="orgNumber"
                      placeholder="Organisationsnummer"
                      className={inputClassName()}
                      data-required-customer="business association"
                    />
                  </label>

                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">E-post</span>
                    <input
                      name="email"
                      type="email"
                      placeholder="E-post"
                      className={inputClassName()}
                    />
                  </label>

                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">Mobilnummer</span>
                    <input
                      name="phone"
                      placeholder="Mobilnummer"
                      className={inputClassName()}
                    />
                  </label>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  Anläggning och flytt
                </h3>

                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">Anläggningsnamn / etikett</span>
                    <input
                      name="siteName"
                      placeholder="Anläggningsnamn / etikett"
                      className={inputClassName()}
                    />
                  </label>

                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">Anläggnings-id</span>
                    <input
                      name="facilityId"
                      placeholder="Anläggnings-id"
                      className={inputClassName()}
                    />
                  </label>

                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">Mätpunkts-id</span>
                    <input
                      name="meterPointId"
                      placeholder="Mätpunkts-id"
                      className={inputClassName()}
                    />
                  </label>

                  <label className="grid gap-1 text-sm">
                    <span
                      className="text-slate-600 dark:text-slate-300"
                      data-label-for-flow
                      data-label-switch="Önskat startdatum"
                      data-label-move_in="Inflyttningsdatum"
                      data-label-move_out_takeover="Övertagsdatum"
                    >
                      Önskat startdatum
                    </span>
                    <input
                      type="date"
                      name="moveInDate"
                      className={inputClassName()}
                      data-required-flow="move_in move_out_takeover"
                    />
                  </label>

                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">Nätägare</span>
                    <select name="gridOwnerId" className={inputClassName()}>
                      <option value="">Välj nätägare</option>
                      {gridOwners.map((owner) => (
                        <option key={owner.id} value={owner.id}>
                          {owner.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">Elområde</span>
                    <select name="priceAreaCode" className={inputClassName()}>
                      <option value="">Välj elområde</option>
                      {priceAreas.map((area) => (
                        <option key={area.code} value={area.code}>
                          {area.code} • {area.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">Årsförbrukning kWh</span>
                    <input
                      name="annualConsumptionKwh"
                      placeholder="Årsförbrukning kWh"
                      className={inputClassName()}
                    />
                  </label>

                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">Anläggningstyp</span>
                    <select name="siteType" defaultValue="consumption" className={inputClassName()}>
                      <option value="consumption">Förbrukning</option>
                      <option value="production">Produktion</option>
                      <option value="mixed">Mixad</option>
                    </select>
                  </label>

                  <label className="grid gap-1 text-sm md:col-span-2" data-flow-section="switch move_in move_out_takeover">
                    <span
                      className="text-slate-600 dark:text-slate-300"
                      data-label-for-flow
                      data-label-switch="Anläggningsadress"
                      data-label-move_in="Ny adress kunden flyttar till"
                      data-label-move_out_takeover="Adress som tas över"
                    >
                      Anläggningsadress
                    </span>
                    <input
                      name="street"
                      placeholder="Gatuadress"
                      className={inputClassName('full')}
                      data-required-flow="move_in move_out_takeover"
                    />
                  </label>

                  <label className="grid gap-1 text-sm" data-flow-section="switch move_in move_out_takeover">
                    <span className="text-slate-600 dark:text-slate-300">Postnummer</span>
                    <input
                      name="postalCode"
                      placeholder="Postnummer"
                      className={inputClassName()}
                      data-required-flow="move_in move_out_takeover"
                    />
                  </label>

                  <label className="grid gap-1 text-sm" data-flow-section="switch move_in move_out_takeover">
                    <span className="text-slate-600 dark:text-slate-300">Stad</span>
                    <input
                      name="city"
                      placeholder="Stad"
                      className={inputClassName()}
                      data-required-flow="move_in move_out_takeover"
                    />
                  </label>

                  <label className="grid gap-1 text-sm md:col-span-2" data-flow-section="switch move_in move_out_takeover">
                    <span className="text-slate-600 dark:text-slate-300">c/o</span>
                    <input
                      name="careOf"
                      placeholder="c/o"
                      className={inputClassName('full')}
                    />
                  </label>

                  <label className="grid gap-1 text-sm" data-flow-section="switch move_in move_out_takeover">
                    <span
                      className="text-slate-600 dark:text-slate-300"
                      data-label-for-flow
                      data-label-switch="Nuvarande elleverantör"
                      data-label-move_in="Nuvarande elleverantör på nya anläggningen"
                      data-label-move_out_takeover="Nuvarande elleverantör på anläggningen"
                    >
                      Nuvarande elleverantör
                    </span>
                    <input
                      name="currentSupplierName"
                      placeholder="Nuvarande elleverantör"
                      className={inputClassName()}
                    />
                  </label>

                  <label className="grid gap-1 text-sm" data-flow-section="switch move_in move_out_takeover">
                    <span className="text-slate-600 dark:text-slate-300">Nuvarande leverantör org.nr</span>
                    <input
                      name="currentSupplierOrgNumber"
                      placeholder="Nuvarande leverantör org.nr"
                      className={inputClassName()}
                    />
                  </label>

                  <div className="md:col-span-2 grid gap-4 md:grid-cols-2" data-flow-section="move_in move_out_takeover">
                    <div className="md:col-span-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
                      Fyll i var kunden flyttar från när det är relevant. Fälten skickas bara med för inflytt och övertag.
                    </div>

                    <label className="grid gap-1 text-sm md:col-span-2">
                      <span className="text-slate-600 dark:text-slate-300">Flyttar från adress</span>
                      <input
                        name="movedFromStreet"
                        placeholder="Flyttar från adress"
                        className={inputClassName('full')}
                      />
                    </label>

                    <label className="grid gap-1 text-sm">
                      <span className="text-slate-600 dark:text-slate-300">Flyttar från postnummer</span>
                      <input
                        name="movedFromPostalCode"
                        placeholder="Flyttar från postnummer"
                        className={inputClassName()}
                      />
                    </label>

                    <label className="grid gap-1 text-sm">
                      <span className="text-slate-600 dark:text-slate-300">Flyttar från stad</span>
                      <input
                        name="movedFromCity"
                        placeholder="Flyttar från stad"
                        className={inputClassName()}
                      />
                    </label>

                    <label className="grid gap-1 text-sm md:col-span-2">
                      <span className="text-slate-600 dark:text-slate-300">Flyttar från leverantör</span>
                      <input
                        name="movedFromSupplierName"
                        placeholder="Flyttar från leverantör"
                        className={inputClassName('full')}
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  Avtal
                </h3>

                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <label className="grid gap-1 text-sm md:col-span-2">
                    <span className="text-slate-600 dark:text-slate-300">Avtalsmall</span>
                    <select
                      name="contractOfferId"
                      className={inputClassName('full')}
                    >
                      <option value="">Välj avtal från avtalskatalog</option>
                      {contractOffers.map((offer) => (
                        <option key={offer.id} value={offer.id}>
                          {offer.name} • {offer.contract_type}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">Avtalsstart</span>
                    <input type="date" name="contractStartDate" className={inputClassName()} />
                  </label>

                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">Avtalsstatus</span>
                    <select
                      name="contractStatus"
                      defaultValue="pending_signature"
                      className={inputClassName()}
                    >
                      <option value="draft">Draft</option>
                      <option value="pending_signature">Väntar signering</option>
                      <option value="signed">Signerat</option>
                      <option value="active">Aktivt</option>
                    </select>
                  </label>

                  <label className="grid gap-1 text-sm md:col-span-2">
                    <span className="text-slate-600 dark:text-slate-300">Override-orsak</span>
                    <input
                      name="overrideReason"
                      placeholder="Override-orsak"
                      className={inputClassName('full')}
                    />
                  </label>

                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">Avtalstyp override</span>
                    <select name="contractTypeOverride" className={inputClassName()}>
                      <option value="">Behåll katalogens avtalstyp</option>
                      <option value="fixed">Fast</option>
                      <option value="variable_monthly">Rörlig månad</option>
                      <option value="variable_hourly">Rörlig tim</option>
                      <option value="portfolio">Portfölj</option>
                    </select>
                  </label>

                  <label className="grid gap-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">Grön el-avgift override</span>
                    <select name="greenFeeMode" className={inputClassName()}>
                      <option value="">Behåll katalogens grön el-avgift</option>
                      <option value="none">Ingen</option>
                      <option value="sek_month">kr/mån</option>
                      <option value="ore_per_kwh">öre/kWh</option>
                    </select>
                  </label>

                  <input
                    name="fixedPriceOrePerKwh"
                    placeholder="Override fast pris öre/kWh"
                    className={inputClassName()}
                  />

                  <input
                    name="spotMarkupOrePerKwh"
                    placeholder="Override påslag öre/kWh"
                    className={inputClassName()}
                  />

                  <input
                    name="variableFeeOrePerKwh"
                    placeholder="Override rörlig avgift öre/kWh"
                    className={inputClassName()}
                  />

                  <input
                    name="monthlyFeeSek"
                    placeholder="Override månadsavgift kr"
                    className={inputClassName()}
                  />

                  <input
                    name="greenFeeValue"
                    placeholder="Override grön el-värde"
                    className={inputClassName()}
                  />

                  <input
                    name="bindingMonths"
                    placeholder="Bindningstid månader"
                    className={inputClassName()}
                  />

                  <input
                    name="noticeMonths"
                    placeholder="Uppsägningstid månader"
                    className={inputClassName()}
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
                <p>Säkrar rätt kundlogik för privat, företag och förening med kontaktperson där det krävs.</p>
                <p>Registrerar nätägare, elområde, flyttar-från-data och anläggningsinfo.</p>
                <p>Knyter valbart avtal från admin-katalogen med möjlighet till override.</p>
                <p>Loggar första avtalshändelsen i kundens avtalshistorik.</p>
                <p>Kan skapa rätt switchtyp direkt från intake: leverantörsbyte, inflytt eller övertag.</p>
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  )
}