'use client'

import { useMemo, useState } from 'react'
import { saveEdielMessageRuleAction } from '@/app/admin/ediel/settings/actions'

export type EdielRuleListRow = {
  id: string
  message_family: string
  message_code: string
  message_standard: 'edifact' | 'xml' | 'ai_list'
  version_code: string
  direction: 'inbound' | 'outbound' | 'both'
  requires_contrl: boolean
  requires_aperak: boolean
  supports_negative_response: boolean
  is_active: boolean
  valid_from: string | null
  valid_to: string | null
  notes: string | null
  updated_at: string | null
  statusTag: 'current' | 'previous' | 'history'
  runtimeCurrentVersion: string | null
  runtimePreviousVersion: string | null
  acceptedVersions: string[]
}

export type EdielRuleGroup = {
  key: string
  family: string
  code: string
  standard: 'edifact' | 'xml' | 'ai_list'
  rows: EdielRuleListRow[]
  currentRule: EdielRuleListRow | null
  previousRule: EdielRuleListRow | null
  historyRules: EdielRuleListRow[]
}

type Props = {
  groups: EdielRuleGroup[]
}

function pillClassName(tone: 'green' | 'yellow' | 'red' | 'blue' | 'slate') {
  return tone === 'green'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : tone === 'yellow'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : tone === 'red'
        ? 'border-rose-200 bg-rose-50 text-rose-700'
        : tone === 'blue'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-slate-200 bg-slate-50 text-slate-700'
}

