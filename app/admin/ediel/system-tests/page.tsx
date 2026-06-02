import Link from "next/link";
import type { ReactNode } from "react";
import AdminHeader from "@/components/admin/AdminHeader";
import { requirePlatformAdminAccess } from "@/lib/admin/guards";
import { supabaseService } from "@/lib/supabase/service";
import { listEdielMessages, listEdielTestRuns } from "@/lib/ediel/db";
import { getOperationalCompanyScope } from "@/lib/tenant/scope";
import {
  getEdielSystemTestRuntimeContext,
  type EdielSystemTestRuntimeContext,
} from "@/lib/ediel/systemTestSettings";
import {
  evaluateEdielTgtRun,
  getEdielTgtTestCases,
  type EdielTgtTestCaseDefinition,
} from "@/lib/ediel/tgtRegistry";
import { createEdielTgtRunFromTemplateAction } from "@/app/admin/ediel/actions";
import { saveSimpleSystemTestCompanySetupAction } from "@/app/admin/ediel/system-tests/actions";

export const dynamic = "force-dynamic";

type Tone = "emerald" | "amber" | "red" | "slate" | "blue";
type TestRunList = Awaited<ReturnType<typeof listEdielTestRuns>>;
type MessageList = Awaited<ReturnType<typeof listEdielMessages>>;
type CompanyOption = {
  id: string;
  name: string | null;
  ediel_id?: string | null;
  org_number?: string | null;
};
type CertificateOption = {
  id: string;
  display_name?: string | null;
  fingerprint_sha256?: string | null;
  certificate_fingerprint?: string | null;
  valid_to?: string | null;
  certificate_valid_to?: string | null;
  status?: string | null;
  environment?: string | null;
  scope?: string | null;
};
type FilterPacket =
  | "all"
  | "u3"
  | "u31"
  | "u32"
  | "esco"
  | "utilts"
  | "prodat"
  | "l"
  | "e"
  | "ul"
  | "ue"
  | "agt"
  | "tgt";
type FilterFamily =
  | "all"
  | "PRODAT"
  | "UTILTS"
  | "APERAK"
  | "CONTRL"
  | "UTILTS_ERR"
  | "AI_LIST"
  | "NBS_XML";
type FilterTestType = "all" | "tgt" | "agt" | "regression" | "payload";
type FilterDirection =
  | "all"
  | "portal_to_gridex"
  | "gridex_to_portal"
  | "external_to_gridex"
  | "gridex_to_external";
type FilterStatus =
  | "all"
  | "not_started"
  | "running"
  | "passed"
  | "failed"
  | "waiting_inbound"
  | "waiting_contrl"
  | "waiting_aperak"
  | "waiting_utilts_err"
  | "blocked";

