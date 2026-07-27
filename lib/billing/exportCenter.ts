import { createHash, createHmac, randomUUID } from "node:crypto";
import { supabaseService } from "@/lib/supabase/service";
import { assertPlatformSchemaReady } from "@/lib/platform/schemaReadiness";
import { assertOutboundAllowed } from "@/lib/platform/outboundFreeze";
import { withAutomationLock } from "@/lib/automation/locks";
import type {
  BillingUnderlayRow,
  MeteringValueRow,
  PartnerExportRow,
} from "@/lib/cis/types";
import {
  listAllBillingUnderlays,
  listAllMeteringValues,
  listAllPartnerExports,
} from "@/lib/cis/db";
import { requireCompanyOperationalForWrites } from "@/lib/tenant/governance";
import {
  calculateUnderlayPricingWithCore,
  loadLockedUnderlayPricingWithCore,
} from "@/lib/pricing/underlayPricingAdapter";
import { lockPricingPreview } from "@/lib/pricing/engine";
import { buildXlsxWorkbook } from "@/lib/billing/xlsx";
import {
  GRIDEX_BILLING_PARTNER_ADAPTER_KEY,
  GRIDEX_BILLING_PARTNER_PAYLOAD_VERSION,
  buildBillingPartnerPayload,
  buildBillingPartnerPayloadRow,
} from "@/lib/billing/partnerAdapter";
import type { CustomerContractRow } from "@/lib/customer-contracts/types";

export type BillingExportRunRow = {
  id: string;
  company_id: string;
  period_month: string;
  target_system: string;
  export_format: string;
  status: string;
  rows_total: number;
  rows_ready: number;
  rows_blocked: number;
  rows_exported: number;
  rows_queued?: number;
  rows_sent?: number;
  rows_acknowledged?: number;
  rows_failed?: number;
  rows_rejected?: number;
  blocker_summary: Array<Record<string, unknown>>;
  created_at: string;
  created_by: string | null;
  updated_at?: string | null;
  metadata?: Record<string, unknown> | null;
  adapter_key?: string | null;
  payload_version?: string | null;
  retry_policy?: Record<string, unknown> | null;
  partner_response_log?: Array<Record<string, unknown>> | null;
  last_partner_response_at?: string | null;
};

export type BillingExportCenterData = {
  underlays: BillingUnderlayRow[];
  meterValues: MeteringValueRow[];
  partnerExports: PartnerExportRow[];
  exportRuns: BillingExportRunRow[];
};

function isMissingRelationError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null;
  return Boolean(
    maybe &&
    (maybe.code === "42P01" ||
      maybe.code === "42703" ||
      maybe.code === "PGRST205" ||
      /does not exist|schema cache|relation .* does not exist/i.test(
        maybe.message ?? "",
      )),
  );
}

