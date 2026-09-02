import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({
  tables: {
    ediel_actor_settings: [] as Row[],
    ediel_route_profiles: [] as Row[],
  },
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: 'ediel_actor_settings' | 'ediel_route_profiles') {
      let rows = [...state.tables[table]]
      const builder = {
        select() {
          return builder
        },
        eq(column: string, value: unknown) {
          rows = rows.filter((row) => row[column] === value)
          return builder
        },
        async limit(limit: number) {
          return { data: rows.slice(0, limit), error: null }
        },
      }
      return builder
    },
  },
}))

import { resolveCustomerInfoOperationEnvironment } from '@/lib/ediel/customerInfoEnvironmentResolver'

describe('customer-info environment routing cardinality', () => {
  beforeEach(() => {
    state.tables.ediel_actor_settings = []
    state.tables.ediel_route_profiles = []
  })

  it('does not confuse several production grid-owner profiles with environment ambiguity', async () => {
    state.tables.ediel_actor_settings = [
      {
        id: 'production-sender',
        company_id: 'company-1',
        environment: 'production',
        actor_role: 'supplier',
        role: 'supplier',
        market_roles: ['supplier'],
        is_active: true,
        production_send_lock_enabled: false,
        first_production_send_approved: true,
      },
      {
        id: 'test-sender',
        company_id: 'company-1',
        environment: 'test',
        actor_role: 'supplier',
        role: 'supplier',
        market_roles: ['supplier'],
        is_active: true,
        production_send_lock_enabled: true,
        first_production_send_approved: false,
      },
    ]

    state.tables.ediel_route_profiles = Array.from({ length: 4 }, (_, index) => ({
      id: `production-grid-owner-${index + 1}`,
      company_id: 'company-1',
      environment: 'production',
      message_family: 'PRODAT',
      message_code: 'Z01',
      is_enabled: true,
      is_active: true,
      is_production_route: true,
      receiver_source: null,
      dynamic_receiver_strategy: null,
      actor_setting_id: 'production-sender',
      production_mode: 'live',
      metadata: {},
    }))

    const result = await resolveCustomerInfoOperationEnvironment({
      companyId: 'company-1',
      messageFamily: 'PRODAT',
      messageCode: 'Z01',
    })

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') throw new Error('expected resolved environment')
    expect(result.environment).toBe('production')
    expect(result.actorSettingId).toBe('production-sender')
    expect(result.routeProfileId).toBeNull()
    expect(result.productionSendLockStatus).toBe('approved')
    expect(result.evidence.routeProfileCount).toBe(4)
  })

  it('still blocks when the sender setting itself is ambiguous inside one environment', async () => {
    state.tables.ediel_actor_settings = [
      {
        id: 'production-sender-a',
        company_id: 'company-1',
        environment: 'production',
        actor_role: 'supplier',
        role: 'supplier',
        market_roles: ['supplier'],
        is_active: true,
      },
      {
        id: 'production-sender-b',
        company_id: 'company-1',
        environment: 'production',
        actor_role: 'supplier',
        role: 'supplier',
        market_roles: ['supplier'],
        is_active: true,
      },
    ]
    state.tables.ediel_route_profiles = [
      {
        id: 'production-grid-owner-1',
        company_id: 'company-1',
        environment: 'production',
        message_family: 'PRODAT',
        message_code: 'Z01',
        is_enabled: true,
        is_active: true,
        is_production_route: true,
        actor_setting_id: null,
        metadata: {},
      },
    ]

    const result = await resolveCustomerInfoOperationEnvironment({
      companyId: 'company-1',
      messageFamily: 'PRODAT',
      messageCode: 'Z01',
    })

    expect(result.status).toBe('blocked')
    if (result.status !== 'blocked') throw new Error('expected blocked environment')
    expect(result.blocker.blocker_code).toBe('environment_not_resolved')
  })
})
