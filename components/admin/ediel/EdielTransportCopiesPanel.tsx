'use client'

import { useState } from 'react'

type Copy = { attemptId: string; mimeSha256: string; mimeLength: number; rfcMessageId: string;
  enteredAt: string; observedAt: string | null; smtpClassification: string | null }

export default function EdielTransportCopiesPanel({ messageId }: { messageId: string }) {
  const [copies, setCopies] = useState<Copy[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function load() {
    setLoading(true); setError(null)
    try {
      const response = await fetch(`/api/ediel/messages/${messageId}/transport-copy`, { cache: 'no-store', credentials: 'same-origin' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Transportkopior kunde inte läsas.')
      if (result.status !== 'available') throw new Error('Ingen verifierad transportkopia är tillgänglig för det valda bolaget.')
      setCopies(result.copies)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Transportkopior kunde inte läsas.'); setCopies(null) }
    finally { setLoading(false) }
  }
  return <section className="rounded-3xl border border-slate-200 bg-white p-6">
    <h2 className="text-lg font-semibold text-slate-900">Arkiverad transportkopia</h2>
    <p className="mt-2 text-sm text-slate-600">Hämta den sparade transportens MIME-fil. Kvittens och affärssvar visas separat.</p>
    <button type="button" disabled={loading} onClick={load} className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">
      {loading ? 'Läser transportkopior…' : 'Visa transportkopior'}
    </button>
    {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
    {copies ? <ul className="mt-4 space-y-3">{copies.map(copy => <li key={copy.attemptId} className="rounded-xl border border-slate-200 p-3 text-sm">
      <div>SMTP-utfall: {copy.smtpClassification ?? 'Ej fastställt'}</div>
      <div>Transportstart: {copy.enteredAt}</div>
      <div>Arkivstorlek: {copy.mimeLength} byte</div>
      <p className="mt-1 break-all font-mono text-xs">SHA-256: {copy.mimeSha256}</p>
      <a className="mt-2 inline-block font-semibold text-emerald-700 underline" href={`/api/ediel/messages/${messageId}/transport-copy?attemptId=${copy.attemptId}`}>
        Hämta arkiverad MIME-fil
      </a>
    </li>)}</ul> : null}
  </section>
}
