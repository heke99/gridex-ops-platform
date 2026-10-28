import { supabaseService } from "@/lib/supabase/service";
import { formatErrorMessage } from "@/lib/errors";

/**
 * FINDINGS J2-02 / owner decision 40: a grid owner's metering correction for an already invoiced month reaches the
 * customer through a traceable correction document. The database (gridex_record_metering_billing_corrections_v1,
 * migration 20261028120000) does the work under its own locks: per invoiced finalized underlay with a correction
 * journal it charges or credits exactly the difference of every qualified new metering revision (idempotent per
 * revision), bound to the original invoice, period, contract and price snapshot, as a correction underlay in this run's
 * billing month; above the documented approval threshold it waits for manual approval. The original invoice and its
 * finalized underlay are never touched.
 */

type JsonRecord = Record<string, unknown>;

export type MeteringCorrectionDocument = {
  correctionId: string;
  underlayId: string | null;
  status: "underlaid" | "pending_approval" | "approved_waiting" | "approved_blocked";
  direction?: "charge" | "credit";
  deltaKwh?: number;
  revisions?: number;
  flow?: "next_invoice" | "separate_correction";
  flowReason?: string | null;
  approvalRequired?: boolean;
  error?: string | null;
};

export type MeteringCorrectionOutcome = {
  originalUnderlayId: string;
  originalInvoiceId: string | null;
  outcome: "recorded" | "handled" | "original_not_invoiced" | "waiting_for_qualified_revision";
  pending: number;
  corrections: MeteringCorrectionDocument[];
};

