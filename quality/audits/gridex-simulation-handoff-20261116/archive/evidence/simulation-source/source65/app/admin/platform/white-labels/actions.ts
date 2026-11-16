'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Only platform superadmins may attach or detach a tenant. The RPC re-checks
// gridex_user_is_platform_admin(), locks the company row and writes audit_logs.
export async function assignCompanyToWhiteLabelAction(formData: FormData) {
  await requirePlatformAdminActionAccess()
  const companyId = String(formData.get('company_id') ?? '')
  const platformRaw = String(formData.get('white_label_platform_id') ?? '')
  if (!UUID.test(companyId)) throw new Error('Välj ett bolag.')
  if (platformRaw && !UUID.test(platformRaw)) throw new Error('Ogiltig plattform.')

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('gridex_assign_company_to_whitelabel', {
    p_company_id: companyId,
    p_white_label_platform_id: platformRaw || null,
  })
  if (error) throw new Error(error.message)

  revalidatePath('/admin/platform/white-labels')
}
