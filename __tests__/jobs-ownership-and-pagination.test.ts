import { describe, it, vi } from 'vitest'
import { analyticsCases, manualCases, type analyticsFixture, type manualFixture } from './helpers/jobs-ownership-cases'

const state = vi.hoisted(() => ({
  manual: null as ReturnType<typeof manualFixture> | null,
  analytics: null as ReturnType<typeof analyticsFixture> | null,
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      if (table === 'companies') return state.analytics!.db.from(table)
      return state.manual!.db.from(table)
    },
  },
}))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => {} }))
vi.mock('@/lib/email/providers', () => ({ getEmailProvider: () => ({
  async sendEmail(input: Record<string, unknown>) {
    state.manual!.sends.push(input)
    return state.manual!.send(input)
  },
}) }))
vi.mock('@/lib/email/manualOperationsMailbox', () => ({ isEdielReservedSender: () => state.manual!.reserved() }))
vi.mock('@/lib/tenant/operationPolicy', () => ({
  getTenantOperationDecision(companyId: string) {
    state.manual!.policies.push(companyId)
    return state.manual!.policy(state.manual!.policies.length)
  },
}))

import { processManualEmailOutbox } from '@/lib/email/manualEmailOutbox'
import { listAnalyticsCompanyIds } from '@/lib/analytics/cron'

describe('manual email failure ownership', () => {
  for (const testCase of manualCases) {
    it(testCase.name, () => testCase.run((fixture) => {
      state.manual = fixture
      return processManualEmailOutbox
    }))
  }
})
describe('complete analytics company enumeration', () => {
  for (const testCase of analyticsCases) {
    it(testCase.name, () => testCase.run((fixture) => {
      state.analytics = fixture
      return listAnalyticsCompanyIds
    }))
  }
})
