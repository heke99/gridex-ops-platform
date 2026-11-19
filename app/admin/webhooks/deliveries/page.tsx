import Link from 'next/link'
import { requireAdminPageAccess, isPlatformAdminContext } from '@/lib/admin/guards'
import { canPresentAdminAction, canPresentAdminLink, webhookActionNotice } from '@/lib/admin/actionPresentation'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { listWebhookDeliveries, listWebhookSubscriptions } from '@/lib/admin/websiteIntegrationOps'
import { markWebhookDeliveryIgnoredAction, resendWebhookDeliveryAction, sendWebhookTestEventAction } from '../actions'
import { formatAdminDateTime, formatStatusLabel } from '@/lib/ui/format'

export const dynamic = 'force-dynamic'

function payloadString(payload: Record<string, unknown> | null | undefined, key: string) {
  const value = payload?.[key]
  return typeof value === 'string' ? value : null
}

function eventLabel(event: string) {
  if (event === 'webhook.test') return 'Test av anslutningen'
  if (event.startsWith('customer.')) return 'Kunduppgifter'
  if (event.startsWith('contract.')) return 'Avtalsuppgifter'
  if (event.startsWith('invoice.') || event.startsWith('billing.')) return 'Fakturauppgifter'
  return 'Uppdatering till ansluten tjänst'
}

