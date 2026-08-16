'use client'

import { useState } from 'react'

type CopyState = 'idle' | 'copied' | 'failed'

type CopyCodeBlockProps = {
  children?: string
  code?: string
  language?: string
}

export function CopyCodeBlock({ children, code }: CopyCodeBlockProps) {
  const [state, setState] = useState<CopyState>('idle')
  const value = children ?? code ?? ''

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('failed')
    }
    window.setTimeout(() => setState('idle'), 1800)
  }

  const label =
    state === 'copied'
      ? 'Kopierat'
      : state === 'failed'
        ? 'Kunde inte kopiera'
        : 'Kopiera'

  return (
    <div className="relative">
      <button
        type="button"
        onClick={copy}
        className="absolute right-3 top-3 rounded-lg border border-slate-600 bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-100 outline-none transition hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-emerald-400"
        aria-label="Kopiera kodexempel"
      >
        {label}
      </button>
      <span className="sr-only" aria-live="polite">
        {state === 'copied'
          ? 'Kodexemplet har kopierats.'
          : state === 'failed'
            ? 'Kodexemplet kunde inte kopieras.'
            : ''}
      </span>
      <pre className="overflow-x-auto rounded-2xl bg-slate-950 p-4 pr-32 text-xs leading-6 text-slate-100">
        <code>{value}</code>
      </pre>
    </div>
  )
}
