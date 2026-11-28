import type { Json } from "@/supabase/database.types"
import { supabaseService } from "@/lib/supabase/service"
import type { InboundLeaseReceipt } from "./edielMailboxPoller.part-1"

const maxUid = 0xffffffff;
const retryStateKey = "retries_v1";
export const IMAP_BUSINESS_RECEIPT_PENDING = "imap_scan_business_receipt_pending";

function jsonObject(value: Json | undefined): Record<string, Json | undefined> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

export type EdielImapRetry = {
  attempts: number;
  nextAttemptAt: string | null;
  reviewRequired: boolean;
  reason: string;
};

type Retries = Record<string, EdielImapRetry>;

function readRetries(value: Json | undefined): Retries {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("imap_scan_retry_state_invalid");
  const retries: Retries = {};
  for (const [uid, entry] of Object.entries(value)) {
    const retry = jsonObject(entry);
    const {attempts,nextAttemptAt,reviewRequired,reason}=retry;
    if (!/^[1-9][0-9]*$/.test(uid) || Number(uid)>maxUid || typeof attempts!=="number"
      || !Number.isSafeInteger(attempts) || attempts<1 || typeof reviewRequired!=="boolean"
      || typeof reason!=="string" || (reviewRequired ? nextAttemptAt!==null :
        typeof nextAttemptAt!=="string" || !Number.isFinite(Date.parse(nextAttemptAt)))) {
      throw new Error("imap_scan_retry_state_invalid");
    }
    retries[uid]={attempts,nextAttemptAt:typeof nextAttemptAt==="string"?nextAttemptAt:null,reviewRequired,reason};
  }
  return retries;
}

export function listEdielImapRetries(metadata: Json | undefined) {
  const state=jsonObject(jsonObject(metadata).ediel_imap_scan_v1);
  return Object.entries(jsonObject(state[retryStateKey])).flatMap(([scope,value])=>{
    const saved=jsonObject(state[scope]);
    if (!/^[a-f0-9]{64}$/.test(scope) || typeof saved.uidValidity !== "number"
      || !Number.isInteger(saved.uidValidity) || saved.uidValidity < 1 || saved.uidValidity > maxUid) return [];
    const uidValidity = saved.uidValidity;
    try {
      return Object.entries(readRetries(value)).map(([uid,retry])=>({scope,uidValidity,uid:Number(uid),...retry}));
    } catch {
      return [];
    }
  });
}

export function nextEdielImapRetry(current: EdielImapRetry | undefined, reason: string): EdielImapRetry {
  const waitingForBusiness = reason === IMAP_BUSINESS_RECEIPT_PENDING;
  const previousAttempts = current && (current.reason === IMAP_BUSINESS_RECEIPT_PENDING) === waitingForBusiness
    ? current.attempts : 0;
  const attempts = previousAttempts + 1;
  // A full E66 can span many scheduler leases. A pending result check uses a
  // separate bounded budget and only asks for review after a day of backoff.
  const maxAttempts = waitingForBusiness ? 28 : 5;
  const reviewRequired=attempts>=maxAttempts || reason==="imap_scan_retry_source_absent" || reason==="imap_transport_identity_bytes_conflict";
  return {
    attempts,reviewRequired,reason,
    nextAttemptAt:reviewRequired?null:new Date(Date.now()+Math.min(60,5*2**(attempts-1))*60_000).toISOString(),
  };
}

/** Native local quarantine read; it never authorizes an IMAP STORE. */
export async function readHeldTechnicalE66ImapUids(input: {
  claim: InboundLeaseReceipt;
  accountScope: string;
  folder: string;
  uidValidity: number;
  uids: readonly number[];
}) {
  const unique = [...new Set(input.uids)];
  const held = new Set<number>();
  const batchSize = 256;
  for (let offset = 0; offset < unique.length; offset += batchSize) {
    const batch = unique.slice(offset, offset + batchSize);
    const { data, error } = await supabaseService.rpc("gridex_list_held_e66_technical_imap_uids_v1", {
      p_mailbox: input.claim.id,
      p_worker: input.claim.locked_by,
      p_claimed_at: input.claim.locked_at,
      p_scope: input.accountScope,
      p_folder: input.folder,
      p_validity: input.uidValidity,
      p_uids: batch,
    });
    if (error || !Array.isArray(data)) throw new Error("imap_technical_hold_read_unavailable");
    const requested = new Set(batch);
    for (const uid of data) {
      if (typeof uid !== "number" || !requested.has(uid) || held.has(uid)) {
        throw new Error("imap_technical_hold_receipt_invalid");
      }
      held.add(uid);
    }
  }
  return held;
}

