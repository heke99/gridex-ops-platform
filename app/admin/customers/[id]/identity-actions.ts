"use server";

import { revalidatePath } from "next/cache"
import { tenantSelect } from "@/lib/supabase/tenantQuery"
import { assertUserCanOperateCompany } from "@/lib/tenant/scope"
import {
  IdentityChangeError,
  cancelCustomerIdentityChange,
  requestCustomerIdentityChange,
  type IdentityField,
} from "@/lib/customer-service/identityChange"
import { CustomerActionError, getActorUserId, runCustomerCardAction } from "./profile-actions.part-1"
import type { CustomerActionState } from "./customer-action-state"

function field(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value.trim() : ""
}

/** Loads the customer's tenant and refuses when the form was rendered for another tenant. */
async function resolveCustomerCompany(actorUserId: string, customerId: string, expectedCompanyId: string): Promise<string> {
  if (!customerId) throw new CustomerActionError("missing_customer", "Kund-id saknas.")
  if (!expectedCompanyId) throw new CustomerActionError("tenant_mismatch", "Organisationen saknas i formuläret. Ladda om sidan.")
  // Scoped to the tenant the form was rendered for: a customer of another tenant is simply not found.
  const { data, error } = await tenantSelect(expectedCompanyId, "customers", "company_id").eq("id", customerId).maybeSingle()
  if (error) throw error
  const customerCompanyId = typeof (data as { company_id?: unknown } | null)?.company_id === "string" ? (data as { company_id: string }).company_id : null
  if (!customerCompanyId) throw new CustomerActionError("missing_customer", "Kunden hittades inte.")
  if (expectedCompanyId && expectedCompanyId !== customerCompanyId) {
    throw new CustomerActionError("tenant_mismatch", "Kunden tillhör en annan organisation än den du arbetar i. Ladda om sidan.")
  }
  return assertUserCanOperateCompany(actorUserId, customerCompanyId)
}

function toActionError(error: unknown): never {
  if (error instanceof IdentityChangeError) throw new CustomerActionError(error.code, error.message)
  throw error
}

export async function requestIdentityChangeAction(
  _prevState: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  return runCustomerCardAction(async () => {
    const actorUserId = await getActorUserId()
    const customerId = field(formData, "customer_id")
    const companyId = await resolveCustomerCompany(actorUserId, customerId, field(formData, "expected_company_id"))
    const identityField = field(formData, "field") as IdentityField
    if (identityField !== "personal_number" && identityField !== "org_number") {
      throw new CustomerActionError("identity_field_invalid", "Okänt fält.")
    }
    try {
      const result = await requestCustomerIdentityChange({
        companyId,
        customerId,
        field: identityField,
        newValue: field(formData, "new_value"),
        reason: field(formData, "reason"),
        actorUserId,
      })
      revalidatePath(`/admin/customers/${customerId}`)
      return result.status === "applied"
        ? { status: "success", message: "Numret är ändrat. Ändringen är loggad i historiken." }
        : {
            status: "success",
            message: `Kunden har ${result.contractCount} avtal. Ett godkännandemejl har skickats till ${result.recipientMasked}. Numret ändras först när kunden godkänner.`,
          }
    } catch (error) {
      toActionError(error)
    }
  })
}

export async function cancelIdentityChangeAction(
  _prevState: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  return runCustomerCardAction(async () => {
    const actorUserId = await getActorUserId()
    const customerId = field(formData, "customer_id")
    const companyId = await resolveCustomerCompany(actorUserId, customerId, field(formData, "expected_company_id"))
    try {
      await cancelCustomerIdentityChange({ companyId, requestId: field(formData, "request_id"), actorUserId })
    } catch (error) {
      toActionError(error)
    }
    revalidatePath(`/admin/customers/${customerId}`)
    return { status: "success", message: "Begäran är avbruten. Godkännandelänken fungerar inte längre." }
  })
}
