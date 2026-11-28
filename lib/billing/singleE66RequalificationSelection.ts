import { z } from 'zod'
import { loadQualifiedBillingValues } from '@/lib/billing/sourceBasis'
import { tenantSelect } from '@/lib/supabase/tenantQuery'

const instant = z.string().datetime({ offset: true })
  .regex(/T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/)
  .refine(value => Number.isFinite(Date.parse(value)))
const environment = z.enum(['test', 'production'])
const id = z.string().uuid()

function instantMicros(value: string) {
  const subMilliseconds = /\.(\d{1,6})/.exec(value)?.[1]?.padEnd(6, '0').slice(3) ?? '000'
  return BigInt(Date.parse(value)) * BigInt(1000) + BigInt(subMilliseconds)
}

export const singleE66SelectionQuery = z.strictObject({
  point: z.string().trim().max(64)
    .transform(point => point.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
    .pipe(z.string().min(1)),
  from: instant,
  until: instant,
  environment,
}).refine(({ from, until }) => instantMicros(from) < instantMicros(until))

const candidate = z.object({
  id,
  company_id: id,
  source_message_id: id,
  source_metering_value_id: id,
  period_start: instant,
  period_end: instant,
  point: z.object({ company_id: id, normalized_metering_point_id: z.string() }),
})

const qualifiedValue = z.object({
  id,
  company_id: id,
  source_message_id: id,
  source_metering_value_id: id,
  period_start: instant,
  period_end: instant,
  revision_status: z.literal('current'),
  billing_status: z.literal('billable'),
  billing_gate_status: z.literal('eligible'),
  direction: z.literal('consumption'),
  billing_source_basis: z.object({
    qualified: z.literal(true),
    sourceMessageId: id,
    sourcePayloadHash: z.string().regex(/^[0-9a-f]{64}$/),
    quantityType: z.literal('136'),
    quantityKwh: z.string(),
  }),
  billing_source_message: z.object({
    id,
    company_id: id,
    message_family: z.literal('UTILTS'),
    message_code: z.literal('E66'),
  }),
})

const sourceIdentity = z.object({
  id,
  company_id: id,
  environment,
  immutable_payload_hash: z.string(),
})

const candidateLimit = 2

export async function findSingleE66RequalificationSelection(
  companyId: string,
  input: z.output<typeof singleE66SelectionQuery>,
) {
  const { data, error } = await tenantSelect(companyId, 'normalized_metering_values',
    'id,company_id,source_message_id,source_metering_value_id,period_start,period_end,point:metering_points!normalized_metering_values_company_meter_fkey!inner(company_id,normalized_metering_point_id)')
    .eq('point.company_id', companyId)
    .eq('point.normalized_metering_point_id', input.point)
    .eq('period_start', input.from)
    .eq('period_end', input.until)
    .eq('revision_status', 'current')
    .eq('billing_status', 'billable')
    .eq('billing_gate_status', 'eligible')
    .eq('direction', 'consumption')
    .not('supply_period_id', 'is', null)
    .not('source_message_id', 'is', null)
    .not('source_metering_value_id', 'is', null)
    .limit(candidateLimit + 1)
  if (error) throw error
  const matches = z.array(candidate).parse(data)
  if (matches.length > candidateLimit) return { status: 'ambiguous' } as const
  if (matches.length === 0) return { status: 'missing' } as const

  const sourceOf = new Map(matches.map(row => [row.id, row.source_message_id]))
  if (sourceOf.size !== matches.length || matches.some(row => row.company_id !== companyId ||
      row.point.company_id !== companyId || row.point.normalized_metering_point_id !== input.point ||
      instantMicros(row.period_start) !== instantMicros(input.from) ||
      instantMicros(row.period_end) !== instantMicros(input.until))) {
    throw new Error('single_e66_billing_selection_scope_invalid')
  }

  const values = await loadQualifiedBillingValues(companyId, [...sourceOf.keys()], sourceOf)
  const selected = []
  for (const row of matches) {
    const qualified = qualifiedValue.safeParse(values.get(row.id))
    if (!qualified.success) return { status: 'unverified' } as const
    const value = qualified.data
    if (value.id !== row.id || value.company_id !== companyId || value.source_message_id !== row.source_message_id ||
        value.source_metering_value_id !== row.source_metering_value_id ||
        value.billing_source_basis.sourceMessageId !== row.source_message_id ||
        value.billing_source_basis.quantityKwh.startsWith('-') ||
        value.billing_source_message.id !== row.source_message_id || value.billing_source_message.company_id !== companyId ||
        instantMicros(value.period_start) !== instantMicros(row.period_start) ||
        instantMicros(value.period_end) !== instantMicros(row.period_end)) {
      return { status: 'unverified' } as const
    }

    // The native basis binds the source rule receipt to the source's original environment and digest.
    const { data: source, error: sourceError } = await tenantSelect(companyId, 'ediel_messages',
      'id,company_id,environment,immutable_payload_hash')
      .eq('id', row.source_message_id)
      .eq('direction', 'inbound')
      .eq('message_standard', 'edifact')
      .eq('message_family', 'UTILTS')
      .eq('message_code', 'E66')
      .eq('immutable_payload_hash', value.billing_source_basis.sourcePayloadHash)
      .maybeSingle()
    if (sourceError) throw sourceError
    const original = sourceIdentity.safeParse(source)
    if (!original.success || original.data.id !== row.source_message_id || original.data.company_id !== companyId ||
        original.data.immutable_payload_hash !== value.billing_source_basis.sourcePayloadHash) {
      return { status: 'unverified' } as const
    }
    if (original.data.environment === input.environment) {
      selected.push({
        normalizedValueId: row.id,
        environment: original.data.environment,
        periodStart: value.period_start,
        periodEnd: value.period_end,
      })
    }
  }

  if (selected.length > 1) return { status: 'ambiguous' } as const
  if (selected.length === 0) return { status: 'missing' } as const
  return { status: 'found', value: selected[0] } as const
}
