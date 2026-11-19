import 'server-only'
import {
  isPlatformAdminContext,
  requireAdminActionAccess,
  requireCompanyScopedActionAccess,
  type GuardResult,
} from '@/lib/admin/guards'
import { hasPermissionRequirement, type PermissionRequirement } from '@/lib/admin/accessModel'
import { getCompanyById, isCompanyOperationalForWrites } from '@/lib/tenant/governance'

// These are the explicit denials emitted by the existing read-only guards.
// A failed membership/context read must fail the page, not look like read-only access.
const actionDenials = new Set([
  'Unauthorized',
  'Forbidden',
  'Bolaget är pausat eller inte operativt. Ändringar är blockerade tills bolaget återaktiveras.',
  'Du saknar aktiv ändringsbehörighet för valt bolag.',
])

export async function canPresentAdminAction(
  requirement: string[] | PermissionRequirement,
  options?: { companyId: string },
): Promise<boolean> {
  try {
    if (options) await requireCompanyScopedActionAccess(options.companyId, requirement)
    else await requireAdminActionAccess(requirement)
    return true
  } catch (error) {
    if (error instanceof Error && !('code' in error) && !('cause' in error) && actionDenials.has(error.message)) return false
    throw error
  }
}

/** For commands whose downstream service requires this particular company to be operational. */
export async function canPresentOperationalAction(
  requirement: string[] | PermissionRequirement,
  companyId: string | null | undefined,
): Promise<boolean> {
  if (!companyId || !await canPresentAdminAction(requirement)) return false
  const company = await getCompanyById(companyId)
  if (!company) throw new Error('Bolaget hittades inte.')
  return isCompanyOperationalForWrites(company.status)
}

export function canPresentAdminLink(
  context: Pick<GuardResult, 'roles' | 'permissions'> & Partial<Pick<GuardResult, 'isPlatformAdmin'>>,
  requirement: PermissionRequirement,
): boolean {
  return isPlatformAdminContext(context) || hasPermissionRequirement(context.permissions, requirement)
}

export type WebhookActionNotice = { kind: 'queued' | 'check' | 'ignored'; message: string }

export function webhookActionNotice(value: unknown): WebhookActionNotice | null {
  switch (value) {
    case 'Testevent skapades och köades för webhook.':
      return { kind: 'queued', message: 'Testhändelsen har skapats. Följ leveransens status i listan.' }
    case 'Testevent skapades men ingen aktiv webhook matchade vald endpoint.':
      return { kind: 'check', message: 'Testhändelsen har skapats. Kontrollera den valda anslutningen och befintliga leveranser innan ett nytt försök. Händelsen kan redan ha leveranser.' }
    case 'Webhook delivery köades om.':
      return { kind: 'queued', message: 'Leveransen har lagts i kö igen. Det betyder inte att den har skickats.' }
    case 'Webhook delivery markerades som hanterad.':
      return { kind: 'ignored', message: 'Leveransen har markerats som hanterad.' }
    default:
      return null
  }
}
