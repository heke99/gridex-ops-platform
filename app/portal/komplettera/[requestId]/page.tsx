import Link from 'next/link'
import { getCustomerPortalContext } from '@/lib/customer-portal/db'
import { loadPortalTargetedRequest } from '@/lib/customer-portal/targetedRequest'
import TargetedRequestForm from './targeted-request-form'

export const dynamic = 'force-dynamic'

export default async function PortalTargetedRequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  const context = await getCustomerPortalContext()
  const { requestId } = await params
  const request = await loadPortalTargetedRequest(context, requestId)
  return (
    <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6">
      <Link href="/portal/status" className="text-sm font-semibold text-emerald-800 underline">Tillbaka till Status</Link>
      <h1 className="text-2xl font-semibold">Svara på uppgiftsbegäran</h1>
      {context.companyId && request ? (
        <>
          <p>{request.customerLabel}</p>
          <p>{request.siteLabel ?? 'Begäran gäller kundkontot.'}</p>
          <p>Ingen svarstid har angetts.</p>
          <TargetedRequestForm companyId={context.companyId} requestId={request.id} siteId={request.siteId} fields={request.fields} />
        </>
      ) : (
        <p role="status">Uppgiftsbegäran kan inte öppnas. Gå till Status för att se vilka uppgifter som kan besvaras.</p>
      )}
    </section>
  )
}
