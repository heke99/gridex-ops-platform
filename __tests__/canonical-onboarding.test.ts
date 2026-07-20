import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  data: null as unknown,
  error: null as { code?: string; message?: string } | null,
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name, args })
      return { data: state.data, error: state.error }
    },
  },
}))

import {
  CanonicalOnboardingError,
  canonicalIdempotencyKey,
  onboardCustomerGraph,
  resolveCustomerMatchReviewCase,
} from '@/lib/customers/canonicalOnboarding'

const success = {
  ok: true as const,
  code: 'customer_onboarding_committed' as const,
  operation_id: 'operation-1',
  correlation_id: '11111111-1111-4111-8111-111111111111',
  customer_id: 'customer-1',
  customer_number: 'DX-100001',
  created_new_customer: true,
  contact_id: null,
  address_id: null,
  site_id: null,
  metering_point_id: null,
  contract_id: null,
  contract_number: null,
  price_snapshot_id: null,
  power_of_attorney_id: null,
  authorization_document_id: null,
  authorization_scope_id: null,
  legal_snapshot_id: null,
  application_id: 'application-1',
  task_id: null,
  info_request_id: null,
  outbox_event_id: 'event-1',
}

beforeEach(() => {
  state.data = success
  state.error = null
  state.calls = []
})

describe('canonical customer onboarding client', () => {
  it('calls the single transactional RPC and accepts a verified permanent number', async () => {
    const result = await onboardCustomerGraph({
      company_id: 'company-1',
      channel: 'website',
      idempotency_key: 'website:application-1',
      correlation_id: success.correlation_id,
      customer: { full_name: 'Anna Andersson' },
    })
    expect(result).toEqual(success)
    expect(state.calls).toHaveLength(1)
    expect(state.calls[0]).toMatchObject({
      name: 'gridex_onboard_customer_graph',
      args: { p_command: expect.objectContaining({ matching_policy: 'link_unique' }) },
    })
  })

  it('returns ambiguity as a blocking domain result, never as a selected customer', async () => {
    state.data = {
      ok: false,
      code: 'ambiguous_customer_match',
      operation_id: 'operation-2',
      correlation_id: success.correlation_id,
      candidate_customer_ids: ['customer-1', 'customer-2'],
    }
    const result = await onboardCustomerGraph({
      company_id: 'company-1',
      channel: 'external_contract',
      idempotency_key: 'external:1',
      customer: { org_number: '5560000000' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.candidate_customer_ids).toHaveLength(2)
  })

  it('fails closed when the RPC response lacks a persisted customer number', async () => {
    state.data = { ...success, customer_number: '' }
    await expect(onboardCustomerGraph({
      company_id: 'company-1',
      channel: 'admin',
      idempotency_key: 'admin:1',
      customer: { full_name: 'Test' },
    })).rejects.toMatchObject({ code: 'canonical_onboarding_incomplete_response' })
  })

  it('maps a missing migration to a structured correlated error', async () => {
    state.error = { code: 'PGRST202', message: 'Could not find the function' }
    await expect(onboardCustomerGraph({
      company_id: 'company-1',
      channel: 'api',
      idempotency_key: 'api:1',
      correlation_id: success.correlation_id,
      customer: { full_name: 'Test' },
    })).rejects.toEqual(expect.objectContaining<Partial<CanonicalOnboardingError>>({
      code: 'canonical_onboarding_rpc_missing',
      correlationId: success.correlation_id,
    }))
  })


  it('records an explicit manual resolution through the service-only RPC', async () => {
    state.data = {
      ok: true,
      case_id: 'case-1',
      operation_id: 'operation-2',
      company_id: 'company-1',
      resolution_type: 'link_customer',
      resolved_customer_id: 'customer-2',
    }
    const result = await resolveCustomerMatchReviewCase({
      caseId: 'case-1',
      resolutionType: 'link_customer',
      selectedCustomerId: 'customer-2',
      actorUserId: 'actor-1',
      resolutionNote: 'Verifierad mot personnummer och anläggning.',
    })
    expect(result.resolved_customer_id).toBe('customer-2')
    expect(state.calls.at(-1)).toMatchObject({
      name: 'gridex_resolve_customer_match_review_case',
      args: {
        p_case_id: 'case-1',
        p_resolution_type: 'link_customer',
        p_selected_customer_id: 'customer-2',
        p_actor_user_id: 'actor-1',
      },
    })
  })

  it('generates stable idempotency keys from the same identity input', () => {
    const input = {
      channel: 'website' as const,
      companyId: 'company-1',
      identityParts: ['anna@example.com', '735999000000000001'],
    }
    expect(canonicalIdempotencyKey(input)).toBe(canonicalIdempotencyKey(input))
  })
})
