import { z } from 'zod'
import { updateMeterValueBillingReadiness } from '@/lib/billing/meterValueBillingMatcher'
import { loadQualifiedBillingValues } from '@/lib/billing/sourceBasis'
import { supabaseService } from '@/lib/supabase/service'

export const mixedE66BillingRequest = z.object({
  rawUnderlayId: z.string().uuid(),
  offset: z.number().int().min(0).max(2_147_483_647).default(0),
  limit: z.number().int().min(1).max(16).default(8),
})

const batchReceipt = z.object({
  offset: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  members: z.array(z.object({
    normalizedId: z.string().uuid(),
    sourceId: z.string().uuid(),
    meterValue: z.object({
      id: z.string().uuid(),
      company_id: z.string().uuid(),
      metering_point_id: z.string().uuid(),
      period_start: z.string(),
      period_end: z.string(),
      source_ediel_message_id: z.string().uuid(),
      canonical_dedupe_key: z.string().nullable(),
      source_transaction_reference: z.string().nullable(),
      source_system: z.literal('ediel_utilts'),
    }),
  })).min(1).max(16),
})

type BatchScope = {
  p_company_id: string
  p_actor_user_id: string
  p_raw_underlay_id: string
  p_offset: number
  p_limit: number
}

export async function qualifyMixedE66BillingBatch(input: z.output<typeof mixedE66BillingRequest> & {
  companyId: string
  actorUserId: string
}) {
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (
    name: 'gridex_read_mixed_e66_billing_readiness_batch_v1', args: BatchScope
  ) => PromiseLike<{ data: unknown; error: { code: string; message: string } | null }>
  const selected = await rpc('gridex_read_mixed_e66_billing_readiness_batch_v1', {
    p_company_id: input.companyId,
    p_actor_user_id: input.actorUserId,
    p_raw_underlay_id: input.rawUnderlayId,
    p_offset: input.offset,
    p_limit: input.limit,
  })
  if (selected.error) throw selected.error
  const batch = batchReceipt.parse(selected.data)
  const sourceOf = new Map(batch.members.map(member => [member.normalizedId, member.sourceId]))
  if (batch.offset !== input.offset || batch.members.length !== Math.min(input.limit, batch.total - batch.offset) ||
      sourceOf.size !== batch.members.length || batch.members.some(({ meterValue, sourceId }) =>
        meterValue.company_id !== input.companyId || meterValue.source_ediel_message_id !== sourceId)) {
    throw new Error('mixed_e66_billing_readiness_invalid_receipt')
  }

  const qualifiedValues = await loadQualifiedBillingValues(input.companyId, [...sourceOf.keys()], sourceOf)
  let eligible = 0
  for (const { meterValue, sourceId, normalizedId } of batch.members) {
    const state = await updateMeterValueBillingReadiness({
      meterValue,
      sourceMessageId: sourceId,
      qualifiedValues,
      async commitBillingGate(command) {
        if (command.p_company_id !== input.companyId || command.p_metering_value_id !== meterValue.id ||
            command.p_normalized_value_id !== normalizedId || command.p_gate.source_message_id !== sourceId) {
          throw new Error('mixed_e66_billing_readiness_changed')
        }
        const result = await supabaseService.rpc('gridex_set_metering_billing_gate', command)
        if (result.error) throw result.error
      },
    })
    if (state === 'billable') eligible += 1
  }
  const next = batch.offset + batch.members.length
  return { processed: batch.members.length, eligible, held: batch.members.length - eligible,
    total: batch.total, nextOffset: next === batch.total ? null : next }
}
