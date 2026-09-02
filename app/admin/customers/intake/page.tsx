import Link from "next/link";
import AdminHeader from "@/components/admin/AdminHeader";
import CustomerBulkImportPanel from "@/components/admin/customers/CustomerBulkImportPanel";
import CustomerIntakeForm from "@/components/admin/customers/CustomerIntakeForm";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdminPageAccess } from "@/lib/admin/guards";
import {
  listElectricitySuppliers,
  listGridOwners,
  listPriceAreas,
} from "@/lib/masterdata/db";
import { listContractOffers } from "@/lib/customer-contracts/db";
import { getOperationalCompanyScope } from "@/lib/tenant/scope";
import { getCompanyGoLiveSetupSummary } from "@/lib/ediel/platformGoLive";

export const dynamic = "force-dynamic";

const bulkExample = `customer_type;intake_flow_type;first_name;last_name;contact_title;company_name;email;phone;personal_number;org_number;apartment_number;site_name;facility_id;meter_point_id;grid_owner_id;grid_area_code;price_area_code;move_in_date;annual_consumption_kwh;street;postal_code;city;care_of;country;current_supplier_name;current_supplier_org_number;customer_confirmation_status;authorization_status;authorization_valid_from;authorization_valid_to;expected_start_date;confirmed_start_date;start_date_source;moved_from_street;moved_from_postal_code;moved_from_city;moved_from_supplier_name;contract_offer_id;contract_status;binding_months;notice_months
private;switch;Anna;Svensson;;;anna@example.se;0700000000;199001011234;;1201;Anna Svensson - Lägenhet;735999111111111111;735999000000000001;REPLACE_GRID_OWNER_UUID;STHLM;SE3;2026-06-01;12000;Storgatan 1;11122;Stockholm;;SE;Fortum;5560000000;confirmed;signed;2026-05-21;2027-05-21;2026-06-01;;customer_expected;;;;;REPLACE_CONTRACT_OFFER_UUID;pending_signature;12;1
association;move_in;Sara;Ek;Ordförande;Brf Solrosen;sara@solrosen.se;0701111111;;769600-1234;;Brf Solrosen Huvudanläggning;735999111111111112;735999000000000002;REPLACE_GRID_OWNER_UUID;STHLM;SE3;2026-08-01;54000;Föreningsgatan 4;11123;Stockholm;c/o Styrelsen;SE;E.ON;5561000000;confirmed;sent;2026-05-21;2027-05-21;2026-08-01;;customer_expected;Gamla vägen 9;11121;Stockholm;Vattenfall;REPLACE_CONTRACT_OFFER_UUID;pending_signature;12;3`;

