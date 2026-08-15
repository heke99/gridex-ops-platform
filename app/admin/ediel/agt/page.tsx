import Link from "next/link";
import type { ReactNode } from "react";
import AdminHeader from "@/components/admin/AdminHeader";
import { requirePlatformAdminAccess } from "@/lib/admin/guards";
import { listEdielTestRuns } from "@/lib/ediel/db";
import { getEdielAgtSupplierRuntime } from "@/lib/ediel/testing/agtRuntime";
import { getEdielSystemTestSettings } from "@/lib/ediel/systemTestSettings";
import { EDIEL_AGT_SUPPLIER_2026A_CASES } from "@/lib/ediel/testing/agtRegistry";
import {
  createAgtSupplierTestRunAction,
  createAgtSupplierOutboundCommandAction,
  saveAgtSupplierRuntimeAction,
} from "@/app/admin/ediel/agt/actions";

export const dynamic = "force-dynamic";

function inputClassName() {
  return "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500";
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | number | boolean | null | undefined;
}) {
  const display =
    value === null || value === undefined || String(value).trim() === ""
      ? "—"
      : String(value);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">
        {label}
      </div>
      <div className="mt-1 break-all text-sm text-slate-950">{display}</div>
    </div>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "emerald" | "amber" | "red" | "slate";
  children: ReactNode;
}) {
  const className =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}
    >
      {children}
    </span>
  );
}

function issueTone(severity: "error" | "warning" | "info") {
  if (severity === "error") return "red" as const;
  if (severity === "warning") return "amber" as const;
  return "emerald" as const;
}

function RouteCard({
  title,
  family,
  route,
  profile,
  portalEdielId,
  receiverSubaddress,
}: {
  title: string;
  family: "PRODAT" | "UTILTS";
  route: Awaited<
    ReturnType<typeof getEdielAgtSupplierRuntime>
  >["prodat"]["route"];
  profile: Awaited<
    ReturnType<typeof getEdielAgtSupplierRuntime>
  >["prodat"]["profile"];
  portalEdielId: string | null;
  receiverSubaddress: string | null;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-slate-950">{title}</div>
          <div className="mt-1 text-sm text-slate-700">
            Runtime route + Ediel profile som AGT använder.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={route?.is_active ? "emerald" : "red"}>
            {route?.is_active ? "route aktiv" : "route saknas/inaktiv"}
          </Badge>
          <Badge tone={profile?.is_enabled ? "emerald" : "red"}>
            {profile?.is_enabled ? "profil aktiv" : "profil saknas/inaktiv"}
          </Badge>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label="Route name" value={route?.route_name} />
        <Field label="Target email" value={route?.target_email} />
        <Field label="Sender Ediel-id" value={profile?.sender_ediel_id} />
        <Field label="Receiver Ediel-id" value={profile?.receiver_ediel_id} />
        <Field label="Sender subaddress" value={profile?.sender_sub_address} />
        <Field
          label="Receiver subaddress"
          value={profile?.receiver_sub_address}
        />
        <Field label="Ack mode" value={profile?.ack_mode} />
        <Field label="Encryption" value={profile?.encryption_mode} />
      </div>

      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        {family === "PRODAT"
          ? `PRODAT AGT ska gå mot DB-konfigurerad testportal ${portalEdielId ?? "—"}. Sender-subadress ska följa tenantens Edielregisteruppgift; receiver-subadress är ${receiverSubaddress ?? "—"}.`
          : `UTILTS AGT ska gå mot DB-konfigurerad testportal ${portalEdielId ?? "—"} utan subadress.`}
      </div>
    </div>
  );
}

function caseTone(hasRun: boolean) {
  return hasRun ? "emerald" : "slate";
}

function directionLabel(direction: "actor_to_portal" | "portal_to_actor") {
  return direction === "actor_to_portal"
    ? "Leverantör → Edielportalen"
    : "Edielportalen → Leverantör";
}

function notesText(notes: string | string[]) {
  return Array.isArray(notes) ? notes.join(" ") : notes;
}