export type MeteringCorrectionRun = {
  billingMonth: string;
  originals: number;
  truncated: boolean;
  results: MeteringCorrectionOutcome[];
  error: string | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

const DOCUMENT_STATUSES = new Set(["underlaid", "pending_approval", "approved_waiting", "approved_blocked"]);
const OUTCOMES = new Set(["recorded", "handled", "original_not_invoiced", "waiting_for_qualified_revision"]);

/** Strict reading of the database result: anything unexpected is an error, never an empty success. */
export function parseMeteringCorrectionRun(data: unknown, billingMonth: string): MeteringCorrectionRun {
  const root = object(data);
  if (root.billingMonth !== billingMonth || !Array.isArray(root.results)) throw new Error("metering_correction_result_invalid");
  const results = root.results.map((entry): MeteringCorrectionOutcome => {
    const row = object(entry);
    const originalUnderlayId = text(row.originalUnderlayId);
    const outcome = text(row.outcome);
    if (!originalUnderlayId || !outcome || !OUTCOMES.has(outcome) || !Array.isArray(row.corrections)) {
      throw new Error("metering_correction_result_invalid");
    }
    return {
      originalUnderlayId,
      originalInvoiceId: text(row.originalInvoiceId),
      outcome: outcome as MeteringCorrectionOutcome["outcome"],
      pending: numberOrNull(row.pending) ?? 0,
      corrections: row.corrections.map((item): MeteringCorrectionDocument => {
        const document = object(item);
        const correctionId = text(document.correctionId);
        const status = text(document.status);
        if (!correctionId || !status || !DOCUMENT_STATUSES.has(status)) throw new Error("metering_correction_result_invalid");
        return {
          correctionId,
          underlayId: text(document.underlayId),
          status: status as MeteringCorrectionDocument["status"],
          direction: document.direction === "credit" ? "credit" : document.direction === "charge" ? "charge" : undefined,
          deltaKwh: numberOrNull(document.deltaKwh) ?? undefined,
          revisions: numberOrNull(document.revisions) ?? undefined,
          flow: document.flow === "separate_correction" ? "separate_correction" : document.flow === "next_invoice" ? "next_invoice" : undefined,
          flowReason: text(document.flowReason),
          approvalRequired: typeof document.approvalRequired === "boolean" ? document.approvalRequired : undefined,
          error: text(document.error),
        };
      }),
    };
  });
  return {
    billingMonth,
    originals: numberOrNull(root.originals) ?? results.length,
    truncated: root.truncated === true,
    results,
    error: null,
  };
}

/**
 * Records the corrections for the month's billing run. A database refusal never fails the tenant's month (the lesson of
 * J2-01): it is returned as `error`, and the uncovered correction stays visible in the reconciliation check.
 */
export async function recordMeteringCorrectionsAfterBilling(input: {
  companyId: string;
  billingMonth: string;
  customerId?: string | null;
  meteringPointId?: string | null;
  actorUserId?: string | null;
}): Promise<MeteringCorrectionRun> {
  const scope: JsonRecord = {};
  if (input.customerId) scope.customer_id = input.customerId;
  if (input.meteringPointId) scope.metering_point_id = input.meteringPointId;
  const failed = (error: unknown): MeteringCorrectionRun => ({ billingMonth: input.billingMonth, originals: 0, truncated: false, results: [],
    error: formatErrorMessage(error, "Rättelser efter fakturering kunde inte registreras.") });
  try {
    const { data, error } = await supabaseService.rpc("gridex_record_metering_billing_corrections_v1", {
      p_company_id: input.companyId,
      p_billing_month: input.billingMonth,
      p_scope: scope,
      p_actor_user_id: input.actorUserId ?? null,
    });
    if (error) return failed(error);
    return parseMeteringCorrectionRun(data, input.billingMonth);
  } catch (error) {
    return failed(error);
  }
}

/** The underlay engine's result rows for the recorded corrections (one per correction document). */
export function meteringCorrectionResults(run: MeteringCorrectionRun): Array<{
  underlayId: string | null;
  status: "ready_for_pricing" | "needs_review";
  sourceRows: number;
  warnings: string[];
}> {
  const rows: Array<{ underlayId: string | null; status: "ready_for_pricing" | "needs_review"; sourceRows: number; warnings: string[] }> = [];
  if (run.error) {
    rows.push({ underlayId: null, status: "needs_review", sourceRows: 0,
      warnings: [`metering_correction_failed: Rättelser efter fakturering kunde inte registreras (${run.error}).`] });
  }
  for (const result of run.results) {
    for (const document of result.corrections) {
      const what = `${document.direction === "credit" ? "kreditering" : "tilläggsdebitering"} ${document.deltaKwh ?? "?"} kWh, ${document.revisions ?? "?"} mätvärdesrevisioner`;
      if (document.status === "underlaid") {
        rows.push({ underlayId: document.underlayId, status: "ready_for_pricing", sourceRows: document.revisions ?? 0,
          warnings: [`metering_correction_after_billing: Rättelse av redan fakturerad period (${what}), bunden till faktura ${result.originalInvoiceId ?? "?"}.`] });
      } else {
        const reason = document.status === "pending_approval"
          ? "väntar på manuellt godkännande (över beloppsgränsen eller kundkategorins regel)"
          : document.status === "approved_blocked"
            ? `kunde inte skapas (${document.error ?? "okänt fel"})`
            : "godkänd, skapas i en senare körning";
        rows.push({ underlayId: null, status: "needs_review", sourceRows: document.revisions ?? 0,
          warnings: [`metering_correction_${document.status}: Rättelse av redan fakturerad period (${what}) ${reason}.`] });
      }
    }
    if (result.outcome === "original_not_invoiced" && result.pending > 0) {
      rows.push({ underlayId: null, status: "needs_review", sourceRows: result.pending,
        warnings: [`metering_correction_original_not_invoiced: ${result.pending} mätvärden i ett låst underlag har korrigerats innan underlaget fakturerades.`] });
    }
    if (result.outcome === "waiting_for_qualified_revision" && result.pending > 0) {
      rows.push({ underlayId: null, status: "needs_review", sourceRows: result.pending,
        warnings: [`metering_correction_waiting: ${result.pending} korrigerade mätvärden för ett fakturerat underlag är ännu inte faktureringsgodkända.`] });
    }
  }
  return rows;
}