export default async function WebhookDeliveriesPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireAdminPageAccess({ anyOf: ['integrations.read', 'integrations.write'] })
  const tenantScope = await resolveAdminTenantReadScope(access)
  const resolved = searchParams ? await searchParams : {}
  const status = typeof resolved.status === 'string' ? resolved.status : null
  const notice = webhookActionNotice(resolved.success)
  const companyId = tenantScope.isPlatformAdmin ? null : tenantScope.companyId
  const [deliveries, subscriptions] = await Promise.all([
    listWebhookDeliveries({ companyId, status, limit: 150 }),
    listWebhookSubscriptions({ companyId, limit: 100 }),
  ])
  const isPlatformAdmin = isPlatformAdminContext(access)
  const canReadApplications = canPresentAdminLink(access, { anyOf: ['customers.read', 'customers.write', 'billing_underlay.read'] })
  const companies = [...new Set([...subscriptions, ...deliveries].map(row => row.company_id))]
  const writableCompanies = new Map(await Promise.all(companies.map(async id => [id,
    isPlatformAdmin || await canPresentAdminAction(['integrations.write'], { companyId: id }),
  ] as const)))

  return <main className="mx-auto min-w-0 max-w-7xl space-y-4 p-4 lg:p-6">
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h1 className="text-2xl font-semibold text-slate-950">Anslutningens leveranser</h1>
      <p className="mt-2 text-sm text-slate-600">Följ uppgifter som skickas till ert anslutna system. Köad och skickad är olika lägen; ett skickat meddelande bevisar inte att kundärendet är klart.</p>
      <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold text-emerald-800">
        {canReadApplications ? <Link href="/admin/website-applications" className="underline">Kundansökningar</Link> : null}
        {isPlatformAdmin ? <Link href="/developers/customer-portal-api" className="underline">Teknisk dokumentation</Link> : null}
      </div>
      {notice ? <p role="status" className={`mt-3 rounded-xl border p-3 text-sm ${notice.kind === 'check' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>{notice.message}</p> : null}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Inlästa leveranser', deliveries.length],
          ['Skickade', deliveries.filter(row => row.status === 'sent').length],
          ['I kö eller pågår', deliveries.filter(row => ['queued', 'processing'].includes(row.status)).length],
          ['Kräver åtgärd', deliveries.filter(row => ['failed', 'dead_letter'].includes(row.status)).length],
        ].map(([label, count]) => <div key={String(label)} className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-600">{label}</p><p className="mt-1 text-xl font-semibold">{count}</p></div>)}
      </div>
    </section>

    <details className="rounded-2xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer font-semibold text-slate-950">Anslutningar ({subscriptions.length})</summary>
      <div role="region" aria-label="Anslutningar" tabIndex={0} className="mt-3 max-h-[28rem] space-y-3 overflow-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
        {subscriptions.length === 0 ? <p className="text-sm text-slate-600">Inga anslutningar hittades.</p> : null}
        {subscriptions.map(subscription => <article key={subscription.id} className="min-w-0 rounded-xl border border-slate-200 p-3 text-sm">
          <p className="break-words font-semibold">{subscription.name} · {formatStatusLabel(subscription.status, 'Status saknas', 'Behöver granskas')}</p>
          <p className="mt-1 break-all text-xs text-slate-600">Mottagare: {subscription.endpoint_url}</p>
          {writableCompanies.get(subscription.company_id) ? <form action={sendWebhookTestEventAction} className="mt-3">
            <input type="hidden" name="company_id" value={subscription.company_id} /><input type="hidden" name="subscription_id" value={subscription.id} />
            <button className="min-h-10 rounded-xl border border-slate-300 px-3 py-2 font-semibold">Skicka testhändelse</button>
          </form> : <p className="mt-2 text-xs text-slate-600">Läsbehörighet. En behörig anslutningsansvarig behöver utföra tester.</p>}
          {isPlatformAdmin ? <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold">Tekniska uppgifter</summary><p className="mt-2 break-all text-xs">{subscription.companies?.name ?? subscription.company_id} · {subscription.integration_api_clients?.name ?? 'API-klient saknas'} · {(subscription.event_types ?? []).join(', ')}</p></details> : null}
        </article>)}
      </div>
    </details>

    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-slate-950">Leveranshistorik</h2>
      <nav aria-label="Filtrera leveransstatus" className="mt-3 flex flex-wrap gap-2 text-sm">
        {[[null, 'Alla'], ['failed', 'Kräver åtgärd'], ['queued', 'I kö']].map(([value, label]) => <Link key={label} aria-current={status === value ? 'page' : undefined} href={value ? `/admin/webhooks/deliveries?status=${value}` : '/admin/webhooks/deliveries'} className="rounded-xl border border-slate-300 px-3 py-2">{label}</Link>)}
      </nav>
      <div role="region" aria-label="Leveranser" tabIndex={0} className="mt-3 max-h-[40rem] space-y-3 overflow-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
        {deliveries.length === 0 ? <p className="p-3 text-sm text-slate-600">Inga leveranser matchar urvalet.</p> : null}
        {deliveries.map(delivery => <article key={delivery.id} className="min-w-0 rounded-xl border border-slate-200 p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">{eventLabel(delivery.event_type)}</p><p>{formatStatusLabel(delivery.status, 'Status saknas', 'Behöver granskas')}</p></div>
          <p className="mt-1 text-xs text-slate-600">{formatAdminDateTime(delivery.created_at)} · Kundnummer: {payloadString(delivery.payload, 'customer_number') ?? 'Saknas'}</p>
          <p className="mt-1 break-all text-xs text-slate-600">Mottagare: {delivery.webhook_subscriptions?.endpoint_url ?? 'Saknas'}</p>
          {['failed', 'dead_letter'].includes(delivery.status) ? <p className="mt-2 text-sm text-amber-900">Överföringen behöver kontrolleras. Kontakta anslutningsansvarig innan ett nytt försök.</p> : null}
          {writableCompanies.get(delivery.company_id) ? <details className="mt-3"><summary className="cursor-pointer font-semibold">Hantera leverans</summary><div className="mt-2 flex flex-wrap gap-2">
            <form action={resendWebhookDeliveryAction}><input type="hidden" name="company_id" value={delivery.company_id} /><input type="hidden" name="delivery_id" value={delivery.id} /><button className="min-h-10 rounded-xl border border-slate-300 px-3 py-2">Skicka igen</button></form>
            <form action={markWebhookDeliveryIgnoredAction}><input type="hidden" name="company_id" value={delivery.company_id} /><input type="hidden" name="delivery_id" value={delivery.id} /><input type="hidden" name="note" value="Manuellt hanterad från delivery UI" /><button className="min-h-10 rounded-xl border border-slate-300 px-3 py-2">Ignorera leverans</button></form>
          </div></details> : null}
          {isPlatformAdmin ? <details className="mt-3"><summary className="cursor-pointer font-semibold">Tekniska uppgifter</summary><p className="mt-2 break-all text-xs">{delivery.event_type} · {delivery.domain_event_id} · HTTP {delivery.response_status ?? '—'} · Försök {delivery.attempts}/{delivery.max_attempts}</p><p className="mt-1 break-words text-xs">{delivery.failure_reason}</p><pre className="mt-2 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(delivery.payload, null, 2)}</pre></details> : null}
        </article>)}
      </div>
    </section>
  </main>
}