function parseAgtActorNotes(notes?: string | null): {
  balanceResponsibleEdielId: string | null;
} {
  if (!notes) return { balanceResponsibleEdielId: null };
  try {
    const parsed = JSON.parse(notes) as { balanceResponsibleEdielId?: unknown };
    return {
      balanceResponsibleEdielId:
        typeof parsed.balanceResponsibleEdielId === "string" &&
        parsed.balanceResponsibleEdielId.trim()
          ? parsed.balanceResponsibleEdielId.trim()
          : null,
    };
  } catch {
    return { balanceResponsibleEdielId: null };
  }
}

type PageProps = {
  searchParams?: Promise<{ companyId?: string }>;
};

export default async function EdielAgtPage({ searchParams }: PageProps) {
  const context = await requirePlatformAdminAccess();
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const companyId =
    typeof resolvedSearchParams.companyId === "string" &&
    resolvedSearchParams.companyId.trim().length > 0
      ? resolvedSearchParams.companyId.trim()
      : null;
  const [runtime, testRuns, systemTestSettings] = await Promise.all([
    getEdielAgtSupplierRuntime(companyId),
    companyId ? listEdielTestRuns({ scope: 'tenant', companyId }) : Promise.resolve([]),
    getEdielSystemTestSettings({
      companyId,
      testSuite: "AGT",
      actorRole: "supplier",
      messageFamily: "PRODAT",
      setupPackage: "agt_ddq_prodat_l",
      environmentType: "agt_test",
    }),
  ]);

  const supplierAgtRuns = testRuns.filter(
    (run) =>
      run.role_code === "supplier" &&
      run.approval_version === "2026A" &&
      EDIEL_AGT_SUPPLIER_2026A_CASES.some(
        (testCase) =>
          testCase.suite === run.test_suite &&
          testCase.testCaseCode === run.test_case_code,
      ),
  );

  const errorCount = runtime.issues.filter(
    (issue) => issue.severity === "error",
  ).length;
  const warningCount = runtime.issues.filter(
    (issue) => issue.severity === "warning",
  ).length;
  const agtActorNotes = {
    balanceResponsibleEdielId:
      runtime.actor?.brp_ediel_id ??
      systemTestSettings?.testBrpEdielId ??
      parseAgtActorNotes(runtime.actor?.notes).balanceResponsibleEdielId,
  };
  const portalEdielId =
    systemTestSettings?.testPortalEdielId ??
    runtime.prodat.profile?.receiver_ediel_id ??
    runtime.utilts.profile?.receiver_ediel_id ??
    null;
  const portalSmtp =
    systemTestSettings?.testPortalEmail ??
    runtime.prodat.route?.target_email ??
    runtime.utilts.route?.target_email ??
    null;
  const receiverSubaddress =
    systemTestSettings?.defaultReceiverSubaddress ??
    runtime.prodat.profile?.receiver_sub_address ??
    null;

  return (
    <div className="space-y-6">
      <AdminHeader
        title="Aktörsgodkännande (AGT)"
        subtitle="Låst plattformsyta för aktörs- och leverantörsgodkännande mot Edielportalen."
        userEmail={context.email}
        workspaceName="Plattformskontroll"
        workspaceMode="platform"
      />

      <section className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-emerald-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Låst godkännandeyta
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">
              Först ska godkännandeytan vara redo
            </h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
              Värdena i formuläret sparas i aktörskort, communication_routes och
              ediel_route_profiles. Bolagets Ediel-ID och systemtestmottagare
              sparas i databasen. Runtime ska läsa från ediel_actor_settings,
              ediel_counterparties och ediel_system_test_settings — inte från
              hårdkodade portalvärden.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={runtime.isReady ? "emerald" : "red"}>
              {runtime.isReady ? "godkännande redo" : "godkännande blockerat"}
            </Badge>
            <Badge tone={errorCount > 0 ? "red" : "emerald"}>
              fel {errorCount}
            </Badge>
            <Badge tone={warningCount > 0 ? "amber" : "emerald"}>
              varningar {warningCount}
            </Badge>
            <Link
              href="/admin/ediel"
              className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Till Ediel
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Field label="Aktiv aktör" value={runtime.actor?.actor_name} />
        <Field
          label="Aktörens Ediel-id"
          value={runtime.actor?.actor_ediel_id}
        />
        <Field label="Aktörsroll" value={runtime.actor?.actor_role} />
        <Field label="Miljö" value={runtime.actor?.environment} />
        <Field label="Portal Ediel-id" value={portalEdielId} />
        <Field label="Portal SMTP" value={portalSmtp} />
      </section>

      {runtime.issues.length > 0 ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Readiness issues
          </h2>
          <div className="mt-4 space-y-3">
            {runtime.issues.map((issue) => (
              <div
                key={issue.code}
                className="rounded-xl border border-white/70 bg-white p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={issueTone(issue.severity)}>
                    {issue.severity}
                  </Badge>
                  <div className="text-sm font-semibold text-slate-950">
                    {issue.title}
                  </div>
                </div>
                <div className="mt-1 text-sm text-slate-700">
                  {issue.description}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
          Readiness är grön. Du kan starta ett AGT-test i Edielportalen och
          skapa motsvarande run här som bevislogg.
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Leverantörens AGT-info
          </h2>
          <p className="mt-1 text-sm text-slate-700">
            Det är här du lägger in aktiv leverantör/tenant. För framtida
            SaaS-kunder ändras samma fält till kundens bolagsnamn, Ediel-id och
            e-post/routing.
          </p>
        </div>

        <form
          action={saveAgtSupplierRuntimeAction}
          className="grid gap-5 xl:grid-cols-2"
        >
          <input type="hidden" name="company_id" value={companyId ?? ""} />
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">
              Aktörskort
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm text-slate-700">
                Bolagsnamn
                <input
                  name="actor_name"
                  defaultValue={runtime.actor?.actor_name ?? ""}
                  className={inputClassName()}
                />
              </label>
              <label className="text-sm text-slate-700">
                Leverantörens Ediel-id
                <input
                  name="actor_ediel_id"
                  defaultValue={runtime.actor?.actor_ediel_id ?? ""}
                  className={inputClassName()}
                />
              </label>
              <label className="text-sm text-slate-700">
                Balansansvarig Ediel-id
                <input
                  name="balance_responsible_ediel_id"
                  defaultValue={agtActorNotes.balanceResponsibleEdielId ?? ""}
                  className={inputClassName()}
                  placeholder="BRP-id krävs för L1/L7 Z03/Z09"
                />
              </label>
              <label className="text-sm text-slate-700">
                PRODAT sender subaddress
                <input
                  name="prodat_sender_sub_address"
                  defaultValue={
                    runtime.prodat.profile?.sender_sub_address ??
                    runtime.actor?.sender_sub_address ??
                    ""
                  }
                  className={inputClassName()}
                  placeholder="Lämna tom om Edielregistret saknar subadress"
                />
              </label>
              <label className="text-sm text-slate-700">
                Sender name
                <input
                  name="sender_name"
                  defaultValue={
                    runtime.actor?.sender_name ??
                    runtime.actor?.actor_name ??
                    ""
                  }
                  className={inputClassName()}
                />
              </label>
              <label className="text-sm text-slate-700">
                Mailbox
                <input
                  name="mailbox"
                  defaultValue={runtime.actor?.mailbox ?? "INBOX"}
                  className={inputClassName()}
                />
              </label>
              <label className="text-sm text-slate-700">
                SMTP from email
                <input
                  name="smtp_from_email"
                  defaultValue={runtime.actor?.smtp_from_email ?? ""}
                  className={inputClassName()}
                  placeholder="din avsändaradress"
                />
              </label>
              <label className="text-sm text-slate-700">
                Reply-to
                <input
                  name="smtp_reply_to_email"
                  defaultValue={runtime.actor?.smtp_reply_to_email ?? ""}
                  className={inputClassName()}
                  placeholder="valfritt"
                />
              </label>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">
              Systemtest-inställningar / AGT-routes
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm text-slate-700">
                Mottagare
                <input
                  name="receiver_name"
                  defaultValue={
                    systemTestSettings?.testPortalName ?? "Edielportalen"
                  }
                  className={inputClassName()}
                />
              </label>
              <label className="text-sm text-slate-700">
                Testportal Ediel-ID
                <input
                  name="receiver_ediel_id"
                  defaultValue={portalEdielId ?? ""}
                  className={inputClassName()}
                  placeholder="Testportalens Ediel-ID från systemtestinställning"
          