function badgeClass(tone: Tone) {
  if (tone === "emerald")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tone === "amber") return "border-amber-200 bg-amber-50 text-amber-700";
  if (tone === "red") return "border-red-200 bg-red-50 text-red-700";
  if (tone === "blue") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function Badge({
  tone = "slate",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass(tone)}`}
    >
      {children}
    </span>
  );
}

function isU3(testCase: EdielTgtTestCaseDefinition): boolean {
  return (
    testCase.roleCode === "esco" &&
    testCase.suite === "UTILTS" &&
    testCase.testCaseCode.toUpperCase().startsWith("U3.")
  );
}

function caseGroup(testCase: EdielTgtTestCaseDefinition): string {
  const code = testCase.testCaseCode.toUpperCase();
  if (code.startsWith("U3.1")) return "U3.1 - Korrekt UTILTS E66";
  if (code.startsWith("U3.2")) return "U3.2 - Felaktig UTILTS E66";
  if (testCase.roleCode === "esco" && testCase.suite === "PRODAT")
    return "ESCO PRODAT tillstånd";
  if (testCase.roleCode === "esco" && testCase.suite === "UTILTS")
    return "ESCO UTILTS övriga";
  if (testCase.suite === "UTILTS") return "UTILTS leverantör";
  return "PRODAT leverantör";
}

function casePriority(testCase: EdielTgtTestCaseDefinition): number {
  const code = testCase.testCaseCode.toUpperCase();
  if (code === "U3.1.1") return 1;
  if (code === "U3.1.2") return 2;
  if (code === "U3.2.1") return 3;
  if (code === "U3.2.2") return 4;
  if (testCase.roleCode === "esco" && testCase.suite === "UTILTS") return 10;
  if (testCase.roleCode === "esco" && testCase.suite === "PRODAT") return 20;
  if (testCase.suite === "UTILTS") return 30;
  return 40;
}

function compareCase(
  a: EdielTgtTestCaseDefinition,
  b: EdielTgtTestCaseDefinition,
) {
  const prio = casePriority(a) - casePriority(b);
  if (prio !== 0) return prio;
  return a.testCaseCode.localeCompare(b.testCaseCode, "sv");
}

function normalizePacket(value: string | undefined): FilterPacket {
  const normalized = String(value ?? "u3").toLowerCase();
  if (
    normalized === "all" ||
    normalized === "u3" ||
    normalized === "u31" ||
    normalized === "u32" ||
    normalized === "esco" ||
    normalized === "utilts" ||
    normalized === "prodat" ||
    normalized === "l" ||
    normalized === "e" ||
    normalized === "ul" ||
    normalized === "ue" ||
    normalized === "agt" ||
    normalized === "tgt"
  )
    return normalized;
  return "u3";
}

function normalizeFamily(value: string | undefined): FilterFamily {
  const normalized = String(value ?? "all")
    .trim()
    .toUpperCase();
  if (
    normalized === "PRODAT" ||
    normalized === "UTILTS" ||
    normalized === "APERAK" ||
    normalized === "CONTRL" ||
    normalized === "UTILTS_ERR" ||
    normalized === "AI_LIST" ||
    normalized === "NBS_XML"
  )
    return normalized;
  return "all";
}

function normalizeTestType(value: string | undefined): FilterTestType {
  const normalized = String(value ?? "all").toLowerCase();
  if (
    normalized === "all" ||
    normalized === "tgt" ||
    normalized === "agt" ||
    normalized === "regression" ||
    normalized === "payload"
  )
    return normalized;
  return "all";
}

function normalizeDirection(value: string | undefined): FilterDirection {
  const normalized = String(value ?? "all").toLowerCase();
  if (
    normalized === "all" ||
    normalized === "portal_to_gridex" ||
    normalized === "gridex_to_portal" ||
    normalized === "external_to_gridex" ||
    normalized === "gridex_to_external"
  )
    return normalized;
  return "all";
}

function normalizeStatus(value: string | undefined): FilterStatus {
  const normalized = String(value ?? "all").toLowerCase();
  if (
    normalized === "all" ||
    normalized === "not_started" ||
    normalized === "running" ||
    normalized === "passed" ||
    normalized === "failed" ||
    normalized === "waiting_inbound" ||
    normalized === "waiting_contrl" ||
    normalized === "waiting_aperak" ||
    normalized === "waiting_utilts_err" ||
    normalized === "blocked"
  )
    return normalized;
  return "all";
}

function statusTone(status: string | null | undefined): Tone {
  if (status === "passed") return "emerald";
  if (status === "failed") return "red";
  if (status === "running" || status === "draft") return "amber";
  if (status === "not_started") return "slate";
  return "slate";
}

function runsForCase(testCase: EdielTgtTestCaseDefinition, runs: TestRunList) {
  return runs.filter(
    (run) =>
      run.test_suite === testCase.suite &&
      run.role_code === testCase.roleCode &&
      run.test_case_code === testCase.testCaseCode &&
      run.status !== "cancelled",
  );
}

function latestRunForCase(
  testCase: EdielTgtTestCaseDefinition,
  activeRuns: TestRunList,
) {
  return (
    [...runsForCase(testCase, activeRuns)].sort((a, b) =>
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
    )[0] ?? null
  );
}

function detailedStatusForEvaluation(
  testCase: EdielTgtTestCaseDefinition,
  activeRuns: TestRunList,
  messages?: MessageList,
): { key: FilterStatus; label: string; tone: Tone } {
  const runs = runsForCase(testCase, activeRuns);
  if (runs.length === 0)
    return { key: "not_started", label: "Inte påbörjad", tone: "slate" };
  if (runs.some((run) => run.status === "passed"))
    return { key: "passed", label: "Klar", tone: "emerald" };

  const latestRun = latestRunForCase(testCase, activeRuns);
  if (!latestRun)
    return { key: "not_started", label: "Inte påbörjad", tone: "slate" };
  if (latestRun.status === "failed")
    return { key: "failed", label: "Fel", tone: "red" };
  if (!messages) return { key: "running", label: "Pågår", tone: "amber" };

  const evaluation = evaluateEdielTgtRun(latestRun, messages);
  if (evaluation.computedStatus === "failed" || evaluation.hasMismatch)
    return { key: "blocked", label: "Blockerad", tone: "red" };
  if (evaluation.computedStatus === "passed")
    return { key: "passed", label: "Klar", tone: "emerald" };

  const missing = evaluation.matches.find(
    (match) => match.step.required && match.status !== "passed",
  );
  if (!missing) return { key: "running", label: "Pågår", tone: "amber" };
  if (missing.step.direction === "inbound")
    return {
      key: "waiting_inbound",
      label: "Väntar på inbound",
      tone: "amber",
    };
  if (missing.step.family === "CONTRL")
    return { key: "waiting_contrl", label: "Väntar på CONTRL", tone: "amber" };
  if (missing.step.family === "APERAK")
    return { key: "waiting_aperak", label: "Väntar på APERAK", tone: "amber" };
  if (missing.step.family === "UTILTS_ERR")
    return {
      key: "waiting_utilts_err",
      label: "Väntar på UTILTS_ERR",
      tone: "amber",
    };
  return { key: "running", label: "Pågår", tone: "amber" };
}

function statusForCase(
  testCase: EdielTgtTestCaseDefinition,
  activeRuns: TestRunList,
  messages?: MessageList,
): { key: FilterStatus; label: string; tone: Tone } {
  return detailedStatusForEvaluation(testCase, activeRuns, messages);
}

function testDirectionLabel(testCase: EdielTgtTestCaseDefinition): string {
  const first = testCase.expectedSteps[0];
  if (!first) return "Testkedja saknas";
  if (first.direction === "inbound" && first.actor === "portal")
    return "Portal → Gridex";
  if (first.direction === "outbound" && first.actor === "gridex")
    return "Gridex → Portal";
  return `${first.actor} ${first.direction}`;
}

function expectedResponseLabel(testCase: EdielTgtTestCaseDefinition): string {
  const required = testCase.expectedSteps.filter(
    (step) =>
      step.required && step.actor === "gridex" && step.direction === "outbound",
  );
  if (required.some((step) => step.family === "UTILTS_ERR"))
    return "Svar: positiv CONTRL + UTILTS_ERR";
  const aperak = required.find((step) => step.family === "APERAK");
  if (aperak?.outcome === "negative")
    return "Svar: positiv CONTRL + negativ APERAK";
  if (aperak?.outcome === "positive")
    return "Svar: positiv CONTRL + positiv APERAK";
  if (required.some((step) => step.family === "CONTRL")) return "Svar: CONTRL";
  return "Svar enligt kedja";
}

function matchesPacket(
  testCase: EdielTgtTestCaseDefinition,
  packet: FilterPacket,
): boolean {
  const code = testCase.testCaseCode.toUpperCase();
  if (packet === "all") return true;
  if (packet === "u3") return isU3(testCase);
  if (packet === "u31") return isU3(testCase) && code.startsWith("U3.1");
  if (packet === "u32") return isU3(testCase) && code.startsWith("U3.2");
  if (packet === "esco") return testCase.roleCode === "esco";
  if (packet === "utilts") return testCase.suite === "UTILTS";
  if (packet === "prodat") return testCase.suite === "PRODAT";
  if (packet === "e")
    return (
      testCase.roleCode === "esco" &&
      testCase.suite === "PRODAT" &&
      (/^E\d/i.test(code) || code.startsWith("8.") || code.startsWith("9."))
    );
  if (packet === "ue")
    return (
      testCase.roleCode === "esco" &&
      testCase.suite === "UTILTS" &&
      (code.startsWith("UE") || code.startsWith("U3."))
    );
  if (packet === "l")
    return (
      testCase.roleCode === "supplier" &&
      testCase.suite === "PRODAT" &&
      code.startsWith("L")
    );
  if (packet === "ul")
    return (
      testCase.roleCode === "supplier" &&
      testCase.suite === "UTILTS" &&
      code.startsWith("UL")
    );
  if (packet === "agt")
    return (
      code.startsWith("L") ||
      code.startsWith("UL") ||
      code.startsWith("UE") ||
      code.startsWith("E")
    );
  if (packet === "tgt")
    return (
      !code.startsWith("L") && !code.startsWith("UL") && !code.startsWith("UE")
    );
  return true;
}

function isAgtCase(testCase: EdielTgtTestCaseDefinition): boolean {
  const code = testCase.testCaseCode.toUpperCase();
  return (
    code.startsWith("L") ||
    code.startsWith("UL") ||
    code.startsWith("UE") ||
    /^E\d/.test(code)
  );
}

function matchesRole(
  testCase: EdielTgtTestCaseDefinition,
  role: string,
): boolean {
  if (!role) return true;
  if (role === "system_provider") return !isAgtCase(testCase);
  return testCase.roleCode === role;
}

function matchesFamily(
  testCase: EdielTgtTestCaseDefinition,
  family: FilterFamily,
): boolean {
  if (family === "all") return true;
  if (family === "AI_LIST" || family === "NBS_XML")
    return testCase.suite === family;
  return (
    String(testCase.suite) === family ||
    testCase.expectedSteps.some((step) => step.family === family)
  );
}

function matchesTestType(
  testCase: EdielTgtTestCaseDefinition,
  testType: FilterTestType,
): boolean {
  if (testType === "all") return true;
  if (testType === "agt") return isAgtCase(testCase);
  if (testType === "tgt") return !isAgtCase(testCase);
  if (testType === "payload") return true;
  if (testType === "regression") return true;
  return true;
}

function matchesDirection(
  testCase: EdielTgtTestCaseDefinition,
  direction: FilterDirection,
): boolean {
  if (direction === "all") return true;
  const first = testCase.expectedSteps[0];
  if (!first) return false;
  if (direction === "portal_to_gridex")
    return first.actor === "portal" && first.direction === "inbound";
  if (direction === "gridex_to_portal")
    return first.actor === "gridex" && first.direction === "outbound";
  if (direction === "external_to_gridex") return first.direction === "inbound";
  if (direction === "gridex_to_external") return first.direction === "outbound";
  return true;
}

function matchesQuery(
  testCase: EdielTgtTestCaseDefinition,
  q: string,
): boolean {
  if (!q) return true;
  return [
    testCase.testCaseCode,
    testCase.title,
    testCase.purpose,
    testCase.suite,
    testCase.roleCode,
    testCase.testDataHint,
    caseGroup(testCase),
    expectedResponseLabel(testCase),
  ]
    .join(" ")
    .toUpperCase()
    .includes(q);
}

function IdentityPanel({
  runtime,
}: {
  runtime: EdielSystemTestRuntimeContext | null;
}) {
  const actorEdielId = runtime?.actorEdielId ?? "saknas";
  const portalEdielId = runtime?.testPortalEdielId ?? "saknas";
  const portalEmail = runtime?.testPortalEmail ?? "saknar mottagarmail";

  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
            Aktörsidentitet för TGT/U3
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">
            Systemtest körs med bolagets Ediel-ID från databasen: {actorEdielId}
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-blue-900">
            För U3 UTILTS E66 är detta portal → aktör. Edielportalen skickar
            inbound till bolagets DB-konfigurerade testaktör. Motparten hämtas
            från systemtestinställningar: {portalEdielId} ({portalEmail}). Inga
            TGT-/AGT-ID:n ska hårdkodas i frontend.
          </p>
        </div>
        <div className="grid gap-2 text-xs text-blue-950 sm:grid-cols-2">
          <div className="rounded-xl border border-blue-200 bg-white p-3">
            <div className="font-semibold">System / aktör</div>
            <div>Ediel-ID: {actorEdielId}</div>
            <div>Roll: Energitjänsteföretag / testaktör</div>
          </div>
          <div className="rounded-xl border border-blue-200 bg-white p-3">
            <div className="font-semibold">Motpart</div>
            <div>Ediel-ID: {portalEdielId}</div>
            <div>{portalEmail}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function QuickFilters({
  packet,
  status,
  q,
  family,
  testType,
  direction,
  suite,
  role,
  companyId,
}: {
  packet: FilterPacket;
  status: FilterStatus;
  q: string;
  family: FilterFamily;
  testType: FilterTestType;
  direction: FilterDirection;
  suite: string;
  role: string;
  companyId: string | null;
}) {
  const base = `/admin/ediel/system-tests?status=${encodeURIComponent(status)}&family=${encodeURIComponent(family)}&testType=${encodeURIComponent(testType)}&direction=${encodeURIComponent(direction)}${companyId ? `&companyId=${encodeURIComponent(companyId)}` : ""}${suite ? `&suite=${encodeURIComponent(suite)}` : ""}${role ? `&role=${encodeURIComponent(role)}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const items: Array<{ key: FilterPacket; label: string }> = [
    { key: "u3", label: "U3 alla" },
    { key: "u31", label: "U3.1 korrekta" },
    { key: "u32", label: "U3.2 felaktiga" },
    { key: "esco", label: "Alla energitjänsteföretag" },
    { key: "e", label: "E3–E8 PRODAT ESCO" },
    { key: "ue", label: "UE1–UE2 UTILTS ESCO" },
    { key: "l", label: "L1–L7 Leverantör AGT" },
    { key: "ul", label: "UL1–UL6 UTILTS AGT" },
    { key: "utilts", label: "Alla UTILTS" },
    { key: "prodat", label: "Alla PRODAT" },
    { key: "all", label: "Alla testfall" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Link
          key={item.key}
          href={`${base}&packet=${item.key}`}
          className={`rounded-xl border px-3 py-2 text-xs font-semibold ${packet === item.key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

function StartRunForm({
  testCase,
  companyId,
}: {
  testCase: EdielTgtTestCaseDefinition;
  companyId: string | null;
}) {
  return (
    <form action={createEdielTgtRunFromTemplateAction} className="flex flex-wrap items-center gap-2">
      {companyId ? <input type="hidden" name="companyId" value={companyId} /> : null}
      <input type="hidden" name="testSuite" value={testCase.suite} />
      <input type="hidden" name="roleCode" value={testCase.roleCode} />
      <input type="hidden" name="testCaseCode" value={testCase.testCaseCode} />
      <select
        name="encryptionMode"
        defaultValue="none"
        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
        title="Välj transportläge för just denna testkörning"
      >
        <option value="none">Okrypterat test</option>
        <option value="smime">Krypterat test</option>
      </select>
      <button className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">
        Starta testkörning
      </button>
    </form>
  );
}

function TestCard({
  testCase,
  activeRuns,
  messages,
  companyId,
}: {
  testCase: EdielTgtTestCaseDefinition;
  activeRuns: TestRunList;
  messages: MessageList;
  companyId: string | null;
}) {
  const status = statusForCase(testCase, activeRuns, messages);
  const caseRuns = runsForCase(testCase, activeRuns);
  const activeCount = caseRuns.filter(
    (run) => run.status === "running" || run.status === "draft",
  ).length;
  const latestRun = latestRunForCase(testCase, activeRuns);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={isU3(testCase) ? "blue" : "emerald"}>
              {testCase.testCaseCode}
            </Badge>
            <Badge>{testCase.suite}</Badge>
            <Badge>
              {testCase.roleCode === "esco"
                ? "Energitjänsteföretag"
                : testCase.roleCode}
            </Badge>
            <Badge tone={status.tone}>{status.label}</Badge>
            {activeCount > 1 ? (
              <Badge tone="red">
                {activeCount} aktiva — kör bara en åt gången
              </Badge>
            ) : null}
          </div>
          <h3 className="mt-3 text-base font-semibold text-slate-950">
            {testCase.title}
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-700">
            {testCase.purpose}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
          <div className="font-semibold text-slate-900">Riktning</div>
          <div>{testDirectionLabel(testCase)}</div>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
          <div className="font-semibold text-slate-900">
            Förväntat Gridex-svar
          </div>
          <div>{expectedResponseLabel(testCase)}</div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs leading-5 text-slate-700">
        {testCase.testDataHint}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>{caseRuns.length} körning(ar)</span>
        <span>
          Senaste:{" "}
          {latestRun?.created_at
            ? latestRun.created_at.replace("T", " ").slice(0, 16)
            : "—"}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <StartRunForm testCase={testCase} companyId={companyId} />
        <Link
          href={`/admin/ediel/system-tests/cases/${encodeURIComponent(testCase.testCaseCode)}`}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Öppna & kör
        </Link>
      </div>
    </div>
  );
}

function SimpleCompanySetupPanel({
  companies,
  certificates,
  selectedCompanyId,
  selectedCompany,
  selectedActorRole,
  runtime,
  setupStatus,
  setupMessage,
}: {
  companies: CompanyOption[];
  certificates: CertificateOption[];
  selectedCompanyId: string | null;
  selectedCompany: CompanyOption | null;
  selectedActorRole: "esco" | "supplier";
  runtime: EdielSystemTestRuntimeContext | null;
  setupStatus: "success" | "error" | null;
  setupMessage: string | null;
}) {
  const defaultEdielId = runtime?.actorEdielId ?? selectedCompany?.ediel_id ?? "";
  const defaultTestBrpEdielId = selectedActorRole === "supplier" ? "91109" : "";

  return (
    <section className="rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
            Enkel testsetup
          </p>
          <h2 className="mt-2 text-xl font-black text-slate-950">
            Kör alla tester här som Div3rsa eller valt bolag
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
            Fyll i saknade uppgifter här en gång. Systemet sparar aktör,
            Edielportalen-route, shared mailbox, readiness och systemtestinställning
            så knapparna nedan kan köra testerna direkt från denna sida.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <div className="font-bold text-slate-950">Aktuell runtime</div>
          <div>Bolag: {selectedCompany?.name ?? selectedCompanyId ?? "saknas"}</div>
          <div>Aktör Ediel-ID: {runtime?.actorEdielId ?? "saknas"}</div>
          <div>Portal: {runtime?.testPortalEdielId ?? "91100"} · {runtime?.testPortalEmail ?? "91100@ediel.se"}</div>
        </div>
      </div>

      {setupStatus && setupMessage ? (
        <div className={`mt-5 rounded-2xl border px-4 py-3 text-sm font-semibold ${
          setupStatus === "success"
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-red-200 bg-red-50 text-red-800"
        }`}>
          {setupMessage}
        </div>
      ) : null}

      <form action={saveSimpleSystemTestCompanySetupAction} className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <select name="companyId" defaultValue={selectedCompanyId ?? ""} required className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
          <option value="">Välj bolag</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name ?? company.id}{company.org_number ? ` · ${company.org_number}` : ""}
            </option>
          ))}
        </select>
        <select name="actorRole" defaultValue={selectedActorRole} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
          <option value="esco">Energitjänsteföretag / DGI</option>
          <option value="supplier">Elleverantör / DDQ</option>
        </select>
        <input name="edielId" defaultValue={defaultEdielId} required placeholder="Bolagets Ediel-ID" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
        <input name="mailbox" defaultValue="ediel@gridex.se" required placeholder="Teknisk mailbox" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
        <input name="portalEdielId" defaultValue={runtime?.testPortalEdielId ?? "91100"} required placeholder="Edielportalen Ediel-ID" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
        <input name="portalEmail" defaultValue={runtime?.testPortalEmail ?? "91100@ediel.se"} required placeholder="Edielportalen e-post" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
        <input name="testBrpEdielId" defaultValue={defaultTestBrpEdielId} placeholder="Test-BRP (bara leverantör)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
        <select name="encryptionMode" defaultValue="none" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
          <option value="none">Okrypterat test</option>
          <option value="smime">Krypterat S/MIME-test</option>
        </select>
        <select name="certificateId" defaultValue="" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
          <option value="">Välj krypteringsversion/certifikat om S/MIME</option>
          {certificates.map((certificate) => {
            const fingerprint = certificate.fingerprint_sha256 ?? certificate.certificate_fingerprint ?? "";
            const label = [
              certificate.display_name ?? "S/MIME certifikat",
              certificate.environment ?? "test",
              certificate.status ?? "status okänd",
              fingerprint ? fingerprint.slice(0, 12) : null,
              certificate.valid_to ?? certificate.certificate_valid_to ? `giltigt till ${(certificate.valid_to ?? certificate.certificate_valid_to)?.slice(0, 10)}` : null,
            ].filter(Boolean).join(" · ");
            return <option key={certificate.id} value={certificate.id}>{label}</option>;
          })}
        </select>
        <input name="prodatSubaddress" placeholder="PRODAT subadress om krävs, annars tom" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
        <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <input type="checkbox" name="prodatSubaddressRequired" />
          PRODAT subadress krävs
        </label>
        <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white">
          Spara och gör redo för tester
        </button>
      </form>

      <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
        Efter sparning: välj testkort nedan och klicka <strong>Starta testkörning</strong>. Allt sker från denna sida.
      </div>
    </section>
  );
}

