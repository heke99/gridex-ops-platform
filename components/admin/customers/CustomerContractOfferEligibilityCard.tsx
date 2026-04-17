import Link from 'next/link'
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

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
  }).format(new Date(value))
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value)
}

function groupLabel(type: ContractOfferRow['contract_type']): string {
  switch (type) {
    case 'fixed':
      return 'Fastpris'
    case 'variable_monthly':
      return 'Rörlig månad'
    case 'variable_hourly':
      return 'Rörlig tim'
    case 'portfolio':
      return 'Portfölj'
    default:
      return 'Övrigt'
  }
}

export default function CustomerContractOfferEligibilityCard({
  customerType,
  offers,
}: {
  customerType: string | null
  offers: ContractOfferRow[]
}) {
  const activeOffers = offers.filter((offer) => offer.is_active && offer.status === 'active')

  const groupedOffers = [
    'fixed',
    'variable_monthly',
    'variable_hourly',
    'portfolio',
  ].map((type) => ({
    type,
    label: groupLabel(type as ContractOfferRow['contract_type']),
    offers: activeOffers.filter((offer) => offer.contract_type === type),
  }))

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Valbara avtalsmallar
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Visar aktiva avtalsmallar som kan användas för denna kund i admin.
          Nuvarande schema i zippen har ingen separat spärrkolumn per kundtyp,
          så listan visar därför alla aktiva valbara mallar för{' '}
          <strong>{customerTypeLabel(customerType)}</strong>.
        </p>
      </div>

      <div className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-100">
        <div className="font-semibold">Nästa steg för admin</div>
        <p className="mt-1">
          Att en mall är valbar betyder inte att kunden redan har ett avtal.
          Själva kundavtalet skapas först i avtalssidan längre ner på kundkortet,
          där det sparas som en riktig post i <code>customer_contracts</code>.
        </p>

        <div className="mt-3 flex flex-wrap gap-3">
          <a
            href="#contracts"
            className="inline-flex items-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950"
          >
            Gå till kundens avtal
          </a>

          <Link
            href="/admin/contracts"
            className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Öppna avtalskatalog
          </Link>
        </div>
      </div>

      {activeOffers.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
          Inga aktiva avtalsmallar hittades.
        </div>
      ) : (
        <div className="space-y-5">
          {groupedOffers
            .filter((group) => group.offers.length > 0)
            .map((group) => (
              <div key={group.type} className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  {group.label}
                </div>

                <div className="space-y-3">
                  {group.offers.map((offer) => (
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

                        {offer.campaign_name ? (
                          <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                            {offer.campaign_name}
                          </span>
                        ) : null}
                      </div>

                      {offer.description ? (
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                          {offer.description}
                        </p>
                      ) : null}

                      <div className="mt-3 grid gap-2 text-sm text-slate-600 dark:text-slate-300 md:grid-cols-2">
                        <div>Månadsavgift: {formatNumber(offer.monthly_fee_sek)} kr</div>
                        <div>Fast pris: {formatNumber(offer.fixed_price_ore_per_kwh)} öre/kWh</div>
                        <div>Påslag: {formatNumber(offer.spot_markup_ore_per_kwh)} öre/kWh</div>
                        <div>Rörlig avgift: {formatNumber(offer.variable_fee_ore_per_kwh)} öre/kWh</div>
                        <div>Bindningstid: {offer.default_binding_months ?? '—'} mån</div>
                        <div>Uppsägningstid: {offer.default_notice_months ?? '—'} mån</div>
                        <div>Gäller från: {formatDate(offer.valid_from)}</div>
                        <div>Gäller till: {formatDate(offer.valid_to)}</div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-3">
                        <a
                          href="#contracts"
                          className="inline-flex items-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950"
                        >
                          Skapa kundavtal från mall längre ner
                        </a>

                        <Link
                          href="/admin/contracts"
                          className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          Hantera mall i katalogen
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </section>
  )
}