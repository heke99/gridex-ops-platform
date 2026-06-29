import Link from "next/link";
import type {
  CustomerDocument,
  CustomerLegalAcceptance,
  CustomerOpsReadiness,
  CustomerOpsTimelineEvent,
} from "@/lib/opsMaster/readiness";
import {
  isAvailablePowerOfAttorneyDocument,
  isSignedPowerOfAttorney,
  type CustomerCardSnapshot,
} from "@/lib/customers/customerCardSnapshot";
import { hasExternallySendablePoa as isPoaExternallySendable } from "@/lib/customers/poaReadiness";

type PoaLike = Record<string, unknown>;

type Props = {
  customerId: string;
  readiness: CustomerOpsReadiness;
  acceptances: CustomerLegalAcceptance[];
  documents: CustomerDocument[];
  timeline: CustomerOpsTimelineEvent[];
  snapshot?: CustomerCardSnapshot;
  powersOfAttorney?: PoaLike[];
  customerIdentity?: string | null;
};

const POA_STATUS_LABELS: Record<string, string> = {
  draft: "Utkast",
  sent: "Uppladdad – väntar verifiering",
  pending_review: "Väntar granskning",
  signed: "Signerad",
  accepted: "Accepterad",
  active: "Aktiv",
  completed: "Slutförd",
  revoked: "Återkallad",
  expired: "Utgången",
};

const POA_SCOPE_LABELS: Record<string, string> = {
  supplier_switch: "Leverantörsbyte",
  facility_information_lookup: "Anläggningsuppgifter",
  meter_data: "Mätvärden",
  billing_handoff: "Faktureringsunderlag",
};

const POA_METHOD_LABELS: Record<string, string> = {
  website_acceptance: "Webbsignering",
  pdf_upload: "Uppladdad PDF",
  admin_recorded: "Manuellt registrerad",
  external_sync: "Extern synk",
};

function poaScopeList(poa: PoaLike): string[] {
  const summary = poa.scope_summary as PoaLike | null | undefined;
  const raw = summary?.scopes;
  if (Array.isArray(raw) && raw.length > 0) return raw.map((value) => String(value));
  const single = typeof poa.scope === "string" ? poa.scope : null;
  return single ? [single] : [];
}

function poaScopeCovers(poa: PoaLike, scope: string): boolean {
  const scopes = poaScopeList(poa).map((value) => value.toLowerCase());
  if (scopes.includes(scope) || scopes.includes("supplier_switch") || scopes.includes("all")) return true;
  const summary = poa.scope_summary as PoaLike | null | undefined;
  return summary?.[scope] === true;
}

const ACCEPTANCE_LABELS: Record<string, string> = {
  terms: "Allmänna villkor",
  privacy_policy: "Integritetspolicy",
  withdrawal_info: "Ångerrättsinformation",
  price_snapshot: "Prisbild / prissnapshot",
  power_of_attorney: "Fullmakt",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("sv-SE");
}

function Pill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}
    >
      {children}: {ok ? "klar" : "saknas"}
    </span>
  );
}

function ReadinessBox({
  title,
  ok,
  children,
}: {
  title: string;
  ok: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-3xl border p-5 ${ok ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}
    >
      <p
        className={`text-sm font-black ${ok ? "text-emerald-900" : "text-amber-950"}`}
      >
        {title}
      </p>
      <p className="mt-2 text-2xl font-black text-slate-950">
        {ok ? "Ja" : "Inte ännu"}
      </p>
      <div className="mt-3 text-sm font-semibold leading-6 text-slate-700">
        {children}
      </div>
    </div>
  );
}

