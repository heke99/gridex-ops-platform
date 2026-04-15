'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import CustomerIntakeEnhancer from '@/components/admin/customers/CustomerIntakeEnhancer'
import { createCustomerAction } from '@/app/admin/customers/actions'
import {
  initialIntakeActionState,
  type IntakeActionState,
} from '@/app/admin/customers/actionState'

type GridOwnerOption = {
  id: string
  name: string
}

type PriceAreaOption = {
  code: string
  name: string
}

type ContractOfferOption = {
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
  gridOwners: GridOwnerOption[]
  priceAreas: PriceAreaOption[]
  contractOffers: ContractOfferOption[]
}

function inputClassName(state: IntakeActionState, fieldName: string, span?: 'full') {
  const hasError = Boolean(state.fieldErrors[fieldName as keyof typeof state.fieldErrors])

  return `rounded-2xl border px-4 py-3 dark:bg-slate-950 dark:text-white ${
    hasError
      ? 'border-red-500 bg-red-50 text-red-950 dark:border-red-500 dark:bg-red-950/20 dark:text-red-100'
      : 'border-slate-300 dark:border-slate-700'
  }${span === 'full' ? ' md:col-span-2' : ''}`
}

function FieldError({ state, name }: { state: IntakeActionState; name: string }) {
  const error = state.fieldErrors[name as keyof typeof state.fieldErrors]
  if (!error) return null

  return <span className="text-xs font-medium text-red-600 dark:text-red-400">{error}</span>
}

