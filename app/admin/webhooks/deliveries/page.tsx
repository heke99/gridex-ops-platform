import Link from 'next/link'
import { requireAdminPageAccess, isPlatformAdminContext } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { listWebhookDeliveries, listWebhookSubscriptions } from '@/lib/admin/websiteIntegrationOps'
import { markWebhookDeliveryIgnoredAction, resendWebhookDeliveryAction, sendWebhookTestEventAction } from '../actions'

export const dynamic = 'force-dynamic'

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function statusTone(status: string) {
  if (status === 'sent') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (['queued', 'processing'].includes(status)) return 'border-amber-200 bg-amber-50 text-amber-900'
  if (['failed', 'dead_letter'].includes(status)) return 'border-red-200 bg-red-50 text-red-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function payloadString(payload: Record<string, unknown> | null | undefined, key: string) {
  const value = payload?.[key]
  return typeof value === 'string' ? value : null
}

export default async function WebhookDeliveriesPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  // Webhook deliveries are an integration surface (payloads, endpoints,
  // signatures) — only users with the integrations permissions should see it,
  // not every operator with customer read access.
  const access = await requireAdminPageAccess({ anyOf: ['integrations.read', 'integrations.write'] })
  const tenantScope = await resolveAdminTenantReadScope(access)
  const resolved = searchParams ? await searchParams : {}
  const status = typeof resolved.status === 'string' ? resolved.status : null
  const companyId = tenantScope.isPlatformAdmin ? null : tenantScope.companyId
  const [deliveries, subscriptions] = await Promise.all([
    listWebhookDeliveries({ companyId, status, limit: 150 }),
    listWebhookSubscriptions({ companyId, limit: 100 }),
  ])
  const isPlatformAdmin = isPlatformAdminContext(access)
  const sent = deliveries.filter((item) => item.status === 'sent').length
  const failed = deliveries.filter((item) => ['failed', 'dead_letter'].includes(item.status)).length
  const queued = deliveries.filter((item) => ['queued', 'processing'].includes(item.status)).length

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-6 py-8">
      <section className="rounded-[36px] border border-emerald-100 bg-white p-8 shadow-sm shadow-emerald-950/5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Webhooks</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Webhook delivery logs</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">Följ event som skickas från app.gridex.se till externa hemsidor. Failed deliveries kan köas om manuellt.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/website-applications" className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Website applications</Link>
            <Link href="/developers/customer-portal-api" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">Webhook docs</Link>
          </div>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5"><p className="text-sm text-slate-700">Totalt</p><p className="mt-2 text-3xl font-semibold text-slate-950">{deliveries.length}</p></div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5"><p className="text-sm text-amber-900">Köade</p><p className="mt-2 text-3xl font-semibold text-amber-950">{queued}</p></div>
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5"><p className="text-sm text-emerald-800">Skickade</p><p className="mt-2 text-3xl font-semibold text-emerald-950">{sent}</p></div>
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5"><p className="text-sm text-red-800">Fel</p><p className="mt-2 text-3xl font-semibold text-red-950">{failed}</p></div>
        </div>
      </section>

      <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Webhook subscriptions</h2>
            <p className="mt-1 text-sm text-slate-600">Skicka testevent från en aktiv subscription för att verifiera endpoint och signaturhantering.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/webhooks/deliveries" className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-semibold text-slate-700">Alla</Link>
            <Link href="/admin/webhooks/deliveries?status=failed" className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-sm font-semibold text-red-800">Failed</Link>
            <Link href="/admin/webhooks/deliveries?status=queued" className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-900">Queued</Link>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {subscriptions.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-600">Inga webhook subscriptions finns ännu.</div> : null}
          {subscriptions.slice(0, 12).map((subscription) => (
            <article key={subscription.id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-950">{subscription.name}</div>
                  <div className="mt-1 break-all text-xs text-slate-600">{subscription.endpoint_url}</div>
                  <div className="mt-2 text-xs text-slate-500">{isPlatformAdmin ? subscription.companies?.name ?? subscription.company_id : 'Ditt bolag'} · {subscription.integration_api_clients?.name ?? 'API-client saknas'}</div>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(subscription.status)}`}>{subscription.status}</span>
              </div>
              <div className="mt-3 text-xs text-slate-600">Events: {(subscription.event_types ?? []).slice(0, 4).join(', ') || '—'}</div>
              <form action={sendWebhookTestEventAction} className="mt-4">
                <input type="hidden" name="company_id" value={subscription.company_id} />
                <input type="hidden" name="subscription_id" value={subscription.id} />
                <button className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">Skicka testevent</button>
              </form>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Delivery log</h2>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
              <tr><th className="px-4 py-3">Datum</th><th className="px-4 py-3">Event</th><th className="px-4 py-3">Destination</th><th className="px-4 py-3">Kund</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Svar/fel</th><th className="px-4 py-3">Åtgärder</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {deliveries.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-600">Inga webhook deliveries hittades.</td></tr> : null}
              {deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDate(delivery.created_at)}</td>
                  <td className="px-4 py-3 text-slate-700">{delivery.event_type}<div className="font-mono text-xs text-slate-500">{delivery.domain_event_id}</div></td>
                  <td className="max-w-xs break-all px-4 py-3 text-slate-700">{delivery.webhook_subscriptions?.endpoint_url ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{payloadString(delivery.payload, 'customer_number') ?? '—'}<div>{payloadString(delivery.payload, 'external_customer_id') ?? '—'}</div></td>
                  <td className="px-4 py-3"><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(delivery.status)}`}>{delivery.status}</span><div className="mt-1 text-xs text-slate-500">{delivery.attempts}/{delivery.max_attempts}</div></td>
                  <td className="max-w-xs px-4 py-3 text-xs text-slate-700">HTTP {delivery.response_status ?? '—'}<div className="mt-1 text-red-700">{delivery.failure_reason ?? '—'}</div></td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <form action={resendWebhookDeliveryAction}>
                        <input type="hidden" name="company_id" value={delivery.company_id} />
                        <input type="hidden" name="delivery_id" value={delivery.id} />
                        <button className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Resend</button>
                      </form>
                      <form action={markWebhookDeliveryIgnoredAction}>
                        <input type="hidden" name="company_id" value={delivery.company_id} />
                        <input type="hidden" name="delivery_id" value={delivery.id} />
                        <input type="hidden" name="note" value="Manuellt hanterad från delivery UI" />
                        <button className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Ignorera</button>
                      </form>
                      <details className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                        <summary className="cursor-pointer">Payload</summary>
                        <pre className="mt-2 max-h-64 w-[28rem] overflow-auto whitespace-pre-wrap text-[11px] font-normal text-slate-600">{JSON.stringify(delivery.payload, null, 2)}</pre>
                      </details>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
