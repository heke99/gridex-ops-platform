"use client";

import {
  publishContractChannelAction,
  unpublishContractChannelAction,
} from "@/app/admin/contracts/actions";

const CHANNELS = [
  {
    channel: "internal",
    label: "Intern försäljning",
    publishLabel: "Aktivera intern försäljning",
    unpublishLabel: "Pausa intern försäljning",
  },
  {
    channel: "website",
    label: "Hemsida",
    publishLabel: "Publicera på hemsidan",
    unpublishLabel: "Avpublicera från hemsida",
  },
  {
    channel: "api",
    label: "API",
    publishLabel: "Publicera via API",
    unpublishLabel: "Avpublicera från API",
  },
] as const;

export default function ContractChannelControl({
  companyId,
  offerId,
  surface,
}: {
  companyId: string;
  offerId: string;
  surface: "contracts" | "company";
}) {
  return (
    <details className="rounded-xl border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer text-xs font-black text-slate-800">
        Styr försäljningskanaler
      </summary>
      <p className="mt-2 text-xs leading-5 text-slate-600">
        Intern försäljning, hemsida och API styrs separat men pekar alltid på
        samma låsta canonical avtalsversion. Publicering går genom readiness-
        och behörighetskontroller på serversidan.
      </p>
      <div className="mt-3 grid gap-3">
        {CHANNELS.map((entry) => (
          <div
            key={entry.channel}
            className="rounded-xl border border-slate-200 bg-slate-50 p-3"
          >
            <strong className="text-xs text-slate-900">{entry.label}</strong>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <form action={publishContractChannelAction}>
                <input type="hidden" name="company_id" value={companyId} />
                <input type="hidden" name="id" value={offerId} />
                <input type="hidden" name="channel" value={entry.channel} />
                <input type="hidden" name="return_surface" value={surface} />
                <button className="w-full rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800 hover:bg-emerald-100">
                  {entry.publishLabel}
                </button>
              </form>
              <form action={unpublishContractChannelAction}>
                <input type="hidden" name="company_id" value={companyId} />
                <input type="hidden" name="id" value={offerId} />
                <input type="hidden" name="channel" value={entry.channel} />
                <input type="hidden" name="return_surface" value={surface} />
                <button className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-900 hover:bg-amber-100">
                  {entry.unpublishLabel}
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
