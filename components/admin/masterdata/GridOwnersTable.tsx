import Link from "next/link";
import type { GridOwnerRow } from "@/lib/masterdata/types";
import {
  acknowledgeGridOwnerReviewsAction,
  confirmEmptyGridOwnerSubaddressAction,
  searchGridOwnerCertificateNowAction,
} from "@/app/admin/network-owners/actions";

type GridOwnersTableProps = {
  gridOwners: GridOwnerRow[];
};

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        active ? "bg-emerald-100 text-emerald-700 " : "bg-slate-100 text-slate-700 ",
      ].join(" ")}
    >
      {active ? "Aktiv" : "Inaktiv"}
    </span>
  );
}

function VerificationBadge({ status }: { status?: string | null }) {
  const normalized = status ?? "needs_review";
  const labels: Record<string, string> = {
    verified: "Verifierad",
    needs_route: "Saknar route",
    needs_certificate: "Saknar certifikat",
    needs_ediel_id: "Saknar EDIEL-id",
    needs_subaddress: "Saknar subadress",
    ambiguous_subaddress: "Välj subadress",
    needs_contact: "Saknar kontaktväg",
    unresolved_duplicate: "Dubblett",
    excluded_from_electricity_scope: "Exkluderad från elhandel",
    manual_review_required: "Manuell review",
  };
  const tone = normalized === "verified"
    ? "bg-emerald-100 text-emerald-800 border-emerald-200"
    : normalized === "excluded_from_electricity_scope"
      ? "bg-slate-100 text-slate-700 border-slate-200"
      : normalized === "unresolved_duplicate" || normalized === "ambiguous_subaddress"
        ? "bg-red-100 text-red-800 border-red-200"
        : "bg-amber-100 text-amber-900 border-amber-200";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>{labels[normalized] ?? normalized}</span>;
}

function CertificateBadge({ status }: { status?: string | null }) {
  const normalized = status ?? "saknas";
  const labels: Record<string, string> = {
    finns: "Certifikat finns",
    saknas: "Certifikat saknas",
    utgånget: "Utgånget certifikat",
    fel_miljö: "Fel miljö",
    fel_mottagare: "Fel mottagare",
  };
  const tone = normalized === "finns" ? "text-emerald-700" : "text-amber-800";
  return <span className={`text-xs font-medium ${tone}`}>{labels[normalized] ?? normalized}</span>;
}

function ReadinessPill({ ready, label }: { ready?: boolean | null; label: string }) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        ready ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600",
      ].join(" ")}
    >
      {label}: {ready ? "Ja" : "Nej"}
    </span>
  );
}

function SubaddressLine({
  label,
  value,
  status,
  source,
}: {
  label: string;
  value?: string | null;
  status?: string | null;
  source?: string | null;
}) {
  const statusLabel: Record<string, string> = {
    verified: "verifierad",
    not_required_confirmed: "tom verifierad",
    missing: "saknas",
    ambiguous: "behöver väljas",
  };
  return (
    <div className="mt-1 text-xs text-slate-600">
      {label}: {value || status === "not_required_confirmed" ? value || "tom" : "saknas"}
      {status ? ` • ${statusLabel[status] ?? status}` : ""}
      {source && source !== "missing" ? ` • ${source}` : ""}
    </div>
  );
}

function EmptySubaddressAction({ owner, family }: { owner: GridOwnerRow; family: "PRODAT" | "UTILTS" }) {
  return (
    <form action={confirmEmptyGridOwnerSubaddressAction} className="mt-2">
      <input type="hidden" name="grid_owner_id" value={owner.id} />
      <input type="hidden" name="message_family" value={family} />
      <input type="hidden" name="note" value={`Tom ${family}-subadress verifierad i nätägarvyn.`} />
      <button
        type="submit"
        className="inline-flex items-center rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
      >
        Markera tom {family} som verifierad
      </button>
    </form>
  );
}

