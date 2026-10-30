// Decides whether the customer card may open. A customer of another company and a
// customer without company link are answered exactly like an id that does not exist,
// so the page never confirms that an id exists outside the actor's tenant.

export type CustomerCardLookupScope = { isPlatformAdmin: boolean; companyId: string | null };
export type CustomerCardLookupRow = { company_id: string | null; source: string | null };

export type CustomerCardLookupOutcome =
  | { kind: "ok"; companyId: string }
  | { kind: "not_found" }
  | { kind: "no_active_company" }
  | { kind: "ediel_portal_test" };

export function resolveCustomerCardLookup(
  scope: CustomerCardLookupScope,
  customer: CustomerCardLookupRow | null,
): CustomerCardLookupOutcome {
  if (!scope.isPlatformAdmin && !scope.companyId) return { kind: "no_active_company" };
  if (!customer || !customer.company_id) return { kind: "not_found" };
  if (!scope.isPlatformAdmin && customer.company_id !== scope.companyId) return { kind: "not_found" };
  if (customer.source === "ediel_portal_test") return { kind: "ediel_portal_test" };
  return { kind: "ok", companyId: customer.company_id };
}
