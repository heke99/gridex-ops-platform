import Link from "next/link";
import type {
  CustomerSiteRow,
  GridOwnerRow,
  MeteringPointRow,
} from "@/lib/masterdata/types";
import type { CustomerInfoRequestRow } from "@/lib/onboarding/infoRequests";
import type {
  CustomerAuthorizationDocumentRow,
  PowerOfAttorneyRow,
} from "@/lib/operations/types";
import {
  facilityMissingFieldLabel,
  facilityStatusLabel,
  type FacilityWorkQueueStatus,
} from "@/lib/facility/workQueue";
import {
  hasValidPowerOfAttorney,
  type CustomerCardSnapshot,
} from "@/lib/customers/customerCardSnapshot";
import { hasMeteringPointIdentity, meteringPointIdentityLabel } from "@/lib/customers/meteringIdentity";

type FacilityCardItem = {
  siteId: string;
  siteLabel: string;
  facilityId: string | null;
  meteringPointId: string | null;
  gridOwnerName: string | null;
  gridAreaCode: string | null;
  priceAreaCode: string | null;
  missingFields: string[];
  status: FacilityWorkQueueStatus;
  statusDescription: string;
  nextAction: string;
  href: string;
};

function activeRequestStatuses(status: string): boolean {
  return [
    "pending",
    "sent",
    "waiting_response",
    "waiting_for_z02",
    "z01_prepared",
    "ready_to_send",
    "manual_review_required",
  ].includes(status);
}

function statusTone(status: FacilityWorkQueueStatus): string {
  switch (status) {
    case "ready_for_switch":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "awaiting_grid_owner":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "missing_authorization":
    case "needs_grid_owner_review":
    case "manual_review":
      return "border-red-200 bg-red-50 text-red-900";
    default:
      return "border-slate-200 bg-slate-50 text-slate-800";
  }
}

function gridOwnerName(
  gridOwners: GridOwnerRow[],
  gridOwnerId: string | null,
): string | null {
  if (!gridOwnerId) return null;
  const owner = gridOwners.find((row) => row.id === gridOwnerId);
  return owner?.name ?? owner?.owner_code ?? gridOwnerId;
}

function pointLabel(point: MeteringPointRow | undefined): string | null {
  return meteringPointIdentityLabel(point);
}

function firstText(...values: Array<string | null | undefined>): string | null {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}

function siteLabel(site: CustomerSiteRow): string {
  return (
    site.site_name ||
    site.facility_id ||
    [site.street, site.postal_code, site.city].filter(Boolean).join(", ") ||
    "Anläggning"
  );
}

function buildFacilityItems(input: {
  customerId: string;
  sites: CustomerSiteRow[];
  meteringPoints: MeteringPointRow[];
  infoRequests: CustomerInfoRequestRow[];
  powersOfAttorney: PowerOfAttorneyRow[];
  documents?: CustomerAuthorizationDocumentRow[];
  gridOwners: GridOwnerRow[];
  snapshot?: CustomerCardSnapshot;
}): FacilityCardItem[] {
  const hasSignedPower =
    input.snapshot?.hasAuthorization ??
    hasValidPowerOfAttorney(input.powersOfAttorney, input.documents ?? []);

  return input.sites.map((site) => {
    const points = input.meteringPoints.filter(
      (point) => point.site_id === site.id,
    );
    const primaryPoint =
      points.find((point) => point.status === "active") ?? points[0];
    const effectiveGridOwnerId = firstText(
      site.grid_owner_id,
      primaryPoint?.grid_owner_id,
    );
    const effectiveGridAreaCode = firstText(
      site.grid_area_code,
      primaryPoint?.grid_area_code,
    );
    const effectivePriceAreaCode = firstText(
      site.price_area_code,
      primaryPoint?.price_area_code,
    );
    const hasMeteringPoint = points.some(hasMeteringPointIdentity);
    const openRequest = input.infoRequests.some((request) => {
      const sameSite =
        request.site_id === site.id ||
        (!request.site_id && request.customer_id === input.customerId);
      return sameSite && activeRequestStatuses(request.status);
    });
    const missingFields = [
      site.facility_id?.trim() ? null : "facility_id",
      effectiveGridOwnerId ? null : "grid_owner",
      effectivePriceAreaCode ? null : "price_area",
      effectiveGridAreaCode ? null : "grid_area",
      hasMeteringPoint ? null : "metering_point_id",
      hasSignedPower ? null : "power_of_attorney",
    ].filter((value): value is string => Boolean(value));

    const status: FacilityWorkQueueStatus = openRequest
      ? "awaiting_grid_owner"
      : missingFields.length === 0
        ? "ready_for_switch"
        : missingFields.includes("power_of_attorney")
          ? "missing_authorization"
          : missingFields.includes("grid_owner")
            ? "needs_grid_owner_review"
            : "needs_facility_data";

    const nextAction =
      status === "ready_for_switch"
        ? "Starta leverantörsbyte"
        : status === "awaiting_grid_owner"
          ? "Följ upp svar"
          : status === "missing_authorization"
            ? "Kontrollera fullmakt"
            : status === "needs_grid_owner_review"
              ? "Verifiera nätägare"
              : "Begär uppgifter";

    return {
      siteId: site.id,
      siteLabel: siteLabel(site),
      facilityId: site.facility_id,
      meteringPointId: pointLabel(primaryPoint),
      gridOwnerName: gridOwnerName(input.gridOwners, effectiveGridOwnerId),
      gridAreaCode: effectiveGridAreaCode,
      priceAreaCode: effectivePriceAreaCode,
      missingFields,
      status,
      nextAction,
      href: `/admin/customers/${input.customerId}?tab=${status === "ready_for_switch" ? "switch-operations" : status === "missing_authorization" ? "authorization-documents" : "data-requests"}`,
      statusDescription: openRequest
        ? "Begäran är redan startad och väntar på nätägaren eller manuell uppföljning."
        : missingFields.length === 0
          ? "Anläggningen har tillräckliga uppgifter för nästa driftsteg."
          : `Saknas: ${missingFields.map(facilityMissingFieldLabel).join(", ")}.`,
    };
  });
}

