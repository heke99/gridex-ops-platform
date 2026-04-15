import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import CustomerIntakeForm from '@/components/admin/customers/CustomerIntakeForm'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { listGridOwners, listPriceAreas } from '@/lib/masterdata/db'
import { listContractOffers } from '@/lib/customer-contracts/db'
import { bulkCreateCustomersAction } from '@/app/admin/customers/actions'

export const dynamic = 'force-dynamic'

const bulkExample = `customer_type;intake_flow_type;first_name;last_name;contact_title;company_name;email;phone;personal_number;org_number;apartment_number;site_name;facility_id;meter_point_id;grid_owner_id;price_area_code;move_in_date;annual_consumption_kwh;street;postal_code;city;care_of;country;current_supplier_name;current_supplier_org_number;moved_from_street;moved_from_postal_code;moved_from_city;moved_from_supplier_name;contract_offer_id;contract_status;binding_months;notice_months
private;switch;Anna;Svensson;;;anna@example.se;0700000000;199001011234;;1201;Anna Svensson - Lägenhet;735999111111111111;735999000000000001;REPLACE_GRID_OWNER_UUID;SE3;2026-06-01;12000;Storgatan 1;11122;Stockholm;;SE;Fortum;5560000000;;;;;REPLACE_CONTRACT_OFFER_UUID;pending_signature;12;1
association;move_in;Sara;Ek;Ordförande;Brf Solrosen;sara@solrosen.se;0701111111;;769600-1234;;Brf Solrosen Huvudanläggning;735999111111111112;735999000000000002;REPLACE_GRID_OWNER_UUID;SE3;2026-08-01;54000;Föreningsgatan 4;11123;Stockholm;c/o Styrelsen;SE;E.ON;5561000000;Gamla vägen 9;11121;Stockholm;Vattenfall;REPLACE_CONTRACT_OFFER_UUID;pending_signature;12;3`

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
    <div className="min-h-screen">
      <AdminHeader
        title="Kundintag"
        subtitle="Skapa kund med anläggning, nätägare, mätpunkt och avtal. Flödet är nu servervaliderat, ger tydliga fel och rullar tillbaka skapad data om ett senare steg fallerar."
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
          <CustomerIntakeForm
            gridOwners={gridOwners.map((owner) => ({ id: owner.id, name: owner.name }))}
            priceAreas={priceAreas.map((area) => ({ code: area.code, name: area.name }))}
            contractOffers={serializedOffers}
          />

          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Bulkimport
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Klistra in semikolon- eller tab-separerad data. Samma servervalidering används rad för rad, och varje rad rensas tillbaka om något i dess kedja fallerar.
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
                Vad som är härdat nu
              </h2>
              <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <p>Servern stoppar ofullständiga kundtyper, flyttflöden och avtalsstatusar innan databasen hinner spridas.</p>
                <p>Fel visas tydligt i formuläret i stället för som generisk 500-krasch.</p>
                <p>Om ett senare steg fallerar rensas kund, kontakt, adress, anläggning, mätpunkt, avtal och switchdata bort i omvänd ordning.</p>
                <p>Koden är nu uppdelad så att samma validering kan flyttas till RPC eller riktig databastransaktion senare utan att formuläret behöver byggas om igen.</p>
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  )
}