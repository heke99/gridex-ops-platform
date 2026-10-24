import { claimRecoveryWork, runRecoveryBatch, type RecoveryClaim, type RecoveryOutcome } from "./edielRecoveryWork";
// Resume for technical CONTRL replies that an inbound Ediel source should have
// had but never got (reality finding F106 part A).
//
// The technical CONTRL is created once, early in processInboundEdielMessage.
// When that step failed (statement timeout 57014 under load, or
// ediel_existing_ack_original_read_unavailable) the error was only written as a
// "CONTRL skapades inte" note and processing went on: the source reached
// parsed/validated, so neither its mail job nor the F103 stranded resume (which
// only selects 'received') ever revisits it. Two outcomes were left behind:
//   * missing:  no CONTRL at all for the source;
//   * unqueued: the UTILTS runtime later created the same technical CONTRL
//     (createUtiltsRuntimeAcks), but that path never queues it, so it stays a
//     draft without an ediel_outbox row and is never sent.
// This module selects exactly the sources with such a note, bounded per run,
// per lane and (optionally) per tenant, and
//   * re-runs only the technical CONTRL owner for a missing reply
//     (resumeInboundTechnicalAck: same endpoint/syntax/canonical gateway, which
//     replays idempotently and queues a fresh CONTRL on first insertion), and
//   * repairs the missing outbox entry of an unqueued reply from its protected
//     retained original (readExistingAckBeforeDraft) as an insert-only
//     'prepared' entry - never requeueing an existing transport state.
// Every attempt is recorded on the message it acts on and counted, so a
// permanently failing reply ends with an explicit exhausted note.
import { supabaseService } from "@/lib/supabase/service";
import { tenantDb } from "@/lib/supabase/tenantDb";
import { createEdielMessageEvent } from "@/lib/ediel/db";
import { readExistingAckBeforeDraft } from "@/lib/ediel/core/ackDraftSource";
import { createOutboxItem } from "@/lib/ediel/outbox/createOutboxItem";
import type { EdielMessageRow } from "@/lib/ediel/types";

export const MISSED_TECHNICAL_ACK_RESUME_MARKER = "missed_technical_ack";
/** createAckBlockedEvent in lib/ediel/flows/inboundProcessing.ts */

export type MissedTechnicalAckResumeOptions = {
  environment: "test" | "production";
  /** Tenant-scoped run (manual company poll). Omitted = every tenant of the lane. */
  companyId?: string | null;
  /** Ediel messages this run already processed; never touched twice in one run. */
  excludeIds?: readonly string[];
  limit?: number;
  /** A failure note younger than this may belong to processing still in flight. */
  graceMinutes?: number;
  lookbackHours?: number;
  maxAttempts?: number;
  now?: () => Date;
};

export type MissedTechnicalAckTarget = RecoveryClaim & {
  kind: "missing" | "unqueued";
  /** The message the attempt acts on: the source (missing) or its draft CONTRL (unqueued). */
  messageId: string;
  sourceMessageId: string;
  companyId: string;
  attempt: number;
  maxAttempts: number;
};

export type MissedTechnicalAckResumeResult = {
  candidates: number;
  claimed: number;
  created: number;
  requeued: number;
  notApplicable: number;
  failed: number;
  exhausted: number;
  errors: string[];
};

/**
 * PostgREST puts .in() lists in the request URL. With hundreds of ids the
 * request failed with "URI too long" on every run (world, F run 28: 384 failure
 * notes), so no missed reply was ever resumed (F112). Lists are read in chunks.
 */

/**
 * Selects the sources of this lane (and tenant) whose technical CONTRL attempt
 * failed, and classifies what is still missing. A source still 'received' is
 * left to the F103 stranded resume, which re-runs its whole processing.
 * All work is reserved by the shared durable source token before acting.
 * Existing ACK locks and insert-only outbox writes remain required.
 */
export async function claimMissedTechnicalAcks(options: MissedTechnicalAckResumeOptions): Promise<{ candidates: number; claimed: MissedTechnicalAckTarget[] }> {
  return claimRecoveryWork<MissedTechnicalAckTarget>("technical", options);
}

async function readMessage(id: string, companyId: string, environment: string): Promise<EdielMessageRow | null> {
  const { data, error } = await (tenantDb(companyId).from("ediel_messages").select("*") as ReturnType<ReturnType<typeof supabaseService.from>['select']>)
    .eq("id", id)
    .eq("environment", environment)
    .maybeSingle();
  if (error) throw error;
  return (data as EdielMessageRow | null) ?? null;
}

