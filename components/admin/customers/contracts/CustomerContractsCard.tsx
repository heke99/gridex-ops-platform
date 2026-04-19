import { createSupabaseServerClient } from '@/lib/supabase/server'
import { listContractOffers, listCustomerContractEventsByCustomerId, listCustomerContractsByCustomerId } from '@/lib/customer-contracts/db'
import type { CustomerContractRow } from '@/lib/customer-contracts/types'
import { listCustomerSitesByCustomerId } from '@/lib/masterdata/db'
import {
  contractTypeLabel,
  formatDateTime,
  formatNumber,
  getCurrentContract,
  getLifecycleSummary,
  getSiteLabel,
  greenFeeLabel,
  statusLabel,
  statusTone,
  terminationReasonLabel,
} from './helpers'
import {
  CreateFromOfferForm,
  CreateManualContractForm,
  EditContractForm,
} from './ContractForms'

export default async function CustomerContractsCard({
  customerId,
}: {
  customerId: string
}) {
  const supabase = await createSupabaseServerClient()

  const [contracts, events, sites, offers] = await Promise.all([
    listCustomerContractsByCustomerId(customerId),
    listCustomerContractEventsByCustomerId(customerId),
    listCustomerSitesByCustomerId(supabase, customerId),
    listContractOffers(),
  ])

  const activeOffers = offers.filter((offer) => offer.is_active && offer.status === 'active')

  const siteOptions = sites.map((site) => ({
    id: site.id,
    label: site.facility_id ? `${site.site_name} • ${site.facility_id}` : site.site_name,
  }))

  const siteLabelsById = new Map(siteOptions.map((site) => [site.id, site.label] as const))
  const currentContract = getCurrentContract(contracts)

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Kundavtal och historik
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Kundavtal sparas som egna poster i kundens avtalsbok. Katalogändringar slår inte retroaktivt på redan registrerade kundavtal.
          </p>
        </div>

        <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
          {currentContract ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  {currentContract.status === 'active' ? 'Aktivt huvudavtal' : 'Senast relevanta avtal'}
                </div>
                <div className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                  {currentContract.contract_name}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
                    {contractTypeLabel(currentContract.contract_type)}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
                    {getSiteLabel(currentContract.site_id, siteLabelsById)}
                  </span>
                  <span className={`rounded-full border px-3 py-1 ${statusTone(currentContract.status)}`}>
                    {statusLabel(currentContract.status)}
                  </span>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                  <div className="text-slate-500 dark:text-slate-400">Aktiva / relevanta avtal</div>
                  <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
                    {contracts.length}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                  <div className="text-slate-500 dark:text-slate-400">Väntar / signerat</div>
                  <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
                    {
                      contracts.filter(
                        (contract) =>
                          contract.status === 'pending_signature' || contract.status === 'signed'
                      ).length
                    }
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                  <div className="text-slate-500 dark:text-slate-400">Senaste uppdatering</div>
                  <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">
                    {currentContract ? formatDateTime(currentContract.updated_at) : '—'}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500 dark:text-slate-400">Inget aktuellt kundavtal.</div>
          )}
        </div>

        {contracts.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            Inget kundavtal registrerat ännu.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {contracts.map((contract: CustomerContractRow) => {
              const contractEvents = events
                .filter((event) => event.customer_contract_id === contract.id)
                .slice(0, 6)

              const lifecycle = getLifecycleSummary(contract)

              return (
                <article key={contract.id} className="p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="font-medium text-slate-900 dark:text-white">
                        {contract.contract_name}
                      </div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {contractTypeLabel(contract.contract_type)} • {contract.source_type} •{' '}
                        {getSiteLabel(contract.site_id, siteLabelsById)}
                      </div>
                      {contract.override_reason ? (
                        <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                          Override: {contract.override_reason}
                        </div>
                      ) : null}
                    </div>

                    <span
                      className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(
                        contract.status
                      )}`}
                    >
                      {statusLabel(contract.status)}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 text-sm text-slate-700 dark:text-slate-300 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950">
                      <div>Fast: {formatNumber(contract.fixed_price_ore_per_kwh)}</div>
                      <div>Påslag: {formatNumber(contract.spot_markup_ore_per_kwh)}</div>
                      <div>Rörlig: {formatNumber(contract.variable_fee_ore_per_kwh)}</div>
                      <div>Mån: {formatNumber(contract.monthly_fee_sek)}</div>
                    </div>

                    <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950">
                      <div>Bindning: {contract.binding_months ?? '—'} mån</div>
                      <div>Uppsägning: {contract.notice_months ?? '—'} mån</div>
                      <div>Start: {formatDateTime(contract.starts_at)}</div>
                      <div>Slut: {formatDateTime(contract.ends_at)}</div>
                    </div>

                    <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950">
                      <div>Signerat: {formatDateTime(contract.signed_at)}</div>
                      <div>{greenFeeLabel(contract.green_fee_mode, contract.green_fee_value)}</div>
                      <div>Uppsägning mottagen: {formatDateTime(contract.termination_notice_date)}</div>
                      <div>Uppsägning orsak: {terminationReasonLabel(contract.termination_reason)}</div>
                    </div>

                    <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950">
                      <div>Auto renew: {contract.auto_renew_enabled ? 'Ja' : 'Nej'}</div>
                      <div>Förlängningstid: {contract.auto_renew_term_months ?? '—'} mån</div>
                      <div>Nuvarande period: {formatDateTime(lifecycle.currentTermStart)} → {formatDateTime(lifecycle.currentTermEnd)}</div>
                      <div>Nästa förlängning: {formatDateTime(lifecycle.nextRenewalDate)}</div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                    {contractEvents.length === 0 ? (
                      'Inga händelser ännu.'
                    ) : (
                      <div className="space-y-1">
                        {contractEvents.map((event) => (
                          <div key={event.id}>
                            <span className="font-medium text-slate-700 dark:text-slate-200">
                              {event.event_type}
                            </span>{' '}
                            • {formatDateTime(event.happened_at)}
                            {event.note ? <span> • {event.note}</span> : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <EditContractForm
                    contract={contract}
                    customerId={customerId}
                    siteOptions={siteOptions}
                  />
                </article>
              )
            })}
          </div>
        )}
      </div>

      <div className="space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">
            Skapa från aktiv avtalsmall
          </div>

          <div className="mt-4 space-y-4">
            {activeOffers.length === 0 ? (
              <div className="text-sm text-slate-500 dark:text-slate-400">
                Inga aktiva avtalsmallar hittades.
              </div>
            ) : (
              activeOffers.map((offer) => (
                <CreateFromOfferForm
                  key={offer.id}
                  customerId={customerId}
                  offer={offer}
                  siteOptions={siteOptions}
                />
              ))
            )}
          </div>
        </div>

        <CreateManualContractForm customerId={customerId} siteOptions={siteOptions} />
      </div>
    </section>
  )
}