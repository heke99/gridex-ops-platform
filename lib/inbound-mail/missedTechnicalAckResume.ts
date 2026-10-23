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
import { createEdielMessageEvent } from "@/lib/ediel/db";
import { readExistingAckBeforeDraft } from "@/lib/ediel/core/ackDraftSource";
import { createOutboxItem } from "@/lib/ediel/outbox/createOutboxItem";
import type { EdielMessageRow } from "@/lib/ediel/types";

export const MISSED_TECHNICAL_ACK_RESUME_MARKER = "missed_technical_ack";
/** createAckBlockedEvent in lib/ediel/flows/inboundProcessing.ts */
const TECHNICAL_ACK_FAILURE_GUARD = "canonical_inbound_ack_guard";

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

export type MissedTechnicalAckTarget = {
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

type Row = Record<string, unknown>;
type SourceRow = { id: string; company_id: string; environment: string; status: string | null; processing_status: string | null; updated_at: string | null };
type ContrlRow = { id: string; company_id: string; environment: string; status: string | null; related_message_id: string };

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

async function countAttempts(ids: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  const { data, error } = await supabaseService
    .from("ediel_message_events")
    .select("ediel_message_id,payload")
    .in("ediel_message_id", ids)
    .eq("event_type", "manual_note");
  if (error) throw error;
  for (const row of (data ?? []) as Array<{ ediel_message_id?: string | null; payload?: unknown }>) {
    const payload = payloadOf(row.payload);
    if (!row.ediel_message_id || payload.resume !== MISSED_TECHNICAL_ACK_RESUME_MARKER || payload.kind !== "attempt") continue;
    counts.set(row.ediel_message_id, (counts.get(row.ediel_message_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Selects the sources of this lane (and tenant) whose technical CONTRL attempt
 * failed, and classifies what is still missing. A source still 'received' is
 * left to the F103 stranded resume, which re-runs its whole processing.
 * Missing replies are claimed with an updated_at compare-and-set on the source;
 * an unqueued reply needs no claim, because its outbox entry is insert-only on
 * the reply's unique ACK lock key.
 */
export async function claimMissedTechnicalAcks(options: MissedTechnicalAckResumeOptions): Promise<{ candidates: number; claimed: MissedTechnicalAckTarget[] }> {
  if (options.environment !== "test" && options.environment !== "production") return { candidates: 0, claimed: [] };
  const now = (options.now ?? (() => new Date()))();
  const limit = clampInt(options.limit, 10, 1, 50);
  const maxAttempts = clampInt(options.maxAttempts, 3, 1, 10);
  const graceCutoff = new Date(now.getTime() - clampInt(options.graceMinutes, 10, 2, 24 * 60) * 60_000).toISOString();
  const lookbackCutoff = new Date(now.getTime() - clampInt(options.lookbackHours, 72, 1, 30 * 24) * 3_600_000).toISOString();
  const exclude = new Set(options.excludeIds ?? []);

  let failures = supabaseService
    .from("ediel_message_events")
    .select("ediel_message_id,company_id,created_at")
    .eq("event_type", "manual_note")
    .eq("payload->>blockedBy", TECHNICAL_ACK_FAILURE_GUARD)
    .eq("payload->>ackFamily", "CONTRL")
    .gt("created_at", lookbackCutoff)
    .lt("created_at", graceCutoff);
  if (options.companyId) failures = failures.eq("company_id", options.companyId);
  const { data: failureRows, error: failureError } = await failures.order("created_at", { ascending: true }).limit(1000);
  if (failureError) throw failureError;
  const sourceIds = Array.from(new Set(((failureRows ?? []) as Row[])
    .map((row) => text(row.ediel_message_id))
    .filter((id): id is string => Boolean(id) && !exclude.has(id as string))));
  if (sourceIds.length === 0) return { candidates: 0, claimed: [] };

  let sourcesQuery = supabaseService
    .from("ediel_messages")
    .select("id,company_id,environment,message_family,status,processing_status,updated_at")
    .in("id", sourceIds)
    .eq("direction", "inbound")
    .eq("message_standard", "edifact")
    .eq("environment", options.environment)
    .not("company_id", "is", null);
  if (options.companyId) sourcesQuery = sourcesQuery.eq("company_id", options.companyId);
  const { data: sourceRows, error: sourceError } = await sourcesQuery;
  if (sourceError) throw sourceError;
  const sources = ((sourceRows ?? []) as Row[]).flatMap((row): SourceRow[] => {
    const id = text(row.id), companyId = text(row.company_id);
    if (!id || !companyId || row.environment !== options.environment || (options.companyId && companyId !== options.companyId)) return [];
    if (row.message_family === "CONTRL" || row.status === "cancelled") return [];
    // Never acknowledge a CONTRL; F103 owns a source whose processing never ran.
    if (row.status === "received" && row.processing_status === "received") return [];
    return [{ id, company_id: companyId, environment: options.environment, status: text(row.status), processing_status: text(row.processing_status), updated_at: text(row.updated_at) }];
  });
  if (sources.length === 0) return { candidates: 0, claimed: [] };
  const sourceById = new Map(sources.map((row) => [row.id, row]));

  const { data: contrlRows, error: contrlError } = await supabaseService
    .from("ediel_messages")
    .select("id,company_id,environment,status,related_message_id")
    .in("related_message_id", sources.map((row) => row.id))
    .eq("direction", "outbound")
    .eq("message_family", "CONTRL");
  if (contrlError) throw contrlError;
  const contrls = ((contrlRows ?? []) as Row[]).flatMap((row): ContrlRow[] => {
    const id = text(row.id), related = text(row.related_message_id), source = related ? sourceById.get(related) : undefined;
    // Only the source's own tenant and lane; anything else is never repaired here.
    if (!id || !source || row.company_id !== source.company_id || row.environment !== source.environment) return [];
    return [{ id, company_id: source.company_id, environment: source.environment, status: text(row.status), related_message_id: source.id }];
  });
  const repliedSources = new Set(((contrlRows ?? []) as Row[]).map((row) => text(row.related_message_id)).filter(Boolean));

  const drafts = contrls.filter((row) => row.status === "draft");
  const queued = new Set<string>();
  if (drafts.length > 0) {
    const { data: outboxRows, error: outboxError } = await supabaseService
      .from("ediel_outbox")
      .select("ediel_message_id")
      .in("ediel_message_id", drafts.map((row) => row.id));
    if (outboxError) throw outboxError;
    for (const row of (outboxRows ?? []) as Row[]) { const id = text(row.ediel_message_id); if (id) queued.add(id); }
  }

  const candidates: Array<Omit<MissedTechnicalAckTarget, "attempt" | "maxAttempts">> = [
    ...sources.filter((row) => !repliedSources.has(row.id))
      .map((row) => ({ kind: "missing" as const, messageId: row.id, sourceMessageId: row.id, companyId: row.company_id })),
    ...drafts.filter((row) => !queued.has(row.id))
      .map((row) => ({ kind: "unqueued" as const, messageId: row.id, sourceMessageId: row.related_message_id, companyId: row.company_id })),
  ];
  if (candidates.length === 0) return { candidates: 0, claimed: [] };

  const attempts = await countAttempts(candidates.map((row) => row.messageId));
  const eligible = candidates.filter((row) => (attempts.get(row.messageId) ?? 0) < maxAttempts).slice(0, limit);

  const claimed: MissedTechnicalAckTarget[] = [];
  for (const row of eligible) {
    const attempt = (attempts.get(row.messageId) ?? 0) + 1;
    if (row.kind === "missing") {
      const source = sourceById.get(row.sourceMessageId);
      if (!source?.updated_at) continue;
      const claim = await supabaseService
        .from("ediel_messages")
        .update({ updated_at: now.toISOString() })
        .eq("id", source.id)
        .eq("company_id", source.company_id)
        .eq("environment", source.environment)
        .eq("updated_at", source.updated_at)
        .select("id");
      if (claim.error) throw claim.error;
      if ((claim.data ?? []).length === 0) continue;
    }
    claimed.push({ ...row, attempt, maxAttempts });
  }
  return { candidates: candidates.length, claimed };
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

  for (const target of claimed) {
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
        if (outcome.outcome === "created" || outcome.outcome === "existing") result.created += 1;
        else result.notApplicable += 1;
      } else {
        const outcome = await repairUnqueuedContrl({ actorUserId: input.actorUserId, workerId: input.workerId, target, environment: input.environment });
        if (outcome === "requeued") result.requeued += 1;
        else result.notApplicable += 1;
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
          : "Automatisk återupptagning av teknisk kvittens (CONTRL) misslyckades; nytt försök görs av inbound-cron.",
        payload: { resume: MISSED_TECHNICAL_ACK_RESUME_MARKER, kind: exhausted ? "exhausted" : "failed", mode: target.kind,
          attempt: target.attempt, maxAttempts: target.maxAttempts, error: failure.slice(0, 1000), workerId: input.workerId },
      }).catch(() => null);
    }
  }
  return result;
}