function Pill({
  text,
  tone,
}: {
  text: string
  tone: 'green' | 'yellow' | 'red' | 'blue' | 'slate'
}) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${pillClassName(tone)}`}>
      {text}
    </span>
  )
}

function inputClassName() {
  return 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400'
}

function selectClassName() {
  return 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900'
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function Input({
  name,
  defaultValue,
  placeholder,
  type = 'text',
}: {
  name: string
  defaultValue?: string | number | null
  placeholder?: string
  type?: string
}) {
  return (
    <input
      name={name}
      type={type}
      defaultValue={defaultValue ?? ''}
      placeholder={placeholder}
      className={inputClassName()}
    />
  )
}

function Select({
  name,
  defaultValue,
  children,
}: {
  name: string
  defaultValue?: string | number | null
  children: React.ReactNode
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue == null ? '' : String(defaultValue)}
      className={selectClassName()}
    >
      {children}
    </select>
  )
}

function Checkbox({
  name,
  defaultChecked,
  label,
}: {
  name: string
  defaultChecked?: boolean
  label: string
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-slate-300"
      />
      <span>{label}</span>
    </label>
  )
}

function RuleEditorCard({
  row,
  defaultOpen = false,
}: {
  row: EdielRuleListRow
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  const tone =
    row.statusTag === 'current'
      ? 'green'
      : row.statusTag === 'previous'
        ? 'yellow'
        : 'slate'

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-4 text-left"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Pill
            text={row.statusTag === 'current' ? 'CURRENT' : row.statusTag === 'previous' ? 'PREVIOUS' : 'HISTORY'}
            tone={tone}
          />
          <Pill text={row.version_code} tone="blue" />
          <Pill text={row.direction} tone="slate" />
          <Pill text={row.is_active ? 'Aktiv' : 'Inaktiv'} tone={row.is_active ? 'green' : 'slate'} />
        </div>

        <div className="text-xs text-slate-500">
          Uppdaterad {formatDate(row.updated_at)}
        </div>
      </button>

      {open ? (
        <form action={saveEdielMessageRuleAction} className="border-t border-slate-200 bg-white px-4 py-4">
          <input type="hidden" name="id" value={row.id} />

          <div className="grid gap-3 md:grid-cols-3">
            <Input name="message_family" defaultValue={row.message_family} />
            <Input name="message_code" defaultValue={row.message_code} />
            <Select name="message_standard" defaultValue={row.message_standard}>
              <option value="edifact">edifact</option>
              <option value="xml">xml</option>
              <option value="ai_list">ai_list</option>
            </Select>

            <Input name="version_code" defaultValue={row.version_code} />
            <Select name="direction" defaultValue={row.direction}>
              <option value="both">both</option>
              <option value="inbound">inbound</option>
              <option value="outbound">outbound</option>
            </Select>
            <Input name="valid_from" type="date" defaultValue={row.valid_from} />

            <Input name="valid_to" type="date" defaultValue={row.valid_to} />
            <Input name="notes" defaultValue={row.notes} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Checkbox name="requires_contrl" defaultChecked={row.requires_contrl} label="requires_contrl" />
            <Checkbox name="requires_aperak" defaultChecked={row.requires_aperak} label="requires_aperak" />
            <Checkbox
              name="supports_negative_response"
              defaultChecked={row.supports_negative_response}
              label="supports_negative_response"
            />
            <Checkbox name="is_active" defaultChecked={row.is_active} label="Aktiv regel" />

            <button
              type="submit"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              Spara regel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  )
}

export default function EdielRuleGroups({ groups }: Props) {
  const [showHistory, setShowHistory] = useState(false)
  const [query, setQuery] = useState('')

  const filteredGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return groups.filter((group) => {
      if (!normalizedQuery) return true

      return (
        group.family.toLowerCase().includes(normalizedQuery) ||
        group.code.toLowerCase().includes(normalizedQuery) ||
        group.standard.toLowerCase().includes(normalizedQuery) ||
        group.rows.some((row) => row.version_code.toLowerCase().includes(normalizedQuery))
      )
    })
  }, [groups, query])

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Message rules</h2>
          <p className="mt-1 text-sm text-slate-500">
            Här visas reglerna grupperade per family + code + standard. Du ser direkt vad som är current, previous och history, i stället för en lång rå lista.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Sök family, code eller version"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
          />
          <label className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={showHistory}
              onChange={(event) => setShowHistory(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Visa history
          </label>
        </div>
      </div>

      <div className="space-y-5">
        {filteredGroups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            Inga rule-grupper matchar filtret.
          </div>
        ) : (
          filteredGroups.map((group) => (
            <article key={group.key} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-950">
                      {group.family} {group.code}
                    </h3>
                    <Pill text={group.standard} tone="blue" />
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    Current = runtime current outbound-version. Previous = närmast föregående giltiga version. History = övriga sparade regler för samma family/code/standard.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Pill
                    text={`current ${group.currentRule?.version_code ?? '—'}`}
                    tone="green"
                  />
                  <Pill
                    text={`previous ${group.previousRule?.version_code ?? '—'}`}
                    tone="yellow"
                  />
                  <Pill
                    text={`accepted ${group.currentRule?.acceptedVersions.length ?? 0}`}
                    tone="slate"
                  />
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="mb-3 text-sm font-semibold text-emerald-900">Current</div>
                  {group.currentRule ? (
                    <RuleEditorCard row={group.currentRule} defaultOpen />
                  ) : (
                    <div className="rounded-xl border border-dashed border-emerald-300 bg-white p-3 text-sm text-emerald-800">
                      Ingen current-rule kunde matchas från runtime just nu.
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="mb-3 text-sm font-semibold text-amber-900">Previous</div>
                  {group.previousRule ? (
                    <RuleEditorCard row={group.previousRule} />
                  ) : (
                    <div className="rounded-xl border border-dashed border-amber-300 bg-white p-3 text-sm text-amber-800">
                      Ingen previous-rule finns för gruppen just nu.
                    </div>
                  )}
                </div>
              </div>

              {showHistory ? (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-900">History</div>
                  {group.historyRules.length > 0 ? (
                    <div className="space-y-3">
                      {group.historyRules.map((row) => (
                        <RuleEditorCard key={row.id} row={row} />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500">
                      Ingen history sparad för gruppen ännu.
                    </div>
                  )}
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  )
}