import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { loadTestCenterTrace } from '@/lib/ediel/testing/testCenterTraceReadModel'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ edielMessageId: string }>
  searchParams?: Promise<{ billingMonth?: string; underlayId?: string }>
}

function JsonBlock({ value, empty = 'Ingen data skapades i detta steg.' }: { value: unknown; empty?: string }) {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
    return <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">{empty}</div>
  }
  return (
    <pre className="max-h-[34rem] overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function Step({ number, title, description, children }: { number: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Steg {number}</div>
          <h2 className="mt-1 text-xl font-black text-slate-950">{title}</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{description}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export default async function TestCenterTracePage({ params, searchParams }: PageProps) {
  const context = await requirePlatformAdminAccess()
  const route = await params
  const query = await searchParams
  const billingMonth = query?.billingMonth?.trim() ?? ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(billingMonth)) throw new Error('Trace kräver billingMonth=YYYY-MM.')

  const trace = await loadTestCenterTrace({
    edielMessageId: route.edielMessageId,
    billingMonth,
    billingUnderlayId: query?.underlayId?.trim() || null,
  })

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Testcenter trace"
        subtitle="Spårbar körning från original-EDIFACT till mätvärden, billing, pricing och fakturautkast."
        userEmail={context.email}
        workspaceName="Platform"
        workspaceMode="platform"
      />
      <main className="space-y-6 p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/admin/ediel/test-center/metering-to-invoice" className="text-sm font-bold text-emerald-800 hover:underline">
            ← Ny Testcenter-körning
          </Link>
          <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-emerald-800">
            environment=test · external dispatch blocked
          </div>
        </div>

        <section className="grid gap-3 md:grid-cols-4">
          {[
            ['Ediel message', trace.edielMessageId],
            ['Kund', trace.customerId],
            ['Fakturamånad', trace.billingMonth],
            ['SHA256', trace.source.sha256 ?? '—'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{label}</div>
              <div className="mt-1 break-all text-sm font-bold text-slate-900">{value}</div>
            </div>
          ))}
        </section>

        <Step number="1" title="Originalfil och segment" description="Den exakta testpayloaden läses tillbaka från inbound-envelope. Segmentnumret gör det möjligt att spåra senare fakta tillbaka till EDIFACT-källan.">
          <JsonBlock value={{ inboundEmailMessageId: trace.source.inboundEmailMessageId, filename: trace.source.filename, sha256: trace.source.sha256, segments: trace.source.segments }} />
        </Step>

        <Step number="2" title="Canonical parse och validation" description="Visar det canonical parsed payload och validation report som faktiskt ligger på samma Ediel-meddelande som produktionsflödet använder.">
          <JsonBlock value={trace.canonical} />
        </Step>

        <Step number="3" title="Normaliserade mätvärdesrader" description="Raderna hämtas tenant-scopat för den matchade mätpunkten och exakt fakturamånad. Detta är samma normaliserade lager som completeness- och billingmotorerna läser.">
          <JsonBlock value={trace.metering} />
        </Step>

        <Step number="4" title="Billing-underlag" description="Det faktiska billing_underlay som skapades eller återanvändes för körningen, inklusive readiness, period, total kWh och blockerare.">
          <JsonBlock value={trace.billing.underlay} />
        </Step>

        <Step number="5" title="Pricing snapshot och pricing-rader" description="Visar låst pris-snapshot, pricing run och de radposter som blev underlag för fakturan.">
          <JsonBlock value={trace.pricing} />
        </Step>

        <Step number="6" title="Fakturautkast" description="Visar invoice export item och eventuell customer invoice-projektion. Testcenter skickar aldrig fakturan externt.">
          <JsonBlock value={trace.invoice} />
        </Step>

        <Step number="7" title="End-to-end provenance" description="Samlad identitetskedja för snabb felsökning och revision. Alla länkar är tenant-scopade och bygger på samma Ediel message ID.">
          <JsonBlock value={{
            inboundEmailMessageId: trace.source.inboundEmailMessageId,
            edielMessageId: trace.edielMessageId,
            meteringPointId: trace.metering.meteringPointId,
            meteringRows: trace.metering.rows.length,
            billingUnderlayId: (trace.billing.underlay as Record<string, unknown> | null)?.id ?? null,
            pricingRunId: (trace.pricing.run as Record<string, unknown> | null)?.id ?? null,
            invoiceExportItemId: (trace.invoice.exportItem as Record<string, unknown> | null)?.id ?? null,
            customerInvoiceId: (trace.invoice.draft as Record<string, unknown> | null)?.id ?? null,
          }} />
        </Step>
      </main>
    </div>
  )
}
