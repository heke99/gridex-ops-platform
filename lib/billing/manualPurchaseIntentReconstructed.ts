import 'server-only'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { resolveCapwayConnectionConfig } from '@/lib/integrations/billing/capway/auth'
import type { CapwayPurchaseRequest } from '@/lib/integrations/billing/capway/types'

const uuid = z.string().uuid()
const object = z.record(z.string(), z.unknown())
const receiptSchema = z.object({
  companyId: uuid, itemId: uuid, intentId: uuid, actorUserId: uuid, sessionId: uuid,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/), snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  connectionHash: z.string().regex(/^[a-f0-9]{64}$/),
  invoiceGuid: z.string().min(1), environment: z.enum(['test', 'production']),
  status: z.enum(['dispatch_started', 'response_observed', 'rejected', 'uncertain']),
  shouldPost: z.boolean(), response: object.nullable(), payload: object,
  financingMode: z.enum(['factoring_without_recourse', 'factoring_with_recourse']),
  itemBinding: object,
}).strict()
export type ManualPurchaseReceipt = z.infer<typeof receiptSchema>
export type ManualPurchaseCommand = {
  companyId: string; itemId: string; actorUserId: string; sessionId: string;
  financingMode: 'factoring_without_recourse' | 'factoring_with_recourse';
  payload: CapwayPurchaseRequest; itemBinding: Record<string, unknown>;
  connectionJson: string;
}
export class ManualPurchaseIntentError extends Error {
  constructor(readonly status: number) { super('manual_purchase_unavailable'); this.name = 'ManualPurchaseIntentError' }
}

/** This is a fingerprint of existing immutable fields, not an invoice revision. */
export function manualPurchaseItemBinding(item: Record<string, unknown>) {
  return Object.fromEntries(['id', 'company_id', 'export_run_id', 'customer_id', 'customer_contract_id',
    'billing_underlay_id', 'pricing_run_id', 'provider', 'environment', 'financing_mode',
    'provider_invoice_guid', 'provider_invoice_id', 'provider_request_id', 'provider_idempotency_key',
    'idempotency_key', 'request_payload', 'amount_ex_vat', 'vat_amount', 'amount_inc_vat',
    'rounding_amount', 'total_kwh', 'currency', 'period_start', 'period_end', 'sent_at', 'provider_confirmed_at'].map(key => [key, item[key] ?? null]))
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export async function resolveManualPurchaseConfiguration(companyId: string, environment: 'test' | 'production') {
  let connection: Record<string, unknown> | null = null
  const configuration = await resolveCapwayConnectionConfig({ companyId, environment,
    onConnectionResolved: value => { connection = value } })
  const parsed = z.object({ id: uuid, company_id: z.literal(companyId), provider: z.literal('capway_aptic'),
    environment: z.literal(environment), status: z.enum(['ready','active']), settings: object, secret_reference: object }).strict().safeParse(connection)
  if (!parsed.success || configuration.companyId !== companyId || configuration.environment !== environment || configuration.provider !== 'capway_aptic') {
    throw new ManualPurchaseIntentError(409)
  }
  return { configuration, connectionJson: stable(parsed.data) }
}
async function command(name: string, input: ManualPurchaseCommand, extra: Record<string, unknown> = {}) {
  if (![input.companyId, input.itemId, input.actorUserId, input.sessionId].every(value => uuid.safeParse(value).success)) {
    throw new ManualPurchaseIntentError(422)
  }
  const { data, error } = await supabaseService.rpc(name, { p_command: { ...input, ...extra } })
  if (error) {
    if (error.code === '42501') throw new ManualPurchaseIntentError(403)
    if (['23505', '40001', '55000'].includes(error.code)) throw new ManualPurchaseIntentError(409)
    if (['22023', '22P02'].includes(error.code)) throw new ManualPurchaseIntentError(422)
    throw new ManualPurchaseIntentError(500)
  }
  const parsed = receiptSchema.safeParse(data)
  if (!parsed.success || parsed.data.companyId !== input.companyId || parsed.data.itemId !== input.itemId
    || parsed.data.actorUserId !== input.actorUserId || parsed.data.sessionId !== input.sessionId
    || parsed.data.financingMode !== input.financingMode
    || parsed.data.connectionHash !== createHash('sha256').update(input.connectionJson).digest('hex')
    || stable(parsed.data.payload) !== stable(input.payload) || stable(parsed.data.itemBinding) !== stable(input.itemBinding)
    || parsed.data.invoiceGuid !== input.itemBinding.provider_invoice_guid || parsed.data.environment !== input.itemBinding.environment
    || (parsed.data.shouldPost && (parsed.data.status !== 'dispatch_started' || parsed.data.response !== null))
    || (name !== 'gridex_claim_manual_invoice_purchase_v1' && (parsed.data.shouldPost || parsed.data.intentId !== extra.intentId
      || parsed.data.requestHash !== extra.requestHash || parsed.data.snapshotHash !== extra.snapshotHash || parsed.data.status !== extra.outcome))) {
    throw new ManualPurchaseIntentError(500)
  }
  return parsed.data
}
/** Only a fresh, committed item-scoped barrier permits the one provider POST. */
export function claimManualPurchase(input: ManualPurchaseCommand) {
  return command('gridex_claim_manual_invoice_purchase_v1', input)
}
/** An observed HTTP response is distinct from provider purchase approval. */
export function completeManualPurchase(input: ManualPurchaseCommand, receipt: ManualPurchaseReceipt,
  outcome: 'response_observed' | 'rejected' | 'uncertain', observation: Record<string, unknown>) {
  return command('gridex_complete_manual_invoice_purchase_v1', input, {
    intentId: receipt.intentId, requestHash: receipt.requestHash, snapshotHash: receipt.snapshotHash, outcome, observation,
  })
}
