import { supabaseService } from "@/lib/supabase/service";
import type {
  RouteDecisionIssue,
  RouteDecisionTraceEntry,
} from "@/lib/routes/routeDecisionTypes";

type ResolverInput = {
  companyId?: string | null;
  environment?: string | null;
  businessProcess: string;
  messageFamily?: string | null;
  messageCode?: string | null;
  gridOwnerId?: string | null;
  siteId?: string | null;
  meteringPointId?: string | null;
  supplierSwitchRequestId?: string | null;
  dataRequestId?: string | null;
  outboundRequestId?: string | null;
  inboundMessageId?: string | null;
};

type GridOwnerRow = {
  id: string;
  name: string | null;
  ediel_id: string | null;
  is_active: boolean | null;
  lifecycle_status?: string | null;
  default_prodat_subaddress?: string | null;
  default_utilts_subaddress?: string | null;
  communication_email?: string | null;
  email?: string | null;
  environment?: string | null;
};

type ReceiverResolutionStatus =
  | "resolved"
  | "not_required"
  | "missing"
  | "ambiguous"
  | "blocked";

export type DynamicReceiverResolution = {
  status: ReceiverResolutionStatus;
  receiverSource: string;
  dynamicReceiverStrategy: string | null;
  receiverEdielId: string | null;
  receiverSubAddress: string | null;
  receiverName: string | null;
  receiverEmail: string | null;
  gridOwnerId: string | null;
  counterpartyId: string | null;
  issues: RouteDecisionIssue[];
  warnings: RouteDecisionIssue[];
  trace: RouteDecisionTraceEntry[];
};

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function upper(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function isProduction(environment: unknown): boolean {
  return (
    String(environment ?? "")
      .trim()
      .toLowerCase() === "production"
  );
}

function issue(
  code: string,
  message: string,
  source: string,
  metadata?: Record<string, unknown>,
): RouteDecisionIssue {
  return { code, message, severity: "blocking", source, metadata };
}

function warning(
  code: string,
  message: string,
  source: string,
  metadata?: Record<string, unknown>,
): RouteDecisionIssue {
  return { code, message, severity: "warning", source, metadata };
}

function trace(
  step: string,
  status: RouteDecisionTraceEntry["status"],
  message: string,
  metadata?: Record<string, unknown>,
): RouteDecisionTraceEntry {
  return { step, status, message, metadata };
}

function requiresSelectedGridOwner(input: ResolverInput): boolean {
  const process = String(input.businessProcess ?? "").toLowerCase();
  const family = upper(input.messageFamily);
  const code = upper(input.messageCode);

  if (
    [
      "supplier_switch",
      "metering_access",
      "meter_values",
      "customer_masterdata",
      "billing_underlay",
    ].includes(process)
  ) {
    return true;
  }

  if (
    family === "PRODAT" &&
    [
      "Z01",
      "Z03",
      "Z04",
      "Z05",
      "Z06",
      "Z10",
      "Z13",
      "Z14",
      "Z15",
      "Z18",
    ].includes(code)
  ) {
    return true;
  }

  if (family === "UTILTS") return true;
  return false;
}

function subAddressForMessage(
  owner: GridOwnerRow,
  messageFamily?: string | null,
): string | null {
  const family = upper(messageFamily);
  if (family === "UTILTS") return clean(owner.default_utilts_subaddress);
  return clean(owner.default_prodat_subaddress);
}

async function resolveGridOwnerIdFromContext(input: ResolverInput): Promise<{
  gridOwnerId: string | null;
  source: string;
  ambiguous: boolean;
  trace: RouteDecisionTraceEntry[];
}> {
  const entries: RouteDecisionTraceEntry[] = [];

  if (input.gridOwnerId) {
    return {
      gridOwnerId: input.gridOwnerId,
      source: "selected_grid_owner_id",
      ambiguous: false,
      trace: [
        trace(
          "dynamic_receiver_context",
          "success",
          "Vald nätägare fanns direkt på route-input.",
          { gridOwnerId: input.gridOwnerId },
        ),
      ],
    };
  }

  if (input.meteringPointId) {
    const { data, error } = await supabaseService
      .from("metering_points")
      .select("id,company_id,site_id,grid_owner_id")
      .eq("id", input.meteringPointId)
      .maybeSingle();
    if (error) throw error;
    const row = data as {
      id: string;
      company_id: string | null;
      site_id: string | null;
      grid_owner_id: string | null;
    } | null;
    if (row?.grid_owner_id) {
      return {
        gridOwnerId: row.grid_owner_id,
        source: "selected_metering_point_grid_owner",
        ambiguous: false,
        trace: [
          trace(
            "dynamic_receiver_context",
            "success",
            "Vald nätägare hämtades från mätpunkten.",
            {
              meteringPointId: input.meteringPointId,
              gridOwnerId: row.grid_owner_id,
            },
          ),
        ],
      };
    }
    entries.push(
      trace(
        "dynamic_receiver_context",
        "warning",
        "Mätpunkten saknar vald nätägare.",
        { meteringPointId: input.meteringPointId },
      ),
    );
  }

  if (input.siteId) {
    const [siteResult, pointsResult] = await Promise.all([
      supabaseService
        .from("customer_sites")
        .select("id,company_id,grid_owner_id")
        .eq("id", input.siteId)
        .maybeSingle(),
      supabaseService
        .from("metering_points")
        .select("id,grid_owner_id")
        .eq("site_id", input.siteId),
    ]);
    if (siteResult.error) throw siteResult.error;
    if (pointsResult.error) throw pointsResult.error;

    const site = siteResult.data as {
      id: string;
      company_id: string | null;
      grid_owner_id: string | null;
    } | null;
    if (site?.grid_owner_id) {
      return {
        gridOwnerId: site.grid_owner_id,
        source: "selected_customer_site_grid_owner",
        ambiguous: false,
        trace: [
          trace(
            "dynamic_receiver_context",
            "success",
            "Vald nätägare hämtades från anläggningen.",
            { siteId: input.siteId, gridOwnerId: site.grid_owner_id },
          ),
        ],
      };
    }

    const pointOwners = Array.from(
      new Set(
        ((pointsResult.data ?? []) as Array<{ grid_owner_id: string | null }>)
          .map((row) => row.grid_owner_id)
          .filter(Boolean),
      ),
    ) as string[];
    if (pointOwners.length === 1) {
      return {
        gridOwnerId: pointOwners[0],
        source: "selected_customer_site_metering_point_grid_owner",
        ambiguous: false,
        trace: [
          trace(
            "dynamic_receiver_context",
            "success",
            "Vald nätägare hämtades från anläggningens mätpunkt.",
            { siteId: input.siteId, gridOwnerId: pointOwners[0] },
          ),
        ],
      };
    }
    if (pointOwners.length > 1) {
      return {
        gridOwnerId: null,
        source: "selected_customer_site_grid_owner",
        ambiguous: true,
        trace: [
          trace(
            "dynamic_receiver_context",
            "blocked",
            "Flera valda nätägare hittades på anläggningens mätpunkter.",
            { siteId: input.siteId, gridOwnerIds: pointOwners },
          ),
        ],
      };
    }
    entries.push(
      trace(
        "dynamic_receiver_context",
        "warning",
        "Anläggningen saknar vald nätägare.",
        { siteId: input.siteId },
      ),
    );
  }

  if (input.supplierSwitchRequestId) {
    const { data, error } = await supabaseService
      .from("supplier_switch_requests")
      .select("id,company_id,grid_owner_id,metering_point_id,site_id")
      .eq("id", input.supplierSwitchRequestId)
      .maybeSingle();
    if (error) throw error;
    const row = data as {
      id: string;
      grid_owner_id: string | null;
      metering_point_id?: string | null;
      site_id?: string | null;
    } | null;
    if (row?.grid_owner_id) {
      return {
        gridOwnerId: row.grid_owner_id,
        source: "selected_supplier_switch_grid_owner",
        ambiguous: false,
        trace: [
          trace(
            "dynamic_receiver_context",
            "success",
            "Vald nätägare hämtades från leverantörsbytesärendet.",
            {
              supplierSwitchRequestId: input.supplierSwitchRequestId,
              gridOwnerId: row.grid_owner_id,
            },
          ),
        ],
      };
    }
  }

  if (input.outboundRequestId) {
    const { data, error } = await supabaseService
      .from("outbound_requests")
      .select("id,company_id,grid_owner_id,metering_point_id,site_id,customer_site_id,supplier_switch_request_id,source_type,source_id")
      .eq("id", input.outboundRequestId)
      .maybeSingle();
    if (error) throw error;
    const row = data as {
      id: string;
      grid_owner_id: string | null;
      metering_point_id?: string | null;
      site_id?: string | null;
      customer_site_id?: string | null;
      supplier_switch_request_id?: string | null;
      source_type?: string | null;
      source_id?: string | null;
    } | null;
    if (row?.grid_owner_id) {
      return {
        gridOwnerId: row.grid_owner_id,
        source: "selected_outbound_request_grid_owner",
        ambiguous: false,
        trace: [
          trace(
            "dynamic_receiver_context",
            "success",
            "Vald nätägare hämtades från outbound-begäran.",
            {
              outboundRequestId: input.outboundRequestId,
              gridOwnerId: row.grid_owner_id,
            },
          ),
        ],
      };
    }

    if (row?.metering_point_id) {
      return resolveGridOwnerIdFromContext({
        ...input,
        outboundRequestId: null,
        meteringPointId: row.metering_point_id,
      });
    }

    if (row?.customer_site_id ?? row?.site_id) {
      return resolveGridOwnerIdFromContext({
        ...input,
        outboundRequestId: null,
        siteId: row.customer_site_id ?? row.site_id ?? null,
      });
    }

    if (row?.supplier_switch_request_id) {
      return resolveGridOwnerIdFromContext({
        ...input,
        outboundRequestId: null,
        supplierSwitchRequestId: row.supplier_switch_request_id,
      });
    }

    entries.push(
      trace(
        "dynamic_receiver_context",
        "warning",
        "Outbound-begäran saknar vald nätägare och kunde inte peka ut mätpunkt/anläggning.",
        { outboundRequestId: input.outboundRequestId },
      ),
    );
  }

  if (input.dataRequestId) {
    const { data, error } = await supabaseService
      .from("grid_owner_data_requests")
      .select("id,company_id,grid_owner_id,metering_point_id,site_id")
      .eq("id", input.dataRequestId)
      .maybeSingle();
    if (error) throw error;
    const row = data as {
      id: string;
      grid_owner_id: string | null;
      metering_point_id?: string | null;
      site_id?: string | null;
    } | null;
    if (row?.grid_owner_id) {
      return {
        gridOwnerId: row.grid_owner_id,
        source: "selected_data_request_grid_owner",
        ambiguous: false,
        trace: [
          trace(
            "dynamic_receiver_context",
            "success",
            "Vald nätägare hämtades från data-/uppgiftsbegäran.",
            {
              dataRequestId: input.dataRequestId,
              gridOwnerId: row.grid_owner_id,
            },
          ),
        ],
      };
    }
  }

  return {
    gridOwnerId: null,
    source: "selected_grid_owner_missing",
    ambiguous: false,
    trace: entries,
  };
}

async function getGridOwner(gridOwnerId: string): Promise<GridOwnerRow | null> {
  const { data, error } = await supabaseService
    .from("grid_owners")
    .select(
      "id,name,ediel_id,is_active,lifecycle_status,default_prodat_subaddress,default_utilts_subaddress,communication_email,email,environment",
    )
    .eq("id", gridOwnerId)
    .maybeSingle();
  if (error) throw error;
  return (data as GridOwnerRow | null) ?? null;
}

export async function resolveDynamicReceiver(
  input: ResolverInput,
): Promise<DynamicReceiverResolution> {
  const base: DynamicReceiverResolution = {
    status: "not_required",
    receiverSource: "not_required",
    dynamicReceiverStrategy: null,
    receiverEdielId: null,
    receiverSubAddress: null,
    receiverName: null,
    receiverEmail: null,
    gridOwnerId: null,
    counterpartyId: null,
    issues: [],
    warnings: [],
    trace: [],
  };

  if (!requiresSelectedGridOwner(input)) {
    return {
      ...base,
      trace: [
        trace(
          "dynamic_receiver_requirement",
          "info",
          "Processen kräver inte vald nätägare som dynamisk mottagare.",
        ),
      ],
    };
  }

  const context = await resolveGridOwnerIdFromContext(input);
  const dynamicReceiverStrategy = context.source;
  const receiverSource =
    context.source === "selected_grid_owner_id"
      ? "selected_metering_point_grid_owner"
      : context.source;

  if (context.ambiguous) {
    return {
      ...base,
      status: "ambiguous",
      receiverSource,
      dynamicReceiverStrategy,
      issues: [
        issue(
          "multiple_possible_grid_owners",
          "Flera möjliga valda nätägare hittades. Välj mätpunkt eller nätägare manuellt innan Ediel skickas.",
          "dynamic_receiver_resolver",
        ),
      ],
      trace: context.trace,
    };
  }

  if (!context.gridOwnerId) {
    return {
      ...base,
      status: "missing",
      receiverSource,
      dynamicReceiverStrategy,
      issues: [
        issue(
          "missing_selected_grid_owner",
          "Nätägare är inte vald. Välj nätägare på kund/anläggning/mätpunkt innan Ediel skickas.",
          "dynamic_receiver_resolver",
        ),
      ],
      trace:
        context.trace.length > 0
          ? context.trace
          : [
              trace(
                "dynamic_receiver_resolver",
                "blocked",
                "Ingen vald nätägare kunde hämtas från ärendets kontext.",
              ),
            ],
    };
  }

  const owner = await getGridOwner(context.gridOwnerId);
  if (!owner) {
    return {
      ...base,
      status: "missing",
      receiverSource,
      dynamicReceiverStrategy,
      gridOwnerId: context.gridOwnerId,
      issues: [
        issue(
          "selected_grid_owner_not_found",
          "Vald nätägare finns inte längre i masterdata.",
          "dynamic_receiver_resolver",
          { gridOwnerId: context.gridOwnerId },
        ),
      ],
      trace: context.trace,
    };
  }

  const lifecycle = String(
    owner.lifecycle_status ??
      (owner.is_active === false ? "blocked" : "active"),
  ).toLowerCase();
  const issues: RouteDecisionIssue[] = [];
  const warnings: RouteDecisionIssue[] = [];

  if (
    owner.is_active === false ||
    ["blocked", "deprecated", "inactive"].includes(lifecycle)
  ) {
    issues.push(
      issue(
        "selected_grid_owner_not_active",
        "Vald nätägare är inte aktiv och får inte användas för production Ediel.",
        "dynamic_receiver_resolver",
        { gridOwnerId: owner.id, lifecycleStatus: lifecycle },
      ),
    );
  }

  const receiverEdielId = clean(owner.ediel_id)?.toUpperCase() ?? null;
  if (!receiverEdielId) {
    issues.push(
      issue(
        "selected_grid_owner_missing_ediel_id",
        "Vald nätägare saknar Ediel-ID. Lägg in Ediel-ID på nätägaren innan Ediel skickas.",
        "dynamic_receiver_resolver",
        { gridOwnerId: owner.id },
      ),
    );
  }

  if (
    isProduction(input.environment) &&
    ["91100", "91109"].includes(receiverEdielId ?? "")
  ) {
    issues.push(
      issue(
        "selected_grid_owner_test_ediel_id",
        "Vald nätägare har ett test-Ediel-ID som inte får användas i production.",
        "dynamic_receiver_resolver",
        { gridOwnerId: owner.id, receiverEdielId },
      ),
    );
  }

  const ownerEnvironment = clean(owner.environment)?.toLowerCase() ?? null;
  if (
    isProduction(input.environment) &&
    ownerEnvironment &&
    ownerEnvironment !== "production"
  ) {
    warnings.push(
      warning(
        "selected_grid_owner_environment_mismatch",
        "Vald nätägare är inte markerad som production i masterdata.",
        "dynamic_receiver_resolver",
        { gridOwnerId: owner.id, ownerEnvironment },
      ),
    );
  }

  return {
    ...base,
    status: issues.length > 0 ? "blocked" : "resolved",
    receiverSource,
    dynamicReceiverStrategy,
    receiverEdielId,
    receiverSubAddress: subAddressForMessage(owner, input.messageFamily),
    receiverName: clean(owner.name),
    receiverEmail: clean(owner.communication_email) ?? clean(owner.email),
    gridOwnerId: owner.id,
    issues,
    warnings,
    trace: [
      ...context.trace,
      trace(
        issues.length > 0
          ? "dynamic_receiver_resolver"
          : "dynamic_receiver_resolver",
        issues.length > 0 ? "blocked" : "success",
        issues.length > 0
          ? "Vald nätägare kunde inte användas som mottagare."
          : "Mottagare valdes dynamiskt från vald nätägare.",
        {
          gridOwnerId: owner.id,
          receiverEdielId,
          receiverSource,
          dynamicReceiverStrategy,
          receiverName: owner.name,
        },
      ),
    ],
  };
}
