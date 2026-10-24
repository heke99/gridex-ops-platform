import { supabaseService } from "@/lib/supabase/service";

export type RecoveryOutcome = "completed" | "no_effect" | "ambiguous";
export type RecoveryClaim = { companyId: string; recovery: { workId: string; token: string; leaseUntil: string; deadline: number }; attempt: number; maxAttempts: number };
type Row = Record<string, unknown>;
type Rpc = (name: string, args: Row) => { abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }> };
const MAX_ROWS = 200;
const MAX_TARGETS = 50;
const RPC_MS = 5_000;
const TOTAL_MS = 45_000;
const CLEANUP_MS = 5_000;
const rpc = supabaseService.rpc.bind(supabaseService) as unknown as Rpc;
function object(v: unknown): Row { if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("ediel_recovery_response_invalid"); return v as Row; }
function integer(v: number | undefined, fallback: number, min: number, max: number) { return Math.max(min, Math.min(max, Number.isFinite(v) ? Math.floor(v!) : fallback)); }
async function call(name: string, args: Row, deadline: number): Promise<Row> {
  const remaining = Math.min(RPC_MS, deadline - performance.now());
  if (remaining <= 0) throw new Error("ediel_recovery_deadline");
  const { data, error } = await rpc(name, args).abortSignal(AbortSignal.timeout(Math.max(1, Math.floor(remaining))));
  if (error) throw error;
  return object(data);
}
export async function claimRecoveryWork<T extends RecoveryClaim>(kind: "stranded" | "technical" | "runtime" | "held", options: {
  environment: "test" | "production"; companyId?: string | null; excludeIds?: readonly string[];
  limit?: number; replyLimit?: number; graceMinutes?: number; lookbackHours?: number; maxAttempts?: number;
}): Promise<{ candidates: number; claimedSources: number; claimed: T[] }> {
  const deadline = performance.now() + TOTAL_MS;
  if ((options.excludeIds?.length ?? 0) > 500) throw new Error("ediel_recovery_excludes_exceeded");
  const common = { p_kind: kind, p_environment: options.environment, p_company: options.companyId ?? null };
  const grace = integer(options.graceMinutes, 10, 2, 1440) * 60;
  await call("ediel_recovery_discover_v1", { ...common, p_page: MAX_ROWS, p_grace_seconds: grace,
    p_lookback_hours: integer(options.lookbackHours, kind === "held" ? 1080 : kind === "stranded" ? 168 : 72, 1, kind === "held" ? 8760 : kind === "stranded" ? 2160 : 720),
    p_max_attempts: integer(options.maxAttempts, kind === "held" ? 6 : 3, 1, kind === "held" ? 20 : 10) }, deadline);
  const data = await call("ediel_recovery_lease_v1", { ...common, p_exclude: options.excludeIds ?? [],
    p_source_limit: integer(options.limit, 10, 1, 50), p_target_limit: integer(kind === "runtime" ? options.replyLimit : options.limit, kind === "runtime" ? 50 : 10, 1, MAX_TARGETS),
    p_grace_seconds: grace }, deadline);
  if (!Array.isArray(data.claimed) || data.claimed.length > MAX_TARGETS) throw new Error("ediel_recovery_response_invalid");
  const claimed = data.claimed.map(value => {
    const target = object(value); const recovery = object(target.recovery);
    if (typeof target.companyId !== "string" || typeof recovery.workId !== "string" || typeof recovery.token !== "string" || typeof recovery.leaseUntil !== "string"
      || !Number.isInteger(target.attempt) || !Number.isInteger(target.maxAttempts)) throw new Error("ediel_recovery_response_invalid");
    return { ...target, recovery: { ...recovery, deadline } } as T;
  });
  return { candidates: Number(data.candidates), claimedSources: Number(data.claimedSources), claimed };
}
async function transition(target: RecoveryClaim, operation: "start" | "finish" | "uncertain" | "release", deadline: number, error?: string) {
  return call("ediel_recovery_transition_v1", { p_work: target.recovery.workId, p_token: target.recovery.token, p_operation: operation, p_error: error?.slice(0, 1000) ?? null }, deadline);
}
/** A timed-out callback continues under an UNCERTAIN source reservation; expiry never authorizes another callback. */
export async function runRecoveryBatch<T extends RecoveryClaim>(targets: readonly T[], action: (target: T) => Promise<RecoveryOutcome>, errors: string[]): Promise<void> {
  if (targets.length > MAX_TARGETS) throw new Error("ediel_recovery_targets_exceeded");
  let index = 0;
  try {
    for (; index < targets.length; index += 1) {
      const target = targets[index];
      if (target.recovery.deadline - performance.now() <= RPC_MS) break;
      // A START timeout is ambiguous: never release this token as unstarted.
      let started = false;
      let releaseLateReceipt: () => void = () => undefined;
      const lateReceiptReady = new Promise<void>(resolve => { releaseLateReceipt = resolve; });
      try {
        const state = await transition(target, "start", target.recovery.deadline);
        target.attempt = Number(state.attempt); target.maxAttempts = Number(state.maxAttempts); started = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const execution = action(target);
          const record = async (outcome: RecoveryOutcome, expectedState: "running" | "uncertain") => {
            if (outcome === "ambiguous") throw new Error("ediel_recovery_owner_outcome_ambiguous");
            const companyId = target.companyId;
            if (!companyId) throw new Error("ediel_recovery_terminal_company_missing");
            await call("ediel_recovery_record_terminal_v1", {p_work: target.recovery.workId, p_token: target.recovery.token,
              p_company: companyId, p_expected_state: expectedState, p_outcome: outcome}, expectedState === "uncertain" ? performance.now() + CLEANUP_MS : target.recovery.deadline + 2 * CLEANUP_MS);
          };
          let timedOut = false;
          // A late successful owner completion may leave durable proof for a
          // later qualified reconciliation. No rejected/unknown call emits it.
          void execution.then(async outcome => {
            if (timedOut) { await lateReceiptReady; await record(outcome, "uncertain"); }
          }).catch(() => undefined);
          const outcome = await Promise.race([execution, new Promise<never>((_, reject) => {
            timer = setTimeout(() => { timedOut = true; reject(new Error("ediel_recovery_action_deadline")); }, Math.max(1, target.recovery.deadline - performance.now()));
          })]);
          await record(outcome, "running");
        } finally { if (timer) clearTimeout(timer); }
        await transition(target, "finish", target.recovery.deadline + 2 * CLEANUP_MS);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`recovery ${target.recovery.workId}: ${message}`);
        // Unknown START outcome and any action/finish failure preserve the token.
        // If START never committed, this transition fails and normal unstarted lease expiry is safe.
        await transition(target, "uncertain", target.recovery.deadline + 2 * CLEANUP_MS, message).catch(() => undefined).finally(releaseLateReceipt);
        if (started || performance.now() >= target.recovery.deadline) { index += 1; break; }
      }
    }
  } finally {
    const cleanupDeadline = Math.min(...targets.map(target => target.recovery.deadline)) + 2 * CLEANUP_MS;
    for (; index < targets.length && performance.now() < cleanupDeadline; index += 1) {
      await transition(targets[index], "release", cleanupDeadline).catch(() => undefined);
    }
  }
}

/** Release only a lease whose owner action has never STARTed. */
export async function releaseRecoveryWork(target: RecoveryClaim): Promise<void> { await transition(target, "release", target.recovery.deadline + CLEANUP_MS); }
