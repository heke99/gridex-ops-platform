import Link from "next/link";
import { portalContractTypeLabel } from "@/lib/customer-portal/labels";
import {
  getCustomerPortalContext,
  getPortalSelectedSite,
  listPortalContracts,
  listPortalSites,
} from "@/lib/customer-portal/db";
import { listPortalContractNoticeDates } from "@/lib/customer-portal/contractNoticeDates";
import { formatDate, formatSek } from "@/lib/customer-portal/format";
import type { CustomerPortalSiteRow } from "@/lib/customer-portal/types";

export const dynamic = "force-dynamic";

function contractStatusLabel(status: string | null) {
  const map: Record<string, string> = {
    draft: "Utkast",
    pending_signature: "Väntar på signering",
    signature_failed: "Signering misslyckades – försök igen",
    signed: "Signerat",
    active: "Aktivt",
    terminated: "Avslutat",
    expired: "Utgånget",
    cancelled: "Avbrutet",
  };
  return map[String(status ?? "")] ?? "Under handläggning";
}

function siteLabel(site: CustomerPortalSiteRow) {
  return [site.street, site.postal_code, site.city].filter(Boolean).join(", ")
    || site.site_name || site.facility_id || "Anläggning";
}

export default async function PortalContractsPage({
  searchParams,
}: {
  searchParams?: Promise<{ site_id?: string | string[] }>;
} = {}) {
  const context = await getCustomerPortalContext();
  const selection = (await searchParams)?.site_id;
  const selectedSite = await getPortalSelectedSite(context, selection);
  const contracts = selection === undefined || selectedSite
    ? await listPortalContracts(context, selectedSite ?? undefined)
    : [];
  const [noticeDates, sites] = await Promise.all([
    listPortalContractNoticeDates(context, contracts).catch(() => null),
    selectedSite ? [selectedSite] : listPortalSites(
      context,
      Array.from(new Set(contracts.flatMap((contract) => contract.site_id ? [contract.site_id] : []))),
    ),
  ]);
  const siteById = new Map(sites.map((site) => [site.id, site]));
  const cards = contracts.map((contract) => {
    const site = contract.site_id ? siteById.get(contract.site_id) : undefined;
    return { contract, site: site?.customer_id === contract.customer_id ? site : null, notice: noticeDates?.get(contract.id) };
  });

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
        {selectedSite ? (
          <p className="mt-3 text-sm font-semibold text-slate-900">{siteLabel(selectedSite)}</p>
        ) : null}
        {selection !== undefined ? (
          <Link href={selectedSite ? "/portal/avtal" : "/portal/anlaggningar"} className="mt-4 inline-block text-sm font-semibold text-slate-900 underline underline-offset-4">
            {selectedSite ? "Visa alla avtal" : "Visa alla anläggningar"}
          </Link>
        ) : null}
      </section>

      <section className="space-y-4">
        {noticeDates === null ? (
          <p role="status" className="text-sm text-slate-600">Uppsägningsuppgifterna kunde inte hämtas. Försök igen.</p>
        ) : null}
        {cards.map(({ contract, site, notice }) => (
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
                  {portalContractTypeLabel(contract.contract_type)} · Start{" "}
                  {formatDate(contract.starts_at)}
                  {contract.ends_at ? <> · Avtalat slut {formatDate(contract.ends_at)}</> : null}
                </p>
                {notice ? (
                  <div className="mt-1 text-sm text-slate-600">
                    <p>Uppsägning mottagen {formatDate(notice.receivedOn)}</p>
                    {notice.plannedEndOn ? <p>Planerat avtalsavslut {formatDate(notice.plannedEndOn)}</p> : null}
                  </div>
                ) : null}
                {site ? (
                  <Link href={`/portal/anlaggningar?site_id=${encodeURIComponent(site.id)}`} prefetch={false} className="mt-2 inline-block text-sm font-semibold text-slate-900 underline underline-offset-4">
                    {siteLabel(site)}
                  </Link>
                ) : null}
              </div>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                {contractStatusLabel(contract.status)}
              </span>
            </div>

            <div className="mt-5 grid gap-3 text-sm text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                Månadsavgift:{" "}
                <strong>{formatSek(contract.monthly_fee_sek)}</strong>
              </div>
              <div>
                Fakturaavgift:{" "}
                <strong>{formatSek(contract.invoice_fee_sek)}</strong>
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
                Startavgift: <strong>{formatSek(contract.start_fee_sek)}</strong>
              </div>
              <div>
                Administrationsavgift:{" "}
                <strong>{formatSek(contract.admin_fee_sek)}</strong>
              </div>
              <div>
                Brytavgift: <strong>{formatSek(contract.break_fee_sek)}</strong>
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
            {selectedSite
              ? "Inga avtal visas för den valda anläggningen."
              : selection !== undefined
                ? "Anläggningen kunde inte öppnas. Välj en anläggning från listan."
                : "Inga avtal är kopplade till ditt kundkonto ännu. Har du nyss tecknat ett avtal kan det ta en liten stund innan det syns här."}
          </div>
        ) : null}
      </section>
    </div>
  );
}
