import { supabaseService } from "@/lib/supabase/service";
import type {
  BillingUnderlayRow,
  MeteringValueRow,
  PartnerExportRow,
} from "@/lib/cis/types";
import { buildBillingReadinessMap } from "@/lib/cis/billingReadiness";
import {
  listAllBillingUnderlays,
  listAllMeteringValues,
  listAllPartnerExports,
} from "@/lib/cis/db";
import { requireCompanyOperationalForWrites } from "@/lib/tenant/governance";
import { createPartnerExport } from "@/lib/cis/db-data";
import {
  calculatePricingForBillingUnderlay,
  listPricingComponentRules,
} from "@/lib/billing/pricingEngine";
import { buildXlsxWorkbook } from "@/lib/billing/xlsx";

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
  blocker_summary: Array<Record<string, unknown>>;
  created_at: string;
  created_by: string | null;
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

export async function createBillingExportRun(input: {
  companyId: string;
  actorUserId: string;
  periodMonth: string;
  targetSystem: string;
  exportFormat: string;
}) {
  await requireCompanyOperationalForWrites(input.companyId);

  const [underlays, meterValues, partnerExports, pricingRules] =
    await Promise.all([
      listAllBillingUnderlays({ companyId: input.companyId, status: "all" }),
      listAllMeteringValues({ companyId: input.companyId }),
      listAllPartnerExports({ companyId: input.companyId, status: "all" }),
      listPricingComponentRules(input.companyId),
    ]);

  const [year, month] = input.periodMonth
    .split("-")
    .map((part) => Number(part));
  const periodUnderlays = underlays.filter((underlay) => {
    if (!Number.isFinite(year) || !Number.isFinite(month)) return true;
    return underlay.underlay_year === year && underlay.underlay_month === month;
  });

  const readiness = buildBillingReadinessMap({
    underlays: periodUnderlays,
    meterValues,
    partnerExports,
  });
  const items = periodUnderlays.map((underlay) => {
    const result = readiness.get(underlay.id);
    const pricing = calculatePricingForBillingUnderlay({
      underlay,
      rules: pricingRules,
    });
    const pricingWarnings = pricing.warnings.map((warning) => ({
      code: "pricing_warning",
      severity: "warning",
      title: "Prismotor behöver granskning",
      description: warning,
    }));
    const blockerReasons = [...(result?.issues ?? []), ...pricingWarnings];

    return {
      company_id: input.companyId,
      billing_underlay_id: underlay.id,
      customer_id: underlay.customer_id,
      site_id: underlay.site_id,
      metering_point_id: underlay.metering_point_id,
      status: result?.isExportable ? "ready" : "blocked",
      readiness_status: result?.status ?? "blocked",
      blocker_reasons: blockerReasons,
      payload_snapshot: {
        underlay,
        readiness: result,
        pricing,
        exportContract: {
          version: "billing_export_v2",
          periodMonth: input.periodMonth,
          targetSystem: input.targetSystem,
          exportFormat: input.exportFormat,
        },
      },
    };
  });

  const rowsReady = items.filter((item) => item.status === "ready").length;
  const rowsBlocked = items.filter((item) => item.status === "blocked").length;
  const blockerSummary = items
    .filter((item) => item.status === "blocked")
    .slice(0, 40)
    .map((item) => ({
      billing_underlay_id: item.billing_underlay_id,
      issues: item.blocker_reasons,
    }));

  const { data: run, error } = await supabaseService
    .from("billing_export_runs")
    .insert({
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
    })
    .select("*")
    .single();

  if (error) throw error;

  if (items.length > 0) {
    const { error: itemError } = await supabaseService
      .from("billing_export_run_items")
      .insert(
        items.map((item) => ({ ...item, billing_export_run_id: run.id })),
      );

    if (itemError) throw itemError;
  }

  return run as BillingExportRunRow;
}

