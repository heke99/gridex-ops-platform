import { supabaseService } from "@/lib/supabase/service";

// Company onboarding readiness checklist.
//
// Readiness is persisted in company_onboarding_tasks (seeded on company
// creation) and recomputed from real data. We never invent Ediel IDs, routes,
// approvals or certificates — a task only flips to 'complete' when the
// underlying real, tenant-scoped data exists.

export type CompanyOnboardingTask = {
  task_key: string;
  title: string;
  category: string;
  environment: string | null;
  status: "pending" | "in_progress" | "complete" | "blocked";
  blocker_reason: string | null;
  next_required_action: string | null;
};

function isMissingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return (
    ["42P01", "42703", "PGRST204", "PGRST205"].includes(code) ||
    /schema cache|does not exist|column .* does not exist|could not find the table/i.test(message)
  );
}

type CountResult = { count: number | null; error: unknown };

// Best-effort count of rows matching a filter. Returns 0 on missing schema so a
// not-yet-migrated table never blocks readiness computation.
async function countRows(run: () => PromiseLike<CountResult>): Promise<number> {
  try {
    const { count, error } = await run();
    if (error) {
      if (isMissingSchema(error)) return 0;
      throw error;
    }
    return count ?? 0;
  } catch (error) {
    if (isMissingSchema(error)) return 0;
    throw error;
  }
}

export async function seedCompanyOnboardingTasks(companyId: string): Promise<void> {
  try {
    const { error } = await supabaseService.rpc("gridex_seed_company_onboarding_tasks", {
      p_company_id: companyId,
    });
    if (error && !isMissingSchema(error)) throw error;
  } catch (error) {
    if (!isMissingSchema(error)) throw error;
  }
}

async function setTaskStatus(
  companyId: string,
  taskKey: string,
  status: CompanyOnboardingTask["status"],
): Promise<void> {
  const { error } = await supabaseService
    .from("company_onboarding_tasks")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("task_key", taskKey);
  if (error && !isMissingSchema(error)) throw error;
}

// Recompute checklist statuses from real tenant data. Idempotent and safe to
// call after onboarding writes (e.g. saving Ediel actor settings or BRP).
export async function recalculateCompanyOnboardingReadiness(
  companyId: string,
): Promise<void> {
  if (!companyId) return;
  // Ensure the checklist exists before we update statuses.
  await seedCompanyOnboardingTasks(companyId);

  const c = () => supabaseService;
  const [
    testActor,
    prodActor,
    brp,
    sharedMailbox,
    companyMailbox,
    testRouteReady,
    prodRouteReady,
    legal,
    apiClients,
  ] = await Promise.all([
    countRows(() =>
      c().from("ediel_actor_settings").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("environment", "test").eq("is_active", true),
    ),
    countRows(() =>
      c().from("ediel_actor_settings").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("environment", "production").eq("is_active", true),
    ),
    countRows(() =>
      c().from("ediel_brp_settings").select("id", { count: "exact", head: true }).eq("company_id", companyId),
    ),
    countRows(() =>
      c().from("ediel_mailboxes").select("id", { count: "exact", head: true }).is("company_id", null),
    ),
    countRows(() =>
      c().from("ediel_mailboxes").select("id", { count: "exact", head: true }).eq("company_id", companyId),
    ),
    countRows(() =>
      c().from("gridex_company_route_readiness_v").select("company_id", { count: "exact", head: true }).eq("company_id", companyId).eq("environment", "test").eq("operational_route_ready", true),
    ),
    countRows(() =>
      c().from("gridex_company_route_readiness_v").select("company_id", { count: "exact", head: true }).eq("company_id", companyId).eq("environment", "production").eq("operational_route_ready", true),
    ),
    countRows(() =>
      c().from("legal_text_versions").select("id", { count: "exact", head: true }).eq("company_id", companyId),
    ),
    countRows(() =>
      c().from("integration_api_clients").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "active"),
    ),
  ]);

  const updates: Array<[string, CompanyOnboardingTask["status"]]> = [
    ["test_ediel_actor_settings", testActor > 0 ? "complete" : "pending"],
    ["production_ediel_actor_settings", prodActor > 0 ? "complete" : "pending"],
    ["brp_settings", brp > 0 ? "complete" : "pending"],
    ["shared_mailbox_transport", sharedMailbox + companyMailbox > 0 ? "complete" : "pending"],
    ["test_route_readiness", testRouteReady > 0 ? "complete" : "pending"],
    ["production_route_readiness", prodRouteReady > 0 ? "complete" : "pending"],
    ["legal_default_package", legal > 0 ? "complete" : "pending"],
    ["api_client_scopes", apiClients > 0 ? "complete" : "pending"],
    ["website_portal_integration", apiClients > 0 ? "complete" : "pending"],
    // Customer automation requires both production sender settings and a ready
    // production route — never auto-complete on partial state.
    ["customer_automation_readiness", prodActor > 0 && prodRouteReady > 0 ? "complete" : "pending"],
  ];

  for (const [taskKey, status] of updates) {
    await setTaskStatus(companyId, taskKey, status);
  }
}

export async function getCompanyOnboardingReadiness(
  companyId: string,
): Promise<{ tasks: CompanyOnboardingTask[]; ready: boolean }> {
  const { data, error } = await supabaseService
    .from("company_onboarding_tasks")
    .select("task_key,title,category,environment,status,blocker_reason,next_required_action")
    .eq("company_id", companyId)
    .order("category", { ascending: true });
  if (error) {
    if (isMissingSchema(error)) return { tasks: [], ready: false };
    throw error;
  }
  const tasks = (data ?? []) as CompanyOnboardingTask[];
  const ready = tasks.length > 0 && tasks.every((task) => task.status === "complete");
  return { tasks, ready };
}
