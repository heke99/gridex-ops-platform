// reality-defects: H-16
// H-16 (reality H run 4): with H-14 the withdrawal case correctly requires a cancellation, but
// createCancellationDraftForCase rendered its own legacy Z03 that the 26.A field matrix refuses
// (prodat_render_blocked:Z03:FIELD_MATRIX_FIELD_FORMAT_INVALID, ...). The error aborted the withdrawal action (500):
// no Z03C and no "withdrawal_received" email. A case bound to a switch now uses the canonical Z03C builder.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const C = '11111111-1111-4111-8111-111111111111'
const builder = vi.fn()
const updates: Array<Record<string, unknown>> = []
const legacyRender = vi.fn(() => { throw new Error('prodat_render_blocked:Z03:FIELD_MATRIX_FIELD_FORMAT_INVALID') })

vi.mock('@/lib/ediel/flows/prodatSwitchCancellation', () => ({ prepareAndQueueSwitchCancellation: (input: unknown) => builder(input) }))
vi.mock('@/lib/ediel/prodat/engine', () => ({ renderProdat26A: () => legacyRender() }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: () => {
      const q = { update: (patch: Record<string, unknown>) => { updates.push(patch); return q }, eq: () => q,
        then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }) }
      return q
    },
  },
}))

const caseRow = { id: 'case-1', company_id: C, customer_id: 'cu', site_id: 'si', metering_point_id: 'mp', supplier_switch_request_id: 'sw-1',
  cancellation_required: true, cancellation_ediel_message_id: null, withdrawal_scenario: 'after_prodat_before_start' } as never

describe('H-16 a withdrawal after a sent Z03 builds the canonical Z03C', () => {
  beforeEach(() => { builder.mockReset(); updates.length = 0; legacyRender.mockClear() })

  it('queues the Z03C for the bound switch and links it to the case', async () => {
    builder.mockResolvedValue({ status: 'queued', message: { id: 'z03c-1' } })
    const { createCancellationDraftForCase } = await import('@/lib/customer-cases/engine')
    const message = await createCancellationDraftForCase(caseRow, 'actor')
    expect(builder).toHaveBeenCalledWith({ companyId: C, switchRequestId: 'sw-1', actorUserId: 'actor' })
    expect(message).toEqual({ id: 'z03c-1' })
    expect(updates).toEqual([expect.objectContaining({ cancellation_ediel_message_id: 'z03c-1', cancellation_status: 'draft_created' })])
    expect(legacyRender).not.toHaveBeenCalled()
  })

  it('sends a held cancellation to manual review instead of failing the withdrawal', async () => {
    builder.mockResolvedValue({ status: 'held', missing: ['qualified_immutable_original_cancellation_projection'] })
    const { createCancellationDraftForCase } = await import('@/lib/customer-cases/engine')
    await expect(createCancellationDraftForCase(caseRow, 'actor')).resolves.toBeNull()
    expect(updates).toEqual([expect.objectContaining({ cancellation_ediel_message_id: null, cancellation_status: 'manual_review' })])
    expect(legacyRender).not.toHaveBeenCalled()
  })
})
