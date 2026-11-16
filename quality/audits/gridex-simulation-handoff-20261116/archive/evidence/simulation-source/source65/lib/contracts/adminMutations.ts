import { randomUUID } from "node:crypto";

import type { ContractLifecycleRpcResult } from "@/lib/contracts/lifecycleErrors";
import { createSupabaseServiceRequestClient } from "@/lib/supabase/service";

function mutationClient() {
  const requestId = randomUUID();
  return {
    requestId,
    client: createSupabaseServiceRequestClient({
      requestId,
      correlationId: requestId,
    }),
  };
}

export async function deleteContractProduct(input: {
  companyId: string;
  offerId: string;
  actorUserId: string;
  expectedPreviewToken?: string | null;
}): Promise<ContractLifecycleRpcResult> {
  const { client } = mutationClient();
  const { data, error } = await client.rpc(
    "gridex_remove_internal_contract_offer_v2",
    {
      p_company_id: input.companyId,
      p_offer_id: input.offerId,
      p_mode: "safe_delete",
      p_actor_user_id: input.actorUserId,
      p_expected_preview_token: input.expectedPreviewToken ?? null,
    },
  );
  if (error) throw error;
  return (data ?? {
    ok: false,
    code: "invalid_contract_delete_result",
    blockers: [],
  }) as ContractLifecycleRpcResult;
}

export async function archiveContractProduct(input: {
  companyId: string;
  offerId: string;
  actorUserId: string;
}): Promise<ContractLifecycleRpcResult> {
  const { client } = mutationClient();
  const { data, error } = await client.rpc(
    "gridex_remove_internal_contract_offer_v2",
    {
      p_company_id: input.companyId,
      p_offer_id: input.offerId,
      p_mode: "archive",
      p_actor_user_id: input.actorUserId,
      p_expected_preview_token: null,
    },
  );
  if (error) throw error;
  return (data ?? {
    ok: false,
    code: "invalid_contract_archive_result",
    blockers: [],
  }) as ContractLifecycleRpcResult;
}
