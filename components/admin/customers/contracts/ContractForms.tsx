// components/admin/customers/contracts/ContractForms.tsx
import Link from 'next/link'
import type { OutboundRequestRow } from '@/lib/cis/types'
import type { ContractOfferRow, CustomerContractRow } from '@/lib/customer-contracts/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'
import {
  contractTypeLabel,
  formatDateOnly,
  formatNumber,
  getContractEditQuickActions,
  getContractMiniGlossary,
  getContractOpsStatus,
  getLifecycleSummary,
  type ContractOpsContext,
} from './helpers'
import {
  createContractAction,
  createContractFromOfferAction,
  logContractEventAction,
  updateContractAction,
} from './actions'

type SiteOption = { id: string; label: string }

function SectionCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-sm font-semibold text-slate-900 dark:text-white">{title}</div>
      {description ? (
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</div>
      ) : null}
      <div className="mt-4">{children}</div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
      {children}
    </label>
  )
}

function inputClassName() {
  return 'rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white'
}

function quickActionToneClass(tone: 'neutral' | 'warning' | 'danger' | 'success') {
  switch (tone) {
    case 'warning':
      return 'border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20'
    case 'danger':
      return 'border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-950/20'
    case 'success':
      return 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/20'
    default:
      return 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950'
  }
}

