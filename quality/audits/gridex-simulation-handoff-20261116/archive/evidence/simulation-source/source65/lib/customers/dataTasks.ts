import { supabaseService } from "@/lib/supabase/service";


function missingSchema(error: unknown): boolean {
  const code = String((error as { code?: string } | null)?.code ?? "")
  const message = String((error as { message?: string } | null)?.message ?? "")
  return ["42P01", "42703", "PGRST205"].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

async function hasOpenTask(input: {
  table: "customer_data_tasks" | "customer_operation_tasks";
  companyId: string;
  customerId: string;
  customerSiteId?: string | null;
  meteringPointId?: string | null;
  taskType: string;
}) {
  const siteColumn = input.table === "customer_data_tasks" ? "customer_site_id" : "site_id"
  let query = supabaseService
    .from(input.table)
    .select("id")
    .eq("company_id", input.companyId)
    .eq("customer_id", input.customerId)
    .eq("task_type", input.taskType)
    .in("status", ["open", "in_progress", "blocked", "pending_review"])
    .limit(1)

  query = input.customerSiteId ? query.eq(siteColumn, input.customerSiteId) : query.is(siteColumn, null)
  query = input.meteringPointId ? query.eq("metering_point_id", input.meteringPointId) : query.is("metering_point_id", null)

  const { data, error } = await query
  if (error) {
    if (missingSchema(error)) return false
    throw error
  }
  return Boolean(data?.length)
}

export type CustomerDataTaskType =
  | "missing_facility_id"
  | "missing_metering_point"
  | "missing_grid_owner"
  | "grid_owner_review_required"
  | "invoice_review_required"
  | "contact_customer"
  | "contact_grid_owner"
  | "request_customer_completion";

export async function createCustomerDataTask(input: {
  companyId: string;
  customerId: string;
  customerSiteId?: string | null;
  meteringPointId?: string | null;
  taskType: CustomerDataTaskType;
  description: string;
  actorUserId?: string | null;
  priority?: "low" | "normal" | "high";
}): Promise<void> {
  if (await hasOpenTask({ table: "customer_data_tasks", ...input })) return
  if (await hasOpenTask({ table: "customer_operation_tasks", ...input })) return

  const payload = {
    company_id: input.companyId,
    customer_id: input.customerId,
    customer_site_id: input.customerSiteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    task_type: input.taskType,
    status: "open",
    priority: input.priority ?? "normal",
    description: input.description,
    created_by: input.actorUserId ?? null,
    updated_by: input.actorUserId ?? null,
  };

  const { error } = await supabaseService
    .from("customer_data_tasks")
    .insert(payload);
  if (!error) return;

  if (!missingSchema(error)) {
    console.warn(
      "[customerDataTasks] Kunde inte skapa customer_data_tasks",
      error,
    );
  }

  const fallback = {
    company_id: input.companyId,
    customer_id: input.customerId,
    site_id: input.customerSiteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    task_type: input.taskType,
    status: "open",
    priority: input.priority ?? "normal",
    title: input.description.slice(0, 140),
    description: input.description,
    metadata: {
      source: "customer_data_tasks_fallback",
      taskType: input.taskType,
    },
    created_by: input.actorUserId ?? null,
    updated_by: input.actorUserId ?? null,
  };

  const { error: fallbackError } = await supabaseService
    .from("customer_operation_tasks")
    .insert(fallback);
  if (fallbackError)
    console.warn(
      "[customerDataTasks] Kunde inte skapa fallback customer_operation_tasks",
      fallbackError,
    );
}

export async function createMissingCustomerDataTasks(input: {
  companyId: string;
  customerId: string;
  customerSiteId?: string | null;
  meteringPointId?: string | null;
  facilityId?: string | null;
  meterPointId?: string | null;
  gridOwnerId?: string | null;
  actorUserId?: string | null;
}): Promise<void> {
  const tasks: Array<Promise<void>> = [];

  if (!input.gridOwnerId) {
    tasks.push(
      createCustomerDataTask({
        companyId: input.companyId,
        customerId: input.customerId,
        customerSiteId: input.customerSiteId ?? null,
        meteringPointId: input.meteringPointId ?? null,
        taskType: "missing_grid_owner",
        priority: "high",
        description:
          "Saknar vald nätägare. Välj nätägare innan Ediel kan skickas.",
        actorUserId: input.actorUserId ?? null,
      }),
    );
  }

  if (!input.facilityId && !input.meterPointId) {
    tasks.push(
      createCustomerDataTask({
        companyId: input.companyId,
        customerId: input.customerId,
        customerSiteId: input.customerSiteId ?? null,
        meteringPointId: input.meteringPointId ?? null,
        taskType: "missing_facility_id",
        priority: "high",
        description:
          "Saknar anläggnings-ID/mätpunkts-ID. Kunden kan sparas men Ediel som kräver anläggning blockeras tills uppgiften är kompletterad.",
        actorUserId: input.actorUserId ?? null,
      }),
    );
  }

  await Promise.all(tasks);
}
