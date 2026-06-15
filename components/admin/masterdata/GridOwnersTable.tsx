import Link from "next/link";
import type { GridOwnerRow } from "@/lib/masterdata/types";

type GridOwnersTableProps = {
  gridOwners: GridOwnerRow[];
};

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        active
          ? "bg-emerald-100 text-emerald-700 "
          : "bg-slate-100 text-slate-700 ",
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
    needs_contact: "Saknar kontaktväg",
    unresolved_duplicate: "Dubblett",
  };
  const tone = normalized === "verified"
    ? "bg-emerald-100 text-emerald-800 border-emerald-200"
    : normalized === "unresolved_duplicate"
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

export default function GridOwnersTable({ gridOwners }: GridOwnersTableProps) {
  if (gridOwners.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center ">
        <h3 className="text-lg font-semibold text-slate-900 ">
          Inga nätägare ännu
        </h3>
        <p className="mt-2 text-sm text-slate-700 ">
          Skapa första nätägaren för att börja koppla anläggningar och
          mätpunkter korrekt.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
      <div className="border-b border-slate-200 px-6 py-4 ">
        <h2 className="text-lg font-semibold text-slate-900 ">
          Registrerade nätägare
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Tabellen visar om nätägaren kan användas i kundintag och Ediel-flöden. Postnummer/adress kan ge förslag, men verifierad sanning kräver EDIEL-id, route, subadress, kontaktväg och certifikat där det behövs.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 ">
            <tr className="text-left text-slate-700 ">
              <th className="px-6 py-3 font-medium">Namn</th>
              <th className="px-6 py-3 font-medium">EDIEL/org</th>
              <th className="px-6 py-3 font-medium">Route</th>
              <th className="px-6 py-3 font-medium">Certifikat</th>
              <th className="px-6 py-3 font-medium">Kontakt</th>
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
                  <div className="mt-1 text-xs text-slate-700 ">
                    {owner.city || "—"} {owner.country ? `• ${owner.country}` : ""}
                  </div>
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
                  <div className="mt-1 text-xs text-slate-600">Subadress: {owner.default_prodat_subaddress ?? owner.default_utilts_subaddress ?? "saknas"}</div>
                </td>
                <td className="px-6 py-4">
                  <CertificateBadge status={owner.certificate_status} />
                  <div className="mt-1 text-xs text-slate-600">{owner.certificate_environment ?? owner.environment ?? "production"}</div>
                </td>
                <td className="px-6 py-4">
                  <div>{owner.contact_name ?? "—"}</div>
                  <div className="mt-1 text-xs text-slate-700 ">
                    {owner.communication_email ?? owner.email ?? owner.phone ?? "Ingen kontaktinfo"}
                  </div>
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
                </td>
                <td className="px-6 py-4 text-right">
                  <Link
                    href={`/admin/network-owners?edit=${owner.id}`}
                    className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 "
                  >
                    Redigera
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
