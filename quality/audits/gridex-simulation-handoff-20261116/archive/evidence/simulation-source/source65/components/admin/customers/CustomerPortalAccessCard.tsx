import Link from 'next/link'
import type {
 AdminCustomerPortalAccountRow,
 AdminCustomerPortalClaimRow,
} from '@/lib/customer-portal/admin'

type CustomerPortalAccessCardProps = {
 customerId: string
 accounts: AdminCustomerPortalAccountRow[]
 claims: AdminCustomerPortalClaimRow[]
}

function formatDateTime(value: string | null | undefined): string {
 if (!value) return '—'
 return new Intl.DateTimeFormat('sv-SE', {
 dateStyle: 'medium',
 timeStyle: 'short',
 }).format(new Date(value))
}

function statusTone(value: string | null | undefined): string {
 if (value === 'approved' || value === 'active') return 'bg-emerald-100 text-emerald-700'
 if (value === 'rejected' || value === 'disabled') return 'bg-red-100 text-red-700'
 return 'bg-amber-100 text-amber-700'
}

function boolLabel(value: boolean): string {
 return value ? 'Ja' : 'Nej'
}

function snapshotValue(snapshot: Record<string, unknown>, key: string): string {
 const value = snapshot[key]
 if (value === null || value === undefined || value === '') return '—'
 if (typeof value === 'string') return value
 if (typeof value === 'number' || typeof value === 'boolean') return String(value)
 return JSON.stringify(value)
}

export default function CustomerPortalAccessCard({
 customerId,
 accounts,
 claims,
}: CustomerPortalAccessCardProps) {
 const activeAccounts = accounts.filter((account) => account.is_active)
 const latestClaim = claims[0] ?? null

 return (
 <section className="space-y-6">
 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
 <div>
 <h2 className="text-lg font-semibold text-slate-950 ">
 Kundportalåtkomst
 </h2>
 <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-700 ">
 Kundens login till gridex.se kopplas säkert via personnummer, e-post,
 namn och anläggnings-ID/mätpunkts-ID. Systemet kopplar inte portalåtkomst
 enbart baserat på e-post.
 </p>
 </div>

 <Link
 href="/admin/billing/partner-invoices"
 className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
 >
 Partnerfakturor
 </Link>
 </div>

 <div className="mt-5 grid gap-3 md:grid-cols-3">
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Aktiva portal-konton</div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">
 {activeAccounts.length}
 </div>
 </div>
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Totala claims</div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">
 {claims.length}
 </div>
 </div>
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Senaste claim</div>
 <div className="mt-1 text-sm font-semibold text-slate-950 ">
 {latestClaim ? formatDateTime(latestClaim.created_at) : '—'}
 </div>
 </div>
 </div>
 </div>

 <div className="grid gap-6 xl:grid-cols-2">
 <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-5 ">
 <h3 className="text-base font-semibold text-slate-950 ">
 Kopplade portal-konton
 </h3>
 <p className="mt-1 text-sm text-slate-700 ">
 Dessa användare får se kundens fakturor, förbrukning och anläggningar i portalen.
 </p>
 </div>

 {accounts.length === 0 ? (
 <div className="p-8 text-center text-sm text-slate-700 ">
 Inget portal-konto är kopplat till denna kund ännu. Kunden kan koppla sig själv via
 Mina sidor på gridex.se med korrekt personnummer, namn, e-post och anläggnings-ID.
 </div>
 ) : (
 <div className="divide-y divide-slate-100 ">
 {accounts.map((account) => (
 <article key={account.id} className="p-5">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <div className="font-semibold text-slate-950 ">
 {account.user_email ?? account.user_id}
 </div>
 <div className="mt-1 text-xs text-slate-700 ">
 Roll: {account.role} · Metod: {account.match_method ?? '—'}
 </div>
 </div>
 <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(account.is_active ? 'active' : 'disabled')}`}>
 {account.is_active ? 'Aktiv' : 'Avstängd'}
 </span>
 </div>

 <div className="mt-4 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
 <div>Verifierad: {formatDateTime(account.verified_at)}</div>
 <div>Aktiverad: {formatDateTime(account.activated_at)}</div>
 <div>Senast sedd: {formatDateTime(account.last_seen_at)}</div>
 <div>Kund-ID: {customerId}</div>
 </div>

 <div className="mt-4 rounded-2xl bg-slate-50 p-3 text-xs text-slate-700 ">
 <div>Input namn: {snapshotValue(account.verified_identity_snapshot, 'inputName')}</div>
 <div>Anläggning/mätpunkt: {snapshotValue(account.verified_identity_snapshot, 'inputInstallationId')}</div>
 <div>Personnummer sista 4: {snapshotValue(account.verified_identity_snapshot, 'personalNumberLast4')}</div>
 </div>
 </article>
 ))}
 </div>
 )}
 </div>

 <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-5 ">
 <h3 className="text-base font-semibold text-slate-950 ">
 Senaste verifieringsförsök
 </h3>
 <p className="mt-1 text-sm text-slate-700 ">
 Visar godkända och nekade försök för samma kundkort.
 </p>
 </div>

 {claims.length === 0 ? (
 <div className="p-8 text-center text-sm text-slate-700 ">
 Inga verifieringsförsök ännu.
 </div>
 ) : (
 <div className="divide-y divide-slate-100 ">
 {claims.map((claim) => (
 <article key={claim.id} className="p-5">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <div className="font-semibold text-slate-950 ">
 {claim.user_email ?? claim.user_id}
 </div>
 <div className="mt-1 text-xs text-slate-700 ">
 {formatDateTime(claim.created_at)} · {claim.match_method}
 </div>
 </div>
 <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(claim.status)}`}>
 {claim.status}
 </span>
 </div>

 <div className="mt-4 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
 <div>E-post match: {boolLabel(claim.email_matched)}</div>
 <div>Namn match: {boolLabel(claim.name_matched)}</div>
 <div>Personnummer match: {boolLabel(claim.personal_number_matched)}</div>
 <div>Anläggning match: {boolLabel(claim.installation_matched)}</div>
 </div>

 {claim.failure_reason ? (
 <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
 {claim.failure_reason}
 </div>
 ) : null}
 </article>
 ))}
 </div>
 )}
 </div>
 </div>
 </section>
 )
}