export async function listBillingExportRuns(
  companyId: string,
): Promise<BillingExportRunRow[]> {
  try {
    const { data, error } = await supabaseService
      .from("billing_export_runs")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(40);

    if (error) {
      if (isMissingRelationError(error)) return [];
      throw error;
    }

    return (data ?? []) as BillingExportRunRow[];
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

export async function getBillingExportCenterData(
  companyId: string,
): Promise<BillingExportCenterData> {
  const [underlays, meterValues, partnerExports, exportRuns] =
    await Promise.all([
      listAllBillingUnderlays({ companyId, status: "all" }),
      listAllMeteringValues({ companyId }),
      listAllPartnerExports({ companyId, status: "all" }),
      listBillingExportRuns(companyId),
    ]);

  return { underlays, meterValues, partnerExports, exportRuns };
}

async function listExactBillableContractsByUnderlayIds(params: {
  companyId: string;
  underlays: BillingUnderlayRow[];
}): Promise<Map<string, CustomerContractRow>> {
  const map = new Map<string, CustomerContractRow>();
  const contractIds = Array.from(
    new Set(
      params.underlays
        .map((underlay) =>
          String(
            (underlay as unknown as Record<string, unknown>).contract_id ?? "",
          ).trim(),
        )
        .filter(Boolean),
    ),
  );
  if (contractIds.length === 0) return map;

  const { data, error } = await supabaseService
    .from("customer_contracts")
    .select("*")
    .eq("company_id", params.companyId)
    .in("id", contractIds)
    .in("status", ["signed", "active"]);
  if (error) throw error;

  const byId = new Map(
    ((data ?? []) as CustomerContractRow[]).map((contract) => [
      contract.id,
      contract,
    ]),
  );
  for (const underlay of params.underlays) {
    const contractId = String(
      (underlay as unknown as Record<string, unknown>).contract_id ?? "",
    ).trim();
    const contract = contractId ? byId.get(contractId) : null;
    if (contract) map.set(underlay.id, contract);
  }
  return map;
}

function contractTextField(
  contract: CustomerContractRow | null,
  key: string,
): string | null {
  if (!contract) return null;
  const value = (contract as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function contractBooleanField(
  contract: CustomerContractRow | null,
  key: string,
): boolean {
  if (!contract) return false;
  return Boolean((contract as unknown as Record<string, unknown>)[key]);
}

function buildInvoiceSnapshot(params: {
  underlay: BillingUnderlayRow;
  contract: CustomerContractRow | null;
}) {
  const invoiceAddress = {
    recipient: contractTextField(params.contract, "invoice_recipient"),
    email: contractTextField(params.contract, "invoice_email"),
    reference: contractTextField(params.contract, "invoice_reference"),
    street: contractTextField(params.contract, "billing_street"),
    postalCode: contractTextField(params.contract, "billing_postal_code"),
    city: contractTextField(params.contract, "billing_city"),
    country: contractTextField(params.contract, "billing_country") ?? "SE",
  };

  const siteAddress = {
    street:
      (params.underlay as unknown as Record<string, unknown>).site_street ??
      null,
    postalCode:
      (params.underlay as unknown as Record<string, unknown>)
        .site_postal_code ?? null,
    city:
      (params.underlay as unknown as Record<string, unknown>).site_city ?? null,
    country:
      (params.underlay as unknown as Record<string, unknown>).site_country ??
      "SE",
  };

  return {
    invoiceRecipient: invoiceAddress.recipient,
    invoiceEmail: invoiceAddress.email,
    invoiceReference: invoiceAddress.reference,
    billingLevel:
      contractTextField(params.contract, "billing_level") ?? "customer",
    consolidatedInvoice: contractBooleanField(
      params.contract,
      "consolidated_invoice",
    ),
    invoiceAddress,
    siteAddress,
    groupKey: contractBooleanField(params.contract, "consolidated_invoice")
      ? `customer:${params.underlay.customer_id ?? "unknown"}`
      : `underlay:${params.underlay.id}`,
  };
}

async function createBlockedBillingCasesForItems(params: {
  companyId: string;
  actorUserId: string | null;
  exportRunId: string;
  items: BillingExportRunItemRow[];
}) {
  for (const item of params.items) {
    if (item.status !== "blocked" || !item.customer_id || item.blocker_case_id)
      continue;
    const issues = Array.isArray(item.blocker_reasons)
      ? item.blocker_reasons
      : [];
    const firstIssue = issues.find((issue) => typeof issue === "object") as
      Record<string, unknown> | undefined;
    const title = String(firstIssue?.title ?? "Faktureringsrad blockerad");
    const description = String(
      firstIssue?.description ??
        "Faktureringsunderlaget kräver manuell granskning innan export.",
    );

    try {
      const { data: task, error: taskError } = await supabaseService
        .from("customer_operation_tasks")
        .insert({
          company_id: params.companyId,
          customer_id: item.customer_id,
          site_id: item.site_id,
          metering_point_id: item.metering_point_id,
          task_type: "billing_export_blocker",
          status: "open",
          priority: "high",
          title,
          description,
          metadata: {
            reasonCategory: "billing_export_blocker",
            nextAction:
              "Granska blockerad faktureringsrad, komplettera saknade mätvärden/avtal och öppna därefter exporten för ny körning.",
            source: "billing_export_blocker",
            contractId: item.contract_id ?? null,
            exportRunId: params.exportRunId,
            exportRunItemId: item.id,
            billingUnderlayId: item.billing_underlay_id,
            blockerReasons: issues,
          },
          created_by: params.actorUserId,
          updated_by: params.actorUserId,
        })
        .select("id")
        .single();

      if (taskError) throw taskError;

      const { error: itemUpdateError } = await supabaseService
        .from("billing_export_run_items")
        .update({
          blocker_case_id: task?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", params.companyId)
        .eq("id", item.id);
      if (itemUpdateError) throw itemUpdateError;
    } catch (error) {
      console.warn("Billing blocker task could not be created", error);
    }
  }
}

export async function createBillingExportRun(input: {
  companyId: string;
  actorUserId: string | null;
  periodMonth: string;
  targetSystem: string;
  exportFormat: string;
  /**
   * Run-level idempotency (automation callers): when a run with this key
   * already exists it is returned instead of creating a duplicate. Backed by
   * ux_billing_export_runs_company_idempotency.
   */
  idempotencyKey?: string | null;
}) {
  await requireCompanyOperationalForWrites(input.companyId);

  const idempotencyKey = input.idempotencyKey?.trim() || null;

  const underlays = await listAllBillingUnderlays({
    companyId: input.companyId,
    status: "all",
  });

  const [year, month] = input.periodMonth
    .split("-")
    .map((part) => Number(part));
  const periodUnderlays = underlays.filter((underlay) => {
    if (!Number.isFinite(year) || !Number.isFinite(month)) return true;
    return underlay.underlay_year === year && underlay.underlay_month === month;
  });

  const contractsByUnderlay = await listExactBillableContractsByUnderlayIds({
    companyId: input.companyId,
    underlays: periodUnderlays,
  });

  const items = [];
  for (const underlay of periodUnderlays) {
    const contract = contractsByUnderlay.get(underlay.id) ?? null;
    // Single Pricing Core: same engine and persisted pricing_run as the
    // pricing preview, so billing/export can never disagree with preview.
    let pricing = await loadLockedUnderlayPricingWithCore({
      companyId: input.companyId,
      billingUnderlayId: underlay.id,
    });
    if (!pricing) {
      pricing = await calculateUnderlayPricingWithCore({
        companyId: input.companyId,
        billingUnderlayId: underlay.id,
        persist: true,
      });
      if (pricing.status === "success" && pricing.pricingRunId) {
        await lockPricingPreview({
          companyId: input.companyId,
          pricingRunId: pricing.pricingRunId,
          actorUserId: input.actorUserId,
        });
        pricing =
          (await loadLockedUnderlayPricingWithCore({
            companyId: input.companyId,
            billingUnderlayId: underlay.id,
          })) ?? pricing;
      }
    }
    const { data: canonicalReadiness, error: readinessError } =
      await supabaseService
        .from("billing_export_readiness_v")
        .select("*")
        .eq("company_id", input.companyId)
        .eq("billing_underlay_id", underlay.id)
        .maybeSingle();
    if (readinessError) throw readinessError;
    const canonicalBlockers = Array.isArray(canonicalReadiness?.blockers)
      ? canonicalReadiness.blockers.map((blocker: unknown) => ({
          code: String(blocker),
          severity: "blocked",
          title: "Canonical exportreadiness blockerad",
          description: String(blocker),
        }))
      : [];

    const pricingWarnings = pricing.warnings.map((warning) => ({
      code: "pricing_warning",
      severity: "warning",
      title: "Prismotor behöver granskning",
      description: warning,
    }));
    const pricingBlockers =
      pricing.status === "success" && pricing.locked
        ? []
        : (pricing.errors.length > 0
            ? pricing.errors
            : [
                pricing.status === "success"
                  ? "Prisberäkningen är inte låst."
                  : "Prisberäkningen misslyckades.",
              ]
          ).map((message) => ({
            code: "pricing_failed",
            severity: "blocked",
            title: "Prisberäkning blockerad",
            description: message,
          }));
    const missingContractIssue = !contract
      ? [
          {
            code: "missing_contract",
            severity: "blocked",
            title: "Avtal saknas",
            description:
              "Faktureringsraden saknar kopplat avtal/kampanj och får inte exporteras automatiskt.",
          },
        ]
      : [];
    const blockerReasons = [
      ...canonicalBlockers,
      ...pricingWarnings,
      ...pricingBlockers,
      ...missingContractIssue,
    ];
    const invoiceSnapshot = buildInvoiceSnapshot({ underlay, contract });
    const itemIdempotencySeed = `billing:${input.companyId}:${underlay.id}:${input.periodMonth}`;

    items.push({
      company_id: input.companyId,
      billing_underlay_id: underlay.id,
      contract_id:
        String(
          (underlay as unknown as Record<string, unknown>).contract_id ?? "",
        ).trim() || null,
      customer_id: underlay.customer_id,
      site_id: underlay.site_id,
      metering_point_id: underlay.metering_point_id,
      status:
        canonicalReadiness?.is_exportable === true &&
        contract &&
        pricing.status === "success" &&
        pricing.locked
          ? "ready"
          : "blocked",
      readiness_status: canonicalReadiness?.status ?? "blocked",
      energy_direction: pricing.energyDirection,
      settlement_type: pricing.settlementType,
      blocker_reasons: blockerReasons,
      pricing_line_items: pricing.lines,
      invoice_recipient: invoiceSnapshot.invoiceRecipient,
      invoice_email: invoiceSnapshot.invoiceEmail,
      invoice_reference: invoiceSnapshot.invoiceReference,
      billing_level: invoiceSnapshot.billingLevel,
      consolidated_invoice: invoiceSnapshot.consolidatedInvoice,
      invoice_address_snapshot: invoiceSnapshot.invoiceAddress,
      site_address_snapshot: invoiceSnapshot.siteAddress,
      consolidated_invoice_group_key: invoiceSnapshot.groupKey,
      adapter_key: GRIDEX_BILLING_PARTNER_ADAPTER_KEY,
      payload_version: "billing_export_item_v4c",
      idempotency_key: itemIdempotencySeed,
      external_reference: `BILLING-${input.periodMonth}-${underlay.id.slice(0, 8).toUpperCase()}`,
      adapter_payload_snapshot: {},
      payload_snapshot: {
        underlay,
        contract,
        readiness: canonicalReadiness ?? {
          status: "blocked",
          blockers: ["readiness_row_missing"],
        },
        pricing,
        invoice: invoiceSnapshot,
        exportContract: {
          version: "billing_export_v4c_partner_adapter",
          periodMonth: input.periodMonth,
          targetSystem: input.targetSystem,
          exportFormat: input.exportFormat,
        },
      },
      pricing_run_id: pricing.pricingRunId,
      customer_contract_id: contract?.id ?? null,
      period_start: underlay.billing_period_start ?? null,
      period_end: underlay.billing_period_end ?? null,
      total_kwh: underlay.total_kwh,
      currency: underlay.currency || "SEK",
      amount_ex_vat: pricing.subtotalSekExVat,
      vat_amount: pricing.vatSek,
      amount_inc_vat: pricing.totalSekIncVat,
    });
  }

  const rowsReady = items.filter((item) => item.status === "ready").length;
  const rowsBlocked = items.filter((item) => item.status === "blocked").length;
  const blockerSummary = items
    .filter((item) => item.status === "blocked")
    .slice(0, 40)
    .map((item) => ({
      billing_underlay_id: item.billing_underlay_id,
      issues: item.blocker_reasons,
    }));

  const now = new Date().toISOString();
  const effectiveIdempotencyKey =
    idempotencyKey ??
    `billing-export:${createHash("sha256")
      .update(
        JSON.stringify({
          companyId: input.companyId,
          periodMonth: input.periodMonth,
          targetSystem: input.targetSystem,
          exportFormat: input.exportFormat,
          underlayIds: items
            .map((item) => item.billing_underlay_id)
            .sort(),
        }),
      )
      .digest("hex")}`;
  const runDraft: BillingExportRunRow & { idempotency_key?: string | null } = {
    id: randomUUID(),
    company_id: input.companyId,
    period_month: input.periodMonth,
    target_system: input.targetSystem,
    export_format: input.exportFormat,
    status: rowsReady > 0 ? "ready_with_flags" : "blocked",
    rows_total: items.length,
    rows_ready: rowsReady,
    rows_blocked: rowsBlocked,
    rows_exported: 0,
    blocker_summary: blockerSummary,
    created_by: input.actorUserId,
    created_at: now,
    updated_at: now,
    adapter_key: GRIDEX_BILLING_PARTNER_ADAPTER_KEY,
    payload_version: "billing_export_v4c",
    retry_policy: { maxAttempts: 3, strategy: "manual_retry" },
    metadata: {
      pricingEngine: "pricing_core_v1",
      partnerAdapter: GRIDEX_BILLING_PARTNER_ADAPTER_KEY,
      exactContractBinding: true,
      atomicCreation: true,
    },
    idempotency_key: effectiveIdempotencyKey,
  };
  const preparedItems = items.map((item) => {
    const prepared = {
      ...item,
      id: randomUUID(),
      billing_export_run_id: runDraft.id,
      created_at: now,
      updated_at: now,
    } as BillingExportRunItemRow;
    return {
      ...prepared,
      adapter_payload_snapshot: buildBillingPartnerPayloadRow({
        run: runDraft,
        item: prepared,
      }),
    };
  });

  const canonicalItems = preparedItems
    .filter((item) => item.status === "ready")
    .map((item) => {
      const row = item as BillingExportRunItemRow & {
        pricing_run_id?: string | null;
        customer_contract_id?: string | null;
        period_start?: string | null;
        period_end?: string | null;
        total_kwh?: number | null;
        currency?: string | null;
        amount_ex_vat?: number | null;
        vat_amount?: number | null;
        amount_inc_vat?: number | null;
      };
      if (
        !row.customer_contract_id ||
        !row.pricing_run_id ||
        !row.period_start ||
        !row.period_end ||
        row.total_kwh === null ||
        row.total_kwh === undefined ||
        !Number.isFinite(row.amount_ex_vat) ||
        !Number.isFinite(row.vat_amount) ||
        !Number.isFinite(row.amount_inc_vat)
      ) {
        throw new Error(
          `canonical_invoice_export_item_incomplete:${row.billing_underlay_id}`,
        );
      }
      return {
        id: row.id,
        company_id: input.companyId,
        billing_underlay_id: row.billing_underlay_id,
        pricing_run_id: row.pricing_run_id,
        customer_contract_id: row.customer_contract_id,
        customer_id: row.customer_id,
        metering_point_id: row.metering_point_id,
        period_start: row.period_start,
        period_end: row.period_end,
        total_kwh: row.total_kwh,
        currency: row.currency ?? "SEK",
        provider: input.targetSystem,
        environment: "production",
        financing_mode: "invoice_service",
        amount_ex_vat: row.amount_ex_vat,
        vat_amount: row.vat_amount,
        amount_inc_vat: row.amount_inc_vat,
        idempotency_key: row.idempotency_key,
        metadata: {
          legacy_billing_export_run_id: runDraft.id,
          legacy_billing_export_run_item_id: row.id,
        },
      };
    });
  const canonicalInvoices = canonicalItems.map((item) => ({
    invoice_export_item_id: item.id,
    customer_id: item.customer_id,
    customer_contract_id: item.customer_contract_id,
    period_start: item.period_start,
    period_end: item.period_end,
    total_kwh: item.total_kwh,
    currency: item.currency,
    amount_ex_vat: item.amount_ex_vat,
    vat_amount: item.vat_amount,
    amount_inc_vat: item.amount_inc_vat,
    metadata: {
      source: "gridex_create_invoice_export_graph_v1",
      billing_export_run_id: runDraft.id,
    },
  }));

  const { data: atomicResult, error } = await supabaseService.rpc(
    "gridex_create_invoice_export_graph_v1",
    {
      p_run: {
        id: runDraft.id,
        company_id: input.companyId,
        provider: input.targetSystem,
        environment: "production",
        billing_month: input.periodMonth,
        financing_mode: "invoice_service",
        readiness_snapshot: {
          rows_total: items.length,
          rows_ready: rowsReady,
          rows_blocked: rowsBlocked,
          blockers: blockerSummary,
        },
        metadata: runDraft.metadata,
        requested_by: input.actorUserId,
        idempotency_key: effectiveIdempotencyKey,
        legacy_run: runDraft,
        legacy_items: preparedItems,
      },
      p_items: canonicalItems,
      p_invoices: canonicalInvoices,
    },
  );
  if (error) throw error;
  const atomic = atomicResult as {
    run_id?: string;
    existing?: boolean;
    legacy_run?: BillingExportRunRow;
  };
  const run = atomic.legacy_run;
  if (!run?.id || run.id !== atomic.run_id) {
    throw new Error("canonical_invoice_export_graph_invalid_response");
  }

  await createBlockedBillingCasesForItems({
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    exportRunId: run.id,
    items: preparedItems,
  });

  return run as BillingExportRunRow;
}

export async function queueReadyBillingExportRunItems(input: {
  companyId: string;
  actorUserId: string | null;
  exportRunId: string;
}): Promise<{ queued: number; blocked: number; skipped: number }> {
  await requireCompanyOperationalForWrites(input.companyId);
  const { data, error } = await supabaseService.rpc(
    "gridex_queue_billing_export_run",
    {
      p_company_id: input.companyId,
      p_export_run_id: input.exportRunId,
      p_actor_user_id: input.actorUserId,
    },
  );
  if (error) throw error;
  const result =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  return {
    queued: Number(result.queued ?? 0),
    blocked: Number(result.blocked ?? 0),
    skipped: Number(result.skipped ?? 0),
  };
}

export type BillingExportRunItemRow = {
  id: string;
  company_id: string;
  billing_export_run_id: string;
  billing_underlay_id: string | null;
  contract_id?: string | null;
  customer_id: string | null;
  site_id: string | null;
  metering_point_id: string | null;
  status: string;
  readiness_status: string;
  energy_direction?: "consumption" | "production" | "consumption_correction";
  settlement_type?: "invoice" | "credit_invoice" | "self_billing";
  blocker_reasons: Array<Record<string, unknown>>;
  pricing_line_items?: Array<Record<string, unknown>> | null;
  invoice_recipient?: string | null;
  invoice_email?: string | null;
  invoice_reference?: string | null;
  billing_level?: string | null;
  consolidated_invoice?: boolean | null;
  invoice_address_snapshot?: Record<string, unknown> | null;
  site_address_snapshot?: Record<string, unknown> | null;
  consolidated_invoice_group_key?: string | null;
  adapter_key?: string | null;
  payload_version?: string | null;
  adapter_payload_snapshot?: Record<string, unknown> | null;
  external_reference?: string | null;
  partner_response_log?: Array<Record<string, unknown>> | null;
  last_partner_response_at?: string | null;
  payload_snapshot: Record<string, unknown>;
  export_status?: string | null;
  partner_export_id?: string | null;
  idempotency_key?: string | null;
  queued_at?: string | null;
  sent_at?: string | null;
  acknowledged_at?: string | null;
  failed_at?: string | null;
  retry_count?: number | null;
  last_error?: string | null;
  blocker_case_id?: string | null;
  sent_by?: string | null;
  created_at: string;
};

export type BillingExportFile = {
  fileName: string;
  contentType: string;
  body: string | Uint8Array;
};

export class BillingExportNotFoundError extends Error {
  constructor() {
    super("Exportkörningen hittades inte för valt bolag.");
    this.name = "BillingExportNotFoundError";
  }
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n;]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

function readSnapshotNumber(
  snapshot: Record<string, unknown>,
  path: string[],
): number | null {
  let cursor: unknown = snapshot;
  for (const part of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor))
      return null;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === "number" && Number.isFinite(cursor) ? cursor : null;
}

function exportRowFromItem(item: BillingExportRunItemRow) {
  const snapshot = item.payload_snapshot ?? {};
  const underlay =
    snapshot.underlay && typeof snapshot.underlay === "object"
      ? (snapshot.underlay as Record<string, unknown>)
      : {};
  const pricing =
    snapshot.pricing && typeof snapshot.pricing === "object"
      ? (snapshot.pricing as Record<string, unknown>)
      : {};
  const rawEnergyDirection = item.energy_direction ?? underlay.energy_direction;
  if (rawEnergyDirection !== "consumption" && rawEnergyDirection !== "production" && rawEnergyDirection !== "consumption_correction") {
    throw new Error("billing_export_energy_direction_missing");
  }
  const rawSettlementType = item.settlement_type ?? underlay.settlement_type;
  const settlementType = rawSettlementType ?? (rawEnergyDirection === "consumption" ? "invoice" : null);
  if (rawEnergyDirection === "production" && settlementType !== "credit_invoice" && settlementType !== "self_billing") {
    throw new Error("billing_export_production_settlement_type_invalid");
  }
  if (rawEnergyDirection === "consumption_correction" && settlementType !== "credit_invoice") {
    throw new Error("billing_export_consumption_correction_settlement_invalid");
  }
  if (rawEnergyDirection === "consumption" && settlementType !== "invoice") {
    throw new Error("billing_export_consumption_settlement_type_invalid");
  }
  return {
    export_run_item_id: item.id,
    idempotency_key: item.idempotency_key ?? null,
    payload_version:
      item.payload_version ?? GRIDEX_BILLING_PARTNER_PAYLOAD_VERSION,
    adapter_key: item.adapter_key ?? GRIDEX_BILLING_PARTNER_ADAPTER_KEY,
    external_reference: item.external_reference ?? null,
    billing_underlay_id: item.billing_underlay_id,
    contract_id: item.contract_id ?? null,
    customer_id: item.customer_id,
    site_id: item.site_id,
    metering_point_id: item.metering_point_id,
    status: item.status,
    readiness_status: item.readiness_status,
    energy_direction: rawEnergyDirection,
    settlement_type: settlementType,
    period_year: underlay.underlay_year ?? null,
    period_month: underlay.underlay_month ?? null,
    total_kwh: underlay.total_kwh ?? null,
    base_amount_sek_ex_vat: underlay.total_sek_ex_vat ?? null,
    calculated_amount_sek_ex_vat:
      pricing.subtotalSekExVat ??
      readSnapshotNumber(snapshot, ["pricing", "subtotalSekExVat"]),
    vat_sek:
      pricing.vatSek ?? readSnapshotNumber(snapshot, ["pricing", "vatSek"]),
    total_sek_inc_vat:
      pricing.totalSekIncVat ??
      readSnapshotNumber(snapshot, ["pricing", "totalSekIncVat"]),
    pricing_line_items: item.pricing_line_items ?? [],
    interval_evidence: Array.isArray(pricing.intervalEvidence)
      ? pricing.intervalEvidence
      : [],
    invoice_recipient: item.invoice_recipient ?? null,
    invoice_email: item.invoice_email ?? null,
    invoice_reference: item.invoice_reference ?? null,
    billing_level: item.billing_level ?? null,
    consolidated_invoice: Boolean(item.consolidated_invoice),
    consolidated_invoice_group_key: item.consolidated_invoice_group_key ?? null,
    invoice_address_snapshot: item.invoice_address_snapshot ?? null,
    site_address_snapshot: item.site_address_snapshot ?? null,
    blocker_reasons: item.blocker_reasons ?? [],
  };
}

export async function getBillingExportRunWithItems(params: {
  companyId: string | null;
  exportRunId: string;
}): Promise<{ run: BillingExportRunRow; items: BillingExportRunItemRow[] }> {
  let runQuery = supabaseService
    .from("billing_export_runs")
    .select("*")
    .eq("id", params.exportRunId);
  if (params.companyId) runQuery = runQuery.eq("company_id", params.companyId);
  const { data: run, error: runError } = await runQuery.maybeSingle();

  if (runError) throw runError;
  if (!run) throw new BillingExportNotFoundError();

  let itemsQuery = supabaseService
    .from("billing_export_run_items")
    .select("*")
    .eq("billing_export_run_id", params.exportRunId);
  if (params.companyId)
    itemsQuery = itemsQuery.eq("company_id", params.companyId);
  const { data: items, error: itemError } = await itemsQuery.order(
    "created_at",
    { ascending: true },
  );

  if (itemError) throw itemError;

  return {
    run: run as BillingExportRunRow,
    items: (items ?? []) as BillingExportRunItemRow[],
  };
}

export function buildBillingExportFile(params: {
  run: BillingExportRunRow;
  items: BillingExportRunItemRow[];
  format?: string | null;
}): BillingExportFile {
  const format = String(
    params.format ?? params.run.export_format ?? "json",
  ).toLowerCase();
  const rows = params.items.map(exportRowFromItem);
  const baseName = `billing-export-${params.run.period_month}-${params.run.id.slice(0, 8)}`;

  if (format === "csv") {
    const headers = [
      "export_run_item_id",
      "idempotency_key",
      "payload_version",
      "adapter_key",
      "external_reference",
      "billing_underlay_id",
      "contract_id",
      "customer_id",
      "site_id",
      "metering_point_id",
      "status",
      "readiness_status",
      "energy_direction",
      "settlement_type",
      "period_year",
      "period_month",
      "total_kwh",
      "base_amount_sek_ex_vat",
      "calculated_amount_sek_ex_vat",
      "vat_sek",
      "total_sek_inc_vat",
      "pricing_line_items",
      "interval_evidence",
      "invoice_recipient",
      "invoice_email",
      "invoice_reference",
      "billing_level",
      "consolidated_invoice",
      "consolidated_invoice_group_key",
      "invoice_address_snapshot",
      "site_address_snapshot",
      "blocker_reasons",
    ];
    const body = [
      headers.join(";"),
      ...rows.map((row) =>
        headers
          .map((header) => csvEscape((row as Record<string, unknown>)[header]))
          .join(";"),
      ),
    ].join("\n");
    return {
      fileName: `${baseName}.csv`,
      contentType: "text/csv; charset=utf-8",
      body,
    };
  }

  if (format === "excel" || format === "xlsx") {
    const headers = [
      "export_run_item_id",
      "idempotency_key",
      "payload_version",
      "adapter_key",
      "external_reference",
      "billing_underlay_id",
      "contract_id",
      "customer_id",
      "site_id",
      "metering_point_id",
      "status",
      "readiness_status",
      "energy_direction",
      "settlement_type",
      "period_year",
      "period_month",
      "total_kwh",
      "base_amount_sek_ex_vat",
      "calculated_amount_sek_ex_vat",
      "vat_sek",
      "total_sek_inc_vat",
      "pricing_line_items",
      "interval_evidence",
      "invoice_recipient",
      "invoice_email",
      "invoice_reference",
      "billing_level",
      "consolidated_invoice",
      "consolidated_invoice_group_key",
      "invoice_address_snapshot",
      "site_address_snapshot",
      "blocker_reasons",
    ];
    return {
      fileName: `${baseName}.xlsx`,
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: buildXlsxWorkbook(headers, rows),
    };
  }

  return {
    fileName: `${baseName}.json`,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify({ run: params.run, rows }, null, 2),
  };
}

type BillingPartnerRoute = {
  id: string;
  endpoint: string;
  targetSystem: string;
  authConfig: Record<string, unknown>;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringConfig(
  config: Record<string, unknown>,
  key: string,
): string | null {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function findPartnerApiRoute(
  companyId: string,
  targetSystem: string,
): Promise<BillingPartnerRoute | null> {
  const { data, error } = await supabaseService
    .from("communication_routes")
    .select(
      "id,endpoint,target_system,route_type,is_active,company_id,route_scope,auth_config,created_at",
    )
    .eq("route_scope", "billing_underlay")
    .eq("route_type", "partner_api")
    .eq("target_system", targetSystem)
    .eq("is_active", true)
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .order("company_id", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const tenantRows = rows.filter((row) => row.company_id === companyId);
  const candidates =
    tenantRows.length > 0
      ? tenantRows
      : rows.filter((row) => row.company_id === null);
  if (candidates.length > 1) {
    throw new Error(
      `Flera aktiva fakturapartner-routes matchar ${targetSystem}.`,
    );
  }
  const row = candidates[0];
  const endpoint = typeof row?.endpoint === "string" ? row.endpoint.trim() : "";
  const routeId = typeof row?.id === "string" ? row.id : "";
  if (!endpoint || !routeId) return null;
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "https:")
    throw new Error("Fakturapartnerns endpoint måste använda HTTPS.");
  return {
    id: routeId,
    endpoint,
    targetSystem,
    authConfig: objectValue(row.auth_config),
  };
}

function partnerHeaders(
  route: BillingPartnerRoute,
  rawBody: string,
  idempotencyKey: string,
): Record<string, string> {
  const config = route.authConfig;
  const authType =
    stringConfig(config, "type") ?? stringConfig(config, "auth_type");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    "idempotency-key": idempotencyKey,
    "x-gridex-route-id": route.id,
  };
  if (authType === "bearer") {
    const token =
      stringConfig(config, "token") ?? stringConfig(config, "bearer_token");
    if (!token) throw new Error("Fakturapartner-routen saknar bearer-token.");
    headers.authorization = `Bearer ${token}`;
  } else if (authType === "api_key") {
    const name = stringConfig(config, "header_name") ?? "x-api-key";
    const value = stringConfig(config, "api_key");
    if (!value) throw new Error("Fakturapartner-routen saknar API-nyckel.");
    headers[name] = value;
  } else if (authType === "basic") {
    const username = stringConfig(config, "username");
    const password = stringConfig(config, "password");
    if (!username || !password)
      throw new Error("Fakturapartner-routen saknar Basic Auth-uppgifter.");
    headers.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  } else if (authType === "hmac_sha256") {
    const secret = stringConfig(config, "secret");
    if (!secret)
      throw new Error("Fakturapartner-routen saknar HMAC-hemlighet.");
    const timestamp = String(Math.floor(Date.now() / 1000));
    headers["x-gridex-timestamp"] = timestamp;
    headers["x-gridex-signature"] = createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
  } else {
    throw new Error(
      "Fakturapartner-routen saknar en stödd autentiseringsmetod.",
    );
  }
  return headers;
}

function parsePartnerItemResult(payload: unknown, readyItemIds: string[]) {
  const body = objectValue(payload);
  const accepted = Array.isArray(body.accepted_ids)
    ? body.accepted_ids.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const rejectedRows = Array.isArray(body.rejected) ? body.rejected : [];
  const rejected = new Map<string, string>();
  for (const entry of rejectedRows) {
    const row = objectValue(entry);
    const id = typeof row.id === "string" ? row.id : null;
    const error =
      typeof row.error === "string"
        ? row.error
        : "Fakturapartnern avvisade raden.";
    if (id) rejected.set(id, error);
  }
  const known = new Set([...accepted, ...rejected.keys()]);
  const unknown = readyItemIds.filter((id) => !known.has(id));
  const invalid = [...known].filter((id) => !readyItemIds.includes(id));
  if (unknown.length > 0 || invalid.length > 0) {
    throw new Error(
      "Fakturapartnerns radkvittens är ofullständig eller innehåller okända rad-ID:n.",
    );
  }
  return { accepted, rejected };
}

async function applyPartnerResult(input: {
  companyId: string;
  actorUserId: string | null;
  exportRunId: string;
  acceptedIds: string[];
  rejected: Array<{ id: string; error: string }>;
  responsePayload: Record<string, unknown>;
}) {
  const { data, error } = await supabaseService.rpc(
    "gridex_apply_billing_export_partner_result",
    {
      p_company_id: input.companyId,
      p_export_run_id: input.exportRunId,
      p_accepted_ids: input.acceptedIds,
      p_rejected: input.rejected,
      p_response: input.responsePayload,
      p_actor_user_id: input.actorUserId,
    },
  );
  if (error) throw error;
  return data;
}

export async function sendBillingExportRunToPartnerApi(input: {
  companyId: string;
  actorUserId: string | null;
  exportRunId: string;
}): Promise<{
  sent: boolean;
  status: string;
  endpoint: string | null;
  responsePayload: Record<string, unknown>;
}> {
  await assertPlatformSchemaReady();
  await requireCompanyOperationalForWrites(input.companyId);
  await assertOutboundAllowed({
    companyId: input.companyId,
    channel: "invoice_export",
  });

  return withAutomationLock({
    lockKey: `billing-partner-export:${input.companyId}:${input.exportRunId}`,
    companyId: input.companyId,
    ttlSeconds: 7_200,
    metadata: {
      domain: "billing_partner_export",
      exportRunId: input.exportRunId,
    },
    run: async () => {
      await queueReadyBillingExportRunItems(input);
      const { run, items } = await getBillingExportRunWithItems({
        companyId: input.companyId,
        exportRunId: input.exportRunId,
      });
      const readyItems = items.filter(
        (item) =>
          ["ready", "ready_for_retry"].includes(item.status) &&
          String(item.export_status ?? "") === "queued" &&
          Boolean(item.partner_export_id),
      );
      if (readyItems.length === 0) {
        throw new Error(
          "Exportkörningen saknar osända readiness-godkända rader.",
        );
      }
      if (
        items.some(
          (item) =>
            !["ready", "ready_for_retry", "sent", "acknowledged"].includes(
              String(item.status),
            ),
        )
      ) {
        throw new Error(
          "Exportkörningen innehåller blockerade eller inkonsekventa rader.",
        );
      }

      const route = await findPartnerApiRoute(
        input.companyId,
        run.target_system,
      );
      if (!route) {
        const responsePayload = {
          error: "partner_api_route_missing",
          targetSystem: run.target_system,
        };
        await applyPartnerResult({
          ...input,
          acceptedIds: [],
          rejected: readyItems.map((item) => ({
            id: item.id,
            error: "Partner-API-rutt saknas.",
          })),
          responsePayload,
        });
        return {
          sent: false,
          status: "failed",
          endpoint: null,
          responsePayload,
        };
      }

      const payload = buildBillingPartnerPayload({ run, items: readyItems });
      const rawBody = JSON.stringify(payload);
      const idempotencyKey = `billing-export:${input.companyId}:${input.exportRunId}`;
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error("Fakturapartner timeout")),
        30_000,
      );
      try {
        const response = await fetch(route.endpoint, {
          method: "POST",
          headers: partnerHeaders(route, rawBody, idempotencyKey),
          body: rawBody,
          signal: controller.signal,
          cache: "no-store",
        });
        const responseText = await response.text();
        let responseJson: unknown = {};
        try {
          responseJson = responseText ? JSON.parse(responseText) : {};
        } catch {
          responseJson = {};
        }
        const responsePayload = {
          status: response.status,
          ok: response.ok,
          body: responseText.slice(0, 5_000),
          endpoint: route.endpoint,
          route_id: route.id,
        };
        if (!response.ok) {
          throw new Error(`Fakturapartnern svarade ${response.status}.`);
        }
        const itemResult = parsePartnerItemResult(
          responseJson,
          readyItems.map((item) => item.id),
        );
        await applyPartnerResult({
          ...input,
          acceptedIds: itemResult.accepted,
          rejected: Array.from(itemResult.rejected.entries()).map(
            ([id, error]) => ({ id, error }),
          ),
          responsePayload,
        });
        const allAccepted = itemResult.rejected.size === 0;
        return {
          sent: allAccepted,
          status: allAccepted ? "sent" : "partial_failed",
          endpoint: route.endpoint,
          responsePayload,
        };
      } catch (error) {
        const responsePayload = {
          error: error instanceof Error ? error.message : "Okänt API-fel",
          endpoint: route.endpoint,
          route_id: route.id,
        };
        await applyPartnerResult({
          ...input,
          acceptedIds: [],
          rejected: readyItems.map((item) => ({
            id: item.id,
            error: String(responsePayload.error),
          })),
          responsePayload,
        });
        return {
          sent: false,
          status: "failed",
          endpoint: route.endpoint,
          responsePayload,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

export async function retryFailedBillingExportRunItems(input: {
  companyId: string;
  actorUserId: string | null;
  exportRunId: string;
}): Promise<{ reopened: number }> {
  await requireCompanyOperationalForWrites(input.companyId);
  const { data, error } = await supabaseService.rpc(
    "gridex_prepare_billing_export_retry",
    {
      p_company_id: input.companyId,
      p_export_run_id: input.exportRunId,
      p_actor_user_id: input.actorUserId,
    },
  );
  if (error) throw error;
  const result =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  return { reopened: Number(result.reopened ?? 0) };
}
