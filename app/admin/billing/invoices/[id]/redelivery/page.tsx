import { randomUUID } from 'node:crypto'
import Link from 'next/link'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { getInvoiceReviewDetail } from '@/lib/billing/invoiceReviewData'
import { resolveEffectiveBillingProfile } from '@/lib/billing/effectiveBillingProfile'
import { supabaseService } from '@/lib/supabase/service'
import RedeliveryDecisionForm from './RedeliveryDecisionForm'

export const dynamic = 'force-dynamic'
export default async function InvoiceRedeliveryDecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminPageKeyAccess('billing.workspace')
  const scope = await getOperationalCompanyScope(guard.userId)
  if (!scope?.companyId || (!guard.isPlatformAdmin && guard.companyId !== scope.companyId)) {
    return <main className="p-6"><p role="alert">Tenantkontexten har ändrats. Välj tenant och läs in fakturan igen.</p></main>
  }
  const { id } = await params
  const detail = await getInvoiceReviewDetail({ companyId: scope.companyId, invoiceExportItemId: id })
  const invoiceId = typeof detail.invoice?.id === 'string' ? detail.invoice.id : null
  const customerId = typeof detail.customer.id === 'string' ? detail.customer.id : null
  if (!invoiceId || !customerId) return <main className="p-6"><p role="alert">Originalfakturan är ännu inte tillgänglig för ett omleveransbeslut.</p></main>
  const [owners, company] = await Promise.all([
    supabaseService.from('customer_portal_accounts').select('id,user_id,portal_user_id,user_email,email')
      .eq('company_id', scope.companyId).eq('customer_id', customerId).eq('role', 'owner').eq('status', 'active').eq('is_active', true).not('user_id', 'is', null),
    supabaseService.from('companies').select('billing_settings').eq('id', scope.companyId).single(),
  ])
  const settings = company.data?.billing_settings as Record<string, unknown> | undefined
  const tenantProfile = settings?.invoice_profile as Record<string, unknown> | undefined
  const profile = resolveEffectiveBillingProfile({ companyId: scope.companyId, customerId, customer: detail.customer, contract: detail.contract,
    defaultDistributionMethod: !company.error && typeof tenantProfile?.distribution_method === 'string' ? tenantProfile.distribution_method : null })
  const accountIds = owners.error ? [] : (owners.data ?? []).filter(row => !row.portal_user_id || row.portal_user_id === row.user_id).map(row => row.id)
  const accountLabels = Object.fromEntries((owners.error ? [] : owners.data ?? []).map((row, index) => [row.id,
    row.user_email || row.email ? `Registrerad ägarrelation: ${row.user_email || row.email}` : `Ägarrelation ${index + 1}`]))
  const canRecord = (guard.isPlatformAdmin || guard.permissions.includes('billing_underlay.export'))
    && detail.lifecycleStage === 'dispatched' && profile.distributionMethod === 'email' && profile.blockers.length === 0 && accountIds.length > 0
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Link href={`/admin/billing/invoices/${id}`} className="text-sm font-semibold text-slate-600">← Till fakturan</Link>
      <header><h1 className="text-2xl font-semibold text-slate-950">Separat beslut om omleverans</h1>
        <p className="mt-2 text-sm text-slate-600">Originalfakturan behåller sina tidigare uppgifter. Ett nytt leveransbeslut knyts till den aktuella, bekräftade mottagaradressen.</p></header>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Aktuell faktureringsadress</dt><dd className="font-semibold">{profile.email ?? 'Saknas'}</dd></div>
          <div><dt className="text-slate-500">Källa</dt><dd>{profile.sources.email === 'contract_override' ? 'Avtalets uttryckliga undantag' : 'Kundens faktureringsstandard'}</dd></div>
          <div><dt className="text-slate-500">Profilrevision</dt><dd>{profile.profileRevision}</dd></div>
          <div><dt className="text-slate-500">Avtalsrevision</dt><dd>{profile.contractOverrideRevision}</dd></div>
        </dl>
        <p className="mt-4 text-sm text-slate-600">Vid registreringen kontrolleras ägarrelationen, mottagarens bekräftade adress och aktuella rättigheter igen.</p>
      </section>
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
        Beslutet skickar inte fakturan. Omleverans behöver hanteras separat hos fakturapartnern innan en faktisk leverans kan bekräftas.
      </section>
      <RedeliveryDecisionForm companyId={scope.companyId} customerId={customerId} invoiceId={invoiceId}
        expectedRevision={profile.profileRevision} expectedOverrideRevision={profile.contractOverrideRevision}
        idempotencyKey={`invoice-redelivery:${randomUUID()}`} accountIds={accountIds} accountLabels={accountLabels} canRecord={canRecord} />
    </main>
  )
}
