import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import {
  addCustomerContractEvent,
  getCustomerContractById,
  listCustomerContractEventsByCustomerId,
  listCustomerContractsByCustomerId,
  updateCustomerContract,
} from '@/lib/customer-contracts/db'
import type {
  ContractType,
  CustomerContractEventType,
  CustomerContractRow,
} from '@/lib/customer-contracts/types'
import { listCustomerSitesByCustomerId } from '@/lib/masterdata/db'

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'

  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value)
}

function contractTypeLabel(value: string): string {
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

function statusTone(status: string): string {
  switch (status) {
    case 'active':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300'
    case 'signed':
      return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-300'
    case 'pending_signature':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300'
    case 'terminated':
    case 'cancelled':
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300'
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }
}

function parseNumberOrNull(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = Number(trimmed.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function parseIntOrNull(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function parseContractType(value: FormDataEntryValue | null): ContractType {
  if (value === 'fixed') return 'fixed'
  if (value === 'variable_monthly') return 'variable_monthly'
  if (value === 'portfolio') return 'portfolio'
  return 'variable_hourly'
}

async function logEventAction(formData: FormData) {
  'use server'

  await requireAdminActionAccess(['masterdata.write'])

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  const customerId = String(formData.get('customer_id') ?? '').trim()
  const customerContractId = String(formData.get('customer_contract_id') ?? '').trim()
  const eventType = String(formData.get('event_type') ?? 'note').trim() as CustomerContractEventType
  const note = String(formData.get('note') ?? '').trim() || null
  const happenedAt = String(formData.get('happened_at') ?? '').trim() || null

  if (!customerId || !customerContractId) {
    throw new Error('customer_id och customer_contract_id krävs')
  }

  await addCustomerContractEvent({
    customerContractId,
    customerId,
    eventType,
    note,
    happenedAt,
    actorUserId: user.id,
  })

  revalidatePath(`/admin/customers/${customerId}`)
}

async function updateContractAction(formData: FormData) {
  'use server'

  await requireAdminActionAccess(['masterdata.write'])

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  const customerId = String(formData.get('customer_id') ?? '').trim()
  const contractId = String(formData.get('customer_contract_id') ?? '').trim()

  if (!customerId || !contractId) {
    throw new Error('customer_id och customer_contract_id krävs')
  }

  const before = await getCustomerContractById(contractId)
  if (!before || before.customer_id !== customerId) {
    throw new Error('Kundavtalet kunde inte hittas')
  }

  const nextStatus = String(formData.get('status') ?? before.status).trim() as CustomerContractRow['status']
  const signedAt = String(formData.get('signed_at') ?? '').trim() || null
  const startsAt = String(formData.get('starts_at') ?? '').trim() || null
  const endsAt = String(formData.get('ends_at') ?? '').trim() || null
  const terminationNoticeDate =
    String(formData.get('termination_notice_date') ?? '').trim() || null

  const updated = await updateCustomerContract({
    id: contractId,
    customerId,
    siteId: String(formData.get('site_id') ?? '').trim() || null,
    status: nextStatus,
    contractName: String(formData.get('contract_name') ?? '').trim() || before.contract_name,
    contractType: parseContractType(formData.get('contract_type')),
    fixedPriceOrePerKwh: parseNumberOrNull(formData.get('fixed_price_ore_per_kwh')),
    spotMarkupOrePerKwh: parseNumberOrNull(formData.get('spot_markup_ore_per_kwh')),
    variableFeeOrePerKwh: parseNumberOrNull(formData.get('variable_fee_ore_per_kwh')),
    monthlyFeeSek: parseNumberOrNull(formData.get('monthly_fee_sek')),
    bindingMonths: parseIntOrNull(formData.get('binding_months')),
    noticeMonths: parseIntOrNull(formData.get('notice_months')),
    startsAt,
    endsAt,
    signedAt,
    terminationNoticeDate,
    overrideReason: String(formData.get('override_reason') ?? '').trim() || null,
    actorUserId: user.id,
  })

  await addCustomerContractEvent({
    customerContractId: updated.id,
    customerId,
    eventType: 'updated',
    note: 'Kundavtal uppdaterat från kundkortet',
    metadata: {
      previousStatus: before.status,
      nextStatus: updated.status,
      previousSiteId: before.site_id,
      nextSiteId: updated.site_id,
    },
    actorUserId: user.id,
  })

  if (before.status !== updated.status) {
    if (updated.status === 'pending_signature') {
      await addCustomerContractEvent({
        customerContractId: updated.id,
        customerId,
        eventType: 'signature_requested',
        happenedAt: startsAt,
        note: 'Status ändrad till väntar signering från kundkortet',
        actorUserId: user.id,
      })
    }

    if (updated.status === 'signed') {
      await addCustomerContractEvent({
        customerContractId: updated.id,
        customerId,
        eventType: 'signed',
        happenedAt: signedAt ?? startsAt,
        note: 'Status ändrad till signerat från kundkortet',
        actorUserId: user.id,
      })
    }

    if (updated.status === 'active') {
      if (before.status !== 'signed') {
        await addCustomerContractEvent({
          customerContractId: updated.id,
          customerId,
          eventType: 'signed',
          happenedAt: signedAt ?? startsAt,
          note: 'Signering registrerad via kundkort före aktivering',
          actorUserId: user.id,
        })
      }

      await addCustomerContractEvent({
        customerContractId: updated.id,
        customerId,
        eventType: 'activated',
        happenedAt: startsAt,
        note: 'Status ändrad till aktiv från kundkortet',
        actorUserId: user.id,
      })
    }

    if (updated.status === 'terminated') {
      if (terminationNoticeDate && !before.termination_notice_date) {
        await addCustomerContractEvent({
          customerContractId: updated.id,
          customerId,
          eventType: 'termination_notice_received',
          happenedAt: terminationNoticeDate,
          note: 'Uppsägning registrerad från kundkortet',
          actorUserId: user.id,
        })
      }

      await addCustomerContractEvent({
        customerContractId: updated.id,
        customerId,
        eventType: 'terminated',
        happenedAt: endsAt ?? terminationNoticeDate,
        note: 'Status ändrad till avslutat från kundkortet',
        actorUserId: user.id,
      })
    }

    if (updated.status === 'cancelled') {
      await addCustomerContractEvent({
        customerContractId: updated.id,
        customerId,
        eventType: 'cancelled',
        happenedAt: endsAt,
        note: 'Status ändrad till avbrutet från kundkortet',
        actorUserId: user.id,
      })
    }
  }

  revalidatePath(`/admin/customers/${customerId}`)
}

function EditContractForm({
  contract,
  customerId,
  siteOptions,
}: {
  contract: CustomerContractRow
  customerId: string
  siteOptions: Array<{ id: string; label: string }>
}) {
  return (
    <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
      <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900 dark:text-white">
        Redigera detta avtal
      </summary>

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
            <span className="text-slate-600 dark:text-slate-300">Uppsägning mottagen</span>
            <input
              type="date"
              name="termination_notice_date"
              defaultValue={
                contract.termination_notice_date
                  ? contract.termination_notice_date.slice(0, 10)
                  : ''
              }
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
    </details>
  )
}

export default async function CustomerContractsCard({
  customerId,
}: {
  customerId: string
}) {
  const supabase = await createSupabaseServerClient()

  const [contracts, events, sites] = await Promise.all([
    listCustomerContractsByCustomerId(customerId),
    listCustomerContractEventsByCustomerId(customerId),
    listCustomerSitesByCustomerId(supabase, customerId),
  ])

  const siteOptions = sites.map((site) => ({
    id: site.id,
    label: site.facility_id ? `${site.site_name} • ${site.facility_id}` : site.site_name,
  }))

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Kundavtal och historik
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Snapshot av avtal per kund. Ändringar i avtalskatalogen ändrar inte retroaktivt gamla kundavtal.
          </p>
        </div>

        {contracts.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            Inget kundavtal registrerat ännu.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {contracts.map((contract) => {
              const contractEvents = events
                .filter((event) => event.customer_contract_id === contract.id)
                .slice(0, 6)

              return (
                <article key={contract.id} className="p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="font-medium text-slate-900 dark:text-white">
                        {contract.contract_name}
                      </div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {contractTypeLabel(contract.contract_type)} • {contract.source_type}
                        {contract.site_id ? ` • Site ${contract.site_id}` : ''}
                      </div>
                      {contract.override_reason ? (
                        <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                          Override: {contract.override_reason}
                        </div>
                      ) : null}
                    </div>

                    <span
                      className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(
                        contract.status
                      )}`}
                    >
                      {contract.status}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 text-sm text-slate-700 dark:text-slate-300 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950">
                      <div>Fast: {formatNumber(contract.fixed_price_ore_per_kwh)}</div>
                      <div>Påslag: {formatNumber(contract.spot_markup_ore_per_kwh)}</div>
                      <div>Rörlig: {formatNumber(contract.variable_fee_ore_per_kwh)}</div>
                      <div>Mån: {formatNumber(contract.monthly_fee_sek)}</div>
                    </div>

                    <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950">
                      <div>Bindning: {contract.binding_months ?? '—'} mån</div>
                      <div>Uppsägning: {contract.notice_months ?? '—'} mån</div>
                      <div>Start: {formatDateTime(contract.starts_at)}</div>
                      <div>Slut: {formatDateTime(contract.ends_at)}</div>
                    </div>

                    <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950">
                      <div>Signerat: {formatDateTime(contract.signed_at)}</div>
                      <div>
                        Uppsägning mottagen: {formatDateTime(contract.termination_notice_date)}
                      </div>
                      <div>Skapat: {formatDateTime(contract.created_at)}</div>
                    </div>

                    <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                      {contractEvents.length === 0 ? (
                        'Inga händelser ännu.'
                      ) : (
                        <div className="space-y-1">
                          {contractEvents.map((event) => (
                            <div key={event.id}>
                              <span className="font-medium text-slate-700 dark:text-slate-200">
                                {event.event_type}
                              </span>{' '}
                              • {formatDateTime(event.happened_at)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <EditContractForm
                    contract={contract}
                    customerId={customerId}
                    siteOptions={siteOptions}
                  />
                </article>
              )
            })}
          </div>
        )}
      </div>

      <aside className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">
          Logga avtalshändelse
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Använd detta när kund signerat, aktiverats, sagt upp eller när du vill lämna en manuell notering.
        </p>

        <form action={logEventAction} className="mt-4 space-y-4">
          <input type="hidden" name="customer_id" value={customerId} />

          <select
            name="customer_contract_id"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          >
            {contracts.length === 0 ? (
              <option value="">Inga avtal</option>
            ) : (
              contracts.map((contract) => (
                <option key={contract.id} value={contract.id}>
                  {contract.contract_name} • {contract.status}
                </option>
              ))
            )}
          </select>

          <select
            name="event_type"
            defaultValue="signed"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          >
            <option value="signature_requested">Signering skickad</option>
            <option value="signed">Signerat</option>
            <option value="activated">Aktiverat</option>
            <option value="termination_notice_received">Uppsägning mottagen</option>
            <option value="terminated">Avslutat</option>
            <option value="cancelled">Avbrutet</option>
            <option value="note">Notering</option>
          </select>

          <input
            type="datetime-local"
            name="happened_at"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />

          <textarea
            name="note"
            rows={5}
            placeholder="Notering"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />

          <button className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
            Spara händelse
          </button>
        </form>
      </aside>
    </section>
  )
}