import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { getCanonicalAckState } from '@/lib/ediel/ack'
import {
  listDuplicateAckCandidates,
  listEdielMessages,
  listOverdueAckMessages,
  listRuleAmbiguities,
} from '@/lib/ediel/db'

function tone(value: 'green' | 'yellow' | 'red' | 'slate' | 'blue'): string {
  if (value === 'green') return 'border-green-200 bg-green-50 text-green-700'
  if (value === 'yellow') return 'border-yellow-200 bg-yellow-50 text-yellow-700'
  if (value === 'red') return 'border-red-200 bg-red-50 text-red-700'
  if (value === 'blue') return 'border-blue-200 bg-blue-50 text-blue-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function ackTone(state: string): string {
  if (
    state === 'ack_overdue' ||
    state === 'failed' ||
    state === 'contrl_failed' ||
    state === 'aperak_received_negative'
  ) {
    return tone('red')
  }
  if (
    state === 'awaiting_contrl' ||
    state === 'awaiting_aperak' ||
    state === 'in_progress'
  ) {
    return tone('yellow')
  }
  if (
    state === 'contrl_received' ||
    state === 'contrl_completed' ||
    state === 'aperak_received' ||
    state === 'aperak_received_positive' ||
    state === 'utilts_err_received' ||
    state === 'no_ack_required'
  ) {
    return tone('green')
  }
  if (state === 'sent' || state === 'validated' || state === 'parsed') {
    return tone('blue')
  }
  return tone('slate')
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
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

  const inboundCount = recentMessages.filter((row) => row.direction === 'inbound').length
  const outboundCount = recentMessages.filter((row) => row.direction === 'outbound').length
  const failedRecentCount = recentMessages.filter((row) => row.status === 'failed').length

  return (
    <div className="space-y-6">
      <AdminHeader
        title="Ediel Control Tower"
        subtitle="Canonical översikt för overdue ack, dublettrisker, regelkonflikter och senaste trafik."
      />

      <section className="grid gap-4 md:grid-cols-4 xl:grid-cols-7">
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Senaste meddelanden</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {recentMessages.length}
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Inbound</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{inboundCount}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Outbound</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{outboundCount}</p>
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
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Failed senaste</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {failedRecentCount}
          </p>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Försenade kvittenser</h2>
          <p className="mt-1 text-sm text-slate-500">
            Control tower använder canonical ack state från samma logik som meddelandesidan.
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
                  <th className="px-4 py-3 font-medium">Ref</th>
                  <th className="px-4 py-3 font-medium">Öppna</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overdueMessages.map((row) => {
                  const canonicalState = getCanonicalAckState(row)
                  return (
                    <tr key={row.id}>
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-slate-900">
                          {row.message_family} {row.message_code}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.message_version || 'utan version'}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">{row.direction}</td>
                      <td className="px-4 py-3 align-top">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${ackTone(
                            String(canonicalState)
                          )}`}
                        >
                          {String(canonicalState)}
                        </span>
                        <div className="mt-2 space-y-1 text-xs text-slate-500">
                          <div>CONTRL: {row.contrl_status ?? '—'}</div>
                          <div>APERAK: {row.aperak_status ?? '—'}</div>
                          <div>UTILTS_ERR: {row.utilts_err_status ?? '—'}</div>
                          <div>Kräver CONTRL: {row.requires_contrl ? 'Ja' : 'Nej'}</div>
                          <div>Kräver APERAK: {row.requires_aperak ? 'Ja' : 'Nej'}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-slate-500">
                        {formatDate(row.ack_due_at)}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-slate-500">
                        <div>Meddelande-ID: {row.id}</div>
                        <div>Status: {row.status}</div>
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-slate-500">
                        <Link
                          href={`/admin/ediel/messages/${row.id}`}
                          className="underline-offset-2 hover:underline"
                        >
                          Öppna meddelande
                        </Link>
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
              Visar om historik eller runtime ändå producerat mer än en outbound-ack för samma källa.
            </p>
          </div>
          {duplicateAckCandidates.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-500">
              Inga ack-dubletter hittades.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {duplicateAckCandidates.map((row) => (
                <li
                  key={`${row.related_message_id}-${row.message_family}`}
                  className="px-5 py-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-slate-900">
                        {row.message_family} × {row.duplicate_count}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Source message: {row.related_message_id}
                      </p>
                    </div>
                    <Link
                      href={`/admin/ediel/messages/${row.related_message_id}`}
                      className="text-sm text-slate-700 underline-offset-2 hover:underline"
                    >
                      Öppna källa
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">Versions-/regelkonflikter</h2>
            <p className="mt-1 text-sm text-slate-500">
              Visar när regelsättet inte ger ett entydigt runtime-beslut.
            </p>
          </div>
          {ruleAmbiguities.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-500">
              Inga regelkonflikter hittades.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {ruleAmbiguities.map((row) => (
                <li
                  key={`${row.message_family}-${row.message_code}-${row.message_standard}-${row.direction}`}
                  className="px-5 py-4"
                >
                  <div className="font-medium text-slate-900">
                    {row.message_family} {row.message_code} / {row.direction}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {row.message_standard} · {row.active_rule_count} aktiva regler
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    </div>
  )
}