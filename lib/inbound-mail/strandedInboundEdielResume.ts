import { claimRecoveryWork, runRecoveryBatch, type RecoveryClaim } from "./edielRecoveryWork";
// Resume for stored inbound Ediel business messages whose business processing
// never finished (reality finding F103).
//
// The inbound engine runs business processing (tenant -> canonical runtime ->
// native owner) only for the Ediel messages of mail fetched, deduped or whose
// job completed in the same run. When that processing throws, the error was
// kept only in the poll-run metadata: the mail stays 'processed', its job
// 'done', and the Ediel message stays 'received' with no later run selecting
// it again. This module gives such a message a durable failure note on its own
// timeline and a bounded, claimed, environment- and tenant-scoped resume that
// re-runs the same sanctioned processInboundEdielMessage (the operator's
// "rerun runtime decision" path), never a new business writer.
import { supabaseService } from "@/lib/supabase/service";
import { tenantDb } from "@/lib/supabase/tenantDb";
import { createEdielMessageEvent } from "@/lib/ediel/db";

export const STRANDED_INBOUND_RESUME_MARKER = "stranded_inbound_business_processing";
export const INBOUND_BUSINESS_PROCESSING_FAILURE_MARKER = "inbound_business_processing_failed";

export type StrandedResumeOptions = {
  environment: "test" | "production";
  /** Tenant-scoped run (manual company poll). Omitted = every tenant of the lane. */
  companyId?: string | null;
  /** Ediel messages this run already processed; never resumed twice in one run. */
  excludeIds?: readonly string[];
  limit?: number;
  /** A message updated more recently may still be in flight in another run. */
  graceMinutes?: number;
  lookbackHours?: number;
  maxAttempts?: number;
  now?: () => Date;
};

export type ClaimedStrandedMessage = RecoveryClaim & { id: string; companyId: string; attempt: number; maxAttempts: number };

export type StrandedResumeResult = {
  candidates: number;
  claimed: number;
  resumed: number;
  stillReceived: number;
  failed: number;
  exhausted: number;
  errors: string[];
};

const STRANDED_STATUS = "received";

/** Durable, per-message operator signal for a business-processing exception. */
export async function recordInboundBusinessProcessingFailure(input: {
  actorUserId: string;
  edielMessageId: string;
  error: string;
  workerId: string;
  phase: "first_run" | "resume";
  attempt?: number | null;
  maxAttempts?: number | null;
}): Promise<void> {
  await createEdielMessageEvent({
    actorUserId: input.actorUserId,
    edielMessageId: input.edielMessageId,
    eventType: "manual_note",
    eventStatus: "error",
    message: input.phase === "resume"
      ? "Affärsbehandlingen har osäkert utfall. Automatiska återförsök är spärrade tills utfallet har verifierats."
      : "Affärsbehandlingen av inbound-meddelandet avbröts; meddelandet står kvar som mottaget och återupptas av inbound-cron.",
    payload: {
      inboundBusinessProcessing: INBOUND_BUSINESS_PROCESSING_FAILURE_MARKER,
      phase: input.phase,
      error: input.error.slice(0, 1000),
      workerId: input.workerId,
      attempt: input.attempt ?? null,
      maxAttempts: input.maxAttempts ?? null,
    },
  });
}

/**
 * Selects inbound Ediel messages that were stored and tenant-resolved, whose
 * mail intake finished, but whose business processing never moved them past
 * 'received'; claims each with an updated_at compare-and-set on that exact
 * state so two overlapping runs never resume the same message.
 */
export async function claimStrandedInboundEdielMessages(options: StrandedResumeOptions): Promise<{ candidates: number; claimed: ClaimedStrandedMessage[] }> {
  return claimRecoveryWork<ClaimedStrandedMessage>("stranded", options);
}

/** Claims stranded messages and re-runs business processing once per claim. */
export async function resumeStrandedInboundEdielMessages(input: StrandedResumeOptions & {
  actorUserId: string;
  workerId: string;
  process: (edielMessageId: string) => Promise<unknown>;
}): Promise<StrandedResumeResult> {
  const result: StrandedResumeResult = { candidates: 0, claimed: 0, resumed: 0, stillReceived: 0, failed: 0, exhausted: 0, errors: [] };
  const { candidates, claimed } = await claimStrandedInboundEdielMessages(input);
  result.candidates = candidates;
  result.claimed = claimed.length;

  await runRecoveryBatch(claimed, async (item) => {
    // The attempt is recorded before the re-run: a crash mid-run still counts.
    await createEdielMessageEvent({
      actorUserId: input.actorUserId,
      edielMessageId: item.id,
      eventType: "manual_note",
      eventStatus: "warning",
      message: `Inbound-affärsbehandlingen återupptas automatiskt (försök ${item.attempt} av ${item.maxAttempts}).`,
      payload: { resume: STRANDED_INBOUND_RESUME_MARKER, kind: "attempt", attempt: item.attempt, maxAttempts: item.maxAttempts, workerId: input.workerId },
    });
    let failure: string | null = null;
    try {
      await input.process(item.id);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error ?? "Okänt fel");
      result.failed += 1;
      result.errors.push(`${item.id}: ${failure}`);
      await recordInboundBusinessProcessingFailure({
        actorUserId: input.actorUserId, edielMessageId: item.id, error: failure, workerId: input.workerId,
        phase: "resume", attempt: item.attempt, maxAttempts: item.maxAttempts,
      }).catch(() => null);
    }

    const { data: after, error: afterError } = await (tenantDb(item.companyId).from("ediel_messages").select("id,status,processing_status") as ReturnType<ReturnType<typeof supabaseService.from>['select']>)
      .eq("id", item.id)
      .maybeSingle();
    if (afterError) throw afterError;
    const row = after as { status?: string | null; processing_status?: string | null } | null;
    if (!row) {
      result.errors.push(`${item.id}: message not readable after resume`);
      return "ambiguous";
    }
    if (row.status !== STRANDED_STATUS || row.processing_status !== STRANDED_STATUS) {
      result.resumed += 1;
      return failure ? "ambiguous" : "completed";
    }
    if (!failure) result.stillReceived += 1;
    if (item.attempt >= item.maxAttempts) {
      result.exhausted += 1;
      await createEdielMessageEvent({
        actorUserId: input.actorUserId,
        edielMessageId: item.id,
        eventType: "manual_note",
        eventStatus: "error",
        message: "Automatisk återupptagning avslutad utan att meddelandet behandlades. Kör om runtime-beslutet för meddelandet i Ediel-inkorgen.",
        payload: { resume: STRANDED_INBOUND_RESUME_MARKER, kind: "exhausted", exhausted: true, attempts: item.attempt, lastError: failure },
      });
    }
    return "ambiguous";
  }, result.errors);
  return result;
}
