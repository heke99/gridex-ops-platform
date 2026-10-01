import 'server-only'
import { z } from 'zod'
import { PlatformSchemaNotReadyError } from '@/lib/platform/schemaReadiness'
import { supabaseService } from '@/lib/supabase/service'

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable()
const uuid = z.string().uuid().transform(value => value.toLowerCase())
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return !value.startsWith('0000-') && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}).nullable()
const addressFields = z.object({
  type: z.enum(['registered', 'billing', 'other']),
  street_1: z.string().trim().min(1).max(300), street_2: nullableText(300),
  postal_code: nullableText(40), city: nullableText(120), country: z.string().regex(/^[A-Z]{2}$/),
  municipality: nullableText(120), moved_in_at: date, moved_out_at: date, is_active: z.boolean(),
}).strict().refine(value => !value.moved_in_at || !value.moved_out_at || value.moved_out_at >= value.moved_in_at)
const inputSchema = z.object({
  companyId: uuid, customerId: uuid, addressId: uuid.nullable().optional(),
  actor: z.object({ kind: z.literal('ops'), userId: uuid, sessionId: uuid,
    reason: z.string().trim().min(1).max(200) }).strict(),
  expectedRevision: z.number().int().nonnegative().safe(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:+~-]{8,200}$/), changes: addressFields,
}).strict()

export type CustomerAddressChanges = z.infer<typeof addressFields>
export type AddressCommandInput = z.infer<typeof inputSchema>
export type AddressCommandResult = { addressId: string; revision: number; changed: boolean; replayed: boolean }
export class AddressCommandError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = 'AddressCommandError' }
}

/** Address-book fields only. Current OPS session, tenant, permission, selection,
 * revision and replay are checked again under the shared database authority locks. */
export async function changeCustomerAddress(input: AddressCommandInput): Promise<AddressCommandResult> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) throw new AddressCommandError('invalid_address_command', 422)
  const candidate = parsed.data
  const p_command = {
    companyId: candidate.companyId, customerId: candidate.customerId, addressId: candidate.addressId ?? null,
    actorUserId: candidate.actor.userId, sessionId: candidate.actor.sessionId, reason: candidate.actor.reason,
    expectedRevision: candidate.expectedRevision, idempotencyKey: candidate.idempotencyKey, changes: candidate.changes,
  }
  const { data, error } = await supabaseService.rpc('gridex_change_customer_address_book_v1', { p_command })
  if (error) {
    const code = String(error.message ?? '')
    if ((['42883', 'PGRST202'].includes(String(error.code)) && code.includes('gridex_change_customer_address_book_v1')) ||
        (['42703', 'PGRST204'].includes(String(error.code)) && code.includes('address_book_revision'))) {
      throw new PlatformSchemaNotReadyError('Adressbokens aktuella databasgräns är ännu inte tillgänglig.')
    }
    if (['address_book_revision_conflict', 'address_book_idempotency_conflict', 'address_book_selection_conflict'].includes(code)) {
      throw new AddressCommandError(code, 409)
    }
    if (['address_service_required', 'address_actor_forbidden', 'address_customer_unavailable', 'address_tenant_unavailable'].includes(code)) {
      throw new AddressCommandError(code, 403)
    }
    if (['invalid_address_command', 'invalid_customer_address'].includes(code)) throw new AddressCommandError(code, 422)
    throw error
  }
  const result = data as Record<string, unknown> | null
  if (!result || result.companyId !== candidate.companyId || result.customerId !== candidate.customerId ||
      !z.string().uuid().safeParse(result.addressId).success ||
      (candidate.addressId && result.addressId !== candidate.addressId) ||
      !Number.isSafeInteger(result.revision) || Number(result.revision) < 0 ||
      typeof result.changed !== 'boolean' || typeof result.replayed !== 'boolean' ||
      result.revision !== candidate.expectedRevision + (result.changed ? 1 : 0)) {
    throw new AddressCommandError('address_result_invalid', 503)
  }
  return { addressId: result.addressId as string, revision: result.revision as number, changed: result.changed, replayed: result.replayed }
}
