import { claimRecoveryWork, runRecoveryBatch, type RecoveryClaim, type RecoveryOutcome } from "./edielRecoveryWork";
// Resume for UTILTS runtime replies that were created but never queued
// (reality finding F112).
//
// createUtiltsRuntimeAcks (lib/ediel/flows/utiltsDataRequest.part-1.ts) builds
// the CONTRL / APERAK / UTILTS-ERR replies of an inbound UTILTS source and
// records "<FAMILY> hanterad via canonical kernel." on the source with the
// reply's ackMessageId. Before F112 it never queued them, so every operational
// reply stayed a draft without an ediel_outbox row and was never sent to the
// grid owner (world, F run 28: the reprocessed held E66 got their APERAK only
// as drafts). Since F112 an operational reply is queued when it is created;
// this resume covers the replies left behind:
//   * pre_f112:     a production-lane reply recorded before F112 (its event has
//                   no replyDispatch). The Test Center chain and TGT never run
//                   in production (ENV-05), so these are operational replies;
//   * queue_failed: an operational reply whose outbox insert failed
//                   (replyDispatch=operational_outbox, outboxQueued=false), in
//                   either lane.
// A reply recorded as draft_only (Test Center, TGT, AGT, manual callers) and a
// pre-F112 test-lane reply are never taken: their origin cannot be proven
// operational. A technical CONTRL whose source carries the F106 "CONTRL
// skapades inte" note belongs to missedTechnicalAckResume and is left to it.
//
// Selection is per lane and optionally per tenant, bounded in time and count;
// a durable source token is started before a reply is acted on, and every
// attempt is atomically counted on the reply before acting. The
// reply is queued from its protected retained original
// (readExistingAckBeforeDraft) as an insert-only 'prepared' entry on its unique
// ACK lock key, so a retry or a concurrent run never queues twice and an
// existing transport state is never requeued. All send gates apply in the
// outbox worker as for any other ACK.
import { supabaseService } from "@/lib/supabase/service";
import { tenantDb } from "@/lib/supabase/tenantDb";
import { createEdielMessageEvent } from "@/lib/ediel/db";
import { readExistingAckBeforeDraft } from "@/lib/ediel/core/ackDraftSource";
import { createOutboxItem } from "@/lib/ediel/outbox/createOutboxItem";
import { getUtiltsAckTransactionTargets } from "@/lib/ediel/ack";
import { resolveUtiltsRuntimeReplyDispatch } from "@/lib/ediel/utilts/utiltsRuntimeReplyDispatch";
import type { EdielMessageRow } from "@/lib/ediel/types";

export const UNQUEUED_UTILTS_REPLY_RESUME_MARKER = "unqueued_utilts_runtime_reply";
/** createAckBlockedEvent in lib/ediel/flows/inboundProcessing.ts; owned by missedTechnicalAckResume. */
type ReplyFamily = "CONTRL" | "APERAK" | "UTILTS_ERR";
/** PostgREST puts .in() lists in the URL; long lists fail with "URI too long". */

export type UnqueuedUtiltsReplyResumeOptions = {
  environment: "test" | "production";
  /** Tenant-scoped run. Omitted = every tenant of the lane. */
  companyId?: string | null;
  /** Sources this run already processed; never touched twice in one run. */
  excludeIds?: readonly string[];
  /** Sources claimed per run. */
  limit?: number;
  /** Replies acted on per run. */
  replyLimit?: number;
  /** A reply younger than this may still be queued by the run that created it. */
  graceMinutes?: number;
  lookbackHours?: number;
  maxAttempts?: number;
  now?: () => Date;
};

export type UnqueuedUtiltsReplyTarget = RecoveryClaim & {
  ackMessageId: string;
  sourceMessageId: string;
  companyId: string;
  ackFamily: ReplyFamily;
  outcome: "positive" | "negative" | null;
  ackScope: string | null;
  relatedTransactionReference: string | null;
  provenance: "pre_f112" | "queue_failed";
  attempt: number;
  maxAttempts: number;
};

export type UnqueuedUtiltsReplyResumeResult = {
  candidates: number;
  claimedSources: number;
  claimed: number;
  requeued: number;
  notApplicable: number;
  failed: number;
  exhausted: number;
  errors: string[];
};

/**
 * A production source exchanged with the Ediel test portal (91100) is never
 * queued here (ENV-05). The application reference alone is no TGT signal:
 * "23-DDQ-E66-T" is an ordinary production profile variant (S or T).
 */

/**
 * Selects the unqueued operational UTILTS runtime replies of one lane (and
 * tenant) and claims their sources. Nothing is written except the claim.
 */
export async function claimUnqueuedUtiltsRuntimeReplies(options: UnqueuedUtiltsReplyResumeOptions): Promise<{ candidates: number; claimedSources: number; claimed: UnqueuedUtiltsReplyTarget[] }> {
  return claimRecoveryWork<UnqueuedUtiltsReplyTarget>("runtime", options);
}

async function readMessage(id: string, companyId: string, environment: string): Promise<EdielMessageRow | null> {
  const { data, error } = await (tenantDb(companyId).from("ediel_messages").select("*") as ReturnType<ReturnType<typeof supabaseService.from>['select']>)
    .eq("id", id)
    .eq("environment", environment)
    .maybeSingle();
  if (error) throw error;
  return (data as EdielMessageRow | null) ?? null;
}

