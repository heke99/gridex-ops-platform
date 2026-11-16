import 'server-only'

import type { GuardResult } from '@/lib/admin/guards'
import { listPriceAreas } from '@/lib/masterdata/db'
import { supabaseService } from '@/lib/supabase/service'

/** The intake page supplies its verified, company-scoped canonical guard. */
export async function loadCustomerIntakePriceAreas(access: GuardResult | null) {
  const permitted = access?.isPlatformAdmin === true || access?.permissions.some(
    permission => permission === 'customers.write' || permission === 'masterdata.read',
  )
  if (!permitted) return []

  // Only this global reference catalogue crosses the service-only RLS boundary.
  // Company, customer, site and offer reads retain their existing request scope.
  return listPriceAreas(supabaseService)
}
