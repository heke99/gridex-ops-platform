import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  error: null as { code?: string; message?: string } | null,
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      if (table !== 'companies') throw new Error(`unexpected table ${table}`)
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      builder.select = chain
      builder.eq = chain
      builder.maybeSingle = () => Promise.resolve({ data: state.row, error: state.error })
      return builder
    },
  },
}))

import {
  getCompanyProductionStatus,
  isCompanyProductionApproved,
} from '@/lib/tenant/companyProductionStatus'

beforeEach(() => {
  state.row = null
  state.error = null
})

describe('company production status', () => {
  it('requires every production approval signal', () => {
    const approved = {
      ediel_production_status: 'live',
      ediel_production_enabled: true,
      live_ediel_enabled: true,
      live_approved_at: '2026-08-15T11:48:58.000Z',
    }
    expect(isCompanyProductionApproved(approved)).toBe(true)
    expect(isCompanyProductionApproved({ ...approved, ediel_production_enabled: false })).toBe(false)
    expect(isCompanyProductionApproved({ ...approved, live_ediel_enabled: false })).toBe(false)
    expect(isCompanyProductionApproved({ ...approved, ediel_production_status: 'not_ready' })).toBe(false)
    expect(isCompanyProductionApproved({ ...approved, live_approved_at: null })).toBe(false)
  })

  it('does not confuse tenant active with production approved', async () => {
    state.row = {
      id: 'tenant-test',
      name: 'Test bolag',
      status: 'active',
      lifecycle_status: 'active',
      ediel_production_status: 'not_ready',
      ediel_production_enabled: false,
      live_ediel_enabled: false,
      live_approved_at: null,
    }

    await expect(getCompanyProductionStatus('tenant-test')).resolves.toEqual({
      id: 'tenant-test',
      name: 'Test bolag',
      tenantStatus: 'active',
      edielProductionStatus: 'not_ready',
      productionApproved: false,
    })
  })

  it('reports Gridex-style live evidence as production approved', async () => {
    state.row = {
      id: 'gridex',
      name: 'Gridex El AB',
      status: 'active',
      lifecycle_status: 'active',
      ediel_production_status: 'live',
      ediel_production_enabled: true,
      live_ediel_enabled: true,
      live_approved_at: '2026-08-15T11:48:58.000Z',
    }

    const result = await getCompanyProductionStatus('gridex')
    expect(result?.tenantStatus).toBe('active')
    expect(result?.productionApproved).toBe(true)
  })

  it('returns null for an unknown tenant and propagates database errors', async () => {
    await expect(getCompanyProductionStatus('missing')).resolves.toBeNull()
    state.error = { code: '57014', message: 'statement timeout' }
    await expect(getCompanyProductionStatus('broken')).rejects.toMatchObject({ code: '57014' })
  })
})
