import Link from "next/link";
import AdminHeader from "@/components/admin/AdminHeader";
import { requireAdminPageAccess } from "@/lib/admin/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOperationalCompanyScope } from "@/lib/tenant/scope";
import {
  createCustomerFromImportRowAction,
  linkCustomerImportRowToExistingCustomerAction,
  rejectCustomerImportRowAction,
} from "@/app/admin/customers/actions";

export const dynamic = "force-dynamic";

type ImportBatchRow = {
  id: string;
  company_id: string | null;
  source_kind: string | null;
  source_type?: string | null;
  file_name: string | null;
  status: string | null;
  total_rows?: number | null;
  rows_total?: number | null;
  created_rows?: number | null;
  rows_created?: number | null;
  failed_rows?: number | null;
  rows_failed?: number | null;
  warnings?: unknown;
  created_at: string;
  imported_at?: string | null;
};

type ImportRow = {
  id: string;
  import_batch_id: string;
  row_number: number;
  status: string;
  customer_id: string | null;
  error_message?: string | null;
  warnings?: unknown;
  issues?: unknown;
  parser_confidence?: number | null;
  normalized_payload?: unknown;
  created_at: string;
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function issueText(row: ImportRow): string {
  const issues = row.issues as {
    missingFields?: string[];
    uncertainFields?: string[];
    duplicateWarnings?: string[];
  } | null;
  const parts: string[] = [];
  if (issues?.missingFields?.length)
    parts.push(`Saknas: ${issues.missingFields.join(", ")}`);
  if (issues?.uncertainFields?.length)
    parts.push(`Osäkert: ${issues.uncertainFields.join(", ")}`);
  if (issues?.duplicateWarnings?.length)
    parts.push(`Dubblett: ${issues.duplicateWarnings.join(", ")}`);
  const warnings = asArray(row.warnings)
    .map((item) => String(item))
    .filter(Boolean);
  if (warnings.length) parts.push(warnings.slice(0, 3).join(" · "));
  if (row.error_message) parts.push(row.error_message);
  return parts.join(" · ") || "—";
}

function statusTone(status: string | null | undefined): string {
  if (status === "created" || status === "completed")
    return "border-emerald-200 bg-emerald-50 text-emerald-800 ";
  if (
    [
      "duplicate_warning",
      "missing_fields",
      "requires_review",
      "partially_imported",
      "previewed",
    ].includes(status ?? "")
  )
    return "border-amber-200 bg-amber-50 text-amber-900 ";
  if (status === "failed" || status === "rejected")
    return "border-red-200 bg-red-50 text-red-800 ";
  return "border-slate-200 bg-slate-50 text-slate-700 ";
}

function rowStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "ready_to_create":
      return "Redo att skapa";
    case "requires_review":
      return "Kräver granskning";
    case "duplicate_warning":
      return "Dubblettmisstanke";
    case "missing_fields":
      return "Saknar fält";
    case "created":
      return "Skapad";
    case "failed":
      return "Fel";
    case "partially_imported":
      return "Delvis importerad";
    case "completed":
      return "Slutförd";
    case "previewed":
      return "Förhandsgranskad";
    default:
      return status ?? "Okänd";
  }
}

