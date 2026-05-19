import Link from 'next/link'
import type { CustomerSyncBuildResult, CustomerSyncProfile, CustomerSyncSignal } from '@/lib/operations/customerSync'

type Props = {
 result: CustomerSyncBuildResult
 limit?: number
}

function signalClass(signal: CustomerSyncSignal): string {
 switch (signal) {
 case 'blocked':
 return 'border-red-200 bg-red-50 text-red-700 '
 case 'attention':
 return 'border-amber-200 bg-amber-50 text-amber-700 '
 case 'ready':
 return 'border-emerald-200 bg-emerald-50 text-emerald-700 '
 case 'in_progress':
 return 'border-emerald-200 bg-emerald-50 text-emerald-700 '
 case 'healthy':
 return 'border-slate-200 bg-slate-50 text-slate-700 '
 default:
 return 'border-slate-200 bg-slate-50 text-slate-700 '
 }
}

function formatSignal(signal: CustomerSyncSignal): string {
 switch (signal) {
 case 'blocked':
 return 'Blockerad'
 case 'attention':
 return 'Kräver komplettering'
 case 'ready':
 return 'Redo'
 case 'in_progress':
 return 'Pågår'
 case 'healthy':
 return 'Synkad'
 default:
 return signal
 }
}

function Kpi({ label, value, hint }: { label: string; value: number; hint: string }) {
 return (
 <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm ">
 <p className="text-sm font-medium text-slate-700 ">{label}</p>
 <p className="mt-2 text-3xl font-semibold text-slate-950 ">{value}</p>
 <p className="mt-2 text-sm text-slate-700 ">{hint}</p>
 </div>
 )
}

function CompactProfileCard({ profile }: { profile: CustomerSyncProfile }) {
 const visibleIssues = [...profile.blockers, ...profile.warnings].slice(0, 3)

 return (
 <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm ">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <Link
 href={profile.href}
 className="text-base font-semibold text-slate-950 underline-offset-4 hover:underline "
 >
 {profile.customerName}
 </Link>
 <p className="mt-1 text-sm text-slate-700 ">
 {profile.customerNumber ?? 'Kundnummer saknas'} · {profile.email ?? 'e-post saknas'}
 </p>
 </div>

 <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${signalClass(profile.signal)}`}>
 {formatSignal(profile.signal)}
 </span>
 </div>

 <div className="mt-4 flex flex-wrap gap-2">
 <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 ">
 {profile.stageLabel}
 </span>
 <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 ">
 anl {profile.counts.sites}
 </span>
 <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 ">
 mätpkt {profile.counts.meteringPoints}
 </span>
 <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 ">
 avtal {profile.counts.signedOrActiveContracts}/{profile.counts.contracts}
 </span>
 <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 ">
 fullmakt {profile.counts.signedPowersOfAttorney}/{profile.counts.powersOfAttorney}
 </span>
 </div>

 <p className="mt-4 text-sm leading-6 text-slate-700 ">
 {profile.recommendedAction}
 </p>

 {visibleIssues.length > 0 ? (
 <ul className="mt-3 space-y-1 text-xs text-slate-700 ">
 {visibleIssues.map((issue) => (
 <li key={issue}>• {issue}</li>
 ))}
 </ul>
 ) : null}

 {profile.identityKeys.length > 0 ? (
 <div className="mt-4 flex flex-wrap gap-2">
 {profile.identityKeys.slice(0, 4).map((key) => (
 <span
 key={`${key.label}:${key.value}`}
 className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700 "
 >
 {key.label}: {key.value}
 </span>
 ))}
 </div>
 ) : null}
 </article>
 )
}

export default function CustomerSyncBoard({ result, limit = 10 }: Props) {
 const { summary } = result
 const profiles = result.profiles.slice(0, limit)

 return (
 <section className="space-y-6">
 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div>
 <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-700 ">
 Operations Core · SaaS-synk
 </p>
 <h2 className="mt-2 text-xl font-semibold text-slate-950 ">
 Kundsynk, onboarding och datakoppling
 </h2>
 <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700 ">
 Den här vyn visar om varje kund har rätt kedja: kundidentitet → avtal/kampanj → fullmakt → anläggning → mätpunkt → nätägare → mätvärden/billing. Den är byggd för SaaS: datan ska ligga inom samma tenant/company-scope och matchas via kundnummer, person-/orgnummer, anläggnings-id, mätpunkts-id och Ediel-referenser.
 </p>
 </div>

 <Link
 href="/admin/operations/sync"
 className="inline-flex rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
 >
 Öppna full synkvy
 </Link>
 </div>
 </div>

 <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
 <Kpi label="Kunder" value={summary.totalCustomers} hint="Kunder i aktuell tenant/behörighet." />
 <Kpi label="Blockerade" value={summary.blocked} hint="Saknar kritisk data eller route." />
 <Kpi label="Redo för switch" value={summary.readyForSwitch} hint="Basdata, avtal och fullmakt finns." />
 <Kpi label="Aktiv men saknar mätvärden" value={summary.activeMissingMeterValues} hint="Behöver mätvärdes- eller billingflöde." />
 </div>

 <div className="grid gap-4 lg:grid-cols-2">
 {profiles.length === 0 ? (
 <div className="rounded-3xl border border-dashed border-slate-200 p-6 text-sm text-slate-700 ">
 Inga kunder hittades för synkgranskning.
 </div>
 ) : (
 profiles.map((profile) => (
 <CompactProfileCard key={profile.customerId} profile={profile} />
 ))
 )}
 </div>
 </section>
 )
}
