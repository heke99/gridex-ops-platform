import {
  createCustomerDataRequestPackageAction,
  registerCurrentSupplierResponseAction,
} from "@/app/admin/customers/[id]/actions";
import type { CustomerSiteRow, MeteringPointRow } from "@/lib/masterdata/types";
import type { CustomerInfoRequestRow } from "@/lib/onboarding/infoRequests";
import type {
  CustomerAuthorizationDocumentRow,
  PowerOfAttorneyRow,
} from "@/lib/operations/types";
import type { GridOwnerRow } from "@/lib/masterdata/types";
import SubmitButton from "@/components/admin/customers/document-card/SubmitButton";
import {
  buildCustomerCardSnapshot,
  hasValidPowerOfAttorney,
  humanizeBlockerReason,
  type CustomerCardSnapshot,
} from "@/lib/customers/customerCardSnapshot";

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function simpleRequestLabel(value: string): string {
  switch (value) {
    case "z01_customer_masterdata":
      return "Nätägare";
    case "current_supplier_contract_info":
      return "Nuvarande leverantör";
    default:
      return value.replaceAll("_", " ");
  }
}

function simpleStatus(value: string): {
  label: string;
  className: string;
  description: string;
} {
  switch (value) {
    case "draft":
      return {
        label: "Utkast",
        className: "bg-slate-100 text-slate-700",
        description: "Sparad men inte skickad.",
      };
    case "ready_to_send":
    case "z01_prepared":
      return {
        label: "Redo",
        className: "bg-emerald-100 text-emerald-700",
        description: "Systemet har förberett begäran.",
      };
    case "sent":
    case "sent_to_grid_owner":
      return {
        label: "Skickad",
        className: "bg-emerald-100 text-emerald-700",
        description: "Begäran är skickad eller köad.",
      };
    case "waiting_for_contrl":
    case "waiting_for_aperak":
    case "waiting_for_z02":
    case "manual_review_required":
      return {
        label: "Väntar/granskning",
        className: "bg-amber-100 text-amber-700",
        description: "Systemet väntar på svar eller granskning.",
      };
    case "z02_received":
    case "completed":
      return {
        label: "Klar",
        className: "bg-emerald-100 text-emerald-700",
        description: "Uppgifter finns eller är klara.",
      };
    case "negative_aperak":
    case "rejected":
      return {
        label: "Nekad",
        className: "bg-red-100 text-red-700",
        description: "Begäran behöver rättas eller följas upp.",
      };
    case "missing_authorization":
      return {
        label: "Fullmakt krävs",
        className: "bg-red-100 text-red-700",
        description: "Fullmakt behöver verifieras innan utskick.",
      };
    case "blocked":
    case "route_missing":
    case "contact_path_missing":
      return {
        label: "Blockerad",
        className: "bg-red-100 text-red-700",
        description: "En uppgift eller kontaktväg behöver verifieras.",
      };
    case "cancelled":
      return {
        label: "Avbruten",
        className: "bg-slate-200 text-slate-700",
        description: "Begäran är stoppad.",
      };
    default:
      return {
        label: value.replaceAll("_", " "),
        className: "bg-slate-100 text-slate-700",
        description: "Status från systemet.",
      };
  }
}

function findSiteName(sites: CustomerSiteRow[], siteId: string | null): string {
  if (!siteId) return "Kundnivå";
  return sites.find((site) => site.id === siteId)?.site_name ?? "Anläggning";
}

