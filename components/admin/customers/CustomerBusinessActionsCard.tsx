import Link from "next/link";
import { createGridOwnerDataRequestAction } from "@/app/admin/customers/[id]/actions";
import {
  endAgreementBusinessAction,
  registerCancellationBusinessAction,
  repairZ01CustomerInfoRequestAction,
  dryRunZ01RepairAction,
  requestHistoricalMeteringAccessBusinessAction,
  requestMeteringAccessBusinessAction,
  sendCustomerConfirmationBusinessAction,
  terminateMeteringAccessBusinessAction,
} from "@/app/admin/customers/[id]/business-actions";
import type { CustomerContractRow } from "@/lib/customer-contracts/types";
import type { CustomerSiteRow, MeteringPointRow } from "@/lib/masterdata/types";
import type {
  CustomerAuthorizationDocumentRow,
  PowerOfAttorneyRow,
  SupplierSwitchRequestRow,
} from "@/lib/operations/types";
import type { CustomerInfoRequestRow } from "@/lib/onboarding/infoRequests";
import SubmitButton from "@/components/admin/customers/document-card/SubmitButton";
import CustomerOperationAutomationForm from "@/components/admin/customers/CustomerOperationAutomationForm";
import CustomerProcessTimeline from "@/components/admin/customers/CustomerProcessTimeline";
import {
  buildCustomerCardSnapshot,
  type CustomerCardSnapshot,
} from "@/lib/customers/customerCardSnapshot";
import { meteringPointIdentityLabel } from "@/lib/customers/meteringIdentity";
import {
  buildCustomerCardWorkflow,
} from "@/lib/customer-operations/customerCardWorkflow";

export type Z01RepairEvent = {
  id: string;
  event_type: string;
  message: string | null;
  payload: Record<string, unknown> | null;
  created_at: string | null;
};

type Props = {
  customerId: string;
  companyId?: string | null;
  sites: CustomerSiteRow[];
  meteringPoints: MeteringPointRow[];
  powersOfAttorney?: PowerOfAttorneyRow[];
  documents?: CustomerAuthorizationDocumentRow[];
  infoRequests?: CustomerInfoRequestRow[];
  contracts?: CustomerContractRow[];
  switchRequests?: SupplierSwitchRequestRow[];
  snapshot?: CustomerCardSnapshot;
  isPlatformAdmin?: boolean;
  z01RepairEvents?: Z01RepairEvent[];
};

function z01PayloadValue(payload: Record<string, unknown> | null, key: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload[key];
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "ja" : "nej";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return null;
}

function z01PayloadAny(payload: Record<string, unknown> | null, keys: string[]): string | null {
  for (const key of keys) {
    const value = z01PayloadValue(payload, key);
    if (value) return value;
  }
  return null;
}

function z01EventDateLabel(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString("sv-SE");
}

function z01EventLabel(eventType: string): string {
  switch (eventType) {
    case "z01_dry_run_repair":
      return "Torrkörning";
    case "z01_repair_blocked":
      return "Reparation blockerad";
    case "z01_repair_failed":
      return "Reparation misslyckades";
    case "z01_repair_completed":
    case "z01_grid_owner_data_request_finalized_after_route_ready":
      return "Reparation";
    default:
      return "Z01-händelse";
  }
}

function pointLabel(point: MeteringPointRow | null): string {
  return meteringPointIdentityLabel(point) ?? "Mätpunkts-ID saknas";
}

function siteLabel(site: CustomerSiteRow | null): string {
  if (!site) return "Ingen anläggning vald";
  return `${site.site_name}${site.facility_id ? ` · ${site.facility_id}` : " · saknar anläggnings-ID"}`;
}

function StatusPill({
  ok,
  children,
}: {
  ok: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}
    >
      {children}
    </span>
  );
}

