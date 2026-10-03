import type { IntegrationApiClient, IntegrationApiAuthResult } from '@/lib/integrations/apiAuth'
export type StaffApiContext = {
  companyId: string; userId: string; client: IntegrationApiClient; isPlatformAdmin: boolean
  permissions: string[]; roles: string[]; sessionId: string; sessionRevision: number; nativeSessionId: string
  integrationAuth: Extract<IntegrationApiAuthResult, { ok: true }>; requestId: string; correlationId: string
  staffReference: string; organizationReference: string; displayName: string | null
}