export default function CustomerFacilityWorkflowCard(input: {
  customerId: string;
  sites: CustomerSiteRow[];
  meteringPoints: MeteringPointRow[];
  infoRequests: CustomerInfoRequestRow[];
  powersOfAttorney: PowerOfAttorneyRow[];
  documents?: CustomerAuthorizationDocumentRow[];
  gridOwners: GridOwnerRow[];
  snapshot?: CustomerCardSnapshot;
}) {
  const items = buildFacilityItems(input);
  const missingDataCount = items.filter(
    (item) => item.missingFields.length > 0,
  ).length;
  const waitingCount = items.filter(
    (item) => item.status === "awaiting_grid_owner",
  ).length;
  const readyCount = items.filter(
    (item) => item.status === "ready_for_switch",
  ).length;

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">
            Anläggningsflöde
          </p>
          <h2 className="mt-1 text-lg font-bold text-slate-950">
            Anläggningsuppgifter och nästa steg
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-700">
            Kunden får finnas kvar även när anläggnings-ID, mätpunkt eller
            nätägare saknas. Systemet kontrollerar anläggnings-ID, mätpunkt och
            nätägare innan leverantörsbyte kan begäras. Fullmakt räknas
            automatiskt när signerad fullmakt eller fullmaktsdokument finns.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">
            {missingDataCount} behöver kompletteras
          </span>
          <span className="rounded-full bg-sky-50 px-3 py-1 text-sky-800">
            {waitingCount} väntar svar
          </span>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">
            {readyCount} redo
          </span>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-700">
          Ingen anläggning finns ännu. Skapa anläggning eller använd
          kundintag/uppgiftsbegäran för att komplettera kunden.
        </div>
      ) : (
        <div className="mt-5 grid gap-3 xl:grid-cols-2">
          {items.map((item) => (
            <div
              key={item.siteId}
              className={`rounded-2xl border p-4 text-sm ${statusTone(item.status)}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-bold">{item.siteLabel}</div>
                  <div className="mt-1 text-xs opacity-80">
                    {facilityStatusLabel(item.status)}
                  </div>
                </div>
                <Link
                  href={item.href}
                  className="rounded-xl bg-white/80 px-3 py-1 text-xs font-bold text-slate-800 hover:bg-white"
                >
                  {item.nextAction}
                </Link>
              </div>
              <p className="mt-3 leading-6">{item.statusDescription}</p>
              <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                <div>
                  Anläggnings-ID:{" "}
                  <span className="font-bold">
                    {item.facilityId ?? "Saknas"}
                  </span>
                </div>
                <div>
                  Mätpunkt:{" "}
                  <span className="font-bold">
                    {item.meteringPointId ?? "Saknas"}
                  </span>
                </div>
                <div>
                  Nätägare:{" "}
                  <span className="font-bold">
                    {item.gridOwnerName ?? "Saknas"}
                  </span>
                </div>
                <div>
                  Nätområde:{" "}
                  <span className="font-bold">
                    {item.gridAreaCode ?? "Saknas"}
                  </span>
                </div>
                <div>
                  Elområde:{" "}
                  <span className="font-bold">
                    {item.priceAreaCode ?? "Saknas"}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <Link
          href="/admin/facility-requests"
          className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800"
        >
          Öppna anläggningskö
        </Link>
        <Link
          href={`/admin/customers/${input.customerId}?tab=data-requests`}
          className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50"
        >
          Begär uppgifter
        </Link>
      </div>
    </section>
  );
}
