import { randomUUID } from "node:crypto";

import {
  lifecycleStatusesForContractAdminView,
  type ContractAdminListResult,
  type ContractAdminView,
  type ContractDeletePreview,
} from "@/lib/contracts/adminDto";
import {
  getContractOfferById,
  listContractOffers,
} from "@/lib/customer-contracts/db";
import type { ContractOfferRow } from "@/lib/customer-contracts/types";
import { createSupabaseServiceRequestClient, supabaseService } from "@/lib/supabase/service";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function listTenantContractProducts(input: {
  companyId: string;
  view?: ContractAdminView;
  page?: number;
  pageSize?: number;
}): Promise<ContractAdminListResult> {
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(input.pageSize ?? 25)));
  const lifecycleStatuses = lifecycleStatusesForContractAdminView(
    input.view ?? "active",
  );
  const rows = await listContractOffers({
    companyId: input.companyId,
    includeArchived: input.view === "all" || input.view === "archived",
    lifecycleStatuses,
    limit: pageSize + 1,
    offset: (page - 1) * pageSize,
  });
  const hasNext = rows.length > pageSize;
  const visibleRows = rows.slice(0, pageSize);
  return {
    ok: true,
    rows: visibleRows,
    page,
    pageSize,
    // This repository intentionally avoids a second count query. The value is
    // exact for completed pages and a lower bound when a following page exists.
    totalCount: (page - 1) * pageSize + visibleRows.length + (hasNext ? 1 : 0),
    hasPrevious: page > 1,
    hasNext,
  };
}

export async function getTenantContractProduct(input: {
  companyId: string;
  offerId: string;
}): Promise<ContractOfferRow | null> {
  return getContractOfferById(input.offerId, input.companyId);
}

export async function getContractReadiness(input: {
  companyId: string;
  offerId: string;
  operation: "publish_version" | "activate_channel" | "archive" | "delete";
  channel?: "website" | "api" | "internal" | null;
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseService.rpc(
    "gridex_validate_contract_readiness_v2",
    {
      p_company_id: input.companyId,
      p_contract_offer_id: input.offerId,
      p_operation: input.operation,
      p_channel: input.channel ?? null,
    },
  );
  if (error) throw error;
  return asRecord(data) ?? {
    ok: false,
    code: "invalid_contract_readiness_result",
    blockers: [],
  };
}

export async function previewContractDelete(input: {
  companyId: string;
  offerId: string;
  actorUserId: string;
  requestId?: string;
  correlationId?: string;
}): Promise<ContractDeletePreview> {
  const requestId = input.requestId ?? randomUUID();
  const client = createSupabaseServiceRequestClient({
    requestId,
    correlationId: input.correlationId ?? requestId,
  });
  const { data, error } = await client.rpc(
    "gridex_preview_delete_unused_contract_v2",
    {
      p_company_id: input.companyId,
      p_offer_id: input.offerId,
      p_actor_user_id: input.actorUserId,
    },
  );
  if (error) throw error;
  return (asRecord(data) ?? {
    ok: false,
    code: "invalid_contract_delete_preview",
    can_delete: false,
    blockers: [],
  }) as ContractDeletePreview;
}
