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

/** progressed: the message got past 'received' before its processing failed (F-B1d); its own status is kept by the claim. */
export type ClaimedStrandedMessage = { id: string; companyId: string; attempt: number; maxAttempts: number; progressed?: boolean };

export type StrandedResumeResult = {
  candidates: number;
  claimed: number;
  resumed: number;
  stillReceived: number;
  failed: number;
  exhausted: number;
  errors: string[];
};

type CandidateRow = {
  id: string;
  company_id: string | null;
  environment: string | null;
  inbound_email_message_id: string | null;
  updated_at: string | null;
  status?: string | null;
  processing_status?: string | null;
};

const STRANDED_STATUS = "received";
/** F-B1d: statuses a message reaches during business processing before it can still fail (validation, linking). */
const PROGRESSED_STATUSES = ["parsed", "validated"];

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const number = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.min(Math.max(number, min), max);
}

function payloadOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// 40P01 deadlock, 40001 serialization failure, 57014 statement timeout (rolled back): safe to run again (F-B1, F-B1c).
const TRANSIENT_POSTGRES_CODES = new Set(["40P01", "40001", "57014"]);

function isTransientConflict(error: unknown): boolean {
  const record = error && typeof error === "object" ? (error as { code?: unknown; message?: unknown }) : {};
  if (typeof record.code === "string" && TRANSIENT_POSTGRES_CODES.has(record.code)) return true;
  const name = error && typeof error === "object" ? (error as { name?: unknown }).name : null;
  if (name === "AbortError" || name === "TimeoutError") return true;
  const message = typeof record.message === "string" ? record.message : String(error ?? "");
  return /deadlock detected|could not serialize access|statement timeout/i.test(message);
}

/** F-B1: a deadlock or serialization failure between concurrent inbound processings rolls back only the failed call;
 * the same sanctioned processing is retried in place a bounded number of times. Any other error is thrown at once. */
export async function runWithTransientRetry<T>(run: () => Promise<T>, options: { attempts?: number; delayMs?: number } = {}): Promise<T> {
  const attempts = clampInt(options.attempts, 3, 1, 5);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts || !isTransientConflict(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, (options.delayMs ?? 250) * attempt));
    }
  }
}

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
    message: input.phase === "resume" && input.attempt != null && input.maxAttempts != null && input.attempt >= input.maxAttempts
      ? "Affärsbehandlingen av inbound-meddelandet avbröts igen; meddelandet står kvar som mottaget."
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

async function countResumeAttempts(ids: string[]): Promise<Map<string, number>> {
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
    if (!row.ediel_message_id || payload.resume !== STRANDED_INBOUND_RESUME_MARKER || payload.kind !== "attempt") continue;
    counts.set(row.ediel_message_id, (counts.get(row.ediel_message_id) ?? 0) + 1);
  }
  return counts;
}

/** F-B1d: messages whose business processing failed after they got past 'received' (the first-run or resume failure
 * note is on their own timeline) and that no later resume completed: more failure notes than completed resumes. */
async function progressedFailureIds(lookbackCutoff: string, max: number): Promise<string[]> {
  const { data, error } = await supabaseService
    .from("ediel_message_events")
    .select("ediel_message_id,payload")
    .eq("event_type", "manual_note")
    .eq("event_status", "error")
    .gt("created_at", lookbackCutoff)
    .order("created_at", { ascending: false })
    .limit(max);
  if (error) throw error;
  const failed = new Set<string>();
  for (const row of (data ?? []) as Array<{ ediel_message_id?: string | null; payload?: unknown }>) {
    if (row.ediel_message_id && payloadOf(row.payload).inboundBusinessProcessing === INBOUND_BUSINESS_PROCESSING_FAILURE_MARKER) failed.add(row.ediel_message_id);
  }
  if (failed.size === 0) return [];
  const { data: events, error: eventError } = await supabaseService
    .from("ediel_message_events")
    .select("ediel_message_id,payload")
    .in("ediel_message_id", [...failed])
    .eq("event_type", "manual_note");
  if (eventError) throw eventError;
  const balance = new Map<string, number>();
  for (const row of (events ?? []) as Array<{ ediel_message_id?: string | null; payload?: unknown }>) {
    const payload = payloadOf(row.payload);
    if (!row.ediel_message_id) continue;
    if (payload.inboundBusinessProcessing === INBOUND_BUSINESS_PROCESSING_FAILURE_MARKER) balance.set(row.ediel_message_id, (balance.get(row.ediel_message_id) ?? 0) + 1);
    if (payload.resume === STRANDED_INBOUND_RESUME_MARKER && payload.kind === "completed") balance.set(row.ediel_message_id, (balance.get(row.ediel_message_id) ?? 0) - 1);
  }
  return [...failed].filter((id) => (balance.get(id) ?? 0) > 0);
}

/**
 * Selects inbound Ediel messages that were stored and tenant-resolved, whose
 * mail intake finished, but whose business processing never moved them past
 * 'received'; claims each with an updated_at compare-and-set on that exact
 * state so two overlapping runs never resume the same message.
 */