function MiniGlossary() {
  const items = getContractMiniGlossary()

  return (
    <SectionCard
      title="Snabbhjälp / begrepp"
      description="Små förklaringar så att man snabbt minns vad varje begrepp betyder i avtalsflödet."
    >
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-700 dark:text-slate-200">
              {item.term}
            </div>
            <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              {item.explanation}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}

function AutoRenewFields({
  autoRenewEnabled,
  autoRenewTermMonths,
}: {
  autoRenewEnabled?: boolean
  autoRenewTermMonths?: number | null
}) {
  return (
    <SectionCard
      title="Automatisk förlängning"
      description="Använd detta när avtalet ska fortsätta löpa vidare om kunden inte säger upp i tid."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm dark:border-slate-800">
          <input
            type="checkbox"
            name="auto_renew_enabled"
            defaultChecked={autoRenewEnabled}
            className="h-4 w-4 rounded border-slate-300"
          />
          <span className="text-slate-700 dark:text-slate-200">
            Förläng automatiskt om kunden inte säger upp i tid
          </span>
        </label>

        <Field label="Ny bindningsperiod vid förlängning (mån)">
          <input
            name="auto_renew_term_months"
            defaultValue={autoRenewTermMonths ?? ''}
            className={inputClassName()}
          />
        </Field>
      </div>
    </SectionCard>
  )
}

function TerminationFields({
  terminationNoticeDate,
  terminationReason,
}: {
  terminationNoticeDate?: string | null
  terminationReason?: CustomerContractRow['termination_reason']
}) {
  return (
    <SectionCard
      title="Uppsägning / avslut"
      description="Registrera när uppsägning kom in och välj den faktiska orsaken så att drift och support ser rätt läge direkt."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Uppsägning mottagen">
          <input
            type="date"
            name="termination_notice_date"
            defaultValue={terminationNoticeDate ? terminationNoticeDate.slice(0, 10) : ''}
            className={inputClassName()}
          />
        </Field>

        <Field label="Uppsägningsorsak">
          <select
            name="termination_reason"
            defaultValue={terminationReason ?? ''}
            className={inputClassName()}
          >
            <option value="">Ingen</option>
            <option value="switch_supplier">Kund byter leverantör</option>
            <option value="stop_supply">Kund avslutar helt</option>
            <option value="move_out">Move out / utflytt</option>
            <option value="manual_override">Manuell override / felregistrering</option>
            <option value="other">Övrigt</option>
          </select>
        </Field>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          <div className="font-semibold">Kund byter leverantör</div>
          <div className="mt-1">Switch = kunden lämnar er för annan elleverantör.</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          <div className="font-semibold">Kund avslutar helt</div>
          <div className="mt-1">Använd när leveransen ska upphöra helt utan nytt aktivt avtal.</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          <div className="font-semibold">Move out / utflytt</div>
          <div className="mt-1">Kunden flyttar från anläggningen eller adressen och avtalet måste följas upp.</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          <div className="font-semibold">Manuell override / felregistrering</div>
          <div className="mt-1">Använd när tidigare registrering varit fel eller måste rättas manuellt.</div>
        </div>
      </div>
    </SectionCard>
  )
}

function LifecycleSummaryBox({
  contract,
}: {
  contract: CustomerContractRow
}) {
  const lifecycle = getLifecycleSummary(contract)

  return (
    <div className="rounded-2xl bg-white px-4 py-3 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
      <div>Bindningstid: {contract.binding_months ?? '—'} mån</div>
      <div>Uppsägningstid: {contract.notice_months ?? '—'} mån</div>
      <div>
        Nuvarande avtalsperiod: {formatDateOnly(lifecycle.currentTermStart)} →{' '}
        {formatDateOnly(lifecycle.currentTermEnd)}
      </div>
      <div>Aktuellt slutdatum: {formatDateOnly(lifecycle.effectiveEndDate)}</div>
      <div>Nästa förlängning: {formatDateOnly(lifecycle.nextRenewalDate)}</div>
      <div>Uppsägning mottagen: {formatDateOnly(contract.termination_notice_date)}</div>
    </div>
  )
}

function OpsStatusRow({
  contract,
  opsContext,
}: {
  contract: CustomerContractRow
  opsContext?: ContractOpsContext | null
}) {
  const ops = getContractOpsStatus(contract, opsContext)

  return (
    <SectionCard
      title="Operationsstatus kopplad till avtalet"
      description="Detta visar om avtalet redan har ett relevant switchärende eller outbound kopplat till sig på samma anläggning."
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="text-xs uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
            Switchläge
          </div>
          <div className="mt-1 font-medium text-slate-900 dark:text-white">
            {ops.switchSummary}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="text-xs uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
            Outboundläge
          </div>
          <div className="mt-1 font-medium text-slate-900 dark:text-white">
            {ops.outboundSummary}
          </div>
        </div>
      </div>
    </SectionCard>
  )
}

function ContractOperationalActions({
  contract,
  customerId,
  opsContext,
}: {
  contract: CustomerContractRow
  customerId: string
  opsContext?: ContractOpsContext | null
}) {
  const quickActions = getContractEditQuickActions(contract, customerId, opsContext)

  return (
    <SectionCard
      title="Operativa snabbval"
      description="Det här är nästa rekommenderade arbetsyta utifrån nuvarande avtalsläge. Spara först avtalet om du ändrat något."
    >
      {quickActions.length === 0 ? (
        <div className="text-sm text-slate-500 dark:text-slate-400">
          Inga särskilda snabbval just nu. Fortsätt i avtalsdelen eller lägg till en händelse nedan vid behov.
        </div>
      ) : (
        <div className="grid gap-3">
          {quickActions.map((action) => (
            <div
              key={action.id}
              className={`rounded-2xl border px-4 py-4 ${quickActionToneClass(action.tone)}`}
            >
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                {action.title}
              </div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {action.description}
              </div>
              <div className="mt-3">
                <Link
                  href={action.href}
                  className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {action.label}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

function CoreContractFields({
  contract,
  siteOptions,
}: {
  contract: CustomerContractRow
  siteOptions: SiteOption[]
}) {
  return (
    <SectionCard title="Grunduppgifter">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Avtalsnamn">
          <input
            name="contract_name"
            defaultValue={contract.contract_name}
            className={inputClassName()}
          />
        </Field>

        <Field label="Status">
          <select
            name="status"
            defaultValue={contract.status}
            className={inputClassName()}
          >
            <option value="draft">Draft</option>
            <option value="pending_signature">Väntar signering</option>
            <option value="signed">Signerat</option>
            <option value="active">Aktivt</option>
            <option value="terminated">Avslutat</option>
            <option value="cancelled">Avbrutet</option>
            <option value="expired">Utgånget</option>
          </select>
        </Field>

        <Field label="Anläggning">
          <select
            name="site_id"
            defaultValue={contract.site_id ?? ''}
            className={inputClassName()}
          >
            <option value="">Ingen kopplad anläggning</option>
            {siteOptions.map((site) => (
              <option key={site.id} value={site.id}>
                {site.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Avtalstyp">
          <select
            name="contract_type"
            defaultValue={contract.contract_type}
            className={inputClassName()}
          >
            <option value="fixed">Fast</option>
            <option value="variable_monthly">Rörlig månad</option>
            <option value="variable_hourly">Rörlig tim</option>
            <option value="portfolio">Portfölj</option>
          </select>
        </Field>

        <Field label="Startdatum">
          <input
            type="date"
            name="starts_at"
            defaultValue={contract.starts_at ? contract.starts_at.slice(0, 10) : ''}
            className={inputClassName()}
          />
        </Field>

        <Field label="Slutdatum">
          <input
            type="date"
            name="ends_at"
            defaultValue={contract.ends_at ? contract.ends_at.slice(0, 10) : ''}
            className={inputClassName()}
          />
        </Field>

        <Field label="Signerat datum">
          <input
            type="date"
            name="signed_at"
            defaultValue={contract.signed_at ? contract.signed_at.slice(0, 10) : ''}
            className={inputClassName()}
          />
        </Field>

        <Field label="Bindningstid (mån)">
          <input
            name="binding_months"
            defaultValue={contract.binding_months ?? ''}
            className={inputClassName()}
          />
        </Field>

        <Field label="Uppsägningstid (mån)">
          <input
            name="notice_months"
            defaultValue={contract.notice_months ?? ''}
            className={inputClassName()}
          />
        </Field>
      </div>
    </SectionCard>
  )
}

function PriceFields({
  contract,
}: {
  contract: CustomerContractRow
}) {
  return (
    <SectionCard title="Pris och avgifter">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Fast pris (öre/kWh)">
          <input
            name="fixed_price_ore_per_kwh"
            defaultValue={contract.fixed_price_ore_per_kwh ?? ''}
            className={inputClassName()}
          />
        </Field>

        <Field label="Påslag (öre/kWh)">
          <input
            name="spot_markup_ore_per_kwh"
            defaultValue={contract.spot_markup_ore_per_kwh ?? ''}
            className={inputClassName()}
          />
        </Field>

        <Field label="Rörlig avgift (öre/kWh)">
          <input
            name="variable_fee_ore_per_kwh"
            defaultValue={contract.variable_fee_ore_per_kwh ?? ''}
            className={inputClassName()}
          />
        </Field>

        <Field label="Månadsavgift (SEK)">
          <input
            name="monthly_fee_sek"
            defaultValue={contract.monthly_fee_sek ?? ''}
            className={inputClassName()}
          />
        </Field>
      </div>
    </SectionCard>
  )
}

function ManualCoreFields({
  siteOptions,
}: {
  siteOptions: SiteOption[]
}) {
  return (
    <SectionCard title="Grunduppgifter">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Avtalsnamn">
          <input name="contract_name" className={inputClassName()} />
        </Field>

        <Field label="Status">
          <select
            name="status"
            defaultValue="draft"
            className={inputClassName()}
          >
            <option value="draft">Draft</option>
            <option value="pending_signature">Väntar signering</option>
            <option value="signed">Signerat</option>
            <option value="active">Aktivt</option>
          </select>
        </Field>

        <Field label="Anläggning">
          <select
            name="site_id"
            defaultValue=""
            className={inputClassName()}
          >
            <option value="">Ingen kopplad anläggning</option>
            {siteOptions.map((site) => (
              <option key={site.id} value={site.id}>
                {site.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Avtalstyp">
          <select
            name="contract_type"
            defaultValue="variable_hourly"
            className={inputClassName()}
          >
            <option value="fixed">Fast</option>
            <option value="variable_monthly">Rörlig månad</option>
            <option value="variable_hourly">Rörlig tim</option>
            <option value="portfolio">Portfölj</option>
          </select>
        </Field>

        <Field label="Startdatum">
          <input type="date" name="starts_at" className={inputClassName()} />
        </Field>

        <Field label="Signerat datum">
          <input type="date" name="signed_at" className={inputClassName()} />
        </Field>

        <Field label="Slutdatum">
          <input type="date" name="ends_at" className={inputClassName()} />
        </Field>

        <Field label="Bindningstid (mån)">
          <input name="binding_months" className={inputClassName()} />
        </Field>

        <Field label="Uppsägningstid (mån)">
          <input name="notice_months" className={inputClassName()} />
        </Field>
      </div>
    </SectionCard>
  )
}

function ManualPriceFields() {
  return (
    <SectionCard title="Pris och avgifter">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Fast pris (öre/kWh)">
          <input name="fixed_price_ore_per_kwh" className={inputClassName()} />
        </Field>

        <Field label="Påslag (öre/kWh)">
          <input name="spot_markup_ore_per_kwh" className={inputClassName()} />
        </Field>

        <Field label="Rörlig avgift (öre/kWh)">
          <input name="variable_fee_ore_per_kwh" className={inputClassName()} />
        </Field>

        <Field label="Månadsavgift (SEK)">
          <input name="monthly_fee_sek" className={inputClassName()} />
        </Field>

        <Field label="Grön avgift">
          <select
            name="green_fee_mode"
            defaultValue="none"
            className={inputClassName()}
          >
            <option value="none">Ingen</option>
            <option value="sek_month">SEK/mån</option>
            <option value="ore_per_kwh">öre/kWh</option>
          </select>
        </Field>

        <Field label="Grön avgift värde">
          <input name="green_fee_value" className={inputClassName()} />
        </Field>
      </div>
    </SectionCard>
  )
}

export function EditContractForm({
  contract,
  customerId,
  siteOptions,
  switchRequests = [],
  outboundRequests = [],
}: {
  contract: CustomerContractRow
  customerId: string
  siteOptions: SiteOption[]
  switchRequests?: SupplierSwitchRequestRow[]
  outboundRequests?: OutboundRequestRow[]
}) {
  const opsContext: ContractOpsContext = {
    switchRequests,
    outboundRequests,
  }

  return (
    <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
      <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900 dark:text-white">
        Redigera detta avtal
      </summary>

      <div className="mt-4">
        <LifecycleSummaryBox contract={contract} />
      </div>

      <div className="mt-4">
        <OpsStatusRow contract={contract} opsContext={opsContext} />
      </div>

      <div className="mt-4">
        <ContractOperationalActions
          contract={contract}
          customerId={customerId}
          opsContext={opsContext}
        />
      </div>

      <div className="mt-4">
        <MiniGlossary />
      </div>

      <form action={updateContractAction} className="mt-4 space-y-4">
        <input type="hidden" name="customer_id" value={customerId} />
        <input type="hidden" name="customer_contract_id" value={contract.id} />

        <CoreContractFields contract={contract} siteOptions={siteOptions} />
        <PriceFields contract={contract} />
        <TerminationFields
          terminationNoticeDate={contract.termination_notice_date}
          terminationReason={contract.termination_reason}
        />
        <AutoRenewFields
          autoRenewEnabled={contract.auto_renew_enabled}
          autoRenewTermMonths={contract.auto_renew_term_months}
        />

        <SectionCard
          title="Manuell kommentar / override"
          description="Använd detta när avtalet avviker från katalog, standardflöde eller tidigare registrering."
        >
          <textarea
            name="override_reason"
            rows={3}
            defaultValue={contract.override_reason ?? ''}
            className={inputClassName()}
          />
        </SectionCard>

        <div className="flex justify-end">
          <button className="inline-flex items-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
            Spara avtalet
          </button>
        </div>
      </form>

      <form
        action={logContractEventAction}
        className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800"
      >
        <input type="hidden" name="customer_id" value={customerId} />
        <input type="hidden" name="customer_contract_id" value={contract.id} />

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Händelsetyp">
            <select
              name="event_type"
              defaultValue="note"
              className={inputClassName()}
            >
              <option value="note">Notering</option>
              <option value="signature_requested">Signering skickad</option>
              <option value="signed">Signerat</option>
              <option value="activated">Aktiverat</option>
              <option value="termination_notice_received">Uppsägning mottagen</option>
              <option value="terminated">Avslutat</option>
              <option value="cancelled">Avbrutet</option>
            </select>
          </Field>

          <Field label="Datum">
            <input
              type="date"
              name="happened_at"
              defaultValue=""
              className={inputClassName()}
            />
          </Field>
        </div>

        <Field label="Notering">
          <textarea
            name="note"
            rows={3}
            placeholder="Skriv en manuell notering på avtalet"
            className={inputClassName()}
          />
        </Field>

        <div className="flex justify-end">
          <button className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
            Lägg till händelse
          </button>
        </div>
      </form>
    </details>
  )
}

export function CreateFromOfferForm({
  customerId,
  offer,
  siteOptions,
}: {
  customerId: string
  offer: ContractOfferRow
  siteOptions: SiteOption[]
}) {
  return (
    <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
      <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900 dark:text-white">
        Skapa från mall: {offer.name}
      </summary>

      <div className="mt-3 grid gap-2 text-xs text-slate-600 dark:text-slate-300 md:grid-cols-2">
        <div>Typ: {contractTypeLabel(offer.contract_type)}</div>
        <div>Månadsavgift: {offer.monthly_fee_sek ?? '—'} SEK</div>
        <div>Fast pris: {offer.fixed_price_ore_per_kwh ?? '—'} öre/kWh</div>
        <div>Påslag: {offer.spot_markup_ore_per_kwh ?? '—'} öre/kWh</div>
        <div>Rörlig avgift: {offer.variable_fee_ore_per_kwh ?? '—'} öre/kWh</div>
        <div>Bindning: {offer.default_binding_months ?? '—'} mån</div>
        <div>
          Grön avgift: {formatNumber(offer.green_fee_value)}{' '}
          {offer.green_fee_value !== null ? offer.green_fee_mode : ''}
        </div>
      </div>

      <form action={createContractFromOfferAction} className="mt-4 space-y-4">
        <input type="hidden" name="customer_id" value={customerId} />
        <input type="hidden" name="contract_offer_id" value={offer.id} />

        <SectionCard title="Grunduppgifter">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Status">
              <select
                name="status"
                defaultValue="pending_signature"
                className={inputClassName()}
              >
                <option value="draft">Draft</option>
                <option value="pending_signature">Väntar signering</option>
                <option value="signed">Signerat</option>
                <option value="active">Aktivt</option>
              </select>
            </Field>

            <Field label="Anläggning">
              <select
                name="site_id"
                defaultValue=""
                className={inputClassName()}
              >
                <option value="">Ingen kopplad anläggning</option>
                {siteOptions.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Startdatum">
              <input type="date" name="starts_at" className={inputClassName()} />
            </Field>

            <Field label="Signerat datum">
              <input type="date" name="signed_at" className={inputClassName()} />
            </Field>

            <Field label="Slutdatum">
              <input type="date" name="ends_at" className={inputClassName()} />
            </Field>
          </div>
        </SectionCard>

        <TerminationFields />

        <AutoRenewFields
          autoRenewEnabled={Boolean((offer.default_binding_months ?? 0) > 0)}
          autoRenewTermMonths={offer.default_binding_months}
        />

        <SectionCard
          title="Kommentar / override"
          description="Frivillig kommentar om varför denna avtalsmall valdes för kunden."
        >
          <textarea
            name="override_reason"
            rows={3}
            placeholder="Frivillig kommentar om varför denna avtalsmall valdes för kunden"
            className={inputClassName()}
          />
        </SectionCard>

        <button className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
          Skapa kundavtal från mall
        </button>
      </form>
    </details>
  )
}

export function CreateManualContractForm({
  customerId,
  siteOptions,
}: {
  customerId: string
  siteOptions: SiteOption[]
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="text-sm font-semibold text-slate-900 dark:text-white">
        Skapa manuellt kundavtal
      </div>

      <form action={createContractAction} className="mt-4 space-y-4">
        <input type="hidden" name="customer_id" value={customerId} />

        <ManualCoreFields siteOptions={siteOptions} />
        <ManualPriceFields />
        <TerminationFields />
        <AutoRenewFields />

        <SectionCard
          title="Manuell kommentar / override"
          description="Ange varför avtalet skapas manuellt eller avviker från katalogen."
        >
          <textarea
            name="override_reason"
            rows={3}
            placeholder="Ange varför avtalet skapas manuellt eller avviker från katalogen"
            className={inputClassName()}
          />
        </SectionCard>

        <button className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
          Skapa manuellt kundavtal
        </button>
      </form>
    </div>
  )
}