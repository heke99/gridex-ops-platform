"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export default function CustomerContractCreatePanel({ offers, manual }: {
  offers: Array<{ id: string; name: string; form: ReactNode }>;
  manual: ReactNode;
}) {
  const [method, setMethod] = useState(offers.length ? "offer" : "manual");
  const [offerId, setOfferId] = useState(offers[0]?.id ?? "");
  const selectedOfferId = offers.some((offer) => offer.id === offerId) ? offerId : (offers[0]?.id ?? "");
  const effectiveMethod = offers.length ? method : "manual";
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    for (const wrapper of root.current?.querySelectorAll<HTMLElement>("[data-offer-panel]") ?? []) {
      if (wrapper.dataset.offerPanel === selectedOfferId) {
        const details = wrapper.querySelector("details");
        if (details) details.open = true;
      }
    }
  }, [selectedOfferId]);
  const selectClass = "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700";
  return (
    <div ref={root} className="space-y-4">
      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold text-slate-600">
          Avtalskälla
          <select aria-label="Avtalskälla" value={effectiveMethod} onChange={(event) => setMethod(event.target.value)} className={selectClass}>
            {offers.length ? <option value="offer">Från aktiv avtalsmall</option> : null}
            <option value="manual">Manuellt avtal</option>
          </select>
        </label>
        {effectiveMethod === "offer" ? <label className="grid gap-1 text-xs font-semibold text-slate-600">
          Avtalsmall
          <select aria-label="Avtalsmall" value={selectedOfferId} onChange={(event) => setOfferId(event.target.value)} className={selectClass}>
            {offers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}
          </select>
        </label> : null}
      </div>
      {offers.map((offer) => <div key={offer.id} data-offer-panel={offer.id} hidden={effectiveMethod !== "offer" || selectedOfferId !== offer.id}>{offer.form}</div>)}
      <div hidden={effectiveMethod !== "manual"}>{manual}</div>
    </div>
  );
}
