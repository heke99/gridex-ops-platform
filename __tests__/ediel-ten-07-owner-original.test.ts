// masterplan: TEN-07, AT-TEN-07
import { describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  original: { id: 'owner-source', company_id: 'legal-owner', raw_payload: "UNB+owner'UNH+1'UNH+2'", direction: 'inbound' },
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: () => {
      const predicates: Array<[string, unknown]> = []
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { predicates.push([key, value]); return query },
        maybeSingle: async () => ({
          data: predicates.every(([key, value]) => fixture.original[key as keyof typeof fixture.original] === value) ? fixture.original : null,
          error: null,
        }),
      }
      return query
    },
  },
}))
import { getEdielMessageById } from '@/lib/ediel/db'

describe('TEN-07 owner original reader', () => {
  it('retains every original transaction for the legal owner and gives no original to a beneficiary', async () => {
    const before = structuredClone(fixture.original)
    expect(await getEdielMessageById('owner-source', { companyId: 'legal-owner' })).toEqual(before)
    expect(await getEdielMessageById('owner-source', { companyId: 'scoped-beneficiary' })).toBeNull()
    expect(fixture.original).toEqual(before)
  })
})
