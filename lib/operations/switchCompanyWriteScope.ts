import type { SupabaseClient } from '@supabase/supabase-js'
import { isCompanyWritableInTenantWorkspace } from '@/lib/tenant/lifecycle'

export async function readWritableSwitchCompanyIds(
  supabase: SupabaseClient,
  companyIds: readonly (string | null | undefined)[],
): Promise<Set<string>> {
  const ids = [...new Set(companyIds.filter((id): id is string => Boolean(id)))]
  const writable = new Set<string>()

  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100)
    const { data, error } = await supabase.from('companies').select('id,status').in('id', batch)
    if (error) throw error

    for (const company of data ?? []) {
      if (batch.includes(company.id) && isCompanyWritableInTenantWorkspace(company.status)) {
        writable.add(company.id)
      }
    }
  }

  return writable
}
