import type {
  ContractLifecycleStatus,
  ContractOfferRow,
} from "@/lib/customer-contracts/types";

export type ContractAdminView =
  | "active"
  | "draft"
  | "paused"
  | "closed"
  | "archived"
  | "all";

export const CONTRACT_ADMIN_VIEW_LABELS: Readonly<
  Record<ContractAdminView, string>
> = {
  active: "Aktiva",
  draft: "Utkast",
  paused: "Pausade",
  closed: "Stängda",
  archived: "Arkiverade",
  all: "Alla",
};

export const CONTRACT_ADMIN_VIEW_STATUSES: Readonly<
  Record<Exclude<ContractAdminView, "all">, readonly ContractLifecycleStatus[]>
> = {
  active: ["published"],
  draft: ["draft", "ready"],
  paused: ["paused"],
  closed: ["expired", "closed", "superseded"],
  archived: ["archived"],
};

export function parseContractAdminView(
  value: string | null | undefined,
): ContractAdminView {
  return value && value in CONTRACT_ADMIN_VIEW_LABELS
    ? (value as ContractAdminView)
    : "active";
}

export function lifecycleStatusesForContractAdminView(
  view: ContractAdminView,
): ContractLifecycleStatus[] | undefined {
  return view === "all" ? undefined : [...CONTRACT_ADMIN_VIEW_STATUSES[view]];
}

export type ContractDeleteBlocker = {
  resource_type?: string | null;
  resource_id?: string | null;
  count?: number | null;
  reason?: string | null;
  classification?:
    | "deletable_internal_dependency"
    | "business_history_blocker"
    | "regulatory_retention_blocker"
    | "repairable_broken_relation"
    | string;
  recommended_action?: string | null;
  message?: string | null;
};

export type ContractDeletePreview = {
  ok?: boolean;
  code?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  contract_offer_id?: string | null;
  contract_product_id?: string | null;
  product_name?: string | null;
  preview_token?: string | null;
  can_delete?: boolean;
  deletable?: boolean;
  has_business_usage?: boolean;
  requires_archive?: boolean;
  requires_unpublish?: boolean;
  recommended_action?: string | null;
  reason_codes?: string[];
  lifecycle_status?: string | null;
  blockers?: ContractDeleteBlocker[];
  removable_system_dependencies?: Record<string, number>;
  dependency_classification?: Record<string, unknown>;
};

export type ContractAdminListResult = {
  ok: true;
  rows: ContractOfferRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  hasPrevious: boolean;
  hasNext: boolean;
};
