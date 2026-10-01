import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'

const r = vi.hoisted(() => ({
  frame: 'provider', index: 0, frames: new Map<string, unknown[]>(), contexts: new Map<object, unknown>(),
  effects: new Map<string, () => void>(), listeners: new Map<string, (event: unknown) => void>(),
  confirm: vi.fn(), action: vi.fn(), pending: false, waits: [] as Promise<unknown>[],
}))
vi.mock('server-only', () => ({}))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = r.index++, values = r.frames.get(r.frame) ?? []; r.frames.set(r.frame, values)
    if (!Object.hasOwn(values, i)) values[i] = typeof initial === 'function' ? initial() : initial
    return [values[i], (value: unknown) => { values[i] = typeof value === 'function' ? value(values[i]) : value }]
  },
  useRef: (initial: unknown) => {
    const i = r.index++, values = r.frames.get(r.frame) ?? []; r.frames.set(r.frame, values)
    if (!Object.hasOwn(values, i)) values[i] = { current: initial }
    return values[i]
  },
  useContext: (context: object) => { r.index++; return r.contexts.get(context) },
  useCallback: (callback: unknown) => { r.index++; return callback },
  useMemo: (factory: () => unknown) => { r.index++; return factory() },
  useId: () => `${r.frame}-${r.index++}`,
  startTransition: (callback: () => unknown) => callback(),
  useActionState: (callback: (previous: unknown, data: FormData) => Promise<unknown>, initial: unknown) => {
    const i = r.index++, values = r.frames.get(r.frame) ?? []; r.frames.set(r.frame, values)
    if (!Object.hasOwn(values, i)) values[i] = initial
    return [values[i], (data: FormData) => {
      r.pending = true
      const promise = (async () => { try { values[i] = await callback(values[i], data) } finally { r.pending = false } })()
      r.waits.push(promise); return promise
    }, r.pending]
  },
  useEffect: (effect: () => void | (() => void)) => {
    const key = `${r.frame}-${r.index++}`; r.effects.get(key)?.()
    const cleanup = effect(); if (typeof cleanup === 'function') r.effects.set(key, cleanup); else r.effects.delete(key)
  },
}))
vi.mock('@/app/admin/customers/[id]/actions', () => ({ createCustomerInternalNoteAction: r.action, createCustomerInternalNoteReceiptAction: r.action,
  registerCustomerLifecycleDecisionAction: vi.fn(), savePowerOfAttorneyScopeAction: vi.fn() }))

import AdminUnsavedChanges from '@/components/admin/AdminUnsavedChanges'
import { NotesSection } from '@/app/admin/customers/[id]/page.part-2'

// Actual exported NotesSection/provider execute with hook and browser-event
// adapters. This is not mounted React/Next, browser traversal or durable SQL.
class ElementAdapter { closest() { return this } }
class AnchorAdapter extends ElementAdapter { href = 'https://gridex.example/admin/customers'; download = ''; target = '' }
class FormAdapter extends ElementAdapter {
  dataset = { dirtyForm: 'true' }
  fields = { customer_id: '00000000-0000-4000-8000-000000001301', body: '' }
  reset = vi.fn(() => { this.fields.body = '' })
}
class FormDataAdapter extends FormData {
  constructor(form?: FormAdapter) { super(); if (form) for (const [key, value] of Object.entries(form.fields)) this.set(key, value) }
}
let nativeForm: FormAdapter
function nodes(value: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!isValidElement(value)) return []
  const node = value as ReactElement<Record<string, unknown>>
  if (typeof node.type === 'function') {
    r.frame = 'form'; r.index = 0
    return nodes((node.type as (props: Record<string, unknown>) => ReactNode)(node.props))
  }
  return [node, ...nodes(node.props.children as ReactNode)]
}
function rendered() {
  r.frame = 'form'; r.index = 0
  const result = nodes(NotesSection({ customerId: nativeForm.fields.customer_id, notes: [] }))
  const form = result.find(node => node.type === 'form')!
  if (form.props.ref && typeof form.props.ref === 'object') (form.props.ref as { current: unknown }).current = nativeForm
  return { result, form }
}
function typeDraft(body: string) {
  nativeForm.fields.body = body
  const handler = rendered().form.props.onChange as ((event: unknown) => void) | undefined
  handler?.({ currentTarget: nativeForm })
  return rendered()
}
function navigate(accept = false) {
  r.confirm.mockReturnValue(accept)
  const event = { target: new AnchorAdapter(), button: 0, defaultPrevented: false,
    metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() }
  r.listeners.get('document/click')!(event)
  return event
}
function submit() {
  const event = { currentTarget: nativeForm, preventDefault: vi.fn() }
  ;(rendered().form.props.onSubmit as (event: unknown) => void)(event)
  return event
}
async function settled() { await Promise.all(r.waits); return rendered() }
function text(value: ReactNode): string {
  if (Array.isArray(value)) return value.map(text).join(' ')
  if (isValidElement(value)) return text((value.props as { children?: ReactNode }).children)
  return typeof value === 'string' ? value : ''
}
const qualified = () => ({ noteId: '00000000-0000-4000-8000-000000001302', customerId: nativeForm.fields.customer_id,
  companyId: '00000000-0000-4000-8000-000000001303', actorUserId: '00000000-0000-4000-8000-000000001304' })
