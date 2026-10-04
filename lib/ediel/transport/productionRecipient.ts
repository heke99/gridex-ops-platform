import { tenantDb } from '@/lib/supabase/tenantDb'
import type { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { edielRecipientAddresses } from '@/lib/ediel/core/productionGuards'

/** Read current tenant test-portal aliases before a fresh production attempt. */
export async function assertNoConfiguredPortalRecipient(message: EdielMessageRow): Promise<void> {
  if (message.environment !== 'production') return
  const query = tenantDb(message.company_id).from('ediel_counterparties')
    .select('email,email_address') as ReturnType<ReturnType<typeof supabaseService.from>['select']>
  const { data, error } = await query.eq('environment', 'test').eq('is_active', true)
    .or('role.eq.test_portal,counterparty_role.eq.test_portal')
  if (error) throw error
  const rows = (data ?? []) as Array<{ email?: string | null; email_address?: string | null }>
  const portals = new Set(rows.flatMap(row => [
    ...edielRecipientAddresses(row.email), ...edielRecipientAddresses(row.email_address),
  ]))
  if (edielRecipientAddresses(message.receiver_email).some(address => portals.has(address))) {
    throw new Error('ediel_portal_email_in_production: Produktionsruntime innehåller en konfigurerad testportal som SMTP-mottagare. Live-send stoppas.')
  }
}
