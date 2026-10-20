import Link from 'next/link'
import { z } from 'zod'

const readingSchema = z.object({
  status: z.enum(['processing', 'completed', 'failed', 'skipped']),
  context: z.object({ company_id: z.string(), customer_id: z.string(), request_id: z.string() }),
  outcome: z.string().optional(), reason: z.string().optional(),
  scope_mode: z.literal('multiple_facilities').optional(),
  outcome_quote: z.string().max(2000).nullable().optional(),
  fields: z.array(z.object({ field: z.string(), value: z.string().max(500), quote: z.string().max(2000) })).max(64).optional(),
  estimated_cost_usd: z.number().nonnegative().optional(),
  review_reasons: z.array(z.enum(['conditional', 'negated', 'multiple_customers', 'multiple_facilities', 'contradictory', 'uncertain', 'other_customer'])).max(7).optional(),
}).refine(value => (value.fields?.length ?? 0) <= 16 || value.scope_mode === 'multiple_facilities')

const textFact = z.string().min(1).max(500)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const applicationSchema = z.object({
  version: z.literal(1), applied: z.literal(true), sourceHash: hash,
  companyId: textFact, customerId: textFact, requestId: textFact, siteId: textFact.optional(),
  complete: z.boolean().optional(), missingFields: z.array(textFact).max(16).optional(),
  terms: z.object({
    contractEndDate: textFact.optional(), earliestStartDate: textFact.optional(), effectiveStartDate: textFact.optional(),
    noticePeriod: textFact.optional(), bindingPeriod: textFact.optional(), cancellationDeadline: textFact.optional(),
    cancellationRegistered: textFact.optional(), contractStatus: textFact.optional(), terminationFee: textFact.optional(),
  }).optional(),
  result: z.object({
    ok: z.literal(true), facilityId: textFact.nullable().optional(), meteringPointExternalId: textFact.nullable().optional(),
    gridAreaCode: textFact.nullable().optional(), priceAreaCode: textFact.nullable().optional(),
    appliedFacts: z.object({ annualConsumptionKwh: z.number().nonnegative().optional(), currentSupplierName: textFact.optional(), readingFrequency: textFact.optional() }).optional(),
  }).optional(),
}).refine(value => (value.complete !== undefined && value.terms && Object.keys(value.terms).length > 0) || value.result?.ok === true)
const senderSchema = z.object({
  version: z.literal(1), status: z.literal('verified'), method: z.literal('dkim'), raw_sha256: hash,
  from_email: z.string().email(), signing_domain: textFact,
  signed_headers: z.array(textFact).refine(headers => headers.includes('from')),
}).refine(value => value.from_email.split('@')[1] === value.signing_domain)

const siteApplicationSchema = z.object({
  version: z.literal(1), parentRequestId: textFact, companyId: textFact, customerId: textFact,
  siteId: textFact, requestId: z.string().uuid(), sourceHash: hash, status: z.literal('applied'),
  application: applicationSchema,
})

type MatchContext = { companyId: string | null; customerId: string | null; requestId: string | null }

const labels: Record<string, string> = {
  facility_id: 'Anläggnings-ID', metering_point_id: 'Mätpunkts-ID', grid_area: 'Nätområde', price_area: 'Elområde',
  annual_consumption: 'Årsförbrukning', current_supplier: 'Nuvarande elhandlare', metering_method: 'Mätmetod',
  reporting_frequency: 'Rapporteringsfrekvens', notice_period: 'Uppsägningstid', binding_period: 'Bindningstid',
  contract_end: 'Avtalslut', earliest_start: 'Tidigaste start enligt svaret', cancellation_deadline: 'Sista uppsägningsdag',
  termination_fee: 'Brytavgift', missing_evidence: 'Begärd komplettering', recipient_correction: 'Begärd adressrättelse',
  poa_rejected: 'Fullmakt nekad', completion_requested: 'Komplettering begärd', facility_information: 'Anläggningsuppgifter',
  contract_information: 'Avtalsuppgifter', other: 'Övrigt svar',
  cancellation_registered: 'Registrerad uppsägning', contract_status: 'Avtalsstatus',
}
const reviewLabels: Record<string, string> = {
  conditional: 'Svaret innehåller villkor', negated: 'Svaret innehåller en negation', multiple_customers: 'Flera kunder anges',
  multiple_facilities: 'Flera anläggningar anges', contradictory: 'Uppgifterna motsäger varandra', uncertain: 'Uppgifterna är osäkra', other_customer: 'Svaret gäller en annan kund',
}
const failures: Record<string, string> = {
  authentication: 'API-behörighet behöver kontrolleras.', rate_limited: 'Leverantörens anropsgräns nåddes.',
  provider_unavailable: 'AI-tjänsten var inte tillgänglig.', transport_error: 'AI-anropet kunde inte slutföras.',
  invalid_output: 'Svaret kunde inte valideras mot mejltexten.', input_too_large: 'Mejlet behöver granskas manuellt på grund av sin längd.',
  empty_input: 'Ingen läsbar svarstext.', disabled: 'Automatisk AI-läsning är avstängd.', not_configured: 'AI-nyckel saknas i servermiljön.',
}

