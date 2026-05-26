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
 ? 'border-amber-200 bg-amber-50 text-amber-700 '
 : tone === 'success'
 ? 'border-emerald-200 bg-emerald-50 text-emerald-700 '
 : tone === 'danger'
 ? 'border-red-200 bg-red-50 text-red-700 '
 : 'border-slate-200 bg-slate-50 text-slate-700 '

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
 ? 'border-amber-200 bg-amber-50 '
 : recommendation.tone === 'success'
 ? 'border-emerald-200 bg-emerald-50 '
 : recommendation.tone === 'danger'
 ? 'border-red-200 bg-red-50 '
 : 'border-slate-200 bg-slate-50 '

 return (
 <div className={`rounded-2xl border px-4 py-4 ${toneClass}`}>
 <div className="text-sm font-semibold text-slate-900 ">
 {recommendation.title}
 </div>
 <div className="mt-1 text-sm text-slate-700 ">
 {recommendation.description}
 </div>
 <div className="mt-3">
 <Link
 href={recommendation.href}
 className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 "
 >
 {recommendation.ctaLabel}
 </Link>
 </div>
 </div>
 )
}


function sourceTypeLabel(value: CustomerContractRow['source_type']): string {
 return value === 'catalog' ? 'Avtalsmall' : 'Manuellt avtal'
}

function valueOrDash(value: string | null | undefined): string {
 const trimmed = value?.trim()
 return trimmed ? trimmed : '—'
}

