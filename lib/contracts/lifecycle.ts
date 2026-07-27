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
  archived: new Set([]),
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

export const CONTRACT_LIFECYCLE_LABELS: Readonly<
  Record<ContractLifecycleStatus, string>
> = {
  draft: "Utkast",
  ready: "Redo",
  published: "Publicerat",
  paused: "Pausat",
  expired: "Utgånget",
  closed: "Stängt",
  archived: "Arkiverat",
  superseded: "Ersatt version",
};

export type ContractImmutableVersionStatus =
  | "draft"
  | "ready"
  | "published"
  | "superseded";

export type ContractChannelStatus = "scheduled" | "active" | "paused" | "ended";

export type ContractPublicationVersionStatus =
  | "draft"
  | "scheduled"
  | "published"
  | "paused"
  | "closed"
  | "superseded";

export const CONTRACT_IMMUTABLE_VERSION_TRANSITIONS = {
  draft: ["ready"],
  ready: ["draft", "published"],
  published: ["superseded"],
  superseded: [],
} as const satisfies Readonly<
  Record<ContractImmutableVersionStatus, readonly ContractImmutableVersionStatus[]>
>;

export const CONTRACT_CHANNEL_TRANSITIONS = {
  scheduled: ["active", "paused", "ended"],
  active: ["paused", "ended"],
  paused: ["active", "ended"],
  ended: [],
} as const satisfies Readonly<
  Record<ContractChannelStatus, readonly ContractChannelStatus[]>
>;

export const CONTRACT_PUBLICATION_VERSION_TRANSITIONS = {
  draft: ["scheduled", "published", "closed"],
  scheduled: ["published", "paused", "closed"],
  published: ["paused", "closed", "superseded"],
  paused: ["published", "closed", "superseded"],
  closed: [],
  superseded: [],
} as const satisfies Readonly<
  Record<
    ContractPublicationVersionStatus,
    readonly ContractPublicationVersionStatus[]
  >
>;

export const CONTRACT_TERMINAL_LIFECYCLE_STATUSES: ReadonlySet<ContractLifecycleStatus> =
  new Set(["archived"]);

export function isContractLifecycleTerminal(
  status: ContractLifecycleStatus | string | null | undefined,
): boolean {
  return Boolean(status) &&
    CONTRACT_TERMINAL_LIFECYCLE_STATUSES.has(status as ContractLifecycleStatus);
}

export function isContractSellable(input: {
  lifecycleStatus: ContractLifecycleStatus | string | null | undefined;
  channelStatus: ContractChannelStatus | string | null | undefined;
  currentlySellable?: boolean | null;
}): boolean {
  return (
    input.lifecycleStatus === "published" &&
    input.channelStatus === "active" &&
    input.currentlySellable === true
  );
}
