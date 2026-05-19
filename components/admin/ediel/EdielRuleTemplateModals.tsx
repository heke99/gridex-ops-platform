'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import type { EdielTemplateActionState } from '@/app/admin/ediel/settings/actions'
import { applyEdielRuleTemplateAction } from '@/app/admin/ediel/settings/actions'

type TemplateId = 'meter_values_request' | 'supplier_switch' | 'ai_list_control' | 'ack_core'

type TemplateMeta = {
  id: TemplateId
  title: string
  subtitle: string
  versionLabel: string
  defaultValidFrom: string
  creates: string[]
  help: string
  requiresProdat?: boolean
}

type Props = {
  hasProdatRule: boolean
}

const INITIAL_TEMPLATE_ACTION_STATE: EdielTemplateActionState = {
  ok: false,
  template: null,
  message: '',
  createdCount: 0,
  skippedCount: 0,
  createdRules: [],
  skippedRules: [],
}

const TEMPLATE_META: TemplateMeta[] = [
  {
    id: 'meter_values_request',
    title: 'Begär mätvärden',
    subtitle: 'UTILTS-paket för mätvärden och saknade värden',
    versionLabel: 'E5SE5A',
    defaultValidFrom: '2025-06-01',
    creates: ['UTILTS E66', 'UTILTS E73', 'UTILTS S02', 'CONTRL', 'APERAK'],
    help: 'UTILTS-version E5SE5A gäller från 2025-06-01. Den här mallen bygger upp det vanligaste grundpaketet för mätvärdesflöden.',
  },
  {
    id: 'supplier_switch',
    title: 'Leverantörsbyte',
    subtitle: 'PRODAT-paket plus kvittenser',
    versionLabel: 'Aktiv PRODAT-version',
    defaultValidFrom: '',
    creates: ['PRODAT Z03', 'PRODAT Z05', 'PRODAT Z09', 'CONTRL', 'APERAK'],
    help: 'Mallen använder den PRODAT-version som redan är aktiv i systemet. Lägg först in minst en PRODAT-version om denna mall ska användas.',
    requiresProdat: true,
  },
  {
    id: 'ai_list_control',
    title: 'AI-list kontroll',
    subtitle: 'AI-/BI-regler för kontrollflödet',
    versionLabel: 'Ver20140401',
    defaultValidFrom: '2025-10-01',
    creates: ['AI_LIST AI', 'AI_LIST BI'],
    help: 'Från 2025-10-01 ska AI-/BI-filer vara .csv men fortfarande semikolonseparerade. Versionsbeteckningen ligger kvar som Ver20140401.',
  },
  {
    id: 'ack_core',
    title: 'Kvittenslager',
    subtitle: 'Grundlager för syntax- och applikationskvittens',
    versionLabel: 'Aktiv CONTRL/APERAK-version',
    defaultValidFrom: '',
    creates: ['CONTRL', 'APERAK'],
    help: 'CONTRL används för syntaxkvittens och APERAK för applikationskvittens. Den här mallen lägger grunden för kvittensmotorn.',
  },
]

function overlayClassName(open: boolean) {
  return open
    ? 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4'
    : 'hidden'
}

export default function EdielRuleTemplateModals({ hasProdatRule }: Props) {
  const [openTemplateId, setOpenTemplateId] = useState<TemplateId | null>(null)
  const [state, formAction, isPending] = useActionState(
    applyEdielRuleTemplateAction,
    INITIAL_TEMPLATE_ACTION_STATE
  )

  const activeTemplate = useMemo(
    () => TEMPLATE_META.find((item) => item.id === openTemplateId) ?? null,
    [openTemplateId]
  )

  useEffect(() => {
    if (state.ok && state.template === openTemplateId) {
      const timeout = window.setTimeout(() => {
        setOpenTemplateId(null)
      }, 1200)
      return () => window.clearTimeout(timeout)
    }
  }, [state.ok, state.template, openTemplateId])

  return (
    <>
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="text-lg font-semibold text-slate-950">Processmallar för regler</h2>
        <p className="mt-1 text-sm text-slate-700">
          Klicka på en mall så öppnas en ruta direkt. Där ser du vilka regler som kommer
          skapas, vilken version som används och från vilket datum paketet börjar gälla.
        </p>

        <div className="mt-4 grid gap-4 xl:grid-cols-4">
          {TEMPLATE_META.map((template) => {
            const blocked = Boolean(template.requiresProdat && !hasProdatRule)

            return (
              <div
                key={template.id}
                className="rounded-2xl border border-white/70 bg-white p-4"
              >
                <div className="text-sm font-semibold text-slate-900">{template.title}</div>
                <p className="mt-1 text-xs text-slate-500">{template.subtitle}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                    Version {template.versionLabel}
                  </span>
                  {template.defaultValidFrom ? (
                    <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                      Från {template.defaultValidFrom}
                    </span>
                  ) : null}
                  {blocked ? (
                    <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                      Kräver PRODAT
                    </span>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => setOpenTemplateId(template.id)}
                  disabled={blocked}
                  className="mt-4 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Öppna mall
                </button>
              </div>
            )
          })}
        </div>
      </section>

      <div className={overlayClassName(Boolean(activeTemplate))}>
        {activeTemplate ? (
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold text-slate-950">
                  {activeTemplate.title}
                </h3>
                <p className="mt-1 text-sm text-slate-600">{activeTemplate.subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpenTemplateId(null)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
              >
                Stäng
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-slate-700">
              <div className="font-medium text-slate-900">Vad den här mallen gör</div>
              <p className="mt-1">{activeTemplate.help}</p>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">
                  Regler som kommer skapas
                </div>
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  {activeTemplate.creates.map((item) => (
                    <li
                      key={item}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <form action={formAction} className="rounded-2xl border border-slate-200 p-4">
                <input type="hidden" name="template" value={activeTemplate.id} />

                <div className="grid gap-3">
                  <label className="text-sm font-medium text-slate-700">
                    Version som används
                    <input
                      value={activeTemplate.versionLabel}
                      readOnly
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                    />
                  </label>

                  <label className="text-sm font-medium text-slate-700">
                    Giltig från
                    <input
                      name="valid_from"
                      type="date"
                      defaultValue={activeTemplate.defaultValidFrom}
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  </label>

                  <label className="text-sm font-medium text-slate-700">
                    Giltig till
                    <input
                      name="valid_to"
                      type="date"
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  </label>
                </div>

                {state.template === activeTemplate.id && state.message ? (
                  <div
                    className={`mt-4 rounded-2xl border p-4 text-sm ${
                      state.ok
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-red-200 bg-red-50 text-red-800'
                    }`}
                  >
                    <div className="font-medium">{state.message}</div>
                    {state.error ? <div className="mt-1">{state.error}</div> : null}
                    {state.createdRules.length > 0 ? (
                      <div className="mt-2">
                        <div className="font-medium">Skapade regler</div>
                        <ul className="mt-1 list-disc pl-5">
                          {state.createdRules.map((rule) => (
                            <li key={rule}>{rule}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {state.skippedRules.length > 0 ? (
                      <div className="mt-2">
                        <div className="font-medium">Fanns redan</div>
                        <ul className="mt-1 list-disc pl-5">
                          {state.skippedRules.map((rule) => (
                            <li key={rule}>{rule}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={isPending}
                    className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isPending ? 'Skapar…' : 'Godkänn och skapa'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenTemplateId(null)}
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                  >
                    Avbryt
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}