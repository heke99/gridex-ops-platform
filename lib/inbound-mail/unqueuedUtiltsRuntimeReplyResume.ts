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
// each source is claimed with an updated_at compare-and-set before its replies
// are acted on, and every attempt is counted on the reply (max attempts). The
// reply is queued from its protected retained original
// (readExistingAckBeforeDraft) as an insert-only 'prepared' entry on its unique
// ACK lock key, so a retry or a concurrent run never queues twice and an
// existing transport state is never requeued. All send gates apply in the
// outbox worker as for any other ACK.
import { supabaseService } from "@/lib/supabase/service";
import { createEdielMessageEvent } from "@/lib/ediel/db";
import { readExistingAckBeforeDraft } from "@/lib/ediel/core/ackDraftSource";
import { createOutboxItem } from "@/lib/ediel/outbox/createOutboxItem";
import { getUtiltsAckTransactionTargets } from "@/lib/ediel/ack";
import { resolveUtiltsRuntimeReplyDispatch } from "@/lib/ediel/utilts/utiltsRuntimeReplyDispatch";
import type { EdielMessageRow } from "@/lib/ediel/types";

export const UNQUEUED_UTILTS_REPLY_RESUME_MARKER = "unqueued_utilts_runtime_reply";
/** createAckBlockedEvent in lib/ediel/flows/inboundProcessing.ts; owned by missedTechnicalAckResume. */
const TECHNICAL_ACK_FAILURE_GUARD = "canonical_inbound_ack_guard";
const REPLY_FAMILIES = ["CONTRL", "APERAK", "UTILTS_ERR"] as const;
type ReplyFamily = (typeof REPLY_FAMILIES)[number];
const KERNEL_EVENT_TYPES = ["contrl_sent", "aperak_sent", "utilts_err_sent"];
const KERNEL_MESSAGES = new Map<string, ReplyFamily>(REPLY_FAMILIES.map((family) => [`${family} hanterad via canonical kernel.`, family]));
/** PostgREST puts .in() lists in the URL; long lists fail with "URI too long". */
const IN_CHUNK = 50;

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

export type UnqueuedUtiltsReplyTarget = {
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

type Row = Record<string, unknown>;

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const number = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.min(Math.max(number, min), max);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function payloadOf(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}

function chunks<T>(values: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += IN_CHUNK) result.push(values.slice(index, index + IN_CHUNK));
  return result;
}

async function rowsIn(ids: readonly string[], query: (chunk: string[]) => PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> {
  const rows: Row[] = [];
  for (const chunk of chunks(Array.from(new Set(ids)))) {
    const { data, error } = await query(chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as Row[]));
  }
  return rows;
}

