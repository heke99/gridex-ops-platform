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
  const companyId = rawCompanyId || null
  if (companyId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(companyId)) {
    throw new Error('Ogiltigt bolags-ID för tenant-integritetsaudit.')
  }

  await runTenantIntegrityAudit({
    companyId,
    scope,
    requestedBy: admin.userId,
  })

  revalidatePath('/admin/system/tenant-integrity')
  revalidatePath('/admin')
}
