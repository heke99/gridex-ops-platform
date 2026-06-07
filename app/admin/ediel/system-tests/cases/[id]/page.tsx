import Link from "next/link";
import type { ReactNode } from "react";
import type { EdielMessageRow, EdielTestRunMessageRow } from "@/lib/ediel/types";
import AdminHeader from "@/components/admin/AdminHeader";
import { requirePlatformAdminAccess } from "@/lib/admin/guards";
import {
  listEdielMessages,
  listEdielMessagesByIds,
  listEdielTestRunMessages,
  listEdielTestRuns,
} from "@/lib/ediel/db";
import { supabaseService } from "@/lib/supabase/service";
import { getOperationalCompanyScope } from "@/lib/tenant/scope";
import {
  getEdielSystemTestRuntimeContext,
  type EdielSystemTestRuntimeContext,
} from "@/lib/ediel/systemTestSettings";
import {
  evaluateEdielTgtRun,
  getEdielTgtTestCaseByCode,
  getEdielTgtTestCases,
  type EdielTgtExpectedStep,
  type EdielTgtRunEvaluation,
  type EdielTgtTestCaseDefinition,
} from "@/lib/ediel/tgtRegistry";
import { createEdielTgtRunFromTemplateAction } from "@/app/admin/ediel/actions";
import { isAgtSystemTestCase } from "@/lib/ediel/systemTestPackages";
import {


  createAndSendSystemTestAckAction,
  createAndSendSystemTestOutboundForRunAction,
  deleteSystemTestArtifactAction,
  deleteSystemTestRunAction,
  pollAndSyncTgtSystemTestMailboxAction,
  sendSystemTestOutboundMessageAction,
  softDeleteSystemTestMessageAction,
  unlinkSystemTestMessageAction,
  validateSystemTestPayloadAction,
} from "@/app/admin/ediel/system-tests/actions";

function readOutcomeRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readAckOutcome(value: unknown): "positive" | "negative" | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "positive" || normalized === "negative" ? normalized : null;
}

function systemTestAckOutcomeFromMessage(
  message: EdielMessageRow | null | undefined,
): "positive" | "negative" | null {
  if (!message) return null;

  const validationReport = readOutcomeRecord(message.validation_report);
  const parsedPayload = readOutcomeRecord(message.parsed_payload);
  const systemTestAckSend = readOutcomeRecord(validationReport?.systemTestAckSend);

  return (
    readAckOutcome(systemTestAckSend?.outcome) ??
    readAckOutcome(validationReport?.effectiveOutcome) ??
    readAckOutcome(validationReport?.backendOutcome) ??
    readAckOutcome(validationReport?.engineOutcome) ??
    readAckOutcome(parsedPayload?.ackOutcome) ??
    readAckOutcome(message.ack_outcome)
  );
}

export const dynamic = "force-dynamic";

type Tone = "emerald" | "amber" | "red" | "slate";

function badgeClass(tone: Tone) {
  if (tone === "emerald")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tone === "amber") return "border-amber-200 bg-amber-50 text-amber-700";
  if (tone === "red") return "border-red-200 bg-red-50 text-red-700";
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


type LinkedTestRunMessage = {
  link: EdielTestRunMessageRow;
  message: EdielMessageRow | null;
};

function linkedMessageBusinessKey(item: LinkedTestRunMessage): string {
  const message = item.message;
  if (!message) return `missing:${item.link.id}`;
  const direction = String(message.direction ?? item.link.expected_direction ?? "").toLowerCase();
  const family = String(message.message_family ?? item.link.expected_family ?? "").toUpperCase();
  const code = String(message.message_code ?? item.link.expected_code ?? "").toUpperCase();
  const sender = String(message.sender_ediel_id ?? "");
  const receiver = String(message.receiver_ediel_id ?? "");
  if (direction === "inbound") {
    return [
      item.link.step_no ?? "",
      direction,
      family,
      code,
      sender,
      receiver,
    ].join("|");
  }

  return `link:${item.link.id}`;
}

function linkedMessageRank(item: LinkedTestRunMessage): number {
  const status = String(item.message?.status ?? "");
  const createdAt = Date.parse(item.message?.created_at ?? item.link.created_at ?? "");
  const freshness = Number.isNaN(createdAt) ? 0 : createdAt;
  const statusBonus = status === "failed" || status === "cancelled" ? 0 : 10_000_000_000_000;
  return statusBonus + freshness;
}

function compactLinkedTestRunMessages(items: LinkedTestRunMessage[]): LinkedTestRunMessage[] {
  const byKey = new Map<string, LinkedTestRunMessage>();

  for (const item of items) {
    const key = linkedMessageBusinessKey(item);
    const current = byKey.get(key);
    if (!current || linkedMessageRank(item) >= linkedMessageRank(current)) {
      byKey.set(key, item);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const stepA = a.link.step_no ?? 9999;
    const stepB = b.link.step_no ?? 9999;
    if (stepA !== stepB) return stepA - stepB;
    return Date.parse(a.link.created_at ?? "") - Date.parse(b.link.created_at ?? "");
  });
}

function statusTone(status: string | null | undefined): Tone {
  if (status === "passed") return "emerald";
  if (status === "failed") return "red";
  if (status === "running" || status === "draft" || status === "in_progress")
    return "amber";
  return "slate";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return value.replace("T", " ").slice(0, 16);
}

function findDefinition(
  testCaseCode: string,
): EdielTgtTestCaseDefinition | null {
  const code = decodeURIComponent(testCaseCode).trim().toUpperCase();
  return (
    getEdielTgtTestCaseByCode("UTILTS", "esco", code) ??
    getEdielTgtTestCases().find(
      (testCase) => testCase.testCaseCode.toUpperCase() === code,
    ) ??
    null
  );
}