function AiReading({ raw, companyId, customerId, requestId }: MatchContext & { raw: unknown }) {
  if (!raw) return <span className="text-slate-500">Ingen AI-läsning</span>
  const parsed = readingSchema.safeParse(raw)
  if (!parsed.success) return <span className="text-slate-500">AI-resultatet behöver kontrolleras.</span>
  const reading = parsed.data
  if (reading.context.company_id !== companyId || reading.context.customer_id !== customerId || reading.context.request_id !== requestId) {
    return <span className="text-amber-800">Tidigare AI-läsning gäller en annan matchning. Granska originalsvaret.</span>
  }
  if (reading.status === 'processing') return <span className="text-slate-500">AI-läsning påbörjad. Ett avbrutet försök körs inte om automatiskt.</span>
  if (reading.status !== 'completed') return <span className="text-amber-800">{failures[reading.reason ?? ''] ?? 'AI-läsningen kunde inte slutföras.'} Granska originalsvaret.</span>
  return (
    <details className="max-w-md break-words">
      <summary className="cursor-pointer font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">AI-läsning: {labels[reading.outcome ?? ''] ?? 'Övrigt svar'}</summary>
      <p className="mt-2 text-slate-600">Läsunderlag med källcitat. Servern validerar uppgifterna före automatisk tillämpning. AI väljer inte tenant eller kund och utför inga ändringar själv.</p>
      {reading.review_reasons?.length ? <ul className="mt-2 list-disc pl-5 text-amber-800">{reading.review_reasons.map(reason => <li key={reason}>{reviewLabels[reason]}</li>)}</ul> : null}
      {reading.review_reasons === undefined ? <p className="mt-2 text-amber-800">Äldre läsning saknar kontroll av villkor och osäkra uppgifter.</p> : null}
      {reading.outcome_quote ? <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-slate-300 pl-2 text-slate-600">{reading.outcome_quote}</blockquote> : null}
      {reading.fields?.map((field, index) => (
        <div key={`${field.field}-${index}`} className="mt-3">
          <div className="font-semibold">{labels[field.field] ?? 'Uppgift'}: {field.value}</div>
          <blockquote className="mt-1 whitespace-pre-wrap border-l-2 border-slate-300 pl-2 text-slate-600">{field.quote}</blockquote>
        </div>
      ))}
      {reading.estimated_cost_usd !== undefined ? <p className="mt-3 text-slate-500">Uppskattad AI-kostnad: {new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'USD', minimumFractionDigits: 6, maximumFractionDigits: 6 }).format(reading.estimated_cost_usd)}</p> : null}
    </details>
  )
}

