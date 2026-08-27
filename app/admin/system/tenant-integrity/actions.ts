'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { runTenantIntegrityAudit, type TenantIntegrityScope } from '@/lib/tenant/integrity'

const ALLOWED_SCOPES = new Set<TenantIntegrityScope>(['all', 'access', 'operations', 'ediel'])

export async function runTenantIntegrityAuditAction(formData: FormData): Promise<void> {
  const admin = await requirePlatformAdminActionAccess()
  const rawCompanyId = String(formData.get('companyId') ?? '').trim()
  const rawScope = String(formData.get('scope') ?? 'all').trim().toLowerCase() as TenantIntegrityScope
  const scope: TenantIntegrityScope = ALLOWED_SCOPES.has(rawScope) ? rawScope : 'all'

  await runTenantIntegrityAudit({
    companyId: rawCompanyId || null,
    scope,
    requestedBy: admin.userId,
  })

  revalidatePath('/admin/system/tenant-integrity')
  revalidatePath('/admin')
}
