import {
  getCustomerPortalContext,
  listPortalContracts,
} from "@/lib/customer-portal/db";
import { formatDate, formatSek } from "@/lib/customer-portal/format";

export const dynamic = "force-dynamic";

function contractStatusLabel(status: string | null) {
  const map: Record<string, string> = {
    draft: "Utkast",
    pending_signature: "Väntar på signering",
    signed: "Signerat",
    active: "Aktivt",
    terminated: "Avslutat",
    expired: "Utgånget",
  };
  return map[String(status ?? "")] ?? status ?? "Okänd status";
}

export default async function PortalContractsPage() {
  const context = await getCustomerPortalContext();
  const contracts = await listPortalContracts(context);

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">
          Mina avtal
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Här ser du elavtal som är kopplade till ditt kundkonto. Statusen
          uppdateras löpande och kan användas som underlag vid frågor till kundtjänst.
        </p>
      </section>

      <section className="space-y-4">
        {contracts.map((contract) => (
          <article
            key={contract.id}
            className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">
                  {contract.contract_name ?? "Elavtal"}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {contract.contract_type ?? "Avtalstyp saknas"} · Start{" "}
                  {formatDate(contract.starts_at)} · Slut{" "}
                  {formatDate(contract.ends_at)}
                </p>
              </div>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                {contractStatusLabel(contract.status)}
              </span>
            </div>

            <div className="mt-5 grid gap-3 text-sm text-slate-600 md:grid-cols-4">
              <div>
                Månadsavgift:{" "}
                <strong>{formatSek(contract.monthly_fee_sek)}</strong>
              </div>
              <div>
                Påslag:{" "}
                <strong>
                  {contract.spot_markup_ore_per_kwh ??
                    contract.variable_fee_ore_per_kwh ??
                    "—"}{" "}
                  öre/kWh
                </strong>
              </div>
              <div>
                Fast pris:{" "}
                <strong>
                  {contract.fixed_price_ore_per_kwh ?? "—"} öre/kWh
                </strong>
              </div>
              <div>
                Bindningstid:{" "}
                <strong>{contract.binding_months ?? "—"} mån</strong>
              </div>
            </div>
          </article>
        ))}

        {contracts.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            Inga avtal är kopplade till ditt kundkonto ännu.
          </div>
        ) : null}
      </section>
    </div>
  );
}
