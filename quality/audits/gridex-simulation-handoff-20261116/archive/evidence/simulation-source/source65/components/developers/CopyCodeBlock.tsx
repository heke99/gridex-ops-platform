'use client'

import { useState } from 'react'

type CopyState = 'idle' | 'copied' | 'failed'

type CopyCodeBlockProps = {
  children?: string
  code?: string
  language?: string
  label?: string
}

export function CopyCodeBlock({ children, code, label: regionLabel = 'Code example' }: CopyCodeBlockProps) {
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
      ? 'Copied'
      : state === 'failed'
        ? 'Copy failed'
        : 'Copy'

  return (
    <div className="min-w-0 max-w-full rounded-2xl bg-slate-950">
      <div className="flex items-center justify-between gap-4 border-b border-slate-700 px-4 py-3">
        <span className="text-sm font-medium text-slate-300">{regionLabel}</span>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-100 outline-none transition hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-emerald-400"
          aria-label="Copy code example"
        >
          {label}
        </button>
      </div>
      <span className="sr-only" aria-live="polite">
        {state === 'copied'
          ? 'The code example has been copied.'
          : state === 'failed'
            ? 'The code example could not be copied.'
            : ''}
      </span>
      <pre role="region" aria-label={regionLabel} tabIndex={0} className="min-w-0 max-w-full overflow-x-auto rounded-b-2xl bg-slate-950 p-4 text-base leading-7 [overflow-wrap:normal] [word-break:normal] text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
        <code>{value}</code>
      </pre>
    </div>
  )
}
