'use client'

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'

const DirtyFormsContext = createContext<(id: string, dirty: boolean, discard?: () => void) => void>(() => {})
const LEAVE_MESSAGE = 'Du har osparade ändringar. Lämna sidan och kasta utkastet?'
export type FormDraftField = { name: string; value: string; checked?: boolean }
const REVISION_FIELD_NAMES = new Set(['expected_revision', 'expected_override_revision', 'expected_legal_profile_revision', 'expected_lifecycle_revision', 'expected_address_revision', 'expected_site_revision'])

export function draftRevisionIsStale(current: FormDraftField[], draft: FormDraftField[]): boolean {
  return current.some((field) => REVISION_FIELD_NAMES.has(field.name) && draft.some((saved) => saved.name === field.name && saved.value !== field.value))
}
type DraftMemory = {
  get: (key: string | undefined) => FormDraftField[] | undefined
  put: (key: string | undefined, fields: FormDraftField[]) => void
  clear: (key: string | undefined) => void
}
const DraftMemoryContext = createContext<DraftMemory>({ get: () => undefined, put: () => {}, clear: () => {} })

export function captureFormDraft(form: HTMLFormElement): FormDraftField[] {
  return Array.from(form.elements).flatMap((field) => {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) ||
        !field.name || field.name.startsWith('$') ||
        (field instanceof HTMLInputElement && (['password', 'file', 'submit', 'button'].includes(field.type) ||
          (field.type === 'hidden' && !REVISION_FIELD_NAMES.has(field.name) && field.name !== 'idempotency_key')))) return []
    return [{ name: field.name, value: field.value,
      ...(field instanceof HTMLInputElement && ['checkbox', 'radio'].includes(field.type) ? { checked: field.checked } : {}) }]
  })
}

export function restoreFormDraft(form: HTMLFormElement, fields: FormDraftField[]) {
  for (const draft of fields) {
    for (const field of Array.from(form.elements)) {
      if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) || field.name !== draft.name) continue
      if (field instanceof HTMLInputElement && ['checkbox', 'radio'].includes(field.type)) {
        if (field.value === draft.value && draft.checked !== undefined) field.checked = draft.checked
      } else field.value = draft.value
    }
  }
}

/** Request-local browser state: drafts never enter localStorage or another user's session. */
export default function AdminUnsavedChanges({ children, actorTenantKey }: { children: ReactNode; actorTenantKey?: string }) {
  const dirtyForms = useRef(new Map<string, () => void>())
  const [drafts] = useState(() => new Map<string, FormDraftField[]>())
  const memory = useMemo<DraftMemory>(() => {
    const keyFor = (key: string | undefined) => actorTenantKey && key ? `${actorTenantKey}/${key}` : null
    return {
      get: (key) => { const scoped = keyFor(key); return scoped ? drafts.get(scoped) : undefined },
      put: (key, fields) => { const scoped = keyFor(key); if (scoped) drafts.set(scoped, fields) },
      clear: (key) => { const scoped = keyFor(key); if (scoped) drafts.delete(scoped) },
    }
  }, [actorTenantKey, drafts])
  const register = useCallback((id: string, dirty: boolean, discard?: () => void) => {
    if (dirty) dirtyForms.current.set(id, discard ?? (() => {}))
    else dirtyForms.current.delete(id)
  }, [])

  useEffect(() => {
    const discardDrafts = () => {
      drafts.clear()
      const discarders = Array.from(dirtyForms.current.values())
      dirtyForms.current.clear()
      for (const discard of discarders) discard()
    }
    const unload = (event: BeforeUnloadEvent) => {
      if (!dirtyForms.current.size) return
      event.preventDefault()
      event.returnValue = ''
    }
    // Capture covers native links and Next Link, including links in server-rendered panels.
    const navigate = (event: MouseEvent) => {
      if (!dirtyForms.current.size || event.defaultPrevented || event.button !== 0 ||
          event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!anchor || anchor.download || (anchor.target && anchor.target !== '_self')) return
      const target = new URL(anchor.href, window.location.href)
      if (target.origin === window.location.origin && target.pathname === window.location.pathname && target.search === window.location.search) return
      if (!window.confirm(LEAVE_MESSAGE)) {
        event.preventDefault()
        event.stopPropagation()
      } else discardDrafts()
    }
    const submit = (event: SubmitEvent) => {
      if (!dirtyForms.current.size || !(event.target instanceof HTMLFormElement) ||
          event.target.dataset.customerEditor === 'true' || event.target.dataset.dirtyForm === 'true') return
      if (!window.confirm(LEAVE_MESSAGE)) {
        event.preventDefault()
        event.stopPropagation()
      } else discardDrafts()
    }
    window.addEventListener('beforeunload', unload)
    document.addEventListener('click', navigate, true)
    document.addEventListener('submit', submit, true)
    return () => {
      window.removeEventListener('beforeunload', unload)
      document.removeEventListener('click', navigate, true)
      document.removeEventListener('submit', submit, true)
    }
  }, [drafts])

  return <DraftMemoryContext.Provider value={memory}><DirtyFormsContext.Provider value={register}>{children}</DirtyFormsContext.Provider></DraftMemoryContext.Provider>
}

export function useAdminDraftMemory() { return useContext(DraftMemoryContext) }

export function useUnsavedChanges(dirty: boolean, discard?: () => void) {
  const register = useContext(DirtyFormsContext)
  const id = useId()
  useEffect(() => {
    register(id, dirty, discard)
    return () => register(id, false)
  }, [dirty, id, register, discard])
}
