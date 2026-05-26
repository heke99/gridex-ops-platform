import { isPlatformAdminContext, type GuardResult } from "@/lib/admin/guards";
import { supabaseService } from "@/lib/supabase/service";
import { requireOperationalCompanyId } from "@/lib/tenant/scope";

type TenantGuard = Pick<
  GuardResult,
  "userId" | "roles" | "permissions" | "isPlatformAdmin"
>;

type CustomerTenantRow = {
  id: string;
  company_id: string | null;
  status: string | null;
};

function assertCompanyId(
  value: string | null | undefined,
  message: string,
): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(message);
  return normalized;
}

export function guardIsPlatformAdmin(guard: TenantGuard): boolean {
  return guard.isPlatformAdmin || isPlatformAdminContext(guard);
}

export async function assertCompanyAccessForGuard(
  companyId: string | null | undefined,
  guard: TenantGuard,
): Promise<string> {
  const normalizedCompanyId = assertCompanyId(
    companyId,
    "Raden saknar bolagskoppling och kan därför inte hanteras säkert.",
  );

  if (guardIsPlatformAdmin(guard)) return normalizedCompanyId;

  const operationalCompanyId = await requireOperationalCompanyId(guard.userId);
  if (operationalCompanyId !== normalizedCompanyId) {
    throw new Error("Du saknar behörighet för valt bolag.");
  }

  return normalizedCompanyId;
}

export async function loadCustomerTenantContext(
  customerId: string,
  guard: TenantGuard,
): Promise<{
  customer: CustomerTenantRow & { company_id: string };
  companyId: string;
}> {
  if (!customerId) throw new Error("Kund saknas.");

  const { data, error } = await supabaseService
    .from("customers")
    .select("id, company_id, status")
    .eq("id", customerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Kunden hittades inte.");

  const customer = data as CustomerTenantRow;
  const companyId = await assertCompanyAccessForGuard(
    customer.company_id,
    guard,
  );

  return {
    customer: { ...customer, company_id: companyId },
    companyId,
  };
}

export async function assertCustomerSiteTenant(params: {
  companyId: string;
  customerId: string;
  siteId: string | null | undefined;
}) {
  if (!params.siteId) return null;

  const { data, error } = await supabaseService
    .from("customer_sites")
    .select("id, company_id, customer_id, grid_owner_id")
    .eq("id", params.siteId)
    .eq("company_id", params.companyId)
    .eq("customer_id", params.customerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Anläggningen tillhör inte kunden eller bolaget.");
  return data as {
    id: string;
    company_id: string;
    customer_id: string;
    grid_owner_id: string | null;
  };
}

export async function assertMeteringPointTenant(params: {
  companyId: string;
  customerId: string;
  siteId?: string | null;
  meteringPointId: string | null | undefined;
}) {
  if (!params.meteringPointId) return null;

  let query = supabaseService
    .from("metering_points")
    .select("id, company_id, customer_id, site_id, grid_owner_id")
    .eq("id", params.meteringPointId)
    .eq("company_id", params.companyId);

  if (params.siteId) query = query.eq("site_id", params.siteId);

  const { data, error } = await query.maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Mätpunkten tillhör inte kunden eller bolaget.");

  const row = data as {
    id: string;
    company_id: string;
    customer_id?: string | null;
    site_id: string | null;
    grid_owner_id: string | null;
  };

  if (row.customer_id && row.customer_id !== params.customerId) {
    throw new Error("Mätpunkten tillhör inte kunden eller bolaget.");
  }

  return row;
}

export async function assertContractTenant(params: {
  companyId: string;
  customerId: string;
  contractId: string | null | undefined;
}) {
  if (!params.contractId) return null;

  const { data, error } = await supabaseService
    .from("customer_contracts")
    .select("id, company_id, customer_id")
    .eq("id", params.contractId)
    .eq("company_id", params.companyId)
    .eq("customer_id", params.customerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Avtalet tillhör inte kunden eller bolaget.");
  return data as { id: string; company_id: string; customer_id: string };
}

export async function assertPowerOfAttorneyTenant(params: {
  companyId: string;
  customerId: string;
  powerOfAttorneyId: string | null | undefined;
}) {
  if (!params.powerOfAttorneyId) return null;

  const { data, error } = await supabaseService
    .from("powers_of_attorney")
    .select("id, company_id, customer_id, status")
    .eq("id", params.powerOfAttorneyId)
    .eq("company_id", params.companyId)
    .eq("customer_id", params.customerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Fullmakten tillhör inte kunden eller bolaget.");
  return data as {
    id: string;
    company_id: string;
    customer_id: string;
    status: string | null;
  };
}

export async function assertBillingUnderlayTenant(params: {
  companyId: string;
  customerId: string;
  billingUnderlayId: string | null | undefined;
}) {
  if (!params.billingUnderlayId) return null;

  const { data, error } = await supabaseService
    .from("billing_underlays")
    .select("id, company_id, customer_id")
    .eq("id", params.billingUnderlayId)
    .eq("company_id", params.companyId)
    .eq("customer_id", params.customerId)
    .maybeSingle();

  if (error) throw error;
  if (!data)
    throw new Error(
      "Faktureringsunderlaget tillhör inte kunden eller bolaget.",
    );
  return data as { id: string; company_id: string; customer_id: string };
}