export default function CustomerDataRequestsCard({
  customerId,
  sites,
  meteringPoints,
  gridOwners,
  infoRequests,
  powersOfAttorney,
  documents,
  snapshot: suppliedSnapshot,
}: {
  customerId: string;
  sites: CustomerSiteRow[];
  meteringPoints: MeteringPointRow[];
  gridOwners: GridOwnerRow[];
  infoRequests: CustomerInfoRequestRow[];
  powersOfAttorney: PowerOfAttorneyRow[];
  documents: CustomerAuthorizationDocumentRow[];
  snapshot?: CustomerCardSnapshot;
}) {
  const snapshot =
    suppliedSnapshot ??
    buildCustomerCardSnapshot({
      sites,
      meteringPoints,
      powersOfAttorney,
      documents,
      infoRequests,
    });
  const hasAuthorization =
    snapshot.hasAuthorization ||
    hasValidPowerOfAttorney(powersOfAttorney, documents);
  const currentSupplierRequests = infoRequests.filter(
    (request) =>
      request.target_party_type === "current_supplier" ||
      request.request_type === "current_supplier_contract_info",
  );
  const defaultCurrentSupplierRequest =
    currentSupplierRequests.find(
      (request) =>
        !["completed", "cancelled", "rejected"].includes(request.status),
    ) ??
    currentSupplierRequests[0] ??
    null;
  const defaultSite = snapshot.primarySite ?? sites[0] ?? null;
  const primaryPoint =
    snapshot.primaryMeteringPoint ?? meteringPoints[0] ?? null;
  const gridOwnerId =
    primaryPoint?.grid_owner_id ?? defaultSite?.grid_owner_id ?? "";
  const latestRequests = infoRequests.slice(0, 8);

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <div className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Begär uppgifter
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              Systemet väljer fullmakt och anläggning automatiskt, försöker
              hitta nätägare från adress, postnummer och elområde, och skapar
              granskning om matchningen inte är säker.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${hasAuthorization ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}
          >
            {hasAuthorization ? "Fullmakt finns" : "Fullmakt saknas"}
          </span>
        </div>

        <div className="mt-5 rounded-2xl border border-emerald-100 bg-white p-4 text-sm text-slate-700">
          <div className="font-semibold text-slate-900">
            Automatisk kontroll
          </div>
          <p className="mt-1">{snapshot.nextStepDescription}</p>
          {snapshot.switchBlockerLabels.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-amber-900">
              {snapshot.switchBlockerLabels.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <form
          action={createCustomerDataRequestPackageAction}
          className="mt-6 space-y-4"
        >
          <input type="hidden" name="customer_id" value={customerId} />
          <input type="hidden" name="request_target" value="both" />
          <input
            type="hidden"
            name="power_of_attorney_id"
            value={
              powersOfAttorney.find((row) => row.status === "signed")?.id ?? ""
            }
          />
          <input type="hidden" name="site_id" value={defaultSite?.id ?? ""} />
          <input
            type="hidden"
            name="metering_point_id"
            value={primaryPoint?.id ?? ""}
          />
          <input type="hidden" name="grid_owner_id" value={gridOwnerId} />
          <SubmitButton
            idleLabel="Begär uppgifter"
            pendingLabel="Kontrollerar och skapar begäran..."
          />
        </form>

        <details className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          <summary className="cursor-pointer font-semibold text-slate-900">
            Avancerad uppgiftsbegäran
          </summary>
          <form
            action={createCustomerDataRequestPackageAction}
            className="mt-4 space-y-4"
          >
            <input type="hidden" name="customer_id" value={customerId} />
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">
                Vad vill du begära?
              </span>
              <select
                name="request_target"
                defaultValue="both"
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900"
              >
                <option value="grid_owner">Från nätägare</option>
                <option value="current_supplier">
                  Från nuvarande leverantör
                </option>
                <option value="both">Från båda</option>
              </select>
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Anläggning</span>
                <select
                  name="site_id"
                  defaultValue={defaultSite?.id ?? ""}
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900"
                >
                  <option value="">Välj anläggning</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.site_name} ·{" "}
                      {site.facility_id ?? "saknar anläggnings-ID"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Mätpunkt</span>
                <select
                  name="metering_point_id"
                  defaultValue={primaryPoint?.id ?? ""}
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900"
                >
                  <option value="">Välj mätpunkt om den finns</option>
                  {meteringPoints.map((point) => (
                    <option key={point.id} value={point.id}>
                      {point.meter_point_id || point.id}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Nätägare</span>
              <select
                name="grid_owner_id"
                defaultValue={gridOwnerId}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900"
              >
                <option value="">Låt systemet välja eller föreslå</option>
                {gridOwners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton
              idleLabel="Skapa avancerad begäran"
              pendingLabel="Skapar..."
            />
          </form>
        </details>
      </div>

      <div className="space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900">Fullmakt</h3>
          <p className="mt-1 text-sm text-slate-700">
            Fullmakt räknas som klar när signerad fullmakt eller
            fullmaktsdokument finns.
          </p>
          <div
            className={`mt-4 rounded-2xl border p-4 text-sm ${hasAuthorization ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`}
          >
            {hasAuthorization
              ? "Fullmakt finns och ska inte längre blockera uppgiftsbegäran."
              : "Fullmakt saknas eller behöver verifieras."}
          </div>
        </div>

        <details className="rounded-3xl border border-amber-200 bg-amber-50/60 p-6 shadow-sm">
          <summary className="cursor-pointer text-base font-semibold text-slate-900">
            Fler åtgärder: registrera leverantörssvar manuellt
          </summary>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Använd bara när systemet inte kunde koppla ett inkommande svar
            automatiskt.
          </p>
          <form
            action={registerCurrentSupplierResponseAction}
            className="mt-4 space-y-4"
          >
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="site_id" value={defaultSite?.id ?? ""} />
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">
                Koppla till uppgiftsbegäran
              </span>
              <select
                name="customer_info_request_id"
                defaultValue={defaultCurrentSupplierRequest?.id ?? ""}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900"
              >
                <option value="">Ingen / manuell registrering</option>
                {currentSupplierRequests.map((request) => (
                  <option key={request.id} value={request.id}>
                    {simpleRequestLabel(request.request_type)} ·{" "}
                    {simpleStatus(request.status).label} ·{" "}
                    {formatDateTime(request.created_at)}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">
                  Svar från leverantör
                </span>
                <select
                  name="response_status"
                  defaultValue="free_to_switch"
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900"
                >
                  <option value="free_to_switch">Kunden kan byta</option>
                  <option value="binding_period">Bindningstid finns</option>
                  <option value="termination_fee">Brytavgift finns</option>
                  <option value="blocked">
                    Leverantören avråder/blockerar
                  </option>
                  <option value="waiting_response">Väntar svar</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">
                  Rekommenderat bytesdatum
                </span>
                <input
                  name="recommended_switch_date"
                  type="date"
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900"
                />
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Kommentar</span>
              <textarea
                name="response_notes"
                rows={3}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900"
              />
            </label>
            <SubmitButton
              idleLabel="Spara manuellt svar"
              pendingLabel="Sparar..."
            />
          </form>
        </details>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Senaste uppgiftsbegäran
              </h3>
              <p className="mt-1 text-sm text-slate-700">
                Enkel status för handläggaren.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {infoRequests.length}
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {latestRequests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-700">
                Inga uppgiftsbegäran finns ännu.
              </div>
            ) : (
              latestRequests.map((request) => {
                const status = simpleStatus(request.status);
                const blocker = humanizeBlockerReason(request.blocker_reason);
                return (
                  <article
                    key={request.id}
                    className="rounded-2xl border border-slate-200 p-4 text-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-950">
                          {simpleRequestLabel(request.request_type)}
                        </div>
                        <div className="mt-1 text-xs text-slate-700">
                          {findSiteName(sites, request.site_id)} ·{" "}
                          {formatDateTime(request.created_at)}
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${status.className}`}
                      >
                        {status.label}
                      </span>
                    </div>
                    <p className="mt-3 text-slate-700">{status.description}</p>
                    {blocker ? (
                      <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        {blocker}
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