export default async function CustomerImportQueuePage() {
  const access = await requireAdminPageAccess({
    anyOf: ["customers.write", "customers.read", "masterdata.read"],
  });
  const supabase = await createSupabaseServerClient();
  const { data: authResult } = await supabase.auth.getUser();
  const companyScope = await getOperationalCompanyScope(access.userId);

  let batchQuery = supabase
    .from("customer_import_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(25);

  if (companyScope.companyId)
    batchQuery = batchQuery.eq("company_id", companyScope.companyId);

  const { data: batches, error: batchError } = await batchQuery;
  if (batchError) throw batchError;

  const batchRows = (batches ?? []) as ImportBatchRow[];
  const batchIds = batchRows.map((row) => row.id);

  const { data: rows, error: rowsError } =
    batchIds.length > 0
      ? await supabase
          .from("customer_import_rows")
          .select("*")
          .in("import_batch_id", batchIds)
          .order("created_at", { ascending: false })
          .limit(250)
      : { data: [], error: null };

  if (rowsError) throw rowsError;

  const importRows = (rows ?? []) as ImportRow[];
  const rowsByBatch = new Map<string, ImportRow[]>();
  for (const row of importRows) {
    const bucket = rowsByBatch.get(row.import_batch_id) ?? [];
    bucket.push(row);
    rowsByBatch.set(row.import_batch_id, bucket);
  }

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Importgranskning"
        subtitle="Granska osäkra bulk- och PDF-rader innan de skapar kunder, avtal och fullmakter."
        userEmail={authResult.user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/customers/intake"
            className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
          >
            Ny import
          </Link>
          <Link
            href="/admin/customers"
            className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 "
          >
            Kundregister
          </Link>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
          <h2 className="text-lg font-semibold text-slate-950 ">
            Manuell granskningskö
          </h2>
          <p className="mt-1 text-sm text-slate-700 ">
            Rader med låg parser-confidence, saknade fält eller
            dubblettmisstanke skapas inte automatiskt. De ligger kvar här som
            spårbar importkö.
          </p>
        </section>

        <div className="space-y-5">
          {batchRows.length === 0 ? (
            <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-700 ">
              Inga importer finns ännu.
            </section>
          ) : (
            batchRows.map((batch) => {
              const bucket = rowsByBatch.get(batch.id) ?? [];
              const totalRows =
                batch.total_rows ?? batch.rows_total ?? bucket.length;
              const createdRows =
                batch.created_rows ??
                batch.rows_created ??
                bucket.filter((row) => row.status === "created").length;
              const failedRows =
                batch.failed_rows ??
                batch.rows_failed ??
                bucket.filter((row) => row.status === "failed").length;
              const reviewRows = bucket.filter((row) =>
                [
                  "requires_review",
                  "missing_fields",
                  "duplicate_warning",
                ].includes(row.status),
              ).length;

              return (
                <section
                  key={batch.id}
                  className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm "
                >
                  <div className="border-b border-slate-200 bg-slate-50 px-6 py-5 ">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-slate-950 ">
                          {batch.file_name ?? "Klistrat underlag"}
                        </h3>
                        <p className="mt-1 text-sm text-slate-700 ">
                          {batch.source_kind ?? batch.source_type ?? "underlag"}{" "}
                          · {formatDateTime(batch.created_at)}
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(batch.status)}`}
                      >
                        {rowStatusLabel(batch.status)}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-4">
                      <div className="rounded-2xl bg-white px-4 py-3 text-sm">
                        <div className="text-slate-700">Rader</div>
                        <div className="font-semibold text-slate-950">
                          {totalRows}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-white px-4 py-3 text-sm">
                        <div className="text-slate-700">Skapade</div>
                        <div className="font-semibold text-slate-950">
                          {createdRows}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-white px-4 py-3 text-sm">
                        <div className="text-slate-700">Granskning</div>
                        <div className="font-semibold text-slate-950">
                          {reviewRows}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-white px-4 py-3 text-sm">
                        <div className="text-slate-700">Fel</div>
                        <div className="font-semibold text-slate-950">
                          {failedRows}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="divide-y divide-slate-200 ">
                    {bucket.length === 0 ? (
                      <div className="p-6 text-sm text-slate-700 ">
                        Inga radposter finns för importen.
                      </div>
                    ) : (
                      bucket.map((row) => (
                        <article
                          key={row.id}
                          className="grid gap-3 px-6 py-4 text-sm xl:grid-cols-[90px_180px_140px_minmax(0,1fr)_210px]"
                        >
                          <div className="font-medium text-slate-700">
                            Rad {row.row_number}
                          </div>
                          <div>
                            <span
                              className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(row.status)}`}
                            >
                              {rowStatusLabel(row.status)}
                            </span>
                          </div>
                          <div className="text-slate-700">
                            Confidence: {row.parser_confidence ?? "—"}%
                          </div>
                          <div className="space-y-2 text-slate-700">
                            <div>{issueText(row)}</div>
                            {row.normalized_payload ? (
                              <details className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                                <summary className="cursor-pointer font-semibold text-slate-700">
                                  Visa normaliserad rad
                                </summary>
                                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-slate-700">
                                  {JSON.stringify(
                                    row.normalized_payload,
                                    null,
                                    2,
                                  )}
                                </pre>
                              </details>
                            ) : null}
                          </div>
                          <div className="space-y-2">
                            {row.customer_id ? (
                              <Link
                                href={`/admin/customers/${row.customer_id}`}
                                className="inline-flex rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 font-semibold text-emerald-800 hover:bg-emerald-100"
                              >
                                Öppna kund
                              </Link>
                            ) : ["created", "rejected"].includes(row.status) ? (
                              <span className="text-slate-500">
                                Ingen åtgärd
                              </span>
                            ) : (
                              <>
                                <form
                                  action={createCustomerFromImportRowAction}
                                >
                                  <input
                                    type="hidden"
                                    name="importRowId"
                                    value={row.id}
                                  />
                                  <button className="w-full rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">
                                    Skapa kund från rad
                                  </button>
                                </form>
                                <form
                                  action={linkCustomerImportRowToExistingCustomerAction}
                                  className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-2"
                                >
                                  <input
                                    type="hidden"
                                    name="importRowId"
                                    value={row.id}
                                  />
                                  <input
                                    name="existingCustomerId"
                                    placeholder="Befintligt kund-id"
                                    className="w-full rounded-xl border border-amber-300 px-3 py-2 text-xs"
                                  />
                                  <select
                                    name="duplicateResolution"
                                    defaultValue="add_site_to_existing"
                                    className="w-full rounded-xl border border-amber-300 px-3 py-2 text-xs"
                                  >
                                    <option value="add_site_to_existing">Koppla: lägg till anläggning</option>
                                    <option value="add_contract_to_existing">Koppla: lägg till avtal</option>
                                    <option value="update_existing">Uppdatera befintlig kund</option>
                                  </select>
                                  <button className="w-full rounded-xl bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700">
                                    Koppla till befintlig kund
                                  </button>
                                </form>
                                <form
                                  action={rejectCustomerImportRowAction}
                                  className="space-y-2"
                                >
                                  <input
                                    type="hidden"
                                    name="importRowId"
                                    value={row.id}
                                  />
                                  <input
                                    name="reason"
                                    placeholder="Orsak vid avvisning"
                                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
                                  />
                                  <button className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-100">
                                    Avvisa rad
                                  </button>
                                </form>
                              </>
                            )}
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
