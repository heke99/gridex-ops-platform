'use client'

import { useState } from 'react'
import type { EdielTransportCopy, EdielTransportReconciliationCase } from '@/lib/ediel/transport/copy'

type Copy = Pick<EdielTransportCopy, 'attemptId' | 'mimeSha256' | 'mimeLength' | 'enteredAt' | 'smtpClassification'>
type ReconciliationCase = Pick<EdielTransportReconciliationCase, 'caseId' | 'attemptId' | 'reason' | 'status' | 'observedClassification'>
type TransportCopyResponse = {
  status?: 'available' | 'held' | 'unavailable'
  copies?: Copy[]
  reconciliationCases?: ReconciliationCase[]
  error?: string
}
type ReadState = { messageId: string } & (
  | { status: 'loading' }
  | { status: 'failed'; error: string }
  | { status: 'loaded'; copies: Copy[] | null; reconciliationCases: ReconciliationCase[] | null }
)

export default function EdielTransportCopiesPanel({ messageId }: { messageId: string }) {
  const [read, setRead] = useState<ReadState | null>(null)
  const current = read?.messageId === messageId ? read : null
  const loading = current?.status === 'loading'
  const result = current?.status === 'loaded' ? current : null
  const error = current?.status === 'failed' ? current.error :
    result?.copies === null ? 'Ingen verifierad transportkopia är tillgänglig för det valda bolaget.' : null

  async function load() {
    const pending = { messageId, status: 'loading' } as const
    setRead(pending)
    let completion: ReadState
    try {
      const response = await fetch(`/api/ediel/messages/${messageId}/transport-copy`, { cache: 'no-store', credentials: 'same-origin' })
      const payload = await response.json() as TransportCopyResponse
      if (!response.ok) throw new Error(payload.error ?? 'Transportkopior kunde inte läsas.')
      const copies = payload.status === 'available' && Array.isArray(payload.copies) ? payload.copies : null
      const reconciliationCases = Array.isArray(payload.reconciliationCases) ? payload.reconciliationCases : null
      completion = { messageId, status: 'loaded', copies, reconciliationCases }
    } catch (cause) {
      completion = {
        messageId,
        status: 'failed',
        error: cause instanceof Error ? cause.message : 'Transportkopior kunde inte läsas.',
      }
    }
    setRead(active => active === pending ? completion : active)
  }
  return <section className="rounded-3xl border border-slate-200 bg-white p-6">
    <h2 className="text-lg font-semibold text-slate-900">Arkiverad transportkopia</h2>
    <p className="mt-2 text-sm text-slate-600">Visa transportens avstämningsärenden och hämta verifierade MIME-kopior. Kvittens och affärssvar visas separat.</p>
    <button type="button" disabled={loading} onClick={load} className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">
      {loading ? 'Läser transportkopior…' : 'Visa transportkopior'}
    </button>
    {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
    {result ? <div className="mt-4">
      <h3 className="font-semibold text-slate-900">Avstämningsärenden</h3>
      {result.reconciliationCases === null ? <p role="status" className="mt-2 text-sm text-slate-600">Avstämningsärenden kunde inte läsas.</p> :
        result.reconciliationCases.length === 0 ? <p className="mt-2 text-sm text-slate-600">Inga avstämningsärenden.</p> :
          <ul className="mt-2 space-y-3">{result.reconciliationCases.map(item => <li key={item.caseId} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-slate-900">
            <p className="font-semibold">{item.status === 'outcome_observed' ? 'SMTP-utfall observerat' : 'Behöver avstämmas'}</p>
            <p className="mt-1">Transportförsök <code className="break-all">{item.attemptId}</code></p>
            <p>{item.reason === 'entry_unresolved_after_lease' ? 'Arbetarlåset löpte ut efter transportstart.' : 'SMTP lämnade inget säkert slutligt besked.'}</p>
            {item.observedClassification ? <p>SMTP-utfall: {item.observedClassification}</p> : null}
          </li>)}</ul>}
    </div> : null}
    {result?.copies?.length ? <ul className="mt-4 space-y-3">{result.copies.map(copy => <li key={copy.attemptId} className="rounded-xl border border-slate-200 p-3 text-sm">
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
