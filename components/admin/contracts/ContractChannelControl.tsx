"use client";

import {
  publishContractChannelAction,
  unpublishContractChannelAction,
} from "@/app/admin/contracts/actions";

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
        Styr hemsidepublicering
      </summary>
      <p className="mt-2 text-xs leading-5 text-slate-600">
        Intern försäljning aktiveras genom avtalsversionens readiness-kontroll.
        Här styrs endast hemsidekanalen mot samma låsta canonical avtalsversion.
        API-åtkomst och API-klientbehörigheter hanteras separat och exponeras
        inte som en manuell publiceringskanal i denna adminyta.
      </p>
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <strong className="text-xs text-slate-900">Hemsida</strong>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <form action={publishContractChannelAction}>
            <input type="hidden" name="company_id" value={companyId} />
            <input type="hidden" name="id" value={offerId} />
            <input type="hidden" name="channel" value="website" />
            <input type="hidden" name="return_surface" value={surface} />
            <button className="w-full rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800 hover:bg-emerald-100">
              Publicera på hemsidan
            </button>
          </form>
          <form action={unpublishContractChannelAction}>
            <input type="hidden" name="company_id" value={companyId} />
            <input type="hidden" name="id" value={offerId} />
            <input type="hidden" name="channel" value="website" />
            <input type="hidden" name="return_surface" value={surface} />
            <button className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-900 hover:bg-amber-100">
              Avpublicera från hemsida
            </button>
          </form>
        </div>
      </div>
    </details>
  );
}