async function safeLoad<T>(
  label: string,
  loader: () => Promise<T[]>,
): Promise<{ rows: T[]; warning: string | null }> {
  try {
    return { rows: await loader(), warning: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Okänt databasfel";
    return {
      rows: [],
      warning: `${label} kunde inte läsas in. Kundintag visas ändå så att sidan inte kraschar: ${message}`,
    };
  }
}

export default async function CustomerIntakePage() {
  const access = await requireAdminPageAccess({
    anyOf: ["customers.write", "masterdata.read"],
  });

  const supabase = await createSupabaseServerClient();
  const { data: authResult } = await supabase.auth.getUser();
  const user = authResult.user;
  const companyScope = await getOperationalCompanyScope(access.userId);

  const [
    gridOwnersResult,
    electricitySuppliersResult,
    priceAreasResult,
    contractOffersResult,
    goLiveSummary,
  ] = await Promise.all([
    safeLoad("Nätägare", () =>
      listGridOwners(supabase, { customerFlowOnly: true }),
    ),
    safeLoad("Elhandlare", () =>
      listElectricitySuppliers(supabase, {
        activeOnly: true,
        customerFlowOnly: true,
        companyId: companyScope.companyId,
      }),
    ),
    safeLoad("Prisområden", () => listPriceAreas(supabase)),
    safeLoad("Avtalserbjudanden", () =>
      companyScope.companyId
        ? listContractOffers({
            activeOnly: true,
            companyId: companyScope.companyId,
          })
        : Promise.resolve([]),
    ),
    companyScope.companyId
      ? getCompanyGoLiveSetupSummary(companyScope.companyId)
      : Promise.resolve(null),
  ]);
  const gridOwners = gridOwnersResult.rows;
  const electricitySuppliers = electricitySuppliersResult.rows;
  const priceAreas = priceAreasResult.rows;
  const contractOffers = contractOffersResult.rows;
  const loadWarnings = [
    gridOwnersResult.warning,
    electricitySuppliersResult.warning,
    priceAreasResult.warning,
    contractOffersResult.warning,
  ].filter((warning): warning is string => Boolean(warning));

  const serializedOffers = contractOffers.map((offer) => ({
    id: offer.id,
    name: offer.name,
    campaign_name: offer.campaign_name,
    contract_type: offer.contract_type,
    fixed_price_ore_per_kwh: offer.fixed_price_ore_per_kwh,
    spot_markup_ore_per_kwh: offer.spot_markup_ore_per_kwh,
    variable_fee_ore_per_kwh: offer.variable_fee_ore_per_kwh,
    monthly_fee_sek: offer.monthly_fee_sek,
    invoice_fee_sek: offer.invoice_fee_sek ?? null,
    start_fee_sek: offer.start_fee_sek ?? null,
    admin_fee_sek: offer.admin_fee_sek ?? null,
    break_fee_sek: offer.break_fee_sek ?? null,
    green_fee_mode: offer.green_fee_mode,
    green_fee_value: offer.green_fee_value,
    default_binding_months: offer.default_binding_months,
    default_notice_months: offer.default_notice_months,
    optional_fee_lines: offer.optional_fee_lines,
  }));

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Kundintag"
        subtitle="Skapa kund, avtal, dokument och fullmakt utan att ofullständig data stoppar intaget."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/customers"
            className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
          >
            Till kundlistan
          </Link>

          <Link
            href="/admin/contracts"
            className="inline-flex items-center rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 "
          >
            Hantera avtalskatalog
          </Link>
        </div>

        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm ">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 ">
            Operativt bolag
          </p>
          <h2 className="mt-2 text-xl font-semibold text-slate-950 ">
            {companyScope.companyName ?? "Bolagskoppling saknas"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-700 ">
            Kundintag sparar kund, anläggning, mätpunkt, avtal, dokument och
            fullmakt i detta bolag.
          </p>
          {companyScope.message ? (
            <p className="mt-3 text-sm font-semibold text-amber-700 ">
              {companyScope.message}
            </p>
          ) : null}
        </section>

        {loadWarnings.length > 0 ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900 shadow-sm">
            <h2 className="font-semibold text-amber-950">
              Kundintag laddades med begränsad masterdata
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              {loadWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-5">
          {[
            [
              "1",
              "Kund",
              "Privat/företag, identitet, kontakt och fakturaadress.",
            ],
            [
              "2",
              "Anläggning",
              "Anläggnings-id, nätägare, elområde och startdatum.",
            ],
            ["3", "Avtal", "Prisplan, kampanj, fullmakt och startvillkor."],
            [
              "4",
              "Fullmakt/Ediel",
              "Plattformen avgör fullmakt, leverantörsbyte, inflytt, uppsägning och mätdataflöde.",
            ],
            [
              "5",
              "Sammanfattning",
              "Visa blockerare, nästa steg och om kunden är redo för fakturering.",
            ],
          ].map(([step, title, body]) => (
            <div
              key={step}
              className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-700 text-sm font-bold text-white">
                {step}
              </div>
              <h2 className="mt-4 text-base font-semibold text-slate-950">
                {title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-700">{body}</p>
            </div>
          ))}
        </section>

        <section className="rounded-3xl border border-sky-200 bg-sky-50 p-6 text-sm leading-6 text-sky-950 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                Automatiskt nätägar- och Ediel-flöde
              </h2>
              <p className="mt-2">
                Kundintag ska inte skapa egna tekniska routes eller
                receiver-värden. Systemet använder verifierad masterdata,
                tenantens Ediel-ID och go-live route-profiler för att avgöra
                nästa steg.
              </p>
              <p className="mt-2">
                Om anläggnings-id, mätpunkts-id eller nätägare saknas sparas
                kunden med blockerare och uppgiftsbegäran i stället för att
                skicka felaktig PRODAT.
              </p>
            </div>
            <div className="rounded-2xl border border-sky-200 bg-white px-4 py-3 text-xs font-bold text-sky-900">
              EDIFACT-status:{" "}
              {goLiveSummary?.status === "ready"
                ? "Redo"
                : goLiveSummary?.status === "manual_review_required"
                  ? "Kräver granskning"
                  : "Blockerad/saknas"}
            </div>
          </div>
          {goLiveSummary ? (
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl bg-white p-4">
                <div className="text-xs font-bold uppercase text-slate-500">
                  Ediel-ID
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-slate-950">
                  {goLiveSummary.edielId ?? "–"}
                </div>
              </div>
              <div className="rounded-2xl bg-white p-4">
                <div className="text-xs font-bold uppercase text-slate-500">
                  Receiver
                </div>
                <div className="mt-1 text-sm font-bold text-slate-950">
                  {goLiveSummary.routeResolutionMode === "automatic"
                    ? "Automatiskt"
                    : "Granska"}
                </div>
              </div>
              <div className="rounded-2xl bg-white p-4">
                <div className="text-xs font-bold uppercase text-slate-500">
                  PRODAT produktion
                </div>
                <div className="mt-1 text-sm font-bold text-slate-950">
                  {goLiveSummary.hasProdatRoute ? "Klar" : "Inte aktiverad"}
                </div>
              </div>
              <div className="rounded-2xl bg-white p-4">
                <div className="text-xs font-bold uppercase text-slate-500">
                  Juridik
                </div>
                <div className="mt-1 text-sm font-bold text-slate-950">
                  {goLiveSummary.legal.terms &&
                  goLiveSummary.legal.privacy_policy &&
                  goLiveSummary.legal.withdrawal &&
                  goLiveSummary.legal.power_of_attorney
                    ? "Klar"
                    : "Inte aktiverad"}
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <CustomerIntakeForm
            gridOwners={gridOwners.map((owner) => ({
              id: owner.id,
              name: owner.name,
            }))}
            electricitySuppliers={electricitySuppliers.map((supplier) => ({
              id: supplier.id,
              name: supplier.name,
              org_number: supplier.org_number,
              ediel_id: supplier.ediel_id,
              email: supplier.email,
            }))}
            priceAreas={priceAreas.map((area) => ({
              code: area.code,
              name: area.name,
            }))}
            contractOffers={serializedOffers}
          />

          <div className="space-y-6">
            <CustomerBulkImportPanel
              example={bulkExample}
              contractOffers={serializedOffers.map((offer) => ({
                id: offer.id,
                name: offer.name,
                campaign_name: offer.campaign_name,
              }))}
            />

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
              <h2 className="text-lg font-semibold text-slate-950 ">
                Kundintag med blockerare
              </h2>
              <div className="mt-4 space-y-3 text-sm text-slate-700 ">
                <p>
                  Servern sparar kunden även när driftdata saknas och skapar
                  blockerare i stället för att kasta bort intaget.
                </p>
                <p>
                  Land sparas som ISO-kod, till exempel SE, medan gränssnittet
                  visar Sverige.
                </p>
                <p>
                  Möjliga dubbletter sparas som granskning och blockerare, inte
                  som ett skrivfält på kundraden.
                </p>
                <p>
                  Signerade avtal och signerade fullmakter kan laddas upp direkt
                  och kopplas till kund, anläggning, mätpunkt och avtal.
                </p>
                <p>
                  Blockerare används för att stoppa rätt senare steg:
                  uppgiftsbegäran, leverantörsbyte, faktureringsunderlag eller
                  export.
                </p>
                <p>
                  Alla rader skapas med operativt company_id och samma
                  servervalidering som manuellt kundintag.
                </p>
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  );
}
