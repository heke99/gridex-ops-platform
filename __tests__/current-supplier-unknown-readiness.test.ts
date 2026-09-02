import { describe, expect, it } from 'vitest'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type { PowerOfAttorneyRow } from '@/lib/operations/types'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'

describe('current supplier unknown switch semantics', () => {
  it('does not create current_supplier_missing when the persisted supplier state is explicitly unknown', () => {
    const site = {
      id: 'site-unknown-supplier',
      customer_id: 'customer-1',
      site_name: 'Anläggning',
      facility_id: '735999000000000001',
      grid_owner_id: 'grid-owner-1',
      grid_area_code: 'AREA-1',
      price_area_code: 'SE3',
      move_in_date: '2026-09-22',
      current_supplier_name: null,
      current_supplier_unknown: true,
    } as CustomerSiteRow

    const point = {
      id: 'mp-1',
      site_id: site.id,
      status: 'active',
      meter_point_id: '735999000000000001',
      ediel_reference: null,
      grid_owner_id: 'grid-owner-1',
      grid_area_code: 'AREA-1',
      price_area_code: 'SE3',
    } as MeteringPointRow

    const poa = {
      id: 'poa-1',
      customer_id: 'customer-1',
      site_id: site.id,
      scope: 'supplier_switch',
      status: 'signed',
      signed_at: '2026-09-02T12:00:00Z',
      valid_from: '2026-09-02',
      valid_to: null,
      document_path: 'poa/poa-1.pdf',
      reference: 'POA-1',
      notes: null,
      created_at: '2026-09-02T12:00:00Z',
      updated_at: '2026-09-02T12:00:00Z',
      created_by: null,
      updated_by: null,
    } as PowerOfAttorneyRow

    const result = evaluateSiteSwitchReadiness({
      site,
      meteringPoints: [point],
      powersOfAttorney: [poa],
      now: new Date('2026-09-02T13:00:00Z'),
    })

    expect(result.issues.map((issue) => issue.code)).not.toContain('current_supplier_missing')
    expect(result.isReady).toBe(true)
  })

  it('keeps contradictory legacy state visible when supplier is missing but not marked unknown', () => {
    const site = {
      id: 'site-legacy-supplier-state',
      customer_id: 'customer-1',
      site_name: 'Anläggning',
      facility_id: '735999000000000002',
      grid_owner_id: 'grid-owner-1',
      grid_area_code: 'AREA-1',
      price_area_code: 'SE3',
      move_in_date: '2026-09-22',
      current_supplier_name: null,
      current_supplier_unknown: false,
    } as CustomerSiteRow

    const point = {
      id: 'mp-2',
      site_id: site.id,
      status: 'active',
      meter_point_id: '735999000000000002',
      ediel_reference: null,
      grid_owner_id: 'grid-owner-1',
      grid_area_code: 'AREA-1',
      price_area_code: 'SE3',
    } as MeteringPointRow

    const poa = {
      id: 'poa-2',
      customer_id: 'customer-1',
      site_id: site.id,
      scope: 'supplier_switch',
      status: 'signed',
      signed_at: '2026-09-02T12:00:00Z',
      valid_from: '2026-09-02',
      valid_to: null,
      document_path: 'poa/poa-2.pdf',
      reference: 'POA-2',
      notes: null,
      created_at: '2026-09-02T12:00:00Z',
      updated_at: '2026-09-02T12:00:00Z',
      created_by: null,
      updated_by: null,
    } as PowerOfAttorneyRow

    const result = evaluateSiteSwitchReadiness({
      site,
      meteringPoints: [point],
      powersOfAttorney: [poa],
    })

    expect(result.issues.map((issue) => issue.code)).toContain('current_supplier_missing')
  })
})
