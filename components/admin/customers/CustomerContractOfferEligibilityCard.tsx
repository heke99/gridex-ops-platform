import type { ContractOfferRow } from '@/lib/customer-contracts/types'

function contractTypeLabel(value: ContractOfferRow['contract_type']): string {
  switch (value) {
    case 'fixed':
      return 'Fast'
    case 'variable_monthly':
      return 'Rörlig månad'
    case 'variable_hourly':
      return 'Rörlig tim'
    case 'portfolio':
      return 'Portfölj'
    default:
      return value
  }
}

function customerTypeLabel(value: string | null): string {
  if (value === 'business') return 'Företag'
  if (value === 'association') return 'Förening'
  return 'Privat'
}

export default function CustomerContractOfferEligibilityCard({
  customerType,
  offers,
}: {
  customerType: string | null
  offers: ContractOfferRow[]
}) {
  const activeOffers = offers.filter((offer) => offer.is_active && offer.status === 'active')

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Valbara avtalsmallar
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Visar aktiva avtalsmallar som kan väljas för denna kund direkt i admin.
          Nuvarande schema i zippen har ingen separat spärrkolumn per kundtyp, så listan visar därför alla aktiva valbara mallar för <strong>{customerTypeLabel(customerType)}</strong>.
        </p>
      </div>

      {activeOffers.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
          Inga aktiva avtalsmallar hittades.
        </div>
      ) : (
        <div className="space-y-3">
          {activeOffers.map((offer) => (
            <article
              key={offer.id}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-950"
            >
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-semibold text-slate-900 dark:text-white">
                  {offer.name}
                </div>
                <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  Valbar nu
                </span>
                <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {contractTypeLabel(offer.contract_type)}
                </span>
              </div>

              <div className="mt-3 grid gap-2 text-sm text-slate-600 dark:text-slate-300 md:grid-cols-2">
                <div>Månadsavgift: {offer.monthly_fee_sek ?? '—'} kr</div>
                <div>Fast pris: {offer.fixed_price_ore_per_kwh ?? '—'} öre/kWh</div>
                <div>Påslag: {offer.spot_markup_ore_per_kwh ?? '—'} öre/kWh</div>
                <div>Rörlig avgift: {offer.variable_fee_ore_per_kwh ?? '—'} öre/kWh</div>
                <div>Bindningstid: {offer.default_binding_months ?? '—'} mån</div>
                <div>Uppsägningstid: {offer.default_notice_months ?? '—'} mån</div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}