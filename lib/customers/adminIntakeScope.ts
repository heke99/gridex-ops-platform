import 'server-only'

import { requireAdminActionAccess } from '@/lib/admin/guards'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'

export async function requireAdminCustomerIntakeContext() {
  const actor = await requireAdminActionAccess({ allOf: ['customers.write'] })
  const { companyId } = await resolveAdminSelectedCompanyReadScope(actor, { allowMissing: true })
  if (!companyId) throw new Error('Välj ett bolag innan du registrerar eller importerar kunder.')
  await requireCompanyOperationalForWrites(companyId)
  return { actor, companyId }
}