/** The scope prepareSourceAckDraft used for this UTILTS reply (see lib/ediel/ack/prepareSourceAckDraft.ts). */
function retainedReplyScope(source: EdielMessageRow, target: UnqueuedUtiltsReplyTarget): { ackScope: "interchange" | "message" | "transaction"; references: string[] } {
  if (target.ackFamily === "CONTRL") return { ackScope: "interchange", references: [] };
  if (target.ackScope === "message" && !target.relatedTransactionReference) return { ackScope: "message", references: [] };
  if (target.relatedTransactionReference) return { ackScope: "transaction", references: [target.relatedTransactionReference] };
  const references = getUtiltsAckTransactionTargets(source).map((row) => row.reference);
  return { ackScope: references.length ? "transaction" : "message", references };
}

async function queueRetainedReply(input: { actorUserId: string; workerId: string; target: UnqueuedUtiltsReplyTarget; environment: "test" | "production" }): Promise<"requeued" | "not_applicable"> {
  const { target } = input;
  const [ack, source] = await Promise.all([
    readMessage(target.ackMessageId, target.companyId, input.environment),
    readMessage(target.sourceMessageId, target.companyId, input.environment),
  ]);
  if (!ack || !source || ack.direction !== "outbound" || ack.message_family !== target.ackFamily || ack.related_message_id !== source.id
    || ack.status !== "draft" || source.direction !== "inbound" || source.message_family !== "UTILTS" || source.status === "cancelled") return "not_applicable";
  // The lane rule of the creating run, re-read on the full source: only an
  // operational source is ever sent. The origin is operational by provenance.
  if (resolveUtiltsRuntimeReplyDispatch({ origin: "operational", sourceMessage: source }).dispatch !== "operational_outbox") return "not_applicable";
  const scope = retainedReplyScope(source, target);
  // The protected read decides which reply is the source's own original; a
  // draft row alone is never trusted as the reply to send.
  const retained = await readExistingAckBeforeDraft({ actorUserId: input.actorUserId, sourceMessage: source, ackFamily: target.ackFamily,
    outcome: target.ackFamily === "CONTRL" ? undefined : target.outcome ?? undefined, ackScope: scope.ackScope, acknowledgedReferences: scope.references });
  if (!retained || retained.id !== ack.id || retained.company_id !== target.companyId || retained.environment !== input.environment) {
    throw new Error("unqueued_utilts_reply_retained_original_mismatch");
  }
  await createOutboxItem({
    actorUserId: input.actorUserId,
    message: retained,
    sourceMessageId: source.id,
    status: "prepared",
    queueOnlyIfInserted: true,
    payload: { createdBy: "unqueued_utilts_reply_resume", ackFamily: target.ackFamily, sourceMessageId: source.id,
      provenance: target.provenance, workerId: input.workerId },
  });
  return "requeued";
}

/** Claims unqueued operational UTILTS runtime replies of one lane and queues each once per run. */
export async function resumeUnqueuedUtiltsRuntimeReplies(input: UnqueuedUtiltsReplyResumeOptions & {
  actorUserId: string;
  workerId: string;
}): Promise<UnqueuedUtiltsReplyResumeResult> {
  const result: UnqueuedUtiltsReplyResumeResult = { candidates: 0, claimedSources: 0, claimed: 0, requeued: 0, notApplicable: 0, failed: 0, exhausted: 0, errors: [] };
  const { candidates, claimedSources, claimed } = await claimUnqueuedUtiltsRuntimeReplies(input);
  result.candidates = candidates;
  result.claimedSources = claimedSources;
  result.claimed = claimed.length;

  await runRecoveryBatch(claimed, async (target) => {
    let terminal: RecoveryOutcome = "ambiguous";
    // The attempt is recorded before acting: a crash mid-run still counts.
    await createEdielMessageEvent({
      actorUserId: input.actorUserId,
      edielMessageId: target.ackMessageId,
      eventType: "manual_note",
      eventStatus: "warning",
      message: `${target.ackFamily} till inkommande UTILTS saknar utkorgspost; den köas automatiskt (försök ${target.attempt} av ${target.maxAttempts}).`,
      payload: { resume: UNQUEUED_UTILTS_REPLY_RESUME_MARKER, kind: "attempt", provenance: target.provenance, attempt: target.attempt,
        maxAttempts: target.maxAttempts, sourceMessageId: target.sourceMessageId, workerId: input.workerId },
    });
    try {
      const outcome = await queueRetainedReply({ actorUserId: input.actorUserId, workerId: input.workerId, target, environment: input.environment });
      if (outcome === "requeued") { result.requeued += 1; terminal = "completed"; }
      else { result.notApplicable += 1; terminal = "no_effect"; }
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error ?? "Okänt fel");
      result.failed += 1;
      result.errors.push(`${target.ackMessageId}: ${failure}`);
      const exhausted = target.attempt >= target.maxAttempts;
      if (exhausted) result.exhausted += 1;
      await createEdielMessageEvent({
        actorUserId: input.actorUserId,
        edielMessageId: target.ackMessageId,
        eventType: "manual_note",
        eventStatus: "error",
        message: exhausted
          ? `Automatisk köning av ${target.ackFamily} avslutad utan resultat. Granska källan och svaret manuellt.`
          : `Automatisk köning av ${target.ackFamily} har osäkert utfall. Automatiska återförsök är spärrade tills utfallet har verifierats.`,
        payload: { resume: UNQUEUED_UTILTS_REPLY_RESUME_MARKER, kind: exhausted ? "exhausted" : "failed", attempt: target.attempt,
          maxAttempts: target.maxAttempts, error: failure.slice(0, 1000), workerId: input.workerId },
      }).catch(() => null);
    }
    return terminal;
  }, result.errors);
  return result;
}
