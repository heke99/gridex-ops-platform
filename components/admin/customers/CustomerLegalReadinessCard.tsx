import Link from "next/link";
import { formatAdminDateTime } from "@/lib/ui/format";
import { customerEmailStatus } from "@/lib/admin/customerCommunicationLabels";
import type {
  CustomerDocument,
  CustomerLegalAcceptance,
  CustomerOpsReadiness,
  CustomerOpsTimelineEvent,
} from "@/lib/opsMaster/readiness";
import {
  isAvailablePowerOfAttorneyDocument,
  type CustomerCardSnapshot,
} from "@/lib/customers/customerCardSnapshot";

type PoaLike = Record<string, unknown>;

type Props = {
  customerId: string;
  isPlatformAdmin?: boolean;
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
  meter_values: "Mätvärden",
  billing_handoff: "Faktureringsunderlag",
  billing_underlay: "Faktureringsunderlag",
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

const ACCEPTANCE_LABELS: Record<string, string> = {
  terms: "Allmänna villkor",
  privacy_policy: "Integritetspolicy",
  withdrawal_info: "Ångerrättsinformation",
  price_snapshot: "Prisbild",
  power_of_attorney: "Fullmakt",
};

const BLOCKER_COPY: Record<string, { label: string; action: string }> = {
  terms_missing: { label: 'Villkor saknas', action: 'Be kunden godkänna de allmänna villkoren.' },
  privacy_missing: { label: 'Integritetspolicy saknas', action: 'Kontrollera kundens godkännande av integritetspolicyn.' },
  withdrawal_missing: { label: 'Ångerrättsinformation saknas', action: 'Se till att kunden får ångerrättsinformation och spara bekräftelsen.' },
  price_snapshot_missing: { label: 'Prisuppgifter saknas', action: 'Kontrollera vilket pris och vilka villkor som gäller för avtalet.' },
  poa_acceptance_missing: { label: 'Fullmaktens godkännande saknas', action: 'Be kunden godkänna fullmakten.' },
  poa_missing: { label: 'Giltig fullmakt saknas', action: 'Kontrollera att fullmakten gäller rätt anläggning och ärende.' },
  contract_snapshot_missing: { label: 'Avtalsunderlag saknas', action: 'Kontrollera att rätt avtal finns för kunden.' },
  facility_missing: { label: 'Anläggning saknas', action: 'Komplettera kundens anläggning eller begär uppgifter från nätägaren.' },
  metering_point_missing: { label: 'Mätpunktsnummer saknas', action: 'Kontrollera anläggningsuppgifterna med nätägaren.' },
  grid_owner_missing: { label: 'Nätägare saknas', action: 'Kontrollera vilken nätägare som hör till anläggningen.' },
  grid_area_missing: { label: 'Nätområde saknas', action: 'Kontrollera anläggningens nätområde med nätägaren.' },
};
const EVENT_LABELS: Record<string, string> = {
  'customer.created': 'Ansökan mottagen',
  'customer_number.assigned': 'Kundnummer skapat',
  'contract.application_received': 'Ansökan mottagen',
  'contract.confirmation_sent': 'Avtalsbekräftelse skickad',
  'contract.cooling_off_sent': 'Ångerrättsinformation skickad',
  'invoice.sent': 'Faktura skickad',
  'metering_values.updated': 'Mätvärden uppdaterade',
};
const DOCUMENT_LABELS: Record<string, string> = { contract_confirmation: 'Avtalsbekräftelse', withdrawal: 'Ångerrätt', power_of_attorney: 'Fullmakt', price_terms: 'Prisvillkor', invoice: 'Faktura', customer_document: 'Kunddokument' };

function Pill({ ok, children, falseLabel = "saknas" }: { ok: boolean | null; children: React.ReactNode; falseLabel?: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${ok === null ? "border-amber-200 bg-amber-50 text-amber-900" : ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}
    >
      {children}: {ok === null ? "behöver kontrolleras" : ok ? "klar" : falseLabel}
    </span>
  );
}

function ReadinessBox({
  title,
  ok,
  children,
}: {
  title: string;
  ok: boolean | null;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border p-3 ${ok ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}
    >
      <p
        className={`text-sm font-black ${ok ? "text-emerald-900" : "text-amber-950"}`}
      >
        {title}
      </p>
      <p className="mt-2 text-lg font-semibold text-slate-950">
        {ok === null ? "Behöver kontrolleras" : ok ? "Ja" : "Inte ännu"}
      </p>
      <div className="mt-3 text-sm font-semibold leading-6 text-slate-700">
        {children}
      </div>
    </div>
  );
}

export default function CustomerLegalReadinessCard({
  customerId,
  isPlatformAdmin = false,
  readiness,
  acceptances,
  documents,
  timeline,
  snapshot,
  powersOfAttorney = [],
}: Props) {
  const latestTimeline = timeline.slice(0, 10);
  const display = (labels: Record<string, string>, value: string, fallback: string) => labels[value] ?? (isPlatformAdmin ? value || fallback : fallback);
  const renderTimeline = (event: CustomerOpsTimelineEvent) => {
    const eventLabel = event.source === 'communication_log'
      ? `E-post · ${customerEmailStatus(typeof event.metadata?.status === 'string' ? event.metadata.status : null)}`
      : event.source === 'customer_legal_acceptance'
        ? `${ACCEPTANCE_LABELS[event.event_type ?? ''] ?? 'Juridiskt godkännande'} registrerat`
        : EVENT_LABELS[event.event_type ?? ''] ?? 'Kundhändelse';
    return <div key={`${event.source}-${event.source_id}-${event.created_at}`} className="min-w-0 break-words py-3">
      <p className="text-sm font-semibold text-slate-950">{isPlatformAdmin ? event.title ?? event.event_type ?? 'Händelse' : eventLabel}</p>
      <p className="mt-1 text-xs text-slate-600">{formatAdminDateTime(event.created_at)}{isPlatformAdmin ? ` · ${event.source ?? 'händelse'}` : ''}</p>
    </div>;
  };
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
  const facilityPoa = snapshot?.poaReadiness?.facility;
  const switchPoa = snapshot?.poaReadiness?.supplierSwitch;
  const sameCustomer = (fact: typeof facilityPoa) => fact?.customerId === customerId
    && fact?.siteId === snapshot?.primarySite?.id && fact?.companyId === snapshot?.primarySite?.company_id;
  const facilityUsable = sameCustomer(facilityPoa) ? facilityPoa?.usableNow ?? null : null;
  const switchUsable = sameCustomer(switchPoa) ? switchPoa?.usableNow ?? null : null;
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
    <section className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h2 className="mt-2 text-xl font-black text-slate-950">
          Fullmakt och godkännanden
        </h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">
          Här ser du kundens godkännanden, fullmakter och dokument.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ReadinessBox
          title="Fullmakt för leverantörsbyte"
          ok={switchUsable}
        >
          {(sameCustomer(switchPoa) ? switchPoa?.explanation : null) ?? "Kontrollera att fullmakten gäller för vald anläggning och detta ärende."}
        </ReadinessBox>
        <ReadinessBox
          title="Fullmakt för anläggningsuppgifter"
          ok={facilityUsable}
        >
          {(sameCustomer(facilityPoa) ? facilityPoa?.explanation : null) ?? "Kontrollera att fullmakten gäller för vald anläggning och detta ärende."}
        </ReadinessBox>
        <ReadinessBox title="Juridiska godkännanden" ok={legalLooksAccepted}>
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
              {isPlatformAdmin ? nextDescription : !legalLooksAccepted ? 'Kontrollera kundens juridiska godkännanden.' : !hasPowerOfAttorney ? 'Kontrollera att rätt fullmakt finns för ärendet.' : 'Se kundöversikten för nästa steg i ärendet.'}
            </p>
          </div>
          <Link
            href={isPlatformAdmin ? `/admin/customers/${customerId}?tab=data-requests` : `/admin/customers/${customerId}`}
            className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800"
          >
            {isPlatformAdmin ? nextLabel : "Visa kundöversikt"}
          </Link>
        </div>
      </div>

      <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-800">Övriga uppgifter</summary><div className="mt-3 flex flex-wrap gap-2">
        <Pill ok={legalLooksAccepted}>Juridiska godkännanden</Pill>
        <Pill ok={readiness.hasPriceSnapshot}>Prisbild</Pill>
        <Pill ok={hasPowerOfAttorney ? true : facilityPoa?.parentCoverage !== "complete" || facilityPoa.kind === "unknown" ? null : false}>Godkännande av fullmakt</Pill>
        <Pill ok={readiness.hasFacility}>Anläggning</Pill>
        <Pill ok={readiness.hasMeteringPoint}>Mätpunkt</Pill>
        <Pill ok={readiness.hasGridOwner}>Nätägare</Pill>
        <Pill ok={readiness.hasGridArea}>Nätområde</Pill>
      </div></details>

      <section className="min-w-0 rounded-2xl border border-slate-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-black text-slate-950">Fullmakt</h3>
          {isPlatformAdmin ? <Link
            href={`/admin/customers/${customerId}?tab=authorization-documents`}
            className="rounded-2xl border border-slate-300 px-3 py-1.5 text-xs font-black text-slate-800 hover:bg-slate-50"
          >
            Ladda upp signerad PDF
          </Link> : null}
        </div>
        {powersOfAttorney.length === 0 ? (
          <p className="mt-3 text-sm font-semibold text-slate-600">
            Fullmakt saknas. Be en behörig handläggare registrera kundens fullmakt.
          </p>
        ) : (
          <div role="region" aria-label="Fullmakter" tabIndex={0} className="mt-4 grid max-h-96 gap-3 overflow-y-auto rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
            {powersOfAttorney.map((poa, index) => {
              const status = String(poa.status ?? "").toLowerCase();
              const scopes = poaScopeList(poa);
              const usableForSwitch = sameCustomer(switchPoa) ? switchPoa?.rows.find(row => row.poaId === poa.id)?.usableNow ?? null : null;
              const usableForFacility = sameCustomer(facilityPoa) ? facilityPoa?.rows.find(row => row.poaId === poa.id)?.usableNow ?? null : null;
              const method = typeof poa.method === "string" ? poa.method : null;
              const signedAt = (poa.signed_at ?? poa.accepted_at) as string | null | undefined;
              const hasDocument = Boolean(poa.document_id || poa.document_path);
              return (
                <div key={String(poa.id ?? index)} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-slate-950">{display(POA_STATUS_LABELS, status, "Status behöver kontrolleras")}</span>
                    {method ? <span className="text-xs font-semibold text-slate-600">· {display(POA_METHOD_LABELS, method, "Godkännandesätt behöver kontrolleras")}</span> : null}
                    <span className="text-xs font-semibold text-slate-600">· signerad {formatAdminDateTime(signedAt)}</span>
                  </div>
                  <div className="mt-2 text-xs font-semibold text-slate-600">
                    Omfattning: {scopes.length > 0 ? scopes.map((scope) => display(POA_SCOPE_LABELS, scope, "Omfattning behöver kontrolleras")).join(", ") : "–"}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Pill ok={usableForSwitch} falseLabel="inte användbar">Leverantörsbyte</Pill>
                    <Pill ok={usableForFacility} falseLabel="inte användbar">Anläggningsuppgifter</Pill>
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
                  {isPlatformAdmin ? blocker.label : BLOCKER_COPY[blocker.code]?.label ?? "Uppgifter behöver kontrolleras"}
                </p>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">
                  Åtgärd: {isPlatformAdmin ? blocker.action : BLOCKER_COPY[blocker.code]?.action ?? "Kontrollera kundöversikten för nästa steg."}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <details id="saved-legal-acceptances" className="min-w-0 rounded-2xl border border-slate-200 p-4">
          <summary className="cursor-pointer text-base font-semibold text-slate-950">Sparade godkännanden ({acceptances.length})</summary>
          <div role="region" aria-label="Juridiska godkännanden" tabIndex={0} className="mt-4 max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
            {acceptances.length === 0 ? (
              <p className="text-sm font-semibold text-slate-600">
                Inga juridiska godkännanden sparade ännu.
              </p>
            ) : null}
            {acceptances.map((acceptance) => (
              <div key={acceptance.id} className="min-w-0 break-words py-3">
                <p className="text-sm font-black text-slate-950">
                  {display(ACCEPTANCE_LABELS, acceptance.acceptance_type, "Juridiskt godkännande")}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-600">
                  {formatAdminDateTime(acceptance.accepted_at)}
                  {isPlatformAdmin ? ` · källa: ${acceptance.source}` : null}
                </p>
                {acceptance.reason ? (
                  <p className="mt-1 text-xs font-semibold text-slate-600">
                    Orsak: {acceptance.reason}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </details>

        <section className="min-w-0 rounded-2xl border border-slate-200 p-4">
          <h3 className="text-base font-black text-slate-950">Dokument</h3>
          <div role="region" aria-label="Kunddokument" tabIndex={0} className="mt-4 max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
            {legalDocuments.length === 0 ? (
              <p className="text-sm font-semibold text-slate-600">
                Inga dokument sparade på kundkortet ännu.
              </p>
            ) : null}
            {legalDocuments.map((doc) => (
              <div key={doc.id} className="min-w-0 break-words py-3">
                <p className="text-sm font-black text-slate-950">
                  {doc.title ??
                    doc.file_name ??
                    DOCUMENT_LABELS[doc.document_type ?? ""] ?? "Dokument"}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-600">
                  {display(DOCUMENT_LABELS, doc.document_type ?? "", "Kunddokument")} ·{" "}
                  {formatAdminDateTime(doc.created_at)}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <details id="customer-legal-history" className="min-w-0 rounded-2xl border border-slate-200 p-4">
        <summary className="cursor-pointer text-base font-semibold text-slate-950">Kundhistorik ({timeline.length})</summary>
        <div className="mt-4 divide-y divide-slate-100">
          {latestTimeline.length === 0 ? (
            <p className="text-sm font-semibold text-slate-600">
              Ingen tidslinje hittades ännu.
            </p>
          ) : null}
          {latestTimeline.map(renderTimeline)}
        </div>
        {timeline.length > 10 ? <details className="mt-3 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-800">Tidigare händelser ({timeline.length - 10})</summary><div role="region" aria-label="Tidigare kundhändelser" tabIndex={0} className="mt-2 max-h-80 overflow-y-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">{timeline.slice(10).map(renderTimeline)}</div></details> : null}
      </details>
    </section>
  );
}
