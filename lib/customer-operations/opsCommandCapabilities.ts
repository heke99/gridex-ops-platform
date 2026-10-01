import 'server-only'
import { unstable_rethrow } from 'next/navigation'
import { z } from 'zod'
import { supabaseService } from '@/lib/supabase/service'
import { currentSupportSession } from './supportSession'

const requestSchema = z.object({
  companyId: z.string().uuid(), customerId: z.string().uuid(), expectedUserId: z.string().uuid(),
}).strict()
const capabilitySchema = z.object({
  canEditContact: z.boolean(), canEditAddresses: z.boolean(), canEditBilling: z.boolean(),
  canEditLegalProfile: z.boolean(), canCloseLifecycle: z.boolean(), canEditSites: z.boolean(),
}).strict()
const responseSchema = capabilitySchema.extend({
  companyId: z.string().uuid(), customerId: z.string().uuid(),
  actorUserId: z.string().uuid(), sessionId: z.string().uuid(),
}).strict()

export type CustomerOpsCommandCapabilities = z.infer<typeof capabilitySchema> & {
  status: 'ready' | 'read_only' | 'unavailable'
}
const denied = {
  canEditContact: false, canEditAddresses: false, canEditBilling: false,
  canEditLegalProfile: false, canCloseLifecycle: false, canEditSites: false,
}

/** A fresh UI projection for this customer, never a write authorization token.
 * Commands recheck current authority under their own locks when submitted. */
export async function getCustomerOpsCommandCapabilities(input: {
  companyId: string; customerId: string; expectedUserId: string
}): Promise<CustomerOpsCommandCapabilities> {
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) return { status: 'unavailable', ...denied }
  const companyId = parsed.data.companyId.toLowerCase()
  const customerId = parsed.data.customerId.toLowerCase()
  try {
    const actor = await currentSupportSession('ops', parsed.data.expectedUserId.toLowerCase())
    const { data, error } = await supabaseService.rpc('gridex_customer_ops_command_capabilities_v1', {
      p_company_id: companyId, p_customer_id: customerId,
      p_user_id: actor.userId, p_session_id: actor.sessionId,
    })
    const response = responseSchema.safeParse(data)
    if (error || !response.success || response.data.companyId !== companyId || response.data.customerId !== customerId ||
      response.data.actorUserId !== actor.userId || response.data.sessionId !== actor.sessionId) {
      return { status: 'unavailable', ...denied }
    }
    const capabilities = capabilitySchema.strip().parse(response.data)
    return { status: Object.values(capabilities).some(Boolean) ? 'ready' : 'read_only', ...capabilities }
  } catch (error) {
    unstable_rethrow(error)
    return { status: 'unavailable', ...denied }
  }
}
