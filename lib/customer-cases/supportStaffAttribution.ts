import { z } from 'zod'
import { publicReference } from '@/lib/integrations/publicReferences'

/** Attribute only the saved staff author. Historical unknown authors remain
 * unknown; the customer reading a summary is never its inferred author. */
export function publicSupportStaffReference(
  companyId: string,
  authorKind: 'customer' | 'staff',
  storedActorUserId: string | null | undefined,
): string | null {
  if (authorKind !== 'staff' || !z.string().uuid().safeParse(storedActorUserId).success) return null
  return publicReference('support_staff', companyId, storedActorUserId)
}
