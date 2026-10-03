import { describe, expect, it } from 'vitest'
import { routeScopeForProcess, shouldMaterializePerGridOwner } from '@/lib/ediel/routeMatrix'

describe('shouldMaterializePerGridOwner fails closed like routeScopeForProcess', () => {
  it('rejects an unknown PRODAT code', () => {
    expect(() => shouldMaterializePerGridOwner({ messageFamily: 'PRODAT', messageCode: 'Z99X' }))
      .toThrow(/ediel_route_scope_prodat_profile_missing:Z99X/)
  })

  it('rejects PRODAT without a message code', () => {
    expect(() => shouldMaterializePerGridOwner({ messageFamily: 'PRODAT' }))
      .toThrow(/ediel_route_scope_prodat_code_required/)
  })

  it('materializes known PRODAT codes per grid owner', () => {
    expect(shouldMaterializePerGridOwner({ messageFamily: 'PRODAT', messageCode: 'Z03' })).toBe(true)
    expect(routeScopeForProcess({ messageFamily: 'PRODAT', messageCode: 'Z03' })).toBe('supplier_switch')
  })

  it('does not materialize acknowledgements', () => {
    for (const family of ['CONTRL', 'APERAK', 'UTILTS_ERR']) {
      expect(shouldMaterializePerGridOwner({ messageFamily: family })).toBe(false)
    }
  })
})