export default async function CustomerContractsCard({
 customerId,
 companyId,
}: {
 customerId: string
 companyId?: string | null
}) {
 const supabase = await createSupabaseServerClient()

 const [contracts, events, sites, offers, switchRequests, outboundRequests] = await Promise.all([
 listCustomerContractsByCustomerId(customerId, { companyId }),
 listCustomerContractEventsByCustomerId(customerId, { companyId, limit: 100 }),
 listCustomerSitesByCustomerId(supabase, customerId, { companyId }),
 listContractOffers({ activeOnly: false, companyId }),
 listSupplierSwitchRequestsByCustomerId(supabase, customerId, { companyId }),
 listOutboundRequestsByCustomerId(customerId, { companyId }),
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
 <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-5 ">
 <h2 className="text-lg font-semibold text-slate-900 ">
 Kundavtal och historik
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Kundavtal sparas som egna poster i kundens avtalsbok. Katalogändringar slår inte retroaktivt på redan registrerade kundavtal.
 </p>
 </div>

 <div className="border-b border-slate-200 px-6 py-5 ">
 {currentContract ? (
 <div className="space-y-4">
 <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
 <div>
 <div className="text-xs uppercase tracking-[0.14em] text-slate-700 ">
 {currentContract.status === 'active'
 ? 'Aktivt huvudavtal'
 : 'Senast relevanta avtal'}
 </div>

 <div className="mt-2 text-xl font-semibold text-slate-950 ">
 {currentContract.contract_name}
 </div>

 <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-700 ">
 <span className="rounded-full bg-slate-100 px-3 py-1 ">
 {contractTypeLabel(currentContract.contract_type)}
 </span>
 <span className="rounded-full bg-slate-100 px-3 py-1 ">
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

 <div className="mt-3 grid gap-2 text-xs text-slate-700 md:grid-cols-2 xl:grid-cols-4">
 <span className="rounded-2xl bg-slate-50 px-3 py-2">Kampanj: {valueOrDash(currentContract.campaign_name)}</span>
 <span className="rounded-2xl bg-slate-50 px-3 py-2">Kampanjversion: {valueOrDash(currentContract.campaign_version)}</span>
 <span className="rounded-2xl bg-slate-50 px-3 py-2">Prisversion: {valueOrDash(currentContract.price_version)}</span>
 <span className="rounded-2xl bg-slate-50 px-3 py-2">Villkor: {valueOrDash(currentContract.terms_version)}</span>
 </div>
 </div>

 <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">
 Aktiva / relevanta avtal
 </div>
 <div className="mt-1 text-xl font-semibold text-slate-950 ">
 {contracts.length}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Väntar / signerat</div>
 <div className="mt-1 text-xl font-semibold text-slate-950 ">
 {
 contracts.filter(
 (contract) =>
 contract.status === 'pending_signature' ||
 contract.status === 'signed'
 ).length
 }
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Senaste uppdatering</div>
 <div className="mt-1 text-sm font-semibold text-slate-950 ">
 {formatDateTime(currentContract.updated_at)}
 </div>
 </div>
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 ">
 <div className="text-xs uppercase tracking-[0.12em] text-slate-700 ">
 Operativ sammanfattning
 </div>

 <div className="mt-2 text-sm font-semibold text-slate-900 ">
 {currentSituation?.title}
 </div>

 <div className="mt-1 text-sm text-slate-700 ">
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
 <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 ">
 <div className="text-xs uppercase tracking-[0.12em] text-slate-700 ">
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
 <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-700 ">
 <div className="font-semibold text-slate-900">Inget aktuellt kundavtal</div>
 <div className="mt-1">Skapa ett avtal för att koppla kunden till kampanj, prisversion, startdatum och faktureringsunderlag.</div>
 </div>
 )}
 </div>

 {contracts.length === 0 ? (
 <div className="p-10 text-center text-sm text-slate-700 ">
 <div className="text-base font-semibold text-slate-900">Inget avtal är registrerat ännu</div>
 <div className="mx-auto mt-2 max-w-xl">Skapa ett avtal för att koppla kunden till kampanj, prisversion, startdatum och nästa steg i leverantörsbytet.</div>
 <div className="mt-4 text-xs text-slate-600">Du kan skapa avtal från en aktiv avtalsmall eller registrera ett manuellt avtal i panelen till höger.</div>
 </div>
 ) : (
 <div className="divide-y divide-slate-200 ">
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
 <div className="font-medium text-slate-900 ">
 {contract.contract_name}
 </div>

 <div className="mt-1 text-xs text-slate-700 ">
 {contractTypeLabel(contract.contract_type)} • {sourceTypeLabel(contract.source_type)} •{' '}
 {getSiteLabel(contract.site_id, siteLabelsById)}
 </div>

 <div className="mt-2 text-xs font-medium text-slate-700 ">
 {situation.title}
 </div>

 {contract.override_reason ? (
 <div className="mt-2 text-xs text-amber-700 ">
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

 <div className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-2 xl:grid-cols-4">
 <div className="rounded-2xl bg-slate-50 px-4 py-3 ">
 <div>Fast: {formatNumber(contract.fixed_price_ore_per_kwh)}</div>
 <div>Påslag: {formatNumber(contract.spot_markup_ore_per_kwh)}</div>
 <div>Rörlig: {formatNumber(contract.variable_fee_ore_per_kwh)}</div>
 <div>Mån: {formatNumber(contract.monthly_fee_sek)}</div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 ">
 <div>Kampanj: {valueOrDash(contract.campaign_name)}</div>
 <div>Kampanjkod: {valueOrDash(contract.campaign_code)}</div>
 <div>Prisversion: {valueOrDash(contract.price_version)}</div>
 <div>Villkor: {valueOrDash(contract.terms_version)}</div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 ">
 <div>Bindningstid: {contract.binding_months ?? '—'} mån</div>
 <div>Uppsägningstid: {contract.notice_months ?? '—'} mån</div>
 <div>Start: {formatDateTime(contract.starts_at)}</div>
 <div>Explicit slut: {formatDateTime(contract.ends_at)}</div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 ">
 <div>Signerat: {formatDateTime(contract.signed_at)}</div>
 <div>{greenFeeLabel(contract.green_fee_mode, contract.green_fee_value)}</div>
 <div>
 Uppsägning mottagen: {formatDateTime(contract.termination_notice_date)}
 </div>
 <div>
 Uppsägning orsak: {terminationReasonLabel(contract.termination_reason)}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 ">
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

 <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-700 ">
 {contractEvents.length === 0 ? (
 'Inga händelser ännu.'
 ) : (
 <div className="space-y-1">
 {contractEvents.map((event) => (
 <div key={event.id}>
 <span className="font-medium text-slate-700 ">
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
 <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm ">
 <div className="text-sm font-semibold text-slate-900 ">
 Skapa från aktiv avtalsmall
 </div>

 <div className="mt-4 space-y-4">
 {activeOffers.length === 0 ? (
 <div className="text-sm text-slate-700 ">
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