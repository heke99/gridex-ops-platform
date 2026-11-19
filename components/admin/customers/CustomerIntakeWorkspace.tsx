"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

export default function CustomerIntakeWorkspace({
  mode,
  manual,
  bulk,
  resetKey = "current",
}: {
  mode: "manual" | "bulk";
  manual: ReactNode;
  bulk: ReactNode;
  resetKey?: string;
}) {
  const router = useRouter();
  const [resetCount, setResetCount] = useState(0);
  return (
    <section className="space-y-4" onClickCapture={(event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('a')?.getAttribute('href') === '/admin/customers/intake?new=1') {
        setResetCount(count => count + 1);
      }
    }}>
      <label className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
        <span className="font-semibold text-slate-900">Registreringssätt</span>
        <select
          aria-label="Registreringssätt"
          value={mode}
          onChange={(event) => router.push(`/admin/customers/intake?mode=${event.target.value === "bulk" ? "bulk" : "manual"}${resetKey === "new" ? "&new=1" : ""}`, { scroll: false })}
          className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 sm:w-auto"
        >
          <option value="manual">Registrera en kund</option>
          <option value="bulk">Importera flera kunder</option>
        </select>
      </label>
      <div key={`manual:${resetKey}:${resetCount}`} hidden={mode !== "manual"}>{manual}</div>
      <div key={`bulk:${resetKey}:${resetCount}`} hidden={mode !== "bulk"}>{bulk}</div>
    </section>
  );
}
