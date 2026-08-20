// Extracted from page.tsx; keep public imports on the facade module.
import Link from "next/link"











import { createCustomerInternalNoteAction, registerCustomerLifecycleDecisionAction, savePowerOfAttorneyScopeAction } from "./actions"
import type { AuditLogRow, CustomerInternalNoteRow, CustomerSiteRow, MeteringPointRow } from "@/lib/masterdata/types"

import type { PowerOfAttorneyRow, CustomerBlockerRow } from "@/lib/operations/types"

























import type { CustomerContractRow } from "@/lib/customer-contracts/types"




import { type BillingPartnerCustomerSummary, type WebsiteApplicationAdminRow } from "@/lib/admin/websiteIntegrationOps"

import { intakeStatusLabel as applicationIntakeStatusLabel, sourceLabel } from "@/lib/customers/statusLabels"


import { humanizeMissingField } from "@/lib/customers/customerCardSnapshot"
import type { CustomerRow, PowerOfAttorneyScopeRow } from './page.part-1'
import { ActorCell, actionLabel, blockerSimpleLabel, blockerToneClass, compactJson, entityLabel, formatDateTime } from './page.part-1'

export function CustomerBlockersBanner({
  blockers,
}: {
  blockers: CustomerBlockerRow[];
}) {
  if (blockers.length === 0) return null;

  return (
    <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-amber-950">
            Saker att lösa innan nästa steg
          </h2>
          <p className="mt-1 text-sm text-amber-900">
            Kunden är sparad, men vissa flöden stoppas tills uppgifterna är
            klara. Det här stoppar inte kundkortet eller avtalshanteringen.
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-amber-900">
          {blockers.length} öppna
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {blockers.slice(0, 6).map((blocker) => (
          <div
            key={blocker.id}
            className={`rounded-2xl border px-4 py-3 text-sm ${blockerToneClass(blocker)}`}
          >
            <div className="font-semibold">
              {blocker.title || blockerSimpleLabel(blocker.blocker_type)}
            </div>
            <div className="mt-1 text-xs opacity-80">
              {blockerSimpleLabel(blocker.blocker_type)} · {blocker.status}
            </div>
            {blocker.description ? (
              <p className="mt-2 leading-5">{blocker.description}</p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function LifecycleDecisionSection({
  customerId,
  sites,
  meteringPoints,
  contracts,
}: {
  customerId: string;
  sites: CustomerSiteRow[];
  meteringPoints: MeteringPointRow[];
  contracts: CustomerContractRow[];
}) {
  const activeContract =
    contracts.find((contract) => ["active", "signed", "pending_signature"].includes(contract.status)) ??
    contracts[0] ??
    null;

  const targetOptions = () => (
    <>
      <option value="customer:">Hela kundprocessen</option>
      {contracts.length > 0 ? (
        <optgroup label="Avtal">
          {contracts.map((contract) => (
            <option key={`contract-${contract.id}`} value={`contract:${contract.id}`}>
              {contract.contract_name} · {contract.status}
            </option>
          ))}
        </optgroup>
      ) : null}
      {sites.length > 0 ? (
        <optgroup label="Anläggningar">
          {sites.map((site) => (
            <option key={`site-${site.id}`} value={`site:${site.id}`}>
              {site.site_name} · {site.facility_id ?? "utan anläggnings-id"}
            </option>
          ))}
        </optgroup>
      ) : null}
      {meteringPoints.length > 0 ? (
        <optgroup label="Mätpunkter">
          {meteringPoints.map((point) => (
            <option key={`point-${point.id}`} value={`metering_point:${point.id}`}>
              {point.meter_point_id} · {point.status}
            </option>
          ))}
        </optgroup>
      ) : null}
    </>
  );

  const form = (input: {
    decisionType: "withdrawal" | "cancelled" | "rejected";
    title: string;
    description: string;
    reasonPlaceholder: string;
    buttonLabel: string;
    confirmationLabel: string;
    defaultTarget: string;
    tone: string;
  }) => (
    <form
      action={registerCustomerLifecycleDecisionAction}
      className={`rounded-3xl border p-5 ${input.tone}`}
    >
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="decision_type" value={input.decisionType} />
      <input type="hidden" name="block_billing" value="true" />
      <h3 className="font-semibold text-slate-950">{input.title}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-700">{input.description}</p>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-slate-700">Gäller</span>
          <select
            name="scope_target"
            defaultValue={input.defaultTarget}
            className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
          >
            {targetOptions()}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">Mottaget datum</span>
            <input
              type="datetime-local"
              name="received_at"
              defaultValue={new Date().toISOString().slice(0, 16)}
              className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">Kanal</span>
            <select
              name="received_channel"
              defaultValue="phone"
              className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
            >
              <option value="phone">Telefon</option>
              <option value="email">E-post</option>
              <option value="web_form">Formulär</option>
              <option value="letter">Brev</option>
              <option value="other">Annat</option>
            </select>
          </label>
        </div>
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-slate-700">Orsak</span>
          <textarea
            name="reason"
            rows={3}
            required
            placeholder={input.reasonPlaceholder}
            className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-slate-700">Intern anteckning</span>
          <textarea
            name="notes"
            rows={2}
            placeholder="Valfri intern information. Visas inte för kunden."
            className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
          />
        </label>
        <label className="flex items-start gap-3 rounded-2xl border border-slate-300 bg-white p-3 text-sm text-slate-700">
          <input type="checkbox" name="confirmed" value="true" required className="mt-1" />
          <span>{input.confirmationLabel}</span>
        </label>
        <button className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800">
          {input.buttonLabel}
        </button>
      </div>
    </form>
  );

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Ånger och avslut</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-700">
          Ånger, operativt avbrott och avvisning är separata beslut. Systemet
          behåller historiken, stoppar relevanta flöden och skapar ett tydligt
          kundärende. Vid ånger köas även tenantens bekräftelsemejl.
        </p>
      </div>
      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        {form({
          decisionType: "withdrawal",
          title: "Registrera ånger",
          description: "Använd när kunden uttryckligen använder sin ångerrätt.",
          reasonPlaceholder: "Exempel: Kunden ångrade avtalet via telefon inom ångerfristen.",
          buttonLabel: "Registrera ånger",
          confirmationLabel: "Jag bekräftar att kunden uttryckligen har ångrat avtalet och att relevanta flöden ska stoppas.",
          defaultTarget: activeContract ? `contract:${activeContract.id}` : "customer:",
          tone: "border-amber-200 bg-amber-50/70",
        })}
        {form({
          decisionType: "cancelled",
          title: "Avbryt process",
          description: "Använd för dubblett, felaktig ansökan eller när processen inte ska fortsätta.",
          reasonPlaceholder: "Exempel: Dubblettansökan eller kunden vill inte fortsätta innan avtal ingåtts.",
          buttonLabel: "Avbryt process",
          confirmationLabel: "Jag bekräftar att vald process ska stoppas utan att historiken raderas.",
          defaultTarget: "customer:",
          tone: "border-slate-200 bg-slate-50",
        })}
        {form({
          decisionType: "rejected",
          title: "Avvisa ansökan",
          description: "Använd när Gridex eller tenantbolaget fattar ett avslagsbeslut.",
          reasonPlaceholder: "Exempel: Avtalet kan inte levereras för vald anläggning.",
          buttonLabel: "Registrera avvisning",
          confirmationLabel: "Jag bekräftar att detta är ett avslagsbeslut och att vald process ska blockeras.",
          defaultTarget: "customer:",
          tone: "border-red-200 bg-red-50/70",
        })}
      </div>
    </section>
  );
}

export function PowerOfAttorneyScopesSection({
  customerId,
  sites,
  meteringPoints,
  contracts,
  powersOfAttorney,
  scopes,
}: {
  customerId: string;
  sites: CustomerSiteRow[];
  meteringPoints: MeteringPointRow[];
  contracts: CustomerContractRow[];
  powersOfAttorney: PowerOfAttorneyRow[];
  scopes: PowerOfAttorneyScopeRow[];
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 ">
          Fullmaktens omfattning
        </h2>
        <p className="mt-1 text-sm text-slate-700 ">
          Koppla en signerad fullmakt till kund, anläggning, mätpunkt eller
          avtal så leverantörsbyte och uppgiftsbegäran kan valideras per objekt.
        </p>
      </div>
      {scopes.length > 0 ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {scopes.map((scope) => {
            const site = sites.find((row) => row.id === scope.site_id);
            const point = meteringPoints.find(
              (row) => row.id === scope.metering_point_id,
            );
            const contract = contracts.find(
              (row) => row.id === scope.customer_contract_id,
            );
            return (
              <div
                key={scope.id}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"
              >
                <div className="font-semibold text-slate-950">
                  {scope.scope_type}
                </div>
                <div className="mt-1">
                  Fullmakt: {scope.power_of_attorney_id}
                </div>
                <div>Anläggning: {site?.site_name ?? scope.site_id ?? "—"}</div>
                <div>
                  Mätpunkt:{" "}
                  {point?.meter_point_id ?? scope.metering_point_id ?? "—"}
                </div>
                <div>
                  Avtal:{" "}
                  {contract?.contract_name ?? scope.customer_contract_id ?? "—"}
                </div>
                <div>
                  Status: {scope.status ?? "active"} · giltig{" "}
                  {scope.valid_from ?? "—"} – {scope.valid_to ?? "—"}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-700">
          Inga detaljerade fullmaktsscope är sparade ännu.
        </div>
      )}
      <form
        action={savePowerOfAttorneyScopeAction}
        className="mt-5 grid gap-4 md:grid-cols-2"
      >
        <input type="hidden" name="customer_id" value={customerId} />
        <label className="grid gap-1 text-sm">
          <span className="text-slate-700 ">Fullmakt</span>
          <select
            name="power_of_attorney_id"
            required
            className="rounded-2xl border border-slate-300 px-4 py-3"
          >
            <option value="">Välj fullmakt</option>
            {powersOfAttorney.map((power) => (
              <option key={power.id} value={power.id}>
                {power.reference ?? power.id} · {power.status}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-slate-700 ">Scope-typ</span>
          <select
            name="scope_type"
            defaultValue="site"
            className="rounded-2xl border border-slate-300 px-4 py-3"
          >
            <option value="customer">Kund</option>
            <option value="site">Anläggning</option>
            <option value="metering_point">Mätpunkt</option>
            <option value="contract">Avtal</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-slate-700 ">Anläggning</span>
          <select
            name="site_id"
            defaultValue=""
            className="rounded-2xl border border-slate-300 px-4 py-3"
          >
            <option value="">Ingen/alla</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.site_name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-slate-700 ">Mätpunkt</span>
          <select
            name="metering_point_id"
            defaultValue=""
            className="rounded-2xl border border-slate-300 px-4 py-3"
          >
            <option value="">Ingen/alla</option>
            {meteringPoints.map((point) => (
              <option key={point.id} value={point.id}>
                {point.meter_point_id}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-slate-700 ">Avtal</span>
          <select
            name="contract_id"
            defaultValue=""
            className="rounded-2xl border border-slate-300 px-4 py-3"
          >
            <option value="">Inget specifikt avtal</option>
            {contracts.map((contract) => (
              <option key={contract.id} value={contract.id}>
                {contract.contract_name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-slate-700 ">Giltig från</span>
            <input
              name="valid_from"
              type="date"
              className="rounded-2xl border border-slate-300 px-4 py-3"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-slate-700 ">Giltig till</span>
            <input
              name="valid_to"
              type="date"
              className="rounded-2xl border border-slate-300 px-4 py-3"
            />
          </label>
        </div>
        <button className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 md:col-span-2">
          Spara fullmaktsscope
        </button>
      </form>
    </section>
  );
}

export function NotesSection({
  customerId,
  notes,
}: {
  customerId: string;
  notes: CustomerInternalNoteRow[];
}) {
  return (
    <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
      <form
        action={createCustomerInternalNoteAction}
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm "
      >
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-slate-900 ">
            Intern anteckning
          </h2>
          <p className="mt-1 text-sm text-slate-700 ">
            Logga intern drift- och handläggningsinformation som inte hör hemma
            i kundens avtal eller adressfält.
          </p>
        </div>

        <input type="hidden" name="customer_id" value={customerId} />

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700 ">
            Anteckning
          </span>
          <textarea
            name="body"
            rows={8}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 "
            placeholder="Skriv intern notering för drift eller handläggning..."
          />
        </label>

        <div className="mt-6 flex justify-end">
          <button className="inline-flex items-center rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 ">
            Spara anteckning
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
        <div className="border-b border-slate-200 px-6 py-4 ">
          <h2 className="text-lg font-semibold text-slate-900 ">
            Intern historik
          </h2>
          <p className="mt-1 text-sm text-slate-700 ">
            {notes.length} anteckningar kopplade till kunden.
          </p>
        </div>

        {notes.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-700 ">
            Inga interna anteckningar ännu.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 ">
            {notes.map((note) => (
              <article key={note.id} className="p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-medium text-slate-900 ">
                    Intern notering
                  </div>
                  <div className="text-xs text-slate-700 ">
                    Skapad {formatDateTime(note.created_at)}
                  </div>
                </div>

                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700 ">
                  {note.body}
                </p>

                <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-700 ">
                  <span>Skapad av: {note.created_by ?? "System"}</span>
                  <span>Uppdaterad: {formatDateTime(note.updated_at)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function AuditSection({
  auditLogs,
  sites,
  meteringPoints,
}: {
  auditLogs: AuditLogRow[];
  sites: CustomerSiteRow[];
  meteringPoints: MeteringPointRow[];
}) {
  const siteNameById = new Map(sites.map((site) => [site.id, site.site_name]));
  const meteringPointNameById = new Map(
    meteringPoints.map((point) => [point.id, point.meter_point_id]),
  );

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
      <div className="border-b border-slate-200 px-6 py-5 ">
        <h2 className="text-lg font-semibold text-slate-900 ">
          Senaste ändringar
        </h2>
        <p className="mt-1 text-sm text-slate-700 ">
          Visar senaste audit-händelser för kund, anläggningar och mätpunkter.
        </p>
      </div>

      {auditLogs.length === 0 ? (
        <div className="p-10 text-center text-sm text-slate-700 ">
          Inga audit-händelser hittades ännu.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 ">
              <tr className="border-b border-slate-200 text-left ">
                <th className="px-6 py-4 font-semibold text-slate-700 ">Tid</th>
                <th className="px-6 py-4 font-semibold text-slate-700 ">
                  Objekt
                </th>
                <th className="px-6 py-4 font-semibold text-slate-700 ">
                  Händelse
                </th>
                <th className="px-6 py-4 font-semibold text-slate-700 ">
                  Användare
                </th>
                <th className="px-6 py-4 font-semibold text-slate-700 ">
                  Detalj
                </th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => {
                const title =
                  log.entity_type === "customer_site"
                    ? (siteNameById.get(log.entity_id) ?? log.entity_id)
                    : log.entity_type === "metering_point"
                      ? (meteringPointNameById.get(log.entity_id) ??
                        log.entity_id)
                      : log.entity_id;

                return (
                  <tr key={log.id} className="align-top">
                    <td className="px-6 py-4 text-slate-700 ">
                      {formatDateTime(log.created_at)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900 ">
                        {entityLabel(log.entity_type)}
                      </div>
                      <div className="mt-1 text-xs text-slate-700 ">
                        {title}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-700 ">
                      {actionLabel(log.action)}
                    </td>
                    <td className="px-6 py-4">
                      <ActorCell actorUserId={log.actor_user_id} />
                    </td>
                    <td className="px-6 py-4 text-slate-700 ">
                      <div>{compactJson(log.new_values)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function CustomerWebsiteTraceabilityCard({
  customer,
  applications,
  billingPartners,
  isPlatformAdmin,
}: {
  customer: CustomerRow;
  applications: WebsiteApplicationAdminRow[];
  billingPartners: BillingPartnerCustomerSummary[];
  isPlatformAdmin: boolean;
}) {
  const latestApplication = applications[0] ?? null;
  const latestBillingPartner = billingPartners[0] ?? null;
  const origin = sourceLabel(
    latestApplication?.source ?? customer.source ?? "manual",
  );
  const externalCustomerId = latestApplication?.external_customer_id ?? "—";
  const latestStatus = applicationIntakeStatusLabel(
    latestApplication?.status ?? null,
  );
  const capwayReference =
    latestBillingPartner?.provider_debtor_id ??
    latestBillingPartner?.provider_customer_id ??
    "—";
  const missingFields = Array.isArray(latestApplication?.missing_fields)
    ? latestApplication?.missing_fields
        .map((item) => humanizeMissingField(item))
        .filter(Boolean)
    : [];
  const nextStep =
    latestApplication?.next_step ??
    (missingFields.length > 0
      ? "Komplettera kundansökan."
      : "Kontrollera kundens nästa steg.");

  if (!isPlatformAdmin) {
    return (
      <section className="rounded-3xl border border-emerald-100 bg-emerald-50 p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">Kundöversikt</p>
        <h2 className="mt-2 text-xl font-semibold text-slate-950">Kundens ärende</h2>
        <p className="mt-2 text-sm leading-6 text-emerald-900">Samlad status för kundens ansökan och nästa administrativa steg.</p>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3"><div className="text-xs uppercase tracking-[0.14em] text-slate-600">Kundnummer</div><div className="mt-1 font-mono text-sm font-semibold text-slate-950">{customer.customer_number ?? "—"}</div></div>
          <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3"><div className="text-xs uppercase tracking-[0.14em] text-slate-600">Kundkälla</div><div className="mt-1 text-sm font-semibold text-slate-950">{origin}</div></div>
          <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3"><div className="text-xs uppercase tracking-[0.14em] text-slate-600">Ansökningsstatus</div><div className="mt-1 text-sm font-semibold text-slate-950">{latestStatus}</div></div>
          <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3"><div className="text-xs uppercase tracking-[0.14em] text-slate-600">Senaste uppdatering</div><div className="mt-1 text-sm font-semibold text-slate-950">{formatDateTime(latestApplication?.updated_at ?? latestApplication?.created_at ?? customer.created_at)}</div></div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-emerald-100 bg-emerald-50 p-6 shadow-sm ">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800 ">
            Externa referenser
          </p>
          <h2 className="mt-2 text-xl font-semibold text-slate-950 ">
            API- och partnerkopplingar
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-emerald-900 ">
            Visar tekniska referenser för hemsida, kundportal och fakturapartner.
          </p>
        </div>
        <Link
          href={`/admin/customers/${customer.id}#tekniskt`}
          className="rounded-2xl border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 "
        >
          Visa kommunikation
        </Link>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-8">
        <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-[0.14em] text-slate-600">
            Kundnummer
          </div>
          <div className="mt-1 font-mono text-sm font-semibold text-slate-950">
            {customer.customer_number ?? "—"}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-[0.14em] text-slate-600">
            Källa
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-950">
            {origin}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-[0.14em] text-slate-600">
            Extern referens
          </div>
          <div className="mt-1 font-mono text-xs font-semibold text-slate-950">
            {externalCustomerId}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-[0.14em] text-slate-600">
            Ansökningsstatus
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-950">
            {latestStatus}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-[0.14em] text-slate-600">
            Nästa steg
          </div>
          <div className="mt-1 text-xs font-semibold text-slate-950">
            {nextStep}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-[0.14em] text-slate-600">
            Saknas
          </div>
          <div className="mt-1 text-xs font-semibold text-slate-950">
            {missingFields.length > 0
              ? missingFields.slice(0, 3).join(", ")
              : "Inget blockerar"}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-[0.14em] text-slate-600">
            Capway/debtor
          </div>
          <div className="mt-1 font-mono text-xs font-semibold text-slate-950">
            {capwayReference}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-[0.14em] text-slate-600">
            Senaste ansökan
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-950">
            {formatDateTime(latestApplication?.created_at)}
          </div>
        </div>
      </div>

      {latestApplication && missingFields.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 ">
          Kundansökan behöver kompletteras innan leverantörsbyte kan startas.
          Saknas: {missingFields.join(", ")}.{" "}
          <Link
            href="/admin/website-applications?status=needs_information"
            className="underline"
          >
            Öppna arbetsvyn
          </Link>
          .
        </div>
      ) : null}
      {latestApplication?.error_stage ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 ">
          Senaste ansökan från hemsida har fel: {latestApplication.error_stage}{" "}
          ·{" "}
          {latestApplication.error_message ??
            latestApplication.error_code ??
            "okänt fel"}
          .
        </div>
      ) : null}
    </section>
  );
}
