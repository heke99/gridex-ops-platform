import { randomUUID } from "node:crypto";

import { logAdminActionAndUsage } from "@/lib/audit/actionLogger";
import { contractLifecycleError } from "@/lib/contracts/lifecycleErrors";
import { getContractOfferById } from "@/lib/customer-contracts/db";
import type {
  ContractChannelReadiness,
  ContractOfferRow,
  ContractPublicationChannel,
} from "@/lib/customer-contracts/types";
import { createSupabaseServiceRequestClient } from "@/lib/supabase/service";

type RpcObject = Record<string, unknown>;

export type ContractChannelCommandResult = {
  ok: true;
  changed: boolean;
  channel: ContractPublicationChannel;
  offer: ContractOfferRow;
  readiness: ContractChannelReadiness;
  externalAccessReady: boolean;
  externalBlockers: ContractChannelReadiness["blockers"];
  rpc: RpcObject;
};

function requestClient() {
  const requestId = randomUUID();
  return createSupabaseServiceRequestClient({
    requestId,
    correlationId: requestId,
  });
}

async function auditChannelCommand(input: {
  action: string;
  label: string;
  companyId: string;
  offerId: string;
  actorUserId: string;
  channel: ContractPublicationChannel;
  values?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await logAdminActionAndUsage({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      entityType: "contract_offer",
      entityId: input.offerId,
      action: input.action,
      label: input.label,
      oldValues: null,
      newValues: input.values ?? null,
      source: "canonical_contract_channel_service",
      billable: false,
      metadata: { channel: input.channel },
    });
  } catch (auditError) {
    console.error("[contract-channel-audit] failed", {
      action: input.action,
      companyId: input.companyId,
      offerId: input.offerId,
      channel: input.channel,
      auditError,
    });
  }
}

function asObject(value: unknown, code: string): RpcObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as RpcObject;
}

function blockers(value: unknown): ContractChannelReadiness["blockers"] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const blocker = asObject(item, "invalid_contract_channel_blocker");
    return {
      code:
        typeof blocker.code === "string"
          ? blocker.code
          : "contract_channel_not_ready",
      message:
        typeof blocker.message === "string"
          ? blocker.message
          : "Avtalskanalen är inte redo.",
    };
  });
}

function channelAvailable(
  offer: ContractOfferRow,
  channel: ContractPublicationChannel,
): boolean {
  if (channel === "internal") return offer.internally_sellable_now;
  if (channel === "website") return offer.website_available_now;
  return offer.api_available_now;
}

function channelStatus(
  offer: ContractOfferRow,
  channel: ContractPublicationChannel,
): string {
  if (channel === "internal") return offer.internal_channel_status;
  if (channel === "website") return offer.website_channel_status;
  return offer.api_channel_status;
}

async function loadOffer(input: {
  companyId: string;
  offerId: string;
}): Promise<ContractOfferRow> {
  const offer = await getContractOfferById(input.offerId, input.companyId);
  if (!offer) throw new Error("contract_offer_not_found");
  if (!offer.assignment_id) {
    throw new Error("contract_assignment_not_found");
  }
  return offer;
}

export async function validateContractChannelReadiness(input: {
  companyId: string;
  assignmentId: string;
  channel: ContractPublicationChannel;
}): Promise<{
  readiness: ContractChannelReadiness;
  externalAccessReady: boolean;
  externalBlockers: ContractChannelReadiness["blockers"];
  raw: RpcObject;
}> {
  const { data, error } = await requestClient().rpc(
    "gridex_validate_contract_channel_readiness",
    {
      p_company_id: input.companyId,
      p_assignment_id: input.assignmentId,
      p_channel: input.channel,
    },
  );
  if (error) throw error;
  const raw = asObject(data, "invalid_contract_channel_readiness_result");
  return {
    readiness: {
      ready: raw.ready === true,
      blockers: blockers(raw.blockers),
    },
    externalAccessReady: raw.external_access_ready === true,
    externalBlockers: blockers(raw.external_blockers),
    raw,
  };
}

