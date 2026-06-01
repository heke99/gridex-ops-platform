import { supabaseService } from "@/lib/supabase/service";

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

  const code = String((error as { code?: string }).code ?? "");
  if (!["42P01", "42703", "PGRST205"].includes(code)) {
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
