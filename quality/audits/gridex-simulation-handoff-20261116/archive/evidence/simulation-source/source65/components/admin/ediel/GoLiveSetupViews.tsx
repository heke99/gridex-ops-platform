import Link from "next/link";
import type { ReactNode } from "react";
import type {
  GoLiveRouteSimulation,
  GoLiveSetupSummary,
  GoLiveSetupStatus,
} from "@/lib/ediel/platformGoLive";

function statusLabel(status: GoLiveSetupStatus): string {
  if (status === "ready") return "Redo";
  if (status === "manual_review_required") return "Granska";
  return "Blockerad";
}

function statusTone(status: GoLiveSetupStatus): string {
  if (status === "ready")
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "manual_review_required")
    return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-red-200 bg-red-50 text-red-800";
}

function boolTone(value: boolean): string {
  return value
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-red-200 bg-red-50 text-red-800";
}

function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${tone}`}
    >
      {children}
    </span>
  );
}

function CheckCard({
  label,
  value,
  description,
}: {
  label: string;
  value: boolean;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-950">{label}</h3>
        <Badge tone={boolTone(value)}>{value ? "Klar" : "Saknas"}</Badge>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-700">{description}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-bold text-slate-950">
        {value || "–"}
      </div>
    </div>
  );
}

function transportLabel(mode: GoLiveRouteSimulation["transportMode"]): string {
  if (mode === "shared_platform_mailbox") return "Gridex shared transport";
  if (mode === "company_specific_mailbox") return "Bolagsspecifik mailbox";
  return "Saknas";
}

function RouteSimulationCard({
  simulation,
}: {
  simulation: GoLiveRouteSimulation;
}) {
  const transportReady = simulation.transportMode !== "missing";
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-700">
            Route-simulering
          </p>
          <h2 className="mt-2 text-xl font-black text-slate-950">
            Aktivera PRODAT utan manuell receiver
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
            Huvudregeln är enkel: tenantens Ediel-ID skickar, mottagaren löses
            automatiskt via kund → anläggning → verifierad nätägare, och Gridex
            shared mailbox är bara transportkanal.
          </p>
        </div>
        <Badge
          tone={
            simulation.blockers.length > 0
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }
        >
          {simulation.blockers.length > 0 ? "Blockerad" : "Kan simuleras"}
        </Badge>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Info
          label="Sender Ediel-ID"
          value={
            <span className="font-mono text-xs">
              {simulation.senderEdielId ?? "–"}
            </span>
          }
        />
        <Info
          label="Sender subadress"
          value={simulation.senderSubAddress ?? "Ingen standard-subadress"}
        />
        <Info
          label="Mottagare"
          value="Automatiskt via kundens verifierade nätägare"
        />
        <Info label="Kvittens" value="CONTRL + APERAK enligt regelmotor" />
        <Info
          label="Gridex S/MIME transport"
          value={transportReady ? "Redo" : "Saknas"}
        />
        <Info
          label="Mottagarcertifikat"
          value="Kontrolleras per nätägare vid sändning"
        />
        <Info
          label="Kryptering"
          value={
            simulation.encryptionRequired
              ? "PRODAT krypteras i production"
              : "Ej krav"
          }
        />
        <Info label="Transportläge" value={transportLabel(simulation.transportMode)} />
      </div>

      <details className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <summary className="cursor-pointer text-sm font-black text-slate-800">
          Visa tekniska detaljer
        </summary>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Info label="Message family" value={simulation.messageFamily} />
          <Info label="Process" value={simulation.processType} />
          <Info label="Receiver source" value={simulation.receiverSource} />
          <Info
            label="Fast receiver"
            value={simulation.receiverEdielId ?? "Dynamisk via nätägare/process"}
          />
          <Info
            label="Receiver subadress"
            value={simulation.receiverSubAddress ?? "Endast om route kräver det"}
          />
          <Info
            label="Application Reference"
            value={simulation.applicationReference ?? "–"}
          />
          <Info label="Transport" value={transportLabel(simulation.transportMode)} />
          <Info
            label="Krypteringspolicy"
            value={
              simulation.encryptionRequired
                ? "Krävs för PRODAT production"
                : "Ej krav"
            }
          />
        </div>
      </details>
    </section>
  );
}

export function GoLiveSetupOverview({
  summaries,
}: {
  summaries: GoLiveSetupSummary[];
}) {
  const ready = summaries.filter(
    (summary) => summary.status === "ready",
  ).length;
  const review = summaries.filter(
    (summary) => summary.status === "manual_review_required",
  ).length;
  const blocked = summaries.filter(
    (summary) => summary.status === "blocked",
  ).length;

  return (
    <section className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Info label="Bolag" value={summaries.length} />
        <Info label="Redo" value={ready} />
        <Info label="Granska" value={review} />
        <Info label="Blockerade" value={blocked} />
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
              Go-live setup
            </p>
            <h2 className="mt-2 text-xl font-black text-slate-950">
              Tenant-readiness utan manuell receiver
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
              Tabellen skiljer på Ediel production, intern kundhantering och
              hemsida/API. Publicerade avtal och API är separata webbkrav;
              receiver ska härledas från process och verifierad motpart, inte
              skrivas för hand i kundintag.
            </p>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Bolag</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Ediel</th>
                <th className="px-4 py-3">Routes</th>
                <th className="px-4 py-3">Juridik</th>
                <th className="px-4 py-3">Nästa steg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summaries.map((summary) => (
                <tr key={summary.companyId} className="align-top">
                  <td className="px-4 py-4">
                    <Link
                      href={`/admin/platform/go-live/${summary.companyId}`}
                      className="font-bold text-slate-950 hover:text-emerald-700"
                    >
                      {summary.companyName ?? summary.companyId}
                    </Link>
                    <div className="mt-1 text-xs text-slate-500">
                      Score {summary.score}%
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <Badge tone={statusTone(summary.status)}>
                      {statusLabel(summary.status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-4 text-xs leading-6 text-slate-700">
                    <div>
                      Ediel:{" "}
                      <span className="font-mono">
                        {summary.edielId ?? "–"}
                      </span>
                    </div>
                    <div>
                      BRP:{" "}
                      <span className="font-mono">
                        {summary.brpEdielId ?? "–"}
                      </span>
                    </div>
                    <div>
                      Subadress: {summary.senderSubAddress ?? "Ej standardkrav"}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-xs leading-6 text-slate-700">
                    <div>
                      PRODAT: {summary.hasProdatRoute ? "klar" : "saknas"}
                    </div>
                    <div>
                      UTILTS: {summary.hasUtiltsRoute ? "klar" : "saknas"}
                    </div>
                    <div>
                      Transport:{" "}
                      {summary.sharedMailboxMode === "shared_platform_mailbox"
                        ? "shared"
                        : summary.sharedMailboxMode}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-xs leading-6 text-slate-700">
                    <div>
                      Villkor: {summary.legal.terms ? "klar" : "saknas"}
                    </div>
                    <div>
                      Integritet:{" "}
                      {summary.legal.privacy_policy ? "klar" : "saknas"}
                    </div>
                    <div>
                      Ångerrätt/fullmakt:{" "}
                      {summary.legal.withdrawal &&
                      summary.legal.power_of_attorney
                        ? "klar"
                        : "saknas"}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-xs leading-6 text-slate-700">
                    {summary.nextActions.slice(0, 2).map((action) => (
                      <div key={action}>{action}</div>
                    ))}
                  </td>
                </tr>
              ))}
              {summaries.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    Inga bolag hittades.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function CompanyGoLiveSetupPanel({
  summary,
}: {
  summary: GoLiveSetupSummary;
}) {
  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
              Tenant setup
            </p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">
              {summary.companyName ?? "Bolag"} · korrekt Ediel-grund
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
              Här visas det som faktiskt ska sättas per tenant: Ediel-ID, BRP,
              sender identity, shared transport, route-profiler och juridik.
              Hemsida/API visas separat och ska inte blockera Ediel production.
              Subadress visas som route-detalj, inte som obligatorisk tenant-inställning.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={statusTone(summary.status)}>
              {statusLabel(summary.status)}
            </Badge>
            <Badge tone="border-slate-200 bg-slate-50 text-slate-700">
              Score {summary.score}%
            </Badge>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Info
            label="Ediel-ID"
            value={
              <span className="font-mono text-xs">
                {summary.edielId ?? "–"}
              </span>
            }
          />
          <Info
            label="BRP"
            value={
              <span className="font-mono text-xs">
                {summary.brpEdielId ?? "–"}
              </span>
            }
          />
          <Info
            label="Subadresspolicy"
            value={
              summary.receiverSubAddressPolicy === "not_required_by_default"
                ? "Ingen tenant-subadress krävs som standard"
                : summary.receiverSubAddressPolicy
            }
          />
          <Info
            label="Mottagare"
            value={
              summary.routeResolutionMode === "automatic"
                ? "Automatiskt via kundens nätägare/process"
                : "Kräver granskning"
            }
          />
          <Info
            label="Transport"
            value={
              summary.sharedMailboxMode === "shared_platform_mailbox"
                ? "Shared Gridex mailbox"
                : summary.sharedMailboxMode
            }
          />
          <Info
            label="Sender identity"
            value={
              summary.hasSenderIdentity ? "Verifierad" : "Saknas/ej verifierad"
            }
          />
          <Info
            label="Hemsida/API"
            value={summary.hasPublishedContracts ? "Publicerade avtal finns" : "Separat webbkrav"}
          />
          <Info
            label="PRODAT/UTILTS"
            value={`${summary.hasProdatRoute ? "PRODAT klar" : "PRODAT saknas"} · ${summary.hasUtiltsRoute ? "UTILTS klar" : "UTILTS saknas"}`}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <CheckCard
          label="Villkor"
          value={summary.legal.terms}
          description="Publicerad allmän villkorstext finns för tenantens avtal."
        />
        <CheckCard
          label="Integritet"
          value={summary.legal.privacy_policy}
          description="Publicerad integritetspolicy finns för kundens godkännande."
        />
        <CheckCard
          label="Ångerrätt"
          value={summary.legal.withdrawal}
          description="Ångerrättsinformation kan visas och sparas som snapshot."
        />
        <CheckCard
          label="Fullmakt"
          value={summary.legal.power_of_attorney}
          description="Fullmakten kan accepteras separat, inte bara i villkoren."
        />
        <CheckCard
          label="Prisvillkor"
          value={summary.legal.price_terms}
          description="Prisvillkor finns som del av avtalssnapshot/signering."
        />
      </div>

      <RouteSimulationCard simulation={summary.routeSimulation} />

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-950 shadow-sm">
          <h3 className="text-lg font-bold">Blockerare</h3>
          <ul className="mt-3 space-y-2 text-sm leading-6">
            {summary.blockers.length === 0 ? (
              <li>Inga blockerare.</li>
            ) : (
              summary.blockers.map((item) => <li key={item}>{item}</li>)
            )}
          </ul>
        </div>
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-sm">
          <h3 className="text-lg font-bold">Granskning</h3>
          <ul className="mt-3 space-y-2 text-sm leading-6">
            {summary.warnings.length === 0 ? (
              <li>Inga varningar.</li>
            ) : (
              summary.warnings.map((item) => <li key={item}>{item}</li>)
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}
