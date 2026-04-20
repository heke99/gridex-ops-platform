//components/admin/customers/contracts/CustomerContractsCard.tsx
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { listOutboundRequestsByCustomerId } from '@/lib/cis/db'
import {
  listContractOffers,
  listCustomerContractEventsByCustomerId,
  listCustomerContractsByCustomerId,
} from '@/lib/customer-contracts/db'
import type { CustomerContractRow } from '@/lib/customer-contracts/types'
import { listCustomerSitesByCustomerId } from '@/lib/masterdata/db'
import { listSupplierSwitchRequestsByCustomerId } from '@/lib/operations/db'
import {
  contractTypeLabel,
  formatDateTime,
  formatNumber,
  getContractSituation,
  getContractUiRecommendations,
  getCurrentContract,
  getLifecycleSummary,
  getSiteLabel,
  greenFeeLabel,
  statusLabel,
  statusTone,
  terminationReasonLabel,
  type ContractUiRecommendation,
} from './helpers'
import {
  CreateFromOfferForm,
  CreateManualContractForm,
  EditContractForm,
} from './ContractForms'

function ContractLifecyclePill({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'warning' | 'success' | 'danger'
}) {
  const toneClass =
    tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300'
      : tone === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300'
        : tone === 'danger'
          ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300'
          : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'

  return (
    <div className={`rounded-2xl border px-3 py-2 text-xs ${toneClass}`}>
      <div className="uppercase tracking-[0.12em] opacity-70">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  )
}

function RecommendationCard({
  recommendation,
}: {
  recommendation: ContractUiRecommendation
}) {
  const toneClass =
    recommendation.tone === 'warning'
      ? 'border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20'
      : recommendation.tone === 'success'
        ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/20'
        : recommendation.tone === 'danger'
          ? 'border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-950/20'
          : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950'

  return (
    <div className={`rounded-2xl border px-4 py-4 ${toneClass}`}>
      <div className="text-sm font-semibold text-slate-900 dark:text-white">
        {recommendation.title}
      </div>
      <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        {recommendation.description}
      </div>
      <div className="mt-3">
        <Link
          href={recommendation.href}
          className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {recommendation.ctaLabel}
        </Link>
      </div>
    </div>
  )
}

