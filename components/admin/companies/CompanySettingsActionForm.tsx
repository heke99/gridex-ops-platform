"use client";

import { startTransition, useActionState, type ReactNode } from "react";
import type { CompanySettingsActionState } from "@/app/admin/company-settings/actions";

const initialState: CompanySettingsActionState = { ok: false, message: "" };

type Props = {
  action: (state: CompanySettingsActionState, formData: FormData) => Promise<CompanySettingsActionState>;
  canWrite: boolean;
  children: ReactNode;
  id?: string;
  className?: string;
};

export default function CompanySettingsActionForm({ action, canWrite, children, id, className }: Props) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form
      id={id}
      action={canWrite ? formAction : undefined}
      className={className}
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (!canWrite || pending) return;
        // Capture values before disabling the fieldset. Dispatch explicitly so
        // a fulfilled validation error does not reset the uncontrolled fields.
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      {!canWrite ? <p className="col-span-full text-sm text-slate-600">Du har läsbehörighet till dessa uppgifter.</p> : null}
      {state.message && !state.ok ? (
        <p
          role="alert"
          className="col-span-full rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"
        >
          {state.message}
        </p>
      ) : null}
      <p
        role="status"
        aria-live="polite"
        className={pending ? "col-span-full text-sm text-slate-600" : state.ok && state.message ? "col-span-full rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" : "sr-only"}
      >
        {pending ? "Sparar ändringar…" : state.ok ? state.message : ""}
      </p>
      <fieldset disabled={pending || !canWrite} className="contents">
        {children}
      </fieldset>
    </form>
  );
}