export async function claimStrandedInboundEdielMessages(options: StrandedResumeOptions): Promise<{ candidates: number; claimed: ClaimedStrandedMessage[] }> {
  if (options.environment !== "test" && options.environment !== "production") return { candidates: 0, claimed: [] };
  const now = (options.now ?? (() => new Date()))();
  const limit = clampInt(options.limit, 10, 1, 50);
  const maxAttempts = clampInt(options.maxAttempts, 3, 1, 10);
  const graceCutoff = new Date(now.getTime() - clampInt(options.graceMinutes, 10, 2, 24 * 60) * 60_000).toISOString();
  const lookbackCutoff = new Date(now.getTime() - clampInt(options.lookbackHours, 7 * 24, 1, 90 * 24) * 3_600_000).toISOString();
  const exclude = new Set(options.excludeIds ?? []);

  let query = supabaseService
    .from("ediel_messages")
    .select("id,company_id,environment,inbound_email_message_id,updated_at,status,processing_status")
    .eq("direction", "inbound")
    .eq("environment", options.environment)
    .eq("status", STRANDED_STATUS)
    .eq("processing_status", STRANDED_STATUS)
    .eq("tenant_resolution_status", "tenant_resolved")
    .not("company_id", "is", null)
    .not("inbound_email_message_id", "is", null)
    .lt("updated_at", graceCutoff)
    .gt("created_at", lookbackCutoff);
  if (options.companyId) query = query.eq("company_id", options.companyId);
  const { data, error } = await query.order("updated_at", { ascending: true }).limit(limit * 4);
  if (error) throw error;

  // F-B1d: the same scope for messages that got past 'received' before their processing failed.
  const progressedIds = await progressedFailureIds(lookbackCutoff, limit * 40);
  let progressedRows: CandidateRow[] = [];
  if (progressedIds.length) {
    let progressedQuery = supabaseService
      .from("ediel_messages")
      .select("id,company_id,environment,inbound_email_message_id,updated_at,status,processing_status")
      .in("id", progressedIds)
      .eq("direction", "inbound")
      .eq("environment", options.environment)
      .in("status", PROGRESSED_STATUSES)
      .eq("tenant_resolution_status", "tenant_resolved")
      .not("company_id", "is", null)
      .not("inbound_email_message_id", "is", null)
      .lt("updated_at", graceCutoff)
      .gt("created_at", lookbackCutoff);
    if (options.companyId) progressedQuery = progressedQuery.eq("company_id", options.companyId);
    const { data: progressed, error: progressedError } = await progressedQuery.order("updated_at", { ascending: true }).limit(limit * 4);
    if (progressedError) throw progressedError;
    progressedRows = (progressed ?? []) as CandidateRow[];
  }
  const progressedSet = new Set(progressedRows.map((row) => row.id));

  const rows = ([...((data ?? []) as CandidateRow[]), ...progressedRows.filter((row) => !((data ?? []) as CandidateRow[]).some((r) => r.id === row.id))]).filter((row) =>
    row.id && row.company_id && row.inbound_email_message_id && row.updated_at
    && row.environment === options.environment && !exclude.has(row.id)
    && (!options.companyId || row.company_id === options.companyId));
  if (rows.length === 0) return { candidates: 0, claimed: [] };

  // Only mail whose intake finished in the same tenant. Mail still 'received'
  // has its own job retry; a DSN is never business input.
  const { data: mails, error: mailError } = await supabaseService
    .from("inbound_email_messages")
    .select("id,company_id,processing_status,match_status")
    .in("id", Array.from(new Set(rows.map((row) => row.inbound_email_message_id as string))));
  if (mailError) throw mailError;
  const mailById = new Map(((mails ?? []) as Array<{ id: string; company_id: string | null; processing_status: string | null; match_status: string | null }>)
    .map((mail) => [mail.id, mail]));
  const intakeDone = rows.filter((row) => {
    const mail = mailById.get(row.inbound_email_message_id as string);
    return Boolean(mail && mail.processing_status === "processed" && mail.match_status !== "dsn_transport_review"
      && mail.company_id === row.company_id);
  });

  const attempts = await countResumeAttempts(intakeDone.map((row) => row.id));
  const eligible = intakeDone.filter((row) => (attempts.get(row.id) ?? 0) < maxAttempts).slice(0, limit);

  const claimed: ClaimedStrandedMessage[] = [];
  for (const row of eligible) {
    const progressed = progressedSet.has(row.id);
    const claim = await supabaseService
      .from("ediel_messages")
      .update({ updated_at: now.toISOString() })
      .eq("id", row.id)
      .eq("company_id", row.company_id as string)
      .eq("status", progressed ? String(row.status) : STRANDED_STATUS)
      .eq("processing_status", progressed ? String(row.processing_status) : STRANDED_STATUS)
      .eq("updated_at", row.updated_at as string)
      .select("id");
    if (claim.error) throw claim.error;
    if ((claim.data ?? []).length === 0) continue;
    claimed.push({ id: row.id, companyId: row.company_id as string, attempt: (attempts.get(row.id) ?? 0) + 1, maxAttempts, ...(progressed ? { progressed: true } : {}) });
  }
  return { candidates: intakeDone.length, claimed };
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

  for (const item of claimed) {
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

    const { data: after, error: afterError } = await supabaseService
      .from("ediel_messages")
      .select("id,status,processing_status")
      .eq("id", item.id)
      .eq("company_id", item.companyId)
      .maybeSingle();
    if (afterError) throw afterError;
    const row = after as { status?: string | null; processing_status?: string | null } | null;
    if (!row) {
      result.errors.push(`${item.id}: message not readable after resume`);
      continue;
    }
    // F-B1d: a progressed message keeps its status; a re-run that did not throw completed it.
    if (item.progressed && !failure) {
      result.resumed += 1;
      await createEdielMessageEvent({
        actorUserId: input.actorUserId, edielMessageId: item.id, eventType: "manual_note", eventStatus: "success",
        message: "Inbound-affärsbehandlingen återupptogs och slutfördes.",
        payload: { resume: STRANDED_INBOUND_RESUME_MARKER, kind: "completed", attempt: item.attempt, workerId: input.workerId },
      });
      continue;
    }
    if (!item.progressed && (row.status !== STRANDED_STATUS || row.processing_status !== STRANDED_STATUS)) {
      result.resumed += 1;
      continue;
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
  }
  return result;
}
