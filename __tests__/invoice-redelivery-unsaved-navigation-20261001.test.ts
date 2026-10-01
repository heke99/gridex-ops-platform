import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'

const runtime = vi.hoisted(() => ({
  frame: 'provider', index: 0, frames: new Map<string, unknown[]>(), contexts: new Map<object, unknown>(),
  effects: new Map<string, () => void>(), listeners: new Map<string, (event: unknown) => void>(),
  confirm: vi.fn(), dispatch: vi.fn(), pending: false, result: null as Record<string, unknown> | null,
}))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useActionState: () => { runtime.index++; return [runtime.result, runtime.dispatch, runtime.pending] },
  useState: (initial: unknown) => {
    const index = runtime.index++, values = runtime.frames.get(runtime.frame) ?? []
    runtime.frames.set(runtime.frame, values)
    if (!Object.hasOwn(values, index)) values[index] = typeof initial === 'function' ? initial() : initial
    return [values[index], (value: unknown) => { values[index] = typeof value === 'function' ? value(values[index]) : value }]
  },
  useRef: (initial: unknown) => {
    const index = runtime.index++, values = runtime.frames.get(runtime.frame) ?? []
    runtime.frames.set(runtime.frame, values)
    if (!Object.hasOwn(values, index)) values[index] = { current: initial }
    return values[index]
  },
  useContext: (context: object) => { runtime.index++; return runtime.contexts.get(context) },
  useCallback: (callback: unknown) => { runtime.index++; return callback },
  useMemo: (factory: () => unknown) => { runtime.index++; return factory() },
  useId: () => `${runtime.frame}-${runtime.index++}`,
  useEffect: (effect: () => void | (() => void)) => {
    const key = `${runtime.frame}-${runtime.index++}`
    runtime.effects.get(key)?.()
    const cleanup = effect()
    if (typeof cleanup === 'function') runtime.effects.set(key, cleanup)
    else runtime.effects.delete(key)
  },
}))
vi.mock('@/app/admin/billing/invoices/[id]/redelivery-actions', () => ({ recordInvoiceRedeliveryDecisionFormAction: vi.fn() }))

import AdminUnsavedChanges from '@/components/admin/AdminUnsavedChanges'
import Form from '@/app/admin/billing/invoices/[id]/redelivery/RedeliveryDecisionForm'

// Actual exported provider/hook/form execute. Hooks and browser events are
// controlled adapters, not a mounted React DOM or real-browser acceptance.
class BrowserElement {
  closest() { return this }
}
class BrowserAnchor extends BrowserElement {
  href = 'https://gridex.example/admin/billing/invoices/item'
  download = ''
  target = ''
}
class BrowserForm extends BrowserElement {
  constructor(readonly dataset: Record<string, string | undefined>) { super() }
}
const id = (value: number) => `e5120000-0000-4000-8000-${String(value).padStart(12, '0')}`
const props = { companyId: id(1), customerId: id(2), invoiceId: id(3), expectedRevision: 4,
  expectedOverrideRevision: 0, idempotencyKey: 'navigation-decision-fixture', accountIds: [id(4)], canRecord: true }
