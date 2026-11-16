"use client";

import { useActionState } from "react";
import {
  requestSupplierSwitchAutomationAction,
  startAutomaticOnboardingAction,
  type CustomerOperationActionState,
} from "@/app/admin/customers/[id]/actions";
import SubmitButton from "@/components/admin/customers/document-card/SubmitButton";

type Kind = "customer_data" | "supplier_switch";

const INITIAL_STATE: CustomerOperationActionState = {
  ok: false,
  status: "idle",
  title: "",
  message: "",
};

function tone(status: CustomerOperationActionState["status"]) {
  if (status === "started") return "border-emerald-200 bg-emerald-50 text-emerald-950";
  if (status === "blocked" || status === "warning") return "border-amber-200 bg-amber-50 text-amber-950";
  return "border-red-200 bg-red-50 text-red-950";
}

export default function CustomerOperationAutomationForm({
  kind,
  customerId,
  siteId,
  meteringPointId,
  idleLabel,
  pendingLabel,
}: {
  kind: Kind;
  customerId: string;
  siteId?: string | null;
  meteringPointId?: string | null;
  idleLabel: string;
  pendingLabel: string;
}) {
  const action = kind === "customer_data"
    ? startAutomaticOnboardingAction
    : requestSupplierSwitchAutomationAction;
  const [state, formAction] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="customer_id" value={customerId} />
      {siteId ? <input type="hidden" name="site_id" value={siteId} /> : null}
      {meteringPointId ? (
        <input type="hidden" name="metering_point_id" value={meteringPointId} />
      ) : null}
      <SubmitButton idleLabel={idleLabel} pendingLabel={pendingLabel} />
      {state.status !== "idle" ? (
        <div aria-live="polite" className={`rounded-2xl border px-3 py-3 text-sm ${tone(state.status)}`}>
          <div className="font-semibold">{state.title}</div>
          <p className="mt-1 leading-5">{state.message}</p>
        </div>
      ) : null}
    </form>
  );
}
