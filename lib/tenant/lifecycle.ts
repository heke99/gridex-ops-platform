import type { CompanyOperationalStatus } from '@/lib/tenant/governance'

export const COMPANY_LIFECYCLE_TRANSITIONS: Readonly<
  Record<CompanyOperationalStatus, readonly CompanyOperationalStatus[]>
> = {
  onboarding: ['active', 'paused', 'suspended', 'archived', 'pending_deletion', 'closed', 'deleted_test_only'],
  active: ['paused', 'suspended', 'archived', 'pending_deletion', 'closed'],
  paused: ['active', 'suspended', 'archived', 'pending_deletion', 'closed'],
  suspended: ['active', 'paused', 'archived', 'pending_deletion', 'closed'],
  archived: ['pending_deletion', 'closed'],
  pending_deletion: ['closed', 'deleted_test_only'],
  closed: [],
  deleted_test_only: [],
}

export function canTransitionCompanyStatus(
  currentStatus: CompanyOperationalStatus,
  targetStatus: CompanyOperationalStatus,
): boolean {
  return currentStatus === targetStatus
    || COMPANY_LIFECYCLE_TRANSITIONS[currentStatus].includes(targetStatus)
}

export function isCompanyVisibleInTenantWorkspace(
  status: string | null | undefined,
): boolean {
  return status === 'active' || status === 'onboarding' || status === 'paused'
}

export function companyLifecycleEffectSummary(status: CompanyOperationalStatus): string {
  switch (status) {
    case 'paused':
      return 'Tillfällig paus: tenantens historik är läsbar, men ny drift, API, webhooks, försäljning, automation och outbound stoppas.'
    case 'suspended':
      return 'Avstängt: normal tenantåtkomst och all ny drift ska stoppas tills superadmin återaktiverar bolaget.'
    case 'archived':
      return 'Arkiverat: bolaget tas ur daglig drift och ska endast vara åtkomligt för platform admin och revision.'
    case 'pending_deletion':
      return 'Radering begärd: bolaget är låst för drift medan historik och beroenden kontrolleras.'
    case 'closed':
      return 'Terminalt stängt: kan inte återaktiveras. Integrationer och outbound ska vara avstängda och historik bevaras.'
    case 'deleted_test_only':
      return 'Raderat test-/felregistrerat bolag: terminal tombstone utan operativ åtkomst.'
    case 'onboarding':
      return 'Onboarding: konfiguration och tester tillåts, men produktion kräver separat readiness.'
    case 'active':
      return 'Aktivt: operationer styrs av tenantens capabilities och production-readiness.'
  }
}
