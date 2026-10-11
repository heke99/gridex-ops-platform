import Link from "next/link";
import AdminHeader from "@/components/admin/AdminHeader";
import CustomerBulkImportPanel from "@/components/admin/customers/CustomerBulkImportPanel";
import CustomerIntakeForm from "@/components/admin/customers/CustomerIntakeForm";
import CustomerIntakeWorkspace from "@/components/admin/customers/CustomerIntakeWorkspace";
import CustomerActionsMenu from "@/components/admin/customers/CustomerActionsMenu";
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

export default async function CustomerIntakePage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const mode = (await searchParams).mode === "bulk" ? "bulk" : "manual";
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
      <AdminHeader title="Kundintag" subtitle="Registrera en kund eller importera flera kunder." userEmail={user?.email ?? null} />
      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/admin/customers" className="text-sm font-semibold text-slate-700 hover:text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">← Kundregister</Link>
          <CustomerActionsMenu ariaLabel="Fler vyer från kundintag"><Link href="/admin/contracts">Hantera avtalskatalog</Link></CustomerActionsMenu>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          Registrerar i <span className="font-semibold text-slate-950">{companyScope.companyName ?? "Bolagskoppling saknas"}</span>
          {companyScope.message ? <p className="mt-1 font-medium text-amber-800">{companyScope.message}</p> : null}
        </div>
        {loadWarnings.length > 0 ? (
          <section role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <h2 className="font-semibold">Vissa grunduppgifter (till exempel nätägare) kunde inte laddas</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">{loadWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          </section>
        ) : null}
        <details className={`rounded-2xl border p-4 text-sm ${goLiveSummary?.status === "ready" ? "border-slate-200 bg-white text-slate-700" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
          <summary className="cursor-pointer font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
            Automatiska utskick: {goLiveSummary?.status === "ready" ? "Redo" : goLiveSummary?.status === "manual_review_required" ? "Kräver granskning" : "Blockerade / inställningar saknas"}
          </summary>
          <p className="mt-3 leading-6">Kunden sparas även om uppgifter saknas. Saknade uppgifter stoppar senare uppgiftsbegäran, leverantörsbyte eller export tills uppgifterna är kompletta.</p>
          {goLiveSummary ? <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-4">
            <div><dt>Ediel-ID</dt><dd className="mt-1 font-semibold">{goLiveSummary.edielId ?? "–"}</dd></div>
            <div><dt>Mottagare</dt><dd className="mt-1 font-semibold">{goLiveSummary.routeResolutionMode === "automatic" ? "Automatiskt" : "Granska"}</dd></div>
            <div><dt>PRODAT produktion</dt><dd className="mt-1 font-semibold">{goLiveSummary.hasProdatRoute ? "Klar" : "Inte aktiverad"}</dd></div>
            <div><dt>Juridik</dt><dd className="mt-1 font-semibold">{goLiveSummary.legal.terms && goLiveSummary.legal.privacy_policy && goLiveSummary.legal.withdrawal && goLiveSummary.legal.power_of_attorney ? "Klar" : "Inte aktiverad"}</dd></div>
          </dl> : null}
        </details>
        <CustomerIntakeWorkspace
          mode={mode}
          manual={<CustomerIntakeForm
            gridOwners={gridOwners.map((owner) => ({ id: owner.id, name: owner.name }))}
            electricitySuppliers={electricitySuppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, org_number: supplier.org_number, ediel_id: supplier.ediel_id, email: supplier.email }))}
            priceAreas={priceAreas.map((area) => ({ code: area.code, name: area.name }))}
            contractOffers={serializedOffers}
          />}
          bulk={<CustomerBulkImportPanel example={bulkExample} contractOffers={serializedOffers.map((offer) => ({ id: offer.id, name: offer.name, campaign_name: offer.campaign_name }))} />}
        />
      </div>
    </div>
  );
}
