'use client'

import { useMemo, useState } from 'react'

export type EdielReceiverPreset = {
  key: string
  label: string
  receiverEdielId: string | null
  receiverName: string | null
  receiverSubAddress: string | null
  targetEmail: string | null
  gridOwnerId: string | null
}

type Props = {
  presets: EdielReceiverPreset[]
  title?: string
  description?: string
}

function setNamedFieldValue(scope: HTMLElement, name: string, value: string | null) {
  if (value == null || value.trim().length === 0) return

  const element = scope.querySelector<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >(`[name="${name}"]`)

  if (!element) return

  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

export default function EdielReceiverPresetPicker({
  presets,
  title = 'Kända mottagare',
  description = 'Välj en tidigare sparad mottagare för att fylla i receiver-fälten automatiskt.',
}: Props) {
  const [selectedKey, setSelectedKey] = useState('')

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.key === selectedKey) ?? null,
    [presets, selectedKey]
  )

  if (presets.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">
        Inga tidigare mottagare sparade ännu.
      </div>
    )
  }

  function applyPreset() {
    if (!selectedPreset) return

    const active = document.activeElement as HTMLElement | null
    const scope = active?.closest('[data-receiver-scope]') as HTMLElement | null

    if (!scope) return

    setNamedFieldValue(scope, 'receiverEdielId', selectedPreset.receiverEdielId)
    setNamedFieldValue(scope, 'receiverName', selectedPreset.receiverName)
    setNamedFieldValue(scope, 'receiverSubAddress', selectedPreset.receiverSubAddress)
    setNamedFieldValue(scope, 'target_email', selectedPreset.targetEmail)
    setNamedFieldValue(scope, 'targetEmail', selectedPreset.targetEmail)
    setNamedFieldValue(scope, 'grid_owner_id', selectedPreset.gridOwnerId)
    setNamedFieldValue(scope, 'gridOwnerId', selectedPreset.gridOwnerId)
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <p className="mt-1 text-xs text-slate-500">{description}</p>

      <div className="mt-3 flex flex-col gap-2 md:flex-row">
        <select
          value={selectedKey}
          onChange={(event) => setSelectedKey(event.target.value)}
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
        >
          <option value="">Välj mottagare</option>
          {presets.map((preset) => (
            <option key={preset.key} value={preset.key}>
              {preset.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={applyPreset}
          disabled={!selectedPreset}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Fyll i mottagare
        </button>
      </div>

      {selectedPreset ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-600">
            Receiver Ediel-id: {selectedPreset.receiverEdielId ?? '—'}
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-600">
            Receiver name: {selectedPreset.receiverName ?? '—'}
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-600">
            Subaddress: {selectedPreset.receiverSubAddress ?? '—'}
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-600">
            Target email: {selectedPreset.targetEmail ?? '—'}
          </div>
        </div>
      ) : null}
    </div>
  )
}