import type { ContractOfferRow, CustomerContractRow } from '@/lib/customer-contracts/types'
import {
  contractTypeLabel,
  formatDateOnly,
  formatNumber,
  getLifecycleSummary,
} from './helpers'
import {
  createContractAction,
  createContractFromOfferAction,
  logContractEventAction,
  updateContractAction,
} from './actions'

type SiteOption = { id: string; label: string }

function AutoRenewFields({
  autoRenewEnabled,
  autoRenewTermMonths,
}: {
  autoRenewEnabled?: boolean
  autoRenewTermMonths?: number | null
}) {
  return (
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

      <label className="grid gap-1 text-sm">
        <span className="text-slate-600 dark:text-slate-300">Ny bindningsperiod vid förlängning (mån)</span>
        <input
          name="auto_renew_term_months"
          defaultValue={autoRenewTermMonths ?? ''}
          className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        />
      </label>
    </div>
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
    <div className="grid gap-4 md:grid-cols-2">
      <label className="grid gap-1 text-sm">
        <span className="text-slate-600 dark:text-slate-300">Uppsägning mottagen</span>
        <input
          type="date"
          name="termination_notice_date"
          defaultValue={terminationNoticeDate ? terminationNoticeDate.slice(0, 10) : ''}
          className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        />
      </label>

      <label className="grid gap-1 text-sm">
        <span className="text-slate-600 dark:text-slate-300">Uppsägning orsak</span>
        <select
          name="termination_reason"
          defaultValue={terminationReason ?? ''}
          className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        >
          <option value="">Ingen</option>
          <option value="switch_supplier">Byte av leverantör</option>
          <option value="stop_supply">Ingen fortsatt leverans</option>
          <option value="move_out">Utflytt</option>
          <option value="manual_override">Manuell rättning</option>
          <option value="other">Övrigt</option>
        </select>
      </label>
    </div>
  )
}