function identityText(
  testCase: EdielTgtTestCaseDefinition,
  runtime: EdielSystemTestRuntimeContext | null,
): string {
  const actorEdielId = runtime?.actorEdielId ?? "saknas";
  const portalEdielId = runtime?.testPortalEdielId ?? "saknas";
  const first = testCase.expectedSteps[0];
  if (first?.direction === "inbound" && first.actor === "portal") {
    return `Inbound från Edielportalen ${portalEdielId} till bolagets DB-konfigurerade testaktör ${actorEdielId}.`;
  }
  if (first?.direction === "outbound" && first.actor === "gridex") {
    return `Outbound från bolagets DB-konfigurerade testaktör ${actorEdielId} till Edielportalen ${portalEdielId}.`;
  }
  return `Systemets TGT Ediel-ID hämtas från bolagets aktörskort (${actorEdielId}); Edielportalen hämtas från systemtestinställningar (${portalEdielId}).`;
}

function expectedResponseText(testCase: EdielTgtTestCaseDefinition): string {
  const gridexOutbound = testCase.expectedSteps.filter(
    (step) =>
      step.actor === "gridex" && step.direction === "outbound" && step.required,
  );
  if (gridexOutbound.some((step) => step.family === "UTILTS_ERR"))
    return "Förväntat svar från Gridex: positiv CONTRL + UTILTS_ERR.";
  const aperak = gridexOutbound.find((step) => step.family === "APERAK");
  if (aperak?.outcome === "negative")
    return "Förväntat svar från Gridex: positiv CONTRL + negativ APERAK.";
  if (aperak?.outcome === "positive")
    return "Förväntat svar från Gridex: positiv CONTRL + positiv APERAK.";
  if (gridexOutbound.some((step) => step.family === "CONTRL"))
    return "Förväntat svar från Gridex: CONTRL enligt kedjan.";
  return "Förväntat svar följer stegen nedan.";
}

function StartRunForm({ testCase, companyId }: { testCase: EdielTgtTestCaseDefinition; companyId: string | null }) {
  const isAgt = isAgtSystemTestCase({
    testCaseCode: testCase.testCaseCode,
    roleCode: testCase.roleCode,
    suite: testCase.suite,
  });
  const setupPackage = isAgt
    ? testCase.roleCode === "esco" && testCase.suite === "UTILTS"
      ? "agt_dgi_utilts_ue1_ue2"
      : testCase.roleCode === "esco"
        ? "agt_dgi_prodat_e3_e8"
        : "agt_ddq_prodat_l"
    : testCase.roleCode === "esco" && testCase.suite === "UTILTS"
      ? "tgt_dgi_utilts_u3"
      : "tgt_ddq_prodat_utilts";
  return (
    <form action={createEdielTgtRunFromTemplateAction} className="flex flex-wrap items-center gap-2">
      {companyId ? <input type="hidden" name="companyId" value={companyId} /> : null}
      <input type="hidden" name="testSuite" value={testCase.suite} />
      <input type="hidden" name="roleCode" value={testCase.roleCode} />
      <input type="hidden" name="testCaseCode" value={testCase.testCaseCode} />
      <input type="hidden" name="setupPackage" value={setupPackage} />
      <input type="hidden" name="runtimeTestSuite" value={isAgt ? "AGT" : "TGT"} />
      <input type="hidden" name="environmentType" value={isAgt ? "agt_test" : "tgt_test"} />
      <input type="hidden" name="certificateEnvironment" value={isAgt ? "production" : "test"} />
      <input type="hidden" name="transportEnvironment" value={isAgt ? "production_smtp" : "test"} />
      <select
        name="encryptionMode"
        defaultValue="none"
        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
        title="Välj transportläge för just denna testkörning"
      >
        <option value="none">Okrypterat test</option>
        <option value="smime">Krypterat test</option>
      </select>
      <button
        type="submit"
        className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
      >
        Starta ny testkörning
      </button>
    </form>
  );
}

function AckActionForm({
  sourceMessageId,
  testRunId,
  testCase,
  ackFamily,
  outcome,
  label,
  tone = "slate",
  stepNo,
}: {
  sourceMessageId: string;
  testRunId: string;
  testCase: EdielTgtTestCaseDefinition;
  ackFamily: "CONTRL" | "APERAK" | "UTILTS_ERR";
  outcome: "positive" | "negative";
  label: string;
  tone?: Tone;
  stepNo?: number | null;
}) {
  return (
    <form action={createAndSendSystemTestAckAction}>
      <input type="hidden" name="sourceMessageId" value={sourceMessageId} />
      <input type="hidden" name="testRunId" value={testRunId} />
      <input type="hidden" name="testCaseCode" value={testCase.testCaseCode} />
      <input type="hidden" name="ackFamily" value={ackFamily} />
      <input type="hidden" name="outcome" value={outcome} />
      <input type="hidden" name="sendNow" value="true" />
      {stepNo ? (
        <input type="hidden" name="stepNo" value={String(stepNo)} />
      ) : null}
      <button
        type="submit"
        className={`rounded-xl border px-3 py-2 text-xs font-semibold ${badgeClass(tone)} hover:bg-white`}
      >
        {label}
      </button>
    </form>
  );
}

function UnlinkMessageForm({
  testRunId,
  testCaseCode,
  edielMessageId,
  linkId,
}: {
  testRunId: string;
  testCaseCode: string;
  edielMessageId: string;
  linkId?: string | null;
}) {
  return (
    <form action={unlinkSystemTestMessageAction}>
      <input type="hidden" name="testRunId" value={testRunId} />
      <input type="hidden" name="testCaseCode" value={testCaseCode} />
      <input type="hidden" name="edielMessageId" value={edielMessageId} />
      {linkId ? <input type="hidden" name="linkId" value={linkId} /> : null}
      <button
        type="submit"
        className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100"
      >
        Koppla loss
      </button>
    </form>
  );
}