export default function ManualMailAiReading({ payload, companyId, customerId, requestId }: MatchContext & { payload: unknown }) {
  const stored = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
  const automation = stored.manual_automation && typeof stored.manual_automation === 'object' ? stored.manual_automation as Record<string, unknown> : {}
  const parsed = applicationSchema.safeParse(automation.application)
  const application = parsed.success && stored.sender_credible === true && senderSchema.safeParse(stored.sender_verification).success
    && parsed.data.companyId === companyId && parsed.data.customerId === customerId && parsed.data.requestId === requestId
    && parsed.data.sourceHash === automation.sourceHash ? parsed.data : null
  const confirmedSites = stored.sender_credible === true && senderSchema.safeParse(stored.sender_verification).success
    && automation.site_applications && typeof automation.site_applications === 'object' && !Array.isArray(automation.site_applications)
    ? Object.entries(automation.site_applications as Record<string, unknown>).flatMap(([key, raw]) => {
      const checked = siteApplicationSchema.safeParse(raw)
      if (!checked.success) return []
      const site = checked.data, applied = site.application
      return key === site.requestId && site.parentRequestId === requestId && site.companyId === companyId
        && site.customerId === customerId && site.sourceHash === automation.sourceHash
        && applied.companyId === companyId && applied.customerId === customerId && applied.requestId === site.requestId
        && applied.sourceHash === site.sourceHash && (!applied.siteId || applied.siteId === site.siteId) ? [site] : []
    }) : []
  const terms = application?.terms
  const result = application?.result
  const saved: Array<[string, string | number | null | undefined]> = [
    ['Anläggnings-ID', result?.facilityId], ['Mätpunkts-ID', result?.meteringPointExternalId], ['Nätområde', result?.gridAreaCode], ['Elområde', result?.priceAreaCode],
    ['Årsförbrukning (kWh)', result?.appliedFacts?.annualConsumptionKwh], ['Nuvarande elhandlare', result?.appliedFacts?.currentSupplierName], ['Rapporteringsfrekvens', result?.appliedFacts?.readingFrequency],
    ['Avtalslut', terms?.contractEndDate], ['Tidigaste start hos ny leverantör', terms?.earliestStartDate], ['Beräknad tidigaste start', terms?.effectiveStartDate],
    ['Uppsägningstid', terms?.noticePeriod], ['Bindningstid', terms?.bindingPeriod], ['Sista uppsägningsdag', terms?.cancellationDeadline],
    ['Registrerad uppsägning', terms?.cancellationRegistered], ['Avtalsstatus', terms?.contractStatus], ['Brytavgift', terms?.terminationFee],
  ]
  return (
    <div className="max-w-md space-y-3 break-words">
      {application ? <div>
        <p className="font-semibold text-emerald-800">{application.complete === false ? 'Deluppgifter sparade automatiskt' : terms ? 'Avtalsuppgifter sparade automatiskt' : 'Anläggningsuppgifter sparade automatiskt'}</p>
        <p className="mt-1 text-slate-600">Ordinarie kontroller avgör när leverantörsbytet får skickas.</p>
        <dl className="mt-2 space-y-1">{saved.filter(([, value]) => value !== undefined && value !== null).map(([label, value]) => <div key={label}><dt className="inline font-semibold">{label}: </dt><dd className="inline">{value}</dd></div>)}</dl>
        {application.complete === false && application.missingFields?.length ? <p className="mt-2 text-amber-800">Inväntar komplettering: {application.missingFields.map(field => field === 'earliest_supplier_start_date' ? 'Tidigaste start hos ny leverantör' : labels[field] ?? 'Avtalsuppgift').join(', ')}.</p> : null}
      </div> : <p className="text-slate-500">Inväntar validering eller granskning. Ingen automatisk tillämpning är bekräftad här.</p>}
      {confirmedSites.length > 0 && <section className="space-y-4">
        <h3 className="font-semibold">Bekräftade uppgifter per anläggning</h3>
        {confirmedSites.map(site => <div key={site.requestId} className="rounded-lg border border-slate-200 p-3">
          <p className="mb-2 font-semibold">Anläggning: <Link className="underline" href={`/admin/customers/${encodeURIComponent(site.customerId)}?site=${encodeURIComponent(site.siteId)}`}>{site.siteId}</Link></p>
          <ManualMailAiReading payload={{ sender_credible: true, sender_verification: stored.sender_verification,
            manual_automation: { sourceHash: site.sourceHash, application: site.application } }} companyId={companyId} customerId={customerId} requestId={site.requestId} />
        </div>)}
      </section>}
      <AiReading raw={stored.ai_read_only} companyId={companyId} customerId={customerId} requestId={requestId} />
    </div>
  )
}
