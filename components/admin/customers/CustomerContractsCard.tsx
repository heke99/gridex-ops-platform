import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import {
  addCustomerContractEvent,
  listCustomerContractEventsByCustomerId,
  listCustomerContractsByCustomerId,
} from '@/lib/customer-contracts/db'
import type { CustomerContractEventType } from '@/lib/customer-contracts/types'

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
  const happenedAt =
    String(formData.get('happened_at') ?? '').trim() || null

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

export default async function CustomerContractsCard({
  customerId,
}: {
  customerId: string
}) {
  const [contracts, events] = await Promise.all([
    listCustomerContractsByCustomerId(customerId),
    listCustomerContractEventsByCustomerId(customerId),
  ])

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

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-950/50">
              <tr>
                <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                  Avtal
                </th>
                <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                  Status
                </th>
                <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                  Pris
                </th>
                <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                  Bind / uppsägning
                </th>
                <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-300">
                  Senaste händelser
                </th>
              </tr>
            </thead>

            <tbody>
              {contracts.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-10 text-center text-slate-500 dark:text-slate-400"
                  >
                    Inget kundavtal registrerat ännu.
                  </td>
                </tr>
              ) : (
                contracts.map((contract) => {
                  const contractEvents = events
                    .filter((event) => event.customer_contract_id === contract.id)
                    .slice(0, 4)

                  return (
                    <tr
                      key={contract.id}
                      className="border-t border-slate-100 align-top dark:border-slate-800"
                    >
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-900 dark:text-white">
                          {contract.contract_name}
                        </div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {contractTypeLabel(contract.contract_type)} • {contract.source_type}
                        </div>
                        {contract.override_reason ? (
                          <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                            Override: {contract.override_reason}
                          </div>
                        ) : null}
                      </td>

                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(
                            contract.status
                          )}`}
                        >
                          {contract.status}
                        </span>
                      </td>

                      <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                        <div>Fast: {formatNumber(contract.fixed_price_ore_per_kwh)}</div>
                        <div>Påslag: {formatNumber(contract.spot_markup_ore_per_kwh)}</div>
                        <div>Rörlig: {formatNumber(contract.variable_fee_ore_per_kwh)}</div>
                        <div>Mån: {formatNumber(contract.monthly_fee_sek)}</div>
                      </td>

                      <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                        {contract.binding_months ?? '—'} / {contract.notice_months ?? '—'} mån
                      </td>

                      <td className="px-6 py-4 text-xs text-slate-500 dark:text-slate-400">
                        {contractEvents.length === 0 ? (
                          '—'
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
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
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
            rows={4}
            placeholder="Anteckning eller signaturinfo"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />

          <button className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
            Spara avtalshändelse
          </button>
        </form>
      </aside>
    </section>
  )
}