"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export default function CustomerIntakeWorkspace({
  mode,
  manual,
  bulk,
}: {
  mode: "manual" | "bulk";
  manual: ReactNode;
  bulk: ReactNode;
}) {
  const router = useRouter();
  return (
    <section className="space-y-4">
      <label className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
        <span className="font-semibold text-slate-900">Registreringssätt</span>
        <select
          aria-label="Registreringssätt"
          value={mode}
          onChange={(event) => router.push(`/admin/customers/intake?mode=${event.target.value === "bulk" ? "bulk" : "manual"}`, { scroll: false })}
          className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 sm:w-auto"
        >
          <option value="manual">Registrera en kund</option>
          <option value="bulk">Importera flera kunder</option>
        </select>
      </label>
      <div hidden={mode !== "manual"}>{manual}</div>
      <div hidden={mode !== "bulk"}>{bulk}</div>
    </section>
  );
}
