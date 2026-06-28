// Shared action-state contract for customer-card server actions. This lives in a
// plain module (NOT a "use server" file) so it can export the type and the idle
// constant — a "use server" module may only export async functions.

export type CustomerActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  code?: string;
};

export const IDLE_CUSTOMER_ACTION_STATE: CustomerActionState = {
  status: "idle",
};
