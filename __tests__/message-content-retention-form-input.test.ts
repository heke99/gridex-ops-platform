import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import Workspace from '../app/admin/ediel/message-content-retention/workspace'

// Model a browser-filled input before React has observed its change event.
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useState: (initial: unknown) => [initial, vi.fn()],
    useRef: () => ({ current: null }),
  }
})

type Element = ReactElement<{ children?: unknown; onSubmit?: (event: unknown) => void }>
function readForm(node: unknown): Element | undefined {
  if (!node || typeof node !== 'object' || !('props' in node)) return
  const element = node as Element
  if (element.type === 'form') return element
  for (const child of [element.props.children].flat(Infinity)) {
    const result = readForm(child)
    if (result) return result
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('retention read form submits browser field data', () => {
  it('reads the submitted decision even when the controlled React state is still empty', async () => {
    const id = '1aa443a8-9ec4-4761-81f5-c17bbe9e897d'
    const values = new FormData()
    values.set('decisionId', id)
    vi.stubGlobal('FormData', function () { return values })
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ decisionId: id }) })
    vi.stubGlobal('fetch', fetch)
    const form = readForm(Workspace({ companyId: 'synthetic-company', permissions: [] }))
    expect(form?.props.onSubmit).toBeTypeOf('function')
    form!.props.onSubmit!({ preventDefault: vi.fn(), currentTarget: {} })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    expect(fetch.mock.calls[0][0]).toBe('/api/ediel/message-content-retention/' + id)
  })

  it('never sends the bare collection GET when no decision ID was submitted', async () => {
    const values = new FormData()
    values.set('decisionId', '')
    vi.stubGlobal('FormData', function () { return values })
    const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'invalid' }) })
    vi.stubGlobal('fetch', fetch)
    const form = readForm(Workspace({ companyId: 'synthetic-company', permissions: [] }))
    form!.props.onSubmit!({ preventDefault: vi.fn(), currentTarget: {} })
    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
  })
})
