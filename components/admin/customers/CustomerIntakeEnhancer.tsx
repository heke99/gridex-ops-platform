'use client'

import { useEffect, useMemo, useState } from 'react'

type IntakeOffer = {
  id: string
  name: string
  contract_type: 'fixed' | 'variable_monthly' | 'variable_hourly' | 'portfolio'
  fixed_price_ore_per_kwh: number | null
  spot_markup_ore_per_kwh: number | null
  variable_fee_ore_per_kwh: number | null
  monthly_fee_sek: number | null
  green_fee_mode: 'none' | 'sek_month' | 'ore_per_kwh'
  green_fee_value: number | null
  default_binding_months: number | null
  default_notice_months: number | null
  optional_fee_lines: Array<Record<string, unknown>> | null
}

type Props = {
  offers: IntakeOffer[]
}

function formatContractTypeLabel(value: IntakeOffer['contract_type']): string {
  switch (value) {
    case 'fixed':
      return 'Fast'
    case 'variable_monthly':
      return 'Rörlig månad'
    case 'variable_hourly':
      return 'Rörlig tim'
    case 'portfolio':
      return 'Portfölj'
    default:
      return value
  }
}

function formatOptionalFeeLines(
  lines: Array<Record<string, unknown>> | null
): string {
  if (!lines || lines.length === 0) return ''

  return lines
    .map((line) => {
      const label = typeof line.label === 'string' ? line.label : ''
      const amount =
        typeof line.amount === 'number' || typeof line.amount === 'string'
          ? String(line.amount)
          : ''
      const unit = typeof line.unit === 'string' ? line.unit : 'sek'
      return `${label} | ${amount} | ${unit}`
    })
    .join('\n')
}

function setFieldValue(name: string, value: string) {
  const field = document.querySelector<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >(`[name="${name}"]`)

  if (!field || field.disabled) return

  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.dispatchEvent(new Event('change', { bubbles: true }))
}

function tokenizeRules(value: string | null): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function matchesRule(ruleValue: string | null, selectedValue: string): boolean {
  const rules = tokenizeRules(ruleValue)
  if (rules.length === 0) return true
  return rules.includes(selectedValue)
}

function isPlaceholderField(
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
): field is HTMLInputElement | HTMLTextAreaElement {
  return field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
}

function toggleSectionVisibility(attribute: string, selectedValue: string) {
  const sections = document.querySelectorAll<HTMLElement>(`[${attribute}]`)

  sections.forEach((section) => {
    const shouldShow = matchesRule(section.getAttribute(attribute), selectedValue)
    section.hidden = !shouldShow

    const formFields = section.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >('input, select, textarea')

    formFields.forEach((field) => {
      if (field.hasAttribute('data-keep-enabled')) return
      field.disabled = !shouldShow
    })
  })
}

function syncConditionalRequired(
  attribute: string,
  selectedValue: string,
  inputType: 'customer' | 'flow'
) {
  const fields = document.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >(`[${attribute}]`)

  fields.forEach((field) => {
    const isRequired = matchesRule(field.getAttribute(attribute), selectedValue)
    field.required = isRequired && !field.disabled

    const wrapper = field.closest('label')
    if (wrapper) {
      wrapper.dataset.required = isRequired && !field.disabled ? 'true' : 'false'
    }

    if (inputType === 'customer' && isPlaceholderField(field)) {
      if (field.name === 'firstName') {
        field.placeholder =
          selectedValue === 'private' ? 'Förnamn' : 'Kontaktperson förnamn'
      }

      if (field.name === 'lastName') {
        field.placeholder =
          selectedValue === 'private' ? 'Efternamn' : 'Kontaktperson efternamn'
      }
    }
  })
}

function syncDynamicLabels(attribute: string, selectedValue: string) {
  const labels = document.querySelectorAll<HTMLElement>(`[${attribute}]`)

  labels.forEach((label) => {
    const nextText = label.dataset[`label${selectedValue}` as keyof DOMStringMap]
    if (typeof nextText === 'string' && nextText.trim()) {
      label.textContent = nextText
    }
  })
}

function syncDynamicForm(customerType: string, flowType: string) {
  toggleSectionVisibility('data-customer-section', customerType)
  toggleSectionVisibility('data-flow-section', flowType)
  syncConditionalRequired('data-required-customer', customerType, 'customer')
  syncConditionalRequired('data-required-flow', flowType, 'flow')
  syncDynamicLabels('data-label-for-customer', customerType)
  syncDynamicLabels('data-label-for-flow', flowType)
}

