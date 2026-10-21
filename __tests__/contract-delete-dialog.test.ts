import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContractDeletePreviewActionState } from '@/lib/contracts/adminActions'

const fixture = vi.hoisted(() => ({
  state: {} as ContractDeletePreviewActionState,
  pending: false,
  previewAction: vi.fn(),
  archiveAction: vi.fn(),
  deleteAction: vi.fn(),
  useActionState: vi.fn(),
}))

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useActionState: fixture.useActionState,
}))
vi.mock('@/lib/contracts/adminActions', () => ({
  previewContractDeleteAction: fixture.previewAction,
  archiveContractAction: fixture.archiveAction,
  deleteContractPermanentlyAction: fixture.deleteAction,
}))

import ContractDeleteControl from '@/components/admin/contracts/ContractDeleteControl'

function renderControl() {
  return renderToStaticMarkup(createElement(ContractDeleteControl, {
    companyId: 'synthetic-company-A', offerId: 'synthetic-offer-A',
    productId: 'synthetic-product-A', productName: 'Syntetiskt avtal',
    companyName: 'Syntetiskt bolag', surface: 'contracts', view: 'active', page: 3,
  }))
}

beforeEach(() => {
  fixture.state = {
    status: 'ready', requestId: 'synthetic-preview-request',
    companyId: 'synthetic-company-A', offerId: 'synthetic-offer-A',
    surface: 'contracts', view: 'active', page: 3, error: null,
    preview: { can_delete: true, preview_token: 'synthetic-preview-token', lifecycle_status: 'draft' },
  }
  fixture.pending = false
  fixture.useActionState.mockReset().mockImplementation(() => [fixture.state, vi.fn(), fixture.pending])
  fixture.previewAction.mockClear()
  fixture.archiveAction.mockClear()
  fixture.deleteAction.mockClear()
})

describe('contract delete dialog and retained preview guards', () => {
  it('uses a named native modal dialog after a preview, with a non-submitting close control', () => {
    const html = renderControl()
    expect(html).toContain('<dialog')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-labelledby="delete-contract-synthetic-offer-A"')
    expect(html).toContain('id="delete-contract-synthetic-offer-A"')
    expect(html).toMatch(/<button type="button"[^>]*>Stäng<\/button>/)
    expect(fixture.useActionState).toHaveBeenCalledWith(fixture.previewAction, expect.objectContaining({ status: 'idle' }))
  })

  it('does not mount a dialog or a permanent-delete confirmation before any preview', () => {
    fixture.state = { ...fixture.state, status: 'idle', requestId: null, preview: null }
    const html = renderControl()
    expect(html).not.toContain('<dialog')
    expect(html).not.toContain('Bekräfta permanent radering')
    expect(html).toContain('Radera permanent')
  })

  it('disables the preview trigger while the preview request is pending', () => {
    fixture.pending = true
    fixture.state = { ...fixture.state, status: 'idle', requestId: null, preview: null }
    const html = renderControl()
    expect(html).toMatch(/<button type="submit" disabled=""/)
    expect(html).toContain('Kontrollerar beroenden…')
    expect(html).not.toContain('<dialog')
  })

  it('preserves the preview token and tenant/return fields for an explicitly deletable preview', () => {
    const html = renderControl()
    expect(html).toContain('Bekräfta permanent radering')
    expect(html).toContain('name="expected_preview_token" value="synthetic-preview-token"')
    expect(html.match(/name="company_id" value="synthetic-company-A"/g)).toHaveLength(2)
    expect(html.match(/name="offer_id" value="synthetic-offer-A"/g)).toHaveLength(2)
    expect(html.match(/name="return_surface" value="contracts"/g)).toHaveLength(2)
    expect(html.match(/name="contract_view" value="active"/g)).toHaveLength(2)
    expect(html.match(/name="contract_page" value="3"/g)).toHaveLength(2)
    expect(fixture.previewAction).not.toHaveBeenCalled()
    expect(fixture.archiveAction).not.toHaveBeenCalled()
    expect(fixture.deleteAction).not.toHaveBeenCalled()
  })

  it('withholds permanent deletion when its preview token is absent', () => {
    fixture.state.preview = { can_delete: true, preview_token: null, lifecycle_status: 'draft', recommended_action: 'review' }
    const html = renderControl()
    expect(html).not.toContain('Bekräfta permanent radering')
    expect(html).not.toContain('expected_preview_token')
    expect(html).toContain('Åtgärda blockerarna och kör preview igen')
  })

  it('preserves blockers and archive guidance without exposing permanent deletion', () => {
    fixture.state.preview = {
      can_delete: false, lifecycle_status: 'draft', recommended_action: 'archive',
      blockers: [{ reason: 'business_history', count: 2, message: 'Syntetisk affärshistorik måste behållas.' }],
    }
    const html = renderControl()
    expect(html).toContain('2 × Syntetisk affärshistorik måste behållas.')
    expect(html).toContain('Arkivera och dölj')
    expect(html).not.toContain('Bekräfta permanent radering')
    expect(html).not.toContain('expected_preview_token')
  })

  it('withholds archive for a lifecycle that must first be unpublished', () => {
    fixture.state.preview = { can_delete: false, lifecycle_status: 'active', recommended_action: 'unpublish', blockers: [{ reason: 'published' }] }
    const html = renderControl()
    expect(html).toContain('Pausa eller stäng avtalet före arkivering')
    expect(html).not.toContain('>Arkivera och dölj</button>')
    expect(html).not.toContain('Bekräfta permanent radering')
  })

  it('keeps dependency counts and the irreversible-delete warning visible', () => {
    fixture.state.preview = { ...fixture.state.preview, removable_system_dependencies: { drafts: 2, links: 3 } }
    const html = renderControl()
    expect(html).toContain('<strong>5</strong> interna draftberoenden')
    expect(html).toContain('Permanent radering kan inte ångras')
    expect(html).toContain('Kundavtal, offerter, fakturor,')
  })

  it('shows an error preview in the same closable dialog without mutation controls', () => {
    fixture.state = { ...fixture.state, status: 'error', preview: null, error: 'Syntetisk kontroll kunde inte slutföras.' }
    const html = renderControl()
    expect(html).toContain('<dialog')
    expect(html).toContain(fixture.state.error)
    expect(html).toContain('>Stäng</button>')
    expect(html).not.toContain('Bekräfta permanent radering')
    expect(html).not.toContain('>Arkivera och dölj</button>')
  })
})