function nodes(value: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!isValidElement(value)) return []
  const element = value as ReactElement<Record<string, unknown>>
  return [element, ...nodes(element.props.children as ReactNode)]
}
function form(canRecord = true) {
  runtime.frame = 'form'; runtime.index = 0
  return nodes(Form({ ...props, canRecord }))
}
function edit(tag: 'textarea' | 'select', value: string) {
  const field = form().find(node => node.type === tag)!
  ;(field.props.onChange as (event: unknown) => void)({ target: { value } })
  return form()
}
function navigate(accept = false) {
  runtime.confirm.mockReturnValue(accept)
  const event = { target: new BrowserAnchor(), button: 0, defaultPrevented: false,
    metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() }
  runtime.listeners.get('document/click')!(event)
  return event
}
function unload() {
  const event = { preventDefault: vi.fn(), returnValue: undefined as string | undefined }
  runtime.listeners.get('window/beforeunload')!(event)
  return event
}
beforeEach(() => {
  runtime.frame = 'provider'; runtime.index = 0; runtime.frames.clear(); runtime.contexts.clear(); runtime.effects.clear(); runtime.listeners.clear()
  runtime.confirm.mockReset(); runtime.dispatch.mockReset(); runtime.pending = false; runtime.result = null
  const listenerSurface = (surface: string) => ({
    addEventListener: (name: string, handler: (event: unknown) => void) => runtime.listeners.set(`${surface}/${name}`, handler),
    removeEventListener: (name: string) => runtime.listeners.delete(`${surface}/${name}`),
  })
  vi.stubGlobal('window', { ...listenerSurface('window'), confirm: runtime.confirm,
    location: { href: 'https://gridex.example/admin/billing/invoices/item/redelivery', origin: 'https://gridex.example', pathname: '/admin/billing/invoices/item/redelivery', search: '' } })
  vi.stubGlobal('document', listenerSurface('document'))
  vi.stubGlobal('Element', BrowserElement); vi.stubGlobal('HTMLFormElement', BrowserForm)
  for (const node of nodes(AdminUnsavedChanges({ actorTenantKey: 'current-writer/current-company', children: null }))) {
    if (typeof node.type === 'object' && node.type !== null && 'value' in node.props) runtime.contexts.set(node.type, node.props.value)
  }
  form()
})
afterEach(() => {
  for (const cleanup of runtime.effects.values()) cleanup()
  vi.unstubAllGlobals()
})
it('untouched decision navigation does not produce a discard prompt', () => {
  expect(navigate().preventDefault).not.toHaveBeenCalled()
  expect(unload().preventDefault).not.toHaveBeenCalled()
  expect(runtime.confirm).not.toHaveBeenCalled()
})
it('typing a reason blocks actual shared navigation when leaving is cancelled and retains the draft', () => {
  edit('textarea', 'Keep this separate decision draft')
  expect(navigate().preventDefault).toHaveBeenCalledOnce()
  expect(runtime.confirm).toHaveBeenCalledOnce()
  expect(form().find(node => node.type === 'textarea')?.props.value).toBe('Keep this separate decision draft')
  expect(unload().preventDefault).toHaveBeenCalledOnce()
})
it('selecting only a destination relationship also requires confirmation before leaving', () => {
  edit('select', id(4))
  expect(navigate().preventDefault).toHaveBeenCalledOnce()
  expect(form().find(node => node.type === 'select')?.props.value).toBe(id(4))
})
it('current read-only props do not silently remove protection from an existing unfinished draft', () => {
  edit('textarea', 'Keep draft even after current write permission disappears')
  const tree = form(false)
  expect(tree.find(node => node.type === 'fieldset')?.props.disabled).toBe(true)
  expect(navigate().preventDefault).toHaveBeenCalledOnce()
  expect(tree.find(node => node.type === 'textarea')?.props.value).toBe('Keep draft even after current write permission disappears')
})
it('accepting discard clears controlled fields through the shared guard and leaves no stale unload block', () => {
  edit('textarea', 'Discard only after confirmation'); edit('select', id(4))
  expect(navigate(true).preventDefault).not.toHaveBeenCalled()
  const tree = form()
  expect(tree.find(node => node.type === 'textarea')?.props.value).toBe('')
  expect(tree.find(node => node.type === 'select')?.props.value).toBe('')
  expect(unload().preventDefault).not.toHaveBeenCalled()
})
it('returned errors and pending saves preserve both the draft and current navigation protection', () => {
  edit('textarea', 'Keep the failed request draft'); edit('select', id(4))
  runtime.result = { status: 'error', message: 'Beslutet kunde inte registreras.' }; runtime.pending = true
  const tree = form()
  expect(tree.find(node => node.type === 'textarea')?.props.value).toBe('Keep the failed request draft')
  expect(tree.find(node => node.type === 'select')?.props.value).toBe(id(4))
  expect(tree.find(node => node.type === 'fieldset')?.props.disabled).toBe(true)
  expect(navigate().preventDefault).toHaveBeenCalledOnce()
  runtime.pending = false
  expect(form().find(node => node.type === 'fieldset')?.props.disabled).toBe(false)
  expect(navigate().preventDefault).toHaveBeenCalledOnce()
  expect(form().find(node => node.type === 'textarea')?.props.value).toBe('Keep the failed request draft')
  const submit = { target: new BrowserForm({ dirtyForm: String(tree[0].props['data-dirty-form']) }), preventDefault: vi.fn(), stopPropagation: vi.fn() }
  runtime.confirm.mockClear(); runtime.listeners.get('document/submit')!(submit)
  expect(runtime.confirm).not.toHaveBeenCalled()
})
it('a confirmed persisted decision clears navigation protection while preserving the existing completed lock', () => {
  edit('textarea', 'A separate persisted decision'); edit('select', id(4))
  runtime.result = { status: 'success', decisionStatus: 'verified_delivery_decision', companyId: props.companyId,
    customerId: props.customerId, invoiceId: props.invoiceId, revision: 4, contractOverrideRevision: 0,
    decisionId: id(5), deliveryStatus: 'blocked_provider_adapter', message: 'Beslutet är sparat. Leveransen väntar.' }
  expect(form().find(node => node.type === 'button')?.props.disabled).toBe(true)
  expect(navigate().preventDefault).not.toHaveBeenCalled()
  expect(runtime.confirm).not.toHaveBeenCalled()
})