beforeEach(() => {
  r.frame = 'provider'; r.index = 0; r.frames.clear(); r.contexts.clear(); r.effects.clear(); r.listeners.clear()
  r.confirm.mockReset(); r.action.mockReset(); r.pending = false; r.waits = []; nativeForm = new FormAdapter()
  const surface = (name: string) => ({ addEventListener: (event: string, callback: (event: unknown) => void) => r.listeners.set(`${name}/${event}`, callback),
    removeEventListener: (event: string) => r.listeners.delete(`${name}/${event}`) })
  vi.stubGlobal('window', { ...surface('window'), confirm: r.confirm,
    location: { href: 'https://gridex.example/admin/customers/current?tab=notes', origin: 'https://gridex.example', pathname: '/admin/customers/current', search: '?tab=notes' } })
  vi.stubGlobal('document', surface('document')); vi.stubGlobal('Element', ElementAdapter); vi.stubGlobal('HTMLFormElement', FormAdapter)
  vi.stubGlobal('FormData', FormDataAdapter)
  for (const node of nodes(AdminUnsavedChanges({ actorTenantKey: 'current-actor/current-company', children: null }))) {
    if (typeof node.type === 'object' && node.type !== null && 'value' in node.props) r.contexts.set(node.type, node.props.value)
  }
  rendered()
})
afterEach(() => { for (const cleanup of r.effects.values()) cleanup(); vi.unstubAllGlobals() })
it('actual untouched NotesSection does not manufacture a discard prompt or server call', () => {
  expect(navigate().preventDefault).not.toHaveBeenCalled(); expect(r.confirm).not.toHaveBeenCalled(); expect(r.action).not.toHaveBeenCalled()
})
it('typing in the actual NotesSection registers a draft with the shared provider and cancelled navigation preserves it', () => {
  typeDraft('Synthetic internal note draft')
  expect(navigate().preventDefault).toHaveBeenCalledOnce()
  expect(r.confirm).toHaveBeenCalledOnce(); expect(nativeForm.fields.body).toBe('Synthetic internal note draft'); expect(r.action).not.toHaveBeenCalled()
})
it('actual confirmed discard resets this note draft through the shared provider without a write', () => {
  typeDraft('Discard only after explicit confirmation')
  expect(navigate(true).preventDefault).not.toHaveBeenCalled()
  expect(nativeForm.reset).toHaveBeenCalledOnce(); expect(nativeForm.fields.body).toBe(''); expect(r.action).not.toHaveBeenCalled()
})
it('uses the current page receipt action and does not dispatch an untouched draft', () => {
  expect(submit().preventDefault).toHaveBeenCalledOnce(); expect(r.action).not.toHaveBeenCalled()
  expect(rendered().result.find(node => node.type === 'button' && node.props.type === 'submit')!.props.disabled).toBe(true)
})
it('captures the actual draft before pending disable and prevents a second current submission', async () => {
  let complete!: (value: ReturnType<typeof qualified>) => void
  r.action.mockImplementation(() => new Promise(resolve => { complete = resolve }))
  typeDraft('Pending private draft')
  expect(submit().preventDefault).toHaveBeenCalledOnce(); submit()
  expect(r.action).toHaveBeenCalledOnce()
  const data = r.action.mock.calls[0][0] as FormData
  expect(Object.fromEntries(data)).toEqual({ customer_id: nativeForm.fields.customer_id, body: 'Pending private draft' })
  expect(rendered().form.props['aria-busy']).toBe(true)
  expect(rendered().result.find(node => node.type === 'fieldset')!.props.disabled).toBe(true)
  expect(nativeForm.fields.body).toBe('Pending private draft'); expect(navigate().preventDefault).toHaveBeenCalledOnce()
  complete(qualified()); await settled()
})
it('only a qualified exact-customer receipt resets the draft and releases the shared navigation guard', async () => {
  r.action.mockResolvedValue(qualified()); typeDraft('A confirmed private note'); submit()
  const result = await settled()
  expect(nativeForm.reset).toHaveBeenCalledOnce(); expect(nativeForm.fields.body).toBe('')
  expect(navigate().preventDefault).not.toHaveBeenCalled(); expect(r.confirm).not.toHaveBeenCalled()
  expect(result.result.some(node => node.props.role === 'status' && text(node) === 'Anteckningen är sparad.')).toBe(true)
})
it.each(['void', 'other customer', 'missing identity'] as const)('retains the draft and shared guard after an unqualified %s result', async kind => {
  r.action.mockResolvedValue(kind === 'void' ? undefined : kind === 'other customer' ? { ...qualified(), customerId: '00000000-0000-4000-8000-000000001399' } : { ...qualified(), noteId: '' })
  typeDraft('Unconfirmed private note'); submit(); const result = await settled()
  expect(nativeForm.reset).not.toHaveBeenCalled(); expect(nativeForm.fields.body).toBe('Unconfirmed private note')
  expect(navigate().preventDefault).toHaveBeenCalledOnce()
  expect(result.result.some(node => node.props.role === 'alert' && text(node).includes('Utkastet finns kvar'))).toBe(true)
  expect(result.result.some(node => text(node) === 'Anteckningen är sparad.')).toBe(false)
})
it('retains an errored draft without showing a raw private error and explicit discard removes the stale message', async () => {
  r.action.mockRejectedValue(new Error('private-error-canary@example.invalid'))
  typeDraft('Failed private note'); submit(); const result = await settled()
  expect(nativeForm.reset).not.toHaveBeenCalled(); expect(nativeForm.fields.body).toBe('Failed private note')
  expect(result.result.map(text).join(' ')).not.toContain('private-error-canary@example.invalid')
  const cancel = result.result.find(node => node.type === 'button' && node.props.type === 'button')!
  ;(cancel.props.onClick as () => void)()
  expect(nativeForm.reset).toHaveBeenCalledOnce(); expect(nativeForm.fields.body).toBe('')
  const discarded = rendered() // Run the next render/effect turn in this hook adapter.
  expect(navigate().preventDefault).not.toHaveBeenCalled()
  expect(discarded.result.some(node => node.props.role === 'alert')).toBe(false)
})
it('a new edited draft hides an old confirmation and registers the shared guard again', async () => {
  r.action.mockResolvedValue(qualified()); typeDraft('First draft'); submit(); await settled()
  const result = typeDraft('Second draft')
  expect(result.result.some(node => text(node) === 'Anteckningen är sparad.')).toBe(false)
  expect(navigate().preventDefault).toHaveBeenCalledOnce(); expect(r.action).toHaveBeenCalledOnce()
})
