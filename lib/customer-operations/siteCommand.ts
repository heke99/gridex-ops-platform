import 'server-only'
import { z } from 'zod'
import { supabaseService } from '@/lib/supabase/service'
import { PlatformSchemaNotReadyError } from '@/lib/platform/schemaReadiness'
import { computeCustomerSiteAddressHash, normalizeSwedishPostalCode } from '@/lib/customer-sites/addressIntake'

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable()
const uuid = z.string().uuid().transform((value) => value.toLowerCase())
const date = nullableText(10).refine((value) => value === null || (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value))
const changesSchema = z.object({
  site_name: z.string().trim().min(1).max(200), facility_id: nullableText(120),
  site_type: z.enum(['consumption', 'production', 'mixed']), status: z.enum(['draft', 'active', 'pending_move', 'inactive', 'closed']),
  move_in_date: date, annual_consumption_kwh: z.number().finite().min(0).max(1_000_000_000_000).nullable(),
  current_supplier_name: nullableText(240), current_supplier_org_number: nullableText(50),
  street: nullableText(300), care_of: nullableText(200), postal_code: nullableText(20), city: nullableText(120),
  country: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()),
  moved_from_street: nullableText(300), moved_from_postal_code: nullableText(20), moved_from_city: nullableText(120),
  moved_from_supplier_name: nullableText(240), internal_notes: nullableText(10_000),
}).strict()
const inputSchema = z.object({
  companyId: uuid, customerId: uuid, siteId: uuid.nullable(),
  actor: z.object({ kind: z.literal('ops'), userId: uuid, sessionId: uuid, reason: z.string().trim().min(1).max(200) }).strict(),
  expectedRevision: z.number().int().nonnegative().safe(), idempotencyKey: z.string().regex(/^[A-Za-z0-9._:+~-]{8,200}$/),
  siteFlowType: z.enum(['switch', 'move_in', 'move_out_takeover']), changes: changesSchema,
  addressHints: z.object({ claimedGridOwnerId: uuid.nullable(), claimedPriceAreaCode: z.enum(['SE1', 'SE2', 'SE3', 'SE4']).nullable() }).strict(),
}).strict().superRefine((input, context) => {
  if ((!input.siteId && input.expectedRevision !== 0) ||
      (input.siteFlowType !== 'switch' && (!input.changes.move_in_date || !input.changes.street || !input.changes.postal_code || !input.changes.city)) ||
      (input.siteFlowType === 'switch' && [input.changes.moved_from_street, input.changes.moved_from_postal_code,
        input.changes.moved_from_city, input.changes.moved_from_supplier_name].some((value) => value !== null))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_site_flow' })
  }
})
export type SiteCommandInput = z.input<typeof inputSchema>
export type SiteCommandResult = { siteId: string; revision: number; changed: boolean; replayed: boolean; addressStatus: 'updated' | 'unchanged' | 'incomplete' | 'conflict' }
export class SiteCommandError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = 'SiteCommandError' }
}

function unavailableSchema(error: { code?: string; message?: string }) {
  if (['42883', '42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code ?? '')) {
    throw new PlatformSchemaNotReadyError('Anläggningens databasgräns är ännu inte tillgänglig.')
  }
}

/** The form supplies changes and the saved revision only. The current actor
 * comes from verified auth; the RPC locks and rechecks all authority before
 * replay or effects. A read here only preserves the unexposed apartment field. */
export async function saveCustomerSiteCommand(input: SiteCommandInput): Promise<SiteCommandResult> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) throw new SiteCommandError('invalid_site_command', 422)
  const command = parsed.data
  let apartmentNumber: string | null = null
  if (command.siteId) {
    const { data, error } = await supabaseService.from('customer_sites').select('id,apartment_number')
      .eq('id', command.siteId).eq('company_id', command.companyId).eq('customer_id', command.customerId).maybeSingle()
    if (error) { unavailableSchema(error); throw error }
    apartmentNumber = typeof data?.apartment_number === 'string' ? data.apartment_number : null
  }
  const clean = (value: string | null) => value?.trim().replace(/\s+/g, ' ') || null
  const street = clean(command.changes.street), city = clean(command.changes.city), careOf = clean(command.changes.care_of)
  const postalCode = normalizeSwedishPostalCode(command.changes.postal_code)
  const hash = computeCustomerSiteAddressHash({ street, postalCode, city, country: command.changes.country, apartmentNumber })
  const p_command = {
    companyId: command.companyId, customerId: command.customerId, siteId: command.siteId,
    actorUserId: command.actor.userId, sessionId: command.actor.sessionId, reason: command.actor.reason,
    expectedRevision: command.expectedRevision, idempotencyKey: command.idempotencyKey,
    siteFlowType: command.siteFlowType, changes: command.changes, addressHints: command.addressHints,
    candidate: { street, city, care_of: careOf, postal_code: postalCode, country: command.changes.country,
      apartment_number: apartmentNumber, complete: hash.complete, normalized: hash.normalized, address_hash: hash.hash },
  }
  const { data, error } = await supabaseService.rpc('gridex_save_customer_site_v1', { p_command })
  if (error) {
    unavailableSchema(error)
    const code = String(error.message ?? '')
    if (['site_revision_conflict', 'site_idempotency_conflict'].includes(code)) throw new SiteCommandError(code, 409)
    if (['site_service_required', 'site_actor_forbidden', 'site_customer_unavailable', 'site_tenant_unavailable'].includes(code)) throw new SiteCommandError(code, 403)
    if (code === 'site_resource_not_found') throw new SiteCommandError(code, 404)
    if (['invalid_site_command', 'invalid_site_field', 'invalid_site_flow', 'site_candidate_invalid'].includes(code)) throw new SiteCommandError(code, 422)
    throw error
  }
  const result = data as Record<string, unknown> | null
  if (!result || result.companyId !== command.companyId || result.customerId !== command.customerId ||
      typeof result.siteId !== 'string' || !z.string().uuid().safeParse(result.siteId).success ||
      (command.siteId !== null && result.siteId !== command.siteId) ||
      !Number.isSafeInteger(result.revision) || Number(result.revision) < 0 ||
      typeof result.changed !== 'boolean' || typeof result.replayed !== 'boolean' ||
      !['updated', 'unchanged', 'incomplete', 'conflict'].includes(String(result.addressStatus))) {
    throw new SiteCommandError('site_result_invalid', 503)
  }
  return { siteId: result.siteId, revision: result.revision as number, changed: result.changed, replayed: result.replayed,
    addressStatus: result.addressStatus as SiteCommandResult['addressStatus'] }
}