export default function CustomerLegalReadinessCard({
  customerId,
  readiness,
  acceptances,
  documents,
  timeline,
  snapshot,
  powersOfAttorney = [],
  customerIdentity = null,
}: Props) {
  const latestTimeline = timeline.slice(0, 10);
  const legalDocuments = documents.filter((doc) =>
    [
      "contract_confirmation",
      "withdrawal",
      "power_of_attorney",
      "price_terms",
      "invoice",
      "customer_document",
    ].includes(String(doc.document_type ?? "customer_document")),
  );
  const legalLooksAccepted =
    snapshot?.hasLegalAcceptance ??
    (acceptances.length >= 4 ||
      (readiness.hasTerms && readiness.hasPrivacy && readiness.hasWithdrawal));
  const hasPowerDocument = documents.some((doc) =>
    isAvailablePowerOfAttorneyDocument(
      doc as unknown as Record<string, unknown>,
    ),
  );
  const hasPowerOfAttorney =
    snapshot?.hasAuthorization ??
    (readiness.hasActivePowerOfAttorney ||
      hasPowerDocument ||
      readiness.hasPowerOfAttorneyAcceptance);
  // Legal acceptance is not the same as a fullmakt that can be sent externally
  // to a grid owner. Only mark "klar" for external use when sendable.
  const hasExternallySendablePoa = snapshot?.hasExternallySendablePoa ?? false;
  const visibleBlockers = readiness.blockers.filter((blocker) => {
    const code = String(blocker.code ?? "").toLowerCase();
    if (hasPowerOfAttorney && code.includes("power")) return false;
    if (
      legalLooksAccepted &&
      (code.includes("terms") ||
        code.includes("privacy") ||
        code.includes("withdrawal") ||
        code.includes("legal"))
    )
      return false;
    if (code.includes("ediel") || code.includes("route")) return false;
    return true;
  });
  const nextLabel = !legalLooksAccepted
    ? "Kontrollera juridiska godkännanden"
    : !hasPowerOfAttorney
      ? "Kontrollera fullmakt"
      : (snapshot?.nextStepLabel ?? "Begär uppgifter");
  const nextDescription = !legalLooksAccepted
    ? "Juridiken behöver kontrolleras innan nästa steg."
    : !hasPowerOfAttorney
      ? "Fullmakt behöver kontrolleras innan nästa steg."
      : (snapshot?.nextStepDescription ??
        "Juridik och fullmakt ser klara ut. Fortsätt med anläggningsuppgifter, mätpunkt och nätägare.");

  return (
    <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
          Kundens juridiska status
        </p>
        <h2 className="mt-2 text-xl font-black text-slate-950">
          Juridik, fullmakt, dokument och nästa åtgärd
        </h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">
          Systemet kontrollerar godkännanden, fullmakt och dokument. Tekniska
          detaljer ligger i avancerade vyer.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ReadinessBox
          title="Kan starta leverantörsbyte"
          ok={readiness.canStartSupplierSwitch}
        >
          {readiness.canStartSupplierSwitch
            ? "Alla grundkrav är uppfyllda."
            : "Flödet är blockerat tills punkterna nedan är åtgärdade."}
        </ReadinessBox>
        <ReadinessBox
          title="Kan begära anläggningsuppgifter"
          ok={hasExternallySendablePoa}
        >
          {hasExternallySendablePoa
            ? "Fullmakt är klar för nätägarkommunikation."
            : hasPowerOfAttorney
              ? "Fullmakt finns juridiskt, men saknar kund-/signeringsuppgifter för extern sändning. Granska fullmakten."
              : "Fullmakt behöver kontrolleras."}
        </ReadinessBox>
        <ReadinessBox title="Kan skicka kundmail" ok={legalLooksAccepted}>
          {legalLooksAccepted
            ? "Juridiska godkännanden finns."
            : "Juridiska godkännanden behöver kontrolleras."}
        </ReadinessBox>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-black text-slate-950">Nästa åtgärd</p>
            <p className="mt-1 text-sm font-semibold text-slate-700">
              {nextDescription}
            </p>
          </div>
          <Link
            href={`/admin/customers/${customerId}?tab=data-requests`}
            className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800"
          >
            {nextLabel}
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Pill ok={legalLooksAccepted}>Juridiska godkännanden</Pill>
        <Pill ok={readiness.hasPriceSnapshot}>Prisbild</Pill>
        <Pill ok={hasPowerOfAttorney}>Fullmakt</Pill>
        <Pill ok={readiness.hasFacility}>Anläggning</Pill>
        <Pill ok={readiness.hasMeteringPoint}>Mätpunkt</Pill>
        <Pill ok={readiness.hasGridOwner}>Nätägare</Pill>
        <Pill ok={readiness.hasGridArea}>Nätområde</Pill>
      </div>

      <section className="rounded-3xl border border-slate-200 p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-black text-slate-950">Fullmakt</h3>
          <Link
            href={`/admin/customers/${customerId}?tab=documents`}
            className="rounded-2xl border border-slate-300 px-3 py-1.5 text-xs font-black text-slate-800 hover:bg-slate-50"
          >
            Ladda upp signerad PDF
          </Link>
        </div>
        {powersOfAttorney.length === 0 ? (
          <p className="mt-3 text-sm font-semibold text-slate-600">
            Fullmakt saknas – begär signering eller ladda upp signerad PDF.
          </p>
        ) : (
          <div className="mt-4 grid gap-3">
            {powersOfAttorney.slice(0, 4).map((poa, index) => {
              const status = String(poa.status ?? "").toLowerCase();
              const scopes = poaScopeList(poa);
              const signed = isSignedPowerOfAttorney(poa);
              const usableForSwitch = signed && poaScopeCovers(poa, "supplier_switch");
              const usableForFacility = isPoaExternallySendable(poa, { customerIdentity }) && poaScopeCovers(poa, "facility_information_lookup");
              const method = typeof poa.method === "string" ? poa.method : null;
              const signedAt = (poa.signed_at ?? poa.accepted_at) as string | null | undefined;
              const hasDocument = Boolean(poa.document_id || poa.document_path);
              return (
                <div key={String(poa.id ?? index)} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-slate-950">{POA_STATUS_LABELS[status] ?? status ?? "Okänd status"}</span>
                    {method ? <span className="text-xs font-semibold text-slate-600">· {POA_METHOD_LABELS[method] ?? method}</span> : null}
                    <span className="text-xs font-semibold text-slate-600">· signerad {formatDate(signedAt)}</span>
                  </div>
                  <div className="mt-2 text-xs font-semibold text-slate-600">
                    Omfattning: {scopes.length > 0 ? scopes.map((scope) => POA_SCOPE_LABELS[scope] ?? scope).join(", ") : "–"}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Pill ok={usableForSwitch}>Leverantörsbyte</Pill>
                    <Pill ok={usableForFacility}>Anläggningsuppgifter</Pill>
                    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${hasDocument ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-600"}`}>
                      Dokument: {hasDocument ? "finns" : "saknas"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {visibleBlockers.length > 0 ? (
        <div className="rounded-3xl border border-red-200 bg-red-50 p-5">
          <p className="text-sm font-black text-red-900">
            Blockeringar som måste lösas
          </p>
          <div className="mt-4 grid gap-3">
            {visibleBlockers.map((blocker) => (
              <div
                key={blocker.code}
                className="rounded-2xl border border-red-100 bg-white p-4"
              >
                <p className="text-sm font-black text-slate-950">
                  {blocker.label}
                </p>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">
                  Åtgärd: {blocker.action}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-3xl border border-slate-200 p-5">
          <h3 className="text-base font-black text-slate-950">
            Kundens juridiska godkännanden
          </h3>
          <div className="mt-4 divide-y divide-slate-100">
            {acceptances.length === 0 ? (
              <p className="text-sm font-semibold text-slate-600">
                Inga juridiska godkännanden sparade ännu.
              </p>
            ) : null}
            {acceptances.map((acceptance) => (
              <div key={acceptance.id} className="py-3">
                <p className="text-sm font-black text-slate-950">
                  {ACCEPTANCE_LABELS[acceptance.acceptance_type] ??
                    acceptance.acceptance_type}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-600">
                  {formatDate(acceptance.accepted_at)} · källa:{" "}
                  {acceptance.source}
                </p>
                {acceptance.reason ? (
                  <p className="mt-1 text-xs font-semibold text-slate-600">
                    Orsak: {acceptance.reason}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 p-5">
          <h3 className="text-base font-black text-slate-950">Dokument</h3>
          <div className="mt-4 divide-y divide-slate-100">
            {legalDocuments.length === 0 ? (
              <p className="text-sm font-semibold text-slate-600">
                Inga dokument sparade på kundkortet ännu.
              </p>
            ) : null}
            {legalDocuments.slice(0, 8).map((doc) => (
              <div key={doc.id} className="py-3">
                <p className="text-sm font-black text-slate-950">
                  {doc.title ??
                    doc.file_name ??
                    doc.document_type ??
                    "Dokument"}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-600">
                  {doc.document_type ?? "kunddokument"} ·{" "}
                  {formatDate(doc.created_at)}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-slate-200 p-5">
        <h3 className="text-base font-black text-slate-950">
          Eventkedja per kund
        </h3>
        <div className="mt-4 divide-y divide-slate-100">
          {latestTimeline.length === 0 ? (
            <p className="text-sm font-semibold text-slate-600">
              Ingen tidslinje hittades ännu.
            </p>
          ) : null}
          {latestTimeline.map((event) => (
            <div
              key={`${event.source}-${event.source_id}-${event.created_at}`}
              className="py-3"
            >
              <p className="text-sm font-black text-slate-950">
                {event.title ?? event.event_type ?? "Händelse"}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-600">
                {formatDate(event.created_at)} · {event.source ?? "händelse"}
              </p>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
