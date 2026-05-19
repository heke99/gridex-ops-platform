import Link from 'next/link'
import type { CustomerSyncBuildResult, CustomerSyncProfile, CustomerSyncSignal } from '@/lib/operations/customerSync'

type Props = {
  result: CustomerSyncBuildResult
  limit?: number
}

function signalClass(signal: CustomerSyncSignal): string {
  switch (signal) {
    case 'blocked':
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300'
    case 'attention':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300'
    case 'ready':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300'
    case 'in_progress':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300'
    case 'healthy':
      return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
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
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">{value}</p>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{hint}</p>
    </div>
  )
}

function CompactProfileCard({ profile }: { profile: CustomerSyncProfile }) {
  const visibleIssues = [...profile.blockers, ...profile.warnings].slice(0, 3)

  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={profile.href}
            className="text-base font-semibold text-slate-950 underline-offset-4 hover:underline dark:text-white"
          >
            {profile.customerName}
          </Link>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {profile.customerNumber ?? 'Kundnummer saknas'} · {profile.email ?? 'e-post saknas'}
          </p>
        </div>

        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${signalClass(profile.signal)}`}>
          {formatSignal(profile.signal)}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {profile.stageLabel}
        </span>
        <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
          anl {profile.counts.sites}
        </span>
        <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
          mätpkt {profile.counts.meteringPoints}
        </span>
        <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
          avtal {profile.counts.signedOrActiveContracts}/{profile.counts.contracts}
        </span>
        <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
          fullmakt {profile.counts.signedPowersOfAttorney}/{profile.counts.powersOfAttorney}
        </span>
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
        {profile.recommendedAction}
      </p>

      {visibleIssues.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
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
              className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
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
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Operations Core · SaaS-synk
            </p>
            <h2 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              Kundsynk, onboarding och datakoppling
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Den här vyn visar om varje kund har rätt kedja: kundidentitet → avtal/kampanj → fullmakt → anläggning → mätpunkt → nätägare → mätvärden/billing. Den är byggd för SaaS: datan ska ligga inom samma tenant/company-scope och matchas via kundnummer, person-/orgnummer, anläggnings-id, mätpunkts-id och Ediel-referenser.
            </p>
          </div>

          <Link
            href="/admin/operations/sync"
            className="inline-flex rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
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
          <div className="rounded-3xl border border-dashed border-slate-200 p-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
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