export default function CustomerBusinessActionsCard({
  customerId,
  companyId: suppliedCompanyId,
  sites,
  meteringPoints,
  powersOfAttorney = [],
  documents = [],
  infoRequests = [],
  contracts = [],
  switchRequests = [],
  snapshot: suppliedSnapshot,
  isPlatformAdmin = false,
  z01RepairEvents = [],
}: Props) {
  const snapshot =
    suppliedSnapshot ??
    buildCustomerCardSnapshot({
      sites,
      meteringPoints,
      powersOfAttorney,
      documents,
      infoRequests,
      contracts,
    });

  const workflow = buildCustomerCardWorkflow({
    customerId,
    snapshot,
    sites,
    meteringPoints,
    infoRequests,
    contracts,
    switchRequests,
    powersOfAttorney,
    isPlatformAdmin,
  });

  // Derive companyId: prefer explicit prop, then fall back to first infoRequest or site
  const companyId =
    suppliedCompanyId ??
    infoRequests.find((r) => r.company_id)?.company_id ??
    sites.find((s) => s.company_id)?.company_id ??
    null;

  const primarySite = snapshot.primarySite;
  const primaryPoint = snapshot.primaryMeteringPoint;
  const gridOwnerId =
    primaryPoint?.grid_owner_id ?? primarySite?.grid_owner_id ?? "";
  const activeContract =
    contracts.find((contract) =>
      ["active", "signed", "pending_signature"].includes(
        String(contract.status ?? ""),
      ),
    ) ??
    contracts[0] ??
    null;
  const activeSwitchRequest =
    switchRequests.find(
      (request) =>
        request.site_id === primarySite?.id &&
        [
          "queued",
          "validated",
          "ready_to_send",
          "submitted",
          "waiting_response",
          "cancellation_requested",
        ].includes(String(request.status ?? "")),
    ) ??
    switchRequests[0] ??
    null;

  const businessActionId = `${customerId}:${primarySite?.id ?? "no-site"}:${primaryPoint?.id ?? "no-meter"}`;

  const renderBusinessActionHiddenFields = (action: string) => (
    <>
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="site_id" value={primarySite?.id ?? ""} />
      <input
        type="hidden"
        name="metering_point_id"
        value={primaryPoint?.id ?? ""}
      />
      <input
        type="hidden"
        name="switch_request_id"
        value={activeSwitchRequest?.id ?? ""}
      />
      <input
        type="hidden"
        name="idempotency_key"
        value={`${action}:${businessActionId}:${activeSwitchRequest?.id ?? "no-switch"}`}
      />
    </>
  );

  const showWaitMessage =
    workflow.primaryAction === "wait_for_grid_owner" ||
    workflow.primaryAction === "no_action_required";

  return (
    <section className="space-y-4">
      {/* Visual process overview */}
      <CustomerProcessTimeline
        steps={workflow.workflowSteps}
        showTechnical={isPlatformAdmin}
      />

      {/* Operational summary card */}
      <section className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
              Nästa åtgärd
            </p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">
              {workflow.adminMessage}
            </h2>
            {workflow.nextRequiredAction ? (
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                {workflow.nextRequiredAction}
              </p>
            ) : null}
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">
            {siteLabel(primarySite)} · {pointLabel(primaryPoint)}
          </span>
        </div>

        {/* Readiness pills */}
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusPill ok={snapshot.hasAuthorization}>
            {snapshot.hasAuthorization ? "Fullmakt" : "Fullmakt saknas"}
          </StatusPill>
          <StatusPill ok={snapshot.hasFacilityId}>
            {snapshot.hasFacilityId ? "Anläggnings-ID" : "Anläggnings-ID saknas"}
          </StatusPill>
          <StatusPill ok={snapshot.hasGridOwner}>
            {snapshot.hasGridOwner ? "Nätägare" : "Nätägare saknas"}
          </StatusPill>
          <StatusPill ok={snapshot.hasGridArea}>
            {snapshot.hasGridArea ? "Nätområde" : "Nätområde saknas"}
          </StatusPill>
        </div>

        {/* Blocker message - in plain Swedish, no internal codes */}
        {workflow.blockerAdminMessage && workflow.primaryAction === "review_blocker" ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-900">Åtgärd krävs</p>
            <p className="mt-1 text-sm text-amber-800">{workflow.blockerAdminMessage}</p>
          </div>
        ) : null}

        {/* Primary CTA */}
        <div className="mt-5">
          {showWaitMessage ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              {workflow.adminMessage}
            </div>
          ) : workflow.primaryAction === "request_data" ||
            workflow.primaryAction === "continue_data_request" ? (
            <div className="rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">
                {workflow.primaryAction === "continue_data_request"
                  ? "Fortsätt uppgiftsbegäran"
                  : "Begär uppgifter"}
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                Systemet begär anläggningsuppgifter från nätägaren och förbereder
                Ediel-meddelandet i bakgrunden.
              </p>
              <div className="mt-4">
                <CustomerOperationAutomationForm
                  kind="customer_data"
                  customerId={customerId}
                  siteId={primarySite?.id}
                  meteringPointId={primaryPoint?.id}
                  idleLabel={
                    workflow.primaryAction === "continue_data_request"
                      ? "Fortsätt uppgiftsbegäran"
                      : "Begär uppgifter"
                  }
                  pendingLabel="Startar…"
                />
              </div>
            </div>
          ) : workflow.primaryAction === "create_supplier_switch" ? (
            <div className="rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">
                Begär leverantörsbyte
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                Uppgifter mottagna. Systemet kontrollerar alla förutsättningar
                innan leverantörsbyte startas.
              </p>
              <div className="mt-4">
                <CustomerOperationAutomationForm
                  kind="supplier_switch"
                  customerId={customerId}
                  siteId={primarySite?.id}
                  meteringPointId={primaryPoint?.id}
                  idleLabel="Begär leverantörsbyte"
                  pendingLabel="Startar…"
                />
              </div>
            </div>
          ) : workflow.primaryAction === "review_blocker" ? (
            <div className="rounded-3xl border border-amber-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">
                Granska blockerare
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                Uppgiftsbegäran är blockerad. Se processöversikten ovan för detaljer
                och kontakta plattformsadministratören vid behov.
              </p>
              <div className="mt-4 flex gap-3">
                <Link
                  href={`/admin/customer-info-requests`}
                  className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
                >
                  Visa uppgiftsbegäran
                </Link>
              </div>
            </div>
          ) : null}
        </div>

        {/* Secondary actions */}
        <div className="mt-4 flex flex-wrap gap-3">
          {workflow.secondaryActions.map((action) => (
            <Link
              key={action.id}
              href={action.href ?? "#"}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {action.label}
            </Link>
          ))}
        </div>

        {/* Technical / advanced actions — platform admin only */}
        {isPlatformAdmin ? (
          <details className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <summary className="cursor-pointer font-semibold text-slate-900">
              Tekniska åtgärder
            </summary>
            <div className="mt-4 space-y-4">
              {/* Technical details */}
              {Object.entries(workflow.technicalDetails).some(([, v]) => Boolean(v)) ? (
                <div className="rounded-xl bg-slate-50 p-3 font-mono text-xs text-slate-600 space-y-1">
                  {workflow.technicalDetails.customerInfoRequestId ? (
                    <div>customer_info_request: {workflow.technicalDetails.customerInfoRequestId}</div>
                  ) : null}
                  {workflow.technicalDetails.gridOwnerDataRequestId ? (
                    <div>grid_owner_data_request: {workflow.technicalDetails.gridOwnerDataRequestId}</div>
                  ) : null}
                  {workflow.technicalDetails.outboundRequestId ? (
                    <div>outbound_request: {workflow.technicalDetails.outboundRequestId}</div>
                  ) : null}
                  {workflow.technicalDetails.edielMessageId ? (
                    <div>ediel_message: {workflow.technicalDetails.edielMessageId}</div>
                  ) : null}
                  {workflow.technicalDetails.communicationRouteId ? (
                    <div>communication_route: {workflow.technicalDetails.communicationRouteId}</div>
                  ) : null}
                  {workflow.technicalDetails.edielRouteProfileId ? (
                    <div>ediel_route_profile: {workflow.technicalDetails.edielRouteProfileId}</div>
                  ) : null}
                  {workflow.technicalDetails.operationId ? (
                    <div>operation_id: {workflow.technicalDetails.operationId}</div>
                  ) : null}
                  {workflow.technicalDetails.blockerCode ? (
                    <div>blocker_code: {workflow.technicalDetails.blockerCode}</div>
                  ) : null}
                  {workflow.technicalDetails.routeResolutionStatus ? (
                    <div>route_resolution_status: {workflow.technicalDetails.routeResolutionStatus}</div>
                  ) : null}
                </div>
              ) : null}

              {/* Visible result of the latest Z01 dry-run/repair so clicking the
                  button never looks like nothing happened. Shown regardless of
                  canRunRepair (a successful repair changes the blocker code and
                  would otherwise hide this section). */}
              {z01RepairEvents.length > 0 ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
                  <p className="text-sm font-semibold text-emerald-900">Senaste Z01-reparation / torrkörning</p>
                  {z01RepairEvents.slice(0, 3).map((event) => {
                    const dateLabel = z01EventDateLabel(event.created_at);
                    const environment = z01PayloadAny(event.payload, ["environment"]);
                    const outboundRequestId = z01PayloadAny(event.payload, ["outboundRequestId", "outbound_request_id"]);
                    const routeProfileId = z01PayloadAny(event.payload, ["edielRouteProfileId", "ediel_route_profile_id"]);
                    const senderEdielId = z01PayloadAny(event.payload, ["senderEdielId", "sender_ediel_id"]);
                    const blockerCode = z01PayloadAny(event.payload, ["blockerCode", "new_blocker_code", "blocker_code"]);
                    const edielMessageId = z01PayloadAny(event.payload, ["edielMessageId", "ediel_message_id"]);
                    const smtpSent = z01PayloadAny(event.payload, ["smtpSent", "smtp_sent"]);
                    const nextRequiredAction = z01PayloadAny(event.payload, ["nextRequiredAction", "next_required_action"]);
                    return (
                      <div key={event.id} className="rounded-xl bg-white/70 p-3 text-xs text-emerald-900">
                        <div className="font-medium">
                          {z01EventLabel(event.event_type)}
                          {dateLabel ? ` · ${dateLabel}` : ""}
                        </div>
                        {event.message ? <div className="mt-1 text-emerald-800">{event.message}</div> : null}
                        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] text-emerald-700">
                          {environment ? (
                            <><dt>miljö</dt><dd>{environment}</dd></>
                          ) : null}
                          {outboundRequestId ? (
                            <><dt>outbound</dt><dd>{outboundRequestId}</dd></>
                          ) : null}
                          {routeProfileId ? (
                            <><dt>route profile</dt><dd>{routeProfileId}</dd></>
                          ) : null}
                          {senderEdielId ? (
                            <><dt>sender Ediel-ID</dt><dd>{senderEdielId}</dd></>
                          ) : null}
                          {blockerCode ? (
                            <><dt>blockerkod</dt><dd>{blockerCode}</dd></>
                          ) : null}
                          {edielMessageId ? (
                            <><dt>ediel-meddelande</dt><dd>{edielMessageId}</dd></>
                          ) : (
                            <><dt>ediel-meddelande</dt><dd>ej skapat</dd></>
                          )}
                          <dt>SMTP skickad</dt><dd>{smtpSent ?? "nej"}</dd>
                        </dl>
                        {nextRequiredAction ? (
                          <p className="mt-1 text-emerald-800">Nästa åtgärd: {nextRequiredAction}</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {/* Repair Z01 chain — platform admin only, requires canRunRepair */}
              {(workflow.canRunRepair || workflow.canContinueFinalization) && companyId ? (
                <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-orange-900">{workflow.canContinueFinalization ? "Fortsätt Z01-finalisering" : "Reparera Z01-kedja"}</p>
                    <p className="mt-1 text-xs text-orange-700">
                      {workflow.canContinueFinalization
                        ? "Route-blockeringen verkar vara åtgärdad. Kör om finaliseringen för att skapa PRODAT Z01-utkast. Ingen SMTP skickas direkt."
                        : "Det finns en uppgiftsbegäran utan outbound-förfrågan. Finalisering skapar outbound och förbereder Ediel-meddelandet utan att skicka SMTP direkt."}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <form action={repairZ01CustomerInfoRequestAction}>
                      <input type="hidden" name="company_id" value={companyId} />
                      <input type="hidden" name="customer_id" value={customerId} />
                      {workflow.technicalDetails.customerInfoRequestId ? (
                        <input type="hidden" name="customer_info_request_id" value={workflow.technicalDetails.customerInfoRequestId} />
                      ) : null}
                      {workflow.technicalDetails.gridOwnerDataRequestId ? (
                        <input type="hidden" name="grid_owner_data_request_id" value={workflow.technicalDetails.gridOwnerDataRequestId} />
                      ) : null}
                      <input type="hidden" name="environment" value="production" />
                      <SubmitButton
                        idleLabel={workflow.canContinueFinalization ? "Fortsätt Z01-finalisering" : "Reparera uppgiftsbegäran"}
                        pendingLabel={workflow.canContinueFinalization ? "Finaliserar…" : "Reparerar…"}
                      />
                    </form>
                    <form action={dryRunZ01RepairAction}>
                      <input type="hidden" name="company_id" value={companyId} />
                      <input type="hidden" name="customer_id" value={customerId} />
                      {workflow.technicalDetails.customerInfoRequestId ? (
                        <input type="hidden" name="customer_info_request_id" value={workflow.technicalDetails.customerInfoRequestId} />
                      ) : null}
                      {workflow.technicalDetails.gridOwnerDataRequestId ? (
                        <input type="hidden" name="grid_owner_data_request_id" value={workflow.technicalDetails.gridOwnerDataRequestId} />
                      ) : null}
                      <input type="hidden" name="environment" value="production" />
                      <SubmitButton
                        idleLabel={workflow.canContinueFinalization ? "Testa finalisering" : "Testa reparation"}
                        pendingLabel="Testar…"
                      />
                    </form>
                  </div>
                  {workflow.technicalDetails.gridOwnerDataRequestId ? (
                    <p className="text-xs font-mono text-orange-600">
                      grid_owner_data_request: {workflow.technicalDetails.gridOwnerDataRequestId}
                    </p>
                  ) : null}
                  {workflow.technicalDetails.customerInfoRequestId ? (
                    <p className="text-xs font-mono text-orange-600">
                      customer_info_request: {workflow.technicalDetails.customerInfoRequestId}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-3">
                <form
                  action={sendCustomerConfirmationBusinessAction}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  {renderBusinessActionHiddenFields("send_confirmation")}
                  <SubmitButton
                    idleLabel="Skicka bekräftelsemail"
                    pendingLabel="Skickar…"
                  />
                </form>
                <form
                  action={registerCancellationBusinessAction}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  {renderBusinessActionHiddenFields("register_cancellation")}
                  <input
                    type="hidden"
                    name="reason"
                    value="Kunden har registrerat ånger från kundkortet."
                  />
                  <SubmitButton
                    idleLabel="Registrera ånger"
                    pendingLabel="Registrerar…"
                  />
                </form>
                <form
                  action={endAgreementBusinessAction}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  {renderBusinessActionHiddenFields(
                    `end_agreement:${activeContract?.id ?? "customer"}`,
                  )}
                  <input
                    type="hidden"
                    name="reason"
                    value="Avslut av avtal påbörjat från kundkortet."
                  />
                  <SubmitButton idleLabel="Avsluta avtal" pendingLabel="Startar…" />
                </form>
                <form
                  action={createGridOwnerDataRequestAction}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  <input type="hidden" name="customer_id" value={customerId} />
                  <input type="hidden" name="site_id" value={primarySite?.id ?? ""} />
                  <input
                    type="hidden"
                    name="metering_point_id"
                    value={primaryPoint?.id ?? ""}
                  />
                  <input type="hidden" name="grid_owner_id" value={gridOwnerId} />
                  <input
                    type="hidden"
                    name="request_scope"
                    value="customer_masterdata"
                  />
                  <SubmitButton
                    idleLabel="Begär anläggningsuppgifter (manuellt)"
                    pendingLabel="Skapar…"
                  />
                </form>
                <form
                  action={requestMeteringAccessBusinessAction}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  {renderBusinessActionHiddenFields("request_metering_access")}
                  <SubmitButton
                    idleLabel="Begär mätvärdesåtkomst"
                    pendingLabel="Begär…"
                  />
                </form>
                <form
                  action={requestHistoricalMeteringAccessBusinessAction}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  {renderBusinessActionHiddenFields(
                    "request_historical_metering_access",
                  )}
                  <SubmitButton
                    idleLabel="Hämta mätvärden"
                    pendingLabel="Kontrollerar…"
                  />
                </form>
                <form
                  action={terminateMeteringAccessBusinessAction}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  {renderBusinessActionHiddenFields("terminate_metering_access")}
                  <SubmitButton
                    idleLabel="Avsluta mätvärdesåtkomst"
                    pendingLabel="Avslutar…"
                  />
                </form>
              </div>
            </div>
          </details>
        ) : null}
      </section>
    </section>
  );
}