export function EditContractForm({
  contract,
  customerId,
  siteOptions,
}: {
  contract: CustomerContractRow
  customerId: string
  siteOptions: SiteOption[]
}) {
  const lifecycle = getLifecycleSummary(contract)

  return (
    <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
      <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900 dark:text-white">
        Redigera detta avtal
      </summary>

      <div className="mt-4 rounded-2xl bg-white px-4 py-3 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
        <div>Nuvarande avtalsperiod: {formatDateOnly(lifecycle.currentTermStart)} → {formatDateOnly(lifecycle.currentTermEnd)}</div>
        <div>Nästa förlängning: {formatDateOnly(lifecycle.nextRenewalDate)}</div>
      </div>

      <form action={updateContractAction} className="mt-4 space-y-4">
        <input type="hidden" name="customer_id" value={customerId} />
        <input type="hidden" name="customer_contract_id" value={contract.id} />

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Avtalsnamn</span>
            <input
              name="contract_name"
              defaultValue={contract.contract_name}
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Status</span>
            <select
              name="status"
              defaultValue={contract.status}
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="draft">Draft</option>
              <option value="pending_signature">Väntar signering</option>
              <option value="signed">Signerat</option>
              <option value="active">Aktivt</option>
              <option value="terminated">Avslutat</option>
              <option value="cancelled">Avbrutet</option>
              <option value="expired">Utgånget</option>
            </select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Anläggning</span>
            <select
              name="site_id"
              defaultValue={contract.site_id ?? ''}
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="">Ingen kopplad anläggning</option>
              {siteOptions.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Avtalstyp</span>
            <select
              name="contract_type"
              defaultValue={contract.contract_type}
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="fixed">Fast</option>
              <option value="variable_monthly">Rörlig månad</option>
              <option value="variable_hourly">Rörlig tim</option>
              <option value="portfolio">Portfölj</option>
            </select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Startdatum</span>
            <input
              type="date"
              name="starts_at"
              defaultValue={contract.starts_at ? contract.starts_at.slice(0, 10) : ''}
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Slutdatum</span>
            <input
              type="date"
              name="ends_at"
              defaultValue={contract.ends_at ? contract.ends_at.slice(0, 10) : ''}
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Signerat datum</span>
            <input
              type="date"
              name="signed_at"
              defaultValue={contract.signed_at ? contract.signed_at.slice(0, 10) : ''}
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Fast pris (öre/kWh)</span>
            <input
              name="fixed_price_ore_per_kwh"
              defaultValue={contract.fixed_price_ore_per_kwh ?? ''}
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Påslag (öre/kWh)</span>
            <input
              name="spot_markup_ore_per_kwh"
              defaultValue={contract.spot_markup_ore_per_kwh ?? ''}
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Rörlig avgift (öre/kWh)</span>
            <input
              name="variable_fee_ore_per_kwh"
              defaultValue={contract.variable_fee_ore_per_kwh ?? ''}
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Månadsavgift (SEK)</span>
            <input
              name="monthly_fee_sek"
              defaultValue={contract.monthly_fee_sek ?? ''}
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Bindning (mån)</span>
            <input
              name="binding_months"
              defaultValue={contract.binding_months ?? ''}
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Uppsägningstid (mån)</span>
            <input
              name="notice_months"
              defaultValue={contract.notice_months ?? ''}
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>
        </div>

        <TerminationFields
          terminationNoticeDate={contract.termination_notice_date}
          terminationReason={contract.termination_reason}
        />

        <AutoRenewFields
          autoRenewEnabled={contract.auto_renew_enabled}
          autoRenewTermMonths={contract.auto_renew_term_months}
        />

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Override reason</span>
          <textarea
            name="override_reason"
            rows={3}
            defaultValue={contract.override_reason ?? ''}
            className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </label>

        <div className="flex justify-end">
          <button className="inline-flex items-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
            Spara avtalet
          </button>
        </div>
      </form>

      <form action={logContractEventAction} className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
        <input type="hidden" name="customer_id" value={customerId} />
        <input type="hidden" name="customer_contract_id" value={contract.id} />

        <div className="grid gap-4 md:grid-cols-3">
          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Händelsetyp</span>
            <select
              name="event_type"
              defaultValue="note"
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="note">Notering</option>
              <option value="signature_requested">Signering skickad</option>
              <option value="signed">Signerat</option>
              <option value="activated">Aktiverat</option>
              <option value="termination_notice_received">Uppsägning mottagen</option>
              <option value="terminated">Avslutat</option>
              <option value="cancelled">Avbrutet</option>
            </select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Datum</span>
            <input
              type="date"
              name="happened_at"
              defaultValue=""
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>
        </div>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Notering</span>
          <textarea
            name="note"
            rows={3}
            placeholder="Skriv en manuell notering på avtalet"
            className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </label>

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
      </div>

      <form action={createContractFromOfferAction} className="mt-4 space-y-4">
        <input type="hidden" name="customer_id" value={customerId} />
        <input type="hidden" name="contract_offer_id" value={offer.id} />

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Status</span>
            <select
              name="status"
              defaultValue="pending_signature"
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="draft">Draft</option>
              <option value="pending_signature">Väntar signering</option>
              <option value="signed">Signerat</option>
              <option value="active">Aktivt</option>
            </select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Anläggning</span>
            <select
              name="site_id"
              defaultValue=""
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="">Ingen kopplad anläggning</option>
              {siteOptions.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Startdatum</span>
            <input
              type="date"
              name="starts_at"
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Signerat datum</span>
            <input
              type="date"
              name="signed_at"
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Slutdatum</span>
            <input
              type="date"
              name="ends_at"
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </label>
        </div>

        <TerminationFields />

        <AutoRenewFields
          autoRenewEnabled={Boolean((offer.default_binding_months ?? 0) > 0)}
          autoRenewTermMonths={offer.default_binding_months}
        />

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Kommentar / override reason</span>
          <textarea
            name="override_reason"
            rows={3}
            placeholder="Frivillig kommentar om varför denna avtalsmall valdes för kunden"
            className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </label>

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

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Avtalsnamn</span>
            <input
              name="contract_name"
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Status</span>
            <select
              name="status"
              defaultValue="draft"
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              <option value="draft">Draft</option>
              <option value="pending_signature">Väntar signering</option>
              <option value="signed">Signerat</option>
              <option value="active">Aktivt</option>
            </select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Anläggning</span>
            <select
              name="site_id"
              defaultValue=""
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              <option value="">Ingen kopplad anläggning</option>
              {siteOptions.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Avtalstyp</span>
            <select
              name="contract_type"
              defaultValue="variable_hourly"
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              <option value="fixed">Fast</option>
              <option value="variable_monthly">Rörlig månad</option>
              <option value="variable_hourly">Rörlig tim</option>
              <option value="portfolio">Portfölj</option>
            </select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Startdatum</span>
            <input
              type="date"
              name="starts_at"
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Signerat datum</span>
            <input
              type="date"
              name="signed_at"
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Slutdatum</span>
            <input
              type="date"
              name="ends_at"
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Fast pris (öre/kWh)</span>
            <input
              name="fixed_price_ore_per_kwh"
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Påslag (öre/kWh)</span>
            <input
              name="spot_markup_ore_per_kwh"
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Rörlig avgift (öre/kWh)</span>
            <input
              name="variable_fee_ore_per_kwh"
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Månadsavgift (SEK)</span>
            <input
              name="monthly_fee_sek"
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Grön avgift</span>
            <select
              name="green_fee_mode"
              defaultValue="none"
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              <option value="none">Ingen</option>
              <option value="sek_month">SEK/mån</option>
              <option value="ore_per_kwh">öre/kWh</option>
            </select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Grön avgift värde</span>
            <input
              name="green_fee_value"
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Bindning (mån)</span>
            <input
              name="binding_months"
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Uppsägningstid (mån)</span>
            <input
              name="notice_months"
              className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>
        </div>

        <TerminationFields />
        <AutoRenewFields />

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Override reason</span>
          <textarea
            name="override_reason"
            rows={3}
            placeholder="Ange varför avtalet skapas manuellt eller avviker från katalogen"
            className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </label>

        <button className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
          Skapa manuellt kundavtal
        </button>
      </form>
    </div>
  )
}