function ProgressSummary({
  cases,
  runs,
  messages,
}: {
  cases: EdielTgtTestCaseDefinition[];
  runs: TestRunList;
  messages: MessageList;
}) {
  const total = cases.length;
  const passed = cases.filter(
    (testCase) => statusForCase(testCase, runs, messages).key === "passed",
  ).length;
  const failed = cases.filter(
    (testCase) => statusForCase(testCase, runs, messages).key === "failed",
  ).length;
  const running = cases.filter((testCase) =>
    [
      "running",
      "waiting_inbound",
      "waiting_contrl",
      "waiting_aperak",
      "waiting_utilts_err",
      "blocked",
    ].includes(statusForCase(testCase, runs, messages).key),
  ).length;
  const notStarted = Math.max(0, total - passed - failed - running);
  const percent = total > 0 ? Math.round((passed / total) * 100) : 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-950">
            Status för filtrerat urval
          </div>
          <div className="mt-1 text-xs text-slate-600">
            {passed}/{total} klara · {percent}%
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="emerald">{passed} klara</Badge>
          <Badge tone={running > 0 ? "amber" : "slate"}>{running} pågår</Badge>
          <Badge tone={failed > 0 ? "red" : "slate"}>{failed} fel</Badge>
          <Badge>{notStarted} ej påbörjade</Badge>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full bg-emerald-600"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export default async function EdielSystemTestsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string;
    companyId?: string;
    setupStatus?: string;
    setupMessage?: string;
    suite?: string;
    role?: string;
    packet?: string;
    family?: string;
    testType?: string;
    direction?: string;
    status?: string;
  }>;
}) {
  const context = await requirePlatformAdminAccess();
  const scope = await getOperationalCompanyScope(context.userId);
  const query = searchParams ? await searchParams : {};
  const [companiesResult, certificatesResult] = await Promise.all([
    supabaseService
      .from("companies")
      .select("*")
      .order("name", { ascending: true })
      .limit(200),
    supabaseService
      .from("ediel_certificates")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const companies = ((companiesResult.data ?? []) as CompanyOption[]);
  const certificates = certificatesResult.error ? [] : ((certificatesResult.data ?? []) as CertificateOption[]);
  const div3rsaCompany =
    companies.find((company) => String(company.name ?? "").toLowerCase().includes("div3rsa")) ??
    companies.find((company) => String(company.name ?? "").toLowerCase().includes("diversa")) ??
    null;
  const selectedCompanyId =
    String(query.companyId ?? "").trim() ||
    scope.companyId ||
    div3rsaCompany?.id ||
    companies[0]?.id ||
    null;
  const selectedCompany = companies.find((company) => company.id === selectedCompanyId) ?? null;
  const systemTestRuntime = await getEdielSystemTestRuntimeContext({
    companyId: selectedCompanyId,
    testSuite: "TGT",
  }).catch(() => null);
  const q = String(query.q ?? "")
    .trim()
    .toUpperCase();
  const suite = String(query.suite ?? "")
    .trim()
    .toUpperCase();
  const role = String(query.role ?? "")
    .trim()
    .toLowerCase();
  const selectedActorRole: "esco" | "supplier" = role === "supplier" ? "supplier" : "esco";
  const packet = normalizePacket(query.packet);
  const family = normalizeFamily(query.family);
  const testType = normalizeTestType(query.testType);
  const direction = normalizeDirection(query.direction);
  const status = normalizeStatus(query.status);

  const [testRuns, messages] = await Promise.all([
    listEdielTestRuns().catch(() => []),
    listEdielMessages({ limit: 300 }).catch(() => []),
  ]);
  const testRunsForCards = testRuns as TestRunList;

  const allCore = getEdielTgtTestCases().filter(
    (testCase) => testCase.scope === "core",
  );
  const u3Cases = allCore.filter(isU3).sort(compareCase);
  const filteredCases = allCore
    .filter((testCase) => !suite || testCase.suite === suite)
    .filter((testCase) => matchesRole(testCase, role))
    .filter((testCase) => matchesPacket(testCase, packet))
    .filter((testCase) => matchesFamily(testCase, family))
    .filter((testCase) => matchesTestType(testCase, testType))
    .filter((testCase) => matchesDirection(testCase, direction))
    .filter((testCase) => matchesQuery(testCase, q))
    .filter(
      (testCase) =>
        status === "all" ||
        statusForCase(testCase, testRuns, messages).key === status,
    )
    .sort(compareCase);

  const evaluations = testRuns
    .filter((run) => run.status !== "cancelled")
    .map((run) => evaluateEdielTgtRun(run, messages));
  const allPassed = evaluations.filter(
    (evaluation) => evaluation.computedStatus === "passed",
  ).length;
  const allFailed = evaluations.filter(
    (evaluation) => evaluation.computedStatus === "failed",
  ).length;
  const allRunning = testRuns.filter(
    (run) => run.status === "running" || run.status === "draft",
  ).length;

  const groups = Array.from(new Set(filteredCases.map(caseGroup)));

  return (
    <div className="space-y-6">
      <AdminHeader
        title="Ediel Systemtest"
        subtitle="Körbara TGT-/AGT-testfall med filtrering, aktörsidentitet och tydlig synk mot inbound/outbound-kedjan."
        userEmail={context.email}
        workspaceName="Plattformskontroll"
        workspaceMode="platform"
      />

      <SimpleCompanySetupPanel
        companies={companies}
        certificates={certificates}
        selectedCompanyId={selectedCompanyId}
        selectedCompany={selectedCompany}
        selectedActorRole={selectedActorRole}
        runtime={systemTestRuntime}
        setupStatus={query.setupStatus === "success" ? "success" : query.setupStatus === "error" ? "error" : null}
        setupMessage={query.setupMessage ?? null}
      />

      <IdentityPanel runtime={systemTestRuntime} />

      <section className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
              Primärt testpaket nu
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">
              UTILTS E66 för energitjänsteföretag
            </h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
              Dessa fyra U3-testfall är huvudflödet nu. Starta bara ett U3-test
              åt gången, starta samma test i Edielportalen och importera/polla
              portalens inbound UTILTS E66. Dold synknyckel är testfallskoden,
              till exempel U3.1.1.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="emerald">{allPassed} klara</Badge>
            <Badge tone={allFailed > 0 ? "red" : "slate"}>
              {allFailed} fel
            </Badge>
            <Badge tone={allRunning > 0 ? "amber" : "slate"}>
              {allRunning} aktiva
            </Badge>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {u3Cases.map((testCase) => (
            <TestCard
              key={testCase.testCaseCode}
              testCase={testCase}
              activeRuns={testRunsForCards}
              messages={messages}
              companyId={selectedCompanyId}
            />
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Filtrera testfall
            </h2>
            <p className="mt-1 text-sm text-slate-700">
              Snabbfiltren nedan gör att du direkt hittar U3.1.1, U3.1.2, U3.2.1
              och U3.2.2 utan att bläddra bland alla leverantörstester.
            </p>
          </div>
          <Link
            href="/admin/ediel/agt"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Öppna AGT-vy
          </Link>
        </div>

        <div className="mt-4">
          <QuickFilters
            packet={packet}
            status={status}
            q={q}
            family={family}
            testType={testType}
            direction={direction}
            suite={suite}
            role={role}
            companyId={selectedCompanyId}
          />
        </div>

        <form className="mt-4 grid gap-3 md:grid-cols-8">
          <input type="hidden" name="packet" value={packet} />
          {selectedCompanyId ? <input type="hidden" name="companyId" value={selectedCompanyId} /> : null}
          <input
            name="q"
            defaultValue={q}
            placeholder="Sök U3.1.1, E66, SCH, kvart"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2"
          />
          <select
            name="suite"
            defaultValue={suite}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Alla sviter</option>
            <option value="PRODAT">PRODAT</option>
            <option value="UTILTS">UTILTS</option>
            <option value="AI_LIST">AI-lista</option>
            <option value="NBS_XML">NBS/eSett XML</option>
          </select>
          <select
            name="family"
            defaultValue={family}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">Alla familjer</option>
            <option value="PRODAT">PRODAT</option>
            <option value="UTILTS">UTILTS</option>
            <option value="APERAK">APERAK</option>
            <option value="CONTRL">CONTRL</option>
            <option value="UTILTS_ERR">UTILTS_ERR</option>
            <option value="AI_LIST">AI/BI-lista</option>
            <option value="NBS_XML">NBS/eSett XML</option>
          </select>
          <select
            name="role"
            defaultValue={role}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Alla roller</option>
            <option value="supplier">Leverantör</option>
            <option value="esco">Energitjänsteföretag</option>
            <option value="grid_owner">Nätägare</option>
            <option value="balance_responsible">Balansansvarig</option>
            <option value="system_provider">Systemleverantör/TGT</option>
          </select>
          <select
            name="testType"
            defaultValue={testType}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">Alla testtyper</option>
            <option value="tgt">TGT/Systemtest</option>
            <option value="agt">AGT/Aktörstest</option>
            <option value="regression">Regression</option>
            <option value="payload">Payload-test</option>
          </select>
          <select
            name="direction"
            defaultValue={direction}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">Alla riktningar</option>
            <option value="portal_to_gridex">Portal → Gridex</option>
            <option value="gridex_to_portal">Gridex → Portal</option>
            <option value="external_to_gridex">Extern aktör → Gridex</option>
            <option value="gridex_to_external">Gridex → extern aktör</option>
          </select>
          <select
            name="status"
            defaultValue={status}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">Alla statusar</option>
            <option value="not_started">Inte påbörjad</option>
            <option value="running">Pågår</option>
            <option value="waiting_inbound">Väntar på inbound</option>
            <option value="waiting_contrl">Väntar på CONTRL</option>
            <option value="waiting_aperak">Väntar på APERAK</option>
            <option value="waiting_utilts_err">Väntar på UTILTS_ERR</option>
            <option value="blocked">Blockerad</option>
            <option value="passed">Klar</option>
            <option value="failed">Fel</option>
          </select>
          <button className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">
            Filtrera
          </button>
        </form>
      </section>

      <ProgressSummary
        cases={filteredCases}
        runs={testRuns}
        messages={messages}
      />

      {filteredCases.length === 0 ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          Inga testfall matchar filtreringen. Välj “U3 alla” eller rensa
          sökningen.
        </section>
      ) : null}

      {groups.map((group) => {
        const items = filteredCases.filter(
          (testCase) => caseGroup(testCase) === group,
        );
        return (
          <section
            key={group}
            className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-950">{group}</h2>
              <Badge>{items.length} testfall</Badge>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {items.map((testCase) => (
                <TestCard
                  key={`${testCase.suite}-${testCase.roleCode}-${testCase.testCaseCode}`}
                  testCase={testCase}
                  activeRuns={testRunsForCards}
                  messages={messages}
                  companyId={selectedCompanyId}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
