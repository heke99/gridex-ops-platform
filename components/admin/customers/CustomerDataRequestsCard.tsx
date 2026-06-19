import {
  createCustomerDataRequestPackageAction,
  registerCurrentSupplierResponseAction,
} from "@/app/admin/customers/[id]/actions";
import { meteringPointIdentityLabel } from "@/lib/customers/meteringIdentity";
import type { CustomerSiteRow, MeteringPointRow } from "@/lib/masterdata/types";
import type { CustomerInfoRequestRow } from "@/lib/onboarding/infoRequests";
import type {
  CustomerAuthorizationDocumentRow,
  PowerOfAttorneyRow,
} from "@/lib/operations/types";
import type { GridOwnerRow } from "@/lib/masterdata/types";
import SubmitButton from "@/components/admin/customers/document-card/SubmitButton";
import CustomerOperationAutomationForm from "@/components/admin/customers/CustomerOperationAutomationForm";
import {
  buildCustomerCardSnapshot,
  hasValidPowerOfAttorney,
  humanizeBlockerReason,
  type CustomerCardSnapshot,
} from "@/lib/customers/customerCardSnapshot";
import { customerBlockerStatusLabel } from "@/lib/customer-operations/blockers";

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

function requestBlockerCode(request: CustomerInfoRequestRow): string | null {
  const details = request.blocker_details ?? request.verified_payload?.blocker_details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const record = details as Record<string, unknown>;
    if (typeof record.blocker_code === "string") return record.blocker_code;
    if (typeof record.reason_code === "string") return record.reason_code;
  }
  if (typeof request.blocker_code === "string") return request.blocker_code;
  if (typeof request.verified_payload?.blocker_code === "string") {
    return request.verified_payload.blocker_code;
  }
  return null;
}

function requestBlockerDetail(request: CustomerInfoRequestRow, key: string): string | null {
  const details = request.blocker_details ?? request.verified_payload?.blocker_details;
  const record =
    details && typeof details === "object" && !Array.isArray(details)
      ? (details as Record<string, unknown>)
      : {};
  const value = record[key] ?? request.verified_payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function simpleStatus(request: CustomerInfoRequestRow): {
  label: string;
  className: string;
  description: string;
} {
  const value = request.status;
  const blockerCode = requestBlockerCode(request);
  if (["blocked", "route_missing", "missing_authorization", "manual_review_required"].includes(value) && blockerCode) {
    return {
      label: customerBlockerStatusLabel(blockerCode),
      className:
        blockerCode === "production_send_locked"
          ? "bg-amber-100 text-amber-800"
          : "bg-red-100 text-red-700",
      description:
        requestBlockerDetail(request, "blocker_reason") ??
        "Uppgiftsbegäran behöver granskas innan den kan fortsätta.",
    };
  }
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
        label: "Uppgiftsbegäran skickad",
        className: "bg-emerald-100 text-emerald-700",
        description: "Systemet har förberett begäran för Ediel-utskick.",
      };
    case "sent":
    case "sent_to_grid_owner":
      return {
        label: "Uppgiftsbegäran skickad",
        className: "bg-emerald-100 text-emerald-700",
        description: "Begäran är skickad eller köad.",
      };
    case "waiting_for_contrl":
    case "waiting_for_aperak":
    case "waiting_for_z02":
    case "manual_review_required":
      return {
        label: value === "manual_review_required" ? "Uppgiftsbegäran kräver granskning" : "Svar inväntas",
        className: "bg-amber-100 text-amber-700",
        description: "Systemet väntar på svar eller granskning.",
      };
    case "z02_received":
    case "completed":
      return {
        label: value === "z02_received" ? "Svar mottaget" : "Klar",
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
        label: "Uppgiftsbegäran kräver granskning",
        className: "bg-red-100 text-red-700",
        description: "Fullmakt behöver verifieras innan utskick.",
      };
    case "blocked":
    case "route_missing":
    case "contact_path_missing":
      return {
        label: "Uppgiftsbegäran kräver granskning",
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
  // Standardvyn visar bara den aktiva automatiska nätägarkedjan.
  // Äldre/manuella leverantörsärenden ligger kvar i historiken men får inte
  // ersätta kundens verkliga nästa steg.
  const automatedGridOwnerRequests = infoRequests.filter(
    (request) =>
      request.target_party_type === "grid_owner" ||
      request.request_type === "z01_customer_masterdata",
  );
  const latestRequests = automatedGridOwnerRequests.slice(0, 8);
  const legacyManualRequests = infoRequests.filter(
    (request) => !automatedGridOwnerRequests.some((item) => item.id === request.id),
  );

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

        <div className="mt-6 space-y-4">
          <CustomerOperationAutomationForm
            kind="customer_data"
            customerId={customerId}
            siteId={defaultSite?.id}
            meteringPointId={primaryPoint?.id}
            idleLabel="Begär uppgifter"
            pendingLabel="Startar automatiskt flöde..."
          />
          <p className="text-xs text-slate-600">
            Begäran startas direkt. Systemet söker och verifierar nätägare i
            bakgrunden innan något skickas.
          </p>
        </div>

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
                      {meteringPointIdentityLabel(point) ?? "Mätpunkts-ID saknas"}
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
                    {simpleStatus(request).label} ·{" "}
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
                Automatisk uppgiftsbegäran
              </h3>
              <p className="mt-1 text-sm text-slate-700">
                Status för den aktiva nätägar- och anläggningskedjan.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {automatedGridOwnerRequests.length}
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {latestRequests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-700">
                Ingen automatisk uppgiftsbegäran har startats ännu.
              </div>
            ) : (
              latestRequests.map((request) => {
                const status = simpleStatus(request);
                const blockerCode = requestBlockerCode(request);
                const blockerReason =
                  requestBlockerDetail(request, "blocker_reason") ??
                  humanizeBlockerReason(request.blocker_reason);
                const nextAction = requestBlockerDetail(request, "next_required_action");
                const issueType = requestBlockerDetail(request, "issue_type");
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
                    {blockerReason || blockerCode || nextAction ? (
                      <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        {blockerReason ? <div>{blockerReason}</div> : null}
                        {blockerCode ? <div className="mt-1 font-mono">Blockerarkod: {blockerCode}</div> : null}
                        {issueType ? <div className="mt-1">Typ: {issueType}</div> : null}
                        {nextAction ? <div className="mt-1">Nästa åtgärd: {nextAction}</div> : null}
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>
          {legacyManualRequests.length > 0 ? (
            <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <summary className="cursor-pointer font-semibold text-slate-800">
                Visa äldre eller manuella uppgiftsärenden ({legacyManualRequests.length})
              </summary>
              <p className="mt-2 text-xs text-slate-600">
                Dessa ärenden styr inte den automatiska nätägar- och byteskedjan.
              </p>
              <div className="mt-3 space-y-2">
                {legacyManualRequests.slice(0, 8).map((request) => {
                  const status = simpleStatus(request);
                  return (
                    <div key={request.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
                      <div className="font-semibold text-slate-800">{simpleRequestLabel(request.request_type)}</div>
                      <div className="mt-1 text-slate-600">{status.label} · {formatDateTime(request.created_at)}</div>
                    </div>
                  );
                })}
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </section>
  );
}