function SoftDeleteMessageForm({
  testRunId,
  testCaseCode,
  edielMessageId,
}: {
  testRunId: string;
  testCaseCode: string;
  edielMessageId: string;
}) {
  return (
    <form action={softDeleteSystemTestMessageAction}>
      <input type="hidden" name="testRunId" value={testRunId} />
      <input type="hidden" name="testCaseCode" value={testCaseCode} />
      <input type="hidden" name="edielMessageId" value={edielMessageId} />
      <input
        type="hidden"
        name="reason"
        value="Soft delete från testfallssidan. Felkopplat eller felaktigt testmeddelande."
      />
      <button
        type="submit"
        className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
      >
        Soft delete
      </button>
    </form>
  );
}

function SendSystemTestOutboundForm({
  testRunId,
  testCaseCode,
  edielMessageId,
  stepNo,
  messageFamily,
  messageCode,
}: {
  testRunId: string;
  testCaseCode: string;
  edielMessageId: string;
  stepNo?: number | null;
  messageFamily?: string | null;
  messageCode?: string | null;
}) {
  return (
    <form action={sendSystemTestOutboundMessageAction}>
      <input type="hidden" name="testRunId" value={testRunId} />
      <input type="hidden" name="testCaseCode" value={testCaseCode} />
      <input type="hidden" name="edielMessageId" value={edielMessageId} />
      {stepNo ? <input type="hidden" name="stepNo" value={String(stepNo)} /> : null}
      <button
        type="submit"
        className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
      >
        Skicka från Systemtest{messageFamily ? ` · ${messageFamily} ${messageCode ?? ""}` : ""}
      </button>
    </form>
  );
}


function CreateAndSendSystemTestOutboundForRunForm({
  testRunId,
  testCaseCode,
  messageId,
}: {
  testRunId: string;
  testCaseCode: string;
  messageId?: string | null;
}) {
  return (
    <form action={createAndSendSystemTestOutboundForRunAction}>
      <input type="hidden" name="testRunId" value={testRunId} />
      <input type="hidden" name="testCaseCode" value={testCaseCode} />
      {messageId ? <input type="hidden" name="edielMessageId" value={messageId} /> : null}
      <button
        type="submit"
        className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-black text-white hover:bg-emerald-800"
      >
        Skapa och skicka PRODAT från Systemtest
      </button>
    </form>
  );
}

function DeleteRunForm({
  testRunId,
  testCaseCode,
}: {
  testRunId: string;
  testCaseCode: string;
}) {
  return (
    <form action={deleteSystemTestRunAction}>
      <input type="hidden" name="testRunId" value={testRunId} />
      <input type="hidden" name="testCaseCode" value={testCaseCode} />
      <input
        type="hidden"
        name="reason"
        value="Testkörning rensad från testfallssidan innan ny portaltestkörning."
      />
      <button
        type="submit"
        className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
      >
        Radera/lossa testkörning
      </button>
    </form>
  );
}

function DeleteArtifactForm({
  testRunId,
  testCaseCode,
  artifactId,
}: {
  testRunId: string;
  testCaseCode: string;
  artifactId: string;
}) {
  return (
    <form action={deleteSystemTestArtifactAction}>
      <input type="hidden" name="testRunId" value={testRunId} />
      <input type="hidden" name="testCaseCode" value={testCaseCode} />
      <input type="hidden" name="artifactId" value={artifactId} />
      <input
        type="hidden"
        name="reason"
        value="Artifact raderad från testfallssidan inför ny verifiering."
      />
      <button
        type="submit"
        className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
      >
        Radera artifact
      </button>
    </form>
  );
}

function safeJsonPreview(value: unknown, maxLength = 900): string {
  try {
    const text = JSON.stringify(value ?? {}, null, 2);
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
  } catch {
    return "Kunde inte visa payload.";
  }
}

function shouldOfferAperak(messageFamily: string | null | undefined) {
  return messageFamily === "PRODAT" || messageFamily === "UTILTS";
}


function expectedAckActionsForInboundMessage(
  testCase: EdielTgtTestCaseDefinition,
  messageFamily: string | null | undefined,
): EdielTgtExpectedStep[] {
  const family = String(messageFamily ?? "").toUpperCase();
  if (!family || family === "CONTRL" || family === "APERAK" || family === "UTILTS_ERR") return [];
  return testCase.expectedSteps.filter((step) => {
    if (step.actor !== "gridex" || step.direction !== "outbound") return false;
    if (!step.required) return false;
    if (step.family === "CONTRL") return true;
    if (step.family === "APERAK") return shouldOfferAperak(family);
    if (step.family === "UTILTS_ERR") return family === "UTILTS";
    return false;
  });
}

function ackActionTone(step: EdielTgtExpectedStep): Tone {
  if (step.family === "CONTRL" && step.outcome !== "negative") return "emerald";
  if (step.family === "APERAK" && step.outcome !== "negative") return "emerald";
  return step.outcome === "negative" || step.family === "UTILTS_ERR" ? "red" : "emerald";
}

function ackActionLabel(step: EdielTgtExpectedStep): string {
  if (step.family === "UTILTS_ERR") return "Skapa & skicka rekommenderad UTILTS_ERR";
  return `Skapa & skicka rekommenderad ${step.family}`;
}

function ackActionBackendHint(step: EdielTgtExpectedStep): string {
  if (step.family === "UTILTS_ERR") {
    return "Backend avgör att UTILTS_ERR är rätt svar; UI skickar inte fri APERAK-outcome.";
  }
  return "Outcome är backendstyrt. Testdefinitionens outcome skickas bara som hint och får inte tvinga kvittensen.";
}

