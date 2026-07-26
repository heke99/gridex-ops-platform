import type { ContractLifecycleStatus } from "@/lib/customer-contracts/types";

export type ContractLifecycleAction =
  | "edit_draft"
  | "create_version"
  | "publish_version"
  | "activate_channel"
  | "pause_channels"
  | "close"
  | "archive"
  | "delete_unused";

const ACTIONS_BY_STATUS: Readonly<
  Record<ContractLifecycleStatus, ReadonlySet<ContractLifecycleAction>>
> = {
  draft: new Set(["edit_draft", "publish_version", "close", "archive", "delete_unused"]),
  ready: new Set(["edit_draft", "publish_version", "close", "archive", "delete_unused"]),
  published: new Set(["create_version", "activate_channel", "pause_channels", "close"]),
  paused: new Set(["create_version", "publish_version", "activate_channel", "pause_channels", "close", "archive"]),
  expired: new Set(["create_version", "archive"]),
  closed: new Set(["archive"]),
  archived: new Set(["create_version"]),
  superseded: new Set(["create_version", "archive"]),
};

export function contractLifecycleAllows(
  status: ContractLifecycleStatus | string | null | undefined,
  action: ContractLifecycleAction,
): boolean {
  if (!status || !(status in ACTIONS_BY_STATUS)) return false;
  return ACTIONS_BY_STATUS[status as ContractLifecycleStatus].has(action);
}

export const CONTRACT_LIFECYCLE_TRANSITIONS = {
  draft: ["ready", "published", "closed", "archived", "deleted"],
  ready: ["draft", "published", "closed", "archived", "deleted"],
  published: ["paused", "closed"],
  paused: ["published", "closed", "archived"],
  expired: ["archived"],
  closed: ["archived"],
  archived: [],
  superseded: ["archived"],
} as const satisfies Readonly<Record<ContractLifecycleStatus, readonly string[]>>;