async function countAttempts(ids: readonly string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const rows = await rowsIn(ids, (chunk) => supabaseService
    .from("ediel_message_events")
    .select("ediel_message_id,payload")
    .in("ediel_message_id", chunk)
    .eq("event_type", "manual_note"));
  for (const row of rows) {
    const id = text(row.ediel_message_id), payload = payloadOf(row.payload);
    if (!id || payload.resume !== UNQUEUED_UTILTS_REPLY_RESUME_MARKER || payload.kind !== "attempt") continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * A production source exchanged with the Ediel test portal (91100) is never
 * queued here (ENV-05). The application reference alone is no TGT signal:
 * "23-DDQ-E66-T" is an ordinary production profile variant (S or T).
 */
function looksLikeTgtSource(row: Row): boolean {
  return row.sender_ediel_id === "91100" || row.receiver_ediel_id === "91100";
}

/**
 * Selects the unqueued operational UTILTS runtime replies of one lane (and
 * tenant) and claims their sources. Nothing is written except the claim.
 */
export async function claimUnqueuedUtiltsRuntimeReplies(options: UnqueuedUtiltsReplyResumeOptions): Promise<{ candidates: number; claimedSources: number; claimed: UnqueuedUtiltsReplyTarget[] }> {
  const none = { candidates: 0, claimedSources: 0, claimed: [] };
  if (options.environment !== "test" && options.environment !== "production") return none;
  const now = (options.now ?? (() => new Date()))();
  const limit = clampInt(options.limit, 10, 1, 50);
  const replyLimit = clampInt(options.replyLimit, 50, 1, 200);
  const maxAttempts = clampInt(options.maxAttempts, 3, 1, 10);
  const graceCutoff = new Date(now.getTime() - clampInt(options.graceMinutes, 10, 2, 24 * 60) * 60_000).toISOString();
  const lookbackCutoff = new Date(now.getTime() - clampInt(options.lookbackHours, 72, 1, 30 * 24) * 3_600_000).toISOString();
  const exclude = new Set(options.excludeIds ?? []);

  const kernelEvents = () => {
    let query = supabaseService
      .from("ediel_message_events")
      .select("ediel_message_id,company_id,message,payload,created_at")
      .in("event_type", KERNEL_EVENT_TYPES)
      .in("message", Array.from(KERNEL_MESSAGES.keys()))
      .gt("created_at", lookbackCutoff)
      .lt("created_at", graceCutoff);
    if (options.companyId) query = query.eq("company_id", options.companyId);
    return query;
  };
  const selections: Array<{ provenance: UnqueuedUtiltsReplyTarget["provenance"]; rows: Row[] }> = [];
  {
    const { data, error } = await kernelEvents()
      .eq("payload->>replyDispatch", "operational_outbox")
      .eq("payload->>outboxQueued", "false")
      .order("created_at", { ascending: true }).limit(1000);
    if (error) throw error;
    selections.push({ provenance: "queue_failed", rows: (data ?? []) as Row[] });
  }
  if (options.environment === "production") {
    // Pre-F112 events are older than every event that carries replyDispatch,
    // so the oldest-first page reaches them first; later ones are dropped below.
    const { data, error } = await kernelEvents()
      .order("created_at", { ascending: true }).limit(1000);
    if (error) throw error;
    selections.push({ provenance: "pre_f112", rows: (data ?? []) as Row[] });
  }

  type Candidate = Omit<UnqueuedUtiltsReplyTarget, "attempt" | "maxAttempts"> & { eventCompanyId: string | null; createdAt: string };
  const byAck = new Map<string, Candidate>();
  for (const { provenance, rows } of selections) {
    for (const row of rows) {
      const payload = payloadOf(row.payload);
      const ackMessageId = text(payload.ackMessageId), sourceMessageId = text(row.ediel_message_id);
      const ackFamily = KERNEL_MESSAGES.get(String(row.message ?? ""));
      if (!ackMessageId || !sourceMessageId || !ackFamily || exclude.has(sourceMessageId) || byAck.has(ackMessageId)) continue;
      // Only a reply recorded as operational (or a pre-F112 production reply) is ever taken.
      if (provenance === "queue_failed" && payload.replyDispatch !== "operational_outbox") continue;
      if (provenance === "pre_f112" && payload.replyDispatch !== undefined && payload.replyDispatch !== null) continue;
      const outcome = payload.outcome === "positive" || payload.outcome === "negative" ? payload.outcome : null;
      byAck.set(ackMessageId, { ackMessageId, sourceMessageId, companyId: "", ackFamily, outcome, provenance,
        ackScope: text(payload.ackScope), relatedTransactionReference: text(payload.relatedTransactionReference),
        eventCompanyId: text(row.company_id), createdAt: String(row.created_at ?? "") });
    }
  }
  if (byAck.size === 0) return none;

  const ackRows = await rowsIn(Array.from(byAck.keys()), (chunk) => {
    let query = supabaseService
      .from("ediel_messages")
      .select("id,company_id,environment,direction,message_family,status,related_message_id")
      .in("id", chunk)
      .eq("environment", options.environment)
      .eq("direction", "outbound");
    if (options.companyId) query = query.eq("company_id", options.companyId);
    return query;
  });
  const drafts = new Map<string, Candidate>();
  for (const row of ackRows) {
    const candidate = byAck.get(String(row.id ?? ""));
    const companyId = text(row.company_id);
    if (!candidate || !companyId || row.status !== "draft" || row.message_family !== candidate.ackFamily
      || row.related_message_id !== candidate.sourceMessageId || row.environment !== options.environment
      || (candidate.eventCompanyId && candidate.eventCompanyId !== companyId) || (options.companyId && companyId !== options.companyId)) continue;
    drafts.set(candidate.ackMessageId, { ...candidate, companyId });
  }
  if (drafts.size === 0) return none;

  const queued = new Set((await rowsIn(Array.from(drafts.keys()), (chunk) => supabaseService
    .from("ediel_outbox").select("ediel_message_id").in("ediel_message_id", chunk)))
    .map((row) => text(row.ediel_message_id)).filter(Boolean) as string[]);
  for (const id of queued) drafts.delete(id);
  if (drafts.size === 0) return none;

  const sourceIds = Array.from(new Set(Array.from(drafts.values()).map((row) => row.sourceMessageId)));
  const sourceRows = await rowsIn(sourceIds, (chunk) => {
    let query = supabaseService
      .from("ediel_messages")
      .select("id,company_id,environment,direction,message_family,status,updated_at,sender_ediel_id,receiver_ediel_id,application_reference")
      .in("id", chunk)
      .eq("environment", options.environment)
      .eq("direction", "inbound");
    if (options.companyId) query = query.eq("company_id", options.companyId);
    return query;
  });
  const sources = new Map<string, Row>();
  for (const row of sourceRows) {
    const id = text(row.id);
    if (!id || row.message_family !== "UTILTS" || row.status === "cancelled" || !text(row.company_id) || !text(row.updated_at)) continue;
    if (options.environment === "production" && looksLikeTgtSource(row)) continue;
    sources.set(id, row);
  }
  // A technical CONTRL of a source with the F106 failure note is owned by missedTechnicalAckResume.
  const contrlSourceIds = Array.from(drafts.values()).filter((row) => row.ackFamily === "CONTRL").map((row) => row.sourceMessageId);
  const technicalOwned = new Set((await rowsIn(contrlSourceIds, (chunk) => supabaseService
    .from("ediel_message_events")
    .select("ediel_message_id")
    .in("ediel_message_id", chunk)
    .eq("event_type", "manual_note")
    .eq("payload->>blockedBy", TECHNICAL_ACK_FAILURE_GUARD)
    .eq("payload->>ackFamily", "CONTRL")))
    .map((row) => text(row.ediel_message_id)).filter(Boolean) as string[]);

  const eligibleDrafts = Array.from(drafts.values()).filter((row) => {
    const source = sources.get(row.sourceMessageId);
    return Boolean(source) && source!.company_id === row.companyId && !(row.ackFamily === "CONTRL" && technicalOwned.has(row.sourceMessageId));
  });
  if (eligibleDrafts.length === 0) return none;
  const attempts = await countAttempts(eligibleDrafts.map((row) => row.ackMessageId));
  const candidates = eligibleDrafts
    .filter((row) => (attempts.get(row.ackMessageId) ?? 0) < maxAttempts)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

  const claimed: UnqueuedUtiltsReplyTarget[] = [];
  const claimedSources = new Set<string>();
  const refusedSources = new Set<string>();
  for (const row of candidates) {
    if (claimed.length >= replyLimit) break;
    if (refusedSources.has(row.sourceMessageId)) continue;
    if (!claimedSources.has(row.sourceMessageId)) {
      if (claimedSources.size >= limit) continue;
      const source = sources.get(row.sourceMessageId)!;
      // Claim the source once per run; a concurrent run loses the compare-and-set.
      const claim = await supabaseService
        .from("ediel_messages")
        .update({ updated_at: now.toISOString() })
        .eq("id", row.sourceMessageId)
        .eq("company_id", row.companyId)
        .eq("environment", options.environment)
        .eq("updated_at", source.updated_at as string)
        .select("id");
      if (claim.error) throw claim.error;
      if ((claim.data ?? []).length === 0) { refusedSources.add(row.sourceMessageId); continue; }
      claimedSources.add(row.sourceMessageId);
    }
    claimed.push({ ackMessageId: row.ackMessageId, sourceMessageId: row.sourceMessageId, companyId: row.companyId, ackFamily: row.ackFamily,
      outcome: row.outcome, ackScope: row.ackScope, relatedTransactionReference: row.relatedTransactionReference, provenance: row.provenance,
      attempt: (attempts.get(row.ackMessageId) ?? 0) + 1, maxAttempts });
  }
  return { candidates: candidates.length, claimedSources: claimedSources.size, claimed };
}

async function readMessage(id: string, companyId: string, environment: string): Promise<EdielMessageRow | null> {
  const { data, error } = await supabaseService
    .from("ediel_messages")
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
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

  for (const target of claimed) {
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
      if (outcome === "requeued") result.requeued += 1;
      else result.notApplicable += 1;
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
          : `Automatisk köning av ${target.ackFamily} misslyckades; nytt försök görs av inbound-cron.`,
        payload: { resume: UNQUEUED_UTILTS_REPLY_RESUME_MARKER, kind: exhausted ? "exhausted" : "failed", attempt: target.attempt,
          maxAttempts: target.maxAttempts, error: failure.slice(0, 1000), workerId: input.workerId },
      }).catch(() => null);
    }
  }
  return result;
}