function splitEdifactSegments(rawPayload: string | null | undefined): string[] {
  return String(rawPayload ?? "")
    .split("'")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function firstSegment(
  rawPayload: string | null | undefined,
  tag: string,
): string | null {
  return (
    splitEdifactSegments(rawPayload).find((segment) =>
      segment.toUpperCase().startsWith(`${tag.toUpperCase()}+`),
    ) ?? null
  );
}

function allSegments(
  rawPayload: string | null | undefined,
  tag: string,
): string {
  const values = splitEdifactSegments(rawPayload).filter((segment) =>
    segment.toUpperCase().startsWith(`${tag.toUpperCase()}+`),
  );
  return values.length > 0 ? values.slice(0, 3).join(" | ") : "—";
}

function shortValue(value: string | null | undefined, maxLength = 90): string {
  const text = String(value ?? "—");
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function markerFromParsed(
  parsed: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function MessageMarkerGrid({
  message,
}: {
  message: NonNullable<EdielTgtRunEvaluation["matches"][number]["message"]>;
}) {
  const parsed = message.parsed_payload ?? {};
  const bgm =
    firstSegment(message.raw_payload, "BGM") ??
    markerFromParsed(parsed, [
      "bgm",
      "bgmCode",
      "messageCode",
      "documentNameCode",
    ]);
  const unh =
    firstSegment(message.raw_payload, "UNH") ??
    markerFromParsed(parsed, ["unh", "family", "messageFamily"]);
  const rff =
    firstSegment(message.raw_payload, "RFF") ??
    markerFromParsed(parsed, [
      "transactionReference",
      "businessReference",
      "lineItemReference",
    ]);
  const doc =
    firstSegment(message.raw_payload, "DOC") ??
    markerFromParsed(parsed, ["documentReference", "sourceDocumentReference"]);
  return (
    <div className="mt-2 grid gap-1 text-[11px] leading-5 text-slate-700 md:grid-cols-2">
      <div>
        <strong>UNH:</strong> {shortValue(unh)}
      </div>
      <div>
        <strong>BGM:</strong> {shortValue(bgm)}
      </div>
      <div>
        <strong>ERC:</strong>{" "}
        {shortValue(allSegments(message.raw_payload, "ERC"))}
      </div>
      <div>
        <strong>FTX:</strong>{" "}
        {shortValue(allSegments(message.raw_payload, "FTX"))}
      </div>
      <div>
        <strong>STS:</strong>{" "}
        {shortValue(allSegments(message.raw_payload, "STS"))}
      </div>
      <div>
        <strong>RFF/DOC:</strong> {shortValue(rff ?? doc)}
      </div>
    </div>
  );
}

function ExpectedActualPanel({
  evaluation,
}: {
  evaluation: EdielTgtRunEvaluation;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-950">
          Expected vs actual
        </h3>
        <Badge
          tone={
            evaluation.hasMismatch
              ? "red"
              : evaluation.missingRequiredSteps > 0
                ? "amber"
                : "emerald"
          }
        >
          {evaluation.passedSteps}/{evaluation.requiredSteps} obligatoriska steg
        </Badge>
      </div>
      <div className="mt-3 overflow-x-auto rounded-xl border border-indigo-100 bg-white">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-semibold">Steg</th>
              <th className="px-3 py-2 font-semibold">Förväntat</th>
              <th className="px-3 py-2 font-semibold">Faktiskt</th>
              <th className="px-3 py-2 font-semibold">Payload-kontroll</th>
              <th className="px-3 py-2 font-semibold">Status/diff</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {evaluation.matches.map((match) => (
              <tr key={match.step.stepNo} className="align-top">
                <td className="px-3 py-3 font-semibold text-slate-900">
                  {match.step.stepNo}
                </td>
                <td className="px-3 py-3 text-slate-700">
                  <div>
                    {match.step.actor === "gridex" ? "Gridex" : "Portal"} ·{" "}
                    {match.step.direction}
                  </div>
                  <div className="mt-1 font-semibold text-slate-900">
                    {match.step.family} {match.step.code}
                  </div>
                  <div className="mt-1">
                    {match.step.outcome ?? "outcome enligt meddelande"}
                  </div>
                  {match.message ? (() => {
                    const backendOutcome = systemTestAckOutcomeFromMessage(match.message);
                    return backendOutcome && backendOutcome !== match.step.outcome ? (
                      <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800">
                        Backendbeslut användes: {backendOutcome}
                      </div>
                    ) : null;
                  })() : null}
                  <div className="mt-1">
                    {match.step.required ? "Obligatoriskt" : "Valfritt"}
                  </div>
                </td>
                <td className="px-3 py-3 text-slate-700">
                  {match.message ? (
                    <div>
                      <div>
                        {match.message.direction} ·{" "}
                        {match.message.message_family}{" "}
                        {match.message.message_code}
                      </div>
                      <div className="mt-1">Status: {match.message.status}</div>
                      <div className="mt-1">
                        ACK: {match.message.ack_outcome ?? "—"} · syntax:{" "}
                        {match.message.syntax_check_status ?? "—"}
                      </div>
                      <Link
                        href={`/admin/ediel/messages/${match.message.id}`}
                        className="mt-1 inline-flex text-emerald-700 underline"
                      >
                        Öppna meddelande
                      </Link>
                    </div>
                  ) : (
                    <span className="text-slate-500">Saknas</span>
                  )}
                </td>
                <td className="px-3 py-3 text-slate-700">
                  {match.message ? (
                    <MessageMarkerGrid message={match.message} />
                  ) : (
                    <span className="text-slate-500">Ingen payload ännu</span>
                  )}
                </td>
                <td className="px-3 py-3 text-slate-700">
                  <Badge
                    tone={
                      match.status === "passed"
                        ? "emerald"
                        : match.status === "mismatch"
                          ? "red"
                          : "amber"
                    }
                  >
                    {match.status}
                  </Badge>
                  {match.issues.length > 0 ? (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-red-700">
                      {match.issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-2 text-slate-500">
                      Ingen diff registrerad.
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StepCard({ step }: { step: EdielTgtExpectedStep }) {
  const tone: Tone = step.actor === "gridex" ? "emerald" : "amber";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge tone={tone}>Steg {step.stepNo}</Badge>
          <Badge>{step.direction}</Badge>
          <Badge>{step.actor === "gridex" ? "Gridex" : "Edielportalen"}</Badge>
          <Badge>
            {step.family} {step.code}
          </Badge>
          {step.outcome ? (
            <Badge tone={step.outcome === "positive" ? "emerald" : "red"}>
              {step.outcome}
            </Badge>
          ) : null}
          <Badge tone={step.required ? "amber" : "slate"}>
            {step.required ? "obligatoriskt" : "valfritt"}
          </Badge>
        </div>
      </div>
      <h3 className="mt-3 text-sm font-semibold text-slate-950">
        {step.title}
      </h3>
      <p className="mt-1 text-sm leading-6 text-slate-700">
        {step.description}
      </p>
    </div>
  );
}

export default async function SystemTestCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    companyId?: string;
    imapStatus?: string;
    fetched?: string;
    stored?: string;
    deduped?: string;
    linked?: string;
    errors?: string;
    message?: string;
    ackStatus?: string;
    ackFamily?: string;
    ackMessageId?: string;
  }>;
}) {
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  const testCaseCode = id;
  const context = await requirePlatformAdminAccess();
  const scope = await getOperationalCompanyScope(context.userId);
  const selectedCompanyId = String(query.companyId ?? "").trim() || scope.companyId || null;
  const imapStatus = String(query.imapStatus ?? "").trim();
  const hasImapSyncResult = Boolean(imapStatus);
  const testCase = findDefinition(testCaseCode);
  const runtimeSuiteForCase = testCase && isAgtSystemTestCase({
    testCaseCode: testCase.testCaseCode,
    roleCode: testCase.roleCode,
    suite: testCase.suite,
  })
    ? "AGT"
    : "TGT";

  if (!testCase) {
    return (
      <div className="space-y-6">
        <AdminHeader
          title="Systemtest"
          subtitle="Testfallet hittades inte."
          userEmail={context.email}
          workspaceName="Plattformskontroll"
          workspaceMode="platform"
        />
        <section className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
          Okänt testfall: {decodeURIComponent(testCaseCode)}. Gå tillbaka till
          Systemtest och välj ett testfall från listan.
        </section>
        <Link
          href={`/admin/ediel/system-tests${selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : ""}`}
          className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Tillbaka till Systemtest
        </Link>
      </div>
    );
  }

  const systemTestRuntime = await getEdielSystemTestRuntimeContext({
    companyId: selectedCompanyId,
    testSuite: runtimeSuiteForCase,
    actorRole: testCase.roleCode,
  }).catch(() => null);

  const [runs, messages] = await Promise.all([
    listEdielTestRuns({ companyId: selectedCompanyId }).catch(() => []),
    listEdielMessages({ companyId: selectedCompanyId, limit: 300 }).catch(() => []),
  ]);

  const matchingRuns = runs.filter(
    (run) =>
      run.test_suite === testCase.suite &&
      run.role_code === testCase.roleCode &&
      run.test_case_code === testCase.testCaseCode &&
      run.status !== "cancelled",
  );
  const runDetails = await Promise.all(
    matchingRuns.map(async (run) => {
      const links = await listEdielTestRunMessages({ testRunId: run.id }).catch(
        () => [],
      );
      const linkMessageRows = await listEdielMessagesByIds(
        links.map((link) => link.ediel_message_id),
        { companyId: selectedCompanyId },
      ).catch(() => []);
      const messagesById = new Map(
        linkMessageRows.map((message) => [message.id, message]),
      );
      let artifactRows: Array<Record<string, unknown>> = [];
      try {
        const artifactResult = await supabaseService
          .from("ediel_test_artifacts")
          .select("*")
          .eq("test_run_id", run.id)
          .order("created_at", { ascending: false })
          .limit(8);

        if (!artifactResult.error || artifactResult.error.code === "42P01") {
          artifactRows = (artifactResult.data ?? []) as Array<
            Record<string, unknown>
          >;
        }
      } catch {
        artifactRows = [];
      }

      const linkedMessages = links.map((link) => ({
        link,
        message: messagesById.get(link.ediel_message_id) ?? null,
      }));

      return {
        runId: run.id,
        links: compactLinkedTestRunMessages(linkedMessages),
        rawLinkCount: linkedMessages.length,
        artifacts: artifactRows,
        explicitMessageIds: links.map((link) => link.ediel_message_id),
        linkedMessageRows: linkMessageRows,
      };
    }),
  );
  const runDetailById = new Map(
    runDetails.map((detail) => [detail.runId, detail]),
  );
  const evaluations = matchingRuns.map((run) => {
    const detail = runDetailById.get(run.id);
    const byId = new Map(messages.map((message) => [message.id, message]));
    for (const linkedMessage of detail?.linkedMessageRows ?? []) {
      byId.set(linkedMessage.id, linkedMessage);
    }

    return evaluateEdielTgtRun(run, Array.from(byId.values()), {
      explicitMessageIds: detail?.explicitMessageIds ?? [],
    });
  });
  const latest = evaluations[0] ?? null;
  const firstStep = testCase.expectedSteps[0] ?? null;
  const startsWithGridexOutbound =
    firstStep?.actor === "gridex" && firstStep.direction === "outbound";
  const latestSendableOutbound = latest
    ? latest.matches
        .map((match) => match.message)
        .find(
          (message) =>
            message?.direction === "outbound" &&
            !["CONTRL", "APERAK", "UTILTS_ERR"].includes(String(message.message_family ?? "").toUpperCase()) &&
            !["sent", "acknowledged", "validated", "cancelled"].includes(String(message.status ?? "").toLowerCase()),
        ) ?? null
    : null;

  return (
    <div className="space-y-6">
      <AdminHeader
        title={`${testCase.testCaseCode} · ${testCase.title}`}
        subtitle="Körbart testfall med synkad run, payload-import och förväntad teknisk kedja."
        userEmail={context.email}
        workspaceName="Plattformskontroll"
        workspaceMode="platform"
      />

      {hasImapSyncResult ? (
        <section
          className={`rounded-2xl border p-4 text-sm leading-6 ${
            imapStatus === "linked"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : imapStatus === "error"
                ? "border-red-200 bg-red-50 text-red-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          <div className="font-black">IMAP-synkresultat för {testCase.testCaseCode}</div>
          <div className="mt-1 grid gap-2 sm:grid-cols-5">
            <span>Status: {imapStatus}</span>
            <span>Hämtade: {query.fetched ?? "0"}</span>
            <span>Sparade: {query.stored ?? "0"}</span>
            <span>Dubbletter: {query.deduped ?? "0"}</span>
            <span>Kopplade: {query.linked ?? "0"}</span>
          </div>
          {query.message ? <div className="mt-2 font-semibold">{query.message}</div> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/admin/inbound-mail" className="underline">Öppna inbound-mail</Link>
            <Link href="/admin/ediel/messages" className="underline">Öppna meddelandelogg</Link>
            <Link href="/admin/ediel/unresolved" className="underline">Öppna unresolved</Link>
          </div>
        </section>
      ) : null}

      {query.ackStatus ? (
        <section
          className={`rounded-2xl border p-4 text-sm leading-6 ${
            query.ackStatus === "sent"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : query.ackStatus === "failed"
                ? "border-red-200 bg-red-50 text-red-900"
                : "border-blue-200 bg-blue-50 text-blue-900"
          }`}
        >
          <div className="font-black">ACK-resultat {query.ackFamily ? `· ${query.ackFamily}` : ""}</div>
          <div className="mt-1">Status: {query.ackStatus}</div>
          {query.message ? <div className="mt-2 font-semibold">{query.message}</div> : null}
          {query.ackMessageId ? (
            <Link
              href={`/admin/ediel/messages/${encodeURIComponent(query.ackMessageId)}`}
              className="mt-3 inline-flex underline"
            >
              Öppna kvittensmeddelandet och dess eventlogg
            </Link>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="emerald">{testCase.suite}</Badge>
              <Badge>
                {testCase.roleCode === "esco"
                  ? "Energitjänsteföretag"
                  : testCase.roleCode}
              </Badge>
              <Badge>{testCase.approvalVersion}</Badge>
              <Badge>
                System Ediel-ID {systemTestRuntime?.actorEdielId ?? "saknas"}
              </Badge>
              <Badge>
                Portal {systemTestRuntime?.testPortalEdielId ?? "saknas"}
              </Badge>
              {latest ? (
                <Badge tone={statusTone(latest.computedStatus)}>
                  {latest.computedStatus}
                </Badge>
              ) : (
                <Badge>Inte påbörjad</Badge>
              )}
            </div>
            <p className="mt-4 max-w-4xl text-sm leading-6 text-slate-700">
              {testCase.purpose}
            </p>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-950">
                <div className="font-semibold">Ediel-identitet</div>
                <div>{identityText(testCase, systemTestRuntime)}</div>
                <div className="mt-1 text-xs">
                  Portalens e-post:{" "}
                  {systemTestRuntime?.testPortalEmail ?? "saknar mottagarmail"}
                </div>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-950">
                <div className="font-semibold">Förväntad respons</div>
                <div>{expectedResponseText(testCase)}</div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <StartRunForm testCase={testCase} companyId={selectedCompanyId} />
            <Link
              href={`/admin/ediel/system-tests${selectedCompanyId ? `?companyId=${encodeURIComponent(selectedCompanyId)}` : ""}`}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Tillbaka
            </Link>
          </div>
        </div>
      </section>

      {startsWithGridexOutbound && latest ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-slate-950">Skicka aktör→portal från Systemtest</h2>
              <p className="mt-1 text-sm leading-6 text-emerald-950">
                Den här knappen skapar saknat PRODAT-utkast via autopilot och skickar det kopplat till denna testkörning. Använd den för E8/E4/E3/L1/L7 i stället för separat outbound-sida.
              </p>
            </div>
            <CreateAndSendSystemTestOutboundForRunForm
              testRunId={latest.testRun.id}
              testCaseCode={testCase.testCaseCode}
              messageId={latestSendableOutbound?.id ?? null}
            />
          </div>
          {latestSendableOutbound ? (
            <div className="mt-3 text-xs font-semibold text-emerald-900">
              Skickbart utkast hittat: {latestSendableOutbound.message_family} {latestSendableOutbound.message_code} · status {latestSendableOutbound.status}.
            </div>
          ) : (
            <div className="mt-3 text-xs font-semibold text-emerald-900">
              Inget skickbart utkast syns ännu. Knappen kör autopilot först och skickar därefter PRODAT från testkörningen.
            </div>
          )}
        </section>
      ) : null}

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
        <h2 className="text-base font-semibold text-slate-950">
          Så kör du testet
        </h2>
        {startsWithGridexOutbound ? (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3 text-sm text-emerald-950">
            Detta är ett aktör→portal-test. Starta körningen här, låt Gridex skapa outbound-utkastet och använd sedan knappen <strong>Skicka från Systemtest</strong> på det kopplade meddelandet. Skicka inte från en separat outbound-sida.
          </div>
        ) : null}
        <ol className="mt-3 list-decimal space-y-1 pl-5">
          <li>
            Klicka <strong>Starta ny testkörning</strong> i Gridex. Kör bara ett
            systemtest åt gången.
          </li>
          <li>
            Starta exakt samma testfall i Edielportalen:{" "}
            <strong>{testCase.testCaseCode}</strong>.
          </li>
          <li>
            Kontrollera att portalens fil gäller rätt mottagare: bolagets
            DB-konfigurerade Ediel-ID{" "}
            <strong>{systemTestRuntime?.actorEdielId ?? "saknas"}</strong>.
          </li>
          <li>
            När portalen skickar inbound UTILTS/PRODAT/ACK: klicka på{" "}
            <strong>Importera via IMAP och synka</strong> här nedan. Knappen
            pollar IMAP direkt från testfallssidan.
          </li>
          <li>
            Importformuläret skickar med{" "}
            <strong>tgtTestCaseCode={testCase.testCaseCode}</strong>, så
            payloaden kopplas till rätt aktiv run och inte till fel E66-test.
          </li>
          <li>
            Kontrollera kedjan under Aktiva körningar. Gridex skapar nästa svar
            enligt förväntat steg.
          </li>
        </ol>
      </section>

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
        <h2 className="text-lg font-semibold text-slate-950">
          Importera via IMAP och synka till detta testfall
        </h2>
        <p className="mt-1 text-sm leading-6 text-blue-950">
          Använd detta när Edielportalen har skickat inbound-filen. Knappen
          pollar IMAP direkt, importerar olästa och senaste redan lästa Ediel-meddelanden och låser
          synken till <strong>{testCase.testCaseCode}</strong> så
          E/UE- eller U-testfall inte blandas ihop.
        </p>
        <form
          action={pollAndSyncTgtSystemTestMailboxAction}
          className="mt-4 grid gap-3 md:grid-cols-[1fr_160px_auto] md:items-end"
        >
          {selectedCompanyId ? <input type="hidden" name="companyId" value={selectedCompanyId} /> : null}
          <input type="hidden" name="testSuite" value={testCase.suite} />
          <input type="hidden" name="roleCode" value={testCase.roleCode} />
          <input
            type="hidden"
            name="testCaseCode"
            value={testCase.testCaseCode}
          />
          <input
            type="hidden"
            name="tgtTestCaseCode"
            value={testCase.testCaseCode}
          />
          <label className="block text-sm font-medium text-slate-700">
            Mailbox-id eller tomt för aktiv testmailbox
            <input
              name="mailbox"
              placeholder="Lämna tomt för DB-konfigurerad testmailbox"
              className="mt-1 block w-full rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Max antal
            <input
              name="limit"
              defaultValue="50"
              inputMode="numeric"
              className="mt-1 block w-full rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
          >
            Importera via IMAP och synka till {testCase.testCaseCode}
          </button>
        </form>
        <div className="mt-3 rounded-xl border border-blue-200 bg-white p-3 text-xs leading-5 text-blue-950">
          Om IMAP saknar inställningar eller lösenord skapas en misslyckad
          testkörning med felorsak i stället för att sidan kraschar.
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Payload-validator
            </h2>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-700">
              Använd denna innan du skickar eller efter IMAP-import för att se
              parsed family/code, fältfel, fel Application Reference och
              förväntad ACK. Resultatet sparas som artifact på aktiv testkörning
              om en finns.
            </p>
          </div>
          <Badge>2.5A</Badge>
        </div>
        <form
          action={validateSystemTestPayloadAction}
          className="mt-4 grid gap-3"
        >
          <input
            type="hidden"
            name="testCaseCode"
            value={testCase.testCaseCode}
          />
          {latest?.testRun.id ? (
            <input type="hidden" name="testRunId" value={latest.testRun.id} />
          ) : null}
          <textarea
            name="rawPayload"
            rows={8}
            placeholder="Klistra in EDIFACT/XML/AI-lista här"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs"
          />
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <label className="block text-sm font-medium text-slate-700">
              Eller ladda upp payloadfil
              <input
                type="file"
                name="payloadFile"
                className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Validera payload mot {testCase.testCaseCode}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-lg font-semibold text-slate-950">
          Förväntad kedja
        </h2>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {testCase.expectedSteps.map((step) => (
            <StepCard key={step.stepNo} step={step} />
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-950">
            Aktiva körningar
          </h2>
          <Badge
            tone={
              matchingRuns.length > 1
                ? "red"
                : matchingRuns.length === 1
                  ? "amber"
                  : "slate"
            }
          >
            {matchingRuns.length} aktiva/historiska
          </Badge>
        </div>
        <div className="mt-4 space-y-3">
          {evaluations.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-700">
              Ingen run finns ännu. Starta testkörning först.
            </div>
          ) : (
            evaluations.map((evaluation) => {
              const detail = runDetailById.get(evaluation.testRun.id);
              return (
                <div
                  key={evaluation.testRun.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                      <Badge tone={statusTone(evaluation.computedStatus)}>
                        {evaluation.computedStatus}
                      </Badge>
                      <Badge>
                        {evaluation.passedSteps}/{evaluation.requiredSteps} steg
                      </Badge>
                      <Badge
                        tone={
                          evaluation.missingRequiredSteps > 0
                            ? "amber"
                            : "emerald"
                        }
                      >
                        {evaluation.missingRequiredSteps} saknas
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-xs text-slate-600">
                        Skapad {formatDate(evaluation.testRun.created_at)}
                      </div>
                      <DeleteRunForm
                        testRunId={evaluation.testRun.id}
                        testCaseCode={testCase.testCaseCode}
                      />
                    </div>
                  </div>
                  {evaluation.testRun.failure_reason ? (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                      <strong>Senaste fel:</strong>{" "}
                      {evaluation.testRun.failure_reason}
                    </div>
                  ) : null}
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {evaluation.matches.map((match) => (
                      <div
                        key={match.step.stepNo}
                        className="rounded-xl border border-slate-200 bg-white p-3 text-xs"
                      >
                        <div className="flex flex-wrap gap-2">
                          <Badge
                            tone={
                              match.status === "passed"
                                ? "emerald"
                                : match.status === "mismatch"
                                  ? "red"
                                  : "slate"
                            }
                          >
                            {match.status}
                          </Badge>
                          <Badge>Steg {match.step.stepNo}</Badge>
                          <Badge>
                            {match.step.family} {match.step.code}
                          </Badge>
                        </div>
                        <div className="mt-2 font-semibold text-slate-900">
                          {match.step.title}
                        </div>
                        {match.message ? (
                          <Link
                            href={`/admin/ediel/messages/${match.message.id}`}
                            className="mt-2 inline-flex text-emerald-700 underline"
                          >
                            Öppna kopplat meddelande
                          </Link>
                        ) : (
                          <div className="mt-2 text-slate-600">
                            Väntar på meddelande.
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <ExpectedActualPanel evaluation={evaluation} />

                  <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-950">
                        Testkopplade meddelanden
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        <Badge>{detail?.links.length ?? 0} aktiva kopplingar</Badge>
                        {detail && detail.rawLinkCount > detail.links.length ? (
                          <Badge tone="amber">
                            {detail.rawLinkCount - detail.links.length} äldre dubbletter dolda
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 space-y-3">
                      {!detail || detail.links.length === 0 ? (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                          Inga testkopplade meddelanden ännu. Polla IMAP eller
                          koppla meddelande från meddelandevyn.
                        </div>
                      ) : (
                        detail.links.map(({ link, message }) => (
                          <div
                            key={link.id}
                            className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap gap-2 text-xs">
                                <Badge
                                  tone={
                                    message?.direction === "inbound"
                                      ? "amber"
                                      : "emerald"
                                  }
                                >
                                  {message?.direction ?? "okänd"}
                                </Badge>
                                <Badge>
                                  {message?.message_family ??
                                    link.expected_family}{" "}
                                  {message?.message_code ?? link.expected_code}
                                </Badge>
                                <Badge>{message?.status ?? "—"}</Badge>
                                {link.step_no ? (
                                  <Badge>Steg {link.step_no}</Badge>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {message ? (
                                  <Link
                                    href={`/admin/ediel/messages/${message.id}`}
                                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                  >
                                    Öppna
                                  </Link>
                                ) : null}
                                {message?.direction === "outbound" &&
                                !["sent", "acknowledged", "validated", "cancelled"].includes(String(message.status ?? "").toLowerCase()) ? (
                                  <SendSystemTestOutboundForm
                                    testRunId={evaluation.testRun.id}
                                    testCaseCode={testCase.testCaseCode}
                                    edielMessageId={message.id}
                                    stepNo={link.step_no}
                                    messageFamily={message.message_family}
                                    messageCode={String(message.message_code ?? "")}
                                  />
                                ) : null}
                                {message ? (
                                  <UnlinkMessageForm
                                    testRunId={evaluation.testRun.id}
                                    testCaseCode={testCase.testCaseCode}
                                    edielMessageId={message.id}
                                    linkId={link.id}
                                  />
                                ) : null}
                                {message ? (
                                  <SoftDeleteMessageForm
                                    testRunId={evaluation.testRun.id}
                                    testCaseCode={testCase.testCaseCode}
                                    edielMessageId={message.id}
                                  />
                                ) : null}
                              </div>
                            </div>
                            {message?.direction === "inbound" &&
                            message.message_family !== "CONTRL" ? (
                              <div className="mt-3 space-y-2">
                                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-900">
                                  Systemet visar bara kvittenserna som testfallet förväntar sig.
                                  Positiv/negativ väljs av backend utifrån payload, route, matchning och regelprofil, inte som fritt manuellt val i UI.
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {expectedAckActionsForInboundMessage(
                                    testCase,
                                    message.message_family,
                                  ).map((step) => (
                                    <div key={`${message.id}-${step.stepNo}-${step.family}`} className="space-y-1">
                                      <AckActionForm
                                        sourceMessageId={message.id}
                                        testRunId={evaluation.testRun.id}
                                        testCase={testCase}
                                        ackFamily={step.family as "CONTRL" | "APERAK" | "UTILTS_ERR"}
                                        outcome={(step.outcome ?? "positive") as "positive" | "negative"}
                                        stepNo={step.stepNo}
                                        label={ackActionLabel(step)}
                                        tone={ackActionTone(step)}
                                      />
                                      <div className="max-w-60 text-[11px] leading-4 text-slate-500">
                                        {ackActionBackendHint(step)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-950">
                        Decision trace / artifacts
                      </h3>
                      <Badge>{detail?.artifacts.length ?? 0} artifacts</Badge>
                    </div>
                    <div className="mt-3 space-y-3">
                      {!detail || detail.artifacts.length === 0 ? (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                          Inga artifacts ännu. Kör IMAP-synk eller
                          Payload-validator.
                        </div>
                      ) : (
                        detail.artifacts.map((artifact) => (
                          <details
                            key={String(
                              artifact.id ??
                                `${artifact.artifact_type}-${artifact.created_at}`,
                            )}
                            className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"
                          >
                            <summary className="cursor-pointer font-semibold text-slate-900">
                              {String(artifact.artifact_type ?? "artifact")} ·{" "}
                              {String(artifact.title ?? "")} ·{" "}
                              {formatDate(
                                typeof artifact.created_at === "string"
                                  ? artifact.created_at
                                  : null,
                              )}
                            </summary>
                            <div className="mt-3 flex flex-wrap justify-end gap-2">
                              {artifact.id ? (
                                <DeleteArtifactForm
                                  testRunId={evaluation.testRun.id}
                                  testCaseCode={testCase.testCaseCode}
                                  artifactId={String(artifact.id)}
                                />
                              ) : null}
                            </div>
                            <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-slate-950 p-3 text-[11px] leading-5 text-slate-50">
                              {safeJsonPreview(artifact.payload)}
                            </pre>
                          </details>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
