import 'server-only'

import type { GuardResult } from '@/lib/admin/guards'
import { listPriceAreas } from '@/lib/masterdata/db'
import { supabaseService } from '@/lib/supabase/service'

/** Global reference catalogue; the customer page supplies its verified guard. */
export async function loadPlatformCustomerSitePriceAreas(access: GuardResult | null) {
  if (access?.isPlatformAdmin !== true) return []

  // 20260904120000 intentionally keeps this catalogue service-role-only.
  // Customer, site and other tenant-owned reads remain on the request client.
  return listPriceAreas(supabaseService)
}