export async function queueReadyBillingExportRunItems(input: {
  companyId: string;
  actorUserId: string;
  exportRunId: string;
}): Promise<{ queued: number; blocked: number; skipped: number }> {
  await requireCompanyOperationalForWrites(input.companyId);

  const { data: run, error: runError } = await supabaseService
    .from("billing_export_runs")
    .select("*")
    .eq("company_id", input.companyId)
    .eq("id", input.exportRunId)
    .maybeSingle();

  if (runError) throw runError;
  if (!run) throw new Error("Exportkörningen hittades inte för valt bolag.");

  const { data: items, error: itemError } = await supabaseService
    .from("billing_export_run_items")
    .select("*")
    .eq("company_id", input.companyId)
    .eq("billing_export_run_id", input.exportRunId)
    .in("status", ["ready", "ready_for_retry"]);

  if (itemError) throw itemError;

  const readyItems = (items ?? []) as BillingExportRunItemRow[];
  const now = new Date().toISOString();
  let queued = 0;
  let skipped = 0;

  for (const item of readyItems) {
    if (!item.customer_id) {
      skipped += 1;
      await supabaseService
        .from("billing_export_run_items")
        .update({
          export_status: "blocked",
          last_error: "Kundkoppling saknas på exportraden.",
          failed_at: now,
          updated_at: now,
        })
        .eq("company_id", input.companyId)
        .eq("id", item.id);
      continue;
    }

    if (
      item.partner_export_id ||
      ["queued", "sent", "acknowledged"].includes(
        String(item.export_status ?? ""),
      )
    ) {
      skipped += 1;
      continue;
    }

    const idempotencyKey =
      item.idempotency_key || `billing-export-run-item:${item.id}`;

    try {
      const partnerExport = await createPartnerExport({
        actorUserId: input.actorUserId,
        customerId: item.customer_id,
        siteId: item.site_id,
        meteringPointId: item.metering_point_id,
        billingUnderlayId: item.billing_underlay_id,
        exportKind: "billing_underlay",
        targetSystem: String(
          (run as BillingExportRunRow).target_system ?? "billing_partner",
        ),
        exportBatchKey: input.exportRunId,
        externalReference: `BILLING-${input.exportRunId.slice(0, 8).toUpperCase()}-${queued + 1}`,
        payload: {
          idempotencyKey,
          exportRunId: input.exportRunId,
          exportRunItemId: item.id,
          ...(item.payload_snapshot ?? {}),
        },
      });

      const { error: updateItemError } = await supabaseService
        .from("billing_export_run_items")
        .update({
          export_status: "queued",
          partner_export_id: partnerExport.id,
          idempotency_key: idempotencyKey,
          queued_at: now,
          failed_at: null,
          last_error: null,
          updated_at: now,
        })
        .eq("company_id", input.companyId)
        .eq("id", item.id);

      if (updateItemError) throw updateItemError;
      queued += 1;
    } catch (error) {
      skipped += 1;
      await supabaseService
        .from("billing_export_run_items")
        .update({
          export_status: "failed",
          idempotency_key: idempotencyKey,
          failed_at: now,
          last_error:
            error instanceof Error
              ? error.message
              : "Partnerexport kunde inte köas.",
          retry_count: Number(item.retry_count ?? 0) + 1,
          updated_at: now,
        })
        .eq("company_id", input.companyId)
        .eq("id", item.id);
    }
  }

  const blocked = Math.max(
    0,
    Number((run as BillingExportRunRow).rows_blocked ?? 0),
  );

  const { error: updateError } = await supabaseService
    .from("billing_export_runs")
    .update({
      status:
        queued > 0 ? "queued" : blocked > 0 ? "ready_with_flags" : "blocked",
      rows_exported:
        Number((run as BillingExportRunRow).rows_exported ?? 0) + queued,
      updated_at: now,
      metadata: {
        ...((run as { metadata?: Record<string, unknown> }).metadata ?? {}),
        rowLevelPartnerExportsQueuedAt: now,
        rowLevelPartnerExportsQueued: queued,
        rowLevelPartnerExportsSkipped: skipped,
      },
    })
    .eq("company_id", input.companyId)
    .eq("id", input.exportRunId);

  if (updateError) throw updateError;

  return { queued, blocked, skipped };
}

