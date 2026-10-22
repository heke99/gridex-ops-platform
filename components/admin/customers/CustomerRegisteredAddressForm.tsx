"use client";

import { useActionState } from "react";
import {
  saveCustomerRegisteredAddressAction,
  type RegisteredAddressActionState,
  type RegisteredAddressField,
} from "@/app/admin/customers/[id]/registered-address-actions";

const initialState: RegisteredAddressActionState = { status: "idle", message: null, fieldErrors: {} };

type Current = { street_1: string | null; street_2: string | null; postal_code: string | null; city: string | null } | null;

/** Staff enter or correct the customer's registered address (FINDINGS F51). Facility/invoice addresses are separate. */
export default function CustomerRegisteredAddressForm({ customerId, current }: { customerId: string; current: Current }) {
  const [state, formAction, isPending] = useActionState(saveCustomerRegisteredAddressAction, initialState);
  const field = (name: RegisteredAddressField, formName: string, label: string, value: string | null, extra?: { span?: boolean; placeholder?: string }) => {
    const error = state.fieldErrors[name];
    return (
      <label className={`grid min-w-0 gap-1 text-sm${extra?.span ? " md:col-span-2" : ""}`}>
        <span className="text-slate-700">{label}</span>
        <input
          name={formName}
          defaultValue={value ?? ""}
          placeholder={extra?.placeholder}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `registered-address-error-${name}` : undefined}
          className={`rounded-2xl border px-4 py-3 ${error ? "border-red-500 bg-red-50" : "border-slate-300"}`}
        />
        {error ? <span id={`registered-address-error-${name}`} role="alert" className="text-xs font-medium text-red-600">{error}</span> : null}
      </label>
    );
  };
  return (
    <form action={formAction} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <input type="hidden" name="customer_id" value={customerId} />
      <div className="grid gap-4 md:grid-cols-2">
        {field("street", "street", "Gatuadress", current?.street_1 ?? null, { span: true })}
        {field("street2", "street2", "Adressrad 2 (valfri, t.ex. c/o)", current?.street_2 ?? null, { span: true })}
        {field("postalCode", "postal_code", "Postnummer", current?.postal_code ?? null, { placeholder: "123 45" })}
        {field("city", "city", "Ort", current?.city ?? null)}
      </div>
      {state.message ? (
        <p role={state.status === "error" ? "alert" : "status"} className={`text-sm ${state.status === "error" ? "text-red-700" : "text-emerald-800"}`}>
          {state.message}
        </p>
      ) : null}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {isPending ? "Sparar…" : current ? "Spara ny folkbokföringsadress" : "Spara folkbokföringsadress"}
        </button>
      </div>
    </form>
  );
}