export default function CustomerIntakeEnhancer({ offers }: Props) {
  const [selectedOfferId, setSelectedOfferId] = useState('')
  const [flowType, setFlowType] = useState('switch')
  const [customerType, setCustomerType] = useState('private')

  useEffect(() => {
    const contractSelect = document.querySelector<HTMLSelectElement>(
      '[name="contractOfferId"]'
    )
    const flowSelect = document.querySelector<HTMLSelectElement>(
      '[name="intakeFlowType"]'
    )
    const customerTypeSelect = document.querySelector<HTMLSelectElement>(
      '[name="customerType"]'
    )

    if (!contractSelect || !flowSelect || !customerTypeSelect) {
      return
    }

    const syncState = () => {
      setSelectedOfferId(contractSelect.value)
      setFlowType(flowSelect.value)
      setCustomerType(customerTypeSelect.value)
      syncDynamicForm(customerTypeSelect.value, flowSelect.value)
    }

    syncState()

    contractSelect.addEventListener('change', syncState)
    flowSelect.addEventListener('change', syncState)
    customerTypeSelect.addEventListener('change', syncState)

    return () => {
      contractSelect.removeEventListener('change', syncState)
      flowSelect.removeEventListener('change', syncState)
      customerTypeSelect.removeEventListener('change', syncState)
    }
  }, [])

  const selectedOffer = useMemo(
    () => offers.find((offer) => offer.id === selectedOfferId) ?? null,
    [offers, selectedOfferId]
  )

  useEffect(() => {
    if (!selectedOffer) return

    setFieldValue('contractTypeOverride', selectedOffer.contract_type)
    setFieldValue('greenFeeMode', selectedOffer.green_fee_mode)
    setFieldValue(
      'fixedPriceOrePerKwh',
      selectedOffer.fixed_price_ore_per_kwh !== null
        ? String(selectedOffer.fixed_price_ore_per_kwh)
        : ''
    )
    setFieldValue(
      'spotMarkupOrePerKwh',
      selectedOffer.spot_markup_ore_per_kwh !== null
        ? String(selectedOffer.spot_markup_ore_per_kwh)
        : ''
    )
    setFieldValue(
      'variableFeeOrePerKwh',
      selectedOffer.variable_fee_ore_per_kwh !== null
        ? String(selectedOffer.variable_fee_ore_per_kwh)
        : ''
    )
    setFieldValue(
      'monthlyFeeSek',
      selectedOffer.monthly_fee_sek !== null
        ? String(selectedOffer.monthly_fee_sek)
        : ''
    )
    setFieldValue(
      'greenFeeValue',
      selectedOffer.green_fee_value !== null
        ? String(selectedOffer.green_fee_value)
        : ''
    )
    setFieldValue(
      'bindingMonths',
      selectedOffer.default_binding_months !== null
        ? String(selectedOffer.default_binding_months)
        : ''
    )
    setFieldValue(
      'noticeMonths',
      selectedOffer.default_notice_months !== null
        ? String(selectedOffer.default_notice_months)
        : ''
    )
    setFieldValue(
      'optionalFeeLines',
      formatOptionalFeeLines(selectedOffer.optional_fee_lines)
    )
  }, [selectedOffer])

  const intakeSummary = useMemo(() => {
    if (customerType === 'private') {
      if (flowType === 'move_in') {
        return 'Privatkund som flyttar in. För- och efternamn används som kundnamn och adress/inflyttningsdatum ska följa med.'
      }

      if (flowType === 'move_out_takeover') {
        return 'Privatkund som tar över anläggning vid utflytt. Kundnamnet byggs från personuppgifterna och övertagsdatum styr switchunderlaget.'
      }

      return 'Privatkund. Personfält används som kundens huvudidentitet och företags-/föreningsfält döljs.'
    }

    if (customerType === 'association') {
      return 'Förening. Föreningsnamn och organisationsnummer sparas på kunden, medan kontaktperson sparas som primär kontakt.'
    }

    return 'Företag. Företagsnamn och organisationsnummer sparas på kunden, medan kontaktperson sparas som primär kontakt.'
  }, [customerType, flowType])

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
        <div className="font-semibold text-slate-900 dark:text-white">
          Intake-logik
        </div>
        <div className="mt-1">
          Kundtyp:{' '}
          <span className="font-medium">
            {customerType === 'association'
              ? 'Förening'
              : customerType === 'business'
                ? 'Företag'
                : 'Privat'}
          </span>
        </div>
        <div className="mt-1">
          Flöde:{' '}
          <span className="font-medium">
            {flowType === 'move_in'
              ? 'Inflytt / flytt'
              : flowType === 'move_out_takeover'
                ? 'Övertag vid utflytt'
                : 'Leverantörsbyte'}
          </span>
        </div>
        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {intakeSummary}
        </div>
      </div>

      {selectedOffer ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200">
          <div className="font-semibold">
            Vald avtalsmall: {selectedOffer.name}
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <div>Avtalstyp: {formatContractTypeLabel(selectedOffer.contract_type)}</div>
            <div>
              Månadsavgift:{' '}
              {selectedOffer.monthly_fee_sek !== null
                ? `${selectedOffer.monthly_fee_sek} kr`
                : '—'}
            </div>
            <div>
              Fast pris:{' '}
              {selectedOffer.fixed_price_ore_per_kwh !== null
                ? `${selectedOffer.fixed_price_ore_per_kwh} öre/kWh`
                : '—'}
            </div>
            <div>
              Påslag:{' '}
              {selectedOffer.spot_markup_ore_per_kwh !== null
                ? `${selectedOffer.spot_markup_ore_per_kwh} öre/kWh`
                : '—'}
            </div>
            <div>
              Rörlig avgift:{' '}
              {selectedOffer.variable_fee_ore_per_kwh !== null
                ? `${selectedOffer.variable_fee_ore_per_kwh} öre/kWh`
                : '—'}
            </div>
            <div>
              Bindning / uppsägning:{' '}
              {selectedOffer.default_binding_months ?? '—'} /{' '}
              {selectedOffer.default_notice_months ?? '—'} mån
            </div>
          </div>
          <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
            Fälten nedan fylls nu automatiskt med mallvärdena men kan fortfarande
            justeras manuellt innan kunden skapas.
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          Välj en avtalsmall så fylls avgifter, påslag, månadsavgift,
          bindningstid och uppsägningstid i direkt.
        </div>
      )}
    </div>
  )
}