export default function CustomerIntakeForm({
  gridOwners,
  priceAreas,
  contractOffers,
}: Props) {
  const [state, formAction, isPending] = useActionState(
    createCustomerAction,
    initialIntakeActionState
  )

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
        Registrera kund
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Skapar kundpost, kontaktperson, anläggning, eventuell mätpunkt och kundavtal i ett och samma flöde.
      </p>

      <form action={formAction} className="mt-6 space-y-6" data-customer-intake-form>
        {state.status === 'error' && state.message ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-100">
            <p className="font-semibold">Intaget stoppades innan ofullständig data sparades.</p>
            <p className="mt-1">{state.message}</p>
          </div>
        ) : null}

        {state.status === 'success' && state.message ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-100">
            <p className="font-semibold">Klart.</p>
            <p className="mt-1">{state.message}</p>
            {state.createdCustomerId ? (
              <Link
                href={`/admin/customers/${state.createdCustomerId}`}
                className="mt-3 inline-flex rounded-xl border border-emerald-300 px-3 py-2 font-semibold hover:bg-emerald-100 dark:border-emerald-700 dark:hover:bg-emerald-900/40"
              >
                Öppna kundkort
              </Link>
            ) : null}
          </div>
        ) : null}

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Kunddata
          </h3>

          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">Kundtyp</span>
              <select name="customerType" defaultValue="private" className={inputClassName(state, 'customerType')}>
                <option value="private">Privatkund</option>
                <option value="business">Företagskund</option>
                <option value="association">Förening</option>
              </select>
              <FieldError state={state} name="customerType" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">Flöde</span>
              <select name="intakeFlowType" defaultValue="switch" className={inputClassName(state, 'intakeFlowType')}>
                <option value="switch">Byte av leverantör</option>
                <option value="move_in">Inflytt / flytt</option>
                <option value="move_out_takeover">Övertag vid utflytt</option>
              </select>
              <FieldError state={state} name="intakeFlowType" />
            </label>

            <label className="grid gap-1 text-sm" data-customer-section="private">
              <span className="text-slate-600 dark:text-slate-300">Lägenhetsnummer</span>
              <input name="apartmentNumber" placeholder="Lägenhetsnummer" className={inputClassName(state, 'apartmentNumber')} />
              <FieldError state={state} name="apartmentNumber" />
            </label>

            <label className="grid gap-1 text-sm" data-customer-section="private business association">
              <span className="text-slate-600 dark:text-slate-300" data-label-for-customer data-label-private="Förnamn" data-label-business="Kontaktperson förnamn" data-label-association="Kontaktperson förnamn">
                Förnamn
              </span>
              <input name="firstName" placeholder="Förnamn" className={inputClassName(state, 'firstName')} data-required-customer="private business association" />
              <FieldError state={state} name="firstName" />
            </label>

            <label className="grid gap-1 text-sm" data-customer-section="private business association">
              <span className="text-slate-600 dark:text-slate-300" data-label-for-customer data-label-private="Efternamn" data-label-business="Kontaktperson efternamn" data-label-association="Kontaktperson efternamn">
                Efternamn
              </span>
              <input name="lastName" placeholder="Efternamn" className={inputClassName(state, 'lastName')} data-required-customer="private business association" />
              <FieldError state={state} name="lastName" />
            </label>

            <label className="grid gap-1 text-sm" data-customer-section="business association">
              <span className="text-slate-600 dark:text-slate-300">Kontaktperson titel</span>
              <input name="contactTitle" placeholder="Ex. VD, administratör, ordförande" className={inputClassName(state, 'contactTitle')} />
              <FieldError state={state} name="contactTitle" />
            </label>

            <label className="grid gap-1 text-sm md:col-span-2" data-customer-section="business association">
              <span className="text-slate-600 dark:text-slate-300" data-label-for-customer data-label-business="Företagsnamn" data-label-association="Föreningsnamn">
                Företags- / föreningsnamn
              </span>
              <input name="companyName" placeholder="Företags- eller föreningsnamn" className={inputClassName(state, 'companyName', 'full')} data-required-customer="business association" />
              <FieldError state={state} name="companyName" />
            </label>

            <label className="grid gap-1 text-sm" data-customer-section="private">
              <span className="text-slate-600 dark:text-slate-300">Personnummer</span>
              <input name="personalNumber" placeholder="Personnummer" className={inputClassName(state, 'personalNumber')} />
              <FieldError state={state} name="personalNumber" />
            </label>

            <label className="grid gap-1 text-sm" data-customer-section="business association">
              <span className="text-slate-600 dark:text-slate-300">Organisationsnummer</span>
              <input name="orgNumber" placeholder="Organisationsnummer" className={inputClassName(state, 'orgNumber')} data-required-customer="business association" />
              <FieldError state={state} name="orgNumber" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">E-post</span>
              <input name="email" type="email" placeholder="E-post" className={inputClassName(state, 'email')} />
              <FieldError state={state} name="email" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">Mobilnummer</span>
              <input name="phone" placeholder="Mobilnummer" className={inputClassName(state, 'phone')} />
              <FieldError state={state} name="phone" />
            </label>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Anläggning och flytt
          </h3>

          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">Anläggningsnamn / etikett</span>
              <input name="siteName" placeholder="Anläggningsnamn / etikett" className={inputClassName(state, 'siteName')} />
              <FieldError state={state} name="siteName" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">Anläggnings-id</span>
              <input name="facilityId" placeholder="Anläggnings-id" className={inputClassName(state, 'facilityId')} />
              <FieldError state={state} name="facilityId" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">Mätpunkts-id</span>
              <input name="meterPointId" placeholder="Mätpunkts-id" className={inputClassName(state, 'meterPointId')} />
              <FieldError state={state} name="meterPointId" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300" data-label-for-flow data-label-switch="Önskat startdatum" data-label-move_in="Inflyttningsdatum" data-label-move_out_takeover="Övertagsdatum">
                Önskat startdatum
              </span>
              <input type="date" name="moveInDate" className={inputClassName(state, 'moveInDate')} data-required-flow="move_in move_out_takeover" />
              <FieldError state={state} name="moveInDate" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">Nätägare</span>
              <select name="gridOwnerId" className={inputClassName(state, 'gridOwnerId')}>
                <option value="">Välj nätägare</option>
                {gridOwners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
              <FieldError state={state} name="gridOwnerId" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">Elområde</span>
              <select name="priceAreaCode" className={inputClassName(state, 'priceAreaCode')}>
                <option value="">Välj elområde</option>
                {priceAreas.map((area) => (
                  <option key={area.code} value={area.code}>
                    {area.code} • {area.name}
                  </option>
                ))}
              </select>
              <FieldError state={state} name="priceAreaCode" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">Årsförbrukning kWh</span>
              <input name="annualConsumptionKwh" placeholder="Årsförbrukning kWh" className={inputClassName(state, 'annualConsumptionKwh')} />
              <FieldError state={state} name="annualConsumptionKwh" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">Anläggningstyp</span>
              <select name="siteType" defaultValue="consumption" className={inputClassName(state, 'siteType')}>
                <option value="consumption">Förbrukning</option>
                <option value="production">Produktion</option>
                <option value="mixed">Mixad</option>
              </select>
              <FieldError state={state} name="siteType" />
            </label>

            <label className="grid gap-1 text-sm md:col-span-2" data-flow-section="switch move_in move_out_takeover">
              <span className="text-slate-600 dark:text-slate-300" data-label-for-flow data-label-switch="Anläggningsadress" data-label-move_in="Ny adress kunden flyttar till" data-label-move_out_takeover="Adress som tas över">
                Anläggningsadress
              </span>
              <input name="street" placeholder="Gatuadress" className={inputClassName(state, 'street', 'full')} data-required-flow="move_in move_out_takeover" />
              <FieldError state={state} name="street" />
            </label>

            <label className="grid gap-1 text-sm" data-flow-section="switch move_in move_out_takeover">
              <span className="text-slate-600 dark:text-slate-300">Postnummer</span>
              <input name="postalCode" placeholder="Postnummer" className={inputClassName(state, 'postalCode')} data-required-flow="move_in move_out_takeover" />
              <FieldError state={state} name="postalCode" />
            </label>

            <label className="grid gap-1 text-sm" data-flow-section="switch move_in move_out_takeover">
              <span className="text-slate-600 dark:text-slate-300">Stad</span>
              <input name="city" placeholder="Stad" className={inputClassName(state, 'city')} data-required-flow="move_in move_out_takeover" />
              <FieldError state={state} name="city" />
            </label>

            <label className="grid gap-1 text-sm" data-flow-section="switch move_in move_out_takeover">
              <span className="text-slate-600 dark:text-slate-300">Land</span>
              <input name="country" defaultValue="SE" placeholder="SE" className={inputClassName(state, 'country')} />
              <FieldError state={state} name="country" />
            </label>

            <label className="grid gap-1 text-sm md:col-span-2" data-flow-section="switch move_in move_out_takeover">
              <span className="text-slate-600 dark:text-slate-300">c/o</span>
              <input name="careOf" placeholder="c/o" className={inputClassName(state, 'careOf', 'full')} />
              <FieldError state={state} name="careOf" />
            </label>

            <label className="grid gap-1 text-sm" data-flow-section="switch move_in move_out_takeover">
              <span className="text-slate-600 dark:text-slate-300" data-label-for-flow data-label-switch="Nuvarande elleverantör" data-label-move_in="Nuvarande elleverantör på nya anläggningen" data-label-move_out_takeover="Nuvarande elleverantör på anläggningen">
                Nuvarande elleverantör
              </span>
              <input name="currentSupplierName" placeholder="Nuvarande elleverantör" className={inputClassName(state, 'currentSupplierName')} />
              <FieldError state={state} name="currentSupplierName" />
            </label>

            <label className="grid gap-1 text-sm" data-flow-section="switch move_in move_out_takeover">
              <span className="text-slate-600 dark:text-slate-300">Nuvarande leverantör org.nr</span>
              <input name="currentSupplierOrgNumber" placeholder="Nuvarande leverantör org.nr" className={inputClassName(state, 'currentSupplierOrgNumber')} />
              <FieldError state={state} name="currentSupplierOrgNumber" />
            </label>

            <div className="md:col-span-2 grid gap-4 md:grid-cols-2" data-flow-section="move_in move_out_takeover">
              <div className="md:col-span-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
                Fyll i var kunden flyttar från när det är relevant. Fälten skickas bara med för inflytt och övertag.
              </div>

              <label className="grid gap-1 text-sm md:col-span-2">
                <span className="text-slate-600 dark:text-slate-300">Flyttar från adress</span>
                <input name="movedFromStreet" placeholder="Flyttar från adress" className={inputClassName(state, 'movedFromStreet', 'full')} />
                <FieldError state={state} name="movedFromStreet" />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-slate-600 dark:text-slate-300">Flyttar från postnummer</span>
                <input name="movedFromPostalCode" placeholder="Flyttar från postnummer" className={inputClassName(state, 'movedFromPostalCode')} />
                <FieldError state={state} name="movedFromPostalCode" />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-slate-600 dark:text-slate-300">Flyttar från stad</span>
                <input name="movedFromCity" placeholder="Flyttar från stad" className={inputClassName(state, 'movedFromCity')} />
                <FieldError state={state} name="movedFromCity" />
              </label>

              <label className="grid gap-1 text-sm md:col-span-2">
                <span className="text-slate-600 dark:text-slate-300">Flyttar från leverantör</span>
                <input name="movedFromSupplierName" placeholder="Flyttar från leverantör" className={inputClassName(state, 'movedFromSupplierName', 'full')} />
                <FieldError state={state} name="movedFromSupplierName" />
              </label>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Avtal
          </h3>

          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm md:col-span-2">
              <span className="text-slate-600 dark:text-slate-300">Avtalsmall</span>
              <select name="contractOfferId" className={inputClassName(state, 'contractOfferId', 'full')}>
                <option value="">Välj avtal från avtalskatalog</option>
                {contractOffers.map((offer) => (
                  <option key={offer.id} value={offer.id}>
                    {offer.name} • {offer.contract_type}
                  </option>
                ))}
              </select>
              <FieldError state={state} name="contractOfferId" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">Avtalsstart</span>
              <input type="date" name="contractStartDate" className={inputClassName(state, 'contractStartDate')} />
              <FieldError state={state} name="contractStartDate" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">Avtalsstatus</span>
              <select name="contractStatus" defaultValue="pending_signature" className={inputClassName(state, 'contractStatus')}>
                <option value="draft">Draft</option>
                <option value="pending_signature">Väntar signering</option>
                <option value="signed">Signerat</option>
                <option value="active">Aktivt</option>
              </select>
              <FieldError state={state} name="contractStatus" />
            </label>

            <label className="grid gap-1 text-sm md:col-span-2">
              <span className="text-slate-600 dark:text-slate-300">Override-orsak</span>
              <input name="overrideReason" placeholder="Override-orsak" className={inputClassName(state, 'overrideReason', 'full')} />
              <FieldError state={state} name="overrideReason" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">Avtalstyp override</span>
              <select name="contractTypeOverride" className={inputClassName(state, 'contractTypeOverride')}>
                <option value="">Behåll katalogens avtalstyp</option>
                <option value="fixed">Fast</option>
                <option value="variable_monthly">Rörlig månad</option>
                <option value="variable_hourly">Rörlig tim</option>
                <option value="portfolio">Portfölj</option>
              </select>
              <FieldError state={state} name="contractTypeOverride" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">Grön el-avgift override</span>
              <select name="greenFeeMode" className={inputClassName(state, 'greenFeeMode')}>
                <option value="">Behåll katalogens grön el-avgift</option>
                <option value="none">Ingen</option>
                <option value="sek_month">kr/mån</option>
                <option value="ore_per_kwh">öre/kWh</option>
              </select>
              <FieldError state={state} name="greenFeeMode" />
            </label>

            <div className="grid gap-1 text-sm">
              <input name="fixedPriceOrePerKwh" placeholder="Override fast pris öre/kWh" className={inputClassName(state, 'fixedPriceOrePerKwh')} />
              <FieldError state={state} name="fixedPriceOrePerKwh" />
            </div>

            <div className="grid gap-1 text-sm">
              <input name="spotMarkupOrePerKwh" placeholder="Override påslag öre/kWh" className={inputClassName(state, 'spotMarkupOrePerKwh')} />
              <FieldError state={state} name="spotMarkupOrePerKwh" />
            </div>

            <div className="grid gap-1 text-sm">
              <input name="variableFeeOrePerKwh" placeholder="Override rörlig avgift öre/kWh" className={inputClassName(state, 'variableFeeOrePerKwh')} />
              <FieldError state={state} name="variableFeeOrePerKwh" />
            </div>

            <div className="grid gap-1 text-sm">
              <input name="monthlyFeeSek" placeholder="Override månadsavgift kr" className={inputClassName(state, 'monthlyFeeSek')} />
              <FieldError state={state} name="monthlyFeeSek" />
            </div>

            <div className="grid gap-1 text-sm">
              <input name="greenFeeValue" placeholder="Override grön el-värde" className={inputClassName(state, 'greenFeeValue')} />
              <FieldError state={state} name="greenFeeValue" />
            </div>

            <div className="grid gap-1 text-sm">
              <input name="bindingMonths" placeholder="Bindningstid månader" className={inputClassName(state, 'bindingMonths')} />
              <FieldError state={state} name="bindingMonths" />
            </div>

            <div className="grid gap-1 text-sm">
              <input name="noticeMonths" placeholder="Uppsägningstid månader" className={inputClassName(state, 'noticeMonths')} />
              <FieldError state={state} name="noticeMonths" />
            </div>

            <label className="grid gap-1 text-sm md:col-span-2">
              <textarea name="optionalFeeLines" rows={4} placeholder={'Extra avgifter\nEtablering | 395 | sek\nNattillägg | 1.2 | ore_per_kwh'} className={inputClassName(state, 'optionalFeeLines', 'full')} />
              <FieldError state={state} name="optionalFeeLines" />
            </label>
          </div>
        </div>

        <CustomerIntakeEnhancer offers={contractOffers} />

        <button disabled={isPending} className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950">
          {isPending ? 'Skapar kund...' : 'Skapa kund med avtal'}
        </button>
      </form>
    </div>
  )
}