/** Queues the protected retained CONTRL of a source when it has no outbox entry. */
async function repairUnqueuedContrl(input: { actorUserId: string; workerId: string; target: MissedTechnicalAckTarget; environment: string }): Promise<"requeued" | "not_applicable"> {
  const { target } = input;
  const [ack, source] = await Promise.all([
    readMessage(target.messageId, target.companyId, input.environment),
    readMessage(target.sourceMessageId, target.companyId, input.environment),
  ]);
  if (!ack || !source || ack.direction !== "outbound" || ack.message_family !== "CONTRL" || ack.related_message_id !== source.id
    || ack.status !== "draft" || source.direction !== "inbound") return "not_applicable";
  // The protected read decides which reply is the source's own original; a
  // draft row alone is never trusted as the reply to send.
  const retained = await readExistingAckBeforeDraft({ actorUserId: input.actorUserId, sourceMessage: source, ackFamily: "CONTRL", ackScope: "interchange", acknowledgedReferences: [] });
  if (!retained || retained.id !== ack.id || retained.company_id !== target.companyId || retained.environment !== input.environment) {
    throw new Error("missed_technical_ack_retained_original_mismatch");
  }
  await createOutboxItem({
    actorUserId: input.actorUserId,
    message: retained,
    sourceMessageId: source.id,
    status: "prepared",
    queueOnlyIfInserted: true,
    payload: { createdBy: "missed_technical_ack_resume", ackFamily: "CONTRL", sourceMessageId: source.id, workerId: input.workerId },
  });
  return "requeued";
}

/** Claims missed technical replies of one lane and resolves each once per run. */
export async function resumeMissedTechnicalAcks(input: MissedTechnicalAckResumeOptions & {
  actorUserId: string;
  workerId: string;
  /** resumeInboundTechnicalAck from lib/ediel/flows/inboundProcessing.ts */
  resumeTechnicalAck: (target: { edielMessageId: string; companyId: string; environment: "test" | "production" }) => Promise<{ outcome: string; ackMessageId: string | null }>;
}): Promise<MissedTechnicalAckResumeResult> {
  const result: MissedTechnicalAckResumeResult = { candidates: 0, claimed: 0, created: 0, requeued: 0, notApplicable: 0, failed: 0, exhausted: 0, errors: [] };
  const { candidates, claimed } = await claimMissedTechnicalAcks(input);
  result.candidates = candidates;
  result.claimed = claimed.length;

  await runRecoveryBatch(claimed, async (target) => {
    let terminal: RecoveryOutcome = "ambiguous";
    // The attempt is recorded before acting: a crash mid-run still counts.
    await createEdielMessageEvent({
      actorUserId: input.actorUserId,
      edielMessageId: target.messageId,
      eventType: "manual_note",
      eventStatus: "warning",
      message: target.kind === "missing"
        ? `Teknisk kvittens (CONTRL) saknas; den skapas automatiskt på nytt (försök ${target.attempt} av ${target.maxAttempts}).`
        : `CONTRL saknar utkorgspost; den köas automatiskt (försök ${target.attempt} av ${target.maxAttempts}).`,
      payload: { resume: MISSED_TECHNICAL_ACK_RESUME_MARKER, kind: "attempt", mode: target.kind, attempt: target.attempt,
        maxAttempts: target.maxAttempts, sourceMessageId: target.sourceMessageId, workerId: input.workerId },
    });
    let failure: string | null = null;
    try {
      if (target.kind === "missing") {
        const outcome = await input.resumeTechnicalAck({ edielMessageId: target.sourceMessageId, companyId: target.companyId, environment: input.environment });
        if (outcome.outcome === "created" || outcome.outcome === "existing") { result.created += 1; terminal = "completed"; }
        else result.notApplicable += 1;
      } else {
        const outcome = await repairUnqueuedContrl({ actorUserId: input.actorUserId, workerId: input.workerId, target, environment: input.environment });
        if (outcome === "requeued") { result.requeued += 1; terminal = "completed"; }
        else { result.notApplicable += 1; terminal = "no_effect"; }
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error ?? "Okänt fel");
      result.failed += 1;
      result.errors.push(`${target.messageId}: ${failure}`);
      const exhausted = target.attempt >= target.maxAttempts;
      if (exhausted) result.exhausted += 1;
      await createEdielMessageEvent({
        actorUserId: input.actorUserId,
        edielMessageId: target.messageId,
        eventType: "manual_note",
        eventStatus: "error",
        message: exhausted
          ? "Automatisk återupptagning av teknisk kvittens (CONTRL) avslutad utan resultat. Granska källan och kvittensen manuellt."
          : "Återupptagning av teknisk kvittens (CONTRL) har osäkert utfall. Automatiska återförsök är spärrade tills utfallet har verifierats.",
        payload: { resume: MISSED_TECHNICAL_ACK_RESUME_MARKER, kind: exhausted ? "exhausted" : "failed", mode: target.kind,
          attempt: target.attempt, maxAttempts: target.maxAttempts, error: failure.slice(0, 1000), workerId: input.workerId },
      }).catch(() => null);
    }
    return terminal;
  }, result.errors);
  return result;
}