export default function GridOwnersTable({ gridOwners }: GridOwnersTableProps) {
  if (gridOwners.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center ">
        <h3 className="text-lg font-semibold text-slate-900 ">Inga nätägare ännu</h3>
        <p className="mt-2 text-sm text-slate-700 ">Skapa första nätägaren för att börja koppla anläggningar och mätpunkter korrekt.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
      <div className="border-b border-slate-200 px-6 py-4 ">
        <h2 className="text-lg font-semibold text-slate-900 ">Registrerade nätägare</h2>
        <p className="mt-1 text-sm text-slate-600">
          Tabellen visar om aktören kan användas i elhandelns kundintag, PRODAT, UTILTS och leverantörsbyte. Gas, test och rena systemaktörer visas som exkluderade och blockerar inte elflödet.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 ">
            <tr className="text-left text-slate-700 ">
              <th className="px-6 py-3 font-medium">Namn</th>
              <th className="px-6 py-3 font-medium">EDIEL/org</th>
              <th className="px-6 py-3 font-medium">Route och subadress</th>
              <th className="px-6 py-3 font-medium">Certifikat</th>
              <th className="px-6 py-3 font-medium">Readiness</th>
              <th className="px-6 py-3 font-medium">Verifiering</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 font-medium text-right">Åtgärd</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-200 ">
            {gridOwners.map((owner) => (
              <tr key={owner.id} className="align-top text-slate-800 ">
                <td className="px-6 py-4">
                  <div className="font-medium">{owner.name}</div>
                  <div className="mt-1 text-xs text-slate-700 ">{owner.city || "—"} {owner.country ? `• ${owner.country}` : ""}</div>
                  {owner.excluded_from_electricity_scope ? (
                    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">Exkluderad från elhandelns leverantörsbyte</div>
                  ) : null}
                  {Number(owner.duplicate_count ?? 0) > 1 ? (
                    <div className="mt-2 text-xs font-semibold text-red-700">Möjlig dubblett: {owner.duplicate_count} träffar</div>
                  ) : null}
                </td>
                <td className="px-6 py-4">
                  <div>{owner.ediel_id ?? "—"}</div>
                  <div className="mt-1 text-xs text-slate-600">{owner.org_number ?? "Org.nr saknas"}</div>
                </td>
                <td className="px-6 py-4">
                  <div>{owner.route_status === "verified" ? "Verifierad route" : "Route behöver kontroll"}</div>
                  <div className="mt-1 text-xs text-slate-600">PRODAT {owner.prodat_route_count ?? 0} • UTILTS {owner.utilts_route_count ?? 0}</div>
                  <SubaddressLine label="PRODAT" value={owner.default_prodat_subaddress} status={owner.prodat_subaddress_status} source={owner.prodat_subaddress_source} />
                  <SubaddressLine label="UTILTS" value={owner.default_utilts_subaddress} status={owner.utilts_subaddress_status} source={owner.utilts_subaddress_source} />
                  {(owner.prodat_route_count ?? 0) > 0 && owner.prodat_subaddress_status === "missing" ? <EmptySubaddressAction owner={owner} family="PRODAT" /> : null}
                  {(owner.utilts_route_count ?? 0) > 0 && owner.utilts_subaddress_status === "missing" ? <EmptySubaddressAction owner={owner} family="UTILTS" /> : null}
                </td>
                <td className="px-6 py-4">
                  <CertificateBadge status={owner.certificate_status} />
                  <div className="mt-1 text-xs text-slate-600">{owner.certificate_environment ?? owner.environment ?? "production"}</div>
                  {owner.certificate_fingerprint_sha256 ? (
                    <div className="mt-1 max-w-[180px] truncate text-xs text-slate-500">{owner.certificate_fingerprint_sha256}</div>
                  ) : null}
                  {owner.certificate_source ? <div className="mt-1 text-xs text-slate-500">Källa: {owner.certificate_source}</div> : null}
                </td>
                <td className="px-6 py-4">
                  <div className="flex max-w-[220px] flex-wrap gap-1.5">
                    <ReadinessPill ready={owner.can_use_for_prodat} label="PRODAT" />
                    <ReadinessPill ready={owner.can_use_for_utilts} label="UTILTS" />
                    <ReadinessPill ready={owner.can_start_supplier_switch} label="Leverantörsbyte" />
                  </div>
                  <div className="mt-2 text-xs text-slate-600">{owner.communication_email ?? owner.email ?? owner.phone ?? "Ingen kontaktinfo"}</div>
                  {owner.manual_review_required ? <div className="mt-1 text-xs font-semibold text-amber-800">Manuell review: {owner.manual_review_reason ?? "krävs"}</div> : null}
                  {owner.supplier_switch_readiness_status ? <div className="mt-1 text-xs text-slate-500">Switch-status: {owner.supplier_switch_readiness_status}</div> : null}
                </td>
                <td className="px-6 py-4">
                  <VerificationBadge status={owner.verification_status} />
                  {owner.verification_reasons?.length ? (
                    <div className="mt-2 max-w-xs text-xs text-slate-600">{owner.verification_reasons.join(", ")}</div>
                  ) : null}
                </td>
                <td className="px-6 py-4">
                  <StatusBadge active={owner.is_active} />
                  <div className="mt-2 text-xs text-slate-600">{owner.actor_registry_status ?? "under_review"}</div>
                  {owner.excluded_from_electricity_scope !== true && owner.verification_status !== "verified" ? (
                    <form action={acknowledgeGridOwnerReviewsAction} className="mt-2">
                      <input type="hidden" name="grid_owner_id" value={owner.id} />
                      <button type="submit" className="text-xs font-semibold text-slate-600 underline-offset-2 hover:underline">Markera granskad</button>
                    </form>
                  ) : null}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex flex-col items-end gap-2">
                    <Link
                      href={`/admin/network-owners?edit=${owner.id}`}
                      className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 "
                    >
                      Redigera
                    </Link>
                    {owner.excluded_from_electricity_scope !== true ? (
                      <form action={searchGridOwnerCertificateNowAction}>
                        <input type="hidden" name="grid_owner_id" value={owner.id} />
                        <button
                          type="submit"
                          className="inline-flex items-center rounded-xl border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 "
                        >
                          Sök certifikat nu
                        </button>
                      </form>
                    ) : null}
                    <Link
                      href="/admin/ediel/auto-readiness"
                      className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 "
                    >
                      Tekniska detaljer
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
