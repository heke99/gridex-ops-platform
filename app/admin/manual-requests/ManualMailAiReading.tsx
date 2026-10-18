import { z } from 'zod'

const readingSchema = z.object({
  status: z.enum(['processing', 'completed', 'failed', 'skipped']),
  context: z.object({ company_id: z.string(), customer_id: z.string(), request_id: z.string() }),
  outcome: z.string().optional(), reason: z.string().optional(),
  outcome_quote: z.string().max(2000).nullable().optional(),
  fields: z.array(z.object({ field: z.string(), value: z.string().max(500), quote: z.string().max(2000) })).max(16).optional(),
  estimated_cost_usd: z.number().nonnegative().optional(),
})

const labels: Record<string, string> = {
  facility_id: 'Anläggnings-ID', metering_point_id: 'Mätpunkts-ID', grid_area: 'Nätområde',
  annual_consumption: 'Årsförbrukning', current_supplier: 'Nuvarande elhandlare', metering_method: 'Mätmetod',
  reporting_frequency: 'Rapporteringsfrekvens', notice_period: 'Uppsägningstid', binding_period: 'Bindningstid',
  contract_end: 'Avtalslut', earliest_start: 'Tidigaste start enligt svaret', cancellation_deadline: 'Sista uppsägningsdag',
  termination_fee: 'Brytavgift', missing_evidence: 'Begärd komplettering', recipient_correction: 'Begärd adressrättelse',
  poa_rejected: 'Fullmakt nekad', completion_requested: 'Komplettering begärd', facility_information: 'Anläggningsuppgifter',
  contract_information: 'Avtalsuppgifter', other: 'Övrigt svar',
}
const failures: Record<string, string> = {
  authentication: 'API-behörighet behöver kontrolleras.', rate_limited: 'Leverantörens anropsgräns nåddes.',
  provider_unavailable: 'AI-tjänsten var inte tillgänglig.', transport_error: 'AI-anropet kunde inte slutföras.',
  invalid_output: 'Svaret kunde inte valideras mot mejltexten.', input_too_large: 'Mejlet behöver granskas manuellt på grund av sin längd.',
  empty_input: 'Ingen läsbar svarstext.', disabled: 'Automatisk AI-läsning är avstängd.', not_configured: 'AI-nyckel saknas i servermiljön.',
}

export default function ManualMailAiReading({ payload, companyId, customerId, requestId }: {
  payload: unknown; companyId: string | null; customerId: string | null; requestId: string | null
}) {
  const raw = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).ai_read_only : null
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
      <summary className="cursor-pointer font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">AI-förslag: {labels[reading.outcome ?? ''] ?? 'Övrigt svar'}</summary>
      <p className="mt-2 text-amber-800">Behöver granskas. Inga kunduppgifter eller leveransdatum ändras av AI-läsningen.</p>
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