export async function setContractChannelPermission(input: {
  companyId: string;
  assignmentId: string;
  channel: ContractPublicationChannel;
  allowed: boolean;
  actorUserId: string;
  reason?: string | null;
}): Promise<RpcObject> {
  const { data, error } = await requestClient().rpc(
    "gridex_set_contract_channel_permission",
    {
      p_company_id: input.companyId,
      p_assignment_id: input.assignmentId,
      p_channel: input.channel,
      p_allowed: input.allowed,
      p_actor_user_id: input.actorUserId,
      p_reason: input.reason?.trim() || null,
    },
  );
  if (error) throw error;
  const result = asObject(data, "invalid_contract_channel_permission_result");
  if (result.ok !== true) {
    throw contractLifecycleError(
      result,
      "Kanalbehörigheten kunde inte ändras.",
    );
  }
  return result;
}

export async function publishContractChannel(input: {
  companyId: string;
  offerId: string;
  channel: ContractPublicationChannel;
  actorUserId: string;
}): Promise<ContractChannelCommandResult> {
  await auditChannelCommand({
    action: "contract_channel_publish_started",
    label: "Avtalspublicering startad",
    ...input,
  });
  try {
    await loadOffer(input);

    // The publish RPC is the canonical readiness gate and materializes the
    // permission, channel, publication and public-offer graph atomically.
    // A pre-publication state naturally lacks those rows, so validating the
    // already-materialized graph here made first publication impossible.
    const { data, error } = await requestClient().rpc(
      "gridex_publish_contract_channel",
      {
        p_company_id: input.companyId,
        p_offer_id: input.offerId,
        p_channel: input.channel,
        p_actor_user_id: input.actorUserId,
      },
    );
    if (error) throw error;
    const rpc = asObject(data, "invalid_contract_channel_publish_result");
    if (rpc.ok !== true) {
      throw contractLifecycleError(rpc, "Kanalen kunde inte publiceras.");
    }

    const offer = await loadOffer(input);
    if (channelStatus(offer, input.channel) !== "active") {
      throw new Error("contract_channel_post_commit_verification_failed");
    }
    if (input.channel !== "api" && !channelAvailable(offer, input.channel)) {
      throw new Error("contract_channel_availability_verification_failed");
    }

    const readiness =
      input.channel === "internal"
        ? offer.internal_readiness
        : input.channel === "website"
          ? offer.website_readiness
          : offer.api_readiness;

    return {
      ok: true,
      changed: rpc.changed !== false,
      channel: input.channel,
      offer,
      readiness,
      externalAccessReady:
        input.channel === "api"
          ? offer.api_available_now
          : channelAvailable(offer, input.channel),
      externalBlockers: readiness.blockers,
      rpc,
    };
  } catch (error) {
    await auditChannelCommand({
      action: "contract_channel_publish_failed",
      label: "Avtalspublicering misslyckades",
      ...input,
      values: {
        code:
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : null,
        message: error instanceof Error ? error.message : "unknown_error",
      },
    });
    throw error;
  }
}

export async function unpublishContractChannel(input: {
  companyId: string;
  offerId: string;
  channel: ContractPublicationChannel;
  actorUserId: string;
}): Promise<ContractChannelCommandResult> {
  const before = await loadOffer(input);
  const { data, error } = await requestClient().rpc(
    "gridex_unpublish_contract_channel",
    {
      p_company_id: input.companyId,
      p_offer_id: input.offerId,
      p_channel: input.channel,
      p_actor_user_id: input.actorUserId,
    },
  );
  if (error) throw error;
  const rpc = asObject(data, "invalid_contract_channel_unpublish_result");
  if (rpc.ok !== true) {
    throw contractLifecycleError(rpc, "Kanalen kunde inte avpubliceras.");
  }

  const offer = await loadOffer(input);
  if (
    channelStatus(offer, input.channel) === "active" ||
    channelAvailable(offer, input.channel)
  ) {
    throw new Error("contract_channel_unpublish_verification_failed");
  }
  const readiness =
    input.channel === "internal"
      ? before.internal_readiness
      : input.channel === "website"
        ? before.website_readiness
        : before.api_readiness;
  return {
    ok: true,
    changed: rpc.changed !== false,
    channel: input.channel,
    offer,
    readiness,
    externalAccessReady: false,
    externalBlockers: [],
    rpc,
  };
}