export type BillingExportRunItemRow = {
  id: string;
  company_id: string;
  billing_export_run_id: string;
  billing_underlay_id: string | null;
  customer_id: string | null;
  site_id: string | null;
  metering_point_id: string | null;
  status: string;
  readiness_status: string;
  blocker_reasons: Array<Record<string, unknown>>;
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
  created_at: string;
};

export type BillingExportFile = {
  fileName: string;
  contentType: string;
  body: string | Uint8Array;
};

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
  return {
    export_run_item_id: item.id,
    billing_underlay_id: item.billing_underlay_id,
    customer_id: item.customer_id,
    site_id: item.site_id,
    metering_point_id: item.metering_point_id,
    status: item.status,
    readiness_status: item.readiness_status,
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
    blocker_reasons: item.blocker_reasons ?? [],
  };
}

export async function getBillingExportRunWithItems(params: {
  companyId: string;
  exportRunId: string;
}): Promise<{ run: BillingExportRunRow; items: BillingExportRunItemRow[] }> {
  const { data: run, error: runError } = await supabaseService
    .from("billing_export_runs")
    .select("*")
    .eq("company_id", params.companyId)
    .eq("id", params.exportRunId)
    .maybeSingle();

  if (runError) throw runError;
  if (!run) throw new Error("Exportkörningen hittades inte för valt bolag.");

  const { data: items, error: itemError } = await supabaseService
    .from("billing_export_run_items")
    .select("*")
    .eq("company_id", params.companyId)
    .eq("billing_export_run_id", params.exportRunId)
    .order("created_at", { ascending: true });

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
      "billing_underlay_id",
      "customer_id",
      "site_id",
      "metering_point_id",
      "status",
      "readiness_status",
      "period_year",
      "period_month",
      "total_kwh",
      "base_amount_sek_ex_vat",
      "calculated_amount_sek_ex_vat",
      "vat_sek",
      "total_sek_inc_vat",
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
      "billing_underlay_id",
      "customer_id",
      "site_id",
      "metering_point_id",
      "status",
      "readiness_status",
      "period_year",
      "period_month",
      "total_kwh",
      "base_amount_sek_ex_vat",
      "calculated_amount_sek_ex_vat",
      "vat_sek",
      "total_sek_inc_vat",
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

async function findPartnerApiEndpoint(
  companyId: string,
  targetSystem: string,
): Promise<string | null> {
  const { data, error } = await supabaseService
    .from("communication_routes")
    .select(
      "endpoint,target_system,route_type,is_active,company_id,route_scope",
    )
    .eq("route_scope", "billing_underlay")
    .eq("route_type", "partner_api")
    .eq("is_active", true)
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .order("company_id", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;
  const rows = (data ?? []) as Array<{
    endpoint?: string | null;
    target_system?: string | null;
  }>;
  const exact = rows.find(
    (row) => row.target_system === targetSystem && row.endpoint,
  );
  return exact?.endpoint ?? rows.find((row) => row.endpoint)?.endpoint ?? null;
}

export async function sendBillingExportRunToPartnerApi(input: {
  companyId: string;
  actorUserId: string;
  exportRunId: string;
}): Promise<{
  sent: boolean;
  status: string;
  endpoint: string | null;
  responsePayload: Record<string, unknown>;
}> {
  await requireCompanyOperationalForWrites(input.companyId);
  const { run, items } = await getBillingExportRunWithItems({
    companyId: input.companyId,
    exportRunId: input.exportRunId,
  });
  const readyItems = items.filter(
    (item) =>
      ["ready", "ready_for_retry"].includes(item.status) &&
      !["sent", "acknowledged"].includes(String(item.export_status ?? "")),
  );
  const endpoint = await findPartnerApiEndpoint(
    input.companyId,
    run.target_system,
  );
  const now = new Date().toISOString();

  if (!endpoint) {
    const responsePayload = {
      error: "partner_api_endpoint_missing",
      targetSystem: run.target_system,
    };
    await supabaseService
      .from("billing_export_runs")
      .update({
        status: "failed",
        rows_exported: 0,
        blocker_summary: [...(run.blocker_summary ?? []), responsePayload],
        updated_at: now,
      })
      .eq("company_id", input.companyId)
      .eq("id", input.exportRunId);

    if (readyItems.length > 0) {
      await supabaseService
        .from("billing_export_run_items")
        .update({
          export_status: "failed",
          failed_at: now,
          last_error: "Partner-API endpoint saknas.",
          updated_at: now,
        })
        .eq("company_id", input.companyId)
        .eq("billing_export_run_id", input.exportRunId)
        .in("status", ["ready", "ready_for_retry"]);
    }

    return { sent: false, status: "failed", endpoint: null, responsePayload };
  }

  const payload = {
    exportRun: run,
    rows: readyItems.map((item) => ({
      idempotencyKey:
        item.idempotency_key || `billing-export-run-item:${item.id}`,
      ...exportRowFromItem(item),
    })),
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    const responsePayload = {
      status: response.status,
      ok: response.ok,
      body: text.slice(0, 5000),
      endpoint,
    };

    await supabaseService
      .from("billing_export_runs")
      .update({
        status: response.ok ? "sent" : "failed",
        rows_exported: response.ok ? readyItems.length : 0,
        metadata: {
          partnerApi: responsePayload,
          sentAt: now,
          rowCount: readyItems.length,
        },
        updated_at: now,
      })
      .eq("company_id", input.companyId)
      .eq("id", input.exportRunId);

    await supabaseService
      .from("billing_export_run_items")
      .update({
        export_status: response.ok ? "sent" : "failed",
        sent_at: response.ok ? now : null,
        failed_at: response.ok ? null : now,
        last_error: response.ok
          ? null
          : `Partner-API svarade ${response.status}`,
        updated_at: now,
      })
      .eq("company_id", input.companyId)
      .eq("billing_export_run_id", input.exportRunId)
      .eq("status", "ready");

    return {
      sent: response.ok,
      status: response.ok ? "sent" : "failed",
      endpoint,
      responsePayload,
    };
  } catch (error) {
    const responsePayload = {
      error: error instanceof Error ? error.message : "Okänt API-fel",
      endpoint,
    };
    await supabaseService
      .from("billing_export_runs")
      .update({
        status: "failed",
        metadata: { partnerApi: responsePayload, failedAt: now },
        updated_at: now,
      })
      .eq("company_id", input.companyId)
      .eq("id", input.exportRunId);

    await supabaseService
      .from("billing_export_run_items")
      .update({
        export_status: "failed",
        failed_at: now,
        last_error: responsePayload.error,
        updated_at: now,
      })
      .eq("company_id", input.companyId)
      .eq("billing_export_run_id", input.exportRunId)
      .eq("status", "ready");

    return { sent: false, status: "failed", endpoint, responsePayload };
  }
}

export async function retryFailedBillingExportRunItems(input: {
  companyId: string;
  actorUserId: string;
  exportRunId: string;
}): Promise<{ reopened: number }> {
  await requireCompanyOperationalForWrites(input.companyId);
  const now = new Date().toISOString();

  const { data: items, error: itemError } = await supabaseService
    .from("billing_export_run_items")
    .select("id,retry_count")
    .eq("company_id", input.companyId)
    .eq("billing_export_run_id", input.exportRunId)
    .eq("export_status", "failed");

  if (itemError) throw itemError;

  const rows = (items ?? []) as Array<{
    id: string;
    retry_count?: number | null;
  }>;
  for (const row of rows) {
    await supabaseService
      .from("billing_export_run_items")
      .update({
        export_status: "ready_for_retry",
        failed_at: null,
        last_error: null,
        retry_count: Number(row.retry_count ?? 0) + 1,
        updated_at: now,
      })
      .eq("company_id", input.companyId)
      .eq("id", row.id);
  }

  await supabaseService
    .from("billing_export_runs")
    .update({
      status: rows.length > 0 ? "ready_with_flags" : "failed",
      updated_at: now,
      metadata: {
        retryPreparedAt: now,
        retryPreparedBy: input.actorUserId,
        retryPreparedRows: rows.length,
      },
    })
    .eq("company_id", input.companyId)
    .eq("id", input.exportRunId);

  return { reopened: rows.length };
}