export default async function CustomerContractsCard({
  customerId,
}: {
  customerId: string
}) {
  const supabase = await createSupabaseServerClient()

  const [contracts, events, sites, offers, switchRequests, outboundRequests] = await Promise.all([
    listCustomerContractsByCustomerId(customerId),
    listCustomerContractEventsByCustomerId(customerId),
    listCustomerSitesByCustomerId(supabase, customerId),
    listContractOffers(),
    listSupplierSwitchRequestsByCustomerId(supabase, customerId),
    listOutboundRequestsByCustomerId(customerId),
  ])

  const activeOffers = offers.filter((offer) => offer.is_active && offer.status === 'active')

  const siteOptions = sites.map((site) => ({
    id: site.id,
    label: site.facility_id ? `${site.site_name} • ${site.facility_id}` : site.site_name,
  }))

  const siteLabelsById = new Map(siteOptions.map((site) => [site.id, site.label] as const))
  const currentContract = getCurrentContract(contracts)
  const currentLifecycle = currentContract ? getLifecycleSummary(currentContract) : null
  const currentSituation = currentContract ? getContractSituation(currentContract) : null
  const currentRecommendations = currentContract
    ? getContractUiRecommendations(currentContract, customerId)
    : []

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
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div>
                  <div className="text-xs uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                    {currentContract.status === 'active'
                      ? 'Aktivt huvudavtal'
                      : 'Senast relevanta avtal'}
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
                    <span
                      className={`rounded-full border px-3 py-1 ${statusTone(
                        currentContract.status
                      )}`}
                    >
                      {statusLabel(currentContract.status)}
                    </span>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                    <div className="text-slate-500 dark:text-slate-400">
                      Aktiva / relevanta avtal
                    </div>
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
                            contract.status === 'pending_signature' ||
                            contract.status === 'signed'
                        ).length
                      }
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                    <div className="text-slate-500 dark:text-slate-400">Senaste uppdatering</div>
                    <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">
                      {formatDateTime(currentContract.updated_at)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-950">
                <div className="text-xs uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                  Operativ sammanfattning
                </div>

                <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
                  {currentSituation?.title}
                </div>

                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {currentSituation?.description}
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <ContractLifecyclePill
                    label="Bindningstid"
                    value={
                      currentContract.binding_months !== null
                        ? `${currentContract.binding_months} mån`
                        : '—'
                    }
                    tone={currentLifecycle?.bindingActive ? 'warning' : 'neutral'}
                  />
                  <ContractLifecyclePill
                    label="Uppsägningstid"
                    value={
                      currentContract.notice_months !== null
                        ? `${currentContract.notice_months} mån`
                        : '—'
                    }
                  />
                  <ContractLifecyclePill
                    label="Uppsägning mottagen"
                    value={formatDateTime(currentContract.termination_notice_date)}
                    tone={currentLifecycle?.terminationPending ? 'warning' : 'neutral'}
                  />
                  <ContractLifecyclePill
                    label="Aktuellt slutdatum"
                    value={formatDateTime(currentLifecycle?.effectiveEndDate ?? null)}
                    tone={
                      currentContract.status === 'terminated' ||
                      currentContract.status === 'cancelled'
                        ? 'danger'
                        : 'neutral'
                    }
                  />
                  <ContractLifecyclePill
                    label="Nuvarande avtalsperiod"
                    value={`${formatDateTime(currentLifecycle?.currentTermStart ?? null)} → ${formatDateTime(
                      currentLifecycle?.currentTermEnd ?? null
                    )}`}
                  />
                  <ContractLifecyclePill
                    label="Nästa förlängningsdatum"
                    value={formatDateTime(currentLifecycle?.nextRenewalDate ?? null)}
                    tone={currentContract.auto_renew_enabled ? 'success' : 'neutral'}
                  />
                </div>
              </div>

              {currentRecommendations.length > 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
                  <div className="text-xs uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                    Rekommenderade nästa steg
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {currentRecommendations.map((recommendation) => (
                      <RecommendationCard
                        key={recommendation.id}
                        recommendation={recommendation}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Inget aktuellt kundavtal.
            </div>
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
              const situation = getContractSituation(contract)
              const recommendations = getContractUiRecommendations(contract, customerId)

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

                      <div className="mt-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                        {situation.title}
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
                      <div>Bindningstid: {contract.binding_months ?? '—'} mån</div>
                      <div>Uppsägningstid: {contract.notice_months ?? '—'} mån</div>
                      <div>Start: {formatDateTime(contract.starts_at)}</div>
                      <div>Explicit slut: {formatDateTime(contract.ends_at)}</div>
                    </div>

                    <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950">
                      <div>Signerat: {formatDateTime(contract.signed_at)}</div>
                      <div>{greenFeeLabel(contract.green_fee_mode, contract.green_fee_value)}</div>
                      <div>
                        Uppsägning mottagen: {formatDateTime(contract.termination_notice_date)}
                      </div>
                      <div>
                        Uppsägning orsak: {terminationReasonLabel(contract.termination_reason)}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950">
                      <div>Auto renew: {contract.auto_renew_enabled ? 'Ja' : 'Nej'}</div>
                      <div>Förlängningstid: {contract.auto_renew_term_months ?? '—'} mån</div>
                      <div>
                        Aktuellt slutdatum: {formatDateTime(lifecycle.effectiveEndDate)}
                      </div>
                      <div>
                        Nästa förlängning: {formatDateTime(lifecycle.nextRenewalDate)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 text-xs md:grid-cols-3">
                    <ContractLifecyclePill
                      label="Nuvarande avtalsperiod"
                      value={`${formatDateTime(lifecycle.currentTermStart)} → ${formatDateTime(
                        lifecycle.currentTermEnd
                      )}`}
                    />
                    <ContractLifecyclePill
                      label="Bindning aktiv nu"
                      value={lifecycle.bindingActive ? 'Ja' : 'Nej'}
                      tone={lifecycle.bindingActive ? 'warning' : 'neutral'}
                    />
                    <ContractLifecyclePill
                      label="Uppsägning registrerad"
                      value={lifecycle.terminationPending ? 'Ja' : 'Nej'}
                      tone={lifecycle.terminationPending ? 'warning' : 'neutral'}
                    />
                  </div>

                  {recommendations.length > 0 ? (
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      {recommendations.map((recommendation) => (
                        <RecommendationCard
                          key={recommendation.id}
                          recommendation={recommendation}
                        />
                      ))}
                    </div>
                  ) : null}

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
                    switchRequests={switchRequests}
                    outboundRequests={outboundRequests}
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