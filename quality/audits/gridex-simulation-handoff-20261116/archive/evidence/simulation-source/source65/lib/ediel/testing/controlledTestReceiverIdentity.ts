import 'server-only'
import { z } from 'zod'
import { supabaseService } from '@/lib/supabase/service'

export class ControlledTestReceiverInputError extends Error {}

const uuid = z.string().uuid()
const issueSchema = z.object({
  companyId: uuid,
  environment: z.literal('test'),
  receiverEdielId: z.string().trim().regex(/^\d{5}$/),
  role: z.enum(['supplier', 'esco']),
  purpose: z.string().trim().min(1).max(200),
  expiresAt: z.string().datetime({ offset: true }),
  idempotencyKey: z.string().trim().min(8).max(200),
  acknowledgement: z.literal('LOCAL_TEST_ONLY'),
}).strict()
const revokeSchema = z.object({
  companyId: uuid, registrationId: uuid,
  reason: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict()
const receiptSchema = z.object({
  registrationId: uuid, companyId: uuid, actorId: uuid,
  receiverEdielId: z.string().regex(/^\d{5}$/),
  roleCode: z.enum(['electricity_supplier', 'energy_service_company']),
  assurance: z.literal('LOCAL_SIMULATION_ONLY'),
  status: z.enum(['issued', 'expired', 'revoked']),
  validFrom: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }),
}).passthrough()
export type ControlledTestReceiverReceipt = z.infer<typeof receiptSchema>

function verifiedInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new ControlledTestReceiverInputError('Kontrollera bolag, femsiffrigt test-ID, roll, giltighet och bekräftelsen för enbart lokalt TEST.')
  }
  return result.data
}

function receipt(value: unknown, companyId: string): ControlledTestReceiverReceipt {
  const parsed = receiptSchema.safeParse(value)
  if (!parsed.success || parsed.data.companyId !== companyId) {
    throw new Error('Mottagaridentitetens kvitto kunde inte verifieras för bolaget.')
  }
  return parsed.data
}

export async function issueControlledTestReceiverIdentity(actorUserId: string, input: unknown) {
  const actor = verifiedInput(uuid, actorUserId)
  const parsed = verifiedInput(issueSchema, input)
  const roleCode = parsed.role === 'supplier' ? 'electricity_supplier' : 'energy_service_company'
  const { data, error } = await supabaseService.rpc('issue_controlled_test_receiver_identity_v1', {
    p_company_id: parsed.companyId, p_actor_user_id: actor,
    p_command: {
      environment: 'test', assurance: 'LOCAL_SIMULATION_ONLY', receiver_ediel_id: parsed.receiverEdielId,
      role_code: roleCode, purpose: parsed.purpose,
      expires_at: new Date(parsed.expiresAt).toISOString(), idempotency_key: parsed.idempotencyKey,
    },
  })
  if (error) throw error
  const result = receipt(data, parsed.companyId)
  if (result.receiverEdielId !== parsed.receiverEdielId || result.roleCode !== roleCode) {
    throw new Error('Mottagaridentitetens kvitto matchar inte begärt test-ID och roll.')
  }
  return result
}

export async function revokeControlledTestReceiverIdentity(actorUserId: string, input: unknown) {
  const actor = verifiedInput(uuid, actorUserId)
  const parsed = verifiedInput(revokeSchema, input)
  const { data, error } = await supabaseService.rpc('revoke_controlled_test_receiver_identity_v1', {
    p_company_id: parsed.companyId, p_actor_user_id: actor,
    p_command: { registration_id: parsed.registrationId, reason: parsed.reason, idempotency_key: parsed.idempotencyKey },
  })
  if (error) throw error
  const result = receipt(data, parsed.companyId)
  if (result.registrationId !== parsed.registrationId || result.status !== 'revoked') {
    throw new Error('Mottagaridentitetens kvitto bekräftar inte den begärda återkallelsen.')
  }
  return result
}

export async function loadControlledTestReceiverIdentities(actorUserId: string, companyId: string) {
  const actor = verifiedInput(uuid, actorUserId)
  const company = verifiedInput(uuid, companyId)
  const { data, error } = await supabaseService.rpc('read_controlled_test_receiver_identities_v1', {
    p_company_id: company, p_actor_user_id: actor,
  })
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Mottagaridentiteternas kvitton kunde inte läsas.')
  return data.map(value => receipt(value, company))
}