export async function openEdielImapScan(input: {
  claim: InboundLeaseReceipt;
  scope: string;
  uidValidity: number;
  uidNext: number | undefined;
  startAtZero?: boolean;
  requireExisting?: boolean;
}) {
  const uidNext = input.uidNext;
  if (typeof uidNext !== "number" || !Number.isInteger(uidNext) || uidNext < 1 || uidNext > maxUid + 1) {
    throw new Error("imap_scan_uidnext_missing");
  }
  const upperUid = uidNext - 1;
  const {data, error} = await supabaseService.from("ediel_mailboxes").select("metadata")
    .eq("id",input.claim.id).eq("locked_by",input.claim.locked_by).eq("locked_at",input.claim.locked_at)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("imap_scan_claim_lost");
  let expected = data.metadata;
  const savedState=jsonObject(expected).ediel_imap_scan_v1;
  if (savedState !== undefined && (!savedState || typeof savedState !== "object" || Array.isArray(savedState))) {
    throw new Error("imap_scan_checkpoint_invalid");
  }
  const existingState=jsonObject(savedState);
  const priorScope=existingState[input.scope];
  const previous=jsonObject(priorScope);
  if (priorScope !== undefined && previous.uidValidity !== input.uidValidity) {
    throw new Error("imap_scan_checkpoint_invalid");
  }
  const cursor = previous.uidValidity === input.uidValidity ? previous.lastUid : undefined;
  if (previous.uidValidity === input.uidValidity
    && (typeof cursor !== "number" || !Number.isInteger(cursor) || cursor < 0 || cursor > upperUid)) {
    throw new Error("imap_scan_checkpoint_outside_epoch");
  }
  if (input.requireExisting && cursor === undefined) throw new Error("imap_scan_retry_scope_not_found");
  let lastUid = typeof cursor === "number" ? cursor : input.startAtZero ? 0 : upperUid;

  const savedRetryScopes = existingState[retryStateKey];
  if (savedRetryScopes !== undefined
    && (!savedRetryScopes || typeof savedRetryScopes !== "object" || Array.isArray(savedRetryScopes))) {
    throw new Error("imap_scan_retry_state_invalid");
  }
  const existingRetryScopes = jsonObject(savedRetryScopes);
  let retries = readRetries(existingRetryScopes[input.scope]);
  if (Object.keys(retries).some(uid => Number(uid) > upperUid)) throw new Error("imap_scan_retry_outside_epoch");

  async function persist(nextUid: number, nextRetries: Retries = retries) {
    const nextState: Record<string, Json | undefined> = {
      ...existingState, [input.scope]: { uidValidity: input.uidValidity, lastUid: nextUid },
    };
    // Older checkpoint writers replace the cursor object but preserve sibling keys.
    // Keep retries in a separate scope map within the same atomic checkpoint.
    const nextRetryScopes = { ...existingRetryScopes };
    if (Object.keys(nextRetries).length > 0) nextRetryScopes[input.scope] = { ...nextRetries };
    else delete nextRetryScopes[input.scope];
    if (Object.keys(nextRetryScopes).length > 0) nextState[retryStateKey] = nextRetryScopes;
    else delete nextState[retryStateKey];
    const {data: saved,error: fault}=await supabaseService.rpc("gridex_checkpoint_ediel_imap_scan_v1",{
      p_mailbox_id: input.claim.id, p_locked_by: input.claim.locked_by, p_locked_at: input.claim.locked_at,
      p_expected_metadata: expected, p_scan: nextState,
    });
    if (fault) throw fault;
    if (saved !== true) throw new Error("imap_scan_claim_or_metadata_changed");
    expected={...jsonObject(expected),ediel_imap_scan_v1:nextState};
    lastUid=nextUid;
    retries=nextRetries;
  }

  // Persist the SELECT boundary before handling any mail or changing a Seen flag.
  // Historic Seen mail stays eligible for the explicit, bounded manual reread.
  if (cursor === undefined) await persist(lastUid);
  return { upperUid, get lastUid() { return lastUid; }, get retries() { return retries; }, advance: persist };
}
