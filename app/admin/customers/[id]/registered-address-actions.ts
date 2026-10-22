"use server";

// FINDINGS F51 (owner decision 2026-10-22): staff enter or correct the customer's own registered address
// (folkbokföringsadress; for an organisation its registered address) on the customer card. The protected
// Ediel masterdata rule uses that single current `registered` row for Z01; a facility or invoice address is
// never used instead. The shared writer keeps the previous address as history.
import { revalidatePath } from "next/cache";

import { requireAdminActionAccess } from "@/lib/admin/guards";
import { recordRegisteredAddress, validateRegisteredAddress } from "@/lib/customers/registeredAddress";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { requireCompanyOperationalForWrites } from "@/lib/tenant/governance";
import { requireOperationalCompanyId } from "@/lib/tenant/scope";
import { insertAuditLog } from "@/app/admin/customers/actions.part-1";

export type RegisteredAddressField = "street" | "street2" | "postalCode" | "city";

export type RegisteredAddressActionState = {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors: Partial<Record<RegisteredAddressField, string>>;
};

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

function refused(message: string): RegisteredAddressActionState {
  return { status: "error", message, fieldErrors: {} };
}

export async function saveCustomerRegisteredAddressAction(
  _previous: RegisteredAddressActionState,
  formData: FormData,
): Promise<RegisteredAddressActionState> {
  let actorUserId: string;
  let companyId: string;
  try {
    // The same permission that lets staff enter the address at manual intake.
    await requireAdminActionAccess({ allOf: ["customers.write"] });
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return refused("Du saknar behörighet för den här åtgärden.");
    actorUserId = user.id;
    // The staff member's own active company; the customer must belong to it.
    companyId = await requireOperationalCompanyId(actorUserId);
    await requireCompanyOperationalForWrites(companyId);
  } catch {
    return refused("Du saknar behörighet för den här åtgärden.");
  }

  const customerId = text(formData, "customer_id");
  if (!customerId) return refused("Kund-id saknas.");
  const address = {
    street: text(formData, "street"),
    street2: text(formData, "street2") || null,
    postalCode: text(formData, "postal_code"),
    city: text(formData, "city"),
    country: "SE",
  };
  const fieldErrors = validateRegisteredAddress(address);
  delete fieldErrors.country;
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: "Kontrollera adressen.", fieldErrors };
  }

  const { data: customer, error: customerError } = await supabaseService
    .from("customers")
    .select("id")
    .eq("company_id", companyId)
    .eq("id", customerId)
    .maybeSingle();
  if (customerError) {
    console.error("[customer-card] customer lookup failed", customerError);
    return refused("Adressen kunde inte sparas. Försök igen.");
  }
  if (!customer?.id) return refused("Kunden finns inte i ditt bolag.");

  let result: Awaited<ReturnType<typeof recordRegisteredAddress>>;
  try {
    result = await recordRegisteredAddress({
      companyId,
      customerId,
      address,
      source: "staff_entry",
      actorUserId,
      declaredAt: new Date().toISOString(),
      reference: `customer_card:${customerId}`,
    });
  } catch (error) {
    console.error("[customer-card] registered address not saved", error);
    return refused("Adressen kunde inte sparas. Försök igen.");
  }

  if (result.status !== "unchanged") {
    await insertAuditLog({
      actorUserId,
      companyId,
      entityType: "customer_address",
      entityId: result.addressId,
      action: result.status === "replaced" ? "customer_registered_address_replaced" : "customer_registered_address_created",
      newValues: { type: "registered", ...address },
      metadata: { customerId, registeredAddressSource: "staff_entry", source: "customer_card" },
    }).catch((error) => console.error("[customer-card] registered address audit failed", error));
  }
  revalidatePath(`/admin/customers/${customerId}`);
  return {
    status: "success",
    message: result.status === "unchanged"
      ? "Adressen är redan registrerad."
      : result.status === "replaced"
        ? "Folkbokföringsadressen uppdaterades. Den tidigare adressen finns kvar i historiken."
        : "Folkbokföringsadressen sparades.",
    fieldErrors: {},
  };
}
