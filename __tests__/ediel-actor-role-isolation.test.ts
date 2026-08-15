import { describe, expect, it } from 'vitest'

import {
  canonicalEdielActorRole,
  isSupplierEdielActorRole,
} from '@/lib/ediel/actorRole'

describe('Ediel actor-role isolation', () => {
  it('canonicalizes supplier aliases without accepting ESCO or system-supplier roles', () => {
    expect(canonicalEdielActorRole('supplier')).toBe('supplier')
    expect(canonicalEdielActorRole('electricity_supplier')).toBe('supplier')
    expect(isSupplierEdielActorRole('supplier')).toBe(true)
    expect(isSupplierEdielActorRole('electricity_supplier')).toBe(true)

    expect(isSupplierEdielActorRole('esco')).toBe(false)
    expect(isSupplierEdielActorRole('energy_service_company')).toBe(false)
    expect(isSupplierEdielActorRole('system_supplier')).toBe(false)
  })

  it('keeps ESCO aliases in their own canonical role', () => {
    expect(canonicalEdielActorRole('esco')).toBe('esco')
    expect(canonicalEdielActorRole('energy_service_company')).toBe('esco')
    expect(canonicalEdielActorRole('system_supplier')).toBeNull()
    expect(canonicalEdielActorRole('')).toBeNull()
  })
})
