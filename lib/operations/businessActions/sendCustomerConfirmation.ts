import { actionPreflight } from '@/lib/operations/businessActions/actionPreflight'
import { decideBusinessAction } from '@/lib/operations/businessActions/actionDecisionEngine'
import { supabaseService } from '@/lib/supabase/service'

export async function sendCustomerConfirmation(input: {
  actorUserId: string
  customerId: string
  event: string
  templateId?: string | null
}) {
  const preflight = await actionPreflight(input)
  const decision = decideBusinessAction('send_customer_confirmation')
  if (!preflight.ok) return { ok: false, preflight, decision, message: 'Kan inte skicka bekräftelsemail' }

  const { data, error } = await supabaseService
    .from('customer_communications')
    .insert({
      company_id: preflight.companyId,
      customer_id: input.customerId,
      template_id: input.templateId ?? null,
      event_type: input.event,
      status: 'queued',
      channel: 'email',
      created_by: input.actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error
  return { ok: true, preflight, decision, communication: data }
}
