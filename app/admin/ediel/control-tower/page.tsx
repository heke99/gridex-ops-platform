// app/admin/ediel/control-tower/page.tsx

import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { listDuplicateAckCandidates, listEdielMessages, listOverdueAckMessages, listRuleAmbiguities } from '@/lib/ediel/db'

function tone(
  value: 'green' | 'yellow' | 'red' | 'slate' | 'blue'
): string {
  if (value === 'green') {
    return 'border-green-200 bg-green-50 text-green-700'
  }
  if (value === 'yellow') {
    return 'border-yellow-200 bg-yellow-50 text-yellow-700'
  }
  if (value === 'red') {
    return 'border-red-200 bg-red-50 text-red-700'
  }
  if (value === 'blue') {
    return 'border-blue-200 bg-blue-50 text-blue-700'
  }
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function ackTone(state: string): string {
  if (state === 'ack_overdue' || state === 'failed') return tone('red')
  if (state === 'awaiting_contrl' || state === 'awaiting_aperak') return tone('yellow')
  if (
    state === 'contrl_completed' ||
    state === 'aperak_received' ||
    state === 'utilts_err_received' ||
    state === 'no_ack_required'
  ) {
    return tone('green')
  }
  return tone('slate')
}

export default async function AdminEdielControlTowerPage() {
  await requirePermissionServer('operations.read')

  const [recentMessages, overdueMessages, duplicateAckCandidates, ruleAmbiguities] =
    await Promise.all([
      listEdielMessages({ limit: 20 }),
      listOverdueAckMessages({ limit: 50 }),
      listDuplicateAckCandidates(),
      listRuleAmbiguities(),
    ])

  return (
    <div className="space-y-6">
      <AdminHeader title="Ediel Control Tower" />

      <section className="grid gap-4 md:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Senaste meddelanden</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {recentMessages.length}
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Försenade kvittenser</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {overdueMessages.length}
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Ack-dubletter</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {duplicateAckCandidates.length}
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Regelkonflikter</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {ruleAmbiguities.length}
          </p>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Försenade kvittenser</h2>
          <p className="mt-1 text-sm text-slate-500">
            Meddelanden där CONTRL, APERAK eller UTILTS_ERR fortfarande är pending efter ack_due_at.
          </p>
        </div>

        {overdueMessages.length === 0 ? (
          <div className="px-5 py-6 text-sm text-slate-500">
            Inga försenade kvittenser just nu.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Meddelande</th>
                  <th className="px-4 py-3 font-medium">Riktning</th>
                  <th className="px-4 py-3 font-medium">Ack-status</th>
                  <th className="px-4 py-3 font-medium">Due</th>
                  <th className="px-4 py-3 font-medium">Relation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overdueMessages.map((row) => {
                  const canonicalState =
                    row.contrl_status === 'pending'
                      ? 'awaiting_contrl'
                      : row.aperak_status === 'pending'
                        ? 'awaiting_aperak'
                        : row.utilts_err_status === 'pending'
                          ? 'ack_overdue'
                          : 'in_progress'

                  return (
                    <tr key={row.id}>
                      <td className="px-4 py-3 align-top">
                        <Link
                          href={`/admin/ediel/messages/${row.id}`}
                          className="font-medium text-slate-900 underline-offset-2 hover:underline"
                        >
                          {row.message_family} {row.message_code}
                        </Link>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.external_reference || row.transaction_reference || row.id}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {row.direction}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${ackTone(canonicalState)}`}
                        >
                          {canonicalState}
                        </span>
                        <div className="mt-2 space-y-1 text-xs text-slate-500">
                          <div>CONTRL: {row.contrl_status ?? '—'}</div>
                          <div>APERAK: {row.aperak_status ?? '—'}</div>
                          <div>UTILTS_ERR: {row.utilts_err_status ?? '—'}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-slate-500">
                        {row.ack_due_at ? new Date(row.ack_due_at).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-slate-500">
                        {row.switch_request_id ? (
                          <Link
                            href={`/admin/operations/switches/${row.switch_request_id}`}
                            className="underline-offset-2 hover:underline"
                          >
                            Switch
                          </Link>
                        ) : row.grid_owner_data_request_id ? (
                          <Link
                            href={`/admin/operations/grid-owner-requests/${row.grid_owner_data_request_id}`}
                            className="underline-offset-2 hover:underline"
                          >
                            Grid owner request
                          </Link>
                        ) : row.outbound_request_id ? (
                          <Link
                            href={`/admin/outbound`}
                            className="underline-offset-2 hover:underline"
                          >
                            Outbound
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">Dublettskydd ack</h2>
            <p className="mt-1 text-sm text-slate-500">
              DB-vyn visar om det ändå finns mer än en outbound CONTRL/APERAK/UTILTS_ERR för samma source message.
            </p>
          </div>

          {duplicateAckCandidates.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-500">
              Inga ack-dubletter hittades.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {duplicateAckCandidates.map((row) => (
                <li key={`${row.related_message_id}-${row.message_family}`} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-slate-900">
                        {row.message_family} × {row.duplicate_count}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Source message: {row.related_message_id}
                      </p>
                    </div>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${tone('red')}`}>
                      måste städas
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">Regelambiguiteter</h2>
            <p className="mt-1 text-sm text-slate-500">
              Visar om flera aktiva regler fortfarande tävlar om samma family/code/standard/direction.
            </p>
          </div>

          {ruleAmbiguities.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-500">
              Inga regelambiguiteter hittades.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {ruleAmbiguities.map((row) => (
                <li
                  key={`${row.message_family}-${row.message_code}-${row.message_standard}-${row.direction}`}
                  className="px-5 py-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-slate-900">
                        {row.message_family} {row.message_code}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {row.message_standard} / {row.direction}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">
                        Versioner: {row.version_codes.join(', ')}
                      </p>
                    </div>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${tone('red')}`}>
                      {row.active_rule_count} aktiva
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Senaste Ediel-meddelanden</h2>
          <p className="mt-1 text-sm text-slate-500">
            Snabbvy för senaste flödena medan Batch 1–3 kopplas in i resten av systemet.
          </p>
        </div>

        {recentMessages.length === 0 ? (
          <div className="px-5 py-6 text-sm text-slate-500">
            Inga meddelanden hittades.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Meddelande</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Ack</th>
                  <th className="px-4 py-3 font-medium">Sender → Receiver</th>
                  <th className="px-4 py-3 font-medium">Tid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentMessages.map((row) => {
                  const ackState =
                    row.contrl_status === 'pending'
                      ? 'awaiting_contrl'
                      : row.aperak_status === 'pending'
                        ? 'awaiting_aperak'
                        : row.status === 'failed'
                          ? 'failed'
                          : row.requires_contrl === false && row.requires_aperak === false
                            ? 'no_ack_required'
                            : row.aperak_status === 'received'
                              ? 'aperak_received'
                              : row.contrl_status === 'received'
                                ? 'contrl_completed'
                                : 'in_progress'

                  return (
                    <tr key={row.id}>
                      <td className="px-4 py-3 align-top">
                        <Link
                          href={`/admin/ediel/messages/${row.id}`}
                          className="font-medium text-slate-900 underline-offset-2 hover:underline"
                        >
                          {row.message_family} {row.message_code}
                        </Link>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.message_version || 'utan version'}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">{row.status}</td>
                      <td className="px-4 py-3 align-top">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${ackTone(ackState)}`}
                        >
                          {ackState}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-slate-500">
                        {row.sender_ediel_id || '—'} → {row.receiver_ediel_id || '—'}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-slate-500">
                        {new Date(row.created_at).toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}